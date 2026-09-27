"""Source-free safety and arithmetic tests for Elbera Tools' bounded evaluator."""
import unittest
from types import SimpleNamespace

from check_anim_terminal_native import f32, x87_slice


def instructions(*rows):
    return [SimpleNamespace(mnemonic=op, op_str=arg) for op, arg in rows]


class FloatingSliceTests(unittest.TestCase):
    def test_reverse_operations_preserve_operand_order(self):
        memory, stack = x87_slice(instructions(('fdivrp', 'st(1)'), ('fsubr', 'constant')),
                                  {'constant': 7.}, [6., 2.])
        self.assertEqual(stack, [4.])

    def test_pop_store_to_stack_has_x87_order(self):
        _, stack = x87_slice(instructions(('fstp', 'st(1)'), ('fmulp', 'st(1)')), {}, [3., 7., 2.])
        self.assertEqual(stack, [6.])

    def test_float32_memory_store_rounds_without_changing_live_register(self):
        memory, stack = x87_slice(instructions(('fst', 'dword ptr [sample]')), {}, [1. + 2 ** -25])
        self.assertEqual(memory['dword ptr [sample]'], 1.)
        self.assertNotEqual(stack[0], 1.)

    def test_repeated_store_rounding_is_observable(self):
        mem = {'dword ptr [sample]': f32(2 ** 24), 'one': 1.}
        for _ in range(2):
            x87_slice(instructions(('fld', 'dword ptr [sample]'), ('fadd', 'one'),
                                   ('fstp', 'dword ptr [sample]')), mem, [])
        self.assertEqual(mem['dword ptr [sample]'], 2 ** 24)
        self.assertNotEqual(mem['dword ptr [sample]'], f32(2 ** 24 + 2))

    def test_rejects_unbounded_code_and_unsupported_stores(self):
        for op, arg in [('call', '0x1234'), ('jmp', '0x1234'), ('fst', 'qword ptr [sample]')]:
            with self.subTest(op=op), self.assertRaises(AssertionError):
                x87_slice(instructions((op, arg)), {}, [1.])


if __name__ == '__main__':
    unittest.main()
