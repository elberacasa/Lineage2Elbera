"""Elbera Tools: portable NumberPad arithmetic tests; no original assets needed."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_numberpad_native import group_digits, number_color, reading_english


class NumberPadTests(unittest.TestCase):
    labels = ['K', ' M', ' B']  # Synthetic labels preserve deliberate whitespace.

    def test_literal_grouping_preserves_leading_zeroes(self):
        for raw, expected in [('', ''), ('0', '0'), ('0001', '0,001'),
                              ('1234567', '1,234,567'), ('000000', '000,000')]:
            self.assertEqual(group_digits(raw), expected)

    def test_grouping_never_round_trips_through_number(self):
        self.assertEqual(group_digits('9007199254740993'), '9,007,199,254,740,993')

    def test_zero_and_short_leading_zero_reading(self):
        for raw in ['', '0', '0000', '000000000000']:
            self.assertEqual(reading_english(raw, self.labels), '')
        self.assertEqual(reading_english('000001000001', self.labels), '1  M,1 ')

    def test_nonzero_magnitude_groups_and_native_spaces(self):
        for raw, expected in [('1', '1 '), ('1000', '1 K'), ('1001', '1 K,1 '),
                              ('1000000', '1  M'), ('1001000000', '1  B,1  M'),
                              ('2147483647', '2  B,147  M,483 K,647 ')]:
            self.assertEqual(reading_english(raw, self.labels), expected)

    def test_length_branch_precedes_leading_zero_removal(self):
        self.assertEqual(reading_english('0000000000000', self.labels), '0,000,000,000,000')
        self.assertEqual(reading_english('1000000000000', self.labels), '1,000,000,000,000')
        self.assertEqual(reading_english('999999999999', self.labels), '999  B,999  M,999 K,999 ')

    def test_numeric_colors_count_digits_not_value(self):
        expected = ['#DCDCDC']*5 + ['#00FFFF', '#FF80FF', '#FFFF00', '#00FF00', '#00FFFF']
        for count, color in enumerate(expected):
            self.assertEqual(number_color('0'*count), color)
            self.assertEqual(number_color(group_digits('0'*count)), color)
        self.assertEqual(number_color('0,000,000'), '#FFFF00')

    def test_unsupported_input_does_not_become_guessed_numeric_value(self):
        for invalid in [None, 12, '-1', '+1', '1.5', '1e3', ' 12', '\u0661', '１']:
            for fn in [group_digits, lambda x: reading_english(x, self.labels), number_color]:
                with self.assertRaises(ValueError): fn(invalid)
        for fn in [group_digits, lambda x: reading_english(x, self.labels)]:
            with self.assertRaises(ValueError): fn('1,000')


if __name__ == '__main__':
    unittest.main()
