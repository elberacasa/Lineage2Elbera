// Elbera Tools: authored boundary fixtures. Native correspondence requires the
// supplied ALAudio.dll and check_playsound_native.py --voice-selection.
import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeAudioPriority,
  planNativeAudioStop,
  selectNativeAudioVoice,
} from "../js/native-audio-voices.js";

const voice = (soundId, priority, flags = 0) => ({ soundId, priority, flags });
const select = (state) =>
  selectNativeAudioVoice({
    soundId: 2,
    priority: 1,
    partitionFlag: 0,
    voices: [],
    ...state,
  });

test("priority zero-radius branch skips locations and preserves raw flag contributions", () => {
  for (const [flags, priority] of [
    [0, 1],
    [4, 2],
    [8, 3],
    [16, 2],
    [28, 5],
    [0xffffffe3, 1],
  ]) {
    assert.deepEqual(nativeAudioPriority({ radius: -0, volume: 1, flags }), {
      status: "ready",
      priority,
    });
  }
});

test("priority uses squared distance and a priority floor distinct from audible gain", () => {
  const input = {
    radius: 1,
    volume: 0.5,
    flags: 0,
    location: [0, 0, 0],
    viewTargetLocation: [25, 0, 0],
  };
  assert.equal(nativeAudioPriority(input).priority, 0.375);
  assert.equal(nativeAudioPriority({ ...input, radius: -1 }).priority, 0.375);
  for (const distance of [50, 100]) {
    assert.equal(
      nativeAudioPriority({ ...input, viewTargetLocation: [distance, 0, 0] })
        .priority,
      Math.fround(0.005),
    );
  }
  assert.equal(
    nativeAudioPriority({ ...input, volume: -1, flags: 4 }).priority,
    0.25,
  );
});

test("priority consumes the supplied view-target location without mutating inputs", () => {
  const input = {
    radius: 1,
    volume: 1,
    flags: 0,
    location: [1024, 2048, 4096],
    viewTargetLocation: [1049, 2048, 4096],
  };
  const before = structuredClone(input);
  assert.equal(nativeAudioPriority(input).priority, 0.75);
  assert.deepEqual(input, before);
  assert.equal(
    nativeAudioPriority({ ...input, location: undefined }).status,
    "unsupported",
  );
  assert.equal(
    nativeAudioPriority({ ...input, viewTargetLocation: undefined }).status,
    "unsupported",
  );
});

test("unsupported priority arithmetic does not produce a fabricated priority", () => {
  const input = {
    radius: 1,
    volume: 1,
    flags: 0,
    location: [0, 0, 0],
    viewTargetLocation: [0, 0, 0],
  };
  for (const patch of [
    { radius: NaN },
    { volume: Infinity },
    { flags: -1 },
    { radius: 0.1 },
    { radius: 2 ** -149 },
    { radius: Math.fround(1e30) },
    { viewTargetLocation: [Math.fround(1e30), 0, 0] },
  ]) {
    const result = nativeAudioPriority({ ...input, ...patch });
    assert.equal(result.status, "unsupported");
    assert.equal("priority" in result, false);
  }
});

test("stopping an inactive voice reads no other fields", () => {
  assert.deepEqual(planNativeAudioStop({ voice: { soundId: 0 } }), {
    status: "ready",
    operations: [],
  });
});

test("stop orders bookkeeping, stream destruction, source stop, detach and selective clearing", () => {
  const input = {
    voice: {
      soundId: 2,
      sound: "synthetic-sound",
      source: 17,
      flags: 4,
      actor: "owner",
      gain: 0.5,
    },
    streamHandle: 1,
  };
  const before = structuredClone(input);
  assert.deepEqual(planNativeAudioStop(input), {
    status: "ready",
    operations: [
      { op: "setSoundField70", sound: "synthetic-sound", value: 0 },
      { op: "destroyStream", streamId: 0, arg2: 0 },
      { op: "alSourceStop", source: 17 },
      { op: "alSourcei", source: 17, parameter: 0x1009, value: 0 },
      {
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
      },
    ],
  });
  assert.deepEqual(input, before);
});

test("stop skips absent sound/source and preserves signed stream argument wraparound", () => {
  const voice = { soundId: 2, sound: null, source: 0, flags: 0 };
  assert.deepEqual(
    planNativeAudioStop({ voice }).operations.map((o) => o.op),
    ["clearVoice"],
  );
  for (const [streamHandle, expected] of [
    [0, -1],
    [0x80000000, 0x7fffffff],
    [0xffffffff, -2],
  ]) {
    const result = planNativeAudioStop({
      voice: { ...voice, sound: "sound", flags: 4 },
      streamHandle,
    });
    assert.equal(result.operations[1].streamId, expected);
    assert.deepEqual(
      result.operations.map((o) => o.op),
      ["setSoundField70", "destroyStream", "clearVoice"],
    );
  }
});

test("missing stop state cannot become a partial executable plan", () => {
  const voice = { soundId: 2, sound: "sound", source: 17, flags: 4 };
  for (const input of [
    undefined,
    { voice },
    { voice: { ...voice, sound: null }, streamHandle: 1 },
    { voice: { ...voice, source: undefined }, streamHandle: 1 },
  ]) {
    const result = planNativeAudioStop(input);
    assert.equal(result.status, "unsupported");
    assert.equal("operations" in result, false);
  }
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
