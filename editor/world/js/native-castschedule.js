// Elbera Tools: ordinary APawn::InitSkillProcess, Engine.dll RVA 0x1ef470.
// Source proof: docs/native-cast-scheduler-evidence.md and
// docs/native-cast-agent-evidence.md. tools/ui/check_castschedule_runtime.py compares this planner
// with the existing evaluator of original decoded instructions.
// No playback, particles, target association or notify delivery happens here.
// Float64 intermediates + original Float32 stores are not x87 bit parity.
import { nativeSkillSlots } from './native-skillanim.js';

const f32 = Math.fround;
const TWEEN = f32(.2), MIN_LEAD = f32(.15), PROJECTILE_LEAD = f32(.4);
const RATE_EPSILON = .0001; // source double at RVA 0x5a74a8
const FLEXIBLE = Object.freeze({
  A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1, I: 1,
  J: 0, K: 0, L: 0, MS01: 1,
});
const unsupported = (reason, detail = {}) => ({ status: 'unsupported', reason, ...detail });
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** All 32 original selector branches, with Clear's -1 for nonflexible codes. */
export function nativeCastFlexIndex(animation) {
  if (!nativeSkillSlots(animation)) return null;
  return FLEXIBLE[animation.toUpperCase()] ?? -1;
}

/** Pure schedule, in seconds. Inputs must be original sequence metadata:
 *  - animation/style are exact skillgrp.animation/cast_style, not categories;
 *  - hitTimeMs is the packet integer; speedRate is native SkillSpeedRate;
 *  - agent is the exact-level binding status, with entry.f for a resolved Agent;
 *  - phases follow SetSkillAnim order and require real renderable clip names;
 *  - notify.t is original normalized time, never glTF u/seconds; isAttackShot
 *    is original class identity/ancestry. Preserve serialized notify order.
 * [] proves no notifies; absent metadata is unsupported, not an empty list.
 * A ready result proves the bounded timing calculation, not animation or VFX
 * playback fidelity. Native elapsed time advances strictly beyond each due;
 * tween is already included in the cumulative deadlines and shotTime.
 */
export function planNativeCastSchedule(input) {
  if (!input || typeof input !== 'object') return unsupported('missing-input');
  const { animation, style, hitTimeMs, speedRate, agent, phases } = input;
  const slots = nativeSkillSlots(animation), flexIndex = nativeCastFlexIndex(animation);
  if (!slots) return unsupported('unknown-animation');
  if (!Number.isInteger(style) || style <= 0 || style > 0x7fffffff) return unsupported('invalid-style');
  if (style === 13) return unsupported('style-13');
  if (!Number.isInteger(hitTimeMs) || hitTimeMs <= 0 || hitTimeMs > 0x7fffffff) {
    return unsupported('invalid-hit-time');
  }
  if (!finite(speedRate) || !(f32(speedRate) > 0) || !finite(f32(speedRate))) {
    return unsupported('invalid-speed-rate');
  }
  const hitTime = f32(hitTimeMs / 1000), speed = f32(speedRate);
  let lead;
  if (agent?.status === 'source-none') {
    lead = [2, 5, 8, 10].includes(style) ? PROJECTILE_LEAD
      : [3, 12].includes(style) ? 0 : style === 14 ? 2 : MIN_LEAD;
  } else if (agent?.status === 'resolved-source-object') {
    if (!finite(agent.entry?.f) || !finite(f32(agent.entry.f)) || agent.entry.f < 0) {
      return unsupported('invalid-agent-flight-time');
    }
    const flight = f32(agent.entry.f);
    lead = flight >= MIN_LEAD ? flight : style === 3 ? 0 : MIN_LEAD;
  } else {
    return unsupported('unresolved-agent', { agentStatus: agent?.status ?? null });
  }
  if (!Array.isArray(phases) || phases.length !== slots.length) return unsupported('phase-count');
  const source = [];
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    if (!phase || phase.frames == null || phase.rate == null) return unsupported('missing-source-sequence', { phase: i });
    if (phase.slot != null && phase.slot !== slots[i]) return unsupported('phase-slot', { phase: i });
    if (!Number.isInteger(phase.frames) || phase.frames <= 0 || phase.frames > 0x7fffffff
        || !finite(phase.rate) || !(f32(phase.rate) > 0) || !finite(f32(phase.rate))) {
      return unsupported('invalid-source-sequence', { phase: i });
    }
    if (!Array.isArray(phase.notifies)) return unsupported('missing-source-notifies', { phase: i });
    for (let j = 0; j < phase.notifies.length; j++) {
      const notify = phase.notifies[j];
      if (!notify || typeof notify.isAttackShot !== 'boolean'
          || (notify.isAttackShot && (!finite(notify.t) || notify.t < 0 || notify.t > 1))) {
        return unsupported('invalid-source-notify', { phase: i, notify: j });
      }
    }
    if (typeof phase.clip !== 'string' || !phase.clip.trim()) return unsupported('missing-rendered-clip', { phase: i });
    const sourceRate = f32(phase.rate), sourceDuration = f32(phase.frames / sourceRate);
    if (!finite(sourceDuration) || !(sourceDuration > 0)) return unsupported('invalid-source-duration', { phase: i });
    source.push({ clip: phase.clip, slot: slots[i], frames: phase.frames, sourceRate,
      sourceDuration, sourceEndpoint: (phase.frames - 1) / sourceRate,
      scanDuration: i === flexIndex ? 0 : sourceDuration, loop: i === flexIndex,
      notifies: phase.notifies.map(notify => ({ ...notify })) });
  }

  // InitSkillProcess 1ef570..617: scan phases backward, ignoring flexible
  // phases. The notify helper returns the last matching array entry, even
  // when its time is zero; it does not seek an earlier positive one.
  let shotPhase = -1, shotOffset = 0, sourceAttackTime = 0, shotNotify = null;
  for (let i = source.length - 1; i >= 0; i--) {
    if (i === flexIndex) continue;
    if (shotOffset > 0) {
      sourceAttackTime = f32(sourceAttackTime + source[i].scanDuration);
    } else {
      const notes = phases[i].notifies;
      const j = notes.findLastIndex(n => n.isAttackShot);
      shotPhase = i;
      shotOffset = j < 0 ? 0 : f32(f32(notes[j].t) * source[i].scanDuration);
      sourceAttackTime = shotOffset;
      shotNotify = j < 0 ? null : { phase: i, index: j, t: f32(notes[j].t) };
    }
  }
  let shotFallback = false;
  if (sourceAttackTime === 0) {
    // Native 1ef627..65a sums forward here; preserve Float32 addition order.
    shotFallback = true;
    shotPhase = source.length - 1;
    shotOffset = source[shotPhase].scanDuration;
    sourceAttackTime = source.reduce((sum, phase) => f32(sum + phase.scanDuration), 0);
    shotNotify = null;
  }
  if (!(sourceAttackTime > 0) || !finite(sourceAttackTime)) return unsupported('degenerate-attack-time');

  let rate, tween, flexibleDuration = 0;
  if (flexIndex >= 0) {
    flexibleDuration = f32(hitTime - lead - (sourceAttackTime + TWEEN) / speed);
    tween = f32(TWEEN / speed);
    rate = speed;
    if (flexibleDuration < 0) {
      const remaining = hitTime - lead - TWEEN / speed;
      // 1ef78e stores before the comparison; division still uses the x87
      // stack value, not that rounded copy.
      if (f32(remaining) > RATE_EPSILON) {
        rate = f32(sourceAttackTime / remaining);
        flexibleDuration = 0;
      } else {
        // Native retains a negative flexible duration here. No clamp or
        // substitute playback policy is established for this input domain.
        return unsupported('negative-flexible-budget');
      }
    }
  } else {
    const remaining = hitTime - lead - TWEEN;
    if (!(remaining > 0)) return unsupported('nonpositive-playback-budget');
    rate = f32(sourceAttackTime / remaining);
    tween = TWEEN;
  }
  if (!finite(rate) || !(rate > 0) || !finite(tween) || !(tween > 0)
      || !finite(flexibleDuration)) return unsupported('degenerate-playback-rate');

  let previous = tween, shotTime;
  const planned = source.map((phase, i) => {
    if (i === shotPhase) shotTime = f32(previous + shotOffset / rate);
    let due = f32(previous + (phase.loop ? flexibleDuration : phase.scanDuration / rate));
    if (!phase.loop && i === 0 && source.length > 1 && lead >= MIN_LEAD) {
      // 1ef8e7 stores due, then 1ef905..919 reloads/corrects/stores it.
      due = f32(due - (due / (hitTime - lead)) * MIN_LEAD);
    }
    previous = due;
    return { ...phase, due };
  });
  if (!finite(shotTime) || shotTime < 0
      || planned.some((phase, i) => !finite(phase.due) || phase.due < 0
        || (i > 0 && phase.due < planned[i - 1].due))) return unsupported('degenerate-deadlines');
  return { status: 'ready', animation: animation.toUpperCase(), style, hitTime,
    speedRate: speed, lead, rate, tween, flexIndex, flexibleDuration,
    shotTime, shotPhase, shotOffset, sourceAttackTime, shotNotify, shotFallback,
    phases: planned, precision: 'float64-intermediates-float32-stores' };
}
