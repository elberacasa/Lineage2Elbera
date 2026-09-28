"""Portable authored membership-interpreter checks; no client files required."""

from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from actor_octree_machine import MembershipMachine


def machine(code="90", memory=None, **registers):
    rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(code), 0x1000))
    program = SimpleNamespace(
        rows=rows,
        half=0.5,
        bounds_constants={},
        membership_constants={},
        import_targets={},
        membership_targets={},
    )
    m = MembershipMachine(program, memory)
    m.registers.update(registers)
    return m, rows


class MembershipInterpreterTest(unittest.TestCase):
    def test_test_clears_stale_signed_branch_state(self):
        m, rows = machine("85c0", eax=1)
        m.less, m.carry, m.zero = True, True, True
        m.step(rows[0])
        self.assertEqual(
            (m.less, m.carry, m.zero, m.sign), (False, False, False, False)
        )
        m.registers["eax"] = 0x80000000
        m.step(rows[0])
        self.assertTrue(m.less and m.sign)

    def test_signed_compare_uses_overflow_and_unsigned_carry_separately(self):
        for a, b, less, carry in [
            (0x80000000, 1, True, False),
            (0x7FFFFFFF, 0xFFFFFFFF, False, True),
            (0xFFFFFFFF, 0xFFFFFFFF, False, False),
        ]:
            m, rows = machine("39c8", eax=a, ecx=b)
            m.step(rows[0])
            self.assertEqual((m.less, m.carry, m.zero), (less, carry, a == b))

    def test_add_wrap_and_inc_preserve_distinct_carry_rules(self):
        m, rows = machine("01c840", eax=0xFFFFFFFF, ecx=1)
        m.step(rows[0])
        self.assertEqual((m.registers["eax"], m.carry, m.zero), (0, True, True))
        m.step(rows[1])
        self.assertEqual((m.registers["eax"], m.carry, m.zero), (1, True, False))

    def test_partial_state_byte_preserves_other_bytes(self):
        m, rows = machine("c644240101", memory={0x8000: 0xAABBCCDD}, esp=0x8000)
        m.step(rows[0])
        self.assertEqual(m.memory[0x8000], 0xAABB01DD)

    def test_overlap_copy_handles_both_directions(self):
        for dest, source, expected in [
            (0x4004, 0x4000, [1, 1, 2, 3]),
            (0x4000, 0x4004, [2, 3, 4, 4]),
        ]:
            m, _ = machine(memory={0x4000 + 4 * i: i + 1 for i in range(4)})
            m.memmove(dest, source, 12)
            self.assertEqual([m.memory[0x4000 + 4 * i] for i in range(4)], expected)

    def test_reallocation_copies_known_cells_without_initializing_unknowns(self):
        m, _ = machine()
        ptr = m.allocate(12)
        m.memory[ptr + 4] = 123
        new = m.reallocate(ptr, 20)
        self.assertNotIn(ptr, m.blocks)
        self.assertNotIn(ptr + 4, m.memory)
        self.assertEqual(m.memory[new + 4], 123)
        self.assertNotIn(new, m.memory)
        self.assertNotIn(new + 16, m.memory)
        self.assertEqual(m.reallocate(new, 0), 0)
        self.assertEqual(m.blocks, {})

    def test_unknown_instruction_and_undeclared_calls_fail_closed(self):
        for code in ["90", "e8fb0f0000"]:
            m, rows = machine(code)
            with self.assertRaises(AssertionError):
                m.step(rows[0])


if __name__ == "__main__":
    unittest.main()
