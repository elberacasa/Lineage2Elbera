"""Portable synthetic instructions for actor-admission interpreter additions."""

from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from actor_octree_admission_machine import AdmissionMachine, PartialWord


def machine(code):
    rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(code), 0x1000))
    program = SimpleNamespace(
        rows=rows,
        half=0.5,
        bounds_constants={},
        membership_constants={},
        import_targets={},
        membership_targets={},
        admission_imports={},
    )
    return AdmissionMachine(program), rows


class AdmissionInterpreterTest(unittest.TestCase):
    def test_fucompp_consumes_two_operands_and_replaces_status(self):
        for a, b, status in [(1.0, 2.0, 0x100), (2.0, 1.0, 0), (-0.0, 0.0, 0x4000)]:
            m, rows = machine("dae9")
            m.status = 0xFFFF
            m.stack = [a, b, 7.0]
            m.step(rows[0])
            self.assertEqual((m.status, m.stack), (status, [7.0]))
        m, rows = machine("dae9")
        m.stack = [float("nan"), 0.0]
        with self.assertRaises(AssertionError):
            m.step(rows[0])

    def test_unknown_padding_survives_validity_byte_write_and_word_copy(self):
        m, rows = machine(
            "c600018b08890a"
        )  # mov byte[eax],1;mov ecx,[eax];mov[edx],ecx
        m.registers.update(eax=0x4000, edx=0x5000)
        for row in rows:
            m.step(row)
        self.assertEqual(m.memory[0x5000], PartialWord(1, 255))
        self.assertEqual(m.read("byte ptr [0x5000]"), 1)
        with self.assertRaises(AssertionError):
            m.read("byte ptr [0x5001]")

    def test_known_flag_byte_reads_do_not_consume_high_bits(self):
        m, _ = machine("90")
        m.memory[0x4000] = 0xAABBCCDD
        self.assertEqual(m.read("byte ptr [0x4000]"), 0xDD)
        self.assertEqual(m.read("byte ptr [0x4001]"), 0xCC)


if __name__ == "__main__":
    unittest.main()
