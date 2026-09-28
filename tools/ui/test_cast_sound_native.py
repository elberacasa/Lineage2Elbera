"""Source-free adversarial tests for the original cast sound evidence tool."""
import struct
import unittest
from types import SimpleNamespace

from check_cast_sound_native import parse_source_rows, phase_layers, select_source_row, random_gate, match_model_records, core_rand_step, RandomMachine, TRAILER


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


    def test_explicit_rng_state_preserves_unsigned_overflow_and_known_chain(self):
        state = 1
        actual = []
        for _ in range(5):
            state, value = core_rand_step(state)
            actual.append((state, value))
        self.assertEqual(actual, [(2745024,41),(3357800067,18467),(415139642,6334),
                                  (3884216597,26500),(3403800452,19169)])
        self.assertEqual(core_rand_step(0xffffffff), (2316998,35))
        # State is explicitly supplied; none of these fixtures is a live seed.
        for value in (None, True, False, -1, 1.0, 1 << 32, '1'):
            with self.assertRaisesRegex(ValueError, 'explicit unsigned DWORD'):
                core_rand_step(value)

    def test_integer_interpreter_modulo32_and_logical_shift(self):
        rows = [('imul','ecx, ecx, 0x343fd'),('add','ecx, 0x269ec3'),
                ('mov','dword ptr [eax + 0x14], ecx'),('shr','ecx, 0x10'),('and','ecx, 0x7fff'),('ret','')]
        instructions = [SimpleNamespace(address=i, size=1, mnemonic=op, op_str=args) for i,(op,args) in enumerate(rows)]
        # The first two start states distinguish signed shift and missing u32
        # truncation; expected words are independent fixed synthetic fixtures.
        for old, word, output in [(1,2745024,41),(0xffffffff,2316998,35),
                                  (0x80000000,2150014659,38),(0,2531011,38)]:
            machine = RandomMachine({}, {'eax':0x2000,'ecx':old}, instructions)
            self.assertEqual(machine.execute(0), 6)
            self.assertEqual(machine.memory[0x2014], word)
            self.assertEqual(machine.registers['ecx'], output)

    def test_gate_interpreter_signed_division_and_inclusive_rejection(self):
        rows = [('cdq',''),('mov','ecx, 0x64'),('idiv','ecx'),
                ('cmp','edx, dword ptr [edi + 0x44]'),('jge','0x7'),('ret','')]
        instructions = [SimpleNamespace(address=i, size=1, mnemonic=op, op_str=args) for i,(op,args) in enumerate(rows)]
        for value, threshold, expected_remainder, rejected in [(-101,0,-1,False),
                (-100,0,0,True),(0,0,0,True),(32767,67,67,True),(32767,68,67,False),
                (41,-0x80000000,41,True),(41,0x7fffffff,41,False)]:
            machine = RandomMachine({0x3044:threshold & 0xffffffff},
                                    {'eax':value & 0xffffffff,'edi':0x3000}, instructions)
            machine.execute(0, 7 if rejected else None)
            remainder = machine.registers['edx']
            if remainder & 0x80000000: remainder -= 1 << 32
            self.assertEqual(remainder, expected_remainder)
            self.assertEqual(not rejected, random_gate(threshold,value))

    def test_integer_interpreter_never_executes_imports(self):
        instruction = SimpleNamespace(address=0, size=6, mnemonic='call', op_str='dword ptr [0x1000]')
        with self.assertRaises(AssertionError):
            RandomMachine({}, {}, [instruction]).execute(0)


if __name__ == '__main__':
    unittest.main()
