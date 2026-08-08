// Geometry for UE2 MeshEmitter particles.
//
// DATA: /gamedata/skillmesh.json + /gamedata/skillmesh.bin, built by
// tools/dat/build_skillmesh.py out of the umodel .pskx exports of the 108
// LineageEffectsStaticmeshes objects that skill-bound MeshEmitters name.
// Nothing here is authored: positions, UVs, triangles and per-submesh textures
// are all retail bytes, already converted to the client's (x, z, -y) basis with
// the winding corrected (the same correction the character pipeline applies --
// umodel's psk exporter mirrors on Y, which flips the triangle order).
//
// The pair is one 12 KB index + one 255 KB binary blob for the whole set, so a
// mesh costs a subarray view rather than a fetch: 8393 triangles total.

import * as THREE from 'three';

let _promise = null;
let _index = null;       // parsed skillmesh.json
let _pos = null;         // Float32Array, 3 per vertex, three-space metres
let _uv = null;          // Float32Array, 2 per vertex
let _idx = null;         // Uint16Array, per-mesh-relative wedge indices
const _geoms = new Map();   // "<mesh>/<submesh>" -> BufferGeometry

/** Load the index + blob once. Resolves to null when the pipeline has not
 *  staged them (the client then simply draws no mesh particles). */
export function meshIndex() {
  if (!_promise) {
    _promise = Promise.all([
      fetch('/gamedata/skillmesh.json').then(r => (r.ok ? r.json() : null)),
      fetch('/gamedata/skillmesh.bin').then(r => (r.ok ? r.arrayBuffer() : null)),
    ]).then(([json, bin]) => {
      if (!json || !bin) return null;
      // layout: [positions f32x3][uvs f32x2][indices u16], counts in the index
      const nv = json.nv, ni = json.ni;
      _pos = new Float32Array(bin, 0, nv * 3);
      _uv = new Float32Array(bin, nv * 12, nv * 2);
      _idx = new Uint16Array(bin, nv * 12 + nv * 8, ni);
      _index = json;
      return json;
    }).catch(() => null);
  }
  return _promise;
}

export function meshReady() { return _index; }

/** Submesh records for one mesh name: [{geometry, tex, texAlpha}], or null. */
export function meshParts(name) {
  if (!_index) return null;
  const rec = _index.mesh[name];
  if (!rec) return null;
  const out = [];
  for (let s = 0; s < rec.s.length; s++) {
    const sub = rec.s[s];
    if (sub.t === undefined) continue;      // material slot never staged: skip it
    const key = name + '/' + s;
    let g = _geoms.get(key);
    if (!g) {
      g = new THREE.BufferGeometry();
      // one shared vertex block per mesh; indices are already mesh-relative
      g.setAttribute('position', new THREE.BufferAttribute(
        _pos.subarray(rec.v0 * 3, (rec.v0 + rec.nv) * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(
        _uv.subarray(rec.v0 * 2, (rec.v0 + rec.nv) * 2), 2));
      g.setIndex(new THREE.BufferAttribute(
        _idx.subarray(sub.i0, sub.i0 + sub.n), 1));
      _geoms.set(key, g);
    }
    out.push({ geometry: g, tex: _index.tex[sub.t], texAlpha: !!_index.texa[sub.t] });
  }
  return out.length ? out : null;
}
