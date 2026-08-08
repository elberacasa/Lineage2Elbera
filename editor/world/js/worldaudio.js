// The world's own soundscape: zone music and placed ambient emitters.
//
// `assets/world/<tile>/audio.json` is written by tools/world/audio_extract.py
// out of the retail `.unr` tiles — the same actors the 2006 client reads. Two
// kinds live in it:
//
//   ambient  AmbientSoundObject actors: a sound, a world position, an audible
//            radius, a volume, a pitch, and a day/night/water type. There are
//            172,253 of them across the 100 tiles — around 1,700 on a single
//            tile. That number is the whole design problem here.
//   music    MusicVolume brushes: a BSP box and a track. Standing inside one is
//            what starts a town's theme in retail, and the boxes overlap, so
//            "which song" is a containment test, not a nearest-neighbour one.
//
// Why emitters are culled rather than all started: every live one is a looping
// AudioBufferSourceNode plus a PannerNode, and the panner is HRTF — a few
// thousand of those would cost more CPU than the renderer. Only emitters whose
// own radius actually reaches the listener are candidates, and of those we keep
// the MAX_LIVE nearest. That is not a quality compromise: a sound whose radius
// does not reach you is silent by the game's own definition, and the retail
// client does the same thing for the same reason.
//
// Re-evaluated at 4 Hz, not per frame. A footstep's worth of movement cannot
// change which emitters are audible, and the diffing allocates.

import * as THREE from 'three';
import { l2ToThree } from './coords.js';
import { audio } from './audio.js';

const MAX_LIVE = 16;          // concurrent ambient loops
const UPDATE_HZ = 4;
const HYSTERESIS = 1.15;      // must recede 15% past its radius before stopping

// AmbientSoundType, from Engine.u's ASType1 enum:
// 0 Always, 1 Day, 2 Night, 3 Water. Interlude has no day/night cycle in this
// client, so day and night emitters would both play at once and fight. Until a
// clock exists we take the day set, which is what a player sees on screen.
const TYPE_ALWAYS = 0, TYPE_DAY = 1, TYPE_NIGHT = 2;

export class WorldAudio {
  constructor() {
    this.tile = null;
    this.ambient = [];        // { key, sound, pos: Vector3, radius, volume, pitch, type }
    this.music = [];          // { songs, min: Vector3, max: Vector3 }
    this.live = new Set();    // keys currently looping
    this._acc = 0;
    this._song = null;
  }

  // Swap to a tile's soundscape. Stops everything the previous tile started —
  // an emitter is meaningless once its tile is unloaded.
  async load(tile, baseUrl = '/scenes') {
    if (this.tile === tile) return;
    this.stopAll();
    this.tile = tile;
    this.ambient = [];
    this.music = [];

    let data;
    try {
      const res = await fetch(`${baseUrl}/${tile}/audio.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      // Tiles converted before audio_extract.py ran simply have no soundscape.
      console.warn(`[worldaudio] ${tile}: ${err.message}`);
      return;
    }
    if (this.tile !== tile) return;   // a newer tile landed while we fetched

    for (let i = 0; i < (data.ambient || []).length; i++) {
      const a = data.ambient[i];
      const t = a.type == null ? TYPE_ALWAYS : a.type;
      if (t === TYPE_NIGHT) continue;
      this.ambient.push({
        key: `${tile}:${i}`,
        sound: a.sound,
        pos: l2ToThree(a.position[0], a.position[1], a.position[2]),
        // radius/volume/pitch are null where the actor omitted the property;
        // audio_extract.py deliberately does not invent UE2 class defaults, so
        // the fallbacks belong here, at the point of use.
        radius: a.radius == null ? 80 : a.radius,
        volume: a.volume == null ? 250 : a.volume,
        pitch: a.pitch == null ? 1 : a.pitch,
      });
    }

    for (const m of (data.music || [])) {
      const songs = m.songs && m.songs.length ? m.songs : (m.song ? [m.song] : []);
      if (!songs.length || !m.bounds) continue;
      const lo = l2ToThree(m.bounds.min[0], m.bounds.min[1], m.bounds.min[2]);
      const hi = l2ToThree(m.bounds.max[0], m.bounds.max[1], m.bounds.max[2]);
      // l2ToThree negates Y, so the box corners swap on that axis.
      this.music.push({
        songs,
        min: new THREE.Vector3(Math.min(lo.x, hi.x), Math.min(lo.y, hi.y), Math.min(lo.z, hi.z)),
        max: new THREE.Vector3(Math.max(lo.x, hi.x), Math.max(lo.y, hi.y), Math.max(lo.z, hi.z)),
      });
    }
  }

  stopAll() {
    audio.ambientStopAll();
    this.live.clear();
    this._song = null;
  }

  // `pos` is the listener in three-space (the character, not the camera — the
  // player's body is what stands inside a music volume).
  update(dt, pos) {
    if (!audio.ready || !audio.unlocked || !pos) return;
    this._acc += dt;
    if (this._acc < 1 / UPDATE_HZ) return;
    this._acc = 0;

    this._updateMusic(pos);
    this._updateAmbient(pos);
  }

  _updateMusic(pos) {
    // Boxes overlap (a town interior sits inside a town-wide volume); the
    // smallest containing box is the most specific and wins.
    let best = null, bestVol = Infinity;
    for (const m of this.music) {
      if (pos.x < m.min.x || pos.x > m.max.x) continue;
      if (pos.z < m.min.z || pos.z > m.max.z) continue;
      // Y is deliberately ignored: the brushes are waist-high in places and a
      // player standing on a roof or in a cellar is still in the same zone.
      const vol = (m.max.x - m.min.x) * (m.max.z - m.min.z);
      if (vol < bestVol) { best = m; bestVol = vol; }
    }
    const song = best ? best.songs[0] : null;
    if (song === this._song) return;
    this._song = song;
    audio.music(song);        // null crossfades to silence
  }

  _updateAmbient(pos) {
    const want = [];
    for (const a of this.ambient) {
      const d = a.pos.distanceTo(pos);
      const reach = a.radius * 25 * 0.01;    // same unit rule as audio.playAt
      const limit = this.live.has(a.key) ? reach * HYSTERESIS : reach;
      if (d <= limit) want.push({ a, d });
    }
    want.sort((p, q) => p.d - q.d);
    const keep = new Set();
    for (let i = 0; i < Math.min(MAX_LIVE, want.length); i++) keep.add(want[i].a.key);

    for (const key of this.live) {
      if (!keep.has(key)) { audio.ambientStop(key); this.live.delete(key); }
    }
    for (let i = 0; i < Math.min(MAX_LIVE, want.length); i++) {
      const a = want[i].a;
      if (this.live.has(a.key)) continue;
      this.live.add(a.key);
      audio.ambientStart(a.key, a.sound, a.pos,
                         { volume: a.volume, radius: a.radius });
    }
  }

  // for verification
  get liveCount() { return this.live.size; }
  get currentSong() { return this._song; }
}

export const worldAudio = new WorldAudio();
