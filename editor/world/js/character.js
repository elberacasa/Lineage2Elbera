// Character: glTF load, animation state machine (idle/walk/run), and
// point-click / WASD locomotion over the terrain.

import * as THREE from 'three';
import { PlayerAppearance } from './appearance.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L2_TO_M } from './coords.js';
import { equipWeapon, stanceFor } from './equipment.js';
import { applyArmor, detachArmor } from './armor.js';
import { createCastPlayback, advanceCastPlayback, closeSourceLoop } from './castplayback.js';
import { directNotifySound } from './animnotify-clock.js';
import { audio } from './audio.js';
import { playerVisualScale } from './player-transform.js';
import { pawnAnim } from './castanim.js';
import { waitSequence, createWaitSequence, advanceWaitPlayback } from './waitanim.js';
import { fetchOriginalAnimationBundle } from './sourceanim-data.js';
import { createOriginalPosePlayback } from './sourcepose-playback.js';

// SOCIAL EMOTES: the actionId -> clip table is retail's, not a name match.
//
// The SocialAction packet carries an `actionId`; `actionname.dat` defines
// exactly twelve of them (its `type` field, 2..13) and the client resolves
// each through `Engine.Pawn`'s `PcSocialAnimName[]` array, per race/gender.
// tools/anim/social_actions.json holds that decode for all 14 sets, and
// tools/build_characters wrote it into editor/characters/manifest.json as
// each model's `socialActions` map -- 12 entries on all 14 models, every one
// naming a clip the glTF actually carries (verified by
// verify_emotes.js --check, which also asserts the twelve are twelve
// DIFFERENT animations rather than twelve names for Social_dance).
//
// The table is fetched once and shared: Character.load() awaits it so that a
// SocialAction arriving in the same tick as the spawn still resolves. Every
// model id is a key, so a miss means the manifest and the glTF disagree --
// which is a defect, not a case to paper over with a default clip.
let _charManifest = null;
function charManifest() {
  if (!_charManifest) {
    _charManifest = fetch('/characters/manifest.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && j.models) || null)
      .catch(() => null);
  }
  return _charManifest;
}

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

// Cached decoded source images are shared; PlayerAppearance owns and retires
// each actor's material/texture wrappers without disposing the shared image.
const faceImages = new Map();
function faceImage(url) {
  if (!faceImages.has(url)) faceImages.set(url, new THREE.TextureLoader().loadAsync(url)
    .catch(error => { faceImages.delete(url); throw error; }));
  return faceImages.get(url);
}

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
    // Worn armor: { pieces, key, hidden }, owned by armor.js. Unlike a weapon
    // this is not an attachment — the pieces are SkinnedMeshes bound to this
    // character's own skeleton, standing in for the body meshes the base glTF
    // ships. `wantArmor` survives a model reload for the same reason
    // `wantWeapon` does: the reload builds a new skeleton and every piece has
    // to be re-bound to it.
    this.armor = { pieces: [], key: null };
    this.wantArmor = null;
    // animation stance the equipped weapon calls for; 'hand' is unarmed
    this.stance = 'hand';
    this.waitType = 1;
    this.sitting = false;
    this.nativeWait = null;
  }

  // The four armored paperdoll slots, straight off the wire. aCis writes
  // gloves/chest/legs/feet in both UserInfo and CharInfo and the gateway has
  // decoded all four since the inventory wave (gameclient.js
  // readPaperdollItems); nothing consumed them until now.
  // Safe to call before the model has loaded: the ids are remembered and
  // applied when load() finishes.
  setArmor(paperdoll) {
    this.wantArmor = paperdoll || null;
    if (!this.model || !this.modelId) return Promise.resolve(null);
    return applyArmor(this.model, this.modelId, this.wantArmor, this.armor);
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
      if (this.nativeWait) this._refreshWaitStance();
      else if (this.mixer && !this.emoteUntil && !this.nativeCast) this.play('idle');
    }
    if (!this.model) return Promise.resolve(null);
    return equipWeapon(this.model, this.wantWeapon, this.weapon);
  }

  // aCis reports speed in L2 units/second on every UserInfo, so this is also
  // the path by which a haste buff, a slow, or a weight penalty takes effect —
  // it must be re-applied on each charSheet, not just at login.
  // Takes the whole charSheet (self) or addPlayer (remote) payload; every field
  // is optional so a payload that carries only some of them still applies.
  setSpeeds({ runSpeed, walkSpeed, speedMul, pAtkSpd, mAtkSpd, atkSpdMul, running }) {
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
    // Original User magic-casting speed -> Pawn.SkillSpeedRate, not the
    // physical attack multiplier. Engine.dll RVA 0x195366..0x195384.
    if (Number.isFinite(mAtkSpd) && mAtkSpd > 0) this.skillSpeedRate = Math.fround(mAtkSpd / 333);
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

  // Scale comes from original Actor/mesh fields. Placement remains a separate
  // unresolved transform; never infer scale by fitting a measured height.
  async load(url) {
    const generation = this.loadGeneration = (this.loadGeneration || 0) + 1;
    // The pawn this body is. entities.js picks a manifest entry and hands over
    // only its `gltf` path, and steps.js needs the id to find this pawn's
    // footfall frames — the file's own basename is that id (manifest.json
    // models[].gltf is "models/<id>.gltf" for all 14), so it is read here
    // rather than added to the addPlayer contract.
    this.modelId = String(url).split('/').pop().replace(/\.gltf$/i, '') || null;
    // the model's own PcSocialAnimName table (see charManifest above)
    const [models, waitTable] = await Promise.all([charManifest(), pawnAnim()]);
    if (generation !== this.loadGeneration) return this;
    this.waitTable = waitTable;
    const mEntry = models && models.find(m => m.id === this.modelId);
    const path = String(url);
    const scale = playerVisualScale(mEntry?.visualScale, {
      modelId: this.modelId, gltf: path.startsWith('/characters/') ? path.slice(12) : null,
    });
    if (!scale) throw new Error(`Missing verified player scale for ${this.modelId}`);
    this.socialActions = (mEntry && mEntry.socialActions) || null;
    // These model URLs and their buffers are rebuilt in place by the local
    // asset pipeline. Revalidate both so an appended animation cannot be
    // paired with a previously cached glTF or shorter binary. GLTFLoader
    // propagates request headers to its dependent buffer loader.
    const [gltf, original] = await Promise.all([
      new GLTFLoader().setRequestHeader({ 'Cache-Control': 'no-cache' }).loadAsync(url),
      fetchOriginalAnimationBundle(this.modelId).then(data=>({data}),error=>({error})),
    ]);
    if (generation !== this.loadGeneration) return this;
    const root = gltf.scene;

    root.scale.set(scale.x, scale.y, scale.z);
    const box2 = new THREE.Box3().setFromObject(root);
    const center = box2.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box2.min.y;
    this.heightM = box2.getSize(new THREE.Vector3()).y;   // final world height

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    // A SECOND load() on the same Character has to REPLACE the body, not add
    // one. Found while probing the cast clip live: loading orc_fighter_m over
    // an already-loaded human_fighter_m left the human's 90-odd
    // AnimationActions in `actions`, so `_clip('spAtk01')` at the bow stance
    // answered `spatk01_bow` — a clip the orc does not ship — and the action
    // it returned belonged to the DISCARDED mixer, which nothing updates.
    // The old body also stayed in the group.
    //
    // Latent, not live, and said that way deliberately: the one runtime path
    // that changes the self model (main.js loadCharacter, the race/class
    // swap) builds a NEW Character and removes the old group, and remote
    // players are loaded once per entity — so no shipped path re-enters here
    // today. It is fixed because the method must be safe on its own terms,
    // and because the probe that found it is the same shape as the next
    // feature that will call it.
    if (this.model) this.group.remove(this.model);
    if (this.mixer) this.mixer.stopAllAction();
    this.actions = {};
    this.current = null;
    this.cancelCast(); // A reused Character must retire old skeleton sound callbacks too.
    this.originalPose = null;
    this.castLoopActions = new Map();
    this.nativeWait = null;
    this.waitLoopActions = new Map();
    this.lastWaitError = null;
    this.model = root;
    this.group.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    try {
      if (original.error) throw original.error;
      this.originalPose = createOriginalPosePlayback(root, original.data);
      this.lastOriginalPose = {status:'ready',mode:'ordinary-source-keys'};
    } catch (error) {
      this.lastOriginalPose = {status:'unsupported',reason:error.message};
    }
    this.play('idle');
    // A model reload builds a new skeleton, so any weapon we were told about
    // before or during the load has to be re-hung on the new sockets.
    this.weapon = { object: null, meshId: null };
    this.offhand = { object: null, meshId: null };
    if (this.wantWeapon) equipWeapon(this.model, this.wantWeapon, this.weapon);
    if (this.wantOffhand) equipWeapon(this.model, this.wantOffhand, this.offhand, 'L');
    // Same reason as the weapon re-hang, one step further: the armor pieces are
    // bound to the OLD skeleton, which this load has just replaced. Reset the
    // holder so applyArmor rebuilds and re-binds rather than believing the
    // cached key still describes what is on screen.
    detachArmor(this.armor);
    this.armor = { pieces: [], key: null };
    if (this.wantArmor) applyArmor(this.model, this.modelId, this.wantArmor, this.armor);
    this._appearance?.refresh();
    return this;
  }

  // Only explicit packet fields are retained. Hair is reported as pending
  // source support; the source face index never falls back to another index.
  setAppearance(snapshot) {
    this._appearance ??= new PlayerAppearance({
      getModel: () => ({ model: this.model, modelId: this.modelId }),
      loadTexture: faceImage,
      onResult: result => { this.lastAppearance = result; },
    });
    return this._appearance.set(snapshot);
  }

  cancelAppearance() {
    return this._appearance?.cancel();
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
    this.originalPose?.stop();
    name = this._clip(name);
    const next = this.actions[name] || this.actions.idle;
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  // One-shot emote BY CLIP NAME: play the clip and hold it against the
  // per-frame idle fallback for its own duration; real movement still
  // cancels it, as it should. Callers that hold a SocialAction actionId
  // want socialEmote() below, not this.
  emote(name) {
    this.oneShot(name, 0.15);
  }

  // SocialAction actionId -> this model's clip. Null when the model has no
  // table (never happens for the 14 shipped models) or the id is not one of
  // actionname.dat's twelve.
  socialClip(actionId) {
    const t = this.socialActions;
    if (!t || actionId == null) return null;
    return t[String(actionId)] || null;
  }

  // One-shot emote from a SocialAction broadcast. Returns the clip it chose
  // so the caller (and verify_emotes.js) can see the resolution, or null when
  // the id resolves to nothing -- in which case NOTHING plays. It used to
  // play 'dance' for all twelve ids, which is why eleven emotes looked
  // identical; substituting a default clip here would restore exactly that
  // bug in a quieter form.
  socialEmote(actionId) {
    const clip = this.socialClip(actionId);
    this.lastSocial = { actionId, clip };   // verification hook
    if (!clip) return null;
    this.oneShot(clip, 0.15);
    return clip;
  }

  // Play a clip once (skill cast gestures, emotes, swings). The update()
  // idle/sit fallback stays suppressed via emoteUntil.
  //
  // opts.rate       playback multiplier (swings: the server's atkSpdMul)
  // opts.durationMs make the clip last exactly this long (casts: the server's
  //                 MagicSkillUse hitTime) — overrides rate
  //
  // The packet values are server data, but stretching a whole cast clip to
  // hitTime is provisional browser behavior. The native scheduler computes
  // separate phase deadlines/rates from original sequence and notify data;
  // see docs/native-cast-scheduler-evidence.md.
  // Play a clip that the CLIENT'S OWN table already resolved (js/castanim.js
  // slotClip): no _clip() stance guessing, because the table is already
  // stance-indexed and its answer is frequently NOT '<name>_<stance>'.
  // Falls through to oneShot's machinery for rate/hold.
  oneShotExact(clip, fade = 0.1, opts = {}) {
    return this.oneShot(clip, fade, Object.assign({ exact: true }, opts));
  }

  oneShot(name, fade = 0.1, opts = {}) {
    this.cancelCast();
    // resolve the stance here too, so the hold time matches the clip that
    // actually plays — a 1HS swing and the unarmed one are different lengths.
    // opts.exact skips that: the caller already holds retail's own answer.
    const resolved = opts.exact ? name : this._clip(name);
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
      // play() re-resolves the stance; for an exact clip that would undo the
      // table's answer (play('atk01_bow') with stance 'bow' -> atk01_bow_bow,
      // a miss, then idle). Drive the mixer directly instead.
      if (opts.exact) {
        action.reset().setEffectiveWeight(1).fadeIn(fade).play();
        if (this.current) this.current.fadeOut(fade);
        this.current = action;
      } else {
        this.play(resolved, fade);
      }
    }
    action.setEffectiveTimeScale(rate);
    const ms = (clipSec / rate) * 1000;
    this.lastOneShot = { clip: resolved, rate, ms };
    this.emoteUntil = performance.now() + ms;
    return this.lastOneShot;
  }

  // Drop an active or pending cast and release the body to idle/sit on the
  // next update. This body transition remains a browser adaptation; native
  // cancellation poses and notify delivery are separate fidelity gaps.
  cancelCast({preserveOriginalCache=false}={}) {
    this.originalPose?.stop({preserveCache:preserveOriginalCache});
    this.castGeneration = (this.castGeneration || 0) + 1;
    this.nativeCast?.hooks?.cancel?.();
    const had = !!(this.nativeCast || this.emoteUntil > performance.now());
    this.nativeCast = null;
    this.nativeWait = null;
    this.emoteUntil = 0;
    this.lastCancel = { at: performance.now(), had };   // verification hook
    return had;
  }

  /** Play every verified ordinary source phase. Unsupported/missing inputs
   *  never fall back to stretching the first animation. Fresh/evaluated source
   *  transitions are admitted; unknown history and native modifiers remain gaps. */
  startCastSchedule(schedule, hooks = null) {
    // Browser cast channels explicitly enable notifies. Native EnableChannelNotify
    // is recovered; the original newly allocated channel default is unresolved.
    const state = createCastPlayback(schedule, { notifiesEnabled:true });
    if (!state || !this.mixer || !this.model) return { status: 'unsupported', reason: 'missing-playback-input' };
    const actions = [];
    this.castLoopActions ||= new Map();
    for (const phase of schedule.phases) {
      const base = this.actions[phase.clip];
      if (!base || base.getClip().duration !== Math.fround(phase.sourceEndpoint)) {
        return { status: 'unsupported', reason: 'missing-or-mismatched-exported-clip', clip: phase.clip };
      }
      let action = base;
      if (phase.loop) {
        const key = `${phase.clip}:${phase.frames}:${phase.sourceRate}`;
        action = this.castLoopActions.get(key);
        if (!action) {
          const closed = closeSourceLoop(base.getClip(), phase.frames, phase.sourceRate);
          if (!closed) return { status: 'unsupported', reason: 'unverified-loop-samples', clip: phase.clip };
          action = this.mixer.clipAction(closed); this.castLoopActions.set(key, action);
        }
      }
      actions.push(action);
    }
    this.cancelCast({preserveOriginalCache:true});
    state.actions = actions;
    state.hooks = hooks;
    state.generation = this.castGeneration;
    this.nativeCast = state;
    hooks?.start?.(state.generation);
    this.castNotifyCount=0; this.lastCastNotify=null; this.lastCastError=null;
    this.lastCastSchedule = schedule;
    return { status: 'ready' };
  }

  _advanceCastSchedule(dt) {
    const state = this.nativeCast;
    if (!state) return;
    const step = advanceCastPlayback(state, dt);
    if (!step) return;
    // Events belong to the channel that UpdateAnimation advanced before
    // MagicProcess changes phase, including the final completion tick.
    for (const event of step.events || []) {
      if (this.nativeCast !== state) break;
      const notify=step.eventPhase.notifies[event.index];
      const detail={ ...event, notify, phaseIndex:step.eventPhaseIndex,
        clip:step.eventPhase.clip, activeTime:step.eventActiveTime,
        elapsed:step.eventElapsed };
      // elapsed is an observation at the end of this tick; native callbacks
      // see activeTime before MagicProcess adds the delta.
      this.castNotifyCount++; this.lastCastNotify=detail;
      const sound=event.dispatch === 'object' && directNotifySound(notify);
      if (sound && this.castSoundEnabled !== false) audio.playAt(sound.ref, this.group.position,
        { volume:sound.volume, radius:sound.radius, isCurrent:()=>this.castGeneration === state.generation && this.castSoundEnabled !== false });
      this.onCastNotify?.(detail);
    }
    if (this.nativeCast !== state) return;
    if (step.unsupported) state.hooks?.cancel?.();
    else state.hooks?.tick?.({activeTime:step.eventActiveTime,complete:step.done,
      events:(step.events || []).map(event=>({...event,notify:step.eventPhase.notifies[event.index]}))});
    if (this.nativeCast !== state) return;
    if (step.done) {
      this.originalPose?.stop();
      this.lastCastError=step.unsupported || null;
      if (step.unsupported) this.castGeneration++;
      this.nativeCast = null;
      return;
    }
    if (step.changed) this._beginSourcePose(state, state.actions[step.phaseIndex], step.tween, step.phase);
    this._sampleSourcePose(state, step);
    this.lastCastPhase = { index: step.phaseIndex, clip: step.phase.clip, loop: step.phase.loop,
      elapsed: state.elapsed, sampleTime: step.sampleTime };
  }

  _beginSourcePose(state, action, tween, plan) {
    this.originalPose?.restore();
    if (this.originalPose) this.lastOriginalPose=this.originalPose.select(plan);
    state.tweenBones = [];
    if (tween > 0) this.model.traverse(bone => {
      if (bone.isBone) state.tweenBones.push({ bone, fromPosition: bone.position.clone(),
        fromQuaternion: bone.quaternion.clone(), fromScale: bone.scale.clone() });
    });
    this.mixer.stopAllAction();
    state.action = action;
    action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    action.paused = true; action.time = 0;
    this.current = action;
    if (state.tweenBones.length) {
      this.mixer.update(0);
      for (const pose of state.tweenBones) {
        pose.toPosition = pose.bone.position.clone();
        pose.toQuaternion = pose.bone.quaternion.clone();
        pose.toScale = pose.bone.scale.clone();
      }
    }
  }

  _sampleSourcePose(state, step) {
    state.originalFrame = step.frame;
    state.action.time = step.sampleTime;
    state.tweenProgress = step.tweenProgress;
    // Restore constant destination tracks before positive-time sampling;
    // Three can otherwise retain the previous partial tween in its cache.
    if (state.tweenProgress >= 1 && state.tweenBones?.length) {
      for (const pose of state.tweenBones) {
        pose.bone.position.copy(pose.toPosition);
        pose.bone.quaternion.copy(pose.toQuaternion);
        pose.bone.scale.copy(pose.toScale);
      }
      state.tweenBones = null;
    }
  }

  _applySourceTween(state) {
    if (!state?.tweenBones?.length) return;
    for (const pose of state.tweenBones) {
      pose.bone.position.lerpVectors(pose.fromPosition, pose.toPosition, state.tweenProgress);
      pose.bone.quaternion.slerpQuaternions(pose.fromQuaternion, pose.toQuaternion, state.tweenProgress);
      pose.bone.scale.lerpVectors(pose.fromScale, pose.toScale, state.tweenProgress);
    }
  }

  _applyCastTween() { this._applySourceTween(this.nativeCast); }

  _applyOriginalPose(state) {
    if (this.originalPose && state) this.lastOriginalPose=this.originalPose.apply(
      state.originalFrame,{epoch:this.sourcePoseEpoch});
  }

  // Ordinary ground sit/stand only. Collision adjustment, combat waiting,
  // swimming and the special wait types are separate native parity gaps.
  setWaitType(waitType, { snapshot = false, initial = false } = {}) {
    if (waitType !== 0 && waitType !== 1) return { status:'unsupported', reason:'special-wait-type' };
    const previous = this.waitType;
    this.waitType = waitType;
    this.sitting = waitType === 0;
    if (previous === waitType && !(snapshot && !this.nativeWait && !this.nativeCast
      && !(this.emoteUntil > performance.now()))) return { status:'unchanged' };
    // Snapshot steady state uses Pawn's first CharInfo multiplier (speedMul).
    // AnimEnd's script callback separately supplies literal 1. Initial self
    // UserInfo uses zero tween; remote snapshot admission represents the
    // later steady state, not exact native first-frame/update ordering.
    return this._startWaitSequence(snapshot ? (this.sitting ? 'sitWait' : 'idle')
      : this.sitting ? 'sitDown' : 'standUp', snapshot ? {loopRate:Math.fround(this.speedMul), initial:initial && waitType===1} : {});
  }

  _startWaitSequence(slot, options = {}) {
    const plan = waitSequence(this.waitTable, this.modelId, this.stance, slot, options);
    const successor = plan.loop ? null : waitSequence(this.waitTable, this.modelId, this.stance,
      slot === 'sitDown' ? 'sitWait' : 'idle');
    const channel = createWaitSequence(plan), actions = new Map();
    if (!channel || (successor && successor.status !== 'ready') || !this.mixer || !this.model) {
      return this.lastWaitError = { status:'unsupported', reason:'missing-original-wait-inputs' };
    }
    for (const item of [plan, successor].filter(Boolean)) {
      const admitted = this._waitAction(item);
      if (admitted.status !== 'ready') return this.lastWaitError = admitted;
      actions.set(item.clip, admitted.action);
    }
    this.cancelCast({preserveOriginalCache:true});
    this.nativeWait = { channel, successor, actions, changed:true, generation:this.castGeneration };
    this.lastWaitError = null; this.waitNotifyCount = 0; this.lastWaitNotify = null;
    return { status:'ready' };
  }

  _waitAction(plan) {
    if (plan.status !== 'ready') return plan;
    const base = this.actions[plan.clip];
    if (!base || base.getClip().duration !== plan.sourceEndpoint)
      return { status:'unsupported', reason:'missing-or-mismatched-wait-clip', clip:plan.clip };
    if (!plan.loop) return { status:'ready', action:base };
    this.waitLoopActions ||= new Map();
    const key = `${plan.clip}:${plan.frames}:${plan.sourceRate}`;
    let action = this.waitLoopActions.get(key);
    if (!action) {
      const closed = closeSourceLoop(base.getClip(), plan.frames, plan.sourceRate);
      if (!closed) return { status:'unsupported', reason:'unverified-wait-loop-samples' };
      action = this.mixer.clipAction(closed); this.waitLoopActions.set(key, action);
    }
    return { status:'ready', action };
  }

  _refreshWaitStance() {
    const state = this.nativeWait;
    if (!state) return;
    // All recovered Sit/Stand source names are stance-invariant. Their
    // AnimEnd successor must still resolve the CURRENT weapon's wait slot.
    const prior = state.successor || state.channel.plan;
    const next = waitSequence(this.waitTable, this.modelId, this.stance, prior.slot, {loopRate:prior.rate});
    if (next.status === 'ready' && next.clip === prior.clip) return;
    const admitted = this._waitAction(next);
    if (admitted.status !== 'ready') { this.lastWaitError=admitted; this.cancelCast(); return; }
    if (state.successor) { state.successor=next; state.actions.set(next.clip,admitted.action); }
    else this._startWaitSequence(next.slot, {loopRate:next.rate});
  }

  _advanceWaitSchedule(dt) {
    const state = this.nativeWait;
    if (!state) return;
    const result = advanceWaitPlayback(state, dt);
    for (const step of result.segments || []) {
      if (this.nativeWait !== state) return;
      if (step.changed) this._beginSourcePose(state, state.actions.get(step.plan.clip), step.plan.tween, step.plan);
      this._sampleSourcePose(state, step);
      // These exported mixer poses are compatibility behavior. Native
      // UpdateAnimation advances channels and dispatches AnimEnd separately
      // from GetFrame: do not manufacture a source-cache evaluation for each
      // segment. The final channel is evaluated once below in update().
      this.mixer.update(0); this._applySourceTween(state);
      for (const event of step.events) {
        if (this.nativeWait !== state) return;
        const notify = step.plan.notifies[event.index];
        this.lastWaitNotify = { ...event, notify, clip:step.plan.clip };
        this.waitNotifyCount++;
        const sound = event.dispatch === 'object' && directNotifySound(notify);
        if (sound && this.waitSoundEnabled !== false) audio.playAt(sound.ref, this.group.position,
          { volume:sound.volume, radius:sound.radius,
            isCurrent:()=>this.castGeneration === state.generation && this.waitSoundEnabled !== false });
        this.onWaitNotify?.(this.lastWaitNotify);
      }
      if (this.nativeWait !== state) return;
      this.lastWaitPhase = { clip:step.plan.clip, seq:step.plan.seq, rate:step.plan.rate,
        sampleTime:step.sampleTime, tweenProgress:step.tweenProgress, loop:step.plan.loop };
    }
    if (result.status !== 'ready') { this.lastWaitError=result; this.cancelCast(); }
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
    this.sourcePoseEpoch=(this.sourcePoseEpoch || 0)+1;
    this.originalPose?.restore();
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
          this.group.position.x, this.group.position.z, this.group.position.y) ?? this.group.position.y;
        this.target = null;
      } else {
        const step = Math.min(speed * dt, d);
        vx = (this.target.x - this.group.position.x) / d * (step / dt);
        vz = (this.target.z - this.group.position.z) / d * (step / dt);
        running = this.moveAnim === 'run';
        moving = true;
      }
    }

    this._advanceCastSchedule(dt);

    if (moving) {
      const pos = this.group.position;
      pos.x += vx * dt;
      pos.z += vz * dt;
      pos.y = terrain.heightAtWorld(pos.x, pos.z, pos.y) ?? pos.y;
      // smooth turn toward heading
      const heading = Math.atan2(vx, vz);
      let dy = heading - this.group.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      const maxTurn = TURN_RATE * dt;
      this.group.rotation.y += Math.abs(dy) < maxTurn ? dy : Math.sign(dy) * maxTurn;
      if (!this.nativeCast) { if (this.nativeWait) this.cancelCast(); this.play(running ? 'run' : 'walk'); }
      this.speed = Math.hypot(vx, vz);
    } else if (!this.nativeCast && performance.now() >= (this.emoteUntil || 0)) {
      if (this.sitting && !this.nativeWait && !this.lastWaitError) this._startWaitSequence('sitWait');
      if (this.nativeWait) this._advanceWaitSchedule(dt);
      else if (!this.sitting) this.play('idle');
      this.speed = 0;
    } else {
      this.speed = 0;   // emoting: held by emote(), not re-idled
    }

    this.mixer.update(dt);
    this._applyCastTween();
    this._applySourceTween(this.nativeWait);
    this._applyOriginalPose(this.nativeCast || this.nativeWait);
  }
}
