"""Authored string payloads; portable without any original client files."""

import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from l2lib import L2Error
from l2lib.stringproperty import decode_string_property


class StringPropertyTest(unittest.TestCase):
    def test_byte_loading_zero_widens_and_retains_embedded_nul_storage(self):
        result = decode_string_property(b"\x05\x80\xff\0Z\0")
        self.assertEqual(result["codeUnits"], [128, 255, 0, 90, 0])
        self.assertEqual(result["value"], "\x80ÿ")
        self.assertEqual(
            (result["savedCount"], result["count"], result["capacity"]), (5, 5, 5)
        )

    def test_utf16_keeps_unpaired_surrogates_and_supplementary_characters(self):
        for payload, units, text in (
            (b"\x82\0\xd8\0\0", [0xD800, 0], "\ud800"),
            (b"\x82\xff\xdf\0\0", [0xDFFF, 0], "\udfff"),
            (b"\x83\x3c\xd8\x0a\xdf\0\0", [0xD83C, 0xDF0A, 0], "🌊"),
        ):
            result = decode_string_property(payload)
            self.assertEqual(result["codeUnits"], units)
            self.assertEqual(result["value"], text)
            self.assertEqual(result["savedCount"], -len(units))

    def test_original_count_one_emptying_does_not_depend_on_unit_value(self):
        for payload in (b"\0", b"\x01\0", b"\x01Z", b"\x81\0\0", b"\x81\0\xd8"):
            result = decode_string_property(payload)
            self.assertEqual(
                (
                    result["codeUnits"],
                    result["value"],
                    result["count"],
                    result["capacity"],
                ),
                ([], "", 0, 0),
            )

    def test_compact_continuation_and_negative_zero(self):
        self.assertEqual(
            decode_string_property(b"\x40\x01" + b"a" * 63 + b"\0")["count"], 64
        )
        self.assertEqual(decode_string_property(b"\x80")["codeUnits"], [])

    def test_rejects_truncation_extra_bytes_unterminated_and_overflow(self):
        for payload in (
            b"",
            b"\x40",
            b"\x02a",
            b"\x82a\0",
            b"\0x",
            b"\x02ab",
            b"\x40\x80\x80\x80\x04",
            b"\x40\x80\x80\x80\x80\0",
        ):
            with self.subTest(payload=payload), self.assertRaises(L2Error):
                decode_string_property(payload)
        with self.assertRaises(L2Error):
            decode_string_property(bytearray(b"\0"))


if __name__ == "__main__":
    unittest.main()
