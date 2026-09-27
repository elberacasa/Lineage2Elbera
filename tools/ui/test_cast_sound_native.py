"""Source-free adversarial tests for the original cast sound evidence tool."""
import struct
import unittest

from check_cast_sound_native import parse_source_rows, phase_layers, select_source_row, random_gate, match_model_records, TRAILER


def ustr(value):
    raw = value.encode('utf-16le')
    return struct.pack('<i', len(raw)) + raw


def fixture():
    out = struct.pack('<III', 1, 73, 2)
    for layer in range(3):
        out += b''.join(ustr('%d-%d' % (layer, phase)) for phase in range(3))
        out += struct.pack('<6f', *(value for phase in range(3) for value in (layer*10+phase, 100+phase)))
    out += b''.join(ustr(str(i)) for i in range(30))
    return out + struct.pack('<2f', 0, 50) + TRAILER


class CastSoundTests(unittest.TestCase):
    def test_model_identity_joins_exact_original_assets_without_spelling_inference(self):
        record = {'body_mesh':['Original.A','Original.B'],'face_mesh':['Original.Face']}
        creation = {'races':[{'id':'fixture','creationAssets':{'gender':{'class':{
            'bodyMeshes':record['body_mesh'],'faceMesh':record['face_mesh']}}}}]}
        keys = {'arbitrary_browser_model':('fixture','gender','class')}
        self.assertEqual(match_model_records([record],creation,keys),{'arbitrary_browser_model':0})
        with self.assertRaisesRegex(ValueError,'ambiguous'):
            match_model_records([record,record],creation,keys)
        with self.assertRaisesRegex(ValueError,'missing'):
            match_model_records([dict(record,body_mesh=['Wrong'])],creation,keys)

    def test_serializer_layers_transpose_to_three_simultaneous_phase_entries(self):
        row = parse_source_rows(fixture())[0]
        self.assertEqual([p['sound'] for p in phase_layers(row,2)], ['0-1','1-1','2-1'])
        self.assertEqual([p['volume'] for p in phase_layers(row,1)], [0,10,20])
        self.assertEqual(row['voices'][1][14], '29')
        self.assertEqual(row['voiceVolume'], 0)
        with self.assertRaises(ValueError): phase_layers(row,0)

    def test_last_exact_first_level_one_preserves_differing_duplicates(self):
        rows = [{'id':7,'level':1,'name':'old1'}, {'id':7,'level':2,'name':'old2'},
                {'id':8,'level':1,'name':'other'}, {'id':7,'level':1,'name':'new1'},
                {'id':7,'level':2,'name':'new2'}]
        self.assertEqual(select_source_row(rows,7,2)['name'],'new2')
        self.assertEqual(select_source_row(rows,7,1)['name'],'new1')
        self.assertEqual(select_source_row(rows,7,999)['name'],'old1')
        self.assertIsNone(select_source_row(rows,9,1))
        self.assertIsNone(select_source_row([rows[1]],7,3))

    def test_malformed_boundaries_fail_instead_of_dropping_a_record(self):
        for data in (fixture()[:-1], fixture()[:-len(TRAILER)-1]+TRAILER, fixture()[:-len(TRAILER)]+b'junk'+TRAILER):
            with self.assertRaises((ValueError,EOFError)): parse_source_rows(data)

    def test_random_100_passes_every_signed_remainder_without_guessing_rng(self):
        for operand in (-2**31,-999,-100,-99,-1,0,1,99,100,999,2**31-1):
            self.assertTrue(random_gate(100,operand))
        self.assertTrue(random_gate(5,104))
        self.assertFalse(random_gate(5,105))
        self.assertTrue(random_gate(0,-1))  # Signed IDIV, not Python modulo.
        with self.assertRaises(ValueError): random_gate(100,2**31)


if __name__ == '__main__':
    unittest.main()
