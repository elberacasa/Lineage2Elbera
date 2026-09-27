// Elbera Tools: ordinary native phase clock over the current exported poses.
// Source: docs/native-cast-scheduler-evidence.md and native-animation-terminal-evidence.md.
// This supplies phase selection/loop period, not native quaternion interpolation.
import { advanceAnimationChannel, validateAnimationNotifies } from './animnotify-clock.js';

export function createCastPlayback(schedule, { notifiesEnabled = false } = {}) {
  const finite = value => typeof value === 'number' && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
  if (schedule?.status !== 'ready' || !Array.isArray(schedule.phases) || !schedule.phases.length
    || typeof notifiesEnabled !== 'boolean'
    || !finite(schedule.rate) || !(Math.fround(schedule.rate) > 0)
    || !finite(schedule.tween) || schedule.tween < 0
    || (schedule.tween > 0 && !(Math.fround(schedule.tween) > 0))
    || schedule.phases.some(phase => !phase || !Number.isInteger(phase.frames) || phase.frames < 2
      || !finite(phase.sourceRate) || !(Math.fround(phase.sourceRate) > 0)
      || !finite(phase.sourceEndpoint) || !(Math.fround(phase.sourceEndpoint) > 0)
      || !finite(phase.due) || typeof phase.loop !== 'boolean'
      || validateAnimationNotifies(phase.notifies))) return null;
  // A finite plan can still overflow when normalized for skeletal playback.
  // Admit only representable inputs to the bounded ordinary channel clock.
  for (const phase of schedule.phases) {
    const f = Math.fround, endpoint = f(1 - 1 / phase.frames);
    const rate = f(f(phase.sourceRate / phase.frames) * schedule.rate);
    const tweenRate = schedule.tween > 0 ? f(1 / (f(schedule.tween) * f(phase.frames))) : 0;
    if (endpoint >= 1 || !Number.isFinite(rate) || !(rate > 0)
      || !Number.isFinite(tweenRate) || (schedule.tween > 0 && !(tweenRate > 0))) return null;
  }
  return { schedule, elapsed: 0, phaseIndex: -1, phaseElapsed: 0, done: false, notifiesEnabled };
}

export function advanceCastPlayback(state, dt) {
  if (!state || state.done || !Number.isFinite(dt) || dt < 0) return null;
  const { schedule } = state, f = Math.fround;
  const elapsed = f(state.elapsed + f(dt)), phaseElapsed = f(state.phaseElapsed + f(dt));
  if (!Number.isFinite(elapsed) || !Number.isFinite(phaseElapsed)) {
    state.done = true; state.unsupported = 'nonfinite-cast-clock';
    return { done: true, unsupported: state.unsupported };
  }

  // AActor::Tick invokes UpdateAnimation before TickSpecial/NActionProcess/
  // MagicProcess. Advance the OLD channel and retain its event identity even
  // on a tick that changes/exhausts phases. The new channel receives no delta
  // until a later actor tick. See native-pawn-notify-evidence.md.
  let events = [];
  const eventPhaseIndex = state.phaseIndex, eventActiveTime = state.elapsed;
  const eventPhase = schedule.phases[eventPhaseIndex] || null;
  if (eventPhase) {
    const clock = advanceAnimationChannel({ frame:state.frame, rate:state.frameRate,
      last:f(1 - 1 / eventPhase.frames), delta:dt, tweenRate:state.tweenRate, loop:eventPhase.loop,
      notifies:eventPhase.notifies, notifiesEnabled:state.notifiesEnabled });
    if (clock.status !== 'ready') {
      state.done=true; state.unsupported=clock.reason;
      return { done:true, unsupported:clock.reason };
    }
    state.frame=clock.frame; state.frameRate=clock.rate; events=clock.events;
  }
  let changed = false;
  if (state.phaseIndex < 0 || state.elapsed === 0 || state.elapsed > schedule.phases[state.phaseIndex].due) {
    do { state.phaseIndex++; }
    while (state.phaseIndex < schedule.phases.length && schedule.phases[state.phaseIndex].due <= 0);
    if (state.phaseIndex >= schedule.phases.length) {
      state.done = true;
      // Completion Clear(1) zeroes ActiveTime before the shared delta add.
      state.elapsed = f(dt);
      return { done:true, events, eventPhase, eventPhaseIndex, eventActiveTime, eventElapsed:elapsed };
    }
    const phase = schedule.phases[state.phaseIndex];
    state.phaseElapsed = 0;
    state.initialTween = state.elapsed === 0 ? schedule.tween : 0;
    state.frame = state.initialTween > 0 ? f(-1 / phase.frames) : f(phase.loop ? .0001 : .001);
    state.frameRate = f(f(phase.sourceRate / phase.frames) * schedule.rate);
    state.tweenRate = state.initialTween > 0 ? f(1 / (f(state.initialTween) * f(phase.frames))) : 0;
    changed = true;
  } else state.phaseElapsed = phaseElapsed;
  // MagicProcess compares the previous ActiveTime before adding this delta.
  // Equality keeps the current phase; nonpositive new deadlines are skipped.
  state.elapsed = elapsed;
  const phase = schedule.phases[state.phaseIndex], endpoint = f(1 - 1 / phase.frames);
  const sampleTime = state.frame < 0 ? 0 : !phase.loop && state.frame === endpoint
    ? phase.sourceEndpoint : Math.max(0, state.frame * phase.frames / phase.sourceRate);
  return { done:false, changed, phase, events, eventPhase, eventPhaseIndex, eventActiveTime,
    eventElapsed:elapsed, phaseIndex:state.phaseIndex, frame:state.frame, sampleTime, tween:state.initialTween,
    tweenProgress:Math.min(1, 1 + Math.min(0, state.frame) * phase.frames) };
}

/** Preserve every exported sample, append frame zero at the original period.
 *  Exact source frame/rate metadata is required; never stretch the old keys.
 *  Original subframe quaternion interpolation remains a separate porting gap. */
export function closeSourceLoop(clip, frames, rate) {
  if (!clip || !Number.isInteger(frames) || frames < 2 || !Number.isFinite(rate) || rate <= 0) return null;
  const endpoint = Math.fround((frames - 1) / rate), period = Math.fround(frames / rate);
  for (const track of clip.tracks) {
    const count = track.times.length, width = track.getValueSize();
    if (track.times[0] !== 0 || track.times[count - 1] !== endpoint) return null;
    if (count === frames) {
      for (let i = 1; i < frames - 1; i++) if (track.times[i] !== Math.fround(i / rate)) return null;
    } else {
      // assemble.py losslessly collapses an all-identical source track to
      // endpoint keys. Accept that exact form, never a sparse moving track.
      if (count !== 2 || !Number.isInteger(width) || width <= 0) return null;
      for (let i = 0; i < width; i++) {
        if (!Number.isFinite(track.values[i]) || !Object.is(track.values[i], track.values[i + width])) return null;
      }
    }
  }
  const loop = clip.clone();
  for (const track of loop.tracks) {
    const width = track.getValueSize();
    const times = new track.times.constructor(track.times.length + 1);
    times.set(track.times); times[track.times.length] = period;
    const values = new track.values.constructor(track.values.length + width);
    values.set(track.values); values.set(track.values.subarray(0, width), track.values.length);
    track.times = times; track.values = values;
  }
  loop.duration = period;
  return loop;
}
