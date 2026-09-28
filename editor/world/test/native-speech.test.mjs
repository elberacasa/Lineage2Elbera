// Portable synthetic behavior checks; source differential uses private inputs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeSpeechDelay,
  tickNativeSpeech,
  nativeSpeechFade,
} from "../js/native-speech.js";

test("packet delay uses a signed DWORD and integer truncation without negative zero", () => {
  for (const value of [-999, -1, 0, 999])
    assert.equal(Object.is(nativeSpeechDelay(value), 0), true);
  assert.equal(nativeSpeechDelay(0xffffffff), 0);
  assert.equal(nativeSpeechDelay(0x80000000), -2147483);
  assert.equal(nativeSpeechDelay(1999), 1);
  for (const value of [NaN, Infinity, null, 1.5, -0x80000001, 0x100000000])
    assert.equal(nativeSpeechDelay(value), null);
});

test("missing observations do not mutate an explicit pending controller", () => {
  const state = {
    kind: 1,
    ref: "synthetic",
    delay: 1,
    voiceHandle: -1,
    musicHandle: -1,
    flags: 0,
  };
  const before = { ...state };
  assert.equal(tickNativeSpeech(state, { delta: 0 }, {}).status, "unsupported");
  assert.deepEqual(state, before);
});

test("interface voice cannot interrupt active Ogg narration; native music restore precedes cancellation", () => {
  const state = {
    kind: 2,
    ref: "synthetic",
    delay: 0,
    voiceHandle: 17,
    musicHandle: 5,
    flags: 0,
  };
  const events = [];
  tickNativeSpeech(
    state,
    {
      delta: 0,
      available: true,
      ogg: true,
      wav: false,
      music: true,
      voiceEnd: true,
    },
    {
      setMusicVolume: (...args) => events.push(args),
      stopMusic: () => assert.fail("unexpected interruption"),
      playVoice: () => assert.fail("unexpected playback"),
    },
  );
  assert.deepEqual(events, [[5, 1, 2]]);
  assert.equal(state.kind, 0);
  assert.equal(state.ref, "");
  assert.equal(state.voiceHandle, 17);
});

test("fade admission rejects missing/invalid timing instead of fabricating defaults", () => {
  for (const duration of [undefined, 0, -1, Infinity])
    assert.equal(
      nativeSpeechFade({ elapsed: 0, duration, delta: 0, volume: 1 }).status,
      "unsupported",
    );
});
