"""Portable authored property layout boundaries; no private client inputs."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from l2lib import L2Error
from l2lib.propertylayout import (
    consensus_flag_bits,
    property_offsets,
    linked_properties,
    structure_layouts,
    property_link_flags,
    property_lists,
    structure_links,
)


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
    def test_flag_consensus_keeps_only_agreed_consumed_bits(self):
        for variants, expected in (
            ([0, 0xFFDFFFFF], 0),
            ([0x200000, 0xFFFFFFFF], 0x200000),
            ([0xFFFFFFFF], 0x200000),
        ):
            self.assertEqual(
                consensus_flag_bits(iter(variants), 0x200000),
                dict(mask=0x200000, value=expected),
            )
        with self.assertRaisesRegex(L2Error, "disagree"):
            consensus_flag_bits([0, 0x200000], 0x200000)
        for variants in ([], [True], [-1], [0x100000000], [None]):
            with self.assertRaises(L2Error):
                consensus_flag_bits(variants, 0x200000)
        for mask in (0, -1, True, None, 0x100000000):
            with self.assertRaises(L2Error):
                consensus_flag_bits([0], mask)

    def test_object_links_accept_known_consumed_bit_without_a_full_class_word(self):
        for kind in ("Object", "Class"):
            for value, expected in ((0, 0), (0x200000, 0x400000)):
                for noise in (0, 0x80000000):
                    self.assertEqual(
                        property_link_flags(
                            dict(
                                field(kind),
                                propertyFlags=0,
                                referenceFlags=dict(
                                    mask=0x200000 | noise, value=value | noise
                                ),
                            )
                        ),
                        expected,
                    )
            for profile in (
                {},
                dict(mask=0, value=0),
                dict(mask=0x100000, value=0),
                dict(mask=0x200000, value=1),
                dict(mask=True, value=0),
                dict(mask=0x200000, value=False),
                dict(mask=-1, value=0),
                dict(mask=0x100000000, value=0),
                dict(mask=0x200000, value=0x100000000),
            ):
                with self.assertRaisesRegex(L2Error, "unknown or invalid"):
                    property_link_flags(
                        dict(field(kind), propertyFlags=0, referenceFlags=profile)
                    )
            # The native short circuit never consults referenced-class bits.
            self.assertEqual(
                property_link_flags(dict(field(kind), propertyFlags=0x4000008)),
                0x4400008,
            )

    def test_masked_class_bits_propagate_through_structure_constructor_lists(self):
        leaf = structure(
            "Example.Leaf",
            [
                dict(
                    field("Object"),
                    propertyFlags=0,
                    reference="Example.Actor",
                )
            ],
        )
        outer = structure(
            "Example.Outer",
            [
                dict(
                    field("Struct"),
                    propertyFlags=0,
                    reference="Example.Leaf",
                )
            ],
        )
        for value in (0, 0x200000):
            result = structure_links(
                [outer, leaf],
                {
                    "EXAMPLE.ACTOR": dict(mask=0x200000, value=value),
                },
            )
            self.assertTrue(all(r["status"] == "ready" for r in result.values()))
            self.assertEqual(
                result["example.outer"]["lists"]["0x78"],
                ["Example.Outer.Field0"] if value else [],
            )
        result = structure_links(
            [outer, leaf], {"Example.Actor": dict(mask=1, value=0)}
        )
        self.assertTrue(all(r["status"] == "unsupported" for r in result.values()))
        self.assertNotIn("referenceFlags", leaf["fields"][0])

    def test_structure_links_resolve_nested_flags_and_preserve_saved_words(self):
        leaf = structure("Example.Leaf", [dict(field("Str"), propertyFlags=0)])
        parent = structure(
            "Example.Parent", [dict(field("Name"), propertyFlags=0x4000)]
        )
        child = structure(
            "Example.Child",
            [dict(field("Struct"), propertyFlags=0, reference="Example.Leaf")],
            "Example.Parent",
        )
        result = structure_links([child, parent, leaf])
        linked = result["example.child"]
        self.assertEqual(linked["status"], "ready")
        self.assertEqual(linked["ownFields"][0]["propertyFlags"], 0x400000)
        self.assertEqual(linked["ownFields"][0]["savedPropertyFlags"], 0)
        self.assertEqual(
            linked["lists"]["0x70"], ["Example.Child.Field0", "Example.Parent.Field0"]
        )
        self.assertEqual(linked["lists"]["0x78"], ["Example.Child.Field0"])
        self.assertEqual(linked["lists"]["0x74"], ["Example.Parent.Field0"])
        self.assertEqual(leaf["fields"][0]["propertyFlags"], 0)
        self.assertNotIn("savedPropertyFlags", child["fields"][0])

    def test_structure_reference_gaps_propagate_until_explicit_current_flags_arrive(
        self,
    ):
        referenced = structure(
            "Example.Reference",
            [dict(field("Object"), propertyFlags=0, reference="Example.Actor")],
        )
        outer = structure(
            "Example.Outer",
            [dict(field("Struct"), propertyFlags=0, reference="Example.Reference")],
        )
        for rows in ([outer, referenced], [referenced, outer]):
            unknown = structure_links(rows)
            self.assertTrue(all(r["status"] == "unsupported" for r in unknown.values()))
            known = structure_links(rows, {"example.actor": 0x200000})
            self.assertTrue(all(r["status"] == "ready" for r in known.values()))
            self.assertEqual(
                known["example.outer"]["lists"]["0x78"], ["Example.Outer.Field0"]
            )
        for mapping in (0, False, {"Example.Actor": 0, "example.actor": 0}):
            with self.assertRaises(L2Error):
                structure_links([referenced], mapping)

    def test_string_and_structure_link_flags_preserve_preexisting_bits(self):
        for initial, expected in (
            (0, 0x400000),
            (0x1000, 0x1000),
            (0x401000, 0x401000),
        ):
            self.assertEqual(
                property_link_flags(dict(field("Str"), propertyFlags=initial)), expected
            )
            self.assertEqual(
                property_link_flags(
                    dict(
                        field("Struct"),
                        propertyFlags=initial,
                        structConstructorLink=True,
                    )
                ),
                expected,
            )
            self.assertEqual(
                property_link_flags(
                    dict(
                        field("Struct"),
                        propertyFlags=initial,
                        structConstructorLink=False,
                    )
                ),
                initial,
            )
        for kind in ("Byte", "Int", "Bool", "Float", "Name"):
            self.assertEqual(
                property_link_flags(dict(field(kind), propertyFlags=0xFFFFFFFF)),
                0xFFFFFFFF,
            )

    def test_object_link_flags_observe_short_circuit_and_current_reference(self):
        for kind in ("Object", "Class"):
            for initial, referenced, expected in (
                (0x4000008, None, 0x4400008),
                (0x4000000, 0, 0x4000000),
                (8, 0, 8),
                (0x1000, 0x200000, 0x401000),
                (0x400000, 0, 0x400000),
                (0, 0x80000000, 0),
            ):
                self.assertEqual(
                    property_link_flags(
                        dict(
                            field(kind),
                            propertyFlags=initial,
                            referenceFlags=referenced,
                        )
                    ),
                    expected,
                )
        for bad in (
            dict(field("Str")),
            dict(field("Str"), propertyFlags=True),
            dict(field("Str"), propertyFlags=-1),
            dict(field("Str"), propertyFlags=0x100000000),
            dict(field("Object"), propertyFlags=0),
            dict(field("Struct"), propertyFlags=0),
            dict(field("Struct"), propertyFlags=0, structConstructorLink=0),
            dict(field("Array"), propertyFlags=0),
        ):
            with self.assertRaises(L2Error):
                property_link_flags(bad)

    def test_four_lists_preserve_supplied_iterator_order_and_distinct_identities(self):
        records = [
            dict(identity="Child.Title", kind="StrProperty", propertyFlags=0x404000),
            dict(identity="Child.Target", kind="ClassProperty", propertyFlags=0),
            dict(identity="Parent.Title", kind="StrProperty", propertyFlags=0x400000),
            dict(
                identity="Parent.Callback",
                kind="DelegateProperty",
                propertyFlags=0x4000,
            ),
            dict(identity="Root.Values", kind="ArrayProperty", propertyFlags=0x400000),
        ]
        result = property_lists(records)
        self.assertEqual(result["0x70"], [r["identity"] for r in records])
        self.assertEqual(
            result["0x6c"], ["Child.Target", "Parent.Callback", "Root.Values"]
        )
        self.assertEqual(result["0x74"], ["Child.Title", "Parent.Callback"])
        self.assertEqual(result["0x78"], ["Child.Title", "Parent.Title", "Root.Values"])
        self.assertEqual(property_lists([]), {h: [] for h in result})
        for bad in (
            records + [records[0]],
            [dict(records[0], identity="")],
            [dict(records[0], propertyFlags=None)],
            [dict(records[0], kind="UnknownProperty")],
        ):
            with self.assertRaises(L2Error):
                property_lists(bad)

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
