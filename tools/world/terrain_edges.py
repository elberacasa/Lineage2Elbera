"""Adjacent original G16 samples for terrain boundaries, in L2 world Z.

This preserves row/column 255 at its source coordinate and supplies separate
samples at coordinate 256. Exact saved FCoords heights are separately gated
by native engine identity and original sector bounds. Missing neighbor sources
remain null; the complete native streaming behavior is not reproduced here.
"""

import hashlib
import math
import os
import re
import struct

from l2lib import L2Error

FORMAT = "l2-terrain-edges-v1"
FILENAME = "terrain-edges.json"
GRID = 256
SPACING = 128
EXTENT = GRID * SPACING
DIRECTIONS = {"east": (1, 0), "south": (0, 1), "southeast": (1, 1)}


def _require(condition, message):
    if not condition:
        raise L2Error("terrain edges: " + message)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _tile_origin(tile):
    _require(isinstance(tile, str) and re.fullmatch(r"\d+_\d+", tile),
             "invalid source tile name")
    tx, ty = map(int, tile.split("_"))
    return [(tx - 20) * EXTENT, (ty - 18) * EXTENT]


def load_source(tile):
    """Read native TerrainInfo/G16; None only when a source file is absent."""
    # Delayed import keeps convert -> terrain_edges free of an import cycle.
    import convert as conversion
    _tile_origin(tile)
    map_path = os.path.join(conversion.CLIENT, "maps", tile + ".unr")
    textures = [os.path.join(conversion.CLIENT, "textures", prefix + tile + ".utx")
                for prefix in ("T_", "t_")]
    texture_path = next((p for p in textures if os.path.isfile(p)), None)
    if not os.path.isfile(map_path) or texture_path is None:
        return None
    package, _ = conversion.load_package(map_path)
    info = conversion.read_terrain_info(package)
    texture, _ = conversion.load_package(texture_path)
    raw, texture_name = conversion.extract_heightmap(texture, tile)
    terrain = next(e for e in package.exports if package.class_name_of(e) == "TerrainInfo")
    properties = conversion.find_prop_start(package, terrain, want_first=("TerrainMap",))
    reference = conversion.prop_objref(package, next(p["raw"] for p in properties if p["name"] == "TerrainMap"))
    _require(reference is not None and reference["class"] == "Texture"
             and reference["package"].lower() == os.path.splitext(os.path.basename(texture_path))[0].lower()
             and reference["name"].lower() == texture_name.lower(),
             tile + " extracted G16 is not the declared TerrainMap")
    _require(len(raw) == GRID * GRID * 2, tile + " G16 byte count")
    location, scale = info["location"], info["scale"]
    _require(len(location) == len(scale) == 3
             and all(_number(v) for v in location + scale),
             tile + " invalid native transform")
    _require(scale[:2] == [SPACING, SPACING], tile + " unsupported native XY spacing")
    origin = [location[0] - EXTENT / 2, location[1] - EXTENT / 2, location[2]]
    _require(origin[:2] == _tile_origin(tile), tile + " native origin is not on its tile")
    _require(scale[2] > 0, tile + " invalid native height scale")
    with open(map_path, "rb") as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
        source_hash = digest.hexdigest()
    return {"tile": tile, "origin": origin, "spacing": SPACING,
            "heightScale": scale[2] / 256,
            "rawMapSHA256": source_hash,
            "extractedHeightSHA256": hashlib.sha256(raw).hexdigest(),
            "heightmap": raw,
            "heightTransform": conversion.terrain_topology.native_height_transform(
                package, raw, origin, SPACING, scale[2] / 256)}


def _metadata(source):
    result = {key: source[key] for key in ("tile", "rawMapSHA256",
            "extractedHeightSHA256", "origin", "spacing", "heightScale")}
    if source.get("heightTransform") is not None:
        result["heightTransform"] = source["heightTransform"]
    return result


def world_height(source, height):
    """Exact saved native Z coordinates when verified; prior path otherwise."""
    transform = source.get("heightTransform")
    if transform is not None:
        from terrain_topology import float32
        return float32((height - transform["origin"][2]) * transform["axes"][2][2])
    return source["origin"][2] + (height - 32768) * source["heightScale"]


def edge_values_sha256(value):
    """SHA-256 of ordered world-Z values as IEEE-754 float64 little-endian.

    East/south encode their 256 values; southeast encodes one value. The
    numeric encoding is independent of JSON whitespace or int/float spelling.
    """
    values = value if isinstance(value, list) else [value]
    _require(all(_number(v) for v in values), "invalid edge values for hashing")
    return hashlib.sha256(struct.pack("<%dd" % len(values), *values)).hexdigest()


def build(tile, source_loader=None):
    """Source-loader injection allows synthetic tests without retail assets."""
    loader = source_loader or load_source
    center = loader(tile)
    _require(center is not None, "missing center source: " + tile)
    _require(center["tile"] == tile, "center source tile differs")
    tx, ty = map(int, tile.split("_"))
    result = {"format": FORMAT, "tile": tile, "gridSize": GRID,
              "origin": list(center["origin"]), "spacing": SPACING,
              "provenance": {"center": _metadata(center)}}
    for direction, (dx, dy) in DIRECTIONS.items():
        name = "%d_%d" % (tx + dx, ty + dy)
        source = loader(name)
        result[direction] = None
        result["provenance"][direction] = None
        if source is None:
            continue
        _require(source["tile"] == name, direction + " source tile differs")
        raw = source["heightmap"]
        _require(len(raw) == GRID * GRID * 2, name + " G16 byte count")
        def world_z(index):
            height = struct.unpack_from("<H", raw, index * 2)[0]
            return world_height(source, height)
        if direction == "east":
            result[direction] = [world_z(y * GRID) for y in range(GRID)]
        elif direction == "south":
            result[direction] = [world_z(x) for x in range(GRID)]
        else:
            result[direction] = world_z(0)
        result["provenance"][direction] = _metadata(source)
        result["provenance"][direction]["edgeValuesSHA256"] = edge_values_sha256(result[direction])
    validate(result)
    return result


def validate(record, scene=None):
    _require(isinstance(record, dict) and record.get("format") == FORMAT, "unknown format")
    tile = record.get("tile")
    corner = _tile_origin(tile)
    _require(record.get("gridSize") == GRID and record.get("spacing") == SPACING,
             "unsupported grid or spacing")
    origin = record.get("origin")
    _require(isinstance(origin, list) and len(origin) == 3
             and all(_number(v) for v in origin) and origin[:2] == corner,
             "invalid center origin")
    provenance = record.get("provenance")
    _require(isinstance(provenance, dict)
             and set(provenance) == {"center", *DIRECTIONS}, "invalid provenance")
    _require(all(key in record for key in DIRECTIONS), "missing edge fields")
    tx, ty = map(int, tile.split("_"))
    for key, offset in {"center": (0, 0), **DIRECTIONS}.items():
        meta = provenance[key]
        if key != "center":
            value = record.get(key)
            _require((value is None) == (meta is None), key + " missing source/value mismatch")
            if meta is None:
                continue
            if key == "southeast":
                _require(_number(value), "invalid southeast height")
            else:
                _require(isinstance(value, list) and len(value) == GRID
                         and all(_number(v) for v in value), "invalid " + key + " heights")
        expected_tile = "%d_%d" % (tx + offset[0], ty + offset[1])
        _require(isinstance(meta, dict) and meta.get("tile") == expected_tile,
                 key + " source tile mismatch")
        source_origin = meta.get("origin")
        _require(isinstance(source_origin, list) and len(source_origin) == 3
                 and all(_number(v) for v in source_origin)
                 and source_origin[:2] == _tile_origin(expected_tile),
                 key + " source origin is not adjacent")
        _require(meta.get("spacing") == SPACING and _number(meta.get("heightScale"))
                 and meta["heightScale"] > 0, key + " invalid source scale")
        digests = ("rawMapSHA256", "extractedHeightSHA256")
        if key != "center":
            digests += ("edgeValuesSHA256",)
        for digest in digests:
            _require(isinstance(meta.get(digest), str)
                     and re.fullmatch(r"[0-9a-f]{64}", meta[digest]), key + " invalid " + digest)
        if meta.get("heightTransform") is not None:
            from terrain_topology import validate_height_transform
            validate_height_transform(meta["heightTransform"], meta)
        if key != "center":
            _require(meta["edgeValuesSHA256"] == edge_values_sha256(record[key]),
                     key + " edge values differ from source digest")
    _require(provenance["center"]["origin"] == origin, "center provenance origin differs")
    if scene is not None:
        for key in ("tile", "gridSize", "origin", "spacing"):
            _require(record.get(key) == scene.get(key), "scene " + key + " differs")
        _require(provenance["center"]["heightScale"] == scene.get("heightScale"),
                 "scene heightScale differs")


def write(tile, out_dir, scene=None):
    import terrain_topology
    record = build(tile)
    validate(record, scene)
    terrain_topology.write_json(os.path.join(out_dir, FILENAME), record)
    return record
