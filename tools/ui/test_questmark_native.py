"""Elbera Tools: source-free framing tests for the narrow quest marker decoder."""
import copy
import struct
import unittest
from unittest.mock import patch

import check_questmark_native as target


def string(value):
    raw = value.encode('ascii') + b'\0'
    return bytes([len(raw)]) + raw


def position(own, other, name, x, y):
    return struct.pack('<3i', 1, own, other) + string(name) + struct.pack('<2i', x, y)


def fixture():
    window = position(7, 1, 'ChatWnd', 42, -5)
    textures = ['synthetic.normal', 'synthetic.down', 'synthetic.hover', 'synthetic.glow1', 'synthetic.glow2']
    button = (position(1, 1, '', 0, 0) + struct.pack('<3i', -1, -1, 0)
              + string('undefined') + struct.pack('<2i', -9999, 1)
              + b''.join(string(t) for t in textures))
    rows = [dict(name='QuestBtnWnd', parent='', off=0, body=0, width=32, height=32, end=len(window)),
            dict(name='btnQuest', parent='QuestBtnWnd', off=len(window), body=len(window),
                 width=32, height=32, end=len(window + button), textures=textures)]
    return bytearray(window + button), rows


class QuestMarkerDecode(unittest.TestCase):
    def decode(self, raw, rows):
        with patch.object(target, 'scan', return_value=(None, rows)):
            return target.decode_layout(raw)

    def test_source_anchor_and_ordered_texture_frame(self):
        raw, rows = fixture()
        decoded = self.decode(raw, rows)
        self.assertEqual(decoded['position']['offsetX'], 42)
        self.assertEqual(decoded['position']['offsetY'], -5)
        self.assertEqual(decoded['texture'], 'synthetic.normal')
        self.assertEqual(decoded['sourceTextures'], rows[1]['textures'])

    def test_other_anchor_is_not_guessed(self):
        raw, rows = fixture()
        struct.pack_into('<i', raw, 4, 2)
        with self.assertRaises(ValueError):
            self.decode(raw, rows)

    def test_wrong_effect_type_or_duplicate_control_rejected(self):
        raw, rows = fixture()
        p = raw.index(string('synthetic.normal')) - 4
        struct.pack_into('<i', raw, p, 0)
        with self.assertRaises(ValueError):
            self.decode(raw, rows)
        raw, rows = fixture()
        rows.append(copy.deepcopy(rows[1]))
        with self.assertRaises(ValueError):
            self.decode(raw, rows)

    def test_trailing_and_truncated_record_rejected(self):
        raw, rows = fixture()
        rows[1]['end'] += 1
        with self.assertRaises(ValueError):
            self.decode(raw + b'\0', rows)
        raw, rows = fixture()
        with self.assertRaises(ValueError):
            self.decode(raw[:-3], rows)


class TimerBoundaries(unittest.TestCase):
    def test_equality_does_not_fire(self):
        self.assertEqual(target.timer_step(0, .01, 10), (False, target.f32(.01)))
        self.assertEqual(target.timer_step(0, .5, 500), (False, .5))

    def test_one_period_subtraction_and_float32_accumulation(self):
        self.assertEqual(target.timer_step(0, 1, 500), (True, .5))
        fired, remainder = target.timer_step(0, 1, 10)
        self.assertTrue(fired)
        self.assertEqual(remainder, target.f32(1 - target.f32(.01)))
        self.assertEqual(target.timer_step(0, .010001, 10)[0], True)


if __name__ == '__main__':
    unittest.main()
