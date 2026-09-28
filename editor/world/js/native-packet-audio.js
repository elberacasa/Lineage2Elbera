// Original packet PCM and tutorial speech over Web Audio. Native arithmetic,
// selection and stop order live in native-audio-voices.js; controller requests
// and fades live in native-speech.js. Decoding, handles and autoplay are adapters.
import {
  nativeAudioPriority,
  selectNativeAudioVoice,
  planNativeAudioStop,
} from "./native-audio-voices.js";
import {
  nativeSpeechDelay,
  tickNativeSpeech,
  nativeSpeechFade,
} from "./native-speech.js";

const f = Math.fround;
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((x) => Number.isFinite(x) && f(x) === x);
const unsupported = (reason) => ({ status: "unsupported", reason });

export class NativePacketAudio {
  constructor({ context, profile, sounds, buffers, speech }) {
    this.context = context;
    this.profile = Object.freeze({ ...profile });
    this.voices = [];
    this.sounds = new Map();
    this.speechSounds = new Map();
    this.browserStreamSerial = 0;
    this._resetSpeech();
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
    for (const [key, info] of Object.entries(speech?.sounds ?? {})) {
      const buffer = speech.buffers.get(key);
      if (
        info.encoding === "vorbis" &&
        info.channels === 1 &&
        info.sampleRate === 44100 &&
        buffer?.numberOfChannels === 1 &&
        /^tutorial_voice_[0-9]{3}[a-z]?$/.test(key)
      )
        this.speechSounds.set(key, { ref: key, buffer, field70: 0 });
    }
    this.ready = this.voices.length > 0;
    if (!this.ready) this.failure = "no-browser-audio-sources";
  }

  _stop(voice) {
    const plan = planNativeAudioStop({
      voice,
      streamHandle: voice.browserStream?.handle,
    });
    if (plan.status !== "ready") return plan;
    for (const operation of plan.operations) {
      switch (operation.op) {
        case "setSoundField70":
          operation.sound.field70 = operation.value;
          break;
        case "destroyStream":
          // A predecoded browser buffer replaces the native streaming decoder.
          // Retire this play's resource identity before stopping/detaching the
          // source. The immutable decode cache survives; no native decoder ID
          // or OpenAL streaming-buffer equivalence is claimed.
          voice.browserStream = null;
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
    if (packet.soundType === 2) return this._requestSpeech(packet, frame);
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
    return this._playBuffer({
      sound,
      frame,
      gain,
      radius,
      flags: 0,
      slot: 0,
      location: frame.location,
    });
  }

  _playBuffer({ sound, frame, gain, radius, flags, slot, location }) {
    if (this.context.state !== "running")
      return unsupported("browser-audio-locked");
    const priority = nativeAudioPriority({
      radius,
      volume: gain,
      flags,
      location,
      viewTargetLocation: frame.viewTargetLocation,
    });
    if (priority.status !== "ready") return priority;
    const selected = selectNativeAudioVoice({
      soundId: slot,
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
      node.playbackRate.value = 1; // Original PCM and tutorial voice pitch.
      node.loop = false; // Neither admitted source path requests looping.
      Object.assign(voice, {
        sound,
        actor: flags & 0x100 ? null : frame.owner,
        sessionOwner: frame.owner,
        epoch: frame.epoch,
        soundId: selected.soundId,
        flags,
        priority: priority.priority,
        radius,
        gain,
        location: [...location],
        fadeState: 0,
        fadeElapsed: 0,
        fadeDuration: 0,
        browserStream:
          flags & 4 ? { handle: ++this.browserStreamSerial } : null,
        field54: 1,
        field58: 0,
        node,
        ended: false,
      });
      // Ordinary stereo PCM is same-pawn; voice flag0x10 bypasses attenuation.
      // Browser decoding/output replaces native OpenAL/Vorbis device work.
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

  _resetSpeech() {
    // Neutral NEW browser-session state, not a claimed native constructor dump.
    this.speechState = {
      kind: 0,
      delay: 0,
      ref: "",
      voiceHandle: -1,
      musicHandle: -1,
      flags: 0,
    };
    this.speechSnapshot = {
      available: true,
      ogg: false,
      wav: false,
      music: false,
      voiceEnd: false,
    };
    this.speechOwner = null;
    this.speechEpoch = null;
    this.lastSpeechResult = null;
  }

  _requestSpeech(packet, frame) {
    if (!this._frame(frame))
      return unsupported("missing-current-pawn-audio-state");
    if (this.context.state !== "running")
      return unsupported("browser-audio-locked");
    if (
      !Number.isFinite(this.profile.oggVoiceVolume) ||
      f(this.profile.oggVoiceVolume) !== this.profile.oggVoiceVolume
    )
      return unsupported("original-voice-volume-unavailable");
    const delay = nativeSpeechDelay(packet.delay);
    const ref = String(packet.sound).toLowerCase();
    if (delay === null) return unsupported("invalid-original-voice-delay");
    if (!this.speechSounds.has(ref))
      return unsupported("original-voice-buffer-unavailable");
    // One controller request field: a later packet replaces a pending request.
    Object.assign(this.speechState, { kind: 1, delay, ref });
    this.speechOwner = frame.owner;
    this.speechEpoch = frame.epoch;
    this.lastSpeechResult = { status: "requested", ref, delay };
    return this.lastSpeechResult;
  }

  _tickSpeech(frame, delta) {
    if (this.speechOwner === null) return;
    if (
      !this._frame(frame) ||
      frame.owner !== this.speechOwner ||
      frame.epoch !== this.speechEpoch
    ) {
      this._resetSpeech();
      return;
    }
    tickNativeSpeech(
      this.speechState,
      { ...this.speechSnapshot, delta },
      {
        stopMusic: (handle, duration) => {
          const voice = this.voices[handle - 1];
          if (voice?.sound)
            Object.assign(voice, {
              fadeState: 2,
              fadeElapsed: 0,
              fadeDuration: duration,
            });
        },
        playVoice: (ref) => {
          const gain = f(Math.max(0, Math.min(1, this.profile.oggVoiceVolume)));
          const template = this.speechSounds.get(ref);
          const result = !template
            ? unsupported("original-voice-buffer-unavailable")
            : gain <= 0
              ? { status: "rejected", reason: "voice-volume-zero" }
              : this._playBuffer({
                  sound: { ...template },
                  frame,
                  gain,
                  radius: 1000,
                  flags: 0x114,
                  slot: 1,
                  location: [0, 0, 0],
                });
          this.lastSpeechResult = result;
          return result.status === "playing" ? result.voiceIndex + 1 : 0;
        },
        // The existing legacy music pool has no native music handle. Do not
        // invent one or silently apply these operations to an unrelated bus.
        setMusicVolume: () => {
          throw new Error("Native music handle is not integrated");
        },
      },
    );
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

  update(frame, delta = 0) {
    if (!Number.isFinite(delta) || delta < 0 || !Number.isFinite(f(delta)))
      return;
    this._tickSpeech(frame, f(delta));
    const observations = {
      available: true,
      ogg: false,
      wav: false,
      music: false,
      voiceEnd: false,
    };
    for (const voice of this.voices) {
      if (voice.soundId === 0) continue;
      if (
        voice.ended ||
        !this._frame(frame) ||
        voice.sessionOwner !== frame.owner ||
        voice.epoch !== frame.epoch
      ) {
        if (voice.ended && (voice.flags & 0x104) === 0x104)
          observations.voiceEnd = true;
        this._stop(voice);
        continue;
      }
      // Native observations precede the fade pass. A fade retired this frame
      // remains visible to the controller until the next driver observation.
      if (voice.flags & 0x100) observations.ogg = true;
      else voice.location = [...frame.location];
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
      if (voice.fadeState === 2) {
        const fade = nativeSpeechFade({
          elapsed: voice.fadeElapsed,
          duration: voice.fadeDuration,
          delta: f(delta),
          volume: this.profile.oggVoiceVolume,
        });
        if (fade.status !== "ready") {
          this._stop(voice);
          continue;
        }
        voice.fadeElapsed = fade.elapsed;
        voice.output.gain.value = fade.gain;
      } else voice.output.gain.value = voice.gain;
    }
    this.speechSnapshot = observations;
  }

  reset() {
    // Browser session retirement, not an asserted native SetViewport mapping.
    for (const voice of this.voices) this._stop(voice);
    this._resetSpeech();
  }

  dispose() {
    this.reset();
    for (const voice of this.voices) voice.output.disconnect();
    this.voices = [];
    this.ready = false;
  }
}
