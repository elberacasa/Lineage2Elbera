"""Authored interpreter edge cases; no original images or game records."""

from types import SimpleNamespace
import unittest

from actor_octree_admission_machine import AdmissionMachine, PartialWord
from check_actor_localization_native import (
    LocalizationMachine,
    StringLocalizationMachine,
    StringLoadingMachine,
)
from capstone import Cs, CS_ARCH_X86, CS_MODE_32


def machine(cls=LocalizationMachine):
    m = object.__new__(cls)
    program = SimpleNamespace(
        rows=[],
        half=0.5,
        bounds_constants={},
        membership_constants={},
        import_targets={},
        membership_targets={},
        admission_imports={},
    )
    AdmissionMachine.__init__(m, program)
    return m


class LocalizationMemoryTest(unittest.TestCase):
    def test_compact_byte_sign_and_word_comparison_use_operand_width(self):
        m = machine(StringLoadingMachine)
        dis = Cs(CS_ARCH_X86, CS_MODE_32)
        byte_test = next(dis.disasm(bytes.fromhex("84c0"), 0x9000))
        word_cmp = next(dis.disasm(bytes.fromhex("663dff00"), 0x9010))
        setge = next(dis.disasm(bytes.fromhex("0f9dc1"), 0x9020))
        m.registers.update(eax=0x12340080, ecx=0xAABBCCDD)
        m.step(byte_test)
        self.assertTrue(m.sign)
        self.assertTrue(m.less)
        self.assertFalse(m.carry)
        m.step(setge)
        self.assertEqual(m.registers["ecx"], 0xAABBCC00)
        m.registers["eax"] = 0xABCDFFFF
        m.step(word_cmp)
        self.assertTrue(m.less)
        self.assertFalse(m.carry)
        m.registers["eax"] = 0xABCD0080
        m.step(word_cmp)
        self.assertTrue(m.less)
        self.assertTrue(m.carry)

    def test_word_store_preserves_unknown_neighbor_bytes(self):
        m = machine()
        m.write("word ptr [0x1002]", 0x1234)
        self.assertEqual(m.memory[0x1000], PartialWord(0x12340000, 0xFFFF0000))
        self.assertEqual(m.read("word ptr [0x1002]"), 0x1234)
        with self.assertRaises(AssertionError):
            m.read("word ptr [0x1000]")
        m.write("word ptr [0x1001]", 0x5678)
        self.assertEqual(m.memory[0x1000], PartialWord(0x12567800, 0xFFFFFF00))

    def test_negative_copy_difference_wraps_effective_address(self):
        m = machine()
        m.registers.update(esi=0xFFFFFF00, ecx=0x1100)
        m.write("word ptr [esi + ecx]", 0xABCD)
        self.assertEqual(m.read("word ptr [0x1000]"), 0xABCD)
        self.assertNotIn(0x100001000, m.memory)

    def test_utf16_preserves_surrogates_and_word_register_neighbors(self):
        m = machine()
        value = "Café / 水 / \U0001f30a"
        m.put_text(0x2002, value)
        self.assertEqual(m.text(0x2002), value)
        m.registers["edx"] = 0xCAFEBABE
        m.write("dx", 0x1234)
        self.assertEqual(m.registers["edx"], 0xCAFE1234)
        self.assertEqual(m.read("dx"), 0x1234)

    def test_byte_heap_retains_partial_words_without_rounding_string_sizes(self):
        m = machine(StringLocalizationMachine)
        old = m.allocate(6)
        m.write(f"word ptr [{old:#x}]", 0x1234)
        m.write(f"word ptr [{old+4:#x}]", 0xABCD)
        new = m.reallocate(old, 10)
        self.assertEqual(m.blocks[new], 10)
        self.assertNotIn(old, m.blocks)
        self.assertEqual(m.read(f"word ptr [{new:#x}]"), 0x1234)
        self.assertEqual(m.read(f"word ptr [{new+4:#x}]"), 0xABCD)
        with self.assertRaises(AssertionError):
            m.read(f"word ptr [{new+2:#x}]")
        with self.assertRaises(AssertionError):
            m.read(f"word ptr [{new+6:#x}]")
        self.assertEqual(m.reallocate(new, 0), 0)
        self.assertEqual(m.blocks, {})

    def test_stack_probe_integer_operations_preserve_correct_borrow_and_registers(self):
        m = machine(StringLocalizationMachine)
        dis = Cs(CS_ARCH_X86, CS_MODE_32)
        sbb = next(dis.disasm(bytes.fromhex("1bc0"), 0x9000))
        inv = next(dis.disasm(bytes.fromhex("f7d0"), 0x9002))
        swap = next(dis.disasm(bytes.fromhex("94"), 0x9004))
        for carry in (False, True):
            m.registers["eax"] = 0x56781234
            m.carry = carry
            m.step(sbb)
            self.assertEqual(m.registers["eax"], 0xFFFFFFFF if carry else 0)
            self.assertEqual(m.carry, carry)
            m.step(inv)
            self.assertEqual(m.registers["eax"], 0 if carry else 0xFFFFFFFF)
            self.assertEqual(m.carry, carry)
        m.registers.update(eax=0x1234, esp=0x5678)
        m.step(swap)
        self.assertEqual((m.registers["eax"], m.registers["esp"]), (0x5678, 0x1234))


if __name__ == "__main__":
    unittest.main()
