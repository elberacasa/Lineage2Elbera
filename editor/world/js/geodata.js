// Per-tile geodata (blockstream-v1) — true ground heights, incl. multi-level
// structures (bridges, two-floor buildings, dungeon floors).
//
// FROZEN contract (tools/world/README.md, docs/geodata-format.md):
//   geodata.json: {tile, cellSize: 16, origin: [x0, y0], cells: 2048,
//                  blockCells: 8, blocks: 256, layers: [{data, encoding,
//                  bytes}], stats}
//   geodata.bin:  u32 magic 0x4C324731 ('L2G1'), u16 tileX, u16 tileY
//   then 256x256 blocks (X outer, Y inner), each 8x8 cells row-major:
//     u8 0 FLAT       -> i16 height (nswe implied 0x0F, open)
//     u8 1 COMPLEX    -> 64 x i16 packed cell words
//     u8 2 MULTILAYER -> per cell: u8 layerCount (1..127),
//                        layerCount x i16 packed cell words
//   packed cell word: nswe = w & 0x000F (E1 W2 S4 N8 — a bit allows moving
//                     OUT of the cell that way)
//                     height = int16(w & 0xFFF0) >> 1  (arithmetic shift)
//   origin = world X/Y of cell (0,0)'s CORNER == scene.json.origin[:2];
//   cell of a world point: cx = floor((x - origin[0]) / cellSize), clamp.
//
// THE MULTI-LAYER QUERY RULE (the whole point): height is a function of
// (x, y, z) — pick the layer height NEAREST to the current z. A z-less
// lookup picks the wrong floor in every bridge/two-floor structure.
//
// NSWE passage flags are exposed via passable() and consumed by the
// click-to-move pathing (NavGrid below): coarse A* over the geodata, with
// the same walking rule as movement (heightAt maxUp + from-cell nswe).

const MAGIC = 0x4C324731;

// Cell-index epsilon: L2 coordinates reach queries as float round-trips
// (x * 0.01 -> / 0.01), and at exact cell boundaries the division lands
// ~1e-12 below the integer — floor() then flips into the ADJACENT cell,
// whose layer differs by meters at cliffs/walls/stair edges (measured on
// 17_25: -3728 vs -4144 at (-78336, 239616), a 3.9m sink). 1e-6 cells
// (1.6e-5 L2 units) is orders of magnitude above the float noise and
// orders below any real position change.
const CELL_EPS = 1e-6;

// aCis per-cell climb limit (GeoStructure.CELL_IGNORE_HEIGHT =
// CELL_HEIGHT * 6, server/.../geodata/GeoStructure.java:22-23; consumed
// by GeoEngine.canMove picking the layer below groundZ +
// CELL_IGNORE_HEIGHT, GeoEngine.java:696). Callers may request a SMALLER
// step, never a larger one: bigger steps chain cell-by-cell onto
// wall/foundation layers the nswe flags forbid (measured on 17_25:
// +2.28m onto TI village foundations with the old 200 cap).
const MAX_STEP_UP = 48;

// How far the geodata ground layer may sit from the drawn terrain and still
// be taken for the same surface (anchoredHeightAt below). MEASURED, not
// chosen for looks: the geodata-over-terrain band on flat ground is
// +26.9..+34.2 (one CELL_HEIGHT quantum wide), and on real ground the
// per-point gap |nearest layer - drawn terrain| has p95 = 33..43 on the
// open tiles (16_21, 16_24) and 110..148 on the town tiles, where the two
// surfaces genuinely disagree (stale heightmap rectangles, building floors
// and roofs that no terrain vertex describes). 64 = 8 x CELL_HEIGHT sits
// above the whole open-ground distribution and below the structure
// population: it accepts 98%/97% of the sampled points on 16_21/16_24 and
// 84% on Giran (22_22), leaving the rest on the raw geodata height, which
// is the correct answer where there is no terrain counterpart.
export const GEO_ANCHOR_MAX = 64;

export class Geodata {
  constructor(meta, buf) {
    this.meta = meta;
    this.origin = meta.origin;
    this.cellSize = meta.cellSize || 16;
    this.cells = meta.cells || 2048;
    this.blockCells = meta.blockCells || 8;
    this.blocks = meta.blocks || 256;
    this.view = new DataView(buf);
    this.blockCache = new Map();   // blockIndex -> Int16Array-like cell data
    this.offsets = null;           // Uint32Array blockIndex -> byte offset
  }

  static async load(baseUrl, sceneDef) {
    const ref = sceneDef && sceneDef.geodata;
    if (!ref) return null;
    const meta = await (await fetch(baseUrl + ref)).json();
    const layer = meta.layers && meta.layers[0];
    if (!layer || layer.encoding !== 'blockstream-v1') return null;
    const buf = await (await fetch(baseUrl + layer.data)).arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint32(0, true) !== MAGIC) return null;
    return new Geodata(meta, buf);
  }

  // One sequential pass to index block offsets (variable-length blocks).
  // Measured: single-digit ms for a 4-9 MB tile — done once, on first query.
  _index() {
    const n = this.blocks * this.blocks;
    const offsets = new Uint32Array(n);
    let p = 8;   // magic u32 + tileX u16 + tileY u16
    const v = this.view;
    for (let i = 0; i < n; i++) {
      offsets[i] = p;
      const type = v.getUint8(p);
      if (type === 0) p += 1 + 2;
      else if (type === 1) p += 1 + 128;
      else if (type === 2) {
        p += 1;
        for (let c = 0; c < 64; c++) {
          const layers = v.getUint8(p);
          p += 1 + layers * 2;
        }
      } else throw new Error(`geodata: bad block type ${type} at block ${i}`);
    }
    this.offsets = offsets;
  }

  _block(bx, by) {
    const idx = bx * this.blocks + by;   // X outer, Y inner
    let block = this.blockCache.get(idx);
    if (block) return block;
    if (!this.offsets) this._index();
    const v = this.view;
    let p = this.offsets[idx];
    const type = v.getUint8(p++);
    const cells = new Array(64);
    if (type === 0) {
      const h = v.getInt16(p, true);
      for (let c = 0; c < 64; c++) cells[c] = [{ nswe: 0x0F, height: h }];
    } else if (type === 1) {
      for (let c = 0; c < 64; c++) cells[c] = [decodeWord(v.getInt16(p + c * 2, true))];
    } else {
      for (let c = 0; c < 64; c++) {
        const layers = v.getUint8(p++);
        const arr = new Array(layers);
        for (let l = 0; l < layers; l++) {
          arr[l] = decodeWord(v.getInt16(p, true));
          p += 2;
        }
        cells[c] = arr;
      }
    }
    block = { type, cells };
    this.blockCache.set(idx, block);
    return block;
  }

  _layersAt(x, y) {
    const cx = Math.max(0, Math.min(this.cells - 1,
      Math.floor((x - this.origin[0]) / this.cellSize + CELL_EPS)));
    const cy = Math.max(0, Math.min(this.cells - 1,
      Math.floor((y - this.origin[1]) / this.cellSize + CELL_EPS)));
    const block = this._block(cx >> 3, cy >> 3);
    // 8x8 cells per block, row-major (y inner)
    return block.cells[(cy & 7) * this.blockCells + (cx & 7)];
  }

  /** Ground height (L2 world units) at (x, y, z): the layer height NEAREST
   *  to z. Without z, the LOWEST layer (a deliberate, safe default).
   *
   *  maxUp (L2 units, optional): walking rule — a walker may only GAIN
   *  maxUp in one step (capped at MAX_STEP_UP, the aCis per-cell limit);
   *  layers above z + step are walls, not floors.
   *  Among the remaining candidates the HIGHEST is the floor. When NO
   *  layer is within reach (walking into a wall/cliff face) the walker is
   *  blocked: the result is z itself, so height never snaps up mid-walk.
   *  Descents are unbounded (falling is legitimate). Without maxUp the
   *  historical nearest-layer semantics apply (spawn/teleport lookups). */
  heightAt(x, y, z = null, maxUp = null) {
    const layers = this._layersAt(x, y);
    if (!layers || !layers.length) return null;
    if (z == null) return layers.reduce((m, l) => Math.min(m, l.height), Infinity);
    if (maxUp != null) {
      const step = Math.min(maxUp, MAX_STEP_UP);
      let floor = null;
      for (const l of layers) {
        if (l.height <= z + step && (floor == null || l.height > floor)) {
          floor = l.height;
        }
      }
      return floor == null ? z : floor;
    }
    if (layers.length === 1) return layers[0].height;
    let best = layers[0].height, bestD = Math.abs(layers[0].height - z);
    for (let i = 1; i < layers.length; i++) {
      const d = Math.abs(layers[i].height - z);
      if (d < bestD) { bestD = d; best = layers[i].height; }
    }
    return best;
  }

  /** Walking height RE-ANCHORED onto the terrain the client actually draws.
   *
   *  The geodata surface and the .unr terrain surface are NOT the same
   *  surface. Measured (tools/world/verify_terrain_z.py, section B) over
   *  50 453 dead-flat cells inside FLAT geodata blocks on 16_21, and
   *  reproduced on every tile tried: the geodata height stands
   *  +26.9 .. +34.2 L2 units above the decoded heightmap surface — a band
   *  exactly one CELL_HEIGHT (8) wide, i.e. one constant offset of ~30 plus
   *  the 8-unit quantisation of the packed cell word. It is a constant, not
   *  a scale error: fitting it against (h - 32768) over the full 22 000-unit
   *  height range of 17_22 gives a slope of -1.3e-3, 0.4% of heightScale.
   *
   *  The heightmap surface is the one that is right for RENDERING: it
   *  reproduces the .unr's own TerrainSector bounding boxes to within one
   *  G16 step (verify_terrain_z.py section A, 33-95% of sectors landing on
   *  exactly +1 step), and retail flat-bottomed props rest on it — the 49
   *  V_Obj_S.O_Box01 crates of 17_25 sit +0.5 above it and -68.6 below
   *  geodata. Putting the model's feet on the geodata height therefore
   *  floats it ~30 units, 0.6 of a 46-unit character, over the ground the
   *  player is looking at.
   *
   *  So: geodata still chooses the LEVEL (walking rule, bridges, floors),
   *  and the drawn terrain supplies the Z of the ground level. No constant
   *  is subtracted — the offset is taken from the cell itself: the layer
   *  NEAREST the drawn terrain IS this cell's ground layer, so replacing it
   *  by terrainZ and carrying every other layer's relative offset removes
   *  the bias wherever the two surfaces describe the same ground, and
   *  leaves multi-level geometry intact.
   *
   *  terrainZ: the drawn terrain height at (x, y), L2 units.
   *  anchorMax: how far the ground layer may sit from the drawn terrain and
   *    still be the same surface. Beyond it the cell has no terrain
   *    counterpart (under a building, a stale-heightmap rectangle, a
   *    dungeon) and the raw geodata height is returned unchanged.
   *  Returns null only when the cell has no geodata at all. */
  anchoredHeightAt(x, y, z, maxUp, terrainZ, anchorMax = GEO_ANCHOR_MAX) {
    const layers = this._layersAt(x, y);
    if (!layers || !layers.length) return null;
    const picked = this.heightAt(x, y, z, maxUp);
    if (picked == null) return null;
    let ground = null, best = Infinity;
    for (const l of layers) {
      const d = Math.abs(l.height - terrainZ);
      if (d < best) { best = d; ground = l.height; }
    }
    if (ground == null || best > anchorMax) return picked;
    return terrainZ + (picked - ground);
  }

  /** NSWE passage check between ADJACENT cells (consumed by the NavGrid
   *  edge tests below — the aCis canMove from-cell check, `nswe & dir`,
   *  GeoEngine.java:892). A bit in the FROM cell's nswe flags allows
   *  moving OUT of the cell that way. */
  passable(fromX, fromY, toX, toY) {
    const layers = this._layersAt(fromX, fromY);
    if (!layers || !layers.length) return false;
    const fx = Math.floor((fromX - this.origin[0]) / this.cellSize + CELL_EPS);
    const fy = Math.floor((fromY - this.origin[1]) / this.cellSize + CELL_EPS);
    const dx = Math.sign(Math.floor((toX - this.origin[0]) / this.cellSize + CELL_EPS) - fx);
    const dy = Math.sign(Math.floor((toY - this.origin[1]) / this.cellSize + CELL_EPS) - fy);
    let flag = 0;
    if (dx > 0) flag = 0x1;        // E
    else if (dx < 0) flag = 0x2;   // W
    else if (dy > 0) flag = 0x4;   // S
    else if (dy < 0) flag = 0x8;   // N
    else return true;              // same cell
    return (layers[0].nswe & flag) !== 0;
  }

  /** Decoded-block count and rough bytes held (perf reporting). */
  stats() {
    let bytes = 0;
    for (const b of this.blockCache.values()) {
      bytes += b.cells.reduce((s, c) => s + c.length * 4, 0);
    }
    return { blocksDecoded: this.blockCache.size, bytesHeld: bytes };
  }
}

function decodeWord(w) {
  // height = int16(w & 0xFFF0) >> 1: sign-extend the masked 16-bit value,
  // THEN arithmetic-shift (JS `&` zero-extends into int32 — naive masking
  // turns negative heights into huge positives)
  const m = w & 0xFFF0;
  const s = m >= 0x8000 ? m - 65536 : m;
  return { nswe: w & 0x000F, height: s >> 1 };
}

// --- Coarse navigation grid + A* (click-to-move pathing) -------------------
//
// Why coarse: a tile is 2048x2048 geodata cells (4M) — per-click A* at that
// resolution is too heavy for a browser. Nav cells are NAV_CELL L2 units
// (8x8 geodata cells, 256x256 = 65k per tile); geodata cells align with nav
// cells globally (cellSize 16 divides NAV_CELL, tile origins are multiples
// of 32768), so one global cell grid spans tiles without re-anchoring.
//
// The grid is IMPLICIT — nothing is prebuilt. geoAt(x, y) answers the
// Geodata covering a world point (the center tile plus whatever neighbor
// geodata has loaded); points without geodata are blocked, so a path never
// leaves loaded ground and the caller re-paths when more of it lands.
//
// An edge between nav cells is walkable when the underlying geodata allows
// the walk, mirroring aCis canMove (GeoEngine.java:892-913):
//   * nswe: the FROM cell's exit flag across the shared boundary, sampled
//     between the two geodata cells straddling the boundary midpoint;
//   * height: the walking rule (heightAt with maxUp = MAX_STEP_UP) against
//     the path's CURRENT z — layers above z + step are walls, descents are
//     unbounded, and bridges/underpasses resolve exactly like walking does.
//   Diagonals additionally require both orthogonal edges (no cutting wall
//   corners).
//
// findPath is budgeted (expansion count + wall clock). When the goal is
// unreachable within budget/loaded ground, it returns the path to the
// reachable cell CLOSEST to the goal with complete:false — walking that
// far either lands on newly loaded geodata (re-path continues) or
// confirms the stall. null means no route at all (no geodata under the
// start, no walkable ground near the click, zero progress): the caller
// falls back to straight legs.
export const NAV_CELL = 128;          // L2 units per nav cell
const NAV_MAX_EXPANSIONS = 60000;     // A* work caps per click
const NAV_TIME_MS = 150;
const NAV_SMOOTH_MS = 300;            // separate cap for string pulling
const NAV_GOAL_SNAP_RINGS = 4;        // click on a wall -> walk next to it

export class NavGrid {
  // geoAt(x, y): world L2 coords -> Geodata (or null when unloaded). The
  // grid only reads heightAt() + passable(), so tests may stub it.
  constructor(geoAt) {
    this.geoAt = geoAt;
  }

  // Walking floor at world (x, y) approached at height z: the walking-rule
  // layer, or null when the point is a wall (every layer above z + step)
  // or has no geodata.
  _floorAt(x, y, z) {
    const geo = this.geoAt(x, y);
    if (!geo) return null;
    const lowest = geo.heightAt(x, y);              // z-less: lowest layer
    if (lowest == null || lowest > z + MAX_STEP_UP) return null;
    return geo.heightAt(x, y, z, MAX_STEP_UP);
  }

  // nswe across one axis of a nav-cell boundary: sampled between the
  // geodata cells straddling the boundary midpoint (NAV_CELL/2 from the
  // from-cell center, half a geodata cell to each side).
  _exitOpen(cx, cy, dx, dy) {
    const mx = cx + dx * NAV_CELL / 2, my = cy + dy * NAV_CELL / 2;
    const fx = mx - dx * 8, fy = my - dy * 8;
    const geo = this.geoAt(fx, fy);
    return geo != null && geo.passable(fx, fy, mx + dx * 8, my + dy * 8);
  }

  // Edge from nav cell (ix, iy) toward (dx, dy) (each in {-1,0,1}, not
  // both 0), walked at height z: the target cell's floor z, or null.
  _trans(ix, iy, z, dx, dy) {
    const cx = ix * NAV_CELL + NAV_CELL / 2;
    const cy = iy * NAV_CELL + NAV_CELL / 2;
    if (!this._exitOpen(cx, cy, dx, 0)) return null;
    if (!this._exitOpen(cx, cy, 0, dy)) return null;
    if (dx && dy) {
      // corner-cut guard: both orthogonal neighbors must be floors too
      if (this._floorAt(cx + dx * NAV_CELL, cy, z) == null) return null;
      if (this._floorAt(cx, cy + dy * NAV_CELL, z) == null) return null;
    }
    return this._floorAt(cx + dx * NAV_CELL, cy + dy * NAV_CELL, z);
  }

  // Straight-line walkability between world points a{x,y,z} and b{x,y},
  // checked at GEODATA resolution (16u steps) — the exact rule the walker
  // (and aCis canMove) applies per crossed cell: from-cell nswe + the
  // walking-rule layer pick. This is what makes the emitted legs honest:
  // the coarse edge tests are only samples, so every line the character
  // will actually walk is re-validated here. Returns the floor z reached
  // at b, or null when the line is blocked.
  _lineOk(a, b) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16));
    let z = a.z, px = a.x, py = a.y;
    for (let i = 1; i <= n; i++) {
      const x = a.x + (b.x - a.x) * i / n;
      const y = a.y + (b.y - a.y) * i / n;
      const geo = this.geoAt(px, py);
      if (!geo || !geo.passable(px, py, x, y)) return null;
      z = this._floorAt(x, y, z);
      if (z == null) return null;
      px = x; py = y;
    }
    return z;
  }

  // A* from (sx, sy, sz) to (gx, gy, gz), world L2 coords. Returns
  // {points: [{x, y, z}], complete, expansions, ms} (points smoothed by
  // string pulling, first = exact start, last = exact goal when complete),
  // or null when there is no route at all.
  findPath(sx, sy, sz, gx, gy, gz) {
    const t0 = performance.now();
    const six = Math.floor(sx / NAV_CELL), siy = Math.floor(sy / NAV_CELL);
    // start must stand on loaded, walkable ground
    if (this._floorAt(sx, sy, sz) == null) return null;

    // goal snap: a click ON a wall aims at the nearest walkable cell
    let gix = Math.floor(gx / NAV_CELL), giy = Math.floor(gy / NAV_CELL);
    if (this._floorAt(gx, gy, gz) == null) {
      let found = null;
      for (let r = 1; r <= NAV_GOAL_SNAP_RINGS && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = gix + dx, ny = giy + dy;
            if (this._floorAt(nx * NAV_CELL + NAV_CELL / 2,
                              ny * NAV_CELL + NAV_CELL / 2, gz) != null) {
              found = [nx, ny];
            }
          }
        }
      }
      if (!found) return null;
      [gix, giy] = found;
    }

    const key = (ix, iy) => (ix + 8192) * 32768 + (iy + 8192);
    const hOct = (ix, iy) => {
      const dx = Math.abs(ix - gix), dy = Math.abs(iy - giy);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    const gScore = new Map([[key(six, siy), 0]]);
    const cameFrom = new Map();
    const zAt = new Map([[key(six, siy), sz]]);
    const closed = new Set();
    const heap = [[hOct(six, siy), key(six, siy)]];   // [f, key] binary heap
    const push = (item) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };

    const GOAL = key(gix, giy);
    let bestKey = key(six, siy), bestH = hOct(six, siy);
    let expansions = 0, complete = false;
    while (heap.length) {
      const [, ck] = pop();
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (++expansions > NAV_MAX_EXPANSIONS) break;
      if ((expansions & 1023) === 0 && performance.now() - t0 > NAV_TIME_MS) break;
      if (ck === GOAL) { complete = true; bestKey = ck; break; }
      const cix = Math.floor(ck / 32768) - 8192, ciy = ck % 32768 - 8192;
      const ch = hOct(cix, ciy);
      if (ch < bestH) { bestH = ch; bestKey = ck; }
      const cz = zAt.get(ck), cg = gScore.get(ck);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nz = this._trans(cix, ciy, cz, dx, dy);
          if (nz == null) continue;
          const nk = key(cix + dx, ciy + dy);
          if (closed.has(nk)) continue;
          const ng = cg + (dx && dy ? 1.4142 : 1);
          if (ng < (gScore.get(nk) ?? Infinity)) {
            gScore.set(nk, ng);
            cameFrom.set(nk, ck);
            zAt.set(nk, nz);
            push([ng + hOct(cix + dx, ciy + dy), nk]);
          }
        }
      }
    }

    if (!complete && bestKey === key(six, siy)) return null;   // zero progress

    // reconstruct (world points at cell centers, z = path floor per node)
    const cells = [];
    for (let ck = bestKey; ck != null; ck = cameFrom.get(ck)) {
      const cix = Math.floor(ck / 32768) - 8192, ciy = ck % 32768 - 8192;
      cells.push({
        x: cix * NAV_CELL + NAV_CELL / 2,
        y: ciy * NAV_CELL + NAV_CELL / 2,
        z: zAt.get(ck),
      });
    }
    cells.reverse();
    cells[0] = { x: sx, y: sy, z: sz };
    if (complete) cells[cells.length - 1] = { x: gx, y: gy, z: gz };

    // string pulling: drop every waypoint the walker can skip in a
    // straight line — every emitted segment is re-validated at geodata
    // walk resolution (_lineOk). If even the next A* cell fails that (a
    // coarse-grid false positive), the route ends here, short of the goal.
    const points = [cells[0]];
    let tries = 0;
    for (let i = 0; i < cells.length - 1;) {
      let j = cells.length - 1, z = null;
      for (; j > i; j--) {
        // smoothing budget: past it, stop trying long pulls (each is a
        // 16u-resolution scan) and emit adjacent, still-validated segments
        if (j > i + 1 && (tries++ & 31) === 0
            && performance.now() - t0 > NAV_SMOOTH_MS) j = i + 1;
        z = this._lineOk(cells[i], cells[j]);
        if (z != null) break;
      }
      if (z == null) {
        return {
          points, complete: false, expansions,
          ms: performance.now() - t0,
        };
      }
      if (!(j === cells.length - 1 && complete)) cells[j] = { ...cells[j], z };
      points.push(cells[j]);
      i = j;
    }

    return {
      points, complete, expansions,
      ms: performance.now() - t0,
    };
  }
}
