// BSP floor raster: assets/world/<tile>/bspfloor.bin, written by
// tools/world/bspfloor.py. Per TERRAIN GRID POINT (the same 256x256 /
// 128-unit lattice as heightmap.u16), the L2 world Z of every upward-facing
// level-BSP surface over that point, ascending.
//
// WHY THE CLIENT NEEDS IT. The .unr heightmap is the NATURAL GROUND. A town
// plaza is a stone slab BUILT ON TOP of it: measured at the Giran square
// (22_22, L2 82000/148000) the heightmap says -3600.8, the decoded
// Giran_floor03/04 slab top is -3496.0, and geodata says -3464. Two client
// decisions used to have no way to tell those three apart:
//
//   * the stale-rectangle correction (heightfix.js) read the 136-unit
//     heightmap-vs-geodata gap as a stale heightmap and lifted the DIRT
//     terrain to -3464, burying the pavement it was supposed to be under;
//   * heightAtWorld anchors the walker onto "the drawn terrain", which over
//     a slab is not the terrain mesh at all -- it is the slab.
//
// Both now ask this file where the BSP already floors the world.
//
// SECTION 2, THE WALK RASTER (2026-08-08). The two consumers above ask two
// different questions and only one of them is answered per terrain vertex.
// heightAtWorld asks about a POINT, and at 128 units a point on the Giran
// plaza staircase and a point on the plaza slab BURIED UNDER IT are the same
// sample — which is why the walker went through the stairs instead of up
// them. Section 2 answers the same question per GEODATA CELL (16 units, same
// origin, same floor() indexing, so a raster cell IS a geodata cell) and from
// the PROPS as well as the BSP — a staircase is a prop. Measured at the Giran
// stair, y=148618: per cell the tread's geodata layer stands +31 over the
// tread while the buried slab is +40..+96 under that same layer, so the
// documented geodata-over-surface band tells them apart. tools/world/
// bspfloor.py has the derivation and the mirrored-prop normal trap.
//
// FORMAT (tools/world/bspfloor.py has the authoritative description):
//   u32 magic 'BSPF' 0x46505342, u16 gridSize, u16 maxLayers,
//   i32 originX, i32 originY, i32 spacing,
//   then gridSize*gridSize records (row-major, gx fastest):
//   u8 count, count x i16 height (L2 world Z, ascending, deduped within 8).
//   [optional] u32 magic 'WALK' 0x4B4C4157, i32 fineSpacing, u16 fineCells,
//   u16 blockCells, then (fineCells/blockCells)^2 block records (row-major,
//   bx fastest): u8 type — 0 empty, 1 uniform (u8 count + i16s shared by all
//   64 cells), 2 per-cell (64 x u8 count + i16s, index (cy%8)*8 + cx%8).
//
// A tile without BSP floors ships no file; load() answers null and every
// consumer falls back to its pre-BSP behaviour. A file that stops after
// section 1 (a tile with no geodata, or an asset tree built before this
// existed) answers null from walkLayersAtWorld and _drawnGroundL2 falls back
// to the coarse raster it used before.

import { GEO_ANCHOR_MAX } from './geodata.js';

const MAGIC = 0x46505342;
const WALK_MAGIC = 0x4B4C4157;

// How far above a drawn surface its own geodata layer stands. MEASURED
// (tools/world/verify_terrain_z.py section B): +26.9..+34.2 on flat ground, a
// band exactly one CELL_HEIGHT wide, i.e. one ~+30 offset plus the 8-unit
// quantisation of the packed cell word. Widened to the quantum on both sides
// it is [24, 40] — the same band verify_walksurface.js gate D uses to decide
// whether a drawn surface is walkable at all. A surface with a layer in this
// band is the surface that layer describes; one without is something else
// (the slab buried under a staircase, the top of a crate the walker may not
// climb, a roof). Consumed by terrain.js _drawnGroundL2.
export const GEO_SURFACE_BAND = [24, 40];

export class BspFloor {
  constructor(buf) {
    const v = new DataView(buf);
    if (v.getUint32(0, true) !== MAGIC) throw new Error('bspfloor: bad magic');
    this.grid = v.getUint16(4, true);
    this.maxLayers = v.getUint16(6, true);
    this.origin = [v.getInt32(8, true), v.getInt32(12, true)];
    this.spacing = v.getInt32(16, true);
    this.view = v;
    // one pass to index the variable-length records (65 536 of them: sub-ms)
    const n = this.grid * this.grid;
    const offsets = new Uint32Array(n);
    let p = 20;
    for (let i = 0; i < n; i++) {
      offsets[i] = p;
      p += 1 + 2 * v.getUint8(p);
    }
    this.offsets = offsets;
    this.fine = null;
    if (p !== buf.byteLength) p = this._readWalk(v, p, buf.byteLength);
    if (p !== buf.byteLength) {
      throw new Error(`bspfloor: ${p} bytes consumed of ${buf.byteLength}`);
    }
  }

  // Section 2. One sequential pass to index the variable-length blocks, the
  // same shape as the section-1 pass above (65 536 blocks: sub-ms).
  //
  // '?walkraster=off' parses it and then throws it away, which leaves the
  // client behaving exactly as it did before section 2 existed: the coarse
  // 128-unit BSP-only raster, no props, walker through the stairs. Same idiom
  // as '?bspfloor=off' above and for the same reason — verify_walksurface.js
  // takes its before/after from ONE build instead of from two checkouts.
  _readWalk(v, p, end) {
    if (p + 12 > end || v.getUint32(p, true) !== WALK_MAGIC) return p;
    const off = typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('walkraster') === 'off';
    const fineSpacing = v.getInt32(p + 4, true);
    const cells = v.getUint16(p + 8, true);
    const blockCells = v.getUint16(p + 10, true);
    p += 12;
    const nb = cells / blockCells;
    if (!Number.isInteger(nb)) {
      throw new Error(`bspfloor: WALK ${cells} cells / ${blockCells} per block`);
    }
    const per = blockCells * blockCells;
    const offsets = new Int32Array(nb * nb);
    for (let i = 0; i < nb * nb; i++) {
      const type = v.getUint8(p);
      if (type === 0) { offsets[i] = -1; p += 1; continue; }
      offsets[i] = p;
      p += 1;
      if (type === 1) {
        p += 1 + 2 * v.getUint8(p);
      } else {
        for (let c = 0; c < per; c++) p += 1 + 2 * v.getUint8(p);
      }
    }
    if (!off) {
      this.fine = { spacing: fineSpacing, cells, blockCells, nb, per, offsets };
    }
    return p;
  }

  // -> BspFloor, or null when the tile ships none / anything goes wrong.
  static async load(baseUrl) {
    // '?bsp=off' already renders the tile the way it looked before the BSP
    // was decoded; the floor raster follows the same switch. '?bspfloor=off'
    // keeps the BSP buildings but drops the raster, i.e. the client exactly
    // as it shipped before this file existed — terrain drawn over the
    // pavement. That is how verify_pavement.js takes before/after from one
    // build instead of from two checkouts.
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search);
      if (q.get('bsp') === 'off' || q.get('bspfloor') === 'off') return null;
    }
    try {
      const res = await fetch(baseUrl + 'bspfloor.bin');
      // A tile with no BSP floors ships no file. The 404 body MUST still be
      // drained: fetch resolves on headers, and an unread body leaves the
      // request in flight forever as far as the network stack is concerned —
      // which is what `waitUntil: 'networkidle0'` waits on, so every suite
      // that uses it (verify_terrain, verify_geodata, ...) hangs until its
      // navigation timeout. Measured: one undrained 404 held the connection
      // open for the whole 42 s of the trace.
      if (!res.ok) {
        await res.arrayBuffer().catch(() => {});
        return null;
      }
      return new BspFloor(await res.arrayBuffer());
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn(`bspfloor: ${baseUrl}bspfloor.bin (${err.message})`);
      }
      return null;
    }
  }

  /** Floor heights (L2 world Z, ascending) over grid point (gx, gy).
   *  Empty array when the BSP floors nothing there. */
  layersAt(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= this.grid || gy >= this.grid) return EMPTY;
    const p = this.offsets[gy * this.grid + gx];
    const n = this.view.getUint8(p);
    if (!n) return EMPTY;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.view.getInt16(p + 1 + i * 2, true);
    return out;
  }

  /** The floor height over grid point (gx, gy) nearest to z, or null.
   *  `tol` (L2 units), when given, rejects anything further than that. */
  nearest(gx, gy, z, tol = Infinity) {
    const layers = this.layersAt(gx, gy);
    let best = null, bestD = tol;
    for (const h of layers) {
      const d = Math.abs(h - z);
      if (d <= bestD) { bestD = d; best = h; }
    }
    return best;
  }

  /** Same, addressed by L2 world position (nearest grid point — the raster
   *  is sampled at grid points, so no interpolation is defensible between a
   *  floored point and an unfloored one). */
  nearestAtWorld(x, y, z, tol = Infinity) {
    return this.nearest(
      Math.round((x - this.origin[0]) / this.spacing),
      Math.round((y - this.origin[1]) / this.spacing), z, tol);
  }

  /** SECTION 2 — every walkable drawn surface (BSP *and* props) over the
   *  GEODATA CELL containing L2 (x, y), ascending. `null` when the file
   *  carries no walk raster at all (so the caller can tell "this tile has no
   *  section 2" from "this cell has no surface", which is EMPTY). */
  walkLayersAtWorld(x, y) {
    const f = this.fine;
    if (!f) return null;
    const cx = Math.floor((x - this.origin[0]) / f.spacing);
    const cy = Math.floor((y - this.origin[1]) / f.spacing);
    if (cx < 0 || cy < 0 || cx >= f.cells || cy >= f.cells) return EMPTY;
    const bi = ((cy / f.blockCells) | 0) * f.nb + ((cx / f.blockCells) | 0);
    let p = f.offsets[bi];
    if (p < 0) return EMPTY;
    const v = this.view;
    const type = v.getUint8(p++);
    if (type !== 1) {
      // per-cell block: skip the records before this one
      const want = (cy % f.blockCells) * f.blockCells + (cx % f.blockCells);
      for (let c = 0; c < want; c++) p += 1 + 2 * v.getUint8(p);
    }
    const n = v.getUint8(p);
    if (!n) return EMPTY;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = v.getInt16(p + 1 + i * 2, true);
    return out;
  }

  /** Grid points carrying at least one floor (reporting/verification). */
  coveredCells() {
    let n = 0;
    for (let i = 0; i < this.offsets.length; i++) {
      if (this.view.getUint8(this.offsets[i])) n++;
    }
    return n;
  }
}

const EMPTY = [];

/** The surface the player actually SEES at L2 (x, y) — the terrain mesh
 *  unless something is drawn over that spot, and then that thing.
 *
 *  Lives here rather than in terrain.js because the CENTER tile and the
 *  decimated NEIGHBOR meshes (neighbors.js) must answer identically: a walker
 *  crossing a tile border between two different rules steps by the difference.
 *
 *  `terrainZ` is the mesh height there and `hintZ` the walker's current z
 *  (the multi-layer rule: which storey). The candidates are the terrain mesh
 *  itself plus every upward BSP and PROP surface over the GEODATA CELL
 *  containing (x, y) — the walk raster. Geodata picks between them:
 *
 *    * a raster surface must be ABOVE the mesh (below it, the mesh is what
 *      shows) and geodata must describe it — its nearest layer within
 *      GEO_ANCHOR_MAX, exactly the guard this rule has always applied, so
 *      nothing that used to be accepted is rejected now;
 *    * of two surfaces DESCRIBED BY THE SAME geodata layer, the one standing
 *      closest to the middle of the measured geodata-over-surface band
 *      (GEO_SURFACE_BAND) is the one that layer is about. That is the whole
 *      fix for "i dont go up the stairs i go trough them": under the Giran
 *      plaza staircase the BSP slab runs on at -3496 while the treads climb,
 *      and per 16-unit cell the treads sit +31 under their geodata layer while
 *      the slab sits +40, +48, ... +96 under the SAME layer. Nearest-to-z
 *      picked the slab every time and the walker never left it;
 *    * surfaces under DIFFERENT layers are different storeys — a bridge over a
 *      road, a second floor — and there the multi-layer rule still applies
 *      unchanged: the one nearest the walker's z.
 *
 *  THE MESH IS A CANDIDATE TOO, and that is not cosmetic. Putting props in the
 *  raster puts every crate, rock and curb top in it, and those pass the
 *  |layer - surface| <= 64 guard from the WRONG side — the layer is BELOW the
 *  crate top (measured on 22_22: 6.3% of prop surfaces are inside 64 but
 *  outside the band). With only raster surfaces in the running they would win
 *  by default and the walker would ride over the scenery; with the mesh in it,
 *  the crate loses to the ground its geodata layer actually describes.
 *  This costs nothing where the pavement is concerned: at a slab cell the mesh
 *  is the natural ground ~105 units under the slab and geodata stands ~137
 *  over it, so the guard rejects the mesh outright and the slab wins exactly
 *  as before — including the slab cells whose gap is 16 or 48 rather than 32.
 *
 *  A bspfloor.bin that predates the walk raster (or a tile with no geodata to
 *  adjudicate with) has no section 2; then this falls back to the coarse
 *  128-unit BSP-only rule it used before, which is the same rule minus the
 *  props and minus the resolution to place them.
 */
export function drawnGroundL2(bspFloor, geodata, xL2, yL2, terrainZ, hintZ) {
  if (!bspFloor || !geodata) return terrainZ;
  const walk = bspFloor.walkLayersAtWorld(xL2, yL2);
  const z = hintZ ?? terrainZ;
  if (walk == null) {                       // section 1 only
    const b = bspFloor.nearestAtWorld(xL2, yL2, z);
    if (b == null || b <= terrainZ) return terrainZ;
    const g = geodata.heightAt(xL2, yL2, b);
    if (g == null || Math.abs(g - b) > GEO_ANCHOR_MAX) return terrainZ;
    return b;
  }
  const mid = (GEO_SURFACE_BAND[0] + GEO_SURFACE_BAND[1]) / 2;
  let best = null, bestD = 0, bestScore = 0, bestBand = false, bestG = 0;
  const consider = (s) => {
    const g = geodata.heightAt(xL2, yL2, s);
    if (g == null) return;
    const gap = g - s;
    if (Math.abs(gap) > GEO_ANCHOR_MAX) return;
    const inBand = gap >= GEO_SURFACE_BAND[0] && gap <= GEO_SURFACE_BAND[1];
    const score = Math.abs(gap - mid);
    const d = Math.abs(s - z);
    let better;
    if (best === null) better = true;
    else if (inBand !== bestBand) better = inBand;
    else if (g === bestG) better = score < bestScore;   // same layer
    else better = d < bestD;                            // different storeys
    if (better) {
      best = s; bestD = d; bestScore = score; bestBand = inBand; bestG = g;
    }
  };
  consider(terrainZ);
  for (const s of walk) if (s > terrainZ) consider(s);
  return best === null ? terrainZ : best;
}
