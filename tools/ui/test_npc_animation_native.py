"""Portable Elbera NPC evidence validation tests; no original inputs required."""
from pathlib import Path
import subprocess
import struct
import sys
import unittest

from check_npc_animation_native import (
    absent_zero_item_ids, enter_event_lookup, field_argument_index, parse_enter_event_table,
)


TRAILER=b'\x0cSafePackage\0'


def ascf(text, wide=False):
    """Small synthetic string encoder, independent of the production reader."""
    if not text:
        return b'\0'
    raw=text.encode('utf-16-le' if wide else 'cp1252')
    units=len(raw)//(2 if wide else 1)+1
    assert units<64
    return bytes([units|(0x80 if wide else 0)])+raw+(b'\0\0' if wide else b'\0')


def unicode_text(text):
    raw=text.encode('utf-16-le')
    return struct.pack('<i',len(raw))+raw


def event(identifier, spawn_type=1, text0='', sound='', effect='', animation='', wide=False):
    return (struct.pack('<I',identifier)+ascf(text0,wide)+ascf(sound,wide)
            +struct.pack('<ffII',.125,64.5,7,spawn_type)+unicode_text(effect)+unicode_text(animation))


def table(*records):
    return struct.pack('<I',len(records))+b''.join(records)+TRAILER


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


class NativeNpcEnterEvents(unittest.TestCase):
    def test_serializer_keeps_both_string_encodings_and_uninterpreted_fields(self):
        rows=parse_enter_event_table(table(
            event(0,text0='label',sound='Pkg.Group.Sound',effect='Fx.Symbol',animation='Idle'),
            event(0xffffffff,2,text0='λ',sound='音',wide=True)))
        self.assertEqual(rows[0],{'id':0,'text0':'label','sound':'Pkg.Group.Sound',
            'soundVolume':.125,'soundRadius':64.5,'isrise':7,'spawn_type':1,
            'effect':'Fx.Symbol','animation':'Idle'})
        self.assertEqual(rows[1]['id'],0xffffffff)
        self.assertEqual(rows[1]['text0'],'λ')
        self.assertEqual(rows[1]['sound'],'音')
        self.assertEqual(rows[1]['spawn_type'],2)

    def test_empty_framed_table_is_distinct_from_missing_input(self):
        self.assertEqual(parse_enter_event_table(table()),[])
        for data in (b'',b'\0'*4,None,bytearray(table())):
            with self.subTest(data=data),self.assertRaises(ValueError):
                parse_enter_event_table(data)

    def test_every_truncated_prefix_fails_even_with_a_valid_trailer(self):
        data=table(event(4,text0='text',effect='effect',animation='wait'))
        payload=data[:-len(TRAILER)]
        for end in range(len(payload)):
            with self.subTest(end=end),self.assertRaises(ValueError):
                parse_enter_event_table(payload[:end]+TRAILER)

    def test_exact_count_eof_and_duplicate_ids_are_required(self):
        for data in (table(event(4),event(4)),
                     struct.pack('<I',2)+event(4)+TRAILER,
                     table(event(4))[:-len(TRAILER)]+b'junk'+TRAILER,
                     struct.pack('<I',0xffffffff)+event(4)+TRAILER):
            with self.subTest(data=data),self.assertRaises(ValueError):
                parse_enter_event_table(data)

    def test_string_boundaries_are_not_silently_repaired(self):
        valid=bytearray(event(4,text0='abc'))
        valid[8]=ord('x')  # Replace the ASCF terminator after id/length/abc.
        invalid_unicode=event(4)[:-8]+struct.pack('<i',1)+b'x'+struct.pack('<i',0)
        negative_unicode=event(4)[:-8]+struct.pack('<i',-2)+b'xx'+struct.pack('<i',0)
        for record in (bytes(valid),invalid_unicode,negative_unicode):
            with self.subTest(record=record),self.assertRaises(ValueError):
                parse_enter_event_table(table(record))

    def test_exact_lookup_never_substitutes_id_zero_for_a_miss(self):
        rows=parse_enter_event_table(table(event(0),event(8),event(16,0)))
        self.assertIs(enter_event_lookup(rows,0),rows[0])
        self.assertIs(enter_event_lookup(rows,8),rows[1])
        self.assertIsNone(enter_event_lookup(rows,16))  # Explicit disabled source row.
        self.assertIsNone(enter_event_lookup(rows,24))  # Missing colliding key.
        self.assertIsNone(enter_event_lookup([],8))

    def test_lookup_requires_an_exact_dword_not_a_coerced_key(self):
        rows=parse_enter_event_table(table(event(1)))
        for key in (True,1.0,'1',-1,2**32,None):
            with self.subTest(key=key),self.assertRaises(ValueError):
                enter_event_lookup(rows,key)


if __name__ == '__main__':
    unittest.main()
