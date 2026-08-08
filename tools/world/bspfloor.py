#!/usr/bin/env python3
"""bspfloor.py - assets/world/<tile>/bsp.gltf -> bspfloor.bin, the BSP FLOOR
RASTER: where the decoded level BSP puts a walkable-facing surface over each
terrain grid point, and at what height.

WHY IT EXISTS

The terrain mesh and the level BSP describe two different things at the same
(x, y): the .unr heightmap is the NATURAL GROUND, and a town's plaza is a
stone slab BUILT ON TOP of it (measured at the Giran square, tile 22_22,
L2 82000/148000 -- heightmap -3600.8, Giran_floor03/04 top -3496.0, geodata
-3464). The client's stale-rectangle correction
(editor/world/js/terrain.js, correctHeightsWithGeodata) knew nothing about
the slab -- it saw the heightmap disagree with geodata by a metre, believed
the heightmap was stale, and lifted the DIRT terrain to -3464, i.e. 32 units
OVER the pavement, hiding it. The correction needs to know which grid points
the BSP already floors. That is this file.

It rasterises the SHIPPED bsp.gltf (not the .unr): the glTF carries raw L2
world units, Z-up, node transforms are identity ("bsp.gltf carries raw L2
world units ... NOTHING is translated", tools/world/README.md), so a
triangle's positions are already world positions and no placement can be got
wrong here. Re-running bsp.py and re-running this are independent.

WHAT COUNTS AS A FLOOR

A triangle whose geometric normal points up by at least FLOOR_NZ. That is a
surface a player stands on or looks down at -- the thing that must not be
buried by terrain. Walls (nz ~ 0) and ceilings/undersides (nz < 0) are
excluded: a wall crossing a grid point floors nothing. FLOOR_NZ = 0.5 (60
degrees from horizontal) is the retail stair slope band: the measured
Giran_stair treads at the square carry nz 0.58, the risers 0.0..0.02.

OUTPUT (sibling file; scene.json is a frozen contract and is not touched,
and, like bsp.gltf, a tile without one simply has no BSP floors)

    assets/world/<tile>/bspfloor.bin

    u32  magic 'BSPF' (0x46505342 little-endian)
    u16  gridSize          (= scene.json gridSize, 256)
    u16  maxLayers         (per-cell layer cap actually used)
    i32  originX, originY  (= scene.json origin[:2])
    i32  spacing           (= scene.json spacing, 128)
    then gridSize*gridSize records, row-major with gx FASTEST (index
    gy*gridSize + gx -- the heightmap.u16 order):
        u8   count         (0 = no BSP floor over this grid point)
        count x i16        floor heights, L2 world Z, ASCENDING

Heights are rounded to whole L2 units (geodata itself is quantised to 2) and
deduplicated within DEDUP_L2 so one slab does not ship as three coincident
coplanar surfaces.

Usage:
    python3 tools/world/bspfloor.py 22_22 [17_25 ...]
    python3 tools/world/bspfloor.py --all
    python3 tools/world/bspfloor.py --check [tiles]   # exit 1 on failure
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_ROOT = os.path.join(ROOT, "assets", "world")

MAGIC = 0x46505342          # 'BSPF' little-endian
FLOOR_NZ = 0.5              # see module docstring
DEDUP_L2 = 8                # geodata CELL_HEIGHT: below it, one surface
MAX_LAYERS = 15             # per grid point (u8 count; 15 keeps records small)
# Sub-samples per grid cell edge: triangles are sampled on a
# spacing/SUBDIV = 32 L2 unit lattice and each sample is credited to the
# grid point whose +-spacing/2 box it falls in (see raster()).
# MEASURED, at 16-unit triangle resolution, counting sample points where the
# corrected mesh covers an upward BSP face the raw heightmap left visible
# (22_22 / 24_18 / 25_18 / 20_22):
#     SUBDIV 1 -> 10 / 2405 / 646 / 812      file 84,362 B on 24_18
#     SUBDIV 2 -> 10 / 2077 / 554 / 804           87,112 B
#     SUBDIV 4 ->  0 / 2109 / 553 / 804           88,494 B
#     SUBDIV 8 ->  0 / 2107 / 510 / 804           89,332 B
# 4 is where Giran reaches exactly zero; past it nothing moves, because what
# is left is not a sampling limit but the 128-unit mesh itself -- between two
# capped vertices the interpolated surface can still cross a slab edge by a
# few units (22_22 before this: median 2.9, max 24 L2u).
SUBDIV = 4

# glTF component types used by bsp.py
CT_FLOAT = 5126
CT_UINT32 = 5125
CT_UINT16 = 5123
CT_SIZE = {CT_FLOAT: 4, CT_UINT32: 4, CT_UINT16: 2}
CT_FMT = {CT_FLOAT: "f", CT_UINT32: "I", CT_UINT16: "H"}
TYPE_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


# ---------------------------------------------------------------------------
# glTF reading (bsp.gltf only: external .bin, no sparse, no node transforms)
# ---------------------------------------------------------------------------

def read_accessor(gltf, buf, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    n = TYPE_N[acc["type"]]
    ct = acc["componentType"]
    off = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    count = acc["count"] * n
    vals = struct.unpack_from("<%d%s" % (count, CT_FMT[ct]), buf, off)
    if n == 1:
        return list(vals)
    return [vals[i * n:(i + 1) * n] for i in range(acc["count"])]


def bsp_triangles(tile_dir):
    """-> list of (p0, p1, p2) in raw L2 world units, or None when the tile
    ships no BSP."""
    path = os.path.join(tile_dir, "bsp.gltf")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        gltf = json.load(f)
    buffers = gltf.get("buffers") or []
    if not buffers or not gltf.get("meshes"):
        return []
    with open(os.path.join(tile_dir, buffers[0]["uri"]), "rb") as f:
        buf = f.read()
    for node in gltf.get("nodes", []):
        for key in ("matrix", "translation", "rotation", "scale"):
            if key in node:
                raise SystemExit(
                    "%s: node %r carries a %s transform; bspfloor.py assumes "
                    "the documented identity-node bsp.gltf contract"
                    % (path, node.get("name"), key))
    tris = []
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            if prim.get("mode", 4) != 4:
                continue
            pos = read_accessor(gltf, buf, prim["attributes"]["POSITION"])
            idx = read_accessor(gltf, buf, prim["indices"])
            for i in range(0, len(idx) - 2, 3):
                tris.append((pos[idx[i]], pos[idx[i + 1]], pos[idx[i + 2]]))
    return tris


# ---------------------------------------------------------------------------
# rasterisation
# ---------------------------------------------------------------------------

def raster(tris, origin, grid, spacing):
    """-> list of gridSize*gridSize sorted height lists (L2 world Z)."""
    cells = [None] * (grid * grid)
    ox, oy = origin[0], origin[1]
    for a, b, c in tris:
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        ln = (nx * nx + ny * ny + nz * nz) ** 0.5
        if ln == 0.0 or nz / ln < FLOOR_NZ:
            continue                       # wall, underside, or degenerate
        # SUB-CELL sampling. A terrain VERTEX is not a point in the render:
        # the four triangles around it span the +-spacing/2 box, so a BSP
        # floor anywhere in that box is drawn over by that vertex if the
        # vertex is lifted. Sampling only the grid points themselves missed
        # every floor narrower than 128 units and every one that happened to
        # fall between them -- measured at triangle resolution on 24_18,
        # grid-point sampling left 43,711 sample points of Aden_V_lawn and
        # friends still under the mesh where sub-cell sampling leaves ~0.
        # So the lattice is SUBDIV per cell and each sample is credited to
        # the NEAREST grid point, i.e. to the box it is drawn in.
        step = spacing / float(SUBDIV)
        sx0 = min(a[0], b[0], c[0]); sx1 = max(a[0], b[0], c[0])
        sy0 = min(a[1], b[1], c[1]); sy1 = max(a[1], b[1], c[1])
        i0 = int(math.floor((sx0 - ox) / step))
        i1 = int(math.ceil((sx1 - ox) / step))
        j0 = int(math.floor((sy0 - oy) / step))
        j1 = int(math.ceil((sy1 - oy) / step))
        i0 = max(i0, 0); j0 = max(j0, 0)
        i1 = min(i1, (grid - 1) * SUBDIV); j1 = min(j1, (grid - 1) * SUBDIV)
        if i1 < i0 or j1 < j0:
            continue
        # barycentric setup in XY (nz != 0 here, so the projection is
        # non-degenerate and the plane is a function of x, y)
        det = ux * vy - uy * vx
        if det == 0.0:
            continue
        for j in range(j0, j1 + 1):
            py = oy + j * step - a[1]
            gy = (j + SUBDIV // 2) // SUBDIV
            base = gy * grid
            for i in range(i0, i1 + 1):
                px = ox + i * step - a[0]
                s = (px * vy - py * vx) / det
                t = (py * ux - px * uy) / det
                if s < 0.0 or t < 0.0 or s + t > 1.0:
                    continue
                z = a[2] + s * uz + t * vz
                k = base + (i + SUBDIV // 2) // SUBDIV
                if cells[k] is None:
                    cells[k] = [z]
                else:
                    cells[k].append(z)
    out = []
    for lst in cells:
        if not lst:
            out.append([])
            continue
        lst.sort()
        keep = []
        for z in lst:
            zi = int(round(z))
            if keep and zi - keep[-1] < DEDUP_L2:
                continue
            keep.append(zi)
        if len(keep) > MAX_LAYERS:
            # keep the extremes and thin the middle: a >15-storey stack is
            # scaffolding geometry, and the ground floor + roof are what the
            # consumers ask about
            step = (len(keep) - 1) / float(MAX_LAYERS - 1)
            keep = [keep[int(round(i * step))] for i in range(MAX_LAYERS)]
        out.append(keep)
    return out


def encode(cells, grid, origin, spacing):
    head = struct.pack("<IHHiii", MAGIC, grid, MAX_LAYERS,
                       int(round(origin[0])), int(round(origin[1])),
                       int(round(spacing)))
    body = bytearray()
    for lst in cells:
        body.append(len(lst))
        for z in lst:
            body += struct.pack("<h", max(-32768, min(32767, z)))
    return head + bytes(body)


# ---------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------

def convert_tile(tile, verbose=True):
    tile_dir = os.path.join(OUT_ROOT, tile)
    scene_path = os.path.join(tile_dir, "scene.json")
    if not os.path.exists(scene_path):
        raise SystemExit("%s: no scene.json" % tile)
    with open(scene_path) as f:
        scene = json.load(f)
    grid = scene.get("gridSize", 256)
    spacing = scene.get("spacing", 128)
    origin = scene["origin"]
    tris = bsp_triangles(tile_dir)
    out_path = os.path.join(tile_dir, "bspfloor.bin")
    if tris is None:
        if os.path.exists(out_path):
            os.remove(out_path)
        if verbose:
            print("%s: no bsp.gltf, skipped" % tile)
        return None
    cells = raster(tris, origin, grid, spacing)
    covered = sum(1 for c in cells if c)
    # An all-empty raster is still WRITTEN. Letting the client's probe 404
    # instead costs a console error per tile in every headless suite, and a
    # 404 whose body the client does not drain never lets a page reach
    # networkidle0 (see editor/world/js/bspfloor.js). 65 KB of zero counts is
    # the cheaper answer.
    data = encode(cells, grid, origin, spacing)
    with open(out_path, "wb") as f:
        f.write(data)
    if verbose:
        print("%s: %d triangles, %d/%d grid points floored (%.1f%%), %d bytes"
              % (tile, len(tris), covered, grid * grid,
                 100.0 * covered / (grid * grid), len(data)))
    return {"tile": tile, "triangles": len(tris), "covered": covered,
            "bytes": len(data)}


def check_tile(tile):
    """Re-derive the raster and compare it byte for byte with the shipped
    file -- a stale bspfloor.bin is exactly as dangerous as a wrong one."""
    tile_dir = os.path.join(OUT_ROOT, tile)
    out_path = os.path.join(tile_dir, "bspfloor.bin")
    tris = bsp_triangles(tile_dir)
    if tris is None:
        return (not os.path.exists(out_path), "no bsp.gltf")
    with open(os.path.join(tile_dir, "scene.json")) as f:
        scene = json.load(f)
    grid = scene.get("gridSize", 256)
    spacing = scene.get("spacing", 128)
    cells = raster(tris, scene["origin"], grid, spacing)
    if not os.path.exists(out_path):
        return (False, "missing bspfloor.bin")
    want = encode(cells, grid, scene["origin"], spacing)
    with open(out_path, "rb") as f:
        got = f.read()
    if got != want:
        return (False, "stale (%d bytes on disk, %d re-derived)"
                % (len(got), len(want)))
    return (True, "%d bytes" % len(got))


def all_tiles():
    return sorted(t for t in os.listdir(OUT_ROOT)
                  if os.path.isdir(os.path.join(OUT_ROOT, t))
                  and os.path.exists(os.path.join(OUT_ROOT, t, "scene.json")))


def main(argv):
    args = list(argv)
    check = "--check" in args
    if check:
        args.remove("--check")
    if "--all" in args:
        args.remove("--all")
        args = all_tiles()
    if not args:
        args = all_tiles() if check else None
    if not args:
        print(__doc__)
        return 2
    if check:
        bad = 0
        for tile in args:
            ok, msg = check_tile(tile)
            if not ok:
                bad += 1
                print("FAIL %s: %s" % (tile, msg))
        print("bspfloor --check: %d tiles, %d failures" % (len(args), bad))
        return 1 if bad else 0
    for tile in args:
        convert_tile(tile)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
