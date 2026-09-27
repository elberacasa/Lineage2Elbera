"""Elbera Tools: portable synthetic notify boundary/clock regressions.

No client assets, capstone, browser, database, or services are required.
"""
import unittest

from check_anim_notify_native import (
    advance_channel, crossing, dispatch_batch, dispatch_kind, f32,
    selected_indices, split_delta,
)


def record(time, *, shot=False, bone=False, object_ref=1, function='None'):
    return {'t': time, 'isAttackShot': shot, 'isBoneScale': bone,
            'objectRef': object_ref, 'function': function}


class NotifyBoundaryTests(unittest.TestCase):
    def test_old_exclusive_new_inclusive(self):
        self.assertFalse(crossing(.25, .75, .25))
        self.assertTrue(crossing(.25, .75, .75))
        self.assertFalse(crossing(.25, .75, .7501))
        self.assertFalse(crossing(.25, .25, .25))

    def test_float32_source_rounding_precedes_comparison(self):
        self.assertFalse(crossing(.5, .75, .5 + 2 ** -26))
        self.assertTrue(crossing(.25, .5, .5 + 2 ** -26))

    def test_source_order_is_not_time_order(self):
        rows = [record(.75), record(.25), record(.5)]
        self.assertEqual(selected_indices(rows, 0., 1.), [0, 1, 2])
        batch = dispatch_batch(rows, 0., 1., 1.)
        self.assertEqual([e['frame'] for e in batch['events']], [.75, .25, .5])
        self.assertEqual(batch['frame'], .5)

    def test_first_crossed_attack_shot_survives_not_first_in_sequence(self):
        rows = [record(.1, shot=True), record(.6, shot=True)]
        self.assertEqual(selected_indices(rows, .25, .75), [1])

    def test_filter_removal_fails_closed_without_import_binding(self):
        for rows in ([record(.5, bone=True)], [record(.25, shot=True), record(.5, shot=True)]):
            with self.assertRaisesRegex(ValueError, 'aliased removal'):
                selected_indices(rows, 0., 1.)

    def test_conditional_small_array_alias_removal_consumes_tail(self):
        for middle in (record(.5, bone=True), record(.5, shot=True)):
            rows = [record(.25, shot=True), middle, record(.75)]
            self.assertEqual(selected_indices(rows, 0., 1., removal_policy='small-in-place-alias'), [0])
        rows = [record(.5, bone=True), record(.5)]
        self.assertEqual(selected_indices(rows, 0., 1., removal_policy='small-in-place-alias'), [])

    def test_conditional_alias_model_refuses_reallocation_domain(self):
        rows = [record(.5, bone=True)] + [record(.5) for _ in range(33)]
        with self.assertRaisesRegex(ValueError, 'capacity exceeded'):
            selected_indices(rows, 0., 1., removal_policy='small-in-place-alias')

    def test_missing_class_proof_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'class predicates'):
            selected_indices([{'t': .5, 'kind': 'AttackShot'}], 0., 1.)

    def test_nonfinite_boundary_outside_proof(self):
        for value in (float('nan'), float('inf')):
            with self.assertRaises(ValueError): crossing(0., 1., value)


class NotifyClockTests(unittest.TestCase):
    def test_multiple_crossings_use_mutated_current_but_original_old_frame(self):
        batch = dispatch_batch([record(.25), record(.5)], .125, .875, .75)
        self.assertEqual(batch['events'][0]['remaining'], .625)
        self.assertEqual(batch['events'][1]['remaining'], -1.25)
        self.assertEqual(batch['frame'], .5)

    def test_equal_times_dispatch_both_and_zero_remaining(self):
        batch = dispatch_batch([record(.5), record(.5)], .125, .875, .75)
        self.assertEqual(len(batch['events']), 2)
        self.assertEqual(batch['remaining'], 0.)

    def test_null_object_splits_clock_without_callback(self):
        state = advance_channel(.125, 1., .875, .5, [record(.25, object_ref=0)])
        self.assertEqual(state['frame'], .25)
        self.assertEqual(state['events'][0]['dispatch'], 'null')
        self.assertEqual(state['discarded'], .375)
        self.assertEqual(state['advancements'], 1)

    def test_named_function_is_postload_script_even_if_source_object_nonnull(self):
        self.assertEqual(dispatch_kind(record(.5, object_ref=0, function='OnStep')), 'postload-script')
        self.assertEqual(dispatch_kind(record(.5, object_ref=5, function='OnStep')), 'postload-script')
        self.assertEqual(dispatch_kind(record(.5, object_ref=0)), 'null')

    def test_below_endpoint_exits_after_batch_without_replaying_remainder(self):
        state = advance_channel(.125, 1., .875, .75, [record(.25), record(.5)])
        self.assertEqual(state['frame'], .5)
        self.assertEqual(state['discarded'], -1.25)
        self.assertEqual(state['advancements'], 1)

    def test_four_advancements_do_not_limit_four_callbacks(self):
        rows = [record(.5) for _ in range(9)]
        state = advance_channel(.125, 1., .875, .75, rows)
        self.assertEqual(len(state['events']), 9)
        self.assertEqual(state['advancements'], 1)

    def test_one_shot_dispatches_before_clamping_including_above_one(self):
        state = advance_channel(.5, 1., .75, 1., [record(1.25, object_ref=0)])
        self.assertEqual(state['events'][0]['frame'], 1.25)
        self.assertEqual(state['frame'], .75)
        self.assertEqual(state['rate'], 0.)

    def test_one_shot_endpoint_equal_fires_and_stops(self):
        state = advance_channel(.5, 1., .75, .25, [record(.75)])
        self.assertEqual(len(state['events']), 1)
        self.assertEqual(state['frame'], .75)
        self.assertEqual(state['rate'], 0.)

    def test_notify_at_one_zeroes_remainder_in_later_loop_endpoint_step(self):
        state = advance_channel(.75, 1., .875, .5, [record(0.), record(.125), record(1.)], loop=True)
        self.assertEqual([e['index'] for e in state['events']], [2])
        self.assertEqual(state['frame'], 0.)
        self.assertEqual(state['advancements'], 1)

    def test_loop_wrap_remainder_excludes_zero_on_next_cycle(self):
        state = advance_channel(.75, 1., .875, .5, [record(0.), record(.125)], loop=True)
        self.assertEqual([e['index'] for e in state['events']], [1])
        self.assertEqual(state['frame'], .125)
        self.assertEqual(state['advancements'], 2)

    def test_loop_cap_drops_remaining_after_four_advancements(self):
        state = advance_channel(0., 1., .875, 8.5, loop=True)
        self.assertEqual(state['advancements'], 4)
        self.assertEqual(state['frame'], 0.)
        self.assertEqual(state['discarded'], 4.5)

    def test_initial_tween_and_loop_share_counter(self):
        state = advance_channel(-.25, 1., .75, 8.5, loop=True, tween_rate=1.)
        self.assertEqual(state['advancements'], 4)
        self.assertEqual(state['discarded'], 5.25)

    def test_tween_zero_and_new_sequence_epsilon_do_not_emit_zero_notify(self):
        rows = [record(0.), record(.001)]
        tween = advance_channel(-.25, 1., .875, .5, rows, tween_rate=1.)
        self.assertEqual([e['index'] for e in tween['events']], [1])
        fresh = advance_channel(f32(.001), 1., .875, .1, rows)
        self.assertEqual(fresh['events'], [])

    def test_reentrant_zero_divisor_not_silently_repaired(self):
        with self.assertRaisesRegex(ValueError, 'zero-divisor'):
            split_delta(.5, .5, .75, .2)


if __name__ == '__main__':
    unittest.main()
