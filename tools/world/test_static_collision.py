"""Portable Elbera Tools collision serialization tests; no proprietary inputs."""
import struct
from pathlib import Path
import unittest
from copy import deepcopy
from export_static_collision import Reader, mesh_body, mesh_load_tail, qualified_ref, eligible_materials, Audit, flattened_reference_collisions, actor_record
from types import SimpleNamespace
from unittest.mock import patch
from l2lib import L2Error
from check_static_collision_records import check_arrays, check_bounds, check_load_tail, check_properties, check_fresh_preparation
from static_mesh_class_source import read_root_class_flags


def compact(n):
    sign, n = (128 if n < 0 else 0), abs(n)
    first, n = n & 63, n >> 6
    out = bytearray([first | sign | (64 if n else 0)])
    while n:
        b, n = n & 127, n >> 7
        out.append(b | (128 if n else 0))
    return bytes(out)


def body(*, index=3, collision_model=0, nodes=True, lazy=False, origin=0, planes=None, base_bounds=None, saved_bounds=None, sections=0):
    # One rendered triangle, plus a distinct collision-only triangle.
    vertices = [(0, 0, 0), (10, 0, 0), (0, 10, 0), (0, 0, 20)]
    base = bytes(25) if base_bounds is None else struct.pack('<6fB', *base_bounds)
    saved = bytes(25) if saved_bounds is None else struct.pack('<6fB', *saved_bounds)
    out = bytearray(base + bytes(16) + compact(sections) + bytes(sections * 14) + saved + compact(4))
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
    def test_ordered_mesh_census_keeps_duplicate_names_indices_and_saved_flags(self):
        # Repeated Materials and explicit header tag remain visible in this
        # census. No dictionary collapse may turn it into initialization proof.
        raw = b'\x01\xa2\x80\x80ABCD\x01\x22EFGH\x02\x22IJKL\0'
        pkg = SimpleNamespace(data=raw, path='authored.usx', file_version=123,
                              name=lambda n: ['None', 'Materials', 'ObjectFlags'][n])
        ex = SimpleNamespace(serial_offset=0, serial_size=len(raw), object_flags=0x2345)
        result = check_properties(pkg, ex, len(raw))
        self.assertEqual(result['duplicateNames'], ['materials'])
        self.assertEqual(result['nativeHeaderTags'], ['ObjectFlags'])
        self.assertEqual([tag['index'] for tag in result['tags']], [128, 0, 0])
        self.assertEqual(result['savedExportFlags'], 0x2345)
        self.assertNotIn('currentFlags', result)
        with self.assertRaisesRegex(ValueError, 'terminator'):
            check_properties(pkg, ex, len(raw)-1)
        ex.serial_size -= 1
        with self.assertRaises(L2Error):
            check_properties(pkg, ex, len(raw))

    def test_later_saved_box_replaces_distinct_primitive_record_with_exact_spans(self):
        origin = 137
        first = [-7., -8., -9., 10., 11., 12., 0]
        second = [-0., -2., -3., 4., 5., 6., 255]
        for lazy in (False, True):
            raw = b'X' * origin + body(lazy=lazy, origin=origin,
                base_bounds=first, saved_bounds=second, sections=65)
            parsed = mesh_body(Reader(raw, origin), lazy_collision=lazy,
                export_end=len(raw), retain_sweep_data=True)
            self.assertEqual(parsed['nativeBodyOffset'], origin)
            self.assertEqual(parsed['baseSerializedBounds']['min'], first[:3])
            saved = parsed['savedLocalBounds']
            self.assertEqual(saved['valid'], 255)
            self.assertEqual(saved['sourceOffset'], origin+41+len(compact(65))+65*14)
            self.assertEqual(struct.pack('<6fB', *saved['min'], *saved['max'], saved['valid']),
                             struct.pack('<6fB', *second))
            self.assertEqual(len(check_bounds(raw, parsed)), 2)
            self.assertEqual(len(check_arrays(raw, parsed)), 2)

    def test_box_round_trip_rejects_changed_values_validity_hash_and_offsets(self):
        raw = body(base_bounds=[-0., 0., 0., 1., 2., 3., 1],
                   saved_bounds=[4., 5., 6., 7., 8., 9., 0], sections=1)
        for name, change in [
            ('baseSerializedBounds', lambda b: b['min'].__setitem__(0, 0.)),
            ('savedLocalBounds', lambda b: b.update(valid=1)),
            ('savedLocalBounds', lambda b: b.update(sourceSHA256='0'*64)),
            ('savedLocalBounds', lambda b: b.update(sourceOffset=0)),
            ('baseSerializedBounds', lambda b: b.update(sourceBytes=24)),
        ]:
            parsed = mesh_body(Reader(raw), retain_sweep_data=True)
            change(parsed[name])
            with self.assertRaises(ValueError): check_bounds(raw, parsed)
        parsed = mesh_body(Reader(raw), retain_sweep_data=True)
        damaged = bytearray(raw); damaged[41] = 0  # wrong section count, same records
        with self.assertRaisesRegex(ValueError, 'span differs'):
            check_bounds(damaged, parsed)

    def test_nonfinite_saved_boxes_remain_unsupported_without_changing_ray_contract(self):
        for name in ('base_bounds', 'saved_bounds'):
            for value in (float('inf'), float('-inf'), float('nan')):
                raw = body(**{name: [value, 0., 0., 1., 1., 1., 0]})
                with self.assertRaisesRegex(ValueError, 'nonfinite serialized mesh bounds'):
                    mesh_body(Reader(raw), retain_sweep_data=True)
                parsed = mesh_body(Reader(raw))
                self.assertNotIn('savedLocalBounds', parsed)
                self.assertEqual(parsed['indices'], [0, 1, 2, 0, 1, 3])

    def test_truncated_prefix_cannot_borrow_the_next_export_for_a_box(self):
        raw = body(sections=1)
        for boundary in (24, 41+1+14+24):
            with self.assertRaises(L2Error):
                mesh_body(Reader(raw), export_end=boundary, retain_sweep_data=True)

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
        parsed = mesh_body(Reader(body()))
        for key in ['collisionTree', 'nativeBodyOffset', 'baseSerializedBounds', 'savedLocalBounds', 'loadTail']:
            self.assertNotIn(key, parsed)

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
    def mesh_fixture(self, *, sweep, repeated=False):
        # A complete authored export: one enabled material, native geometry,
        # and the file-123/licensee-zero tail. No original package is needed.
        material_tag = b'\x01\x29\x01\x02\x83\x00'
        props = material_tag * (2 if repeated else 1) + b'\x00'
        native = body()
        raw = props + native
        raw += struct.pack('<i', len(raw)+5) + b'\x00' + struct.pack('<i', 8) + b'\x00' + bytes(4)
        ex = SimpleNamespace(index=0, name='Mesh', package_index=0,
            class_index=-2, serial_offset=0, serial_size=len(raw), object_flags=0x12345)
        imports = [SimpleNamespace(name='Engine', package_index=0),
                   SimpleNamespace(name='StaticMesh', package_index=-1)]
        pkg = SimpleNamespace(path=Path('Fixture.usx'), data=raw, exports=[ex],
            file_version=123, licensee_version=0,
            name=lambda n: ['None', 'Materials', 'EnableCollision'][n],
            class_name_of=lambda e: 'StaticMesh', body_reader=lambda e: Reader(raw),
            resolve_ref=lambda ref: ex if ref > 0 else imports[-ref-1],
            export_name=lambda e: e.name, import_name=lambda e: e.name)
        audit = Audit.__new__(Audit)
        audit.retain_sweep_data = sweep
        audit.class_loading = dict(sourceClass='Engine.StaticMesh',
            scope='ordinary-native-registration', mask=0x408, value=0)
        audit.packages, audit.meshes, audit.geometry = {'Fixture': pkg}, {}, {}
        return audit

    def test_mesh_export_retains_qualified_class_saved_flags_and_ordered_tags(self):
        for repeated in (False, True):
            audit = self.mesh_fixture(sweep=True, repeated=repeated)
            self.assertEqual(audit.mesh('Fixture.Mesh')['issues'], [])
            mesh = audit.geometry['Fixture.Mesh']
            self.assertEqual(mesh['sourceClass'], 'Engine.StaticMesh')
            self.assertEqual(mesh['savedProperties'], {
                'savedExportFlags': 0x12345,
                'tags': [{'name': 'Materials', 'type': 9, 'index': 0, 'struct': None}]
                        * (2 if repeated else 1)})
            self.assertEqual(mesh['loadTail']['fields']['0x1dc']['value'], 8)

    def test_ray_export_does_not_require_or_emit_fresh_loading_metadata(self):
        audit = self.mesh_fixture(sweep=False)
        # Legacy ray extraction never resolves the source class import chain.
        audit.packages['Fixture'].exports[0].class_index = -999
        self.assertEqual(audit.mesh('Fixture.Mesh')['issues'], [])
        mesh = audit.geometry['Fixture.Mesh']
        for name in ('sourceClass', 'savedProperties', 'loadTail', 'collisionTree'):
            self.assertNotIn(name, mesh)

    def test_browser_preparation_diagnostic_requires_explicit_valid_class_state(self):
        audit = self.mesh_fixture(sweep=True)
        audit.packages['Fixture'].exports[0].object_flags = 0xf0004
        self.assertEqual(audit.mesh('Fixture.Mesh')['issues'], [])
        result = check_fresh_preparation(audit.geometry, 0)
        self.assertEqual(result['cases'], 1)
        self.assertEqual(result['records'][0]['objectFlags'], 0x600f0004)
        self.assertEqual(result['records'][0]['vertexCount'], 4)
        with self.assertRaisesRegex(ValueError, 'class config/localized'):
            check_fresh_preparation(audit.geometry, 0x400)
        from_source = check_fresh_preparation(audit.geometry)
        self.assertEqual(from_source['records'], result['records'])
        self.assertEqual(from_source['classStateEvidence'], 'decoded original native-registration loading bits')
        for invalid in (True, -1, 0x100000000, '0'):
            with self.assertRaises(ValueError):
                check_fresh_preparation(audit.geometry, invalid)

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


class RootClassPrefixTest(unittest.TestCase):
    def fixture(self, *, flags=0x12345678, friendly=1, script_size=0):
        raw = b'head!' + b''.join(compact(v) for v in (0, -65, 0, 130, friendly, 0))
        raw += struct.pack('<iii', 17, 29, script_size) + bytes(22) + struct.pack('<I', flags)
        ex = SimpleNamespace(serial_offset=5, serial_size=len(raw)-5,
                             super_index=0, object_flags=0)
        return SimpleNamespace(file_version=123, path='authored.u', data=raw,
            exports=[ex], class_name_of=lambda e: 'Class', export_name=lambda e: 'Object',
            name=lambda n: 'Object' if n == friendly else 'Other')

    def test_class_prefix_tracks_variable_width_fields_without_guessing_offsets(self):
        for friendly in (1, 128, 16385):
            package = self.fixture(friendly=friendly)
            result = read_root_class_flags(package)
            self.assertEqual(result['flags'], 0x12345678)
            self.assertEqual(result['sourceOffset'], len(package.data)-4)
            self.assertEqual(result['prefixBytes'], len(package.data)-5)

    def test_class_prefix_cannot_borrow_the_following_export(self):
        package = self.fixture()
        end = len(package.data)
        package.data += bytes(128)
        for boundary in range(6, end):
            package.exports[0].serial_size = boundary-5
            with self.assertRaises((ValueError, L2Error)):
                read_root_class_flags(package)

    def test_unknown_root_layouts_fail_instead_of_supplying_class_bits(self):
        for mutation in (
            lambda p: setattr(p, 'file_version', 122),
            lambda p: setattr(p.exports[0], 'super_index', 1),
            lambda p: setattr(p.exports[0], 'object_flags', 0x02000000),
            lambda p: setattr(p, 'name', lambda n: 'Other'),
            lambda p: p.exports.append(p.exports[0]),
        ):
            package = self.fixture()
            mutation(package)
            with self.assertRaises(ValueError): read_root_class_flags(package)
        with self.assertRaisesRegex(ValueError, 'bytecode'):
            read_root_class_flags(self.fixture(script_size=1))


class MeshLoadTailTest(unittest.TestCase):
    def fixture(self, licensee=17, *, origin=37, version=8, reference=-129,
                opaque=b'\x01opaque synthetic bytes'):
        # Authored bytes exercise framing; the opaque payload is not a raw
        # triangle fixture and must never be described as decoded triangles.
        prefix = b''
        if licensee >= 6:
            prefix += struct.pack('<I', 0xffffffff) + compact(-65) + compact(130)
            prefix += struct.pack('<2I', 0x80000000, 0x7fc00001)
        if licensee >= 7: prefix += struct.pack('<2I', 7, 8)
        if licensee >= 11: prefix += struct.pack('<I', 11)
        if licensee >= 13: prefix += struct.pack('<I', 13)
        if licensee >= 14: prefix += struct.pack('<2I', 14, 15)
        if licensee >= 15: prefix += struct.pack('<I', 16)
        saved_end = origin + len(prefix) + 4 + len(opaque)
        raw = bytes(origin) + prefix + struct.pack('<i', saved_end) + opaque
        raw += struct.pack('<i', version) + compact(reference) + struct.pack('<I', 0xff800000)
        return raw, origin, origin+len(prefix)

    def parse(self, raw, origin, licensee=17):
        return mesh_load_tail(Reader(raw, origin), file_version=123,
                              licensee_version=licensee, export_end=len(raw))

    def check(self, raw, origin, tail, licensee=17):
        return check_load_tail(raw, dict(loadTail=tail, fileVersion=123, licenseeVersion=licensee),
                               array_end=origin, export_end=len(raw))

    def test_signed_version_references_and_unknown_word_bits_are_preserved(self):
        for version in (-2147483648, -1, 0, 7, 8, 2147483647):
            raw, origin, _ = self.fixture(version=version)
            tail = self.parse(raw, origin)
            self.assertEqual(tail['fields']['0x1dc']['value'], version)
            self.assertEqual(tail['fields']['0x198']['value'], -65)
            self.assertEqual(tail['fields']['0x19c']['value'], 130)
            self.assertEqual(tail['fields']['0x1f0']['value'], -129)
            self.assertEqual(tail['fields']['0x194']['value'], 0xffffffff)
            self.assertEqual(tail['fields']['0x1a4']['value'], 0x7fc00001)
            self.assertEqual(tail['fields']['0x1e0']['value'], 0xff800000)
            self.assertEqual(self.check(raw, origin, tail)['savedMeshVersion'], version)

    def test_each_licensee_gate_and_exact_export_end(self):
        for licensee, count in [(0, 3), (5, 3), (6, 8), (7, 10), (10, 10),
                                (11, 11), (12, 11), (13, 12), (14, 14),
                                (15, 15), (16, 15), (17, 15), (65535, 15)]:
            raw, origin, _ = self.fixture(licensee)
            reader = Reader(raw + b'next export', origin)
            tail = mesh_load_tail(reader, file_version=123,
                                 licensee_version=licensee, export_end=len(raw))
            self.assertEqual(reader.pos, len(raw))
            self.assertEqual(len(tail['fields']), count)
            self.assertEqual(tail['sourceOffset'] + tail['sourceBytes'], len(raw))
            self.check(raw, origin, tail, licensee)

    def test_lazy_payload_is_opaque_and_saved_end_controls_final_field(self):
        for opaque in (b'\x00', bytes(range(256)), b'\xff' * 129):
            raw, origin, _ = self.fixture(opaque=opaque)
            tail = self.parse(raw, origin)
            lazy = tail['lazyArray1c4']
            self.assertEqual(lazy['payload']['sourceBytes'], len(opaque))
            self.assertEqual(lazy['savedEnd'], tail['fields']['0x1dc']['sourceOffset'])
            self.assertNotIn('count', lazy)
            self.assertEqual(self.check(raw, origin, tail)['opaqueLazyPayloadBytes'], len(opaque))

    def test_no_truncated_tail_can_borrow_from_next_export(self):
        raw, origin, _ = self.fixture()
        for end in range(origin+1, len(raw)):
            reader = Reader(raw + bytes(200), origin)
            with self.assertRaises((ValueError, L2Error)):
                mesh_load_tail(reader, file_version=123, licensee_version=17, export_end=end)
            self.assertEqual(reader.pos, origin)
        with self.assertRaisesRegex(ValueError, 'does not end'):
            self.parse(raw + b'\x00', origin)

    def test_invalid_saved_ends_versions_and_boundaries_are_rejected(self):
        raw, origin, lazy = self.fixture()
        for end in (-1, 0, lazy, lazy+4, len(raw), len(raw)+1):
            damaged = bytearray(raw)
            struct.pack_into('<i', damaged, lazy, end)
            with self.assertRaises((ValueError, L2Error)):
                self.parse(damaged, origin)
        for file_version, licensee in [(122, 17), (124, 17), (123.0, 17), (123, -1),
                                      (123, 65536), (123, True), (123, 17.5)]:
            with self.assertRaisesRegex(ValueError, 'source version'):
                mesh_load_tail(Reader(raw, origin), file_version=file_version,
                               licensee_version=licensee, export_end=len(raw))
        for end in (None, True, -1, origin, len(raw)+1):
            with self.assertRaisesRegex(ValueError, 'export boundary'):
                mesh_load_tail(Reader(raw, origin), file_version=123,
                               licensee_version=17, export_end=end)

    def test_noncanonical_reference_encoding_is_not_silently_normalized(self):
        raw, origin, _ = self.fixture(0, reference=0)
        damaged = raw[:-5] + b'\x40\x00' + raw[-4:]
        with self.assertRaisesRegex(ValueError, 'noncanonical'):
            self.parse(damaged, origin, 0)

    def test_round_trip_rejects_field_span_hash_payload_and_boundary_changes(self):
        raw, origin, _ = self.fixture()
        original = self.parse(raw, origin)
        for mutate in [
            lambda t: t['fields']['0x1dc'].update(value=7),
            lambda t: t['fields']['0x1f0'].update(encoding='i32'),
            lambda t: t['fields']['0x194'].update(sourceOffset=0),
            lambda t: t['fields']['0x194'].update(sourceBytes=3),
            lambda t: t['fields']['0x194'].update(sourceSHA256='0'*64),
            lambda t: t['fields'].pop('0x1bc'),
            lambda t: t['fields'].update(unknown={}),
            lambda t: t['lazyArray1c4'].update(savedEnd=0),
            lambda t: t['lazyArray1c4']['payload'].update(sourceSHA256='0'*64),
            lambda t: t.update(sourceBytes=1),
        ]:
            tail = deepcopy(original)
            mutate(tail)
            with self.assertRaises(ValueError): self.check(raw, origin, tail)
        damaged = bytearray(raw)
        damaged[original['lazyArray1c4']['payload']['sourceOffset']] ^= 1
        with self.assertRaises(ValueError): self.check(damaged, origin, original)
        with self.assertRaisesRegex(ValueError, 'span differs'):
            self.check(raw, origin+1, original)


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
