// Terrain: loads a scene package (scene.json + heightmap.u16 + layer
// textures) and builds the walkable mesh.
//
// Frozen scene.json contract:
//   {"tile","origin":[x0,y0,z0],"gridSize":256,"spacing":128,
//    "heightScale":0.296875,"heightmap":"heightmap.u16",
//    "heights":"heightmap.png",
//    "layers":[{"name","diffuse","splat"}],
//    "water":[{"height","rect":[x0,y0,x1,y1],"texture"}]|null,
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
import { Geodata, GEO_ANCHOR_MAX } from './geodata.js';
import { Bsp } from './bsp.js';

const UE_ROT_TO_RAD = (Math.PI * 2) / 65536;
const PROP_CLUSTER_SIZE = 48;  // meters, instanced-prop cluster grid cell
// walking rule for the geodata layer pick: a walker gains at most this much
// height in one step — taller layers are walls, not floors (L2 units). 48 =
// aCis's per-cell climb limit (GeoStructure.CELL_IGNORE_HEIGHT =
// CELL_HEIGHT*6, consumed by GeoEngine's move validation).
const MAX_STEP_UP_L2 = 48;
// mesh correction: max allowed heightmap-vs-geodata deviation before the
// geodata layer replaces the (stale) heightmap value (L2 units; 1m)
const MESH_GEO_MAX_DEV = 100;
// mesh correction: max deviation the correction may APPLY (L2 units; 2m).
// Geodata covers walkable surfaces only — under a building there is NO
// ground layer, so the layer-nearest-heightmap pick lands on a floor or the
// roof. Verified on 22_22: every >100 deviation cell lacks a near layer;
// the legit stale-rectangle repairs are ~1-2m, the rest are roofs/spires
// (up to +22m — the giant "cone" walls over towns). Bigger deviations are
// filled from trustworthy neighbors instead.
const MESH_GEO_MAX_FIX = 200;
// mesh correction: an accepted pick must belong to a 4-connected cluster of
// at least this many grid cells. Geodata covers WALKABLE surfaces, so the
// walkable TOPS of small structures (market stalls, carts, fences — 1-2m
// above ground with no ground layer beneath them) also parse as accepted
// picks and render as grass pyramids rising through the prop. Measured
// across all 100 tiles: every verified legit stale-rectangle repair is a
// broad zone >= 200 cells (22_22's Giran square = one 1196-cell cluster),
// the structure tops cluster at <= 25 cells (90%+ sit on a placed prop).
// Small clusters are demoted to the neighbor-median fill (state 2).
const MESH_GEO_MIN_CLUSTER = 50;
// ring radius (grid cells) for the neighbor-median ground fill above
const MESH_GEO_FILL_R = 4;

// Stale-rectangle heightmap correction, shared by the center tile (Terrain)
// and the decimated neighbor meshes (neighbors.js). Some tiles carry STALE
// heightmap rectangles: sharp axis-aligned zones (village squares) where the
// .unr heightmap disagrees with geodata by meters, while server z, retail
// spawn z and building props all agree with geodata (delta map: near-r=1
// globally, rectangular defect zones). Retail ground truth there is geodata;
// everywhere else the smooth heightmap wins. Rule: per grid point, when
// |heightmap - geodata layer NEAREST the heightmap| exceeds MESH_GEO_MAX_DEV,
// take that geodata layer (nearest picks the ground, never a roof layer).
//
// The roof hazard (verified on 22_22): geodata covers WALKABLE surfaces
// only, so cells under a building have no ground layer at all — the nearest
// pick lands on an interior floor or the roof (up to +22m, rendering as
// giant terrain walls swallowing the town). So the pick is accepted only
// within MESH_GEO_MAX_FIX (the documented defect size); beyond it the ground
// comes from the median of trustworthy neighbors (uncorrected cells +
// accepted picks) in a MESH_GEO_FILL_R ring.
//
// Mutates `heights` (Uint16Array gridSize*gridSize, G16 encoding) in place.
// `geodata` must be a loaded Geodata (caller skips when null). Returns
// { fixed, deferred, deferredCells }: fixed = cells rewritten (accepted
// picks + ring fills), deferred = per-cell state array (2 = ring-filled
// roof-hazard override), deferredCells = count of state-2 cells.
export function correctHeightsWithGeodata(heights, gridSize, spacing, origin, heightScale, geodata) {
  const g = gridSize;
  const picks = new Float32Array(g * g);  // geodata candidate z per cell
  const state = new Uint8Array(g * g);    // 0 keep-hm, 1 take-geo, 2 defer
  const hmAt = (i) => origin[2] + (heights[i] - 32768) * heightScale;
  for (let gy = 0; gy < g; gy++) {
    for (let gx = 0; gx < g; gx++) {
      const i = gy * g + gx;
      const hm = hmAt(i);
      const geo = geodata.heightAt(
        origin[0] + gx * spacing,
        origin[1] + gy * spacing, hm);
      if (geo == null) continue;
      const dev = Math.abs(geo - hm);
      if (dev <= MESH_GEO_MAX_DEV) continue;
      picks[i] = geo;
      state[i] = dev <= MESH_GEO_MAX_FIX ? 1 : 2;
    }
  }
  // demote structure-top picks (small 4-connected clusters, see
  // MESH_GEO_MIN_CLUSTER) to the ring fill
  const seen = new Uint8Array(g * g);
  for (let i = 0; i < g * g; i++) {
    if (state[i] !== 1 || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const cluster = [];
    while (stack.length) {
      const c = stack.pop();
      cluster.push(c);
      const cx = c % g, cy = (c / g) | 0;
      if (cx + 1 < g && state[c + 1] === 1 && !seen[c + 1]) {
        seen[c + 1] = 1; stack.push(c + 1);
      }
      if (cx > 0 && state[c - 1] === 1 && !seen[c - 1]) {
        seen[c - 1] = 1; stack.push(c - 1);
      }
      if (cy + 1 < g && state[c + g] === 1 && !seen[c + g]) {
        seen[c + g] = 1; stack.push(c + g);
      }
      if (cy > 0 && state[c - g] === 1 && !seen[c - g]) {
        seen[c - g] = 1; stack.push(c - g);
      }
    }
    if (cluster.length < MESH_GEO_MIN_CLUSTER) {
      for (const c of cluster) state[c] = 2;
    }
  }
  let fixed = 0;
  const R = MESH_GEO_FILL_R;
  for (let gy = 0; gy < g; gy++) {
    for (let gx = 0; gx < g; gx++) {
      const i = gy * g + gx;
      let z = null;
      if (state[i] === 1) {
        z = picks[i];
      } else if (state[i] === 2) {
        const ring = [];
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = gx + dx, ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= g || ny >= g) continue;
            const j = ny * g + nx;
            if (state[j] === 0) ring.push(hmAt(j));
            else if (state[j] === 1) ring.push(picks[j]);
          }
        }
        ring.sort((a, b) => a - b);
        // no trustworthy neighbor at all: keep the heightmap (terrain-like),
        // never the roof pick
        z = ring.length ? ring[ring.length >> 1] : hmAt(i);
      }
      if (z != null) {
        heights[i] = Math.round(32768 + (z - origin[2]) / heightScale);
        fixed++;
      }
    }
  }
  return {
    fixed,
    deferred: state,
    deferredCells: state.reduce((n, s) => n + (s === 2 ? 1 : 0), 0),
  };
}

// water planes (scene.json "water", tools/world/README.md): one repeat per
// 128 L2 units (the terrain diffuse rule), alpha-blended, uv-scrolled by
// main.js the way retail's TexPanner does
const WATER_TILE_L2 = 128;        // L2 units per texture repeat
const WATER_OPACITY = 0.82;
// gentle drift (uv/sec) — AUTHORED visual; retail animates via TexPanner
// (FX_E_T fx_e_waterpan PanRate 0.7); the plane/height/texture are sourced
export const WATER_SCROLL = [0.011, 0.007];

// interior fire props (19_16 Pagan Temple FX_E_S.Default_Flame01 x22,
// 21_25 Elven Ruins Default_Flame01 x82 + deco01.Fire01 x24): flame/brazier
// static meshes that justify a warm point light. Lights are clustered
// (nearby flames share one) and capped — a dungeon tile has 500+ props.
const FIRE_PROP_RE = /(?:^|[._])(?:default_)?flame|(?:^|[._])fire/i;
// flame SPRITE materials (the glow quad itself, not the brazier bowl):
// across all 136 fire-prop gltfs exactly these four match, and their glow
// textures (de_fire_0000, de_fire_glow, sp2f_fire02, fx_e_fire_under02)
// are additive-blend FX art — de_fire_0000/sp2f_fire02/fx_e_fire_under02
// carry UNIFORM alpha, so the generic alphaTest 0.5 cutout below keeps
// the whole quad and the flame renders as a giant black rectangle. They
// render additively instead (retail blends these shader FX; black adds
// nothing). Godard_vertex_F also has uniform alpha but is an opaque
// ground slab — correctly NOT matched.
const FLAME_MAT_RE = /flame|fire_?glow|fire_?shader|fx_e_under/i;
const FIRE_CLUSTER_M = 8;         // flames within this XY/Z bin share a light
const FIRE_LIGHT_MAX = 16;        // hard cap per tile (forward-renderer perf)
const FIRE_LIGHT_LIFT_M = 1.2;    // flame mesh spans 0..1.06 m above origin

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
    this.waterTex = null;   // shared water diffuse (uv-scrolled by main.js)
    this.fireLights = [];   // interior fire-prop point lights
    this.bsp = null;        // decoded level BSP (the buildings), or null
  }

  // fallback interior detection: tiles whose props are (almost) all below
  // the terrain surface are dungeon interiors (19_16, 21_25, ...). The
  // walkable floor and spawn come from the densest prop cluster: spawn =
  // densest 20 m bin center, floor = bin median z (floor-slab level).
  _detectInterior() {
    // Interior tiles are dungeons UNDER a flat dummy plane (19_16, 21_25,
    // 25_21 — the converter flags exactly those, tools/world/convert.py
    // INTERIOR_TILES). Detection must NOT trip on tiles that merely CONTAIN
    // underground content: 24_21 carries the Antharas cave props ~900 L2u
    // below a real mountainous surface and was misclassified, which deleted
    // the terrain mesh ("no floor"). The converter's own evidence rule:
    // flat relief AND >=95% of props >=500u below the plane.
    const props = (this.def.props || []).filter(p => p.gltf && p.position);
    if (props.length < 20) return false;
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < this.heights.length; i++) {
      if (this.heights[i] < minH) minH = this.heights[i];
      if (this.heights[i] > maxH) maxH = this.heights[i];
    }
    const relief = (maxH - minH) * this.heightScale;
    if (relief > 5) return false;                 // real terrain: never interior
    const plane = this.origin[2] + (minH - 32768) * this.heightScale;
    let below = 0;
    for (const p of props) if (p.position[2] < plane - 500) below++;
    if (below / props.length < 0.95) return false;

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

    // geodata BEFORE the mesh: the stale-rectangle correction needs it
    this.geodata = await Geodata.load(this.baseUrl, this.def)
      .catch(() => null);                    // heightmap fallback on failure
    this._correctHeights();

    if (!this.interior) await this._buildMesh();   // interiors: no terrain plane
    await this._buildWater();                      // self-skips interior/null
    // after geodata: fire lights clamp above the local floor
    if (this.interior) this._buildFireLights();
    await this._loadProps();
    await this._loadBsp();
  }

  // BSP buildings (bsp.js). Sibling file to the frozen scene.json, written
  // by tools/world/bsp.py; tiles without one just render as before.
  // Interiors load it too — a dungeon is mostly BSP.
  async _loadBsp() {
    this.bsp = await Bsp.load(this.baseUrl);
    if (this.bsp) this.group.add(this.bsp.group);
  }

  // Stale-rectangle correction: see correctHeightsWithGeodata (module
  // scope, shared with the neighbor tiles in neighbors.js).
  _correctHeights() {
    if (!this.geodata) return;
    const r = correctHeightsWithGeodata(
      this.heights, this.gridSize, this.spacing, this.origin, this.heightScale,
      this.geodata);
    this.geoFixedCells = r.fixed;
    this.geoDeferred = r.deferred;   // 2 = ring-filled (roof-hazard override)
    this.geoDeferredCells = r.deferredCells;
  }

  // -- grid -> world helpers ----------------------------------------------

  // three.js world position (meters) of grid sample (gx, gy)
  vertexPos(gx, gy, out = new THREE.Vector3()) {
    const h = this.heights[gy * this.gridSize + gx];
    // The 256x128 grid only reaches 32640 of the tile's 32768 units; the
    // last row/column is STRETCHED to the far edge so the mesh abuts the
    // neighbor tile's mesh instead of leaving a 128-unit crack of void.
    // Heights are unchanged (the edge sample is simply reused at the edge).
    const g = this.gridSize;
    const lx = gx === g - 1 ? g * this.spacing : gx * this.spacing;
    const ly = gy === g - 1 ? g * this.spacing : gy * this.spacing;
    return l2ToThree(
      this.origin[0] + lx,
      this.origin[1] + ly,
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
        // Gate on the walker's z (hint), not the fixed spawn floorY:
        // multi-level dungeons have real floors >2.5m from floorY
        // (measured: 19_16 hall -112.56 vs -107.0, 21_25 -66.56 vs
        // -62.71) — gating on floorY popped the walker up mid-hall.
        // A garbage hint lands on the dummy plane and falls through.
        if (h != null && Math.abs(h * L2_TO_M - hint) < 2.5) {
          return h * L2_TO_M;
        }
      }
      return this.floorY;
    }
    // The geodata surface stands about +30 L2 units above the terrain the
    // client actually DRAWS — measured at +28.14 median on flat ground, a
    // constant offset, not a slope or scale error (tools/world/verify_terrain_z.py,
    // editor/world/verify_feet.js). Placing feet on raw geodata while drawing
    // the heightmap is what made characters hover 0.6 of their own height.
    //
    // Geodata still chooses the LEVEL — which floor of a building, which side
    // of a bridge — and the heightfield supplies the Z of that level, so the
    // feet touch what is rendered. No constant is subtracted anywhere: the
    // offset comes per-cell from the two surfaces themselves.
    //
    // MAX_STEP_UP: a walker can only gain this much in one cell — layers above
    // that are walls (roofs/decks), not floors. 2m matches the steepest retail
    // stairs without letting a ground walker snap onto rooftops beside tall
    // buildings.
    const s = L2_TO_M;
    const fx = (x / s - this.origin[0]) / this.spacing;
    const fy = (-z / s - this.origin[1]) / this.spacing;
    const terrainY = this._sampleBilinear(fx, fy);
    if (this.geodata) {
      const h = this.geodata.anchoredHeightAt(
        x / s, -z / s,
        currentZ == null ? null : currentZ / s,
        currentZ == null ? null : MAX_STEP_UP_L2,
        terrainY / s, GEO_ANCHOR_MAX);
      if (h != null) return h * s;
    }
    return terrainY;
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

  // -- water ------------------------------------------------------------------
  //
  // scene.json "water": one rect per WaterVolume brush (height = bbox top,
  // sourced; see tools/world/README.md). Renders as a translucent plane at
  // exactly that height — never adjusted, so the shoreline falls out of the
  // terrain crossing the plane (and a volume fully below ground stays
  // invisible). depthWrite off so the beach overdraw blends instead of
  // z-fighting. Interiors skip: their volumes are dummy-plane leftovers
  // (19_16 has one at -3780, far above the dungeon).
  async _buildWater() {
    const water = this.def.water;
    if (this.interior || !water || !water.length) return;
    const tex = await new Promise((resolve) => {
      new THREE.TextureLoader().load(this.baseUrl + water[0].texture,
        resolve, undefined, () => resolve(null));
    });
    if (!tex) return;   // missing texture must not kill the tile
    tex.flipY = false;  // same convention as the terrain textures
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.waterTex = tex;
    for (const w of water) {
      const [x0, y0, x1, y1] = w.rect;
      const wM = (x1 - x0) * L2_TO_M, hM = (y1 - y0) * L2_TO_M;
      const geo = new THREE.PlaneGeometry(wM, hM);
      // bake the tiling into the uvs so every rect shares one texture:
      // one repeat per WATER_TILE_L2 L2 units, the terrain diffuse rule
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * (x1 - x0) / WATER_TILE_L2,
                 uv.getY(i) * (y1 - y0) / WATER_TILE_L2);
      }
      const mat = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, opacity: WATER_OPACITY,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      l2ToThree((x0 + x1) / 2, (y0 + y1) / 2, w.height, mesh.position);
      mesh.renderOrder = 1;   // after the opaque terrain
      mesh.name = 'water';
      this.group.add(mesh);
    }
  }

  // -- interior fire-prop lights ------------------------------------------------
  //
  // Dungeon textures are authentically near-black (19_16 mean luminance 56)
  // and the single player-torch leaves most of the map dark. Static flame
  // props (FX_E_S.Default_Flame01, deco01.Fire01) mark where the map itself
  // burns — attach warm point lights there. Nearby flames (brazier clusters)
  // share one light and the total is capped; tiles without fire props
  // (25_21 Antharas' Nest) get nothing.
  _buildFireLights() {
    const flames = (this.def.props || [])
      .filter(p => p.gltf && p.position && FIRE_PROP_RE.test(p.mesh));
    if (!flames.length) return;
    const bins = new Map();  // "bx,by,bz" -> {sx,sy,sz,n}
    for (const p of flames) {
      const [x, y, z] = p.position;   // L2 units
      const key = [x, y, z]
        .map(v => Math.round(v * L2_TO_M / FIRE_CLUSTER_M)).join(',');
      let b = bins.get(key);
      if (!b) bins.set(key, b = { sx: 0, sy: 0, sz: 0, n: 0 });
      b.sx += x; b.sy += y; b.sz += z; b.n++;
    }
    // cap: the biggest clusters are the brazier groups, keep those
    const clusters = [...bins.values()]
      .sort((a, b) => b.n - a.n).slice(0, FIRE_LIGHT_MAX);
    for (const c of clusters) {
      // tuned against the player torch (3.2/60/1.3): reads at ~15 m in the
      // near-black dungeon without washing out the mood
      const light = new THREE.PointLight(0xff9540, 16.0, 40, 1.5);
      l2ToThree(c.sx / c.n, c.sy / c.n, c.sz / c.n, light.position);
      light.position.y += FIRE_LIGHT_LIFT_M;
      // brazier flames can sit in sunken bowls below the walk floor; a
      // light left there only lights floor undersides — clamp above the
      // local floor (geodata-aware, multi-level safe)
      const groundY = this.heightAtWorld(
        light.position.x, light.position.z, light.position.y);
      light.position.y = Math.max(light.position.y, groundY + 1.5);
      light.userData.baseIntensity = light.intensity;
      light.userData.phase = Math.random() * Math.PI * 2;
      this.group.add(light);
      this.fireLights.push(light);
    }
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
  //
  // The basis map M: (x,y,z)_L2 -> (x,z,-y)_three has determinant +1 (it is
  // a ROTATION, not a reflection — the old comment here claimed otherwise).
  // So the placement quaternion is simply M R_ue M^T, which preserves every
  // rotation angle and only relabels the axes.
  //
  // R_ue is UE2's FRotationMatrix, reproduced term for term by the vendored
  // reference oracle: tools/src/UEViewer/Unreal/UnrealMesh/UnMathTools.h:6
  // RotatorToAxis + Core/Math3D.cpp:252 Euler2Vecs, whose rows (= the actor's
  // local axes in world space) are
  //     X: ( cP cY,            cP sY,            sP    )
  //     Y: ( sR sP cY - cR sY,  sR sP sY + cR cY, -sR cP)
  //     Z: (-(cR sP cY + sR sY), cY sR - cR sP sY, cR cP)
  // Conjugating that by M and matching against axis-angle quaternions gives
  // exactly ONE combination (verified numerically over 40 random rotators,
  // max element error 6.7e-16):
  //     yaw   -> about (0,1,0) by +yaw
  //     pitch -> about (0,0,1) by +pitch
  //     roll  -> about (1,0,0) by -roll
  //     composed qYaw * qPitch * qRoll
  // Only the YAW sign changes relative to the pre-F1 code; pitch and roll
  // were already right. (docs/foundation-audit.md F1 specified roll -> +roll;
  // that part of the spec is wrong — see docs/world-prop-basis.md.)
  //
  // This is only valid together with the determinant +1 prop meshes produced
  // by convert.py gltf_to_proper_basis(); umodel's raw output is mirrored.
  static ueQuaternion(pitch, yaw, roll) {
    const qYaw = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * UE_ROT_TO_RAD);
    const qPitch = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch * UE_ROT_TO_RAD);
    const qRoll = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -roll * UE_ROT_TO_RAD);
    return qYaw.multiply(qPitch).multiply(qRoll);
  }

  // scene.json stores `scale` in L2 axis order (DrawScale * DrawScale3D,
  // convert.py convert_props). The same conjugation as above maps a diagonal
  // L2 scale to three as diag(sx, sz, sy) — L2 y is three -z and L2 z is
  // three y. Getting this wrong flipped 308 retail (1,-1,1) mirrors upside
  // down instead of sideways and mis-stretched 3,025 placements.
  // docs/foundation-audit.md F2.
  static propScale(scale, out = new THREE.Vector3()) {
    const [sx, sy, sz] = scale || [1, 1, 1];
    return out.set(sx, sz, sy);
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
      // flame glow sprites: additive, no cutout, no depth writes (see
      // FLAME_MAT_RE) — the generic cutout turns them into black quads
      if (m.map && FLAME_MAT_RE.test(m.name || '')) {
        m.blending = THREE.AdditiveBlending;
        m.transparent = true;
        m.depthWrite = false;
        m.alphaTest = 0;
        m.side = THREE.DoubleSide;
        continue;
      }
      // Everything else keeps the render state GLTFLoader read from the
      // glTF, which convert.py now sets from the RETAIL UE2 material
      // (AlphaTest/AlphaRef, OutputBlending, TwoSided/TreatAsTwoSided) — see
      // convert.py RetailMaterialIndex and docs/foundation-audit.md F3.
      // The blanket `m.alphaTest = 0.5; m.side = DoubleSide` that used to
      // live here overrode all of it and cut 209 surfaces (1,131 placements)
      // away entirely, because in L2 the alpha channel is a specular or
      // self-illumination mask on every material that is not alpha-tested.
    }
    return material;
  }

  // Front/back swap for mirrored (negative-determinant) instances; cached
  // per source material so one clone is shared by every mirrored placement.
  static _flipSide(material) {
    if (Array.isArray(material)) return material.map(m => Terrain._flipSide(m));
    if (material.side === THREE.DoubleSide) return material;
    if (!Terrain._flipCache) Terrain._flipCache = new WeakMap();
    let m = Terrain._flipCache.get(material);
    if (!m) {
      m = material.clone();
      m.side = material.side === THREE.BackSide ? THREE.FrontSide : THREE.BackSide;
      Terrain._flipCache.set(material, m);
    }
    return m;
  }

  static _propMatrix(p, out = new THREE.Matrix4()) {
    const [px, py, pz] = p.position || [0, 0, 0];
    const pos = l2ToThree(px, py, pz);
    const [pitch, yaw, roll] = p.rotation || [0, 0, 0];
    const quat = Terrain.ueQuaternion(pitch, yaw, roll);
    return out.compose(pos, quat, Terrain.propScale(p.scale));
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
          // 1,849 retail placements carry a NEGATIVE-determinant scale
          // (DrawScale3D mirrors, e.g. (1,-1,1)). Such an instance draws its
          // triangles with reversed winding, and three.js only compensates
          // for that on an object's own matrixWorld (WebGLRenderer's
          // frontFaceCW test) — never per InstancedMesh instance. While
          // every prop material was force-DoubleSided that stayed hidden;
          // now that the retail two-sidedness is honored (F3) they would be
          // culled inside-out. So mirrored instances go into their own
          // InstancedMesh with the material's front face flipped.
          // (Normals are fine: these are axis mirrors, diagonal +-1, for
          // which the instance matrix IS its own inverse-transpose.)
          for (const flip of [false, true]) {
            const sel = [];
            for (const m of matrices) {
              instM.copy(m).multiply(mesh.matrix);
              if ((instM.determinant() < 0) === flip) sel.push(instM.clone());
            }
            if (!sel.length) continue;
            const material = flip ? Terrain._flipSide(mesh.material)
              : mesh.material;
            const im = new THREE.InstancedMesh(mesh.geometry, material, sel.length);
            for (let i = 0; i < sel.length; i++) im.setMatrixAt(i, sel[i]);
            im.instanceMatrix.needsUpdate = true;
            im.castShadow = true;
            im.receiveShadow = true;
            im.computeBoundingSphere();   // per-cluster frustum culling
            this.group.add(im);
            this.props.push(im);
            cluster.meshes.push(im);
          }
        }
        this.propClusters.push(cluster);
      }
    }
  }

  // draw-distance: toggle cluster visibility by distance to a world point.
  // The BSP chunks ride the same budget (bsp.py buckets them on the same
  // 48 m grid), so buildings and their decoration pop together.
  setPropDrawDistance(dist, from) {
    for (const c of this.propClusters || []) {
      const v = !dist || c.center.distanceTo(from) < dist;
      if (v !== c.visible) {
        c.visible = v;
        for (const m of c.meshes) m.visible = v;
      }
    }
    if (this.bsp) this.bsp.setDrawDistance(dist, from);
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
      Terrain.propScale(p.scale, obj.scale);
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
