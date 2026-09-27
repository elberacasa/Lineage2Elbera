"""Public synthetic packed-field tests plus optional owned-input source checks."""
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mine_dialogbox import ROOT, anchor_fields, decode, resolved_rect, pad_rect


def packed(offset_x, offset_y=100, anchor=2):
    return (struct.pack('<3i', 1, anchor, anchor) + b'\0'
            + struct.pack('<5i', offset_x, offset_y, -1, -1, 0)
            + b'\x0aundefined\0')


class AnchorTests(unittest.TestCase):
    def test_signed_offsets_follow_one_byte_empty_string(self):
        raw = packed(-40)
        self.assertEqual(anchor_fields(raw, 0)['offsetX'], -40)
        self.assertEqual(anchor_fields(raw, 0)['offsetY'], 100)
        # Independent regression: old byte12 fixed-point reads x correctly
        # by coincidence, but contaminates y with x's signed high byte.
        old_y = struct.unpack_from('<i', raw, 16)[0]
        self.assertEqual(old_y % 256, 255)

    def test_native_parent_minus_self_half_width_not_raw_offset(self):
        record = {'body': 0, 'off': 0, 'width': 76, 'height': 23}
        for offset, expected in [(-40, 75), (40, 155), (0, 115)]:
            rect = resolved_rect(packed(offset), record, 306)
            self.assertEqual((rect['x'], rect['y']), (expected, 100))
        # Different parent size exposes a hard-coded set of source positions.
        self.assertEqual(resolved_rect(packed(-40), record, 400)['x'], 122)

    def test_top_left_and_malformed_anchor_rejection(self):
        self.assertEqual(anchor_fields(packed(41, 9, 1), 0)['self'], 1)
        with self.assertRaises(ValueError):
            anchor_fields(packed(0, anchor=9), 0)
        broken = bytearray(packed(-40)); broken[21] = 0
        with self.assertRaises(ValueError):
            anchor_fields(broken, 0)

    def test_named_pad_sibling_anchors_use_sibling_dimensions(self):
        record = {'width': 28, 'height': 28, 'off': 123, 'sizeMode': 'absolute',
                  'position': {'selfAnchor': 1, 'targetAnchor': 3,
                               'target': 'DialogBox.first', 'offsetX': 1, 'offsetY': 0}}
        target = {'x': 7, 'y': 7, 'width': 28, 'height': 28}
        self.assertEqual(pad_rect(record, {'first': target}, {})['x'], 36)
        # A different source size exposes an invented uniform grid.
        self.assertEqual(pad_rect(record, {'first': dict(target, width=57)}, {})['x'], 65)
        record['position'].update(targetAnchor=7, offsetX=0, offsetY=1)
        self.assertEqual(pad_rect(record, {'first': target}, {})['y'], 36)
        with self.assertRaises(ValueError): pad_rect(record, {}, {})
        record['position']['target'] = 'Other.first'
        with self.assertRaises(ValueError): pad_rect(record, {'first': target}, {})

    @unittest.skipUnless((ROOT / 'assets/interlude/system/Interface.xdat').exists(),
                         'owned original client inputs are private')
    def test_owned_source_and_native_proof(self):
        data = decode()
        self.assertEqual((data['body']['width'], data['body']['height']), (306, 128))
        self.assertEqual(data['source']['native']['buttonLabelColor'], '#E6DCBE')
        self.assertEqual(data['source']['native']['status'], 'verified')
        self.assertEqual([data['controls'][k]['x'] for k in
                         ('OKButton', 'CancelButton', 'CenterOKButton')], [75, 155, 115])
        self.assertEqual(data['controls']['DialogText']['color'], '#DCDCDC')
        self.assertEqual(data['controls']['OKButton']['labelId'], 1337)
        self.assertEqual(data['controls']['CancelButton']['labelId'], 1342)
        edit = data['controls']['DialogBoxEdit']
        self.assertEqual([edit[k] for k in ('x', 'y', 'width', 'height')], [75, 73, 156, 17])
        self.assertEqual([edit['textInsetX'], edit['textInsetY']], [2, 2])
        self.assertEqual(edit['frame']['capWidth'], 8)
        self.assertEqual(data['numberPad']['dialogWidth'], 434)
        for name, rect in [('num1', (7, 7, 28, 28)), ('numAll', (36, 94, 57, 28)),
                           ('numBS', (94, 7, 28, 57)), ('numC', (94, 65, 28, 57))]:
            actual = data['numberPad']['buttons'][name]
            self.assertEqual(tuple(actual[k] for k in ('x', 'y', 'width', 'height')), rect)


if __name__ == '__main__':
    unittest.main()
