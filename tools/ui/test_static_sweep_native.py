"""Authored interpreter semantics; no original client inputs."""

import struct
from types import SimpleNamespace
import unittest
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from check_static_sweep_native import PreparationMachine


def machine(code, **registers):
    rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(code), 0x1000))
    return (
        PreparationMachine(SimpleNamespace(engine=None, rows=rows), {}, registers),
        rows,
    )


class PreparationInterpreterTest(unittest.TestCase):
    def test_sub_zero_carry_and_signed_compare_are_not_stale(self):
        for a, b, expected in [
            (1, 1, (0, True, False, False)),
            (0, 1, (0xFFFFFFFF, False, True, True)),
            (0x80000000, 1, (0x7FFFFFFF, False, False, True)),
            (0x7FFFFFFF, 0xFFFFFFFF, (0x80000000, False, True, False)),
        ]:
            m, rows = machine("29d8", eax=a, ebx=b)  # sub eax,ebx
            m.zero, m.carry, m.less = (not v for v in expected[1:])
            m.step(rows[0])
            self.assertEqual((m.registers["eax"], m.zero, m.carry, m.less), expected)

    def test_fnstsw_keeps_high_word_of_float_cell_and_replaces_ax(self):
        for value in [-0.0, 1.25, -2.75]:
            m, rows = machine("dfe0", eax=value)  # fnstsw ax
            m.status = 0x4100
            m.step(rows[0])
            bits = struct.unpack("<I", struct.pack("<f", value))[0]
            self.assertEqual(m.registers["eax"], (bits & 0xFFFF0000) | 0x4100)

    def test_unqualified_call_never_becomes_a_noop(self):
        m, rows = machine("e800000000", esp=0x8000)
        with self.assertRaises(AssertionError):
            m.step(rows[0])

    def test_unbounded_loop_is_rejected(self):
        m, _ = machine("ebfe")  # jmp self
        with self.assertRaisesRegex(AssertionError, "did not finish"):
            m.until(0x1000, 0x2000)


if __name__ == "__main__":
    unittest.main()
