#!/usr/bin/env python3
"""Elbera Tools: export audited original StaticMeshActor collision triangles.

Example (local original-derived output; never a public asset):
 python3 tools/world/export_static_collision.py 17_25 --actor StaticMeshActor140 --actor StaticMeshActor141 --emit
Use --audit for a read-only census, or --all-supported to explicitly select
the complete currently supported subset. Qualified group paths are retained.
Use --references-only with a tile or "all" for a read-only qualified-name
census across the currently exported scene tiles, without decoding geometry.
Unknown classes, simple/cylinder models, unsupported source versions and
non-colliding referenced materials fail closed. This is
source geometry for browser ray picking, not the original extent-sweep engine.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/dat'), str(ROOT / 'tools/ui')]
from l2lib import L2Error, Reader, load_package, read_properties, encode_compact, qualified_ref, read_model, read_polys
from convert import actor_prop_offset, read_props_ordered, read_map_actor_frame
from export_npc_visuals import OriginalClasses, serialized_defaults
from l2lib.declarations import read_property_declaration

FORMAT = 'l2-static-collision-v1'
LIMIT = 1_000_000
sha = lambda data: hashlib.sha256(data).hexdigest()


def count(r, limit=LIMIT):
    n = r.compact()
    if not 0 <= n <= limit:
        raise ValueError('invalid source array count')
    return n


def collision_array(r, lazy, name):
    """Native lazy arrays prefix the ordinary payload with its absolute end.

    Read within that span, rather than jumping over an assumed header. The
    caller must finish the complete payload exactly at the saved boundary.
    """
    if not lazy:
        return r, None
    start = r.pos
    end = r.i32()
    if not r.pos < end <= len(r.data):
        raise ValueError('invalid lazy %s saved-end offset' % name)
    block = {'kind': name, 'start': start, 'payload': r.pos, 'savedEnd': end}
    return Reader(memoryview(r.data)[r.pos:end], path=str(r.path) + ':' + name), block


def finish_collision_array(r, payload, block):
    if block is None:
        return
    if payload.pos != len(payload.data):
        raise ValueError('lazy %s payload does not end at saved offset' % block['kind'])
    r.pos = block['savedEnd']


def serialized_box(r):
    """Preserve a finite original FBox and its decoded-package byte span."""
    offset = r.pos
    raw = r.bytes(25)
    values = struct.unpack('<6fB', raw)
    if not all(math.isfinite(value) for value in values[:6]):
        raise ValueError('nonfinite serialized mesh bounds')
    return dict(min=list(values[:3]), max=list(values[3:6]), valid=values[6],
                sourceOffset=offset, sourceBytes=25, sourceSHA256=sha(raw))


def mesh_body(r, *, lazy_collision=False, export_end=None, retain_sweep_data=False):
    """Native file123 body: legacy arrays or licensee>=17 saved-end arrays.

    Saved ends are absolute positions in the decoded package, not relative to
    the object or array. Lazy decoding therefore requires the original export
    boundary. Both forms retain the same collision element serializers.
    """
    original = r
    if lazy_collision and export_end is None:
        raise ValueError('lazy collision requires original export boundary')
    if export_end is not None:
        if type(export_end) is not int or not r.pos <= export_end <= len(r.data):
            raise ValueError('invalid original export boundary')
        r = Reader(memoryview(r.data)[:export_end], r.pos, r.path)
    body_offset = r.pos
    if retain_sweep_data:
        base_bounds = serialized_box(r)
    else:
        r.bytes(25)
    r.bytes(16)  # UPrimitive FSphere, file version >61
    r.bytes(count(r) * 14)  # sections
    # UStaticMesh.Serialize writes the same +0x34 field again after sections.
    # This later saved box does not establish later PostLoad/current state.
    if retain_sweep_data:
        saved_bounds = serialized_box(r)
    else:
        r.bytes(25)
    vertices = [list(struct.unpack('<6f', r.bytes(24))[:3]) for _ in range(count(r))]
    r.i32()  # vertex stream revision
    for _ in range(2):
        r.bytes(count(r) * 4); r.i32()
    for _ in range(count(r, 16)):
        r.bytes(count(r) * 8); r.i32(); r.i32()
    render = []
    for stream in range(2):
        n = count(r); indices = struct.unpack('<%dH' % n, r.bytes(n * 2)); r.i32()
        if stream == 0:
            render = list(indices)
    if r.compact() != 0:
        raise ValueError('simple CollisionModel is not supported')
    collision_offset = r.pos
    triangles, triangle_block = collision_array(r, lazy_collision, 'triangles')
    indices, materials, planes = [], [], []
    for _ in range(count(triangles)):
        raw_planes = triangles.bytes(64)  # source plane + three edge planes
        if retain_sweep_data:
            values = list(struct.unpack('<16f', raw_planes))
            if not all(math.isfinite(value) for value in values):
                raise ValueError('nonfinite source collision plane')
            planes.append(values)
        face = [triangles.compact() for _ in range(4)]
        if any(i < 0 or i >= len(vertices) for i in face[:3]) or face[3] < 0:
            raise ValueError('invalid collision vertex/material index')
        indices.extend(face[:3]); materials.append(face[3])
    finish_collision_array(r, triangles, triangle_block)
    if not vertices or not indices or not all(math.isfinite(x) for p in vertices for x in p):
        raise ValueError('empty/nonfinite collision geometry')
    node_stream, node_block = collision_array(r, lazy_collision, 'nodes')
    nodes = count(node_stream)
    if nodes == 0:
        raise ValueError('no native collision nodes')
    tree, node_records = [], []
    for _ in range(nodes):
        links = [node_stream.compact() for _ in range(4)]
        bounds = struct.unpack('<6f', node_stream.bytes(24)); valid = node_stream.u8()
        if not 0 <= links[0] < len(materials) or any(x < -1 or x >= nodes for x in links[1:]) \
                or not all(math.isfinite(x) for x in bounds) or valid != 1:
            raise ValueError('invalid source collision node')
        tree.append(links)
        if retain_sweep_data:
            node_records.append(dict(links=links, bounds=list(bounds), valid=valid))
    finish_collision_array(r, node_stream, node_block)
    reached, faces, pending = set(), set(), [0]
    while pending:
        node = pending.pop()
        if node < 0 or node in reached: continue
        reached.add(node); faces.add(tree[node][0]); pending.extend(tree[node][1:])
    if len(faces) != len(materials):
        raise ValueError('collision triangles unreachable from native root zero')
    a = Counter(tuple(sorted(indices[i:i+3])) for i in range(0, len(indices), 3))
    b = Counter(tuple(sorted(render[i:i+3])) for i in range(0, len(render), 3))
    original.pos = r.pos
    result = dict(vertices=vertices, indices=indices, materials=materials,
                collisionOffset=collision_offset, collisionNodeCount=nodes,
                collisionArrayLayout='lazy-saved-end' if lazy_collision else 'ordinary',
                collisionArrayBlocks=[block for block in (triangle_block, node_block) if block],
                renderTriangleCount=len(render)//3, collisionTriangleCount=len(indices)//3,
                collisionOnlyTriangleCount=sum((a-b).values()),
                renderOnlyTriangleCount=sum((b-a).values()))
    if retain_sweep_data:
        result['collisionTree'] = dict(trianglePlanes=planes, nodes=node_records)
        result.update(nativeBodyOffset=body_offset, baseSerializedBounds=base_bounds,
                      savedLocalBounds=saved_bounds)
    return result


def mesh_load_tail(r, *, file_version, licensee_version, export_end):
    """Recover file123's remaining saved fields without interpreting raw triangles.

    Native field offsets identify unknown words; they are not asset meanings.
    The original lazy loader seeks an absolute saved end. Preserve that opaque
    span's hash rather than pretending to decode it. This is serialized state,
    not a replacement for UStaticMesh.PostLoad or object-reference resolution.
    """
    if type(file_version) is not int or file_version != 123 or type(licensee_version) is not int or not 0 <= licensee_version <= 65535:
        raise ValueError('unsupported mesh load-tail source version')
    if type(export_end) is not int or not 0 <= r.pos < export_end <= len(r.data):
        raise ValueError('invalid mesh load-tail export boundary')
    original = r
    r = Reader(memoryview(r.data)[:export_end], r.pos, r.path)
    start, fields = r.pos, {}

    def span(offset, end):
        return dict(sourceOffset=offset, sourceBytes=end-offset,
                    sourceSHA256=sha(r.data[offset:end]))

    def field(offset, encoding='u32'):
        at = r.pos
        if encoding == 'compact-reference':
            value = r.compact()
            if bytes(r.data[at:r.pos]) != encode_compact(value):
                raise ValueError('noncanonical mesh load-tail reference')
        else:
            value = r.i32() if encoding == 'i32' else r.u32()
        fields[hex(offset)] = dict(encoding=encoding, value=value, **span(at, r.pos))

    if licensee_version >= 6:
        field(0x194)
        field(0x198, 'compact-reference')
        field(0x19c, 'compact-reference')
        field(0x1a0)
        field(0x1a4)
    for minimum, offsets in [(7, [0x1a8, 0x1ac]), (11, [0x1b0]),
                             (13, [0x1b4]), (14, [0x1b8, 0x1bc]), (15, [0x1c0])]:
        if licensee_version >= minimum:
            for offset in offsets:
                field(offset)
    lazy_start = r.pos
    saved_end = r.i32()
    if not r.pos < saved_end <= export_end:
        raise ValueError('invalid mesh load-tail lazy saved end')
    lazy = dict(savedEnd=saved_end, **span(lazy_start, saved_end),
                payload=span(r.pos, saved_end))
    r.pos = saved_end
    field(0x1dc, 'i32')
    field(0x1f0, 'compact-reference')
    field(0x1e0)
    if r.pos != export_end:
        raise ValueError('mesh load-tail does not end at original export boundary')
    original.pos = r.pos
    return dict(**span(start, r.pos), fields=fields, lazyArray1c4=lazy)


def class_defaults(*, retain_collision_fields=False):
    catalog, values, evidence = OriginalClasses(), {}, []
    for qualified in ('Engine.Actor', 'Engine.StaticMeshActor'):
        types = catalog.property_types(qualified, set())
        pkg = catalog.packages['Engine']
        ex = next(e for e in pkg.exports if pkg.class_name_of(e) == 'Class'
                  and pkg.export_name(e) == qualified.split('.')[1])
        expected_parent = 'Core.Object' if qualified == 'Engine.Actor' else 'Engine.Actor'
        if qualified_ref(pkg, ex.super_index) != expected_parent:
            raise ValueError('unsupported collision class inheritance')
        props, ev = serialized_defaults(pkg, ex, types)
        values.update({name: value for name, _, value in props})
        evidence.append({'class': qualified, **ev})
    fields = actor_field_evidence(pkg)
    # Core UClass::Serialize initializes the class-default byte buffer from
    # zero + parent defaults before reading tagged overrides. Rotation is a
    # declared Core.Object.Rotator, not an inferred optional vector (native proof in
    # check_picking_native). Keep the default's provenance in the sidecar.
    rotation = values.get('Rotation')
    if rotation is None:
        values['Rotation'] = [0, 0, 0]
        evidence[-1]['rotationDefault'] = {'value': [0, 0, 0],
            'source': 'zero-initialized-class-default; no inherited tagged override',
            'field': fields['Rotation']}
    else:
        if rotation[0] != 'Rotator' or len(bytes.fromhex(rotation[1])) != 12:
            raise ValueError('unsupported Rotation class default')
        values['Rotation'] = list(struct.unpack('<3i', bytes.fromhex(rotation[1])))
    scale3 = values['DrawScale3D']
    assert scale3[0] == 'Vector'
    values['DrawScale3D'] = list(struct.unpack('<3f', bytes.fromhex(scale3[1])))
    pivot = values.get('PrePivot')
    if pivot is None:
        values['PrePivot'] = [0.0, 0.0, 0.0]
        evidence[-1]['prePivotDefault'] = {
            'value': [0.0, 0.0, 0.0],
            'source': 'zero-initialized-class-default; no inherited tagged override',
            'field': fields['PrePivot']}
    else:
        if pivot[0] != 'Vector' or len(bytes.fromhex(pivot[1])) != 12:
            raise ValueError('unsupported PrePivot class default')
        values['PrePivot'] = list(struct.unpack('<3f', bytes.fromhex(pivot[1])))
    if retain_collision_fields:
        transform_layout = actor_transform_layout(pkg)
        location = values.get('Location')
        if location is None:
            values['Location'] = [0.0, 0.0, 0.0]
            evidence[-1]['locationDefault'] = dict(
                value=values['Location'],
                source='zero-initialized-class-default; no inherited tagged override')
        else:
            if location[0] != 'Vector' or len(bytes.fromhex(location[1])) != 12:
                raise ValueError('unsupported Location class default')
            values['Location'] = list(struct.unpack('<3f', bytes.fromhex(location[1])))
        evidence[-1]['collisionTransforms'] = dict(
            layout=transform_layout,
            defaults={field['name']: values[field['name']] for field in transform_layout},
            scope='decoded declared class defaults; not live actor transforms')
        attached, inner = actor_attached_layout(pkg)
        if 'Attached' in values:
            raise ValueError('nonempty or tagged Attached class default requires array loading')
        evidence[-1]['collisionAttached'] = dict(
            layout=attached, inner=inner, defaultCount=0,
            defaultOrigin='zero-initialized-class-default',
            scope='declared empty class-default array; native copying checked separately')
        reference_layout = actor_reference_layout(pkg)
        references = {
            field['name']: dict(reference=0, qualified=None, package=Path(pkg.path).stem,
                                origin='zero-initialized-class-default')
            for field in reference_layout}
        for ev in evidence:
            start = ev['exportOffset'] + ev['defaultsOffset']
            end = ev['exportOffset'] + ev['exportLength']
            tags, actual = read_props_ordered(pkg, start, end=end)
            if actual != end:
                raise ValueError('actor reference defaults exceed class export')
            overrides = saved_reference_overrides(pkg, tags, references)
            for name, record in overrides.items():
                references[name] = dict(record, origin=ev['class'] + '.default')
        evidence[-1]['collisionReferences'] = dict(
            layout=reference_layout, defaults=references,
            scope='saved-class-default-references; not resolved current objects')
        layout = actor_boolean_layout(pkg)
        zero_names = []
        for group in layout:
            for field in group['fields']:
                name = field['name']
                if name not in values:
                    # Same qualified zero-plus-parent CDO path as Rotation and
                    # PrePivot, now applied only to declared Boolean fields.
                    values[name] = False
                    zero_names.append(name)
                if type(values[name]) is not bool:
                    raise ValueError('non-Boolean actor class default: ' + name)
        evidence[-1]['collisionBooleans'] = dict(
            layout=layout, zeroInitialized=zero_names,
            defaultGroups={group['offset']: dict(mask=group['mask'], value=sum(
                field['mask'] for field in group['fields'] if values[field['name']]))
                for group in layout},
            scope='declared-class-default-bits; not current actor state')
    return values, evidence, catalog.sources


def actor_declaration(pkg, ref, owner_ref):
    if not 0 < ref <= len(pkg.exports):
        raise ValueError('invalid actor declaration reference')
    ex = pkg.exports[ref - 1]
    if ex.package_index != owner_ref:
        raise ValueError('actor declaration escapes its owner')
    if pkg.class_name_of(ex) == 'ClassProperty':
        raise ValueError('unsupported actor declaration kind')
    record = read_property_declaration(pkg, ex)
    if record['arrayDim'] != 1:
        raise ValueError('unsupported actor declaration size')
    # Preserve the existing consumed-field schema; general source inspection
    # uses the declaration reader directly to retain dimensions/network data.
    return {key: record[key] for key in ('name', 'kind', 'next', 'propertyFlags',
                                        'reference', 'exportRef', 'exportSHA256')}


def actor_attached_layout(pkg):
    """Read the array and its separate element declaration; their flags differ."""
    matches = [ex for ex in pkg.exports
               if qualified_ref(pkg, ex.index + 1) == 'Engine.Actor.Attached'
               and pkg.class_name_of(ex) == 'ArrayProperty']
    if len(matches) != 1:
        raise ValueError('ambiguous Actor Attached declaration')
    ex = matches[0]
    if qualified_ref(pkg, ex.package_index) != 'Engine.Actor':
        raise ValueError('Attached declaration has wrong owner')
    field = actor_declaration(pkg, ex.index + 1, ex.package_index)
    children = [child for child in pkg.exports if child.package_index == ex.index + 1
                and qualified_ref(pkg, child.index + 1) == field['reference']]
    if len(children) != 1:
        raise ValueError('ambiguous Attached element declaration')
    inner = actor_declaration(pkg, children[0].index + 1, ex.index + 1)
    if inner['kind'] != 'ObjectProperty' or inner['reference'] != 'Engine.Actor':
        raise ValueError('unsupported Attached element type')
    return field, inner


def actor_reference_layout(pkg):
    """Declared reference types; native offsets are checked by the bounds tool."""
    owners = [e for e in pkg.exports if pkg.class_name_of(e) == 'Class'
              and pkg.export_name(e) == 'Actor']
    if len(owners) != 1:
        raise ValueError('ambiguous Actor class declaration')
    owner_ref = owners[0].index + 1
    fields = []
    for name, target in [('StaticMesh', 'StaticMesh'), ('Owner', 'Actor'),
                         ('Level', 'LevelInfo'), ('XLevel', 'Level'),
                         ('Mesh', 'Mesh'), ('Brush', 'Model'), ('AntiPortal', 'ConvexVolume')]:
        matches = [e for e in pkg.exports if e.package_index == owner_ref
                   and pkg.export_name(e) == name]
        if len(matches) != 1:
            raise ValueError('ambiguous actor reference declaration: ' + name)
        field = actor_declaration(pkg, matches[0].index + 1, owner_ref)
        if field['kind'] != 'ObjectProperty' or field['reference'] != 'Engine.' + target:
            raise ValueError('unsupported actor reference type: ' + name)
        fields.append(field)
    return fields


def actor_transform_layout(pkg):
    """Dimension-one source declarations used by original actor matrices."""
    owners = [e for e in pkg.exports if pkg.class_name_of(e) == 'Class'
              and pkg.export_name(e) == 'Actor']
    if len(owners) != 1:
        raise ValueError('ambiguous Actor class declaration')
    owner_ref = owners[0].index + 1
    fields = []
    for name, target in [('Location', 'Core.Object.Vector'),
                         ('Rotation', 'Core.Object.Rotator'), ('DrawScale', None),
                         ('DrawScale3D', 'Core.Object.Vector'), ('PrePivot', 'Core.Object.Vector')]:
        matches = [e for e in pkg.exports if e.package_index == owner_ref
                   and pkg.export_name(e) == name]
        if len(matches) != 1:
            raise ValueError('ambiguous actor transform declaration: ' + name)
        field = actor_declaration(pkg, matches[0].index + 1, owner_ref)
        if field['kind'] != ('StructProperty' if target else 'FloatProperty') or field['reference'] != target:
            raise ValueError('unsupported actor transform type: ' + name)
        fields.append(field)
    return fields


def saved_reference_overrides(pkg, tags, names):
    """Retain canonical package references, including explicit nulls.

    Qualified names retain group/outer identity. They are not resolved runtime
    objects, and transient-property application is deliberately not inferred.
    """
    result = {}
    for tag in tags:
        name = tag['name']
        if name not in names:
            continue
        if (name in result or tag['type'] != 5 or tag.get('index', 0) != 0
                or tag.get('struct') is not None):
            raise ValueError('unsupported saved actor reference: ' + name)
        raw = tag['raw']
        reader = Reader(raw)
        reference = reader.compact()
        if reader.pos != len(raw) or encode_compact(reference) != raw:
            raise ValueError('noncanonical saved actor reference: ' + name)
        result[name] = dict(reference=reference,
            qualified=qualified_ref(pkg, reference) if reference else None,
            package=Path(pkg.path).stem, origin='map-property')
    return result


def actor_boolean_layout(pkg):
    """Read the four original declaration chains used by collision methods.

    Native offsets and packing are separately qualified against the typed copy
    constructor and Core.BoolProperty.Link. Undeclared padding stays unknown.
    """
    owner = [e for e in pkg.exports if pkg.class_name_of(e) == 'Class'
             and pkg.export_name(e) == 'Actor']
    if len(owner) != 1:
        raise ValueError('ambiguous Actor class declaration')
    owner_ref = owner[0].index + 1

    groups = []
    for offset, first, first_kind, last, last_kind in [
        (0x64, 'CreatureID', 'IntProperty', 'RelativeTrailOffset', 'StructProperty'),
        (0x74, 'RelativeTrailOffset', 'StructProperty', 'RelativeLocInVehicle', 'StructProperty'),
        (0x2e4, 'Style', 'ByteProperty', 'TransientSoundVolume', 'FloatProperty'),
        (0x2f8, 'CollisionHeight', 'FloatProperty', 'Mass', 'FloatProperty'),
    ]:
        matches = [e for e in pkg.exports if e.package_index == owner_ref and pkg.export_name(e) == first]
        if len(matches) != 1:
            raise ValueError('ambiguous actor Boolean group anchor')
        previous = actor_declaration(pkg, matches[0].index + 1, owner_ref)
        if previous['kind'] != first_kind:
            raise ValueError('unexpected actor Boolean group anchor kind')
        fields, seen, cursor = [], set(), previous['next']
        while True:
            if cursor in seen:
                raise ValueError('cyclic actor Boolean declaration chain')
            seen.add(cursor)
            row = actor_declaration(pkg, cursor, owner_ref)
            if row['kind'] != 'BoolProperty':
                break
            if len(fields) >= 32:
                raise ValueError('actor Boolean group exceeds one source word')
            fields.append(dict(row, mask=1 << len(fields)))
            cursor = row['next']
        if not fields or row['name'] != last or row['kind'] != last_kind:
            raise ValueError('unsupported actor Boolean group endpoint')
        for anchor in (previous, row):
            if anchor['kind'] == 'StructProperty' and anchor['reference'] != 'Core.Object.Vector':
                raise ValueError('unsupported actor Boolean group anchor struct')
        groups.append(dict(offset=hex(offset), mask=(1 << len(fields)) - 1,
                           before=previous, after=row, fields=fields))
    return groups


def serialized_class_record(catalog, qualified):
    """Read one exact class and retain its ordered, source-bound default tags."""
    types = catalog.property_types(qualified, set())
    source, name = qualified.split(".")
    pkg = catalog.packages[catalog.files[source.casefold()].stem]
    matches = [
        e
        for e in pkg.exports
        if pkg.class_name_of(e) == "Class"
        and pkg.export_name(e).casefold() == name.casefold()
    ]
    if len(matches) != 1:
        raise ValueError("ambiguous original class")
    ex = matches[0]
    values, proof = serialized_defaults(pkg, ex, types)
    tags, consumed = read_props_ordered(
        pkg,
        ex.serial_offset + proof["defaultsOffset"],
        end=ex.serial_offset + ex.serial_size,
    )
    if consumed != ex.serial_offset + ex.serial_size or [t["name"] for t in tags] != [
        v[0] for v in values
    ]:
        raise ValueError("class default tag census differs from value reader")
    return (
        pkg,
        ex,
        dict(
            sourceClass=qualified_ref(pkg, ex.index + 1),
            parent=qualified_ref(pkg, ex.super_index) if ex.super_index else None,
            defaults=proof,
            tags=tags,
        ),
    )


def saved_boolean_overrides(layout, groups, properties):
    """Apply ordered saved Boolean tags to only the declared known-bit subset.

    This describes serialized values, not native property admission or current
    actor state. Repeated tags retain order; unrelated bits remain unknown.
    """
    fields = {
        field["name"].casefold(): (group["offset"], field)
        for group in layout
        for field in group["fields"]
    }
    if len(fields) != sum(len(group["fields"]) for group in layout):
        raise ValueError("duplicate Boolean declaration name")
    result = {key: dict(value) for key, value in groups.items()}
    if set(result) != {group["offset"] for group in layout}:
        raise ValueError("Boolean default groups differ from declaration layout")
    for group in layout:
        word = result[group["offset"]]
        if (
            type(word.get("value")) is not int
            or word.get("mask") != group["mask"]
            or not 0 <= word["value"] <= 0xFFFFFFFF
            or word["value"] & ~word["mask"]
        ):
            raise ValueError("Boolean defaults contain unknown or malformed bits")
    tags, overrides = [], {}
    for prop in properties:
        field = fields.get(prop["name"].casefold())
        if field is None:
            continue
        offset, declaration = field
        if prop["type"] != 3 or prop["index"] != 0 or type(prop["boolval"]) is not bool:
            raise ValueError("malformed declared Boolean property")
        name, mask, value = declaration["name"], declaration["mask"], prop["boolval"]
        word = result[offset]
        word["value"] = (word["value"] & ~mask) | (mask if value else 0)
        tags.append(dict(name=name, value=value))
        overrides[name] = value
    return dict(groups=result, tags=tags, overrides=overrides)


class ActorBooleanDefaults:
    """Shared original Actor fields through exact class ancestors, cached once.

    No subclass constructor or PostLoad is substituted for AActor. These are
    source defaults only, ready for a separately qualified lifecycle consumer.
    """

    def __init__(self, layout, catalog=None):
        self.layout = layout
        self.catalog = catalog if catalog is not None else OriginalClasses()
        self.records = {}

    def read(self, qualified, seen=frozenset()):
        key = qualified.casefold()
        if key in seen:
            raise ValueError("cyclic original Actor ancestry")
        if key in self.records:
            return self.records[key]
        pkg, ex, source = serialized_class_record(self.catalog, qualified)
        parent = self.read(source["parent"], seen | {key}) if source["parent"] else None
        if key == "core.object":
            if parent is not None:
                raise ValueError("unexpected Core.Object ancestor")
            inherited = None
        elif key == "engine.actor":
            if source["parent"] != "Core.Object":
                raise ValueError("unexpected Actor ancestor")
            inherited = {
                g["offset"]: dict(mask=g["mask"], value=0) for g in self.layout
            }
        else:
            inherited = (
                parent["actorBooleans"]["groups"]
                if parent and parent["actorBooleans"]
                else None
            )
            if inherited is None:
                raise ValueError("class is outside the original Actor ancestry")
            names = {f["name"].casefold() for g in self.layout for f in g["fields"]} | {"brush"}
            if any(
                e.package_index == ex.index + 1
                and pkg.export_name(e).casefold() in names
                for e in pkg.exports
            ):
                raise ValueError("subclass redeclares a consumed Actor field")
        booleans = (
            saved_boolean_overrides(self.layout, inherited, source["tags"])
            if inherited is not None
            else None
        )
        if booleans is not None:
            origins = (
                dict(parent["actorBooleans"]["origins"])
                if key != "engine.actor"
                else {
                    f["name"]: "zero-initialized-class-default"
                    for g in self.layout
                    for f in g["fields"]
                }
            )
            origins.update(
                {name: source["sourceClass"] for name in booleans["overrides"]}
            )
            booleans["origins"] = origins
        record = dict(
            source,
            tags=[dict(t, raw=t["raw"].hex()) for t in source["tags"]],
            actorBooleans=booleans,
        )
        self.records[key] = record
        return record


def saved_actor_booleans(pkg, ex, defaults, layout):
    """Recover one actor's saved Boolean subset without running its lifecycle."""
    identity = qualified_ref(pkg, ex.class_index)
    if (
        identity.casefold() != defaults["sourceClass"].casefold()
        or defaults["actorBooleans"] is None
    ):
        raise ValueError("actor Boolean defaults differ from saved class")
    frame = saved_actor_frame(pkg, ex)
    start, end = (
        ex.serial_offset + frame["sourceBytes"],
        ex.serial_offset + ex.serial_size,
    )
    tags, consumed = read_props_ordered(pkg, start, end=end)
    values = saved_boolean_overrides(layout, defaults["actorBooleans"]["groups"], tags)
    return dict(
        scope="saved-actor-declared-booleans",
        sourceClass=identity,
        savedStateFrame=frame,
        propertyStream=dict(
            sourceOffset=start,
            sourceBytes=consumed - start,
            sourceSHA256=sha(pkg.data[start:consumed]),
        ),
        nativeTail=dict(
            sourceOffset=consumed,
            sourceBytes=end - consumed,
            sourceSHA256=sha(pkg.data[consumed:end]),
        ),
        **values
    )


def saved_model_resource(pkg, ex):
    """Retain a file123 Model's bounds and PostLoad operands from exact spans.

    The three rendering arrays must be empty for this resource profile. Their
    native field identities are source-bound, not guessed asset meanings.
    Full Model geometry remains available through the shared package decoder.
    """
    if (
        pkg.file_version != 123
        or pkg.licensee_version < 9
        or pkg.class_name_of(ex) != "Model"
    ):
        raise ValueError("unsupported Model resource edition or class")
    model = read_model(pkg, ex)
    properties, property_end = model.source_spans["properties"]
    tags, consumed = read_props_ordered(pkg, properties, end=property_end)
    if tags or consumed != property_end:
        raise ValueError("tagged Model properties require native property loading")
    lo, hi = model.source_spans["primitive"]
    reader = Reader(memoryview(pkg.data)[:hi], lo, pkg.path)
    bounds = serialized_box(reader)
    sphere = list(struct.unpack("<4f", reader.bytes(16)))
    if reader.pos != hi or not all(math.isfinite(v) for v in sphere):
        raise ValueError("invalid Model primitive span")
    start, end = model.source_spans["undecoded_tail"]
    reader = Reader(memoryview(pkg.data)[:end], start, pkg.path)
    arrays = []
    for field in ("0xe4", "0x10c", "0xf0"):
        pos = reader.pos
        n = reader.compact()
        if n != 0 or pkg.data[pos : reader.pos] != encode_compact(n):
            raise ValueError("nonempty or noncanonical Model rendering array")
        arrays.append(
            dict(
                nativeField=field,
                count=n,
                sourceOffset=pos,
                sourceBytes=reader.pos - pos,
            )
        )
    if reader.pos != end:
        raise ValueError("trailing Model resource bytes")
    return dict(
        scope="saved-model-resource",
        fileVersion=pkg.file_version,
        licenseeVersion=pkg.licensee_version,
        sourcePackage=Path(pkg.path).stem,
        exportRef=ex.index + 1,
        identity=qualified_ref(pkg, ex.index + 1),
        classIdentity=qualified_ref(pkg, ex.class_index),
        savedExportFlags=ex.object_flags,
        exportSHA256=sha(
            pkg.data[ex.serial_offset : ex.serial_offset + ex.serial_size]
        ),
        localBounds=bounds,
        boundingSphere=sphere,
        nodeSurfaces=[n.i_surf for n in model.nodes],
        surfaceCount=len(model.surfs),
        polysReference=model.polys,
        emptyRenderArrays=arrays,
        sourceSpans={
            key: dict(
                sourceOffset=a, sourceBytes=b - a, sourceSHA256=sha(pkg.data[a:b])
            )
            for key, (a, b) in model.source_spans.items()
        },
    )


def saved_polys_resource(pkg, ex):
    """Retain exact Polys identity/header evidence; geometry stays in its source.

    The shared decoder consumes every polygon byte with the file123 native gate.
    The browser header consumer does not need a second copy of that geometry.
    """
    start, end = ex.serial_offset, ex.serial_offset + ex.serial_size
    if (
        pkg.file_version != 123
        or qualified_ref(pkg, ex.class_index) != "Engine.Polys"
        or ex.object_flags & 0x02000000
        or not 0 <= start < end <= len(pkg.data)
    ):
        raise ValueError("unsupported Polys resource edition, class or framing")
    tags, consumed = read_props_ordered(pkg, start, end=end)
    if tags:
        raise ValueError("tagged Polys properties require native property loading")
    reader = Reader(memoryview(pkg.data)[:end], consumed, pkg.path)
    count, maximum = reader.i32(), reader.i32()
    polygons = read_polys(pkg, ex)
    if len(polygons) != count:
        raise ValueError("Polys count differs from consumed records")
    spans = {
        "properties": (start, consumed),
        "counts": (consumed, reader.pos),
        "polygons": (reader.pos, end),
    }
    return dict(
        scope="saved-polys-resource",
        fileVersion=pkg.file_version,
        licenseeVersion=pkg.licensee_version,
        sourcePackage=Path(pkg.path).stem,
        exportRef=ex.index + 1,
        identity=qualified_ref(pkg, ex.index + 1),
        classIdentity=qualified_ref(pkg, ex.class_index),
        savedExportFlags=ex.object_flags,
        exportSHA256=sha(pkg.data[start:end]),
        propertyTagCount=0,
        polygonCount=count,
        serializedMax=maximum,
        sourceSpans={
            key: dict(
                sourceOffset=a, sourceBytes=b - a, sourceSHA256=sha(pkg.data[a:b])
            )
            for key, (a, b) in spans.items()
        },
    )

TRANSFORM_TYPES = {
    "Location": ("Vector", "<3f"),
    "Rotation": ("Rotator", "<3i"),
    "DrawScale": (None, "<f"),
    "DrawScale3D": ("Vector", "<3f"),
    "PrePivot": ("Vector", "<3f"),
}


def decoded_transform_tags(tags):
    """Retain ordered declared transform values, without renderer conversion."""
    names = {name.casefold(): name for name in TRANSFORM_TYPES}
    result = []
    for tag in tags:
        name = names.get(tag["name"].casefold())
        if name is None:
            continue
        kind, fmt = TRANSFORM_TYPES[name]
        if (
            tag["type"] != (10 if kind else 4)
            or tag["index"] != 0
            or tag.get("struct") != kind
            or len(tag["raw"]) != struct.calcsize(fmt)
        ):
            raise ValueError("unsupported original transform tag: " + name)
        values = struct.unpack(fmt, tag["raw"])
        if not all(math.isfinite(v) for v in values):
            raise ValueError("nonfinite original transform tag: " + name)
        result.append(dict(name=name, value=list(values) if kind else values[0]))
    return result


def decoded_reference_tags(pkg, tags, names):
    """Resolve each saved tag's identity; keep repeated references in order."""
    names = {name.casefold(): name for name in names}
    result = []
    for tag in tags:
        name = names.get(tag["name"].casefold())
        if name is not None:
            value = saved_reference_overrides(
                pkg, [dict(tag, name=name)], names.values()
            )[name]
            result.append(dict(value, name=name))
    return result


def brush_actor_fields(
    pkg, identities, defaults, brush_models, boolean_records, declarations
):
    """Read each Brush subclass's own consumed fields through its class chain.

    Only declaration layouts are reused from the static source profile, never
    its class default values. Original CDO zero/parent/tag rules establish the
    defaults; construction, localization and PostLoad remain runtime stages.
    """
    transform_layout = declarations["collisionTransforms"]["layout"]
    reference_layout = declarations["collisionReferences"]["layout"]
    boolean_layout = declarations["collisionBooleans"]["layout"]
    attached = declarations["collisionAttached"]
    if {f["name"] for f in transform_layout} != set(TRANSFORM_TYPES):
        raise ValueError("complete original transform declarations required")
    reference_names = [f["name"] for f in reference_layout]
    if len(reference_names) != 7 or set(reference_names) != {
        "StaticMesh",
        "Owner",
        "Level",
        "XLevel",
        "Mesh",
        "Brush",
        "AntiPortal",
    }:
        raise ValueError("complete original reference declarations required")
    names = {
        name.casefold() for name in {*TRANSFORM_TYPES, *reference_names, "Attached"}
    }
    classes, actors = {}, {}
    for key, brush in brush_models["actors"].items():
        class_key = brush["sourceClass"].casefold()
        if class_key not in classes:
            chain, current = [], defaults.read(brush["sourceClass"])
            while current is not None:
                chain.append(current)
                current = (
                    defaults.records[current["parent"].casefold()]
                    if current["parent"]
                    else None
                )
            # Zero initial CDO storage; inherited tags below replace these values.
            transforms = {
                name: [0, 0, 0] if kind else 0
                for name, (kind, _) in TRANSFORM_TYPES.items()
            }
            origins = dict.fromkeys(transforms, "zero-initialized-class-default")
            references = {
                name: dict(
                    reference=0,
                    qualified=None,
                    package="Core",
                    origin="zero-initialized-class-default",
                )
                for name in reference_names
            }
            for row in reversed(chain):
                package_name = row["sourceClass"].split(".")[0]
                source_pkg = defaults.catalog.packages[package_name]
                class_ex = next(
                    e
                    for e in source_pkg.exports
                    if source_pkg.class_name_of(e) == "Class"
                    and qualified_ref(source_pkg, e.index + 1) == row["sourceClass"]
                )
                if row["sourceClass"].casefold() not in ("core.object", "engine.actor"):
                    if any(
                        e.package_index == class_ex.index + 1
                        and source_pkg.export_name(e).casefold() in names
                        for e in source_pkg.exports
                    ):
                        raise ValueError("subclass redeclares a consumed Actor field")
                tags = [dict(t, raw=bytes.fromhex(t["raw"])) for t in row["tags"]]
                if any(t["name"].casefold() == "attached" for t in tags):
                    raise ValueError("tagged Attached default requires array loading")
                for tag in decoded_transform_tags(tags):
                    transforms[tag["name"]] = tag["value"]
                    origins[tag["name"]] = row["sourceClass"]
                for tag in decoded_reference_tags(source_pkg, tags, reference_names):
                    references[tag["name"]] = {
                        k: v
                        for k, v in dict(tag, origin=row["sourceClass"]).items()
                        if k != "name"
                    }
            classes[class_key] = dict(
                sourceClass=brush["sourceClass"],
                scope="saved-brush-actor-defaults",
                ancestry=[r["sourceClass"] for r in chain],
                collisionTransforms=dict(
                    layout=transform_layout, defaults=transforms, origins=origins
                ),
                collisionBooleans=dict(
                    layout=boolean_layout,
                    defaultGroups=chain[0]["actorBooleans"]["groups"],
                ),
                collisionReferences=dict(layout=reference_layout, defaults=references),
                collisionAttached=dict(
                    layout=attached["layout"],
                    inner=attached["inner"],
                    defaultCount=0,
                    defaultOrigin="zero-initialized-class-default",
                ),
            )
        cls = classes[class_key]
        ex = pkg.exports[int(key) - 1]
        frame = brush["savedStateFrame"]
        start, end = (
            ex.serial_offset + frame["sourceBytes"],
            ex.serial_offset + ex.serial_size,
        )
        tags, consumed = read_props_ordered(pkg, start, end=end)
        if consumed != end:
            raise ValueError("Brush fields have an unsupported native tail")
        transform_tags = decoded_transform_tags(tags)
        reference_tags = decoded_reference_tags(pkg, tags, reference_names)
        fields = dict(cls["collisionReferences"]["defaults"])
        for tag in reference_tags:
            fields[tag["name"]] = {k: v for k, v in tag.items() if k != "name"}
        actors[key] = dict(
            sourceClass=brush["sourceClass"],
            exportRef=int(key),
            exportSHA256=identities[key]["exportSHA256"],
            savedStateFrame=frame,
            savedActorLoading=dict(
                scope="saved-actor-loading-inputs",
                fileVersion=pkg.file_version,
                sourceOffset=start,
                sourceBytes=end - start,
                sourceSHA256=sha(pkg.data[start:end]),
                attachedOverrideCount=sum(
                    t["name"].casefold() == "attached" for t in tags
                ),
                tags=[
                    {k: t[k] for k in ("name", "type", "index", "struct")} for t in tags
                ],
            ),
            savedTransform=dict(
                scope="saved-map-and-class-defaults", tags=transform_tags
            ),
            savedReferences=dict(
                scope="saved-map-and-class-defaults", tags=reference_tags, fields=fields
            ),
            savedCollisionFlags=dict(
                scope="saved-map-and-class-defaults", tags=boolean_records[key]["tags"]
            ),
        )
    return dict(scope="saved-brush-actor-fields", classes=classes, actors=actors)

def saved_brush_models(pkg, identities, defaults):
    """Bind each saved Brush subclass to its exact Model resource, once."""
    actors, models, polys = {}, {}, {}
    for key, identity in identities.items():
        ancestry, current = [], defaults.read(identity["classIdentity"])
        while current is not None:
            ancestry.append(current)
            current = (
                defaults.records[current["parent"].casefold()]
                if current["parent"]
                else None
            )
        if not any(row["sourceClass"].casefold() == "engine.brush" for row in ancestry):
            continue
        inherited = dict(
            reference=0, package="Core", origin="zero-initialized-class-default"
        )
        for row in reversed(ancestry):
            for tag in row["tags"]:
                if tag["name"].casefold() != "brush":
                    continue
                if tag["type"] != 5 or tag["index"] != 0:
                    raise ValueError("unsupported class Brush reference tag")
                raw = bytes.fromhex(tag["raw"])
                reader = Reader(raw)
                ref = reader.compact()
                if reader.pos != len(raw) or raw != encode_compact(ref):
                    raise ValueError("noncanonical class Brush reference")
                inherited = dict(
                    reference=ref,
                    package=row["sourceClass"].split(".")[0],
                    origin=row["sourceClass"],
                )
        ex = pkg.exports[int(key) - 1]
        frame = saved_actor_frame(pkg, ex)
        start = ex.serial_offset + frame["sourceBytes"]
        tags, end = read_props_ordered(
            pkg, start, end=ex.serial_offset + ex.serial_size
        )
        if end != ex.serial_offset + ex.serial_size:
            raise ValueError("unexpected Brush actor native tail")
        overrides = saved_reference_overrides(pkg, tags, {"Brush"})
        saved = dict(inherited)
        if "Brush" in overrides:
            saved = dict(overrides["Brush"], origin=identity["identity"])
        ref = saved["reference"]
        if ref and (
            saved["package"].casefold() != Path(pkg.path).stem.casefold()
            or ref <= 0
            or ref > len(pkg.exports)
        ):
            raise ValueError("nonlocal Brush Model needs source package resolution")
        if ref and str(ref) not in models:
            models[str(ref)] = saved_model_resource(pkg, pkg.exports[ref - 1])
            poly_ref = models[str(ref)]["polysReference"]
            if type(poly_ref) is not int or not 0 <= poly_ref <= len(pkg.exports):
                raise ValueError("nonlocal Model Polys needs source package resolution")
            if poly_ref and str(poly_ref) not in polys:
                polys[str(poly_ref)] = saved_polys_resource(pkg, pkg.exports[poly_ref - 1])
        actors[key] = dict(
            sourceClass=identity["classIdentity"],
            defaults=inherited,
            savedReference=saved,
            modelRef=ref,
            savedStateFrame=frame,
            propertyStream=dict(
                sourceOffset=start,
                sourceBytes=end - start,
                sourceSHA256=sha(pkg.data[start:end]),
            ),
        )
    return dict(scope="saved-brush-model-resources", actors=actors, models=models, polys=polys)


def level_collision_layout(pkg):
    """Read the LevelInfo Boolean word consumed by collision admission.

    The typed-copy constructor and Core Boolean packing bind the offset/masks
    independently in actor_transform_source. No undeclared bits are supplied.
    """
    owners = [
        e
        for e in pkg.exports
        if pkg.class_name_of(e) == "Class" and pkg.export_name(e) == "LevelInfo"
    ]
    if len(owners) != 1:
        raise ValueError("ambiguous LevelInfo class declaration")
    owner = owners[0].index + 1
    anchors = [
        e
        for e in pkg.exports
        if e.package_index == owner and pkg.export_name(e) == "SelectedGroups"
    ]
    if len(anchors) != 1:
        raise ValueError("ambiguous LevelInfo Boolean anchor")
    before = actor_declaration(pkg, anchors[0].index + 1, owner)
    if before["kind"] != "StrProperty":
        raise ValueError("unsupported LevelInfo Boolean anchor")
    cursor, fields = before["next"], []
    for name, flags in [("bLonePlayer", 1), ("bBegunPlay", 0), ("bPlayersOnly", 0)]:
        field = actor_declaration(pkg, cursor, owner)
        if (field["kind"], field["name"], field["propertyFlags"]) != (
            "BoolProperty",
            name,
            flags,
        ):
            raise ValueError("unsupported LevelInfo Boolean chain")
        fields.append(dict(field, mask=1 << len(fields)))
        cursor = field["next"]
    after = actor_declaration(pkg, cursor, owner)
    if after["name"] != "DetailMode" or after["kind"] != "ByteProperty":
        raise ValueError("unsupported LevelInfo Boolean endpoint")
    return [dict(offset="0x554", mask=7, before=before, after=after, fields=fields)]


def level_collision_defaults():
    """Recover the declared mode bits through every original class ancestor.

    Uses the source-bound serialized class prefix. Unsupported bytecode remains
    unsupported. The qualified UClass zero-plus-parent path supplies absent
    declared bits; this result is a default buffer, not a live level mode.
    """
    catalog = OriginalClasses()
    chain = [
        "Core.Object",
        "Engine.Actor",
        "Engine.Info",
        "Engine.ZoneInfo",
        "Engine.LevelInfo",
    ]
    values, evidence = {}, []
    for index, qualified in enumerate(chain):
        types = catalog.property_types(qualified, set())
        package, name = qualified.split(".")
        pkg = catalog.packages[catalog.files[package.casefold()].stem]
        matches = [
            e
            for e in pkg.exports
            if pkg.class_name_of(e) == "Class" and pkg.export_name(e) == name
        ]
        if len(matches) != 1:
            raise ValueError("ambiguous LevelInfo ancestor")
        ex = matches[0]
        parent = qualified_ref(pkg, ex.super_index) if ex.super_index else None
        if parent != (chain[index - 1] if index else None):
            raise ValueError("unsupported LevelInfo inheritance")
        props, proof = serialized_defaults(pkg, ex, types)
        values.update({name: value for name, _, value in props})
        evidence.append(dict(sourceClass=qualified, parent=parent, **proof))
    layout = level_collision_layout(pkg)
    names = [field["name"] for field in layout[0]["fields"]]
    zero = [name for name in names if name not in values]
    defaults = {name: values.get(name, False) for name in names}
    if any(type(value) is not bool for value in defaults.values()):
        raise ValueError("non-Boolean LevelInfo mode default")
    return dict(
        scope="declared-class-default-bits",
        layout=layout,
        defaultGroups={
            "0x554": dict(
                mask=7,
                value=sum(
                    field["mask"]
                    for field in layout[0]["fields"]
                    if defaults[field["name"]]
                ),
            )
        },
        zeroInitialized=zero,
        classDefaults=evidence,
        sources=catalog.sources,
    )


def saved_level_collision_mode(pkg, binding, defaults):
    """Recover the exact first actor's declared mode bits and ordered overrides.

    Saved mode is not current collision mode. Native construction, loading and
    later startup writes remain separate evidence and browser lifecycle stages.
    """
    arrays = [row for row in binding["actorArrays"] if row["nativeField"] == "0x38"]
    if len(arrays) != 1 or not arrays[0]["references"]:
        raise ValueError("missing saved current-level actor array")
    reference = arrays[0]["references"][0]
    if not 0 < reference <= len(pkg.exports):
        raise ValueError("saved first actor is not a local LevelInfo")
    ex = pkg.exports[reference - 1]
    if qualified_ref(pkg, ex.class_index) != "Engine.LevelInfo":
        raise ValueError("saved first actor is not Engine.LevelInfo")
    frame = saved_actor_frame(pkg, ex)
    start, end = (
        ex.serial_offset + frame["sourceBytes"],
        ex.serial_offset + ex.serial_size,
    )
    props, consumed = read_props_ordered(pkg, start, end=end)
    if consumed != end:
        raise ValueError("LevelInfo property stream does not end at export boundary")
    fields = {field["name"]: field for field in defaults["layout"][0]["fields"]}
    tags, value = [], defaults["defaultGroups"]["0x554"]["value"]
    for prop in props:
        field = fields.get(prop["name"])
        if field is None:
            continue
        if prop["type"] != 3 or prop["index"] != 0 or type(prop["boolval"]) is not bool:
            raise ValueError("malformed LevelInfo mode property")
        tags.append(dict(name=prop["name"], value=prop["boolval"]))
        value = value | field["mask"] if prop["boolval"] else value & ~field["mask"]
    return dict(
        scope="saved-level-info-collision-mode",
        reference=reference,
        identity=qualified_ref(pkg, reference),
        sourceClass="Engine.LevelInfo",
        savedExportFlags=ex.object_flags,
        savedStateFrame=frame,
        exportOffset=ex.serial_offset,
        exportLength=ex.serial_size,
        exportSHA256=sha(pkg.data[ex.serial_offset : end]),
        propertiesOffset=start,
        propertiesLength=end - start,
        propertiesSHA256=sha(pkg.data[start:end]),
        tags=tags,
        groups={"0x554": dict(mask=7, value=value)},
    )


def actor_field_evidence(pkg):
    """Read original declared field identities and linked collision-bool order."""
    names = ['CollisionHeight', 'bCollideActors', 'bCollideWorld', 'bBlockActors',
             'bBlockPlayers', 'bProjTarget', 'bBlockZeroExtentTraces',
             'bBlockNonZeroExtentTraces', 'bAutoAlignToTerrain', 'Rotation', 'PrePivot']
    records = {}
    for name in names:
        matches = [e for e in pkg.exports if pkg.export_name(e) == name
                   and e.package_index > 0
                   and qualified_ref(pkg, e.package_index) == 'Engine.Actor']
        if len(matches) != 1: raise ValueError('missing/ambiguous Actor field: ' + name)
        ex = matches[0]; r = pkg.body_reader(ex)
        if pkg.name(r.compact()) != 'None' or r.compact() != 0:
            raise ValueError('unsupported Actor field header')
        next_field = qualified_ref(pkg, r.compact())
        dimension, flags, category = r.u32(), r.u32(), pkg.name(r.compact())
        kind = pkg.class_name_of(ex)
        expected = 'StructProperty' if name in ('Rotation', 'PrePivot') else (
            'FloatProperty' if name == 'CollisionHeight' else 'BoolProperty')
        if kind != expected or dimension != 1 or flags not in (1, 3):
            raise ValueError('unsupported Actor field layout: ' + name)
        struct_type = qualified_ref(pkg, r.compact()) if expected == 'StructProperty' else None
        if expected == 'StructProperty' and struct_type != ('Core.Object.Rotator' if name == 'Rotation' else 'Core.Object.Vector'):
            raise ValueError('unsupported Actor struct type: ' + name)
        if r.pos != ex.serial_offset + ex.serial_size:
            raise ValueError('trailing Actor field bytes')
        records[name] = {'kind': kind, 'next': next_field, 'flags': flags,
                         'struct': struct_type,
                         'exportSHA256': sha(pkg.data[ex.serial_offset:r.pos])}
    for previous, following in zip(names[:8], names[1:9]):
        if records[previous]['next'] != 'Engine.Actor.' + following:
            raise ValueError('unsupported collision field order')
    return records



def eligible_materials(materials, referenced):
    """Unreferenced slots cannot make a collision triangle participate.

    The source tree's triangle material +4c supplies result material lookup.
    Retain a conservative explicit-enable gate on every actually used slot;
    this does not insert render faces belonging to unused/disabled materials.
    """
    for index in set(referenced):
        if not 0 <= index < len(materials): raise ValueError('invalid collision material')
        if materials[index].get('EnableCollision') is not True:
            raise ValueError('collision-referenced material is not explicitly enabled')


def saved_actor_frame(pkg, ex):
    """Retain the complete supported saved frame; no live state is inferred."""
    frame = read_map_actor_frame(pkg, ex)
    if frame is None:
        raise ValueError('unsupported saved actor state frame')
    raw = bytes(pkg.data[ex.serial_offset:ex.serial_offset + frame.size])
    return dict(scope='saved-map-state-frame', savedExportFlags=ex.object_flags,
                classIdentity=qualified_ref(pkg, ex.class_index),
                node=frame.node, stateNode=frame.state_node,
                probeMaskWords=[frame.probe_mask & 0xFFFFFFFF,
                                (frame.probe_mask >> 32) & 0xFFFFFFFF],
                word28=frame.latent_action & 0xFFFFFFFF, codeOffset=frame.offset,
                sourceOffset=ex.serial_offset, sourceBytes=frame.size, sourceSHA256=sha(raw))


def actor_record(pkg, ex, inherited, *, retain_source_transform=False, boolean_layout=None,
                 reference_defaults=None, retain_state_frame=False):
    name = pkg.export_name(ex)
    result = {'name': name, 'issues': [], 'class': pkg.class_name_of(ex)}
    if result['class'] != 'StaticMeshActor' or qualified_ref(pkg, ex.class_index) != 'Engine.StaticMeshActor':
        result['issues'].append('unsupported-actor-class'); return result
    off = actor_prop_offset(pkg, ex)
    if off is None:
        result['issues'].append('unsupported-actor-framing'); return result
    if retain_state_frame:
        result['savedStateFrame'] = saved_actor_frame(pkg, ex)
    props, end = read_props_ordered(pkg, ex.serial_offset + off,
                                  end=ex.serial_offset + ex.serial_size)
    if end != ex.serial_offset + ex.serial_size:
        result['issues'].append('actor-properties-trailing-bytes'); return result
    if retain_state_frame:
        start = ex.serial_offset + off
        result['savedActorLoading'] = dict(scope='saved-actor-loading-inputs',
            fileVersion=pkg.file_version, sourceOffset=start, sourceBytes=end-start,
            sourceSHA256=sha(pkg.data[start:end]),
            attachedOverrideCount=sum(p['name'] == 'Attached' for p in props),
            tags=[{key: tag[key] for key in ('name', 'type', 'index', 'struct')}
                  for tag in props])
    if reference_defaults is not None:
        overrides = saved_reference_overrides(pkg, props, reference_defaults)
        result['savedReferences'] = dict(
            scope='saved-map-and-class-defaults',
            tags=[dict(name=p['name'], reference=overrides[p['name']]['reference'],
                       package=Path(pkg.path).stem)
                  for p in props if p['name'] in overrides],
            fields={name: dict(overrides.get(name, value))
                    for name, value in reference_defaults.items()})
    values, mesh, position = dict(inherited), None, None
    rotation = list(inherited['Rotation']) if 'Rotation' in inherited else None
    rotation_source = 'inherited-class-default' if rotation is not None else None
    expected = {'StaticMesh': (5, None), 'Location': (10, 12), 'Rotation': (10, 12),
                'DrawScale3D': (10, 12), 'PrePivot': (10, 12), 'DrawScale': (4, 4)}
    expected.update({k: (3, None) for k in ('bStatic', 'bCollideActors', 'bBlockActors',
        'bBlockPlayers', 'bBlockZeroExtentTraces', 'bBlockNonZeroExtentTraces', 'bUseCylinderCollision')})
    boolean_names = {field['name'] for group in boolean_layout or [] for field in group['fields']}
    expected.update({name: (3, None) for name in boolean_names})
    seen = set()
    for p in props:
        k, raw = p['name'], p['raw']
        if k in expected:
            kind, size = expected[k]
            if k in seen:
                result['issues'].append('duplicate-property:' + k); continue
            seen.add(k)
            struct_type = 'Rotator' if k == 'Rotation' else 'Vector'
            if (p['type'] != kind or size is not None and len(raw) != size
                    or p.get('index', 0) != 0
                    or kind == 10 and p.get('struct') != struct_type):
                result['issues'].append('malformed-property:' + k); continue
        if p['type'] == 3: values[k] = p['boolval']
        elif k == 'StaticMesh': mesh = qualified_ref(pkg, Reader(raw).compact())
        elif k in ('Location', 'DrawScale3D', 'PrePivot'):
            value = list(struct.unpack('<3f', raw))
            if k == 'Location': position = value
            else: values[k] = value
        elif k == 'Rotation':
            rotation = list(struct.unpack('<3i', raw)); rotation_source = 'map-property'
        elif k == 'DrawScale': values[k] = struct.unpack('<f', raw)[0]
    required = ('bStatic', 'bCollideActors', 'bBlockActors', 'bBlockPlayers',
                'bBlockNonZeroExtentTraces')
    # Native mouse picking supplies extent (0.1,0.1,0.1), taking the nonzero
    # branch. Preserve the independent zero-extent value without requiring it.
    flags = {k: values.get(k) for k in (*required, 'bBlockZeroExtentTraces')}
    result['flags'] = flags
    for k in required:
        value = flags[k]
        if value is not True: result['issues'].append('unsupported-flag:' + k + '=' + str(value))
    if values.get('bUseCylinderCollision'): result['issues'].append('cylinder-collision')
    if any(values.get('PrePivot', [0, 0, 0])): result['issues'].append('nonzero-prepivot')
    if mesh is None: result['issues'].append('missing-mesh')
    if position is None: result['issues'].append('missing-explicit-location')
    if rotation is None: result['issues'].append('missing-source-rotation-default')
    scale = [values['DrawScale'] * v for v in values['DrawScale3D']]
    if not all(math.isfinite(v) for v in (position or []) + scale) or not all(scale):
        result['issues'].append('invalid-transform')
    result.update(mesh=mesh, position=position, rotation=rotation, rotationSource=rotation_source, scale=scale,
                  exportSHA256=sha(pkg.data[ex.serial_offset:ex.serial_offset+ex.serial_size]))
    if retain_source_transform:
        # Preserve separate source operands. The legacy combined scale above
        # loses the original multiplication/store order and is not this input.
        fields = dict(location=position, rotation=rotation,
                      drawScale=values.get('DrawScale'), drawScale3D=values.get('DrawScale3D'),
                      prePivot=values.get('PrePivot'))
        native_names = dict(location='Location', rotation='Rotation', drawScale='DrawScale',
                            drawScale3D='DrawScale3D', prePivot='PrePivot')
        malformed = any(reason in result['issues']
                        for name in native_names.values()
                        for reason in ('malformed-property:' + name, 'duplicate-property:' + name))
        scalars = [fields['drawScale']]
        for name in ('location', 'rotation', 'drawScale3D', 'prePivot'):
            value = fields[name]
            if not isinstance(value, list) or len(value) != 3:
                malformed = True
            else:
                scalars.extend(value)
        if malformed or any(type(v) not in (int, float) or not math.isfinite(v) for v in scalars):
            result['issues'].append('unsupported-source-transform')
        else:
            result['savedTransform'] = {
                'scope': 'saved-map-and-class-defaults',
                'fields': {k: list(v) if isinstance(v, list) else v for k, v in fields.items()},
                'tags': [dict(name=p['name'], value=(struct.unpack('<f', p['raw'])[0]
                    if p['name'] == 'DrawScale' else list(struct.unpack(
                        '<3i' if p['name'] == 'Rotation' else '<3f', p['raw']))))
                    for p in props if p['name'] in native_names.values()],
                'origins': {k: 'map-property' if name in seen else 'inherited-class-default'
                            for k, name in native_names.items()}}
    if boolean_layout is not None:
        # Only declared bits are known here. Do not fabricate padding or
        # reinterpret saved UObject export flags as these Actor field words.
        malformed = any(reason in result['issues'] for name in boolean_names
                        for reason in ('malformed-property:' + name, 'duplicate-property:' + name))
        if malformed or any(type(values.get(name)) is not bool for name in boolean_names):
            result['issues'].append('unsupported-source-actor-booleans')
        else:
            result['savedCollisionFlags'] = dict(
                scope='saved-map-and-class-defaults',
                tags=[dict(name=p['name'], value=p['boolval'])
                      for p in props if p['name'] in boolean_names],
                groups={group['offset']: dict(mask=group['mask'], value=sum(
                    field['mask'] for field in group['fields'] if values[field['name']]))
                    for group in boolean_layout},
                overrides={name: values[name] for name in sorted(boolean_names & seen)})
    return result



def flattened_reference_collisions(rows):
    """Audit legacy package+leaf keys without adopting them as identities."""
    groups = {}
    for row in rows:
        qualified = row.get('mesh')
        if not qualified: continue
        parts = qualified.split('.')
        leaf = parts[0] + '.' + parts[-1]
        groups.setdefault(leaf, {}).setdefault(qualified, []).append(row['name'])
    return {leaf: members for leaf, members in groups.items() if len(members) > 1}


def reference_census(tiles):
    """Original references only: repeated leaf keys are not shape attribution."""
    reports = {}
    for tile in tiles:
        if not tile.replace('_', '').isdigit() or len(tile.split('_')) != 2:
            raise ValueError('invalid tile name')
        source = ROOT / 'assets/interlude/maps' / (tile + '.unr')
        try:
            pkg, _ = load_package(source)
            rows, unresolved = [], []
            for ex in pkg.exports:
                if pkg.class_name_of(ex) != 'StaticMeshActor': continue
                row = {'name': pkg.export_name(ex), 'mesh': None}
                try:
                    offset = actor_prop_offset(pkg, ex)
                    if offset is None: raise ValueError('unsupported-actor-framing')
                    props, end = read_props_ordered(pkg, ex.serial_offset + offset,
                                                  end=ex.serial_offset + ex.serial_size)
                    if end != ex.serial_offset + ex.serial_size:
                        raise ValueError('actor-properties-trailing-bytes')
                    fields = [p for p in props if p['name'] == 'StaticMesh' and p['type'] == 5]
                    if len(fields) != 1: raise ValueError('missing-or-ambiguous-mesh-field')
                    ref = Reader(fields[0]['raw'])
                    row['mesh'] = qualified_ref(pkg, ref.compact())
                    if ref.pos != len(ref.data): raise ValueError('mesh-reference-trailing-bytes')
                except (L2Error, ValueError, IndexError, struct.error) as error:
                    row['mesh'] = None
                    unresolved.append({'name': row['name'], 'reason': str(error)})
                rows.append(row)
            reports[tile] = {'sourceSHA256': sha(source.read_bytes()), 'actors': len(rows),
                             'unresolved': unresolved,
                             'collisions': flattened_reference_collisions(rows)}
        except (L2Error, ValueError, OSError, IndexError, struct.error) as error:
            reports[tile] = {'error': str(error)}
    summary = {'tiles': len(reports), 'actors': sum(r.get('actors', 0) for r in reports.values()),
               'tilesWithCollisions': sum(bool(r.get('collisions')) for r in reports.values()),
               'collisionGroups': sum(len(r.get('collisions', {})) for r in reports.values()),
               'affectedActorReferences': sum(len(names) for r in reports.values()
                   for group in r.get('collisions', {}).values() for names in group.values()),
               'unresolvedMeshReferences': sum(len(r.get('unresolved', [])) for r in reports.values()),
               'failedMaps': {tile: r['error'] for tile, r in reports.items() if 'error' in r}}
    return {'format': 'l2-qualified-reference-census-v1',
            'scope': 'Original StaticMeshActor references; potential legacy leaf-key collisions, '
                     'not geometry attribution, remaining repair count, or visual parity.',
            'summary': summary, 'tiles': reports}


class Audit:
    def __init__(self, tile, *, retain_sweep_data=False):
        if not tile.replace('_', '').isdigit() or len(tile.split('_')) != 2:
            raise ValueError('invalid tile name')
        from check_picking_native import verify_static_mesh
        self.tile, self.proof = tile, verify_static_mesh()
        self.retain_sweep_data = retain_sweep_data
        if retain_sweep_data:
            from static_mesh_class_source import read_owned_loading_bits
            self.class_loading = read_owned_loading_bits()
            self.actor_class_loading = read_owned_loading_bits(actor=True)
        source = ROOT / 'assets/interlude/maps' / (tile + '.unr')
        self.pkg, _ = load_package(source)
        if retain_sweep_data:
            from export_bsp_collision import level_model_binding
            _, self.level_binding = level_model_binding(self.pkg)
            self.level_mode_defaults = level_collision_defaults()
            self.level_mode = saved_level_collision_mode(self.pkg, self.level_binding, self.level_mode_defaults)
            self.level_slots = {}
            actor_array = next(a for a in self.level_binding['actorArrays'] if a['nativeField'] == '0x38')
            for slot, ref in enumerate(actor_array['references']):
                self.level_slots.setdefault(ref, []).append(slot)
        self.inherited, self.defaults, sources = class_defaults(retain_collision_fields=retain_sweep_data)
        self.boolean_layout = self.defaults[-1]['collisionBooleans']['layout'] if retain_sweep_data else None
        self.reference_defaults = self.defaults[-1]['collisionReferences']['defaults'] if retain_sweep_data else None
        self.sources = {str(source.relative_to(ROOT)): sha(source.read_bytes()), **sources}
        self.packages, self.meshes, self.geometry = {}, {}, {}

    def mesh(self, qualified):
        if qualified in self.meshes: return self.meshes[qualified]
        record = {'issues': []}; self.meshes[qualified] = record
        try:
            package = qualified.split('.')[0]
            if not package or '/' in package or '\\' in package:
                raise ValueError('invalid mesh package name')
            if package not in self.packages:
                path = ROOT / 'assets/interlude/staticmeshes' / (package + '.usx')
                self.packages[package] = load_package(path)[0]
                self.sources[str(path.relative_to(ROOT))] = sha(path.read_bytes())
            pkg = self.packages[package]
            record['version'] = [pkg.file_version, pkg.licensee_version]
            matches = [e for e in pkg.exports if pkg.class_name_of(e) == 'StaticMesh'
                       and qualified_ref(pkg, e.index + 1).casefold() == qualified.casefold()]
            if len(matches) != 1: raise ValueError('missing-or-ambiguous-qualified-mesh')
            ex = matches[0]; r = pkg.body_reader(ex); props = read_properties(pkg, r)
            saved_properties = None
            if self.retain_sweep_data:
                source_class = qualified_ref(pkg, ex.class_index)
                tags, tag_end = read_props_ordered(pkg, ex.serial_offset,
                    end=ex.serial_offset + ex.serial_size)
                if tag_end != r.pos:
                    raise ValueError('ordered-mesh-property-framing-mismatch')
                saved_properties = dict(savedExportFlags=ex.object_flags,
                    tags=[{key: tag[key] for key in ('name', 'type', 'index', 'struct')}
                          for tag in tags])
            mr = Reader(props['Materials'])
            mats = [read_properties(pkg, mr) for _ in range(count(mr))]
            if mr.pos != len(mr.data): raise ValueError('material-properties-trailing-bytes')
            record.update(exportSHA256=sha(pkg.data[ex.serial_offset:ex.serial_offset+ex.serial_size]),
                          materialCount=len(mats),
                          disabledMaterials=[i for i, m in enumerate(mats) if m.get('EnableCollision') is False],
                          unknownMaterials=[i for i, m in enumerate(mats) if m.get('EnableCollision') is None])
            if pkg.file_version != 123:
                raise ValueError('unsupported-source-file-version:' + str(pkg.file_version))
            data = mesh_body(r, lazy_collision=pkg.licensee_version >= 17,
                             export_end=ex.serial_offset + ex.serial_size,
                             retain_sweep_data=self.retain_sweep_data)
            if self.retain_sweep_data:
                data['loadTail'] = mesh_load_tail(r, file_version=pkg.file_version,
                    licensee_version=pkg.licensee_version,
                    export_end=ex.serial_offset + ex.serial_size)
                data.update(sourceClass=source_class, savedProperties=saved_properties)
                if source_class == self.class_loading['sourceClass']:
                    data['classLoading'] = self.class_loading
            referenced = sorted(set(data['materials']))
            if not self.retain_sweep_data:
                del data['materials']
            record['referencedMaterials'] = referenced
            eligible_materials(mats, referenced)
            data.update(sourceExport=qualified, fileVersion=pkg.file_version,
                        licenseeVersion=pkg.licensee_version, exportSHA256=record['exportSHA256'])
            self.geometry[qualified] = data
            record.update({k: data[k] for k in ('collisionTriangleCount', 'renderTriangleCount',
                          'collisionOnlyTriangleCount', 'renderOnlyTriangleCount',
                          'collisionArrayLayout', 'collisionArrayBlocks')})
            record['vertexCount'] = len(data['vertices'])
        except (L2Error, ValueError, OSError, KeyError, IndexError, struct.error) as error:
            record['issues'].append(str(error))
        return record

    def actors(self, names=None):
        exports = [e for e in self.pkg.exports if self.pkg.class_name_of(e) == 'StaticMeshActor']
        if names is not None:
            if len(names) != len(set(names)): raise ValueError('duplicate selected actor')
            selected = []
            for name in names:
                found = [e for e in exports if self.pkg.export_name(e) == name]
                if len(found) != 1: raise ValueError('expected unique StaticMeshActor: ' + name)
                selected.append(found[0])
            exports = selected
        rows = []
        for ex in exports:
            try: row = actor_record(self.pkg, ex, self.inherited,
                                   retain_source_transform=self.retain_sweep_data,
                                   retain_state_frame=self.retain_sweep_data,
                                   boolean_layout=self.boolean_layout,
                                   reference_defaults=self.reference_defaults)
            except (L2Error, ValueError, IndexError, struct.error) as error:
                row = {'name': self.pkg.export_name(ex), 'issues': [str(error)]}
            if self.retain_sweep_data:
                row['exportRef'] = ex.index + 1
                row['savedLevelSlots'] = list(self.level_slots.get(ex.index + 1, []))
            row['meshIssues'] = self.mesh(row['mesh'])['issues'] if row.get('mesh') else []
            rows.append(row)
        return rows

    def reference_bindings(self, rows):
        """Bind consumed saved package indices to exact original exports.

        These are source identities for constructing browser objects, not a
        snapshot of native pointers or proof that factories finished loading.
        All nonnull packages must already be present in this source audit.
        """
        packages = {Path(self.pkg.path).stem: self.pkg, **self.packages}
        result = {}
        fields = [
            field
            for row in rows
            if "savedReferences" in row
            for field in row["savedReferences"]["fields"].values()
        ]
        fields.extend(tag for row in rows for tag in row.get("savedReferences", {}).get("tags", [])
                      if "qualified" in tag)
        for field in fields:
            ref, package_name = field["reference"], field["package"]
            if not ref:
                continue  # IndexToObject(0) does not consume a package table.
            package = packages.get(package_name)
            if package is None:
                raise ValueError("unloaded source reference package: " + package_name)
            table = result.setdefault(
                package_name,
                dict(
                    exportCount=len(package.exports),
                    importCount=len(package.imports),
                    references={},
                ),
            )
            qualified = qualified_ref(package, ref)
            if qualified != field["qualified"]:
                raise ValueError("reference identity differs from source package")
            if str(ref) in table["references"]:
                continue
            if ref > 0:
                target, export = package, package.exports[ref - 1]
            else:
                imported = package.imports[-1 - ref]
                import_class = (
                    package.name(imported.class_package)
                    + "."
                    + package.name(imported.class_name)
                )
                target = packages.get(qualified.split(".")[0])
                if target is None:
                    raise ValueError("unloaded source import package: " + qualified)
                # VerifyImport matches class name/package as well as object
                # name/outer. Real packages contain Texture and StaticMesh
                # exports with exactly the same qualified object name.
                matches = [
                    e
                    for e in target.exports
                    if e.class_index
                    and qualified_ref(target, e.class_index).casefold()
                    == import_class.casefold()
                    and qualified_ref(target, e.index + 1).casefold()
                    == qualified.casefold()
                ]
                if len(matches) != 1:
                    raise ValueError(
                        "missing or ambiguous full source import identity: "
                        + qualified
                        + " exports="
                        + repr(
                            [
                                (e.index + 1, target.class_name_of(e), e.serial_size)
                                for e in matches
                            ]
                        )
                    )
                export = matches[0]
                if not export.object_flags & 4:
                    raise ValueError(
                        "source import requires unported private visibility handling"
                    )
            start, end = export.serial_offset, export.serial_offset + export.serial_size
            if not 0 <= start < end <= len(target.data):
                raise ValueError("reference target body outside source export")
            binding = dict(
                identity=qualified_ref(target, export.index + 1),
                sourcePackage=Path(target.path).stem,
                exportRef=export.index + 1,
                classIdentity=qualified_ref(target, export.class_index),
                exportSHA256=sha(target.data[start:end]),
            )
            table["references"][str(ref)] = binding
        return result

    def report(self, rows):
        supported = [r for r in rows if not r['issues'] and not r['meshIssues']]
        used = {r['mesh'] for r in supported}
        summary = {'actors': len(rows), 'uniqueMeshes': len(self.meshes),
                   'supportedActors': len(supported), 'supportedMeshes': len(used),
                   'uniqueCollisionTriangles': sum(self.geometry[k]['collisionTriangleCount'] for k in used),
                   'placedCollisionTriangles': sum(self.geometry[r['mesh']]['collisionTriangleCount'] for r in supported),
                   'actorReasonCounts': dict(Counter(reason for r in rows for reason in r['issues'])),
                   'meshReasonActorCounts': dict(Counter(reason for r in rows for reason in r['meshIssues']))}
        return {'format': 'l2-static-collision-audit-v1', 'tile': self.tile,
                'sources': self.sources, 'nativeProof': self.proof, 'summary': summary,
                'supportedNames': [r['name'] for r in supported],
                'flattenedReferenceCollisions': flattened_reference_collisions(rows),
                'actors': rows, 'meshes': self.meshes}

    def output(self, rows, *, all_supported=False):
        if self.retain_sweep_data:
            raise ValueError('sweep records require the separate private source output')
        selected = [r for r in rows if not r['issues'] and not r['meshIssues']]
        if not selected or not all_supported and len(selected) != len(rows):
            reasons = {r['name']: r['issues'] + r['meshIssues'] for r in rows if r['issues'] or r['meshIssues']}
            raise ValueError('selected collision actors unsupported: ' + json.dumps(reasons))
        return {'format': FORMAT, 'tile': self.tile, 'nativeProof': self.proof,
                'sources': self.sources, 'classDefaults': self.defaults,
                'selection': {'mode': 'all-currently-supported' if all_supported else 'explicit-actors',
                              'audit': self.report(rows)['summary']},
                'meshes': {k: self.geometry[k] for k in sorted({r['mesh'] for r in selected})},
                'actors': [{k: v for k, v in r.items() if k not in ('issues', 'meshIssues', 'class')}
                           | {'traceEligible': True} for r in selected],
                'limits': ['ray only: native nonzero extent sweep and hit bias unported',
                           'placement uses existing world basis; native rounding unported',
                           'only source-audited static actors; no moving props']}

    def sweep_output(self, rows, *, all_supported=False):
        """Original geometry records only; legacy placed rays are not a matrix source."""
        if not self.retain_sweep_data:
            raise ValueError('source collision records were not retained')
        selected = [r for r in rows if not r['issues'] and not r['meshIssues']]
        if not selected or not all_supported and len(selected) != len(rows):
            raise ValueError('selected source collision actors are not supported')
        return {
            'format': 'l2-static-sweep-source-v1', 'tile': self.tile,
            'sources': self.sources, 'nativeProof': self.proof,
            'classDefaults': self.defaults,
            'actorClassLoading': self.actor_class_loading,
            'savedLevelBinding': self.level_binding,
            'levelCollisionDefaults': self.level_mode_defaults,
            'savedLevelCollisionMode': self.level_mode,
            'savedReferenceBindings': self.reference_bindings(selected),
            'meshes': {k: self.geometry[k] for k in sorted({r['mesh'] for r in selected})},
            'references': [{k: r[k] for k in ('name', 'mesh', 'exportRef', 'exportSHA256',
                'savedTransform', 'savedCollisionFlags', 'savedReferences',
                'savedLevelSlots', 'savedStateFrame', 'savedActorLoading')} for r in selected],
            'limits': [
                'Saved source geometry, not live actor/cache state or a collision query.',
                'savedLocalBounds is the later serialized mesh field; baseSerializedBounds preserves the overwritten primitive record. PostLoad/current mutations remain separate.',
                'loadTail preserves saved fields by native offset and an opaque lazy-array span. References are encoded package indices, not resolved objects; field 0x1dc is the signed saved version, not proof of current state.',
                'Node links and bounds and triangle planes retain source order; no tree rebuild or plane normalization.',
                'Current actor matrices, query state and owner/material callbacks must be supplied separately.',
                'savedTransform preserves separate original operands and their map/default origins; it is not current actor state or a renderer matrix.',
                'savedCollisionFlags contains only declared Boolean bits and explicit map overrides; undeclared padding, current lifecycle writes and current level membership are not inferred.',
                'savedReferences retains canonical package indices, full outer/group names and default/map origins for the seven declared collision references. Null class defaults are not current reference-resolution proof; transient XLevel is assigned separately by level loading.',
                'savedLevelBinding retains both original reference arrays in serialized order, including null/repeated slots. savedLevelSlots identifies membership in field 0x38; an empty list has no saved slot. Export/audit order is not population order, and saved membership does not establish current state.',
                'savedLevelCollisionMode preserves the first LevelInfo actor and its declared default/map bits. Construction and the later bBegunPlay write are separate stages; this is not current startup mode.',
                'Existing conservative actor/material selection gates remain in force.',
                'Original-derived private data; never include in public source or tool bundles.',
            ],
        }

    def world_source_output(self, rows):
        """Keep the full static input set and saved actor order for scene loading.

        Legacy ray-selection gates do not remove actors from this output.
        Missing resources and unimplemented classes remain explicit source
        records; the bundle does not certify current level collision.
        """
        if not self.retain_sweep_data:
            raise ValueError("source collision records were not retained")
        expected = {
            e.index + 1
            for e in self.pkg.exports
            if self.pkg.class_name_of(e) == "StaticMeshActor"
        }
        if {r["exportRef"] for r in rows} != expected or len(rows) != len(expected):
            raise ValueError("world source requires every static actor export")
        arrays = [
            a for a in self.level_binding["actorArrays"] if a["nativeField"] == "0x38"
        ]
        if len(arrays) != 1:
            raise ValueError("saved level actor array required")
        slots = arrays[0]["references"]
        identities = {}
        for ref in sorted(set(slots) | expected):
            if ref == 0:
                continue
            if type(ref) is not int or not 0 < ref <= len(self.pkg.exports):
                raise ValueError("nonlocal saved actor source is not supported")
            ex = self.pkg.exports[ref - 1]
            start, end = ex.serial_offset, ex.serial_offset + ex.serial_size
            if not 0 <= start < end <= len(self.pkg.data):
                raise ValueError("saved actor source lies outside export")
            identities[str(ref)] = dict(
                identity=qualified_ref(self.pkg, ref),
                sourcePackage=self.tile,
                exportRef=ref,
                classIdentity=qualified_ref(self.pkg, ex.class_index),
                exportSHA256=sha(self.pkg.data[start:end]),
            )
        defaults = ActorBooleanDefaults(self.boolean_layout)
        boolean_records = {}
        for key, identity in identities.items():
            ex = self.pkg.exports[int(key) - 1]
            boolean_records[key] = saved_actor_booleans(
                self.pkg, ex, defaults.read(identity['classIdentity']), self.boolean_layout)
        self.sources.update(defaults.catalog.sources)
        from static_mesh_class_source import read_owned_loading_bits
        brush_models = saved_brush_models(self.pkg, identities, defaults)
        brush_models['classLoading'] = read_owned_loading_bits(model=True)
        brush_models['polysClassLoading'] = read_owned_loading_bits(polys=True)
        brush_fields = brush_actor_fields(self.pkg, identities, defaults, brush_models,
                                          boolean_records, self.defaults[-1])
        brush_fields['classLoading'] = {'Engine.Brush': read_owned_loading_bits(brush=True)}
        return dict(
            format="l2-static-world-source-v1",
            tile=self.tile,
            sources=self.sources,
            classDefaults=self.defaults,
            actorClassLoading=self.actor_class_loading,
            savedLevelBinding=self.level_binding,
            savedActorSlots=slots,
            savedActorSources=identities,
            savedActorBooleans=dict(
                scope='saved-actor-declared-booleans',
                classes=defaults.records, actors=boolean_records,
                sources=defaults.catalog.sources,
            ),
            savedBrushModels=brush_models,
            savedBrushActors=brush_fields,
            levelCollisionDefaults=self.level_mode_defaults,
            savedLevelCollisionMode=self.level_mode,
            savedReferenceBindings=self.reference_bindings([*rows, *brush_fields["actors"].values()]),
            meshes=self.geometry,
            actors=rows,
            limits=[
                "All static source records retained, including actors rejected by legacy ray gates and exports absent from the saved level array.",
                "Every saved slot retains its source identity, including unimplemented nonstatic classes. Missing actor/resource preparation is not clear space.",
                "Saved order and LevelInfo mode are not current level startup. This is resource preparation, not collision population or live query acceptance.",
                "Saved Actor Boolean records cover class ancestry and ordered map tags, including nonstatic classes. Constructors, subclass PostLoad and native tail data are not executed or inferred.",
                "Private original-derived data; exclude from public source and tool bundles.",
            ],
        )


def build(tile, names):
    audit = Audit(tile)
    return audit.output(audit.actors(names))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('tile')
    selection = p.add_mutually_exclusive_group(required=True)
    selection.add_argument('--actor', action='append')
    selection.add_argument('--audit', action='store_true', help='read-only source census, full JSON report')
    selection.add_argument('--references-only', action='store_true', help='read-only reference census; tile "all" scans existing scene tiles')
    selection.add_argument('--all-supported', action='store_true', help='explicitly select every actor passing this source audit')
    selection.add_argument('--world-source-output', type=Path,
                           help='create a private complete static source bundle for the scene loader; retains all saved actor slots')
    p.add_argument('--emit', action='store_true', help='write private sidecar and reference in the one existing scene')
    p.add_argument('--sweep-output', type=Path,
                   help='create a separate private original collision-record file; does not change a scene')
    args = p.parse_args()
    if args.world_source_output and (args.emit or args.sweep_output):
        p.error('--world-source-output creates a separate source bundle; cannot also emit legacy collision')
    if (args.audit or args.references_only) and args.emit:
        p.error('source censuses are read-only; use --all-supported to emit the passed set')
    if args.sweep_output and (args.emit or args.audit or args.references_only):
        p.error('--sweep-output requires an actor selection and cannot also emit or run a census')
    if args.references_only:
        tiles = (sorted(p.parent.name for p in (ROOT / 'assets/world').glob('*/scene.json'))
                 if args.tile == 'all' else [args.tile])
        report = reference_census(tiles)
        print(json.dumps(report, indent=2))
        return 1 if report['summary']['failedMaps'] else 0
    audit = Audit(args.tile, retain_sweep_data=bool(args.sweep_output or args.world_source_output)); rows = audit.actors(args.actor)
    if args.world_source_output:
        data = audit.world_source_output(rows)
        with args.world_source_output.open('x') as stream:
            json.dump(data, stream, separators=(',', ':'))
            stream.write('\n')
        print(json.dumps({'tile': args.tile, 'actors': len(data['actors']),
                          'savedSlots': len(data['savedActorSlots']), 'meshes': len(data['meshes']),
                          'worldSourceOutput': str(args.world_source_output)}))
        return
    if args.audit:
        print(json.dumps(audit.report(rows), indent=2)); return
    if args.sweep_output:
        data = audit.sweep_output(rows, all_supported=args.all_supported)
        with args.sweep_output.open('x') as stream:
            json.dump(data, stream, separators=(',', ':'))
            stream.write('\n')
        print(json.dumps({'tile': args.tile, 'meshes': len(data['meshes']),
                          'references': len(data['references']), 'sweepOutput': str(args.sweep_output)}))
        return
    data = audit.output(rows, all_supported=args.all_supported)
    output = ROOT / 'assets/world' / args.tile / 'static-collision.json'
    if args.emit:
        scene_path = output.parent / 'scene.json'
        scene = json.loads(scene_path.read_text())
        output.write_text(json.dumps(data, separators=(',', ':')) + '\n')
        scene['staticCollision'] = output.name
        scene_path.write_text(json.dumps(scene, separators=(',', ':')) + '\n')
    print(json.dumps({'tile': args.tile, 'actors': len(data['actors']), 'emitted': args.emit,
                     'selection': data['selection'],
                     'jsonBytes': len(json.dumps(data, separators=(',', ':')))}))

if __name__ == '__main__': sys.exit(main())
