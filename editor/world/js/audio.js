// Audio engine — retail sound, positioned in the world.
//
// Sources. `assets/audio/` is built by `tools/audio/build_audio.py` from the
// client's own files: 250 music tracks (Ogg Vorbis, stereo, untouched — NCSoft
// only overwrote the 4-byte "OggS" page marker with "L2SD") and 5,128 sound
// effects unpacked from the 25 encrypted `.uax` banks and transcoded to mono
// Opus. `manifest.json` keys every effect by the game's own reference syntax,
// lowercased: "itemsound.sword_small_1", "monsound.gremlin_dmg_1",
// "skillsound4.fatal_strike_cast". Those strings are exactly what
// `weapongrp.json`, `npcgrp.json` and `skillsoundgrp.json` already contain, so
// a caller plays a sound by handing over the reference it is already holding.
//
// The existing general conversion downmixes all effects. That is a fidelity
// gap: original quest feedback includes stereo PCM, and the native driver
// preserves its channels. tools/audio/export_quest_sounds.py preserves those
// originals separately. Do not substitute the mono files for their native
// playback path. The ordinary packet adapter admits a bounded same-pawn
// stereo path; complete driver/mixer behavior remains unported.
//
// Distance model. The data tables carry a volume and a radius per sound
// (`sound_vol`/`sound_radius` in npcgrp, `spell_vols`/`spell_rads` in
// skillsoundgrp, `SoundVolume`/`SoundRadius` on the map's AmbientSoundObjects).
// Volume is a 0..255 byte — 250 is the usual "full".
//
// RADIUS_UNIT AND THE FALLOFF CURVE ARE NOW DECODED FROM THE CLIENT'S OWN
// AUDIO DRIVER. Both used to be calibrations; neither is any more.
//
// The consumer of SoundRadius is ALAudio.dll (the OpenAL driver the Interlude
// client ships). It is an unpacked PE, so it disassembles. It imports two
// float globals from Core.dll:
//
//     ?GAudioMaxRadiusMultiplier@@3MA   Core.dll .data rva 0x1352EC = 50.0f
//     ?GAudioDefaultRadius@@3MA         Core.dll .data rva 0x1352F0 = 80.0f
//
// (Read straight out of Core.dll's export table + .data — see
// tools/audio/verify_falloff.py, which re-reads both and fails on drift.)
//
// ALAudio.dll dereferences the multiplier at nine call sites, always against
// the source's radius field, always in the same shape. Site 0x1000ADE8:
//
//     flds  0x20(%eax)        ; SoundRadius
//     movl  0x1004E7B4, %ecx  ; -> &GAudioMaxRadiusMultiplier
//     fmuls (%ecx)            ; R*M
//     fsubs 0x2C(%ebp)        ; R*M - distance
//     fmuls 0x20(%ebp)        ; * volume
//     flds  0x20(%eax)
//     fmuls (%ecx)            ; R*M
//     fdivrp                  ; -> volume * (R*M - d) / (R*M)
//     ... clamp(x, 0, 1) ... alSourcef(src, AL_GAIN /*0x100A*/, x)
//
// This is one manual AL_GAIN term, not the complete OpenAL output. Init also
// writes the configured AL_ROLLOFF_FACTOR (0.5 in the supplied local profile).
// The historical mono PannerNode path below therefore remains provisional;
// matching this term alone does not establish final attenuation equivalence.
//
// The 80.0 default is the same number worldaudio.js already falls back to for
// an AmbientSoundObject that omits SoundRadius; that was a guess when it was
// written and it happens to be right.
//
// Skill callers are now pinned independently: PlaySkillSound and the direct
// AnimNotify_Sound branch divide their authored volume by255 before the audio
// subsystem call (tools/ui/check_cast_sound_native.py). That does not settle
// NPC/weapon/UI caller gains, bus controls, or every later audio-driver path.
// The existing shared scale remains provisional for those other callers.
//
// Autoplay. Browsers refuse to start an AudioContext without a user gesture, so
// the context is created suspended and resumed on the first click or keypress.
// Everything before that point is silently dropped rather than queued: a burst
// of stale combat sounds firing the moment someone clicks would be worse than
// the silence it replaced.

import * as THREE from 'three';
import { L2_TO_M } from './coords.js';
import { createBrowserRandom } from './native-random.js';
import { NativePacketAudio } from './native-packet-audio.js';

const BASE = '/audio';
const MANIFEST_URL = `${BASE}/manifest.json`;

// GAudioMaxRadiusMultiplier from Core.dll (.data, 50.0f): a table's radius
// times this is the audible range in L2 world units. L2_TO_M then converts to
// the metres the scene graph is built in. Exported because worldaudio.js sizes
// its emitter-culling reach with the same rule and must not re-hardcode it.
export const RADIUS_UNIT = 50;
// GAudioDefaultRadius from Core.dll (.data, 80.0f): what the driver uses when
// a source carries no radius of its own.
export const DEFAULT_RADIUS = 80;
const VOLUME_SCALE = 1 / 255;      // Proven for the supported skill/direct-notify callers.

// There is no separate cull distance, and there must not be one.
//
// Under the linear model above (gain = 1 - d/(R x RADIUS_UNIT), decoded from
// ALAudio.dll) the gain reaches exactly zero at `maxDistance`, so maxDistance
// IS the inaudibility cutoff -- a second, smaller number can only truncate a
// sound that the client would still be playing.
//
// A `CULL_DISTANCE_M = 120` used to sit here, and it became a live defect
// the moment RADIUS_UNIT was corrected from 25 to 50: every one of the 6,519
// npcgrp records has sound_radius 250, i.e. an audible range of 125 m, and
// 176 skillsoundgrp entries reach 300-400 m. All of them were being clipped.

const BUSES = ['music', 'sfx', 'ambient', 'ui'];
const STORE_KEY = 'l2vzla.audio';

export class AudioEngine {
  constructor() {
    // Shared by all ported animation Sound notifies in this browser context.
    // Browser entropy is a seed adapter; other native RNG consumers and exact
    // CRT execution-context/seed history remain separate parity work. Audio
    // unlock, mute, buffer loading and reconnect do not create another stream.
    this.nativeRandom = createBrowserRandom();
    this.ctx = null;
    this.manifest = null;
    this.ready = false;
    this.buffers = new Map();        // key -> AudioBuffer
    this.pending = new Map();        // key -> Promise<AudioBuffer|null>
    this.missing = new Set();        // keys that 404'd, so we ask only once
    this.buses = {};                 // name -> GainNode
    this.volumes = this._loadVolumes();
    this._music = null;              // { source, gain, name }
    this._ambient = new Map();       // key -> { source, gain }
    this._unlockBound = null;
    this.nativePacketAudio = null;
    this.lastPacketSound = null;
    this.lastPlayedPacketSound = null;
  }

  // ---- lifecycle --------------------------------------------------------

  // Safe to call before any gesture: builds the graph and fetches the manifest,
  // but leaves the context suspended until the player interacts.
  async init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { console.warn('[audio] Web Audio unavailable — running silent'); return false; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);
    for (const name of BUSES) {
      const g = this.ctx.createGain();
      g.gain.value = this.volumes[name];
      g.connect(this.master);
      this.buses[name] = g;
    }

    this._unlockBound = () => this.resume();
    window.addEventListener('pointerdown', this._unlockBound, { passive: true });
    window.addEventListener('keydown', this._unlockBound);

    await this._initNativePacketAudio();

    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = await res.json();
      this.ready = true;
    } catch (err) {
      // No audio build present — the rest of the client must still run.
      console.warn('[audio] no manifest, running silent:', err.message);
      return false;
    }
    return true;
  }

  async _initNativePacketAudio() {
    try {
      const read = async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      };
      const [profile, metadata] = await Promise.all([
        read(`${BASE}/native-profile.json`).then(r => r.json()),
        read(`${BASE}/quest-sounds.json`).then(r => r.json()),
      ]);
      if (metadata.format !== 'l2-interlude-quest-sounds-v1') throw new Error('Unsupported original sound metadata');
      if (metadata.source?.SHA256 !== 'e16cd1701b485f4b76de4938af5674699b8622cb6e0c418c2c313044c485365d') {
        throw new Error('Unsupported original sound bank');
      }
      const buffers = new Map();
      await Promise.all(Object.entries(metadata.sounds).map(async ([key, info]) => {
        if (!/^\/audio\/quest\/quest_(accept|middle|finish|itemget|tutorial)\.wav$/.test(info.url)) {
          throw new Error('Unexpected original stereo URL');
        }
        const bytes = await read(info.url).then(r => r.arrayBuffer());
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== info.SHA256) throw new Error('Original stereo WAV hash differs');
        buffers.set(key, await this.ctx.decodeAudioData(bytes));
      }));
      let speech;
      try { speech = await this._loadTutorialSpeech(read); }
      catch (error) { console.warn('[audio] original tutorial speech unavailable:', error.message); }
      this.nativePacketAudio = new NativePacketAudio({ context: this.ctx, profile, sounds: metadata.sounds, buffers, speech });
      if (!this.nativePacketAudio.ready) throw new Error(this.nativePacketAudio.failure);
    } catch (error) {
      this.nativePacketAudio?.dispose();
      this.nativePacketAudio = null;
      console.warn('[audio] original packet audio unavailable:', error.message);
    }
  }

  async _loadTutorialSpeech(read) {
    const metadata = await read(`${BASE}/tutorial-voice.json`).then(r => r.json());
    if (metadata.format !== 'l2-interlude-tutorial-voice-v1' || metadata.languageVariant !== 'e' ||
        metadata.catalogSHA256 !== 'd6a59635328d18053a600d200b544ae84708fdbe3c553f197e1b393ce0284ea2')
      throw new Error('Unsupported original tutorial catalog');
    const buffers = new Map();
    // Predecode before admitting packets; no late replay after async loading.
    // Four workers bound simultaneous browser decoders, not game voice count.
    const entries = Object.entries(metadata.sounds);
    const catalog = entries.map(([key, info]) => {
      if (info.file !== `${key}-e.ogg`) throw new Error('Original voice catalog name differs');
      return { SHA256:info.SHA256, bytes:info.bytes, file:info.file };
    }).sort((a,b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
    const catalogHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(catalog)))), byte => byte.toString(16).padStart(2,'0')).join('');
    if (catalogHash !== metadata.catalogSHA256) throw new Error('Original tutorial catalog fingerprint differs');
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < entries.length) {
        const [key, info] = entries[next++];
        if (!/^tutorial_voice_[0-9]{3}[a-z]?$/.test(key) || info.url !== `/audio/voice/${key}-e.ogg`)
          throw new Error('Unexpected original voice URL');
        const bytes = await read(info.url).then(r => r.arrayBuffer());
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== info.SHA256 || bytes.byteLength !== info.bytes)
          throw new Error('Original tutorial voice hash differs');
        const buffer = await this.ctx.decodeAudioData(bytes);
        if (buffer.numberOfChannels !== info.channels)
          throw new Error('Original tutorial channel count differs');
        buffers.set(key, buffer);
      }
    }));
    return { sounds: metadata.sounds, buffers };
  }

  playPacketSound(packet, frame) {
    const result = this.nativePacketAudio?.play(packet, frame)
      ?? { status: 'unsupported', reason: 'original-packet-audio-unavailable' };
    this.lastPacketSound = result;
    if (result.status === 'playing') this.lastPlayedPacketSound = result;
    return result;
  }

  packetAudioState() {
    return {
      ready: !!this.nativePacketAudio?.ready,
      sources: this.nativePacketAudio?.voices.length ?? 0,
      active: this.nativePacketAudio?.voices.filter(v => v.soundId !== 0).length ?? 0,
      last: this.lastPacketSound,
      lastPlayed: this.lastPlayedPacketSound,
      speechBuffers: this.nativePacketAudio?.speechSounds.size ?? 0,
      speech: this.nativePacketAudio?.lastSpeechResult ?? null,
      speechPending: this.nativePacketAudio?.speechState.kind !== 0 && !!this.nativePacketAudio,
      nativeMusicIntegrated: false,
    };
  }

  updatePacketAudio(frame, delta) {
    this.nativePacketAudio?.update(frame, delta);
    const result = this.nativePacketAudio?.lastSpeechResult;
    if (result?.status === 'playing' && result !== this._lastSpeechReceipt) {
      this.lastPlayedPacketSound = result;
      this._lastSpeechReceipt = result;
    }
  }

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this._unlockBound) {
      window.removeEventListener('pointerdown', this._unlockBound);
      window.removeEventListener('keydown', this._unlockBound);
      this._unlockBound = null;
    }
  }

  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }

  // ---- volume -----------------------------------------------------------

  _loadVolumes() {
    // AUTHORED, all five. This is a browser mixer we invented: retail has
    // four sliders (SoundVolume / MusicVolume / WavVoiceVolume /
    // OggVoiceVolume, ALAudio's UALAudioSubsystem getters) and no 'ui' or
    // 'ambient' bus at all, so there is no retail default to port. The
    // Option.ini shipped with the client is one player's SAVED state
    // (SoundVolume=0.0), not a factory default, and reading it as one would
    // mute the game.
    const v = { master: 0.7, music: 0.35, sfx: 0.8, ambient: 0.45, ui: 0.6 };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      for (const k of Object.keys(v)) {
        if (typeof saved[k] === 'number') v[k] = Math.min(1, Math.max(0, saved[k]));
      }
    } catch { /* first run, or storage disabled */ }
    return v;
  }

  setVolume(bus, value) {
    const v = Math.min(1, Math.max(0, value));
    this.volumes[bus] = v;
    const node = bus === 'master' ? this.master : this.buses[bus];
    // AUTHORED 20 ms smoothing: a WebAudio artefact-avoidance constant
    // (a step change on a GainNode clicks). Nothing in the client has one.
    if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.volumes)); } catch { /* ignore */ }
  }

  // ---- buffers ----------------------------------------------------------

  _url(ref) {
    const key = String(ref).toLowerCase();
    const rel = this.manifest.sfx[key];
    return rel ? `${BASE}/sfx/${rel}` : null;
  }

  // Resolves to null (never throws) when a reference is absent — six of the
  // game's own references are malformed and will never resolve.
  async _buffer(ref) {
    const key = String(ref).toLowerCase();
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (this.missing.has(key)) return null;
    if (this.pending.has(key)) return this.pending.get(key);

    const url = this._url(key);
    if (!url) { this.missing.add(key); return null; }

    const job = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(key, buf);
        return buf;
      } catch (err) {
        console.warn(`[audio] ${key}: ${err.message}`);
        this.missing.add(key);
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, job);
    return job;
  }

  // Warm the cache without playing — for sounds we know are imminent (a
  // monster's damage bank the moment it spawns, the weapon we just equipped).
  prefetch(refs) {
    if (!this.ready || !this.ctx) return;
    for (const ref of refs) {
      if (ref) this._buffer(ref);
    }
  }

  // ---- listener ---------------------------------------------------------

  // Called once per frame from the render loop with the camera.
  setListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(_p);
    camera.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // Firefox and Safari still ship the deprecated setters; Chrome exposes
    // AudioParams. Support both rather than picking one and going silent.
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(_p.x, t);
      l.positionY.setValueAtTime(_p.y, t);
      l.positionZ.setValueAtTime(_p.z, t);
      l.forwardX.setValueAtTime(_f.x, t);
      l.forwardY.setValueAtTime(_f.y, t);
      l.forwardZ.setValueAtTime(_f.z, t);
      l.upX.setValueAtTime(_u.x, t);
      l.upY.setValueAtTime(_u.y, t);
      l.upZ.setValueAtTime(_u.z, t);
    } else {
      l.setPosition(_p.x, _p.y, _p.z);
      l.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
    }
    this._listenerPos = { x: _p.x, y: _p.y, z: _p.z };
  }

  // ---- playback ---------------------------------------------------------

  // The retail falloff, expressed as a PannerNode. ALAudio.dll computes
  // gain = clamp(1 - d/(SoundRadius*50), 0, 1) and writes it to AL_GAIN
  // itself; Web Audio's 'linear' distance model with refDistance 0 and
  // rolloffFactor 1 is the same expression, so the panner reproduces it
  // rather than approximating it. See the header block for the disassembly.
  //
  // Measured in headless Chrome through an OfflineAudioContext with
  // maxDistance 125 (a monster's radius 250): gain fell 1.00 / 0.75 / 0.50 /
  // 0.25 / 0.00 at d = 0 / 31.25 / 62.5 / 93.75 / 125 and stayed 0 past it.
  // Exactly 1 - d/125. refDistance 0 is accepted (the spec only rejects
  // negative values) and does not degenerate under the linear model.
  _panner(x, y, z, maxDistance) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.refDistance = 0;
    p.rolloffFactor = 1;
    p.maxDistance = maxDistance;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
    return p;
  }

  // One-shot at a world position. `volume` and `radius` are the raw table
  // values (authored gain, Unreal radius units); pass them straight through.
  //
  // The radius default is Core.dll's GAudioDefaultRadius (80.0f) -- the
  // driver's own answer for a source that carries no radius. It used to be
  // 50, which is RADIUS_UNIT's number reused as if it were a radius.
  // The volume default is AUTHORED: nothing in ALAudio.dll or Core.dll
  // exports a per-source default volume, and the only tables that would
  // supply one (npcgrp, skillsoundgrp) always carry their own.
  playAt(ref, position,
         { volume = 250, radius = DEFAULT_RADIUS, bus = 'sfx', pitch = 1, isCurrent = null } = {}) {
    if (!this.ready || !this.unlocked || !ref || !position || (isCurrent && !isCurrent())) return;

    // Callers hand us shared scratch vectors (main.js reuses one for every
    // entityHeadPos call), and the buffer may not resolve for several frames.
    // Snapshot the coordinates now or the sound plays wherever the caller's
    // vector happened to drift to.
    const px = position.x, py = position.y, pz = position.z;

    const maxDistance = Math.max(1, radius * RADIUS_UNIT * L2_TO_M);
    const lp = this._listenerPos;
    if (lp) {
      const dx = px - lp.x, dy = py - lp.y, dz = pz - lp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      // maxDistance IS the cutoff: the linear gain reaches zero there.
      if (d2 > maxDistance * maxDistance) return;
    }

    this._buffer(ref).then(buf => {
      // Browser decoding is asynchronous. A retired cast must not start a
      // newly decoded sound; this does not impose a native stop policy on
      // sounds already playing.
      if (!buf || !this.unlocked || (isCurrent && !isCurrent())) return;
      const panner = this._panner(px, py, pz, maxDistance);

      const gain = this.ctx.createGain();
      gain.gain.value = volume * VOLUME_SCALE;

      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch;
      src.connect(gain).connect(panner).connect(this.buses[bus] || this.buses.sfx);
      src.start();
      src.onended = () => { try { src.disconnect(); gain.disconnect(); panner.disconnect(); } catch { /* already gone */ } };
    });
  }

  // Non-positional one-shot: UI clicks, system feedback, our own inventory.
  // AUTHORED volume default, as in playAt: no decoded per-source default
  // exists, and interface sounds carry no table entry at all.
  play2D(ref, { volume = 250, bus = 'ui', pitch = 1 } = {}) {
    if (!this.ready || !this.unlocked || !ref) return;
    this._buffer(ref).then(buf => {
      if (!buf || !this.unlocked) return;
      const gain = this.ctx.createGain();
      gain.gain.value = volume * VOLUME_SCALE;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch;
      src.connect(gain).connect(this.buses[bus] || this.buses.ui);
      src.start();
      src.onended = () => { try { src.disconnect(); gain.disconnect(); } catch { /* already gone */ } };
    });
  }

  // Pick one of a bank at random — the tables give monsters 3 damage sounds and
  // weapons 4 impact sounds precisely so repeated hits don't sound identical.
  playOneOf(refs, position, opts) {
    if (!refs || !refs.length) return;
    const pool = refs.filter(Boolean);
    if (!pool.length) return;
    const ref = pool[(Math.random() * pool.length) | 0];
    if (position) this.playAt(ref, position, opts); else this.play2D(ref, opts);
  }

  // ---- music ------------------------------------------------------------

  // Crossfades to `name` (a filename in the manifest's music list, with or
  // without the .ogg). Re-requesting the current track is a no-op, so a caller
  // can drive this from a zone check every frame without restarting the music.
  //
  // fade = 2.0 IS UNSOURCED, and so is the crossfade shape. What the client
  // does say, in Engine.u's PlayerController:
  //
  //     function ClientSetMusic( string NewSong, EMusicTransition NewTransition )
  //         StopAllMusic( 0.0 );
  //         PlayMusic( NewSong, 3.0 );
  //
  // — a HARD STOP followed by a 3.0 s fade-in, not a crossfade, and 3.0 is
  // the only fade number anywhere in the client's script. But that is the
  // stock Unreal path, driven by Level.Song / MusicEvent / ACTION_PlayMusic,
  // and Interlude zone music does not use it: MusicVolume is
  // `native nativereplication`, carries only nMusicID / bForcePlayMusic /
  // bLoopMusic, and its PostBeginPlay does nothing but call Super. The switch
  // is made in engine.dll, which ships packed. audio_extract.py confirms no
  // shipped tile authors Level.Song at all.
  //
  // So 3.0-with-a-hard-stop is real but on the wrong path, and the right
  // path's number is not readable. 2.0-with-a-crossfade is left as-is rather
  // than swapped for a number that is sourced from somewhere else entirely.
  async music(name, { loop = true, fade = 2.0 } = {}) {
    if (!this.ready || !this.ctx) return;
    const file = name && (name.endsWith('.ogg') ? name : `${name}.ogg`);
    if (this._music && this._music.name === file) return;

    const old = this._music;
    if (old) {
      const t = this.ctx.currentTime;
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + fade);
      // AUTHORED 50 ms tail past the ramp, so the node is not stopped on the
      // exact sample the ramp reaches zero (that clicks in WebAudio).
      old.source.stop(t + fade + 0.05);
      this._music = null;
    }
    if (!file) return;

    // Streaming a 90-second track through decodeAudioData costs a few MB of
    // RAM but gives sample-accurate looping, which an <audio> element cannot.
    let buf;
    try {
      const res = await fetch(`${BASE}/music/${file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn(`[audio] music ${file}: ${err.message}`);
      return;
    }
    if (this._music) return;   // a newer request landed while we were fetching

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(gain).connect(this.buses.music);
    src.start();
    const t = this.ctx.currentTime;
    gain.gain.linearRampToValueAtTime(1, t + fade);
    this._music = { source: src, gain, name: file };
  }

  stopMusic(fade = 1.0) { this.music(null, { fade }); }

  // ---- ambient loops ----------------------------------------------------

  // Persistent positioned loops from the map's AmbientSoundObjects. Keyed by
  // the caller so a tile can start and stop its own emitters as it streams in
  // and out without tracking node handles.
  // radius default: Core.dll GAudioDefaultRadius (80.0f), the same constant
  // worldaudio.js passes explicitly. volume default AUTHORED, as in playAt.
  async ambientStart(key, ref, position,
                     { volume = 250, radius = DEFAULT_RADIUS } = {}) {
    if (!this.ready || !this.unlocked || this._ambient.has(key)) return;
    const buf = await this._buffer(ref);
    if (!buf || this._ambient.has(key)) return;

    const maxDistance = Math.max(1, radius * RADIUS_UNIT * L2_TO_M);
    const panner = this._panner(position.x, position.y, position.z, maxDistance);
    const gain = this.ctx.createGain();
    gain.gain.value = volume * VOLUME_SCALE;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain).connect(panner).connect(this.buses.ambient);
    src.start();
    this._ambient.set(key, { source: src, gain, panner });
  }

  ambientStop(key) {
    const a = this._ambient.get(key);
    if (!a) return;
    try { a.source.stop(); a.source.disconnect(); a.gain.disconnect(); a.panner.disconnect(); } catch { /* already gone */ }
    this._ambient.delete(key);
  }

  ambientStopAll() {
    for (const key of [...this._ambient.keys()]) this.ambientStop(key);
  }
}

// Scratch vectors for setListener — called every frame, so it must not allocate.
const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

export const audio = new AudioEngine();
