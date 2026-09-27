"""Authored Elbera Tools cache-state tests; no originals or site packages."""
import copy
from pathlib import Path
import subprocess
import sys
import unittest

from check_pose_cache_native import (
    cache_decision, empty_pose_cache_bookkeeping, fresh_channel_bookkeeping,
)


def decision(**changes):
    value = dict(tick=17, cached_tick=17, frame=-.125, cached_frame=-.125,
                 editor=False, q_cache_empty=False, coordinates_changed=False,
                 source_cache_empty=False, mode=0)
    value.update(changes)
    return cache_decision(**value)


class PoseCache(unittest.TestCase):
    def test_import_and_portable_api_without_site_packages(self):
        code = ('import sys;sys.path.insert(0,sys.argv[1]);'
                'from check_pose_cache_native import fresh_channel_bookkeeping;'
                'assert fresh_channel_bookkeeping()["previousFrame"]==0;'
                'assert "capstone" not in sys.modules;'
                'assert "check_tutorial_quest_native" not in sys.modules')
        subprocess.run([sys.executable, '-S', '-c', code,
                        str(Path(__file__).resolve().parent)], cwd='/',
                       timeout=10, check=True)

    def test_fresh_channel_has_three_zero_fields_not_instance_validity(self):
        first = fresh_channel_bookkeeping()
        self.assertEqual(first, dict(previousSequenceId=0, previousFrame=0., accumulated=0.))
        first['previousFrame'] = -1
        self.assertEqual(fresh_channel_bookkeeping()['previousFrame'], 0.)
        self.assertNotIn('cacheValid', first)

    def test_empty_array_resets_only_previous_frame(self):
        state = dict(previousSequenceId=71, previousFrame=-.25, accumulated=.625)
        before = copy.deepcopy(state)
        self.assertEqual(empty_pose_cache_bookkeeping(state),
                         dict(previousSequenceId=71, previousFrame=0., accumulated=.625))
        self.assertEqual(state, before)

    def test_repeat_suppresses_second_tween_but_different_frame_does_not(self):
        self.assertFalse(decision()['evaluate'])
        first = decision(frame=-.0625)
        self.assertTrue(first['evaluate'])
        second = decision(frame=-.0625, cached_frame=first['marker']['frame'],
                          cached_tick=first['marker']['tick'])
        self.assertFalse(second['evaluate'])
        # Native does not simply allow one evaluation per GTicks.
        self.assertTrue(decision(frame=-.03125, cached_frame=-.0625)['evaluate'])

    def test_counter_uses_both_halves_and_float_comparison_uses_stored_values(self):
        self.assertTrue(decision(tick=17 + (1 << 32))['evaluate'])
        self.assertTrue(decision(cached_tick=16)['evaluate'])
        self.assertFalse(decision(frame=.250000001, cached_frame=.25)['evaluate'])
        self.assertFalse(decision(frame=-0., cached_frame=0.)['evaluate'])

    def test_each_layout_reset_and_editor_override_matching_key(self):
        for name in ('editor', 'q_cache_empty', 'coordinates_changed', 'source_cache_empty'):
            with self.subTest(name=name):
                result = decision(**{name: True})
                self.assertTrue(result['evaluate'])
                self.assertTrue(result['repeated'])
                self.assertEqual(result['invalidated'], name != 'editor')

    def test_mode_three_preserves_marker_without_forcing_evaluation(self):
        self.assertFalse(decision(mode=3)['evaluate'])
        result = decision(mode=3, tick=18, frame=.5)
        self.assertTrue(result['evaluate'])
        self.assertEqual(result['marker'], dict(tick=17, frame=-.125))
        self.assertEqual(decision(mode=2, tick=18, frame=.5)['marker'],
                         dict(tick=18, frame=.5))

    def test_rejects_unknown_and_nonfinite_state_without_defaults(self):
        for changes in (dict(tick=True), dict(tick=-1), dict(tick=1 << 64),
                        dict(cached_tick=None), dict(frame=float('nan')),
                        dict(frame=float('inf')), dict(frame=1e100),
                        dict(editor=0), dict(q_cache_empty=None), dict(mode=True)):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decision(**changes)
        for state in (None, {}, dict(previousSequenceId=-1, previousFrame=0., accumulated=0.)):
            with self.assertRaises(ValueError):
                empty_pose_cache_bookkeeping(state)


if __name__ == '__main__':
    unittest.main()
