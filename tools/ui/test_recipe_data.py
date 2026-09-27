"""Elbera Tools portable recipe DAT cases. Synthetic values, no private assets."""
import hashlib
import struct
import unittest
from mine_recipes import parse, TRAILER

def row(index=1, name=b'synthetic', materials=((20, 3), (30, 4))):
    return bytes([len(name)+1])+name+b'\0'+struct.pack('<8I',index,2,3,4,5,6,7,len(materials))+b''.join(struct.pack('<II',*m) for m in materials)
def table(*rows):
    return struct.pack('<I',len(rows))+b''.join(rows)+TRAILER

class Recipes(unittest.TestCase):
    def test_distinct_ids_order_and_source_spans(self):
        record=parse(table(row()))[0]
        self.assertEqual([record[k] for k in ('index','recipeItemId','level','productId','productCount','mpConsume','successRate')],list(range(1,8)))
        self.assertEqual(record['materials'],[{'itemId':20,'count':3},{'itemId':30,'count':4}])
        self.assertEqual(record['sourceOffset'],4)
        self.assertEqual(record['sourceLength'],len(row()))
        self.assertEqual(record['sourceSHA256'],hashlib.sha256(row()).hexdigest())
    def test_every_truncation_rejected(self):
        raw=table(row())[:-len(TRAILER)]
        for end in range(len(raw)):
            with self.subTest(end=end),self.assertRaises((ValueError,EOFError)):
                parse(raw[:end]+TRAILER)
    def test_duplicate_zero_and_tail_reject(self):
        for raw in [table(row(),row()),table(row(0)),table(row())[:-1],table(row())[:-len(TRAILER)]+b'x'+TRAILER]:
            with self.assertRaises(ValueError): parse(raw)
    def test_declared_counts_cannot_exceed_payload(self):
        for raw in [struct.pack('<I',0xffffffff)+TRAILER,
                    struct.pack('<I',1)+row(materials=())[:-4]+struct.pack('<I',0xffffffff)+TRAILER]:
            with self.assertRaises(ValueError): parse(raw)
    def test_empty_materials_and_unicode_names(self):
        raw=b'\x82'+'界\0'.encode('utf-16-le')+row(materials=())[11:]
        value=parse(table(raw))[0]
        self.assertEqual(value['name'],'界'); self.assertEqual(value['materials'],[])

if __name__=='__main__': unittest.main()
