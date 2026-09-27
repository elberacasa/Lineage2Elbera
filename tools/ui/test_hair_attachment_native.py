"""Elbera Tools: source-free hair dispatch, framing and arithmetic boundaries."""
import math
import struct
import unittest

from check_hair_attachment_native import (
    compare_call_block, f32, hair_render_path, master_record, quaternion_record,
    replace_matrix_origin, source_tail,
)


IDENTITY = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]


class HairDispatch(unittest.TestCase):
    def test_signed_mode_predicate_is_not_stream_type_or_nonzero(self):
        for mode in (-(1 << 31), -1, 0, 4):
            self.assertEqual(hair_render_path(mode), 'ordinary')
        for mode in (1, 2, 3, 5, 6, 7, (1 << 31) - 1):
            self.assertEqual(hair_render_path(mode), 'dynamic')
        for mode in (True, 2.0, '4', 1 << 31, -(1 << 31) - 1):
            with self.assertRaises(ValueError):
                hair_render_path(mode)


class MasterArithmetic(unittest.TestCase):
    def test_quaternion_helper_preserves_position_and_native_axis_orientation(self):
        self.assertEqual(quaternion_record([0, 0, 0, 1], [4, 5, 6]), [4, 5, 6] + IDENTITY[3:])
        self.assertEqual(quaternion_record([.5, .5, .5, .5], [4, 5, 6]),
                         [4, 5, 6, 0, 0, 1, 1, 0, 0, 0, 1, 0])

    def test_quaternion_helper_does_not_normalize_source_values(self):
        self.assertEqual(quaternion_record([0, 0, 1, 1], [0, 0, 0]),
                         [0, 0, 0, -1, -2, 0, 2, -1, 0, 0, 0, 1])
        with self.assertRaises(ValueError):
            quaternion_record([0, 0, 1], [0, 0, 0])

    def test_identity_and_translation_preserve_inputs(self):
        current = [10, 20, 30] + IDENTITY[3:]
        table = [3, -4, 5] + IDENTITY[3:]
        self.assertEqual(master_record(current, table), [13, 16, 35] + IDENTITY[3:])
        self.assertEqual(current[:3], [10, 20, 30])
        self.assertEqual(table[:3], [3, -4, 5])

    def test_nonsymmetric_axes_distinguish_order_and_transpose(self):
        current = [10, 20, 30, 0, -1, 0, 1, 0, 0, 0, 0, 2]
        table = [3, 4, 5, 2, 0, 0, 0, 3, 0, 0, 0, 4]
        self.assertEqual(master_record(current, table),
                         [6, 23, 40, 0, -3, 0, 2, 0, 0, 0, 0, 8])
        self.assertNotEqual(master_record(current, table), master_record(table, current))

    def test_origin_dot_rounds_before_adding_origin(self):
        current = [-16777216, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1]
        table = [16777216, 1, 0] + IDENTITY[3:]
        self.assertEqual(master_record(current, table)[0], 0)
        self.assertEqual(f32(-16777216 + 16777216 + 1), 1)

    def test_axes_store_each_product_and_sum_unlike_origin_dot(self):
        current = [0, 0, 0, 16777216, 1, -16777216, 0, 1, 0, 0, 0, 1]
        table = [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1]
        self.assertEqual(master_record(current, table)[3], 0)
        self.assertEqual(f32(16777216 + 1 - 16777216), 1)

    def test_post_conversion_overwrites_only_origin_and_w(self):
        unknown_conversion_result = list(range(16))
        bone = [21, -22, 23] + IDENTITY[3:]
        self.assertEqual(replace_matrix_origin(unknown_conversion_result, bone),
                         list(range(12)) + [21, -22, 23, 1])
        self.assertEqual(unknown_conversion_result, list(range(16)))

    def test_invalid_or_overflow_inputs_do_not_become_geometry(self):
        for bad in (math.inf, math.nan, True, '1', 1e50):
            with self.assertRaises(ValueError):
                master_record([bad] + IDENTITY[1:], IDENTITY)
        with self.assertRaises(ValueError):
            master_record(IDENTITY[:-1], IDENTITY)
        with self.assertRaises(ValueError):
            master_record([1e30] * 12, [1e30] * 12)
        with self.assertRaises(ValueError):
            replace_matrix_origin([0] * 15, IDENTITY)


class TailFraming(unittest.TestCase):
    def fixture(self, mode=4, offset=37, lods=1):
        data = bytearray(b'X' * offset)
        saved_positions = []

        def array(size, count=0):
            self.assertLess(count, 64)
            data.extend(bytes([count]) + bytes(range(size)) * count)

        def lazy(size):
            at = len(data)
            data.extend(struct.pack('<i', at + 4 + 1 + size))
            array(size, 1)
            saved_positions.append(at)

        for _ in range(lods - 1):
            array(4); array(16); data.extend(bytes(4))
            array(0); array(0)  # two empty section arrays
            for _ in range(2):
                array(2); data.extend(bytes(4))
            data.extend(bytes(12)); array(32)
            for size in (8, 10, 8, 12):
                lazy(size)
            data.extend(bytes(24 + 4)); array(52)
        data.append(0)  # f224 object reference
        for size in (12, 10, 12, 8, 2, 2):
            lazy(size)
        mode_offset = len(data)
        data.extend(struct.pack('<i', mode))
        array(4, 2)
        data.extend(struct.pack('<i', 123))
        return data, saved_positions, mode_offset

    def read(self, data, offset=37, lods=1, **overrides):
        args = dict(export_start=0, start=offset, export_end=len(data), lod_count=lods,
                    file_version=123, licensee_version=30)
        args.update(overrides)
        return source_tail(data, **args)

    def test_original_absolute_saved_ends_and_exact_field_location(self):
        data, _, mode_at = self.fixture(7)
        result = self.read(data)
        self.assertEqual((result['modeWord'], result['modeWordOffset'], result['renderPath']),
                         (7, mode_at, 'dynamic'))
        self.assertEqual([row['elementSize'] for row in result['lazyArrays']], [12, 10, 12, 8, 2, 2])
        self.assertEqual((result['extraFloatCount'], result['finalWord'], result['end']), (2, 123, len(data)))

    def test_following_lods_are_parsed_instead_of_blindly_skipped(self):
        data, _, mode_at = self.fixture(0, lods=3)
        result = self.read(data, lods=3)
        self.assertEqual(len(result['lazyArrays']), 14)
        self.assertEqual(result['modeWordOffset'], mode_at)
        self.assertEqual(result['renderPath'], 'ordinary')

    def test_wrong_absolute_boundary_rejected_even_when_in_export(self):
        data, positions, _ = self.fixture()
        for at in positions:
            broken = bytearray(data)
            saved, = struct.unpack_from('<i', broken, at)
            struct.pack_into('<i', broken, at, saved - 1)
            with self.assertRaisesRegex(ValueError, 'saved end'):
                self.read(broken)

    def test_truncation_trailing_data_and_unknown_versions_rejected(self):
        data, _, _ = self.fixture()
        for n in (1, 4, 12, 30):
            with self.assertRaises(ValueError):
                self.read(data[:-n])
        with self.assertRaisesRegex(ValueError, 'unconsumed'):
            self.read(data + b'X')
        for override in ({'licensee_version': 35}, {'file_version': 122},
                         {'lod_count': 10}, {'start': -1}, {'export_end': len(data) + 1}):
            with self.assertRaises(ValueError):
                self.read(data, **override)

    def test_negative_or_oversized_counts_are_rejected(self):
        data, positions, _ = self.fixture()
        # First saved-array count normally is one byte. 0x81 is signed -1.
        data[positions[0] + 4] = 0x81
        with self.assertRaisesRegex(ValueError, 'array count'):
            self.read(data)
        data, positions, _ = self.fixture()
        data[positions[0] + 4:positions[0] + 5] = b'\x7f\xff\xff\x7f'
        with self.assertRaisesRegex(ValueError, 'array count'):
            self.read(data)


class ComparisonBlocks(unittest.TestCase):
    def fixture(self):
        source, candidate, target, iat = 0x1000, 0x2000, 0x3000, 0x4000
        a = b'\x55' + b'\x90' * 6 + b'\xe8' + struct.pack('<i', target - (source + 12)) + b'\x5d'
        b = b'\x55\xff\x15' + struct.pack('<I', iat) + b'\xe8' + struct.pack('<i', target - (candidate + 12)) + b'\x5d'
        args = {'owned_va': source, 'candidate_va': candidate, 'sites': [(1, ('core.dll', '?Example'))],
                'direct_calls': [7], 'imports': {iat: ('Core.DLL', '?Example')}}
        return a, b, args

    def test_named_import_and_same_target_relocation_are_the_only_allowed_changes(self):
        a, b, args = self.fixture()
        result = compare_call_block(a, b, **args)
        self.assertEqual((result['bytes'], result['sameDirectCallTargets']), (13, 1))
        self.assertEqual(result['imports'][0]['symbol'], '?Example')

    def test_surrounding_change_wrong_import_or_call_target_rejected(self):
        a, b, args = self.fixture()
        for offset in (0, 8, 12):
            altered = bytearray(b)
            altered[offset] ^= 1
            with self.assertRaises(ValueError):
                compare_call_block(a, altered, **args)
        with self.assertRaisesRegex(ValueError, 'import'):
            compare_call_block(a, b, **{**args, 'imports': {0x4000: ('core.dll', '?Wrong')}})

    def test_overlap_or_non_nop_source_cannot_hide_extra_code(self):
        a, b, args = self.fixture()
        for changes in ({'direct_calls': [1]}, {'sites': [(1, ('core.dll', '?Example'))] * 2}):
            with self.assertRaisesRegex(ValueError, 'overlapping'):
                compare_call_block(a, b, **{**args, **changes})
        with self.assertRaisesRegex(ValueError, 'six-NOP'):
            compare_call_block(a[:1] + b'\xcc' + a[2:], b, **args)


if __name__ == '__main__':
    unittest.main()
