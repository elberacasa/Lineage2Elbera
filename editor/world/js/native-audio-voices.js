// Elbera Tools: ALAudio priority, voice selection and ordered StopSound effects.
// Source and limits: docs/native-playsound-evidence.md. All pool state is supplied;
// this component does not choose a capacity, initialize voices or start playback.
const uint32 = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const float32 = (value) =>
  Number.isFinite(value) && Math.fround(value) === value;

/** Original SoundPriority with an explicit GetViewTarget location snapshot.
 * Float32 stores and operation order are retained; Number intermediates use
 * binary64. Nonfinite/overflow/underflow cases are outside this finite adapter.
 * Radius zero skips the location query, as in the original function.
 */
export function nativeAudioPriority(input) {
  const unsupported = (reason) => ({ status: "unsupported", reason });
  if (
    !float32(input?.radius) ||
    !float32(input?.volume) ||
    !uint32(input?.flags)
  ) {
    return unsupported("source-priority-fields-required");
  }
  const f = Math.fround;
  let attenuation = 1;
  if (input.radius !== 0) {
    const vector = (v) =>
      Array.isArray(v) && v.length === 3 && v.every(float32);
    if (!vector(input.location) || !vector(input.viewTargetLocation)) {
      return unsupported("source-and-view-target-locations-required");
    }
    // Named Core GAudioMaxRadiusMultiplier, used by SoundPriority itself.
    const radius = f(input.radius * 50);
    const radiusSquared = f(radius * radius);
    const delta = input.viewTargetLocation.map((v, i) =>
      f(v - input.location[i]),
    );
    const squares = delta.map((v) => f(v * v));
    const distanceSquared = f(squares[0] + squares[1] + squares[2]);
    if (
      !Number.isFinite(radiusSquared) ||
      radiusSquared === 0 ||
      !Number.isFinite(distanceSquared)
    ) {
      return unsupported("nonfinite-or-underflowed-priority-distance");
    }
    attenuation = f(1 - distanceSquared / radiusSquared);
    if (!Number.isFinite(attenuation))
      return unsupported("nonfinite-priority-attenuation");
  }
  // Retained Float32 constant at ALAudio 0x10040288; this is a priority floor,
  // not an audible minimum gain. Flag meanings are not inferred here.
  attenuation = Math.max(f(0.01), Math.min(1, attenuation));
  let priority = attenuation * input.volume;
  priority += (input.flags >>> 2) & 1;
  priority += (input.flags >>> 2) & 2;
  priority += (input.flags >>> 4) & 1;
  priority = f(priority);
  if (!Number.isFinite(priority))
    return unsupported("nonfinite-priority-result");
  return { status: "ready", priority };
}

/** Ordered StopSound effects for an explicit, stable voice snapshot.
 * Produces operations; it does not invoke browser/OpenAL/stream callbacks.
 * streamHandle is the original registered-buffer field used by this call,
 * not a guessed sound ID. Unknown field meanings retain their source offsets.
 */
export function planNativeAudioStop(input) {
  const voice = input?.voice;
  const unsupported = (reason) => ({ status: "unsupported", reason });
  if (!uint32(voice?.soundId)) return unsupported("source-voice-id-required");
  if (voice.soundId === 0) return { status: "ready", operations: [] };
  if (
    voice.sound === undefined ||
    !uint32(voice.flags) ||
    !uint32(voice.source)
  ) {
    return unsupported("source-stop-fields-required");
  }
  const operations = [];
  if (voice.sound !== null) {
    operations.push({ op: "setSoundField70", sound: voice.sound, value: 0 });
  }
  if ((voice.flags & 4) !== 0) {
    if (voice.sound === null || !uint32(input.streamHandle)) {
      return unsupported("registered-stream-handle-required");
    }
    operations.push({
      op: "destroyStream",
      streamId: (input.streamHandle - 1) | 0,
      arg2: 0,
    });
  }
  if (voice.source !== 0) {
    operations.push({ op: "alSourceStop", source: voice.source });
    operations.push({
      op: "alSourcei",
      source: voice.source,
      parameter: 0x1009,
      value: 0,
    });
  }
  // The source handle (+4), position, gain and radius are NOT reset here.
  operations.push({
    op: "clearVoice",
    fields: {
      sound: null,
      actor: null,
      flags: 0,
      priority: 0,
      soundId: 0,
      field54: 0,
      field58: 0,
    },
  });
  return { status: "ready", operations };
}

export function selectNativeAudioVoice(input) {
  let soundId = input?.soundId;
  const writes = {};
  const unsupported = (reason) => ({
    status: "unsupported",
    reason,
    soundId,
    writes,
  });
  const ready = (index) => ({ status: "ready", soundId, index, writes });
  if (!uint32(soundId)) return unsupported("missing-sound-id");

  // Slot-zero requests consume the counter even if no voice is subsequently
  // selected. Both the decrement and the shift have native DWORD wraparound.
  if ((soundId & 0xe) === 0) {
    if (!uint32(input.counter)) return unsupported("missing-sound-id-counter");
    writes.counter = (input.counter - 1) >>> 0;
    soundId = (writes.counter << 4) >>> 0;
  }

  const { voices, partitionFlag } = input;
  if (!uint32(partitionFlag)) return unsupported("missing-partition-flag");
  if (!Array.isArray(voices) || voices.length > 0x7fffffff) {
    return unsupported("missing-voice-pool");
  }
  let begin = 0,
    end = voices.length,
    excludeFlag8 = false;
  if (partitionFlag !== 0) {
    if (!uint32(input.selectionClass))
      return unsupported("missing-selection-class");
    // Negative native split/count states are outside this component's contract.
    if (
      !Number.isInteger(input.splitCount) ||
      input.splitCount < 0 ||
      input.splitCount > 0x7fffffff
    ) {
      return unsupported("unsupported-split-count");
    }
    const split = Math.min(input.splitCount, end);
    if (input.selectionClass !== 0) end = split;
    else {
      begin = split;
      excludeFlag8 = true;
    }
  }

  let index = null,
    threshold = input.priority;
  for (let i = begin; i < end; i++) {
    const voice = voices[i];
    if (!uint32(voice?.soundId)) return unsupported("missing-voice-sound-id");
    if (((voice.soundId ^ soundId) & 0xfffffffe) === 0) {
      // Identity wins before priority/flags. Bit zero prohibits replacement,
      // including when an earlier, unrelated candidate had lower priority.
      return ready((soundId & 1) === 0 ? i : null);
    }
    if (!float32(threshold) || !float32(voice.priority)) {
      return unsupported("missing-finite-float32-priority");
    }
    if (threshold <= voice.priority) continue;
    if (excludeFlag8) {
      if (!uint32(voice.flags)) return unsupported("missing-voice-flags");
      if ((voice.flags & 8) !== 0) continue;
    }
    index = i;
    threshold = voice.priority;
  }
  return ready(index);
}
