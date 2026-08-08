#!/usr/bin/env python3
"""bspfloor.py - assets/world/<tile>/{bsp.gltf, props/*.gltf} -> bspfloor.bin,
TWO rasters of the surfaces the client draws over the natural ground:

  SECTION 1, the BSP FLOOR RASTER (unchanged since it was written): where the
  decoded level BSP puts a walkable-facing surface over each TERRAIN GRID
  POINT (256 x 256, 128 units apart), and at what height. Consumed by the
  stale-rectangle correction (heightfix.js), whose question really is asked
  per terrain vertex: "does the BSP floor the +-64 box this vertex draws?"

  SECTION 2, the WALK RASTER (added 2026-08-08): the same question asked per
  GEODATA CELL (2048 x 2048, 16 units apart, the same origin and the same
  floor() indexing as geodata.bin) and answered from the BSP *and from the
  PROPS*. Consumed by terrain.js _drawnGroundL2, whose question is "what is
  the surface the player sees at exactly this point?" -- see WHY SECTION 2.

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

WHY SECTION 2 (measured on the Giran plaza staircase, 22_22)

The player's report was "when i walk in giran i dont go up the stairs i go
trough them". Walking east at y=148618 the walker stayed at -3496 for the
whole staircase while the live aCis climbed -3464 -3448 -3432 -3416 -3400.
Traced: terrain.js _drawnGroundL2 asks section 1 for "the surface the player
sees" and section 1 is BSP-ONLY, so the staircase -- Giran_V_Plaza_Stair01,
a PROP -- was not in it at all, and every point on it read the plaza slab
(-3496) that the BSP puts UNDER the stair. Two things follow, and section 2
needs both:

  * PROPS have to be rastered. A staircase, a jetty, a platform is a prop.
  * 128 units is too coarse to say WHERE. The staircase is 112 units of tread
    and the BSP slab runs under all of it, so at the terrain grid the two
    surfaces are the same sample and nothing can tell them apart. At the
    16-unit geodata cell they separate: MEASURED at y=148618, per cell, the
    tread's own geodata layer stands +31 over the tread while the buried slab
    is +40 +48 +56 +64 +72 +80 +88 +96 under the same layer. That +31 is the
    documented geodata-over-drawn-surface band (+26.9..+34.2), and it is what
    tells the client which of the two surfaces the player is standing on.
    16 is not a taste: it is geodata's OWN cell size, so a raster cell IS a
    geodata cell and the walkability test below is exact rather than blurred
    across cells.

WHICH PROP SURFACES ARE WALKABLE is decided by GEODATA, not by mesh names or
heights: a sample is kept only when the geodata cell it falls in carries a
layer within GEO_ANCHOR_MAX (64) of it -- the SAME test terrain.js applies at
runtime, on the SAME cell, so the gate is lossless with respect to it and
adds nothing new to reason about. A roof, a tree canopy or a wall top has no
geodata layer near it and drops out here.

THE MIRRORED-PROP TRAP. 1,849 retail placements carry a negative-determinant
DrawScale3D. Transforming a triangle by a matrix M maps its winding normal to
det(M) * M^-T * n, so on a mirrored placement the naive cross product of the
placed triangle points the WRONG WAY and a staircase looks like a ceiling.
Measured on Giran_V_Plaza_Stair01 (scale [-1, 1, 1], det -1e6): the naive
winding gives 0 upward-facing triangles, the sign-corrected normal gives 260
and reproduces the drawn ramp -3487.3 -> -3431.3 exactly. So the normal is
transformed as a normal (multiplied by sign(det)), never read off the winding.

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
  -- end of section 1; a file may stop here (no geodata => no section 2) --
    u32  magic 'WALK' (0x4B4C4157 little-endian)
    i32  fineSpacing       (= geodata cellSize, 16)
    u16  fineCells         (cells per axis, = gridSize*spacing/fineSpacing)
    u16  blockCells        (fine cells per block edge, 8)
    then (fineCells/blockCells)^2 BLOCK records, row-major with bx FASTEST:
        u8 type 0 EMPTY    (no walkable surface anywhere in the block)
        u8 type 1 UNIFORM  -> u8 count, count x i16   (all 64 cells alike)
        u8 type 2 CELLS    -> 64 x (u8 count, count x i16), cell index
                             (cy % 8) * 8 + (cx % 8)
    Fine cell (cx, cy) COVERS [originX + cx*16, +16) x [originY + cy*16, +16)
    -- floor() indexing from the same origin as geodata.bin, i.e. the cell IS
    the geodata cell -- and its height is sampled at the cell CENTRE.

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

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_ROOT = os.path.join(ROOT, "assets", "world")

MAGIC = 0x46505342          # 'BSPF' little-endian
WALK_MAGIC = 0x4B4C4157     # 'WALK' little-endian
# Section 2 pitch. NOT a free parameter: it is geodata's own cellSize, so a
# raster cell is a geodata cell (same origin, same floor() indexing) and the
# walkability gate below is exactly the test terrain.js runs at runtime.
FINE_SPACING = 16
BLOCK_CELLS = 8             # fine cells per block edge (block = 128 L2 units)
# How far a geodata layer may sit from a drawn surface and still describe it:
# geodata.js GEO_ANCHOR_MAX, the guard terrain.js _drawnGroundL2 already
# applies. Keeping the build gate identical to it makes section 2 lossless
# with respect to the runtime rule -- nothing is dropped here that the client
# would have accepted.
GEO_ANCHOR_MAX = 64
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


# ---------------------------------------------------------------------------
# props: scene.json placements x props/<name>.gltf -> L2 world triangles
#
# The placement is terrain.js _propMatrix reproduced term for term
# (ueQuaternion + propScale + l2ToThree). Anything else here is a guess about
# where a prop is, and this file does not guess: the client's own placement is
# the definition of where the player sees the prop.
#
# CHECKED AGAINST THE CLIENT, not just read off it: 556 random down-rays cast
# in the live page against terrain.props (materials forced DoubleSide), of
# which 339 hit a face this raster would call a floor (nz >= FLOOR_NZ). The z
# these triangles give at those points vs the client's own raycast hit --
# median 0.0010, p95 0.0048, max 0.0103 L2 units, 0 points where this file
# found no surface. A wrong rotation sign or a wrong scale axis would show up
# as metres, not as float noise.
# ---------------------------------------------------------------------------

UE_ROT_TO_RAD = 2.0 * math.pi / 65536.0
NP_DT = {CT_FLOAT: "<f4", CT_UINT32: "<u4", CT_UINT16: "<u2", 5121: "<u1"}
# three.js (metres, Y up) -> L2 (units, Z up): the inverse of coords.js
# l2ToThree, which is (x, y, z)_L2 -> (x, z, -y)_three.
THREE_TO_L2 = np.array([[100.0, 0.0, 0.0],
                        [0.0, 0.0, -100.0],
                        [0.0, 100.0, 0.0]])


def _xform(pos, A, t):
    """pos @ A.T + t. The errstate is not papering over bad data: numpy 2.0 on
    Accelerate raises divide-by-zero/overflow flags from inside the BLAS
    matmul kernel on perfectly finite input (checked: every POSITION accessor
    that trips it is finite, min |value| 4.3e-5), and the result is exact."""
    with np.errstate(all="ignore"):
        return pos @ A.T + t


def _accessor_np(gltf, bufs, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    n = TYPE_N[acc["type"]]
    dt = np.dtype(NP_DT[acc["componentType"]])
    stride = view.get("byteStride")
    if stride and stride != n * dt.itemsize:
        raise SystemExit("bspfloor: interleaved accessor not supported")
    off = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    a = np.frombuffer(bufs[view.get("buffer", 0)], dtype=dt,
                      count=acc["count"] * n, offset=off)
    return a.reshape(acc["count"], n) if n > 1 else a


def _quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def _axis_angle(ax, ay, az, ang):
    s = math.sin(ang * 0.5)
    return (ax * s, ay * s, az * s, math.cos(ang * 0.5))


def _quat_mat3(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def ue_quaternion(pitch, yaw, roll):
    """terrain.js Terrain.ueQuaternion (docs/world-prop-basis.md)."""
    q = _axis_angle(0, 1, 0, yaw * UE_ROT_TO_RAD)
    q = _quat_mul(q, _axis_angle(0, 0, 1, pitch * UE_ROT_TO_RAD))
    return _quat_mul(q, _axis_angle(1, 0, 0, -roll * UE_ROT_TO_RAD))


def _node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if "rotation" in node:
        m[:3, :3] = _quat_mat3(node["rotation"])
    if "scale" in node:
        m[:3, :3] = m[:3, :3] @ np.diag(node["scale"])
    if "translation" in node:
        m[:3, 3] = node["translation"]
    return m


def prop_primitives(path):
    """-> [(positions Nx3 in glTF/three space, triangle indices Mx3)] with the
    glTF's own node transforms applied (GLTFLoader's matrixWorld)."""
    with open(path) as f:
        gltf = json.load(f)
    d = os.path.dirname(path)
    bufs = []
    for b in gltf.get("buffers", []):
        with open(os.path.join(d, b["uri"]), "rb") as f:
            bufs.append(f.read())
    out = []
    nodes = gltf.get("nodes", [])

    def walk(i, parent):
        node = nodes[i]
        m = parent @ _node_matrix(node)
        if "mesh" in node:
            for prim in gltf["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4 or "indices" not in prim:
                    continue
                idx = _accessor_np(gltf, bufs, prim["indices"])
                if not len(idx):
                    continue
                pos = _accessor_np(
                    gltf, bufs, prim["attributes"]["POSITION"]).astype(np.float64)
                out.append((_xform(pos, m[:3, :3], m[:3, 3]),
                            idx.astype(np.int64).reshape(-1, 3)))
        for c in node.get("children", []):
            walk(c, m)

    for s in gltf["scenes"][gltf.get("scene", 0)]["nodes"]:
        walk(s, np.eye(4))
    return out


def placement_to_l2(p):
    """-> (A 3x3, t 3) mapping a glTF vertex of placement `p` to L2 world."""
    R = _quat_mat3(ue_quaternion(*(p.get("rotation") or [0, 0, 0])))
    sx, sy, sz = p.get("scale") or [1, 1, 1]
    m3 = R @ np.diag([sx, sz, sy])              # Terrain.propScale
    px, py, pz = p["position"]
    return (THREE_TO_L2 @ m3,
            THREE_TO_L2 @ np.array([px * 0.01, pz * 0.01, -py * 0.01]))


def prop_triangles(tile_dir, scene):
    """-> [(a, b, c)] L2 world triangles whose UPWARD-facing side is a
    candidate floor. See THE MIRRORED-PROP TRAP in the module docstring: the
    normal is transformed as a normal, it is not read off the winding."""
    cache = {}
    tris = []
    for p in scene.get("props") or []:
        gltf = p.get("gltf")
        if not gltf or not p.get("position"):
            continue
        if gltf not in cache:
            path = os.path.join(tile_dir, gltf)
            cache[gltf] = prop_primitives(path) if os.path.exists(path) else []
        A, t = placement_to_l2(p)
        sign = 1.0 if np.linalg.det(A) > 0 else -1.0
        for pos, idx in cache[gltf]:
            w = _xform(pos, A, t)
            a, b, c = w[idx[:, 0]], w[idx[:, 1]], w[idx[:, 2]]
            n = np.cross(b - a, c - a) * sign
            ln = np.linalg.norm(n, axis=1)
            keep = (ln > 0) & (n[:, 2] / np.where(ln == 0, 1, ln) >= FLOOR_NZ)
            if keep.any():
                tris.append(np.stack([a[keep], b[keep], c[keep]], axis=1))
    if not tris:
        return np.zeros((0, 3, 3))
    return np.concatenate(tris)


# ---------------------------------------------------------------------------
# geodata (the walkability arbiter). blockstream-v1, decoded exactly as
# editor/world/js/geodata.js does -- FLAT blocks store the height directly,
# COMPLEX/MULTILAYER store packed cell words, and the cell index inside a block
# is X OUTER / Y INNER ((cx % 8) * 8 + cy % 8), the aCis order.
#
# "Exactly" is checked, not asserted: 3,000 random cells of 22_22 read through
# this class and through the client's geodata.js _layersAt give identical layer
# lists (0 mismatches). That is what lets the gate below claim to be the same
# test the client runs -- if the two decoders disagreed, the raster would be
# gated on one thing and consumed under another.
# ---------------------------------------------------------------------------

class GeoCells:
    def __init__(self, tile_dir, scene):
        ref = scene.get("geodata")
        self.ok = False
        if not ref:
            return
        meta_path = os.path.join(tile_dir, ref)
        if not os.path.exists(meta_path):
            return
        with open(meta_path) as f:
            meta = json.load(f)
        layer = (meta.get("layers") or [None])[0]
        if not layer or layer.get("encoding") != "blockstream-v1":
            return
        with open(os.path.join(tile_dir, layer["data"]), "rb") as f:
            self.blob = f.read()
        self.origin = meta["origin"]
        self.cell_size = meta.get("cellSize", 16)
        self.cells = meta.get("cells", 2048)
        self.blocks = meta.get("blocks", 256)
        self._index()
        self.ok = True

    def _index(self):
        b = self.blob
        n = self.blocks * self.blocks
        off = np.zeros(n, dtype=np.int64)
        p = 8                                  # magic u32 + tileX/tileY u16
        for i in range(n):
            off[i] = p
            t = b[p]
            if t == 0:
                p += 3
            elif t == 1:
                p += 129
            else:
                p += 1
                for _ in range(64):
                    p += 1 + 2 * b[p]
        if p != len(b):
            raise SystemExit("bspfloor: geodata index consumed %d of %d bytes"
                             % (p, len(b)))
        self.off = off
        self.cache = {}

    def block_layers(self, bx, by):
        """-> list of 64 height lists, cell index (cx % 8) * 8 + (cy % 8)
        (X OUTER / Y INNER -- aCis's own cell order, see geodata.js)."""
        key = bx * self.blocks + by
        got = self.cache.get(key)
        if got is not None:
            return got
        b = self.blob
        p = int(self.off[key])
        t = b[p]
        p += 1
        if t == 0:
            h = struct.unpack_from("<h", b, p)[0]
            out = [[h]] * 64
        elif t == 1:
            out = [[_cell_height(w)]
                   for w in struct.unpack_from("<64h", b, p)]
        else:
            out = []
            for _ in range(64):
                n = b[p]
                p += 1
                out.append([_cell_height(w)
                            for w in struct.unpack_from("<%dh" % n, b, p)])
                p += 2 * n
        self.cache[key] = out
        return out

    def layers_at_cell(self, cx, cy):
        cx = max(0, min(self.cells - 1, cx))
        cy = max(0, min(self.cells - 1, cy))
        return self.block_layers(cx >> 3, cy >> 3)[(cx & 7) * 8 + (cy & 7)]


def _cell_height(word):
    v = word & 0xFFF0
    if v & 0x8000:
        v -= 0x10000
    return v >> 1


# ---------------------------------------------------------------------------
# section 2: the walk raster
# ---------------------------------------------------------------------------

def fine_samples(tris, ox, oy, n, pitch, chunks):
    """Point-sample every triangle at the CENTRE of each cell of an n x n
    lattice whose cell (cx, cy) covers [ox + cx*pitch, +pitch). Appends
    (cellIndex, z) arrays to `chunks`. Centre sampling, not the +-box credit
    section 1 uses: section 1 answers for a terrain VERTEX, which draws a
    whole box; section 2 answers for a POINT."""
    for a, b, c in tris:
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        det = ux * vy - uy * vx
        if det == 0.0:
            continue
        i0 = int(math.floor((min(a[0], b[0], c[0]) - ox) / pitch - 0.5)) + 1
        i1 = int(math.ceil((max(a[0], b[0], c[0]) - ox) / pitch - 0.5))
        j0 = int(math.floor((min(a[1], b[1], c[1]) - oy) / pitch - 0.5)) + 1
        j1 = int(math.ceil((max(a[1], b[1], c[1]) - oy) / pitch - 0.5))
        i0 = max(i0, 0)
        j0 = max(j0, 0)
        i1 = min(i1, n - 1)
        j1 = min(j1, n - 1)
        if i1 < i0 or j1 < j0:
            continue
        px = (ox + (np.arange(i0, i1 + 1) + 0.5) * pitch - a[0])[None, :]
        py = (oy + (np.arange(j0, j1 + 1) + 0.5) * pitch - a[1])[:, None]
        s = (px * vy - py * vx) / det
        t = (py * ux - px * uy) / det
        m = (s >= 0.0) & (t >= 0.0) & (s + t <= 1.0)
        if not m.any():
            continue
        z = a[2] + s * uz + t * vz
        jj, ii = np.nonzero(m)
        chunks.append(((jj + j0) * n + (ii + i0), z[m]))
    return chunks


def walk_raster(tile_dir, scene, geo, grid, spacing, origin):
    """-> (dict cellIndex -> ascending int heights, n) for section 2, or
    (None, 0) when the tile ships no geodata to adjudicate with."""
    if not geo.ok:
        return None, 0
    if geo.cell_size != FINE_SPACING or list(geo.origin) != list(origin[:2]):
        raise SystemExit(
            "%s: geodata cellSize %s / origin %s does not match the walk "
            "raster's %d / %s -- section 2 assumes a raster cell IS a geodata "
            "cell" % (tile_dir, geo.cell_size, geo.origin, FINE_SPACING,
                      origin[:2]))
    n = int(grid * spacing // FINE_SPACING)
    ox, oy = origin[0], origin[1]
    chunks = []
    tris = bsp_triangles(tile_dir)
    if tris:
        up = []
        for a, b, c in tris:
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx = uy * vz - uz * vy
            ny = uz * vx - ux * vz
            nz = ux * vy - uy * vx
            ln = (nx * nx + ny * ny + nz * nz) ** 0.5
            if ln and nz / ln >= FLOOR_NZ:
                up.append((a, b, c))
        fine_samples(up, ox, oy, n, FINE_SPACING, chunks)
    ptris = prop_triangles(tile_dir, scene)
    if len(ptris):
        fine_samples(ptris, ox, oy, n, FINE_SPACING, chunks)
    if not chunks:
        return {}, n
    idx = np.concatenate([c[0] for c in chunks])
    zs = np.concatenate([c[1] for c in chunks])
    order = np.lexsort((zs, idx))
    idx, zs = idx[order], zs[order]
    cells = {}
    bounds = list(np.nonzero(np.diff(idx))[0] + 1) + [len(idx)]
    start = 0
    for end in bounds:
        k = int(idx[start])
        cx, cy = k % n, k // n
        layers = geo.layers_at_cell(cx, cy)
        keep = []
        if layers:
            for v in zs[start:end]:
                zi = int(round(v))
                if keep and zi - keep[-1] < DEDUP_L2:
                    continue
                # the walkability arbiter (see the module docstring)
                if min(abs(l - zi) for l in layers) > GEO_ANCHOR_MAX:
                    continue
                keep.append(zi)
        if keep:
            if len(keep) > MAX_LAYERS:
                step = (len(keep) - 1) / float(MAX_LAYERS - 1)
                keep = [keep[int(round(i * step))] for i in range(MAX_LAYERS)]
            cells[k] = [max(-32768, min(32767, z)) for z in keep]
        start = end
    return cells, n


def encode_walk(cells, n):
    """Section 2 (see the module docstring). Blocks are BLOCK_CELLS square and
    a uniform block ships one record instead of 64 -- a plaza slab is one flat
    surface for 128 units at a time, and paying 64 records for it would triple
    the file for nothing."""
    nb = n // BLOCK_CELLS
    blocks = {}
    for k, zs in cells.items():
        cx, cy = k % n, k // n
        b = blocks.setdefault((cy // BLOCK_CELLS) * nb + cx // BLOCK_CELLS, {})
        b[(cy % BLOCK_CELLS) * BLOCK_CELLS + (cx % BLOCK_CELLS)] = zs
    out = bytearray(struct.pack("<IiHH", WALK_MAGIC, FINE_SPACING, n,
                                BLOCK_CELLS))
    per = BLOCK_CELLS * BLOCK_CELLS
    for bi in range(nb * nb):
        b = blocks.get(bi)
        if not b:
            out.append(0)
            continue
        first = b[next(iter(b))]
        if len(b) == per and all(v == first for v in b.values()):
            out.append(1)
            out.append(len(first))
            out += struct.pack("<%dh" % len(first), *first)
            continue
        out.append(2)
        for c in range(per):
            zs = b.get(c) or []
            out.append(len(zs))
            if zs:
                out += struct.pack("<%dh" % len(zs), *zs)
    return bytes(out)


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
    data = derive(tile_dir, scene, tris, grid, spacing, origin)
    cells = raster(tris, origin, grid, spacing)
    covered = sum(1 for c in cells if c)
    # An all-empty raster is still WRITTEN. Letting the client's probe 404
    # instead costs a console error per tile in every headless suite, and a
    # 404 whose body the client does not drain never lets a page reach
    # networkidle0 (see editor/world/js/bspfloor.js). 65 KB of zero counts is
    # the cheaper answer.
    with open(out_path, "wb") as f:
        f.write(data["bytes"])
    if verbose:
        print("%s: %d bsp triangles, %d/%d grid points floored (%.1f%%); "
              "walk raster %d/%d cells, %d layers; %d bytes (%d + %d)"
              % (tile, len(tris), covered, grid * grid,
                 100.0 * covered / (grid * grid), data["walkCells"],
                 data["fine"] * data["fine"], data["walkLayers"],
                 len(data["bytes"]), data["sec1"], data["sec2"]))
    return {"tile": tile, "triangles": len(tris), "covered": covered,
            "walkCells": data["walkCells"], "walkLayers": data["walkLayers"],
            "bytes": len(data["bytes"])}


def derive(tile_dir, scene, tris, grid, spacing, origin):
    """Both sections, exactly as they are written -- so --check re-derives
    with the same code path the writer used."""
    sec1 = encode(raster(tris, origin, grid, spacing), grid, origin, spacing)
    geo = GeoCells(tile_dir, scene)
    cells, n = walk_raster(tile_dir, scene, geo, grid, spacing, origin)
    sec2 = b"" if cells is None else encode_walk(cells, n)
    return {"bytes": sec1 + sec2, "sec1": len(sec1), "sec2": len(sec2),
            "fine": n, "walkCells": 0 if cells is None else len(cells),
            "walkLayers": 0 if cells is None else sum(len(v) for v in cells.values())}


def check_tile(tile):
    """Re-derive both sections and compare byte for byte with the shipped
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
    if not os.path.exists(out_path):
        return (False, "missing bspfloor.bin")
    want = derive(tile_dir, scene, tris, grid, spacing, scene["origin"])
    with open(out_path, "rb") as f:
        got = f.read()
    if got != want["bytes"]:
        why = "stale"
        if len(got) <= want["sec1"]:
            why = "no WALK section (pre-2026-08-08 file)"
        return (False, "%s (%d bytes on disk, %d re-derived)"
                % (why, len(got), len(want["bytes"])))
    return (True, "%d bytes (%d + %d)"
            % (len(got), want["sec1"], want["sec2"]))


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
