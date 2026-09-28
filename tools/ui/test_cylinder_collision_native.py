"""Portable evidence-boundary tests, synthetic inputs only; no original client.

Actual native arithmetic/runtime comparison requires the separately documented
private Engine/Core inputs and check_cylinder_collision_native.py.
"""
import math
import struct
import unittest
from types import SimpleNamespace

from check_cylinder_collision_native import (
    NAMED, CylinderEvaluator, bound_cylinder_import, differential_cases, result_bits,
)
from check_hair_attachment_native import compare_call_block


class CylinderEvidenceTests(unittest.TestCase):
    def test_only_declared_exact_erased_calls_are_admitted(self):
        for site, (key, _) in NAMED.items():
            self.assertEqual(bound_cylinder_import(site, b'\x90' * 6), key)
            for wrong in (b'\x90' * 5, b'\x90' * 7, b'\x90' * 5 + b'\xcc'):
                with self.assertRaises(ValueError):
                    bound_cylinder_import(site, wrong)
        with self.assertRaises(ValueError):
            bound_cylinder_import(0x10646329, b'\x90' * 6)

    def test_named_comparison_rejects_other_symbol_surroundings_and_relocations(self):
        symbol = NAMED[0x10646328][1]
        owned_va, candidate_va, target, iat = 0x1000, 0x2000, 0x3000, 0x4000
        owned = b'\x90' * 6 + b'\xe8' + struct.pack('<i', target - owned_va - 11) + b'\xc3'
        other = b'\xff\x15' + struct.pack('<I', iat) + b'\xe8' + struct.pack('<i', target - candidate_va - 11) + b'\xc3'
        args = dict(owned_va=owned_va, candidate_va=candidate_va,
                    sites=[(0, ('core.dll', symbol))], direct_calls=[6], imports={iat: ('Core.dll', symbol)})
        self.assertEqual(compare_call_block(owned, other, **args)['sameDirectCallTargets'], 1)
        for wrong in (other[:-1] + b'\xcc', other[:7] + struct.pack('<i', target - candidate_va - 10) + other[11:]):
            with self.assertRaises(ValueError):
                compare_call_block(owned, wrong, **args)
        with self.assertRaises(ValueError):
            compare_call_block(owned, other, **{**args, 'imports': {iat: ('Core.dll', NAMED[0x106464c2][1])}})

    def test_sqrt_adapter_is_an_explicit_finite_boundary(self):
        machine = SimpleNamespace(registers={'esp': 100}, memory={100: 4.}, stack=[7.])
        CylinderEvaluator.sqrt(machine)
        self.assertEqual(machine.stack, [2., 7.])
        for value in (-1., math.inf, math.nan):
            machine.memory[100] = value
            with self.assertRaises(AssertionError):
                CylinderEvaluator.sqrt(machine)

    def test_result_comparison_keeps_miss_fields_and_signed_zero(self):
        value = dict(hit=False, time=1., point=[0., -0., 2.], normal=[-0., 0., 1.],
                     material=None, actor=99, item=42)
        bits = result_bits(value)
        self.assertEqual(bits['point'], [0, 0x80000000, 0x40000000])
        self.assertEqual(bits['normal'], [0x80000000, 0, 0x3f800000])
        self.assertEqual(bits['actor'], 99)
        self.assertEqual(bits['item'], 42)
        self.assertFalse(bits['hit'])
        self.assertTrue(math.copysign(1., value['point'][1]) < 0)

    def test_fixtures_include_exact_touch_unequal_extents_materials_and_null_actor(self):
        cases = differential_cases()
        self.assertEqual(cases, differential_cases())
        self.assertTrue(any(c['extent'][0] != c['extent'][1] for c in cases))
        self.assertTrue(any(c['start'] == c['end'] and c['start'][2] == c['height'] + c['extent'][2] for c in cases))
        self.assertTrue(any(c.get('nullActor') for c in cases))
        self.assertTrue(any(c.get('skins') == [99, 100] for c in cases))
        self.assertTrue(any(c.get('skins') == [0] for c in cases))


if __name__ == '__main__':
    unittest.main()
