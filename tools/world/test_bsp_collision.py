"""Portable Elbera Tools BSP serialization/validation; synthetic data only."""
import copy
from pathlib import Path
import struct
from types import SimpleNamespace
import unittest

from export_bsp_collision import export_model, validate_graph, validate_model, stage_path, level_model_binding
from l2lib import L2Error, encode_compact
from l2lib.ue2package import _read_model


def source_fixture(short=False):
    c = encode_compact
    box = struct.pack('<6fB', 0, 0, 0, 10, 10, 0, 1)
    sphere = struct.pack('<4f', 0, 0, 0, 10)
    raw = bytearray(c(0) + box + sphere)  # None property terminator + UPrimitive
    vectors = [(0, 0, 1), (1, 0, 0), (0, 1, 0)]
    points = [(0, 0, 0), (10, 0, 0), (0, 10, 0)]
    for values in (vectors, points):
        raw += c(len(values)) + b''.join(struct.pack('<3f', *v) for v in values)
    raw += c(1) + struct.pack('<4fQB', 0, 0, 1, 0, 1 << 63, 5)
    raw += b''.join(c(i) for i in (0, 0, -1, -1, -1, 0, 0))
    raw += sphere + bytes(range(16)) + bytes((0, 0, 3))
    raw += struct.pack('<5i', -1, 0, -1, 0, -1)
    raw += c(1) + c(0) + struct.pack('<I', 0x08000001)
    raw += b''.join(c(i) for i in (0, 0, 1, 2, -1, 0))
    raw += struct.pack('<5f', 0, 0, 1, 0, 32)
    if not short: raw += struct.pack('<i', -1)
    # Fourth slot is retained source data, but intentionally unused/stale.
    raw += c(4) + b''.join(c(v) + c(-1) for v in (0, 1, 2, 99))
    raw += struct.pack('<2i', 0, 1) + c(0) + struct.pack('<QQf', 1 << 63, 3, 0)
    raw += c(0) + c(1) + box + c(2) + struct.pack('<2i', -1, 0)
    raw += c(1) + c(0) + c(-1) + c(-1) + struct.pack('<Q', 1 << 63)
    raw += c(0) + struct.pack('<2i', 1, 0) + b'\0\0\0'
    origin = 17
    export = SimpleNamespace(index=0, serial_offset=origin, serial_size=len(raw), package_index=0,
                             class_index=-2, object_flags=0, label='Model0')
    level_raw = c(0) + bytes(16) + bytes(5) + struct.pack('<2i', 0, 1) + c(1) + b'UNPARSED LEVEL TAIL'
    level = SimpleNamespace(index=1, serial_offset=origin+len(raw)+17, serial_size=len(level_raw),
                            package_index=0, class_index=-3, object_flags=0, label='myLevel')
    imports = [SimpleNamespace(package_index=0,label='Engine'),
               SimpleNamespace(package_index=-1,label='Model'),
               SimpleNamespace(package_index=-1,label='Level')]
    exports = [export,level]
    def resolve(n):
        if n == 0: return None
        if n > 0 and n <= len(exports): return exports[n-1]
        if n < 0 and -n <= len(imports): return imports[-n-1]
        raise L2Error('bad synthetic reference')
    pkg = SimpleNamespace(data=b'P'*origin + raw + b'NEXT EXPORT BYTES' + level_raw, path=Path('synthetic.unr'),
                          file_version=123, licensee_version=25,
                          name=lambda n: 'None' if n == 0 else 'unexpected',
                          export_name=lambda e: e.label, import_name=lambda e:e.label,
                          resolve_ref=resolve, exports=exports, imports=imports)
    return pkg, export, _read_model(pkg, export, not short)


class BspCollisionTests(unittest.TestCase):
    def test_serialized_level_model_is_selected_instead_of_zoned_heuristic(self):
        pkg, expected, model = source_fixture()
        selected, binding = level_model_binding(pkg)
        self.assertIs(selected, expected)
        self.assertEqual(binding['model'], {'reference':1,'qualified':'synthetic.Model0'})
        self.assertEqual(binding['level']['qualified'], 'synthetic.myLevel')
        self.assertEqual(binding['actorArrays'][0]['count'], 0)
        self.assertEqual(binding['remainingTailBytes'], len(b'UNPARSED LEVEL TAIL'))
        result = export_model(pkg, model, '00_00', '0'*64, 111)
        self.assertEqual(result['source']['levelBinding'], binding)
        # Another Model's contents, including its zone count, are never searched.
        other = copy.copy(expected); other.index=2; other.label='UnselectedModel'
        pkg.exports.append(other)
        self.assertIs(level_model_binding(pkg)[0], expected)
        wrong = copy.copy(model); wrong.export=other
        with self.assertRaisesRegex(ValueError,'differs from serialized'): export_model(pkg,wrong,'00_00','0'*64,111)

    def test_level_prefix_handles_reference_arrays_and_unicode_url_without_tail_guess(self):
        pkg, expected, _ = source_fixture()
        level=pkg.exports[1];c=encode_compact
        ansi=lambda s:c(len(s)+1)+s.encode('latin-1')+b'\0'
        wide=lambda s:c(-(len(s)+1))+s.encode('utf-16-le')+b'\0\0'
        body=(c(0)+struct.pack('<2i',2,2)+c(0)+c(1)+struct.pack('<2i',1,1)+c(2)+
              ansi('proto')+wide('host')+ansi('map')+c(0)+c(1)+ansi('option')+
              struct.pack('<2i',1234,1)+c(1)+b'tail')
        pkg.data=pkg.data[:level.serial_offset]+body;level.serial_size=len(body)
        selected,binding=level_model_binding(pkg)
        self.assertIs(selected,expected)
        self.assertEqual([row['count'] for row in binding['actorArrays']],[2,1])
        self.assertEqual(binding['urlOptionCount'],1)
        self.assertEqual(binding['remainingTailBytes'],4)

    def test_level_binding_rejects_ambiguous_identity_and_unsupported_layout(self):
        for mutate in [lambda p:setattr(p,'file_version',122),lambda p:setattr(p,'licensee_version',22),
                       lambda p:setattr(p.exports[1],'object_flags',0x02000000),
                       lambda p:setattr(p.exports[1],'package_index',1),
                       lambda p:setattr(p.imports[0],'label','UnrelatedPackage'),
                       lambda p:p.exports.append(copy.copy(p.exports[1]))]:
            pkg,_,_=source_fixture();mutate(pkg)
            with self.assertRaises(ValueError):level_model_binding(pkg)

    def test_level_binding_rejects_wrong_reference_counts_strings_and_truncation(self):
        for malformed in ['negative','unequal','huge','actor-ref','string','model-null','model-import','model-class','model-range','properties']:
            pkg,_,_=source_fixture();level=pkg.exports[1]
            body=bytearray(pkg.data[level.serial_offset:level.serial_offset+level.serial_size])
            if malformed=='negative':struct.pack_into('<i',body,1,-1)
            elif malformed=='unequal':struct.pack_into('<i',body,5,1)
            elif malformed=='huge':struct.pack_into('<2i',body,1,0x7fffffff,0x7fffffff)
            elif malformed=='actor-ref':body[1:9]=struct.pack('<2i',1,1)+encode_compact(999)
            elif malformed=='string':body[17:18]=encode_compact(2)+b'XX'
            elif malformed=='model-null':body[30]=0
            elif malformed=='model-import':body[30]=0x81
            elif malformed=='model-class':body[30]=2
            elif malformed=='model-range':body[30]=63
            elif malformed=='properties':body[0]=1
            pkg.data=pkg.data[:level.serial_offset]+body;level.serial_size=len(body)
            with self.subTest(malformed=malformed),self.assertRaises((ValueError,L2Error)):
                level_model_binding(pkg)
        pkg,_,_=source_fixture();level=pkg.exports[1]
        # All bytes still exist in the package; the Level export ends before Model.
        level.serial_size=30
        with self.assertRaises(L2Error):level_model_binding(pkg)
        level.serial_offset=-1
        with self.assertRaisesRegex(ValueError,'outside package'):level_model_binding(pkg)

    def test_original_fields_and_absolute_source_consumption_retained(self):
        _, export, model = source_fixture()
        self.assertEqual(model.nodes[0].i_leaf, (-1, 0))
        self.assertEqual(model.nodes[0].reserved, bytes(range(16)))
        self.assertEqual(model.nodes[0].i_collision_bound, 0)
        self.assertEqual(model.nodes[0].i_render_bound, 0)
        self.assertEqual(model.leaf_hulls, [-1, 0])
        self.assertEqual(model.root_outside, 1)
        self.assertEqual(model.lightmap_tail, 3)
        self.assertEqual(model.source_spans['properties'], (export.serial_offset, export.serial_offset+1))
        self.assertEqual(validate_model(model)['unusedOutOfRangePointSlots'], 1)

    def test_unused_stale_vertex_is_preserved_but_cannot_become_active(self):
        pkg, _, model = source_fixture()
        result = export_model(pkg, model, '00_00', '0'*64, 111)
        self.assertEqual(result['vertices'][-1], (99, -1))
        self.assertEqual(result['nodes'][0]['numVertices'], 3)
        self.assertEqual(result['nodes'][0]['zoneMask'], '8000000000000000')
        self.assertEqual(result['leaves'][0]['visibleZones'], '8000000000000000')
        model.nodes[0].num_vertices = 4
        with self.assertRaisesRegex(ValueError, 'active vertex point'): validate_model(model)

    def test_truncated_export_cannot_borrow_adjacent_package_bytes(self):
        pkg, export, _ = source_fixture()
        # The package still contains all bytes. The declared export now ends
        # in the final Linked integer, so the bounded reader must reject it.
        export.serial_size -= 4
        with self.assertRaises(L2Error): _read_model(pkg, export, True)
        export.serial_offset = -1
        with self.assertRaisesRegex(L2Error, 'outside package'): _read_model(pkg, export, True)

    def test_short_surface_layout_preserves_field_absence(self):
        _, _, model = source_fixture(short=True)
        self.assertIsNone(model.surfs[0].i_lightmap_index)
        self.assertEqual(validate_model(model)['root0ReachableNodes'], 1)

    def test_graph_checks_all_links_and_disconnected_cycles(self):
        node = lambda front=-1, back=-1, plane=-1: SimpleNamespace(i_front=front, i_back=back, i_plane=plane)
        self.assertEqual(validate_graph([node(1, 2), node(plane=3), node(), node()]), 4)
        self.assertEqual(validate_graph([node(), node()]), 1)
        for nodes in ([node(1)], [node(plane=-2)], [node(0)], [node(), node(2), node(1)]):
            with self.assertRaises(ValueError): validate_graph(nodes)
        # Shared children form an acyclic graph; they are not falsely cycles.
        self.assertEqual(validate_graph([node(1, 2), node(3), node(3), node()]), 4)

    def test_nonfinite_fields_invalid_references_and_broken_spans_rejected(self):
        _, _, original = source_fixture()
        mutations = [lambda m: setattr(m.nodes[0], 'plane', (0, 0, 1, float('nan'))),
                     lambda m: setattr(m.nodes[0], 'i_leaf', (-1, 2)),
                     lambda m: setattr(m.nodes[0], 'i_vert_pool', -1),
                     lambda m: setattr(m.surfs[0], 'v_normal', 99),
                     lambda m: setattr(m, 'root_outside', 2),
                     lambda m: m.source_spans.update(points=(0, 12))]
        for mutate in mutations:
            model = copy.deepcopy(original); mutate(model)
            with self.assertRaises(ValueError): validate_model(model)

    def test_live_or_existing_staging_destinations_rejected(self):
        for path in [Path(__file__).resolve().parents[2] / 'assets/world/00_00',
                     Path(__file__).resolve().parents[2] / 'tmp/restart-audit']:
            with self.assertRaises(ValueError): stage_path(path)


if __name__ == '__main__': unittest.main()
