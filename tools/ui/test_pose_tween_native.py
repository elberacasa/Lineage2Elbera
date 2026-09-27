"""Elbera Tools portable tween cases; no client, Capstone or service access."""
import copy
from pathlib import Path
import subprocess
import sys
import unittest

from check_pose_tween_native import (
    f32, hemisphere, normalize, synthetic_cases, tween_local_pose,
    tween_position, tween_quaternion, tween_state,
)
from check_quaternion_native import interpolate_quaternion


class PoseTween(unittest.TestCase):
    def test_import_has_no_original_or_site_package_dependency(self):
        code = ('import sys;sys.path.insert(0,sys.argv[1]);'
                'from check_pose_tween_native import synthetic_cases,tween_local_pose;'
                'assert len(synthetic_cases())==123;'
                'assert tween_local_pose(synthetic_cases()[0])["status"]=="ready";'
                'assert "capstone" not in sys.modules;'
                'assert "check_tutorial_quest_native" not in sys.modules')
        subprocess.run([sys.executable,'-S','-c',code,str(Path(__file__).resolve().parent)],
                       cwd='/',check=True,timeout=10)

    def test_tween_does_not_use_ordinary_linear_branch(self):
        a,b,t = [0,0,0,1],[0,0,.6,.8],f32(.3)
        raw,branch = tween_quaternion(a,b,t)
        self.assertEqual(branch,'trigonometric')
        self.assertGreater(abs(normalize(raw)[0][2]-interpolate_quaternion(a,b,t)[2]),.001)

    def test_hemisphere_changes_target_only_and_tie_is_unchanged(self):
        cached,target = [0,0,0,1],[0,0,0,-1]
        adjusted,flipped = hemisphere(target,cached)
        self.assertTrue(flipped);self.assertEqual(adjusted,[0,0,0,1])
        self.assertEqual(target,[0,0,0,-1]);self.assertEqual(cached,[0,0,0,1])
        self.assertFalse(hemisphere([1,0,0,0],cached)[1])

    def test_copy_threshold_is_inclusive_and_caller_still_normalizes(self):
        raw,branch = tween_quaternion([0,0,0,2],[0,0,0,1],0)
        self.assertEqual(raw,[0,0,0,2]);self.assertEqual(branch,'copy')
        self.assertEqual(normalize(raw)[0],[0,0,0,1])
        self.assertEqual(tween_quaternion([0,0,0,1],[0,0,0,1],.5)[1],'copy')

    def test_tiny_normalize_result_is_original_nonidentity_tuple(self):
        self.assertEqual(normalize([0,0,0,0]),([0.,0.,f32(.1),0.],True))

    def test_name_change_resets_fraction_and_bookkeeping_without_sampling_progress(self):
        fraction,state = tween_state(-.07,-.1,10,1,2,.2)
        self.assertEqual(fraction,0)
        self.assertEqual(state,dict(previousFrame=f32(-.1),previousSequenceId=2,accumulated=0))

    def test_inclusive_fraction_boundaries_and_outside_reset(self):
        for current,fraction in [(-.1,0),(0,1)]:
            actual,state = tween_state(current,-.1,10,1,1,.25)
            self.assertEqual(actual,fraction);self.assertEqual(state['previousFrame'],f32(current))
        fraction,state = tween_state(-.2,-.1,10,1,1,.25)
        self.assertEqual(fraction,0);self.assertEqual(state['accumulated'],0)

    def test_normal_win32_masking_admits_signed_zero_reset_explicitly(self):
        for previous in [0.,-0.]:
            for old in [1,2]:
                fraction,state=tween_state(-.05,previous,10,old,1,.2,masked=True)
                self.assertEqual(fraction,0)
                self.assertEqual(state,dict(previousFrame=f32(-.1),previousSequenceId=1,accumulated=0))
        self.assertEqual(tween_state(-3e38,-1e-38,10,1,1,.2,masked=True)[0],0)

    def test_fraction_ratio_is_not_stored_before_subtraction(self):
        current,previous = f32(-.032034233),f32(-.09333421)
        fraction,_ = tween_state(current,previous,30,1,1,0)
        self.assertEqual(fraction,f32(1-current/previous))
        # Separate store positions are checked with a reproducible finite case.
        for current in [f32(-i/137) for i in range(1,13)]:
            expected=f32(1-current/previous)
            if expected != f32(1-f32(current/previous)):
                self.assertEqual(tween_state(current,previous,30,1,1,0)[0],expected)
                break
        else:self.fail('fixture did not distinguish the source store boundary')

    def test_translation_is_incremental_and_rounds_three_stores(self):
        cached=[-932.1904296875,712.3893432617188,-83.52323150634766]
        first=[522.434814453125,-999.8922119140625,711.9132690429688]
        fraction=f32(.37)
        result=tween_position(cached,first,fraction)
        self.assertEqual(result,[f32(a+f32(f32(b-a)*fraction))for a,b in zip(cached,first)])
        self.assertNotEqual(result,[f32(a+(b-a)*fraction)for a,b in zip(cached,first)])

    def test_invalid_cache_requires_explicit_frame_zero_result_and_retains_state(self):
        value=synthetic_cases()[0]
        value.update(cacheValid=False,previousFrame=0,frameZeroPose=dict(quaternion=[0,0,0,.8],position=[4,5,6]))
        del value['cached'];del value['firstKey']
        result=tween_local_pose(value)
        self.assertEqual(result['mode'],'frame-zero');self.assertIsNone(result['fraction'])
        self.assertEqual(result['quaternion'],[0,0,0,f32(.8)])
        self.assertEqual(result['state'],dict(previousFrame=0,previousSequenceId=1,accumulated=f32(.2)))

    def test_portable_cases_keep_inputs_and_do_not_fabricate_missing_state(self):
        for value in synthetic_cases():
            before=copy.deepcopy(value);self.assertEqual(tween_local_pose(value)['status'],'ready')
            self.assertEqual(value,before)
        for changes in [dict(previousFrame=0),dict(previousFrame=-0.),dict(frame=0),dict(frame=-0.),
                        dict(frames=0),dict(accumulated=float('nan')),dict(cacheValid=None),dict(firstKey=None),
                        dict(sequenceId=None),dict(frame=-3e38,previousFrame=-1e-38)]:
            value=synthetic_cases()[0];value.update(changes)
            self.assertEqual(tween_local_pose(value)['status'],'unsupported')


if __name__=='__main__': unittest.main()
