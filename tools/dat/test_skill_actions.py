#!/usr/bin/env python3
"""Elbera Tools: portable action-array and lossless numeric transport checks."""
import json
from pathlib import Path
import struct
import types
import unittest

from parse_skillfx import parse_action_array, parse_skill_usk, load_package, SKILL_USK
from build_skillvfx import pack_action, pack_emitter, Interner, PHASE_KEY


class Package:
    names = ['None', 'Action', 'SpecificStage']
    exports = [types.SimpleNamespace(package_index=0, name='ActionObject')]
    def name(self, index):
        return self.names[index]
    def export_name(self, export):
        return export.name
    def ref_name(self, index):
        return ('Fixture', 'Unresolved') if index else None


def action(ref=1, stage=None):
    raw = bytes([1, 5, ref])
    if stage is not None:
        raw += bytes([2, 0x22]) + struct.pack('<i', stage)
    return raw + b'\x00'


class ActionChecks(unittest.TestCase):
    def test_nulls_omitted_defaults_and_stage_identity_survive(self):
        rows = parse_action_array(Package(), b'\x04' + action() + b'\x00' + action(0, 0) + action(1, -7), {1: {}})
        self.assertEqual([r['sourceIndex'] for r in rows], [0, 1, 2, 3])
        self.assertEqual([r['actionStatus'] for r in rows],
                         ['resolved-locate-effect', 'source-null', 'source-null', 'resolved-locate-effect'])
        self.assertEqual([r['stage'] for r in rows], [0, 0, 0, -7])
        self.assertEqual([r['stageSerialized'] for r in rows], [False, False, True, True])
        self.assertEqual(rows[0]['actionPath'], rows[3]['actionPath'])
        self.assertEqual(rows[0]['actionPath'], 'Skill.ActionObject')

    def test_unknown_reference_remains_explicit(self):
        row = parse_action_array(Package(), b'\x01' + action(2), {})[0]
        self.assertEqual(row['actionStatus'], 'unsupported-action-reference')
        self.assertEqual(row['actionRef'], 2)
        self.assertIsNone(row['actionPath'])

    def test_duplicate_fields_trailing_bytes_and_bad_count_are_rejected(self):
        for raw in [b'\x01' + action() + b'\x00', b'\x81', b'\x03\x00',
                    b'\x01\x01\x05\x01' + action(), b'\x01\x01\x15\x01\x00\x00',
                    b'\x01\x02\x04\x00\x00']:
            with self.subTest(raw=raw), self.assertRaises((ValueError, IndexError, struct.error)):
                parse_action_array(Package(), raw, {1: {}})

    def test_non_drawable_and_null_action_records_are_not_dropped(self):
        rows = parse_action_array(Package(), b'\x02' + action() + b'\x00', {1: {}})
        packed = [pack_action(row, lambda _: None) for row in rows]
        self.assertEqual(packed, rows)
        self.assertTrue(all('f' not in row for row in packed))

    def test_original_float32_values_do_not_round_to_three_decimals(self):
        f = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
        value = f(.123456789)
        packed = pack_action({'effect': 'LineageEffect.fixture', 'offset': [value, -value, 0],
                              'spawnDelay': value}, lambda _: 0)
        self.assertEqual(packed['o'], [value, -value, 0])
        self.assertEqual(packed['d'], value)
        emitter = pack_emitter({'type': 'SpriteEmitter', 'texture': 'Fixture.texture',
                                'opacity': value, 'lifetime': [value, value]}, Interner())
        self.assertEqual(emitter['o'], value)
        self.assertEqual(json.loads(json.dumps(emitter))['o'], value)

    @unittest.skipUnless(Path(SKILL_USK).exists(), 'locally supplied original Skill.usk required')
    def test_all_original_records_survive_the_generated_index(self):
        skills, actions = parse_skill_usk(load_package(SKILL_USK)[0])
        index = json.loads((Path(__file__).resolve().parents[2] / 'assets/gamedata/skillvfx.json').read_text())
        count = without_effect = 0
        for source in skills.values():
            entry = index['objects'][source['path'].lower()]
            self.assertEqual(entry['actionFormat'], 'l2-skill-action-records-v1')
            for phase, key in PHASE_KEY.items():
                rows = source['phases'].get(phase, [])
                self.assertEqual(len(entry[key]), len(rows))
                for raw, packed in zip(rows, entry[key]):
                    count += 1
                    for field in ['sourceIndex', 'actionRef', 'actionPath', 'actionStatus', 'stage', 'stageSerialized']:
                        self.assertEqual(packed[field], raw[field])
                    if raw.get('effect') is None:
                        without_effect += 1
                        self.assertNotIn('f', packed)
        self.assertEqual(len(actions), 524)
        self.assertEqual(count, 524)
        self.assertEqual(without_effect, 2)


if __name__ == '__main__':
    unittest.main()
