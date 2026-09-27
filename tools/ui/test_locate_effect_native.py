"""Source-free boundary tests for Elbera Tools' LocateEffect arithmetic."""
import hashlib
from pathlib import Path
import struct
import sys
import unittest
from check_locate_effect_native import (added_location, raw_offset, relative_offset_input,
                                        read_alias_arrays, core_coordinate_transform, f32)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from l2lib.ue2package import Reader, encode_compact


class LocateEffectArithmeticTests(unittest.TestCase):
    def test_radius_and_height_are_distinct_and_y_is_unscaled(self):
        self.assertEqual(relative_offset_input([2,3,-1],9,23),[18,3,-23])

    def test_skeletal_z_uses_mesh_origin_and_scalar_draw_scale(self):
        self.assertEqual(relative_offset_input([2,3,-1],9,999,skeletal=True,
                         mesh_origin_z=40,draw_scale=.75),[18,3,-30])

    def test_zero_is_original_data_not_a_missing_value(self):
        self.assertEqual(relative_offset_input([2,3,-1],0,0),[0,3,0])
        self.assertEqual(relative_offset_input([2,3,-1],9,skeletal=True,
                         mesh_origin_z=0,draw_scale=1),[18,3,0])

    def test_raw_offset_does_not_acquire_actor_dimensions_or_rotation(self):
        self.assertEqual(raw_offset([55,-35,-20.5]),[55,-35,-20.5])

    def test_addition_has_no_invented_lift_or_axis_mapping(self):
        self.assertEqual(added_location([100,-70,600],[9,2,-23]),[109,-68,577])

    def test_missing_or_invalid_native_fields_cannot_fall_back_to_visual_height(self):
        for args,kwargs in [(([1,2,3],9),{}), (([1,2,3],None,23),{}),
                            (([1,2,3],9),{'skeletal':True,'draw_scale':1}),
                            (([1,2,3],9),{'skeletal':True,'mesh_origin_z':23}),
                            (([1,2,3],9,23),{'skeletal':1})]:
            with self.assertRaises(ValueError): relative_offset_input(*args,**kwargs)

    def test_overflow_and_nonfinite_inputs_are_not_supported_arithmetic(self):
        for offset in ([float('nan'),0,0],[1e100,0,0],[True,0,0]):
            with self.assertRaises(ValueError): raw_offset(offset)
        with self.assertRaises(ValueError): relative_offset_input([3e38,0,0],3e38,0)


class AliasDataTests(unittest.TestCase):
    names = ['None', 'OriginalAlias', 'OriginalBone', 'OtherAlias', 'OtherBone', 'originalalias']

    def encoded(self, aliases=(1,), bones=(2,), coords=None):
        if coords is None: coords = [[0, 0, 1.23456789, 1, 2, 3, 4, 5, 6, 7, 8, 9]]
        data = b''
        for values in (aliases, bones):
            data += encode_compact(len(values)) + b''.join(encode_compact(n) for n in values)
        return data + encode_compact(len(coords)) + b''.join(struct.pack('<12f', *row) for row in coords)

    def decode(self, data, bones=('OriginalBone', 'OtherBone')):
        return read_alias_arrays(Reader(data), self.names, bones)

    def test_exact_float32_coordinates_order_and_table_endpoint(self):
        data = self.encoded(); reader = Reader(data+b'NEXT')
        result = read_alias_arrays(reader, self.names, ['OtherBone', 'OriginalBone'])
        self.assertEqual(result['end'], len(data)); self.assertEqual(reader.bytes(4), b'NEXT')
        row = result['records'][0]
        self.assertEqual(row['alias'], 'OriginalAlias'); self.assertEqual(row['bone'], 'OriginalBone')
        self.assertEqual(row['skeletonIndex'], 1)
        self.assertEqual(row['origin'], [0,0,f32(1.23456789)])
        self.assertNotEqual(row['origin'][2], round(row['origin'][2], 4))
        self.assertEqual(row['axes'], [[1,2,3],[4,5,6],[7,8,9]])
        self.assertEqual(result['SHA256'], hashlib.sha256(data).hexdigest())

    def test_empty_source_table_does_not_invent_an_alias(self):
        self.assertEqual(self.decode(self.encoded((),(),[]))['records'], [])

    def test_mismatched_parallel_arrays_are_never_silently_zipped(self):
        for data in (self.encoded((1,3),(2,)), self.encoded((1,),(2,4)), self.encoded(coords=[])):
            with self.assertRaisesRegex(ValueError, 'differ'): self.decode(data)

    def test_duplicate_or_case_ambiguous_aliases_are_rejected(self):
        coords = [[0]*12]*2
        for aliases in ((1,1),(1,5)):
            with self.assertRaisesRegex(ValueError, 'ambiguous'):
                self.decode(self.encoded(aliases,(2,4),coords))

    def test_missing_bone_invalid_name_or_count_cannot_become_actor_center(self):
        for data in (self.encoded(bones=(3,)), self.encoded(aliases=(99,)), encode_compact(-1)):
            with self.assertRaises(ValueError): self.decode(data)
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            self.decode(self.encoded(), ('OriginalBone','OriginalBone'))

    def test_truncated_and_nonfinite_coordinates_are_rejected(self):
        with self.assertRaises(ValueError): self.decode(self.encoded()[:-1])
        with self.assertRaisesRegex(ValueError, 'nonfinite'):
            self.decode(self.encoded(coords=[[float('nan')]+[0]*11]))


class CoreCoordinateCandidateTests(unittest.TestCase):
    def test_compatible_abis_do_not_mean_equivalent_arithmetic(self):
        coords = [[10,-7,3],[0,1,0],[-1,0,0],[0,0,2]]
        expected = {'vector':[-5,-2,14], 'point':[2,8,8], 'transpose':[5,2,14], 'pivot':[5,-9,17]}
        for mode, result in expected.items():
            self.assertEqual(core_coordinate_transform(coords,[2,-5,7],mode), result)

    def test_invalid_or_unspecified_mode_cannot_select_a_guessed_import(self):
        coords = [[0,0,0],[1,0,0],[0,1,0],[0,0,1]]
        with self.assertRaises(ValueError): core_coordinate_transform(coords,[1,2,3],None)
        with self.assertRaises(ValueError): core_coordinate_transform(coords[:3],[1,2,3],'vector')
        with self.assertRaises(ValueError): core_coordinate_transform(coords,[1,2,float('inf')],'vector')


if __name__=='__main__':
    unittest.main()
