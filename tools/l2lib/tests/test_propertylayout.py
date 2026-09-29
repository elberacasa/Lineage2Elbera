"""Portable authored property layout boundaries; no private client inputs."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from l2lib import L2Error
from l2lib.propertylayout import property_offsets, linked_properties, structure_layouts


def field(kind, dimension=1):
    return dict(kind=kind + "Property", arrayDim=dimension)


def structure(name, fields, parent=None):
    declared = [
        dict(f, exportRef=i + 1, name="Field" + str(i)) for i, f in enumerate(fields)
    ]
    return dict(
        identity=name,
        savedSuper=parent,
        fields=list(reversed(declared)),
        fieldChain=dict(
            stoppedAt=0,
            fields=[
                dict(exportRef=f["exportRef"], name=f["name"], kind=f["kind"])
                for f in declared
            ],
        ),
    )


class PropertyLayoutTest(unittest.TestCase):
    def test_nested_alignment_uses_explicit_size_not_field_name(self):
        for size, offset in ((0, 1), (1, 1), (2, 2), (3, 1), (4, 4), (12, 4)):
            nested = dict(field("Struct", 2), structSize=size)
            result = property_offsets([field("Byte"), nested], 0)
            self.assertEqual(result["fields"][1], dict(offset=offset, elementSize=size))
        for size in (None, True, -1, 0x80000000):
            with self.assertRaises(L2Error):
                property_offsets([dict(field("Struct"), structSize=size)], 0)

    def test_structure_graph_resolves_parents_and_nested_fields_in_link_order(self):
        leaf = structure("Example.Leaf", [field("Byte"), field("Float")])
        derived = structure("Example.Derived", [field("Name")], parent="Example.Leaf")
        nested = structure(
            "Example.Outer",
            [field("Byte"), dict(field("Struct", 2), reference="example.derived")],
        )
        result = structure_layouts([nested, derived, leaf])
        self.assertEqual(result["example.leaf"]["propertiesSize"], 8)
        self.assertEqual(result["example.derived"]["fields"][0]["offset"], 8)
        self.assertEqual(result["example.outer"]["propertiesSize"], 28)
        self.assertNotIn("structSize", nested["fields"][0])

    def test_missing_or_cyclic_graphs_and_inconsistent_chains_fail(self):
        missing = structure(
            "Example.Outer", [dict(field("Struct"), reference="Missing.Type")]
        )
        with self.assertRaisesRegex(L2Error, "missing structure"):
            structure_layouts([missing])
        a = structure("Example.A", [], "Example.B")
        b = structure("Example.B", [], "Example.A")
        with self.assertRaisesRegex(L2Error, "cyclic"):
            structure_layouts([a, b])
        a = structure("Example.A", [dict(field("Struct"), reference="Example.A")])
        with self.assertRaisesRegex(L2Error, "cyclic"):
            structure_layouts([a])
        for change in (
            lambda row: row["fieldChain"].update(stoppedAt=9),
            lambda row: row["fieldChain"]["fields"].clear(),
            lambda row: row["fieldChain"]["fields"][0].update(kind="ByteProperty"),
            lambda row: row["fieldChain"]["fields"].append(
                row["fieldChain"]["fields"][0]
            ),
        ):
            row = structure("Example.A", [field("Int")])
            change(row)
            with self.assertRaises(L2Error):
                linked_properties(row)

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
