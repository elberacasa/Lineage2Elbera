"""Authored interpreter fixtures; no original client files or disassembly."""

import math
from types import SimpleNamespace
import unittest

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from check_static_mesh_native import MeshMachine, TreeMachine, HitMachine


def instruction(at, mnemonic, operands="", size=5):
    return SimpleNamespace(address=at, mnemonic=mnemonic, op_str=operands, size=size)


def machine(cls=MeshMachine, memory=None, **registers):
    program = SimpleNamespace(engine=None, rows=[], import_targets={})
    extra = {}
    if cls is TreeMachine:
        extra = dict(
            triangles=0x4000,
            nodes=0x5000,
            default_object=0x6000,
            methods=dict(ownerMaterials=[0, 0xA000], ownerMethod124=0xB000),
        )
    return cls(program, memory or {}, registers, **extra)


class MeshInterpreterTest(unittest.TestCase):
    def test_cl_reads_only_low_byte(self):
        m = machine(ecx=0xDEADBE83)
        self.assertEqual(m.read("cl"), 0x83)
        self.assertEqual(m.registers["ecx"], 0xDEADBE83)

    def test_wait_is_inert_only_in_admitted_no_exception_profile(self):
        m = machine(memory={0x8000: 3.5}, eax=123, esp=0x8000)
        m.stack = [1.25, -2.0]
        row = next(Cs(CS_ARCH_X86, CS_MODE_32).disasm(b"\x9b", 0x1000))
        self.assertEqual(m.step(row), 0x1001)
        self.assertEqual(m.stack, [1.25, -2.0])
        self.assertEqual(m.memory, {0x8000: 3.5})
        self.assertEqual(m.registers["eax"], 123)
        self.assertEqual(m.visited, [0x1000])

    def test_named_max_and_clamp_calls_push_return_only_at_qualified_sites(self):
        for cls, at, target, body in [
            (MeshMachine, 0x107000B0, "0x10305ed9", 0x104A4940),
            (MeshMachine, 0x107000BF, "0x10305ed9", 0x104A4940),
            (HitMachine, 0x107035DE, "0x10307743", 0x103704B0),
            (HitMachine, 0x107035F2, "0x10307743", 0x103704B0),
        ]:
            m = machine(cls, esp=0x8000)
            self.assertEqual(m.step(instruction(at, "call", target)), body)
            self.assertEqual(m.registers["esp"], 0x7FFC)
            self.assertEqual(m.memory[0x7FFC], at + 5)
            with self.assertRaises(AssertionError):
                m.step(instruction(0x1000, "call", target))

    def test_normal_seh_frames_preserve_prior_link_and_saved_base_pointer(self):
        for method, start, base, stack, link in [
            ("enter_tree", 0x10702CC0, 0x8000 - 0x54, 0x8000 - 0xD0, 0x8000 - 0x60),
            ("enter_bounds", 0x106FFF9B, 0x7FFC, 0x8000 - 0x50, 0x7FF0),
        ]:
            m = machine(
                TreeMachine, {0: 0x1234, 0x8000: 0x9876}, esp=0x8000, ebp=0xAAAA
            )
            self.assertEqual(getattr(m, method)(), start)
            self.assertEqual((m.registers["ebp"], m.registers["esp"]), (base, stack))
            self.assertEqual(m.memory[0x7FFC], 0xAAAA)
            self.assertEqual(m.memory[link], 0x1234)
            self.assertEqual(m.memory[0], link)
            self.assertEqual(m.memory[0x8000], 0x9876)

    def test_material_method_boundaries_preserve_argument_cleanup_and_order(self):
        m = machine(TreeMachine, {0x8000: 1}, esp=0x8000)
        m.step(instruction(0x10702FEF, "call", "eax", 2))
        self.assertEqual((m.registers["eax"], m.registers["esp"]), (0xA000, 0x8004))
        m.step(instruction(0x1070303C, "call", "eax", 2))
        self.assertEqual((m.registers["eax"], m.registers["esp"]), (0xB000, 0x8004))
        self.assertEqual(
            m.events, [["ownerMaterial", 1, 0xA000], ["ownerMethod124", 0xB000]]
        )

    def test_default_object_and_successful_type_boundary_do_not_pop_cdecl_input(self):
        m = machine(TreeMachine, {0x8000: 0x6000}, esp=0x8000)
        self.assertEqual(m.step(instruction(0x10703012, "nop")), 0x10703018)
        self.assertEqual(m.registers["eax"], 0x6000)
        m.step(instruction(0x10703019, "call", "0x103090c5"))
        self.assertEqual(m.registers["esp"], 0x8000)
        self.assertEqual(m.events, [["defaultObject"], ["checkedDefaultObject"]])
        m.memory[0x8000] = 0xDEAD
        with self.assertRaises(AssertionError):
            m.step(instruction(0x10703019, "call", "0x103090c5"))

    def test_source_missing_triangle_assertion_is_never_a_success(self):
        m = machine(TreeMachine)
        with self.assertRaisesRegex(AssertionError, "missing triangle"):
            m.step(instruction(0x10702D0C, "nop"))

    def test_hit_sqrt_retains_argument_and_rejects_nonpositive_or_nonfinite_values(
        self,
    ):
        for at in [0x1010CA3F, 0x1010CB57]:
            for value in [0.125, 2.0, 1e20]:
                m = machine(HitMachine, {0x8000: value}, esp=0x8000)
                self.assertEqual(m.step(instruction(at, "call", "0x10104840")), at + 5)
                self.assertEqual(m.stack, [math.sqrt(value)])
                self.assertEqual((m.registers["esp"], m.sqrt_calls), (0x8000, 1))
            for value in [0.0, -0.0, -1.0, math.inf, math.nan]:
                m = machine(HitMachine, {0x8000: value}, esp=0x8000)
                with self.assertRaises(AssertionError):
                    m.step(instruction(at, "call", "0x10104840"))


if __name__ == "__main__":
    unittest.main()
