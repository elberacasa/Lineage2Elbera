// Ground drops — the item's OWN mesh, where the client ships one.
//
// THE CLAIM THAT WAS WRONG
// ------------------------
// entities.js used to say, at the DropEntity that draws an octahedron:
// "Neither npcgrp nor etcitemgrp carries a ground-drop mesh, so the marker is
// authored." All three item tables carry a full drop description, and they
// have been decoded in assets/gamedata since the .dat extraction landed:
//
//   drop_mesh  drop_texture  drop_radius  drop_height  drop_type
//   drop_anim_type  drop_sound
//
// Adena says `DropItems.coin_m00` + `DropItemsTex.coin_t00`. A sword says its
// own `LineageWeapons.<mesh>`. `tools/dat/export_dropmesh.py` joins the three
// tables into assets/gamedata/dropmesh.json; this module is its read side.
//
// WHAT THIS SHIPS TODAY
// ---------------------
// 441 item ids drop as a real mesh, with no new pipeline: weapons and shields
// drop as THEMSELVES, and 180 of those meshes were already built to glTF by
// tools/src/char_pipeline/build_weapons.py for the equip path. Nothing new was
// extracted — the geometry was on disk and the join was missing.
//
// WHAT STILL FALLS BACK, AND WHY  (documented, never silent)
// -----------------------------------------------------------
// 7,955 item ids — including Adena — drop a `DropItems.*` prop.
// animations/DropItems.ukx ships 415 SkeletalMesh objects and
// systextures/DropItemsTex.utx is ALREADY extracted (240 PNGs in
// assets/library/DropItemsTex/), but the meshes are not built, because 371 of
// the 373 referenced ones carry a non-identity ULodMesh instance transform
// (coin_m00 = MeshScale 3, MeshOrigin z 0.7, RotOrigin yaw 49152) and the
// static emitter refuses a mesh whose transform it would have to drop. That is
// a build job with its own decode
// (tools/src/UEViewer/MeshInstance/SkelMeshInstance.cpp:192-198), not a guess.
// Until it lands, those drops keep the placeholder AND record why on the
// entity: `entity.dropMeshGap`. Nothing is silent.
//
// A further 828 ids name a LineageWeapons mesh that is outside the newbie
// roster build_weapons.py ships; those record the same way.
//
// WHY THIS MODULE DRIVES ITSELF
// -----------------------------
// The swap belongs where the DropEntity is built, in entities.js. This wave
// does not own that file, so the layer watches the entity manager instead of
// being called by it: one pass per animation frame, and an entity is touched
// exactly once. Move the two calls into DropEntity and the watcher can go.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L2_TO_M } from './coords.js';

const TABLE = '/gamedata/dropmesh.json';
const WEAPONS = '/characters/weapons/manifest.json';
const WEAPON_PKG = 'lineageweapons';

let _table = null;          // Promise<doc|null>
let _weapons = null;        // Promise<Set<string>|null>
let _running = false;
const _loader = new GLTFLoader();
const _cache = new Map();   // mesh id -> Promise<THREE.Object3D>

function table() {
  if (!_table) {
    _table = fetch(TABLE).then(r => (r.ok ? r.json() : null)).catch(() => null);
  }
  return _table;
}

function weapons() {
  if (!_weapons) {
    _weapons = fetch(WEAPONS)
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && j.models ? new Map(j.models.map(m => [m.id.toLowerCase(), m]))
        : null))
      .catch(() => null);
  }
  return _weapons;
}

/** The client's own record for an item id, package split out. */
export function dropRecord(doc, itemId) {
  const e = doc && doc.items && doc.items[String(itemId)];
  if (!e || !e.m || !e.m.length) return null;
  // `m` is a list because a dual-wield weapon names one mesh per hand (210
  // records, 97 of them two DIFFERENT blades). What retail draws for a dropped
  // dual sword is NOT decodable — drop_anim_type's enum is inside the packed
  // Engine.dll — so the first is drawn and `meshes` keeps the rest visible
  // rather than discarding them here.
  const all = e.m.map(i => doc.meshes[i]);
  const full = all[0];
  const dot = full.indexOf('.');
  return {
    pkg: full.slice(0, dot), obj: full.slice(dot + 1), meshes: all,
    textures: (e.t || []).map(i => doc.textures[i]),
    radius: e.r, height: e.h, dropType: e.dt, animType: e.at,
    sound: e.s != null ? doc.sounds[e.s] : null,
  };
}

async function model(entry) {
  if (!_cache.has(entry.id)) {
    _cache.set(entry.id, _loader
      .loadAsync(`/characters/weapons/${entry.gltf}`)
      .then(g => g.scene)
      .catch(() => null));
  }
  const scene = await _cache.get(entry.id);
  return scene ? scene.clone(true) : null;
}

/** Swap one drop's placeholder for its own mesh, or record why it cannot. */
async function upgrade(entity) {
  entity._dropMeshTried = true;
  const doc = await table();
  const rec = dropRecord(doc, entity.itemId);
  if (!rec) {
    entity.dropMeshGap = `item ${entity.itemId}: no drop_mesh in weapongrp/`
      + 'armorgrp/etcitemgrp';
    return;
  }
  if (rec.pkg !== WEAPON_PKG) {
    entity.dropMeshGap = `${rec.pkg}.${rec.obj}: animations/DropItems.ukx is `
      + 'not built (non-identity ULodMesh transform — see this module\'s header)';
    return;
  }
  const roster = await weapons();
  const entry = roster && roster.get(rec.obj.toLowerCase());
  if (!entry) {
    entity.dropMeshGap = `${rec.pkg}.${rec.obj}: outside the weapon roster `
      + 'build_weapons.py ships';
    return;
  }
  const scene = await model(entry);
  if (!scene || !entity.group) {
    entity.dropMeshGap = `${rec.pkg}.${rec.obj}: glTF failed to load`;
    return;
  }
  // drop_height is the record's own resting height, in L2 world units — the
  // same units every coordinate in this port uses, converted by the one
  // constant in coords.js. Nothing here is chosen: radius/height/mesh all
  // come out of the item's row.
  const holder = new THREE.Group();
  holder.name = 'drop-mesh';
  holder.position.y = (rec.height || 0) * L2_TO_M;
  holder.add(scene);
  scene.traverse(o => { if (o.isMesh) o.castShadow = true; });
  entity.group.add(holder);
  entity.dropMesh = holder;
  entity.dropMeshGap = null;
  // The placeholder goes away only once the real mesh is in the graph, so a
  // slow fetch never leaves an empty patch of ground.
  if (entity._gem) entity._gem.visible = false;
}

function pass() {
  const w = typeof window !== 'undefined' && window.__world;
  const mgr = w && w.entities;
  if (!mgr || !mgr.entities) return;
  for (const e of mgr.entities.values()) {
    if (e.kind === 'drop' && !e._dropMeshTried) upgrade(e);
  }
}

function loop() {
  if (!_running) return;
  try { pass(); } catch (err) { /* one bad frame must not stop the layer */ }
  requestAnimationFrame(loop);
}

export const Drops = {
  start() {
    if (_running || typeof requestAnimationFrame !== 'function') return;
    _running = true;
    requestAnimationFrame(loop);
  },
  /** Run one pass now — tests should not race the frame loop. */
  tick() { pass(); },
  /** Every drop the world holds, with the mesh it got or the reason it did
   *  not. This is the surface verify_dropmesh.js reads. */
  report() {
    const w = typeof window !== 'undefined' && window.__world;
    const mgr = w && w.entities;
    const out = [];
    if (mgr && mgr.entities) {
      for (const [id, e] of mgr.entities) {
        if (e.kind !== 'drop') continue;
        out.push({
          id, itemId: e.itemId, name: e.name,
          mesh: !!e.dropMesh, gap: e.dropMeshGap || null,
          placeholderVisible: !!(e._gem && e._gem.visible),
        });
      }
    }
    return out;
  },
  dropRecord,
  table,
};

if (typeof window !== 'undefined') window.__drops = Drops;
Drops.start();
