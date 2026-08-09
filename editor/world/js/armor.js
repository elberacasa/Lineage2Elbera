// Equipped armor: per-slot BODY MESH SUBSTITUTION on the character.
//
// Armor is not a prop. A weapon hangs off `Weapon_R_Bone` with an identity
// transform; a breastplate REPLACES the character's upper-body mesh. armorgrp
// says so directly -- every armor row names, per race and per sex, a
// SkeletalMesh out of the same family the creation body is built from. Item 21
// ("Squire's" chest tier) names `Fighter.MFighter_m001_u` for a male human
// fighter, and `MFighter_m001_u` is exactly the mesh already inside
// editor/characters/models/human_fighter_m.gltf. So "no armor equipped" is not
// a special case needing a default model: it is the mesh the base glTF already
// carries, and equipping swaps geometry in its place.
//
// Three lookups, mirroring equipment.js:
//
//   itemId -> slot + mesh    assets/gamedata/armormesh.json, built by
//                            tools/mesh/build_armor.py out of armorgrp.json.
//   mesh name -> glTF        editor/characters/armor/manifest.json (geometry
//                            only -- no texture, because one mesh serves many
//                            colour variants: `FDarkElf_m002_l` is worn by
//                            items whose materials are t10, t45, t48, t49...).
//   material -> PNG          the same manifest's `textures` map. armorgrp's
//                            texture string is a MATERIAL name, and 56% of them
//                            are Shader/FinalBlend objects rather than Texture
//                            objects; the builder resolved each to its declared
//                            diffuse.
//
// WHY THE MESH CAN JUST BE RE-BOUND
// The armor glTFs are assembled by the same canonical-skeleton path the base
// characters use, from .psk exports of the same .ukx. Measured, not assumed:
// `DarkElf.FDarkElf_m002_u`'s 84 joints are the same names in the same ORDER
// as darkelf_f.gltf's 84 (build_armor.py --check re-asserts this on a sample of
// five). So the armor SkinnedMesh can be bound straight to the character's live
// skeleton and it animates with the body -- no retargeting, no bone map.
//
// WHY NOTHING HERE COMPUTES A TRANSFORM
// Each mesh carries a ULodMesh MeshScale/MeshOrigin/RotOrigin that the engine
// applies at instance time. None of them is identity -- and neither are the
// creation meshes the client already renders correctly (every model's body has
// yaw 49152 and a z origin of 20.5-31.5). The point is that a model's ARMOR
// carries the SAME transform as that model's own body, which is why
// substitution needs no extra transform at all. The builder refuses any mesh
// where that equality fails rather than letting this file paper over it; one
// mesh (Orc.MOrc_m007_g, z origin 31.0 against the body's 31.5) is refused on
// exactly that ground.
//
// SLOTS THAT DELIBERATELY DO NOTHING
// body_part 6 is HEAD -- 96 items, "Cloth Cap" through "Wooden Helmet" -- and
// it references ZERO meshes across all 28 race slots in armorgrp. Interlude
// does not render helmets as geometry. Rings, earrings and necklaces likewise.
// No head geometry is invented here.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ARMOR_BASE = '/characters/armor/';
const TABLE_URL = '/gamedata/armormesh.json';

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

let _table = null;      // { slots, models, items: {itemId: {...}} }
let _manifest = null;   // { meshes: {...}, textures: {...} }
let _ready = null;

export function armorReady() { return _ready; }

export async function loadArmor() {
  if (_ready) return _ready;
  _ready = (async () => {
    try {
      const [tab, man] = await Promise.all([
        fetch(TABLE_URL).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
        fetch(ARMOR_BASE + 'manifest.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      ]);
      _table = tab;
      _manifest = man;
      return true;
    } catch (err) {
      // Armor is gitignored build output, exactly like weapons. Without it the
      // client must still run -- every character simply keeps its base body,
      // which is what it did before this module existed.
      console.warn('[armor] not available, armor will not render:', err.message);
      _table = null;
      _manifest = null;
      return false;
    }
  })();
  return _ready;
}

// itemId -> { slot, replaces, meshes, textures } for one model, or null.
export function armorInfo(itemId, modelId) {
  if (!_table || !itemId || !modelId) return null;
  const row = _table.items[String(itemId)];
  if (!row) return null;
  const per = row.byModel[modelId];
  if (!per || !per.meshes || !per.meshes.length) return null;
  return {
    slot: row.slot,
    replaces: row.replaces || [],
    meshes: per.meshes,
    textures: per.textures || [],
  };
}

// Which base mesh suffixes a full equipped set covers. Used to decide which of
// the character's own body meshes to hide.
function suffixOf(meshName) {
  const m = /_([a-z0-9]+)$/i.exec(meshName);
  return m ? '_' + m[1].toLowerCase() : null;
}

const _meshCache = new Map();   // "Pkg.Name" -> Promise<SkinnedMesh|null>
const _texCache = new Map();    // "Pkg.Name" -> Promise<Texture|null>

function loadArmorMesh(full) {
  const key = full.toLowerCase();
  if (_meshCache.has(key)) return _meshCache.get(key);
  // The manifest is keyed exactly as armorgrp writes the reference
  // ("DarkElf.FDarkElf_m002_u"), but armorgrp is inconsistent about case
  // ("Lineageaccessory" vs "LineageAccessory" on 14 rows), so match
  // case-insensitively rather than trusting either spelling.
  let entry = _manifest && _manifest.meshes[full];
  if (!entry && _manifest) {
    for (const k of Object.keys(_manifest.meshes)) {
      if (k.toLowerCase() === key) { entry = _manifest.meshes[k]; break; }
    }
  }
  if (!entry) {
    _meshCache.set(key, Promise.resolve(null));
    return _meshCache.get(key);
  }
  const job = new Promise((resolve) => {
    loader.load(ARMOR_BASE + entry.gltf, (gltf) => {
      let found = null;
      gltf.scene.traverse(o => { if (o.isSkinnedMesh && !found) found = o; });
      resolve(found);
    }, undefined, (err) => {
      console.warn(`[armor] ${full}: ${err && err.message}`);
      resolve(null);
    });
  });
  _meshCache.set(key, job);
  return job;
}

function loadArmorTexture(full) {
  const key = full.toLowerCase();
  if (_texCache.has(key)) return _texCache.get(key);
  let entry = _manifest && _manifest.textures[full];
  if (!entry && _manifest) {
    for (const k of Object.keys(_manifest.textures)) {
      if (k.toLowerCase() === key) { entry = _manifest.textures[k]; break; }
    }
  }
  if (!entry) {
    _texCache.set(key, Promise.resolve(null));
    return _texCache.get(key);
  }
  const job = new Promise((resolve) => {
    texLoader.load(ARMOR_BASE + entry.png, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;              // glTF UV convention, same as the body
      resolve({ map: t, entry });
    }, undefined, () => resolve(null));
  });
  _texCache.set(key, job);
  return job;
}

// Find the character's own skinned body meshes, keyed by the retail suffix.
// The glTF mesh names ARE the retail mesh names (`MFighter_m001_u`), which is
// what makes the suffix meaningful here.
// Armor pieces are named `armor_<Pkg>.<Mesh>` and their mesh names end in the
// very same suffixes, so they MUST be excluded here. Without the guard a
// second call picks an armor piece as the skeleton host — and since the host
// is chosen before the previous set is detached, that host is about to be
// removed from the scene, so `host.parent` is null by the time the new pieces
// are added and nothing renders. It also means "hide the base _u" could hide
// an armor piece instead.
function bodyParts(root) {
  const out = new Map();
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    if ((o.name || '').startsWith('armor_')) return;
    const s = suffixOf(o.name || '');
    if (s) out.set(s, o);
  });
  return out;
}

/**
 * Apply an equipped set to a loaded character.
 *
 * @param root      the character model root (Character.model)
 * @param modelId   one of the 14 manifest ids ("human_fighter_m")
 * @param paperdoll { chest, legs, gloves, feet } item ids straight off the
 *                  wire -- gateway/src/gameclient.js readPaperdollItems already
 *                  decodes all four and bridge.js already forwards them.
 * @param state     caller-owned holder, one per character, so repeated calls
 *                  can remove the previous pieces.
 */
export async function applyArmor(root, modelId, paperdoll, state) {
  if (!root || !state) return null;
  await loadArmor();
  if (!_table) return null;

  // Ticket, for the same reason equipWeapon takes one: aCis emits several
  // UserInfo packets around an equip, each call awaits glTF loads in the
  // middle, and two in-flight calls would otherwise both attach.
  const gen = (state.gen = (state.gen || 0) + 1);

  const pd = paperdoll || {};
  const key = ['chest', 'legs', 'gloves', 'feet'].map(k => pd[k] || 0).join(',');
  if (state.key === key && state.pieces && state.pieces.length) return state.pieces;

  // Resolve every slot BEFORE touching the scene, so a partially-resolved set
  // never leaves the character half-dressed.
  const wanted = [];               // { full, tex, replaces }
  const hidden = new Set();
  for (const slotKey of ['chest', 'legs', 'gloves', 'feet']) {
    const info = armorInfo(pd[slotKey], modelId);
    if (!info) continue;
    for (const s of info.replaces) hidden.add(s);
    // meshes and textures are parallel lists in armorgrp: 8,767 slots carry
    // 1 of each, 864 carry 2 of each, 14 carry 4 of each. Never crossed.
    info.meshes.forEach((m, i) => {
      wanted.push({ full: m, tex: info.textures[i] || null });
      const s = suffixOf(m);
      if (s) hidden.add(s);
    });
  }

  const loaded = await Promise.all(wanted.map(async (w) => {
    const [src, tex] = await Promise.all([
      loadArmorMesh(w.full),
      w.tex ? loadArmorTexture(w.tex) : Promise.resolve(null),
    ]);
    return { ...w, src, tex };
  }));
  if (state.gen !== gen) return null;          // superseded

  // The skeleton to bind onto: the character's own, live and animated.
  const parts = bodyParts(root);
  let host = null;
  for (const [, o] of parts) { if (o.skeleton) { host = o; break; } }
  if (!host) {
    console.warn('[armor] character has no skinned body mesh to bind against');
    return null;
  }

  detachArmor(state);
  state.key = key;

  // Restore every base part first, then hide the ones the set covers. Doing it
  // in this order means a swap from full plate to a chest-only set puts the
  // legs back rather than leaving a hole.
  for (const [s, o] of parts) o.visible = !hidden.has(s);

  const pieces = [];
  for (const w of loaded) {
    if (!w.src) continue;
    // Same lighting model and the same constants the BODY uses, read off the
    // built character glTFs rather than picked: every body material is
    // metallicFactor 0, roughnessFactor 0.9, doubleSided true. An armor piece
    // lit differently from the shoulder it sits against reads as a bug even
    // when the geometry is right. No colour is invented: without a resolved
    // diffuse the piece stays untinted white.
    const mat = new THREE.MeshStandardMaterial({
      map: w.tex ? w.tex.map : null,
      metalness: 0,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    if (w.tex && w.tex.entry) {
      // alphaMode comes from the MATERIAL's own property stream (a FinalBlend
      // declaring AlphaTest), never from inspecting the bitmap's alpha
      // channel: many armor diffuses carry an almost-empty alpha that is a
      // specularity level, and reading it as coverage erases the piece.
      if (w.tex.entry.alphaMode === 'MASK') {
        mat.alphaTest = w.tex.entry.alphaCutoff != null ? w.tex.entry.alphaCutoff : 0.5;
      } else if (w.tex.entry.alphaMode === 'BLEND') {
        mat.transparent = true;
      }
      // `doubleSided` is decoded and carried in the manifest, but it is NOT
      // used to switch a piece to FrontSide: the character glTFs the armor
      // sits against are doubleSided for every body material, so a
      // single-sided sleeve next to a double-sided torso would show holes
      // where the body does not. Nothing here downgrades below the body.
    }
    const mesh = new THREE.SkinnedMesh(w.src.geometry, mat);
    mesh.name = `armor_${w.full}`;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    // Sibling of the body mesh, so it inherits exactly the same parent
    // transform chain, then bound to the body's own skeleton with the body's
    // own bind matrix. Joint order is identical by construction (both come
    // from assemble.py's canonical skeleton over the same .ukx), which
    // build_armor.py --check asserts.
    host.parent.add(mesh);
    mesh.bind(host.skeleton, host.bindMatrix);
    pieces.push(mesh);
  }
  state.pieces = pieces;
  state.hidden = hidden;
  return pieces;
}

// Remove the armor pieces and unhide every base part.
export function detachArmor(state, root = null) {
  if (!state) return;
  for (const p of state.pieces || []) {
    if (p.parent) p.parent.remove(p);
    // The geometry is shared with the cached template (many characters wear
    // the same breastplate), so it must NOT be disposed here. The material is
    // per-piece and is ours to drop.
    if (p.material) p.material.dispose();
  }
  state.pieces = [];
  if (root) for (const [, o] of bodyParts(root)) o.visible = true;
  state.key = null;
  state.hidden = null;
}
