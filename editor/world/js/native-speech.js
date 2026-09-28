// Elbera Tools: original Interlude controller voice requests and driver fades.
// Caller supplies controller state, audio observations and driver operations.
// Browser ownership, buffer readiness and decoder/device behavior are adapters.
const f = Math.fround;
const float = (v) => Number.isFinite(v) && f(v) === v;
const int = (v) => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff;

export function nativeSpeechDelay(milliseconds) {
  if (
    !Number.isInteger(milliseconds) ||
    milliseconds < -0x80000000 ||
    milliseconds > 0xffffffff
  )
    return null;
  // OnPlaySound uses signed integer division before conversion to Float32.
  const seconds = Math.trunc((milliseconds | 0) / 1000);
  return seconds === 0 ? 0 : f(seconds); // Native integer zero has no minus sign.
}

/** Mutates only the supplied controller fields, in original call/write order.
 * Driver callbacks are synchronous, as in the source. No async decode queue.
 * The snapshot is the driver's preceding Update observations, not a fresh
 * query after each callback. The caller owns initialization and retirement.
 */
export function tickNativeSpeech(state, snapshot, driver) {
  if (
    !state ||
    ![0, 1, 2].includes(state.kind) ||
    typeof state.ref !== "string" ||
    !float(state.delay) ||
    !int(state.voiceHandle) ||
    !int(state.musicHandle) ||
    !Number.isInteger(state.flags) ||
    state.flags < 0 ||
    state.flags > 0xffffffff ||
    !float(snapshot?.delta) ||
    snapshot.delta < 0 ||
    !["available", "ogg", "wav", "music", "voiceEnd"].every(
      (k) => typeof snapshot[k] === "boolean",
    )
  )
    return {
      status: "unsupported",
      reason: "explicit-native-speech-state-required",
    };
  if (!snapshot.available) return { status: "ready" };
  if (snapshot.voiceEnd && snapshot.music && state.musicHandle > 0)
    driver.setMusicVolume(state.musicHandle, 1, 2);
  if (state.kind === 0) return { status: "ready" };

  if (
    ((state.kind === 1 && (snapshot.ogg || snapshot.wav)) ||
      (state.kind === 2 && snapshot.wav && !snapshot.ogg)) &&
    state.voiceHandle > 0
  ) {
    driver.stopMusic(state.voiceHandle, 1, 0);
    state.voiceHandle = -1;
  } else if (state.kind === 2 && snapshot.ogg) {
    state.delay = 0;
    state.kind = 0;
    state.ref = "";
  }
  if (state.delay > 0) {
    state.delay = f(state.delay - snapshot.delta);
    return { status: "ready" };
  }
  if (state.ref !== "") {
    state.delay = 0;
    if (state.kind === 1 || state.kind === 2)
      state.voiceHandle = driver.playVoice(
        state.ref,
        0,
        0,
        state.kind === 1 ? 1 : 0,
      );
    state.kind = 0;
    if (state.voiceHandle > 0) {
      if (snapshot.music && state.musicHandle > 0)
        driver.setMusicVolume(state.musicHandle, f(0.3), 2);
      state.flags = (state.flags | 1) >>> 0;
    }
  }
  return { status: "ready" };
}

/** Native Update's finite ordinary voice fade-out (state2). No interpolation
 * is scheduled on a wall clock: elapsed advances only when delta < 1 second.
 * Native stream retirement occurs at elapsed >= duration, before gain update.
 */
export function nativeSpeechFade({ elapsed, duration, delta, volume }) {
  if (
    ![elapsed, duration, delta, volume].every(float) ||
    elapsed < 0 ||
    duration <= 0 ||
    delta < 0
  )
    return {
      status: "unsupported",
      reason: "finite-native-fade-fields-required",
    };
  if (delta < 1) elapsed = f(elapsed + delta);
  if (elapsed >= duration) return { status: "ended", elapsed };
  return {
    status: "ready",
    elapsed,
    gain: f(Math.min(1, Math.max(0, f((1 - elapsed / duration) * volume)))),
  };
}
