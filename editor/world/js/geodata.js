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
// NSWE passage flags are exposed via passable() for a future wall-collision
// pass — NOT consumed by movement code yet (see note at the bottom).

const MAGIC = 0x4C324731;

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
      Math.floor((x - this.origin[0]) / this.cellSize)));
    const cy = Math.max(0, Math.min(this.cells - 1,
      Math.floor((y - this.origin[1]) / this.cellSize)));
    const block = this._block(cx >> 3, cy >> 3);
    // 8x8 cells per block, row-major (y inner)
    return block.cells[(cy & 7) * this.blockCells + (cx & 7)];
  }

  /** Ground height (L2 world units) at (x, y, z): the layer height NEAREST
   *  to z. Without z, the LOWEST layer (a deliberate, safe default).
   *
   *  maxUp (L2 units, optional): walking rule — a walker may only GAIN
   *  maxUp in one step; layers above z + maxUp are walls, not floors.
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
      let floor = null;
      for (const l of layers) {
        if (l.height <= z + maxUp && (floor == null || l.height > floor)) {
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

  /** NSWE passage check between ADJACENT cells (for the future wall pass —
   *  movement code does NOT consume this yet). A bit in the FROM cell's
   *  nswe flags allows moving OUT of the cell that way. */
  passable(fromX, fromY, toX, toY) {
    const layers = this._layersAt(fromX, fromY);
    if (!layers || !layers.length) return false;
    const fx = Math.floor((fromX - this.origin[0]) / this.cellSize);
    const fy = Math.floor((fromY - this.origin[1]) / this.cellSize);
    const dx = Math.sign(Math.floor((toX - this.origin[0]) / this.cellSize) - fx);
    const dy = Math.sign(Math.floor((toY - this.origin[1]) / this.cellSize) - fy);
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
