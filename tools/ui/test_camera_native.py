"""Elbera Tools portable camera equation boundaries; no original files needed."""
import unittest

from check_camera_native import behind_view_distances, trace_base_flags


class CameraEquations(unittest.TestCase):
    def test_default_reach_extends_sixty_beyond_final_boom(self):
        self.assertEqual(behind_view_distances(230), {'traceReach': 260, 'signedBoom': 200})

    def test_configured_near_and_far_examples(self):
        self.assertEqual(behind_view_distances(50), {'traceReach': 80, 'signedBoom': 20})
        self.assertEqual(behind_view_distances(500), {'traceReach': 530, 'signedBoom': 470})

    def test_hit_preserves_thirty_unit_margin(self):
        self.assertEqual(behind_view_distances(230, 100)['signedBoom'], 70)

    def test_extension_hit_does_not_lengthen_camera(self):
        self.assertEqual(behind_view_distances(230, 250)['signedBoom'], 200)

    def test_near_hit_is_signed_not_clamped(self):
        self.assertEqual(behind_view_distances(230, 15)['signedBoom'], -15)
        self.assertEqual(behind_view_distances(230, 0)['signedBoom'], -30)

    def test_unknown_hit_is_not_zero_hit(self):
        self.assertNotEqual(behind_view_distances(230, None), behind_view_distances(230, 0))

    def test_false_trace_still_has_static_actor_and_world_categories(self):
        self.assertEqual(trace_base_flags(False), 0x86)
        self.assertEqual(trace_base_flags(True), 0xbf)
        self.assertTrue(trace_base_flags(False) & 0x80)
        self.assertTrue(trace_base_flags(False) & 4)
        self.assertFalse(trace_base_flags(False) & 0x10)

    def test_reference_requires_finite_explicit_inputs(self):
        for value in (float('inf'), float('nan')):
            with self.assertRaises(ValueError): behind_view_distances(value)
            with self.assertRaises(ValueError): behind_view_distances(230, value)
        with self.assertRaises(ValueError): trace_base_flags(None)


if __name__ == '__main__':
    unittest.main()
