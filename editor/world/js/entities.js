// M2 entity system: remote players (glTF models from the character
// manifest) and NPCs (M3: real monster glTFs when the pipeline delivers
// them, color-coded capsule placeholders otherwise), both with overhead
// name labels and walk-to-target interpolation driven by server `move`
// ops. M3 adds combat visuals: attack/die/revive animation states.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Character, MOVE_TICK_S } from './character.js';
import { l2ToThree, l2HeadingToThreeYaw, L2_TO_M } from './coords.js';
import { makeLabel } from './labels.js';
import { skillAnimMeta, skillAnimInfo } from './gamedata.js';
import { clipForSkill, lastSkillMsg } from './skillfx_anim.js';
import { activeSkillFx } from './skills.js';

const _headPos = new THREE.Vector3();

// the skillCast/skillLaunch message currently being handled (NetClient logs
// before emitting, so it is the tail of the net ring during the handler)
function skillMsgFor(casterId) {
  const w = typeof window !== 'undefined' && window.__world;
  return w ? lastSkillMsg(w.net.log, { casterId }) : null;
}

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

// sex: optional L2 sex (0 male / 1 female, or 'male'/'female'). When given,
// the matching gender is preferred; when absent or no gender match exists,
// the legacy male-preference order applies so nothing regresses.
export function pickModelId(manifest, race, classId, sex) {
  const gender = sex === 0 || sex === 1 ? (sex === 1 ? 'female' : 'male')
    : (sex === 'female' ? 'female' : (sex === 'male' ? 'male' : null));
  const raceName = typeof race === 'number'
    ? RACE_BY_ID[race]
    : RACE_BY_NAME[String(race ?? '').replace(/[\s-]/g, '').toLowerCase()];
  if (raceName) {
    const cands = manifest.filter(m => m.race === raceName);
    if (cands.length) {
      const mystic = classId != null
        && MYSTIC_RANGES.some(([a, b]) => classId >= a && classId <= b);
      const want = mystic ? /mystic/i : /fighter/i;
      const pick = (gender && cands.find(m => want.test(m.className) && m.gender === gender))
        || cands.find(m => want.test(m.className) && m.gender === 'male')
        || cands.find(m => want.test(m.className))
        || (gender && cands.find(m => m.gender === gender))
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

// Rebuilt player models carry a 'die' clip: play it once and HOLD the last
// frame (Character.update re-idles after emoteUntil, so pin it). Returns
// false when the clip is absent (pre-rebuild models) so the caller keeps
// its legacy freeze.
function playDeathClip(ch) {
  const a = ch.actions && ch.actions.die;
  if (!a) return false;
  ch.play('die', 0.15);
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  ch.emoteUntil = Infinity;
  return true;
}

const DROP_LABEL = '#d9c68f';   // item parchment (authored)

// Ground drop (bridge addDrop = aCis SpawnItem/DropItem): a nameplate plus
// a small grounded marker. Neither npcgrp nor etcitemgrp carries a
// ground-drop mesh, so the marker is authored. Clicking routes through
// main.js clickEntity -> target{id}, which the server turns into pickup;
// despawn rides the shared 'remove' op.
class DropEntity {
  constructor({ id, itemId, count, name }) {
    this.id = id;
    this.kind = 'drop';
    this.itemId = itemId;
    this.count = count ?? 1;
    this.name = this.count > 1 ? `${name} (${this.count})` : name;
    this.level = null;
    this.npcId = null;
    this.dead = false;
    this.target = null;
    this.heightM = 0.3;
    this.group = new THREE.Group();
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshLambertMaterial({ color: 0xd8c48a, emissive: 0x2a2210 }),
    );
    gem.position.y = 0.12;
    gem.castShadow = true;
    this.group.add(gem);
    this._gem = gem;
    const label = makeLabel(this.name, DROP_LABEL, 0.55);
    label.position.y = 0.42;
    this.group.add(label);
  }

  update(dt) { this._gem.rotation.y += dt * 1.6; }   // slow spin (authored)
}

class NpcEntity {
  constructor({ id, npcId, name, level, runSpeed, walkSpeed, speedMul, running,
                pAtkSpd, atkSpdMul }) {
    this.id = id;
    this.kind = 'npc';
    this.npcId = npcId;
    this.level = level ?? null;   // addNpc.level from the datapack template
    this.name = name;
    // Attack cadence from NpcInfo (see character.js). A Gremlin's pAtkSpd is
    // 272 -> a 1,838 ms cycle and a 1.209 swing rate; a Guard's is 243 ->
    // 2,057 ms. One constant cannot express that, and the old code used the
    // clip's own length for every creature in the game.
    this.pAtkSpd = pAtkSpd > 0 ? pAtkSpd : 0;
    this.atkSpdMul = atkSpdMul > 0 ? atkSpdMul : 1;
    // NpcInfo speeds in L2 units/s -> m/s; absent for entities that predate the
    // gateway forwarding them, and Entity.update falls back in that case.
    // AbstractNpcInfo writes the BASE speeds (getBaseRunSpeed/getBaseWalkSpeed)
    // and getMovementSpeedMultiplier() as separate fields, exactly like
    // UserInfo — and every Creature carries FuncMoveSpeed, so a mob's
    // multiplier is its own DEX_BONUS and is not 1 either. What the server
    // moves the mob at is the product (CreatureMove.updatePosition covers
    // getMoveSpeed()/10 per 100 ms tick, and getMoveSpeed() =
    // calcStat(RUN_SPEED, base)).
    this.speedMul = speedMul > 0 ? speedMul : 1;
    this.runSpeed = runSpeed > 0 ? runSpeed * this.speedMul * L2_TO_M : 0;
    this.walkSpeed = walkSpeed > 0 ? walkSpeed * this.speedMul * L2_TO_M : 0;
    if (running != null) this.running = !!running;
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

  // `color` is retail's own nickcolor for this NPC (RRGGBBAA). It is not
  // decoration: the 537 NPCs carrying 3F8BFEFF are the Raid Bosses and their
  // escorts, so painting every nameplate the same green made a raid boss look
  // like a gremlin. NPC_LABEL remains the fallback and is the same green the
  // table's own default spells.
  setLabel(text, color = null) {
    if (this.label) this.group.remove(this.label);
    this.name = text;
    if (color) this.labelColor = color;
    this.label = makeLabel(text, this.labelColor || NPC_LABEL, labelScale(this.heightM));
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
      // The social clip is bound OUTSIDE mapAnimations on purpose: that
      // function's six keyword lists are replayed byte-for-byte by
      // tools/anim/audit_bindings.py and asserted as source text by
      // verify_anim.js, so extending it would invalidate the audit rather
      // than the audit catching a real change. There is no keyword search to
      // do here anyway — the pipeline emits the clip under the exact name
      // 'social' when clips.social exists, and nothing when it does not.
      this.actions.social = raw.social || null;
      this._play(this.dead ? 'die' : 'idle', 0);
      if (this.dead) this._finishDeath();      // died while loading
    } catch (e) {
      console.warn(`monster model for npcId ${this.npcId} failed:`, e.message);
    }
  }

  _play(state, fade = 0.2, once = false, rate = 1) {
    const next = this.actions && this.actions[state];
    if (!next) return;
    if (next === this.current) {
      // A repeated one-shot (swing after swing) must restart in phase; a
      // repeated loop must not be reset every frame.
      if (!once) return;
      next.reset().play();
      next.setEffectiveTimeScale(rate);
      return;
    }
    next.reset();
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.setEffectiveWeight(1).fadeIn(fade).play();
    next.setEffectiveTimeScale(rate);
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  // One swing, played at the rate the server computed for this creature
  // (NpcInfo attackSpeedMultiplier — see character.js) and held for exactly as
  // long as it then lasts. The old code played every monster's clip at its
  // authored speed and returned to idle after `max(300, duration - 100)` ms,
  // two numbers with no source at all.
  attackFlash() {
    if (!this.actions || this.dead) return;
    this._playTimed('attack', this.atkSpdMul);
  }

  // M4: skill cast visual — monsters prefer their 'special' clip
  skillFlash() {
    if (!this.actions || this.dead) return;
    this._playTimed('special', this.atkSpdMul);
  }

  // SocialAction on a monster. The clip is the mesh's own NpcSocialAnimName
  // (editor/characters/monsters/manifest.json clips.social — retail-sourced
  // for 381 of the 495, a name candidate for 20, absent for 94), carried in
  // the glTF as the clip literally named 'social' and bound in
  // upgradeToMonster().
  // Where the mesh ships no social clip at all there is nothing retail would
  // have played either, so this plays nothing rather than borrowing another
  // slot; returns the state it played for verification.
  socialFlash() {
    if (!this.actions || this.dead) return null;
    if (!this.actions.social) return null;
    this._playTimed('social', 1);
    return 'social';
  }

  _playTimed(state, rate) {
    const action = this.actions[state];
    if (!action) return;
    const r = rate > 0 && isFinite(rate) ? rate : 1;
    this._play(state, 0.1, true, r);
    const ms = (action.getClip().duration / r) * 1000;
    this.lastFlash = { state, rate: r, ms };   // verification hook
    clearTimeout(this._attackTimer);
    this._attackTimer = setTimeout(() => {
      if (!this.dead) this._play(this.target ? 'walk' : 'idle');
    }, ms);
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
    // per-creature speed from NpcInfo; NPC_SPEED only covers entities that
    // arrived before the gateway forwarded speeds (other players, old mocks)
    const speed = this.running
      ? (this.runSpeed || NPC_SPEED)
      : (this.walkSpeed || NPC_SPEED);
    // Arrival is the server's rule, not a fixed epsilon: one CreatureMove tick
    // of travel (see character.js MOVE_TICK_S), then snap to the destination.
    if (d <= speed * MOVE_TICK_S) {
      pos.x = this.target.x; pos.z = this.target.z;
      pos.y = terrain.heightAtWorld(pos.x, pos.z, pos.y);
      this.target = null;
      if (this.actions) this._play('idle');
      return;
    }
    // ChangeMoveType override: run vs walk (mapAnimations falls back to
    // walk/first clip when a monster has no run clip)
    if (this.actions && this.current !== this.actions.attack) {
      this._play(this.running ? 'run' : 'walk');
    }
    const step = Math.min(speed * dt, d);
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
      // sex rides the new pickModelId signature but is undefined in the
      // addPlayer contract today (follow-up: extend addPlayer with sex) —
      // until then remote players keep the male preference
      const modelId = pickModelId(this.manifest, msg.race, msg.classId, msg.sex);
      const entry = this.manifest.find(m => m.id === modelId) || this.manifest[0];
      const ch = new Character();
      // Tell it what it is holding BEFORE the model loads: load() re-hangs the
      // remembered weapon once the sockets exist, so this avoids a second pass
      // and the frame or two of empty-handedness it would cause.
      if (msg.paperdoll && msg.paperdoll.rhand) ch.wantWeapon = msg.paperdoll.rhand;
      if (msg.paperdoll && msg.paperdoll.lhand) ch.wantOffhand = msg.paperdoll.lhand;
      // Armor rides the same CharInfo paperdoll (gloves/chest/legs/feet are
      // indices 4/5/6/7 of the 12-slot CharInfo layout, decoded by the gateway
      // since the inventory wave). Set BEFORE load for the same reason the
      // weapon is: load() re-applies it once the skeleton exists, so a remote
      // player never appears in their underwear for a frame.
      if (msg.paperdoll) ch.wantArmor = msg.paperdoll;
      await ch.load(`/characters/${entry.gltf}`, entry.nativeHeight || null);
      if (this.entities.has(id)) return;   // raced with a duplicate add
      ch.id = id;
      ch.kind = 'player';
      // CharInfo carries this player's attack cadence and walk/run stance;
      // same fields, same meaning, as the self charSheet (character.js).
      ch.setSpeeds(msg);
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
      this._applyDeferred(ch);
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

  setNpcName(id, name, color = null) {
    const e = this.entities.get(id);
    if (!e || e.kind !== 'npc' || !name) return;
    // repaint on a colour change too, not just a name change — the colour is
    // what distinguishes a raid boss and it can arrive after the name
    if (name !== e.name || (color && color !== e.labelColor)) e.setLabel(name, color);
  }

  // Ground drop spawn (see DropEntity). name comes from itemmeta via the
  // caller (async); removal rides the shared remove() path.
  addDrop(msg, name, terrain) {
    const id = msg.id;
    if (this.has(id)) return;
    const drop = new DropEntity({ ...msg, name });
    l2ToThree(msg.x || 0, msg.y || 0, msg.z || 0, drop.group.position);
    drop.serverZ = (msg.z || 0) * L2_TO_M;
    drop.group.position.y = this._groundY(
      drop.group.position.x, drop.group.position.z, drop.serverZ, terrain);
    drop.group.userData.entityId = id;
    this.entities.set(id, drop);
    this.scene.add(drop.group);
  }

  // M3 combat visuals -------------------------------------------------

  // A swing. The clip plays at the attacker's own server-computed rate
  // (Character.attackSwing / NpcEntity.attackFlash), not at whatever speed the
  // .psa happened to be authored at.
  attackFlash(id) {
    const e = this.entities.get(id);
    if (e && !e.dead) {
      // oneShot holds the swing against update()'s idle fallback (emoteUntil)
      if (e.kind === 'npc') e.attackFlash();
      else e.attackSwing();
      return;
    }
    // the local player is NOT in the EntityManager (main.js keeps it as a
    // separate Character) — own swings animate on that model too (same
    // self fallback as skillFlash below)
    const w = typeof window !== 'undefined' && window.__world;
    if (w && w.net.selfId === id && w.character && !w.character.dead) {
      w.character.attackSwing();
    }
  }

  skillFlash(id) {
    const msg = skillMsgFor(id);
    const e = this.entities.get(id);
    if (e && !e.dead) {
      if (e.kind === 'npc') { e.skillFlash(); return; }
      this._playerCastGesture(e, msg);
      return;
    }
    // the local player is NOT in the EntityManager (main.js keeps it as a
    // separate Character) — self casts gesture on that model too
    const w = typeof window !== 'undefined' && window.__world;
    if (w && w.net.selfId === id && w.character) {
      this._playerCastGesture(w.character, msg);
      // main.js's skillLaunch flash resolves the TARGET through the
      // EntityManager only, so SELF-target launches (Self Heal & co.)
      // produce no effect there — spawn it here instead
      if (msg && msg.op === 'skillLaunch' && msg.targetId === id) {
        const fx = activeSkillFx();
        if (fx) {
          _headPos.copy(w.character.group.position);
          _headPos.y += (w.character.heightM || 1.75) * 1.1;
          fx.flash(_headPos);
        }
      }
    }
  }

  // Per-skill cast gesture from skillanim.json (skillgrp animation code +
  // the skillCast hitTime -> glTF clip, js/skillfx_anim.js): dances play
  // 'dance' (exact), physical skills 'spAtk01/02', magic casts
  // 'castShort/Mid/Long' by duration. Pre-rebuild models lack those clips —
  // the documented 'attack' fallback keeps a gesture until they land.
  // Without skill context the legacy generic swing remains.
  // ... and the gesture lasts exactly hitTime, because hitTime IS the cast
  // duration the server told the client to display: CreatureCast.doCast
  // computes it as Formulas.calcAtkSpd(skillTime * 333 / mAtkSpd), sends it in
  // MagicSkillUse, and drives its own SetupGauge(BLUE, hitTime) with the same
  // number. Playing the clip at its authored length instead made every cast
  // gesture disagree with its own cast bar — a 1.5 s animation over a 400 ms
  // Wind Strike, or a stubby one over a slow chant.
  //
  // skillLaunch re-enters this path at hitTime-400 (CreatureCast.onMagicLaunch);
  // the second gesture is deliberately NOT restarted mid-swing.
  _playerCastGesture(ch, msg) {
    // No skill context at all: play nothing. This used to swing 'attack',
    // which is a weapon strike animation and never a cast.
    if (!msg) { this.lastCastClip = null; return; }
    if (msg.op === 'skillLaunch' && ch.emoteUntil > performance.now()) return;
    skillAnimMeta().then(meta => {
      const entry = skillAnimInfo(meta, msg.skillId, msg.level || 1);
      const clip = clipForSkill(entry, msg.hitTime);
      // null = the skill genuinely has NO cast gesture (empty skillgrp
      // animation code — every TOGGLE in the data, checked: 32/32). The old
      // `|| 'attack'` turned each of those into a full weapon swing, so
      // toggling Vicious Stance on made the character attack the air.
      this.lastCastClip = clip;   // verification hook (name logic picked)
      if (!clip || !(ch.actions && ch.actions[clip])) return;
      // hitTime 0 (toggles, instant skills) means "no cast time": let the clip
      // run at its own length rather than dividing by zero's worth of stretch.
      ch.oneShot(clip, 0.1, msg.hitTime > 0 ? { durationMs: msg.hitTime } : {});
    });
  }

  // Social emote broadcast (SocialAction packet).
  //
  // The packet's `actionId` is the whole message: actionname.dat defines
  // twelve (type 2..13) and each has its own retail clip, resolved through
  // the model's PcSocialAnimName table (character.js: socialClip). This used
  // to take only `id` and hard-code emote('dance'), so eleven of the twelve
  // played the dance — the clips were extracted and sitting in the manifest
  // the whole time.
  //
  // Monsters are a different table: they have no per-action set, only the one
  // NpcSocialAnimName the client gives the mesh (Social01 / SpWait01 / ...),
  // so every actionId plays that single clip. Playing the CAST clip here, as
  // this did, made a monster answer a wave with a spell.
  socialFlash(id, actionId) {
    const e = this.entities.get(id);
    if (!e || e.dead) return null;
    if (e.kind === 'npc') return e.socialFlash();
    return e.socialEmote(actionId);
  }

  // ChangeWaitType broadcast: waitType 0 = sitting, 1 = standing (aCis
  // ChangeWaitType — validated live: sit click -> 0, stand -> 1). Remote
  // players hold the 'sit' clip via Character.sitting. Monsters have no
  // sit clips (mapAnimations maps no sit state) — documented no-op.
  // Broadcasts can race the async model load: state for a pending id is
  // deferred and applied when the spawn lands.
  setWaitType(id, waitType) {
    const e = this.entities.get(id);
    if (!e) {
      if (this.pending.has(id)) {
        (this._waitState || (this._waitState = new Map())).set(id, waitType);
      }
      return;
    }
    if (e.dead || e.kind !== 'player') return;
    e.sitting = waitType === 0;
  }

  // ChangeMoveType broadcast: authoritative walk/run override. Players
  // otherwise guess from the leg distance (Character.setTarget); monsters
  // pick the clip in NpcEntity.update. Same deferral race as setWaitType.
  setMoveMode(id, running) {
    const e = this.entities.get(id);
    if (!e) {
      if (this.pending.has(id)) {
        (this._moveState || (this._moveState = new Map())).set(id, !!running);
      }
      // The local player is not in the EntityManager (same self fallback as
      // attackFlash/skillFlash). Without this the walk/run toggle — the ONE
      // thing that changes the stance after world entry — never reached the
      // character the player is actually looking at.
      const w = typeof window !== 'undefined' && window.__world;
      if (w && w.net.selfId === id && w.character) {
        w.character.forcedMoveAnim = running ? 'run' : 'walk';
        if (w.character.target) w.character.moveAnim = w.character.forcedMoveAnim;
      }
      return;
    }
    if (e.dead) return;
    if (e.kind === 'player') {
      e.forcedMoveAnim = running ? 'run' : 'walk';
      if (e.target) e.moveAnim = e.forcedMoveAnim;
    } else {
      e.running = !!running;
    }
  }

  // apply broadcast state that arrived while the model was still loading
  _applyDeferred(ch) {
    if (this._waitState && this._waitState.has(ch.id)) {
      ch.sitting = this._waitState.get(ch.id) === 0;
      this._waitState.delete(ch.id);
    }
    if (this._moveState && this._moveState.has(ch.id)) {
      ch.forcedMoveAnim = this._moveState.get(ch.id) ? 'run' : 'walk';
      this._moveState.delete(ch.id);
    }
  }

  die(id) {
    const e = this.entities.get(id);
    if (!e) {
      // the local player is not in the EntityManager — same self fallback
      // as attackFlash/skillFlash (no corpse fade on the own model)
      const w = typeof window !== 'undefined' && window.__world;
      if (w && w.net.selfId === id && w.character) {
        w.character.dead = true;
        playDeathClip(w.character);
      }
      return;
    }
    if (e.kind === 'npc') { e.die(); return; }
    e.dead = true;
    e.clearTarget();
    // rebuilt models carry a 'die' clip (held on the last frame); without
    // it keep the legacy freeze
    if (!playDeathClip(e)) e.play('idle');
    e.group.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.transparent = true; m.opacity = 0.25; }
      }
    });
  }

  revive(id) {
    const e = this.entities.get(id);
    if (!e) {
      const w = typeof window !== 'undefined' && window.__world;
      if (w && w.net.selfId === id && w.character) {
        w.character.dead = false;
        w.character.emoteUntil = 0;   // release a held 'die' clip
        w.character.play('idle');
      }
      return;
    }
    if (e.kind === 'npc') { e.revive(); return; }
    e.dead = false;
    e.emoteUntil = 0;   // release a held 'die' clip
    e.group.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.opacity = 1; }
      }
    });
    e.play('idle');
  }

  getEntity(id) { return this.entities.get(id); }

  // MoveToLocation: "this creature is at (x,y,z) and is walking to
  // (tx,ty,tz)". The origin half used to be dropped by the gateway; it is the
  // server's own statement of where the creature IS, so the drawn body starts
  // each leg from the server's position instead of accumulating drift.
  move(msg, terrain) {
    const e = this.entities.get(msg.id);
    if (!e) return;
    if (msg.x != null && msg.y != null && msg.z != null) {
      const here = l2ToThree(msg.x, msg.y, msg.z);
      e.group.position.x = here.x;
      e.group.position.z = here.z;
      e.group.position.y = this._groundY(here.x, here.z, msg.z * L2_TO_M, terrain);
    }
    const target = l2ToThree(msg.tx || 0, msg.ty || 0, msg.tz || 0);
    e.serverZ = (msg.tz || 0) * L2_TO_M;
    if (e.kind === 'player') e.setTarget(target);
    else e.target = target;
  }

  // ValidateLocation / TeleportToLocation: a POSITION, with no destination.
  // aCis broadcasts ValidateLocation for knockback (Pdam), InstantJump and
  // EffectThrowUp, and sends it for a newly targeted creature
  // (Player.java:2480) — in every case the creature IS there now, so the drawn
  // body goes there and stops rather than walking.
  place(msg, terrain) {
    const e = this.entities.get(msg.id);
    if (!e) return;
    const p = l2ToThree(msg.x || 0, msg.y || 0, msg.z || 0);
    e.group.position.x = p.x;
    e.group.position.z = p.z;
    e.serverZ = (msg.z || 0) * L2_TO_M;
    e.group.position.y = this._groundY(p.x, p.z, e.serverZ, terrain);
    e.target = null;
    // NpcEntity.update leaves the last clip running when there is no target,
    // so a creature stopped mid-leg would keep its run clip playing forever.
    if (e.kind === 'npc' && e.actions && !e.dead) e._play('idle');
    if (msg.heading != null && e.kind === 'player') {
      e.group.rotation.y = l2HeadingToThreeYaw(msg.heading);
    }
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
