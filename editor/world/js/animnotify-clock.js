// Elbera Tools: bounded original skeletal channel clock and notify crossings.
// docs/native-animation-notify-evidence.md pins the original instructions.
// Explicit enabled-channel input: fresh appended +0x44 is zero under the checked
// allocation correspondence; later enable calls, filtering and callback mutation
// still need caller admission. The ordinary wait adapter
// handles the separately verified channel-zero AnimEnd replacement.
const f = Math.fround;
const finite = value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(f(value));
const unsupported = reason => ({ status: 'unsupported', reason });
const split = (old, current, time, delta) => f((current - time) * delta / (current - old));

export function validateAnimationNotifies(notifies) {
  if (!Array.isArray(notifies)) return 'missing-source-notifies';
  for (const notify of notifies) {
    if (!notify || !finite(notify.t) || typeof notify.isAttackShot !== 'boolean'
      || typeof notify.isBoneScale !== 'boolean' || !Number.isInteger(notify.objectRef)) return 'invalid-source-notify';
    if (notify.function !== null && notify.function !== 'None') return 'unported-postload-script-notify';
  }
  return null;
}

/** Return events without executing callbacks. Inputs are never mutated.
 * Candidate collection happens before all callbacks, in serialized order.
 * Even null objects change the clock. Never sort, clamp or resume from each
 * notify as if it were an ideal event timeline: the source discards remainder
 * below AnimLast and can produce negative remainders for multiple callbacks.
 */
export function advanceAnimationChannel(input) {
  if (!input || typeof input !== 'object') return unsupported('missing-channel-clock');
  const { notifies, notifiesEnabled, loop = false } = input;
  if (typeof notifiesEnabled !== 'boolean') return unsupported('missing-channel-notify-policy');
  if (typeof loop !== 'boolean') return unsupported('invalid-channel-loop');
  const invalid = validateAnimationNotifies(notifies);
  if (invalid) return unsupported(invalid);
  if (![input.frame,input.rate,input.last,input.delta,input.tweenRate ?? 0].every(finite)
    || input.rate < 0 || input.delta < 0 || input.last < 0 || input.last >= 1) return unsupported('invalid-channel-clock');
  let frame=f(input.frame), rate=f(input.rate), last=f(input.last), remaining=f(input.delta);
  if (last >= 1) return unsupported('invalid-channel-clock');
  const tweenRate=f(input.tweenRate ?? 0), events=[];
  const budget=input.advancementBudget ?? 4;
  if (!Number.isInteger(budget) || budget<0 || budget>4) return unsupported('invalid-advancement-budget');
  let advancements=0, discarded=0;
  while (remaining > 0 && (frame < 0 || rate > 0)) {
    if (advancements === budget) { discarded=remaining; break; }
    advancements++;
    const old=frame;
    if (frame < 0) {
      if (!(tweenRate > 0)) return unsupported('missing-positive-tween-rate');
      frame=f(frame + tweenRate * remaining);
      if (!Number.isFinite(frame)) return unsupported('nonfinite-channel-result');
      if (frame < 0) { remaining=0; break; }
      remaining=split(old,frame,0,remaining);
      if (!Number.isFinite(remaining)) return unsupported('nonfinite-channel-result');
      frame=0; continue;
    }
    frame=f(frame + rate * remaining);
    if (!Number.isFinite(frame)) return unsupported('nonfinite-channel-result');
    const candidates=notifiesEnabled ? notifies.map((notify,index)=>({notify,index}))
      .filter(({notify})=>old < f(notify.t) && f(notify.t) <= frame) : [];
    let shot=false;
    for (const {notify} of candidates) {
      if (notify.isBoneScale || (notify.isAttackShot && shot)) return unsupported('unresolved-native-notify-removal');
      if (notify.isAttackShot) shot=true;
    }
    for (const {notify,index} of candidates) {
      if (frame === old) return unsupported('degenerate-notify-remainder');
      remaining=split(old,frame,f(notify.t),remaining); frame=f(notify.t);
      if (!Number.isFinite(remaining)) return unsupported('nonfinite-channel-result');
      events.push({ index, frame, remaining, dispatch: notify.objectRef === 0 ? 'null' : 'object' });
    }
    if (frame < last) { discarded=candidates.length ? remaining : 0; remaining=0; break; }
    if (loop) {
      if (frame >= 1) {
        remaining=split(old,frame,1,remaining);
        if (!Number.isFinite(remaining)) return unsupported('nonfinite-channel-result');
        frame=0;
      }
      else remaining=0;
    } else {
      remaining=frame !== old ? split(old,frame,last,remaining) : 0;
      if (!Number.isFinite(remaining)) return unsupported('nonfinite-channel-result');
      frame=last; rate=0; break;
    }
  }
  return { status:'ready', frame, rate, remaining, discarded, advancements, events };
}

/** Read-only metadata predicate for unconditional direct Sound records.
 * Dispatch must use selectNotifySound: even Random=100 consumes a draw. */
export function directNotifySound(notify) {
  const info=notify?.soundInfo;
  if (notify?.classPath !== 'Engine.AnimNotify_Sound' || !notify.isSound
    || info?.status !== 'source-direct' || info.random !== 100
    || !finite(info.volume) || !finite(info.radius) || info.radius <= 0
    || typeof notify.sound !== 'string' || !notify.sound) return null;
  return { ref:notify.sound, volume:info.volume, radius:info.radius };
}

/** Dispatch gate for the exact base Sound class. The draw precedes the
 * threshold and direct/surface/audio branches, including thresholds 0/100.
 * One caller-owned context must be shared across actors and source channels.
 * Metadata inspection and unreached/disabled events must not call this. */
export function selectNotifySound(notify, random) {
  if (notify?.classPath !== 'Engine.AnimNotify_Sound' || notify.isSound !== true) {
    return {status:'unsupported',reason:'unported-sound-notify-class'};
  }
  if (typeof random?.nextInt !== 'function') return {status:'unsupported',reason:'missing-random-context'};
  const value = random.nextInt(), info = notify.soundInfo;
  if (!Number.isInteger(value) || value < 0 || value > 32767) {
    return {status:'unsupported',reason:'invalid-native-random-result'};
  }
  const threshold = info?.random;
  if (!Number.isInteger(threshold) || threshold < -0x80000000 || threshold > 0x7fffffff) {
    return {status:'unsupported',reason:'missing-original-random-threshold',randomValue:value};
  }
  // Preserve the original integer modulo (including its small source bias).
  // Thresholds are signed original fields, never clamped percentages.
  if (value % 100 >= threshold) return {status:'filtered',randomValue:value};
  if (info?.status !== 'source-direct' || !finite(info.volume) || !finite(info.radius)
      || info.radius <= 0 || typeof notify.sound !== 'string' || !notify.sound) {
    return {status:'unsupported',reason:'unported-sound-notify-branch',randomValue:value};
  }
  return {status:'ready',ref:notify.sound,volume:info.volume,radius:info.radius,randomValue:value};
}
