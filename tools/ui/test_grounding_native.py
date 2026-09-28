"""Portable checks of the bounded original trace inputs, not collision fixtures."""
import unittest

from check_grounding_native import audit_stack_arguments, collision_hit_z, correction_trace_z
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


class HandlerStackAuditTests(unittest.TestCase):
    """Authored instruction records, not original instructions or byte dumps.

    Addresses/one-byte record sizes are synthetic. Native decoding is tested
    separately with owned inputs; this exercises stack/dataflow refusal.
    """
    base = 0x1000

    def program(self):
        return [
            ('push', 'ebx'), ('sub', 'esp, 8'), ('test', 'ecx, ecx'),
            ('je', '0x1005'), ('mov', 'eax, dword ptr [esp + 0x10]'),
            ('mov', 'dword ptr [esp], eax'), ('call', '0x2000'),
            ('pop', 'ebx'), ('ret', '0xc'),
        ]

    def audit(self, program, *, cleanup=8, end=None, calls=None):
        code = [(self.base + i, 1, op, args) for i, (op, args) in enumerate(program)]
        return audit_stack_arguments(code, start=self.base,
                                     end=self.base + len(code) if end is None else end,
                                     argument_bytes=12,
                                     calls={0x1006: ('0x2000', cleanup)} if calls is None else calls)

    def test_reads_on_either_conditional_arm_are_not_lost(self):
        result = self.audit(self.program())
        self.assertEqual(result['argumentBytesRead'], [4, 5, 6, 7])
        self.assertEqual(result['argumentDwordsRead'], [4])
        self.assertEqual(result['reachableInstructions'], 9)

    def test_mutated_direct_argument_read_cannot_certify_unused_heading(self):
        program = self.program()
        program[4] = ('mov', 'eax, dword ptr [esp + 0x18]')
        self.assertEqual(self.audit(program)['argumentDwordsRead'], [12])

    def test_register_alias_and_saved_alias_preserve_stack_argument_identity(self):
        program = [('push', 'ebx'), ('mov', 'ebx, esp'), ('push', 'ebx'),
                   ('pop', 'eax'), ('mov', 'edx, dword ptr [eax + 0x10]'),
                   ('pop', 'ebx'), ('ret', '0xc')]
        self.assertEqual(self.audit(program, calls={})['argumentDwordsRead'], [12])

    def test_stack_alias_escape_to_callee_receiver_or_memory_is_refused(self):
        for replacement in [('mov', 'ecx, esp'), ('mov', 'eax, esp')]:
            program = self.program(); program[4] = replacement
            with self.subTest(replacement=replacement), self.assertRaisesRegex(ValueError, 'alias escapes'):
                self.audit(program)
        program = [('mov', 'eax, esp'), ('mov', 'dword ptr [esi], eax'), ('ret', '0xc')]
        with self.assertRaisesRegex(ValueError, 'alias escapes'):
            self.audit(program, calls={})

    def test_wrong_cleanup_or_return_size_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'unbalanced'):
            self.audit(self.program(), cleanup=4)
        program = self.program(); program[-1] = ('ret', '8')
        with self.assertRaises(ValueError):
            self.audit(program)

    def test_uninspected_call_and_opcode_fail_closed(self):
        for replacement in [('call', '0x2001'), ('lea', 'eax, [esp + 0x18]')]:
            program = self.program(); program[6] = replacement
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                self.audit(program)

    def test_truncation_gaps_and_unreachable_bytes_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'truncated'):
            self.audit(self.program(), end=0x100a)
        with self.assertRaises(ValueError):
            audit_stack_arguments([(1, 1, 'push', 'eax'), (3, 1, 'ret', '0xc')],
                                  start=1, end=4, argument_bytes=12, calls={})
        with self.assertRaisesRegex(ValueError, 'unreachable'):
            self.audit([('ret', '0xc'), ('ret', '0xc')], calls={})

    def test_branches_cannot_enter_partial_instructions_or_loop(self):
        for target in ('0x1002', '0x1009'):
            program = self.program(); program[3] = ('jne', target)
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, 'boundary'):
                self.audit(program)
        with self.assertRaisesRegex(ValueError, 'boundary'):
            audit_stack_arguments([(1, 2, 'je', '4'), (3, 2, 'ret', '0xc')],
                                  start=1, end=5, argument_bytes=12, calls={})

    def test_argument_overread_and_stack_pointer_rewrite_fail_closed(self):
        for replacement in [('mov', 'eax, dword ptr [esp + 0x1c]'), ('mov', 'esp, eax')]:
            program = self.program(); program[4] = replacement
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                self.audit(program)


if __name__ == '__main__':
    unittest.main()
