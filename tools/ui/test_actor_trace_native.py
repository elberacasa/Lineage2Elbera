"""Portable, authored interpreter fixtures. No original client files required."""

import unittest
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

from check_actor_trace_native import TraceMachine


def row(answer):
    return dict(
        kind="pawn",
        actor=dict(identity=0x200000, controllerIdentity=None),
        source=None,
        flags=1,
        answers={"checkLoadingResource": answer},
    )


def instruction(raw, address):
    return next(Cs(CS_ARCH_X86, CS_MODE_32).disasm(raw, address))


class TraceInterpreterTests(unittest.TestCase):
    def test_named_loader_frame_and_later_byte_read(self):
        machine = TraceMachine(
            row(
                dict(
                    value=128,
                    writes=[dict(target="actor", field="flags678", value=0x12345602)],
                )
            ),
            [],
        )
        machine.registers.update(ecx=0x10BDC620, esp=0x8000)
        machine.memory.update({0x8000: 0x200000, 0x8004: 1})
        call = instruction(b"\xe8\x00\x00\x00\x00", 0x106177A0)
        self.assertEqual(machine.step(call), 0x106177A5)
        self.assertEqual(machine.calls, [["checkLoadingResource", 0x200000, 1]])
        self.assertEqual(machine.registers["esp"], 0x8008)
        self.assertEqual(machine.registers["eax"], 128)
        machine.registers["esi"] = 0x200000
        self.assertEqual(machine.read("byte ptr [esi + 0x678]"), 2)

    def test_unknown_call_does_not_become_a_successful_helper(self):
        machine = TraceMachine(row(0), [])
        with self.assertRaises(AssertionError):
            machine.step(instruction(b"\xe8\x00\x00\x00\x00", 0x123400))

    def test_loader_requires_the_qualified_receiver(self):
        machine = TraceMachine(row(0), [])
        machine.registers.update(ecx=123, esp=0x8000)
        machine.memory.update({0x8000: 0x200000, 0x8004: 1})
        with self.assertRaises(AssertionError):
            machine.step(instruction(b"\xe8\x00\x00\x00\x00", 0x106177A0))

    def test_class_call_consumes_only_its_argument_and_skips_erased_site(self):
        data = row(0)
        data["answers"]["isPawn"] = 0x80000000
        machine = TraceMachine(data, [])
        machine.registers.update(ecx=0x300000, esp=0x8000)
        machine.memory[0x8000] = 0x10DAF7D8
        self.assertEqual(machine.step(instruction(b"\x90", 0x106177CB)), 0x106177D1)
        self.assertEqual(machine.calls, [["isPawn", 0x300000]])
        self.assertEqual(machine.registers["esp"], 0x8004)
        self.assertEqual(machine.registers["eax"], 0x80000000)


if __name__ == "__main__":
    unittest.main()
