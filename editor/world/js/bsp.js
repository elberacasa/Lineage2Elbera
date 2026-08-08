// BSP buildings: loads assets/world/<tile>/bsp.gltf, the decoded UE2 level
// BSP of the map tile (every town building shell, wall, floor, stair and
// interior; static meshes are the decoration ON these shells, not the
// shells themselves). Written by tools/world/bsp.py — contract in
// tools/world/README.md, format lore in tools/l2lib/ue2package.py.
//
// COORDINATES. bsp.gltf carries raw L2 world units, Z-up, exactly like
// scene.json props — "UE2 units = glTF units, handedness conversion is the
// client's job". The conversion is the one in coords.js,
// (x, y, z)_L2 -> (x, z, -y)_three at 1 unit = 1 cm, expressed once as a
// group transform:
//     rotation.x = -PI/2   maps (x, y, z) -> (x, z, -y)
//     scale      =  0.01   L2 cm -> m
// That matrix has positive determinant (it is a rotation), so the CCW
// winding baked by the converter stays CCW and front faces stay front.
// NOTHING is translated — the level BSP is already world-placed, and a
// nudge here would be hiding a converter bug.
//
// CULLING. One glTF node per spatial chunk (the converter buckets nodes on
// a 48 m grid, the same size as the client's prop clusters), so the chunks
// toggle under the same draw distance as the props — see
// Terrain.setPropDrawDistance.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L2_TO_M } from './coords.js';

export class Bsp {
  constructor(gltfScene) {
    this.group = new THREE.Group();
    this.group.name = 'bsp';
    this.group.rotation.x = -Math.PI / 2;
    this.group.scale.setScalar(L2_TO_M);
    this.group.add(gltfScene);
    this.chunks = [];       // { object, center (three world), visible }
    this.triangles = 0;
    // bbox in RAW L2 world units (the glTF nodes carry no transform of
    // their own, so geometry space is L2 world space). Verification reads
    // this to prove the BSP landed in its own tile — see verify_bsp.js.
    this.boundsL2 = new THREE.Box3();

    gltfScene.updateMatrixWorld(true);
    this.group.updateMatrixWorld(true);
    for (const child of gltfScene.children) {
      const center = new THREE.Vector3();
      let n = 0;
      child.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        Bsp._prepMaterial(o.material);
        o.geometry.computeBoundingSphere();
        o.geometry.computeBoundingBox();
        this.boundsL2.union(o.geometry.boundingBox);
        center.add(o.geometry.boundingSphere.center.clone()
          .applyMatrix4(o.matrixWorld));
        n++;
        const idx = o.geometry.index;
        this.triangles +=
          (idx ? idx.count : o.geometry.attributes.position.count) / 3;
      });
      if (n) {
        this.chunks.push({ object: child, center: center.divideScalar(n),
                           visible: true });
      }
    }
  }

  // The converter marks alpha-cutout surfaces alphaMode MASK already; the
  // rest is the same treatment the props get (doubleSided is baked into the
  // glTF materials — a BSP shell is a room you walk INSIDE).
  static _prepMaterial(material) {
    const mats = Array.isArray(material) ? material : [material];
    for (const m of mats) {
      if (!m.map) continue;
      m.map.anisotropy = 4;
      m.side = THREE.DoubleSide;
    }
  }

  // -> Bsp, or null when the tile ships no bsp.gltf (not every tile has
  // BSP, and a missing/broken file must never take the scene down).
  static async load(baseUrl) {
    // '?bsp=off' renders the tile the way it looked before the BSP was
    // decoded — that is how the before/after shots in verify_bsp.js are
    // taken from one build instead of from two checkouts.
    if (new URLSearchParams(location.search).get('bsp') === 'off') return null;
    const url = baseUrl + 'bsp.gltf';
    let text;
    try {
      // plain GET, not HEAD: editor/world/server.py implements GET only.
      const res = await fetch(url);
      if (!res.ok) {
        // drain the 404 body: an unread body leaves the request in flight
        // and never lets the page reach networkidle0 (see bspfloor.js)
        await res.arrayBuffer().catch(() => {});
        return null;                         // tile ships no BSP
      }
      text = await res.text();
    } catch {
      return null;
    }
    try {
      // parse the text we already have (loadAsync would refetch); baseUrl
      // resolves bsp.bin and bsp/*.png
      const gltf = await new GLTFLoader().parseAsync(text, baseUrl);
      return new Bsp(gltf.scene);
    } catch (err) {
      console.warn(`bsp: ${url} failed to load (${err.message})`);
      return null;
    }
  }

  // distance culling, driven from Terrain.setPropDrawDistance so BSP and
  // props share one budget. `from` is a three.js world position.
  setDrawDistance(dist, from) {
    for (const c of this.chunks) {
      const v = !dist || c.center.distanceTo(from) < dist;
      if (v !== c.visible) {
        c.visible = v;
        c.object.visible = v;
      }
    }
  }
}
