"""Portable Elbera NPC evidence validation tests; no original inputs required."""
from pathlib import Path
import subprocess
import sys
import unittest

from check_npc_animation_native import absent_zero_item_ids, field_argument_index


class NativeNpcInputs(unittest.TestCase):
    def test_two_strings_reserve_two_extra_arguments(self):
        fmt = 'ddddddddddddddddddffffdddcccccSSddd'
        self.assertEqual(field_argument_index(fmt, 29), 29)
        self.assertEqual(field_argument_index(fmt, 30), 30)
        self.assertEqual(field_argument_index(fmt, 31), 32)
        self.assertEqual([field_argument_index(fmt, i) for i in (32, 33, 34)], [34, 35, 36])

    def test_extension_mixed_width_arguments_are_not_byte_offsets(self):
        fmt = 'dddddccffdd'
        self.assertEqual([field_argument_index(fmt, i) for i in range(len(fmt))], list(range(11)))

    def test_invalid_format_or_ordinal_is_not_silently_coerced(self):
        for fmt, field in [('ddq', 1), ('dd', -1), ('dd', 2), ('dd', True), ('dd', 1.0), ('', 0)]:
            with self.subTest(fmt=fmt, field=field), self.assertRaises(ValueError):
                field_argument_index(fmt, field)

    def test_source_key_zero_absence_uses_all_groups(self):
        self.assertEqual(absent_zero_item_ids({'weapon':[1,8], 'armor':[21], 'etc':[17,24]}), {
            'weapon':{'count':2,'minimum':1}, 'armor':{'count':1,'minimum':21},
            'etc':{'count':2,'minimum':17}})
        with self.assertRaises(ValueError):
            absent_zero_item_ids({'weapon':[1], 'armor':[21]})

    def test_zero_is_ordinary_key_and_cannot_be_invented_as_sentinel(self):
        for group in ('weapon', 'armor', 'etc'):
            data={'weapon':[1],'armor':[21],'etc':[17]}
            data[group].append(0)
            with self.subTest(group=group), self.assertRaises(ValueError):
                absent_zero_item_ids(data)

    def test_duplicate_or_invalid_ids_reject_unknown_overwrite_semantics(self):
        for value in (1, True, -1, 2**32, '2'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                absent_zero_item_ids({'weapon':[1],'armor':[21],'etc':[value]})

    def test_empty_complete_input_does_not_claim_original_tables_loaded(self):
        with self.assertRaises(ValueError):
            absent_zero_item_ids({'weapon':[],'armor':[],'etc':[]})

    def test_cli_help_does_not_load_capstone_or_originals(self):
        run=subprocess.run([sys.executable,'-S',str(Path(__file__).with_name('check_npc_animation_native.py')),'--help'],
                           capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr)
        self.assertIn('--comparison-engine',run.stdout)
        self.assertIn('--comparison-core',run.stdout)


if __name__ == '__main__':
    unittest.main()
