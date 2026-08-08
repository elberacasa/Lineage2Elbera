// Footsteps — retail's own footfall frames, retail's own step banks.
//
// The game played ZERO footstep sounds before this module existed. What it
// plays now, and where every part of it came from:
//
// ---------------------------------------------------------------------------
// WHEN — the animation says so, not a timer
// ---------------------------------------------------------------------------
// Interlude fires each footstep from an AnimNotify_Sound embedded in the walk
// and run sequences of the pawn's .ukx. tools/audio/build_stepnotify.py reads
// those notifies straight out of the MeshAnimation body and writes
// assets/audio/stepnotify.json; this module seeks them on the AnimationAction's
// OWN clock, so the sound lands on the pose it was authored on no matter what
// rate the clip is played at. There is no interval and no cadence constant
// anywhere in this file — a timer drifts out of phase with the legs within a
// couple of seconds and would have been a guess besides.
//
// Two footfalls per cycle, per pawn, per weapon stance: MFighter's 12-frame
// walk fires at 0.2083 and 0.6667 of the sequence, his 13-frame run at 0.1538
// and 0.6154, and FShaman's walk at 0.0615 and 0.5154. 336 step notifies over
// 168 locomotion sequences, all 14 playable pawns.
//
// `u` (not `t`) is what this module compares against: retail's `t` is a
// fraction of a NumFrames-long sequence while the shipped glTF clip holds
// frames 0..NumFrames-1, so u = t*N/(N-1) is the same instant expressed as a
// fraction of the clip three.js is actually playing. build_stepnotify.py
// asserts that relation against every .gltf it emits for.
//
// ---------------------------------------------------------------------------
// WHICH — four banks of three, read out of the notify objects
// ---------------------------------------------------------------------------
// Every AnimNotify_Sound serializes eight sound arrays (walk and run for each
// of LAND / GRASS / WATER / ACTOR). They are identical on all 336 step
// notifies, so `banks` in stepnotify.json is the pawn's whole vocabulary:
//
//     land   default_walk_01..03      / default_run_01..03
//     grass  grass_walk_01..03        / grass_run_01,02,02  (retail's own dup)
//     water  water_shalow_01..03      / water_shalow_01..03 (run == walk)
//     actor  Stone_Hard_Walk_01..03   / Stone_Hard_Run_01..03
//
// A StaticMeshActor may override with its own StepSound_1..3 — 12,015 of them
// do, across the 100 shipped tiles, and tools/audio/build_steps.py already
// extracted them into <tile>/steps.json. Those are a single bank of three used
// for both gaits (retail authored e.g. stone_gritty_run_01..03 on a rock),
// so they are played as-is rather than split into walk/run.
//
// Volume and Radius ride each step and are the notify's own (250 / 30, except
// the second footfall of Walk_Dual_Mshaman, which retail authored at 60).
// audio.js takes both as raw table values.
//
// ---------------------------------------------------------------------------
// WHICH SURFACE — what is sourced, and the one thing that is ours
// ---------------------------------------------------------------------------
// WATER is the tile's own WaterVolume: scene.json "water" carries one rect and
// height per brush (tools/world/README.md). Feet at or below that height and
// inside the rect is water. The engine's exact predicate (any contact? waist
// deep?) lives in packed engine.dll and is NOT decoded — "the feet are under
// the water plane" is the minimal reading, and it is marked as such.
//
// ACTOR is the prop under the feet. The engine gets that from its own floor
// trace, which this client cannot reproduce: the walker is driven by geodata
// and the terrain heightfield, neither of which knows props exist, so a
// character never actually stands ON a rock — it walks through it. THE TEST
// BELOW IS THEREFORE OURS, not decoded: the feet are on an actor when they are
// inside that actor's own world bounding box, and the smallest such box wins.
// It carries no tuned constant, and it does not depend on whether the prop is
// currently drawn (a raycast does — three.js skips invisible objects, and
// terrain.js hides whole prop clusters past the draw distance).
//
// It is restricted to props that carry their OWN StepSound bank on purpose: a
// bare static mesh cannot be told apart from one merely stood beside, and
// answering "stone_hard, because that tree trunk is a static mesh" would be
// worse than answering "ground".
//
// LAND is everything else.
//
// GRASS IS UNREACHABLE AND THAT IS THE HONEST STATE. Nothing in the .unr says
// which terrain is grass: TerrainLayer has no sound field, and the decision is
// made in engine.dll, which ships packed. The bank is extracted and sits in
// stepnotify.json unused rather than being wired to a plausible-looking proxy
// (decoration-layer density was the obvious candidate and is a guess).
// DefaultActorWalk/RunSound (Stone_Hard) is unreachable for the same kind of
// reason — see the trace note above.

import * as THREE from 'three';
import { audio } from './audio.js';
import { L2_TO_M } from './coords.js';

const NOTIFY_URL = '/audio/stepnotify.json';

// A step is "crossed" when the clip's phase passes its notify time. Actions
// that have not advanced at all this frame are skipped rather than replayed.
const _feet = new THREE.Vector3();

export class Footsteps {
  constructor() {
    this.data = null;              // stepnotify.json
    this.ready = false;
    this.tile = null;              // tile whose surface index is loaded
    this.tileLoading = null;
    this.actorPositions = null;    // [{ pos, refs, box, volume }] per actor
    this.actorBoxes = null;        // the subset that is actually drawn
    this.tileStats = null;         // verification: what setTile resolved
    this.state = new WeakMap();    // Character -> { action, phase }
    this.fired = 0;                // verification counter
    this.lastStep = null;          // verification: the most recent step
  }

  // ---- data -------------------------------------------------------------

  async load() {
    try {
      const res = await fetch(NOTIFY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.ready = !!(this.data && this.data.banks && this.data.pawns);
    } catch (err) {
      // assets/audio is gitignored and regenerated by tools/audio/*.py — the
      // client runs silent rather than failing to boot.
      console.warn(`[steps] no stepnotify.json, footsteps off: ${err.message}`);
      this.ready = false;
    }
    return this.ready;
  }

  /**
   * The tile's per-actor StepSound banks (tools/audio/build_steps.py).
   *
   * steps.json keys props by their index in scene.json, and terrain.js draws
   * every prop as an InstancedMesh whose instance matrix is composed straight
   * from the placement. No prop glTF carries a node transform (checked over
   * all 287 templates on 20_20), so the instance's translation IS
   * l2ToThree(placement.position) and joins the two, with no need to
   * reproduce terrain.js's clustering to learn which instance is which.
   *
   * The join is by PROXIMITY, not by an exact key. InstancedMesh keeps its
   * matrices in a Float32 attribute while scene.json positions are doubles,
   * so the two disagree in the last ~1e-3 m and any fixed quantization loses
   * placements that land on a bin boundary: a millimetre key silently dropped
   * 17 of 20_20's 541 banked actors, every one of them a skeleton* whose z
   * falls on a half-millimetre. JOIN_EPS is a float32 tolerance, not a
   * gameplay number.
   */
  async setTile(tile, terrain) {
    if (tile === this.tile || this.tileLoading === tile) return;
    this.tileLoading = tile;
    const props = (terrain && terrain.def && terrain.def.props) || [];
    let doc = null;
    try {
      const res = await fetch(`/scenes/${encodeURIComponent(tile)}/steps.json`);
      if (res.ok) doc = await res.json();
    } catch { /* no steps.json for this tile: actor banks stay empty */ }
    if (this.tileLoading !== tile) return;    // a newer tile won the race

    // One entry per distinct actor POSITION. A position can be shared: 20_20
    // stacks three fortress pieces on one point, and across all 100 tiles
    // exactly 6 shared positions carry DIFFERENT banks out of 12,015 actors.
    // The first wins and the collision is counted rather than hidden.
    const bins = new Map();          // "bx,by,bz" -> [entry]
    const entries = [];
    let mapped = 0, conflicts = 0;
    if (doc && doc.props && doc.names) {
      for (const [idx, bank] of Object.entries(doc.props)) {
        const p = props[Number(idx)];
        if (!p || !p.position) continue;
        const refs = bank.map(i => doc.names[i]).filter(Boolean);
        if (!refs.length) continue;
        mapped++;
        const [lx, ly, lz] = p.position;
        const pos = new THREE.Vector3(lx * L2_TO_M, lz * L2_TO_M, -ly * L2_TO_M);
        const have = Footsteps._lookup(bins, pos);
        if (have) {
          if (have.refs.join(' ') !== refs.join(' ')) conflicts++;
          continue;
        }
        const e = { pos, refs, box: null, volume: 0 };
        entries.push(e);
        Footsteps._bin(bins, e);
      }
    }

    // World bounding box per banked actor, from the geometry three.js is
    // already holding. One pass over the tile's instances (17,828 on 20_20),
    // once per tile load.
    const m = new THREE.Matrix4();
    const t = new THREE.Vector3();
    try {
      for (const obj of (terrain && terrain.props) || []) {
        if (obj.isInstancedMesh) {
          let geoBox = null;
          for (let i = 0; i < obj.count; i++) {
            obj.getMatrixAt(i, m);
            t.set(m.elements[12], m.elements[13], m.elements[14]);
            const e = Footsteps._lookup(bins, t);
            if (!e) continue;
            if (!geoBox) {
              if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
              geoBox = obj.geometry.boundingBox;
            }
            const b = geoBox.clone().applyMatrix4(m);
            if (e.box) e.box.union(b); else e.box = b;
          }
        } else if (obj.position) {
          const e = Footsteps._lookup(bins, obj.position);
          if (!e) continue;
          const b = new THREE.Box3().setFromObject(obj);
          if (e.box) e.box.union(b); else e.box = b;
        }
      }
    } catch (err) {
      // The tile can be torn down while the steps.json fetch is in flight;
      // half an index is fine (those actors fall back to LAND) and a throw
      // here would take the frame with it.
      console.warn(`[steps] ${tile}: actor index cut short: ${err.message}`);
    }

    const boxes = [];
    const size = new THREE.Vector3();
    for (const e of entries) {
      if (!e.box) continue;              // authored but never drawn
      e.box.getSize(size);
      e.volume = size.x * size.y * size.z;
      boxes.push(e);
    }

    this.actorPositions = entries;
    this.actorBoxes = boxes;
    this.tileStats = { banked: mapped, positions: entries.length,
                       boxes: boxes.length, conflicts };
    this.tile = tile;
    this.tileLoading = null;
  }

  // Float32 instanceMatrix vs float64 scene.json: the two agree to about a
  // millimetre. 1 cm is comfortably above that and far below the distance
  // between two authored placements.
  static get JOIN_EPS() { return 0.01; }

  static _bin(bins, e) {
    const E = Footsteps.JOIN_EPS;
    const seen = new Set();
    for (const dx of [-E, E]) {
      for (const dy of [-E, E]) {
        for (const dz of [-E, E]) {
          const k = `${Math.floor(e.pos.x + dx)},${Math.floor(e.pos.y + dy)},`
            + `${Math.floor(e.pos.z + dz)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const list = bins.get(k);
          if (list) list.push(e); else bins.set(k, [e]);
        }
      }
    }
  }

  static _lookup(bins, p) {
    const list = bins.get(
      `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`);
    if (!list) return null;
    const E = Footsteps.JOIN_EPS;
    for (const e of list) {
      if (Math.abs(e.pos.x - p.x) <= E && Math.abs(e.pos.y - p.y) <= E
          && Math.abs(e.pos.z - p.z) <= E) return e;
    }
    return null;
  }

  // ---- surface ----------------------------------------------------------

  /**
   * Which bank the ground under `feet` calls for.
   * -> { kind: 'actor'|'water'|'land', refs: [ref, ...] }
   * `gait` is 'walk' or 'run'; the actor bank ignores it (see the header).
   */
  surfaceAt(feet, gait, terrain) {
    // WATER: the tile's own WaterVolume rects, in L2 coordinates.
    const water = terrain && terrain.def && terrain.def.water;
    if (water && water.length && !(terrain.interior)) {
      const lx = feet.x / L2_TO_M, ly = -feet.z / L2_TO_M, lz = feet.y / L2_TO_M;
      for (const w of water) {
        const [x0, y0, x1, y1] = w.rect;
        if (lx >= Math.min(x0, x1) && lx <= Math.max(x0, x1)
            && ly >= Math.min(y0, y1) && ly <= Math.max(y0, y1)
            && lz <= w.height) {
          return { kind: 'water', refs: this.data.banks.water[gait] };
        }
      }
    }
    // ACTOR: the banked prop whose box holds the feet (OUR test — header).
    const refs = this._actorUnder(feet);
    if (refs) return { kind: 'actor', refs };
    return { kind: 'land', refs: this.data.banks.land[gait] };
  }

  // The banked actor whose world box contains the feet; smallest box wins,
  // so a rock inside a courtyard beats the courtyard.
  _actorUnder(feet) {
    const boxes = this.actorBoxes;
    if (!boxes || !boxes.length) return null;
    let best = null, bestVol = Infinity;
    for (const e of boxes) {
      const b = e.box;
      if (feet.x < b.min.x || feet.x > b.max.x) continue;
      if (feet.z < b.min.z || feet.z > b.max.z) continue;
      if (feet.y < b.min.y || feet.y > b.max.y) continue;
      if (e.volume < bestVol) { bestVol = e.volume; best = e.refs; }
    }
    return best;
  }

  // ---- per-character driving --------------------------------------------

  /** The step table for one pawn's clip, or null when it is not locomotion. */
  stepsFor(modelId, clipName) {
    if (!this.ready || !modelId || !clipName) return null;
    const pawn = this.data.pawns[modelId];
    if (!pawn) return null;
    return pawn.clips[clipName] || null;
  }

  /**
   * Advance one Character (self or a remote player) and fire whatever its
   * clip crossed this frame. Returns the number of steps played.
   */
  tick(ch, terrain) {
    if (!this.ready || !ch || !ch.mixer || !ch.current) return 0;
    const action = ch.current;
    const clip = action.getClip();
    const table = this.stepsFor(ch.modelId, clip && clip.name);
    let st = this.state.get(ch);
    if (!table || !clip.duration) {
      if (st) st.action = null;
      return 0;
    }
    const phase = ((action.time % clip.duration) + clip.duration) % clip.duration
      / clip.duration;
    if (!st) { st = { action: null, phase: 0 }; this.state.set(ch, st); }
    if (st.action !== action) {
      // A fresh clip starts its own cycle: arm at the current phase so a
      // walk->run swap does not replay every notify it skipped.
      st.action = action;
      st.phase = phase;
      return 0;
    }
    const prev = st.phase;
    st.phase = phase;
    if (phase === prev) return 0;
    const wrapped = phase < prev;
    let played = 0;
    for (const step of table.steps) {
      const u = step.u;
      const crossed = wrapped ? (u > prev || u <= phase) : (u > prev && u <= phase);
      if (!crossed) continue;
      this._fire(ch, table, step, terrain);
      played++;
    }
    return played;
  }

  _fire(ch, table, step, terrain) {
    ch.group.getWorldPosition(_feet);
    // `gait` is the retail sequence's own action token (Walk_*/Run_*), not a
    // guess off the clip name.
    const surface = this.surfaceAt(_feet, table.gait, terrain);
    this.fired++;
    this.lastStep = { model: ch.modelId, clip: ch.current.getClip().name,
                      u: step.u, kind: surface.kind, refs: surface.refs };
    audio.playOneOf(surface.refs, _feet,
                    { volume: step.volume, radius: step.radius, bus: 'sfx' });
  }

  /**
   * The one call main.js makes. `entities` is optional; when given, every
   * remote player it holds walks audibly too.
   */
  update(character, entities, tile, terrain) {
    if (!this.ready) return;
    if (tile && tile !== this.tile) this.setTile(tile, terrain);
    if (character) this.tick(character, terrain);
    if (entities && entities.entities) {
      for (const e of entities.entities.values()) {
        if (e.kind === 'player' && e.mixer) this.tick(e, terrain);
      }
    }
  }
}

export const footsteps = new Footsteps();
