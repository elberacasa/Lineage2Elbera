"""Portable Elbera Tools collision serialization tests; no proprietary inputs."""
import struct
from pathlib import Path
import unittest
from export_static_collision import Reader, mesh_body, qualified_ref, eligible_materials, Audit, flattened_reference_collisions, actor_record
from types import SimpleNamespace
from unittest.mock import patch
from l2lib import L2Error
from check_static_collision_records import check_arrays


def compact(n):
    sign, n = (128 if n < 0 else 0), abs(n)
    first, n = n & 63, n >> 6
    out = bytearray([first | sign | (64 if n else 0)])
    while n:
        b, n = n & 127, n >> 7
        out.append(b | (128 if n else 0))
    return bytes(out)


def body(*, index=3, collision_model=0, nodes=True, lazy=False, origin=0, planes=None):
    # One rendered triangle, plus a distinct collision-only triangle.
    vertices = [(0, 0, 0), (10, 0, 0), (0, 10, 0), (0, 0, 20)]
    out = bytearray(bytes(41) + compact(0) + bytes(25) + compact(4))
    for v in vertices: out += struct.pack('<6f', *v, 0, 0, 1)
    out += bytes(4) + compact(0) + bytes(4) + compact(0) + bytes(4) + compact(0)
    out += compact(3) + struct.pack('<3H', 0, 1, 2) + bytes(4) + compact(0) + bytes(4)
    out += compact(collision_model)
    triangle_array = bytearray(compact(2))
    for face in [(0, 1, 2, 0), (0, 1, index, 0)]:
        triangle_array += (bytes(64) if planes is None else struct.pack('<16f', *planes))
        triangle_array += b''.join(map(compact, face))
    node_array = bytearray(compact(2 if nodes else 0))
    for links in [(0, 1, -1, -1), (1, -1, -1, -1)]:
        node_array += b''.join(map(compact, links)) + struct.pack('<6fB', 0, 0, 0, 10, 10, 20, 1)
    for array in (triangle_array, node_array):
        if lazy: out += struct.pack('<i', origin + len(out) + 4 + len(array))
        out += array
    return bytes(out)


class StaticCollisionTest(unittest.TestCase):
    def test_source_array_round_trip_preserves_ordinary_and_lazy_bytes(self):
        for lazy in (False, True):
            raw = body(lazy=lazy, planes=[-0.0] + [float(i) for i in range(15)])
            parsed = mesh_body(Reader(raw), lazy_collision=lazy, export_end=len(raw),
                               retain_sweep_data=True)
            spans = check_arrays(raw, parsed)
            self.assertEqual(len(spans), 2)
            self.assertEqual(spans[-1]['start'] + spans[-1]['bytes'], len(raw))
            parsed['collisionTree']['trianglePlanes'][0][0] = 0.0
            with self.assertRaisesRegex(ValueError, 'differ from original bytes'):
                check_arrays(raw, parsed)

    def test_source_array_round_trip_rejects_changed_tree_and_saved_end(self):
        raw = body(lazy=True)
        parsed = mesh_body(Reader(raw), lazy_collision=True, export_end=len(raw),
                           retain_sweep_data=True)
        parsed['collisionTree']['nodes'][0]['links'][1] = -1
        with self.assertRaisesRegex(ValueError, 'differ from original bytes'):
            check_arrays(raw, parsed)
        parsed['collisionTree']['nodes'][0]['links'][1] = 1
        damaged = bytearray(raw)
        struct.pack_into('<i', damaged, parsed['collisionOffset'], len(raw))
        with self.assertRaisesRegex(ValueError, 'saved end'):
            check_arrays(damaged, parsed)

    def test_sweep_records_preserve_planes_links_bounds_and_signed_zero(self):
        values = [-0.0, 2.0, -3.0, 17.0] + [float(i) for i in range(12)]
        expected = struct.pack('<16f', *values)
        for lazy in (False, True):
            raw = body(lazy=lazy, planes=values)
            parsed = mesh_body(Reader(raw), lazy_collision=lazy, export_end=len(raw),
                               retain_sweep_data=True)
            tree = parsed['collisionTree']
            self.assertEqual(len(tree['trianglePlanes']), 2)
            for plane in tree['trianglePlanes']:
                self.assertEqual(struct.pack('<16f', *plane), expected)
            self.assertEqual(tree['nodes'], [
                {'links': [0, 1, -1, -1], 'bounds': [0, 0, 0, 10, 10, 20], 'valid': 1},
                {'links': [1, -1, -1, -1], 'bounds': [0, 0, 0, 10, 10, 20], 'valid': 1},
            ])
            self.assertEqual(parsed['materials'], [0, 0])

    def test_nonfinite_plane_is_not_admitted_as_sweep_data_or_normalized(self):
        for value in (float('inf'), float('-inf'), float('nan')):
            raw = body(planes=[value] + [0.0] * 15)
            with self.assertRaisesRegex(ValueError, 'nonfinite source collision plane'):
                mesh_body(Reader(raw), retain_sweep_data=True)
            # The old ray-only contract never consumes these plane records.
            self.assertNotIn('collisionTree', mesh_body(Reader(raw)))

    def test_default_ray_export_does_not_silently_grow_a_sweep_payload(self):
        self.assertNotIn('collisionTree', mesh_body(Reader(body())))

    def test_collision_only_geometry_is_retained(self):
        parsed = mesh_body(Reader(body()))
        self.assertEqual(parsed['indices'], [0, 1, 2, 0, 1, 3])
        self.assertEqual(parsed['collisionOnlyTriangleCount'], 1)
        self.assertEqual(parsed['renderOnlyTriangleCount'], 0)
        self.assertEqual(parsed['collisionNodeCount'], 2)

    def test_invalid_index_and_unsupported_model_rejected(self):
        for raw in [body(index=-1), body(index=4), body(collision_model=1), body(nodes=False)]:
            with self.assertRaises(ValueError): mesh_body(Reader(raw))

    def test_truncated_node_stream_cannot_admit_partial_geometry(self):
        with self.assertRaises(L2Error): mesh_body(Reader(body()[:-5]))

    def test_negative_array_length_rejected_before_cursor_skipping(self):
        with self.assertRaises(ValueError): mesh_body(Reader(bytes(41) + compact(-1)))

    def test_lazy_absolute_saved_ends_preserve_collision_and_export_tail(self):
        origin = 137
        raw = body(lazy=True, origin=origin)
        package = b'X'*origin + raw + b'untouched mesh tail' + b'next export'
        reader = Reader(package, origin, Path('synthetic.usx'))
        parsed = mesh_body(reader, lazy_collision=True, export_end=origin+len(raw)+19)
        self.assertEqual(parsed['indices'], mesh_body(Reader(body()))['indices'])
        self.assertEqual(parsed['collisionOnlyTriangleCount'], 1)
        self.assertEqual(parsed['collisionArrayLayout'], 'lazy-saved-end')
        blocks = parsed['collisionArrayBlocks']
        self.assertEqual([b['kind'] for b in blocks], ['triangles', 'nodes'])
        self.assertEqual(blocks[0]['savedEnd'], blocks[1]['start'])
        self.assertEqual(blocks[1]['savedEnd'], origin+len(raw))
        self.assertEqual(reader.pos, origin+len(raw))

    def test_lazy_requires_actual_export_bound_not_package_length(self):
        raw = body(lazy=True)
        with self.assertRaisesRegex(ValueError, 'requires original export boundary'):
            mesh_body(Reader(raw), lazy_collision=True)
        # Bytes exist after the object. They cannot justify an out-of-object
        # saved end, even if the package itself is long enough.
        parsed = mesh_body(Reader(raw), lazy_collision=True, export_end=len(raw))
        damaged = bytearray(raw + b'other export' * 20)
        node = parsed['collisionArrayBlocks'][1]
        struct.pack_into('<i', damaged, node['start'], len(raw)+1)
        with self.assertRaisesRegex(ValueError, 'saved-end offset'):
            mesh_body(Reader(damaged), lazy_collision=True, export_end=len(raw))

    def test_lazy_saved_boundary_cannot_be_before_after_or_inside_payload(self):
        raw = body(lazy=True)
        parsed = mesh_body(Reader(raw), lazy_collision=True, export_end=len(raw))
        for block in parsed['collisionArrayBlocks']:
            for bad_end in [-1, block['start'], block['payload'], block['savedEnd']-1,
                            block['savedEnd']+1, len(raw)+100]:
                damaged = bytearray(raw + b'Z')
                struct.pack_into('<i', damaged, block['start'], bad_end)
                with self.subTest(block=block['kind'], end=bad_end):
                    with self.assertRaises((ValueError, L2Error)):
                        mesh_body(Reader(damaged), lazy_collision=True, export_end=len(damaged))

    def test_lazy_truncated_headers_counts_and_elements_fail_closed(self):
        raw = body(lazy=True)
        parsed = mesh_body(Reader(raw), lazy_collision=True, export_end=len(raw))
        for block in parsed['collisionArrayBlocks']:
            for end in [block['start']+2, block['payload'], block['savedEnd']-2]:
                with self.assertRaises((ValueError, L2Error)):
                    mesh_body(Reader(raw[:end]), lazy_collision=True, export_end=end)
            damaged = bytearray(raw)
            damaged[block['payload']] = 0x81  # negative compact count
            with self.assertRaisesRegex(ValueError, 'array count'):
                mesh_body(Reader(damaged), lazy_collision=True, export_end=len(raw))

    def test_lazy_retains_index_model_and_reachability_gates(self):
        for raw in [body(lazy=True, index=-1), body(lazy=True, index=4),
                    body(lazy=True, collision_model=1), body(lazy=True, nodes=False)]:
            with self.assertRaises(ValueError):
                mesh_body(Reader(raw), lazy_collision=True, export_end=len(raw))
        raw = bytearray(body(lazy=True))
        parsed = mesh_body(Reader(raw), lazy_collision=True, export_end=len(raw))
        # Root's child1 no longer reaches the second collision triangle.
        root = parsed['collisionArrayBlocks'][1]['payload'] + 1
        raw[root+1] = 0x81
        with self.assertRaisesRegex(ValueError, 'unreachable'):
            mesh_body(Reader(raw), lazy_collision=True, export_end=len(raw))


class QualificationTest(unittest.TestCase):
    def test_import_group_path_selects_the_matching_duplicate_export(self):
        # Both exports have the same leaf; they are different original objects.
        exports = [SimpleNamespace(name='Town', package_index=0),
                   SimpleNamespace(name='Home', package_index=0),
                   SimpleNamespace(name='Box', package_index=1),
                   SimpleNamespace(name='Box', package_index=2)]
        imports = [SimpleNamespace(name='Objects', package_index=0),
                   SimpleNamespace(name='Home', package_index=-1),
                   SimpleNamespace(name='Box', package_index=-2)]
        pkg = SimpleNamespace(path='Objects.usx', exports=exports,
            resolve_ref=lambda ref: exports[ref-1] if ref > 0 else imports[-ref-1],
            export_name=lambda obj: obj.name, import_name=lambda obj: obj.name)
        reference = qualified_ref(pkg, -3)
        matches = [i for i in (3, 4) if qualified_ref(pkg, i) == reference]
        self.assertEqual(reference, 'Objects.Home.Box')
        self.assertEqual(matches, [4])
        imports[1].package_index = -3
        with self.assertRaisesRegex(ValueError, 'cyclic'): qualified_ref(pkg, -3)

    def test_census_exposes_leaf_collisions_without_merging_source_objects(self):
        collisions = flattened_reference_collisions([
            {'name': 'actor1', 'mesh': 'Objects.Home.Box'},
            {'name': 'actor2', 'mesh': 'Objects.Town.Box'},
            {'name': 'actor3', 'mesh': 'Objects.Home.Lamp'}])
        self.assertEqual(collisions, {'Objects.Box': {
            'Objects.Home.Box': ['actor1'], 'Objects.Town.Box': ['actor2']}})

    def test_unused_disabled_material_does_not_remove_valid_collision_faces(self):
        materials = [{'EnableCollision': True}, {'EnableCollision': False}, {}]
        eligible_materials(materials, [0, 0])
        for referenced in ([1], [2], [3], [-1]):
            with self.assertRaises(ValueError): eligible_materials(materials, referenced)

    def test_explicit_selection_never_silently_emits_a_partial_selection(self):
        audit = Audit.__new__(Audit)
        audit.retain_sweep_data = False
        rows = [{'name': 'good', 'issues': [], 'meshIssues': []},
                {'name': 'bad', 'issues': ['unsupported flag'], 'meshIssues': []}]
        with self.assertRaisesRegex(ValueError, 'bad'): audit.output(rows)

    def test_sweep_source_output_cannot_replace_a_live_ray_sidecar(self):
        audit = Audit.__new__(Audit)
        audit.retain_sweep_data = True
        audit.tile, audit.sources, audit.proof = 'synthetic', {}, {}
        geometry = mesh_body(Reader(body()), retain_sweep_data=True)
        audit.geometry = {'Fixture.Mesh': geometry}
        rows = [{'name': 'Actor1', 'mesh': 'Fixture.Mesh', 'exportSHA256': 'fixture',
                 'issues': [], 'meshIssues': [], 'position': [1, 2, 3], 'scale': [1, 1, 1]}]
        with self.assertRaisesRegex(ValueError, 'separate private source output'):
            audit.output(rows)
        source = audit.sweep_output(rows)
        self.assertEqual(source['references'], [
            {'name': 'Actor1', 'mesh': 'Fixture.Mesh', 'exportSHA256': 'fixture'}])
        self.assertIs(source['meshes']['Fixture.Mesh'], geometry)
        self.assertNotIn('actors', source)
        rows.append({'name': 'Unknown', 'issues': ['unknown'], 'meshIssues': []})
        with self.assertRaises(ValueError):
            audit.sweep_output(rows)
        self.assertEqual(len(audit.sweep_output(rows, all_supported=True)['references']), 1)


class ActorAdmissionTest(unittest.TestCase):
    def actor(self, extra=(), *, inherited_rotation=True):
        inherited = {name: True for name in ('bStatic', 'bCollideActors', 'bBlockActors',
            'bBlockPlayers', 'bBlockZeroExtentTraces', 'bBlockNonZeroExtentTraces')}
        inherited.update(DrawScale=1, DrawScale3D=[1, 1, 1])
        if inherited_rotation: inherited['Rotation'] = [0, 0, 0]
        props = [{'name': 'StaticMesh', 'type': 5, 'raw': compact(-1)},
                 {'name': 'Location', 'type': 10, 'struct': 'Vector', 'raw': struct.pack('<3f', 100, -200, 300)}]
        props.extend(extra)
        imports = [SimpleNamespace(name='Mesh', package_index=0),
                   SimpleNamespace(name='StaticMeshActor', package_index=-3),
                   SimpleNamespace(name='Engine', package_index=0)]
        pkg = SimpleNamespace(data=b'fixture', path='synthetic.unr',
            export_name=lambda _: 'StaticMeshActor1', class_name_of=lambda _: 'StaticMeshActor',
            resolve_ref=lambda ref: imports[-ref-1], import_name=lambda obj: obj.name)
        ex = SimpleNamespace(serial_offset=0, serial_size=7, class_index=-2)
        with patch('export_static_collision.actor_prop_offset', return_value=0), \
             patch('export_static_collision.read_props_ordered', return_value=(props, 7)):
            row = actor_record(pkg, ex, inherited)
        return row, inherited

    def test_omitted_rotation_uses_verified_class_default_without_mutating_it(self):
        row, inherited = self.actor()
        self.assertEqual(row['issues'], [])
        self.assertEqual(row['rotation'], [0, 0, 0])
        self.assertEqual(row['rotationSource'], 'inherited-class-default')
        row['rotation'][0] = 12
        self.assertEqual(inherited['Rotation'], [0, 0, 0])

    def test_explicit_map_rotation_overrides_class_default_in_source_axis_order(self):
        row, _ = self.actor([{'name': 'Rotation', 'type': 10, 'struct': 'Rotator',
                             'raw': struct.pack('<3i', -1024, 32768, 2048)}])
        self.assertEqual(row['issues'], [])
        self.assertEqual(row['rotation'], [-1024, 32768, 2048])
        self.assertEqual(row['rotationSource'], 'map-property')

    def test_unknown_or_malformed_rotation_does_not_invent_an_identity_transform(self):
        row, _ = self.actor(inherited_rotation=False)
        self.assertIn('missing-source-rotation-default', row['issues'])
        self.assertIsNone(row['rotation'])
        for kind, raw in [(10, bytes(8)), (4, bytes(12))]:
            row, _ = self.actor([{'name': 'Rotation', 'type': kind, 'raw': raw}])
            self.assertIn('malformed-property:Rotation', row['issues'])
        row, _ = self.actor([{'name': 'Rotation', 'type': 10, 'struct': 'Vector', 'raw': bytes(12)}])
        self.assertIn('malformed-property:Rotation', row['issues'])

    def test_nonzero_mouse_trace_does_not_require_zero_extent_flag(self):
        row, _ = self.actor([{'name': 'bBlockZeroExtentTraces', 'type': 3,
                             'raw': b'', 'boolval': False}])
        self.assertEqual(row['issues'], [])
        self.assertIs(row['flags']['bBlockZeroExtentTraces'], False)
        self.assertIs(row['flags']['bBlockNonZeroExtentTraces'], True)

    def test_nonzero_and_collision_hash_gates_still_reject_disabled_actors(self):
        for flag in ['bBlockNonZeroExtentTraces', 'bCollideActors', 'bStatic']:
            row, _ = self.actor([{'name': flag, 'type': 3, 'raw': b'', 'boolval': False}])
            self.assertIn('unsupported-flag:' + flag + '=False', row['issues'])

    def test_malformed_and_duplicate_flag_cannot_borrow_enabled_default(self):
        flag = 'bBlockNonZeroExtentTraces'
        for prop in [{'name': flag, 'type': 4, 'raw': bytes(4)},
                     {'name': flag, 'type': 3, 'index': 1, 'raw': b'', 'boolval': True}]:
            row, _ = self.actor([prop])
            self.assertIn('malformed-property:' + flag, row['issues'])
        prop = {'name': flag, 'type': 3, 'raw': b'', 'boolval': True}
        row, _ = self.actor([prop, prop])
        self.assertIn('duplicate-property:' + flag, row['issues'])

if __name__ == '__main__': unittest.main()
