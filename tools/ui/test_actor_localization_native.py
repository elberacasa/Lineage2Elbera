"""Authored interpreter edge cases; no original images or game records."""

from types import SimpleNamespace
import unittest

from actor_octree_admission_machine import AdmissionMachine, PartialWord
from check_actor_localization_native import LocalizationMachine


def machine():
    m = object.__new__(LocalizationMachine)
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


if __name__ == "__main__":
    unittest.main()
