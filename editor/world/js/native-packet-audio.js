// Original mode-zero stereo PCM playback over Web Audio. Native arithmetic,
// selection and stop order live in native-audio-voices.js. Web Audio handles,
// buffer decoding and autoplay are explicit browser platform adaptations.
import {
  nativeAudioPriority,
  selectNativeAudioVoice,
  planNativeAudioStop,
} from "./native-audio-voices.js";

const f = Math.fround;
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((x) => Number.isFinite(x) && f(x) === x);
const unsupported = (reason) => ({ status: "unsupported", reason });

export class NativePacketAudio {
  constructor({ context, profile, sounds, buffers }) {
    this.context = context;
    this.profile = Object.freeze({ ...profile });
    this.voices = [];
    this.sounds = new Map();
    this.counter = profile?.initialCounter;
    this.ready = false;
    if (
      profile?.format !== "l2-interlude-native-audio-profile-v1" ||
      profile.channelLimit !== 32 ||
      !Number.isInteger(profile.channels) ||
      profile.channels <= 0 ||
      profile.channels > 0x7fffffff ||
      !uint(profile.partitionFlag) ||
      !Number.isInteger(profile.splitCount) ||
      profile.splitCount < 0 ||
      profile.splitCount > 0x7fffffff ||
      !uint(this.counter) ||
      profile.useEAX !== false ||
      profile.defaultRadius !== 80 ||
      !Number.isFinite(profile.soundVolume) ||
      f(profile.soundVolume) !== profile.soundVolume ||
      profile.soundVolume < 0 ||
      profile.soundVolume > 1
    ) {
      this.failure = "unsupported-original-audio-profile";
      return;
    }
    // Opaque browser handles replace OpenAL names. They are not game IDs.
    for (let i = 0; i < Math.min(profile.channels, profile.channelLimit); i++) {
      let output;
      try {
        output = context.createGain();
        output.connect(context.destination);
      } catch {
        output?.disconnect();
        break;
      }
      this.voices.push({
        source: i + 1,
        output,
        node: null,
        ended: false,
        soundId: 0,
        sound: null,
        actor: null,
        flags: 0,
        priority: 0,
        field54: 0,
        field58: 0,
        gain: 0,
        radius: 0,
        location: [0, 0, 0],
      });
    }
    for (const [key, info] of Object.entries(sounds ?? {})) {
      const buffer = buffers.get(key);
      if (
        !buffer ||
        info.encoding !== 1 ||
        info.channels !== 2 ||
        info.bitsPerSample !== 16 ||
        buffer.numberOfChannels !== 2 ||
        !info.sourceReference
      )
        continue;
      const sound = { ref: key, buffer, field70: 0 };
      this.sounds.set(key.toLowerCase(), sound);
      this.sounds.set(info.sourceReference.toLowerCase(), sound);
    }
    this.ready = this.voices.length > 0;
    if (!this.ready) this.failure = "no-browser-audio-sources";
  }

  _stop(voice) {
    const plan = planNativeAudioStop({ voice });
    if (plan.status !== "ready") return plan;
    for (const operation of plan.operations) {
      switch (operation.op) {
        case "setSoundField70":
          operation.sound.field70 = operation.value;
          break;
        case "alSourceStop":
          if (voice.node) {
            voice.node.onended = null;
            voice.node.stop();
          }
          break;
        case "alSourcei":
          voice.node?.disconnect();
          voice.node = null;
          voice.ended = false;
          break;
        case "clearVoice":
          Object.assign(voice, operation.fields);
          break;
        default:
          throw new Error("Unported native stream stop operation");
      }
    }
    return plan;
  }

  play(packet, frame) {
    if (!this.ready) return unsupported(this.failure);
    if (packet.soundType !== 0)
      return unsupported("unported-packet-sound-mode");
    if (!this._frame(frame))
      return unsupported("missing-current-pawn-audio-state");
    if (this.context.state !== "running")
      return unsupported("browser-audio-locked");
    const sound = this.sounds.get(String(packet.sound).toLowerCase());
    if (!sound) return unsupported("original-stereo-buffer-unavailable");
    const gain = f(Math.max(0, Math.min(1, this.profile.soundVolume)));
    if (gain === 0) return { status: "rejected", reason: "sound-volume-zero" };
    const radius = this.profile.defaultRadius;
    const priority = nativeAudioPriority({
      radius,
      volume: gain,
      flags: 0,
      location: frame.location,
      viewTargetLocation: frame.viewTargetLocation,
    });
    if (priority.status !== "ready") return priority;
    const selected = selectNativeAudioVoice({
      soundId: 0,
      counter: this.counter,
      priority: priority.priority,
      partitionFlag: this.profile.partitionFlag,
      selectionClass: 0,
      splitCount: this.profile.splitCount,
      voices: this.voices,
    });
    if ("counter" in selected.writes) this.counter = selected.writes.counter;
    if (selected.status !== "ready") return selected;
    if (selected.index === null)
      return { status: "rejected", reason: "native-voice-priority" };
    const voice = this.voices[selected.index];
    const stopped = this._stop(voice);
    if (stopped.status !== "ready") return stopped;
    let node;
    try {
      node = this.context.createBufferSource();
      node.buffer = sound.buffer;
      node.playbackRate.value = 1; // Original OnPlaySound mode-zero pitch.
      node.loop = false; // Original ordinary PCM registration flags zero.
      Object.assign(voice, {
        sound,
        actor: frame.owner,
        epoch: frame.epoch,
        soundId: selected.soundId,
        flags: 0,
        priority: priority.priority,
        radius,
        gain,
        location: [...frame.location],
        field54: 1,
        field58: 0,
        node,
        ended: false,
      });
      // This admitted ordinary viewport path has the same pawn for source and
      // audio position. The native dry-gain formula therefore yields stored gain.
      // No stereo panner, invented falloff or legacy UI/master bus is inserted.
      voice.output.gain.value = gain;
      node.connect(voice.output);
      node.onended = () => {
        if (voice.node === node) voice.ended = true;
      };
      node.start();
    } catch {
      if (node) {
        node.onended = null;
        node.disconnect();
      }
      voice.node = null;
      this._stop(voice);
      return unsupported("browser-source-start-failed");
    }
    sound.field70 = 1;
    return {
      status: "playing",
      ref: sound.ref,
      voiceIndex: selected.index,
      soundId: selected.soundId,
      gain,
      channels: sound.buffer.numberOfChannels,
    };
  }

  _frame(frame) {
    return (
      frame?.owner != null &&
      frame.epoch !== undefined &&
      vector(frame.location) &&
      vector(frame.viewTargetLocation) &&
      vector(frame.audioLocation) &&
      frame.location.every((v, i) => v === frame.audioLocation[i])
    );
  }

  update(frame) {
    for (const voice of this.voices) {
      if (voice.soundId === 0) continue;
      if (
        voice.ended ||
        !this._frame(frame) ||
        voice.actor !== frame.owner ||
        voice.epoch !== frame.epoch
      ) {
        this._stop(voice);
        continue;
      }
      voice.location = [...frame.location];
      const priority = nativeAudioPriority({
        radius: voice.radius,
        volume: voice.gain,
        flags: voice.flags,
        location: voice.location,
        viewTargetLocation: frame.viewTargetLocation,
      });
      if (priority.status !== "ready") {
        this._stop(voice);
        continue;
      }
      voice.priority = priority.priority;
      voice.output.gain.value = voice.gain;
    }
  }

  reset() {
    // Browser session retirement, not an asserted native SetViewport mapping.
    for (const voice of this.voices) this._stop(voice);
  }

  dispose() {
    this.reset();
    for (const voice of this.voices) voice.output.disconnect();
    this.voices = [];
    this.ready = false;
  }
}
