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
// THOSE TWO ARE BASE VALUES AND ARE NOT WHAT THE SERVER MOVES AT. UserInfo.java
// writes getStatus().getBaseRunSpeed() / getBaseWalkSpeed() and, four fields
// later, getStatus().getMovementSpeedMultiplier(); CreatureMove.updatePosition
// covers `getMoveSpeed() / 10` every 100 ms, and getMoveSpeed() is
// calcStat(Stats.RUN_SPEED, base) — the base times exactly that multiplier.
// Measured live against the server's own broadcast positions
// (gateway/test/verify-movement.js, 2026-08-08, unbuffed human fighter on dry
// ground): runSpeed 115, speedMul 1.10, ground speed 125.3 u/s over a 6.3 s
// least-squares fit — the base alone is 9.0% slow, permanently. Every Creature
// carries FuncMoveSpeed (= Formulas.DEX_BONUS[DEX], which is 1.10 at the human
// fighter's DEX 30), and PlayerStatus.getMoveSpeed folds the swim, swamp,
// weight-penalty and armour-grade maluses in on top — which is also how those
// become visible here. It CAN be exactly 1 (DEX_BONUS rounds to 1.00 around
// DEX 19 and nothing else applies), so 1 is a legitimate value, not a
// missing-field sentinel.
//
// These fallbacks are only for the offline/solo path, where no server is
// speaking. They are the class table's own values for a level-1 human fighter
// (server/aCis_datapack/data/xml/classes/humanFighter.xml: runSpd 115,
// walkSpd 80), converted with L2_TO_M. There is deliberately NO fallback
// multiplier: 1 is what "nothing has spoken yet" means, and inventing a DEX
// bonus for a character the server has not described would be a guess.
const DEFAULT_RUN_SPEED_L2 = 115;
const DEFAULT_WALK_SPEED_L2 = 80;

const TURN_RATE = 10;          // rad/s toward heading — NOT sourced, see report

// Arrival. aCis has NO arrival epsilon: CreatureMove.updatePosition runs on a
// fixed 100 ms task and covers `passedDistance = getMoveSpeed() / 10` per tick,
// and the moment the remaining distance is not more than that it sets the
// position to the destination outright ("Already there : set the position to
// the destination"). So the threshold is one tick of travel — speed-dependent —
// and the character lands ON the destination. The 0.15 m constant that used to
// live here stopped a hasted character exactly as far short as a walking one.
export const MOVE_TICK_S = 0.1;   // CreatureMove task period, seconds

// Attack cadence, straight from the server, exactly like locomotion speed:
//
//   pAtkSpd   -> Formulas.calculateTimeBetweenAttacks(attacker)
//                = max(100, 500000 / pAtkSpd)  ms per swing
//   atkSpdMul -> CreatureStatus.getAttackSpeedMultiplier(), whose javadoc reads
//                "the attack speed multiplier, which is used by client to set
//                correct character/object attack speed"; its value is
//                1.1 * pAtkSpd / template basePAtkSpd. aCis sends it on
//                UserInfo/CharInfo/NpcInfo and the gateway forwards it.
//
// It is the animation RATE, not a duration: at the player template's base
// atkSpd (300) it is 1.1, and it scales linearly with pAtkSpd, so a swing
// always occupies the same fraction of the attack cycle no matter how fast the
// character gets. Live: pAtkSpd 416 -> mul 1.5253, cycle 1201 ms, and the
// 1.500 s atk01_1hs clip plays in 983 ms.
const DEFAULT_ATK_SPD_MUL = 1;   // no scaling until the server has spoken

export class Character {
  constructor() {
    this.group = new THREE.Group();   // world transform (feet at group origin)
    this.model = null;
    this.mixer = null;
    this.actions = {};                // name -> AnimationAction
    this.current = null;
    this.target = null;               // THREE.Vector3 | null
    // WALK/RUN IS A STATE, NOT A DISTANCE. aCis has exactly one flag for it,
    // Creature._isRunning: Player.restore sets it true at world entry (which is
    // why 'run' is the default here), and Player.setWalkOrRun is the only thing
    // that changes it. For a player it is reached by RequestChangeMoveType, by
    // RequestActionUse id 1 ("Walk/Run"), by Playable.fleeFrom (fear forces the
    // run stance) and by mounting — an exhaustive grep of setWalkOrRun /
    // forceWalkStance / forceRunStance callers, and not one of them looks at a
    // distance. There is no distance rule anywhere in the server —
    // verified live: a 500-unit (5 m) leg is covered at 125.8 u/s, the RUN
    // speed, where the old RUN_THRESHOLD had the client walk anything under
    // 6 m at 0.80 m/s while the server ran it at 1.33 (metres of drift per
    // click). Both signals reach us: the entry stance on charSheet.running
    // (UserInfo's isRunning byte) and later changes as the changeMove op
    // (ChangeMoveType).
    this.moveMode = 'run';
    this.moveAnim = 'run';
    this.keys = new Set();
    this.speed = 0;                   // current planar speed (for verification)
    // metres/second, replaced by the server's values on the first charSheet.
    // These are the EFFECTIVE speeds — base x speedMul (see setSpeeds).
    this.speedMul = 1;
    this.runSpeed = DEFAULT_RUN_SPEED_L2 * L2_TO_M;
    this.walkSpeed = DEFAULT_WALK_SPEED_L2 * L2_TO_M;
    this.baseRunSpeed = DEFAULT_RUN_SPEED_L2;    // L2 units/s, as sent
    this.baseWalkSpeed = DEFAULT_WALK_SPEED_L2;
    // attack cadence (see DEFAULT_ATK_SPD_MUL): replaced by the server's own
    // values on the first charSheet (self) or addPlayer (remote players)
    this.pAtkSpd = 0;
    this.atkSpdMul = DEFAULT_ATK_SPD_MUL;
    // right-hand weapon: { object, meshId, handness, weaponType }, owned by
    // equipment.js. `wantWeapon` survives a model reload — race/class changes
    // rebuild the skeleton and the weapon has to be re-hung on the new sockets.
    this.weapon = { object: null, meshId: null };
    this.wantWeapon = 0;
    // off hand: shields, and the second blade of a dual set. Same shape as
    // `weapon`, hung on Weapon_L_Bone. A two-handed weapon leaves the server's
    // lhand slot empty (verified live in gateway/test/verify-paperdoll.js), so
    // nothing special is needed to keep a shield off a two-hander.
    this.offhand = { object: null, meshId: null };
    this.wantOffhand = 0;
    // animation stance the equipped weapon calls for; 'hand' is unarmed
    this.stance = 'hand';
  }

  // The equipped left-hand item id from the server's paperdoll.
  setOffhand(itemId) {
    this.wantOffhand = itemId || 0;
    if (!this.model) return Promise.resolve(null);
    return equipWeapon(this.model, this.wantOffhand, this.offhand, 'L');
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
  // Takes the whole charSheet (self) or addPlayer (remote) payload; every field
  // is optional so a payload that carries only some of them still applies.
  setSpeeds({ runSpeed, walkSpeed, speedMul, pAtkSpd, atkSpdMul, running }) {
    if (runSpeed > 0) this.baseRunSpeed = runSpeed;
    if (walkSpeed > 0) this.baseWalkSpeed = walkSpeed;
    // The multiplier the base speeds are NOT scaled by — see the top of this
    // file. It arrives on the same UserInfo, so a payload carrying speeds
    // without it means the server really did send 1.
    //
    // IT BELONGS TO THE CURRENT STANCE, and it is not always above 1. Measured
    // live with the fixture standing in water: getMovementSpeedMultiplier() is
    // getMoveSpeed() / getBaseMoveSpeed(), PlayerStatus.getMoveSpeed switches
    // its base to getBaseSwimSpeed() (50) in water, and the server sent 0.478
    // while running (55/115) and 0.6875 after the walk toggle (55/80) — the
    // same 55 u/s both times, measured 54.8 and 55.1. So the product is only
    // meaningful for the stance the UserInfo describes; aCis re-broadcasts
    // UserInfo on every stance change (Player.setWalkOrRun -> broadcastUserInfo),
    // which is what keeps it honest. Applying it to both speeds here is
    // therefore right for the one being drawn and stale for the other, exactly
    // as the protocol affords — and it is why a fallback multiplier would be a
    // lie rather than a default.
    if (speedMul > 0) this.speedMul = speedMul;
    this.runSpeed = this.baseRunSpeed * this.speedMul * L2_TO_M;
    this.walkSpeed = this.baseWalkSpeed * this.speedMul * L2_TO_M;
    if (pAtkSpd > 0) this.pAtkSpd = pAtkSpd;
    if (atkSpdMul > 0) this.atkSpdMul = atkSpdMul;
    // Walk/run stance. aCis's setRunning(true) at world entry does NOT
    // broadcast ChangeMoveType, so this UserInfo/CharInfo byte is the only
    // signal a freshly entered character gets; ChangeMoveType carries every
    // later change.
    if (running != null) {
      this.moveMode = running ? 'run' : 'walk';
      if (this.target) this.moveAnim = this.moveMode;
    }
  }

  // The stance under its old name. entities.js and the browser suites reach for
  // `forcedMoveAnim` — it never "forced" anything over a guess, because there
  // is no guess: it IS Creature.isRunning().
  get forcedMoveAnim() { return this.moveMode; }
  set forcedMoveAnim(v) { this.moveMode = v === 'walk' ? 'walk' : 'run'; }

  /**
   * ms between swings for this character — Formulas.calculateTimeBetweenAttacks.
   * null while the server has not described the character's pAtkSpd.
   */
  attackInterval() {
    return this.pAtkSpd > 0 ? Math.max(100, Math.floor(500000 / this.pAtkSpd)) : null;
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
    this.offhand = { object: null, meshId: null };
    if (this.wantWeapon) equipWeapon(this.model, this.wantWeapon, this.weapon);
    if (this.wantOffhand) equipWeapon(this.model, this.wantOffhand, this.offhand, 'L');
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
  // The pipeline emits the stanced clips LOWERCASE (`spatk01_1hs`,
  // `atk01_2hs`) while the unstanced legacy pair kept retail's camel case
  // (`spAtk01`, `spAtk02`) — both spellings are in editor/characters/
  // manifest.json for every model. Looking up only the verbatim token meant
  // `spAtk01` -> `spAtk01_1hs`, which does not exist, so every physical skill
  // cast silently fell back to the unstanced clip: 30-odd stanced spatk
  // sequences per model shipped and none of them was ever played. Try the
  // lowercase form too.
  _clip(name) {
    const stance = this.stance;
    if (!stance || stance === 'hand') return name;
    const token = name === 'attack' ? 'atk01' : name;
    for (const t of (token === token.toLowerCase() ? [token] : [token, token.toLowerCase()])) {
      const stanced = `${t}_${stance}`;
      if (this.actions[stanced]) return stanced;
    }
    return name;
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

  // Play a clip once (skill cast gestures, emotes, swings). The update()
  // idle/sit fallback stays suppressed via emoteUntil.
  //
  // opts.rate       playback multiplier (swings: the server's atkSpdMul)
  // opts.durationMs make the clip last exactly this long (casts: the server's
  //                 MagicSkillUse hitTime) — overrides rate
  //
  // Neither is a free parameter: both are values the server computed for the
  // client. The clip's own length only decides the animation when nothing
  // sourced is available.
  oneShot(name, fade = 0.1, opts = {}) {
    // resolve the stance here too, so the hold time matches the clip that
    // actually plays — a 1HS swing and the unarmed one are different lengths
    const resolved = this._clip(name);
    const action = this.actions[resolved];
    if (!action) return;
    const clipSec = action.getClip().duration;
    let rate = opts.rate > 0 ? opts.rate : 1;
    if (opts.durationMs > 0 && clipSec > 0) rate = (clipSec * 1000) / opts.durationMs;
    if (!(rate > 0) || !isFinite(rate)) rate = 1;
    if (action === this.current) {
      // Same clip again — a repeating swing. play() short-circuits on the
      // current action, so without this the second swing of a chain never
      // restarted and the clip just kept free-running out of phase.
      action.reset().play();
      this.current = action;
    } else {
      this.play(resolved, fade);
    }
    action.setEffectiveTimeScale(rate);
    this.lastOneShot = { clip: resolved, rate, ms: (clipSec / rate) * 1000 };
    this.emoteUntil = performance.now() + (clipSec / rate) * 1000;
  }

  /**
   * One attack swing, played at the rate the server computed for it.
   * Source: CreatureStatus.getAttackSpeedMultiplier (see the top of this file).
   */
  attackSwing() {
    this.oneShot('attack', 0.1, { rate: this.atkSpdMul });
  }

  setTarget(point) {
    this.target = point.clone();
    // The stance decides, and only the stance: aCis's own move code reads
    // Creature.isRunning() and nothing else (CreatureStatus.getBaseMoveSpeed).
    this.moveAnim = this.moveMode;
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
      // WASD overrides click target. It streams real move orders to the
      // server, which moves at the STANCE speed like any other order — a
      // walking character does not sprint because the input came from a key.
      this.target = null;
      const keySpeed = this.moveMode === 'run' ? this.runSpeed : this.walkSpeed;
      vx = moveDir.x * keySpeed; vz = moveDir.z * keySpeed;
      running = this.moveMode === 'run'; moving = true;
    } else if (this.target) {
      const d = this._planarDist(this.target);
      const speed = this.moveAnim === 'run' ? this.runSpeed : this.walkSpeed;
      if (d <= speed * MOVE_TICK_S) {
        // land on the destination, the way the server does
        this.group.position.x = this.target.x;
        this.group.position.z = this.target.z;
        this.group.position.y = terrain.heightAtWorld(
          this.group.position.x, this.group.position.z, this.group.position.y);
        this.target = null;
      } else {
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
