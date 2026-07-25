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
    assets/world/<tile>/heightmap.png          (min-max normalized preview)
    assets/world/<tile>/basecolor.png          (splat-blended preview, simplified)
    assets/world/<tile>/textures/*.png         (layer diffuses + splat maps)
    assets/world/<tile>/props/*.gltf|bin       (converted static meshes)
    assets/world/<tile>/props/textures/*.png   (prop textures referenced by gltf)

Usage:
    python3 tools/world/convert.py 17_23 [19_22 ...]   # convert tiles
    python3 tools/world/convert.py --check 17_23 ...   # validate scene.json

Everything is stdlib Python + l2lib (tools/l2lib) + tools/bin/umodel.
Format lore: docs/map-format.md. See tools/world/README.md for what is exact
vs simplified.
"""

import array
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from l2lib import (L2Error, Reader, load_package, parse_texture,  # noqa: E402
                   extract_texture_rgba, resolve_material, write_png)

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


def find_prop_start(pkg, exp, want_first=None, max_start=25):
    """Map actor bodies have a 15- or 17-byte native header before the
    property list (docs/map-format.md §3.1); scan for the clean parse."""
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
        return props
    return None


def prop_objref(pkg, raw):
    """Decode an ObjectProperty value -> {'package','class','name'} | None."""
    ci = Reader(raw).compact()
    if ci == 0:
        return None
    if ci > 0:
        return {"package": None, "class": None,
                "name": pkg.export_name(pkg.exports[ci - 1])}
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
            "name": pkg.name(imp.object_name)}


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

def read_static_mesh_actors(pkg):
    actors = []
    for e in pkg.exports:
        if pkg.class_name_of(e) != "StaticMeshActor":
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
    """Export a whole .usx package to glTF+PNG with umodel.
    Returns True on success."""
    argv = [UMODEL, "-export", "-gltf", "-png", "-game=l2",
            "-path=" + CLIENT, "-out=" + out_dir, usx_path]
    proc = subprocess.run(argv, capture_output=True, text=True)
    return proc.returncode == 0


def index_export_tree(out_dir):
    """Map lowercase basename -> full path for everything umodel wrote."""
    idx = {}
    for dirpath, _dirs, files in os.walk(out_dir):
        for f in files:
            idx.setdefault(f.lower(), os.path.join(dirpath, f))
    return idx


def png_has_significant_alpha(path, threshold=128, min_pct=1):
    """True if the PNG carries real transparency (RGBA with >= min_pct of
    pixels below threshold, or a tRNS chunk). Used to mark glTF materials
    alphaMode MASK (foliage, fences) — without it three.js renders the
    transparent background as opaque white."""
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
    """umodel's UE2 glTF carries material names but no images. Wire each
    material to a PNG found by the PropTextureResolver."""
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
    alpha_cache = {}
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
            if dst_name.lower() not in alpha_cache:
                alpha_cache[dst_name.lower()] = png_has_significant_alpha(dst)
            images.append({"uri": rel_prefix + dst_name})
            textures.append({"source": len(images) - 1, "sampler": 0})
            tex_slot[key] = (len(textures) - 1, alpha_cache[dst_name.lower()])
        slot = tex_slot[key]
        if slot is None:
            continue
        slot, has_alpha = slot
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorTexture"] = {"index": slot}
        pbr.pop("baseColorFactor", None)
        if has_alpha:
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.5
            m["doubleSided"] = True
        n_wired += 1
    if n_wired:
        with open(gltf_path, "w") as f:
            json.dump(g, f)
    return n_wired


def convert_props(tile, actors, out_dir):
    """-> (props list for scene.json, stats dict)."""
    props_dir = os.path.join(out_dir, "props")
    tex_dir = os.path.join(props_dir, "textures")
    needed = {}  # package -> set(mesh names)
    for a in actors:
        m = a["mesh"]
        if m and m.get("package"):
            needed.setdefault(m["package"], set()).add(m["name"])
    # export one umodel pass per available package
    export_index = {}       # global fallback: lowercase basename -> path
    pkg_indices = {}        # package -> per-package index (preferred)
    resolver = PropTextureResolver()
    tex_stats = {}
    converted = {}  # (package, mesh) -> gltf relative path | None
    tmp = tempfile.mkdtemp(prefix="world_umodel_")
    copied_tex = set()
    used_names = {}
    try:
        for package in sorted(needed):
            usx = find_usx(package)
            if not usx:
                continue
            pdir = os.path.join(tmp, package)
            os.makedirs(pdir)
            if not umodel_export_package(usx, pdir):
                continue
            idx = index_export_tree(pdir)
            pkg_indices[package.lower()] = idx
            for k, v in idx.items():
                export_index.setdefault(k, v)
            resolver.add_export_tree(pdir)
        for package in sorted(needed):
            pindex = pkg_indices.get(package.lower(), {})
            for mesh in sorted(needed[package]):
                src = pindex.get((mesh + ".gltf").lower()) or \
                    export_index.get((mesh + ".gltf").lower())
                if not src:
                    converted[(package, mesh)] = None
                    continue
                os.makedirs(props_dir, exist_ok=True)
                os.makedirs(tex_dir, exist_ok=True)
                base = mesh
                if base.lower() in used_names and \
                        used_names[base.lower()] != package.lower():
                    base = package + "." + mesh
                used_names[base.lower()] = package.lower()
                dst = os.path.join(props_dir, base + ".gltf")
                shutil.copyfile(src, dst)
                binsrc = pindex.get((mesh + ".bin").lower()) or \
                    export_index.get((mesh + ".bin").lower())
                if binsrc:
                    shutil.copyfile(binsrc,
                                    os.path.join(props_dir, base + ".bin"))
                patch_gltf_textures(dst, tex_dir, "textures/",
                                    resolver, copied_tex, tex_stats)
                converted[(package, mesh)] = "props/" + base + ".gltf"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    props = []
    n_ok = 0
    for a in actors:
        m = a["mesh"]
        key = (m["package"], m["name"])
        gltf = converted.get(key)
        if gltf:
            n_ok += 1
        ds = a["draw_scale"]
        d3 = a["draw_scale3d"]
        props.append({
            "mesh": "%s.%s" % (m["package"], m["name"]),
            "gltf": gltf,
            "position": a["location"],
            "rotation": a["rotation"],
            "scale": [ds * d3[0], ds * d3[1], ds * d3[2]],
        })
    stats = {"actors": len(actors),
             "unique_meshes": sum(len(v) for v in needed.values()),
             "converted": n_ok,
             "packages_found": sum(1 for p in needed if find_usx(p)),
             "packages_total": len(needed),
             "missing_textures": sorted(tex_stats.get("missing", ()))}
    return props, stats


# ---------------------------------------------------------------------------
# scene assembly + contract validation
# ---------------------------------------------------------------------------

def validate_scene(scene, out_dir):
    """Check the frozen contract (tools/world/README.md). Raises on error."""
    errs = []
    def need(cond, msg):
        if not cond:
            errs.append(msg)
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
    for p in scene.get("props", []):
        if p.get("gltf"):
            need(os.path.exists(os.path.join(out_dir, p["gltf"])),
                 "missing " + p["gltf"])
    if errs:
        raise L2Error("scene contract violations:\n  " + "\n  ".join(errs))


def convert_tile(tile, with_props=True):
    tx, ty = (int(v) for v in tile.split("_"))
    out_dir = os.path.join(OUT_ROOT, tile)
    os.makedirs(out_dir, exist_ok=True)
    tex_out = os.path.join(out_dir, "textures")
    os.makedirs(tex_out, exist_ok=True)

    map_path = os.path.join(CLIENT, "maps", tile + ".unr")
    mpkg, _ = load_package(map_path)
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
              "missing_textures": []}
    if with_props:
        actors = read_static_mesh_actors(mpkg)
        props, pstats = convert_props(tile, actors, out_dir)

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
        "water": None,
        "props": props,
    }
    validate_scene(scene, out_dir)
    with open(os.path.join(out_dir, "scene.json"), "w") as f:
        json.dump(scene, f, indent=1)
    return {
        "tile": tile, "height_tex": htex, "z_range": (z_min, z_max),
        "raw_range": (lo, hi), "layers": len(layers),
        "layer_details": [(l["name"], bool(l["diffuse"]), bool(l["splat"]))
                          for l in layers],
        "coverage": coverage, "props": pstats,
        "out": out_dir,
    }


def check_tile(tile):
    out_dir = os.path.join(OUT_ROOT, tile)
    with open(os.path.join(out_dir, "scene.json")) as f:
        scene = json.load(f)
    validate_scene(scene, out_dir)
    print("%s: scene.json OK (%d layers, %d props)" %
          (tile, len(scene["layers"]), len(scene["props"])))


def main(argv):
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--check":
        for tile in args[1:]:
            check_tile(tile)
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
              "%d unwired materials"
              % (ps["actors"], ps["packages_found"], ps["packages_total"],
                 ps["converted"], len(ps.get("missing_textures", []))))
        print("   -> %s" % res["out"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
