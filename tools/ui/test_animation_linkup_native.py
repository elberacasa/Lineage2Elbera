"""Elbera Tools portable animation linkup fixtures; authored names only."""
from pathlib import Path
import subprocess
import sys
import unittest

from check_animation_linkup_native import (decoded_name_linkup,
                                           first_interned_linkup, synthetic_cases)


class AnimationLinkupTests(unittest.TestCase):
    def test_portable_import_needs_no_originals_or_site_packages(self):
        code = ('import sys; sys.path.insert(0,sys.argv[1]); '
                'from check_animation_linkup_native import decoded_name_linkup; '
                'assert decoded_name_linkup(["A"],["B","A"]) == [1]; '
                'assert "capstone" not in sys.modules; '
                'assert "check_tutorial_quest_native" not in sys.modules')
        subprocess.run([sys.executable, '-S', '-c', code, str(Path(__file__).resolve().parent)],
                       cwd='/', check=True, timeout=10)

    def test_animation_order_decides_first_duplicate(self):
        self.assertEqual(first_interned_linkup([9,3,9,7], [3,9,9]), [1,0,1,-1])
        self.assertEqual(first_interned_linkup([9,3,9,7], [9,3,9]), [0,1,0,-1])

    def test_missing_does_not_borrow_a_positional_or_parent_match(self):
        # A deliberately plausible index 1 is still unrelated to token 8.
        self.assertEqual(first_interned_linkup([7,8,9], [7,42,9]), [0,-1,2])
        self.assertEqual(decoded_name_linkup(['Root','Right','Child'],
                                             ['Root','Left','Child']), [0,-1,2])

    def test_decoded_adapter_keeps_punctuation_and_reuses_first_name(self):
        self.assertEqual(decoded_name_linkup(['Arm_A','Arm A','Arm_A','Absent'],
                                             ['Arm A','Arm_A','Arm_A']), [1,0,1,-1])

    def test_different_casefold_spellings_are_not_silently_unified(self):
        for mesh, animation in [(['Bone'], ['bone']), (['Bone','bone'], []),
                                ([], ['Straße','STRASSE'])]:
            with self.subTest(mesh=mesh, animation=animation), self.assertRaises(ValueError):
                decoded_name_linkup(mesh, animation)
        self.assertEqual(decoded_name_linkup(['Bone','Bone'], ['Bone','Bone']), [0,0])

    def test_empty_inputs_and_unsigned_name_endpoints(self):
        self.assertEqual(first_interned_linkup([], [1]), [])
        self.assertEqual(first_interned_linkup([0,0xffffffff], []), [-1,-1])
        self.assertEqual(first_interned_linkup([0xffffffff,0], [0,0xffffffff]), [1,0])
        self.assertEqual(decoded_name_linkup([], []), [])

    def test_rejects_malformed_identifiers_instead_of_coercing(self):
        for bad in ([True], [-1], [2**32], [1.0], ['1'], None, '123'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                first_interned_linkup(bad, [])
        for bad in ([''], ['a\0b'], [7], [None], 'Bone', None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                decoded_name_linkup([], bad)

    def test_input_and_result_ownership(self):
        mesh, animation = [2,1,2], [1,2]
        result = first_interned_linkup(mesh, animation)
        result[0] = 99
        self.assertEqual(mesh, [2,1,2])
        self.assertEqual(animation, [1,2])
        self.assertEqual(first_interned_linkup(tuple(mesh), tuple(animation)), [1,0,1])

    def test_authored_corpus_against_independent_linear_search(self):
        cases = synthetic_cases()
        self.assertEqual(cases, synthetic_cases())
        self.assertEqual(len(cases), 105)
        for mesh, animation in cases:
            expected = [next((i for i,n in enumerate(animation) if n==name), -1) for name in mesh]
            self.assertEqual(first_interned_linkup(mesh, animation), expected)


if __name__ == '__main__':
    unittest.main()
