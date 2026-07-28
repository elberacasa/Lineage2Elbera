// Terrain: loads a scene package (scene.json + heightmap.u16 + layer
// textures) and builds the walkable mesh.
//
// Frozen scene.json contract:
//   {"tile","origin":[x0,y0,z0],"gridSize":256,"spacing":128,
//    "heightScale":0.296875,"heightmap":"heightmap.u16",
//    "heights":"heightmap.png",
//    "layers":[{"name","diffuse","splat"}],
//    "water":null,
//    "props":[{"mesh","gltf":"props/<name>.gltf"|null,
//              "position":[x,y,z],"rotation":[p,y,r],"scale":[x,y,z]}]}
//
// heightmap.u16: gridSize*gridSize Uint16 little-endian, row-major
// (gx fastest). World position of sample (gx,gy) in L2 space:
//   origin + [gx*spacing, gy*spacing, (h - 32768)*heightScale]
// (the -32768 bias is the validated G16 encoding, docs/map-format.md §6;
// without it real-tile props land ~8600 units below the surface)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L2_TO_M, l2ToThree } from './coords.js';
import { Geodata } from './geodata.js';

const UE_ROT_TO_RAD = (Math.PI * 2) / 65536;
const PROP_CLUSTER_SIZE = 48;  // meters, instanced-prop cluster grid cell

export class Terrain {
  constructor(sceneDef, baseUrl) {
    this.def = sceneDef;
    this.baseUrl = baseUrl; // e.g. /scenes/20_18/
    this.gridSize = sceneDef.gridSize || 256;
    this.spacing = sceneDef.spacing || 128;
    this.heightScale = sceneDef.heightScale ?? 0.296875;
    this.origin = sceneDef.origin || [0, 0, 0];
    this.heights = null;    // Uint16Array gridSize*gridSize
    this.mesh = null;
    this.group = new THREE.Group();
    this.props = [];
    // dungeon-interior mode (M5): scene.json "interior": true is the
    // contract; the fallback detects props sitting below the terrain plane
    this.interior = false;
    this.floorY = 0;        // three.js Y of the dungeon floor when interior
    this.geodata = null;    // blockstream-v1 heights when the tile ships them
  }

  // fallback interior detection: tiles whose props are (almost) all below
  // the terrain surface are dungeon interiors (19_16, 21_25, ...). The
  // walkable floor and spawn come from the densest prop cluster: spawn =
  // densest 20 m bin center, floor = bin median z (floor-slab level).
  _detectInterior() {
    const props = (this.def.props || []).filter(p => p.gltf && p.position);
    if (props.length < 20) return false;
    let minH = Infinity;
    for (let i = 0; i < this.heights.length; i++) minH = Math.min(minH, this.heights[i]);
    const terrainMinZ = this.origin[2] + (minH - 32768) * this.heightScale;
    const zs = props.map(p => p.position[2]).sort((a, b) => a - b);
    if (zs[Math.floor(zs.length * 0.06)] >= terrainMinZ - 500) return false;

    // spawn = local prop-density peak (the built-up room, not the void
    // between dungeon modules); floor = that prop's z — the walk level
    // right at the spawn point
    let peak = null, peakN = -1;
    for (const p of props) {
      const [x, y] = p.position;
      let n = 0;
      for (const q of props) {
        if (Math.abs(q.position[0] - x) < 1500 && Math.abs(q.position[1] - y) < 1500) n++;
      }
      if (n > peakN) { peakN = n; peak = p; }
    }
    this.spawnL2 = [peak.position[0], peak.position[1]];
    this.floorY = peak.position[2] * L2_TO_M;
    return true;
  }

  async load() {
    const res = await fetch(this.baseUrl + this.def.heightmap);
    if (!res.ok) throw new Error(`heightmap fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const n = this.gridSize * this.gridSize;
    const view = new DataView(buf);
    this.heights = new Uint16Array(n);
    for (let i = 0; i < n; i++) this.heights[i] = view.getUint16(i * 2, true);

    if (this.def.interior === true) {
      this.interior = true;
      this._detectInterior() || (() => {
        const zs = (this.def.props || []).filter(p => p.gltf && p.position)
          .map(p => p.position[2]).sort((a, b) => a - b);
        this.floorY = (zs.length ? zs[Math.floor(zs.length * 0.06)] : this.origin[2]) * L2_TO_M;
      })();
    } else {
      this.interior = this._detectInterior();
    }

    if (!this.interior) await this._buildMesh();   // interiors: no terrain plane
    this.geodata = await Geodata.load(this.baseUrl, this.def)
      .catch(() => null);                    // heightmap fallback on failure
    await this._loadProps();
  }

  // -- grid -> world helpers ----------------------------------------------

  // three.js world position (meters) of grid sample (gx, gy)
  vertexPos(gx, gy, out = new THREE.Vector3()) {
    const h = this.heights[gy * this.gridSize + gx];
    return l2ToThree(
      this.origin[0] + gx * this.spacing,
      this.origin[1] + gy * this.spacing,
      this.origin[2] + (h - 32768) * this.heightScale,
      out,
    );
  }

  // bilinear height (three.js Y, meters) at three.js world (x, z);
  // interior tiles have no heightfield — everything walks on the
  // estimated dungeon floor.
  // currentZ (three.js Y, meters) selects the NEAREST geodata layer —
  // the multi-layer query rule (a z-less lookup picks the wrong floor in
  // every bridge/two-floor structure, tools/world/README.md).
  heightAtWorld(x, z, currentZ = null) {
    if (this.interior) {
      // Dungeons: the prop-derived floorY is the walk level (see terrain
      // interior notes). Geodata carries BOTH the dummy plane AND the real
      // structure layers (measured: 19_16 [-4672, -10904], 21_25 [-4672,
      // -6656]) — use the geodata layer only when it agrees with floorY;
      // the dummy plane must never override the prop floor. currentZ (or
      // floorY) selects the layer per the multi-layer query rule.
      const hint = currentZ ?? this.floorY;
      if (this.geodata) {
        const h = this.geodata.heightAt(
          x / L2_TO_M, -z / L2_TO_M, hint / L2_TO_M);
        if (h != null && Math.abs(h * L2_TO_M - this.floorY) < 2.5) {
          return h * L2_TO_M;
        }
      }
      return this.floorY;
    }
    if (this.geodata) {
      const h = this.geodata.heightAt(
        x / L2_TO_M, -z / L2_TO_M,
        currentZ == null ? null : currentZ / L2_TO_M);
      if (h != null) return h * L2_TO_M;
    }
    const s = L2_TO_M;
    const fx = (x / s - this.origin[0]) / this.spacing;
    const fy = (-z / s - this.origin[1]) / this.spacing;
    return this._sampleBilinear(fx, fy);
  }

  _sampleBilinear(fx, fy) {
    const g = this.gridSize;
    const cx = Math.min(Math.max(fx, 0), g - 1.001);
    const cy = Math.min(Math.max(fy, 0), g - 1.001);
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    const tx = cx - x0, ty = cy - y0;
    const h = (x, y) => this.heights[Math.min(y, g - 1) * g + Math.min(x, g - 1)];
    const top = h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx;
    const bot = h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx;
    const v = top * (1 - ty) + bot * ty;
    return (this.origin[2] + (v - 32768) * this.heightScale) * L2_TO_M;
  }

  center() {
    const mid = (this.gridSize - 1) / 2;
    return this.vertexPos(Math.round(mid), Math.round(mid));
  }

  // -- mesh ----------------------------------------------------------------

  async _buildMesh() {
    const g = this.gridSize;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(g * g * 3);
    const uv = new Float32Array(g * g * 2);
    const v = new THREE.Vector3();
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++) {
        const i = gy * g + gx;
        this.vertexPos(gx, gy, v);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        uv[i * 2] = gx / (g - 1); uv[i * 2 + 1] = gy / (g - 1);
      }
    }
    // winding: three.js z = -l2y flips handedness, so (A,B,C)/(B,D,C)
    // gives upward-facing triangles (verified: cross product +Y).
    const idx = new Uint32Array((g - 1) * (g - 1) * 6);
    let k = 0;
    for (let gy = 0; gy < g - 1; gy++) {
      for (let gx = 0; gx < g - 1; gx++) {
        const a = gy * g + gx, b = a + 1, c = a + g, d = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const material = await this._buildMaterial();
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.group.add(this.mesh);
  }

  // Terrain texturing — retail UE2 rule (ground truth: docs/map-format.md
  // §4.1 TerrainLayer.TerrainMatrix, cross-validated against the UE2 engine
  // port in realratchet/Lineage2JS — which cites the UE2 source — and the
  // serialized layer matrices in shnok/l2-unity's map metadata):
  //
  //   * layer 0 is the opaque base; each further layer i alpha-blends over
  //     it weighted by its grayscale splat map (white = full weight), the
  //     engine's multi-pass addLayer: fg*a + bg*(1-a), applied in layer order
  //   * splat (alphamap) UV = (gx, gy) / 256 — gx/gy are quad coords
  //     (0..255, row 0 of the splat PNG is the tile's min-Y edge)
  //   * diffuse UV per layer = (gx / UScale, gy / VScale) (mod 1): one
  //     texture repeat spans 128*UScale L2 units (1.28 m at UScale = 1).
  //     TextureMapAxis is XY and pan/rotation are zero for ~96% of the 971
  //     layers in the 100 converted tiles; UScale/VScale live in the .unr
  //     but are deliberately absent from the frozen scene.json contract, so
  //     the shader reads layers[i].uscale/vscale when present and defaults
  //     to 1 otherwise. The serialized TerrainMatrix also carries a per-tile
  //     phase of <= 12 L2 units (< 10% of a repeat); ignored as invisible.
  //   * every terrain texture uses flipY = false so texture V = 0 is the
  //     PNG's first row, matching UE2/D3D addressing (three.js flips by
  //     default — with the default the splats sampled V-mirrored)
  //
  // Diffuses and splats are repacked at load into two texture arrays
  // (sampler2DArray): the largest tiles have 15 layers, which overflows the
  // 16-unit fragment-texture limit with one sampler per map.
  async _buildMaterial() {
    const layers = (this.def.layers || []).filter(l => l && l.diffuse);
    if (layers.length === 0) {
      return new THREE.MeshLambertMaterial({ color: 0x4a6b3a });
    }

    const splatLayers = layers.map((l, i) => ({ l, i }))
      .filter((e, k) => k > 0 && e.l.splat);

    if (splatLayers.length === 0) {
      // graceful path: dominant (first) layer tiled at the retail density
      const tex = new THREE.TextureLoader().load(this.baseUrl + layers[0].diffuse);
      tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const quads = this.gridSize - 1;
      tex.repeat.set(quads / (layers[0].uscale ?? 1), quads / (layers[0].vscale ?? 1));
      return new THREE.MeshLambertMaterial({ map: tex });
    }

    // a texture that fails to load must not kill the whole tile: neutral
    // gray diffuse, zero-weight splat (layer invisible) — same spirit as
    // the old TextureLoader path, which rendered on without it
    const [diffuseImgs, splatImgs] = await Promise.all([
      Promise.all(layers.map(l =>
        this._loadImage(l.diffuse).catch(() => Terrain._solidImage(140, 130, 110)))),
      Promise.all(splatLayers.map(e =>
        this._loadImage(e.l.splat).catch(() => Terrain._solidImage(0, 0, 0)))),
    ]);

    const diffuseSize = Math.max(256, ...diffuseImgs.map(i => i.width));
    const splatSize = Math.max(256, ...splatImgs.map(i => i.width));
    const diffuseTex = new THREE.DataArrayTexture(
      Terrain._packImages(diffuseImgs, diffuseSize, 4),
      diffuseSize, diffuseSize, layers.length);
    diffuseTex.colorSpace = THREE.SRGBColorSpace;
    const splatTex = new THREE.DataArrayTexture(
      Terrain._packImages(splatImgs, splatSize, 1),
      splatSize, splatSize, splatLayers.length);
    splatTex.format = THREE.RedFormat;
    for (const t of [diffuseTex, splatTex]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 4;
      t.needsUpdate = true;
    }

    // per-layer diffuse tiling 1/UScale, 1/VScale, baked into the shader
    const uvOf = (l) => `vec2(${(1 / (l.uscale ?? 1)).toFixed(6)}, ${(1 / (l.vscale ?? 1)).toFixed(6)})`;
    const quads = (this.gridSize - 1).toFixed(1);
    const grid = this.gridSize.toFixed(1);

    const mat = new THREE.MeshLambertMaterial();
    // tracked for dispose(): these arrays live only inside the compiled
    // shader's uniforms, nothing else references them
    mat.userData.textures = [diffuseTex, splatTex];
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDiffuse = { value: diffuseTex };
      shader.uniforms.uSplats = { value: splatTex };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying vec2 vGridUv;')
        .replace('#include <uv_vertex>',
          `#include <uv_vertex>\nvGridUv = uv * ${quads};`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `
          varying vec2 vGridUv;
          uniform sampler2DArray uDiffuse;
          uniform sampler2DArray uSplats;
        `)
        .replace('#include <map_fragment>', `
          // vGridUv = quad coords (0..255): engine's (hmx, hmy)
          vec2 splatUv = vGridUv / ${grid};   // engine: hmx / heightmapX
          vec4 blended = texture(uDiffuse, vec3(vGridUv * ${uvOf(layers[0])}, 0.0));
          ${splatLayers.map((e, k) => `
          blended = mix(blended,
            texture(uDiffuse, vec3(vGridUv * ${uvOf(e.l)}, ${e.i.toFixed(1)})),
            texture(uSplats, vec3(splatUv, ${k.toFixed(1)})).r);`).join('')}
          diffuseColor *= blended;
        `);
    };
    // the generated shader is per-tile (layer count + baked uv constants)
    mat.customProgramCacheKey =
      () => `terrain-splat-${this.def.tile}-${layers.length}-${splatLayers.length}`;
    return mat;
  }

  _loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`terrain texture failed: ${file}`));
      img.src = this.baseUrl + file;
    });
  }

  // free GPU/CPU texture + geometry resources when the tile is unloaded.
  // Without this, switching scenes keeps every tile's textures resident —
  // survivable with LQ sets, fatal with the HD set (a 4x tile decodes to
  // ~2 GB; two HD tiles + a reload stall a 16 GB machine for good).
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
        for (const k of Object.keys(m)) killTex(m[k]);       // map etc.
        for (const t of m.userData?.textures || []) killTex(t); // shader-only arrays
        m.dispose();
      }
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

  // draw every image at `size` x `size` and concatenate the pixels into one
  // buffer (canvas row 0 = PNG row 0, so array slices keep file order).
  // channels 4 = RGBA copy, 1 = R channel only (grayscale splats)
  static _packImages(images, size, channels) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sliceLen = size * size * channels;
    const out = new Uint8Array(sliceLen * images.length);
    images.forEach((img, k) => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size).data;
      const slice = out.subarray(k * sliceLen, (k + 1) * sliceLen);
      if (channels === 4) {
        slice.set(d);
      } else {
        for (let i = 0, j = 0; j < sliceLen; i += 4, j++) slice[j] = d[i];
      }
    });
    return out;
  }

  // -- props ------------------------------------------------------------------

  // UE rotator (1/65536 rev per unit, L2 axes) -> three.js quaternion.
  // Basis map M: (x,y,z)_L2 -> (x,z,-y)_three is a reflection, so under
  // conjugation each rotation flips sign about the mapped axis:
  //   yaw   (about Z_L2) -> about (0,1,0) by -yaw
  //   pitch (about Y_L2) -> about (0,0,1) by +pitch
  //   roll  (about X_L2) -> about (1,0,0) by -roll
  // UE applies R = Yaw * Pitch * Roll.
  static ueQuaternion(pitch, yaw, roll) {
    const qYaw = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw * UE_ROT_TO_RAD);
    const qPitch = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch * UE_ROT_TO_RAD);
    const qRoll = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -roll * UE_ROT_TO_RAD);
    return qYaw.multiply(qPitch).multiply(qRoll);
  }

  // M3 perf: repeated prop glTFs render as InstancedMesh, grouped into
  // spatial clusters (per-cluster bounding sphere => frustum culling per
  // cluster, plus a draw-distance toggle from the main loop).
  // '?props=raw' in the URL forces the legacy one-clone-per-prop path
  // (kept for before/after perf measurement).
  async _loadProps() {
    const placements = (this.def.props || []).filter(p => p.gltf);
    if (!placements.length) return;
    const raw = new URLSearchParams(location.search).get('props') === 'raw';
    if (raw) return this._loadPropsRaw(placements);
    return this._loadPropsInstanced(placements);
  }

  static _prepMaterials(material) {
    const mats = Array.isArray(material) ? material : [material];
    for (const m of mats) {
      // L2 foliage etc. use alpha-cutout cards: honor the alpha channel
      // (no-op for fully opaque textures) and light both sides
      if (m.map) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
    }
    return material;
  }

  static _propMatrix(p, out = new THREE.Matrix4()) {
    const [px, py, pz] = p.position || [0, 0, 0];
    const pos = l2ToThree(px, py, pz);
    const [pitch, yaw, roll] = p.rotation || [0, 0, 0];
    const quat = Terrain.ueQuaternion(pitch, yaw, roll);
    const [sx, sy, sz] = p.scale || [1, 1, 1];
    return out.compose(pos, quat, new THREE.Vector3(sx, sy, sz));
  }

  async _loadPropsInstanced(placements) {
    const loader = new GLTFLoader();
    const byPath = new Map();
    for (const p of placements) {
      if (!byPath.has(p.gltf)) byPath.set(p.gltf, []);
      byPath.get(p.gltf).push(p);
    }

    const loadTemplate = (path) => loader.loadAsync(this.baseUrl + path)
      .then(g => {
        g.scene.updateMatrixWorld(true);
        const meshes = [];
        g.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
        return meshes.map(o => ({
          geometry: o.geometry,
          material: Terrain._prepMaterials(o.material),
          matrix: o.matrixWorld.clone(),
        }));
      });

    this.propClusters = [];
    const propM = new THREE.Matrix4();
    const instM = new THREE.Matrix4();
    const center = new THREE.Vector3();

    for (const [path, list] of byPath) {
      let meshes;
      try {
        meshes = await loadTemplate(path);
      } catch {
        console.warn(`props: template ${path} failed (${list.length} placements)`);
        continue;
      }
      // group placements of this gltf into spatial clusters
      const cells = new Map();
      for (const p of list) {
        const [px, py] = p.position || [0, 0];
        const key = `${Math.floor(px * L2_TO_M / PROP_CLUSTER_SIZE)},`
          + `${Math.floor(-py * L2_TO_M / PROP_CLUSTER_SIZE)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(p);
      }
      for (const cellProps of cells.values()) {
        const matrices = cellProps.map(p => Terrain._propMatrix(p, new THREE.Matrix4()));
        center.set(0, 0, 0);
        for (const m of matrices) center.add(new THREE.Vector3().setFromMatrixPosition(m));
        center.divideScalar(matrices.length);
        const cluster = { center: center.clone(), meshes: [], visible: true };
        for (const mesh of meshes) {
          const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
          for (let i = 0; i < matrices.length; i++) {
            im.setMatrixAt(i, instM.copy(matrices[i]).multiply(mesh.matrix));
          }
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = true;
          im.receiveShadow = true;
          im.computeBoundingSphere();   // per-cluster frustum culling
          this.group.add(im);
          this.props.push(im);
          cluster.meshes.push(im);
        }
        this.propClusters.push(cluster);
      }
    }
  }

  // draw-distance: toggle cluster visibility by distance to a world point
  setPropDrawDistance(dist, from) {
    for (const c of this.propClusters || []) {
      const v = !dist || c.center.distanceTo(from) < dist;
      if (v !== c.visible) {
        c.visible = v;
        for (const m of c.meshes) m.visible = v;
      }
    }
  }

  // legacy path: one clone per placement (best-effort; contract allows gltf:null)
  async _loadPropsRaw(placements) {
    const loader = new GLTFLoader();
    const cache = new Map();   // gltf path -> Promise<THREE.Group template>
    const loadTemplate = (url) => {
      if (!cache.has(url)) {
        cache.set(url, loader.loadAsync(url).then(g => g.scene));
      }
      return cache.get(url);
    };

    const results = await Promise.allSettled(placements.map(async (p) => {
      const template = await loadTemplate(this.baseUrl + p.gltf);
      const obj = template.clone(true);
      const [px, py, pz] = p.position || [0, 0, 0];
      l2ToThree(px, py, pz, obj.position);
      const [pitch, yaw, roll] = p.rotation || [0, 0, 0];
      obj.quaternion.copy(Terrain.ueQuaternion(pitch, yaw, roll));
      const [sx, sy, sz] = p.scale || [1, 1, 1];
      obj.scale.set(sx, sy, sz);
      obj.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          Terrain._prepMaterials(o.material);
        }
      });
      return obj;
    }));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        this.group.add(r.value);
        this.props.push(r.value);
      }
    }
    const failed = results.length - this.props.length;
    if (failed) console.warn(`props: ${failed}/${results.length} failed to load`);
  }
}
