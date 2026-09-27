"""Elbera Tools synthetic DAT boundary cases; no private files required."""
import struct
import unittest
from mine_henna import parse, TRAILER

def row(symbol=1, text1=b'a', text2=b'b'):
    string = lambda s: bytes([len(s)+1]) + s + b'\0'
    return struct.pack('<II', symbol, 20) + b'\x02N\0\x02I\0' + string(text1) + string(text2)
def table(*rows):
    return struct.pack('<I',len(rows))+b''.join(rows)+TRAILER

class HennaRecords(unittest.TestCase):
    def test_distinct_source_text_fields_and_byte_spans(self):
        value=parse(table(row(text1=b'inventory',text2=b'additional')))[0]
        self.assertEqual((value['text1'],value['text2']),('inventory','additional'))
        self.assertEqual(value['sourceOffset'],4)
        self.assertEqual(value['sourceLength'],len(row(text1=b'inventory',text2=b'additional')))
    def test_every_truncated_record_rejects(self):
        payload=table(row())[:-len(TRAILER)]
        for end in range(len(payload)):
            with self.subTest(end=end), self.assertRaises((ValueError,EOFError)):
                parse(payload[:end]+TRAILER)
    def test_duplicate_and_zero_ids_reject(self):
        for data in [table(row(),row()),table(row(0))]:
            with self.assertRaises(ValueError): parse(data)
    def test_missing_trailer_extra_payload_and_missing_terminator_reject(self):
        for data in [table(row())[:-1],table(row())[:-len(TRAILER)]+b'x'+TRAILER,
                     table(row())[:-len(TRAILER)-1]+b'x'+TRAILER]:
            with self.assertRaises(ValueError): parse(data)
    def test_unicode_is_preserved(self):
        raw=struct.pack('<II',1,20)+b'\x82'+ '界\0'.encode('utf-16-le')+b'\0\0\0'
        self.assertEqual(parse(table(raw))[0]['name'],'界')

if __name__=='__main__': unittest.main()
