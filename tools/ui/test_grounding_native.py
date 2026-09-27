"""Portable checks of the bounded original trace inputs, not collision fixtures."""
import unittest

from check_grounding_native import collision_hit_z, correction_trace_z
from check_player_transform_native import f32


class GroundingInputsTests(unittest.TestCase):
    def test_correction_trace_has_extent_and_distinct_bottom(self):
        self.assertEqual(correction_trace_z(-4672, 23), (-4629., -4702.))
        self.assertEqual(correction_trace_z(0, 15), (35., -30.))

    def test_bias_requires_actual_hit_time_and_has_source_threshold(self):
        self.assertEqual(collision_hit_z(100, 0), f32(102.150000035762787))
        self.assertEqual(collision_hit_z(100, .1), f32(100+2.150000035762787-f32(f32(.1)*12)))
        self.assertEqual(collision_hit_z(100, 1), 100.)

    def test_nonfinite_or_unrepresentable_inputs_do_not_become_ground(self):
        for value in (float('nan'), float('inf'), 1e100, True):
            with self.assertRaises(ValueError):
                correction_trace_z(value, 23)
            with self.assertRaises(ValueError):
                collision_hit_z(100, value)


if __name__ == '__main__':
    unittest.main()
