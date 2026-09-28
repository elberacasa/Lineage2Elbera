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
from l2lib import L2Error, Reader, load_package, read_properties, encode_compact
from convert import actor_prop_offset, read_props_ordered
from export_npc_visuals import OriginalClasses, terminal_defaults

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


def class_defaults():
    catalog, values, evidence = OriginalClasses(), {}, []
    for qualified in ('Engine.Actor', 'Engine.StaticMeshActor'):
        types = catalog.property_types(qualified, set())
        pkg = catalog.packages['Engine']
        ex = next(e for e in pkg.exports if pkg.class_name_of(e) == 'Class'
                  and pkg.export_name(e) == qualified.split('.')[1])
        expected_parent = 'Core.Object' if qualified == 'Engine.Actor' else 'Engine.Actor'
        if qualified_ref(pkg, ex.super_index) != expected_parent:
            raise ValueError('unsupported collision class inheritance')
        props, ev = terminal_defaults(pkg, ex, types)
        if ev['defaultsBoundary'] != 'unique-validated-candidate':
            raise ValueError('ambiguous collision class defaults')
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
    return values, evidence, catalog.sources


def actor_field_evidence(pkg):
    """Read original declared field identities and linked collision-bool order."""
    names = ['CollisionHeight', 'bCollideActors', 'bCollideWorld', 'bBlockActors',
             'bBlockPlayers', 'bProjTarget', 'bBlockZeroExtentTraces',
             'bBlockNonZeroExtentTraces', 'bAutoAlignToTerrain', 'Rotation']
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
        expected = 'StructProperty' if name == 'Rotation' else (
            'FloatProperty' if name == 'CollisionHeight' else 'BoolProperty')
        if kind != expected or dimension != 1 or flags not in (1, 3):
            raise ValueError('unsupported Actor field layout: ' + name)
        struct_type = qualified_ref(pkg, r.compact()) if name == 'Rotation' else None
        if name == 'Rotation' and struct_type != 'Core.Object.Rotator':
            raise ValueError('unsupported Actor Rotation type')
        if r.pos != ex.serial_offset + ex.serial_size:
            raise ValueError('trailing Actor field bytes')
        records[name] = {'kind': kind, 'next': next_field, 'flags': flags,
                         'struct': struct_type,
                         'exportSHA256': sha(pkg.data[ex.serial_offset:r.pos])}
    for previous, following in zip(names[:8], names[1:9]):
        if records[previous]['next'] != 'Engine.Actor.' + following:
            raise ValueError('unsupported collision field order')
    return records



def qualified_ref(pkg, reference):
    """Preserve every original outer/group; never choose by duplicate leaf name."""
    parts, seen, last_import = [], set(), False
    while reference:
        if reference in seen: raise ValueError('cyclic object outer chain')
        seen.add(reference)
        obj = pkg.resolve_ref(reference)
        last_import = reference < 0
        parts.append(pkg.import_name(obj) if last_import else pkg.export_name(obj))
        reference = obj.package_index
    if not parts: raise ValueError('null mesh reference')
    if not last_import: parts.append(Path(pkg.path).stem)
    return '.'.join(reversed(parts))


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


def actor_record(pkg, ex, inherited):
    name = pkg.export_name(ex)
    result = {'name': name, 'issues': [], 'class': pkg.class_name_of(ex)}
    if result['class'] != 'StaticMeshActor' or qualified_ref(pkg, ex.class_index) != 'Engine.StaticMeshActor':
        result['issues'].append('unsupported-actor-class'); return result
    off = actor_prop_offset(pkg, ex)
    if off is None:
        result['issues'].append('unsupported-actor-framing'); return result
    props, end = read_props_ordered(pkg, ex.serial_offset + off,
                                  end=ex.serial_offset + ex.serial_size)
    if end != ex.serial_offset + ex.serial_size:
        result['issues'].append('actor-properties-trailing-bytes'); return result
    values, mesh, position = dict(inherited), None, None
    rotation = list(inherited['Rotation']) if 'Rotation' in inherited else None
    rotation_source = 'inherited-class-default' if rotation is not None else None
    expected = {'StaticMesh': (5, None), 'Location': (10, 12), 'Rotation': (10, 12),
                'DrawScale3D': (10, 12), 'PrePivot': (10, 12), 'DrawScale': (4, 4)}
    expected.update({k: (3, None) for k in ('bStatic', 'bCollideActors', 'bBlockActors',
        'bBlockPlayers', 'bBlockZeroExtentTraces', 'bBlockNonZeroExtentTraces', 'bUseCylinderCollision')})
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
        source = ROOT / 'assets/interlude/maps' / (tile + '.unr')
        self.pkg, _ = load_package(source)
        self.inherited, self.defaults, sources = class_defaults()
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
            try: row = actor_record(self.pkg, ex, self.inherited)
            except (L2Error, ValueError, IndexError, struct.error) as error:
                row = {'name': self.pkg.export_name(ex), 'issues': [str(error)]}
            row['meshIssues'] = self.mesh(row['mesh'])['issues'] if row.get('mesh') else []
            rows.append(row)
        return rows

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
            'meshes': {k: self.geometry[k] for k in sorted({r['mesh'] for r in selected})},
            'references': [{k: r[k] for k in ('name', 'mesh', 'exportSHA256')} for r in selected],
            'limits': [
                'Saved source geometry, not live actor/cache state or a collision query.',
                'savedLocalBounds is the later serialized mesh field; baseSerializedBounds preserves the overwritten primitive record. PostLoad/current mutations remain separate.',
                'loadTail preserves saved fields by native offset and an opaque lazy-array span. References are encoded package indices, not resolved objects; field 0x1dc is the signed saved version, not proof of current state.',
                'Node links and bounds and triangle planes retain source order; no tree rebuild or plane normalization.',
                'Current actor matrices, query state and owner/material callbacks must be supplied separately.',
                'Existing conservative actor/material selection gates remain in force.',
                'Original-derived private data; never include in public source or tool bundles.',
            ],
        }


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
    p.add_argument('--emit', action='store_true', help='write private sidecar and reference in the one existing scene')
    p.add_argument('--sweep-output', type=Path,
                   help='create a separate private original collision-record file; does not change a scene')
    args = p.parse_args()
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
    audit = Audit(args.tile, retain_sweep_data=bool(args.sweep_output)); rows = audit.actors(args.actor)
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
