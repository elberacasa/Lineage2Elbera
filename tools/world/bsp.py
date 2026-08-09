#!/usr/bin/env python3
"""bsp.py - offline .unr BSP -> assets/world/<tile>/bsp.gltf (the buildings).

WHAT THIS DECODES, AND WHY IT IS THE RIGHT SOURCE

Every building shell, wall, floor, stair and interior in an Interlude town
is BSP brush geometry, not a static mesh -- `convert.py` reads only
StaticMeshActors, so all of it was missing from the web scenes. A tile
carries the source brushes (one UModel + one UPolys per Brush actor, in
brush-local space) AND the single post-CSG level UModel that the retail
engine actually rasterises. This tool uses the level model, because that is
the geometry after additive/subtractive CSG: doorways are already cut, rooms
are already hollow, and its Points are already in WORLD coordinates, so no
brush Location/Rotation/PrePivot placement is applied (and none can be got
wrong). Rendering the source brush Polys instead would give solid boxes
where retail has rooms.

Verified world-space placement, tile 22_22 (Giran): the decoded
`Giran_Village_T.Giran_wall07` surfaces span x 77403..85821, y 144778..152447,
z -3624..-3149 -- inside the tile's scene.json origin box [65536,131072] +
32768 and on top of the Giran props (scene.json prop 0
`Giran_V_Plaza_Wall04` sits at 80662, 148618, -3387).

The UModel / FBspNode / FBspSurf / FVert / FPoly layouts, the byte-consumption
evidence and the EPolyFlags bit derivations live in `l2lib.ue2package`
(search for "UModel / UPolys"). Summary of what this tool relies on:

  * a node is a convex polygon: Verts[iVertPool .. +NumVertices) -> Points,
    stored counter-clockwise about the node plane (measured on 9082 node
    polygons across three tiles: Newell normal agrees in sign with the node
    plane on all of them), so a triangle fan in stored order is front-facing
    under glTF's CCW rule;
  * texture mapping is
        U = dot(P - Points[pBase], Vectors[vTextureU]) / texture width
        V = dot(P - Points[pBase], Vectors[vTextureV]) / texture height
    (the Vectors entries for texture axes are deliberately NOT unit -- their
    length carries the texture scale);
  * a surface is DROPPED when its PolyFlags carry
        PF_INVISIBLE     0x00000001  editor helper, never drawn
        PF_PORTAL        0x04000000  zone portal
        PF_FAKEBACKDROP  0x00000080  the +-327680-unit sky box faces
    Each of those three bits is named from the retail data itself, not from
    a header: 0x1 marks exactly the AntiPortal / WaterAntiportal /
    ZonePortal-textured surfaces plus the portals, and 0x80 marks exactly
    the world-box faces (T_texture.g_01, interior_A_ch02-3, ...Base, SL_S1)
    -- see the l2lib block comment for the full flag/material histogram.
  * two more things in the level BSP are not this tile's buildings and are
    dropped on structural evidence, never on a texture name:
      - the SKY ROOM (HazeRing_Final / SkybackgroundColor / Cloud_Final): a
        node is in it iff one of its iZone sides is the zone whose ZoneActor
        is the SkyZoneInfo. That catches 53 nodes on 17_25 and 53 on 22_22,
        exactly the sky ones, and no building node;
      - the WORLD BOX: the one Brush per map whose UModel bounding box is
        the whole L2 world (+-327680, +-262144, +-16384). Detected by size:
        a brush wider than a whole tile edge (GRID*SPACING = 32768) is not a
        building. 36 nodes on 17_25, 31 on 22_22.
  * `FX_E_T.WaterShader01` surfaces are dropped only on tiles whose
    scene.json already lists `water`: the water plane the client draws from
    that list IS this surface (convert.py WATER_TEXTURE names the same
    retail shader), and two coincident planes z-fight.

THE TAIL OF THE LEVEL UModel. This file used to say the bytes after
RootOutside/Linked were "an FLightMapIndex array plus the raw LightBits
blob". That was never checked and it is wrong about the first quarter of
them: `tools/world/lightmap.py` decodes that part exactly and it is the
retail RENDER SECTION TABLE (per-material sections of 40-byte render
vertices, whose NumPolys sum to len(model.nodes) on 100/100 tiles). Only
what follows the section table is baked-lighting data, and that part is
still NOT decoded -- see lightmap.py's docstring for what is established
about it and what is missing. This tool draws none of it and fakes none of
it; the client still lights the BSP with the same rig it uses for props.

OUTPUT (sibling files -- scene.json is a frozen contract and is not touched)

    assets/world/<tile>/bsp.gltf     glTF 2.0, external buffer
    assets/world/<tile>/bsp.bin      vertex/index data
    assets/world/<tile>/bsp/*.png    the surface textures

Contract and coordinate convention: tools/world/README.md, "bsp.gltf".

Usage:
    python3 tools/world/bsp.py 22_22 [17_25 ...]   # convert tiles
    python3 tools/world/bsp.py --all               # every converted tile
    python3 tools/world/bsp.py --check [tiles]     # validate, exit 1 on fail
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from l2lib import (L2Error, PF_FAKEBACKDROP, PF_INVISIBLE,  # noqa: E402
                   PF_MASKED, PF_PORTAL, extract_texture_rgba, level_model,
                   load_package, read_model, read_polys, resolve_material,
                   write_png)
from convert import (GRID, SPACING, RETAIL_MATERIALS, find_library_png,  # noqa: E402
                     find_prop_start, png_has_significant_alpha, prop_objref)

CLIENT = os.path.join(ROOT, "assets", "interlude")
OUT_ROOT = os.path.join(ROOT, "assets", "world")
MAPS = os.path.join(CLIENT, "maps")

# Surfaces the retail engine does not rasterise (see the module docstring).
SKIP_FLAGS = PF_INVISIBLE | PF_PORTAL | PF_FAKEBACKDROP
# The water surface the client already draws from scene.json "water".
WATER_MATERIAL = ("fx_e_t", "watershader01")

# Spatial bucket edge for the glTF nodes, L2 units. AUTHORED (not a retail
# value): 4800 L2u = 48 m = the client's PROP_CLUSTER_SIZE, so BSP chunks and
# prop clusters pop in and out at the same granularity under one draw
# distance. Purely a culling subdivision -- it changes no geometry.
CLUSTER_L2 = 4800.0

GLTF_FLOAT = 5126
GLTF_UINT16 = 5123
GLTF_UINT32 = 5125
GLTF_ARRAY_BUFFER = 34962
GLTF_ELEMENT_ARRAY_BUFFER = 34963


# ---------------------------------------------------------------------------
# textures
# ---------------------------------------------------------------------------

def png_size(path):
    """(width, height) from a PNG IHDR."""
    with open(path, "rb") as f:
        head = f.read(26)
    if not head.startswith(b"\x89PNG\r\n\x1a\n") or head[12:16] != b"IHDR":
        raise L2Error("%s: not a PNG" % path)
    return struct.unpack(">II", head[16:24])


def find_utx(package):
    """Case-insensitive lookup of a client texture package."""
    want = (package + ".utx").lower()
    for f in os.listdir(os.path.join(CLIENT, "textures")):
        if f.lower() == want:
            return os.path.join(CLIENT, "textures", f)
    return None


def decode_material_png(package, name, out_path):
    """Decode <package>.<name> (Texture OR Shader/FinalBlend/TexModifier)
    straight from the client .utx, following the same Shader->Diffuse chain
    the prop and terrain paths use. -> True on success."""
    path = find_utx(package)
    if not path:
        return False
    try:
        pkg, _proto = load_package(path)
        exp = pkg.find_export(name)
        if exp is None:
            return False
        if pkg.class_name_of(exp) != "Texture":
            exp = resolve_material(pkg, exp)
            if exp is None:
                return False
        w, h, rgba, _info = extract_texture_rgba(pkg, exp)
    except L2Error:
        return False
    write_png(out_path, w, h, rgba)
    return True


class TextureLibrary(object):
    """Resolves a BSP surface material to a shipped PNG + its pixel size.

    The pixel size is not decoration: the retail BSP UVs are in TEXTURE
    PIXELS, so the width/height are what turn them into 0..1 glTF UVs.
    """

    def __init__(self, out_dir):
        self.out_dir = out_dir
        self.cache = {}          # (package, name) -> (rel_uri, w, h) | None

    def get(self, package, name):
        key = ((package or "").lower(), name.lower())
        if key in self.cache:
            return self.cache[key]
        os.makedirs(self.out_dir, exist_ok=True)
        dst_name = "%s.png" % name
        dst = os.path.join(self.out_dir, dst_name)
        if not os.path.exists(dst):
            src = find_library_png(package, name)
            if src:
                with open(src, "rb") as f_in, open(dst, "wb") as f_out:
                    f_out.write(f_in.read())
            elif not decode_material_png(package, name, dst):
                self.cache[key] = None
                return None
        try:
            w, h = png_size(dst)
        except (OSError, L2Error):
            self.cache[key] = None
            return None
        self.cache[key] = ("bsp/" + dst_name, w, h)
        return self.cache[key]


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------

def surface_geometry(model, node, surf, tex_w, tex_h):
    """One BSP node -> (positions, normals, uvs, fan indices).

    Positions are the raw world-space Points; the normal is the node plane
    (unit, asserted by the parser); UVs are the retail BSP projection
    normalised by the texture size.
    """
    base = model.points[surf.p_base]
    tu = model.vectors[surf.v_texture_u]
    tv = model.vectors[surf.v_texture_v]
    nx, ny, nz = node.plane[0], node.plane[1], node.plane[2]
    pos, nrm, uv = [], [], []
    for k in range(node.num_vertices):
        p = model.points[model.verts[node.i_vert_pool + k][0]]
        dx, dy, dz = p[0] - base[0], p[1] - base[1], p[2] - base[2]
        pos.extend(p)
        nrm.extend((nx, ny, nz))
        uv.append((dx * tu[0] + dy * tu[1] + dz * tu[2]) / tex_w)
        uv.append((dx * tv[0] + dy * tv[1] + dz * tv[2]) / tex_h)
    idx = []
    for k in range(1, node.num_vertices - 1):
        idx.extend((0, k, k + 1))
    return pos, nrm, uv, idx


def sky_zones(pkg, model):
    """Indices of the level model's zones whose ZoneActor is a SkyZoneInfo.

    The backdrop room (HazeRing_Final / SkybackgroundColor / Cloud_Final)
    is ordinary BSP sitting far outside the tile, so it cannot be told from
    a building by flags alone -- but every one of its nodes has the sky
    zone on one side and nothing else does. Verified on 17_25 (zone 2) and
    22_22 (zone 15): the sky zone touches 53 and 53 nodes, exactly the
    HazeRing/Skybackground/Cloud ones, and zero building nodes.
    """
    out = set()
    for i, (actor, _conn, _vis, _t) in enumerate(model.zones):
        if actor > 0 and pkg.class_name_of(pkg.exports[actor - 1]) \
                == "SkyZoneInfo":
            out.add(i)
    return out


def brush_model_of(pkg, actor_ref):
    """Brush actor export ref -> its UModel (the `Brush` property), or None."""
    if actor_ref <= 0:
        return None
    try:
        props = find_prop_start(pkg, pkg.exports[actor_ref - 1]) or []
        ref = next((prop_objref(pkg, p["raw"]) for p in props
                    if p["name"] == "Brush" and p["type"] == 5), None)
        if not ref:
            return None
        mexp = pkg.find_export(ref["name"], cls="Model")
        return read_model(pkg, mexp) if mexp is not None else None
    except (L2Error, IndexError, struct.error):
        return None


def world_box_actors(pkg, model):
    """Brush actors that are the UnrealEd world box, not a building.

    Every .unr carries one enormous brush whose UModel bounding box is the
    whole L2 world -- exactly (-327680,-262144,-16384)..(327680,262144,16384)
    on 17_25 (Brush199) and 22_22 (Brush131). Its faces (T_texture.g_01,
    ...SL_S1) are the outer shell of the level and land many tiles away, so
    they are not this tile's geometry. Identified by size rather than by
    name: a brush wider than one whole tile edge (GRID*SPACING = 32768 L2
    units, the frozen scene.json geometry) cannot be a building -- the
    largest real building brush measured on these tiles is ~2500 units.
    """
    span = GRID * SPACING
    out = set()
    seen = set()
    for surf in model.surfs:
        if surf.actor <= 0 or surf.actor in seen:
            continue
        seen.add(surf.actor)
        bm = brush_model_of(pkg, surf.actor)
        if bm is None or not bm.bounds[2]:
            continue
        mn, mx = bm.bounds[0], bm.bounds[1]
        if mx[0] - mn[0] > span or mx[1] - mn[1] > span:
            out.add(surf.actor)
    return out


def collect(pkg, model, textures, drop_water):
    """-> ({(cluster, material_key): buckets}, stats)

    A bucket is {"pos", "nrm", "uv", "idx", "tex"}; `cluster` is the
    CLUSTER_L2 grid cell of the node centroid.
    """
    buckets = {}
    sky = sky_zones(pkg, model)
    world_box = world_box_actors(pkg, model)
    stats = dict(nodes=len(model.nodes), drawn=0, skipped_flags=0,
                 skipped_sky=0, skipped_worldbox=0, skipped_water=0,
                 skipped_notex=0, triangles=0, missing=set())
    for node in model.nodes:
        surf = model.surfs[node.i_surf]
        if surf.flags & SKIP_FLAGS:
            stats["skipped_flags"] += 1
            continue
        if sky.intersection(node.i_zone):
            stats["skipped_sky"] += 1
            continue
        if surf.actor in world_box:
            stats["skipped_worldbox"] += 1
            continue
        ref = pkg.ref_name(surf.material)
        if not ref or not ref[1]:
            stats["skipped_notex"] += 1
            continue
        package, name = ref
        if drop_water and ((package or "").lower(),
                           name.lower()) == WATER_MATERIAL:
            stats["skipped_water"] += 1
            continue
        tex = textures.get(package, name)
        if tex is None:
            stats["missing"].add("%s.%s" % (package, name))
            stats["skipped_notex"] += 1
            continue
        uri, tw, th = tex
        pos, nrm, uv, idx = surface_geometry(model, node, surf, tw, th)
        cx = int(sum(pos[0::3]) / node.num_vertices // CLUSTER_L2)
        cy = int(sum(pos[1::3]) / node.num_vertices // CLUSTER_L2)
        key = (cx, cy, uri, bool(surf.flags & PF_MASKED))
        b = buckets.get(key)
        if b is None:
            b = buckets[key] = dict(pos=[], nrm=[], uv=[], idx=[], tex=uri,
                                    masked=bool(surf.flags & PF_MASKED))
        off = len(b["pos"]) // 3
        b["pos"].extend(pos)
        b["nrm"].extend(nrm)
        b["uv"].extend(uv)
        b["idx"].extend(i + off for i in idx)
        stats["drawn"] += 1
        stats["triangles"] += len(idx) // 3
    return buckets, stats


# ---------------------------------------------------------------------------
# glTF 2.0 writer (stdlib; external .bin, one primitive per material/cluster)
# ---------------------------------------------------------------------------

class GltfBuilder(object):
    def __init__(self):
        self.blob = bytearray()
        self.views = []
        self.accessors = []

    def _view(self, data, target):
        while len(self.blob) % 4:
            self.blob.append(0)
        offset = len(self.blob)
        self.blob.extend(data)
        self.views.append({"buffer": 0, "byteOffset": offset,
                           "byteLength": len(data), "target": target})
        return len(self.views) - 1

    def vec(self, values, ncomp):
        data = struct.pack("<%df" % len(values), *values)
        view = self._view(data, GLTF_ARRAY_BUFFER)
        count = len(values) // ncomp
        mins = [min(values[i::ncomp]) for i in range(ncomp)]
        maxs = [max(values[i::ncomp]) for i in range(ncomp)]
        self.accessors.append({
            "bufferView": view, "componentType": GLTF_FLOAT, "count": count,
            "type": {2: "VEC2", 3: "VEC3"}[ncomp], "min": mins, "max": maxs})
        return len(self.accessors) - 1

    def indices(self, values, vertex_count):
        big = vertex_count > 0xFFFF
        fmt = "<%dI" % len(values) if big else "<%dH" % len(values)
        view = self._view(struct.pack(fmt, *values),
                          GLTF_ELEMENT_ARRAY_BUFFER)
        self.accessors.append({
            "bufferView": view, "count": len(values), "type": "SCALAR",
            "componentType": GLTF_UINT32 if big else GLTF_UINT16})
        return len(self.accessors) - 1


def write_gltf(out_dir, tile, buckets, stats):
    b = GltfBuilder()
    materials, images, gtextures = [], [], []
    mat_index = {}
    nodes, meshes = [], []
    by_cluster = {}
    for (cx, cy, uri, masked), bucket in sorted(buckets.items()):
        by_cluster.setdefault((cx, cy), []).append((uri, masked, bucket))

    for (cx, cy), items in sorted(by_cluster.items()):
        prims = []
        for uri, masked, bucket in items:
            key = (uri, masked)
            if key not in mat_index:
                png = os.path.join(out_dir, uri)
                # Alpha state, in order of how well it is sourced:
                #   1. PF_MASKED on the BSP surface — the map itself saying so.
                #   2. the retail UE2 material, which states AlphaRef exactly
                #      (RetailMaterialIndex.state, the same reader the prop
                #      path uses since audit F3).
                #   3. only if the name resolves to no retail material at all:
                #      the old PNG alpha histogram. That guess is what made two
                #      BSP materials render 100% invisible on surfaces retail
                #      declares OPAQUE, so it is now the last resort rather
                #      than the first answer.
                name = os.path.splitext(os.path.basename(uri))[0]
                retail = RETAIL_MATERIALS.state(name)
                cutoff = None
                if masked:
                    alpha = True
                elif retail is not None:
                    alpha = retail[0] == "MASK"
                    cutoff = retail[1]
                else:
                    alpha = png_has_significant_alpha(png)
                images.append({"uri": uri})
                gtextures.append({"source": len(images) - 1, "sampler": 0})
                mat = {
                    "name": os.path.splitext(os.path.basename(uri))[0],
                    "pbrMetallicRoughness": {
                        "baseColorTexture": {"index": len(gtextures) - 1},
                        "metallicFactor": 0.0, "roughnessFactor": 1.0},
                    # doubleSided on purpose: BSP walls are single-sided in
                    # retail, but the player walks INSIDE these shells and
                    # single-sided culling makes an entered room vanish.
                    # Same choice the prop glTFs already make.
                    "doubleSided": True,
                }
                if alpha:
                    mat["alphaMode"] = "MASK"
                    # retail states AlphaRef; 0.5 is only the fallback for a
                    # PF_MASKED surface whose material we could not read, and
                    # real foliage refs are 10 or 30, not 128
                    mat["alphaCutoff"] = cutoff if cutoff is not None else 0.5
                materials.append(mat)
                mat_index[key] = len(materials) - 1
            nvert = len(bucket["pos"]) // 3
            prims.append({
                "attributes": {
                    "POSITION": b.vec(bucket["pos"], 3),
                    "NORMAL": b.vec(bucket["nrm"], 3),
                    "TEXCOORD_0": b.vec(bucket["uv"], 2)},
                "indices": b.indices(bucket["idx"], nvert),
                "material": mat_index[key],
                "mode": 4})
        meshes.append({"name": "bsp_%d_%d" % (cx, cy), "primitives": prims})
        nodes.append({"mesh": len(meshes) - 1, "name": "bsp_%d_%d" % (cx, cy)})

    bin_name = "bsp.bin"
    gltf = {
        "asset": {"version": "2.0",
                  "generator": "elbera tools/world/bsp.py",
                  "extras": {
                      "tile": tile,
                      "source": "level UModel (post-CSG world BSP)",
                      "units": "L2 world units, Z-up (same as scene.json)",
                      "nodes": stats["nodes"], "drawn": stats["drawn"],
                      "triangles": stats["triangles"],
                      "skippedFlags": stats["skipped_flags"],
                      "skippedSky": stats["skipped_sky"],
                      "skippedWorldBox": stats["skipped_worldbox"],
                      "skippedWater": stats["skipped_water"],
                      "skippedNoTexture": stats["skipped_notex"],
                      "clusterL2": CLUSTER_L2,
                      "lightmaps": "not decoded; the UModel tail's first "
                                   "region is the render section table "
                                   "(see assets/world/<tile>/bsprender.json "
                                   "and tools/world/lightmap.py), the baked "
                                   "lighting after it is undecoded"}},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "textures": gtextures,
        "images": images,
        "samplers": [{"wrapS": 10497, "wrapT": 10497}],
        "accessors": b.accessors,
        "bufferViews": b.views,
        "buffers": [{"uri": bin_name, "byteLength": len(b.blob)}],
    }
    with open(os.path.join(out_dir, bin_name), "wb") as f:
        f.write(bytes(b.blob))
    with open(os.path.join(out_dir, "bsp.gltf"), "w") as f:
        json.dump(gltf, f, separators=(",", ":"))
    return len(b.blob)


# ---------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------

def scene_has_water(out_dir):
    try:
        with open(os.path.join(out_dir, "scene.json")) as f:
            return bool(json.load(f).get("water"))
    except (OSError, ValueError):
        return False


def convert_tile(tile):
    unr = os.path.join(MAPS, tile + ".unr")
    if not os.path.exists(unr):
        raise L2Error("no such map: %s" % unr)
    out_dir = os.path.join(OUT_ROOT, tile)
    if not os.path.isdir(out_dir):
        raise L2Error("%s: run convert.py first (no %s)" % (tile, out_dir))
    pkg, _proto = load_package(unr)
    model = level_model(pkg)
    if model is None:
        raise L2Error("%s: no level UModel" % tile)
    textures = TextureLibrary(os.path.join(out_dir, "bsp"))
    buckets, stats = collect(pkg, model, textures, scene_has_water(out_dir))
    size = write_gltf(out_dir, tile, buckets, stats)
    stats["bytes"] = size
    stats["primitives"] = sum(1 for _ in buckets)
    stats["lightmap_tail"] = model.lightmap_tail
    return stats


def brush_polys_crosscheck(pkg, model):
    """Independent check that the level BSP and the source brushes agree.

    Every FBspSurf names the Brush actor it was cut from and the index of
    the source FPoly inside that brush's UPolys. Resolving that FPoly and
    comparing its Material to the surface's exercises the UModel parser and
    the UPolys parser against each other -- two independent decodes of the
    same fact. -> (checked, matched).
    """
    polys_of = {}                      # brush export index -> [Poly] | None

    def brush_polys(actor_ref):
        """Brush actor -> its UModel (the `Brush` property) -> its UPolys."""
        if actor_ref in polys_of:
            return polys_of[actor_ref]
        polys_of[actor_ref] = None
        try:
            actor = pkg.exports[actor_ref - 1]
            props = find_prop_start(pkg, actor) or []
            ref = next((prop_objref(pkg, p["raw"]) for p in props
                        if p["name"] == "Brush" and p["type"] == 5), None)
            if not ref:
                return None
            mexp = pkg.find_export(ref["name"], cls="Model")
            if mexp is None:
                return None
            bm = read_model(pkg, mexp)
            if bm.polys <= 0:
                return None
            polys_of[actor_ref] = read_polys(pkg, pkg.exports[bm.polys - 1])
        except (L2Error, IndexError, struct.error):
            polys_of[actor_ref] = None
        return polys_of[actor_ref]

    checked = matched = 0
    for surf in model.surfs:
        if surf.actor <= 0 or surf.i_brush_poly < 0:
            continue
        plist = brush_polys(surf.actor)
        if not plist or surf.i_brush_poly >= len(plist):
            continue
        checked += 1
        matched += plist[surf.i_brush_poly].material == surf.material
    return checked, matched


def check_tile(tile):
    """Validate a converted tile. -> list of problem strings (empty = OK)."""
    out_dir = os.path.join(OUT_ROOT, tile)
    problems = []

    def need(cond, msg):
        if not cond:
            problems.append("%s: %s" % (tile, msg))

    gltf_path = os.path.join(out_dir, "bsp.gltf")
    if not os.path.exists(gltf_path):
        return ["%s: bsp.gltf missing (not converted)" % tile]
    with open(gltf_path) as f:
        g = json.load(f)
    need(g.get("asset", {}).get("version") == "2.0", "not glTF 2.0")
    need(len(g.get("buffers", [])) == 1, "expected exactly one buffer")
    bin_path = os.path.join(out_dir, g["buffers"][0]["uri"])
    need(os.path.exists(bin_path), "missing " + g["buffers"][0]["uri"])
    if os.path.exists(bin_path):
        need(os.path.getsize(bin_path) == g["buffers"][0]["byteLength"],
             "bsp.bin size does not match byteLength")
    for view in g.get("bufferViews", []):
        need(view["byteOffset"] + view["byteLength"]
             <= g["buffers"][0]["byteLength"], "bufferView out of range")
        need(view["byteOffset"] % 4 == 0, "bufferView is not 4-byte aligned")
    for img in g.get("images", []):
        need(os.path.exists(os.path.join(out_dir, img["uri"])),
             "missing image " + img["uri"])
    for mat in g.get("materials", []):
        need(mat.get("doubleSided") is True, "material is not doubleSided")
        tex = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
        need(0 <= tex < len(g.get("textures", [])), "material texture index")
    for mesh in g.get("meshes", []):
        for prim in mesh["primitives"]:
            for key in ("POSITION", "NORMAL", "TEXCOORD_0"):
                need(key in prim["attributes"], "primitive lacks " + key)
            counts = set(g["accessors"][a]["count"]
                         for a in prim["attributes"].values())
            need(len(counts) == 1, "attribute counts disagree")
            nvert = counts.pop() if counts else 0
            acc = g["accessors"][prim["indices"]]
            need(acc["count"] % 3 == 0, "index count is not a multiple of 3")
            need(acc["componentType"] == (GLTF_UINT32 if nvert > 0xFFFF
                                          else GLTF_UINT16),
                 "index component type does not match vertex count")

    # the geometry must still land inside the tile it belongs to
    scene_path = os.path.join(out_dir, "scene.json")
    if os.path.exists(scene_path) and g.get("accessors"):
        with open(scene_path) as f:
            scene = json.load(f)
        ox, oy = scene["origin"][0], scene["origin"][1]
        span = scene["gridSize"] * scene["spacing"]
        outside = 0
        total = 0
        for mesh in g["meshes"]:
            for prim in mesh["primitives"]:
                acc = g["accessors"][prim["attributes"]["POSITION"]]
                total += 1
                if not (ox - span <= acc["min"][0] and acc["max"][0]
                        <= ox + 2 * span
                        and oy - span <= acc["min"][1]
                        and acc["max"][1] <= oy + 2 * span):
                    outside += 1
        need(outside == 0,
             "%d/%d primitives fall outside the tile (placement bug)"
             % (outside, total))

    # and it must still be what the source .unr says it is
    unr = os.path.join(MAPS, tile + ".unr")
    if os.path.exists(unr):
        pkg, _proto = load_package(unr)
        model = level_model(pkg)
        need(model is not None, "no level UModel in the .unr")
        if model is not None:
            # full round trip: re-run the decode and demand the same
            # triangle count the shipped file carries. Catches a stale
            # bsp.gltf as well as any drift in the skip rules.
            textures = TextureLibrary(os.path.join(out_dir, "bsp"))
            _buckets, stats = collect(pkg, model, textures,
                                      scene_has_water(out_dir))
            tris = sum(g["accessors"][p["indices"]]["count"] // 3
                       for m in g["meshes"] for p in m["primitives"])
            need(tris == stats["triangles"],
                 "bsp.gltf has %d triangles, the .unr decodes to %d (stale?)"
                 % (tris, stats["triangles"]))
            # independent cross-decode: every level surface names the Brush
            # actor and the source FPoly index it was cut from, so the
            # UModel parser and the UPolys parser must agree on the material
            checked, matched = brush_polys_crosscheck(pkg, model)
            need(checked == len(model.surfs),
                 "only %d of %d surfaces resolved back to a source brush poly"
                 % (checked, len(model.surfs)))
            need(matched == checked,
                 "level BSP surfaces disagree with their source brush "
                 "polys (%d/%d materials matched)" % (matched, checked))
    return problems


def converted_tiles():
    return sorted(d for d in os.listdir(OUT_ROOT)
                  if os.path.isdir(os.path.join(OUT_ROOT, d))
                  and os.path.exists(os.path.join(OUT_ROOT, d, "scene.json")))


def main(argv):
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--check":
        tiles = args[1:] or converted_tiles()
        bad = 0
        for tile in tiles:
            problems = check_tile(tile)
            for p in problems:
                print("FAIL " + p)
            bad += bool(problems)
        print("--check: %d/%d tiles OK" % (len(tiles) - bad, len(tiles)))
        return 1 if bad else 0
    tiles = converted_tiles() if args[0] == "--all" else args
    failures = 0
    for tile in tiles:
        try:
            s = convert_tile(tile)
        except L2Error as exc:
            print("%-8s FAILED: %s" % (tile, exc))
            failures += 1
            continue
        print("%-8s %5d/%-5d nodes drawn, %5d tris, %3d prims, %6.1f KiB"
              " (skipped: %d flagged, %d sky, %d worldbox, %d water,"
              " %d no-texture)"
              % (tile, s["drawn"], s["nodes"], s["triangles"],
                 s["primitives"], s["bytes"] / 1024.0, s["skipped_flags"],
                 s["skipped_sky"], s["skipped_worldbox"], s["skipped_water"],
                 s["skipped_notex"]))
        if s["missing"]:
            print("         unresolved materials: %s"
                  % ", ".join(sorted(s["missing"])[:6]))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
