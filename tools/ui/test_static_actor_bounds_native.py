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
    def test_unadmitted_actor_paths_never_treat_erased_calls_as_noops(self):
        for at in (0x1052F5B3, 0x1052F5F3):
            m = machine()
            instruction = next(Cs(CS_ARCH_X86, CS_MODE_32).disasm(b"\x90", at))
            with self.assertRaisesRegex(AssertionError, "unadmitted actor"):
                m.step(instruction)
            self.assertEqual(m.visited, [])

    def test_low_byte_register_store_preserves_upper_word_and_flags(self):
        m = machine()
        m.registers.update(eax=0x12345678, edi=0x3000)
        m.memory[0x3000] = 0x11223344
        m.carry, m.zero, m.less = True, False, True
        # Authored MOV AL, 0xab; MOV byte ptr [EDI+1], AL.
        for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(
            bytes.fromhex("b0ab884701"), 0x9000
        ):
            m.step(instruction)
        self.assertEqual(m.registers["eax"], 0x123456AB)
        self.assertEqual(m.memory[0x3000], 0x1122AB44)
        self.assertEqual((m.carry, m.zero, m.less), (True, False, True))

    def test_add_with_carry_preserves_unsigned_wrap_and_signed_branch_flags(self):
        instruction = next(
            Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("11d8"), 0x9000)
        )
        # ADC EAX, EBX: result, carry, zero and signed-less flag.
        for a, b, carry, value, carry_out, zero, less in [
            (0xFFFFFFFF, 0, True, 0, True, True, False),
            (0x7FFFFFFF, 0, True, 0x80000000, False, False, False),
            (0x80000000, 0xFFFFFFFF, False, 0x7FFFFFFF, True, False, True),
            (0x80000000, 0xFFFFFFFF, True, 0x80000000, True, False, True),
        ]:
            m = machine()
            m.registers.update(eax=a, ebx=b)
            m.carry = carry
            self.assertEqual(m.step(instruction), 0x9002)
            self.assertEqual(
                (m.registers["eax"], m.carry, m.zero, m.less),
                (value, carry_out, zero, less),
            )

    def test_unsigned_multiply_returns_both_words_and_source_carry(self):
        instruction = next(
            Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("f7e1"), 0x9000)
        )
        for a, b, low, high in [
            (0xFFFFFFFF, 0xFFFFFFFF, 1, 0xFFFFFFFE),
            (0x80000000, 2, 0, 1),
            (123, 0, 0, 0),
        ]:
            m = machine()
            m.registers.update(eax=a, ecx=b, ebx=0x1234)
            m.step(instruction)
            self.assertEqual(
                (m.registers["eax"], m.registers["edx"], m.carry),
                (low, high, bool(high)),
            )
            self.assertEqual((m.registers["ecx"], m.registers["ebx"]), (b, 0x1234))

    def test_forward_repeated_word_stores_write_only_the_requested_cells(self):
        m = machine()
        m.registers.update(ecx=3, edi=0x3000, eax=0x12345678)
        m.memory.update({0x2FFC: 7, 0x300C: 9})
        instruction = next(
            Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("f3ab"), 0x9000)
        )
        self.assertEqual(m.step(instruction), 0x9002)
        self.assertEqual([m.memory[0x3000 + i * 4] for i in range(3)], [0x12345678] * 3)
        self.assertEqual((m.memory[0x2FFC], m.memory[0x300C]), (7, 9))
        self.assertEqual((m.registers["ecx"], m.registers["edi"]), (0, 0x300C))

    def test_forward_repeated_byte_stores_preserve_unknown_surrounding_bytes(self):
        m = machine()
        m.registers.update(ecx=3, edi=0x3003, eax=0x123456AB)
        instruction = next(
            Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("f3aa"), 0x9000)
        )
        m.step(instruction)
        self.assertEqual(m.memory[0x3000], PartialWord(0xAB000000, 0xFF000000))
        self.assertEqual(m.memory[0x3004], PartialWord(0xABAB, 0xFFFF))
        self.assertEqual((m.registers["ecx"], m.registers["edi"]), (0, 0x3006))
        with self.assertRaises(AssertionError):
            m.read("byte ptr [0x3006]")

    def test_zero_count_string_store_never_touches_the_null_destination(self):
        for code in ("f3ab", "f3aa"):
            m = machine()
            m.registers.update(ecx=0, edi=0)
            before = dict(m.memory)
            m.step(
                next(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(code), 0x9000))
            )
            self.assertEqual(m.memory, before)
            self.assertEqual(m.registers["edi"], 0)

    def test_postload_rejects_unqualified_versions_flags_and_storage_before_execution(
        self,
    ):
        for version, flags, count in [
            (7, 0, 1),
            (-1, 0, 1),
            (0x80000000, 0, 1),
            (8, 0x100, 1),
            (8, -1, 1),
            (8, 0, -1),
        ]:
            m = machine()
            m.memory.update({0x201DC: version, 0x2001C: flags, 0x2007C: count})
            with self.assertRaises(AssertionError):
                m.postload(0x20000)
            self.assertEqual(m.visited, [])
        m = machine()
        m.memory.update(
            {0x201DC: 8, 0x2001C: 0, 0x2007C: 1, 0x200D8: 0, 0x200DC: 1, 0x200E0: 0}
        )
        with self.assertRaises(AssertionError):
            m.postload(0x20000)
        self.assertEqual(m.visited, [])

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
