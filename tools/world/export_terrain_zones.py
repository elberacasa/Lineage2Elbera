#!/usr/bin/env python3
"""Elbera Tools: qualified saved Interlude terrain/zone participants.

Read-only by default. Original-input exporter, initially pinned to 17_25/22_22.
Never certifies live actor state, a hash grid, seam readiness or loading order.
Optional normal-build reconstruction requires explicit supplemental binaries.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [
    str(ROOT / p) for p in ("tools", "tools/world", "tools/dat", "tools/ui")
]
from l2lib import Reader, load_package, read_model
from convert import qualified_objref, read_props_ordered, read_map_actor_frame
from export_bsp_collision import level_model_binding, export_model
from export_terrain_collision import (
    export_bytes,
    parse_terrain_prefix,
    property_one,
    source_boolean,
    write_output,
    PACKAGE_HASHES,
)
from export_npc_visuals import OriginalClasses, terminal_defaults

from terrain_topology import NATIVE_ENGINE_SHA256, NATIVE_CORE_SHA256

FORMAT = "elbera-original-terrain-zones-v1"
MAP_HASHES = {
    "17_25": "8dbe180888719dcb2216b866caa85aaf38f18e2686dc7cb8f78ba722bfe63857",
    "22_22": "74d86d7cd503700494650fa25e237295f9bb37b194419fc67ef5eaf5effe8e6e",
}
ZONE_CLASSES = ("Engine.LevelInfo", "Engine.ZoneInfo", "Engine.SkyZoneInfo")


def require(ok, message):
    if not ok:
        raise ValueError("terrain zones: " + message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def decode_refs(data):
    r = Reader(data)
    count = r.compact()
    require(0 <= count <= len(data) - r.pos, "invalid object-array count")
    result = [r.compact() for _ in range(count)]
    require(r.pos == len(data), "object-array trailing bytes")
    return result


def decode_region(pkg, data):
    rows, end = read_props_ordered(
        SimpleNamespace(data=data, name=pkg.name, path=pkg.path), 0
    )
    require(end == len(data), "Region trailing bytes")
    require(
        sorted(p["name"] for p in rows) == ["Zone", "ZoneNumber", "iLeaf"],
        "unsupported Region fields",
    )
    zone = property_one(rows, "Zone", 5)
    r = Reader(zone["raw"])
    ref = r.compact()
    require(r.pos == len(zone["raw"]), "Region.Zone trailing bytes")
    leaf = struct.unpack("<i", property_one(rows, "iLeaf", 2, 4)["raw"])[0]
    number = property_one(rows, "ZoneNumber", 1, 1)["raw"][0]
    require(number < 64, "Region zone outside fixed table")
    return {"zoneRef": ref, "leaf": leaf, "zoneNumber": number}


def actor_properties(pkg, ex):
    body = export_bytes(pkg, ex)
    frame = read_map_actor_frame(pkg, ex)
    require(frame is not None, "unsupported actor state-frame class, flags or body")
    start = frame.size
    rows, end = read_props_ordered(
        SimpleNamespace(data=body, name=pkg.name, path=pkg.path), start
    )
    require(start <= end <= len(body), "properties escape actor export")
    return rows, {
        "exportSHA256": sha(body),
        "propertySpan": [start, end],
        "stateFrameWord32": frame.latent_action & 0xFFFFFFFF,
        "unparsedTailBytes": len(body) - end,
        "unparsedTailSHA256": sha(body[end:]),
    }


def default_boolean(classes, qualified, name):
    value = None
    evidence = []
    seen = set()
    while qualified:
        require(qualified not in seen, "cyclic source class inheritance")
        seen.add(qualified)
        node = classes.get(qualified)
        require(node is not None, "missing qualified source class")
        package, leaf = qualified.split(".")
        pkg = classes.packages[package]
        found = [
            e
            for e in pkg.exports
            if pkg.class_name_of(e) == "Class" and pkg.export_name(e) == leaf
        ]
        require(len(found) == 1, "ambiguous qualified source class")
        rows, proof = terminal_defaults(
            pkg, found[0], classes.property_types(qualified, set())
        )
        require(
            proof["defaultsBoundary"] == "unique-validated-candidate",
            "ambiguous nonvisual class defaults",
        )
        tags = [r for r in rows if r[0] == name]
        require(
            len(tags) <= 1 and all(r[1] == "bool" and type(r[2]) is bool for r in tags),
            "invalid class Boolean override",
        )
        if value is None and tags:
            value = tags[0][2]
        evidence.append({"class": qualified, **proof})
        qualified = node["super"]
    return (False if value is None else value), evidence


def fixed_zone_refs(serialized):
    require(
        isinstance(serialized, list) and len(serialized) <= 64, "zone table exceeds64"
    )
    require(
        all(type(x) is int and x >= 0 for x in serialized),
        "local zone reference required",
    )
    # Deliberately preserve repeated actor references at distinct slots.
    return serialized + [0] * (64 - len(serialized))


def source_ref(pkg, ref):
    if ref == 0:
        return None
    ex = pkg.resolve_ref(ref)
    require(ref > 0 and ex is not None, "local exported actor reference required")
    return {
        "reference": ref,
        "qualified": qualified_objref(pkg, ref),
        "class": qualified_objref(pkg, ex.class_index),
    }


def level_actor_refs(pkg, binding):
    a, b = binding["spans"]["array0x38"]
    r = Reader(bytes(pkg.data[a:b]))
    count = r.i32()
    require(
        r.i32() == count and 0 < count <= len(r.data) - r.pos,
        "invalid current Level actor array",
    )
    result = [r.compact() for _ in range(count)]
    require(r.pos == len(r.data), "Level actor-array trailing bytes")
    require(result[0] > 0, "missing LevelInfo in first current actor slot")
    return result


def conditional_lists(zone_refs, actor_refs, terrains, regions):
    """Source-order reconstruction only; inputs carry explicit saved-state values.

    Empty applies once per slot (including duplicates); AddUnique is by original
    actor identity. This is not a runtime readiness or actor-state provider.
    """
    lists = {ref: [] for ref in zone_refs if ref}
    for ref in actor_refs:
        if ref not in terrains:
            continue
        require(
            type(terrains[ref]["savedDeleteMe"]) is bool,
            "explicit saved deletion value required",
        )
        if terrains[ref]["savedDeleteMe"]:
            continue
        require(ref in regions, "missing retained PointRegion result")
        zone = regions[ref]["zoneRef"]
        require(
            zone in lists,
            "fallback LevelInfo list requires prior array state; unsupported reconstruction",
        )
        if ref not in lists[zone]:
            lists[zone].append(ref)
    return [{"zoneRef": ref, "terrainRefs": values} for ref, values in lists.items()]


def collect(tile, *, normal_build=False, comparison_engine=None, comparison_core=None):
    require(tile in MAP_HASHES, "unsupported tile/source edition")
    native_hashes = {"engine.dll": NATIVE_ENGINE_SHA256, "Core.dll": NATIVE_CORE_SHA256}
    for name, digest in native_hashes.items():
        require(
            sha((ROOT / "assets/interlude/system" / name).read_bytes()) == digest,
            "native source fingerprint differs: " + name,
        )
    path = ROOT / "assets/interlude/maps" / f"{tile}.unr"
    require(
        sha(path.read_bytes()) == MAP_HASHES[tile], "original map fingerprint differs"
    )
    pkg, protocol = load_package(path)
    model_ex, binding = level_model_binding(pkg)
    model = read_model(pkg, model_ex)
    bsp = export_model(pkg, model, tile, MAP_HASHES[tile], protocol)
    actor_refs = level_actor_refs(pkg, binding)
    default = source_ref(pkg, actor_refs[0])
    require(
        default["class"] == "Engine.LevelInfo", "current actor slot0 is not LevelInfo"
    )
    zone_refs = fixed_zone_refs([z[0] for z in model.zones])
    classes = OriginalClasses()
    zones = []
    terrains = []
    for ex in pkg.exports:
        cls = qualified_objref(pkg, ex.class_index)
        if cls not in (*ZONE_CLASSES, "Engine.TerrainInfo"):
            continue
        rows, proof = actor_properties(pkg, ex)
        ref = ex.index + 1
        record = {
            **source_ref(pkg, ref),
            "source": proof,
            "actorArrayIndices": [i for i, v in enumerate(actor_refs) if v == ref],
        }
        if cls in ZONE_CLASSES:
            fallback, defaults = default_boolean(classes, cls, "bTerrainZone")
            present = [p for p in rows if p["name"] == "Terrains"]
            require(len(present) <= 1, "duplicate Terrains tag")
            require(
                not present or present[0]["type"] == 9, "Terrains must be ArrayProperty"
            )
            record.update(
                bTerrainZone=source_boolean(rows, "bTerrainZone", fallback),
                classDefaultEvidence=defaults,
                savedTerrains=decode_refs(present[0]["raw"]) if present else None,
                savedTerrainsScope=(
                    "serialized-tag" if present else "not-serialized; no list inferred"
                ),
            )
            zones.append(record)
        else:
            info = parse_terrain_prefix(pkg, ex)
            fallback, defaults = default_boolean(classes, cls, "bDeleteMe")
            region = decode_region(pkg, property_one(rows, "Region", 10)["raw"])
            position = list(
                struct.unpack("<3f", property_one(rows, "Location", 10, 12)["raw"])
            )
            record.update(
                location=position,
                savedRegion=region,
                savedDeleteMe=source_boolean(rows, "bDeleteMe", fallback),
                savedDeleteMeScope="qualified class-default plus saved tag; not live state",
                classDefaultEvidence=defaults,
                terrainPrefix=info["evidence"],
                terrainMap=info["terrainMap"],
            )
            terrains.append(record)
    require(
        classes.sources == PACKAGE_HASHES, "original class corpus fingerprints differ"
    )
    known = {z["reference"] for z in zones}
    terrain_ids = {t["reference"] for t in terrains}
    require(
        all(r == 0 or r in known for r in zone_refs),
        "zone slot is not a supported qualified zone actor",
    )
    require(
        all(t["actorArrayIndices"] for t in terrains),
        "source TerrainInfo absent from current Level actor array",
    )
    for zone in zones:
        require(
            zone["savedTerrains"] is None
            or all(ref in terrain_ids for ref in zone["savedTerrains"]),
            "saved Terrains reference is not a qualified local TerrainInfo",
        )
    output = {
        "tool": "Elbera Tools",
        "format": FORMAT,
        "tile": tile,
        "scope": {
            "state": "saved-source-provenance",
            "liveAdmission": False,
            "fixedSlotTail": "conditional normal UModel default constructor then saved serializer",
        },
        "source": {
            "file": path.name,
            "originalSHA256": MAP_HASHES[tile],
            "decodedPackageSHA256": sha(pkg.data),
            "protocol": protocol,
            "levelBinding": binding,
            "model": bsp["source"]["model"],
            "modelExportSHA256": bsp["source"]["modelSHA256"],
            "classPackages": classes.sources,
            "nativeBinaries": native_hashes,
        },
        "numZones": len(model.zones),
        "serializedZoneActorRefs": [z[0] for z in model.zones],
        "zoneActorRefs": zone_refs,
        "resolvedZoneActorRefs": [ref or actor_refs[0] for ref in zone_refs],
        "defaultZoneActor": default,
        "levelActorRefs": actor_refs,
        "zoneActors": zones,
        "terrains": terrains,
        "nativeProjection": {
            "bTerrainZone": {"offset": "0x3d8", "mask": 4},
            "Terrains": "0x3dc",
            "zoneActorSlots": "Model+0x138+24*index",
            "defaultZone": "Level.actorArray(+0x38)[0]",
        },
        "limits": [
            "No live Owner/deletion/loading state, actor hash population or seamless gate supplied.",
            "No full native zone flag word is synthesized from bTerrainZone.",
            "Saved Terrains and optional normal-build lists are distinct; neither is a live snapshot.",
            "Unrecorded fixed zone slots are null only under the checked normal constructor/serializer path; copied/reused/custom models excluded.",
        ],
    }
    if normal_build:
        require(
            comparison_engine is not None and comparison_core is not None,
            "normal reconstruction requires both explicit supplemental images",
        )
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ui"))
        from check_terrain_zones_native import verify, postload_location
        from check_tutorial_quest_native import Image, ENGINE_SHA
        from check_skillanim_native import CORE_SHA
        from check_bsp_region_native import RegionEvaluator

        native = verify(comparison_engine, comparison_core)
        e = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
        c = Image(ROOT / "assets/interlude/system/Core.dll", CORE_SHA)
        location_check = postload_location(e, c, ROOT, tile)
        require(
            location_check["branch"] == "skip-location-assignment",
            "unsupported PostLoad location adjustment",
        )
        token = lambda ref: 0x600000 + 16 * ref
        inputs = {
            "nodes": bsp["nodes"],
            "rootOutside": bsp["rootOutside"],
            "numZones": len(model.zones),
            "zoneActors": [token(r) if r else None for r in zone_refs],
        }
        regions = {}
        for terrain in terrains:
            result = RegionEvaluator(e).evaluate(
                {
                    "source": inputs,
                    "point": terrain["location"],
                    "defaultZone": token(actor_refs[0]),
                }
            )
            region = result["region"]
            original = (region["zone"] - 0x600000) // 16
            require(
                token(original) == region["zone"] and original in known,
                "PointRegion returned unknown source identity",
            )
            regions[terrain["reference"]] = {
                "zoneRef": original,
                "leaf": region["leaf"],
                "zoneNumber": region["zoneNumber"],
            }
            require(
                regions[terrain["reference"]] == terrain["savedRegion"],
                "saved Region differs from retained source query",
            )
        reconstructed = conditional_lists(
            zone_refs, actor_refs, {t["reference"]: t for t in terrains}, regions
        )
        saved_checks = []
        for entry in reconstructed:
            zone = next(z for z in zones if z["reference"] == entry["zoneRef"])
            if zone["savedTerrains"] is not None:
                require(
                    entry["terrainRefs"] == zone["savedTerrains"],
                    "saved Terrains differs from normal-build source reconstruction",
                )
                saved_checks.append(entry["zoneRef"])
        output["normalBuildReconstruction"] = {
            "status": "conditional-source-reconstruction",
            "liveAdmission": False,
            "conditions": [
                "Normal default Model construction and this saved serializer path.",
                "BuildRenderData calls UpdateTerrainArrays after this source state, without intervening actor mutation.",
                "Saved deletion values remain unchanged; this is a condition, not a live observation.",
                "Normal successful helper returns; no custom/copied/reused model or allocator state.",
            ],
            "pointRegions": [
                {"terrainRef": ref, **region} for ref, region in regions.items()
            ],
            "zoneTerrains": reconstructed,
            "savedTerrainsMatchedZoneRefs": saved_checks,
            "postLoadLocation": location_check,
            "nativeProof": {
                "engineSHA256": native["ownedEngineSHA256"],
                "coreSHA256": native["ownedCoreSHA256"],
                "comparisonEngineSHA256": native["supplementalEngineSHA256"],
                "comparisonCoreSHA256": native["supplementalCoreSHA256"],
            },
        }
    json.dumps(output, allow_nan=False)
    return output


def encode(record):
    return (
        json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tile", nargs="+", default=["17_25"])
    p.add_argument("--output-dir", type=Path)
    a = p.add_mutually_exclusive_group()
    a.add_argument("--write", action="store_true")
    a.add_argument("--check", action="store_true")
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--reconstruct-normal-build", action="store_true")
    p.add_argument("--comparison-engine", type=Path)
    p.add_argument("--comparison-core", type=Path)
    args = p.parse_args(argv)
    require(not args.overwrite or args.write, "--overwrite requires --write")
    require(
        not (args.write or args.check) or args.output_dir is not None,
        "explicit output directory required",
    )
    require(
        args.reconstruct_normal_build
        or not (args.comparison_engine or args.comparison_core),
        "comparison inputs require --reconstruct-normal-build",
    )
    results = []
    for tile in args.tile:
        data = collect(
            tile,
            normal_build=args.reconstruct_normal_build,
            comparison_engine=args.comparison_engine,
            comparison_core=args.comparison_core,
        )
        payload = encode(data)
        if args.output_dir:
            dest = args.output_dir / (tile + ".terrain-zones.json")
            if args.write:
                write_output(dest, payload, overwrite=args.overwrite)
            if args.check:
                require(
                    dest.read_bytes() == payload,
                    "fresh source output differs: " + str(dest),
                )
        results.append(
            {
                "tile": tile,
                "zones": data["numZones"],
                "terrains": len(data["terrains"]),
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
                "tiles": results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
