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
)
from l2lib import RF_HAS_STACK, encode_compact, read_properties


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
    for key, name, fmt, kind, structure in [
        ("location", "Location", "<3f", 10, "Vector"),
        ("rotation", "Rotation", "<3i", 10, "Rotator"),
        ("drawScale", "DrawScale", "<f", 4, None),
        ("drawScale3D", "DrawScale3D", "<3f", 10, "Vector"),
        ("prePivot", "PrePivot", "<3f", 10, "Vector"),
    ]:
        value = saved["fields"][key]
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
  const tags=Object.entries(actor.savedCollisionFlags.overrides).map(([name,value])=>({name,value}));
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


def verify(tile, *, fresh_class_flags=None):
    audit = Audit(tile, retain_sweep_data=True)
    actors = audit.actors()
    report = audit.report(actors)
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
        classDefaults=audit.defaults,
        actorClassLoading=audit.actor_class_loading,
        persistentBooleanPreparation=check_boolean_preparation(
            actors,
            audit.boolean_layout,
            audit.defaults[-1]["collisionBooleans"]["defaultGroups"],
        ),
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
            actor_frames = report["actorStateFrames"]
            actor_count = len(report["actorTransforms"])
            actor_flags = len(report["actorFlags"])
            actor_references = len(report["actorReferences"])
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
                    "actorClassLoading",
                ]
            }
            report["actorTransformRecords"] = actor_count
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
            if fresh is not None:
                report["freshPreparation"] = {
                    k: v for k, v in fresh.items() if k != "records"
                }
        print(json.dumps(report, indent=None if args.check else 2))


if __name__ == "__main__":
    main()
