"""Portable Elbera Tools BSP serialization/validation; synthetic data only."""
import copy
from pathlib import Path
import struct
from types import SimpleNamespace
import unittest

from export_bsp_collision import export_model, validate_graph, validate_model, stage_path
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
    export = SimpleNamespace(index=0, serial_offset=origin, serial_size=len(raw), package_index=0)
    pkg = SimpleNamespace(data=b'P'*origin + raw + b'NEXT EXPORT BYTES', path=Path('synthetic.unr'),
                          file_version=123, licensee_version=25,
                          name=lambda n: 'None' if n == 0 else 'unexpected',
                          export_name=lambda e: 'Model0', resolve_ref=lambda n: export)
    return pkg, export, _read_model(pkg, export, not short)


class BspCollisionTests(unittest.TestCase):
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
