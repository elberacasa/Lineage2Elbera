"""Source-free tests for Elbera Tools' bounded integer-slice evaluator."""
import unittest
from types import SimpleNamespace

from check_pawn_notify_native import IntegerSlice, identity_domain


def machine(rows):
    code = {pc: SimpleNamespace(mnemonic=op, op_str=args, size=1)
            for pc, (op, args) in enumerate(rows)}
    return IntegerSlice(code.__getitem__, [(0, len(rows))])


class IntegerSliceTests(unittest.TestCase):
    def test_signed_compare_handles_subtraction_overflow(self):
        vm = machine([('cmp', 'eax, 1'), ('jl', '4'), ('mov', 'ecx, 0'),
                      ('jmp', '5'), ('mov', 'ecx, 1')])
        actual = vm.run(0, {5}, {'eax': 0x80000000}, {})
        self.assertEqual(actual['registers']['ecx'], 1)

    def test_moves_preserve_test_flags(self):
        vm = machine([('test', 'eax, eax'), ('mov', 'eax, 7'), ('je', '4'),
                      ('mov', 'eax, 9')])
        actual = vm.run(0, {4}, {'eax': 0}, {})
        self.assertEqual(actual['registers']['eax'], 7)

    def test_callback_state_and_explicit_pushes(self):
        vm = machine([('push', 'dword ptr [esi + 4]'), ('call', '100'),
                      ('mov', 'eax, dword ptr [esi + 4]')])
        def callback(registers, memory, pushes):
            memory[registers['esi'] + 4] = pushes[-1] + 1
        original = {20: 8}
        actual = vm.run(0, {3}, {'esi': 16}, original, {100: callback})
        self.assertEqual(actual['registers']['eax'], 9)
        self.assertEqual(original, {20: 8})

    def test_unknown_memory_is_not_zero(self):
        vm = machine([('cmp', 'dword ptr [esi + 4], 0')])
        with self.assertRaises(KeyError):
            vm.run(0, {1}, {'esi': 16}, {})

    def test_unknown_call_is_not_ignored(self):
        vm = machine([('call', '100')])
        with self.assertRaisesRegex(ValueError, 'unmodeled call'):
            vm.run(0, {1}, {}, {})

    def test_flags_do_not_survive_opaque_call(self):
        vm = machine([('test', 'eax, eax'), ('call', '100'), ('je', '3')])
        with self.assertRaisesRegex(ValueError, 'no flags'):
            vm.run(0, {3}, {'eax': 0}, {}, {100: lambda *_: None})

    def test_byte_read_does_not_test_upper_bits(self):
        vm = machine([('test', 'byte ptr [esi + 4], 1'), ('je', '3'),
                      ('mov', 'eax, 1')])
        actual = vm.run(0, {3}, {'esi': 16, 'eax': 0}, {20: 0x100})
        self.assertEqual(actual['registers']['eax'], 0)

    def test_step_bound_and_escape_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'step bound'):
            machine([('jmp', '0')]).run(0, {2}, {}, {}, limit=3)
        with self.assertRaisesRegex(ValueError, 'escaped'):
            machine([('jmp', '7')]).run(0, {2}, {}, {})

    def test_unimplemented_instruction_cannot_pass(self):
        with self.assertRaisesRegex(ValueError, 'unsupported instruction'):
            machine([('inc', 'eax')]).run(0, {1}, {'eax': 0}, {})


class SourceIdentityDomainTests(unittest.TestCase):
    @staticmethod
    def row(model='one', ref=1, path='Package.Shot1'):
        return {'model': model, 'objectRef': ref, 'objectPath': path,
                'objectName': path.rsplit('.', 1)[-1], 'classPath': 'Engine.AnimNotify_AttackShot'}

    def test_one_object_can_be_reused_across_sequences(self):
        rows = [dict(self.row(), sequence='first'), dict(self.row(), sequence='second')]
        result = identity_domain(rows)
        self.assertEqual(result['entries'], 2)
        self.assertEqual(result['distinctObjects'], 1)
        self.assertEqual(result['reusedObjects'], 1)
        self.assertFalse(result['importTargetVerified'])

    def test_reference_and_leaf_are_not_global_identity(self):
        result = identity_domain([self.row('one', 1, 'First.Shot1'), self.row('two', 1, 'Second.Shot1')])
        self.assertEqual(result['distinctObjects'], 2)
        self.assertEqual(result['crossModelAmbiguousLeafGroups'], 1)

    def test_same_model_leaf_collision_cannot_claim_candidate_equivalence(self):
        with self.assertRaisesRegex(ValueError, 'candidate identity collision'):
            identity_domain([self.row('one', 1, 'First.Shot1'), self.row('one', 2, 'Second.Shot1')])

    def test_rebound_source_reference_rejects_domain(self):
        with self.assertRaisesRegex(ValueError, 'one source reference'):
            identity_domain([self.row(path='First.Shot1'), self.row(path='First.Shot2')])

    def test_unknown_classes_null_objects_or_unicode_names_are_not_silently_admitted(self):
        for change in [{'classPath': 'Custom.DerivedShot'}, {'objectRef': 0}, {'objectRef': True},
                       {'objectPath': 'Package.Shöt1', 'objectName': 'Shöt1'}, {'objectName': 'Other'}]:
            with self.assertRaisesRegex(ValueError, 'outside measured'):
                identity_domain([dict(self.row(), **change)])


if __name__ == '__main__':
    unittest.main()
