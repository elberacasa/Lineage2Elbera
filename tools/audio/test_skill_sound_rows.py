"""Elbera Tools: portable source sound record preservation regressions."""
import copy
import math
import unittest

from build_audio import SKILL_VOICE_SLOTS, skill_sound_rows


def record(level=1):
    row = {'skill_id': 7, 'skill_level': level, 'sound_vol': 0, 'sound_rad': 17.25}
    for group in ('spell', 'shot', 'exp'):
        row[group + '_sounds'] = [group + '.one', '', group + '.three']
        row[group + '_vols'] = [0, 2.125, 3.75]
        row[group + '_rads'] = [0, 0, 17.25]
    for field in ('voice_cast', 'voice_throw'):
        row[field] = {slot: '' if slot == 'RESERVED' else 'voice.' + field + '.' + slot
                      for slot in SKILL_VOICE_SLOTS}
    return row


class SkillSoundRowsTests(unittest.TestCase):
    def test_order_duplicates_zero_gains_and_fractional_values_survive(self):
        rows = [record(2), record(1), record(2), record(1)]
        rows[2]['spell_sounds'][0] = 'different.exact'
        rows[3]['spell_sounds'][0] = 'different.default'
        before = copy.deepcopy(rows)
        result = skill_sound_rows(rows, lambda value: value or None)['7']
        self.assertEqual([r['level'] for r in result], [2, 1, 2, 1])
        self.assertEqual(result[0]['layers'][0], [['spell.one', 0, 0], [None, 2.125, 0], ['spell.three', 3.75, 17.25]])
        self.assertEqual(result[0]['layers'][1][0][0], 'shot.one')
        self.assertEqual(result[0]['layers'][2][2][0], 'exp.three')
        self.assertEqual(result[2]['layers'][0][0][0], 'different.exact')
        self.assertEqual(result[3]['voiceVolume'], 0)
        self.assertEqual(result[3]['voiceRadius'], 17.25)
        self.assertEqual(rows, before)

    def test_all_voice_slots_and_empty_rows_remain(self):
        row = record()
        for group in ('spell', 'shot', 'exp'): row[group + '_sounds'] = ['', '', '']
        result = skill_sound_rows([row], lambda value: value or None)['7'][0]
        self.assertEqual(len(result['castVoice']), 15)
        self.assertEqual(result['castVoice'][4], 'voice.voice_cast.mdwarf')
        self.assertEqual(result['throwVoice'][13], 'voice.voice_throw.fshaman')
        self.assertIsNone(result['throwVoice'][14])
        self.assertTrue(all(sound[0] is None for layer in result['layers'] for sound in layer))

    def test_incomplete_source_fields_and_nonfinite_values_fail(self):
        for key, value in [('skill_level', -1), ('spell_sounds', ['x.y']),
                           ('shot_rads', [1, math.nan, 3]), ('sound_vol', math.inf)]:
            row = record(); row[key] = value
            with self.assertRaises(ValueError): skill_sound_rows([row], lambda value: value)
        row = record(); del row['voice_cast']['mfighter']
        with self.assertRaises(KeyError): skill_sound_rows([row], lambda value: value)


if __name__ == '__main__': unittest.main()
