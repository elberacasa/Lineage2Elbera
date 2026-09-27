#!/usr/bin/env python3
"""Elbera Tools: source-free checks for fail-closed x86 ID switch evaluation."""
from types import SimpleNamespace
import unittest

from check_legacy_skill_effects_native import Dispatch, LinearX87, f32, velocity_before_bound, displacement_after_bound


def machine(instructions, memory=None, ranges=None):
    instructions = [SimpleNamespace(mnemonic=op, op_str=args, size=1) for op, args in instructions]
    def read(address, width):
        return (memory or {})[(address, width)]
    return Dispatch(instructions.__getitem__, read, ranges or [(0, len(instructions))])


class DispatchChecks(unittest.TestCase):
    def test_unsigned_underflow_takes_out_of_range_default(self):
        dispatch = machine([('sub', 'eax, 6'), ('cmp', 'eax, 0x30'),
                            ('ja', '5'), ('jmp', '4')])
        self.assertEqual(dispatch.run(0, 3, {4, 5})['target'], 5)

    def test_signed_negative_compares_below_positive_despite_unsigned_value(self):
        dispatch = machine([('cmp', 'eax, 1'), ('jl', '4'), ('jmp', '3')])
        self.assertEqual(dispatch.run(0, 0x80000000, {3, 4})['target'], 4)

    def test_subtraction_sets_zero_flags_for_following_branch(self):
        dispatch = machine([('sub', 'eax, 13'), ('je', '4'), ('jmp', '3')])
        self.assertEqual(dispatch.run(0, 13, {3, 4})['target'], 4)
        self.assertEqual(dispatch.run(0, 14, {3, 4})['target'], 3)

    def test_addition_overflow_sets_signed_comparison_flags(self):
        dispatch = machine([('add', 'eax, 1'), ('jg', '4'), ('jmp', '3')])
        # Intel JG tests ZF=0 and SF=OF, not merely a signed result >0.
        self.assertEqual(dispatch.run(0, 0x7fffffff, {3, 4})['target'], 4)

    def test_selector_byte_is_not_assumed_to_equal_skill_index(self):
        dispatch = machine([('sub', 'eax, 7'),
                            ('movzx', 'ecx, byte ptr [eax + 0x200]'),
                            ('jmp', 'dword ptr [ecx*4 + 0x300]')],
                           {(0x202, 1): 3, (0x30c, 4): 6})
        result = dispatch.run(0, 9, {6})
        self.assertEqual(result['target'], 6)
        self.assertEqual(result['trace'], [0, 1, 2])

    def test_rejects_call_instead_of_guessing_missing_import(self):
        with self.assertRaisesRegex(AssertionError, 'unsupported dispatch instruction'):
            machine([('call', '100')]).run(0, 1, {1})

    def test_branch_without_flags_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'no flags'):
            machine([('je', '1')]).run(0, 1, {1})

    def test_unknown_target_cannot_be_reported_as_success(self):
        with self.assertRaisesRegex(AssertionError, 'escaped allowed code'):
            machine([('jmp', '9')]).run(0, 1, {1})

    def test_infinite_loop_is_bounded(self):
        with self.assertRaisesRegex(AssertionError, 'did not terminate'):
            machine([('jmp', '0')]).run(0, 1, {1}, max_steps=5)


class MotionArithmeticChecks(unittest.TestCase):
    def test_zero_friction_keeps_velocity_and_adds_acceleration_componentwise(self):
        velocity = velocity_before_bound([1000, 0, -500], [0, 3000, 0], .1, 0)
        self.assertEqual(velocity, [1000, 300, -500])
        self.assertEqual(displacement_after_bound(velocity, .1), [100, 30, -50])

    def test_zero_delta_does_not_create_a_default_initial_velocity(self):
        self.assertEqual(velocity_before_bound([0, 0, 0], [3000, 0, 0], 0, 0), [0, 0, 0])
        self.assertEqual(displacement_after_bound([3000, 0, 0], 0), [0, 0, 0])

    def test_large_friction_step_is_not_silently_clamped(self):
        self.assertEqual(velocity_before_bound([10, 0, 0], [2, 0, 0], 2, 10), [-26, 0, 0])

    def test_intermediate_float32_stores_change_result(self):
        v, a, dt, friction = -527.90380859375, -793.6679077148438, .4020976722240448, .31839480996131897
        actual = velocity_before_bound([v, 0, 0], [a, 0, 0], dt, friction)[0]
        self.assertEqual(actual, -833.518798828125)
        self.assertNotEqual(actual, f32(v * (1 - friction * f32(.2) * dt) + a * dt))

    def test_evaluator_preserves_extended_stack_until_explicit_store(self):
        instructions = [('fld', 'dword ptr [ebp]'), ('fld1', ''), ('faddp', 'st(1)'),
                        ('fst', 'dword ptr [ebp + 4]'), ('fld', 'dword ptr [ebp + 4]'),
                        ('fsubrp', 'st(1)'), ('fstp', 'dword ptr [ebp + 8]')]
        evaluator = LinearX87({100: float(2 ** 24)}, {'ebp': 100})
        evaluator.run(SimpleNamespace(mnemonic=op, op_str=args) for op, args in instructions)
        self.assertEqual(evaluator.memory[104], float(2 ** 24))
        self.assertEqual(evaluator.memory[108], -1.)
        self.assertEqual(evaluator.stack, [])

    def test_erased_call_nops_and_calls_cannot_be_evaluated_as_noops(self):
        for operation in ('nop', 'call'):
            with self.assertRaisesRegex(AssertionError, 'unsupported arithmetic instruction'):
                LinearX87({}, {}).run([SimpleNamespace(mnemonic=operation, op_str='')])

    def test_undeclared_helper_result_is_not_zero_filled(self):
        with self.assertRaises(KeyError):
            LinearX87({}, {'ebp': 100}).run([SimpleNamespace(mnemonic='fld', op_str='dword ptr [ebp]')])

    def test_nonfinite_and_negative_delta_rejected(self):
        for delta in (-1, float('nan'), float('inf')):
            with self.assertRaises(AssertionError):
                velocity_before_bound([0, 0, 0], [0, 0, 0], delta, 0)


if __name__ == '__main__':
    unittest.main()
