"""Authored interpreter semantics; no original game inputs."""

import math
import struct
from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from check_static_triangle_native import TriangleMachine


def machine(code, memory=None, **registers):
    rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(code), 0x1000))
    program = SimpleNamespace(engine=None, rows=rows, import_targets={})
    return TriangleMachine(program, memory or {}, registers), rows


def instruction(at, mnemonic, operands, size=5):
    return SimpleNamespace(address=at, mnemonic=mnemonic, op_str=operands, size=size)


class TriangleInterpreterTest(unittest.TestCase):
    def test_source_sign_clear_preserves_float_payload_and_positive_zero(self):
        for value in [-0.0, 0.0, -1.5, 2.75]:
            m, rows = machine("8120ffffff7f", {0x4000: value}, eax=0x4000)
            m.step(rows[0])  # and dword ptr [eax],0x7fffffff
            self.assertEqual(
                struct.pack("<f", m.memory[0x4000]), struct.pack("<f", abs(value))
            )

    def test_word_load_masks_upper_bits_without_sign_extension(self):
        m, rows = machine("0fb703", {0x4000: 0x12348001}, ebx=0x4000)
        m.step(rows[0])  # movzx eax,word ptr [ebx]
        self.assertEqual(m.registers["eax"], 0x8001)

    def test_neg_sbb_boolean_conversion_uses_fresh_carry(self):
        for value, expected in [(0, 0), (1, 0xFFFFFFFF), (0x80000000, 0xFFFFFFFF)]:
            m, rows = machine("f7d81bc0", eax=value)
            m.carry = value == 0
            for row in rows:
                m.step(row)
            self.assertEqual(m.registers["eax"], expected)

    def test_sqrt_boundary_is_positive_finite_and_does_not_pop_caller_arguments(self):
        for value in [0.125, 2.0, 1e20]:
            m, _ = machine("90", {0x8000: value}, esp=0x8000)
            pc = m.step(instruction(0x1010CCD2, "call", "0x10104840"))
            self.assertEqual(pc, 0x1010CCD7)
            self.assertEqual(m.stack, [math.sqrt(value)])
            self.assertEqual(m.registers["esp"], 0x8000)
            self.assertEqual(m.sqrt_calls, 1)
        for value in [0.0, -0.0, -1.0, math.inf, math.nan]:
            m, _ = machine("90", {0x8000: value}, esp=0x8000)
            with self.assertRaises(AssertionError):
                m.step(instruction(0x1014E0BC, "call", "0x10104840"))

    def test_unknown_call_never_borrows_a_named_math_boundary(self):
        m, _ = machine("90", {0x8000: 4.0}, esp=0x8000)
        with self.assertRaisesRegex(AssertionError, "unqualified triangle call"):
            m.step(instruction(0x1000, "call", "0x10104840"))

    def test_lookup_cannot_invent_a_loaded_triangle_array(self):
        m, _ = machine("90", {0x8000: 3}, esp=0x8000)
        with self.assertRaisesRegex(AssertionError, "explicit loaded triangle array"):
            m.step(instruction(0x10701C60, "call", "0x10304f43"))


if __name__ == "__main__":
    unittest.main()
