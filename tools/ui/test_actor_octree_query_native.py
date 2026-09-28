"""Portable synthetic instructions for query arithmetic and result adoption."""

import math
import struct
from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from actor_octree_query_machine import QueryMachine


def machine(code, address=0x1000):
    rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(code), address))
    program = SimpleNamespace(
        rows=rows,
        half=0.5,
        bounds_constants={},
        membership_constants={},
        import_targets={},
        membership_targets={},
        admission_imports={},
        query_max_time=3.4028234663852886e38,
    )
    return QueryMachine(program), rows


class QueryInterpreterTest(unittest.TestCase):
    def test_neg_sbb_inc_preserve_native_zero_hit_convention(self):
        for value, expected in [(0, 1), (1, 0), (0x80000000, 0), (0xFFFFFFFF, 0)]:
            m, rows = machine("f7d819c040")  # neg eax;sbb eax,eax;inc eax
            m.registers["eax"] = value
            for row in rows:
                m.step(row)
            self.assertEqual(m.registers["eax"], expected)
            self.assertEqual(m.zero, not bool(expected))

    def test_source_reciprocal_accepts_signed_zero_only_at_declared_sites(self):
        for denominator in [0.0, -0.0, 2.0, -4.0]:
            m, rows = machine("d83500400000", 0x10600A77)  # fdiv dword[0x4000]
            m.stack = [1.0]
            m.memory[0x4000] = denominator
            m.step(rows[0])
            expected = (
                math.copysign(math.inf, denominator)
                if denominator == 0
                else 1 / denominator
            )
            self.assertEqual(m.stack, [expected])
            self.assertEqual(m.zero_divisions, int(denominator == 0))
        m, rows = machine("d83500400000")
        m.stack = [1.0]
        m.memory[0x4000] = 0.0
        with self.assertRaises(AssertionError):
            m.step(rows[0])

    def test_byte_write_preserves_known_float_stack_bits(self):
        m, rows = machine("c60000")  # mov byte[eax],0
        m.registers["eax"] = 0x4000
        m.memory[0x4000] = -1.1
        original = struct.unpack("<I", struct.pack("<f", -1.1))[0]
        m.step(rows[0])
        self.assertEqual(m.memory[0x4000], original & 0xFFFFFF00)

    def test_hit_result_fields_retain_zero_and_opaque_identities(self):
        m, _ = machine("90")
        at = 0x4000
        values = [0, 0x5000, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 0x6000, 0.5, 0xFFFFFFFF, 0]
        m.memory.update({at + i * 4: v for i, v in enumerate(values)})
        r = m.result(at)
        self.assertEqual(r["point"], [1.0, 2.0, 3.0])
        self.assertEqual(r["actor"], 0x5000)
        self.assertEqual(r["item"], 0x6000)
        self.assertEqual(r["material"], 0)
        self.assertEqual(r["nodeIndex"], 0xFFFFFFFF)


if __name__ == "__main__":
    unittest.main()
