// Elbera Tools: browser platform/lifecycle fixtures; no private sound assets.
import test from "node:test";
import assert from "node:assert/strict";
import { NativePacketAudio } from "../js/native-packet-audio.js";

const profile = {
  format: "l2-interlude-native-audio-profile-v1",
  channels: 32,
  channelLimit: 32,
  partitionFlag: 1,
  splitCount: 16,
  initialCounter: 0,
  soundVolume: Math.fround(0.8),
  useEAX: false,
  defaultRadius: 80,
  rolloff: 0.5,
};
const packet = {
  soundType: 0,
  sound: "itemsound.quest_accept",
  objectFlag: 1,
  objectId: 999,
  x: 300,
  y: 400,
  z: 500,
  delay: 9999,
};
const frame = () => ({
  owner: "synthetic-pawn",
  epoch: 1,
  location: [10, 20, 30],
  audioLocation: [10, 20, 30],
  viewTargetLocation: [10, 20, 30],
});

function fixture(options = {}) {
  const calls = [],
    nodes = [],
    outputs = [];
  const context = {
    state: options.locked ? "suspended" : "running",
    destination: {},
    createGain() {
      if (outputs.length === options.failAllocationAt)
        throw new Error("synthetic allocation failure");
      const output = {
        gain: { value: 1 },
        connect() {},
        disconnect() {
          calls.push("output-disconnect");
        },
      };
      outputs.push(output);
      return output;
    },
    createBufferSource() {
      if (options.failSource)
        throw new Error("synthetic source allocation failure");
      const node = {
        playbackRate: { value: 1 },
        onended: null,
        buffer: null,
        connect(output) {
          this.output = output;
          calls.push("connect");
        },
        start() {
          calls.push("start");
          if (options.failStart) throw new Error("synthetic start failure");
        },
        stop() {
          calls.push("stop");
        },
        disconnect() {
          calls.push("detach");
        },
      };
      nodes.push(node);
      return node;
    },
  };
  const sound = {
    encoding: 1,
    channels: 2,
    bitsPerSample: 16,
    sourceReference: "ItemSound.Quest.quest_accept",
  };
  const audio = new NativePacketAudio({
    context,
    profile: { ...profile, ...options.profile },
    sounds: { [packet.sound]: sound },
    buffers: new Map([
      [packet.sound, { numberOfChannels: options.channels ?? 2 }],
    ]),
  });
  return { audio, context, calls, nodes, outputs };
}

test("original profile caps allocation; failure retains only created sources", () => {
  assert.equal(fixture({ profile: { channels: 64 } }).audio.voices.length, 32);
  assert.equal(fixture({ failAllocationAt: 20 }).audio.voices.length, 20);
  assert.equal(fixture({ failAllocationAt: 0 }).audio.ready, false);
  assert.equal(
    fixture({ profile: { channels: 0xffffffff } }).audio.ready,
    false,
  );
  assert.equal(fixture({ profile: { useEAX: true } }).audio.ready, false);
});

test("mode zero plays exact stereo in the ordinary suffix and ignores packet placement/delay", () => {
  const h = fixture(),
    state = frame();
  const result = h.audio.play(packet, state);
  assert.equal(result.status, "playing");
  assert.equal(result.voiceIndex, 16);
  assert.equal(result.soundId, 0xfffffff0);
  assert.equal(result.gain, Math.fround(0.8));
  assert.equal(h.nodes[0].buffer.numberOfChannels, 2);
  assert.equal(h.nodes[0].playbackRate.value, 1);
  assert.equal(h.nodes[0].loop, false);
  assert.deepEqual(h.calls, ["connect", "start"]);
  state.location[0] = 999;
  assert.deepEqual(h.audio.voices[16].location, [10, 20, 30]);
});

test("only original qualified/short aliases resolve; mono and missing inputs stay unavailable", () => {
  const h = fixture();
  assert.equal(
    h.audio.play({ ...packet, sound: "ITEMSOUND.QUEST.QUEST_ACCEPT" }, frame())
      .status,
    "playing",
  );
  for (const value of [
    { sound: "quest_accept" },
    { soundType: 1 },
    { sound: "unknown" },
  ]) {
    assert.equal(
      h.audio.play({ ...packet, ...value }, frame()).status,
      "unsupported",
    );
  }
  assert.equal(
    fixture({ channels: 1 }).audio.play(packet, frame()).status,
    "unsupported",
  );
});

test("equal priority fills the suffix then rejects while retaining the consumed ID", () => {
  const h = fixture();
  for (let i = 0; i < 16; i++)
    assert.equal(h.audio.play(packet, frame()).voiceIndex, 16 + i);
  assert.equal(h.audio.play(packet, frame()).reason, "native-voice-priority");
  assert.equal(h.nodes.length, 16);
  assert.equal(h.audio.counter, (0 - 17) >>> 0);
  assert.equal(
    h.audio.voices.slice(0, 16).some((v) => v.soundId !== 0),
    false,
  );
});

test("end notification is collected on update, then the voice can be reused", () => {
  const h = fixture();
  h.audio.play(packet, frame());
  const ended = h.nodes[0].onended;
  ended();
  assert.notEqual(h.audio.voices[16].soundId, 0);
  h.audio.update(frame());
  assert.equal(h.audio.voices[16].soundId, 0);
  assert.deepEqual(h.calls.slice(-2), ["stop", "detach"]);
  h.audio.play(packet, frame());
  ended(); // A queued callback for the retired node cannot end its replacement.
  assert.equal(h.audio.voices[16].ended, false);
  assert.equal(h.nodes.length, 2);
});

test("session retirement stops and detaches without reseeding the native counter", () => {
  const h = fixture();
  h.audio.play(packet, frame());
  const counter = h.audio.counter;
  h.audio.update({ ...frame(), epoch: 2 });
  assert.equal(h.audio.voices[16].soundId, 0);
  assert.equal(h.audio.counter, counter);
  h.audio.play(packet, { ...frame(), epoch: 2 });
  h.audio.reset();
  assert.equal(h.audio.counter, (counter - 1) >>> 0);
  assert.equal(
    h.audio.voices.some((v) => v.node),
    false,
  );
});

test("autoplay lock and missing/alternate audio states do not consume a native ID", () => {
  const h = fixture({ locked: true });
  assert.equal(h.audio.play(packet, frame()).reason, "browser-audio-locked");
  h.context.state = "running";
  assert.equal(h.audio.play(packet, null).status, "unsupported");
  assert.equal(
    h.audio.play(packet, { ...frame(), audioLocation: [0, 0, 0] }).status,
    "unsupported",
  );
  assert.equal(h.audio.counter, 0);
  assert.equal(h.nodes.length, 0);
});

test("muted profile rejects before ID selection; failed browser start clears the selected voice", () => {
  const muted = fixture({ profile: { soundVolume: 0 } });
  assert.equal(muted.audio.play(packet, frame()).reason, "sound-volume-zero");
  assert.equal(muted.audio.counter, 0);
  const failed = fixture({ failStart: true });
  assert.equal(
    failed.audio.play(packet, frame()).reason,
    "browser-source-start-failed",
  );
  assert.equal(failed.audio.voices[16].soundId, 0);
  assert.equal(failed.audio.voices[16].node, null);
  const allocation = fixture({ failSource: true });
  assert.equal(
    allocation.audio.play(packet, frame()).reason,
    "browser-source-start-failed",
  );
  assert.equal(allocation.audio.voices[16].soundId, 0);
});
