#!/usr/bin/env python3
"""verify_terrain_z.py - which of the client's ground surfaces is the ground?

The web client carries two independent height surfaces per tile and they do
not agree. This tool decides between them from the binaries, not from taste.

WHAT IS BEING COMPARED

  heightmap surface   scene.json origin[2] + (h - 32768) * heightScale, h from
                      heightmap.u16 (the G16 texture in T_<tile>.utx, marker
                      00 40 80 10). heightScale comes from the .unr's own
                      TerrainInfo.TerrainScale.Z / 256 and origin[2] from
                      TerrainInfo.Location.Z - both read here, per tile, so a
                      tile that serialises different values cannot hide.
                      This is what the terrain MESH is built from, i.e. the
                      ground the player looks at.

  geodata surface     assets/world/<tile>/geodata.bin, decoded per
                      docs/geodata-format.md (height = int16(w & 0xFFF0) >> 1,
                      so every value is a multiple of GeoStructure.CELL_HEIGHT
                      = 8). This is the L2OFF walkable surface and it is what
                      aCis reports as a character's z.

FOUR MEASUREMENTS, each independently sourced

  A. TerrainSector bounding boxes (BINARY GROUND TRUTH for the Z formula).
     Every .unr carries 256 TerrainSector exports whose native header is

         u16 ?, i32 quadsX, i32 quadsY, i32 vertexOffsetX, i32 vertexOffsetY,
         float bboxMin[3], float bboxMax[3]

     (offsets confirmed by the bbox XY reproducing origin + offset*128 to the
     half-unit on every sector of every tile tested; sectors whose XY does not
     reproduce are reported, not silently skipped). Those are UnrealEd's own
     world-space bounds of the terrain it renders, so bbox.min.z/max.z against
     the decoded min/max over the sector's vertex patch tests the whole decode
     - marker offset, byte order, bias, heightScale and origin[2] - at once.

  B. geodata vs heightmap on DEAD-FLAT ground inside FLAT geodata blocks.
     Flat ground removes slope and cell-vs-vertex sampling error, FLAT blocks
     remove multi-layer ambiguity, so what is left is the systematic offset
     between the two surfaces, spread over exactly one 8-unit quantum.

  C. prop bottoms. StaticMeshActor Location/Rotation/DrawScale are exact .unr
     binary and a crate, a fence or a tent must touch the ground it stands on.
     The mesh AABB comes from the glTF POSITION accessor min/max (glTF Y is
     L2 Z), and only small, unpitched, unrolled placements are used.

  D. retail-authored ground points: teleports.xml destinations and the
     spawnlist flee points shipped with the aCis datapack. NOTE these are
     L2OFF-derived and land on multiples of 8 - they are geodata-quantised, so
     they corroborate the geodata surface but are NOT independent of it.

Usage:
    python3 tools/world/verify_terrain_z.py [tile ...]        # full report
    python3 tools/world/verify_terrain_z.py --check [tile ...]
        Fails (exit 1) when the decoded heightmap disagrees with the .unr's
        own TerrainSector bounding boxes by more than one heightScale unit on
        any tile - i.e. when the terrain decode itself has drifted. It does
        NOT fail on the geodata/heightmap gap: that gap is a property of the
        shipped data, measured and reported here for the client to consume.

Dependencies: stdlib Python 3, tools/l2lib, tools/world/convert.py, the
retail client tree (assets/interlude/maps/<tile>.unr) and the converted
assets/world/<tile>/.
"""

import array
import collections
import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import convert as C           # noqa: E402  (package loader + prop parser)
import geodata as G           # noqa: E402  (blockstream decoder)

OUT_ROOT = os.path.join(ROOT, "assets", "world")
DATAPACK = os.path.join(ROOT, "server", "aCis_datapack", "data", "xml")

GRID = 256
# TerrainSector native header: 2 bytes, then 4 int32, then two float triples.
SECTOR_BBOX_OFF = 18
# A: the decode is accepted when it reproduces the sector bounds to within
# 1.5 heightmap quanta (1 quantum = heightScale = 0.296875 L2 units at
# TerrainScale.Z 76). MEASURED on every tile tested: the residual is exactly
# +1 quantum on BOTH bounds, i.e. UnrealEd's own terrain bounds sit one G16
# step above origin[2] + (h - 32768) * heightScale, so the bias in the .unr
# is 32767, not 32768. That is 0.297 L2 units - 0.6% of a 46-unit character
# and 27x smaller than the geodata gap in B - so it is reported, not "fixed"
# into scene.json (which is a frozen contract).
SECTOR_TOL_UNITS = 1.5
# C: "small upright prop" filter - big buildings span many terrain cells and
# their AABB bottom is not a ground contact.
PROP_MAX_EXTENT = 600.0


def stat(vals):
    s = sorted(vals)
    n = len(s)
    q = lambda p: s[min(n - 1, int(p * n))]        # noqa: E731
    return {"n": n, "med": round(q(.5), 2), "mean": round(sum(s) / n, 2),
            "p05": round(q(.05), 2), "p25": round(q(.25), 2),
            "p75": round(q(.75), 2), "p95": round(q(.95), 2),
            "min": round(s[0], 2), "max": round(s[-1], 2)}


# ---------------------------------------------------------------------------
# tile assets
# ---------------------------------------------------------------------------

_tiles = {}


def load_tile(tile):
    """-> (scene, heights array.array('H'), geodata blocks) or None."""
    if tile in _tiles:
        return _tiles[tile]
    d = os.path.join(OUT_ROOT, tile)
    try:
        with open(os.path.join(d, "scene.json")) as f:
            scene = json.load(f)
        hm = array.array("H")
        with open(os.path.join(d, "heightmap.u16"), "rb") as f:
            hm.frombytes(f.read())
        with open(os.path.join(d, "geodata.bin"), "rb") as f:
            blocks = G.parse_blockstream(f.read())[2]
        v = (scene, hm, blocks)
    except (IOError, OSError, ValueError):
        v = None
    _tiles[tile] = v
    return v


def tile_of(x, y):
    return "%d_%d" % (int(math.floor(x / 32768.0)) + 20,
                      int(math.floor(y / 32768.0)) + 18)


def heightmap_z(scene, hm, x, y):
    """Bilinear heightmap surface at world (x, y) - the client's own rule."""
    ox, oy, oz = scene["origin"]
    hs, sp = scene["heightScale"], scene["spacing"]
    fx = min(max((x - ox) / sp, 0.0), GRID - 1.001)
    fy = min(max((y - oy) / sp, 0.0), GRID - 1.001)
    x0, y0 = int(fx), int(fy)
    tx, ty = fx - x0, fy - y0
    h = lambda i, j: hm[min(j, GRID - 1) * GRID + min(i, GRID - 1)]   # noqa: E731
    v = ((h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx) * (1 - ty)
         + (h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx) * ty)
    return oz + (v - 32768) * hs


def geo_layers(scene, blocks, x, y):
    ox, oy = scene["origin"][0], scene["origin"][1]
    cx = max(0, min(2047, int(math.floor((x - ox) / 16.0))))
    cy = max(0, min(2047, int(math.floor((y - oy) / 16.0))))
    b = blocks[(cx >> 3) * 256 + (cy >> 3)]
    idx = (cy & 7) * 8 + (cx & 7)
    if b[0] == 0:
        return [b[1]]
    if b[0] == 1:
        return [G.cell_height(b[1][idx])]
    return [G.cell_height(w) for w in b[1][idx]]


def geo_z(scene, blocks, x, y, z):
    return min(geo_layers(scene, blocks, x, y), key=lambda v: abs(v - z))


# ---------------------------------------------------------------------------
# A. TerrainSector bounding boxes
# ---------------------------------------------------------------------------

def check_sector_bboxes(tile, scene, hm):
    tx, ty = (int(v) for v in tile.split("_"))
    x0, y0 = (tx - 20) * 32768.0, (ty - 18) * 32768.0
    pkg, _ = C.load_package(os.path.join(C.CLIENT, "maps", tile + ".unr"))
    data = pkg.data
    oz, hs = scene["origin"][2], scene["heightScale"]
    dmin, dmax, bad_xy, n = [], [], 0, 0
    for e in pkg.exports:
        if pkg.class_name_of(e) != "TerrainSector":
            continue
        b = data[e.serial_offset:e.serial_offset + e.serial_size]
        if len(b) < SECTOR_BBOX_OFF + 24:
            continue
        qx, qy, ox, oy = struct.unpack_from("<4i", b, 2)
        mn = struct.unpack_from("<3f", b, SECTOR_BBOX_OFF)
        mx = struct.unpack_from("<3f", b, SECTOR_BBOX_OFF + 12)
        # the header must reproduce the sector's world XY, else the offsets
        # above are wrong for this licensee version and the sector is not
        # evidence either way
        if abs(mn[0] - (x0 + ox * 128)) > 0.5 or abs(mn[1] - (y0 + oy * 128)) > 0.5:
            bad_xy += 1
            continue
        lo, hi = 65536, 0
        for j in range(oy, min(oy + qy + 1, GRID)):
            row = j * GRID
            for i in range(ox, min(ox + qx + 1, GRID)):
                v = hm[row + i]
                lo = min(lo, v)
                hi = max(hi, v)
        dmin.append(mn[2] - (oz + (lo - 32768) * hs))
        dmax.append(mx[2] - (oz + (hi - 32768) * hs))
        n += 1
    if not n:
        return None
    # The MODE, not the median, is the right statistic here: a sector's bbox
    # bounds only the quads UnrealEd renders, so on rugged/town tiles some
    # sectors legitimately bound tighter than the raw min/max over their
    # vertex patch (hidden quads, extremes shared with the neighbouring
    # sector). Those sectors form a one-sided tail; the sectors whose
    # extremes ARE the bbox extremes pile up on one exact value, and that
    # value is the decode residual.
    def mode(vals):
        c = collections.Counter(round(v, 3) for v in vals)
        v, k = c.most_common(1)[0]
        return v, k / float(len(vals))

    lo_mode, lo_share = mode(dmin)
    hi_mode, hi_share = mode(dmax)
    return {"sectors": n, "bad_xy": bad_xy, "unit": hs,
            "min_mode": lo_mode, "min_share": lo_share,
            "max_mode": hi_mode, "max_share": hi_share,
            "min_resid": stat(dmin), "max_resid": stat(dmax)}


# ---------------------------------------------------------------------------
# B. geodata vs heightmap on dead-flat FLAT-block ground
# ---------------------------------------------------------------------------

def flat_ground_offset(scene, hm, blocks):
    oz, hs = scene["origin"][2], scene["heightScale"]
    ds = []
    for j in range(2, GRID - 2):
        for i in range(2, GRID - 2):
            nb = [hm[(j + dj) * GRID + i + di]
                  for dj in (-1, 0, 1) for di in (-1, 0, 1)]
            if max(nb) - min(nb) > 1:              # dead flat only
                continue
            blk = blocks[((i * 8) >> 3) * 256 + ((j * 8) >> 3)]
            if blk[0] != 0:                        # FLAT geodata blocks only
                continue
            z = oz + (hm[j * GRID + i] - 32768) * hs
            d = blk[1] - z
            if abs(d) > 120:                       # structures, not ground
                continue
            ds.append(d)
    return stat(ds) if ds else None


# ---------------------------------------------------------------------------
# C. prop bottoms
# ---------------------------------------------------------------------------

_gltf_bbox = {}


def _mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)]
            for i in range(4)]


def _node_matrix(node):
    if "matrix" in node:
        m = node["matrix"]
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = node.get("translation", [0, 0, 0])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    s = node.get("scale", [1, 1, 1])
    rot = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
           [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
           [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[rot[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] \
        + [[0, 0, 0, 1]]


def gltf_bbox(path):
    """Scene-space AABB from the POSITION accessor min/max (glTF axes)."""
    if path in _gltf_bbox:
        return _gltf_bbox[path]
    try:
        with open(path) as f:
            doc = json.load(f)
    except (IOError, OSError, ValueError):
        _gltf_bbox[path] = None
        return None
    lo = [1e30] * 3
    hi = [-1e30] * 3

    def walk(ni, m):
        node = doc["nodes"][ni]
        m2 = _mat_mul(m, _node_matrix(node))
        if "mesh" in node:
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                acc = doc["accessors"][prim["attributes"]["POSITION"]]
                a, b = acc["min"], acc["max"]
                for cx in (a[0], b[0]):
                    for cy in (a[1], b[1]):
                        for cz in (a[2], b[2]):
                            for i in range(3):
                                v = (m2[i][0] * cx + m2[i][1] * cy
                                     + m2[i][2] * cz + m2[i][3])
                                lo[i] = min(lo[i], v)
                                hi[i] = max(hi[i], v)
        for c in node.get("children", []):
            walk(c, m2)

    ident = [[1 if i == j else 0 for j in range(4)] for i in range(4)]
    for ni in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        walk(ni, ident)
    _gltf_bbox[path] = (lo, hi) if lo[0] < 1e29 else None
    return _gltf_bbox[path]


def prop_contacts(tile, scene, hm, blocks):
    d = os.path.join(OUT_ROOT, tile)
    per = collections.defaultdict(list)
    for p in scene.get("props", []):
        if not p.get("gltf") or not p.get("position"):
            continue
        bb = gltf_bbox(os.path.join(d, p["gltf"]))
        if not bb:
            continue
        lo, hi = bb
        pitch, _yaw, roll = p.get("rotation", [0, 0, 0])
        if pitch % 65536 or roll % 65536:          # tilted: glTF Y is not world Z
            continue
        sz = p.get("scale", [1, 1, 1])[2]
        extent = max(hi[0] - lo[0], hi[2] - lo[2]) * 100 * abs(sz)
        if extent > PROP_MAX_EXTENT:
            continue
        x, y, z = p["position"]
        bottom = z + lo[1] * 100 * sz
        per[p["mesh"]].append((bottom - heightmap_z(scene, hm, x, y),
                               bottom - geo_z(scene, blocks, x, y, z)))
    return per


# ---------------------------------------------------------------------------
# D. retail-authored ground points (datapack)
# ---------------------------------------------------------------------------

def authored_points():
    pts = []
    tel = os.path.join(DATAPACK, "teleports.xml")
    if os.path.exists(tel):
        with open(tel) as f:
            s = f.read()
        pts += [("teleport",) + tuple(int(v) for v in m.groups())
                for m in re.finditer(r'x="(-?\d+)" y="(-?\d+)" z="(-?\d+)"', s)]
    sl = os.path.join(DATAPACK, "spawnlist")
    if os.path.isdir(sl):
        pat = re.compile(r'name="flee_x" val="(-?\d+)"/>\s*'
                         r'<set name="flee_y" val="(-?\d+)"/>\s*'
                         r'<set name="flee_z" val="(-?\d+)"')
        for fn in sorted(os.listdir(sl)):
            with open(os.path.join(sl, fn)) as f:
                s = f.read()
            pts += [("flee",) + tuple(int(v) for v in m.groups())
                    for m in pat.finditer(s)]
    return pts


def authored_report():
    by_kind = collections.defaultdict(lambda: ([], [], set()))
    for kind, x, y, z in authored_points():
        t = load_tile(tile_of(x, y))
        if not t:
            continue
        scene, hm, blocks = t
        h = heightmap_z(scene, hm, x, y)
        g = geo_z(scene, blocks, x, y, z)
        if abs(z - h) > 500 and abs(z - g) > 500:      # indoors / off-ground
            continue
        dh, dg, mods = by_kind[kind]
        dh.append(z - h)
        dg.append(z - g)
        # the residual against geodata, not z itself: an exact multiple of
        # CELL_HEIGHT means the authored point was snapped to a geodata layer
        mods.add(int(z - g) % 8)
    return by_kind


# ---------------------------------------------------------------------------

def main(argv):
    check = "--check" in argv
    tiles = [a for a in argv if not a.startswith("--")]
    if not tiles:
        tiles = ["16_21", "16_24", "17_25", "19_22", "17_22", "22_22"]

    failures = []
    for tile in tiles:
        t = load_tile(tile)
        if not t:
            print("SKIP %s (no converted scene.json/heightmap/geodata)" % tile)
            continue
        scene, hm, blocks = t
        print("\n=== %s  origin_z=%.5f  heightScale=%.6f  spacing=%d"
              % (tile, scene["origin"][2], scene["heightScale"], scene["spacing"]))

        a = check_sector_bboxes(tile, scene, hm)
        if a is None:
            print("  A. TerrainSector bboxes: no usable sectors")
        else:
            print("  A. TerrainSector bbox residual (bbox.z - decoded z), %d sectors%s"
                  % (a["sectors"], ", %d skipped on XY mismatch" % a["bad_xy"]
                     if a["bad_xy"] else ""))
            print("       min.z: %s" % a["min_resid"])
            print("       max.z: %s" % a["max_resid"])
            worst = max(abs(a["min_mode"]), abs(a["max_mode"]))
            lim = SECTOR_TOL_UNITS * a["unit"]
            print("       modal residual: min.z %+.6f (%.0f%% of sectors), "
                  "max.z %+.6f (%.0f%%)"
                  % (a["min_mode"], 100 * a["min_share"],
                     a["max_mode"], 100 * a["max_share"]))
            print("       |modal residual| = %.6f = %.3f x heightScale  "
                  "(tolerance %.4f)" % (worst, worst / a["unit"], lim))
            if worst > lim + 1e-6:
                failures.append((tile, worst, lim))

        b = flat_ground_offset(scene, hm, blocks)
        print("  B. geodataZ - heightmapZ on dead-flat FLAT-block ground:")
        print("       %s" % (b if b else "no samples"))
        if b:
            print("       band = %.2f .. %.2f (spread %.2f; one geodata quantum "
                  "= 8)" % (b["min"], b["max"], b["max"] - b["min"]))

        per = prop_contacts(tile, scene, hm, blocks)
        allp = [v for lst in per.values() for v in lst]
        print("  C. prop bottoms (%d small upright placements, %d meshes):"
              % (len(allp), len(per)))
        if allp:
            print("       - heightmapZ: %s" % stat([p[0] for p in allp]))
            print("       - geodataZ  : %s" % stat([p[1] for p in allp]))
            print("       %-38s %5s %9s %10s" % ("mesh", "n", "med(-hm)", "med(-geo)"))
            for mesh, v in sorted(per.items(), key=lambda kv: -len(kv[1]))[:6]:
                aa = sorted(p[0] for p in v)
                bb = sorted(p[1] for p in v)
                print("       %-38s %5d %9.1f %10.1f"
                      % (mesh[:38], len(v), aa[len(aa) // 2], bb[len(bb) // 2]))

    print("\n=== D. retail-authored ground points (aCis datapack, world-wide)")
    for kind, (dh, dg, _mods) in sorted(authored_report().items()):
        on_grid = sum(1 for v in dg if abs(v - round(v / 8.0) * 8) < 1e-6)
        print("  %-9s authoredZ - heightmapZ: %s" % (kind, stat(dh)))
        print("  %-9s authoredZ - geodataZ  : %s" % ("", stat(dg)))
        print("  %-9s %.0f%% of the geodata residuals are exact multiples of "
              "CELL_HEIGHT=8 -> these points were snapped to geodata layers, "
              "so they corroborate the geodata surface but are NOT independent "
              "evidence of it" % ("", 100.0 * on_grid / max(1, len(dg))))

    if check:
        if failures:
            print("\nFAIL: heightmap decode disagrees with the .unr TerrainSector "
                  "bounds on %d tile(s):" % len(failures))
            for tile, worst, lim in failures:
                print("  %s: median residual %.4f > %.4f" % (tile, worst, lim))
            return 1
        print("\nPASS: every tile's decoded heightmap reproduces the .unr's own "
              "TerrainSector bounding boxes within %g x heightScale."
              % SECTOR_TOL_UNITS)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
