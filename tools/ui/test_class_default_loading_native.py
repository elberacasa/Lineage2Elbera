"""Portable interpreter/archive boundaries; all instructions and bytes authored."""

from types import SimpleNamespace
from pathlib import Path
import shutil
import tempfile
import unittest
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from check_class_default_loading_native import BROWSER_SCRIPT, DefaultLoadingMachine
from check_static_mesh_native import browser_outputs
from test_actor_localization_native import machine


class DefaultLoadingTest(unittest.TestCase):
    @unittest.skipUnless(
        shutil.which("node"), "browser runtime selection requires Node"
    )
    def test_browser_comparison_uses_the_requested_module(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "authored-loader.mjs"
            runtime.write_text(
                "export function loadClassDefaultProperties() { return "
                "{status:'ready',bytes:[7],values:[],applied:[]}; }\n"
            )
            actual = browser_outputs(
                BROWSER_SCRIPT,
                [dict(identity="Example", parent=None, structures=[])],
                runtime,
            )
        self.assertEqual(
            actual,
            [dict(bytes=[7], values=[], applied=[], names=[], references=[])],
        )

    def test_indirect_size_dispatch_reads_exact_indexed_target(self):
        m = machine(DefaultLoadingMachine)
        instruction = next(
            Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("ff248500100000"), 0x9000)
        )
        m.registers["eax"] = 2
        m.memory[0x1008] = 0xA000
        self.assertEqual(m.step(instruction), 0xA000)
        self.assertEqual(m.visited, [0x9000])
        m.registers["eax"] = 3
        with self.assertRaises(KeyError):
            m.step(instruction)

    def test_sete_preserves_the_other_register_bytes(self):
        m = machine(DefaultLoadingMachine)
        instruction = next(
            Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex("0f94c1"), 0x9000)
        )
        for zero in (False, True):
            m.zero = zero
            m.registers["ecx"] = 0xABCDEF99
            m.step(instruction)
            self.assertEqual(m.registers["ecx"], 0xABCDEF00 | int(zero))

    def test_archive_provider_reads_bounded_bytes_and_returns_without_touching_stack_arguments(
        self,
    ):
        m = machine(DefaultLoadingMachine)
        m.archive = 0xA000
        m.payload = b"\x01\x02\x03"
        m.cursor = 0
        m.registers.update(ecx=m.archive, eax=0xD22000)
        sp = m.registers["esp"]
        m.memory.update({sp: 0x2001, sp + 4: 3, 0x2000: 0xAAAAAAAA, 0x2004: 0xBBBBBBBB})
        instruction = SimpleNamespace(
            address=0x9000, mnemonic="call", op_str="eax", size=2
        )
        self.assertEqual(m.step(instruction), 0x9002)
        self.assertEqual(m.cursor, 3)
        self.assertEqual(m.registers["esp"], sp + 8)
        self.assertEqual(m.memory[0x2000], 0x030201AA)
        self.assertEqual(m.memory[0x2004], 0xBBBBBBBB)
        m.registers["esp"] = sp
        with self.assertRaises(AssertionError):
            m.step(instruction)


if __name__ == "__main__":
    unittest.main()
