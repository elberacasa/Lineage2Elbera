"""Elbera Tools: portable BSP evidence boundaries; no original images required.

These authored fixtures test verifier rejection/store behavior, not original
map geometry or a native-client run. The source-backed differential is the
separate check_bsp_camera_native.py command with owned private inputs.
"""
import math
import struct
import unittest
from types import SimpleNamespace

from check_bsp_camera_native import (
    BSP_BOUND_IMPORTS, bound_bsp_import, decode_sweep_hull_fixture, run_sweep_slice,
)
from check_hair_attachment_native import compare_call_block


def word(value):
    return struct.unpack('<i', struct.pack('<f', value))[0]


class BoundCallTests(unittest.TestCase):
    def test_only_declared_exact_six_nop_sites_are_admitted(self):
        for site, (key, _) in BSP_BOUND_IMPORTS.items():
            self.assertEqual(bound_bsp_import(site, b'\x90'*6), key)
            for wrong in (b'\x90'*5, b'\x90'*7, b'\x90'*5+b'\xcc'):
                with self.assertRaises(ValueError):
                    bound_bsp_import(site, wrong)
        with self.assertRaises(ValueError):
            bound_bsp_import(0x1074897d, b'\x90'*6)

    def test_declared_binding_does_not_mask_other_bytes_or_call_targets(self):
        # Synthetic relocated block, using a real declared semantic contract.
        symbol = BSP_BOUND_IMPORTS[0x1074897c][1]
        a, b, target, iat = 0x1000, 0x2000, 0x3000, 0x4000
        owned = b'\x90'*6 + b'\xe8' + struct.pack('<i', target-(a+11)) + b'\xc3'
        other = b'\xff\x15' + struct.pack('<I', iat) + b'\xe8' + struct.pack('<i', target-(b+11)) + b'\xc3'
        args = dict(owned_va=a, candidate_va=b, sites=[(0, ('core.dll', symbol))],
                    direct_calls=[6], imports={iat: ('Core.dll', symbol)})
        result = compare_call_block(owned, other, **args)
        self.assertEqual(result['sameDirectCallTargets'], 1)
        self.assertEqual(result['imports'][0]['symbol'], symbol)
        for wrong in (other[:-1]+b'\xcc', other[:7]+struct.pack('<i', target+1-(b+11))+other[11:]):
            with self.assertRaises(ValueError):
                compare_call_block(owned, wrong, **args)
        with self.assertRaises(ValueError):
            compare_call_block(owned, other, **{**args, 'imports': {iat: ('Core.dll', '?Normalize@FVector@@QAEHXZ')}})


class HullFramingTests(unittest.TestCase):
    def source(self, references=(0,)):
        return {'nodes': [{'plane': [1., -0., 0., -0.]}],
                'leafHulls': [*references, -1, *map(word, [-1.,-2.,-3.,1.,2.,3.])]}

    def test_oriented_reference_retains_order_duplicates_and_signed_zero(self):
        source = self.source((0x40000000, 0, 0x40000000))
        refs, planes, bounds = decode_sweep_hull_fixture(source, 0)
        self.assertEqual(refs, [0x40000000,0,0x40000000])
        self.assertEqual(list(map(word, planes[0])), list(map(word, [-1.,0.,-0.,0.])))
        self.assertEqual(list(map(word, planes[1])), list(map(word, [1.,-0.,0.,-0.])))
        self.assertEqual(bounds, [-1.,-2.,-3.,1.,2.,3.])
        self.assertEqual(source['nodes'][0]['plane'][0], 1.)

    def test_empty_and_exact_64_plane_records_are_distinct_valid_frames(self):
        self.assertEqual(decode_sweep_hull_fixture(self.source(()), 0)[0], [])
        self.assertEqual(len(decode_sweep_hull_fixture(self.source([0]*64), 0)[0]), 64)
        with self.assertRaises(ValueError):
            decode_sweep_hull_fixture(self.source([0]*65), 0)

    def test_bad_offsets_terminator_reference_and_bounds_fail_closed(self):
        for offset in (-1, True, 0.0, 999):
            with self.assertRaises(ValueError):
                decode_sweep_hull_fixture(self.source(), offset)
        bad = [self.source((1,)), self.source((-2,)), self.source((True,))]
        bad.append({**self.source(), 'leafHulls': [0,-1.0,0,0,0,0,0,0]})
        bad.append({**self.source(), 'leafHulls': [0]})
        bad.append({**self.source(), 'leafHulls': [0,-1,0]})
        bad.append({**self.source(), 'leafHulls': [0,-1,word(float('inf')),0,0,0,0,0]})
        bad.append({**self.source(), 'leafHulls': [0,-1,word(2.),0,0,word(1.),0,0]})
        bad.append({**self.source(), 'leafHulls': [0,-1,1<<31,0,0,0,0,0]})
        for source in bad:
            with self.assertRaises(ValueError):
                decode_sweep_hull_fixture(source, 0)


class StoreMachine:
    """Minimal operand fixture for store/comparison tests, not a CPU emulator."""
    def __init__(self, stack, value=0.):
        self.stack, self.memory, self.trace = list(stack), {}, []
        self.value, self.status = value, None

    def address(self, _):
        return 0x100

    def read(self, operand):
        if operand.startswith('st('):
            return self.stack[int(operand[3:-1])]
        return self.value

    def write(self, operand, value, floating=False):
        if operand.startswith('st('):
            self.stack[int(operand[3:-1])] = value
        else:
            self.memory[self.address(operand)] = struct.unpack('<f', struct.pack('<f', value))[0] if floating else value


def instruction_case(op, operands, machine):
    row = SimpleNamespace(address=0, size=1, mnemonic=op, op_str=operands)
    image = SimpleNamespace(data=b'\0', offset=lambda x: x,
        dis=SimpleNamespace(disasm=lambda *_: iter([row])))
    run_sweep_slice(image, machine, 0, 1, max_steps=2)
    return machine


class SweepInstructionBoundaryTests(unittest.TestCase):
    def test_qword_store_retains_binary64_before_sqrt(self):
        value = 1. + 2**-30
        qword = instruction_case('fstp', 'qword ptr [esp]', StoreMachine([value]))
        dword = instruction_case('fstp', 'dword ptr [esp]', StoreMachine([value]))
        self.assertEqual(qword.memory[0x100], value)
        self.assertEqual(dword.memory[0x100], 1.)
        self.assertEqual(qword.stack, [])

    def test_masked_float32_overflow_and_zero_sign_are_preserved(self):
        for value in (1e40, -1e40):
            machine = instruction_case('fstp', 'dword ptr [esp]', StoreMachine([value]))
            self.assertTrue(math.isinf(machine.memory[0x100]))
            self.assertEqual(math.copysign(1, machine.memory[0x100]), math.copysign(1, value))
        for kind in ('dword', 'qword'):
            machine = instruction_case('fstp', kind+' ptr [esp]', StoreMachine([-0.]))
            self.assertEqual(math.copysign(1, machine.memory[0x100]), -1)

    def test_infinite_comparison_is_supported_but_nan_is_not(self):
        machine = instruction_case('fcom', 'dword ptr [esp]', StoreMachine([math.inf], math.inf))
        self.assertEqual(machine.status, 0x4000)
        machine = instruction_case('fcomp', 'dword ptr [esp]', StoreMachine([1.], math.inf))
        self.assertEqual(machine.status, 0x100)
        self.assertEqual(machine.stack, [])
        for a,b in [(math.nan,1.),(1.,math.nan)]:
            with self.assertRaises(AssertionError):
                instruction_case('fcom', 'dword ptr [esp]', StoreMachine([a], b))

    def test_reverse_divide_by_zero_has_native_masked_sign(self):
        for zero in (0., -0.):
            machine = instruction_case('fdivr', 'dword ptr [esp]', StoreMachine([zero], 4.))
            self.assertTrue(math.isinf(machine.stack[0]))
            self.assertEqual(math.copysign(1, machine.stack[0]), math.copysign(1, zero))

    def test_unknown_ops_calls_and_unbound_nops_are_not_silent(self):
        for op,args in [('nop',''),('call','0x1234'),('cpuid','')]:
            with self.assertRaises(AssertionError):
                instruction_case(op, args, StoreMachine([]))


if __name__ == '__main__':
    unittest.main()
