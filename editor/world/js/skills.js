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
    this.cast = null;          // {skillId, t0, hitTime, raf}
    this.reuse = new Map();    // skillId -> {t0, total} ms (sweep overlays)
    this._seenCancels = new WeakSet();  // skillCancel messages already accounted for
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
    this._absorbCancels();
    this.cast = { skillId, t0: performance.now(), hitTime };
    // NOTE: the cast no longer seeds `reuse`. It used to call
    // setReuse(skillId, hitTime) as a stand-in, which put a 1-second cooldown
    // sweep on toggles (reuse is genuinely 0 there) and a hitTime-long one on
    // anything the server had not yet described. Reuse comes from the server:
    // skillCast.reuse (MagicSkillUse) and skillCoolTime (SkillCoolTime).
    this.castName.textContent = name || `Skill #${skillId}`;
    this.castBar.classList.add('visible');
    // Server-authoritative abort, read straight off the inbound ring: the
    // gateway now forwards MagicSkillCanceled as `skillCancel`. Polled rather
    // than wired with net.on() because NetClient keeps ONE handler per op and
    // main.js owns the wiring (same constraint as SkillFx._pump below).
    //
    // On a TIMER, not on the animation frame. requestAnimationFrame stops in a
    // background tab and starves under load — one headless run here went 11 s
    // without a frame — and a cast bar whose end depends on frames outlives
    // the cast. The fill is a visual and stays on rAF; the LIFECYCLE does not.
    this.cast.poll = setInterval(() => {
      if (!this.cast) return;
      if (this._cancelledByServer()
          || performance.now() - this.cast.t0 >= this.cast.hitTime) this.stopCastBar();
    }, 50);
    const tick = () => {
      if (!this.cast) return;
      const f = Math.min(1, (performance.now() - this.cast.t0) / this.cast.hitTime);
      this.castFill.style.width = (f * 100).toFixed(1) + '%';
      if (f < 1) this.cast.raf = requestAnimationFrame(tick);
      else this.stopCastBar();
    };
    tick();
  }

  stopCastBar() {
    if (this.cast && this.cast.raf) cancelAnimationFrame(this.cast.raf);
    if (this.cast && this.cast.poll) clearInterval(this.cast.poll);
    this.cast = null;
    this.castBar.classList.remove('visible');
  }

  /** The server aborted the in-flight cast. The authoritative signals are
   *  MagicSkillCanceled (gateway op `skillCancel`) and sysMsg 27
   *  CASTING_INTERRUPTED / 748 DIST_TOO_FAR_CASTING_STOPPED.
   *
   *  A bare ActionFailed is NOT one of them, and main.js calls this from its
   *  actionFailed handler — hence the guard. Captured live
   *  (capture-skills.js, MOVE-WHILE-CASTING probe): a movement click 1.5 s
   *  into a 7816 ms Heal produced two bare ActionFailed packets while the
   *  server cast on to completion (skillLaunch at +7446 ms, effects at
   *  +7839 ms). aCis sends that ActionFailed from
   *  PlayableAI.onIntentionMoveTo whenever getCast().isCastingNow(); the same
   *  packet also answers a reuse denial and an invalid target. Cancelling on
   *  it desynced the client from every cast the player walked during. */
  cancelCast() {
    if (!this._serverAbortEvidence()) return;
    this._forceCancel();
  }

  /** Cancel with no evidence check — for callers that already know (tests,
   *  world exit, the skillCancel op itself). */
  _forceCancel() {
    const id = this.cast && this.cast.skillId;
    this.stopCastBar();
    if (id != null) this.finishCast(id);
  }

  /** Tail of the inbound message ring, or null when there is no net client
   *  (offline/solo and unit tests). */
  _inboundTail(scan = 8) {
    const w = typeof window !== 'undefined' && window.__world;
    const log = w && w.net && w.net.log;
    if (!log || !log.length) return null;
    return log.slice(Math.max(0, log.length - scan)).filter(m => m.dir === 'in');
  }

  /** True when an authoritative abort is in the recent inbound tail. With no
   *  ring available at all the caller is trusted (keeps offline callers and
   *  the existing suites working). */
  _serverAbortEvidence() {
    const tail = this._inboundTail();
    if (tail === null) return true;
    return tail.some(m => m.op === 'skillCancel'
      || (m.op === 'sysMsg' && (m.id === 27 || m.id === 748)));
  }

  /** A skillCancel naming our own caster id that arrived AFTER this bar
   *  started. Ring entries are fresh objects (net.js pushes {dir, ...msg}), so
   *  identity in a WeakSet is a safe "already accounted for" marker and ring
   *  rotation cannot replay one — the same trick SkillFx._pump uses. */
  _cancelledByServer() {
    if (!this.cast) return false;
    const tail = this._inboundTail(24);
    if (!tail) return false;
    const w = typeof window !== 'undefined' && window.__world;
    const selfId = w && w.net && w.net.selfId;
    return tail.some(m => m.op === 'skillCancel'
      && (selfId == null || m.casterId === selfId)
      && !this._seenCancels.has(m));
  }

  /** Everything already in the ring predates this cast: absorb it so only a
   *  NEW MagicSkillCanceled kills the bar. */
  _absorbCancels() {
    for (const m of this._inboundTail(24) || []) {
      if (m.op === 'skillCancel') this._seenCancels.add(m);
    }
  }

  clear() {
    this.skills.clear();
    this.stopCastBar();
  }
}

// The skill CLASSIFICATION (kind / target / retail tooltip numbers) lives in
// js/skillclass.js so it can be imported without three.js -- verify_skillclass
// runs it in plain node. Re-exported here because main.js and the UI already
// import from this module.
export { SkillClass, loadSkillClass, skillClassLoaded, setSkillClassData }
  from './skillclass.js';

// skill launch flash: small additive sprite that pops and fades
let _activeFx = null;   // the live SkillFx (registered at construction)

/** The SkillFx instance main.js created — for modules that must spawn an
 *  effect without going through main.js's handlers (e.g. entities.js
 *  covering SELF-target skillLaunches, which main.js's entityHeadPos
 *  cannot resolve). */
export function activeSkillFx() { return _activeFx; }

export class SkillFx {
  constructor(scene) {
    this.scene = scene;
    this.fx = [];
    this.tex = makeGlowTexture();
    this.vfx = new SkillVfx(scene);      // the retail effect player
    this._seen = new WeakSet();          // skill messages already turned into FX
    _activeFx = this;
  }

  /** Drive the retail effects off the net message ring, once per frame.
   *
   *  The obvious hook — registering our own net.on('skillCast') — is not
   *  available: NetClient keeps ONE handler per op (net.js `handlers[op] = fn`,
   *  so we would displace main.js's), and window.__world.net is a read-only
   *  facade that never exposes the handler map anyway. What it does expose is
   *  `log`, the ring of every inbound message (capped at 200, entries pushed as
   *  fresh objects). So we poll it: each frame, walk the tail and spawn effects
   *  for any skillCast/skillLaunch not seen before. Identity via WeakSet means
   *  ring rotation cannot cause a replay, and the worst-case latency is one
   *  frame. This keeps every skill visual inside files this worker owns —
   *  main.js needs no edit.
   */
  _pump() {
    const w = typeof window !== 'undefined' && window.__world;
    if (!w || !w.net || !w.net.log) return;
    const log = w.net.log;
    for (let i = Math.max(0, log.length - 24); i < log.length; i++) {
      const m = log[i];
      if (!m || m.dir !== 'in') continue;
      if (m.op !== 'skillCast' && m.op !== 'skillLaunch') continue;
      if (this._seen.has(m)) continue;
      this._seen.add(m);
      // half = the actor's collision half-height, which is where UE measures
      // effect offsets from (see skillvfx.js Instance._place)
      // yaw = the actor's facing (group.rotation.y, 0 = +Z_three per
      // coords.l2HeadingToThreeYaw), which is what a SkillAction_LocateEffect
      // with bUseCharacterRotation spawns its effect in.
      const anchors = {
        caster: { pos: () => entityPos(m.casterId), half: entityHalf(m.casterId),
                  yaw: () => entityYaw(m.casterId) },
        // a self-target skill names the caster; entityPos resolves the local
        // player too, so this covers both without special-casing
        target: { pos: () => entityPos(m.targetId) || entityPos(m.casterId),
                  half: entityHalf(m.targetId) || entityHalf(m.casterId),
                  yaw: () => entityYaw(m.targetId) ?? entityYaw(m.casterId) },
      };
      try {
        if (m.op === 'skillCast') this.vfx.cast(m.skillId, anchors);
        else this.vfx.launch(m.skillId, anchors);
      } catch (e) { /* a broken visual must never stall the frame loop */ }
    }
  }

  // THE SOULSHOT GLINT IS GONE, and the colour argument is what identifies it.
  //
  // Two callers exist in the whole client (grep `.flash(`):
  //   entities.js:578   fx.flash(_headPos)                  — no colour
  //   main.js:1341      skillFx.flash(shotPos, 0xfff2a8)    — the shot glint
  // so "a colour was passed" means "this is the soulshot glint", and that
  // glint is INVENTED. It is `makeGlowTexture()` — the same additive sprite
  // this class pops for anything without retail data — tinted with a literal
  // 0xfff2a8 that appears in no client table, fired off the Attack packet's
  // HITFLAG_SS. That is exactly the "animation that's used everywhere"
  // complaint, and there is nothing to replace it with:
  //
  //   * The retail trigger for a shot is not the hit at all. aCis
  //     SoulShots.useItem charges the weapon and broadcasts
  //     MagicSkillUse(player, player, item.getSkills()[0].getId(), 1, 0, 0)
  //     in radius 600 — item_skill 2039/2047/2061 and 2150..2164 in the
  //     datapack's items XML. The gateway already forwards that as skillCast,
  //     so _pump() below sees it like any other cast.
  //   * skillgrp.dat gives all 18 of those skills animation "" and hit_time 0
  //     (assets/gamedata/skillgrp.json), so retail plays NO cast gesture —
  //     clipForSkill() already returns null for them, correctly.
  //   * skillsoundgrp.dat gives them SkillSound.soul_shot_cast /
  //     spirits_shot_cast, already bound in assets/audio/bindings.json and
  //     already played by main.js's skillCast handler via gameSound.cast().
  //   * The client's skill -> effect table (animations/Skill.usk, 244
  //     SkillVisualEffect objects named by skill id) has NO entry for any of
  //     the 18. The only shot effects in LineageEffect.u are
  //     it_soul_shot_d_ca and it_spirit_shot_d_ca, and Skill.usk binds them
  //     ONLY to the BEAST shots (skill 2033 on bones soulshot1+soulshot2,
  //     skill 2008 on soulshot1) — bones that exist only in
  //     LineageMonsters*.ukx, never in Fighter.ukx. Binding a pet effect to a
  //     player would be a guess, so it is not done.
  //   * DOCUMENTED GAP: engine.dll does carry a per-attack shot parameter —
  //     Engine.u declares SoulshotGrade (int) and bSpirit (bool) on both
  //     NAttackActionParam and NPrimeActionParam, and engine.dll exports
  //     FL2GameData::SoulShotDataLoad — but no .dat in the client's system/
  //     directory holds that table and no decodable file binds those fields
  //     to an asset. Whatever the retail client draws on a shot-charged swing
  //     is selected in native code we cannot read. It stays undrawn rather
  //     than approximated.
  //
  // The uncoloured caller is untouched: a self-target skillLaunch that the
  // retail tables do not bind still gets the neutral pop, and any launch
  // already drawn from the retail tables by _pump() suppresses it.
  flash(worldPos, color = null, size = 0.6) {
    if (color != null) return;          // the invented shot glint: draw nothing
    const w = typeof window !== 'undefined' && window.__world;
    if (w && lastSkillMsg(w.net.log, { op: 'skillLaunch' })) return;
    this._pop(worldPos, 0x80c0ff, size);
  }

  // Provenance tag, read by verify_soulshot.js and by anything else that has
  // to tell an AUTHORED sprite from a sourced one. SkillVfx tags its own
  // objects `skillvfx.json` / `skillmesh.json` (skillvfx.js) — those come out
  // of the decoded retail tables. Anything this class pops does not, hence
  // 'authored-pop'. The tag used to read 'soulshot-glint', which was wrong for
  // the one caller that survives (entities.js's self-target launch) and is now
  // wrong for the soulshot too, since that glint is gone.
  _tag(obj, kind, skillId) {
    obj.userData.skillFx = { kind, skillId, source: 'authored-pop' };
  }

  _pop(worldPos, color, size = 0.6, skillId = null, kind = 'pop') {
    const mat = new THREE.SpriteMaterial({
      map: this.tex, color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(worldPos);
    s.scale.setScalar(size * 0.4);
    this._tag(s, kind, skillId);
    this.scene.add(s);
    this.fx.push({ s, t0: performance.now(), size, mode: 'pop' });
  }

  update() {
    this._pump();             // net-log -> retail effects
    this.vfx.update();        // retail effect player
    const now = performance.now();
    for (const f of [...this.fx]) {
      // only the 'pop' glint survives here (main.js's soulshot flash)
      const t = (now - f.t0) / 450;
      if (t >= 1) { this._remove(f); continue; }
      f.s.scale.setScalar(f.size * (0.4 + 1.8 * t));
      f.s.material.opacity = 0.95 * (1 - t);
    }
  }

  _remove(f) {
    this.scene.remove(f.s);
    f.s.material.dispose();
    if (f.s.geometry) f.s.geometry.dispose();
    this.fx.splice(this.fx.indexOf(f), 1);
  }

  clear() {
    for (const f of [...this.fx]) this._remove(f);
    this.vfx.clear();
  }
}

import * as THREE from 'three';
import { SkillVfx } from './skillvfx.js';
import { lastSkillMsg } from './skillfx_anim.js';

// world position of any entity, including the local player (self is not in
// the EntityManager — main.js keeps it as a separate Character)
function entityPos(id) {
  const w = typeof window !== 'undefined' && window.__world;
  if (!w) return null;
  if (w.net.selfId === id && w.character) return w.character.group.position;
  const e = w.entities && w.entities.getEntity(id);
  return e ? e.group.position : null;
}

// Half of the actor's rendered height — UE measures effect offsets from the
// centre of the collision cylinder, the client's groups sit at the feet.
function entityHalf(id) {
  const w = typeof window !== 'undefined' && window.__world;
  if (!w) return null;
  if (w.net.selfId === id && w.character) return (w.character.heightM || 1.7) / 2;
  const e = w.entities && w.entities.getEntity(id);
  return e ? (e.heightM || 1.7) / 2 : null;
}

// The actor's facing, for bUseCharacterRotation. null when the actor is gone.
function entityYaw(id) {
  const w = typeof window !== 'undefined' && window.__world;
  if (!w) return null;
  if (w.net.selfId === id && w.character) return w.character.group.rotation.y;
  const e = w.entities && w.entities.getEntity(id);
  return e ? e.group.rotation.y : null;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
