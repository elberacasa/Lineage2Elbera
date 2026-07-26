#!/usr/bin/env python3
"""geodata.py - per-tile geodata extraction for the web client.

Decodes the installed L2OFF geodata regions
(server/geodata-staging/geodata/<tx>_<ty>_conv.dat, format: docs/geodata-format.md
— independently re-verified byte-exact on 22_22) and emits, per world tile:

    assets/world/<tile>/geodata.bin    compact block stream ("blockstream-v1")
    assets/world/<tile>/geodata.json   FROZEN contract descriptor (README.md)

and adds "geodata": "geodata.json" to the tile's scene.json (idempotent).

Usage:
    python3 tools/world/geodata.py <tile> [...]   # generate for these tiles
    python3 tools/world/geodata.py --all          # every converted tile
    python3 tools/world/geodata.py --check <tile> [...]
                                                  # full validation of the output
                                                  # (re-parse, exact consumption,
                                                  # stats, height cross-check)

Why a block stream and not a full raster: measured on 22_22/17_25/16_11 —
block stream 1.6-5.6 MB/tile raw, a 2048x2048x3B raster is 12.6 MB/tile raw
always. The local dev server does not gzip, so raw size wins.
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
GEODATA_DIR = os.path.join(ROOT, "server", "geodata-staging", "geodata")
OUT_ROOT = os.path.join(ROOT, "assets", "world")

MAGIC = 0x4C324731  # 'L2G1'
CELL_SIZE = 16
BLOCK_CELLS = 8
REGION_BLOCKS = 256
ENCODING = "blockstream-v1"


# ---------------------------------------------------------------------------
# decode (L2OFF *_conv.dat, docs/geodata-format.md §4)
# ---------------------------------------------------------------------------

def parse_region(path):
    """-> list of 65536 blocks: (0, height) FLAT | (1, tuple64) COMPLEX |
    (2, [tuple_layers x64]) MULTILAYER. Cell words stay packed:
    nswe = w & 0xF, height = int16(w & 0xFFF0) >> 1."""
    with open(path, "rb") as f:
        data = f.read()
    pos = 18  # header
    blocks = []
    unpack = struct.unpack_from
    while pos < len(data):
        (typ,) = unpack("<h", data, pos)
        pos += 2
        if typ == 0:
            (h,) = unpack("<h", data, pos)
            pos += 4
            blocks.append((0, h))
        elif typ == 0x40:
            blocks.append((1, unpack("<64h", data, pos)))
            pos += 128
        else:
            cells = []
            for _ in range(64):
                (n,) = unpack("<h", data, pos)
                pos += 2
                if not 1 <= n <= 127:
                    raise ValueError("%s: bad layer count %d at 0x%X"
                                     % (path, n, pos))
                cells.append(unpack("<%dh" % n, data, pos))
                pos += 2 * n
            blocks.append((2, cells))
    if pos != len(data):
        raise ValueError("%s: parse stopped at 0x%X, file is 0x%X"
                         % (path, pos, len(data)))
    if len(blocks) != REGION_BLOCKS * REGION_BLOCKS:
        raise ValueError("%s: %d blocks, expected %d"
                         % (path, len(blocks), REGION_BLOCKS ** 2))
    return blocks


def cell_height(word):
    v = word & 0xFFF0
    if v & 0x8000:
        v -= 0x10000
    return v >> 1


# ---------------------------------------------------------------------------
# encode (blockstream-v1)
# ---------------------------------------------------------------------------

def encode_blockstream(tile, blocks):
    """Compact binary: magic + tile coords + per block (X outer, Y inner):
    u8 type | FLAT: i16 height | COMPLEX: 64xi16 words | MULTILAYER: per cell
    u8 layerCount + layerCount xi16 words."""
    tx, ty = (int(v) for v in tile.split("_"))
    out = bytearray(struct.pack("<IHH", MAGIC, tx, ty))
    for typ, pay in blocks:
        out.append(typ)
        if typ == 0:
            out += struct.pack("<h", pay)
        elif typ == 1:
            out += struct.pack("<64h", *pay)
        else:
            for layers in pay:
                out.append(len(layers))
                out += struct.pack("<%dh" % len(layers), *layers)
    return bytes(out)


def block_stats(blocks):
    stats = {"flat": 0, "complex": 0, "multilayer": 0}
    max_layers = 1
    multilayer_cells = 0
    for typ, pay in blocks:
        if typ == 0:
            stats["flat"] += 1
        elif typ == 1:
            stats["complex"] += 1
        else:
            stats["multilayer"] += 1
            for layers in pay:
                max_layers = max(max_layers, len(layers))
                if len(layers) > 1:
                    multilayer_cells += 1
    stats["maxLayers"] = max_layers
    stats["multilayerCells"] = multilayer_cells
    return stats


def write_tile_geodata(tile, out_dir):
    """Decode the region and write geodata.bin + geodata.json for a tile.
    Returns the descriptor dict, or None when no region exists."""
    region = os.path.join(GEODATA_DIR, "%s_conv.dat" % tile)
    if not os.path.exists(region):
        return None
    blocks = parse_region(region)
    blob = encode_blockstream(tile, blocks)
    bin_path = os.path.join(out_dir, "geodata.bin")
    with open(bin_path, "wb") as f:
        f.write(blob)
    tx, ty = (int(v) for v in tile.split("_"))
    stats = block_stats(blocks)
    desc = {
        "tile": tile,
        "cellSize": CELL_SIZE,
        "origin": [(tx - 20) * 32768.0, (ty - 18) * 32768.0],
        "cells": REGION_BLOCKS * BLOCK_CELLS,
        "blockCells": BLOCK_CELLS,
        "blocks": REGION_BLOCKS,
        "maxLayers": stats.pop("maxLayers"),
        "layers": [{"data": "geodata.bin", "encoding": ENCODING,
                    "bytes": len(blob)}],
        "stats": stats,
    }
    with open(os.path.join(out_dir, "geodata.json"), "w") as f:
        json.dump(desc, f, indent=1)
    return desc


def patch_scene_pointer(tile, out_dir):
    """Add/update the "geodata" pointer in an existing scene.json."""
    scene_path = os.path.join(out_dir, "scene.json")
    with open(scene_path) as f:
        scene = json.load(f)
    if scene.get("geodata") == "geodata.json":
        return False
    scene["geodata"] = "geodata.json"
    with open(scene_path, "w") as f:
        json.dump(scene, f, indent=1)
    return True


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------

def parse_blockstream(blob):
    """Inverse of encode_blockstream; returns (tx, ty, blocks)."""
    if len(blob) < 8 or struct.unpack_from("<I", blob, 0)[0] != MAGIC:
        raise ValueError("bad magic")
    tx, ty = struct.unpack_from("<HH", blob, 4)
    pos = 8
    blocks = []
    unpack = struct.unpack_from
    while pos < len(blob):
        typ = blob[pos]
        pos += 1
        if typ == 0:
            (h,) = unpack("<h", blob, pos)
            pos += 2
            blocks.append((0, h))
        elif typ == 1:
            blocks.append((1, unpack("<64h", blob, pos)))
            pos += 128
        else:
            cells = []
            for _ in range(64):
                n = blob[pos]
                pos += 1
                if not 1 <= n <= 127:
                    raise ValueError("bad layer count %d at 0x%X" % (n, pos))
                cells.append(unpack("<%dh" % n, blob, pos))
                pos += 2 * n
            blocks.append((2, cells))
    if pos != len(blob):
        raise ValueError("trailing bytes: consumed 0x%X of 0x%X"
                         % (pos, len(blob)))
    if len(blocks) != REGION_BLOCKS ** 2:
        raise ValueError("%d blocks" % len(blocks))
    return tx, ty, blocks


def check_tile_geodata(tile, out_dir=OUT_ROOT, samples=2048):
    """Full output validation for one tile. Prints a report line; returns a
    dict with the cross-check stats (also used for the multi-level report)."""
    d = os.path.join(out_dir, tile)
    with open(os.path.join(d, "geodata.json")) as f:
        desc = json.load(f)
    with open(os.path.join(d, "geodata.bin"), "rb") as f:
        blob = f.read()
    assert desc["cellSize"] == CELL_SIZE
    assert desc["cells"] == REGION_BLOCKS * BLOCK_CELLS
    assert desc["layers"][0]["encoding"] == ENCODING
    assert desc["layers"][0]["bytes"] == len(blob), "byte count mismatch"
    tx, ty = (int(v) for v in tile.split("_"))
    btx, bty, blocks = parse_blockstream(blob)
    assert (btx, bty) == (tx, ty), "tile coords mismatch"
    stats = block_stats(blocks)
    ml = stats.pop("maxLayers")
    assert stats == desc["stats"], "stats mismatch %s vs %s" % (stats,
                                                               desc["stats"])
    assert ml == desc["maxLayers"]
    # source round-trip: block-for-block equal to the region parse
    region = os.path.join(GEODATA_DIR, "%s_conv.dat" % tile)
    src_blocks = parse_region(region)
    assert src_blocks == blocks, "round-trip differs from source region"
    # height cross-check vs the terrain heightmap (2048 samples)
    import array
    import random
    h = array.array("H")
    with open(os.path.join(d, "heightmap.u16"), "rb") as f:
        h.frombytes(f.read())
    scene = json.load(open(os.path.join(d, "scene.json")))
    oz = scene["origin"][2]
    hs = scene["heightScale"]
    ox, oy = scene["origin"][0], scene["origin"][1]
    assert [ox, oy] == desc["origin"], "origin mismatch with scene.json"
    rng = random.Random(42)
    far = 0
    diffs = []
    for _ in range(samples):
        lx = rng.randrange(desc["cells"])
        ly = rng.randrange(desc["cells"])
        typ, pay = blocks[(lx >> 3) * REGION_BLOCKS + (ly >> 3)]
        ci = (ly & 7) * BLOCK_CELLS + (lx & 7)
        if typ == 0:
            heights = [pay]
        elif typ == 1:
            heights = [cell_height(pay[ci])]
        else:
            heights = [cell_height(w) for w in pay[ci]]
        vx = min(255, lx // (desc["cells"] // 256))
        vy = min(255, ly // (desc["cells"] // 256))
        th = oz + (h[vy * 256 + vx] - 32768) * hs
        best = min(abs(ht - th) for ht in heights)
        diffs.append(best)
        if best > 256:
            far += 1
    diffs.sort()
    rep = {"tile": tile, "median_diff": diffs[len(diffs) // 2],
           "p95_diff": diffs[int(len(diffs) * 0.95)],
           "far_cells_pct": far * 100.0 / samples,
           "multilayer_cells": stats["multilayerCells"], "max_layers": ml,
           "bytes": len(blob)}
    print("%s: OK blocks f/c/m=%d/%d/%d mlCells=%d maxL=%d bin=%.1fMB | "
          "geo-vs-terrain median=%d p95=%d far(>256)=%.1f%%"
          % (tile, stats["flat"], stats["complex"], stats["multilayer"],
             stats["multilayerCells"], ml, len(blob) / 1e6, rep["median_diff"],
             rep["p95_diff"], rep["far_cells_pct"]))
    return rep


# ---------------------------------------------------------------------------

def converted_tiles():
    return sorted(t for t in os.listdir(OUT_ROOT)
                  if t[0].isdigit()
                  and os.path.exists(os.path.join(OUT_ROOT, t, "scene.json")))


def main(argv):
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--check":
        tiles = args[1:] or converted_tiles()
        reports = [check_tile_geodata(t) for t in tiles]
        wins = sorted((r for r in reports if r["far_cells_pct"] > 5),
                      key=lambda r: -r["far_cells_pct"])
        if wins:
            print("\ntiles where geodata contradicts the heightmap >5% of "
                  "samples (multi-level wins):")
            for r in wins:
                print("  %s: %.1f%% far samples, %d multilayer cells"
                      % (r["tile"], r["far_cells_pct"],
                         r["multilayer_cells"]))
        return 0
    tiles = converted_tiles() if args[0] == "--all" else args
    n_ok = n_skip = 0
    total_bytes = 0
    for tile in tiles:
        out_dir = os.path.join(OUT_ROOT, tile)
        if not os.path.exists(os.path.join(out_dir, "scene.json")):
            print("%s: no converted scene, skipped" % tile)
            n_skip += 1
            continue
        desc = write_tile_geodata(tile, out_dir)
        if desc is None:
            print("%s: NO geodata region (heightmap fallback)" % tile)
            n_skip += 1
            continue
        patch_scene_pointer(tile, out_dir)
        n_ok += 1
        total_bytes += desc["layers"][0]["bytes"]
        print("%s: geodata.bin %.2f MB (f/c/m=%d/%d/%d, maxLayers=%d)"
              % (tile, desc["layers"][0]["bytes"] / 1e6,
                 desc["stats"]["flat"], desc["stats"]["complex"],
                 desc["stats"]["multilayer"], desc["maxLayers"]))
    print("done: %d tiles with geodata, %d skipped, %.1f MB total"
          % (n_ok, n_skip, total_bytes / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
