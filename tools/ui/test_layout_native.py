"""Elbera Tools: portable boundary tests for original saved-window recovery."""
import struct
import unittest

from check_layout_native import native_anchor_position, native_corner_intersects
from mine_windowsinfo import decode_default_positions


def table(*rows):
    out = struct.pack('<i', len(rows))
    for name, values in rows:
        encoded = name.encode('ascii') + b'\0'
        out += bytes([len(encoded)]) + encoded + struct.pack('<6i', *values)
    return out


class NativeSavedWindowTests(unittest.TestCase):
    def test_original_inventory_offscreen_reset_is_not_initial_creation_anchor(self):
        root, saved = (0, 0, 623, 760), (722, 127, 256, 401)
        self.assertFalse(native_corner_intersects(root, saved))
        self.assertEqual(native_anchor_position(root, saved, 6, -46, -50), (321, 130))
        self.assertEqual(native_anchor_position(root, saved, 6, 0, -70), (367, 110))

    def test_any_corner_is_enough_even_when_most_of_window_is_offscreen(self):
        self.assertTrue(native_corner_intersects((0, 0, 623, 760), (622, 759, 256, 401)))
        self.assertTrue(native_corner_intersects((0, 0, 623, 760), (-255, -400, 256, 401)))

    def test_all_four_screen_edges_are_inclusive(self):
        root = (0, 0, 100, 100)
        for window in ((100, 50, 10, 10), (-10, 50, 10, 10),
                       (50, 100, 10, 10), (50, -10, 10, 10)):
            self.assertTrue(native_corner_intersects(root, window))
        for window in ((101, 50, 10, 10), (-11, 50, 10, 10),
                       (50, 101, 10, 10), (50, -11, 10, 10)):
            self.assertFalse(native_corner_intersects(root, window))

    def test_intersection_is_directional_corner_test_not_general_overlap(self):
        root, surrounds = (0, 0, 100, 100), (-10, -10, 120, 120)
        self.assertFalse(native_corner_intersects(root, surrounds))
        self.assertTrue(native_corner_intersects(surrounds, root))
        self.assertFalse(native_corner_intersects(root, (-10, 25, 120, 50)))

    def test_native_integer_corners_truncate_sum_not_width_separately(self):
        self.assertTrue(native_corner_intersects((0, 0, 10, 10), (-2, 1, 1.5, 1)))

    def test_anchor_includes_current_negative_origin_before_truncation(self):
        self.assertEqual(native_anchor_position((0, 0, 623, 760), (0, -250, 256, 401),
                                                6, -46, -50), (321, 129))
        self.assertEqual(native_anchor_position((10, 20, 623, 761), (0, 0, 256, 401),
                                                6, -46, -50), (331, 150))

    def test_all_nine_anchors_and_invalid_enum(self):
        for anchor in range(1, 10):
            self.assertEqual(native_anchor_position((0, 0, 100, 200), (0, 0, 20, 40),
                                                    anchor, 0, 0),
                             (((anchor-1) % 3) * 40, ((anchor-1) // 3) * 80))
        with self.assertRaises(ValueError):
            native_anchor_position((0, 0, 100, 100), (0, 0, 10, 10), 0, 0, 0)

    def test_default_table_keeps_signed_offsets_and_unchanged_sizes(self):
        data = table(('InventoryWnd', (6, -46, -50, 0, -9999, -9999)))
        rows, count = decode_default_positions(data, 0, len(data))
        self.assertEqual(count, 1)
        self.assertEqual(rows['InventoryWnd'], {'anchor': 6, 'offsetX': -46, 'offsetY': -50,
                         'anchored': False, 'w': None, 'h': None, 'sourceOffsets': [4]})

    def test_identical_repeated_source_records_preserve_offsets(self):
        row = ('Same', (1, 0, 0, 0, 176, -9999))
        data = table(row, row)
        rows, count = decode_default_positions(data, 0, len(data))
        self.assertEqual(count, 2)
        self.assertEqual(rows['Same']['sourceOffsets'], [4, 34])
        conflict = table(row, ('Same', (2, 0, 0, 0, 176, -9999)))
        with self.assertRaisesRegex(ValueError, 'conflicting'):
            decode_default_positions(conflict, 0, len(conflict))

    def test_truncation_and_count_boundary_fail_closed(self):
        data = table(('Window', (1, 0, 0, 0, -9999, -9999)))
        for bad in (data[:-1], data+b'\0', struct.pack('<i', 2)+data[4:],
                    struct.pack('<i', -1)+data[4:]):
            with self.assertRaises(ValueError):
                decode_default_positions(bad, 0, len(bad))

    def test_invalid_source_enums_and_sizes_fail_closed(self):
        for values in ((0, 0, 0, 0, -9999, -9999), (1, 0, 0, 2, -9999, -9999),
                       (1, 0, 0, 0, -99, -9999)):
            data = table(('Window', values))
            with self.assertRaises(ValueError):
                decode_default_positions(data, 0, len(data))


if __name__ == '__main__':
    unittest.main()
