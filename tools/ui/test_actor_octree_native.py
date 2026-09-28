"""Portable authored instructions for octree interpreter additions."""

from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from check_actor_octree_native import OctreeGeometryMachine


class OctreeGeometryInterpreterTest(unittest.TestCase):
    def test_fabs_preserves_finite_magnitude_and_clears_zero_sign(self):
        rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("d9e1"), 0x1000))
        for value in [-0.0, -3.25, 2.5]:
            m = OctreeGeometryMachine(SimpleNamespace(engine=None, rows=rows), {}, {})
            m.stack = [value]
            m.step(rows[0])
            self.assertEqual(m.stack, [abs(value)])
            if value == 0:
                import math

                self.assertEqual(math.copysign(1, m.stack[0]), 1)

    def test_integer_fpu_load_and_multiply_use_signed_dwords(self):
        rows = list(
            Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("db0424da0c24"), 0x1000)
        )
        for raw, signed in [(0xFFFFFFFF, -1), (0x80000000, -2147483648), (1, 1)]:
            program = SimpleNamespace(engine=None, rows=rows)
            m = OctreeGeometryMachine(program, {0x9000: raw}, dict(esp=0x9000))
            m.step(rows[0])
            self.assertEqual(m.stack, [float(signed)])
            m.stack[0] = 0.5
            m.step(rows[1])
            self.assertEqual(m.stack, [signed * 0.5])

    def test_or_wraps_dword_and_sets_fresh_flags(self):
        rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("09c1"), 0x1000))
        for a, b, wanted in [
            (0, 0, 0),
            (0x80000000, 2, 0x80000002),
            (0xFFFFFFFF, 0, 0xFFFFFFFF),
        ]:
            m = OctreeGeometryMachine(
                SimpleNamespace(engine=None, rows=rows), {}, dict(eax=a, ecx=b)
            )
            m.carry = True
            m.step(rows[0])
            self.assertEqual(
                (m.registers["ecx"], m.zero, m.sign, m.carry, m.parity),
                (
                    wanted,
                    wanted == 0,
                    bool(wanted & 0x80000000),
                    False,
                    bin(wanted & 255).count("1") % 2 == 0,
                ),
            )


if __name__ == "__main__":
    unittest.main()
