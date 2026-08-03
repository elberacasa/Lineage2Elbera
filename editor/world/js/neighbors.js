// Neighbor tiles: the 8 tiles surrounding the current one, rendered CHEAP
// so the world doesn't end in a fog-gray void at every tile border.
//
// Cost contract (vs the full center tile):
//   * one texture per neighbor — a 256x256 canvas baked at load from the
//     tile's splat layers (the same blend rule as the center shader; the
//     converter's basecolor.png preview is overexposed on multi-layer tiles
//     and only used for single-layer ones) on a plain MeshLambertMaterial.
//     NO sampler2DArrays: 8 x the center's splat-blend material would blow
//     the 16-unit fragment-texture budget.
//   * no props, no water, no shadows, no runtime splat blending.
//   * geodata is LAZY: heights/geodata only load when the character gets
//     near the boundary (preloadNear) or actually stands on the tile
//     (heightAtWorld). Until then the heightmap bilinear answers.
//
// Missing tiles (map edges — not every tx_ty exists in assets/world) are
// skipped: the void stays there but nothing crashes.
//
// The character can WALK across a boundary before the scene switch lands;
// entryAt + NeighborTile.heightAtWorld keep it grounded (the walking layer
// rule from js/geodata.js applies unchanged: nearest layer below
// z + MAX_STEP_UP_L2).

import * as THREE from 'three';
import { L2_TO_M, l2ToThree } from './coords.js';
import { Geodata } from './geodata.js';
import { correctHeightsWithGeodata } from './terrain.js';

// walking rule, same constant as terrain.js: a walker gains at most this
// much in one step — taller layers are walls, not floors (L2 units). 48 =
// aCis's per-cell climb limit (GeoStructure.CELL_IGNORE_HEIGHT).
const MAX_STEP_UP_L2 = 48;
// L2 units per tile edge (256 samples x 128 spacing; the last sample column
// is stretched to this far edge so tiles abut without a crack)
const TILE_L2 = 32768;
// neighbor mesh resolution (vertices per edge). The heightmap is 256, but
// background tiles are fog-distant scenery: 8 x 256² meshes cost ~4.9x the
// bare frame time on SwiftShader (measured), so the default is decimated
// 64x64 (~8k tris/tile vs 130k). '?nres=N' overrides for perf comparisons.
const MESH_RES = (() => {
  const v = Number(new URLSearchParams(location.search).get('nres'));
  return Number.isInteger(v) && v >= 8 && v <= 256 ? v : 64;
})();
// gray-brown stand-in when neither basecolor.png nor a first-layer diffuse
// loads (mirrors the terrain.js graceful-path spirit)
const FALLBACK_COLOR = 0x8a7a5e;

export class NeighborTile {
  constructor(tile, baseUrl) {
    this.tile = tile;
    this.baseUrl = baseUrl;
    this.def = null;
    this.heights = null;        // Uint16Array 256x256 (source grid)
    this.mesh = null;
    this.group = new THREE.Group();
    this.geodata = null;        // lazy — see ensureGeodata()
    this._geoPromise = null;
  }

  async load() {
    this.def = await (await fetch(this.baseUrl + 'scene.json')).json();
    const g = this.def.gridSize || 256;
    const res = await fetch(this.baseUrl + this.def.heightmap);
    if (!res.ok) throw new Error(`heightmap fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const view = new DataView(buf);
    this.heights = new Uint16Array(g * g);
    for (let i = 0; i < g * g; i++) this.heights[i] = view.getUint16(i * 2, true);

    const material = await this._buildMaterial();
    this.mesh = new THREE.Mesh(this._buildGeometry(), material);
    this.mesh.name = `neighbor-${this.tile}`;
    this.group.add(this.mesh);
  }

  // one texture, one draw call. Primary: a client-side BAKE of the tile's
  // splat blend into a single 256x256 canvas — the same sequential
  // fg*a+bg*(1-a) rule as the center tile's shader (terrain.js), so the
  // neighbor's colors match the full-quality render. basecolor.png would be
  // the cheap path, but the converter's preview sums base(255)+splats and
  // clips (tools/world/convert.py build_basecolor) — every multi-layer tile
  // bakes out overexposed/white; it's only sound for single-layer tiles
  // (their base weight is exactly 255), so those do use it. Final fallback:
  // first-layer diffuse, then a flat color. A missing texture must never
  // kill the neighborhood.
  async _buildMaterial() {
    const layers = (this.def.layers || []).filter(l => l && l.diffuse);
    const hasSplats = layers.some((l, i) => i > 0 && l.splat);
    if (hasSplats) {
      const baked = await this._bakeSplatTexture(layers);
      if (baked) return new THREE.MeshLambertMaterial({ map: baked });
    }
    const tex = await this._loadTexture('basecolor.png');
    if (tex) return new THREE.MeshLambertMaterial({ map: tex });
    if (layers.length) {
      const t = await this._loadTexture(layers[0].diffuse);
      if (t) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        const quads = (this.def.gridSize || 256) - 1;
        t.repeat.set(quads / (layers[0].uscale ?? 1), quads / (layers[0].vscale ?? 1));
        return new THREE.MeshLambertMaterial({ map: t });
      }
    }
    return new THREE.MeshLambertMaterial({ color: FALLBACK_COLOR });
  }

  // Bake the retail splat blend (docs/map-format.md §4.1) into one 256x256
  // canvas: layer 0 opaque base, each further layer mixed in by its
  // grayscale splat. Diffuse tiling: one repeat per 128*UScale L2 units —
  // at tile fraction f the quad coord is f*255 (vGridUv), the diffuse uv is
  // vGridUv*(1/UScale) mod 1, the splat uv is vGridUv/256 (terrain.js).
  async _bakeSplatTexture(layers) {
    const SIZE = 1024;   // 32 L2 units/px — the 256px bake read as flat blur
    const splatLayers = layers.map((l, i) => ({ l, i })).filter((e, k) => k > 0 && e.l.splat);
    const [diffuseImgs, splatImgs] = await Promise.all([
      Promise.all(layers.map(l =>
        this._loadImage(l.diffuse).catch(() => NeighborTile._solidImage(140, 130, 110)))),
      Promise.all(splatLayers.map(e =>
        this._loadImage(e.l.splat).catch(() => NeighborTile._solidImage(0, 0, 0)))),
    ]);
    // decode everything to pixel arrays once (splat: R channel; diffuse: RGB)
    const read = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, d: ctx.getImageData(0, 0, img.width, img.height).data };
    };
    const diffs = diffuseImgs.map(read);
    const splats = splatImgs.map(read);
    const uscales = layers.map(l => 1 / (l.uscale ?? 1));
    const vscales = layers.map(l => 1 / (l.vscale ?? 1));
    const splatIdx = layers.map((l, i) => splatLayers.findIndex(e => e.i === i));

    const out = document.createElement('canvas');
    out.width = out.height = SIZE;
    const octx = out.getContext('2d');
    const img = octx.createImageData(SIZE, SIZE);
    const px = img.data;
    for (let y = 0; y < SIZE; y++) {
      const fy = y / (SIZE - 1);          // 0 = tile min-Y edge (splat row 0)
      const qy = fy * 255;
      for (let x = 0; x < SIZE; x++) {
        const fx = x / (SIZE - 1);
        const qx = fx * 255;
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < layers.length; k++) {
          // splat weight: layer 0 is the opaque base (a = 1); further
          // layers read their splat at (qx, qy)/256
          let a = 1;
          if (k > 0) {
            const si = splatIdx[k];
            if (si < 0) continue;
            const s = splats[si];
            const sx = Math.min(s.w - 1, Math.floor(qx / 256 * s.w));
            const sy = Math.min(s.h - 1, Math.floor(qy / 256 * s.h));
            a = s.d[(sy * s.w + sx) * 4] / 255;
            if (a === 0) continue;
          }
          const d = diffs[k];
          const du = (qx * uscales[k]) % 1, dv = (qy * vscales[k]) % 1;
          const dx = Math.min(d.w - 1, Math.floor(du * d.w));
          const dy = Math.min(d.h - 1, Math.floor(dv * d.h));
          const o = (dy * d.w + dx) * 4;
          r = r * (1 - a) + d.d[o] * a;
          g = g * (1 - a) + d.d[o + 1] * a;
          b = b * (1 - a) + d.d[o + 2] * a;
        }
        const o = (y * SIZE + x) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(out);
    tex.flipY = false;               // canvas row 0 = tile min-Y edge
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`neighbor texture failed: ${file}`));
      img.src = this.baseUrl + file;
    });
  }

  // 1x1 solid-color stand-in for a layer texture that failed to load
  static _solidImage(r, g, b) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 1, 1);
    return canvas;
  }

  _loadTexture(file) {
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(this.baseUrl + file, (tex) => {
        tex.flipY = false;   // row 0 = tile min-Y edge (splat convention)
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        resolve(tex);
      }, undefined, () => resolve(null));
    });
  }

  // Decimated heightfield over the FULL tile extent [0, TILE_L2] (the last
  // column duplicates the heightmap's edge sample — the 256x128 grid only
  // reaches 32640, and stretching to the far edge is what closes the crack
  // between tiles). Vertices are built in absolute three.js world coords
  // from the tile's own origin, so no transform is needed.
  _buildGeometry() {
    const def = this.def;
    const src = def.gridSize || 256;
    const spacing = def.spacing || 128;
    const heightScale = def.heightScale ?? 0.296875;
    const origin = def.origin || [0, 0, 0];
    const n = MESH_RES;
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const v = new THREE.Vector3();
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const i = gy * n + gx;
        // world offset covers [0, TILE_L2]; height sample clamps to the
        // heightmap's last real sample (255)
        const fx = gx / (n - 1), fy = gy / (n - 1);
        const sx = Math.min(src - 1, fx * src);
        const sy = Math.min(src - 1, fy * src);
        const h = this._sample(src, sx, sy);
        l2ToThree(origin[0] + fx * TILE_L2, origin[1] + fy * TILE_L2,
                  origin[2] + (h - 32768) * heightScale, v);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        uv[i * 2] = fx; uv[i * 2 + 1] = fy;
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let gy = 0; gy < n - 1; gy++) {
      for (let gx = 0; gx < n - 1; gx++) {
        const a = gy * n + gx, b = a + 1, c = a + n, d = c + 1;
        // same winding as terrain.js (three z = -l2y flips handedness)
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }

  // bilinear sample of the source heightmap at fractional (fx, fy)
  _sample(g, fx, fy) {
    const x0 = Math.min(Math.floor(fx), g - 2);
    const y0 = Math.min(Math.floor(fy), g - 2);
    const tx = fx - x0, ty = fy - y0;
    const h = (x, y) => this.heights[y * g + x];
    const top = h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx;
    const bot = h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bot * ty;
  }

  // Lazy geodata: kicked off by preloadNear (boundary approach) or by the
  // first heightAtWorld that lands on this tile. Safe to call repeatedly.
  ensureGeodata() {
    if (!this._geoPromise) {
      this._geoPromise = Geodata.load(this.baseUrl, this.def)
        .then(g => {
          this.geodata = g;
          if (g) this._applyGeodataCorrection();
          return g;
        })
        .catch(() => null);   // heightmap fallback on failure
    }
    return this._geoPromise;
  }

  // Stale-rectangle correction for the neighbor mesh (same algorithm as the
  // center tile — see correctHeightsWithGeodata in terrain.js). Without it
  // the rendered neighbor mesh keeps the raw heightmap while heightAtWorld
  // already answers from geodata, so the walker floats/sinks by up to ~2m
  // in stale zones near a border until the scene switch lands. Runs on the
  // 256x256 SOURCE grid, then re-samples the decimated mesh's Y column in
  // place (the mesh samples this grid — see _buildGeometry), so one source
  // fix covers every mesh vertex.
  _applyGeodataCorrection() {
    const def = this.def;
    const g = def.gridSize || 256;
    const heightScale = def.heightScale ?? 0.296875;
    const origin = def.origin || [0, 0, 0];
    const r = correctHeightsWithGeodata(
      this.heights, g, def.spacing || 128, origin, heightScale, this.geodata);
    this.geoFixedCells = r.fixed;
    if (!this.mesh || r.fixed === 0) return;
    const n = MESH_RES;
    const pos = this.mesh.geometry.attributes.position;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const i = gy * n + gx;
        // same source-grid sampling as _buildGeometry
        const h = this._sample(
          g, Math.min(g - 1, gx / (n - 1) * g), Math.min(g - 1, gy / (n - 1) * g));
        pos.setY(i, (origin[2] + (h - 32768) * heightScale) * L2_TO_M);
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  // three.js Y (meters) at three.js world (x, z) — same contract as
  // Terrain.heightAtWorld's non-interior path: geodata with the walking
  // layer rule when loaded, heightmap bilinear otherwise (and as fallback
  // when geodata has no answer, e.g. before the lazy load lands).
  heightAtWorld(x, z, currentZ = null) {
    if (this.geodata) {
      const h = this.geodata.heightAt(
        x / L2_TO_M, -z / L2_TO_M,
        currentZ == null ? null : currentZ / L2_TO_M,
        currentZ == null ? null : MAX_STEP_UP_L2);
      if (h != null) return h * L2_TO_M;
    }
    const def = this.def;
    const g = def.gridSize || 256;
    const spacing = def.spacing || 128;
    const heightScale = def.heightScale ?? 0.296875;
    const origin = def.origin || [0, 0, 0];
    const fx = Math.min(Math.max((x / L2_TO_M - origin[0]) / spacing, 0), g - 1.001);
    const fy = Math.min(Math.max((-z / L2_TO_M - origin[1]) / spacing, 0), g - 1.001);
    const v = this._sample(g, fx, fy);
    return (origin[2] + (v - 32768) * heightScale) * L2_TO_M;
  }

  // Stitch this neighbor's edge that abuts the CENTER tile to the center's
  // own (geodata-corrected) edge heights. The neighbor mesh is decimated,
  // so without this the two meshes part company along steep relief and a
  // see-through crack shows at the border. dx/dy is this tile's offset from
  // the center; only cardinal neighbors share an edge with it.
  stitchTo(centerTerrain, dx, dy) {
    if (Math.abs(dx) + Math.abs(dy) !== 1 || !this.mesh) return;
    const g = centerTerrain.gridSize;
    const n = Math.round(Math.sqrt(this.mesh.geometry.attributes.position.count));
    // bilinear sample along the center tile's shared edge (256 heights)
    const edge = (s) => {
      const x0 = Math.min(Math.floor(s), g - 2);
      const t = s - x0;
      let h0, h1;
      if (dx === 1) { h0 = centerTerrain.heights[x0 * g + (g - 1)]; h1 = centerTerrain.heights[(x0 + 1) * g + (g - 1)]; }
      else if (dx === -1) { h0 = centerTerrain.heights[x0 * g]; h1 = centerTerrain.heights[(x0 + 1) * g]; }
      else if (dy === 1) { h0 = centerTerrain.heights[(g - 1) * g + x0]; h1 = centerTerrain.heights[(g - 1) * g + x0 + 1]; }
      else { h0 = centerTerrain.heights[x0]; h1 = centerTerrain.heights[x0 + 1]; }
      return h0 * (1 - t) + h1 * t;
    };
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      const h = edge(i / (n - 1) * (g - 1));
      const y = (centerTerrain.origin[2] + (h - 32768) * centerTerrain.heightScale) * L2_TO_M;
      let vi;
      if (dx === 1) vi = i * n;                 // my west column
      else if (dx === -1) vi = i * n + (n - 1); // my east column
      else if (dy === 1) vi = i;                // my near row
      else vi = (n - 1) * n + i;                // my far row
      pos.setY(vi, y);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  // same disposal rule as Terrain.dispose(): free geometry, materials and
  // every texture they reference (switching neighborhoods must not leak)
  dispose() {
    const seenTex = new Set();
    const killTex = (t) => {
      if (t && t.isTexture && !seenTex.has(t)) { seenTex.add(t); t.dispose(); }
    };
    const seenMat = new Set();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (seenMat.has(m)) continue;
        seenMat.add(m);
        for (const k of Object.keys(m)) killTex(m[k]);
        for (const t of m.userData?.textures || []) killTex(t);
        m.dispose();
      }
    });
  }
}

export class NeighborTiles {
  constructor(scene, availableScenes) {
    this.scene = scene;
    this.available = new Set(availableScenes);
    this.tiles = new Map();     // tile name -> NeighborTile (loaded or loading)
    this.center = null;
    this._gen = 0;              // stale-load guard across rapid re-centers
  }

  static names(center) {
    const [tx, ty] = center.split('_').map(Number);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) out.push(`${tx + dx}_${ty + dy}`);
      }
    }
    return out;
  }

  // Rebuild the 3x3 window around `center` (null clears it). Loads run in
  // parallel; dropped tiles are disposed. centerTerrain (the full-quality
  // Terrain) is used to stitch shared edges closed.
  async setCenter(center, centerTerrain = null) {
    const gen = ++this._gen;
    this.center = center;
    const want = center && !Number.isNaN(Number(center.split('_')[0]))
      ? new Set(NeighborTiles.names(center).filter(n => this.available.has(n)))
      : new Set();
    for (const [name, entry] of [...this.tiles]) {
      if (!want.has(name)) {
        this.tiles.delete(name);
        this.scene.remove(entry.group);
        entry.dispose();
      }
    }
    await Promise.all([...want].map(async (name) => {
      if (this.tiles.has(name)) return;
      const entry = new NeighborTile(name, `/scenes/${encodeURIComponent(name)}/`);
      this.tiles.set(name, entry);   // reserve before awaiting (dedupe)
      try {
        await entry.load();
      } catch (e) {
        console.warn(`neighbor ${name}: load failed (${e.message})`);
        this.tiles.delete(name);
        return;
      }
      // a newer setCenter may have dropped us while loading
      if (gen === this._gen && this.tiles.get(name) === entry) {
        entry.group.traverse(o => { o.renderOrder = -1; });  // below the center tile
        this.scene.add(entry.group);
      } else {
        entry.dispose();
      }
    }));
    // close the center<->neighbor seams with the center's own edge heights
    if (centerTerrain && centerTerrain.heights) {
      const [cx, cy] = (center || '0_0').split('_').map(Number);
      for (const [name, entry] of this.tiles) {
        const [tx, ty] = name.split('_').map(Number);
        entry.stitchTo(centerTerrain, tx - cx, ty - cy);
      }
    }
  }

  // The neighbor entry covering three.js world (x, z), or null when the
  // point is on the center tile / off the map / the entry isn't ready.
  entryAt(x, z) {
    const name = `${20 + Math.floor(x / L2_TO_M / TILE_L2)}_`
      + `${18 + Math.floor(-z / L2_TO_M / TILE_L2)}`;
    if (name === this.center) return null;
    const e = this.tiles.get(name);
    return e && e.mesh ? e : null;
  }

  // Start the lazy geodata load for every neighbor whose tile (expanded by
  // marginL2) contains the three.js world point (x, z).
  preloadNear(x, z, marginL2 = 6000) {
    const lx = x / L2_TO_M, ly = -z / L2_TO_M;
    for (const entry of this.tiles.values()) {
      if (!entry.def || entry._geoPromise) continue;
      const [ox, oy] = entry.def.origin;
      if (lx >= ox - marginL2 && lx <= ox + TILE_L2 + marginL2
          && ly >= oy - marginL2 && ly <= oy + TILE_L2 + marginL2) {
        entry.ensureGeodata();
      }
    }
  }

  // Terrain meshes for the click-to-move raycast (click across the border).
  meshes() {
    const out = [];
    for (const e of this.tiles.values()) if (e.mesh) out.push(e.mesh);
    return out;
  }

  async disposeAll() { return this.setCenter(null); }
}
