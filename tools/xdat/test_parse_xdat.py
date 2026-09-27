"""Offline regressions for native shared layout fields; no client files needed."""
import math
import struct
import unittest

import parse_xdat as xdat


def string(value):
    raw = value.encode('ascii')
    return bytes([len(raw) + 1]) + raw + b'\0' if raw else b'\0'


def ints(*values):
    return struct.pack('<' + 'i' * len(values), *values)


def header(size, position, name='Control'):
    # A source-shaped synthetic common header, independent of the decoder.
    return (string(name) + string('undefined') + ints(0, 0) + string('Parent')
            + string('undefined') * 2 + ints(1) + size + position)


def position(own, target, name, dx, dy):
    return ints(1, own, target) + string(name) + ints(dx, dy)


class SharedLayoutTests(unittest.TestCase):
    def test_negative_offsets_are_signed_int32_after_empty_string(self):
        raw = header(ints(1, 1, 76, 23), position(2, 2, '', -40, 100))
        got = xdat.parse_header(xdat.Reader(raw), 0)
        self.assertEqual((got['x'], got['y']), (-40, 100))
        self.assertEqual(got['position'], {
            'selfAnchor': 2, 'targetAnchor': 2, 'target': '',
            'offsetX': -40, 'offsetY': 100,
        })
        self.assertEqual(got['sizeMode'], 'absolute')

    def test_named_target_shifts_both_offsets_without_resolving_them(self):
        for name in ('Sibling', 'DialogBox.num1', 'Window.Nested.Control'):
            with self.subTest(name=name):
                raw = header(ints(1, 1, 28, 28), position(1, 3, name, 1, -5))
                got = xdat.parse_header(xdat.Reader(raw), 0)
                self.assertEqual((got['x'], got['y']), (1, -5))
                self.assertEqual(got['position']['target'], name)
                self.assertEqual(got['position']['targetAnchor'], 3)

    def test_offsets_keep_full_signed_range_without_fixed_point_truncation(self):
        raw = header(ints(1, 1, 1, 1),
                     position(1, 1, '', -2147483648, 2147483647))
        got = xdat.parse_header(xdat.Reader(raw), 0)
        self.assertEqual((got['x'], got['y']), (-2147483648, 2147483647))

    def test_relative_size_keeps_fractional_rates_and_independent_anchor(self):
        size = ints(1, 0) + string('') + struct.pack('<ffii', .5, .9, -420, 128)
        raw = header(size, position(1, 3, 'Other.Back', -12, 0))
        got = xdat.parse_header(xdat.Reader(raw), 0)
        self.assertEqual(got['sizeMode'], 'relative')
        self.assertIsNone(got['width'])
        self.assertEqual(got['relativeSize']['widthRate'], .5)
        self.assertEqual(got['relativeSize']['heightRate'], struct.unpack('<f', struct.pack('<f', .9))[0])
        self.assertEqual(got['insets'], (-420, 128))
        self.assertEqual((got['x'], got['y']), (-12, 0))
        self.assertEqual(xdat.parse_has0_tail(xdat.Reader(raw), got['body'])['position'], got['position'])

    def test_relative_reference_is_a_string_and_not_a_flag_byte(self):
        size = ints(1, 0) + string('SourceSize') + struct.pack('<ffii', 1, 0, -5, 14)
        got = xdat.parse_header(xdat.Reader(header(size, position(1, 1, '', 0, 0))), 0)
        self.assertEqual(got['relativeSize']['reference'], 'SourceSize')
        self.assertEqual(got['relativeSize']['heightRate'], 0)
        self.assertEqual(got['relativeSize']['heightOffset'], 14)

    def test_absent_optional_objects_and_zero_enum_are_preserved(self):
        got = xdat.parse_header(xdat.Reader(header(ints(0), ints(0))), 0)
        self.assertIsNone(got['sizeMode'])
        self.assertIsNone(got['position'])
        self.assertIsNone(got['x'])
        raw = header(ints(1, 1, 20, 10), position(0, 0, '', 0, 0))
        self.assertEqual(xdat.parse_header(xdat.Reader(raw), 0)['position']['selfAnchor'], 0)

    def test_invalid_or_truncated_layout_is_rejected(self):
        complete = header(ints(1, 1, 76, 23), position(2, 2, 'Target', -40, 100))
        for raw in (complete[:-1], complete[:-6],
                    header(ints(1, 1, 76, 23), position(10, 2, '', 0, 0)),
                    header(ints(1, 0) + string('') + struct.pack('<ffii', math.nan, 1, 0, 0), ints(0))):
            self.assertIsNone(xdat.parse_header(xdat.Reader(raw), 0))

    def test_tree_retains_explicit_position_and_size_rule(self):
        size = ints(1, 0) + string('') + struct.pack('<ffii', .5, 0, 10, 14)
        got = xdat.parse_header(xdat.Reader(header(size, position(2, 2, '', -4, 0))), 0)
        got.update(type='Window', textures=[], parent='')
        node = xdat.build_tree([got])[0]
        self.assertEqual(node['position'], got['position'])
        self.assertEqual(node['relativeSize'], got['relativeSize'])
        self.assertEqual((node['x'], node['y']), (-4, 0))


class ButtonTextTests(unittest.TestCase):
    def fixture(self, text_id=385, relative=False, target='Other.Control'):
        size = (ints(1, 0) + string('') + struct.pack('<ffii', .5, 1, -4, 0)
                if relative else ints(1, 1, 76, 23))
        raw = header(size, position(3, 3, target, -10, 6))
        # Source-shaped common suffix, then native Button-specific fields.
        raw += ints(7, 8, 9) + string('variable common string') + ints(-9999)
        raw += b''.join(string(t) for t in ('Pkg.Long.Texture', '', 'undefined', 'P.T'))
        raw += ints(text_id, -1, -1, -9999)
        rec = xdat.parse_header(xdat.Reader(raw), 0)
        rec.update(end=len(raw), type='Button', textures=[], parent='')
        return raw, rec

    def test_button_id_follows_variable_strings_and_both_size_kinds(self):
        for relative in (False, True):
            for target in ('', 'Other.Control'):
                with self.subTest(relative=relative, target=target):
                    raw, rec = self.fixture(relative=relative, target=target)
                    self.assertEqual(xdat.parse_button_text(xdat.Reader(raw), rec), {'textId': 385})
                    previous = xdat.data_g
                    try:
                        xdat.data_g = raw
                        self.assertEqual(xdat.build_tree([rec])[0]['textId'], 385)
                    finally:
                        xdat.data_g = previous

    def test_unset_button_label_is_not_an_id(self):
        raw, rec = self.fixture(text_id=-9999)
        self.assertEqual(xdat.parse_button_text(xdat.Reader(raw), rec), {})

    def test_button_cannot_borrow_bytes_from_next_record(self):
        raw, rec = self.fixture()
        rec['end'] -= 1
        self.assertIsNone(xdat.parse_button_text(xdat.Reader(raw + b'next record'), rec))
        self.assertIsNone(xdat.parse_button_text(xdat.Reader(raw[:-1]), rec))


class DeferredParentTests(unittest.TestCase):
    def node(self, name, common='', declared=None):
        rec = xdat.parse_header(xdat.Reader(header(ints(1, 1, 20, 10),
                                               position(1, 1, '', 0, 0), name)), 0)
        rec.update(type='Window', textures=[], parent=common)
        if declared is not None:
            rec['declaredWindowParent'] = declared
        return rec

    def test_window_parent_is_after_common_suffix(self):
        raw = header(ints(1, 1, 256, 401), position(1, 1, '', 0, 0))
        raw += ints(0, 0, 0) + string('undefined') + ints(-9999) + string('LaterRoot')
        rec = xdat.parse_header(xdat.Reader(raw), 0)
        rec['end'] = len(raw)
        self.assertEqual(xdat.parse_window_parent(xdat.Reader(raw), rec), 'LaterRoot')
        rec['end'] -= 1
        self.assertIsNone(xdat.parse_window_parent(xdat.Reader(raw), rec))

    def test_drawer_fields_respect_record_bounds_and_inactive_bytes(self):
        raw = header(ints(1, 1, 46, 504), position(6, 6, '', 0, 0))
        raw += ints(0, 0, 0) + string('undefined') + ints(-9999)
        raw += b''.join(string(s) for s in ('undefined', 'Texture', 'undefined', 'undefined'))
        raw += bytes(88)
        start = len(raw)
        raw += ints(1, -4, 1) + string('PreviousDrawer')
        rec = xdat.parse_header(xdat.Reader(raw), 0)
        rec.update(end=len(raw))
        self.assertEqual(xdat.parse_window_drawer(xdat.Reader(raw), rec),
                         {'direction': 1, 'offset': -4, 'fixed': 1, 'owner': 'PreviousDrawer'})
        rec['end'] -= 1
        self.assertIsNone(xdat.parse_window_drawer(xdat.Reader(raw), rec))
        inactive = raw[:start] + ints(0)
        rec['end'] = len(inactive)
        self.assertEqual(xdat.parse_window_drawer(xdat.Reader(inactive), rec), {'direction': 0})

    def test_forward_parent_attaches_with_original_children(self):
        tree = xdat.build_tree([self.node('Template', declared='Root'),
                               self.node('Label', common='Template'), self.node('Root')])
        self.assertEqual([n['name'] for n in tree], ['Root'])
        template = tree[0]['children'][0]
        self.assertEqual(template['name'], 'Template')
        self.assertEqual(template['children'][0]['name'], 'Label')
        self.assertEqual(template['parentResolution']['source'], 'declaredWindowParent')

    def test_duplicate_missing_and_cyclic_parents_are_explicit(self):
        tree = xdat.build_tree([self.node('Same'), self.node('Same'),
                               self.node('A', declared='Same'),
                               self.node('B', declared='Absent'),
                               self.node('C', declared='D'), self.node('D', declared='C')])
        status = {n['name']: n.get('parentResolution', {}).get('status') for n in tree}
        self.assertEqual(status['A'], 'ambiguous')
        self.assertEqual(status['B'], 'missing')
        self.assertEqual((status['C'], status['D']), ('cycle', 'cycle'))
        self.assertTrue(all(not n['children'] for n in tree))

    def test_undefined_declared_parent_retains_unique_common_parent(self):
        tree = xdat.build_tree([self.node('Root'),
                               self.node('Child', common='Root', declared='undefined')])
        self.assertEqual(tree[0]['children'][0]['parentResolution']['source'], 'commonParent')


class TextLayoutTests(unittest.TestCase):
    def test_autosize_is_explicit_even_with_nonzero_declared_width(self):
        raw = header(ints(1, 1, 245, 12), position(1, 1, '', 0, 0))
        raw += ints(0, 0, 0) + string('undefined') + ints(-9999)
        raw += string(':') + ints(1, 0) + string('undefined')
        raw += ints(-9999, -9999, -9999, -2302756, -1, 1)
        rec = xdat.parse_header(xdat.Reader(raw), 0)
        rec['end'] = len(raw)
        self.assertEqual(xdat.parse_text_layout(xdat.Reader(raw), rec),
                         {'defaultText': ':', 'autoSize': 1, 'fontType': 0, 'alignEnum': 1})
        rec['end'] -= 1
        self.assertIsNone(xdat.parse_text_layout(xdat.Reader(raw), rec))


if __name__ == '__main__':
    unittest.main()
