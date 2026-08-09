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
//                           bones. FOUR of them, not two — see below.
//
// That last one is why nothing here computes a position. The weapon meshes ship
// with their retail origin intact (the builder verified 410 of 417 have an
// identity MeshScale/MeshOrigin/RotOrigin and refuses to emit the rest), so the
// correct transform is the identity: parent the weapon to the socket bone and
// let the animation move it. Any offset or rotation fudge here would be a sign
// the mesh had been mangled upstream, not something to paper over.
//
// Which bone — decoded, not chosen
// --------------------------------
// The retail pawn classes name their own attach bones. `LineageWarrior.u`'s
// class default properties (the serialised tagged-property block of each
// UClass export; decoded with tools/l2lib/ue2package.py) carry, IDENTICALLY on
// all 14 playable pawn classes MFighter/FFighter/MMagic/FMagic/MElf/FElf/
// MDarkElf/FDarkElf/MOrc/FOrc/MShaman/FShaman/MDwarf/FDwarf:
//
//     RightHandBone = Weapon_R_Bone      LeftHandBone = Weapon_L_Bone
//     RightArmBone  = Shield_R_Bone      LeftArmBone  = Shield_L_Bone
//     SpineBone = bip01_spine2   CapeBone = Cape_Bone   HeadBone = Bip01_head
//
// Those four are `var name` slots on Engine.u's `Pawn`, read natively through
// APawn::GetLHandBoneName/GetLArmBoneName (exported by engine.dll). So a SHIELD
// hangs on the ARM bone `Shield_L_Bone`, not on the hand bone a sword uses.
// All 14 character glTFs carry both bones (verified: they are siblings under
// `Bip01_L_Hand`, ~4 cm and ~90 degrees apart), which is exactly why hanging a
// shield on `Weapon_L_Bone` put it through the forearm instead of across it.
//
// Corroborated geometrically on human_fighter_m + tower_shield_m00_sh: the
// shield plate's normal sits 88.2 degrees off the forearm axis on
// Shield_L_Bone (the forearm lies IN the plate, i.e. strapped) and 4.0 degrees
// off it on Weapon_L_Bone (the forearm skewers the plate).
//
// The transform is still the identity, and that is decoded too rather than
// assumed: a UE2 USkeletalMesh carries an explicit socket table
// (AttachAliases / AttachBoneNames / AttachCoords, UEViewer UnMesh2.cpp:447).
// Decoded for all 14 body meshes, each holds exactly ONE socket — alias
// `e_bone` on `Bip01_head`, origin (0,0,7.2..9.7) with identity axes, an
// effect anchor above the head. There is no weapon or shield socket coord
// anywhere, and all 17 shield meshes have identity MeshScale/MeshOrigin/
// RotOrigin and no socket table of their own. The bone frame IS the transform.
//
// NOT recovered: engine.dll is Themida-packed, so the native call site that
// picks LeftArmBone over LeftHandBone for the shield slot cannot be
// disassembled. The bone binding above and the geometry are the evidence.
// `Shield_R_Bone` / RightArmBone is decoded but unused here — the player
// paperdoll never puts a shield in the right hand.
//
// Names are compared lowercased throughout: weapongrp and the .ukx export table
// disagree on case for six meshes, and picking either spelling verbatim would
// resolve on macOS and 404 on a case-sensitive host.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WEAPON_BASE = '/characters/weapons/';
const MESH_INDEX_URL = '/gamedata/weaponmesh.json';
const STANCES_URL = '/characters/stances.json';

const loader = new GLTFLoader();

let _index = null;      // { meshes[], textures[], items: {itemId: {m,t,h,w}} }
let _manifest = null;   // { meshId: entry }
let _stances = null;    // { no_weapon, by_handness: {h: {stance}} }
let _ready = null;

export function equipmentReady() { return _ready; }

export async function loadEquipment() {
  if (_ready) return _ready;
  _ready = (async () => {
    try {
      const [idx, man, st] = await Promise.all([
        fetch(MESH_INDEX_URL).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
        fetch(WEAPON_BASE + 'manifest.json').then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
        // Optional: without it every character just keeps the unarmed stance,
        // which is what the client did before stances existed.
        fetch(STANCES_URL).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      _stances = st;
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
  // ABSENT `h` MEANS ZERO, NOT ONE. export_weaponmesh.py writes `h` only when
  // weapongrp's handness is truthy (`if rec.get("handness")`), so every one of
  // the 95 shield rows — handness 0, the client's own HAND enum ordinal —
  // arrives with no `h` at all. The old `rec.h || 1` turned all 95 of them
  // into one-handed weapons, which is why nothing downstream could tell a
  // shield from a sword. weapongrp has no other handness-0 equippable: the
  // only other rows with handness 0 are the 33 body_part 0 pet/quest sacks,
  // which never reach a paperdoll slot.
  return { mesh, handness: rec.h == null ? 0 : rec.h, weaponType: rec.w || 0 };
}

// --- sockets ---------------------------------------------------------------
// Names are retail (see the header): the pawn's LeftHandBone/LeftArmBone.
const SOCKET_WEAPON = { R: 'Weapon_R_Bone', L: 'Weapon_L_Bone' };
const SOCKET_SHIELD_L = 'Shield_L_Bone';

// Is this mesh a shield? weapongrp's `handness` says so and nothing else does:
// 0 is the client's HAND ordinal, which for an equippable means a shield. The
// manifest is the better of the two carriers — build_weapons.py copies the
// weapongrp value through unchanged per MESH, and shield-ness is a property of
// the mesh, not of the item — so it wins; weaponmesh is the fallback for a
// mesh that was never built. Verified over the whole shipped roster: the 17
// manifest entries with handness 0 are exactly the 17 `_sh` meshes, and
// weapongrp agrees (95 body_part 8 rows, all `_sh`).
function isShield(info) {
  if (!info) return false;
  const entry = _manifest && _manifest[info.mesh.toLowerCase()];
  if (entry && typeof entry.handness === 'number') return entry.handness === 0;
  return info.handness === 0;
}

// Which animation stance a weapon puts a character in.
//
// The mapping is the retail client's own: NWindow.dll's NCPawnViewerWnd lists
// 7(DUALFIST) 5(BOW) 4(POLE) 3(DUAL) 2(2HS) 1(1HS) 0(HAND), and those numbers
// are weapongrp's `handness` — the domains match 1:1. `weapon_type` is a
// DIFFERENT domain (DUAL is 8 there, BOW 6), so it is not what the enum counts.
// Two rows of the table are marked unsourced upstream and fall back to `hand`.
export function stanceFor(itemId) {
  if (!_stances) return 'hand';
  if (!itemId) return _stances.no_weapon || 'hand';
  const info = weaponInfo(itemId);
  if (!info) return _stances.no_weapon || 'hand';
  const row = _stances.by_handness && _stances.by_handness[String(info.handness)];
  return (row && row.stance) || _stances.no_weapon || 'hand';
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
//
// `shield` picks the ARM bone instead of the hand bone (see the header). It
// has NO fallback on purpose: `Shield_L_Bone` is present on all 14 shipped
// character glTFs, and quietly falling back to `Weapon_L_Bone` would restore
// the exact defect this replaces while looking like it worked.
export function findSocket(root, side = 'R', shield = false) {
  if (!root) return null;
  if (shield) return root.getObjectByName(SOCKET_SHIELD_L) || null;
  return root.getObjectByName(SOCKET_WEAPON[side] || SOCKET_WEAPON.R)
      || root.getObjectByName(`Bip01_${side}_Hand`)   // pre-socket models
      || null;
}

// Every bone an item on `side` could be hanging from. A left-hand swap can
// cross sockets (shield -> dagger), so both have to be swept or the old model
// stays on the bone the new one did not land on.
function sideSockets(root, side) {
  const out = [findSocket(root, side, false)];
  if (side === 'L') out.push(findSocket(root, side, true));
  return out.filter(Boolean);
}

// Attach `itemId`'s model to the socket that item's own weapongrp row calls
// for — `Weapon_R_Bone` by default, `Weapon_L_Bone` for an off-hand weapon,
// `Shield_L_Bone` for a shield — replacing whatever is on either socket of
// that side. Returns the attached Object3D, or null when the item has no
// model. `side` is the paperdoll slot; the shield/weapon choice is data, not a
// caller decision, so callers need not (and must not) know the bone.
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

  const shield = isShield(info);
  const socket = findSocket(root, side, shield);
  detachWeapon(state, sideSockets(root, side));
  state.meshId = wantMesh;
  if (!wantMesh) return null;

  const template = await loadWeapon(wantMesh);
  if (!template || state.gen !== gen) return null;   // a newer call superseded us

  if (!socket) {
    // Named, because "no socket" for a shield and for a sword mean different
    // missing bones and a silent substitution is how this bug got here.
    console.warn(`[equipment] model has no ${shield ? SOCKET_SHIELD_L : SOCKET_WEAPON[side]}`);
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
// Takes one socket or a list of them (an off hand has two).
function clearSocket(socket) {
  if (!socket) return;
  if (Array.isArray(socket)) { for (const s of socket) clearSocket(s); return; }
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
