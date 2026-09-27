"""Elbera Tools: exact skill-level joins and strict original-table boundaries.

python3 -m unittest discover -s tools/dat -p test_skilltext.py
Synthetic fixtures contain no original skill prose or art.
"""
from pathlib import Path
import struct
import unittest
from unittest.mock import patch

import build_meta
from extract_gamedata import TRAILER, SkillReader, parse_skillgrp, parse_skillname


def compact(value):
    sign, value = (128 if value < 0 else 0), abs(value)
    out = bytearray([sign | (value & 63) | (64 if value > 63 else 0)])
    value >>= 6
    while value:
        out.append((value & 127) | (128 if value > 127 else 0))
        value >>= 7
    return bytes(out)


def ascf(value, wide=False):
    data = value.encode('utf-16-le' if wide else 'cp1252') + (b'\0\0' if wide else b'\0')
    return compact(-len(data) // 2 if wide else len(data)) + data


def ustr(value):
    data = value.encode('utf-16-le')
    return struct.pack('<i', len(data)) + data


def names(level=1):
    return (struct.pack('<II', 7001, level) + ascf('Synthetic café')
            + ascf(f'Original fixture level {level} \\n untouched')
            + ascf('追加', wide=True) + ascf(f'Enchant fixture {level}'))


def group(level=1):
    return (struct.pack('<6IfI', 7001, level, 0, 7 + level, 0xfffffffe, 3, 1.25, 1)
            + ustr('E') + ustr('') + ustr(f'icon.synthetic_{level}')
            + struct.pack('<6I', 0, 0, 0, 2 + level, 0, 0))


def file(*rows):
    return struct.pack('<I', len(rows)) + b''.join(rows) + TRAILER


def rows():
    return parse_skillgrp(file(group(1), group(2))), parse_skillname(file(names(1), names(2)))


class SkillTextTests(unittest.TestCase):
    def test_parse_fields_and_exact_join_preserve_level_text_icon_and_signed_range(self):
        grp, texts = rows()
        output = build_meta.build_skilltext(grp, texts, {'synthetic': True})
        one, two = output['skills']['7001']['1'], output['skills']['7001']['2']
        self.assertEqual(one['desc'], 'Original fixture level 1 \\n untouched')
        self.assertEqual(two['desc'], 'Original fixture level 2 \\n untouched')
        self.assertEqual(two['icon'], 'icons/synthetic_2.png')
        self.assertEqual(two['enchantName'], '追加')
        self.assertEqual(two['enchantDesc'], 'Enchant fixture 2')
        self.assertEqual((two['hp'], two['mp'], two['range']), (4, 9, -2))
        self.assertEqual(output['provenance']['recordCount'], 2)

    def test_incomplete_join_never_borrows_another_levels_text_or_icon(self):
        grp, texts = rows()
        output = build_meta.build_skilltext(grp[:1], texts[1:], {})['skills']['7001']
        self.assertEqual(set(output), {'1', '2'})
        self.assertIsNone(output['1']['desc'])
        self.assertFalse(output['1']['hasText'])
        self.assertIsNone(output['2']['icon'])
        self.assertIsNone(output['2']['mp'])
        self.assertFalse(output['2']['hasIconRecord'])

    def test_duplicates_rejected_in_binary_and_decoded_inputs(self):
        for parser, record in [(parse_skillgrp, group()), (parse_skillname, names())]:
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                parser(file(record, record))
        grp, texts = rows()
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            build_meta.build_skilltext(grp + grp[:1], texts, {})
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            build_meta.build_skilltext(grp, texts + [{**texts[0], 'desc': 'Conflicting fixture'}], {})

    def test_truncated_payload_counts_unknown_tail_and_trailer_fail(self):
        for parser, record in [(parse_skillgrp, group()), (parse_skillname, names())]:
            for data in [file(record)[:-1], file(record[:-1]), file(record + b'\0'),
                         struct.pack('<I', 0xffffffff) + record + TRAILER]:
                with self.subTest(parser=parser.__name__, size=len(data)), self.assertRaises((EOFError, ValueError)):
                    parser(data)

    def test_strings_require_nul_terminators_and_nonnegative_unicode_byte_lengths(self):
        for raw in [b'\x02ab', b'\x82a\0b\0']:
            with self.assertRaises(ValueError):
                SkillReader(raw).ascf()
        for size in [-2, 3]:
            with self.assertRaises(ValueError):
                SkillReader(struct.pack('<i', size) + bytes(4)).ustr()
        self.assertEqual(SkillReader(ascf('世界', True)).ascf(), '世界')

    def test_invalid_keys_and_empty_decoded_tables_fail(self):
        grp, texts = rows()
        for value in [0, -1, True, 1.5, 0x100000000]:
            bad = [{**grp[0], 'skill_level': value}]
            with self.assertRaises(ValueError):
                build_meta.build_skilltext(bad, texts, {})
        with self.assertRaises(ValueError):
            build_meta.build_skilltext([], texts, {})

    def test_id_only_legacy_catalog_behavior_remains_compatible(self):
        grp, texts = rows()
        with patch.object(build_meta, 'load', side_effect=lambda name: grp if name == 'skillgrp.json' else texts):
            row = build_meta.build_skills()['7001']
        self.assertEqual(row['name'], texts[0]['name'])
        self.assertEqual(row['desc'], texts[0]['desc'])
        self.assertEqual(row['icon'], 'icons/synthetic_1.png')
        self.assertEqual(row['levels'], 2)

    @unittest.skipUnless((Path(build_meta.extract_gamedata.SYSTEM_DIR) / 'skillname-e.dat').exists(),
                         'requires an owned original client')
    def test_owned_originals_have_exact_distinct_level_text_and_provenance(self):
        data = build_meta.original_skilltext()
        self.assertEqual(data['provenance']['recordCount'], 29812)
        self.assertEqual(len(data['provenance']['sources']['skillname-e.dat']['sha256']), 64)
        self.assertNotEqual(data['skills']['3']['1']['desc'], data['skills']['3']['2']['desc'])
        self.assertEqual(data['skills']['3']['1']['name'], data['skills']['3']['2']['name'])


if __name__ == '__main__':
    unittest.main()
