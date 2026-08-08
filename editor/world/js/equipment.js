// Equipped weapons, hung on the skeleton's own sockets.
//
// Three lookups stand between "the server says item 69" and a sword in the
// hand, and each exists because the ids do not line up:
//
//   itemId -> mesh name     assets/gamedata/weaponmesh.json, lifted out of
//                           weapongrp.json. 1,303 weapons share 390 meshes —
//                           every enchant level and most name variants of a
//                           sword are the same geometry.
//   mesh name -> glTF       editor/characters/weapons/manifest.json, built by
//                           tools/src/char_pipeline/build_weapons.py.
//   character -> socket     the character glTFs carry NCSoft's own attachment
//                           bones, `Weapon_R_Bone` and `Weapon_L_Bone`.
//
// That last one is why nothing here computes a position. The weapon meshes ship
// with their retail origin intact (the builder verified 410 of 417 have an
// identity MeshScale/MeshOrigin/RotOrigin and refuses to emit the rest), so the
// correct transform is the identity: parent the weapon to the socket bone and
// let the animation move it. Any offset or rotation fudge here would be a sign
// the mesh had been mangled upstream, not something to paper over.
//
// Names are compared lowercased throughout: weapongrp and the .ukx export table
// disagree on case for six meshes, and picking either spelling verbatim would
// resolve on macOS and 404 on a case-sensitive host.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WEAPON_BASE = '/characters/weapons/';
const MESH_INDEX_URL = '/gamedata/weaponmesh.json';

const loader = new GLTFLoader();

let _index = null;      // { meshes[], textures[], items: {itemId: {m,t,h,w}} }
let _manifest = null;   // { meshId: entry }
let _ready = null;

export function equipmentReady() { return _ready; }

export async function loadEquipment() {
  if (_ready) return _ready;
  _ready = (async () => {
    try {
      const [idx, man] = await Promise.all([
        fetch(MESH_INDEX_URL).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
        fetch(WEAPON_BASE + 'manifest.json').then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      ]);
      _index = idx;
      _manifest = {};
      for (const m of (man.models || [])) _manifest[m.id.toLowerCase()] = m;
      return true;
    } catch (err) {
      // Weapons are gitignored build output; without them the client must still
      // run, just bare-handed.
      console.warn('[equipment] not available, weapons will not render:', err.message);
      _index = null;
      _manifest = null;
      return false;
    }
  })();
  return _ready;
}

// itemId -> { mesh, handness, weaponType } or null
export function weaponInfo(itemId) {
  if (!_index || !itemId) return null;
  const rec = _index.items[String(itemId)];
  if (!rec) return null;
  const full = _index.meshes[rec.m];        // "lineageweapons.bastard_sword_m00_wp"
  if (!full) return null;
  // The manifest is keyed by the object name alone; weaponmesh keeps the
  // package prefix because that is how weapongrp writes it.
  const mesh = full.includes('.') ? full.slice(full.indexOf('.') + 1) : full;
  return { mesh, handness: rec.h || 1, weaponType: rec.w || 0 };
}

const _cache = new Map();   // meshId -> Promise<THREE.Object3D|null>

function loadWeapon(meshId) {
  const key = meshId.toLowerCase();
  if (_cache.has(key)) return _cache.get(key);
  const entry = _manifest && _manifest[key];
  if (!entry) {
    // A weapon whose model was not built (the roster is NONE+D grade today).
    _cache.set(key, Promise.resolve(null));
    return _cache.get(key);
  }
  const job = new Promise((resolve) => {
    loader.load(WEAPON_BASE + entry.gltf,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => { console.warn(`[equipment] ${key}: ${err && err.message}`); resolve(null); });
  });
  _cache.set(key, job);
  return job;
}

// Find a socket bone anywhere under a loaded character. getObjectByName walks
// the whole subtree, which is what we want: the bones live under the skinned
// mesh's armature, not at the model root.
export function findSocket(root, side = 'R') {
  if (!root) return null;
  return root.getObjectByName(`Weapon_${side}_Bone`)
      || root.getObjectByName(`Bip01_${side}_Hand`)   // pre-socket models
      || null;
}

// Attach `itemId`'s weapon to `root`'s right-hand socket, replacing whatever is
// there. Returns the attached Object3D, or null when the item has no model.
//
// `state` is a small holder the caller owns (one per character) so repeated
// calls can dispose the previous weapon — three.js will not do that for us and
// a player who swaps weapons in a shop would otherwise leak one mesh per swap.
export async function equipWeapon(root, itemId, state, side = 'R') {
  if (!root || !state) return null;
  await loadEquipment();

  // Every call takes a ticket. aCis emits several UserInfo packets around an
  // equip, so this runs concurrently for the same character, and each call
  // awaits a glTF load in the middle. Without a ticket, two in-flight calls
  // both pass their post-await guard and both attach — the socket ends up with
  // a stack of weapons, `state.object` tracks only the last, and every later
  // lookup finds a stale one. Comparing meshId is not enough: concurrent calls
  // for the SAME weapon have the same meshId.
  const gen = (state.gen = (state.gen || 0) + 1);

  const info = weaponInfo(itemId);
  const wantMesh = info ? info.mesh.toLowerCase() : null;
  if (state.meshId === wantMesh && state.object && state.object.parent) {
    return state.object;                     // already wearing exactly this
  }

  const socket = findSocket(root, side);
  detachWeapon(state, socket);
  state.meshId = wantMesh;
  if (!wantMesh) return null;

  const template = await loadWeapon(wantMesh);
  if (!template || state.gen !== gen) return null;   // a newer call superseded us

  if (!socket) {
    console.warn('[equipment] no weapon socket on this model');
    return null;
  }

  // Clone per wearer: two players holding the same sword must not share one
  // Object3D, and the template stays clean for the next clone.
  const obj = template.clone(true);
  obj.name = `weapon_${wantMesh}`;
  clearSocket(socket);                        // belt and braces against strays
  socket.add(obj);                            // identity transform, on purpose
  state.object = obj;
  state.handness = info.handness;
  state.weaponType = info.weaponType;
  return obj;
}

// Remove every weapon hanging on a socket, not just the one we think is there.
// The tracked reference can go stale (a superseded load, a model swap), and a
// leftover clone is invisible to `state` but very visible on screen.
function clearSocket(socket) {
  if (!socket) return;
  for (const child of [...socket.children]) {
    if (child.name && child.name.startsWith('weapon_')) socket.remove(child);
  }
}

export function detachWeapon(state, socket = null) {
  if (!state) return;
  // Detach only. The clone shares its geometry and materials with the cached
  // template, so disposing them here would blank the weapon for every other
  // character holding the same sword.
  if (state.object && state.object.parent) state.object.parent.remove(state.object);
  // Sweep the socket too when we have it: a superseded load or an interrupted
  // model swap can leave a clone attached that `state` no longer points at.
  clearSocket(socket);
  state.object = null;
  state.meshId = null;
}
