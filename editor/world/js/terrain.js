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

// how many times a layer diffuse texture repeats across the whole tile
// (before per-layer uscale/vscale)
const TEXTURE_REPEAT = 64;
const MAX_LAYERS = 8;
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
  }

  async load() {
    const res = await fetch(this.baseUrl + this.def.heightmap);
    if (!res.ok) throw new Error(`heightmap fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const n = this.gridSize * this.gridSize;
    const view = new DataView(buf);
    this.heights = new Uint16Array(n);
    for (let i = 0; i < n; i++) this.heights[i] = view.getUint16(i * 2, true);
    this._buildMesh();
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

  // bilinear height (three.js Y, meters) at three.js world (x, z)
  heightAtWorld(x, z) {
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

  _buildMesh() {
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

    const material = this._buildMaterial();
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.group.add(this.mesh);
  }

  _buildMaterial() {
    const layers = (this.def.layers || []).filter(l => l && l.diffuse)
      .slice(0, MAX_LAYERS);
    const loader = new THREE.TextureLoader();
    const loadTex = (file, { srgb = true, repeat = false } = {}) => {
      const t = loader.load(this.baseUrl + file);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      // base uv transform: TEXTURE_REPEAT across the tile; the shader
      // divides it back out for full-tile splats and rescales per layer
      if (repeat) t.repeat.set(TEXTURE_REPEAT, TEXTURE_REPEAT);
      return t;
    };

    if (layers.length === 0) {
      return new THREE.MeshLambertMaterial({ color: 0x4a6b3a });
    }

    const hasSplat = layers.slice(1).some(l => l.splat);
    if (!hasSplat) {
      // graceful path: dominant (first) layer tiled
      return new THREE.MeshLambertMaterial({ map: loadTex(layers[0].diffuse, { repeat: true }) });
    }

    // multi-texture splatting (UE terrain semantics): layer 0 is the base,
    // each subsequent layer is alpha-blended over it using its own
    // grayscale splat map (layers[i].splat). Lambert lighting/fog/shadow
    // from three.js, diffuse replaced via onBeforeCompile.
    const mat = new THREE.MeshLambertMaterial({
      map: loadTex(layers[0].diffuse, { repeat: true }),
    });
    const extra = [];
    for (let i = 1; i < layers.length; i++) {
      extra.push({
        map: loadTex(layers[i].diffuse, { repeat: true }),
        splat: layers[i].splat ? loadTex(layers[i].splat, { srgb: false }) : null,
        uvScale: [layers[i].uscale ?? 1, layers[i].vscale ?? 1],
      });
    }
    const baseUvScale = [layers[0].uscale ?? 1, layers[0].vscale ?? 1];

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBaseUvScale = { value: new THREE.Vector2(...baseUvScale) };
      extra.forEach((e, i) => {
        shader.uniforms[`uMap${i}`] = { value: e.map };
        shader.uniforms[`uSplat${i}`] = { value: e.splat };
        shader.uniforms[`uUvScale${i}`] = { value: new THREE.Vector2(...e.uvScale) };
      });

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `
          #include <map_pars_fragment>
          uniform vec2 uBaseUvScale;
          ${extra.map((_, i) => `
          uniform sampler2D uMap${i};
          uniform sampler2D uSplat${i};
          uniform vec2 uUvScale${i};`).join('')}
        `)
        .replace('#include <map_fragment>', `
          // vMapUv carries the base repeat; splats sample the whole tile
          vec2 splatUv = vMapUv / vec2(${TEXTURE_REPEAT.toFixed(1)});
          vec4 blended = texture2D(map, vMapUv * uBaseUvScale);
          ${extra.map((e, i) => e.splat ? `
          blended = mix(blended, texture2D(uMap${i}, vMapUv * uUvScale${i}),
                        texture2D(uSplat${i}, splatUv).r);` : '').join('')}
          diffuseColor *= blended;
        `);
    };
    return mat;
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
