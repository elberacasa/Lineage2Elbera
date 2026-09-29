#!/usr/bin/env python3
"""Elbera Tools: exact-byte round trip of original static collision records.

Reads private original maps/packages through the existing audited exporter.
Writes only a JSON evidence receipt to stdout, never assets or scene changes.
The comparison covers saved boxes/arrays/tail fields, not live state or native collision results.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct
import subprocess

from export_static_collision import (
    Audit,
    actor_prop_offset,
    qualified_ref,
    Reader,
    count,
    read_props_ordered,
    serialized_class_record,
)
from l2lib import RF_HAS_STACK, encode_compact, read_properties
from export_npc_visuals import OriginalClasses


def check_class_prefix(package, export, prefix):
    """Re-encode retained prefix fields and compare the exact original span.

    This catches lost fields, changed values and span errors. Native serializer
    qualification, not this round trip, supplies the layout's source evidence.
    """
    refs = prefix["references"]
    if len(refs) != 5:
        raise ValueError("class prefix requires five references")
    encoded = bytearray(
        b"".join(encode_compact(n) for n in [*refs[:4], prefix["name"], refs[4]])
    )
    script = prefix["script"]
    encoded += struct.pack(
        "<iii", prefix["line"], prefix["textPosition"], script["memoryBytes"]
    )
    script_start = len(encoded)
    for row in script["tokens"]:
        if row["offset"] != export.serial_offset + len(encoded):
            raise ValueError("class expression source offset mismatch")
        token = row["token"]
        encoded.append(token)
        if token in (0x00, 0x01, 0x02, 0x13, 0x29, 0x2E):
            encoded += encode_compact(row["reference"])
        elif token in (0x09, 0x18):
            encoded += struct.pack("<H", row["word"])
        elif token in (0x24, 0x2C, 0x39):
            encoded.append(row["byte"])
        elif (
            token
            not in (
                0x08,
                0x0B,
                0x16,
                0x17,
                0x25,
                0x26,
                0x27,
                0x28,
                0x2A,
                0x2D,
                0x30,
                0x31,
            )
            and token < 0x70
        ):
            raise ValueError("unsupported class expression in round trip")
    if (
        script["sourceOffset"] != export.serial_offset + script_start
        or script["sourceBytes"] != len(encoded) - script_start
        or script["sourceSHA256"] != hashlib.sha256(encoded[script_start:]).hexdigest()
    ):
        raise ValueError("class expression source span mismatch")
    state = prefix["state"]
    encoded += struct.pack(
        "<QQHI",
        state["probeMask"],
        state["ignoreMask"],
        state["labelOffset"],
        state["flags"],
    )
    if prefix["flagsOffset"] != export.serial_offset + len(encoded):
        raise ValueError("class flags source offset mismatch")
    fields = prefix["fields"]
    encoded += struct.pack("<5I", fields["0x4a4"], *fields["0x4ac"])
    dependencies = fields["0x4dc"]
    encoded += encode_compact(len(dependencies))
    for row in dependencies:
        encoded += encode_compact(row["reference"]) + struct.pack(
            "<II", row["word4"], row["word8"]
        )
    encoded += encode_compact(len(fields["0x4e8"]))
    encoded += b"".join(encode_compact(n) for n in fields["0x4e8"])
    encoded += encode_compact(fields["0x4bc"]) + encode_compact(fields["0x4c0"])
    encoded += encode_compact(len(fields["0x500"]))
    encoded += b"".join(encode_compact(n) for n in fields["0x500"])
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    digest = hashlib.sha256(encoded).hexdigest()
    if (
        prefix["scope"] != "serialized-class-prefix"
        or prefix["fileVersion"] != package.file_version
        or prefix["exportOffset"] != start
        or prefix["exportLength"] != export.serial_size
        or prefix["exportSHA256"] != hashlib.sha256(package.data[start:end]).hexdigest()
        or prefix["defaultsOffset"] != len(encoded)
        or prefix["sourceBytes"] != len(encoded)
        or prefix["sourceSHA256"] != digest
        or not 0 <= start < start + len(encoded) < end <= len(package.data)
        or package.data[start : start + len(encoded)] != encoded
    ):
        raise ValueError("class prefix does not match original bytes or span")
    return dict(sourceOffset=start, sourceBytes=len(encoded), SHA256=digest)


def check_saved_actor_classes(package, binding):
    """Census saved actor classes and ancestors without claiming live defaults."""
    arrays = [row for row in binding["actorArrays"] if row["nativeField"] == "0x38"]
    if len(arrays) != 1:
        raise ValueError("saved actor array required for class census")
    pending = set()
    for ref in arrays[0]["references"]:
        if not ref:
            continue
        if type(ref) is not int or not 0 < ref <= len(package.exports):
            raise ValueError("class census requires a local saved actor")
        pending.add(qualified_ref(package, package.exports[ref - 1].class_index))
    catalog, records = OriginalClasses(), {}
    while pending:
        qualified = min(pending)
        pending.remove(qualified)
        if qualified.casefold() in records:
            continue
        pkg, ex, source = serialized_class_record(catalog, qualified)
        parent, proof, tags = source["parent"], source["defaults"], source["tags"]
        span = check_class_prefix(pkg, ex, proof["classPrefix"])
        records[qualified.casefold()] = dict(
            sourceClass=qualified,
            parent=parent,
            prefixRoundTrip=span,
            defaults=proof,
            tags=[dict(tag, raw=tag["raw"].hex()) for tag in tags],
        )
        if parent:
            pending.add(parent)
    return dict(
        scope="serialized-saved-actor-classes-and-ancestors",
        sources=catalog.sources,
        classCount=len(records),
        records=list(records.values()),
        limits=[
            "Original serialization only; class construction, script execution, live actor state and collision dispatch remain separate."
        ],
    )


def check_saved_actor_boolean_records(audit, world):
    """Cross-check inherited/saved bits with the generic packed-property reader.

    The separate reader collapses tags, so it checks final named Boolean values
    and framing only. Source tag ordering is retained by the exporter; original
    instruction comparisons establish the property gate/writer separately.
    """
    proof = world["savedActorBooleans"]
    if (
        proof.get("scope") != "saved-actor-declared-booleans"
        or world["tile"] != audit.tile
    ):
        raise ValueError("saved Boolean source scope or tile differs")
    layout = audit.boolean_layout
    fields = {f["name"].casefold(): f["name"] for g in layout for f in g["fields"]}
    catalog, computed, origins, active = OriginalClasses(), {}, {}, set()

    def properties(pkg, start, end):
        reader = Reader(memoryview(pkg.data)[:end], start, pkg.path)
        values = read_properties(pkg, reader, fmt="packed")
        return {name.casefold(): value for name, value in values.items()}, reader.pos

    def apply(previous, properties):
        result = dict(previous)
        for name in fields:
            if name in properties:
                value = properties[name]
                if type(value) is not bool:
                    raise ValueError("generic Boolean decode has a non-Boolean value")
                result[name] = value
        return result

    def groups(values):
        return {
            g["offset"]: dict(
                mask=g["mask"],
                value=sum(
                    f["mask"] for f in g["fields"] if values[f["name"].casefold()]
                ),
            )
            for g in layout
        }

    def inherited(key):
        if key in computed:
            return computed[key]
        if key in active:
            raise ValueError("cyclic retained class defaults")
        active.add(key)
        row = proof["classes"][key]
        pkg, ex, original = serialized_class_record(catalog, row["sourceClass"])
        if key != row["sourceClass"].casefold() or row["parent"] != original["parent"]:
            raise ValueError("retained class identity or ancestor differs from source")
        prefix = row["defaults"]["classPrefix"]
        check_class_prefix(pkg, ex, prefix)
        if row["defaults"] != original["defaults"] or row["tags"] != [
            dict(t, raw=t["raw"].hex()) for t in original["tags"]
        ]:
            raise ValueError("retained class proof or ordered tags differ from source")
        values, consumed = properties(
            pkg,
            ex.serial_offset + prefix["defaultsOffset"],
            ex.serial_offset + ex.serial_size,
        )
        if consumed != ex.serial_offset + ex.serial_size:
            raise ValueError("generic class defaults do not consume the export")
        if key == "core.object":
            if row["parent"] is not None or row["actorBooleans"] is not None:
                raise ValueError("unexpected original root default record")
            current = None
            owners = None
        elif key == "engine.actor":
            if row["parent"] != "Core.Object":
                raise ValueError("unexpected original Actor parent")
            inherited("core.object")
            current = apply({name: False for name in fields}, values)
            owners = {
                name: "zero-initialized-class-default" for name in fields.values()
            }
        else:
            parent = inherited(row["parent"].casefold()) if row["parent"] else None
            if parent is None:
                raise ValueError("retained class is outside Actor ancestry")
            current = apply(parent, values)
            owners = dict(origins[row["parent"].casefold()])
        if current is not None and row["actorBooleans"]["groups"] != groups(current):
            raise ValueError(
                "retained class Boolean defaults differ from original tags"
            )
        if owners is not None:
            owners.update(
                {fields[name]: row["sourceClass"] for name in fields if name in values}
            )
            if row["actorBooleans"]["origins"] != owners:
                raise ValueError(
                    "retained Boolean default origins differ from ancestry"
                )
        computed[key] = current
        origins[key] = owners
        active.remove(key)
        return current

    if set(proof["actors"]) != set(world["savedActorSources"]):
        raise ValueError("saved Boolean records differ from retained actor identities")
    records = []
    for key, identity in world["savedActorSources"].items():
        ref = int(key)
        if key != str(ref) or not 0 < ref <= len(audit.pkg.exports):
            raise ValueError("saved Boolean export reference is invalid")
        ex, saved = audit.pkg.exports[ref - 1], proof["actors"][key]
        if (
            identity["identity"] != qualified_ref(audit.pkg, ref)
            or identity["exportRef"] != ref
            or identity["sourcePackage"] != audit.tile
            or identity["exportSHA256"]
            != hashlib.sha256(
                audit.pkg.data[ex.serial_offset : ex.serial_offset + ex.serial_size]
            ).hexdigest()
        ):
            raise ValueError("saved Boolean actor identity differs from source export")
        cls = qualified_ref(audit.pkg, ex.class_index)
        if (
            cls != identity["classIdentity"]
            or saved["sourceClass"] != cls
            or saved["scope"] != "saved-actor-declared-booleans"
        ):
            raise ValueError("saved Boolean class differs from original export")
        check_actor_frame(audit.pkg, ex, saved["savedStateFrame"])
        start, end = (
            ex.serial_offset + saved["savedStateFrame"]["sourceBytes"],
            ex.serial_offset + ex.serial_size,
        )
        values, consumed = properties(audit.pkg, start, end)
        ordered, used = read_props_ordered(audit.pkg, start, end=end)
        expected_tags = [
            dict(name=fields[p["name"].casefold()], value=p["boolval"])
            for p in ordered
            if p["name"].casefold() in fields
        ]
        if (
            used != consumed
            or saved["tags"] != expected_tags
            or saved["overrides"] != {p["name"]: p["value"] for p in expected_tags}
        ):
            raise ValueError("saved Boolean tag order or overrides differ from source")
        expected = groups(apply(inherited(cls.casefold()), values))
        if saved["groups"] != expected:
            raise ValueError(
                "saved Boolean groups differ from original tags and ancestry"
            )
        for name, lo, hi in [
            ("propertyStream", start, consumed),
            ("nativeTail", consumed, end),
        ]:
            if saved[name] != dict(
                sourceOffset=lo,
                sourceBytes=hi - lo,
                sourceSHA256=hashlib.sha256(audit.pkg.data[lo:hi]).hexdigest(),
            ):
                raise ValueError(
                    "saved Boolean stream or native tail differs from source"
                )
        records.append(
            dict(
                reference=ref,
                sourceClass=cls,
                groups=expected,
                nativeTailBytes=end - consumed,
            )
        )
    if set(proof["classes"]) != set(computed) or proof["sources"] != catalog.sources:
        raise ValueError(
            "retained class set or source fingerprints differ from decoded inputs"
        )
    runtime = (
        Path(__file__).resolve().parents[2] / "editor/world/js/static-world-source.js"
    )
    script = r"""
import {pathToFileURL} from 'node:url';
const {prepareStaticWorldSource}=await import(pathToFileURL(process.argv[1]));
let raw='';for await(const part of process.stdin)raw+=part;
const input=JSON.parse(raw),result=prepareStaticWorldSource(input,input.tile);
if(result.status!=='ready')throw Error(result.reason);
process.stdout.write(JSON.stringify({summary:result.summary,records:Object.keys(input.savedActorSources).map(key=>({
 reference:Number(key),groups:result.actorForReference(Number(key)).savedGroups
}))}));
"""
    ran = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(runtime)],
        input=json.dumps(world),
        capture_output=True,
        text=True,
        check=True,
    )
    loaded = json.loads(ran.stdout)
    if loaded["records"] != [
        dict(reference=r["reference"], groups=r["groups"]) for r in records
    ]:
        raise ValueError("scene loader saved groups differ from checked source records")
    return dict(
        scope="saved declared fields; subclass lifecycle and current collision remain unresolved",
        cases=len(records),
        classes=len(computed),
        classesWithSavedCollision=sorted(
            {
                r["sourceClass"]
                for r in records
                if any(
                    f["name"] == "bCollideActors"
                    and r["groups"][g["offset"]]["value"] & f["mask"]
                    for g in layout
                    for f in g["fields"]
                )
            }
        ),
        opaqueNativeTails=sum(r["nativeTailBytes"] > 0 for r in records),
        browserSummary=loaded["summary"],
        records=records,
        runtimeSHA256=hashlib.sha256(runtime.read_bytes()).hexdigest(),
    )


def check_actor_frame(package, export, saved):
    """Re-encode retained frame fields against the bounded original prefix."""
    if (
        saved.get("scope") != "saved-map-state-frame"
        or saved.get("savedExportFlags") != export.object_flags
        or not export.object_flags & RF_HAS_STACK
        or saved.get("classIdentity") != qualified_ref(package, export.class_index)
    ):
        raise ValueError("saved actor frame identity differs from export")
    for name in (
        "node",
        "stateNode",
        "word28",
        "codeOffset",
        "sourceOffset",
        "sourceBytes",
    ):
        if type(saved.get(name)) is not int:
            raise ValueError("saved actor frame scalar is not an integer")
    if (
        saved["node"] != export.class_index
        or saved["stateNode"] != export.class_index
        or not saved["node"]
        or saved["codeOffset"] != -1
        or not 0 <= saved["word28"] <= 0xFFFFFFFF
        or saved.get("probeMaskWords") != [0xFFFFFFFF, 0xFFFFFFFF]
        or any(type(word) is not int for word in saved["probeMaskWords"])
    ):
        raise ValueError("unsupported saved actor frame fields")
    encoded = (
        encode_compact(saved["node"])
        + encode_compact(saved["stateNode"])
        + struct.pack("<III", *saved["probeMaskWords"], saved["word28"])
        + encode_compact(saved["codeOffset"])
    )
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if (
        not 0 <= start < start + len(encoded) <= end <= len(package.data)
        or bytes(package.data[start : start + len(encoded)]) != encoded
        or saved.get("sourceOffset") != start
        or saved.get("sourceBytes") != len(encoded)
        or saved.get("sourceSHA256") != hashlib.sha256(encoded).hexdigest()
    ):
        raise ValueError("saved actor frame differs from original prefix")
    return dict(
        bytes=len(encoded), SHA256=saved["sourceSHA256"], word28=saved["word28"]
    )


def check_level_collision_mode(package, binding, saved, defaults):
    """Check the first actor's mode record against original bytes, then load it.

    Declaration/default construction is qualified separately. This check does
    not turn a saved property into a later live startup value.
    """
    array = next(row for row in binding["actorArrays"] if row["nativeField"] == "0x38")
    ref = array["references"][0]
    if (
        type(ref) is not int
        or not 0 < ref <= len(package.exports)
        or saved.get("reference") != ref
        or saved.get("scope") != "saved-level-info-collision-mode"
    ):
        raise ValueError("LevelInfo mode identity differs from first actor slot")
    export = package.exports[ref - 1]
    if (
        qualified_ref(package, export.class_index) != "Engine.LevelInfo"
        or saved.get("sourceClass") != "Engine.LevelInfo"
        or saved.get("identity") != qualified_ref(package, ref)
        or saved.get("savedExportFlags") != export.object_flags
    ):
        raise ValueError("LevelInfo mode class or export identity differs")
    frame = check_actor_frame(package, export, saved["savedStateFrame"])
    start, end = (
        export.serial_offset + frame["bytes"],
        export.serial_offset + export.serial_size,
    )
    if (
        saved.get("exportOffset") != export.serial_offset
        or saved.get("exportLength") != export.serial_size
        or saved.get("exportSHA256")
        != hashlib.sha256(package.data[export.serial_offset : end]).hexdigest()
        or saved.get("propertiesOffset") != start
        or saved.get("propertiesLength") != end - start
        or saved.get("propertiesSHA256")
        != hashlib.sha256(package.data[start:end]).hexdigest()
    ):
        raise ValueError("LevelInfo mode source span or hash differs")
    layout, words = defaults["layout"], defaults["defaultGroups"]
    if (
        len(layout) != 1
        or layout[0]["offset"] != "0x554"
        or layout[0]["mask"] != 7
        or words["0x554"]["mask"] != 7
    ):
        raise ValueError("LevelInfo mode declaration mask differs")
    fields = {field["name"]: field for field in layout[0]["fields"]}
    tags, actual = read_props_ordered(package, start, end=end)
    reader = Reader(memoryview(package.data)[:end], start, package.path)
    values = read_properties(package, reader)
    if actual != end or reader.pos != end:
        raise ValueError("LevelInfo mode properties do not end at export boundary")
    ordered = []
    for tag in tags:
        if tag["name"] not in fields:
            continue
        if tag["type"] != 3 or tag["index"] != 0 or type(tag["boolval"]) is not bool:
            raise ValueError("malformed LevelInfo Boolean property")
        ordered.append(dict(name=tag["name"], value=tag["boolval"]))
    expected = words["0x554"]["value"]
    for name, field in fields.items():
        if name not in values:
            continue
        if type(values[name]) is not bool:
            raise ValueError("LevelInfo mode value is not Boolean")
        expected = (
            expected | field["mask"] if values[name] else expected & ~field["mask"]
        )
    if saved.get("tags") != ordered or saved.get("groups") != {
        "0x554": dict(mask=7, value=expected)
    }:
        raise ValueError("LevelInfo mode record differs from original defaults or tags")
    loaded = check_boolean_preparation(
        [
            dict(
                name=saved["identity"],
                savedCollisionFlags=dict(tags=ordered, groups=saved["groups"]),
            )
        ],
        layout,
        words,
    )
    if loaded["differsFromSaved"] or loaded["skippedTags"]:
        raise ValueError("LevelInfo mode property loading differs from saved values")
    return dict(
        identity=saved["identity"],
        declaredBits=saved["groups"],
        tags=len(ordered),
        frame=frame,
        persistentBooleanPreparation=loaded,
        scope="source defaults and original saved first actor; later startup mode is separate",
    )


def check_level_actor_order(package, binding, actors):
    """Round-trip both saved arrays and each audited export's slot membership."""
    arrays = binding["actorArrays"]
    if [row["nativeField"] for row in arrays] != ["0x48", "0x38"]:
        raise ValueError("unknown saved Level reference arrays")
    checked, slots = [], {}
    for row in arrays:
        field, refs = row["nativeField"], row["references"]
        if (
            not isinstance(refs, list)
            or any(type(ref) is not int for ref in refs)
            or row["count"] != len(refs)
            or row["duplicateCount"] != len(refs)
        ):
            raise ValueError("inconsistent saved Level reference count")
        a, b = binding["spans"]["array" + field]
        if not 0 <= a < b <= len(package.data):
            raise ValueError("saved Level reference span escapes package")
        encoded = struct.pack("<ii", len(refs), len(refs)) + b"".join(
            map(encode_compact, refs)
        )
        if encoded != bytes(package.data[a:b]):
            raise ValueError("saved Level reference order differs from source")
        present = [ref for ref in refs if ref]
        checked.append(
            dict(
                nativeField=field,
                count=len(refs),
                nullSlots=refs.count(0),
                repeatedNonNullSlots=len(present) - len(set(present)),
                SHA256=hashlib.sha256(encoded).hexdigest(),
            )
        )
        if field == "0x38":
            for slot, ref in enumerate(refs):
                slots.setdefault(ref, []).append(slot)
    seen = set()
    for actor in actors:
        ref = actor["exportRef"]
        if type(ref) is not int or ref <= 0 or ref in seen:
            raise ValueError("ambiguous audited actor export reference")
        seen.add(ref)
        if actor["savedLevelSlots"] != slots.get(ref, []):
            raise ValueError("saved actor slot membership differs from source")
    return dict(
        arrays=checked,
        auditedActors=len(actors),
        actorsInSavedLevel=sum(bool(a["savedLevelSlots"]) for a in actors),
        actorsAbsentFromSavedLevel=sum(not a["savedLevelSlots"] for a in actors),
        auditedActorSlots=sum(len(a["savedLevelSlots"]) for a in actors),
        scope="saved-source-order; not current population",
    )


def check_actor_flags(package, export, saved, defaults, layout):
    """Check declared bits and overrides without filling unknown padding."""
    if saved.get("scope") != "saved-map-and-class-defaults":
        raise ValueError("unknown actor Boolean scope")
    names = {field["name"] for group in layout for field in group["fields"]}
    values = {name: defaults.get(name) for name in names}
    if any(type(value) is not bool for value in values.values()):
        raise ValueError("missing qualified Boolean default")
    off = actor_prop_offset(package, export)
    if off is None:
        raise ValueError("unsupported actor property framing")
    end = export.serial_offset + export.serial_size
    tags, actual = read_props_ordered(package, export.serial_offset + off, end=end)
    if actual != end:
        raise ValueError("actor Boolean properties exceed export")
    overrides = {}
    for tag in tags:
        name = tag["name"]
        if name not in names:
            continue
        if (
            name in overrides
            or tag["type"] != 3
            or tag["index"] != 0
            or tag["struct"] is not None
        ):
            raise ValueError("unsupported saved actor Boolean property")
        overrides[name] = tag["boolval"]
        values[name] = tag["boolval"]
    groups = {}
    for group in layout:
        bits = group["fields"]
        mask = sum(field["mask"] for field in bits)
        if mask != group["mask"]:
            raise ValueError("inconsistent declared actor Boolean mask")
        value = sum(field["mask"] for field in bits if values[field["name"]])
        groups[group["offset"]] = dict(mask=mask, value=value)
    if saved["groups"] != groups or saved["overrides"] != overrides:
        raise ValueError(
            "actor Boolean record differs from original properties/defaults"
        )
    ordered = [
        dict(name=tag["name"], value=tag["boolval"])
        for tag in tags
        if tag["name"] in values
    ]
    if saved.get("tags") != ordered:
        raise ValueError("saved Boolean tag order differs from original properties")
    return dict(groups=groups, overrideCount=len(overrides))


def check_actor_references(package, export, saved, defaults):
    """Re-encode each map reference and check its full qualified identity.

    Defaults retain the class/source package recorded by the default reader.
    This checks transport; it does not resolve native pointers or transient tags.
    """
    if saved.get("scope") != "saved-map-and-class-defaults" or set(
        saved["fields"]
    ) != set(defaults):
        raise ValueError("unknown actor reference scope or fields")
    off = actor_prop_offset(package, export)
    if off is None:
        raise ValueError("unsupported actor property framing")
    end = export.serial_offset + export.serial_size
    tags, actual = read_props_ordered(package, export.serial_offset + off, end=end)
    if actual != end:
        raise ValueError("actor reference properties exceed export")
    checked = []
    for name, value in saved["fields"].items():
        matches = [tag for tag in tags if tag["name"] == name]
        if not matches:
            if value != defaults[name]:
                raise ValueError("actor reference differs from qualified default")
        else:
            if len(matches) != 1:
                raise ValueError("duplicate saved actor reference property")
            tag = matches[0]
            reference = value["reference"]
            if (
                type(reference) is not int
                or tag["type"] != 5
                or tag.get("struct") is not None
                or tag.get("index", 0) != 0
                or tag["raw"] != encode_compact(reference)
                or value
                != dict(
                    reference=reference,
                    qualified=qualified_ref(package, reference) if reference else None,
                    package=Path(package.path).stem,
                    origin="map-property",
                )
            ):
                raise ValueError("actor reference differs from original property")
        checked.append(dict(name=name, **value))
    ordered = [
        dict(
            name=tag["name"],
            reference=saved["fields"][tag["name"]]["reference"],
            package=Path(package.path).stem,
        )
        for tag in tags
        if tag["name"] in defaults
    ]
    if saved.get("tags") != ordered:
        raise ValueError("saved reference tag order differs from original properties")
    return checked


def check_actor_transform(package, export, saved, defaults):
    """Round-trip each saved operand; defaults remain separately identified.

    This checks record transport, not current fields or the actor lifecycle.
    """
    if saved.get("scope") != "saved-map-and-class-defaults":
        raise ValueError("unknown actor transform scope")
    off = actor_prop_offset(package, export)
    if off is None:
        raise ValueError("unsupported actor property framing")
    end = export.serial_offset + export.serial_size
    tags, actual = read_props_ordered(package, export.serial_offset + off, end=end)
    if actual != end:
        raise ValueError("actor transform properties exceed export")
    checked = []
    fields_by_name = {}
    for key, name, fmt, kind, structure in [
        ("location", "Location", "<3f", 10, "Vector"),
        ("rotation", "Rotation", "<3i", 10, "Rotator"),
        ("drawScale", "DrawScale", "<f", 4, None),
        ("drawScale3D", "DrawScale3D", "<3f", 10, "Vector"),
        ("prePivot", "PrePivot", "<3f", 10, "Vector"),
    ]:
        value = saved["fields"][key]
        fields_by_name[name] = (value, fmt)
        raw = (
            struct.pack(fmt, *value)
            if isinstance(value, list)
            else struct.pack(fmt, value)
        )
        matches = [tag for tag in tags if tag["name"] == name]
        if matches:
            if len(matches) != 1:
                raise ValueError("duplicate saved actor transform property")
            tag = matches[0]
            if (
                saved["origins"][key] != "map-property"
                or tag["type"] != kind
                or tag["struct"] != structure
                or tag["index"] != 0
                or tag["raw"] != raw
            ):
                raise ValueError("actor transform differs from original property")
        else:
            expected = defaults[name]
            original = (
                struct.pack(fmt, *expected)
                if isinstance(expected, list)
                else struct.pack(fmt, expected)
            )
            if saved["origins"][key] != "inherited-class-default" or raw != original:
                raise ValueError("actor transform differs from qualified default")
        checked.append(
            dict(
                field=key,
                origin=saved["origins"][key],
                bytes=len(raw),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    ordered = [
        dict(name=tag["name"], value=fields_by_name[tag["name"]][0])
        for tag in tags
        if tag["name"] in fields_by_name
    ]
    if len(saved.get("tags", [])) != len(ordered):
        raise ValueError("saved transform tag count differs from original properties")
    for actual, expected in zip(saved["tags"], ordered):
        if actual.get("name") != expected["name"]:
            raise ValueError(
                "saved transform tag order differs from original properties"
            )
        fmt = fields_by_name[expected["name"]][1]

        def packed(value):
            return (
                struct.pack(fmt, *value)
                if isinstance(value, list)
                else struct.pack(fmt, value)
            )

        if packed(actual["value"]) != packed(expected["value"]):
            raise ValueError(
                "saved transform tag value differs from original properties"
            )
    return checked


def check_properties(package, export, native_offset):
    """Census ordered saved tags; never infer current flags from the export."""
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    tags, actual = read_props_ordered(package, start, end=end)
    if actual != native_offset:
        raise ValueError("property terminator differs from native mesh body offset")
    reader = Reader(memoryview(package.data)[:end], start, package.path)
    legacy = read_properties(package, reader)
    values = {
        tag["name"]: tag["boolval"] if tag["type"] == 3 else tag["raw"] for tag in tags
    }
    if reader.pos != actual or legacy != values:
        raise ValueError("ordered properties differ from mesh decoder")
    counts = Counter(tag["name"].casefold() for tag in tags)
    header_names = {"objectinternal", "objectflags", "outer", "name", "class"}
    return dict(
        sourceOffset=start,
        sourceBytes=actual - start,
        sourceSHA256=hashlib.sha256(package.data[start:actual]).hexdigest(),
        savedExportFlags=export.object_flags,
        tags=[
            dict(
                name=tag["name"],
                type=tag["type"],
                index=tag["index"],
                size=tag["size"],
                struct=tag["struct"],
                boolean=tag["boolval"] if tag["type"] == 3 else None,
                payloadSHA256=hashlib.sha256(tag["raw"]).hexdigest(),
            )
            for tag in tags
        ],
        duplicateNames=sorted(name for name, count in counts.items() if count > 1),
        nativeHeaderTags=[
            tag["name"] for tag in tags if tag["name"].casefold() in header_names
        ],
    )


def check_actor_loading(package, export, saved):
    """Check the whole saved tag census used to admit a fresh actor header."""
    offset = actor_prop_offset(package, export)
    if offset is None:
        raise ValueError("unsupported actor property framing")
    start, end = (
        export.serial_offset + offset,
        export.serial_offset + export.serial_size,
    )
    tags, actual = read_props_ordered(package, start, end=end)
    expected = dict(
        scope="saved-actor-loading-inputs",
        fileVersion=package.file_version,
        sourceOffset=start,
        sourceBytes=end - start,
        sourceSHA256=hashlib.sha256(package.data[start:end]).hexdigest(),
        attachedOverrideCount=sum(t["name"] == "Attached" for t in tags),
        tags=[
            {key: t[key] for key in ("name", "type", "index", "struct")} for t in tags
        ],
    )
    if actual != end or saved != expected:
        raise ValueError("saved actor loading census differs from original properties")
    return dict(
        tags=len(tags),
        attachedOverrides=expected["attachedOverrideCount"],
        nativeHeaderTags=[
            t["name"]
            for t in tags
            if t["name"].lower()
            in ("objectinternal", "objectflags", "outer", "name", "class")
        ],
    )


def check_arrays(source, data):
    """Re-encode decoded records and compare original payload and lazy framing."""
    tree = data["collisionTree"]
    triangles = bytearray(encode_compact(data["collisionTriangleCount"]))
    for index, planes in enumerate(tree["trianglePlanes"]):
        triangles += struct.pack("<16f", *planes)
        for value in data["indices"][3 * index : 3 * index + 3] + [
            data["materials"][index]
        ]:
            triangles += encode_compact(value)
    nodes = bytearray(encode_compact(len(tree["nodes"])))
    for node in tree["nodes"]:
        nodes += b"".join(encode_compact(value) for value in node["links"])
        nodes += struct.pack("<6fB", *node["bounds"], node["valid"])
    cursor, spans = data["collisionOffset"], []
    for payload in (triangles, nodes):
        if data["collisionArrayLayout"] == "lazy-saved-end":
            saved_end = struct.unpack_from("<i", source, cursor)[0]
            cursor += 4
            if saved_end != cursor + len(payload):
                raise ValueError("re-encoded array does not match original saved end")
        original = bytes(source[cursor : cursor + len(payload)])
        if original != payload:
            raise ValueError("re-encoded collision records differ from original bytes")
        spans.append(
            dict(
                start=cursor,
                bytes=len(payload),
                SHA256=hashlib.sha256(original).hexdigest(),
            )
        )
        cursor += len(payload)
    return spans


def check_bounds(source, data):
    """Check both box records and derive their offsets from the native prefix."""
    start = data["nativeBodyOffset"]
    if type(start) is not int or start < 0:
        raise ValueError("invalid native body offset")
    reader = Reader(source, start)
    reader.bytes(41)
    reader.bytes(count(reader) * 14)
    expected = [start, reader.pos]
    spans = []
    for key, offset in zip(["baseSerializedBounds", "savedLocalBounds"], expected):
        box = data[key]
        if box["sourceOffset"] != offset or box["sourceBytes"] != 25:
            raise ValueError("serialized box span differs from native prefix")
        payload = struct.pack("<6fB", *box["min"], *box["max"], box["valid"])
        original = bytes(source[offset : offset + 25])
        digest = hashlib.sha256(original).hexdigest()
        if payload != original or digest != box["sourceSHA256"]:
            raise ValueError("re-encoded box differs from original bytes or hash")
        spans.append(dict(record=key, start=offset, bytes=25, SHA256=digest))
    return spans


def check_load_tail(source, data, *, array_end, export_end):
    """Re-encode tail fields around a hash-checked, explicitly opaque payload."""
    tail = data["loadTail"]
    cursor = array_end
    fields = tail["fields"]
    licensee = data["licenseeVersion"]
    if (
        type(data["fileVersion"]) is not int
        or data["fileVersion"] != 123
        or type(licensee) is not int
        or not 0 <= licensee <= 65535
    ):
        raise ValueError("unsupported mesh load-tail source version")

    def check_span(record, offset, payload):
        end = offset + len(payload)
        if not 0 <= offset <= end <= export_end <= len(source):
            raise ValueError("load-tail span exceeds original export")
        if record["sourceOffset"] != offset or record["sourceBytes"] != len(payload):
            raise ValueError("load-tail span differs from source layout")
        if (
            bytes(source[offset:end]) != payload
            or hashlib.sha256(payload).hexdigest() != record["sourceSHA256"]
        ):
            raise ValueError("re-encoded load-tail differs from original bytes or hash")

    expected = []
    if licensee >= 6:
        expected += [
            ("0x194", "u32"),
            ("0x198", "compact-reference"),
            ("0x19c", "compact-reference"),
            ("0x1a0", "u32"),
            ("0x1a4", "u32"),
        ]
    for minimum, offsets in [
        (7, [0x1A8, 0x1AC]),
        (11, [0x1B0]),
        (13, [0x1B4]),
        (14, [0x1B8, 0x1BC]),
        (15, [0x1C0]),
    ]:
        if licensee >= minimum:
            expected += [(hex(offset), "u32") for offset in offsets]
    final = [("0x1dc", "i32"), ("0x1f0", "compact-reference"), ("0x1e0", "u32")]
    if set(fields) != {key for key, _ in expected + final}:
        raise ValueError("load-tail fields differ from source version")

    def encoded_fields(layout):
        nonlocal cursor
        for key, encoding in layout:
            record = fields[key]
            if record["encoding"] != encoding or type(record["value"]) is not int:
                raise ValueError("load-tail field encoding differs from source")
            payload = (
                encode_compact(record["value"])
                if encoding == "compact-reference"
                else struct.pack("<i" if encoding == "i32" else "<I", record["value"])
            )
            check_span(record, cursor, payload)
            cursor += len(payload)

    encoded_fields(expected)
    lazy = tail["lazyArray1c4"]
    saved_end = lazy["savedEnd"]
    if type(saved_end) is not int or not cursor + 4 < saved_end <= export_end:
        raise ValueError("invalid load-tail lazy saved end")
    opaque = bytes(source[cursor + 4 : saved_end])
    check_span(lazy["payload"], cursor + 4, opaque)
    check_span(lazy, cursor, struct.pack("<i", saved_end) + opaque)
    cursor = saved_end
    encoded_fields(final)
    if cursor != export_end:
        raise ValueError("load-tail does not end at original export boundary")
    check_span(tail, array_end, bytes(source[array_end:cursor]))
    return dict(
        start=array_end,
        bytes=cursor - array_end,
        SHA256=tail["sourceSHA256"],
        savedMeshVersion=fields["0x1dc"]["value"],
        opaqueLazyPayloadBytes=len(opaque),
    )


def check_fresh_preparation(geometry, class_flags=None):
    """Exercise the browser with decoded loading bits or an explicit override.

    No default class word is invented. An override remains diagnostic input.
    """
    if class_flags is not None and (
        type(class_flags) is not int or not 0 <= class_flags <= 0xFFFFFFFF
    ):
        raise ValueError("current class flags must be an unsigned DWORD")
    runtime = (
        Path(__file__).resolve().parents[2] / "editor/world/js/static-mesh-tree.js"
    )
    script = """
import fs from 'node:fs';
const {prepareFreshStaticMeshTree}=await import(process.argv[1]);
const {geometry,classFlags}=JSON.parse(fs.readFileSync(0,'utf8'));
const rows=Object.entries(geometry).map(([mesh,source])=>{
 const r=prepareFreshStaticMeshTree(source,classFlags===null?undefined:{classFlags});
 if(r.status!=='ready')throw Error(`${mesh}: ${JSON.stringify(r)}`);
 return {mesh,loadingFlags:r.loadingFlags,objectFlags:r.postLoadWrites.objectFlags,
         vertexCount:r.postLoadWrites.vertexArray.count};
});
process.stdout.write(JSON.stringify(rows));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, runtime.as_uri()],
        input=json.dumps(dict(geometry=geometry, classFlags=class_flags)),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise ValueError("browser preparation failed: " + result.stderr.strip())
    rows = json.loads(result.stdout)
    if len(rows) != len(geometry):
        raise ValueError("browser preparation omitted source records")
    return dict(
        cases=len(rows),
        classFlags=class_flags,
        classStateEvidence=(
            "decoded original native-registration loading bits"
            if class_flags is None
            else "explicit diagnostic input, not recovered runtime state"
        ),
        runtimeSHA256=hashlib.sha256(runtime.read_bytes()).hexdigest(),
        records=rows,
    )


def check_boolean_preparation(actors, layout, defaults):
    """Exercise actual saved tags with explicit persistent-load/CDO inputs.

    Native differential verification is separate. This does not establish later
    lifecycle state, class-default copying, reference resolution or map admission.
    """
    runtime = Path(__file__).resolve().parents[2] / "editor/world/js/actor-loading.js"
    selected = [row for row in actors if "savedCollisionFlags" in row]
    script = r"""
import { pathToFileURL } from 'node:url';
const { applyActorBooleanTags } = await import(pathToFileURL(process.argv[1]));
let raw=''; for await (const part of process.stdin) raw+=part;
const input=JSON.parse(raw);
const results=input.actors.map(actor=>{
  const tags=actor.savedCollisionFlags.tags;
  const result=applyActorBooleanTags({layout:input.layout,words:input.defaults,tags,
    archive:{loading:true,saving:false,persistent:true}});
  if(result.status!=='ready') throw Error(actor.name+': '+result.reason);
  return {actor:actor.name, groups:result.groups, skipped:result.skipped.map(i=>tags[i].name),
    differsFromSaved:Object.keys(result.groups).some(key=>result.groups[key].value!==actor.savedCollisionFlags.groups[key].value)};
});
process.stdout.write(JSON.stringify(results));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(runtime)],
        input=json.dumps(dict(actors=selected, layout=layout, defaults=defaults)),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise ValueError("browser Boolean preparation failed: " + result.stderr.strip())
    records = json.loads(result.stdout)
    if [row["actor"] for row in records] != [row["name"] for row in selected]:
        raise ValueError("browser Boolean preparation changed the source actor list")
    return dict(
        cases=len(records),
        scope="source defaults and saved tags under explicit persistent-loading modes; not live state",
        skippedTags=dict(Counter(name for row in records for name in row["skipped"])),
        differsFromSaved=sum(row["differsFromSaved"] for row in records),
        runtimeSHA256=hashlib.sha256(runtime.read_bytes()).hexdigest(),
        records=records,
    )


def check_reference_preparation(audit, actors):
    """Join saved references to prepared mesh objects using exact source exports.

    This models a fresh browser registry for these inputs. It does not certify
    a current native registry, complete import discovery or LevelInfo lifecycle.
    """
    runtime = Path(__file__).resolve().parents[2] / "editor/world/js/actor-loading.js"
    selected = [row for row in actors if "savedReferences" in row]
    bindings = audit.reference_bindings(selected)
    script = r"""
import {pathToFileURL} from 'node:url';
const url=pathToFileURL(process.argv[1]);
const {prepareSourceStaticActors}=await import(new URL('./static-world-source.js',url));
let raw='';for await(const part of process.stdin)raw+=part;
const input=JSON.parse(raw), prepared=prepareSourceStaticActors(input);
if(prepared.status!=='ready')throw Error(prepared.reason);
if([...prepared.resources.values()].some(resource=>resource.status!=='ready'))throw Error('unprepared source mesh');
const records=input.actors.map(actor=>{
 const result=prepared.actors.get(actor.exportRef);
 if(result.status!=='ready')throw Error(actor.name+': '+result.reason);
 const references=Object.fromEntries(Object.entries(result.references).map(([name,object])=>[name,object===null?null:object.identity]));
 if(!result.references.StaticMesh?.resource)throw Error('actor has no prepared mesh resource');
 const transformWords=Object.fromEntries(Object.entries(result.transform).map(([name,value])=>[name,
  (Array.isArray(value)?value:[value]).map(v=>{const data=new DataView(new ArrayBuffer(4));
   if(name==='rotation')data.setInt32(0,v,true);else data.setFloat32(0,v,true);
   return data.getUint32(0,true);})]));
 return {actor:actor.name,references,preparedMesh:result.references.StaticMesh.identity,
  transformWords,groups:result.groups,
  loadingFlags:result.loadingFlags,postLoadWrites:result.postLoadWrites,attached:result.attached,
  skipped:result.skipped.references.map(i=>actor.savedReferences.tags[i].name),
  skippedTransformTags:result.skipped.transforms,
  skippedBooleanTags:result.skipped.booleans};
});
process.stdout.write(JSON.stringify({records,uniqueObjects:prepared.objects.size,preparedMeshes:prepared.resources.size,factoryCalls:prepared.factoryCalls}));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(runtime)],
        input=json.dumps(
            dict(
                actors=selected,
                geometry=audit.geometry,
                bindings=bindings,
                actorDefaults=audit.defaults[-1],
                classLoading=audit.actor_class_loading,
            )
        ),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise ValueError(
            "browser reference preparation failed: " + result.stderr.strip()
        )
    output = json.loads(result.stdout)
    if [row["actor"] for row in output["records"]] != [row["name"] for row in selected]:
        raise ValueError("browser reference preparation changed the actor list")
    for actor, loaded in zip(selected, output["records"]):
        if (
            loaded["attached"] != []
            or loaded["postLoadWrites"]["swayRotationOrig"]
            != actor["savedTransform"]["fields"]["rotation"]
        ):
            raise ValueError("fresh actor PostLoad result differs from source inputs")
        for name, value in actor["savedTransform"]["fields"].items():
            fmt = (
                "<3i" if name == "rotation" else "<f" if name == "drawScale" else "<3f"
            )

            def packed(v):
                return (
                    struct.pack(fmt, *v) if isinstance(v, list) else struct.pack(fmt, v)
                )

            if packed(value) != struct.pack(
                "<" + "I" * len(loaded["transformWords"][name]),
                *loaded["transformWords"][name]
            ):
                raise ValueError("loaded transform differs from retained source fields")
        if loaded["groups"] != actor["savedCollisionFlags"]["groups"]:
            raise ValueError("loaded Boolean groups differ from retained source fields")
        if loaded["skippedTransformTags"] or loaded["skippedBooleanTags"]:
            raise ValueError(
                "original map contains a skipped transform or Boolean override"
            )
        expected = {
            name: field["qualified"]
            for name, field in actor["savedReferences"]["fields"].items()
        }
        # These maps have no transient override. Do not silently treat a new
        # saved transient value as the loaded value if a future input adds one.
        if {
            name: value.casefold() if value else None
            for name, value in loaded["references"].items()
        } != {
            name: value.casefold() if value else None
            for name, value in expected.items()
        }:
            raise ValueError("loaded source references differ from retained inputs")
    return dict(
        cases=len(selected),
        scope="fresh source-linked browser objects; current native registry and complete level lifecycle unproven",
        uniqueObjects=output["uniqueObjects"],
        preparedMeshes=output["preparedMeshes"],
        factoryCalls=output["factoryCalls"],
        skippedTags=dict(
            Counter(name for row in output["records"] for name in row["skipped"])
        ),
        runtimeSHA256=hashlib.sha256(runtime.read_bytes()).hexdigest(),
        preparationRuntimeSHA256=hashlib.sha256(
            runtime.with_name("static-world-source.js").read_bytes()
        ).hexdigest(),
        propertyFamiliesJoined=["transforms", "Booleans", "references"],
        lifecycleScope="fresh collision fields through bounded original actor PostLoad; no level population or gameplay",
        records=output["records"],
    )


def verify(tile, *, fresh_class_flags=None):
    audit = Audit(tile, retain_sweep_data=True)
    actors = audit.actors()
    report = audit.report(actors)
    saved_booleans = check_saved_actor_boolean_records(
        audit, audit.world_source_output(actors)
    )
    level_order = check_level_actor_order(audit.pkg, audit.level_binding, actors)
    actor_transforms, actor_flags, actor_references, actor_frames = [], [], [], []
    for actor in actors:
        if not any(
            key in actor
            for key in (
                "savedTransform",
                "savedCollisionFlags",
                "savedReferences",
                "savedStateFrame",
            )
        ):
            continue
        matches = [
            e
            for e in audit.pkg.exports
            if audit.pkg.class_name_of(e) == "StaticMeshActor"
            and audit.pkg.export_name(e) == actor["name"]
        ]
        if len(matches) != 1:
            raise ValueError("ambiguous saved actor transform identity")
        if "savedStateFrame" in actor:
            check_actor_loading(audit.pkg, matches[0], actor["savedActorLoading"])
            actor_frames.append(
                dict(
                    actor=actor["name"],
                    **check_actor_frame(audit.pkg, matches[0], actor["savedStateFrame"])
                )
            )
        if "savedTransform" in actor:
            actor_transforms.append(
                dict(
                    actor=actor["name"],
                    sourceExportSHA256=actor["exportSHA256"],
                    fields=check_actor_transform(
                        audit.pkg, matches[0], actor["savedTransform"], audit.inherited
                    ),
                )
            )
        if "savedCollisionFlags" in actor:
            actor_flags.append(
                dict(
                    actor=actor["name"],
                    sourceExportSHA256=actor["exportSHA256"],
                    **check_actor_flags(
                        audit.pkg,
                        matches[0],
                        actor["savedCollisionFlags"],
                        audit.inherited,
                        audit.boolean_layout,
                    )
                )
            )
        if "savedReferences" in actor:
            actor_references.append(
                dict(
                    actor=actor["name"],
                    sourceExportSHA256=actor["exportSHA256"],
                    fields=check_actor_references(
                        audit.pkg,
                        matches[0],
                        actor["savedReferences"],
                        audit.reference_defaults,
                    ),
                )
            )
    records, layouts = [], Counter()
    for name, data in sorted(audit.geometry.items()):
        package = audit.packages[name.split(".")[0]]
        export = next(
            e
            for e in package.exports
            if package.class_name_of(e) == "StaticMesh"
            and qualified_ref(package, e.index + 1).casefold() == name.casefold()
        )
        assert (
            hashlib.sha256(
                package.data[
                    export.serial_offset : export.serial_offset + export.serial_size
                ]
            ).hexdigest()
            == data["exportSHA256"]
        )
        saved = check_properties(package, export, data["nativeBodyOffset"])
        assert data["sourceClass"] == qualified_ref(package, export.class_index)
        assert data["savedProperties"] == dict(
            savedExportFlags=saved["savedExportFlags"],
            tags=[
                {key: tag[key] for key in ("name", "type", "index", "struct")}
                for tag in saved["tags"]
            ],
        )
        spans = check_arrays(package.data, data)
        bounds = check_bounds(package.data, data)
        tail = check_load_tail(
            package.data,
            data,
            array_end=spans[-1]["start"] + spans[-1]["bytes"],
            export_end=export.serial_offset + export.serial_size,
        )
        layouts[data["collisionArrayLayout"]] += 1
        records.append(
            dict(
                mesh=name,
                triangles=data["collisionTriangleCount"],
                nodes=data["collisionNodeCount"],
                sourceExportSHA256=data["exportSHA256"],
                arrays=spans,
                bounds=bounds,
                loadTail=tail,
                savedProperties=saved,
                overwrittenBoundsDiffer=bounds[0]["SHA256"] != bounds[1]["SHA256"],
            )
        )
    if not records:
        raise ValueError("no source collision records qualified for comparison")
    return dict(
        tool="Elbera Tools",
        status="pass",
        tile=tile,
        sources=audit.sources,
        selection=report["summary"],
        actorTransforms=actor_transforms,
        actorFlags=actor_flags,
        actorReferences=actor_references,
        actorStateFrames=actor_frames,
        levelActorOrder=level_order,
        savedActorClasses=check_saved_actor_classes(audit.pkg, audit.level_binding),
        savedActorBooleans=saved_booleans,
        levelCollisionMode=check_level_collision_mode(
            audit.pkg, audit.level_binding, audit.level_mode, audit.level_mode_defaults
        ),
        classDefaults=audit.defaults,
        actorClassLoading=audit.actor_class_loading,
        persistentBooleanPreparation=check_boolean_preparation(
            actors,
            audit.boolean_layout,
            audit.defaults[-1]["collisionBooleans"]["defaultGroups"],
        ),
        persistentReferencePreparation=check_reference_preparation(audit, actors),
        meshes=len(records),
        triangles=sum(row["triangles"] for row in records),
        nodes=sum(row["nodes"] for row in records),
        layouts=dict(layouts),
        boundsRecords=len(records) * 2,
        overwrittenBoundsDiffer=sum(row["overwrittenBoundsDiffer"] for row in records),
        savedMeshVersions=dict(
            Counter(str(row["loadTail"]["savedMeshVersion"]) for row in records)
        ),
        savedExportFlags=dict(
            Counter(hex(row["savedProperties"]["savedExportFlags"]) for row in records)
        ),
        meshHeaderTagRecords=sum(
            bool(row["savedProperties"]["nativeHeaderTags"]) for row in records
        ),
        meshDuplicateTagRecords=sum(
            bool(row["savedProperties"]["duplicateNames"]) for row in records
        ),
        records=records,
        freshPreparation=check_fresh_preparation(audit.geometry, fresh_class_flags),
        limits=[
            "Actor transform operands round-trip saved properties or qualified class defaults; current actor state and matrices are not inferred.",
            "Actor Boolean records preserve declared saved/default bits and map overrides. Browser preparation exercises the qualified property gate under explicit persistent-load modes and incoming class-default bits; padding and later lifecycle writes are not inferred.",
            "Actor reference records re-encode original map tags and retain full package/group identities and qualified class-default origins. Current reference resolution and transient tag application are not inferred.",
            "Level arrays and audited export slots round-trip source order, including null/repeated references; later loading and population changes are not inferred.",
            "Exact decoded-package array byte round trip, including compact-index encoding and lazy saved ends.",
            "Both serialized boxes are compared at offsets recovered through the primitive prefix and section count. The second overwrites the first saved field; post-load state is not established.",
            "Load-tail fields are re-encoded through the exact export end. The lazy payload is only span/hash checked; its elements are not decoded. References are encoded package indices, not resolved objects.",
            "Ordered saved-property tags retain duplicates and indices. Their terminator must meet the native mesh body; a matching generic decode is a framing cross-check, not independent proof of native loading. Saved export flags are not current flags.",
            "Reads every geometry record admitted by existing class/version/material gates, including references from actors rejected by placement gates.",
            "Not native archive I/O execution, current actor/cache state, collision result parity or complete map coverage.",
            "Malformed/noncanonical compact streams and unsupported versions are outside this evidence.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tiles", nargs="+")
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--fresh-class-flags",
        type=lambda value: int(value, 0),
        help="also exercise browser fresh preparation with these explicit diagnostic class flags; not native class-state evidence",
    )
    args = parser.parse_args()
    for tile in args.tiles:
        report = verify(tile, fresh_class_flags=args.fresh_class_flags)
        if args.check:
            fresh = report["freshPreparation"]
            booleans = report["persistentBooleanPreparation"]
            references = report["persistentReferencePreparation"]
            actor_frames = report["actorStateFrames"]
            actor_count = len(report["actorTransforms"])
            actor_flags = len(report["actorFlags"])
            actor_references = len(report["actorReferences"])
            classes = report["savedActorClasses"]
            saved_booleans = report["savedActorBooleans"]
            report = {
                key: report[key]
                for key in [
                    "status",
                    "tile",
                    "meshes",
                    "triangles",
                    "nodes",
                    "layouts",
                    "boundsRecords",
                    "overwrittenBoundsDiffer",
                    "savedMeshVersions",
                    "savedExportFlags",
                    "meshHeaderTagRecords",
                    "meshDuplicateTagRecords",
                    "selection",
                    "levelActorOrder",
                    "levelCollisionMode",
                    "actorClassLoading",
                ]
            }
            report["actorTransformRecords"] = actor_count
            report["savedActorClasses"] = {
                "classCount": classes["classCount"],
                "scope": classes["scope"],
                "classes": [row["sourceClass"] for row in classes["records"]],
            }
            report["savedActorBooleans"] = {
                k: v for k, v in saved_booleans.items() if k != "records"
            }
            report["actorFlagRecords"] = actor_flags
            report["actorReferenceRecords"] = actor_references
            report["actorStateFrameRecords"] = len(actor_frames)
            report["actorStateFrameWidths"] = dict(
                Counter(row["bytes"] for row in actor_frames)
            )
            report["actorStateFrameDistinctWords28"] = len(
                {row["word28"] for row in actor_frames}
            )
            report["persistentBooleanPreparation"] = {
                k: v for k, v in booleans.items() if k != "records"
            }
            report["persistentReferencePreparation"] = {
                k: v for k, v in references.items() if k != "records"
            }
            if fresh is not None:
                report["freshPreparation"] = {
                    k: v for k, v in fresh.items() if k != "records"
                }
        print(json.dumps(report, indent=None if args.check else 2))


if __name__ == "__main__":
    main()
