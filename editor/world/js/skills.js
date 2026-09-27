// M4/M5: casting bar + per-skill cooldown state + skill visual effects.
// The retail shortcut UI lives in js/ui/shortcutwnd.js; the invented
// 10-slot palette that used to render here is deleted. What remains is
// what other UI needs: castSkill() (the click), finishCast(), the reuse
// sweep data, and the casting bar.
//
// Everything here is now anchored to a packet timeline recorded from the
// running aCis (gateway/test/capture-skills.js, JSON alongside it):
//   MagicSkillUse  hitTime + reuseDelay in ms; hitTime 0 / reuse 0 for
//                  toggles and instant skills
//   SetupGauge     the cast bar, sent ONLY when hitTime > 410
//   MagicSkillLaunched  at hitTime-400 — NOT the end of the cast
//   effects        at hitTime
//   ActionFailed   NOT an abort (a move click during a cast produces one
//                  while the cast runs on to completion)
//   MagicSkillCanceled  IS the abort (gateway op `skillCancel`)

export class SkillBar {
  constructor(rootEl, castBarEl, castFillEl, castNameEl, { onCast } = {}) {
    // rootEl is legacy (the deleted palette container); may be null
    this.castBar = castBarEl;
    this.castFill = castFillEl;
    this.castName = castNameEl;
    this.onCast = onCast || (() => {});
    this.skills = new Map();   // skillId -> {level, cooling, timer}
    this.cast = null;          // {skillId, t0, hitTime, raf, timer}
    this.reuse = new Map();    // skillId -> {t0, total} ms (sweep overlays)
  }

  /** Server-authoritative reuse (skillCoolTime op — total/left in ms
   *  after the caller's unit conversion) or the cast lock's own hitTime;
   *  the windows sweep their overlays off this. */
  setReuse(skillId, ms, leftMs = ms) {
    if (!(ms > 0)) return;
    this.reuse.set(skillId, { t0: performance.now() - (ms - leftMs), total: ms });
  }

  /** {frac, left} for an active cooldown, else null. */
  reuseLeft(skillId, now = performance.now()) {
    const r = this.reuse.get(skillId);
    if (!r) return null;
    const left = r.total - (now - r.t0);
    if (left <= 0) { this.reuse.delete(skillId); return null; }
    return { frac: left / r.total, left };
  }

  register(skills) {
    this.skills.clear();
    for (const s of skills) this.skills.set(s.id, { level: s.level, cooling: false, timer: null });
  }

  /** The click gate. There is no cooldown gate here, on purpose.
   *
   *  What used to be here was a `cooling` flag set on the click and cleared
   *  either by skillLaunch or by a 3000 ms fallback timer. Both numbers were
   *  invented, and the first one is actively wrong: skillLaunch arrives at
   *  hitTime-400 (captured live — Wind Strike, 6253 ms hitTime, launch at
   *  +5851 ms), which is 3.5 s before its 9380 ms reuse is up, so the slot
   *  re-enabled itself long before the skill was really ready.
   *
   *  Refusing the click on the SERVER's reuse instead would also be wrong.
   *  aCis has a system message for exactly this case — 48 S1_PREPARED_FOR_REUSE,
   *  sent from CreatureCast.canAttemptCast when isSkillDisabled — and captured
   *  live: a second Heal inside its 15633 ms reuse answered sysMsg 48 +
   *  ActionFailed. A message the server only ever needs if the client sends
   *  the request is evidence that the retail client sends it. So the click
   *  goes out and the server decides; `reuse` stays what it is, the data
   *  behind the sweep overlays. */
  castSkill(skillId) {
    return this.onCast(skillId) !== false;
  }

  /** Called from the skillLaunch handler. Nothing to unlock any more — the
   *  reuse sweep is server-sourced and expires on its own — so this only
   *  drops an entry the server has reported as having no reuse at all. */
  finishCast(skillId) {
    const r = this.reuse.get(skillId);
    if (r && r.total <= 0) this.reuse.delete(skillId);
  }

  /** aCis sends SetupGauge(BLUE, hitTime) — and schedules the cast at all —
   *  only when hitTime > 410; at or below that CreatureCast.doCast sets
   *  _hitTime = 0 and the launch fires immediately, so retail draws NO bar.
   *  Toggles and instant/triggered skills come through with hitTime 0 exactly
   *  (captured live: Vicious Stance, Relax, and the level-up skills 2278/2282
   *  all arrive as MagicSkillUse hitTime=0 reuse=0). */
  static get MIN_GAUGE_MS() { return 410; }

  // casting bar for the local player's in-flight cast
  startCastBar(skillId, level, hitTime, name) {
    this.stopCastBar();
    // No invented duration. `hitTime || 1000` used to turn every toggle press
    // and every server-side instant skill into a phantom 1-second cast bar for
    // a skill the player never pressed.
    if (!(hitTime > SkillBar.MIN_GAUGE_MS)) return;
    const cast = this.cast = { skillId, t0: performance.now(), hitTime };
    // NOTE: the cast no longer seeds `reuse`. It used to call
    // setReuse(skillId, hitTime) as a stand-in, which put a 1-second cooldown
    // sweep on toggles (reuse is genuinely 0 there) and a hitTime-long one on
    // anything the server had not yet described. Reuse comes from the server:
    // skillCast.reuse (MagicSkillUse) and skillCoolTime (SkillCoolTime).
    this.castName.textContent = name || `Skill #${skillId}`;
    this.castBar.classList.add('visible');
    // main.js dispatches server cancellation directly. Expiration also has
    // a timer because animation frames stop in background tabs. Both callbacks
    // belong to this cast and cannot stop a newer cast if already queued.
    cast.timer = setTimeout(() => {
      if (this.cast === cast) this.stopCastBar();
    }, hitTime);
    const tick = () => {
      if (this.cast !== cast) return;
      const f = Math.min(1, (performance.now() - cast.t0) / cast.hitTime);
      this.castFill.style.width = (f * 100).toFixed(1) + '%';
      if (f < 1) cast.raf = requestAnimationFrame(tick);
      else this.stopCastBar();
    };
    tick();
  }

  stopCastBar() {
    if (this.cast?.raf != null) cancelAnimationFrame(this.cast.raf);
    if (this.cast?.timer != null) clearTimeout(this.cast.timer);
    this.cast = null;
    this.castBar.classList.remove('visible');
  }

  /** Call only from an explicit cancellation event. main.js filters the
   *  caster and retains the existing aCis system-message compatibility rule.
   *  A bare ActionFailed carries no cancellation evidence. */
  cancelCast() {
    const id = this.cast && this.cast.skillId;
    this.stopCastBar();
    if (id != null) this.finishCast(id);
  }

  clear() {
    this.skills.clear();
    this.reuse.clear();
    this.stopCastBar();
  }
}

// The skill CLASSIFICATION (kind / target / retail tooltip numbers) lives in
// js/skillclass.js so it can be imported without three.js -- verify_skillclass
// runs it in plain node. Re-exported here because main.js and the UI already
// import from this module.
export { SkillClass, loadSkillClass, skillClassLoaded, setSkillClassData }
  from './skillclass.js';

// Explicitly bound original skill effects; legacy flash calls are no-ops.
let _activeFx = null;   // the live SkillFx (registered at construction)

/** The SkillFx instance main.js created — for modules that must spawn an
 *  effect without going through main.js's handlers (e.g. entities.js
 *  covering SELF-target skillLaunches, which main.js's entityHeadPos
 *  cannot resolve). */
export function activeSkillFx() { return _activeFx; }

export class SkillFx {
  constructor(scene, { getEntity = () => null, onNativeSound = () => {} } = {}) {
    this.scene = scene;
    this.fx = [];                       // compatibility: no authored sprites
    this.vfx = new SkillVfx(scene);
    this.getEntity = getEntity;
    this.ready = vfxIndex().then(index => { this.index=index; return index; });
    this.onNativeSound=onNativeSound;
    this.nativeContexts=new Map();
    this.generation = 0;
    this.castGeneration = new Map();
    _activeFx = this;
  }

  /** Reserve a native Agent cast at receipt. A cold source index remains on
   *  the existing provisional path for this entire cast; never switch clocks
   *  after playing an earlier packet effect or voice. */
  prepareCast(msg) {
    this.cancel(msg.casterId);
    this.nativeContexts.delete(msg.casterId);
    const agent=skillAgentBinding(this.index,msg.skillId,msg.level);
    const caster=this.getEntity(msg.casterId);
    if (agent.status!=='resolved-source-object' || !caster?.startCastSchedule || caster.dead || !(msg.hitTime>0)) return null;
    const target=this.getEntity(msg.targetId) || null;
    const context={skillId:msg.skillId,level:msg.level,
      retired:false,state:null,associations:[],actorIds:new Map([[caster,msg.casterId]])};
    if (target) context.actorIds.set(target,msg.targetId);
    this.nativeContexts.set(msg.casterId,context);
    const isCurrent=()=>!context.retired && this.nativeContexts.get(msg.casterId)===context
      && this.getEntity(msg.casterId)===caster && caster.castGeneration===context.generation;
    const reject=reason=>{context.retired=true;context.reason=reason;this._releaseNativeActors(context);};
    return {
      configure:({schedule,modelSource})=>{
        if (context.retired || context.completed || this.nativeContexts.get(msg.casterId)!==context) return;
        context.state=createPawnSkill({schedule,modelSource,agent,caster,mainTarget:target,
          skillId:msg.skillId,level:msg.level});
        if (context.state.status!=='ready') {reject(context.state.reason);return;}
        for (const association of context.associations) associatePawnSkill(context.state,association);
        context.associations=[];
      },
      start:generation=>{context.generation=generation;},
      tick:tick=>{
        if (!isCurrent() || context.completed || context.state?.status!=='ready') return;
        const result=consumePawnSkillTick(context.state,{...tick,
          actionTargetPresent:!!target && this.getEntity(msg.targetId)===target});
        // Inspector diagnostics must not retain removed Character/GLTF graphs.
        if (result.status!=='ready' || result.completion || result.dispatches.length)
          this.lastNativeTick={...result,dispatches:(result.dispatches||[]).map(d=>({...d,
            plan:{status:d.plan.status,calls:d.plan.calls.map(c=>({sourceIndex:c.sourceIndex,
              targetSource:c.targetSource,associatedIndex:c.associatedIndex}))}}))};
        if (result.status!=='ready') {reject(result.reason);return;}
        for (const dispatch of result.dispatches) {
          if (!isCurrent()) break;
          this.vfx.dispatchActions(dispatch.plan,actor=>this._anchor(context.actorIds.get(actor),actor),isCurrent);
          if (dispatch.soundType) this.onNativeSound({type:dispatch.soundType,skillId:msg.skillId,
            level:msg.level,caster,isCurrent});
        }
        if (tick.complete) {context.completed=true;this._releaseNativeActors(context);}
      },
      cancel:()=>reject('cast-retired'),reject,
    };
  }

  /** A received launch adds source-ordered associated actors; it cannot fire
   *  or revive native Agent effects. Keep completed/cancelled contexts as
   *  tombstones until the next cast so late packets cannot enter the old path. */
  associate(msg) {
    const context=this.nativeContexts.get(msg.casterId);
    if (!context) return false;
    if (context.retired || context.completed || context.skillId!==msg.skillId) return true;
    const target=this.getEntity(msg.targetId);
    if (!target) return true;
    context.actorIds.set(target,msg.targetId);
    const association={skillId:msg.skillId,target};
    if (context.state) associatePawnSkill(context.state,association);
    else context.associations.push(association);
    return true;
  }

  _anchor(id, actor = this.getEntity(id)) {
    const current = () => actor && this.getEntity(id) === actor;
    return {
      pos: () => current() ? actor.group.position : null,
      yaw: () => current() ? actor.group.rotation.y : null,
      node: name => current() ? actor.group.getObjectByName(name) : null,
      // Existing renderer uses measured model height. Native collision/origin
      // placement is a separate unresolved rule, not established by binding.
      half: actor?.heightM > 0 ? actor.heightM / 2 : null,
    };
  }

  _releaseNativeActors(context) {
    cancelPawnSkill(context.state);
    // Preserve only a small late-packet tombstone. Already scheduled callbacks
    // retain their own guarded anchors until executed or cleared.
    context.state=context.state?{status:context.state.status,active:false}:null;
    context.associations=[];context.actorIds.clear();
  }

  /** Consume the actual gateway event. Debug log size and animation-frame
   *  packet bursts cannot discard or replay effects. Metadata completion is
   *  retired with the online session; anchors retain the same actor identity. */
  async handle(msg) {
    if (!msg || !['skillCast', 'skillLaunch'].includes(msg.op)) return false;
    const generation = this.generation;
    if (msg.op === 'skillCast') this.cancel(msg.casterId);
    const castGeneration = this.castGeneration.get(msg.casterId);
    const anchors = { caster: this._anchor(msg.casterId), target: this._anchor(msg.targetId) };
    await this.ready;
    if (generation !== this.generation || castGeneration !== this.castGeneration.get(msg.casterId)
        || !anchors.caster.pos()) return false;
    return msg.op === 'skillCast'
      ? this.vfx.cast(msg.skillId, anchors, msg.level)
      : this.vfx.launch(msg.skillId, anchors, msg.level);
  }

  // Legacy calls carry no original binding and must never create a flash.
  flash() {}

  update() { this.vfx.update(); }

  cancel(casterId) {
    const context=this.nativeContexts.get(casterId);
    if (context) {context.retired=true;this._releaseNativeActors(context);}
    this.castGeneration.set(casterId, (this.castGeneration.get(casterId) || 0) + 1);
  }

  clear() {
    this.generation++;
    this.castGeneration.clear();
    for (const context of this.nativeContexts.values()) {context.retired=true;this._releaseNativeActors(context);}
    this.nativeContexts.clear();
    this.lastNativeTick=null;
    this.vfx.clear();
  }
}

import { SkillVfx, vfxIndex } from './skillvfx.js';

import { skillAgentBinding } from './skillvfx-binding.js';
import { createPawnSkill,associatePawnSkill,cancelPawnSkill,consumePawnSkillTick } from './pawnskill.js';
