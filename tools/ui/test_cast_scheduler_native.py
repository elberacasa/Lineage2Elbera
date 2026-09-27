#!/usr/bin/env python3
"""Elbera Tools: source-free checks for the bounded native arithmetic reader."""
import struct
from types import SimpleNamespace
import unittest

from check_cast_scheduler_native import Arithmetic, equations, f32


class SyntheticImage:
    base = 0

    def __init__(self, instructions):
        self.data = bytes(len(instructions))
        self.dis = SimpleNamespace(disasm=lambda data, start: (
            SimpleNamespace(address=i, size=1, mnemonic=mnemonic, op_str=operands)
            for i, (mnemonic, operands) in enumerate(instructions)))


def run(instructions, stack=(), memory=None, registers=None):
    machine = Arithmetic(SyntheticImage(instructions), memory or {}, stack, registers or {})
    machine.run(0, len(instructions))
    return machine


class ArithmeticChecks(unittest.TestCase):
    def test_signed_test_selects_nonflex_branch(self):
        machine = run([('test', 'eax, eax'), ('jl', '3'), ('mov', 'ebx, 99'),
                       ('mov', 'ecx, 7')], registers={'eax': -1})
        self.assertNotIn('ebx', machine.registers)
        self.assertEqual(machine.registers['ecx'], 7)

    def test_x87_equal_status_parity(self):
        machine = run([('fcom', 'st(1)'), ('fnstsw', 'ax'), ('test', 'ah, 0x41'),
                       ('jne', '5'), ('mov', 'ebx, 99')], stack=[2., 2.])
        self.assertNotIn('ebx', machine.registers)
        self.assertEqual(machine.status, 0x4000)

    def test_x87_less_than_status_parity(self):
        machine = run([('fcom', 'st(1)'), ('fnstsw', 'ax'), ('test', 'ah, 5'),
                       ('jp', '5'), ('mov', 'ebx, 99')], stack=[1., 2.])
        self.assertEqual(machine.registers['ebx'], 99)
        self.assertEqual(machine.status, 0x100)

    def test_reverse_arithmetic_and_pop(self):
        machine = run([('fsubrp', 'st(1)'), ('fdivr', 'st(1)')], stack=[10., 4., 3.])
        self.assertEqual(machine.stack, [.5, 3.])

    def test_float_store_rounds_but_register_remains_extended(self):
        value = 1. + 2. ** -25
        machine = run([('fst', 'dword ptr [eax]')], stack=[value], registers={'eax': 100})
        self.assertEqual(machine.memory[100], 1.)
        self.assertEqual(machine.stack[0], value)

    def test_same_register_xor_does_not_require_prior_value(self):
        machine = run([('xor', 'ecx, ecx')])
        self.assertEqual(machine.registers['ecx'], 0)

    def test_rejects_calls_instead_of_guessing_import_behavior(self):
        with self.assertRaisesRegex(AssertionError, 'unsupported instruction'):
            run([('call', '0x1000')])

    def test_bounded_execution_rejects_infinite_loop(self):
        with self.assertRaisesRegex(AssertionError, 'did not terminate'):
            run([('jmp', '0')])

    def test_physical_shot_budget_does_not_compress_whole_clip(self):
        result = equations([1.5], 0, .5, -1, 1.4, 0., 1.)
        self.assertAlmostEqual(result['shotTime'], 1.4)
        self.assertGreater(result['dues'][0], 3.7)

    def test_flexible_collapse_is_rate_change_without_negative_loop(self):
        result = equations([.8, .1, 1.5], 2, .5, 1, 1., f32(.15), 1.)
        self.assertAlmostEqual(result['rate'], 2.)
        self.assertEqual(result['dues'][0], result['dues'][1])


if __name__ == '__main__':
    unittest.main()
