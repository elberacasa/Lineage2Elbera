#!/usr/bin/env python3
"""convert.py - offline .unr -> web scene converter (M1 terrain port).

For each map tile <tx>_<ty> this reads
    assets/interlude/maps/<tile>.unr           (TerrainInfo + StaticMeshActors)
    assets/interlude/textures/T_<tile>.utx     (G16 heightmap + per-layer splats)
    assets/interlude/textures/<pkg>.utx        (layer diffuse textures, fallback)
    assets/library/<pkg>/<name>.png            (pre-exported layer textures)
    assets/interlude/staticmeshes/<pkg>.usx    (props, via tools/bin/umodel)

and writes
    assets/world/<tile>/scene.json             (FROZEN contract, see README.md)
    assets/world/<tile>/heightmap.u16          (raw little-endian 256x256 u16)
    assets/world/<tile>/terrain-topology.json (lossless native bitmap arrays;
                                               per-map visibility evidence)
    assets/world/<tile>/terrain-edges.json    (adjacent original G16 edge samples)
    assets/world/<tile>/heightmap.png          (min-max normalized preview)
    assets/world/<tile>/basecolor.png          (splat-blended preview, simplified)
    assets/world/<tile>/textures/*.png         (layer diffuses + splat maps)
    assets/world/<tile>/props/*.gltf|bin       (converted static meshes)
    assets/world/<tile>/props/textures/*.png   (prop textures referenced by gltf)
    assets/world/<tile>/light.json             (retail sun / zone ambient /
                                                distance fog, via
                                                light_extract.py; sibling file
                                                — scene.json stays frozen)

Usage:
    python3 tools/world/convert.py 17_23 [19_22 ...]   # convert tiles
    python3 tools/world/convert.py --check 17_23 ...   # validate scene.json
    python3 tools/world/convert.py --water-only T ...  # repatch water only
    python3 tools/world/convert.py --topology-only T   # preserve terrain masks
    python3 tools/world/convert.py --edges-only T      # source adjacent edge samples
    python3 tools/world/convert.py --materials-only T  # re-apply the retail
                                                       # prop material state
    python3 tools/world/convert.py --repair-prop-identities T --mesh Package.Group.Mesh
        # Elbera Tools: stage selected qualified props; --emit backs up/adopts

Everything is stdlib Python + l2lib (tools/l2lib) + tools/bin/umodel.
Format lore: docs/map-format.md. See tools/world/README.md for what is exact
vs simplified.
"""

import array
import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from l2lib import (L2Error, Reader, TEXF_DXT1, load_package,  # noqa: E402
                   parse_texture, extract_texture_rgba, read_properties,
                   resolve_material, write_png)
import geodata  # noqa: E402  (tools/world sibling module)
import light_extract  # noqa: E402  (tools/world sibling module)
import terrain_topology  # noqa: E402  (tools/world sibling module)
import terrain_edges  # noqa: E402  (tools/world sibling module)

CLIENT = os.path.join(ROOT, "assets", "interlude")
LIBRARY = os.path.join(ROOT, "assets", "library")
OUT_ROOT = os.path.join(ROOT, "assets", "world")
UMODEL = os.path.join(ROOT, "tools", "bin", "umodel")

GRID = 256
SPACING = 128.0
G16_MARKER = b"\x00\x40\x80\x10"
# packages whose StaticMesh names are UE built-in placeholders, not real files
PLACEHOLDER_PACKAGES = ("Texture", "Height", "Engine", "Lineage2Ver")


# ---------------------------------------------------------------------------
# ordered packed-property reader (l2lib's read_properties collapses repeated
# names, but TerrainInfo.Layers is an array of same-name struct props)
# ---------------------------------------------------------------------------

_SIZE_SEL = {0: 1, 1: 2, 2: 4, 3: 12, 4: 16}

# Interior (dungeon) tiles — explicit VERIFIED list, see tools/world/README.md.
# A tile is interior when its .unr map is a dungeon: the terrain is a flat
# dummy plane (relief == 0) and every StaticMeshActor sits far below it.
# Verified against the full converted set (terrain relief + prop z-ranges
# for all 100 tiles) and named zones in assets/world/tile-map.json:
#   19_16  Pagan Temple (Rune)        terrain flat -4704.0, 579 props -11329..-8276
#   21_25  Elven Ruins (Talking Isl.) terrain flat -4704.0, 1110 props -6689..-5357
#   25_21  Antharas' Nest (Giran)     terrain flat -3753.3, 36 props -7825..-5292
# Tiles with real terrain that merely CONTAIN underground zones (Cruma Tower
# 20_21, Giran Castle + Necropolis of Martyrdom 23_22, Garden of Eva 22_25,
# the Necropolis/Catacomb entrance tiles, ...) are OUTDOOR/mixed and are
# deliberately NOT flagged.
INTERIOR_TILES = frozenset(("19_16", "21_25", "25_21"))


def read_props_ordered(pkg, pos):
    """Packed (UE1-style) property list starting at absolute offset `pos`.
    Returns (props, end_pos); props keeps document order and array indices."""
    r = Reader(pkg.data, pos, path=pkg.path)
    props = []
    while True:
        name = pkg.name(r.compact())
        if name == "None":
            break
        info = r.u8()
        ptype = info & 0xF
        sel = (info >> 4) & 7
        is_arr = bool(info & 0x80)
        sname = pkg.name(r.compact()) if ptype == 10 else None
        if sel in _SIZE_SEL:
            ds = _SIZE_SEL[sel]
        elif sel == 5:
            ds = r.u8()
        elif sel == 6:
            ds = r.u16()
        else:
            ds = r.u32()
        aidx = 0
        if ptype != 3 and is_arr:
            b = r.u8()
            if b < 128:
                aidx = b
            elif b & 0x40:
                r.bytes(3)
            else:
                r.bytes(1)
        raw = r.bytes(ds)
        props.append(dict(name=name, type=ptype, size=ds, struct=sname,
                          index=aidx, raw=raw, boolval=is_arr))
    return props, r.pos


def actor_prop_offset(pkg, exp):
    """Offset (from the export body start) of an actor's tagged property
    list, DERIVED from the layout instead of searched for.

    docs/map-format.md §3.1: a scripted actor body is
        cidx ClassIndex, cidx ClassIndex, i32 -1, i32 -1, byte[5], <props>
    so the list starts at 2*len(cidx(ClassIndex)) + 13 — the "15 or 17"
    in the doc is just that compact index being one or two bytes wide.
    Everything before the property list is therefore checkable: both
    compact indices must equal the export table's own ClassIndex and both
    i32 must be -1. -> offset, or None when the bytes are not that layout
    (native exports, and anything the doc does not describe).

    Measured over all 100 converted maps (162,805 StaticMeshActor exports):
    the check passes for every one, the offset is 15 for every one, and the
    property list it points at consumes the body EXACTLY for 162,779 of
    them (99.98%).
    """
    try:
        r = Reader(pkg.data, exp.serial_offset, path=pkg.path)
        if r.compact() != exp.class_index:
            return None
        if r.compact() != exp.class_index:
            return None
        if r.i32() != -1 or r.i32() != -1:
            return None
        r.bytes(5)
        return r.pos - exp.serial_offset
    except (L2Error, IndexError, struct.error):
        return None


def find_prop_start(pkg, exp, want_first=None, max_start=25):
    """Property list of a map actor body (docs/map-format.md §3.1).

    The offset is DERIVED first (actor_prop_offset) and only accepted when
    the list parsed there consumes the body exactly; the offset scan below
    is the fallback for bodies that are not the documented layout.

    WHY the scan cannot be the primary rule — this is the second time it
    has been wrong. A naive first-valid scan misfired on ~1/3 of actors
    (699 of 1936 on 22_22: a 4-byte garbage parse at offset 10 beat the
    real list at 15). Scoring candidates by "has Location, then most
    properties, then longest span" fixed those but STILL lost 5,593
    placements world-wide and mis-resolved 14 more, because a re-sync
    further into the body can parse cleanly, reach the end of the body,
    and carry MORE property tags than the real list while missing
    StaticMesh — on 22_22 that is what dropped Giran_V_Plaza_Stair01, the
    plaza staircase, along with 44 others. Any rule that picks between
    coincidences is guessing; the header length is computable, so compute
    it. (Measured: derived 162,745 usable StaticMeshActor placements vs
    the scan's 157,152, none lost.)"""
    end_of = exp.serial_offset + exp.serial_size
    off = actor_prop_offset(pkg, exp)
    if off is not None:
        try:
            props, end = read_props_ordered(pkg, exp.serial_offset + off)
        except (L2Error, IndexError, struct.error):
            props, end = None, None
        if props and end == end_of \
                and (not want_first or props[0]["name"] in want_first):
            return props
    best = None
    for start in range(max_start):
        try:
            props, end = read_props_ordered(pkg, exp.serial_offset + start)
        except (L2Error, IndexError, struct.error):
            continue
        if not props and end != exp.serial_offset + exp.serial_size:
            continue
        if want_first and (not props or props[0]["name"] not in want_first):
            continue
        if end > exp.serial_offset + exp.serial_size:
            continue
        has_loc = any(p["name"] == "Location" for p in props)
        score = (1 if has_loc else 0, len(props), end - start)
        if best is None or score > best[0]:
            best = (score, props)
        if want_first:
            break
    return best[1] if best else None


def qualified_objref(pkg, reference):
    """Full source identity, including groups; reject broken/cyclic outers."""
    parts, seen, last_import = [], set(), False
    while reference:
        if reference in seen:
            raise L2Error("cyclic object outer chain")
        seen.add(reference)
        obj = pkg.resolve_ref(reference)
        last_import = reference < 0
        parts.append(pkg.import_name(obj) if last_import else pkg.export_name(obj))
        reference = obj.package_index
    if not parts:
        return None
    if not last_import:
        parts.append(Path(pkg.path).stem)
    return ".".join(reversed(parts))


def prop_objref(pkg, raw):
    """Decode an ObjectProperty; retain legacy fields plus qualified identity."""
    ci = Reader(raw).compact()
    if ci == 0:
        return None
    if ci > 0:
        return {"package": None, "class": None,
                "name": pkg.export_name(pkg.exports[ci - 1]),
                "qualified": qualified_objref(pkg, ci)}
    imp = pkg.imports[-ci - 1]
    # walk to the outermost package import
    pkg_name = None
    idx = imp.package_index
    seen = 0
    while idx < 0 and seen < 8:
        outer = pkg.imports[-idx - 1]
        pkg_name = pkg.name(outer.object_name)
        idx = outer.package_index
        seen += 1
    if pkg_name is None:
        pkg_name = pkg.name(imp.class_package) if imp.class_package >= 0 \
            else None
    return {"package": pkg_name, "class": pkg.name(imp.class_name),
            "name": pkg.name(imp.object_name), "qualified": qualified_objref(pkg, ci)}


def prop_float(raw):
    # A few retail actors serialize FloatProperty with a bogus size
    # (e.g. 12 bytes on 4 actors in 23_13); treat those as "use default".
    if len(raw) == 4:
        return struct.unpack("<f", raw)[0]
    if len(raw) == 8:
        return struct.unpack("<d", raw)[0]
    return None


def prop_vector(raw):
    return list(struct.unpack("<3f", raw))


def prop_rotator(raw):
    return list(struct.unpack("<3i", raw))


# ---------------------------------------------------------------------------
# TerrainInfo: layers + terrain transform
# ---------------------------------------------------------------------------

def parse_terrain_layer(pkg, raw, index):
    """A TerrainLayer struct value is a nested packed property list
    (matches the Engine.u script definition, docs/map-format.md §4.1).
    The nested list indexes the outer package's name table."""
    r = Reader(raw)
    layer = {"index": index, "texture": None, "alphamap": None,
             "uscale": 1.0, "vscale": 1.0}
    while True:
        name = pkg.name(r.compact())
        if name == "None":
            break
        info = r.u8()
        ptype = info & 0xF
        sel = (info >> 4) & 7
        is_arr = bool(info & 0x80)
        if ptype == 10:
            pkg.name(r.compact())
        if sel in _SIZE_SEL:
            ds = _SIZE_SEL[sel]
        elif sel == 5:
            ds = r.u8()
        elif sel == 6:
            ds = r.u16()
        else:
            ds = r.u32()
        if ptype != 3 and is_arr:
            b = r.u8()
            if b >= 128:
                if b & 0x40:
                    r.bytes(3)
                else:
                    r.bytes(1)
        val = r.bytes(ds)
        if ptype == 5 and name == "Texture":
            layer["texture"] = prop_objref(pkg, val)
        elif ptype == 5 and name == "AlphaMap":
            layer["alphamap"] = prop_objref(pkg, val)
        elif ptype == 4 and name == "UScale":
            v = prop_float(val)
            if v is not None:
                layer["uscale"] = v
        elif ptype == 4 and name == "VScale":
            v = prop_float(val)
            if v is not None:
                layer["vscale"] = v
    return layer


def is_placeholder(ref):
    """True for dangling refs like Texture.Base / Height.layer0 that point at
    packages the client does not ship (UE built-in defaults)."""
    if ref is None:
        return True
    if ref["package"] in PLACEHOLDER_PACKAGES and ref["package"] != "Height":
        return True
    return False


def read_terrain_info(pkg):
    ti = next((e for e in pkg.exports
               if pkg.class_name_of(e) == "TerrainInfo"), None)
    if ti is None:
        raise L2Error("%s: no TerrainInfo export" % pkg.path)
    props = find_prop_start(pkg, ti, want_first=("TerrainMap",))
    if props is None:
        raise L2Error("%s: TerrainInfo property list not found" % pkg.path)
    info = {"layers": [], "location": [0.0, 0.0, 0.0],
            "scale": [128.0, 128.0, 76.0]}
    for p in props:
        if p["name"] == "Layers" and p["type"] == 10:
            info["layers"].append(
                parse_terrain_layer(pkg, p["raw"], p["index"]))
        elif p["name"] == "Location" and p["type"] == 10:
            info["location"] = prop_vector(p["raw"])
        elif p["name"] == "TerrainScale" and p["type"] == 10:
            info["scale"] = prop_vector(p["raw"])
    info["layers"].sort(key=lambda l: l["index"])
    info["topology"] = terrain_topology.read_bitmaps(props, GRID)
    return info


# ---------------------------------------------------------------------------
# heightmap (G16 texture in T_<tile>.utx; docs/map-format.md §6)
# ---------------------------------------------------------------------------

def find_tile_texture_package(tile):
    for name in ("T_%s.utx" % tile, "t_%s.utx" % tile):
        path = os.path.join(CLIENT, "textures", name)
        if os.path.exists(path):
            return load_package(path)
    raise L2Error("no T_%s.utx in client textures" % tile)


def extract_heightmap(pkg, tile):
    """-> (raw_bytes 256*256*2 LE, texture_name)."""
    best = None
    for e in pkg.exports_by_class("Texture"):
        if pkg.export_name(e).lower() == tile.lower() \
                and e.serial_size >= GRID * GRID * 2:
            best = e
            break
    if best is None:
        for e in pkg.exports_by_class("Texture"):
            try:
                tex = parse_texture(pkg, e)
            except L2Error:
                continue
            if tex.format_name == "G16" and tex.mips \
                    and tex.mips[0].u == GRID and tex.mips[0].v == GRID:
                best = e
                break
    if best is None:
        raise L2Error("%s: no G16 heightmap texture" % pkg.path)
    try:
        tex = parse_texture(pkg, best)
        mip = tex.mips[0]
        if mip.u == GRID and mip.v == GRID \
                and mip.data_size >= GRID * GRID * 2:
            raw = pkg.data[mip.data_offset:mip.data_offset + GRID * GRID * 2]
            return raw, pkg.export_name(best)
    except L2Error:
        pass
    # fallback: marker scan (L2TerrainExtractor trick)
    body = pkg.data[best.serial_offset:best.serial_offset + best.serial_size]
    idx = body.find(G16_MARKER)
    if idx < 0:
        raise L2Error("%s: G16 marker not found" % pkg.path)
    return body[idx + 4:idx + 4 + GRID * GRID * 2], pkg.export_name(best)


def write_gray_png(path, w, h, gray):
    raw = b"".join(b"\x00" + bytes(gray[y * w:(y + 1) * w])
                   for y in range(h))

    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(
            ">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


# ---------------------------------------------------------------------------
# layer textures: splats from the tile package, diffuses from library/utx
# ---------------------------------------------------------------------------

def find_library_png(package, name):
    """Case-insensitive lookup of a pre-exported texture PNG."""
    if not package:
        return None
    want_dir = package.lower()
    want_file = (name + ".png").lower()
    try:
        dirs = os.listdir(LIBRARY)
    except OSError:
        return None
    for d in dirs:
        if d.lower() != want_dir:
            continue
        for f in os.listdir(os.path.join(LIBRARY, d)):
            if f.lower() == want_file:
                return os.path.join(LIBRARY, d, f)
    return None


def decode_utx_texture_png(package, name, out_path):
    """Fallback: decode a texture straight from a client .utx via l2lib."""
    for cand in (package, package.lower(), package.upper()):
        path = os.path.join(CLIENT, "textures", cand + ".utx")
        if os.path.exists(path):
            break
    else:
        return False
    try:
        pkg, _ = load_package(path)
        exp = pkg.find_export(name, cls="Texture")
        if exp is None:
            return False
        w, h, rgba, _ = extract_texture_rgba(pkg, exp)
        write_png(out_path, w, h, rgba)
        return True
    except L2Error:
        return False


def export_tile_splat(tex_pkg, name, out_path):
    """Decode a splat/weight map from the tile's own T package.
    Stored as DXT1 grayscale; write a grayscale PNG (R channel)."""
    exp = tex_pkg.find_export(name, cls="Texture")
    if exp is None:
        return None
    w, h, rgba, _ = extract_texture_rgba(tex_pkg, exp)
    gray = rgba[0::4]
    write_gray_png(out_path, w, h, gray)
    return w, h


# ---------------------------------------------------------------------------
# base-color preview (simplified: nearest-neighbour splat, tiled diffuse)
# ---------------------------------------------------------------------------

def read_png_gray(path):
    """Read back an 8-bit grayscale/RGB(A) PNG (filter 0 or standard) —
    only used on files this tool just wrote (filter 0) and library PNGs are
    not read. Returns (w, h, gray bytes) or None if unsupported."""
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    pos = 8
    w = h = None
    ctype = None
    idat = b""
    while pos < len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype, comp, filt, inter = struct.unpack(
                ">IIBBBBB", body)
            if depth != 8 or inter != 0:
                return None
        elif typ == b"IDAT":
            idat += body
        pos += 12 + ln
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(ctype)
    if channels is None:
        return None
    raw = zlib.decompress(idat)
    stride = w * channels
    recon = bytearray()
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:    # sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif f == 2:  # up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:  # average
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:  # paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        recon += line
        prev = line
    if channels == 1:
        return w, h, bytes(recon)
    gray = bytes(recon[i * channels] for i in range(w * h))
    return w, h, gray


def read_png_rgb(path):
    """Same reader, returns (w, h, rgb bytes)."""
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    pos = 8
    w = h = None
    ctype = None
    idat = b""
    while pos < len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype, comp, filt, inter = struct.unpack(
                ">IIBBBBB", body)
            if depth != 8 or inter != 0:
                return None
        elif typ == b"IDAT":
            idat += body
        pos += 12 + ln
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(ctype)
    if channels is None:
        return None
    raw = zlib.decompress(idat)
    stride = w * channels
    recon = bytearray()
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        recon += line
        prev = line
    out = bytearray(w * h * 3)
    for i in range(w * h):
        o = i * channels
        out[i * 3:i * 3 + 3] = recon[o:o + 3] if channels >= 3 \
            else bytes((recon[o],) * 3)
    return w, h, bytes(out)


def build_basecolor(out_dir, layers, size=512):
    """Simplified terrain color preview: per pixel, sum(weight_i *
    tiled_diffuse_i) / 255. Diffuse tiling repeats every texture width in
    quad units / UScale (approximation of the TerrainMatrix mapping)."""
    imgs = []
    for lay in layers:
        if not lay.get("_diffuse_path") or not lay.get("_splat_path"):
            if lay.get("_diffuse_path") and lay.get("_full_cover"):
                d = read_png_rgb(lay["_diffuse_path"])
                if d:
                    imgs.append((d, None, lay["uscale"]))
            continue
        d = read_png_rgb(lay["_diffuse_path"])
        s = read_png_gray(lay["_splat_path"])
        if d and s:
            imgs.append((d, s, lay["uscale"]))
    if not imgs:
        return None, 0.0
    rgb = bytearray(size * size * 3)
    covered = 0
    for y in range(size):
        for x in range(size):
            r = g = b = 0
            total = 0
            for d, s, us in imgs:
                dw, dh, drgb = d
                # tile the diffuse: one repeat per 8 quads / UScale
                rep = max(1.0, 8.0 / max(us, 1e-3))
                tx = int((x / size * rep % 1.0) * dw) % dw
                ty = int((y / size * rep % 1.0) * dh) % dh
                if s is None:
                    wgt = 255
                else:
                    sw, sh, sgray = s
                    sx = min(sw - 1, x * sw // size)
                    sy = min(sh - 1, y * sh // size)
                    wgt = sgray[sy * sw + sx]
                if wgt:
                    o = (ty * dw + tx) * 3
                    r += drgb[o] * wgt
                    g += drgb[o + 1] * wgt
                    b += drgb[o + 2] * wgt
                    total += wgt
            if total:
                covered += 1
                o = (y * size + x) * 3
                rgb[o] = min(255, r // 255)
                rgb[o + 1] = min(255, g // 255)
                rgb[o + 2] = min(255, b // 255)
    path = os.path.join(out_dir, "basecolor.png")
    rgba = bytearray(size * size * 4)
    rgba[0::4] = rgb[0::3]
    rgba[1::4] = rgb[1::3]
    rgba[2::4] = rgb[2::3]
    rgba[3::4] = b"\xff" * (size * size)
    write_png(path, size, size, bytes(rgba))
    return path, covered * 100.0 / (size * size)


# ---------------------------------------------------------------------------
# props: StaticMeshActor placements + umodel .usx -> glTF conversion
# ---------------------------------------------------------------------------

# Actor classes that place a StaticMesh in the world. Filtering on
# "StaticMeshActor" alone lost 1,202 retail placements world-wide (measured
# over the 100 converted maps): 553 Mover (the clan-hall / castle / dungeon
# DOORS — Door_Set_S.*, drawn closed at their serialized Location, which the
# map also stores as BasePos, i.e. keyframe 0) and 649 MovableStaticMeshActor
# (L2's scripted movers: lifts, rotating machinery; same StaticMesh +
# Location + DrawScale3D fields as a plain StaticMeshActor). Both draw as
# ordinary geometry in retail; neither is animated by this client yet, so
# both are placed statically at their map transform.
STATIC_MESH_ACTOR_CLASSES = ("StaticMeshActor", "MovableStaticMeshActor",
                             "Mover")


def read_static_mesh_actors(pkg):
    actors = []
    for e in pkg.exports:
        if pkg.class_name_of(e) not in STATIC_MESH_ACTOR_CLASSES:
            continue
        props = find_prop_start(pkg, e)
        if not props:
            continue
        entry = {"name": pkg.export_name(e), "mesh": None,
                 "location": None, "rotation": [0, 0, 0],
                 "draw_scale": 1.0, "draw_scale3d": [1.0, 1.0, 1.0]}
        for p in props:
            if p["name"] == "StaticMesh" and p["type"] == 5:
                entry["mesh"] = prop_objref(pkg, p["raw"])
            elif p["name"] == "Location" and p["type"] == 10 \
                    and len(p["raw"]) == 12:
                entry["location"] = prop_vector(p["raw"])
            elif p["name"] == "Rotation" and p["type"] == 10 \
                    and len(p["raw"]) == 12:
                entry["rotation"] = prop_rotator(p["raw"])
            elif p["name"] == "DrawScale" and p["type"] == 4:
                v = prop_float(p["raw"])
                if v is not None:
                    entry["draw_scale"] = v
            elif p["name"] == "DrawScale3D" and p["type"] == 10 \
                    and len(p["raw"]) == 12:
                entry["draw_scale3d"] = prop_vector(p["raw"])
        if entry["mesh"] and entry["location"]:
            actors.append(entry)
    return actors


# ---------------------------------------------------------------------------
# water: WaterVolume brush bounding boxes (there is no FluidSurfaceInfo in
# any of the 100+ retail maps — the client renders the volume's top face)
# ---------------------------------------------------------------------------

# retail WaterSurfaceSet diffuse (FX_E_T.utx Shader WaterShader01 pipeline);
# shipped per-tile next to the layer textures
WATER_TEXTURE = ("FX_E_T", "Water01")
WATER_TEXTURE_DEST = "textures/water01.png"


def _model_bbox(pkg, exp):
    """UPrimitive::Serialize appends FBox + FSphere right after the Model's
    property list (same layout l2lib uses for meshes). -> (min, max)."""
    r = pkg.body_reader(exp)
    read_properties(pkg, r)
    data = r.bytes(41)  # FBox 25B (Min, Max, IsValid) + FSphere 16B
    if len(data) < 41 or data[24] == 0:
        raise L2Error("%s: Model '%s' has no valid bounding box"
                      % (pkg.path, pkg.export_name(exp)))
    return (struct.unpack("<3f", data[0:12]),
            struct.unpack("<3f", data[12:24]))


def _water_actor_props(pkg, exp):
    """Property list of a WaterVolume actor. find_prop_start's first-clean
    parse can stop early on these (misread native header, e.g. 17_25), so
    scan every header offset and prefer a full-length parse that actually
    carries Location + Brush."""
    best = None
    for start in range(25):
        try:
            props, end = read_props_ordered(pkg, exp.serial_offset + start)
        except (L2Error, IndexError, struct.error):
            continue
        if end > exp.serial_offset + exp.serial_size:
            continue
        names = set(p["name"] for p in props)
        if "Location" in names and "Brush" in names:
            if end == exp.serial_offset + exp.serial_size:
                return props
            best = best or props
    return best


def read_water_volumes(pkg):
    """-> [{"height", "rect": [x0, y0, x1, y1]}] in world L2 units.

    Each WaterVolume actor places a Brush (Model) at Location with PrePivot;
    the water surface is the brush bbox top in world space."""
    vols = []
    for e in pkg.exports:
        if pkg.class_name_of(e) != "WaterVolume":
            continue
        props = _water_actor_props(pkg, e)
        if not props:
            continue
        brush = location = prepivot = None
        for p in props:
            if p["name"] == "Brush" and p["type"] == 5:
                brush = prop_objref(pkg, p["raw"])
            elif p["name"] == "Location" and p["type"] == 10 \
                    and len(p["raw"]) == 12:
                location = prop_vector(p["raw"])
            elif p["name"] == "PrePivot" and p["type"] == 10 \
                    and len(p["raw"]) == 12:
                prepivot = prop_vector(p["raw"])
        if not brush or not location:
            continue  # default/leftover actor, no placed volume
        mexp = next((x for x in pkg.exports
                     if pkg.export_name(x) == brush["name"]), None)
        if mexp is None:
            continue
        try:
            mn, mx = _model_bbox(pkg, mexp)
        except L2Error:
            continue
        pp = prepivot or [0.0, 0.0, 0.0]
        wmin = [location[i] + mn[i] - pp[i] for i in range(3)]
        wmax = [location[i] + mx[i] - pp[i] for i in range(3)]
        if wmax[0] - wmin[0] < 1.0 or wmax[1] - wmin[1] < 1.0:
            continue  # degenerate slice, no surface
        vols.append({"height": round(wmax[2], 1),
                     "rect": [round(wmin[0], 1), round(wmin[1], 1),
                              round(wmax[0], 1), round(wmax[1], 1)]})
    return vols


def ship_water_texture(out_dir, water):
    """Copy the retail water diffuse next to the layer textures and wire it
    into every water entry."""
    if not water:
        return
    dst = os.path.join(out_dir, WATER_TEXTURE_DEST)
    if not os.path.exists(dst):
        src = find_library_png(*WATER_TEXTURE)
        if src:
            shutil.copyfile(src, dst)
        elif not decode_utx_texture_png(WATER_TEXTURE[0],
                                        WATER_TEXTURE[1], dst):
            raise L2Error("water texture %s.%s not resolvable"
                          % WATER_TEXTURE)
    for w in water:
        w["texture"] = WATER_TEXTURE_DEST


# ---------------------------------------------------------------------------
# lights: the retail sun, the zone ambient and the distance fog
# ---------------------------------------------------------------------------
# docs/foundation-audit.md F4. The decode lives in `light_extract.py`, whose
# sibling `assets/world/<tile>/light.json` is what `editor/world/js/
# worldlight.js` reads; convert_tile calls it so a re-converted tile can
# never ship a stale light.json. scene.json is a frozen contract and is not
# touched.
#
# NOT decoded by either path, and therefore still an open item: the 91
# `Light` point-light actors per map (1,704 on 23_23), the `NSun` billboard,
# and the per-zone `AmbientVector` list — light_extract.py takes the terrain
# zone only. The client still invents torch lights from a material-name
# regex (FLAME_MAT_RE in terrain.js).

L2_TO_M = 0.01
UE_ROT_TO_RAD = math.pi / 32768.0


def find_usx(package):
    if not package:
        return None
    sm_dir = os.path.join(CLIENT, "staticmeshes")
    want = (package + ".usx").lower()
    try:
        for f in os.listdir(sm_dir):
            if f.lower() == want:
                return os.path.join(sm_dir, f)
    except OSError:
        pass
    return None


def umodel_export_package(usx_path, out_dir):
    """Export a whole .usx package preserving original object groups.
    Returns True on success."""
    argv = [UMODEL, "-export", "-gltf", "-png", "-groups", "-game=l2",
            "-path=" + CLIENT, "-out=" + out_dir, usx_path]
    proc = subprocess.run(argv, capture_output=True, text=True)
    return proc.returncode == 0


def index_export_tree(out_dir):
    """Legacy texture/material basename index; NEVER use for geometry.

    Material/texture group ambiguity remains separate work. Mesh export
    resolution uses _repair_group_index and exact original source identities.
    """
    idx = {}
    for dirpath, _dirs, files in os.walk(out_dir):
        for f in files:
            idx.setdefault(f.lower(), os.path.join(dirpath, f))
    return idx


# ---------------------------------------------------------------------------
# prop glTF: umodel's determinant -1 basis -> the client's determinant +1 one
# ---------------------------------------------------------------------------
# umodel's glTF exporter converts UE space with a SWAP, which is a reflection:
#
#   tools/src/UEViewer/Exporters/ExportGLTF.cpp:59
#       inline void TransformPosition(CVec3& pos)
#       {
#           Exchange(pos[1], pos[2]);   // (x,y,z)_UE -> (x, z, y)   det = -1
#           pos.Scale(0.01f);
#       }
#
# The client places those meshes with `l2ToThree` (editor/world/js/coords.js:17),
# which is the PROPER map (x, y, z)_L2 -> (x, z, -y), det = +1.  The two
# differ by diag(1,1,-1), so every prop was drawn as its own mirror image
# about its pivot.  Proved byte-for-byte against umodel's own psk exporter by
# tools/src/char_pipeline/audit_prop_basis.py (psk is UE space with one
# documented Y mirror, ExportPsk.cpp:21 #define MIRROR_MESH 1):
# Giran_V_Plaza_Wall04 matched (x, z, -y_psk) 54/54 and (x, z, +y_psk) 0/54.
#
# tools/src/char_pipeline/assemble.py:363-382 already documents and applies
# exactly this correction on the character path; this is the world-side
# equivalent, applied as a post-process because umodel writes the glTF.
#
# What has to change, and why:
#   POSITION.z, NORMAL.z          negated  (the axis itself flips)
#   TANGENT.z                     negated  (same)
#   TANGENT.w                     negated  bitangent handedness: with
#       S = diag(1,1,-1) and S orthogonal symmetric,
#       cross(S n, S t) = det(S) * S cross(n, t) = -S cross(n, t),
#       so B' = S B = cross(n', t') * (-w).
#   triangle index order reversed  the correction is det +1, and umodel
#       relied on the reflection to land on glTF's CCW front face
#       (glTF 2.0 3.7.2.1); winding_check.py measured 0/28 inverted faces on
#       the shipped Giran_V_Plaza_Wall04, i.e. the reflected data was CCW.
#   POSITION accessor min.z/max.z  swapped and negated.

_GLTF_BASIS_TAG = "l2ToThree(x,z,-y) det+1"


def _accessor_bytes(g, ai):
    """-> (absolute byte offset, stride, count) for a non-sparse accessor."""
    a = g["accessors"][ai]
    if "sparse" in a:
        raise L2Error("sparse accessor %d not supported" % ai)
    bv = g["bufferViews"][a["bufferView"]]
    comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[
        a["componentType"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    stride = bv.get("byteStride") or comp * ncomp
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return off, stride, a["count"], comp, ncomp


def gltf_to_proper_basis(gltf_path):
    """Rewrite one umodel prop glTF (+ its external .bin) from the reflected
    (x, z, y) basis into the proper (x, z, -y) one.  Idempotent: tagged in
    asset.extras and skipped on a second run.  -> True if it changed."""
    with open(gltf_path) as f:
        g = json.load(f)
    extras = g.setdefault("asset", {}).setdefault("extras", {})
    if extras.get("basis") == _GLTF_BASIS_TAG:
        return False
    # umodel writes one node per mesh with no local TRS; anything else would
    # also have to be conjugated, so refuse rather than silently mis-handle it
    for n in g.get("nodes", []):
        if set(n) & {"matrix", "rotation", "translation", "scale"}:
            raise L2Error("%s: node '%s' has a local transform; the basis "
                          "fix only handles umodel's transform-free nodes"
                          % (gltf_path, n.get("name")))
    bin_path = os.path.join(os.path.dirname(gltf_path),
                            g["buffers"][0]["uri"])
    with open(bin_path, "rb") as f:
        buf = bytearray(f.read())

    def flip(ai, comps):
        off, stride, count, comp, _n = _accessor_bytes(g, ai)
        for k in range(count):
            for c in comps:
                p = off + k * stride + c * comp
                (v,) = struct.unpack_from("<f", buf, p)
                struct.pack_into("<f", buf, p, -v)

    done_attr = set()
    done_idx = set()
    for mesh in g.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:
                raise L2Error("%s: primitive mode %d is not TRIANGLES"
                              % (gltf_path, prim.get("mode")))
            attrs = prim.get("attributes", {})
            for key, comps in (("POSITION", (2,)), ("NORMAL", (2,)),
                               ("TANGENT", (2, 3))):
                ai = attrs.get(key)
                if ai is None or ai in done_attr:
                    continue
                done_attr.add(ai)
                flip(ai, comps)
                if key == "POSITION":
                    a = g["accessors"][ai]
                    if "min" in a and "max" in a:
                        lo, hi = a["min"][2], a["max"][2]
                        a["min"][2], a["max"][2] = -hi, -lo
            ii = prim.get("indices")
            if ii is None or ii in done_idx:
                continue
            done_idx.add(ii)
            off, stride, count, comp, _n = _accessor_bytes(g, ii)
            if count % 3:
                raise L2Error("%s: index count %d is not a multiple of 3"
                              % (gltf_path, count))
            fmt = {1: "<B", 2: "<H", 4: "<I"}[comp]
            for t in range(0, count, 3):
                p1 = off + (t + 1) * stride
                p2 = off + (t + 2) * stride
                (v1,) = struct.unpack_from(fmt, buf, p1)
                (v2,) = struct.unpack_from(fmt, buf, p2)
                struct.pack_into(fmt, buf, p1, v2)
                struct.pack_into(fmt, buf, p2, v1)

    extras["basis"] = _GLTF_BASIS_TAG
    with open(bin_path, "wb") as f:
        f.write(buf)
    with open(gltf_path, "w") as f:
        json.dump(g, f)
    return True


def png_has_significant_alpha(path, threshold=128, min_pct=1):
    """True if the PNG carries real transparency (RGBA with >= min_pct of
    pixels below threshold, or a tRNS chunk).

    NOTE: this is a GUESS about alpha semantics and is no longer used on the
    prop path — see the RetailMaterialIndex block below for why (it cut 209
    prop surfaces away entirely). It survives only as `bsp.py`'s fallback for
    BSP surfaces whose PolyFlags do not carry PF_MASKED; the BSP's primary
    signal is that retail flag, and its walls are deliberately doubleSided.
    """
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return False
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    if b"tRNS" in data:
        return True
    w, h, depth, ctype = struct.unpack(">IIBB", data[16:26])
    if ctype != 6 or depth != 8:
        return False
    pos = 8
    idat = b""
    while pos < len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4])
        if data[pos + 4:pos + 8] == b"IDAT":
            idat += data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
    try:
        raw = zlib.decompress(idat)
    except zlib.error:
        return False
    stride = w * 4
    prev = bytearray(stride)
    p = 0
    n_low = 0
    total = w * h
    for _y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        n_low += sum(1 for a in line[3::4] if a < threshold)
        if n_low * 100 >= min_pct * total:
            return True
        prev = line
    return False


# ---------------------------------------------------------------------------
# prop material render state, read from the retail UE2 material
# ---------------------------------------------------------------------------
# This USED to be guessed: png_has_significant_alpha() marked a material
# `alphaMode MASK, alphaCutoff 0.5, doubleSided true` whenever >=1% of its
# texture's texels had alpha < 128.  In L2 the alpha channel is only a
# coverage mask for alpha-TESTED materials; elsewhere it is a specular or a
# self-illumination mask, so the guess cut 209 surfaces (1,131 placements)
# away completely -- e.g. Giran_wall08_light, an opaque wall with an additive
# window glow whose diffuse alpha peaks at 119/255, below the invented 0.5.
# See docs/foundation-audit.md F3 and tools/src/char_pipeline/audit_prop_materials.py.
#
# The retail data states the render mode exactly.  Every prop material is a
# UE2 `Shader` or a bare `Texture` in a client textures/systextures .utx, and
# the translation below is taken from the reference oracle's own renderer
# (tools/src/UEViewer):
#
#   UShader::SetupGL      Unreal/UnRenderer.cpp:1425-1540
#       TwoSided                -> cull off
#       AlphaTest               -> glAlphaFunc(GL_GREATER, AlphaRef/255)
#       OutputBlending != OB_Normal, or OB_Normal with an Opacity map
#                               -> blending enabled  (line 1510)
#   enum EOutputBlending  Unreal/UnrealMaterial/UnMaterial2.h:570
#       OB_Normal 0, OB_Masked 1, OB_Modulate 2, OB_Translucent 3,
#       OB_Invisible 4, OB_Brighten 5, OB_Darken 6
#   UTexture::SetupGL     Unreal/UnRenderer.cpp:1233-1265
#       bTwoSided                          -> cull off
#       bMasked || (bAlphaTexture && DXT1) -> alpha test GREATER 0.8 + blend
#       bAlphaTexture                      -> alpha test GREATER 0.1 + blend
#       neither                            -> alpha test AND blend disabled
#
# glTF has no "blend and alpha-test" mode, so a blended pass becomes BLEND
# and a pure alpha-tested pass becomes MASK.  The cutoff conversion is exact,
# not a rounding: GL keeps `alpha > ref/255` (i.e. alpha8 >= ref+1) while
# glTF keeps `alpha >= cutoff`, hence cutoff = (AlphaRef + 1) / 255.  With
# AlphaRef absent (UE default 0) that discards exactly the fully-transparent
# texels.  Retail AlphaRef for Interlude foliage is 10 or 30, never 128.
#
# What is deliberately NOT done here (documented gap, not a guess):
#   * SelfIllumination / SelfIlluminationMask shaders are emitted OPAQUE with
#     the correct diffuse.  Their additive emissive pass needs a baked
#     one-channel-to-RGB emissive PNG; until that exists the wall is lit but
#     its window does not glow.
#   * OB_Modulate / OB_Brighten / OB_Darken are all emitted as plain BLEND;
#     glTF 2.0 core has no additive or modulate blend mode.

_UTX_DIRS = ("textures", "systextures")
_UTX_CACHE = os.path.join(OUT_ROOT, ".utx_material_index.json")


def _utx_files():
    out = []
    for d in _UTX_DIRS:
        full = os.path.join(CLIENT, d)
        if not os.path.isdir(full):
            continue
        for f in sorted(os.listdir(full)):
            if f.lower().endswith(".utx"):
                p = os.path.join(full, f)
                out.append((os.path.relpath(p, CLIENT), os.path.getsize(p)))
    return out


class RetailMaterialIndex(object):
    """lowercase export name -> the UE2 material export that defines it.

    Indexing all ~430 client texture packages costs ~80 s, so the name ->
    (package file, export index) map is cached next to the converted world
    (assets/world/.utx_material_index.json) and invalidated by the package
    file list + sizes.  Only the packages actually queried are then loaded.
    """

    def __init__(self):
        self._names = None
        self._pkgs = {}
        self._state = {}

    def _load_index(self):
        if self._names is not None:
            return self._names
        files = _utx_files()
        try:
            with open(_UTX_CACHE) as f:
                cached = json.load(f)
            if cached.get("packages") == [list(x) for x in files]:
                self._names = cached["names"]
                return self._names
        except (OSError, ValueError, KeyError):
            pass
        names = {}
        material = set()
        for rel, _size in files:
            try:
                pkg, _ = load_package(os.path.join(CLIENT, rel))
            except (L2Error, OSError):
                continue
            for i, e in enumerate(pkg.exports):
                key = pkg.export_name(e).lower()
                is_mat = pkg.class_name_of(e) in MATERIAL_CLASSES
                # a MATERIAL always wins a name collision with a non-material
                # export: `frame01` is a StaticMesh in deco01.utx and the
                # Shader the props actually reference in interior_s_t.utx,
                # and plain alphabetical first-wins picked the mesh
                if key not in names or (is_mat and key not in material):
                    names[key] = [rel, i]
                if is_mat:
                    material.add(key)
        try:
            os.makedirs(os.path.dirname(_UTX_CACHE), exist_ok=True)
            with open(_UTX_CACHE, "w") as f:
                json.dump({"packages": files, "names": names}, f)
        except OSError:
            pass
        self._names = names
        return names

    def _package(self, rel):
        if rel not in self._pkgs:
            self._pkgs[rel] = load_package(os.path.join(CLIENT, rel))[0]
        return self._pkgs[rel]

    def state(self, name):
        """-> (alpha_mode, cutoff_or_None, double_sided) for a material name,
        or None when the name is not a retail material (umodel emits
        `dummy_material_N` for mesh sections with no material bound; those
        never get a texture wired either)."""
        key = (name or "").lower()
        if key in self._state:
            return self._state[key]
        ent = self._load_index().get(key)
        res = None
        if ent is not None:
            try:
                res = self._decode(self._package(ent[0]), ent[1])
            except (L2Error, OSError, IndexError, KeyError, struct.error):
                res = None
        self._state[key] = res
        return res

    def _decode(self, pkg, export_index, _depth=0):
        exp = pkg.exports[export_index]
        cls = pkg.class_name_of(exp)
        if cls not in MATERIAL_CLASSES:
            # a name collision with a non-material export (a StaticMesh or a
            # Package export that happens to share the material's name) —
            # refuse rather than read a foreign body as a material
            return None
        props = read_properties(pkg, pkg.body_reader(exp))

        def flag(*keys):
            return any(bool(props.get(k)) for k in keys)

        if cls == "Texture":
            two = flag("bTwoSided")
            fmt = props.get("Format")
            is_dxt1 = isinstance(fmt, (bytes, bytearray)) and fmt \
                and fmt[0] == TEXF_DXT1
            if flag("bMasked") or (flag("bAlphaTexture") and is_dxt1):
                return ("MASK", 0.8, two)          # UnRenderer.cpp:1246
            if flag("bAlphaTexture"):
                return ("BLEND", None, two)        # UnRenderer.cpp:1251,1256
            return ("OPAQUE", None, two)           # UnRenderer.cpp:1261

        two = flag("TwoSided", "TreatAsTwoSided")
        if cls in ("Shader", "FinalBlend"):
            # both classes carry AlphaTest + AlphaRef with the same GL
            # semantics (UnRenderer.cpp:1440 UFinalBlend, and the L2 Shader
            # block); glAlphaFunc(GL_GREATER, ref/255) keeps alpha > ref,
            # glTF MASK keeps alpha >= cutoff, hence (ref + 1) / 255
            if flag("AlphaTest"):
                ref = props.get("AlphaRef")
                ref = ref[0] if isinstance(ref, (bytes, bytearray)) and ref \
                    else 0
                return ("MASK", (ref + 1) / 255.0, two)
            if cls == "FinalBlend":
                # UFinalBlend.FrameBufferBlending, EFrameBufferBlending
                # (UnMaterial2.h:752, :775); FB_Overwrite (0) is the only
                # value that leaves blending off (UnRenderer.cpp:1450)
                fb = props.get("FrameBufferBlending")
                fb = fb[0] if isinstance(fb, (bytes, bytearray)) and fb else 0
                return ("BLEND" if fb != FB_OVERWRITE else "OPAQUE", None, two)
            ob = props.get("OutputBlending")
            ob = ob[0] if isinstance(ob, (bytes, bytearray)) and ob else 0
            if ob != OB_NORMAL or "Opacity" in props:  # UnRenderer.cpp:1510
                return ("BLEND", None, two)
            return ("OPAQUE", None, two)

        # UModifier / UTexModifier (TexPanner, TexOscillator, TexRotator,
        # TexScaler, ColorModifier) and UCombiner only change how the wrapped
        # material is SAMPLED, not how it is blended (UnMaterial2.h:719, :944,
        # :856) — so the render state is the wrapped material's.
        if _depth < 8:
            for key in ("Material", "Material1", "Diffuse"):
                ref = props.get(key)
                if ref is None:
                    continue
                nxt = pkg.resolve_ref(Reader(ref).compact())
                if nxt is None or not hasattr(nxt, "serial_offset"):
                    return None      # import: lives in another package
                try:
                    i = pkg.exports.index(nxt)
                except ValueError:
                    return None
                sub = self._decode(pkg, i, _depth + 1)
                if sub is None:
                    return None
                # the modifier's own TwoSided (L2 adds it) still wins if set
                return (sub[0], sub[1], sub[2] or two)
        return None


# UnMaterial2.h:570 enum EOutputBlending / :752 enum EFrameBufferBlending
# (TEXF_DXT1 comes from l2lib, which carries the same UnMaterial2.h:281
# ETextureFormat table)
OB_NORMAL = 0
FB_OVERWRITE = 0
# UE2 UMaterial subclasses that can legitimately name a mesh section.
# Anything else sharing the name is a collision (a StaticMesh or Package
# export) and must not be read as a material.
MATERIAL_CLASSES = frozenset((
    "Texture", "Shader", "FinalBlend", "Combiner", "Modifier", "TexModifier",
    "TexPanner", "TexOscillator", "TexRotator", "TexScaler", "TexEnvMap",
    "ColorModifier", "FadeColor", "OpacityModifier", "TexCoordSource",
    "FacingShader", "ParticleMaterial", "Cubemap",
))

RETAIL_MATERIALS = RetailMaterialIndex()


class PropTextureResolver(object):
    """Find a PNG for a glTF material name, trying in order:
    1. the PNGs umodel exported next to the meshes,
    2. the pre-exported texture library (assets/library/*/<name>.png),
    3. Shader/FinalBlend materials in the client .utx packages umodel
       pulled in, resolved to their diffuse Texture and decoded via l2lib.
    """

    def __init__(self):
        self.export_index = {}   # lowercase basename -> path (umodel output)
        self.lib_index = None    # lowercase basename -> path (library)
        self.mat_pkgs = {}       # lowercase export name -> (Package, Export)

    def add_export_tree(self, out_dir):
        for k, v in index_export_tree(out_dir).items():
            self.export_index.setdefault(k, v)
        # texture packages umodel pulled in appear as <name>_t/ dirs; index
        # their material exports for shader resolution
        for d in os.listdir(out_dir):
            full = os.path.join(out_dir, d)
            if not os.path.isdir(full):
                continue
            self._index_client_utx(d)

    def _index_client_utx(self, pkg_name):
        tex_dir = os.path.join(CLIENT, "textures")
        for f in os.listdir(tex_dir):
            if f.lower() == (pkg_name + ".utx").lower():
                try:
                    pkg, _ = load_package(os.path.join(tex_dir, f))
                except L2Error:
                    return
                for e in pkg.exports:
                    key = pkg.export_name(e).lower()
                    if key not in self.mat_pkgs:
                        self.mat_pkgs[key] = (pkg, e)
                return

    def _library(self):
        if self.lib_index is None:
            self.lib_index = {}
            for d in os.listdir(LIBRARY):
                full = os.path.join(LIBRARY, d)
                if not os.path.isdir(full):
                    continue
                for f in os.listdir(full):
                    self.lib_index.setdefault(f.lower(),
                                              os.path.join(full, f))
        return self.lib_index

    def find_png(self, name):
        """-> path to a PNG for material `name`, or None."""
        key = (name + ".png").lower()
        src = self.export_index.get(key) or self._library().get(key)
        if src:
            return src
        ent = self.mat_pkgs.get(name.lower())
        if not ent:
            return None
        pkg, exp = ent
        try:
            if pkg.class_name_of(exp) != "Texture":
                exp = resolve_material(pkg, exp)
                if exp is None:
                    return None
            w, h, rgba, _ = extract_texture_rgba(pkg, exp)
        except L2Error:
            return None
        out_dir = os.path.join(tempfile.gettempdir(), "world_resolved_tex")
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, pkg.export_name(exp) + ".png")
        write_png(out, w, h, rgba)
        return out


def patch_gltf_textures(gltf_path, tex_out_dir, rel_prefix, resolver,
                        copied, stats):
    """umodel's UE2 glTF carries material names but no images and no render
    state. Wire each material to a PNG found by the PropTextureResolver, and
    set alphaMode / alphaCutoff / doubleSided from the retail UE2 material
    (RetailMaterialIndex — see the block comment above it)."""
    with open(gltf_path) as f:
        g = json.load(f)
    mats = g.get("materials")
    if not mats:
        return 0
    images = g.setdefault("images", [])
    textures = g.setdefault("textures", [])
    samplers = g.setdefault("samplers", [{}])
    n_wired = 0
    tex_slot = {}
    for m in mats:
        name = m.get("name")
        if not name:
            continue
        key = name.lower()
        if key not in tex_slot:
            src = resolver.find_png(name)
            if not src:
                tex_slot[key] = None
                stats.setdefault("missing", set()).add(name)
                continue
            dst_name = os.path.basename(src)
            dst = os.path.join(tex_out_dir, dst_name)
            if dst_name.lower() not in copied:
                shutil.copyfile(src, dst)
                copied.add(dst_name.lower())
            images.append({"uri": rel_prefix + dst_name})
            textures.append({"source": len(images) - 1, "sampler": 0})
            tex_slot[key] = len(textures) - 1
        slot = tex_slot[key]
        if slot is None:
            continue
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorTexture"] = {"index": slot}
        pbr.pop("baseColorFactor", None)
        state = RETAIL_MATERIALS.state(name)
        if state is None:
            # not a retail material name (umodel dummy_material_N) — but it
            # did resolve to a PNG, so record it instead of guessing a mode
            stats.setdefault("unsourced_state", set()).add(name)
        else:
            mode, cutoff, two_sided = state
            m["alphaMode"] = mode
            if cutoff is None:
                m.pop("alphaCutoff", None)
            else:
                m["alphaCutoff"] = round(cutoff, 6)
            m["doubleSided"] = two_sided
        n_wired += 1
    if n_wired:
        with open(gltf_path, "w") as f:
            json.dump(g, f)
    return n_wired


def _qualified_prop_sources(actors):
    """Resolve each requested identity in its own original StaticMesh package.

    A map may use only one of a package's duplicate leaves. Validate against
    ALL package exports, then select by the entire case-insensitive UE path.
    Unknown references fail rather than substituting another group/package.
    """
    requested, sources = {}, {}
    for actor in actors:
        mesh = actor.get("mesh")
        qualified = mesh.get("qualified") if mesh else None
        parts = qualified.split(".") if isinstance(qualified, str) else []
        if len(parts) < 2 or any(not p or any(c in p for c in "/\\:%?#\0") for p in parts) \
                or not mesh.get("package") \
                or parts[0].casefold() != mesh["package"].casefold() \
                or parts[-1].casefold() != mesh["name"].casefold():
            raise L2Error("missing/invalid qualified prop reference for " + actor["name"])
        requested.setdefault(parts[0].casefold(), {}).setdefault(qualified.casefold(), qualified)
    for package, identities in sorted(requested.items()):
        path = find_usx(package)
        if not path:
            raise L2Error("missing original StaticMesh package " + package)
        pkg = load_package(path)[0]
        exports = {}
        for exp in pkg.exports:
            if pkg.class_name_of(exp) == "StaticMesh":
                key = qualified_objref(pkg, exp.index + 1).casefold()
                exports.setdefault(key, []).append(exp)
        for key, qualified in identities.items():
            matches = exports.get(key, [])
            if len(matches) != 1:
                raise L2Error("missing/ambiguous qualified StaticMesh source " + qualified)
            exp = matches[0]
            sources[key] = {"qualified": qualified, "package": package, "path": path,
                "exportSHA256": hashlib.sha256(pkg.data[exp.serial_offset:
                    exp.serial_offset + exp.serial_size]).hexdigest()}
    return sources


def convert_props(tile, actors, out_dir, sources=None):
    """Qualified source geometry; legacy material/texture resolution unchanged.

    -> (props list for scene.json, stats dict). This is a full props conversion
    and prunes unused top-level meshes; selective live repairs use the separate
    --repair-prop-identities staging/adoption path.
    """
    sources = _qualified_prop_sources(actors) if sources is None else sources
    props_dir = os.path.join(out_dir, "props")
    tex_dir = os.path.join(props_dir, "textures")
    needed = {}  # canonical package -> exact qualified source records
    for key, source in sources.items():
        needed.setdefault(source["package"], {})[key] = source
    # export one umodel pass per available package
    resolved = {}           # qualified identity -> exact grouped export path
    resolver = PropTextureResolver()
    tex_stats = {}
    converted = {}  # qualified identity -> gltf relative path
    tmp = tempfile.mkdtemp(prefix="world_umodel_")
    copied_tex = set()
    try:
        for package in sorted(needed):
            usx = next(iter(needed[package].values()))["path"]
            pdir = os.path.join(tmp, package)
            os.makedirs(pdir)
            if not umodel_export_package(usx, pdir):
                raise L2Error("grouped StaticMesh export failed: " + package)
            idx = _repair_group_index(pdir, ".gltf")
            for key, source in needed[package].items():
                relative = key.replace(".", "/") + ".gltf"
                if relative not in idx:
                    raise L2Error("missing exact grouped mesh export " + source["qualified"])
                # Validate the glTF's actual sibling buffer before output is
                # copied; a same-leaf file in another directory cannot supply it.
                _repair_buffer(idx[relative])
                resolved[key] = idx[relative]
            resolver.add_export_tree(pdir)
        for key, source in sorted(sources.items()):
            os.makedirs(tex_dir, exist_ok=True)
            relative = "props/" + source["qualified"] + ".gltf"
            dst = os.path.join(out_dir, relative)
            _repair_copy_mesh(resolved[key], dst)
            patch_gltf_textures(dst, tex_dir, "textures/",
                                resolver, copied_tex, tex_stats)
            with open(dst) as f:
                gltf = json.load(f)
            gltf.setdefault("asset", {}).setdefault("extras", {}).update(
                sourceMesh=source["qualified"], sourceExportSHA256=source["exportSHA256"])
            with open(dst, "w") as f:
                json.dump(gltf, f)
            converted[key] = relative
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # drop meshes left behind by an earlier conversion of this tile: they are
    # unreachable from scene.json (validate_scene proves every referenced
    # gltf exists), but they still get walked by the audit gates and would
    # report the state of a build that is no longer shipped.
    # (case-insensitively: umodel's own file casing does not always match the
    # StaticMesh name in the map, e.g. R_tombstone01.bin vs R_Tombstone01)
    keep = set(v.lower() for v in converted.values() if v)
    if os.path.isdir(props_dir):
        for fn in sorted(os.listdir(props_dir)):
            if not (fn.endswith(".gltf") or fn.endswith(".bin")):
                continue
            if ("props/" + fn.rsplit(".", 1)[0] + ".gltf").lower() not in keep:
                os.remove(os.path.join(props_dir, fn))
    props = []
    n_ok = 0
    for a in actors:
        m = a["mesh"]
        key = m["qualified"].casefold()
        gltf = converted.get(key)
        if gltf:
            n_ok += 1
        ds = a["draw_scale"]
        d3 = a["draw_scale3d"]
        props.append({
            "mesh": "%s.%s" % (m["package"], m["name"]),
            "sourceMesh": sources[key]["qualified"],
            "gltf": gltf,
            "position": a["location"],
            "rotation": a["rotation"],
            "scale": [ds * d3[0], ds * d3[1], ds * d3[2]],
        })
    stats = {"actors": len(actors),
             "unique_meshes": sum(len(v) for v in needed.values()),
             "converted": n_ok,
             "packages_found": len(needed),
             "packages_total": len(needed),
             "geometry_identity": "original-qualified-export",
             "material_identity": "legacy-leaf-resolution-not-certified-by-geometry-check",
             "missing_textures": sorted(tex_stats.get("missing", ())),
             "unsourced_state": sorted(tex_stats.get("unsourced_state", ()))}
    return props, stats


# ---------------------------------------------------------------------------
# Elbera Tools: bounded qualified-prop repair (separate from full conversion)
# ---------------------------------------------------------------------------

def _repair_require(ok, message):
    if not ok:
        raise L2Error("prop identity repair: " + message)


def _repair_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _repair_count(reader, limit=1000000):
    n = reader.compact()
    _repair_require(0 <= n <= limit, "invalid source array length")
    return n


def _repair_mesh_source(pkg, exp):
    """Independent render prefix for the audited V_Obj_S version 123/23.

    UEViewer UnMesh2.h FStaticMeshSection is <i5H>; ConvertMesh binds section
    i to Materials[i]. The >=17 lazy collision arrays FOLLOW these render
    streams and are deliberately not decoded. No collision faces substituted.
    """
    _repair_require((pkg.file_version, pkg.licensee_version) == (123, 23),
                    "render source version outside audited V_Obj_S 123/23 layout")
    r = pkg.body_reader(exp)
    props = read_properties(pkg, r)
    mr = Reader(props["Materials"])
    materials = [qualified_objref(pkg, Reader(read_properties(pkg, mr)["Material"]).compact())
                 for _ in range(_repair_count(mr))]
    _repair_require(mr.pos == len(mr.data), "trailing source material bytes")
    r.bytes(41)
    sections = [struct.unpack("<i5H", r.bytes(14)) for _ in range(_repair_count(r))]
    r.bytes(25)
    vertices = [struct.unpack("<6f", r.bytes(24))[:3] for _ in range(_repair_count(r))]
    r.i32()
    for _ in range(2):
        r.bytes(_repair_count(r) * 4); r.i32()
    for _ in range(_repair_count(r, 16)):
        r.bytes(_repair_count(r) * 8); r.i32(); r.i32()
    indices = struct.unpack("<%dH" % (n := _repair_count(r)), r.bytes(n * 2))
    _repair_require(vertices and len(sections) == len(materials)
                    and all(math.isfinite(x) for p in vertices for x in p),
                    "invalid source vertices/sections/materials")
    triangles = []
    for section in sections:
        first, faces = section[1], section[5]
        ids = indices[first:first + faces * 3]
        _repair_require(len(ids) == faces * 3 and all(i < len(vertices) for i in ids),
                        "source section index outside stream")
        triangles.append([tuple(vertices[i] for i in ids[t:t+3]) for t in range(0, len(ids), 3)])
    return {"materials": materials, "triangles": triangles,
            "exportSHA256": hashlib.sha256(pkg.data[exp.serial_offset:
                exp.serial_offset + exp.serial_size]).hexdigest()}


def _repair_group_index(root, suffix):
    """Exact exporter relative path -> file; never first basename wins."""
    root = Path(root)
    result = {}
    for path in sorted(root.rglob("*" + suffix)):
        key = path.relative_to(root).as_posix().casefold()
        _repair_require(key not in result, "ambiguous grouped export " + key)
        _repair_require(not path.is_symlink(), "symlink in export tree")
        result[key] = path
    return result


def _repair_buffer(gltf_path):
    g = json.loads(Path(gltf_path).read_text())
    buffers = g.get("buffers", [])
    _repair_require(len(buffers) == 1, "expected one external glTF buffer")
    uri = buffers[0].get("uri")
    _repair_require(isinstance(uri, str) and uri.endswith(".bin")
                    and Path(uri).name == uri and not any(c in uri for c in "\\:%?#"),
                    "buffer must be the glTF's own sibling .bin")
    path = Path(gltf_path).parent / uri
    _repair_require(path.is_file() and not path.is_symlink(), "missing/linked sibling buffer")
    data = path.read_bytes()
    _repair_require(len(data) == buffers[0].get("byteLength"), "buffer length mismatch")
    return g, data


def _repair_verify_geometry(gltf_path, source, proper=False):
    """Compare per-material triangle positions exactly after exporter f32 scale.

    This checks exported pose/identity, not native collision or shader parity.
    UEViewer ExportGltf TransformPosition swaps Y/Z then scales by 0.01f.
    Existing basis correction also negates the exported Z component.
    """
    g, data = _repair_buffer(gltf_path)
    _repair_require(len(g.get("meshes", [])) == 1, "expected one exported mesh")
    primitives = g["meshes"][0].get("primitives", [])
    _repair_require(len(primitives) == len(source["triangles"]), "section count differs")
    f32 = lambda v: struct.unpack("<f", struct.pack("<f", v))[0]
    scale = f32(.01)
    for i, primitive in enumerate(primitives):
        _repair_require(primitive.get("mode", 4) == 4, "non-triangle primitive")
        material = g["materials"][primitive["material"]]["name"]
        _repair_require(material == source["materials"][i].split(".")[-1],
                        "source material section differs")
        def values(index, expected_type, allowed_components):
            a = g["accessors"][index]
            _repair_require(a["type"] == expected_type and a["componentType"] in allowed_components,
                            "unsupported geometry accessor")
            _repair_require(g["bufferViews"][a["bufferView"]].get("buffer", 0) == 0,
                            "foreign accessor buffer")
            off, stride, count, width, components = _accessor_bytes(g, index)
            fmt = "<" + {5123: "H", 5125: "I", 5126: "f"}[a["componentType"]] * components
            _repair_require(off >= 0 and stride >= width * components
                            and (count == 0 or off + (count-1)*stride + width*components <= len(data)),
                            "accessor outside sibling buffer")
            return [struct.unpack_from(fmt, data, off + n*stride) for n in range(count)]
        points = values(primitive["attributes"]["POSITION"], "VEC3", (5126,))
        indices = [x[0] for x in values(primitive["indices"], "SCALAR", (5123, 5125))]
        _repair_require(len(indices) % 3 == 0 and all(n < len(points) for n in indices),
                        "invalid exported triangle indices")
        actual = Counter(tuple(sorted(points[n] for n in indices[t:t+3]))
                         for t in range(0, len(indices), 3))
        def transformed(p):
            return (f32(p[0]*scale), f32(p[2]*scale), f32(p[1]*scale) * (-1 if proper else 1))
        expected = Counter(tuple(sorted(transformed(p) for p in triangle))
                           for triangle in source["triangles"][i])
        _repair_require(actual == expected, "exported positions differ from qualified source section %d" % i)


def _repair_copy_mesh(src, dst):
    g, buffer = _repair_buffer(src)
    dst = Path(dst); dst.parent.mkdir(parents=True, exist_ok=True)
    g["buffers"][0]["uri"] = dst.with_suffix(".bin").name
    dst.with_suffix(".bin").write_bytes(buffer)
    dst.write_text(json.dumps(g))
    gltf_to_proper_basis(str(dst))


def _repair_scene(scene, actors, selected):
    """Match immutable original placement, not a fragile scene array index."""
    result = json.loads(json.dumps(scene))
    matched, used = [], set()
    for actor in actors:
        mesh = actor["mesh"]
        qualified = mesh.get("qualified")
        if qualified not in selected:
            continue
        expected = {"mesh": "%s.%s" % (mesh["package"], mesh["name"]),
                    "position": actor["location"], "rotation": actor["rotation"],
                    "scale": [actor["draw_scale"] * n for n in actor["draw_scale3d"]]}
        matches = [i for i, row in enumerate(scene["props"])
                   if all(row.get(k) == value for k, value in expected.items())]
        _repair_require(len(matches) == 1 and matches[0] not in used,
                        "missing/ambiguous unchanged actor " + actor["name"])
        index = matches[0]; used.add(index)
        _repair_require(scene["props"][index].get("sourceMesh", qualified) == qualified,
                        "conflicting existing sourceMesh for " + actor["name"])
        result["props"][index].update(sourceMesh=qualified, gltf="props/" + qualified + ".gltf")
        matched.append({"actor": actor["name"], "sourceMesh": qualified, "sceneIndex": index})
    _repair_require({row["sourceMesh"] for row in matched} == set(selected),
                    "every selected identity must have an unchanged scene placement")
    return result, matched


def _repair_adoption_plan(live, staged):
    """No mutation: preflight every generated path and refuse byte conflicts."""
    live, staged = Path(live).resolve(), Path(staged).resolve()
    plan = []
    for source in sorted((staged / "props").rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(staged)
        target = live / relative
        _repair_require(not any(p.is_symlink() for p in [source, *source.parents] if p.is_relative_to(staged))
                        and not any(p.is_symlink() for p in [target, *target.parents] if p.is_relative_to(live)),
                        "symlink in adoption path")
        if target.exists():
            _repair_require(source.read_bytes() == target.read_bytes(),
                            "existing asset byte conflict: " + relative.as_posix())
        plan.append((source, target))
    return plan


def _repair_adopt(live, staged, backup, original_scene, source_hashes):
    """New unique files first, atomic scene replacement last; rollback on error."""
    live, staged, backup = Path(live).resolve(), Path(staged).resolve(), Path(backup).resolve()
    plan = _repair_adoption_plan(live, staged)
    scene = live / "scene.json"
    _repair_require(scene.read_bytes() == original_scene, "scene changed during staging")
    for path, digest in source_hashes.items():
        _repair_require(_repair_hash(path) == digest, "source changed during staging: " + str(path))
    backup.mkdir(parents=True, exist_ok=False)
    (backup / "scene.json").write_bytes(original_scene)
    # Old, now-unreferenced leaf meshes remain in place. No cleanup of a subset.
    manifest = {"sceneSHA256": hashlib.sha256(original_scene).hexdigest(),
                "newFiles": [str(t.relative_to(live)) for _, t in plan if not t.exists()]}
    (backup / "manifest.json").write_text(json.dumps(manifest, indent=2))
    created = []
    pending_scene = None
    try:
        for source, target in plan:
            if target.exists():
                _repair_require(source.read_bytes() == target.read_bytes(), "asset changed during adoption")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as out:
                created.append(target); out.write(source.read_bytes())
        validate_scene(json.loads((staged / "scene.json").read_text()), str(live))
        _repair_require(scene.read_bytes() == original_scene, "scene changed before adoption")
        with tempfile.NamedTemporaryFile(dir=live, prefix=".prop-repair-", delete=False) as out:
            pending_scene = Path(out.name); out.write((staged / "scene.json").read_bytes())
        os.replace(pending_scene, scene)
        pending_scene = None
    except BaseException:
        if pending_scene is not None:
            pending_scene.unlink(missing_ok=True)
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise


def repair_prop_identities(tile, selected, emit=False, stage=None):
    """Stage exactly selected qualified meshes; current material domain V_Obj_T.

    This deliberately does not invoke convert_tile/convert_props, regenerate
    terrain, prune live props, or claim complete native material parity.
    """
    _repair_require(len(tile.split("_")) == 2 and all(p.isdigit() for p in tile.split("_")), "invalid tile")
    _repair_require(selected and len(selected) == len(set(selected)), "empty/duplicate selection")
    for name in selected:
        _repair_require(len(name.split(".")) >= 3 and all(part and all(c.isascii() and (c.isalnum() or c == "_")
                        for c in part) for part in name.split(".")), "invalid qualified mesh " + name)
        _repair_require(name.split(".")[0] == "V_Obj_S", "only audited V_Obj_S inputs supported")
    live = Path(OUT_ROOT) / tile
    original_scene = (live / "scene.json").read_bytes()
    scene = json.loads(original_scene)
    validate_scene(scene, str(live))
    map_path = Path(CLIENT) / "maps" / (tile + ".unr")
    map_pkg = load_package(str(map_path))[0]
    candidate, actors = _repair_scene(scene, read_static_mesh_actors(map_pkg), selected)
    mesh_file = find_usx("V_Obj_S")
    _repair_require(mesh_file is not None, "missing original V_Obj_S package")
    mesh_path = Path(mesh_file)
    texture_path = Path(CLIENT) / "textures" / "V_Obj_T.utx"
    mesh_pkg, texture_pkg = load_package(str(mesh_path))[0], load_package(str(texture_path))[0]
    source_hashes = {str(p): _repair_hash(p) for p in (map_path, mesh_path, texture_path, Path(UMODEL))}
    meshes, textures = {}, {}
    for name in selected:
        matches = [e for e in mesh_pkg.exports if mesh_pkg.class_name_of(e) == "StaticMesh"
                   and qualified_objref(mesh_pkg, e.index+1).casefold() == name.casefold()]
        _repair_require(len(matches) == 1, "missing/ambiguous original mesh " + name)
        meshes[name] = _repair_mesh_source(mesh_pkg, matches[0])
        for material in meshes[name]["materials"]:
            _repair_require(material and material.split(".")[0] == "V_Obj_T", "material outside V_Obj_T")
            leaf = material.split(".")[-1]
            matches = [e for e in texture_pkg.exports if texture_pkg.export_name(e).casefold() == leaf.casefold()]
            _repair_require(len(matches) == 1 and qualified_objref(texture_pkg, matches[0].index+1) == material
                            and texture_pkg.class_name_of(matches[0]) == "Texture",
                            "material must resolve uniquely to an original V_Obj_T Texture: " + material)
            textures[material] = matches[0]
    private = Path(ROOT) / "tmp" / "restart-audit"
    private.mkdir(parents=True, exist_ok=True)
    if stage is None:
        stage = Path(tempfile.mkdtemp(prefix="prop-identity-" + tile + "-", dir=private))
    else:
        stage = Path(stage).resolve()
        _repair_require(stage.is_relative_to(private.resolve()) and stage != private.resolve(),
                        "staging must stay under ignored tmp/restart-audit")
        stage.mkdir(parents=True, exist_ok=False)
    raw, staged = stage / "raw", stage / "candidate"
    raw.mkdir(); (staged / "props" / "textures").mkdir(parents=True)
    argv = [UMODEL, "-export", "-gltf", "-png", "-groups", "-game=l2",
            "-path=" + CLIENT, "-out=" + str(raw)]
    for package, names, log_name in (
            (mesh_path, selected, "export.log"),
            (texture_path, textures, "texture-export.log")):
        args = argv + ["-obj=" + leaf for leaf in sorted({s.split(".")[-1] for s in names})]
        proc = subprocess.run(args + [str(package)], capture_output=True, text=True)
        (stage / log_name).write_text(proc.stdout + proc.stderr)
        _repair_require(proc.returncode == 0, "grouped export failed; see " + str(stage / log_name))
    mesh_index, png_index = _repair_group_index(raw, ".gltf"), _repair_group_index(raw, ".png")
    state_decoder = RetailMaterialIndex()
    texture_files = {}
    for material, exp in textures.items():
        key = material.replace(".", "/").casefold() + ".png"
        _repair_require(key in png_index, "missing qualified texture export " + material)
        destination = staged / "props" / "textures" / (texture_pkg.export_name(exp) + ".png")
        shutil.copyfile(png_index[key], destination)
        texture_files[material] = destination.name
    for name, source in meshes.items():
        key = name.replace(".", "/").casefold() + ".gltf"
        _repair_require(key in mesh_index, "missing qualified mesh export " + name)
        src, dst = mesh_index[key], staged / "props" / (name + ".gltf")
        _repair_verify_geometry(src, source)
        _repair_copy_mesh(src, dst)
        _repair_verify_geometry(dst, source, proper=True)
        g = json.loads(dst.read_text())
        g.setdefault("asset", {}).setdefault("extras", {}).update(
            sourceMesh=name, sourceExportSHA256=source["exportSHA256"])
        g["images"], g["textures"], g["samplers"] = [], [], [{}]
        for i, material in enumerate(source["materials"]):
            g["images"].append({"uri": "textures/" + texture_files[material]})
            g["textures"].append({"source": i, "sampler": 0})
            m = g["materials"][g["meshes"][0]["primitives"][i]["material"]]
            pbr = m.setdefault("pbrMetallicRoughness", {})
            pbr["baseColorTexture"] = {"index": i}; pbr.pop("baseColorFactor", None)
            state = state_decoder._decode(texture_pkg, textures[material].index)
            _repair_require(state is not None, "unresolved original material state " + material)
            m["alphaMode"], cutoff, m["doubleSided"] = state
            m.pop("alphaCutoff", None)
            if cutoff is not None: m["alphaCutoff"] = round(cutoff, 6)
        dst.write_text(json.dumps(g))
    (staged / "scene.json").write_text(json.dumps(candidate, indent=1))
    _repair_adoption_plan(live, staged)
    # Original scene was validated before staging. Its only changed fields
    # are checked new glTF paths/source IDs; full validation also runs before
    # atomic adoption with both old and new files present.
    for name in selected:
        g, _ = _repair_buffer(staged / "props" / (name + ".gltf"))
        for entry in g["images"]:
            _repair_require((staged / "props" / entry["uri"]).is_file(), "missing staged texture")
    for path, digest in source_hashes.items():
        _repair_require(_repair_hash(path) == digest, "source changed during staging: " + path)
    report = {"tool": "Elbera Tools", "operation": "qualified-prop-repair", "tile": tile,
              "emitted": False, "stage": str(stage), "sources": source_hashes,
              "originalSceneSHA256": hashlib.sha256(original_scene).hexdigest(),
              "selected": list(selected), "actors": actors,
              "meshes": {name: {"exportSHA256": source["exportSHA256"],
                  "triangles": sum(map(len, source["triangles"])), "materials": source["materials"]}
                  for name, source in meshes.items()},
              "files": {str(p.relative_to(staged)): _repair_hash(p) for p in staged.rglob("*") if p.is_file()}}
    if emit:
        _repair_adopt(live, staged, stage / "backup", original_scene, source_hashes)
        report["emitted"] = True
    (stage / "receipt.json").write_text(json.dumps(report, indent=2))
    return report


# ---------------------------------------------------------------------------
# scene assembly + contract validation
# ---------------------------------------------------------------------------

def validate_scene(scene, out_dir):
    """Check the frozen contract (tools/world/README.md). Raises on error."""
    errs = []
    def need(cond, msg):
        if not cond:
            errs.append(msg)
        return cond
    need(scene.get("tile") and isinstance(scene["tile"], str), "tile str")
    need(isinstance(scene.get("origin"), list)
         and len(scene["origin"]) == 3
         and all(isinstance(v, (int, float)) for v in scene["origin"]),
         "origin [x0,y0,z0]")
    need(scene.get("gridSize") == 256, "gridSize 256")
    need(scene.get("spacing") == 128, "spacing 128")
    need(abs(scene.get("heightScale", 0) - 0.296875) < 1e-9,
         "heightScale 0.296875")
    need(scene.get("heightmap") == "heightmap.u16", "heightmap key")
    need(scene.get("heights") == "heightmap.png", "heights key")
    need(isinstance(scene.get("layers"), list), "layers list")
    for i, lay in enumerate(scene.get("layers", [])):
        need(isinstance(lay.get("name"), str), "layer %d name" % i)
        need(lay.get("diffuse") is None
             or (isinstance(lay["diffuse"], str)
                 and lay["diffuse"].startswith("textures/")),
             "layer %d diffuse" % i)
        need(lay.get("splat") is None
             or (isinstance(lay["splat"], str)
                 and lay["splat"].startswith("textures/")),
             "layer %d splat" % i)
    need("water" in scene, "water key")
    need(scene["water"] is None or isinstance(scene["water"], list),
         "water null or list")
    for i, w in enumerate(scene["water"] or []):
        need(isinstance(w.get("height"), (int, float)), "water %d height" % i)
        need(isinstance(w.get("rect"), list) and len(w["rect"]) == 4
             and all(isinstance(v, (int, float)) for v in w["rect"])
             and w["rect"][2] > w["rect"][0] and w["rect"][3] > w["rect"][1],
             "water %d rect" % i)
        need(isinstance(w.get("texture"), str)
             and w["texture"].startswith("textures/"),
             "water %d texture" % i)
    need("interior" not in scene or scene["interior"] is True,
         "interior must be exactly true when present")
    if "topology" in scene:
        need(scene["topology"] == terrain_topology.FILENAME,
             "terrain topology pointer")
        topology_path = os.path.join(out_dir, terrain_topology.FILENAME)
        if need(os.path.exists(topology_path), "missing terrain-topology.json"):
            try:
                with open(topology_path) as f:
                    topology = json.load(f)
                terrain_topology.validate(topology, scene.get("gridSize"))
            except (OSError, ValueError, L2Error) as exc:
                need(False, "invalid terrain topology: %s" % exc)
    if "terrainEdges" in scene:
        need(scene["terrainEdges"] == terrain_edges.FILENAME,
             "terrain edges pointer")
        edges_path = os.path.join(out_dir, terrain_edges.FILENAME)
        if need(os.path.exists(edges_path), "missing terrain-edges.json"):
            try:
                with open(edges_path) as f:
                    edges = json.load(f)
                terrain_edges.validate(edges, scene)
            except (OSError, ValueError, L2Error) as exc:
                need(False, "invalid terrain edges: %s" % exc)
    # optional geodata pointer (FROZEN contract, tools/world/README.md)
    if "geodata" in scene:
        need(scene["geodata"] == "geodata.json", "geodata pointer")
        gpath = os.path.join(out_dir, "geodata.json")
        if need(os.path.exists(gpath), "missing geodata.json"):
            try:
                with open(gpath) as f:
                    g = json.load(f)
                need(g.get("cellSize") == 16, "geodata cellSize 16")
                need(g.get("origin") == scene["origin"][:2],
                     "geodata origin matches scene origin")
                need(g.get("cells") == 2048, "geodata cells 2048")
                lay = (g.get("layers") or [{}])[0]
                need(lay.get("encoding") == "blockstream-v1",
                     "geodata encoding")
                bpath = os.path.join(out_dir, lay.get("data", ""))
                need(os.path.exists(bpath), "missing geodata.bin")
                if os.path.exists(bpath):
                    need(os.path.getsize(bpath) == lay.get("bytes"),
                         "geodata.bin byte count")
            except (OSError, ValueError) as exc:
                need(False, "geodata.json unreadable: %s" % exc)
    need(isinstance(scene.get("props"), list), "props list")
    for i, p in enumerate(scene.get("props", [])):
        need(isinstance(p.get("mesh"), str) and "." in p["mesh"],
             "prop %d mesh" % i)
        need(p.get("gltf") is None
             or (isinstance(p["gltf"], str)
                 and p["gltf"].startswith("props/")
                 and p["gltf"].endswith(".gltf")), "prop %d gltf" % i)
        for k in ("position", "rotation", "scale"):
            need(isinstance(p.get(k), list) and len(p[k]) == 3
                 and all(isinstance(v, (int, float)) for v in p[k]),
                 "prop %d %s" % (i, k))
    # referenced files must exist
    for rel in [scene.get("heightmap"), scene.get("heights")]:
        if rel:
            need(os.path.exists(os.path.join(out_dir, rel)),
                 "missing " + rel)
    for lay in scene.get("layers", []):
        for k in ("diffuse", "splat"):
            if lay.get(k):
                need(os.path.exists(os.path.join(out_dir, lay[k])),
                     "missing " + lay[k])
    seen_gltf = set()
    for p in scene.get("props", []):
        rel = p.get("gltf")
        if not rel or rel in seen_gltf:
            continue
        seen_gltf.add(rel)
        path = os.path.join(out_dir, rel)
        if not need(os.path.exists(path), "missing " + rel):
            continue
        # a prop glTF is useless without its external buffer and images;
        # nothing else checks them, and the props/ prune could in principle
        # take a .bin whose casing differs from its .gltf
        try:
            with open(path) as f:
                gl = json.load(f)
        except (OSError, ValueError) as exc:
            need(False, "%s unreadable: %s" % (rel, exc))
            continue
        base = os.path.dirname(path)
        for entry in list(gl.get("buffers", [])) + list(gl.get("images", [])):
            uri = entry.get("uri")
            if uri and not uri.startswith("data:"):
                need(os.path.exists(os.path.join(base, uri)),
                     "%s references missing %s" % (rel, uri))
    for w in scene.get("water") or []:
        if w.get("texture"):
            need(os.path.exists(os.path.join(out_dir, w["texture"])),
                 "missing " + w["texture"])
    if errs:
        raise L2Error("scene contract violations:\n  " + "\n  ".join(errs))


def convert_tile(tile, with_props=True):
    tx, ty = (int(v) for v in tile.split("_"))
    map_path = os.path.join(CLIENT, "maps", tile + ".unr")
    mpkg, _ = load_package(map_path)
    actors, prop_sources = [], None
    if with_props:
        # Before ANY output mutation, including terrain: a full conversion
        # must bind each reference to the exact original group and package.
        actors = read_static_mesh_actors(mpkg)
        prop_sources = _qualified_prop_sources(actors)
    out_dir = os.path.join(OUT_ROOT, tile)
    os.makedirs(out_dir, exist_ok=True)
    tex_out = os.path.join(out_dir, "textures")
    os.makedirs(tex_out, exist_ok=True)

    tinfo = read_terrain_info(mpkg)
    locz = tinfo["location"][2]
    scale = tinfo["scale"]
    height_scale = scale[2] / 256.0
    corner = [(tx - 20) * 32768.0, (ty - 18) * 32768.0]

    # heightmap
    tpkg, _ = find_tile_texture_package(tile)
    raw, htex = extract_heightmap(tpkg, tile)
    with open(os.path.join(out_dir, "heightmap.u16"), "wb") as f:
        f.write(raw)
    hvals = array.array("H")
    hvals.frombytes(raw)
    lo, hi = min(hvals), max(hvals)
    rng = max(1, hi - lo)
    write_gray_png(os.path.join(out_dir, "heightmap.png"), GRID, GRID,
                   [(v - lo) * 255 // rng for v in hvals])
    z_min = locz + (lo - 32768) * height_scale
    z_max = locz + (hi - 32768) * height_scale

    # layers
    layers = []
    for lay in tinfo["layers"]:
        tex = lay["texture"]
        amap = lay["alphamap"]
        if tex is None and amap is None:
            continue  # unused slot
        if tex is not None and is_placeholder(tex) \
                and (amap is None or is_placeholder(amap)):
            continue  # fully placeholder layer (e.g. Texture.Base/layer0)
        entry = {"name": None, "diffuse": None, "splat": None,
                 "uscale": lay["uscale"], "vscale": lay["vscale"],
                 "_full_cover": False}
        if tex is not None and not is_placeholder(tex):
            entry["name"] = "%s.%s" % (tex["package"], tex["name"])
            src = find_library_png(tex["package"], tex["name"])
            dst_name = tex["name"] + ".png"
            dst = os.path.join(tex_out, dst_name)
            if src:
                shutil.copyfile(src, dst)
            elif not decode_utx_texture_png(tex["package"], tex["name"],
                                            dst):
                dst = None
            if dst:
                entry["diffuse"] = "textures/" + dst_name
                entry["_diffuse_path"] = dst
        else:
            entry["name"] = "layer%d" % lay["index"]
        if amap is not None and not is_placeholder(amap):
            dst_name = amap["name"] + ".png"
            dst = os.path.join(tex_out, dst_name)
            dims = export_tile_splat(tpkg, amap["name"], dst)
            if dims is None:
                src = find_library_png("T_" + tile, amap["name"]) or \
                    find_library_png("t_" + tile, amap["name"])
                if src:
                    shutil.copyfile(src, dst)
                    dims = True
            if dims:
                entry["splat"] = "textures/" + dst_name
                entry["_splat_path"] = dst
        # a layer with a real diffuse but no resolvable alphamap is the
        # UE2 base layer: full weight (255) over the whole tile
        if entry["diffuse"] and not entry["splat"]:
            entry["_full_cover"] = True
        if entry["diffuse"] or entry["splat"]:
            layers.append(entry)

    base_path, coverage = build_basecolor(out_dir, layers)

    # props
    props = []
    pstats = {"actors": 0, "converted": 0, "packages_found": 0,
              "packages_total": 0, "unique_meshes": 0,
              "missing_textures": [], "unsourced_state": []}
    if with_props:
        props, pstats = convert_props(tile, actors, out_dir, prop_sources)

    # water volumes (WaterVolume brush tops; null when the tile has none)
    water = read_water_volumes(mpkg)
    ship_water_texture(out_dir, water)

    # retail sun / zone ambient / distance fog -> sibling light.json
    lights = light_extract.write(tile, verbose=False)

    scene = {
        "tile": tile,
        "origin": [corner[0], corner[1], locz],
        "gridSize": GRID,
        "spacing": int(SPACING),
        "heightScale": height_scale,
        "heightmap": "heightmap.u16",
        "heights": "heightmap.png",
        "layers": [{"name": lay["name"], "diffuse": lay["diffuse"],
                    "splat": lay["splat"]} for lay in layers],
        "water": water or None,
        "props": props,
    }
    if tile in INTERIOR_TILES:
        # sanity-check the listing against the data (flat dummy terrain,
        # props far below it) so the explicit list cannot silently rot
        relief = z_max - z_min
        pz = [p["position"][2] for p in props]
        n_deep = sum(1 for z in pz if z < z_min - 500)
        if relief > 5.0 or (pz and n_deep * 100 // len(pz) < 95):
            raise L2Error(
                "%s listed as interior but data disagrees (relief %.1f, "
                "%d/%d props deep) — re-verify INTERIOR_TILES"
                % (tile, relief, n_deep, len(pz)))
        scene["interior"] = True
    # per-tile geodata (true ground heights, multi-level floors) — written
    # before scene.json so validate_scene can check the files exist
    if geodata.write_tile_geodata(tile, out_dir) is not None:
        scene["geodata"] = "geodata.json"
    terrain_topology.write(tinfo["topology"], GRID, map_path,
                           "assets/interlude/maps/%s.unr" % tile, out_dir,
                           source_package=mpkg)
    scene["topology"] = terrain_topology.FILENAME
    terrain_edges.write(tile, out_dir, scene)
    scene["terrainEdges"] = terrain_edges.FILENAME
    validate_scene(scene, out_dir)
    with open(os.path.join(out_dir, "scene.json"), "w") as f:
        json.dump(scene, f, indent=1)
    return {
        "tile": tile, "height_tex": htex, "z_range": (z_min, z_max),
        "raw_range": (lo, hi), "layers": len(layers),
        "layer_details": [(l["name"], bool(l["diffuse"]), bool(l["splat"]))
                          for l in layers],
        "coverage": coverage, "props": pstats,
        "lights": lights,
        "out": out_dir,
    }


def check_tile(tile):
    out_dir = os.path.join(OUT_ROOT, tile)
    with open(os.path.join(out_dir, "scene.json")) as f:
        scene = json.load(f)
    validate_scene(scene, out_dir)
    print("%s: scene.json OK (%d layers, %d props)" %
          (tile, len(scene["layers"]), len(scene["props"])))


def update_tile_topology(tile):
    """Preserve source masks in an existing scene without regenerating assets.

    Only terrain-topology.json and its scene.json pointer are written. Raw
    heightmaps, corrected runtime heights, props and textures are untouched.
    Complete, matching native sector evidence marks ordinary-quad visibility
    as verified for this map; otherwise its interpretation stays unverified.
    Native diagonal and boundary rules remain unknown in either case.
    """
    out_dir = os.path.join(OUT_ROOT, tile)
    scene_path = os.path.join(out_dir, "scene.json")
    with open(scene_path) as f:
        scene = json.load(f)
    if scene.get("tile") != tile:
        raise L2Error("scene tile does not match requested source map: " + tile)
    # A missing/outdated topology sidecar is precisely what this operation
    # repairs. Validate every other scene reference before replacing it.
    prior_scene = dict(scene)
    prior_scene.pop("topology", None)
    validate_scene(prior_scene, out_dir)
    map_path = os.path.join(CLIENT, "maps", tile + ".unr")
    mpkg, _ = load_package(map_path)
    tinfo = read_terrain_info(mpkg)
    record = terrain_topology.write(
        tinfo["topology"], scene["gridSize"], map_path,
        "assets/interlude/maps/%s.unr" % tile, out_dir,
        source_package=mpkg)
    scene["topology"] = terrain_topology.FILENAME
    validate_scene(scene, out_dir)
    terrain_topology.write_json(scene_path, scene)
    return record


def update_tile_edges(tile):
    """Add adjacent native edge samples without regenerating other assets."""
    out_dir = os.path.join(OUT_ROOT, tile)
    scene_path = os.path.join(out_dir, "scene.json")
    with open(scene_path) as f:
        scene = json.load(f)
    if scene.get("tile") != tile:
        raise L2Error("scene tile does not match requested source map: " + tile)
    prior_scene = dict(scene)
    prior_scene.pop("terrainEdges", None)
    validate_scene(prior_scene, out_dir)
    record = terrain_edges.build(tile)
    terrain_edges.validate(record, scene)
    with open(os.path.join(out_dir, scene["heightmap"]), "rb") as f:
        current_hash = hashlib.sha256(f.read()).hexdigest()
    if current_hash != record["provenance"]["center"]["extractedHeightSHA256"]:
        raise L2Error("scene heightmap differs from original source: " + tile)
    terrain_topology.write_json(os.path.join(out_dir, terrain_edges.FILENAME), record)
    scene["terrainEdges"] = terrain_edges.FILENAME
    validate_scene(scene, out_dir)
    terrain_topology.write_json(scene_path, scene)
    return record


def update_tile_materials(tile):
    """Re-apply the retail render state to every already-converted prop glTF
    of a tile, without the slow umodel pass.

    Same operation patch_gltf_textures performs at conversion time, split out
    so a change to the material decode can be rolled over the converted world
    in seconds per tile instead of ~30 s. Touches only alphaMode /
    alphaCutoff / doubleSided; geometry, textures and scene.json are not
    read or written. -> (materials updated, materials with no retail state).
    """
    props_dir = os.path.join(OUT_ROOT, tile, "props")
    n_set = 0
    unsourced = set()
    if not os.path.isdir(props_dir):
        return 0, unsourced
    for fn in sorted(os.listdir(props_dir)):
        if not fn.endswith(".gltf"):
            continue
        path = os.path.join(props_dir, fn)
        with open(path) as f:
            g = json.load(f)
        dirty = False
        for m in g.get("materials", []):
            if m.get("pbrMetallicRoughness", {}).get("baseColorTexture") \
                    is None:
                continue
            state = RETAIL_MATERIALS.state(m.get("name") or "")
            if state is None:
                unsourced.add(m.get("name"))
                continue
            mode, cutoff, two = state
            cut = None if cutoff is None else round(cutoff, 6)
            if (m.get("alphaMode", "OPAQUE"), m.get("alphaCutoff"),
                    bool(m.get("doubleSided"))) == (mode, cut, two):
                continue
            m["alphaMode"] = mode
            if cut is None:
                m.pop("alphaCutoff", None)
            else:
                m["alphaCutoff"] = cut
            m["doubleSided"] = two
            n_set += 1
            dirty = True
        if dirty:
            with open(path, "w") as f:
                json.dump(g, f)
    return n_set, unsourced


def update_tile_water(tile):
    """Recompute only the water key of an existing scene.json (the rest of
    the conversion — heightmap, layers, props — is untouched)."""
    out_dir = os.path.join(OUT_ROOT, tile)
    scene_path = os.path.join(out_dir, "scene.json")
    with open(scene_path) as f:
        scene = json.load(f)
    mpkg, _ = load_package(os.path.join(CLIENT, "maps", tile + ".unr"))
    water = read_water_volumes(mpkg)
    ship_water_texture(out_dir, water)
    scene["water"] = water or None
    validate_scene(scene, out_dir)
    with open(scene_path, "w") as f:
        json.dump(scene, f, indent=1)
    return len(water)


def main(argv):
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--check":
        for tile in args[1:]:
            check_tile(tile)
        return 0
    if args[0] == "--repair-prop-identities":
        parser = argparse.ArgumentParser(description="Elbera Tools: stage selected qualified props; no full conversion")
        parser.add_argument("tile")
        parser.add_argument("--mesh", action="append", required=True, help="exact Package.Group.Mesh (repeatable)")
        parser.add_argument("--stage", help="new directory under ignored tmp/restart-audit")
        parser.add_argument("--emit", action="store_true", help="back up and adopt validated files and scene")
        options = parser.parse_args(args[1:])
        report = repair_prop_identities(options.tile, options.mesh, options.emit, options.stage)
        print("%s: %d qualified meshes, %d actors, %s; receipt %s/receipt.json" % (
            options.tile, len(report["selected"]), len(report["actors"]),
            "adopted with backup" if report["emitted"] else "staged only", report["stage"]))
        return 0
    if args[0] == "--edges-only":
        if len(args) == 1:
            raise L2Error("--edges-only requires at least one tile")
        for tile in args[1:]:
            record = update_tile_edges(tile)
            print("%s: native edge sources %s" % (tile, ", ".join(
                key for key in terrain_edges.DIRECTIONS if record[key] is not None)))
        return 0
    if args[0] == "--topology-only":
        if len(args) == 1:
            raise L2Error("--topology-only requires at least one tile")
        for tile in args[1:]:
            record = update_tile_topology(tile)
            print("%s: preserved %d topology arrays; %s"
                  % (tile, len(record["bitmaps"]), record["conventions"]["status"]))
        return 0
    if args[0] == "--materials-only":
        # re-apply the retail material render state to already-converted
        # prop glTFs (see update_tile_materials)
        total = 0
        miss = set()
        for tile in args[1:]:
            n, un = update_tile_materials(tile)
            miss |= un
            total += n
            print("%s: %d material(s) updated" % (tile, n))
        print("total %d updated, %d name(s) with no retail material state"
              % (total, len(miss)))
        if miss:
            print("  " + ", ".join(sorted(miss)[:20]))
        return 0
    if args[0] == "--water-only":
        # patch just the water key of already-converted tiles (skips the
        # slow umodel prop pass); used when the water extraction was added
        # after the initial 100-tile conversion
        for tile in args[1:]:
            n = update_tile_water(tile)
            print("%s: %d water volume(s)" % (tile, n))
        return 0
    for tile in args:
        res = convert_tile(tile)
        print("%s: height %s raw %d..%d -> z %.1f..%.1f" %
              (tile, res["height_tex"], res["raw_range"][0],
               res["raw_range"][1], res["z_range"][0], res["z_range"][1]))
        for name, has_d, has_s in res["layer_details"]:
            print("   layer %-24s diffuse=%s splat=%s" %
                  (name, has_d, has_s))
        print("   basecolor coverage %.1f%%" % res["coverage"])
        ps = res["props"]
        print("   props: %d actors, %d/%d packages found, %d placed gltf, "
              "%d unwired materials, %d unsourced material states"
              % (ps["actors"], ps["packages_found"], ps["packages_total"],
                 ps["converted"], len(ps.get("missing_textures", [])),
                 len(ps.get("unsourced_state", []))))
        lg = res["lights"] or {}
        print("   lights: sun=%s ambient=%s fog=%s"
              % (bool(lg.get("sun")), bool(lg.get("ambient")),
                 (lg.get("fog") or {}).get("end")))
        print("   -> %s" % res["out"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
