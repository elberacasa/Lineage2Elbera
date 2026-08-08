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
// FORMAT (tools/world/bspfloor.py has the authoritative description):
//   u32 magic 'BSPF' 0x46505342, u16 gridSize, u16 maxLayers,
//   i32 originX, i32 originY, i32 spacing,
//   then gridSize*gridSize records (row-major, gx fastest):
//   u8 count, count x i16 height (L2 world Z, ascending, deduped within 8).
//
// A tile without BSP floors ships no file; load() answers null and every
// consumer falls back to its pre-BSP behaviour.

const MAGIC = 0x46505342;

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
    if (p !== buf.byteLength) {
      throw new Error(`bspfloor: ${p} bytes consumed of ${buf.byteLength}`);
    }
    this.offsets = offsets;
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
