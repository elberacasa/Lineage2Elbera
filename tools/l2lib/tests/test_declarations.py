"""Authored file-123 property declarations; no original client bytes."""

from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from l2lib import L2Error, encode_compact
from l2lib.declarations import (
    read_property_declaration,
    read_field_link,
    read_field_chain,
    read_struct_children,
    SCALAR_KINDS,
    REFERENCE_KINDS,
)


def fixture(
    kind="StructProperty",
    *,
    flags=0x21,
    dimension=1,
    replication=0x7391,
    reference=-1,
    metaclass=-2
):
    raw = b"\0\0\0" + struct.pack("<iI", dimension, flags) + b"\1"
    if flags & 0x20:
        raw += struct.pack("<H", replication)
    if kind in REFERENCE_KINDS:
        raw += encode_compact(reference)
    if kind == "ClassProperty":
        raw += encode_compact(metaclass)
    export = SimpleNamespace(
        index=0,
        serial_offset=5,
        serial_size=len(raw),
        object_flags=0,
        package_index=0,
        label="AuthoredField",
    )
    imports = [
        SimpleNamespace(label="AuthoredType", package_index=-2),
        SimpleNamespace(label="Source", package_index=0),
    ]
    names = ["None", "Category"]
    pkg = SimpleNamespace(
        data=b"guard" + raw + b"neighbor",
        path="Fixture.u",
        file_version=123,
        imports=imports,
        exports=[export],
        names=names,
        name=lambda n: names[n],
        class_name_of=lambda e: kind,
        export_name=lambda e: e.label,
        import_name=lambda e: e.label,
        resolve_ref=lambda n: imports[-n - 1] if n < 0 else export,
    )
    return pkg, export


class PropertyDeclarationTest(unittest.TestCase):
    def test_structure_child_prefix_has_its_own_tag_terminator(self):
        pkg, ex = fixture()
        pkg.class_name_of = lambda _: "Struct"
        ex.super_index = 0
        ex.serial_size = 5
        pkg.data = b"guard" + b"\0\0\0\0\1" + b"neighbor"
        row = read_struct_children(pkg, ex)
        self.assertEqual(
            (row["super"], row["scriptText"], row["children"], row["sourceBytes"]),
            (0, 0, 1, 5),
        )
        for size in range(5):
            ex.serial_size = size
            with self.assertRaises(L2Error):
                read_struct_children(pkg, ex)

    def test_structure_prefix_rejects_different_export_super_and_class_shape(self):
        pkg, ex = fixture()
        pkg.class_name_of = lambda _: "Struct"
        ex.super_index = -1
        with self.assertRaisesRegex(L2Error, "superclass"):
            read_struct_children(pkg, ex)
        pkg.class_name_of = lambda _: "Class"
        with self.assertRaises(L2Error):
            read_struct_children(pkg, ex)

    def test_field_prefix_does_not_consume_or_claim_the_function_body(self):
        pkg, ex = fixture()
        pkg.class_name_of = lambda _: "Function"
        ex.serial_size = 3
        row = read_field_link(pkg, ex)
        self.assertEqual((row["super"], row["next"], row["sourceBytes"]), (0, 0, 3))
        for length in (0, 1, 2):
            ex.serial_size = length
            with self.assertRaises(L2Error):
                read_field_link(pkg, ex)

    def test_field_chain_follows_links_not_export_order_and_stops_at_foreign_owner(
        self,
    ):
        pkg, ex = fixture()
        owner = SimpleNamespace(index=3)
        pkg.data = b"guard" + b"\0\0\3" + b"\0\0\0" + b"\0\0\2"
        pkg.exports = [
            SimpleNamespace(
                index=i,
                serial_offset=5 + i * 3,
                serial_size=3,
                object_flags=0,
                package_index=4,
                label=str(i),
            )
            for i in range(3)
        ]
        pkg.class_name_of = lambda e: "Function" if e.index == 2 else "IntProperty"
        result = read_field_chain(pkg, owner, 1)
        self.assertEqual([r["exportRef"] for r in result["fields"]], [1, 3, 2])
        self.assertEqual(result["stoppedAt"], 0)
        pkg.exports[2].package_index = 9
        result = read_field_chain(pkg, owner, 1)
        self.assertEqual([r["exportRef"] for r in result["fields"]], [1])
        self.assertEqual(result["stoppedAt"], 3)
        pkg.exports[2].package_index = 4
        pkg.data = pkg.data[:-1] + b"\1"
        with self.assertRaisesRegex(L2Error, "cyclic"):
            read_field_chain(pkg, owner, 1)
        with self.assertRaises(L2Error):
            read_field_chain(pkg, owner, -1)

    def test_network_word_precedes_type_reference_and_retains_nonzero_value(self):
        pkg, ex = fixture()
        row = read_property_declaration(pkg, ex)
        self.assertEqual(row["replicationOffset"], 0x7391)
        self.assertEqual(row["referenceIndex"], -1)
        self.assertEqual(row["reference"], "Source.AuthoredType")
        self.assertEqual(row["category"], "Category")
        # A zero network word is still two serialized bytes, never a null type.
        pkg, ex = fixture(replication=0)
        self.assertEqual(
            read_property_declaration(pkg, ex)["reference"], "Source.AuthoredType"
        )

    def test_nonnetworked_kinds_do_not_consume_an_extra_word(self):
        for kind in SCALAR_KINDS | REFERENCE_KINDS:
            pkg, ex = fixture(kind, flags=0x8001)
            row = read_property_declaration(pkg, ex)
            self.assertIsNone(row["replicationOffset"])
            self.assertEqual(
                row["referenceIndex"], -1 if kind in REFERENCE_KINDS else 0
            )

    def test_class_property_retains_both_references_and_nulls(self):
        pkg, ex = fixture("ClassProperty")
        row = read_property_declaration(pkg, ex)
        self.assertEqual(
            (row["reference"], row["metaClass"]), ("Source.AuthoredType", "Source")
        )
        pkg, ex = fixture("ClassProperty", reference=0, metaclass=0)
        row = read_property_declaration(pkg, ex)
        self.assertEqual((row["reference"], row["metaClass"]), (None, None))

    def test_dimensions_are_saved_signed_values_not_linked_size_claims(self):
        for dimension in (-1, 0, 1, 6, 0x7FFFFFFF):
            pkg, ex = fixture(dimension=dimension)
            self.assertEqual(read_property_declaration(pkg, ex)["arrayDim"], dimension)

    def test_every_truncation_is_bounded_even_with_an_adjacent_export(self):
        pkg, ex = fixture("ClassProperty")
        size = ex.serial_size
        for length in range(size):
            ex.serial_size = length
            with self.assertRaises(L2Error):
                read_property_declaration(pkg, ex)
        ex.serial_size = size + 1
        with self.assertRaisesRegex(L2Error, "boundary"):
            read_property_declaration(pkg, ex)

    def test_unsupported_headers_and_references_do_not_get_guessed(self):
        for change in (
            lambda p, e: setattr(p, "file_version", 122),
            lambda p, e: setattr(e, "object_flags", 0x02000000),
            lambda p, e: setattr(p, "class_name_of", lambda _: "UnknownProperty"),
            lambda p, e: setattr(p, "data", p.data[:5] + b"\1" + p.data[6:]),
            lambda p, e: setattr(p, "data", p.data[:6] + b"\1" + p.data[7:]),
        ):
            pkg, ex = fixture()
            change(pkg, ex)
            with self.assertRaises(L2Error):
                read_property_declaration(pkg, ex)
        pkg, ex = fixture(reference=-3)
        with self.assertRaises(L2Error):
            read_property_declaration(pkg, ex)

    def test_noncanonical_compact_reference_does_not_shift_neighbor_fields(self):
        pkg, ex = fixture(flags=0, reference=0)
        end = ex.serial_offset + ex.serial_size
        pkg.data = pkg.data[: end - 1] + b"\x40\0" + pkg.data[end:]
        ex.serial_size += 1
        with self.assertRaisesRegex(L2Error, "noncanonical"):
            read_property_declaration(pkg, ex)


if __name__ == "__main__":
    unittest.main()
