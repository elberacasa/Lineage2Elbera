"""Elbera Tools: authored finite pose-coordinate cases, no original assets."""
import copy
import math
from pathlib import Path
import struct
import subprocess
import sys
import unittest

from check_pose_coordinates_native import (
    NORMALIZE_THRESHOLD, apply_pivot, apply_pivot_without_scale, f32,
    normalized_row, packed, pivot_inverse, pose_hierarchy, quaternion_record,
    synthetic_cases, vector_by,
)

IDENTITY = [0,0,0,1,0,0,0,1,0,0,0,1]
C = [10,20,30,0,-1,0,1,0,0,0,0,2]
P = [3,-4,5,2,1,0,0,3,1,1,0,4]


class PoseCoordinates(unittest.TestCase):
    def test_portable_formulas_import_without_assets_or_site_packages(self):
        code = ('import sys;sys.path.insert(0,sys.argv[1]);'
                'from check_pose_coordinates_native import apply_pivot,synthetic_cases;'
                'assert len(synthetic_cases()["pairs"])==223;'
                'assert "capstone" not in sys.modules;'
                'assert "check_tutorial_quest_native" not in sys.modules')
        subprocess.run([sys.executable,'-S','-c',code,str(Path(__file__).resolve().parent)],
                       cwd='/',check=True,timeout=10)

    def test_quaternion_conversion_preserves_nonunit_values_and_source_axes(self):
        self.assertEqual(quaternion_record([.5,.5,.5,.5],[4,5,6]),
                         [4,5,6,0,0,1,1,0,0,0,1,0])
        self.assertEqual(quaternion_record([0,0,1,1],[0,0,0]),
                         [0,0,0,-1,-2,0,2,-1,0,0,0,1])

    def test_reference_composition_distinguishes_operand_order_and_transpose(self):
        self.assertEqual(apply_pivot(C,P), [43,86,135,-1,2,0,-3,0,2,0,1,8])
        self.assertNotEqual(apply_pivot(C,P), apply_pivot(P,C))
        self.assertEqual(C, [10,20,30,0,-1,0,1,0,0,0,0,2])
        self.assertEqual(P, [3,-4,5,2,1,0,0,3,1,1,0,4])

    def test_current_normalizes_operand_rows_only_and_retains_parent_scale_in_origin(self):
        parent = [5,6,7,2,0,0,0,3,0,0,0,4]
        result = apply_pivot_without_scale(C,parent)
        self.assertEqual(result, [25,66,127,0,1,0,-1,0,0,0,0,2])
        self.assertEqual(result[:3], apply_pivot(C,parent)[:3])
        self.assertEqual(apply_pivot_without_scale(C,IDENTITY),apply_pivot(C,IDENTITY))

    def test_normalization_does_not_make_parallel_rows_orthogonal_or_invent_zero_axes(self):
        parent = [5,6,7,2,1,0,4,2,0,0,0,0]
        result = apply_pivot_without_scale(IDENTITY,parent)
        self.assertEqual(result[3:6],result[6:9])
        self.assertEqual(result[9:], [0,0,0])

    def test_normalizer_compares_stored_square_to_the_original_double(self):
        row = [f32(.0001),f32(2e-8),0]
        square = f32(row[1]*row[1]+row[0]*row[0])
        self.assertEqual(square, f32(1e-8));self.assertLess(square,NORMALIZE_THRESHOLD)
        self.assertEqual(normalized_row(row), [0,0,0])
        bits = struct.unpack('<I',struct.pack('<f',f32(.0001)))[0]
        above = struct.unpack('<f',struct.pack('<I',bits+1))[0]
        self.assertEqual(normalized_row([above,0,0]),[1,0,0])

    def test_squared_sum_and_reciprocal_stores_change_real_finite_results(self):
        row = [f32(v) for v in [84.32379913330078,2.857985734939575,8.609198266640306e-5]]
        no_square_store = f32(1/math.sqrt((row[1]*row[1]+row[0]*row[0])+row[2]*row[2]))
        self.assertNotEqual(packed(normalized_row(row)),packed([f32(v*no_square_store) for v in row]))
        row = list(map(f32,[1.234567,8.765432,-4.345678]))
        no_reciprocal_store = 1/math.sqrt(f32((row[1]*row[1]+row[0]*row[0])+row[2]*row[2]))
        self.assertNotEqual(packed(normalized_row(row)),packed([f32(v*no_reciprocal_store) for v in row]))

    def test_vector_dot_has_only_final_store_but_origin_stores_before_addition(self):
        basis = [0,0,0,16777216,1,-16777216,0,1,0,0,0,1]
        self.assertEqual(vector_by(basis,[1,1,1])[0],1)
        local,parent = [16777216,1,0,*IDENTITY[3:]],[-16777216,0,0,1,1,0,0,1,0,0,0,1]
        self.assertEqual(apply_pivot(local,parent)[0],0)

    def test_inverse_uses_correct_cofactor_orientation_and_fails_on_stored_singularity(self):
        self.assertEqual(pivot_inverse(C),[-20,10,-15,0,1,0,-1,0,0,0,0,.5])
        for coords in ([0]*12,[0,0,0,1,0,0,0,1,0,0,0,1e-46]):
            with self.assertRaisesRegex(ValueError,'singular'):pivot_inverse(coords)

    def test_hierarchy_keeps_source_order_root_copy_and_explicit_composition_mode(self):
        poses = [{'quaternion':[.5,.5,.5,.5],'position':[10,20,30]},
                 {'quaternion':[0,0,0,1],'position':[1,2,3]},
                 {'quaternion':[0,0,0,1],'position':[4,5,6]}]
        original = copy.deepcopy(poses)
        for mode in ('reference','current'):
            result = pose_hierarchy(poses,[0,0,1],mode=mode)
            self.assertEqual([r[:3] for r in result],[[10,20,30],[13,21,32],[19,25,37]])
            self.assertEqual(result[0],quaternion_record(**poses[0]))
            result[0][0] = 999
            self.assertEqual(poses,original)
        poses[0]['quaternion'] = [0,0,1,1]
        reference = pose_hierarchy(poses,[0,0,1],mode='reference')
        current = pose_hierarchy(poses,[0,0,1],mode='current')
        self.assertEqual(reference[0],current[0]);self.assertEqual(reference[1][:3],current[1][:3])
        self.assertNotEqual(reference[1][3:],current[1][3:])

    def test_hierarchy_and_arithmetic_fail_closed_without_partial_input_mutation(self):
        poses = [{'quaternion':[0,0,0,1],'position':[0,0,0]} for _ in range(3)]
        original = copy.deepcopy(poses)
        for parents in ([1,0,1],[0,1,1],[0,2,0],[0,-1,0],[0,True,1],[0,0]):
            with self.assertRaises(ValueError):pose_hierarchy(poses,parents,mode='current')
        with self.assertRaises(ValueError):pose_hierarchy(poses,[0,0,1],mode='guess')
        poses[-1]['quaternion'][-1] = math.nan
        with self.assertRaises(ValueError):pose_hierarchy(poses,[0,0,1],mode='current')
        self.assertEqual(poses[:2],original[:2])
        for value in (True,'1',math.inf,math.nan,1e100):
            with self.assertRaises(ValueError):apply_pivot([value]+IDENTITY[1:],IDENTITY)
        with self.assertRaises(ValueError):normalized_row([3e38,0,0])
        with self.assertRaises(ValueError):apply_pivot([1e30]*12,[1e30]*12)


if __name__ == '__main__':unittest.main()
