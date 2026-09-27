"""Elbera Tools: portable control-word arithmetic; no original files needed."""
import unittest
from check_animation_fpu_native import (
    abstract_mask, hardware_mask, startup_precision_word, truncate_rounding_word,
)


class AnimationFpuTests(unittest.TestCase):
    def test_single_exception_bit_mappings(self):
        # Hardware x87 word -> Microsoft CRT API mask. Order intentionally
        # follows exception meanings, not either function's implementation.
        for hardware, api in [(4, 8), (1, 16), (32, 1), (2, 0x80000), (16, 2), (8, 4)]:
            with self.subTest(hardware=hardware):
                self.assertEqual(abstract_mask(hardware), api)
                self.assertEqual(hardware_mask(api), hardware)

    def test_precision_change_does_not_invent_exception_masks(self):
        self.assertEqual(startup_precision_word(0x037f), 0x027f)
        self.assertEqual(startup_precision_word(0x0300), 0x0200)
        self.assertEqual(startup_precision_word(0x0f7b), 0x0e7b)
        self.assertEqual(abstract_mask(startup_precision_word(0x0300)), 0)

    def test_rounding_change_keeps_precision_and_exception_masks(self):
        self.assertEqual(truncate_rounding_word(0x027f), 0x0e7f)
        self.assertEqual(truncate_rounding_word(0x0200), 0x0e00)
        self.assertEqual(truncate_rounding_word(0x0e7f), 0x0e7f)

    def test_all_16bit_patterns_preserve_exception_bits(self):
        for value in range(65536):
            self.assertEqual(startup_precision_word(value) & 0x3f, value & 0x3f)
            self.assertEqual(truncate_rounding_word(value) & 0x3f, value & 0x3f)

    def test_invalid_words_rejected(self):
        for function in (abstract_mask, startup_precision_word, truncate_rounding_word):
            for value in (-1, 65536, 1.0, True, None):
                with self.subTest(function=function.__name__, value=value):
                    with self.assertRaises(ValueError): function(value)
        for value in (-1, 0x100000000, False, None):
            with self.assertRaises(ValueError): hardware_mask(value)


if __name__ == '__main__':
    unittest.main()
