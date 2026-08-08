// Character: glTF load, animation state machine (idle/walk/run), and
// point-click / WASD locomotion over the terrain.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L2_TO_M } from './coords.js';
import { equipWeapon, stanceFor } from './equipment.js';

const CHAR_HEIGHT = 1.75;      // meters — fallback normalization (~1.7 charcreate)

// Locomotion speed is the server's, not ours. aCis sends runSpeed/walkSpeed in
// L2 units per second on every UserInfo (gateway forwards them on `charSheet`),
// which is also how every speed buff, weapon weight penalty and class
// difference reaches us — a Dagger elf and a plate-armoured knight do not move
// at the same rate, and no constant here can express that.
//
// These fallbacks are only for the offline/solo path, where no server is
// speaking. They are the class table's own values for a level-1 human fighter
// (server/aCis_datapack/data/xml/classes/humanFighter.xml: runSpd 120,
// walkSpd 80), converted with L2_TO_M, so offline movement matches what the
// same character would do online instead of the 3.4x-too-fast placeholder that
// used to live here.
const DEFAULT_RUN_SPEED_L2 = 115;
const DEFAULT_WALK_SPEED_L2 = 80;

const RUN_THRESHOLD = 6;       // click farther than this => run anim
const TURN_RATE = 10;          // rad/s toward heading
const ARRIVE_DIST = 0.15;

export class Character {
  constructor() {
    this.group = new THREE.Group();   // world transform (feet at group origin)
    this.model = null;
    this.mixer = null;
    this.actions = {};                // name -> AnimationAction
    this.current = null;
    this.target = null;               // THREE.Vector3 | null
    this.moveAnim = 'walk';
    this.keys = new Set();
    this.speed = 0;                   // current planar speed (for verification)
    // metres/second, replaced by the server's values on the first charSheet
    this.runSpeed = DEFAULT_RUN_SPEED_L2 * L2_TO_M;
    this.walkSpeed = DEFAULT_WALK_SPEED_L2 * L2_TO_M;
    // right-hand weapon: { object, meshId, handness, weaponType }, owned by
    // equipment.js. `wantWeapon` survives a model reload — race/class changes
    // rebuild the skeleton and the weapon has to be re-hung on the new sockets.
    this.weapon = { object: null, meshId: null };
    this.wantWeapon = 0;
    // animation stance the equipped weapon calls for; 'hand' is unarmed
    this.stance = 'hand';
  }

  // The equipped right-hand item id, straight from the server's paperdoll.
  // Safe to call before the model has loaded: the id is remembered and applied
  // when load() finishes.
  setWeapon(itemId) {
    this.wantWeapon = itemId || 0;
    const stance = stanceFor(this.wantWeapon);
    if (stance !== this.stance) {
      this.stance = stance;
      // Re-enter the pose in the new stance, otherwise the character keeps
      // standing unarmed until something else changes its state. Idle is safe
      // even while walking: update()'s moving branch calls play() every frame
      // and will correct it on the next one.
      if (this.mixer && !this.emoteUntil) this.play('idle');
    }
    if (!this.model) return Promise.resolve(null);
    return equipWeapon(this.model, this.wantWeapon, this.weapon);
  }

  // aCis reports speed in L2 units/second on every UserInfo, so this is also
  // the path by which a haste buff, a slow, or a weight penalty takes effect —
  // it must be re-applied on each charSheet, not just at login.
  setSpeeds({ runSpeed, walkSpeed }) {
    if (runSpeed > 0) this.runSpeed = runSpeed * L2_TO_M;
    if (walkSpeed > 0) this.walkSpeed = walkSpeed * L2_TO_M;
  }

  // nativeHeight: true height in L2 world units (frozen M3 manifest
  // contract). When present it is authoritative (exact scale, no guard);
  // when absent, the legacy 1.75 m guarded normalization applies.
  async load(url, nativeHeight = null) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0.001) {
      if (nativeHeight) {
        root.scale.setScalar((nativeHeight * L2_TO_M) / size.y);
      } else {
        const k = CHAR_HEIGHT / size.y;
        if (k < 0.5 || k > 2.5) root.scale.setScalar(k);
      }
    }
    const box2 = new THREE.Box3().setFromObject(root);
    const center = box2.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box2.min.y;
    this.heightM = box2.getSize(new THREE.Vector3()).y;   // final world height

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    this.model = root;
    this.group.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.play('idle');
    // A model reload builds a new skeleton, so any weapon we were told about
    // before or during the load has to be re-hung on the new sockets.
    this.weapon = { object: null, meshId: null };
    if (this.wantWeapon) equipWeapon(this.model, this.wantWeapon, this.weapon);
    return this;
  }

  // Logical clip name -> the stanced clip the equipped weapon calls for.
  //
  // Retail names its sequences per weapon stance (Wait_1HS_MFighter,
  // Run_Bow_MElf...), and the pipeline emits them as idle_1hs / run_bow /
  // atk01_2hs alongside the original unstanced names. `attack` maps to atk01
  // because that is the retail token; the rest keep their own.
  //
  // Falls back to the unstanced clip whenever a stance lacks one — retail
  // genuinely does not ship every combination (no Atk02 for Bow, no Dual
  // SpAtk for elves), so a miss here is data, not an error.
  _clip(name) {
    const stance = this.stance;
    if (!stance || stance === 'hand') return name;
    const token = name === 'attack' ? 'atk01' : name;
    const stanced = `${token}_${stance}`;
    return this.actions[stanced] ? stanced : name;
  }

  play(name, fade = 0.25) {
    name = this._clip(name);
    const next = this.actions[name] || this.actions.idle;
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  // One-shot emote (socialAction broadcast): play the clip and hold it
  // against the per-frame idle fallback for its own duration; real
  // movement still cancels it, as it should.
  emote(name) {
    this.oneShot(name, 0.15);
  }

  // Play a clip once for its own duration (skill cast gestures, emotes).
  // The update() idle/sit fallback stays suppressed via emoteUntil.
  oneShot(name, fade = 0.1) {
    // resolve the stance here too, so the hold time matches the clip that
    // actually plays — a 1HS swing and the unarmed one are different lengths
    const resolved = this._clip(name);
    const clip = this.actions[resolved];
    if (!clip) return;
    this.play(resolved, fade);
    this.emoteUntil = performance.now() + clip.getClip().duration * 1000;
  }

  setTarget(point) {
    this.target = point.clone();
    const d = this._planarDist(this.target);
    // ChangeMoveType is authoritative when the server sent it; otherwise
    // guess run/walk from the leg distance
    this.moveAnim = this.forcedMoveAnim || (d > RUN_THRESHOLD ? 'run' : 'walk');
  }

  clearTarget() { this.target = null; }

  _planarDist(p) {
    const dx = p.x - this.group.position.x;
    const dz = p.z - this.group.position.z;
    return Math.hypot(dx, dz);
  }

  // moveDir: normalized THREE.Vector3 in world XZ (from WASD), or null
  update(dt, terrain, moveDir = null) {
    if (!this.mixer) return;
    let vx = 0, vz = 0, running = false, moving = false;

    if (moveDir && moveDir.lengthSq() > 0) {
      // WASD overrides click target
      this.target = null;
      vx = moveDir.x * this.runSpeed; vz = moveDir.z * this.runSpeed;
      running = true; moving = true;
    } else if (this.target) {
      const d = this._planarDist(this.target);
      if (d <= ARRIVE_DIST) {
        this.target = null;
      } else {
        const speed = this.moveAnim === 'run' ? this.runSpeed : this.walkSpeed;
        const step = Math.min(speed * dt, d);
        vx = (this.target.x - this.group.position.x) / d * (step / dt);
        vz = (this.target.z - this.group.position.z) / d * (step / dt);
        running = this.moveAnim === 'run';
        moving = true;
      }
    }

    if (moving) {
      const pos = this.group.position;
      pos.x += vx * dt;
      pos.z += vz * dt;
      pos.y = terrain.heightAtWorld(pos.x, pos.z, pos.y);
      // smooth turn toward heading
      const heading = Math.atan2(vx, vz);
      let dy = heading - this.group.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      const maxTurn = TURN_RATE * dt;
      this.group.rotation.y += Math.abs(dy) < maxTurn ? dy : Math.sign(dy) * maxTurn;
      this.play(running ? 'run' : 'walk');
      this.speed = Math.hypot(vx, vz);
    } else if (performance.now() >= (this.emoteUntil || 0)) {
      this.play(this.sitting ? 'sit' : 'idle');
      this.speed = 0;
    } else {
      this.speed = 0;   // emoting: held by emote(), not re-idled
    }

    this.mixer.update(dt);
  }
}
