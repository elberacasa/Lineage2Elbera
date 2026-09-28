#!/usr/bin/env python3
"""Elbera Tools: original Interlude terrain collision inputs, separate from rendering.

Read-only by default. --write/--check requires an explicit output directory.
Original packages, generated data and native binaries are never published by
this tool. See docs/native-terrain-collision-inputs.md for provenance and limits.
The prepared primitive does not certify live level/actor-state admission.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import tempfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "tools/world")]
from l2lib import Reader, load_package, parse_texture, mip_bytes
from convert import qualified_objref, read_props_ordered
from terrain_topology import (
    read_bitmaps,
    native_height_transform,
    float32,
    words_sha256,
    NATIVE_ENGINE_SHA256,
    NATIVE_CORE_SHA256,
)
from export_bsp_collision import level_model_binding

FORMAT = "elbera-original-terrain-collision-v1"
PACKAGE_HASHES = {
    "Engine.u": "9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761",
    "Core.u": "de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0",
}


def require(condition, message):
    if not condition:
        raise ValueError("terrain collision: " + message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def export_bytes(pkg, export):
    start, size = export.serial_offset, export.serial_size
    require(
        type(start) is int
        and type(size) is int
        and start >= 0
        and size > 0
        and start + size <= len(pkg.data),
        "export outside package",
    )
    return bytes(pkg.data[start : start + size])


def unique_export(pkg, reference, class_ref):
    require(
        isinstance(reference, str)
        and re.fullmatch(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+", reference),
        "qualified reference required",
    )
    rows = [
        e
        for e in pkg.exports
        if qualified_objref(pkg, e.index + 1).casefold() == reference.casefold()
    ]
    require(len(rows) == 1, "unmatched or ambiguous qualified reference: " + reference)
    require(
        qualified_objref(pkg, rows[0].class_index).casefold() == class_ref.casefold(),
        "qualified export class differs: " + reference,
    )
    return rows[0]


def property_one(properties, name, kind, size=None):
    rows = [p for p in properties if p["name"] == name]
    require(len(rows) == 1, "expected one property " + name)
    prop = rows[0]
    require(
        prop["type"] == kind and (size is None or len(prop["raw"]) == size),
        "malformed property " + name,
    )
    return prop


def parse_terrain_prefix(pkg, export):
    """Bounded ordinary saved actor properties and native TerrainInfo prefix.

    Deliberately stops after HeightmapY; later native fields remain fingerprinted
    but uninterpreted. No property-looking byte scan or neighboring-export read.
    """
    require(
        pkg.file_version == 123 and pkg.licensee_version >= 23,
        "unsupported saved map version",
    )
    require(
        qualified_objref(pkg, export.class_index).casefold() == "engine.terraininfo",
        "expected qualified Engine.TerrainInfo",
    )
    body = export_bytes(pkg, export)
    r = Reader(body)
    require(
        r.compact() == export.class_index and r.compact() == export.class_index,
        "unsupported actor state-frame class",
    )
    require(r.i32() == -1 and r.i32() == -1, "unsupported actor state-frame mask")
    state_word = r.u32()  # preserved framing, not interpreted as live state
    require(r.compact() == -1, "unsupported actor state-frame offset")
    start = r.pos
    # Reuse packed-tag decoder while bounding its reader to THIS export.
    properties, end = read_props_ordered(
        SimpleNamespace(data=body, name=pkg.name, path=pkg.path), start
    )
    ref_prop = property_one(properties, "TerrainMap", 5)
    rr = Reader(ref_prop["raw"])
    ref = rr.compact()
    require(rr.pos == len(rr.data) and ref != 0, "invalid TerrainMap object reference")
    r = Reader(body, end)
    count = r.compact()
    require(count == 256, "unsupported sector count")
    sectors = [r.compact() for _ in range(count)]
    expected = {
        e.index + 1
        for e in pkg.exports
        if qualified_objref(pkg, e.class_index).casefold() == "engine.terrainsector"
    }
    require(
        len(set(sectors)) == 256 and set(sectors) == expected,
        "sector reference identity differs",
    )
    require([r.i32(), r.i32()] == [16, 16], "unsupported sector dimensions")
    coords_start = r.pos
    forward = list(struct.unpack("<12f", r.bytes(48)))
    inverse = list(struct.unpack("<12f", r.bytes(48)))
    require([r.i32(), r.i32()] == [256, 256], "unsupported heightmap dimensions")
    require(all(math.isfinite(v) for v in forward + inverse), "nonfinite saved FCoords")
    return {
        "properties": properties,
        "terrainMap": qualified_objref(pkg, ref),
        "forward": forward,
        "inverse": inverse,
        "width": 256,
        "height": 256,
        "evidence": {
            "exportSHA256": sha(body),
            "exportBytes": len(body),
            "stateFrameWord32": state_word,
            "propertySpan": [start, end],
            "coordsSpan": [coords_start, coords_start + 96],
            "nativePrefixBytes": r.pos,
            "remainingNativeBytes": len(body) - r.pos,
            "remainingNativeSHA256": sha(body[r.pos :]),
        },
    }


def texture_heightmap(pkg, reference):
    """Exact grouped Texture identity and one fully consumed native G16 mip."""
    export = unique_export(pkg, reference, "Engine.Texture")
    body = export_bytes(pkg, export)
    texture = parse_texture(pkg, export)
    require(
        texture.body_end == export.serial_offset + export.serial_size,
        "unconsumed texture export",
    )
    require(
        texture.format == 10 and len(texture.mips) == 1, "expected one original G16 mip"
    )
    mip = texture.mips[0]
    require(
        (mip.u, mip.v, mip.data_size) == (256, 256, 131072),
        "unsupported G16 mip dimensions",
    )
    require(
        texture.props.get("USize") == struct.pack("<i", 256)
        and texture.props.get("VSize") == struct.pack("<i", 256),
        "tagged texture dimensions differ",
    )
    require(
        export.serial_offset <= mip.data_offset
        and mip.data_offset + mip.data_size
        <= export.serial_offset + export.serial_size,
        "G16 mip outside export",
    )
    raw = mip_bytes(pkg, mip)
    require(len(raw) == 131072, "truncated G16 mip")
    return raw, {
        "reference": qualified_objref(pkg, export.index + 1),
        "exportSHA256": sha(body),
        "exportBytes": len(body),
        "fullyConsumed": True,
        "G16SHA256": sha(raw),
        "version": [pkg.file_version, pkg.licensee_version],
    }


def prepared_input(
    raw_height, forward, inverse, visibility, edge_turn, *, inverted, delete_me
):
    """Finite saved 256x256 source domain, with pinned PostLoad bitmap updates.

    Axis-aligned FCoords have one nonzero term per output, so these bounded
    integer/G16 operations are exactly representable before each Float32 store.
    This does not replace general x87 coordinate arithmetic or dynamic actors.
    """
    require(
        isinstance(raw_height, bytes) and len(raw_height) == 131072,
        "complete G16 bytes required",
    )
    for coords in (forward, inverse):
        require(
            isinstance(coords, (list, tuple))
            and len(coords) == 12
            and all(
                type(v) in (int, float)
                and math.isfinite(v)
                and abs(v) <= 3.4028234663852886e38
                and float32(v) == v
                for v in coords
            ),
            "twelve stored finite coordinate scalars required",
        )
    require(
        list(forward[3:]) == [128.0, 0.0, 0.0, 0.0, 128.0, 0.0, 0.0, 0.0, 0.296875],
        "unsupported forward coordinate axes",
    )
    require(
        all(abs(v) <= 2**20 and v * 64 == int(v * 64) for v in forward[:3]),
        "forward origin outside exactly representable bounded arithmetic domain",
    )
    require(
        list(inverse[3:])
        == [0.0078125, 0.0, 0.0, 0.0, 0.0078125, 0.0, 0.0, 0.0, float32(256 / 76)],
        "unsupported inverse coordinate axes",
    )
    for words in (visibility, edge_turn):
        require(
            isinstance(words, (list, tuple))
            and len(words) == 2048
            and all(type(w) is int and 0 <= w <= 0xFFFFFFFF for w in words),
            "complete uint32 bitmap words required",
        )
    require(
        type(inverted) is bool and type(delete_me) is bool,
        "explicit source boolean flags required",
    )
    current_visibility = list(visibility)
    for word in range(2048):
        if word % 8 == 7:
            current_visibility[word] |= 0x80000000
        if word >= 2040:
            current_visibility[word] = 0xFFFFFFFF
    heights = struct.unpack("<65536H", raw_height)
    vertices = [
        [
            float32((x - forward[0]) * forward[3]),
            float32((y - forward[1]) * forward[7]),
            float32((heights[y * 256 + x] - forward[2]) * forward[11]),
        ]
        for y in range(256)
        for x in range(256)
    ]
    require(
        all(math.isfinite(v) for row in vertices for v in row),
        "nonfinite prepared vertex",
    )
    return {
        "format": FORMAT,
        "width": 256,
        "height": 256,
        "vertices": vertices,
        "inverseCoords": list(inverse),
        "visibility": [
            bool(current_visibility[i >> 5] & (1 << (i & 31))) for i in range(65536)
        ],
        "edgeTurn": [bool(edge_turn[i >> 5] & (1 << (i & 31))) for i in range(65536)],
        "inverted": inverted,
        "deleteMe": delete_me,
        "terrainMapPresent": True,
        "owner": None,
    }


def source_defaults(client):
    """Fresh qualified CDO streams; no cached UnrealScript/source text oracle."""
    sys.path.insert(0, str(ROOT / "tools/dat"))
    from export_npc_visuals import OriginalClasses, terminal_defaults

    # This helper's existing package loader is rooted at the owned repository.
    require(
        Path(client).resolve() == (ROOT / "assets/interlude").resolve(),
        "alternate class corpus is unsupported",
    )
    classes = OriginalClasses()
    rows = []
    for name in ("Engine.TerrainInfo", "Engine.Info", "Engine.Actor", "Core.Object"):
        types = classes.property_types(name, set())
        package_name, leaf = name.split(".")
        pkg = classes.packages[package_name]
        matches = [
            e
            for e in pkg.exports
            if pkg.class_name_of(e) == "Class" and pkg.export_name(e) == leaf
        ]
        require(len(matches) == 1, "ambiguous source default class")
        values, evidence = terminal_defaults(pkg, matches[0], types)
        require(
            evidence["defaultsBoundary"] == "unique-validated-candidate",
            "unproved class default boundary",
        )
        require(
            not [v for v in values if v[0] in ("Inverted", "bDeleteMe")],
            "unhandled class boolean override",
        )
        rows.append({"class": name, **evidence})
    require(classes.sources == PACKAGE_HASHES, "class package fingerprints differ")
    return {
        "packages": classes.sources,
        "classes": rows,
        "Inverted": False,
        "bDeleteMe": False,
        "scope": "Core zero/parent-copy CDO plus serialized tag overrides; not later actor state",
    }


def source_boolean(properties, name, fallback):
    rows = [p for p in properties if p["name"] == name]
    require(len(rows) <= 1, "duplicate boolean " + name)
    if not rows:
        return fallback
    require(
        rows[0]["type"] == 3 and type(rows[0]["boolval"]) is bool,
        "malformed boolean " + name,
    )
    return rows[0]["boolval"]


def separate_query_state(record, diagnostic_static_state):
    """Do not silently turn serialized/default flags into live query state."""
    source_flags = {
        key: record[key] for key in ("inverted", "deleteMe", "terrainMapPresent")
    }
    for key in ("owner", "deleteMe", "terrainMapPresent"):
        record.pop(key)
    if diagnostic_static_state:
        require(
            source_flags["deleteMe"] is False,
            "diagnostic not-deleted state conflicts with serialized flag",
        )
        record.update(owner=None, deleteMe=False, terrainMapPresent=True)
    return source_flags


def collect(
    tile,
    client=ROOT / "assets/interlude",
    *,
    defaults=None,
    diagnostic_static_state=False,
):
    require(
        isinstance(tile, str) and re.fullmatch(r"\d+_\d+", tile), "invalid source tile"
    )
    client = Path(client)
    for name, expected in (
        ("engine.dll", NATIVE_ENGINE_SHA256),
        ("Core.dll", NATIVE_CORE_SHA256),
    ):
        require(
            sha((client / "system" / name).read_bytes()) == expected,
            "native input fingerprint differs: " + name,
        )
    defaults = source_defaults(client) if defaults is None else defaults
    path = client / "maps" / (tile + ".unr")
    pkg, _ = load_package(path)
    exports = [
        e
        for e in pkg.exports
        if qualified_objref(pkg, e.class_index).casefold() == "engine.terraininfo"
    ]
    require(len(exports) == 1, "expected one qualified TerrainInfo")
    export = exports[0]
    info = parse_terrain_prefix(pkg, export)
    props = info["properties"]
    package_name = info["terrainMap"].split(".")[0]
    files = [
        p
        for p in (client / "textures").iterdir()
        if p.suffix.casefold() == ".utx"
        and p.stem.casefold() == package_name.casefold()
    ]
    require(len(files) == 1, "missing or ambiguous TerrainMap package")
    texture_pkg, _ = load_package(files[0])
    raw, texture_proof = texture_heightmap(texture_pkg, info["terrainMap"])
    location = list(
        struct.unpack("<3f", property_one(props, "Location", 10, 12)["raw"])
    )
    scale = list(
        struct.unpack("<3f", property_one(props, "TerrainScale", 10, 12)["raw"])
    )
    require(
        scale == [128.0, 128.0, 76.0] and all(math.isfinite(v) for v in location),
        "unsupported terrain source scale/location",
    )
    origin = [location[0] - 16384, location[1] - 16384, location[2]]
    bounds = native_height_transform(pkg, raw, origin, 128, 76 / 256)
    require(bounds is not None, "saved sector four-corner comparison failed")
    require(
        info["forward"]
        == bounds["origin"] + [v for axis in bounds["axes"] for v in axis],
        "saved coordinate readers differ",
    )
    bitmaps = read_bitmaps(props, 256)
    record = prepared_input(
        raw,
        info["forward"],
        info["inverse"],
        bitmaps["visibility"]["words"],
        bitmaps["edgeTurn"]["words"],
        inverted=source_boolean(props, "Inverted", defaults["Inverted"]),
        delete_me=source_boolean(props, "bDeleteMe", defaults["bDeleteMe"]),
    )
    _, level = level_model_binding(pkg)
    membership = []
    for name in ("array0x48", "array0x38"):
        a, b = level["spans"][name]
        r = Reader(pkg.data[a:b])
        count, duplicate = r.i32(), r.i32()
        refs = [r.compact() for _ in range(count)]
        require(
            count == duplicate and r.pos == len(r.data),
            "Level actor-array framing differs",
        )
        membership.append({"field": name, "matches": refs.count(export.index + 1)})
    require(
        sum(m["matches"] for m in membership) > 0,
        "TerrainInfo absent from serialized Level actor arrays",
    )
    record["source"] = {
        "tile": tile,
        "mapSHA256": sha(path.read_bytes()),
        "mapVersion": [pkg.file_version, pkg.licensee_version],
        "terrainRef": qualified_objref(pkg, export.index + 1),
        "terrainExport": info["evidence"],
        "terrainMap": info["terrainMap"],
        "texture": {**texture_proof, "packageSHA256": sha(files[0].read_bytes())},
        "level": level["level"],
        "levelSHA256": level["levelSHA256"],
        "levelMembership": membership,
        "forwardCoords": info["forward"],
        "inverseCoords": info["inverse"],
        "serializedLocation": location,
        "serializedTerrainScale": scale,
        "baseVertexFloat32SHA256": sha(
            b"".join(struct.pack("<3f", *v) for v in record["vertices"])
        ),
        "sectorBounds": bounds["verification"],
        "classDefaults": defaults,
        "bitmaps": {
            k: {
                "property": v["sourceProperty"],
                "propertySHA256": v["sourcePropertySHA256"],
                "wordsSHA256": words_sha256(v["words"]),
            }
            for k, v in bitmaps.items()
        },
        "engineSHA256": NATIVE_ENGINE_SHA256,
        "coreSHA256": NATIVE_CORE_SHA256,
    }
    source_flags = separate_query_state(record, diagnostic_static_state)
    record["source"]["serializedOrClassDefaultFlags"] = source_flags
    record["scope"] = {
        "status": "source-derived-prepared-primitive",
        "actorState": (
            "explicit-diagnostic-query-state"
            if diagnostic_static_state
            else "not-supplied"
        ),
        "actorStateLimits": "owner=null/deleteMe=false/terrainMapPresent=true, when supplied, are explicit diagnostic assumptions, not runtime observation.",
        "cellRange": [0, 254],
        "vertexRange": [0, 255],
        "postLoadBitmaps": "copy current to Orig; set outer visibility",
        "seamInput": "base index domain equals direct vertices; appended sample256 excluded",
        "limits": [
            "Loaded-level participation and later actor deletion/edits remain caller responsibilities.",
            "No rendered-mesh or heightAtWorld input, no appended rendering seam or arbitrary VTGroup replacement.",
            "Saved sector bounds validate four corners, not all native rendering or loading behavior.",
        ],
    }
    return record


def encode(record):
    return (json.dumps(record, separators=(",", ":"), allow_nan=False) + "\n").encode()


def write_output(path, payload, *, overwrite=False):
    """Complete sibling temporary file; no-clobber publication unless explicit."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        temp.write(payload)
        name = Path(temp.name)
    try:
        if overwrite:
            name.replace(path)
        else:
            # Same-filesystem link fails atomically when an existing file or
            # symlink owns the destination. Its bytes remain untouched.
            os.link(name, path)
    finally:
        name.unlink(missing_ok=True)


def seam_input_evidence(E):
    """Finite base-index proof, with named source ranges; no loading inference."""
    from terrain_topology import native_engine_evidence

    anchors = [
        (0x1071D47D, "cmp", "edx, 0xffff"),
        (0x1071D483, "jg", "0x1071d4d4"),
        (0x1071D487, "sar", "eax, 8"),
        (0x1071D48A, "and", "edx, 0xff"),
        (0x1071D492, "sar", "esi, 4"),
        (0x1071D495, "shl", "eax, 4"),
        (0x1071D498, "add", "esi, eax"),
        (0x1071D49A, "mov", "eax, dword ptr [ecx + 0x2204]"),
        (0x1071D4A3, "and", "edx, 0xf"),
        (0x1072B6AC, "mov", "eax, dword ptr [ebx + 0x2110]"),
        (0x1072B6B3, "mov", "ecx, dword ptr [ebx + 0x210c]"),
        (0x1072B6C4, "call", "0x1030795a"),
        (0x1072B7D0, "cmp", "edx, 0x10"),
        (0x1072B7D8, "mov", "ecx, dword ptr [ebx + 0x2100]"),
        (0x1072B7EB, "mov", "dword ptr [ecx], ebx"),
        (0x1072B7F0, "mov", "dword ptr [ecx + 4], ebx"),
        (0x1072B7F6, "mov", "dword ptr [ecx + 8], eax"),
        (0x1072B874, "shl", "eax, 4"),
        (0x1072B877, "add", "eax, dword ptr [ebp - 0x14]"),
        (0x1072B87E, "mov", "edx, dword ptr [ebx + 0x2204]"),
        (0x1072B884, "mov", "dword ptr [eax + edx], esi"),
        (0x1072B887, "mov", "ecx, dword ptr [ebx + 0x2208]"),
        (0x1072B88D, "mov", "dword ptr [eax + ecx], esi"),
        (0x1072768B, "mov", "edx, dword ptr [edi + 0x2208]"),
        (0x10727691, "mov", "edx, dword ptr [edx + eax + 0x3c]"),
        (0x107276A8, "fstp", "dword ptr [edx + 0xc8]"),
        (0x10727A66, "mov", "edx, dword ptr [ebx + 0x2208]"),
        (0x10727A6C, "mov", "esi, dword ptr [edx + eax*4 + 0x4000]"),
        (0x10727A99, "fstp", "dword ptr [esi + ebx*4 + 8]"),
        (0x10727E77, "mov", "eax, dword ptr [esi + 0x2208]"),
        (0x10727E7D, "mov", "eax, dword ptr [eax + 0x403c]"),
        (0x10727E8E, "fstp", "dword ptr [edx + 0xc8]"),
        (0x1072E19B, "call", "0x103070fe"),
        (0x10720A67, "cmp", "dword ptr [ebp + 0x4c], 0"),
        (0x10720A6B, "je", "0x10720adf"),
    ]
    for va, op, args in anchors:
        E.instruction(va, op, args)

    def target(stub):
        p = E.offset(stub)
        assert E.data[p] == 0xE9
        return stub + 5 + struct.unpack_from("<i", E.data, p + 1)[0]

    assert target(0x1030795A) == 0x10720900 and target(0x103070FE) == 0x1072B680
    selected = {(i >> 8) * 16 + ((i & 255) >> 4): set() for i in range(65536)}
    for i in range(65536):
        group = ((i >> 8) << 4) + ((i & 255) >> 4)
        sample = i & 15
        copied_index = group * 16 + sample
        assert copied_index == i
        selected[group].add(sample)
    assert set(selected) == set(range(4096)) and all(
        v == set(range(16)) for v in selected.values()
    )
    reads = {(g, s) for g, ss in selected.items() for s in ss}
    edge_writes = {(y * 16 + 15, 16) for y in range(256)} | {
        (4096 + g, s) for g in range(16) for s in range(17)
    }
    assert not reads & edge_writes
    ranges = []
    for label, a, b, reg in [
        ("PostLoad normal body", 0x1072DED0, 0x1072E4C6, "ebx"),
        ("UpdateVTGroup normal body", 0x1072B680, 0x1072B9CD, "ebx"),
        ("UpdateVertices normal body", 0x10720900, 0x10720E99, "esi"),
    ]:
        # This census does not infer transitive effects of arbitrary callees.
        raw = bytes(E.data[E.offset(a) : E.offset(b)])
        rows = list(E.dis.disasm(raw, a))
        refs = []
        assert (
            rows
            and sum(ins.size for ins in rows) == len(raw)
            and rows[-1].address + rows[-1].size == b
        )
        for ins in rows:
            if any(f"[{reg} + {off}]" in ins.op_str for off in ("0x210c", "0x2110")):
                refs.append(
                    {
                        "VA": hex(ins.address),
                        "instruction": ins.mnemonic + " " + ins.op_str,
                    }
                )
                assert not (
                    ins.op_str.split(", ")[0]
                    in [f"dword ptr [{reg} + {off}]" for off in ("0x210c", "0x2110")]
                    and ins.mnemonic not in ("cmp", "test")
                )
        ranges.append(
            {
                "label": label,
                "range": [hex(a), hex(b)],
                "SHA256": hashlib.sha256(raw).hexdigest(),
                "dimensionReferences": refs,
            }
        )
    report = {
        "status": "PASS",
        "engineSHA256": E.sha,
        "instructionChecks": len(anchors),
        "reusedNamedMethodProof": native_engine_evidence(
            ROOT / "assets/interlude/system/engine.dll"
        ),
        "baseIndexMatches": 65536,
        "groups": 4096,
        "sampleRange": [0, 15],
        "neighborSeamWriteCoordinates": len(edge_writes),
        "intersections": 0,
        "dimensionReadCensus": ranges,
        "limits": [
            "The index equivalence is conditional on serialized width=height=256 and the reviewed UpdateVTGroup population, or direct base fallback.",
            "The dimension census checks each body's main receiver register, not aliases, arbitrary transitive calls or later mutation.",
            "Known neighbor seam setters do not affect this base accessor domain; no claim about later arbitrary VTGroup ownership replacement.",
            "Native rendering may use appended sectors/vertices outside the collision cell domain.",
            "No live loaded-level, bDeleteMe or streaming admission is inferred.",
        ],
    }
    return report


def native_input_evidence(comparison_engine=None, comparison_core=None):
    """Pinned native serialization/coordinate/mask evidence; no DLL execution.

    Optional comparison binds erased imports only after exact finite-block
    correspondence. It does not restore calls or authenticate that distribution.
    """
    sys.path[:0] = [str(ROOT / "tools/ui"), str(ROOT / "tools/dat")]
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from supplemental_pe import PEImage
    from check_hair_attachment_native import compare_call_block
    from export_npc_visuals import OriginalClasses, terminal_defaults
    from terrain_topology import native_engine_evidence
    from check_picking_native import verify_actor_defaults_and_trace

    SHA = sha
    e = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    c = Image(ROOT / "assets/interlude/system/Core.dll", NATIVE_CORE_SHA256)
    require(
        bool(comparison_engine) == bool(comparison_core),
        "both supplemental Engine and Core must be explicit",
    )
    s = (
        PEImage(
            comparison_engine,
            "508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d",
        )
        if comparison_engine
        else None
    )
    sc = (
        PEImage(
            comparison_core,
            "d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639",
        )
        if comparison_core
        else None
    )

    def read(im, a, b):
        return bytes(im.data[im.offset(a) : im.offset(b)])

    def bind(label, a, b, delta, sites):
        raw = read(e, a, b)
        rows = list(e.dis.disasm(raw, a))
        assert (
            rows
            and sum(i.size for i in rows) == len(raw)
            and rows[-1].address + rows[-1].size == b
        )
        if s is None:
            for va in sites:
                assert read(e, va, va + 6) == b"\x90" * 6
            return {
                "label": label,
                "range": [hex(a), hex(b)],
                "status": "owned-call-identities-erased",
                "SHA256": SHA(raw),
            }
        result = compare_call_block(
            raw,
            s.read(a + delta, b - a),
            owned_va=a,
            candidate_va=a + delta,
            sites=[(va - a, ("core.dll", name)) for va, name in sites.items()],
            direct_calls=[
                i.address - a
                for i in rows
                if i.mnemonic == "call" and bytes(i.bytes)[:1] == b"\xe8"
            ],
            imports=s.imports,
        )
        return {"label": label, "range": [hex(a), hex(b)], **result}

    methods = {
        "?Serialize@ATerrainInfo@@UAEXAAVFArchive@@@Z": 0x10739CF0,
        "?UpdateVertices@ATerrainInfo@@QAEXMHHHH@Z": 0x10720900,
        "?HeightmapToWorld@ATerrainInfo@@QAE?AVFVector@@V2@@Z": 0x10364EE0,
        "?WorldToHeightmap@ATerrainInfo@@QAE?AVFVector@@V2@@Z": 0x10364F10,
        "?GetHeightmap@ATerrainInfo@@QAEGHH@Z": 0x1071BF40,
        "??0ATerrainInfo@@QAE@ABV0@@Z": 0x103FC3B0,
        "??0AActor@@QAE@ABV0@@Z": 0x103B60F0,
    }
    for name, va in methods.items():
        assert e.exported(name, True) == va
    coordinate = "?TransformPointBy@FVector@@QBE?AV1@ABVFCoords@@@Z"
    blocks = [
        bind(
            "TerrainInfo serialized sectors/FCoords/dimensions",
            0x10739D18,
            0x10739E39,
            -0x40,
            {
                0x10739D23: "?LicenseeVer@FArchive@@QAEHXZ",
                0x10739DAF: "?Ver@FArchive@@QAEHXZ",
                0x10739E01: "?Ver@FArchive@@QAEHXZ",
            },
        ),
        bind(
            "HeightmapToWorld complete wrapper",
            0x10364EE0,
            0x10364EFD,
            0,
            {0x10364EF1: coordinate},
        ),
        bind(
            "WorldToHeightmap complete wrapper",
            0x10364F10,
            0x10364F2D,
            0,
            {0x10364F21: coordinate},
        ),
    ]
    # This serializer consists of twelve four-byte component writes in native order.
    a, b = 0x106AF200, 0x106AF2B6
    calls = [
        0x106AF210,
        0x106AF21E,
        0x106AF22C,
        0x106AF23A,
        0x106AF248,
        0x106AF256,
        0x106AF264,
        0x106AF272,
        0x106AF280,
        0x106AF28E,
        0x106AF29C,
        0x106AF2AA,
    ]
    blocks.append(
        bind(
            "FCoords twelve Float32 component serialization",
            a,
            b,
            -0x40,
            {p: "?ByteOrderSerialize@FArchive@@QAEAAV1@PAXH@Z" for p in calls},
        )
    )
    assert c.exported(coordinate, True) == 0x1010F640
    if sc is not None:
        assert sc.body(coordinate) == 0x1010F640
    core_ranges = []
    for a, b in [
        (0x1010F640, 0x1010F65A),
        (0x1010F510, 0x1010F584),
        (0x10173250, 0x101732F1),
    ]:
        raw = read(c, a, b)
        if sc is not None:
            assert raw == sc.read(a, b - a)
        core_ranges.append(
            {
                "range": [hex(a), hex(b)],
                "bytes": len(raw),
                "SHA256": SHA(raw),
                "comparison": (
                    "byte-identical-to-pinned-supplemental" if sc else "owned-only"
                ),
            }
        )
    checks = [
        (0x10739D29, "cmp", "eax, 0x11"),
        (0x10739D3C, "lea", "edx, [esi + 0x20f4]"),
        (0x10739DDF, "lea", "eax, [esi + 0x215c]"),
        (0x10739DE6, "lea", "ecx, [esi + 0x212c]"),
        (0x10739E1C, "lea", "eax, [esi + 0x2110]"),
        (0x10739E23, "lea", "ecx, [esi + 0x210c]"),
        (0x10720934, "mov", "ecx, dword ptr [esi + 0x2104]"),
        (0x10720940, "imul", "eax, dword ptr [esi + 0x210c]"),
        (0x10720A71, "call", "0x10308891"),
        (0x10720A76, "movzx", "ecx, ax"),
        (0x10720A94, "mov", "eax, dword ptr [esi + 0x210c]"),
        (0x10720A9A, "imul", "eax, edi"),
        (0x10720A9D, "add", "eax, ebx"),
        (0x10720AA2, "mov", "eax, dword ptr [esi + 0x2100]"),
        (0x10720AC7, "call", "0x1030bdb6"),
        (0x10720AD9, "mov", "dword ptr [edi + 8], eax"),
        (0x1071BFAB, "mov", "edx, dword ptr [ecx + 0x3c0]"),
        (0x1071BFB1, "mov", "dl, byte ptr [edx + 0x578]"),
        (0x1071BFC4, "cmp", "dl, 0xa"),
        (0x1071BFD9, "mov", "ecx, dword ptr [ecx + 0x580]"),
        (0x1071BFDF, "imul", "ecx, eax"),
        (0x1071BFE2, "add", "ecx, esi"),
        (0x1071BFE4, "mov", "edx, dword ptr [edx + 0x1c]"),
        (0x1071BFE7, "mov", "ax, word ptr [edx + ecx*2]"),
        (0x103FC456, "fld", "dword ptr [ebp + 0x20dc]"),
        (0x103FC46E, "and", "edx, 1"),
        (0x103FC471, "xor", "dword ptr [ebx + 0x20e0], edx"),
        (0x103FC485, "and", "ecx, 2"),
        (0x103FC490, "mov", "edx, dword ptr [ebp + 0x20e4]"),
        (0x103B6221, "mov", "ecx, dword ptr [ebp + 0x60]"),
        (0x103B622A, "and", "edx, 1"),
        (0x103B6238, "and", "eax, 2"),
        (0x103B6245, "and", "ecx, 4"),
        (0x103B6252, "and", "eax, 8"),
        (0x103B625F, "and", "ecx, 0x10"),
        (0x103B626C, "and", "eax, 0x20"),
        (0x103B6279, "and", "ecx, 0x40"),
        (0x103B6286, "and", "eax, 0x80"),
        (0x103B628D, "mov", "dword ptr [ebx + 0x64], eax"),
    ]
    for va, op, args in checks:
        e.instruction(va, op, args)
    # Fresh declared-property linked lists bind the masks to names; no cached .uc.
    pkg, _ = load_package(ROOT / "assets/interlude/system/Engine.u")
    groups = {}
    classes = OriginalClasses()
    defaults = []
    for cls, wanted in [
        (
            "TerrainInfo",
            [
                "DecoLayers",
                "DecoLayerOffset",
                "Inverted",
                "bKCollisionHalfRes",
                "JustLoaded",
            ],
        ),
        (
            "Actor",
            [
                "CreatureID",
                "NoCheatCollision",
                "CanIngnoreCollision",
                "bDeleteNow",
                "bAlwaysVisible",
                "bStatic",
                "bHidden",
                "bNoDelete",
                "bDeleteMe",
            ],
        ),
    ]:
        owner = next(
            x
            for x in pkg.exports
            if pkg.class_name_of(x) == "Class" and pkg.export_name(x) == cls
        )
        fields = [
            x
            for x in pkg.exports
            if x.package_index == owner.index + 1
            and pkg.class_name_of(x).endswith("Property")
        ]
        selected = []
        for name in wanted:
            matches = [x for x in fields if pkg.export_name(x) == name]
            assert len(matches) == 1
            selected.append(matches[0])
        evidence = []
        for i, field in enumerate(selected):
            raw = read_body = pkg.data[
                field.serial_offset : field.serial_offset + field.serial_size
            ]
            r = Reader(raw)
            assert pkg.name(r.compact()) == "None" and r.compact() == 0
            nxt = r.compact()
            dim = r.u32()
            flags = r.u32()
            category = pkg.name(r.compact())
            assert dim == 1
            if i < len(selected) - 1:
                assert nxt == selected[i + 1].index + 1
            evidence.append(
                {
                    "name": pkg.export_name(field),
                    "kind": pkg.class_name_of(field),
                    "flags": flags,
                    "SHA256": SHA(raw),
                }
            )
        groups[cls] = evidence
    for name in ["Engine.TerrainInfo", "Engine.Info", "Engine.Actor", "Core.Object"]:
        types = classes.property_types(name, set())
        p = classes.packages[name.split(".")[0]]
        ex = next(
            x
            for x in p.exports
            if p.class_name_of(x) == "Class" and p.export_name(x) == name.split(".")[1]
        )
        props, meta = terminal_defaults(p, ex, types)
        assert meta["defaultsBoundary"] == "unique-validated-candidate"
        assert not [n for n, k, value in props if n in ("Inverted", "bDeleteMe")]
        defaults.append(
            {
                "class": name,
                "sourceSHA256": classes.sources[name.split(".")[0] + ".u"],
                **meta,
                "serializedInvertedOverride": False,
                "serializedDeleteMeOverride": False,
            }
        )
    report = {
        "status": "PASS",
        "source": {
            "engineSHA256": e.sha,
            "coreSHA256": c.sha,
            "comparisonEngineSHA256": s.sha if s else None,
            "comparisonCoreSHA256": sc.sha if sc else None,
            "Engine.uSHA256": SHA(
                (ROOT / "assets/interlude/system/Engine.u").read_bytes()
            ),
        },
        "nativeInstructionChecks": len(checks),
        "exactComparisonBlocks": blocks,
        "coreRanges": core_ranges,
        "methods": {k: hex(v) for k, v in methods.items()},
        "propertyChains": groups,
        "defaults": defaults,
        "reusedCDOProof": verify_actor_defaults_and_trace(e),
        "reusedTopologyProof": native_engine_evidence(
            ROOT / "assets/interlude/system/engine.dll"
        ),
        "bindings": {
            "serializerThresholds": {
                "licenseeVersion": 17,
                "fileVersionLegacyCoordinates": 83,
                "fileVersionOldHeightmap": 76,
            },
            "forwardCoords": "0x212c",
            "inverseCoords": "0x215c",
            "heightmapX": "0x210c",
            "heightmapY": "0x2110",
            "baseVertices": "0x2100",
            "baseVertexCount": "0x2104",
            "terrainMap": "0x3c0",
            "inverted": {"offset": "0x20e0", "mask": 1},
            "deleteMe": {"offset": "0x64", "mask": 128},
        },
        "limits": [
            "Supplemental bindings require BOTH explicit pinned comparison paths; owned-only reports erased calls. Qualified finite matches are not authenticated vendor distribution or restored imports.",
            "These are serialized/default/base-vertex inputs; runtime flags, actor deletion, arbitrary VTGroup replacement and neighbor load participation remain separate.",
            "Absent Inverted/bDeleteMe tags prove no serialized override in the qualified chain; zero class-default interpretation composes existing Core CDO/Bool-Link proof and does not assert later live state.",
            "No native executable was loaded or executed.",
        ],
    }
    report["seamDomain"] = seam_input_evidence(e)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tile", nargs="+", default=["17_25"])
    parser.add_argument("--output-dir", type=Path)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--write", action="store_true")
    actions.add_argument("--check", action="store_true")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="explicitly replace existing output with --write",
    )
    parser.add_argument(
        "--diagnostic-static-state",
        action="store_true",
        help="explicitly add no-owner/not-deleted/present query assumptions; never native live admission",
    )
    parser.add_argument("--native-binding-check", action="store_true")
    parser.add_argument("--comparison-engine", type=Path)
    parser.add_argument("--comparison-core", type=Path)
    args = parser.parse_args(argv)
    if args.native_binding_check:
        print(
            json.dumps(
                native_input_evidence(args.comparison_engine, args.comparison_core),
                indent=2,
            )
        )
        return
    require(
        not (args.comparison_engine or args.comparison_core),
        "comparison files require --native-binding-check",
    )
    require(not args.overwrite or args.write, "--overwrite requires --write")
    require(
        not (args.write or args.check) or args.output_dir is not None,
        "explicit output directory required",
    )
    defaults = source_defaults(ROOT / "assets/interlude")
    summaries = []
    for tile in args.tile:
        record = collect(
            tile,
            defaults=defaults,
            diagnostic_static_state=args.diagnostic_static_state,
        )
        payload = encode(record)
        if args.output_dir:
            path = args.output_dir / (tile + ".terrain-collision.json")
            if args.check:
                require(
                    path.read_bytes() == payload, "fresh output differs: " + str(path)
                )
            if args.write:
                write_output(path, payload, overwrite=args.overwrite)
        summaries.append(
            {
                "tile": tile,
                "vertices": len(record["vertices"]),
                "boundsMatched": record["source"]["sectorBounds"]["boundsMatched"],
                "bytes": len(payload),
                "SHA256": sha(payload),
            }
        )
    print(
        json.dumps(
            {
                "status": "PASS",
                "mode": (
                    "write" if args.write else "check" if args.check else "read-only"
                ),
                "tiles": summaries,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
