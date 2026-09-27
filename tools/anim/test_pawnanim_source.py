"""Elbera Tools: bounded original timing extraction; synthetic + private checks."""
import hashlib
import math
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

import build_pawnanim as pawn
from l2lib.ue2package import encode_compact


class Package:
    file_version = 123
    licensee_version = 30
    path = '<synthetic>'
    names = ['None', 'Bone', 'First', 'Second']

    def name(self, index):
        if not 0 <= index < len(self.names): raise pawn.L2Error('bad name')
        return self.names[index]

    def class_name_of(self, export): return 'MeshAnimation'

    def resolve_ref(self, ref):
        raise pawn.L2Error('unexpected synthetic object ref')


def fixture(notifies=(.9, .1), extra_sequence=False):
    c = encode_compact
    b = bytearray(c(0) + struct.pack('<i', 1) + c(1) + c(1) + struct.pack('<ii', 0, 0))
    moves_offset = len(b)
    b += b'\0' * 4 + c(2 if extra_sequence else 1)
    chunks = []
    for _ in range(2 if extra_sequence else 1):
        mark = len(b); chunks.append(mark)
        b += b'\0' * 4 + struct.pack('<3ffi', 0, 0, 0, 3., 0) + struct.pack('<i', 0)
        b += c(0) + c(1)  # empty BoneIndices, one ordinary bone track
        b += struct.pack('<i', 0) + c(1) + struct.pack('<4f', 0, 0, 0, 1)
        b += c(1) + struct.pack('<3f', 0, 0, 0) + c(1) + struct.pack('<f', 0)
        b += struct.pack('<i', 0) + c(0) + c(0) + c(0)  # empty root track
        struct.pack_into('<i', b, mark, len(b))
    struct.pack_into('<i', b, moves_offset, len(b))
    b += c(len(chunks))
    for index in range(len(chunks)):
        b += struct.pack('<f', 0) + c(index + 2) + c(0) + struct.pack('<ii', 0, 3)
        notes = notifies if index == 0 else []
        b += c(len(notes))
        for t in notes: b += struct.pack('<f', t) + c(0) + c(0)
        b += struct.pack('<fiii', 30., 0, 0, 0) + c(0) + struct.pack('<ii', 0, 0)
        b += b'\0' + c(0) + c(0) + struct.pack('<ii', 0, 0) + c(0)
    package = Package(); package.data = bytes(b)
    export = SimpleNamespace(serial_offset=0, serial_size=len(b))
    return package, export, moves_offset, chunks


class SyntheticSourceTests(unittest.TestCase):
    def test_pose_retention_keeps_original_records_and_leaves_timing_api_unchanged(self):
        pkg, exp, _, _ = fixture()
        plain = pawn.original_sequences(pkg, exp)
        retained = pawn.original_animation(pkg, exp, include_tracks=True)
        self.assertEqual(retained['bones'], [{'name': 'Bone', 'flags': 0, 'parent': 0}])
        sequence = dict(retained['sequences'][0])
        movement = sequence.pop('movement')
        self.assertEqual(sequence, plain[0])
        self.assertEqual(movement['boneIndices'], ())
        self.assertEqual(movement['tracks'][0]['quaternions'], [(0., 0., 0., 1.)])
        self.assertEqual(movement['tracks'][0]['positions'], [(0., 0., 0.)])
        self.assertEqual(movement['tracks'][0]['times'], (0.,))
        self.assertEqual(movement['rootTrack']['quaternions'], [])
        for entry in [movement, movement['tracks'][0], movement['rootTrack']]:
            source = entry['source']
            raw = pkg.data[source['offset']:source['offset'] + source['size']]
            self.assertEqual(hashlib.sha256(raw).hexdigest(), source['SHA256'])

    def test_pose_retention_preserves_nonunit_quaternions_and_rejects_nonfinite(self):
        pkg, exp, _, _ = fixture()
        pose = pawn.original_animation(pkg, exp, include_tracks=True)['sequences'][0]['movement']['tracks'][0]
        # Track header is flags + compact quaternion-count. This fixture's
        # authored nonunit and signed values must not be silently normalized.
        offset = pose['source']['offset'] + 5
        data = bytearray(pkg.data)
        struct.pack_into('<4f', data, offset, -2, 3, 0, .5)
        pkg.data = bytes(data)
        actual = pawn.original_animation(pkg, exp, include_tracks=True)
        self.assertEqual(actual['sequences'][0]['movement']['tracks'][0]['quaternions'], [(-2, 3, 0, .5)])
        struct.pack_into('<f', data, offset, math.nan)
        pkg.data = bytes(data)
        with self.assertRaisesRegex(pawn.L2Error, 'nonfinite source pose'):
            pawn.original_animation(pkg, exp, include_tracks=True)

    def test_localized_wait_rates_are_scalars_not_stance_arrays(self):
        table = pawn.parse_warrior_int('[Fixture]\nSitAnimName[0]=Sit_Fixture\n'
                                      'sitanimrate=1.27451\nStandAnimRate=1.01307\n')
        rates = pawn.source_wait_rates(table['Fixture'])
        self.assertEqual(table['Fixture']['SitAnimName', 0], 'Sit_Fixture')
        self.assertEqual(rates, {'sit': struct.unpack('<f', struct.pack('<f', 1.27451))[0],
                                 'stand': struct.unpack('<f', struct.pack('<f', 1.01307))[0]})
        self.assertNotIn(('sitanimrate', 1), table['Fixture'])

    def test_wait_rates_preserve_source_zero_but_reject_missing_invalid_and_duplicate_fields(self):
        self.assertEqual(pawn.source_wait_rates({('sitanimrate', -1): '0', ('standanimrate', -1): '-2'}),
                         {'sit': 0., 'stand': -2.}, 'native getter policy is separate from original scalar data')
        for value in ('nan', 'inf', '1e40', 'not-a-number'):
            with self.assertRaises(pawn.L2Error):
                pawn.source_wait_rates({('sitanimrate', -1): value, ('standanimrate', -1): '1'})
        with self.assertRaisesRegex(pawn.L2Error, 'missing'):
            pawn.source_wait_rates({('sitanimrate', 1): '1', ('standanimrate', -1): '1'})
        with self.assertRaisesRegex(pawn.L2Error, 'duplicate'):
            pawn.parse_warrior_int('[Fixture]\nsitanimrate=1\nSitAnimRate=2\n')

    def test_original_order_float32_and_valid_empty_sequence(self):
        pkg, exp, _, _ = fixture(extra_sequence=True)
        rows = pawn.original_sequences(pkg, exp)
        self.assertEqual([r['name'] for r in rows], ['First', 'Second'])
        self.assertEqual(rows[1]['notifies'], [])
        self.assertEqual([n['index'] for n in rows[0]['notifies']], [0, 1])
        self.assertEqual(rows[0]['notifies'][0]['t'], struct.unpack('<f', struct.pack('<f', .9))[0])
        self.assertGreater(rows[0]['notifies'][0]['t'], rows[0]['notifies'][1]['t'])
        self.assertEqual((rows[0]['frames'], rows[0]['rate']), (3, 30))
        meta = pawn.sequence_metadata(pkg, rows[0], 'Fixture', {})
        self.assertTrue(meta['originalTiming'])
        self.assertEqual(meta['notifies'][0]['classPath'], None)
        self.assertFalse(meta['notifies'][0]['isAttackShot'])
        self.assertFalse(meta['notifies'][0]['isBoneScale'])
        self.assertFalse(meta['notifies'][0]['isSound'])
        self.assertIsNone(meta['notifies'][0]['objectName'])
        self.assertIsNone(meta['notifies'][0]['objectPath'])
        self.assertEqual(meta['notifies'][0]['function'], 'None')
        self.assertEqual(meta['notifies'][0]['t'], rows[0]['notifies'][0]['t'])

    def test_source_out_of_range_notify_is_preserved_not_clamped(self):
        pkg, exp, _, _ = fixture(notifies=(1.75, -.1))
        rows = pawn.original_sequences(pkg, exp)
        self.assertEqual(rows[0]['notifies'][0]['t'], 1.75)
        self.assertLess(rows[0]['notifies'][1]['t'], 0)

    def test_nonfinite_source_notify_rejected(self):
        pkg, exp, _, _ = fixture(notifies=(math.nan,))
        with self.assertRaisesRegex(pawn.L2Error, 'nonfinite'): pawn.original_sequences(pkg, exp)

    def test_declared_export_boundary_truncates_even_if_more_package_bytes_exist(self):
        pkg, exp, _, _ = fixture()
        exp.serial_size -= 1
        with self.assertRaises(pawn.L2Error): pawn.original_sequences(pkg, exp)

    def test_extra_export_bytes_and_wrong_movement_end_rejected(self):
        pkg, exp, _, chunks = fixture()
        pkg.data += b'\0'; exp.serial_size += 1
        with self.assertRaisesRegex(pawn.L2Error, 'not fully consumed'): pawn.original_sequences(pkg, exp)
        pkg, exp, _, chunks = fixture()
        raw = bytearray(pkg.data)
        struct.pack_into('<i', raw, chunks[0], len(raw))
        pkg.data = bytes(raw)
        with self.assertRaisesRegex(pawn.L2Error, 'endpoint'): pawn.original_sequences(pkg, exp)

    def test_both_original_package_versions_and_unknown_version(self):
        pkg, exp, _, _ = fixture()
        pkg.licensee_version = 28
        self.assertEqual(len(pawn.original_sequences(pkg, exp)), 1)
        pkg.licensee_version = 27
        with self.assertRaisesRegex(pawn.L2Error, 'version'): pawn.original_sequences(pkg, exp)

    def test_source_fingerprint_is_exact_and_deterministic(self):
        pkg, exp, _, _ = fixture()
        row = pawn.original_sequences(pkg, exp)[0]
        source = row['source']
        expected = hashlib.sha256(pkg.data[source['offset']:source['offset'] + source['size']]).hexdigest()
        self.assertEqual(source['SHA256'], expected)
        self.assertEqual(row, pawn.original_sequences(pkg, exp)[0])

    def test_attackshot_class_identity_subtype_and_unknown(self):
        parents = {'fixture.child': 'Engine.AnimNotify_AttackShot',
                   'engine.animnotify_sound': 'Engine.AnimNotify',
                   'engine.animnotify_attackshot': 'Engine.AnimNotify',
                   'engine.animnotify': 'Core.Object'}
        self.assertTrue(pawn.is_attack_shot('Engine.AnimNotify_AttackShot', parents))
        self.assertTrue(pawn.is_attack_shot('Fixture.Child', parents))
        self.assertFalse(pawn.is_attack_shot('Engine.AnimNotify_Sound', parents))
        with self.assertRaisesRegex(pawn.L2Error, 'unresolved'):
            pawn.is_attack_shot('Other.AnimNotify_AttackShot', parents)
        with self.assertRaisesRegex(pawn.L2Error, 'unresolved'):
            pawn.is_attack_shot('Engine.AnimNotify_AttackShot', {})
        with self.assertRaisesRegex(pawn.L2Error, 'cyclic'):
            pawn.is_attack_shot('Fixture.Loop', {'fixture.loop': 'Fixture.Loop'})

    def test_bonescale_classifier_uses_original_ancestry_not_the_leaf_name(self):
        parents = {'fixture.bonechild': 'Engine.AnimNotify_BoneScale',
                   'engine.animnotify_bonescale': 'Engine.AnimNotify',
                   'fixture.animnotify_bonescale': 'Engine.AnimNotify_Sound',
                   'engine.animnotify_sound': 'Engine.AnimNotify',
                   'engine.animnotify': 'Core.Object'}
        target = 'Engine.AnimNotify_BoneScale'
        self.assertTrue(pawn.is_notify_subtype('Fixture.BoneChild', parents, target))
        self.assertFalse(pawn.is_notify_subtype('Fixture.AnimNotify_BoneScale', parents, target))
        self.assertFalse(pawn.is_attack_shot('Fixture.BoneChild', parents))

    def test_sound_properties_preserve_zero_and_only_proven_default_fields(self):
        defaults = {'classPath': 'Engine.AnimNotify_Sound', 'values': {'Volume': 1., 'Random': 100}}
        props = {'Volume': struct.pack('<f', 0), 'Radius': struct.pack('<i', 30)}
        result = pawn.sound_properties(props, defaults, 'Engine.AnimNotify_Sound', 'Fixture.Sound')
        self.assertEqual(result['status'], 'source-direct')
        self.assertEqual((result['volume'], result['radius'], result['random']), (0,30,100))
        self.assertEqual(result['fieldSources'], {'volume':'object','radius':'object','random':'Engine.AnimNotify_Sound'})
        inherited = pawn.sound_properties({'Radius':props['Radius']}, defaults, 'Engine.AnimNotify_Sound', 'Fixture.Sound')
        self.assertEqual(inherited['volume'], 1.)
        self.assertEqual(pawn.sound_properties(props, defaults, 'Engine.AnimNotify_Sound', None)['status'], 'source-surface')

    def test_sound_defaults_missing_radius_or_derived_class_remain_unresolved(self):
        defaults = {'classPath':'Engine.AnimNotify_Sound','values':{'Volume':1.,'Random':100}}
        missing = pawn.sound_properties({}, defaults, 'Engine.AnimNotify_Sound', 'Fixture.Sound')
        self.assertIsNone(missing['radius'])
        self.assertEqual(missing['status'],'unresolved-source-properties')
        derived = pawn.sound_properties({'Radius':struct.pack('<i',30)}, defaults, 'Fixture.SoundChild', 'Fixture.Sound')
        self.assertIsNone(derived['random'])
        self.assertEqual(derived['status'],'unresolved-source-properties')
        for value in (b'\0', struct.pack('<f',math.inf)):
            with self.assertRaises(pawn.L2Error):
                pawn.sound_properties({'Volume':value},defaults,'Engine.AnimNotify_Sound','Fixture.Sound')


class PrivateOriginalTests(unittest.TestCase):
    @unittest.skipUnless(Path(pawn.ANIMS, 'Fighter.ukx').exists(), 'owned original player packages and exported PSA files required')
    def test_all_fourteen_original_headers_notifies_match_independent_psa_guided_reader(self):
        from build_stepnotify import psa_seqs, read_sequences, PSA
        total = 0
        for package in dict.fromkeys(p[1] for p in pawn.PAWNS):
            pkg, _ = pawn.load_package(str(Path(pawn.ANIMS, package + '.ukx')))
            for _, name, prefix in pawn.PAWNS:
                if name != package: continue
                exp = pkg.find_export(prefix + '_anim', 'MeshAnimation')
                strict = pawn.original_sequences(pkg, exp)
                oracle = psa_seqs(str(Path(PSA, package, 'MeshAnimation', prefix + '_anim.psa')))
                scanned, missing = read_sequences(pkg, exp, oracle)
                self.assertEqual(missing, [])
                self.assertEqual(len(strict), len(scanned))
                for a, b in zip(strict, scanned):
                    self.assertEqual((a['name'], a['frames'], a['rate']), (b['name'], b['frames'], b['rate']))
                    self.assertEqual([(n['t'], n['function'], n['objectRef']) for n in a['notifies']], b['notifys'])
                total += len(strict)
        self.assertEqual(total, 1367)


if __name__ == '__main__': unittest.main()
