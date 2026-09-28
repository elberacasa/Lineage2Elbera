// Elbera Tools: authored boundary fixtures. Native correspondence requires the
// supplied ALAudio.dll and check_playsound_native.py --voice-selection.
import test from "node:test";
import assert from "node:assert/strict";
import { selectNativeAudioVoice } from "../js/native-audio-voices.js";

const voice = (soundId, priority, flags = 0) => ({ soundId, priority, flags });
const select = (state) =>
  selectNativeAudioVoice({
    soundId: 2,
    priority: 1,
    partitionFlag: 0,
    voices: [],
    ...state,
  });

test("independent IDs decrement and wrap even when the pool rejects playback", () => {
  for (const [counter, updated, soundId] of [
    [0, 0xffffffff, 0xfffffff0],
    [1, 0, 0],
    [0x80000000, 0x7fffffff, 0xfffffff0],
  ]) {
    assert.deepEqual(select({ soundId: 1, counter }), {
      status: "ready",
      soundId,
      index: null,
      writes: { counter: updated },
    });
  }
  assert.deepEqual(select({ soundId: 3 }), {
    status: "ready",
    soundId: 3,
    index: null,
    writes: {},
  });
});

test("strictly lower priority is required; the first minimum wins ties", () => {
  assert.equal(select({ voices: [voice(8, 1), voice(10, 2)] }).index, null);
  assert.equal(
    select({ voices: [voice(8, 0.5), voice(10, 0.25), voice(12, 0.25)] }).index,
    1,
  );
  assert.equal(
    select({ priority: 0, voices: [voice(8, -0), voice(10, -2)] }).index,
    1,
  );
});

test("identity precedes priority and bit zero blocks even an earlier candidate", () => {
  const voices = [voice(8, 0.25), voice(3, 2)];
  assert.equal(select({ voices }).index, 1);
  assert.equal(select({ soundId: 3, voices }).index, null);
  assert.equal(
    select({ voices: [{ soundId: 2 }], priority: undefined }).index,
    0,
  );
});

test("partition boundaries preserve the two scan ranges and clamp only above count", () => {
  const state = {
    partitionFlag: 1,
    splitCount: 1,
    voices: [voice(8, 0.1), voice(10, 0)],
  };
  // Float32 snapshots are explicit inputs, not silently rounded by the selector.
  state.voices[0].priority = Math.fround(0.1);
  assert.equal(select({ ...state, selectionClass: 1 }).index, 0);
  assert.equal(select({ ...state, selectionClass: 0 }).index, 1);
  assert.equal(
    select({ ...state, selectionClass: 1, splitCount: 0 }).index,
    null,
  );
  assert.equal(
    select({ ...state, selectionClass: 0, splitCount: 0x7fffffff }).index,
    null,
  );
  assert.equal(
    select({ ...state, selectionClass: 1, splitCount: 0x7fffffff }).index,
    1,
  );
  assert.equal(
    select({ ...state, selectionClass: 1, splitCount: -1 }).status,
    "unsupported",
  );
});

test("flag 8 excludes only priority replacement in the zero-class partition", () => {
  const state = {
    partitionFlag: 1,
    splitCount: 0,
    selectionClass: 0,
    voices: [voice(8, 0, 8)],
  };
  assert.equal(select(state).index, null);
  assert.equal(select({ ...state, partitionFlag: 0 }).index, 0);
  assert.equal(select({ ...state, selectionClass: 1, splitCount: 1 }).index, 0);
  assert.equal(select({ ...state, voices: [voice(2, 2, 8)] }).index, 0);
});

test("unused snapshot fields and unvisited voices do not fabricate dependencies", () => {
  assert.equal(select({ voices: [{ soundId: 8, priority: 0 }] }).index, 0);
  assert.equal(select({ voices: [{ soundId: 2 }, null] }).index, 0);
  assert.equal(
    select({
      partitionFlag: 1,
      selectionClass: 0,
      splitCount: 1,
      voices: [null],
    }).index,
    null,
  );
  assert.equal(
    select({
      partitionFlag: 1,
      selectionClass: 0,
      splitCount: 0,
      voices: [{ soundId: 8, priority: 2 }],
    }).index,
    null,
  );
});

test("missing consumed state is unsupported and preserves the completed counter write", () => {
  const input = {
    soundId: 0,
    counter: 1,
    partitionFlag: 0,
    voices: [null],
    priority: 1,
  };
  const before = structuredClone(input);
  assert.deepEqual(selectNativeAudioVoice(input), {
    status: "unsupported",
    reason: "missing-voice-sound-id",
    soundId: 0,
    writes: { counter: 0 },
  });
  assert.deepEqual(input, before);
  assert.equal(select({ soundId: 0 }).reason, "missing-sound-id-counter");
  assert.equal(
    select({ partitionFlag: undefined }).reason,
    "missing-partition-flag",
  );
  assert.equal(select({ partitionFlag: 1 }).reason, "missing-selection-class");
  assert.equal(
    select({ voices: [voice(8, 0.1)] }).reason,
    "missing-finite-float32-priority",
  );
  assert.equal(select({ voices: [voice(8, NaN)] }).status, "unsupported");
  assert.equal(
    select({
      partitionFlag: 1,
      selectionClass: 0,
      splitCount: 0,
      voices: [{ soundId: 8, priority: 0 }],
    }).reason,
    "missing-voice-flags",
  );
  for (const soundId of [-1, 0x100000000, 0.5, NaN])
    assert.equal(select({ soundId }).status, "unsupported");
});
