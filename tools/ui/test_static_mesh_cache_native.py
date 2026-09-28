"""Authored cache-interpreter fixtures; no original images or game inputs."""

from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from check_static_mesh_cache_native import CacheMachine


def machine(code="90", memory=None, **registers):
    rows = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(code), 0x1000))
    program = SimpleNamespace(engine=None, rows=rows, import_targets={})
    m = CacheMachine(
        program,
        memory or {},
        registers,
        matrices={},
        count=7,
        mode="reuse",
        old=0x4000,
        new=0x5000,
        token_old=0x6000,
        token_new=0x7000,
    )
    return m, rows


def instruction(at, op, operands="", size=5):
    return SimpleNamespace(address=at, mnemonic=op, op_str=operands, size=size)


class CacheInterpreterTest(unittest.TestCase):
    def test_unsigned_mul_keeps_both_words_and_updates_carry(self):
        for a, b, low, high in [
            (0, 0xFFFFFFFF, 0, 0),
            (0xFFFFFFFF, 0xFFFFFFFF, 1, 0xFFFFFFFE),
            (0x80000000, 2, 0, 1),
            (123, 456, 56088, 0),
        ]:
            m, rows = machine("f7e1", eax=a, ecx=b)  # mul ecx
            m.carry = not bool(high)
            m.step(rows[0])
            self.assertEqual(
                (m.registers["eax"], m.registers["edx"], m.carry),
                (low, high, bool(high)),
            )

    def test_or_sets_the_branch_zero_flag_and_clears_carry(self):
        for a, b, result in [
            (0, 0, 0),
            (0, 0x80000000, 0x80000000),
            (0x1234, 0xFF00, 0xFF34),
        ]:
            m, rows = machine("09c1", eax=a, ecx=b)  # or ecx,eax
            m.zero, m.carry = result != 0, True
            m.step(rows[0])
            self.assertEqual(
                (m.registers["ecx"], m.zero, m.carry, m.sign),
                (result, result == 0, False, bool(result & 0x80000000)),
            )

    def test_add_then_adc_uses_fresh_carry_and_dword_wrap(self):
        m, rows = machine("01c611d7", eax=1, esi=0xFFFFFFFF, edx=0, edi=0xFFFFFFFF)
        m.carry = False
        m.step(rows[0])  # add esi,eax
        self.assertEqual((m.registers["esi"], m.carry, m.zero), (0, True, True))
        m.step(rows[1])  # adc edi,edx
        self.assertEqual((m.registers["edi"], m.carry, m.zero), (0, True, True))
        m.registers.update(eax=3, esi=4, edx=9, edi=5)
        for row in rows:
            m.step(row)
        self.assertEqual(
            (m.registers["esi"], m.registers["edi"], m.carry), (7, 14, False)
        )

    def test_get_and_create_preserve_out_token_and_callee_cleanup(self):
        m, _ = machine(
            memory={0x8000: 0xE3, 0x8004: 99, 0x8008: 0x9000, 0x800C: 8}, esp=0x8000
        )
        self.assertEqual(m.step(instruction(0x106FEF22, "nop")), 0x106FEF28)
        self.assertEqual(
            (m.registers["eax"], m.registers["esp"], m.memory[0x9000]),
            (0x4000, 0x8010, 0x6000),
        )
        self.assertEqual(m.events, [["get", 0xE3, 99, 8]])
        m.memory.update(
            {
                0x8010: 0xE3,
                0x8014: 99,
                0x8018: 0x9000,
                0x801C: 224,
                0x8020: 8,
                0x8024: 0,
            }
        )
        m.step(instruction(0x106FEF96, "nop"))
        self.assertEqual(
            (m.registers["eax"], m.registers["esp"], m.memory[0x9000]),
            (0x5000, 0x8028, 0x7000),
        )
        self.assertEqual(m.events[-1], ["create", 224, 8, 0])

    def test_miss_is_a_null_provider_response_not_an_invented_cache(self):
        m, _ = machine(
            memory={0x8000: 0xE3, 0x8004: 0, 0x8008: 0x9000, 0x800C: 8}, esp=0x8000
        )
        m.mode = "miss"
        m.step(instruction(0x106FEF22, "nop"))
        self.assertEqual((m.registers["eax"], m.memory[0x9000]), (0, 0))

    def test_flush_normalizes_argument_bits_and_unlock_keeps_stack(self):
        m, _ = machine(
            memory={0x8000: 0xE3, 0x8004: 9, 0x8008: -1, 0x800C: 0},
            esp=0x8000,
            ecx=0x6000,
        )
        m.step(instruction(0x106FEF41, "nop"))
        self.assertEqual(m.registers["esp"], 0x8000)
        m.step(instruction(0x106FEF55, "nop"))
        self.assertEqual(m.registers["esp"], 0x8010)
        self.assertEqual(m.events, [["unlock"], ["flush", 0xFFFFFFFF, 0]])
        m.registers["ecx"] = 0xDEAD
        with self.assertRaises(AssertionError):
            m.step(instruction(0x106FE894, "nop"))

    def test_source_methods_are_admitted_only_at_declared_calls(self):
        for target in [
            "0x1030eeda",
            "0x1030e390",
            "0x1030df58",
            "0x10302d47",
            "0x107a6660",
            "0x10313101",
        ]:
            m, _ = machine(esp=0x8000)
            with self.assertRaises(AssertionError):
                m.step(instruction(0x1000, "call", target))
        m, _ = machine(esp=0x8000)
        m.step(instruction(0x106FEB82, "call", "0x1030eeda"))
        self.assertEqual((m.registers["eax"], m.registers["esp"]), (7, 0x8000))

    def test_owner_matrix_method_copies_result_and_pops_only_output_pointer(self):
        m, _ = machine(memory={0x8000: 0x9000}, esp=0x8000)
        matrix = [float(i) for i in range(16)]
        m.matrices = {"worldToLocal": matrix}
        m.step(instruction(0x106FE14D, "call", "eax", 2))
        self.assertEqual((m.registers["eax"], m.registers["esp"]), (0x9000, 0x8004))
        self.assertEqual([m.memory[0x9000 + i * 4] for i in range(16)], matrix)
        self.assertEqual(m.events, [["worldToLocal"]])
        with self.assertRaises(AssertionError):
            m.step(instruction(0x106FE14D, "call", "edx", 2))


if __name__ == "__main__":
    unittest.main()
