"""Elbera Tools: source-free, adversarial original-clip recovery fixtures."""
import copy
from pathlib import Path
import struct
import tempfile
import unittest

import recover_pawn_clips as recovery


def chunk(name, size, rows):
    return struct.pack('<20sIII', name.encode(), 0, size, len(rows)) + b''.join(rows)


def fixture():
    # The animation duplicates LeftFinger on the right branch. Its ORIGINAL
    # RefBones parents (not PSA's dummy parents) establish which finger moves.
    bones = [{'name': 'Bip01', 'parent': 0, 'quat': (0, 0, 0, 1), 'pos': (0, 0, 0)},
             {'name': 'Left', 'parent': 0, 'quat': (0, 0, 0, 1), 'pos': (0, 2, 0)},
             {'name': 'LeftFinger', 'parent': 1, 'quat': (0, 0, 0, 1), 'pos': (0, 3, 0)},
             {'name': 'Right', 'parent': 0, 'quat': (0, 0, 0, 1), 'pos': (0, -2, 0)},
             {'name': 'RightFinger', 'parent': 3, 'quat': (0, 0, 0, 1), 'pos': (0, -3, 0)}]
    original = copy.deepcopy(bones); original[-1]['name'] = 'LeftFinger'
    nodes = []
    for i, b in enumerate(bones):
        x, y, z = b['pos']
        nodes.append({'name': b['name'], 'translation': [x / 100, z / 100, -y / 100],
                      'rotation': [0, 0, 0, -1]})
        if i:
            nodes[b['parent']].setdefault('children', []).append(i)
    g = {'nodes': nodes, 'skins': [{'joints': list(range(5))}], 'meshes': [{'name': 'body'}],
         'materials': [{'name': 'original'}], 'animations': [], 'accessors': [],
         'bufferViews': [], 'buffers': [{'uri': 'fixture.bin', 'byteLength': 4}]}
    infos, keys, table = [], [], {}
    bone_rows = []
    for i, b in enumerate(original):
        row = bytearray(120); row[:len(b['name'])] = b['name'].encode()
        # umodel emits -1 for root and 0 for every other PSA parent.
        struct.pack_into('<i', row, 72, -1 if i == 0 else 0)
        bone_rows.append(bytes(row))
    for index, (slot, field) in enumerate(recovery.SLOTS.items()):
        name = slot + '_Fixture'; row = bytearray(168); row[:len(name)] = name.encode()
        struct.pack_into('<i', row, 128, 5); struct.pack_into('<i', row, 140, 15)
        struct.pack_into('<f', row, 152, 12); struct.pack_into('<ii', row, 160, index * 3, 3)
        infos.append(bytes(row))
        for frame in range(3):
            for bone in range(5):
                # Unique per bone and frame, with nontrivial root quaternion.
                keys.append(struct.pack('<8f', frame + bone, 10 + bone, 20 + frame,
                                        .125 if bone == 0 else 0, .25, .5, .75, 0))
        for stance in range(6):
            table[field, stance] = name.swapcase()
    psa = (chunk('ANIMHEAD', 0, []) + chunk('BONENAMES', 120, bone_rows)
           + chunk('ANIMINFO', 168, infos) + chunk('ANIMKEYS', 32, keys))
    return g, b'OLD!', psa, [('upper', {'bones': bones}), ('lower', {'bones': original})], {'Fixture': table}, copy.deepcopy(original)


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.g, self.blob, raw, self.parts, self.table, self.bones = fixture()
        self.psa = Path(self.temp.name) / 'fixture.psa'; self.psa.write_bytes(raw)

    def append(self):
        return recovery.append_verified(self.g, self.blob, self.psa, self.parts, self.table, 'Fixture', self.bones)

    def test_full_source_keys_correct_finger_root_conversion_and_prefix_preserved(self):
        old = copy.deepcopy(self.g)
        result, report = self.append()
        self.assertEqual(result[:4], b'OLD!')
        self.assertEqual(self.g['nodes'], old['nodes'])
        self.assertEqual(self.g['materials'], old['materials'])
        self.assertEqual(report['bones'], 5)
        self.assertEqual(len(report['added']), len(recovery.SLOTS))
        animation = self.g['animations'][0]
        right = next(c for c in animation['channels'] if c['target'] == {'node': 4, 'path': 'translation'})
        accessor = animation['samplers'][right['sampler']]['output']
        raw, _ = recovery.accessor_bytes(self.g, result, accessor, 'VEC3')
        self.assertEqual(struct.unpack_from('<3f', raw), struct.unpack('<3f', struct.pack('<3f', .04, .2, -.14)))
        root = next(c for c in animation['channels'] if c['target'] == {'node': 0, 'path': 'rotation'})
        raw, _ = recovery.accessor_bytes(self.g, result, animation['samplers'][root['sampler']]['output'], 'VEC4')
        self.assertEqual(struct.unpack_from('<4f', raw), (-.125, -.5, .25, -.75))
        self.blob = result
        again, rerun = self.append()
        self.assertEqual(again, result); self.assertEqual(rerun['added'], [])

    def test_original_parent_mismatch_rejected_despite_identical_psa_names(self):
        self.bones[-1]['parent'] = 1
        with self.assertRaisesRegex(ValueError, 'complete name-and-parent'):
            self.append()

    def test_psa_order_mismatch_rejected(self):
        self.bones[1], self.bones[3] = self.bones[3], self.bones[1]
        with self.assertRaisesRegex(ValueError, 'PSA order'):
            self.append()

    def test_changed_existing_bind_pose_or_missing_skin_rejected(self):
        self.g['nodes'][2]['translation'][0] = .001
        with self.assertRaisesRegex(ValueError, 'bind node'):
            self.append()
        self.g, *_ = fixture(); self.g['skins'] = []
        with self.assertRaisesRegex(ValueError, 'skin joints'):
            self.append()

    def test_partial_source_slot_or_other_stance_cannot_guess(self):
        self.table['Fixture']['PicItemAnimName', 0] = 'missing'
        with self.assertRaisesRegex(ValueError, 'stance-dependent'):
            self.append()

    def test_truncation_duplicate_sequence_and_invalid_rate_rejected(self):
        original = self.psa.read_bytes()
        self.psa.write_bytes(original[:-1])
        with self.assertRaisesRegex(ValueError, 'truncated'):
            self.append()
        # Offset of first ANIMINFO record in this synthetic file.
        first = 32 + 32 + 120 * 5 + 32
        bad = bytearray(original); bad[first + 168:first + 168 + 64] = bad[first:first + 64]
        self.psa.write_bytes(bad)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.append()
        bad = bytearray(original); struct.pack_into('<f', bad, first + 152, 0)
        self.psa.write_bytes(bad)
        with self.assertRaisesRegex(ValueError, 'invalid'):
            self.append()

    def test_existing_corrupted_clip_is_rejected_instead_of_duplicated(self):
        result, _ = self.append()
        self.blob = bytearray(result)
        ac = self.g['accessors'][self.g['animations'][0]['samplers'][0]['output']]
        view = self.g['bufferViews'][ac['bufferView']]
        self.blob[view['byteOffset']] ^= 1
        with self.assertRaisesRegex(ValueError, 'source key mismatch'):
            self.append()

    def test_candidate_tables_resolve_the_same_exact_source_slots(self):
        names = ['CastEnd_Fixture', 'MagicShot_Fixture', 'MagicNoTarget_Fixture', 'PicItem_Fixture',
                 'Sit_Fixture', 'Stand_Fixture']
        index = recovery.pawnanim.clip_index(names, 'Fixture')
        for slot in recovery.SLOTS:
            candidates = recovery.characters.ANIM_CANDIDATES[slot]
            self.assertIn(slot, index[candidates[0].format(P='Fixture').lower()])
            self.assertEqual(recovery.pawnanim.KEY_SLOT[recovery.SLOTS[slot]], slot)


if __name__ == '__main__':
    unittest.main()
