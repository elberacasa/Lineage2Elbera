// M2 entity system: remote players (glTF models from the character
// manifest) and NPCs (M3: real monster glTFs when the pipeline delivers
// them, color-coded capsule placeholders otherwise), both with overhead
// name labels and walk-to-target interpolation driven by server `move`
// ops. M3 adds combat visuals: attack/die/revive animation states.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Character } from './character.js';
import { l2ToThree, l2HeadingToThreeYaw, L2_TO_M } from './coords.js';
import { makeLabel } from './labels.js';

const FALLBACK_MODEL = 'human_fighter_m';
const NPC_SPEED = 1.6;          // m/s, matches Character.WALK_SPEED
const PLAYER_LABEL = '#c9a959'; // HUD gold
const NPC_LABEL = '#9ce8a9';    // npcname nickcolor green
const MONSTER_HEIGHT = 1.2;     // m — npcgrp carries no scale; plausible default

// label text scale relative to a 1.85 m human, clamped for readability
const labelScale = H => Math.min(1, Math.max(0.25, (H || 1.85) / 1.85));

// monster manifest + npcId->mesh map, fetched lazily once
let _monsterManifest = null;    // Promise<array|null>
let _npcMeshes = null;          // Promise<map>

function monsterManifest() {
  if (!_monsterManifest) {
    _monsterManifest = fetch('/characters/monsters/manifest.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && j.models) || null)
      .catch(() => null);
  }
  return _monsterManifest;
}

function npcMeshes() {
  if (!_npcMeshes) {
    _npcMeshes = fetch('/gamedata/npcgrp.json')
      .then(r => r.json())
      .catch(() => ({}));
  }
  return _npcMeshes;
}

// map animation clip names to combat states by keyword (names vary per
// monster); idle falls back to the first clip
function mapAnimations(actions) {
  const find = (...words) => {
    const name = Object.keys(actions).find(n =>
      words.some(w => n.toLowerCase().includes(w)));
    return name ? actions[name] : null;
  };
  const first = actions[Object.keys(actions)[0]] || null;
  return {
    idle: find('idle', 'wait', 'stand') || first,
    walk: find('walk') || first,
    run: find('run') || find('walk') || first,
    attack: find('attack', 'atk', 'hit') || first,
    special: find('special') || find('attack') || first,
    die: find('die', 'death', 'dead') || first,
  };
}

// aCis/L2 classId ranges that are mystic archetypes (fighters otherwise)
const MYSTIC_RANGES = [[10, 17], [25, 30], [38, 43], [49, 52]];
const RACE_BY_ID = { 0: 'Human', 1: 'Elf', 2: 'DarkElf', 3: 'Orc', 4: 'Dwarf' };
const RACE_BY_NAME = {
  human: 'Human', elf: 'Elf', darkelf: 'DarkElf', orc: 'Orc', dwarf: 'Dwarf',
};

export function pickModelId(manifest, race, classId) {
  const raceName = typeof race === 'number'
    ? RACE_BY_ID[race]
    : RACE_BY_NAME[String(race ?? '').replace(/[\s-]/g, '').toLowerCase()];
  if (raceName) {
    const cands = manifest.filter(m => m.race === raceName);
    if (cands.length) {
      const mystic = classId != null
        && MYSTIC_RANGES.some(([a, b]) => classId >= a && classId <= b);
      const want = mystic ? /mystic/i : /fighter/i;
      const pick = cands.find(m => want.test(m.className) && m.gender === 'male')
        || cands.find(m => want.test(m.className))
        || cands.find(m => m.gender === 'male')
        || cands[0];
      return pick.id;
    }
  }
  return manifest.some(m => m.id === FALLBACK_MODEL)
    ? FALLBACK_MODEL
    : (manifest[0] && manifest[0].id);
}

// deterministic capsule color per npcId (color-coded placeholders)
function npcColor(npcId) {
  const hue = ((npcId || 0) * 47) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.55, 0.5);
}

class NpcEntity {
  constructor({ id, npcId, name, level }) {
    this.id = id;
    this.kind = 'npc';
    this.npcId = npcId;
    this.level = level ?? null;   // addNpc.level from the datapack template
    this.name = name;
    this.target = null;
    this.dead = false;
    this.mixer = null;
    this.actions = null;          // {idle,walk,run,attack,die} after model upgrade
    this.current = null;
    this.capsuleMeshes = [];
    this.heightM = 0.46;          // capsule = human-sized placeholder
    this.group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.1, 0.26, 4, 12),
      new THREE.MeshLambertMaterial({ color: npcColor(npcId) }),
    );
    body.position.y = 0.23;       // capsule center at half height
    body.castShadow = true;
    this.group.add(body);
    this.capsuleMeshes.push(body);
    // small dark base ring so the placeholder reads as grounded
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.14, 24),
      new THREE.MeshBasicMaterial({ color: 0x10131a, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.group.add(ring);
    this.capsuleMeshes.push(ring);
  }

  setLabel(text) {
    if (this.label) this.group.remove(this.label);
    this.name = text;
    this.label = makeLabel(text, NPC_LABEL, labelScale(this.heightM));
    this.label.position.y = this.heightM * 1.25;
    this.group.add(this.label);
  }

  // swap the capsule placeholder for a real monster model
  async upgradeToMonster() {
    const [manifest, meshes] = await Promise.all([monsterManifest(), npcMeshes()]);
    if (!manifest) return;                     // pipeline hasn't landed: keep capsule
    const grp = meshes[String(this.npcId)] || {};
    this.npcType = grp.type || null;   // server NPC type (Monster/Folk/...)
    const meshName = grp.mesh;
    const entry = manifest.find(m => m.id === meshName)
      || manifest.find(m => m.id.toLowerCase() === String(meshName).toLowerCase());
    if (!entry) return;                        // no model for this npcId: keep capsule
    try {
      const gltf = await new GLTFLoader()
        .loadAsync(`/characters/monsters/${entry.gltf}`);
      const root = gltf.scene;
      // nativeHeight (L2 units) is authoritative when the manifest carries
      // it; otherwise normalize to a plausible monster height (npcgrp has
      // no scale info)
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 0.001) {
        if (entry.nativeHeight && grp.height) {
          // docs/npc-visual-data.md §4: server height is a HALF-height (aCis
          // GeoEngine doubles it for full height), so per npcId:
          // renderScale = (2 x npcgrp height) / mesh.nativeHeight — 32% of
          // meshes are reused at different sizes, per npcId, not per mesh.
          root.scale.setScalar((2 * grp.height * L2_TO_M) / size.y);
        } else if (entry.nativeHeight) {
          root.scale.setScalar((entry.nativeHeight * L2_TO_M) / size.y);
        } else {
          const k = MONSTER_HEIGHT / size.y;
          if (k < 0.3 || k > 4) root.scale.setScalar(k);
        }
      }
      const box2 = new THREE.Box3().setFromObject(root);
      const center = box2.getCenter(new THREE.Vector3());
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box2.min.y;
      this.heightM = box2.getSize(new THREE.Vector3()).y;
      if (this.label) this.setLabel(this.name);   // re-anchor to true height
      root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

      // invisible pick proxy: skinned meshes raycast against bind pose,
      // so clicks target a plain cylinder around the model instead
      const proxy = new THREE.Mesh(
        new THREE.CylinderGeometry(
          Math.max(0.12, this.heightM * 0.3), Math.max(0.14, this.heightM * 0.35),
          this.heightM, 8),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      proxy.position.y = this.heightM / 2;
      proxy.name = 'pick-proxy';
      this.group.add(proxy);

      for (const m of this.capsuleMeshes) this.group.remove(m);
      this.capsuleMeshes = [];
      this.group.add(root);
      this.mixer = new THREE.AnimationMixer(root);
      const raw = {};
      for (const clip of gltf.animations) raw[clip.name] = this.mixer.clipAction(clip);
      this.actions = mapAnimations(raw);
      this._play(this.dead ? 'die' : 'idle', 0);
      if (this.dead) this._finishDeath();      // died while loading
    } catch (e) {
      console.warn(`monster model for npcId ${this.npcId} failed:`, e.message);
    }
  }

  _play(state, fade = 0.2, once = false) {
    const next = this.actions && this.actions[state];
    if (!next || next === this.current) return;
    next.reset();
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  attackFlash() {
    if (!this.actions || this.dead) return;
    this._play('attack', 0.1, true);
    // back to idle after the swing
    const dur = this.actions.attack.getClip().duration;
    clearTimeout(this._attackTimer);
    this._attackTimer = setTimeout(() => {
      if (!this.dead) this._play(this.target ? 'walk' : 'idle');
    }, Math.max(300, dur * 1000 - 100));
  }

  // M4: skill cast visual — monsters prefer their 'special' clip
  skillFlash() {
    if (!this.actions || this.dead) return;
    this._play('special', 0.1, true);
    const dur = this.actions.special.getClip().duration;
    clearTimeout(this._attackTimer);
    this._attackTimer = setTimeout(() => {
      if (!this.dead) this._play(this.target ? 'walk' : 'idle');
    }, Math.max(300, dur * 1000 - 100));
  }

  die() {
    this.dead = true;
    this.target = null;
    if (this.actions) this._play('die', 0.15, true);
    clearTimeout(this._attackTimer);
    this._fadeTimer = setTimeout(() => this._finishDeath(), 2500);
  }

  _finishDeath() {
    // fade the corpse out
    this.group.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.transparent = true; m.opacity = 0.25; }
      }
    });
    if (this.label) this.label.visible = false;
  }

  revive() {
    this.dead = false;
    clearTimeout(this._fadeTimer);
    this.group.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.opacity = 1; }
      }
    });
    if (this.label) this.label.visible = true;
    if (this.actions) this._play('idle', 0);
  }

  update(dt, terrain) {
    if (this.mixer) this.mixer.update(dt);
    if (!this.target || this.dead) return;
    const pos = this.group.position;
    const dx = this.target.x - pos.x, dz = this.target.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) { this.target = null; if (this.actions) this._play('idle'); return; }
    if (this.actions && this.current !== this.actions.attack) this._play('walk');
    const step = Math.min(NPC_SPEED * dt, d);
    pos.x += dx / d * step;
    pos.z += dz / d * step;
    pos.y = terrain.heightAtWorld(pos.x, pos.z, pos.y);
    this.group.rotation.y = Math.atan2(dx, dz);
  }
}

export class EntityManager {
  constructor(scene, manifest) {
    this.scene = scene;
    this.manifest = manifest;
    this.entities = new Map();    // id -> Character (players) | NpcEntity
    this.pending = new Set();     // ids with an async spawn in flight
  }

  has(id) { return this.entities.has(id) || this.pending.has(id); }

  // Ground rule: with per-tile geodata present, the height is the layer
  // NEAREST to the server z (bridges: an entity on a bridge stays on the
  // bridge; on the road below, on the road). Legacy rule without geodata:
  // outdoors the converted terrain height is right; indoors the walkable
  // floor is a PROP above the bare-ground heightmap, and the server z
  // (real geodata) is the floor — take the max.
  _groundY(x, z, serverZm, terrain) {
    if (terrain && terrain.geodata && serverZm != null) {
      return terrain.heightAtWorld(x, z, serverZm);
    }
    const t = terrain ? terrain.heightAtWorld(x, z, serverZm ?? null) : -Infinity;
    return Math.max(t, serverZm ?? -Infinity);
  }

  async addPlayer(msg, terrain) {
    const id = msg.id;
    if (this.has(id)) return;
    this.pending.add(id);
    try {
      const modelId = pickModelId(this.manifest, msg.race, msg.classId);
      const entry = this.manifest.find(m => m.id === modelId) || this.manifest[0];
      const ch = new Character();
      await ch.load(`/characters/${entry.gltf}`, entry.nativeHeight || null);
      if (this.entities.has(id)) return;   // raced with a duplicate add
      ch.id = id;
      ch.kind = 'player';
      ch.level = msg.level ?? null;   // addPlayer.level: null in-protocol (aCis 409)
      ch.name = msg.name || `player#${id}`;
      l2ToThree(msg.x || 0, msg.y || 0, msg.z || 0, ch.group.position);
      ch.serverZ = (msg.z || 0) * L2_TO_M;
      ch.group.position.y = this._groundY(
        ch.group.position.x, ch.group.position.z, ch.serverZ, terrain);
      ch.group.rotation.y = l2HeadingToThreeYaw(msg.heading);
      ch.group.userData.entityId = id;
      const label = makeLabel(ch.name, PLAYER_LABEL, labelScale(ch.heightM));
      label.position.y = (ch.heightM || 1.75) * 1.2;
      ch.group.add(label);
      ch.heightM = ch.heightM || 1.75;
      this.entities.set(id, ch);
      this.scene.add(ch.group);
    } catch (e) {
      console.error(`addPlayer ${id} (${msg.name}):`, e);
    } finally {
      this.pending.delete(id);
    }
  }

  addNpc(msg, terrain) {
    const id = msg.id;
    if (this.has(id)) return;
    const npc = new NpcEntity(msg);
    // type (Monster/Folk) resolves with the async npcgrp fetch
    npcMeshes().then(map => {
      const grp = map[String(npc.npcId)];
      if (grp) npc.npcType = grp.type || null;
    });
    l2ToThree(msg.x || 0, msg.y || 0, msg.z || 0, npc.group.position);
    npc.serverZ = (msg.z || 0) * L2_TO_M;
    npc.group.position.y = this._groundY(
      npc.group.position.x, npc.group.position.z, npc.serverZ, terrain);
    npc.group.rotation.y = l2HeadingToThreeYaw(msg.heading);
    npc.group.userData.entityId = id;
    npc.setLabel(msg.name || `npc ${msg.npcId}`);
    this.entities.set(id, npc);
    this.scene.add(npc.group);
    npc.upgradeToMonster();      // M3: async swap capsule -> real model
  }

  setNpcName(id, name) {
    const e = this.entities.get(id);
    if (e && e.kind === 'npc' && name && name !== e.name) e.setLabel(name);
  }

  // M3 combat visuals -------------------------------------------------

  attackFlash(id) {
    const e = this.entities.get(id);
    if (e && !e.dead) {
      if (e.kind === 'npc') e.attackFlash();
      else { e.play('attack', 0.1); setTimeout(() => !e.dead && e.play('idle'), 700); }
    }
  }

  skillFlash(id) {
    const e = this.entities.get(id);
    if (e && !e.dead) {
      if (e.kind === 'npc') e.skillFlash();
      else { e.play('attack', 0.1); setTimeout(() => !e.dead && e.play('idle'), 700); }
    }
  }

  die(id) {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.kind === 'npc') { e.die(); return; }
    // remote player: no die clip in the character manifest — freeze + fade
    e.dead = true;
    e.clearTarget();
    e.play('idle');
    e.group.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.transparent = true; m.opacity = 0.25; }
      }
    });
  }

  revive(id) {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.kind === 'npc') { e.revive(); return; }
    e.dead = false;
    e.group.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.opacity = 1; }
      }
    });
    e.play('idle');
  }

  getEntity(id) { return this.entities.get(id); }

  move(msg) {
    const e = this.entities.get(msg.id);
    if (!e) return;
    const target = l2ToThree(msg.tx || 0, msg.ty || 0, msg.tz || 0);
    e.serverZ = (msg.tz || 0) * L2_TO_M;
    if (e.kind === 'player') e.setTarget(target);
    else e.target = target;
  }

  remove(id) {
    const e = this.entities.get(id);
    if (!e) return;
    this.scene.remove(e.group);
    this.entities.delete(id);
  }

  clear() {
    for (const id of [...this.entities.keys()]) this.remove(id);
  }

  update(dt, terrain) {
    for (const e of this.entities.values()) {
      e.update(dt, terrain);
      // keep entities grounded even when idle (spawn may race a scene
      // swap); indoors the server z (geodata floor) wins over the
      // bare-ground heightmap — see _groundY
      if (terrain && !e.target) {
        e.group.position.y = this._groundY(
          e.group.position.x, e.group.position.z, e.serverZ, terrain);
      }
    }
  }

  // verification snapshot
  snapshot() {
    const out = [];
    for (const [id, e] of this.entities) {
      out.push({
        id, kind: e.kind, name: e.name, level: e.level ?? null,
        npcId: e.npcId,
        hasModel: !!e.mixer,
        heightM: e.heightM ? +e.heightM.toFixed(3) : null,
        pos: e.group.position.toArray().map(v => +v.toFixed(2)),
        moving: e.kind === 'player' ? !!e.target : !!e.target,
      });
    }
    return out;
  }
}
