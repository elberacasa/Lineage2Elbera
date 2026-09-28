"""Portable synthetic helper-boundary tests; no original client files."""

from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from actor_octree_admission_machine import PartialWord
from check_static_actor_bounds_native import StaticBoundsMachine


def machine():
    program = SimpleNamespace(
        rows=[],
        half=0.5,
        bounds_constants={},
        membership_constants={},
        import_targets={},
        membership_targets={},
        admission_imports={},
        local_thunk=0xA01000,
        static_bounds_thunk=0xA02000,
    )
    return StaticBoundsMachine(program)


def call_at(address):
    return next(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("ffd2"), address))


class StaticBoundsBoundaryTest(unittest.TestCase):
    def test_transform_reply_preserves_float_bits_and_callee_cleanup(self):
        m = machine()
        # Authored method reply, including a signed zero; never inferred identity.
        matrix = [-0.0] + [float(i) for i in range(1, 16)]
        m.current = {"matrix": matrix}
        m.registers.update(esp=0x1000, ecx=0x2000, edx=m.source.local_thunk)
        m.memory[0x1000] = 0x3000
        self.assertEqual(m.step(call_at(0x106FE764)), 0x106FE766)
        self.assertEqual(m.registers["esp"], 0x1004)
        self.assertEqual(m.registers["eax"], 0x3000)
        self.assertEqual(m.bound_events, [["local", 0x2000]])
        self.assertEqual([m.memory[0x3000 + i * 4] for i in range(16)], matrix)
        self.assertEqual(str(m.memory[0x3000]), "-0.0")

    def test_auxiliary_reply_preserves_invalid_box_and_unknown_padding(self):
        m = machine()
        box = dict(min=[3.0, 2.0, 1.0], max=[-1.0, -2.0, -3.0], valid=0)
        m.current = {"auxiliary": box}
        m.registers.update(esp=0x1000, ecx=0x4000, edx=0xA60000)
        m.memory.update({0x1000: 0x3000, 0x1004: 0x2000})
        m.step(call_at(0x106FE7BB))
        self.assertEqual(m.registers["esp"], 0x1008)
        self.assertEqual(m.registers["eax"], 0x3000)
        self.assertEqual(m.bound_events, [["model", 0x4000, 0x2000]])
        self.assertEqual(m.box(0x3000), box)
        self.assertEqual(m.memory[0x3018], PartialWord(0, 255))
        with self.assertRaises(AssertionError):
            m.read("byte ptr [0x3019]")

    def test_unknown_virtual_target_cannot_consume_a_supplied_reply(self):
        for address in (0x106FE764, 0x106FE7BB):
            m = machine()
            m.registers.update(esp=0x1000, edx=0xDEAD)
            m.memory[0x1000] = 0x3000
            with self.assertRaises(AssertionError):
                m.step(call_at(address))
            self.assertEqual(m.bound_events, [])
            self.assertNotIn(0x3000, m.memory)

    def test_missing_method_response_is_not_an_identity_or_empty_box(self):
        for address, target in ((0x106FE764, 0xA01000), (0x106FE7BB, 0xA60000)):
            m = machine()
            m.current = {}
            m.registers.update(esp=0x1000, edx=target)
            m.memory.update({0x1000: 0x3000, 0x1004: 0x2000})
            with self.assertRaises(KeyError):
                m.step(call_at(address))
            self.assertNotIn(0x3000, m.memory)


if __name__ == "__main__":
    unittest.main()
