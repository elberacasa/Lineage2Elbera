"""Portable Elbera NPC evidence validation tests; no original inputs required."""
from pathlib import Path
import subprocess
import struct
import sys
import unittest

from check_npc_animation_native import (
    absent_zero_item_ids, enter_event_lookup, field_argument_index, npc_record_spans, parse_enter_event_table,
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


def npc_record(identifier, final_word=0, speed=1.25, decoration=True):
    """Entirely synthetic NPC row with nonempty arrays and distinct tail words."""
    row = {'npc_id':identifier, 'class_name':'Test.Actor', 'mesh_name':'Test.Mesh',
        'textures':['Test.Texture'], 'textures_second':[], 'property_list':[17,29],
        'npc_speed':speed, 'unk_1':['opaque'], 'attack_sound':['Test.Sound'],
        'defense_sound':[], 'damage_sound':[],
        'deco_effect':[{'effect':'Test.Effect','scale':.5}] if decoration else [],
        'unk_2':[41], 'attack_effect':'Test.Attack', 'unk_3':73,
        'sound_vol':.25, 'sound_radius':64.5, 'sound_random':30.0,
        'quest_be':91, 'class_lim':final_word}
    strings = lambda values: struct.pack('<I',len(values))+b''.join(unicode_text(v) for v in values)
    integers = lambda values: bytes([len(values)])+b''.join(struct.pack('<I',v) for v in values)
    data = struct.pack('<I',identifier)+unicode_text(row['class_name'])+unicode_text(row['mesh_name'])
    data += strings(row['textures'])+strings(row['textures_second'])+integers(row['property_list'])
    data += struct.pack('<f',speed)
    for key in ('unk_1','attack_sound','defense_sound','damage_sound'):
        data += strings(row[key])
    data += struct.pack('<I',len(row['deco_effect']))
    for item in row['deco_effect']:
        data += unicode_text(item['effect'])+struct.pack('<f',item['scale'])
    data += integers(row['unk_2'])+unicode_text(row['attack_effect'])
    data += struct.pack('<IfffII',row['unk_3'],row['sound_vol'],row['sound_radius'],row['sound_random'],row['quest_be'],final_word)
    return data,row


class NativeNpcRecordIdentity(unittest.TestCase):
    def test_independent_framing_keeps_separate_ids_and_final_words(self):
        first,a = npc_record(10,0)
        second,b = npc_record(20,1)
        spans = npc_record_spans(table(first,second),[a,b],[10,20])
        self.assertEqual(spans['10']['span'],[4,4+len(first)])
        self.assertEqual(spans['20']['span'],[4+len(first),4+len(first)+len(second)])
        self.assertEqual(spans['10']['finalWordOffset'],len(first))
        self.assertEqual([spans[str(key)]['finalWord'] for key in (10,20)],[0,1])
        self.assertEqual(spans['10']['decoCount'],1)
        self.assertNotEqual(spans['10']['SHA256'],spans['20']['SHA256'])
        self.assertEqual(spans['10']['sharedPayloadSHA256'],spans['20']['sharedPayloadSHA256'])

    def test_shared_payload_equality_is_byte_exact_including_float_sign(self):
        first,a = npc_record(10,speed=0.0)
        second,b = npc_record(20,speed=-0.0)
        spans = npc_record_spans(table(first,second),[a,b],[10,20])
        self.assertNotEqual(spans['10']['sharedPayloadSHA256'],spans['20']['sharedPayloadSHA256'])

    def test_every_truncated_record_prefix_rejects_with_trailer(self):
        record,row = npc_record(10)
        for end in range(len(record)):
            with self.subTest(end=end),self.assertRaises(ValueError):
                npc_record_spans(table(record[:end]),[row],[10])

    def test_identity_requires_exact_unique_rows_and_complete_consumption(self):
        record,row = npc_record(10)
        changed = {**row,'sound_random':31.0}
        for data,rows,ids in [
            (table(record),[changed],[10]), (table(record),[row,row],[10]),
            (table(record,record),[row,row],[10]), (table(record),[row],[20]),
            (table(record),[row],[10,10]), (table(record),[row],[True]),
            (table(record),[row],[]), (table(record)[:-len(TRAILER)]+b'x'+TRAILER,[row],[10]),
            (record,[row],[10]), (None,[row],[10]),
        ]:
            with self.subTest(ids=ids),self.assertRaises(ValueError):
                npc_record_spans(data,rows,ids)

    def test_negative_compact_and_oversized_string_array_counts_reject(self):
        record,row = npc_record(10)
        textures_at = 4+len(unicode_text(row['class_name']))+len(unicode_text(row['mesh_name']))
        property_count_at = textures_at+4+len(unicode_text(row['textures'][0]))+4
        oversized = record[:textures_at]+struct.pack('<I',0xffffffff)+record[textures_at+4:]
        negative = record[:property_count_at]+b'\x81'+record[property_count_at+1:]
        invalid_string = record[:4]+struct.pack('<i',-2)+record[8:]
        for bad in (oversized,negative,invalid_string):
            with self.subTest(record=bad),self.assertRaises(ValueError):
                npc_record_spans(table(bad),[row],[10])


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
