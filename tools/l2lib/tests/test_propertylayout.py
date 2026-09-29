"""Portable authored property layout boundaries; no private client inputs."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from l2lib import L2Error
from l2lib.propertylayout import property_offsets


def field(kind, dimension=1):
    return dict(kind=kind + "Property", arrayDim=dimension)


class PropertyLayoutTest(unittest.TestCase):
    def test_byte_packing_scalar_alignment_and_string_header(self):
        fields = [field(k) for k in ("Byte", "Byte", "Name", "Str", "Byte")]
        result = property_offsets(fields, 1)
        self.assertEqual([f["offset"] for f in result["fields"]], [4, 5, 8, 12, 24])
        self.assertEqual(result["propertiesSize"], 28)
        self.assertEqual(result["fields"][3]["elementSize"], 12)
        self.assertTrue(all("offset" not in f for f in fields))

    def test_boolean_word_rollover_and_nonboolean_break(self):
        fields = [field("Bool") for _ in range(33)] + [field("Int"), field("Bool")]
        result = property_offsets(fields, 0)["fields"]
        self.assertEqual(result[31], dict(elementSize=4, offset=0, boolMask=0x80000000))
        self.assertEqual(result[32], dict(elementSize=4, offset=4, boolMask=1))
        self.assertEqual(result[-1], dict(elementSize=4, offset=12, boolMask=1))

    def test_boolean_array_does_not_invent_a_dimension_one_pack_gate(self):
        result = property_offsets(
            [field("Bool", 3), field("Bool"), field("Bool", 2)], 0
        )
        self.assertEqual([f["offset"] for f in result["fields"]], [0, 0, 0])
        self.assertEqual([f["boolMask"] for f in result["fields"]], [1, 2, 4])
        self.assertEqual(result["propertiesSize"], 8)

    def test_missing_layouts_and_overflow_are_not_fabricated(self):
        for parent in (-1, True, 0x7FFFFFFD):
            with self.assertRaises(L2Error):
                property_offsets([], parent)
        for bad in (
            field("Struct"),
            field("Array"),
            field("Int", 0),
            field("Byte", -1),
            field("Bool", True),
            field("Str", 0x7FFFFFFF),
        ):
            with self.assertRaises(L2Error):
                property_offsets([bad], 0)
        with self.assertRaises(L2Error):
            property_offsets([field("Int")], 0x7FFFFFFC)


if __name__ == "__main__":
    unittest.main()
