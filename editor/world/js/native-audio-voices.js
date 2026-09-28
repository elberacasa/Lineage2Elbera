// Elbera Tools: ALAudio PlaySoundW voice selection, before StopSound.
// Source and limits: docs/native-playsound-evidence.md. All pool state is supplied;
// this component does not choose a capacity, initialize voices or start playback.
const uint32 = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const float32 = (value) =>
  Number.isFinite(value) && Math.fround(value) === value;

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
