"""Elbera Tools portable ordinary-quaternion fixtures; authored inputs only."""
import math
from pathlib import Path
import struct
import subprocess
import sys
import unittest

from check_quaternion_native import (COPY_ABOVE, LINEAR_ABOVE, FALLBACK_COMPONENT,
                                     f32, interpolate_quaternion, interpolation_details,
                                     synthetic_cases)


class OrdinaryQuaternionTests(unittest.TestCase):
    def test_portable_import_uses_no_site_packages_or_private_inputs(self):
        code = ('import sys; sys.path.insert(0, sys.argv[1]); '
                'from check_quaternion_native import interpolate_quaternion, synthetic_cases; '
                'assert interpolate_quaternion([0,0,0,1],[0,0,0,1],.5)==[0.,0.,0.,1.]; '
                'assert len(synthetic_cases())==210; assert "capstone" not in sys.modules')
        subprocess.run([sys.executable, '-S', '-c', code, str(Path(__file__).resolve().parent)],
                       cwd='/', check=True, timeout=10)

    def test_fast_copy_is_not_normalized_or_aliased(self):
        first = [0, 0, 0, 2]
        result = interpolate_quaternion(first, [0, 0, 0, 1], -4)
        self.assertEqual(result, first)
        self.assertIsNot(result, first)
        result[3] = 99
        self.assertEqual(first[3], 2)

    def test_both_thresholds_use_strict_greater_than(self):
        first = [0, 0, 0, 1]
        for dot, branch in [(COPY_ABOVE, 'linear'), (f32(COPY_ABOVE+2**-24), 'copy'),
                            (LINEAR_ABOVE, 'trigonometric'),
                            (f32(LINEAR_ABOVE+2**-24), 'linear')]:
            second = [f32(math.sqrt(1-dot*dot)), 0, 0, dot]
            with self.subTest(dot=dot):
                self.assertEqual(interpolation_details(first, second, .37)['branch'], branch)

    def test_linear_region_differs_from_generic_slerp(self):
        result = interpolate_quaternion([0, 0, 0, 1], [.6, 0, 0, .8], .25)
        self.assertAlmostEqual(result[0], .1559625864, places=8)
        self.assertAlmostEqual(result[3], .9877630472, places=8)
        generic_slerp_x = math.sin(math.acos(.8)*.25)
        self.assertGreater(abs(result[0]-generic_slerp_x), .004)

    def test_trigonometric_branch_preserves_separate_normalization_stores(self):
        result = interpolate_quaternion([0, 0, 0, 1], [0, 0, 1, 0], .5)
        # Authored quarter-turn example. A single host normalization would
        # round sqrt(.5) to the adjacent Float32 instead of this stored chain.
        bits = [struct.unpack('<I', struct.pack('<f', v))[0] for v in result]
        self.assertEqual(bits, [0, 0, 0x3f3504f4, 0x3f3504f4])
        self.assertNotEqual(result[2], f32(math.sqrt(.5)))

    def test_tiny_result_keeps_source_component_fallback(self):
        result = interpolate_quaternion([0, 0, 0, 0], [0, 0, 0, 0], .5)
        self.assertEqual(result, [0., 0., FALLBACK_COMPONENT, 0.])
        self.assertNotEqual(result, [0., 0., 0., 1.])

    def test_no_silent_hemisphere_flip(self):
        details = interpolation_details([0, 0, 0, 1], [0, 0, 0, -1], .5)
        self.assertEqual(details['branch'], 'trigonometric-tiny-fallback')
        self.assertEqual(details['value'], [0., 0., FALLBACK_COMPONENT, 0.])

    def test_alpha_is_not_clamped(self):
        result = interpolate_quaternion([0, 0, 0, 1], [.6, 0, 0, .8], 1.5)
        self.assertGreater(result[0], .78)
        self.assertLess(result[3], .62)

    def test_invalid_inputs_and_math_domain_fail_explicitly(self):
        for value in ([0, 0, 1], [0, 0, 0, True], [0, 0, 0, math.nan],
                      [0, 0, 0, math.inf], [0, 0, 0, 1e100], '0001'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                interpolate_quaternion(value, [0, 0, 0, 1], .5)
        for alpha in (True, math.nan, math.inf, '0.5'):
            with self.subTest(alpha=alpha), self.assertRaises(ValueError):
                interpolate_quaternion([0, 0, 0, 1], [0, 0, 0, 1], alpha)
        with self.assertRaises(ValueError):
            interpolate_quaternion([0, 0, 0, 2], [0, 0, 0, -1], .5)

    def test_authored_corpus_exercises_all_admitted_branches(self):
        cases = synthetic_cases()
        self.assertEqual(len(cases), 210)
        self.assertEqual(cases, synthetic_cases())
        counts = {}
        for case in cases:
            details = interpolation_details(**case)
            counts[details['branch']] = counts.get(details['branch'], 0)+1
            self.assertTrue(all(math.isfinite(v) for v in details['value']))
        self.assertEqual(counts, {'copy': 2, 'linear': 34, 'trigonometric': 172,
                                  'trigonometric-tiny-fallback': 2})


if __name__ == '__main__':
    unittest.main()
