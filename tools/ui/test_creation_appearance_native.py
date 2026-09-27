"""Source-free Elbera Tools creation option decoder regression tests."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parents[1] / 'dat')]
from check_creation_appearance_native import option_lists, sex_options
from extract_charcreate import appearance_matrix


def instructions(*rows):
    return [SimpleNamespace(address=i, size=1, mnemonic=m, op_str=o) for i, (m, o) in enumerate(rows)]


class CreationOptions(unittest.TestCase):
    def test_list_decoder_preserves_source_order_and_duplicate_labels(self):
        rows = instructions(('mov', 'ecx, dword ptr [esi + 0x1dc]'), ('push', '91'), ('call', '0x900'),
                            ('mov', 'ecx, dword ptr [esi + 0x1dc]'), ('push', '91'), ('call', '0x900'))
        self.assertEqual(option_lists(rows, 0x900), {0x1dc: [91, 91]})
        with self.assertRaises(ValueError): option_lists(rows[:-1], 0x900)
        with self.assertRaises(ValueError): option_lists(rows, 0x901)

    def test_branch_executes_selected_path_and_models_clear_before_append(self):
        rows = instructions(
            ('mov', 'ecx, dword ptr [esi + 0x1d8]'), ('push', '8'), ('call', '0x900'),
            ('mov', 'eax, dword ptr [esi + 0x1f0]'), ('cmp', 'eax, 2'), ('jne', '13'),
            ('mov', 'edx, dword ptr [ecx]'), ('mov', 'eax, dword ptr [edx + 0x174]'), ('call', 'eax'),
            ('push', '42'), ('call', '0x900'), ('jmp', '15'), ('push', '999'),
            ('push', '17'), ('call', '0x900'))
        self.assertEqual(sex_options(rows, 0, 15, 2, 0, 0, add_address=0x900), [42])
        self.assertEqual(sex_options(rows, 0, 15, 1, 0, 0, add_address=0x900), [8, 17])

    def test_interpreter_rejects_external_call_escaped_branch_and_uninitialized_flags(self):
        for rows in [instructions(('call', '0x800')), instructions(('jmp', '99')),
                     instructions(('je', '1')), instructions(('mov', 'eax, dword ptr [esi + 0x999]'))]:
            with self.assertRaises(ValueError): sex_options(rows, 0, 1, 0, 0, 0, add_address=0x900)

    def data(self):
        record = {'face_icon': '', 'face_mesh': [], 'face_texture': [], 'body_mesh': [], 'body_texture': []}
        proof = {'status': 'verified-options', 'combinations': [
            {'race': r, 'occupation': c, 'sex': s, 'styleSysStringIds': [10, 20],
             'colorSysStringIds': [30], 'faceSysStringIds': [40]}
            for r in range(5) for c in range(1 if r == 4 else 2) for s in range(2)]}
        return [record] * 14, [[(-1, 7), (9, -1)] + [(-1, -1)] * 13 for _ in range(15)], proof, {
            10: 'first', 20: 'second', 30: 'color', 40: 'face'}

    def test_missing_individual_part_does_not_remove_offered_style_or_invent_color(self):
        appearances, _ = appearance_matrix(*self.data())
        for race in appearances.values():
            for sex in race.values():
                for row in sex.values():
                    self.assertEqual(row['hairStyles'], 2)
                    self.assertEqual(row['hairParts'], [{'style': 0, 'hair1Index': -1, 'hair2Index': 7},
                                                        {'style': 1, 'hair1Index': 9, 'hair2Index': -1}])
                    self.assertEqual(row['hairColors'], [{'index': 0, 'sysStringId': 30, 'name': 'color'}])
                    self.assertNotIn('paintedOnly', row)

    def test_join_refuses_unverified_proof_missing_label_duplicate_domain_or_invalid_part(self):
        for mutation in ('proof', 'label', 'duplicate', 'part'):
            args = self.data()
            if mutation == 'proof': args[2]['status'] = 'unknown'
            elif mutation == 'label': del args[3][30]
            elif mutation == 'duplicate': args[2]['combinations'].append(args[2]['combinations'][0])
            else: args[1][0][0] = (-2, 7)
            with self.assertRaises((ValueError, KeyError)): appearance_matrix(*args)


if __name__ == '__main__': unittest.main()
