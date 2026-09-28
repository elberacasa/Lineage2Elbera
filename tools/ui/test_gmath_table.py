"""Portable, authored arithmetic fixtures; no client bytes or sine coefficients.

These protect the bounded interpreter's instruction semantics. The independent
source qualification and complete constructor walk require private inputs.
"""

import math
from types import SimpleNamespace
import unittest

from recover_gmath_table import SineMachine, START, recover


def program(instructions, constants=None):
    constants = constants or {}

    def read(address, width):
        value = constants[address]
        if len(value) != width:
            raise AssertionError("fixture operand width mismatch")
        return value

    rows = {
        START + i: SimpleNamespace(address=START + i, size=1, mnemonic=op, op_str=args)
        for i, (op, args) in enumerate(instructions)
    }
    return SimpleNamespace(rows=rows, read=read)


def result_tail(register="xmm0"):
    return [
        ("movlpd", f"qword ptr [esp + 4], {register}"),
        ("fld", "qword ptr [esp + 4]"),
        ("ret", ""),
    ]


class SineInstructionTests(unittest.TestCase):
    def test_scalar_and_register_moves_preserve_high_lane(self):
        machine = SineMachine(
            program(
                [
                    ("movsd", "xmm1, xmm0"),
                    ("addsd", "xmm1, xmm0"),
                    ("unpckhpd", "xmm1, xmm1"),
                ]
                + result_tail("xmm1")
            ),
            2.0,
        )
        machine.xmm["xmm1"] = [17.0, 3.0]
        self.assertEqual(machine.run(), 3.0)

    def test_packed_operations_keep_both_lanes(self):
        machine = SineMachine(
            program(
                [
                    ("mulpd", "xmm1, xmm2"),
                    ("subpd", "xmm1, xmm3"),
                    ("unpckhpd", "xmm1, xmm1"),
                ]
                + result_tail("xmm1")
            ),
            0.0,
        )
        machine.xmm.update(xmm1=[2.0, 3.0], xmm2=[5.0, 7.0], xmm3=[1.0, 2.0])
        self.assertEqual(machine.run(), 19.0)

    def test_operations_round_separately_without_fused_multiply_add(self):
        machine = SineMachine(
            program(
                [
                    ("mulsd", "xmm0, xmm1"),
                    ("subsd", "xmm0, xmm2"),
                ]
                + result_tail()
            ),
            1.0 + 2.0**-27,
        )
        machine.xmm.update(xmm1=[1.0 - 2.0**-27, None], xmm2=[1.0, None])
        # Exact product is 1 - 2**-54: its separate Float64 store rounds to 1.
        self.assertEqual(machine.run(), 0.0)

    def test_integer_conversion_uses_ties_to_even(self):
        for value, expected in [(0.5, 0), (1.5, 2), (2.5, 2), (-1.5, -2), (-2.5, -2)]:
            with self.subTest(value=value):
                machine = SineMachine(
                    program([("cvtsd2si", "edx, xmm0")] + result_tail()), value
                )
                machine.run()
                self.assertEqual(machine.gpr["edx"], expected & 0xFFFFFFFF)

    def test_zero_sign_survives_store_and_return(self):
        value = SineMachine(program(result_tail()), -0.0).run()
        self.assertEqual(math.copysign(1.0, value), -1.0)

    def test_unknown_lane_cannot_become_a_successful_result(self):
        machine = SineMachine(
            program(
                [
                    ("movsd", "xmm1, xmm0"),
                    ("unpckhpd", "xmm1, xmm1"),
                ]
                + result_tail("xmm1")
            ),
            1.0,
        )
        with self.assertRaises(AssertionError):
            machine.run()

    def test_missing_source_coefficient_is_not_zero(self):
        machine = SineMachine(
            program(
                [
                    ("mulsd", "xmm0, qword ptr [0x1000]"),
                ]
                + result_tail()
            ),
            1.0,
        )
        with self.assertRaises(KeyError):
            machine.run()

    def test_signed_and_unsigned_compare_flags_are_distinct(self):
        machine = SineMachine(program(result_tail()), 0.0)
        machine.compare(0x8000, 1, 16)
        self.assertFalse(machine.c)
        self.assertFalse(machine.s)
        self.assertTrue(machine.o)
        self.assertNotEqual(machine.s, machine.o)
        machine.compare(0xFFFF, 0, 16)
        self.assertFalse(machine.c)
        self.assertTrue(machine.s)
        self.assertFalse(machine.o)

    def test_unqualified_profile_rejected_before_source_access(self):
        for profile in [None, "host-sin", "source-x87-PC64"]:
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                recover(None, None, profile)


if __name__ == "__main__":
    unittest.main()
