#!/usr/bin/env python3
"""lightmap.py - decode the level UModel's undecoded tail.

WHY THIS EXISTS, AND WHAT IT OVERTURNS

`tools/world/bsp.py` and `l2lib/ue2package.py` both stated, as fact, that the
bytes after `RootOutside`/`Linked` in the LEVEL UModel are

    "the lightmap tail (an FLightMapIndex array plus the raw LightBits blob)"

and skipped them. That is FALSE for the first ~25% of the tail and unproven
for the rest. What the first region actually is has been decoded here and is
verified by exact byte consumption plus an independent invariant.

WHAT DECODES, EXACTLY (region A - the RENDER SECTION TABLE)

The tail opens with the retail engine's pre-built render list:

    cidx NumSections
    NumSections x:
        cidx  NumVertices
        NumVertices x 40-byte render vertex   (layout below)
        i32   CountA            see below -- NOT the same field as NumPolys
        cidx  Material          -> the same Texture/Shader an FBspSurf names
        i32   NumPolys
        u32   PolyFlags         EPolyFlags, same bit meanings as FBspSurf
        i32   Unknown           (-1, 0 or 3 on every section measured)

The identification does not rest on a header or on any outside document. Two
independent facts pin it:

  1. `sum(NumPolys)` over the sections equals `len(model.nodes)` EXACTLY on
     100 of the 100 converted tiles -- i.e. the table partitions the post-CSG
     BSP node set, one polygon per node. Nothing else in the file has that
     property, and it holds across tiles from 59 to 4,493 nodes.
  2. every section's `Material` resolves through the package import table to
     a real texture name, and those names are the same retail materials the
     FBspSurfs name (Giran_Village_T.Giran_floor03, interior_A_t.*,
     L2_Skies.HazeRing_Final ...). 0 unresolved across all 2,165 sections.

  CountA equals NumPolys on 2,160 of the 2,165 sections and is exactly one
  GREATER on the other five (20_16 sec 19: 21 vs 20; 23_25 sec 17: 51 vs 50;
  24_14 sec 4: 3 vs 2; 24_20 sec 4: 119 vs 118; 25_20 sec 7: 2 vs 1). It was
  first written up here as "NumPolys, repeated" -- a correct measurement on
  99.8% of the data with an inference welded to it that five sections then
  falsified. What CountA counts is NOT established; summing it misses the
  node count on 5 tiles, summing NumPolys never does, so NumPolys is the
  field this tool trusts and CountA is recorded verbatim.

The 40-byte render vertex. Bytes 0..11 are an FVector world position (it
lands inside the tile's scene.json origin box) and bytes 28..39 are a unit
vector (|n| == 1 to 2e-3 on every vertex the walk touches -- that is the
termination test the walk uses). Bytes 12..19 are two floats that routinely
exceed 1 and go negative, i.e. a tiling texture UV.

  *** Bytes 20..27 are NOT identified. *** They are two 4-byte slots. On
  22_22 they read as floats inside [0,1] for 98.6% of vertices, which is
  what a lightmap UV pair would look like -- but 44 of 26,056 are NaN and
  317 are outside [0,1], and on 17_25 6.5% are outside. On 17_25 many of
  them read as plausible u16 pairs instead. That is a correct measurement
  (most values lie in [0,1]) that does NOT license the inference (they are
  lightmap UVs), so this tool records the bytes and refuses to name them.

WHAT DOES NOT DECODE (region B - after the section table)

After the section table comes `cidx N`, then N variable-length records, then
`cidx N` again and N x i32 running 0..N-1 (an identity index). N is 595 on
22_22, 272 on 17_25, 1,888 on 20_21. Region B is 1.47 MB of 22_22's 2.07 MB
tail and 172.9 MB across the 100 tiles.

Region B is where the baked lighting lives, and it is NOT decoded. What is
established about it, by measurement:

  * a record begins `u16 A, u8 B, u16 C, u8 W, u8 H` then ~40 bytes of
    floats including an FVector in tile world space;
  * `C` is cumulative: C(next) == C(prev) + W(prev) on the records walked,
    i.e. W/H are the size of something packed side by side into a strip;
  * the bulk of a record is a run of sub-blocks, each
        7 x i32 (the 1st two are W,H; the 6th and 7th are W-1, H-1)
        u8 unknown
        u8 len
        len bytes
    where **len == ceil(W/8) * H on every sub-block walked** -- one BIT per
    texel, rows padded to whole bytes. That is a per-light visibility mask,
    which is how UE1-family engines store baked shadows.

  What is missing before any of it can be drawn: which surface each record
  belongs to, the atlas the masks composite into, and the light colour /
  attenuation each mask is multiplied by. None of that is decoded, so this
  tool emits none of it and the client draws none of it. Approximating it
  with an ambient-occlusion bake, a vertex-colour stand-in or a screen-space
  effect is explicitly out of bounds for this repository.

KNOWN GAPS
  * region B is not decoded (above).
  * bytes 20..27 of the render vertex are not identified (above).
  * CountA's meaning is not established (above); --check pins the exact set
    of sections where it differs from NumPolys, so the gap cannot grow
    quietly.

OUTPUT (a sibling file; scene.json and bsp.gltf are not touched)

    assets/world/<tile>/bsprender.json

Usage:
    python3 tools/world/lightmap.py <tile> [...]   # decode + write json
    python3 tools/world/lightmap.py --all
    python3 tools/world/lightmap.py --check [tile ...]   # exit 1 on drift
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from l2lib import L2Error, level_model, load_package       # noqa: E402
from l2lib.ue2package import Reader                        # noqa: E402

MAPS = os.path.join(ROOT, "assets", "interlude", "maps")
WORLD = os.path.join(ROOT, "assets", "world")

VERTEX_SIZE = 40          # measured: the walk's unit-normal test terminates
                          # each section exactly on its declared count

# The sections where CountA != NumPolys, as (tile, section, CountA,
# NumPolys). A MEASUREMENT of the current tree, not an explanation -- what
# CountA counts is unknown. --check fails if this set changes in either
# direction, so an undiagnosed gap can never quietly grow.
COUNTA_MISMATCH = [
    ("20_16", 19, 21, 20),
    ("23_25", 17, 51, 50),
    ("24_14", 4, 3, 2),
    ("24_20", 4, 119, 118),
    ("25_20", 7, 2, 1),
]


def unit_normal_at(data, pos):
    x, y, z = struct.unpack_from("<3f", data, pos)
    s = x * x + y * y + z * z
    return not math.isnan(s) and abs(s - 1.0) < 2e-3


def decode_tail(pkg, model):
    """-> dict describing region A exactly, and region B by size only.

    Raises L2Error if the section table does not walk cleanly, which is the
    whole point: a desync must never be mistaken for data.
    """
    export = model.export
    end = export.serial_offset + export.serial_size
    start = end - model.lightmap_tail
    data = pkg.data
    r = Reader(data, start, path=pkg.path)
    nsec = r.compact()
    if not 0 <= nsec < 100000:
        raise L2Error("implausible section count %d" % nsec)
    sections = []
    mismatches = []
    total_polys = 0
    total_verts = 0
    unnamed_slot_nan = 0
    unnamed_slot_outside01 = 0
    unnamed_slot_total = 0
    for s in range(nsec):
        nverts = r.compact()
        if not 0 <= nverts < 4000000:
            raise L2Error("section %d: implausible vertex count %d"
                          % (s, nverts))
        vp = r.pos
        if vp + VERTEX_SIZE * nverts > end:
            raise L2Error("section %d: vertex block runs past the export" % s)
        # Structural test, not decoration: bytes 28..39 of every render
        # vertex must be a unit vector. This is what proves the 40-byte
        # stride and the declared count agree with the bytes on disk.
        for k in range(nverts):
            if not unit_normal_at(data, vp + VERTEX_SIZE * k + 28):
                raise L2Error("section %d vertex %d: bytes 28..39 are not a "
                              "unit vector (stride/count desync)" % (s, k))
            for v in struct.unpack_from("<2f", data, vp + VERTEX_SIZE * k + 20):
                unnamed_slot_total += 1
                if math.isnan(v) or math.isinf(v):
                    unnamed_slot_nan += 1
                elif not -0.001 <= v <= 1.001:
                    unnamed_slot_outside01 += 1
        r.bytes(VERTEX_SIZE * nverts)
        count_a = r.i32()
        material = r.compact()
        npolys = r.i32()
        flags = r.u32()
        unknown = r.i32()
        if not 0 <= npolys <= len(model.nodes):
            raise L2Error("section %d: implausible NumPolys %d" % (s, npolys))
        ref = pkg.ref_name(material)
        if ref is None or not ref[1]:
            raise L2Error("section %d: material %d does not resolve"
                          % (s, material))
        if count_a != npolys:
            mismatches.append([s, count_a, npolys])
        sections.append({"verts": nverts, "polys": npolys, "countA": count_a,
                         "material": "%s.%s" % (ref[0], ref[1]),
                         "polyFlags": flags, "unknown": unknown})
        total_polys += npolys
        total_verts += nverts
    region_a = r.pos - start
    return {
        "tile": None,
        "tailBytes": model.lightmap_tail,
        "regionA": {
            "bytes": region_a,
            "sections": nsec,
            "vertices": total_verts,
            "polygons": total_polys,
            "bspNodes": len(model.nodes),
            "polygonsMinusNodes": total_polys - len(model.nodes),
            "vertexStride": VERTEX_SIZE,
            "countAMismatches": mismatches,
            "unnamedSlots": {
                "samples": unnamed_slot_total,
                "nanOrInf": unnamed_slot_nan,
                "outside01": unnamed_slot_outside01,
                "note": "bytes 20..27 of the render vertex are NOT identified",
            },
        },
        "regionB": {
            "bytes": model.lightmap_tail - region_a,
            "decoded": False,
            "note": "baked-lighting records; see the module docstring for "
                    "what is established and what is missing",
        },
        "materials": sorted(set(s["material"] for s in sections)),
        "sectionList": sections,
    }


def tile_model(tile):
    unr = os.path.join(MAPS, tile + ".unr")
    if not os.path.exists(unr):
        raise L2Error("no such map: %s" % unr)
    pkg, _proto = load_package(unr)
    model = level_model(pkg)
    if model is None:
        raise L2Error("%s: no level UModel" % tile)
    return pkg, model


def decode_tile(tile):
    pkg, model = tile_model(tile)
    info = decode_tail(pkg, model)
    info["tile"] = tile
    return info


def write_tile(tile):
    info = decode_tile(tile)
    out_dir = os.path.join(WORLD, tile)
    if not os.path.isdir(out_dir):
        raise L2Error("%s: run convert.py first (no %s)" % (tile, out_dir))
    with open(os.path.join(out_dir, "bsprender.json"), "w") as f:
        json.dump(info, f, separators=(",", ":"))
    return info


def converted_tiles():
    return sorted(d for d in os.listdir(WORLD)
                  if os.path.isdir(os.path.join(WORLD, d))
                  and os.path.exists(os.path.join(WORLD, d, "scene.json"))
                  and os.path.exists(os.path.join(MAPS, d + ".unr")))


def check(tiles):
    """Re-derive from the .unr and assert every invariant. -> problem list."""
    problems = []
    seen_mismatch = []
    for tile in tiles:
        try:
            info = decode_tile(tile)
        except L2Error as exc:
            problems.append("%s: tail did not decode: %s" % (tile, exc))
            continue
        a = info["regionA"]
        if a["polygonsMinusNodes"] != 0:
            problems.append(
                "%s: the section table's NumPolys sum to %d, the BSP has %d "
                "nodes -- they must be equal (the table partitions the nodes)"
                % (tile, a["polygons"], a["bspNodes"]))
        for sec, ca, np_ in a["countAMismatches"]:
            seen_mismatch.append((tile, sec, ca, np_))
        if a["sections"] <= 0:
            problems.append("%s: no render sections" % tile)
        if a["bytes"] >= info["tailBytes"]:
            problems.append("%s: region A consumed the whole tail" % tile)
        # the shipped sibling file must match what the .unr decodes to now
        path = os.path.join(WORLD, tile, "bsprender.json")
        if os.path.exists(path):
            with open(path) as f:
                shipped = json.load(f)
            for key in ("sections", "vertices", "polygons", "bytes"):
                if shipped.get("regionA", {}).get(key) != a[key]:
                    problems.append(
                        "%s: bsprender.json regionA.%s is %r, the .unr "
                        "decodes to %r (stale)"
                        % (tile, key, shipped.get("regionA", {}).get(key),
                           a[key]))
    if len(tiles) > 10:          # only meaningful over the whole set
        expected = sorted(tuple(m) for m in COUNTA_MISMATCH
                          if m[0] in set(tiles))
        got = sorted(seen_mismatch)
        if got != expected:
            problems.append(
                "the CountA != NumPolys section set changed: expected %s, "
                "got %s" % (expected, got))
    return problems


def main(argv):
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--check":
        tiles = args[1:] or converted_tiles()
        problems = check(tiles)
        for p in problems:
            print("FAIL " + p)
        print("--check: %d tiles, %d problems" % (len(tiles), len(problems)))
        return 1 if problems else 0
    tiles = converted_tiles() if args[0] == "--all" else args
    failures = 0
    for tile in tiles:
        try:
            info = write_tile(tile)
        except L2Error as exc:
            print("%-8s FAILED: %s" % (tile, exc))
            failures += 1
            continue
        a = info["regionA"]
        print("%-8s %3d sections %7d verts %6d polys (nodes %6d, %+d)  "
              "regionA %8d B  regionB %9d B undecoded"
              % (tile, a["sections"], a["vertices"], a["polygons"],
                 a["bspNodes"], a["polygonsMinusNodes"], a["bytes"],
                 info["regionB"]["bytes"]))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
