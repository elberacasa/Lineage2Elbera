#!/usr/bin/env python3
"""unrmap - extract asset references and terrain geometry from L2 Interlude maps.

Commands:
    refs <map.unr> [...]     Write tools/maps/maps/<tile>.refs.json: the full
                             map->asset manifest (textures, static meshes,
                             sounds, packages) + StaticMeshActor placements.
    terrain <tile> [...]     Decode the G16 heightmap from textures/T_<tile>.utx
                             (falling back to any T_<tile>.utx in the client):
                             writes tools/maps/out/<tile>.heightmap.{u16,png,json}
                             where the JSON holds a world-space vertex grid.

Heightmap lore (verified against 4 tiles, see docs/map-format.md):
  - The .unr TerrainInfo has a TerrainMap object property pointing at a
    texture named <tile> inside a package called "Height". That package is
    not shipped; instead each tile's textures/T_<tile>.utx contains a
    Texture export named <tile> in G16 format (256x256 u16).
  - The texture body is v123-native (no standard tagged props); the G16
    pixel block is located via the 4-byte marker 00 40 80 10 that precedes
    the 131072-byte mip payload (same trick as the L2TerrainExtractor tool).
  - worldZ(x,y) = TerrainInfo.Location.Z + (h[x,y] - 32768) * TerrainScale.Z / 256
    (validated against the union of TerrainSector bounding boxes).
  - worldX/worldY: tile (tx,ty) corner = ((tx-20)*32768, (ty-18)*32768);
    sample spacing = 128 (TerrainScale.X/Y), 256x256 samples.
"""

import array
import json
import os
import struct
import sys
import zlib

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(TOOLS, "utx"))
import utxedit  # noqa: E402
from unrparse import load_map  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "interlude"))
G16_MARKER = b"\x00\x40\x80\x10"

SIZE_SEL = {0: 1, 1: 2, 2: 4, 3: 12, 4: 16}


# ---------------------------------------------------------------------------
# generic tagged-property reader (UE1/UE2 style, works at a known offset)
# ---------------------------------------------------------------------------

def read_props(pkg, exp, start):
    """Parse the tagged property list of an export starting at +start.
    Returns (props, end_rel_offset). Values are decoded for common types."""
    r = utxedit.Reader(pkg.data, exp.serial_offset + start)
    props = []
    while True:
        ni = r.compact()
        name = pkg.name(ni)
        if name == "None":
            break
        info = r.u8()
        ptype = info & 0xF
        sel = (info >> 4) & 7
        is_array = bool(info & 0x80)
        sname = None
        if ptype == 10:
            sname = pkg.name(r.compact())
        if sel in SIZE_SEL:
            ds = SIZE_SEL[sel]
        elif sel == 5:
            ds = r.u8()
        elif sel == 6:
            ds = r.u16()
        else:
            ds = r.u32()
        aidx = 0
        if ptype != 3 and is_array:
            b = r.u8()
            if b < 128:
                aidx = b
            elif b & 0x40:
                r.u8(); r.u8(); r.u8()
            else:
                r.u8()
        begin = r.pos
        raw = pkg.data[begin:begin + ds]
        value = None
        if ptype == 3:
            value = is_array  # bool lives in the array flag
        elif ptype == 2 and ds == 4:
            value = struct.unpack("<i", raw)[0]
        elif ptype == 4 and ds == 4:
            value = struct.unpack("<f", raw)[0]
        elif ptype == 1 and ds == 1:
            value = raw[0]
        elif ptype == 5:
            rr = utxedit.Reader(raw)
            value = ("objref", rr.compact())
        elif ptype == 10 and ds == 12 and sname == "Vector":
            value = struct.unpack("<3f", raw)
        elif ptype == 10 and ds == 12 and sname == "Rotator":
            value = struct.unpack("<3i", raw)
        elif ptype == 13:
            value = ("str", ds)
        elif ptype == 9:
            value = ("array", ds)
        elif ptype == 10:
            value = ("struct", sname, ds)
        r.pos = begin + ds
        props.append(dict(name=name, type=ptype, size=ds, struct=sname,
                          index=aidx, value=value))
    return props, r.pos - exp.serial_offset


def find_prop_offset(pkg, exp, want_first=None, max_start=25):
    """Locate the property list start by scanning candidate offsets."""
    for start in range(0, max_start):
        try:
            props, rel = read_props(pkg, exp, start)
        except (IndexError, utxedit.UtxError):
            continue
        if not props and rel != exp.serial_size:
            continue
        if want_first and (not props or props[0]["name"] not in want_first):
            continue
        # sanity: props must end inside the export
        if rel > exp.serial_size:
            continue
        return start, props, rel
    return None


def outer_package(pkg, imp):
    """Resolve an import's outer Package name (the .utx/.usx file it lives in)
    by walking the package_index chain to the top-level Package import."""
    chain = []
    idx = imp.package_index
    seen = 0
    while idx < 0 and seen < 8:
        outer = pkg.imports[-idx - 1]
        chain.append(pkg.name(outer.object_name))
        idx = outer.package_index
        seen += 1
    return chain[0] if chain else None


def objref_name(pkg, idx):
    if idx == 0:
        return None
    if idx > 0:
        return {"export": pkg.export_name(pkg.exports[idx - 1])}
    imp = pkg.imports[-idx - 1]
    return {"package": outer_package(pkg, imp) or pkg.name(imp.class_package),
            "class": pkg.name(imp.class_name),
            "name": pkg.name(imp.object_name)}


# ---------------------------------------------------------------------------
# refs command
# ---------------------------------------------------------------------------

def cmd_refs(paths):
    os.makedirs(os.path.join(HERE, "maps"), exist_ok=True)
    for path in paths:
        pkg, protocol = load_map(path)
        tile = os.path.splitext(os.path.basename(path))[0]
        out = {"tile": tile, "protocol": protocol,
               "package_version": pkg.file_version,
               "licensee_version": pkg.licensee_version,
               "counts": {"names": len(pkg.names), "imports": len(pkg.imports),
                          "exports": len(pkg.exports)},
               "imports": [], "terrain_layers": [],
               "static_mesh_actors": []}
        for imp in pkg.imports:
            out["imports"].append({
                "package": outer_package(pkg, imp) or pkg.name(imp.class_package),
                "class": pkg.name(imp.class_name),
                "name": pkg.name(imp.object_name)})
        # terrain layers (texture references per layer)
        ti = next((e for e in pkg.exports
                   if pkg.class_name_of(e) == "TerrainInfo"), None)
        if ti is not None:
            found = find_prop_offset(pkg, ti, want_first=("TerrainMap",))
            if found:
                _, props, _ = found
                for p in props:
                    if p["name"] == "TerrainMap" and p["type"] == 5:
                        out["terrain_map_ref"] = objref_name(pkg, p["value"][1])
                    if p["name"] == "Layers" and p["type"] == 10:
                        # nested property list inside the TerrainLayer struct
                        sub = utxedit.Reader(pkg.data, 0)
                        raw_off = None
                    if p["name"] == "Location" and p["type"] == 10:
                        out["terrain_location"] = p["value"]
                    if p["name"] == "TerrainScale":
                        out["terrain_scale"] = p["value"]
        # static mesh actors: props hold StaticMesh ref + placement
        n_sma = 0
        for e in pkg.exports:
            if pkg.class_name_of(e) != "StaticMeshActor":
                continue
            found = find_prop_offset(pkg, e, max_start=25)
            if not found:
                continue
            _, props, _ = found
            entry = {"name": pkg.export_name(e)}
            for p in props:
                if p["name"] == "StaticMesh" and p["type"] == 5:
                    entry["mesh"] = objref_name(pkg, p["value"][1])
                elif p["name"] == "Location" and p["type"] == 10:
                    entry["location"] = p["value"]
                elif p["name"] == "Rotation" and p["type"] == 10:
                    entry["rotation"] = p["value"]
                elif p["name"] == "DrawScale" and p["type"] == 4:
                    entry["draw_scale"] = p["value"]
            if "mesh" in entry:
                out["static_mesh_actors"].append(entry)
                n_sma += 1
        # terrain layer texture refs from layer structs (raw scan of the
        # struct bodies for object references to imports of class Texture)
        out_path = os.path.join(HERE, "maps", tile + ".refs.json")
        with open(out_path, "w") as f:
            json.dump(out, f, indent=1)
        print("%s: %d imports, %d static-mesh actors -> %s"
              % (tile, len(out["imports"]), n_sma, out_path))


# ---------------------------------------------------------------------------
# terrain command
# ---------------------------------------------------------------------------

def find_height_texture(tile):
    """Locate the tile's G16 heightmap texture inside T_<tile>.utx."""
    cand = os.path.join(CLIENT, "textures", "T_%s.utx" % tile)
    if not os.path.exists(cand):
        cand = os.path.join(CLIENT, "textures", "t_%s.utx" % tile)
    if not os.path.exists(cand):
        return None, None, None
    pkg, protocol = load_map(cand)
    best = None
    for e in pkg.exports:
        if pkg.class_name_of(e) != "Texture":
            continue
        if e.serial_size >= 131072 + 32 and pkg.export_name(e) == tile:
            best = e
            break
    if best is None:
        # fall back: any Texture export with a plausible G16 payload
        for e in pkg.exports:
            if pkg.class_name_of(e) == "Texture" and \
               131072 <= e.serial_size - 80 <= 131072 + 512:
                best = e
                break
    return pkg, best, cand


def write_png(path, w, h, gray):
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


def cmd_terrain(tiles):
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    for tile in tiles:
        pkg, exp, src = find_height_texture(tile)
        if exp is None:
            print("%s: no height texture found" % tile)
            continue
        body = pkg.data[exp.serial_offset:exp.serial_offset + exp.serial_size]
        idx = body.find(G16_MARKER)
        if idx < 0:
            print("%s: G16 marker not found" % tile)
            continue
        raw = body[idx + 4:idx + 4 + 256 * 256 * 2]
        hvals = array.array("H")
        hvals.frombytes(raw)
        # TerrainInfo.Location.Z / TerrainScale from the map
        locz, scale = 0.0, (128.0, 128.0, 76.0)
        mpath = os.path.join(CLIENT, "maps", "%s.unr" % tile)
        if os.path.exists(mpath):
            mpkg, _ = load_map(mpath)
            ti = next((e for e in mpkg.exports
                       if mpkg.class_name_of(e) == "TerrainInfo"), None)
            if ti is not None:
                found = find_prop_offset(mpkg, ti, want_first=("TerrainMap",))
                if found:
                    for p in found[1]:
                        if p["name"] == "Location" and p["type"] == 10:
                            locz = p["value"][2]
                        elif p["name"] == "TerrainScale" and p["type"] == 10:
                            scale = p["value"]
        tx, ty = (int(v) for v in tile.split("_"))
        corner_x = (tx - 20) * 32768.0
        corner_y = (ty - 18) * 32768.0
        zs = [locz + (v - 32768) * scale[2] / 256.0 for v in hvals]
        # raw .u16 dump
        raw_path = os.path.join(HERE, "out", "%s.heightmap.u16" % tile)
        with open(raw_path, "wb") as f:
            f.write(raw)
        # PNG (min-max normalized)
        lo, hi = min(hvals), max(hvals)
        rng = max(1, hi - lo)
        gray = [(v - lo) * 255 // rng for v in hvals]
        png_path = os.path.join(HERE, "out", "%s.heightmap.png" % tile)
        write_png(png_path, 256, 256, gray)
        # vertex-grid JSON (world space)
        grid = {
            "tile": tile, "size": 256, "source": os.path.basename(src),
            "corner": [corner_x, corner_y], "spacing": [scale[0], scale[1]],
            "z_formula": "locz + (h-32768)*scalez/256",
            "locz": locz, "scalez": scale[2],
            "raw_min": lo, "raw_max": hi,
            "z_min": min(zs), "z_max": max(zs),
            "heights_raw": list(hvals),
        }
        json_path = os.path.join(HERE, "out", "%s.heightmap.json" % tile)
        with open(json_path, "w") as f:
            json.dump(grid, f)
        print("%s: raw %d..%d -> z %.1f..%.1f  (%s, %s, %s)"
              % (tile, lo, hi, min(zs), max(zs),
                 os.path.basename(raw_path), os.path.basename(png_path),
                 os.path.basename(json_path)))


def main(argv):
    if len(argv) < 3 or argv[1] not in ("refs", "terrain"):
        print(__doc__)
        return 1
    if argv[1] == "refs":
        cmd_refs(argv[2:])
    else:
        cmd_terrain(argv[2:])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
