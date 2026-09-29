"""Portable authored class-prefix fixtures; no original client bytes."""

import hashlib
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from l2lib import L2Error, Reader, encode_compact
from l2lib.classdata import (
    read_class_default_prefix,
    read_class_script,
    materialize_class_script,
)


def class_fixture(script=b"", memory=0, defaults=b"\0"):
    names = ["None", "AuthoredClass", "FalseAlias", "Config", "Category"] + [
        "Unused"
    ] * 127
    names[131] = "CorrectField"
    refs = [-1, 0, -65, 3, 1, 0]
    prefix = b"".join(encode_compact(n) for n in refs) + struct.pack(
        "<iii", 17, -8, memory
    )
    script_start = len(prefix)
    prefix += script
    prefix += struct.pack("<QQHI", 0x8000000000000001, 0xFFFFFFFFFFFFFFFF, 0xFFFF, 0x80)
    flags_offset = len(prefix)
    prefix += struct.pack("<5I", 0x1234, 11, 22, 33, 44)
    prefix += encode_compact(2)
    prefix += encode_compact(-65) + struct.pack("<II", 0x80000000, 0xFFFFFFFF)
    prefix += encode_compact(70) + struct.pack("<II", 1, 2)
    prefix += encode_compact(2) + encode_compact(3) + encode_compact(4)
    prefix += encode_compact(-1) + encode_compact(3)
    prefix += encode_compact(1) + encode_compact(4)
    origin = 9
    export = SimpleNamespace(
        serial_offset=origin,
        serial_size=len(prefix) + len(defaults),
        super_index=-1,
        object_flags=0,
    )
    package = SimpleNamespace(
        data=b"outside!!" + prefix + defaults + b"next export must stay unread",
        path="authored.u",
        file_version=123,
        names=names,
        imports=[None] * 128,
        exports=[export] + [None] * 127,
        name=lambda i: names[i],
        export_name=lambda e: "AuthoredClass",
        class_name_of=lambda e: "Class",
    )
    return (
        package,
        export,
        dict(
            prefix=prefix,
            scriptOffset=origin + script_start,
            flagsOffset=origin + flags_offset,
            defaultsOffset=len(prefix),
        ),
    )


class ClassPrefixTest(unittest.TestCase):
    def test_empty_script_follows_arrays_and_native_fields_to_exact_defaults(self):
        package, export, expected = class_fixture()
        result = read_class_default_prefix(package, export)
        self.assertEqual(result["defaultsOffset"], expected["defaultsOffset"])
        self.assertEqual(result["flagsOffset"], expected["flagsOffset"])
        self.assertEqual(
            result["sourceSHA256"], hashlib.sha256(expected["prefix"]).hexdigest()
        )
        self.assertEqual(result["references"], [-1, 0, -65, 3, 0])
        self.assertEqual(
            result["fields"],
            {
                "0x4a4": 0x1234,
                "0x4ac": [11, 22, 33, 44],
                "0x4dc": [
                    dict(reference=-65, word4=0x80000000, word8=0xFFFFFFFF),
                    dict(reference=70, word4=1, word8=2),
                ],
                "0x4e8": [3, 4],
                "0x4bc": -1,
                "0x4c0": 3,
                "0x500": [4],
            },
        )
        self.assertEqual(result["script"]["sourceBytes"], 0)
        self.assertEqual(result["state"]["probeMask"], 0x8000000000000001)

    def test_nested_script_tracks_compact_reference_bytes_separately_from_memory(self):
        # Native call(cast(object ref), word-wrapped(context ref(byte value))).
        script = (
            b"\x77\x39\x04\x01"
            + encode_compact(-65)
            + b"\x18\x34\x12\x2e"
            + encode_compact(70)
            + b"\x24\x99\x16"
        )
        package, export, expected = class_fixture(script, 19)
        result = read_class_default_prefix(package, export)
        self.assertEqual(result["defaultsOffset"], expected["defaultsOffset"])
        self.assertEqual(result["script"]["sourceBytes"], len(script))
        self.assertEqual(result["script"]["memoryBytes"], 19)
        tokens = result["script"]["tokens"]
        self.assertEqual(
            [t["token"] for t in tokens], [0x77, 0x39, 1, 0x18, 0x2E, 0x24, 0x16]
        )
        self.assertEqual(
            [t["reference"] for t in tokens if "reference" in t], [-65, 70]
        )
        self.assertEqual(tokens[0]["offset"], expected["scriptOffset"])
        self.assertEqual([t["memoryOffset"] for t in tokens], [0, 1, 3, 8, 11, 16, 18])
        self.assertEqual(
            [t["expressionEnd"] for t in tokens], [19, 8, 8, 18, 18, 18, 19]
        )

    def test_materialized_script_uses_explicit_dword_bindings(self):
        package, _, _ = class_fixture()
        saved = (
            b"\x77\x01"
            + encode_compact(-65)
            + b"\x18\x34\x12\x2e"
            + encode_compact(70)
            + b"\x24\xff\x16"
        )
        decoded = read_class_script(package, Reader(saved), 17)
        loaded = materialize_class_script(decoded, {-65: 0xFFFFFFFF, 70: 0x12345678})
        self.assertEqual(
            loaded,
            b"\x77\x01\xff\xff\xff\xff\x18\x34\x12\x2e\x78\x56\x34\x12\x24\xff\x16",
        )
        for bindings in (
            {},
            {-65: 1},
            {-65: True, 70: 0},
            {-65: -1, 70: 0},
            {-65: 0x100000000, 70: 0},
        ):
            with self.assertRaises(L2Error):
                materialize_class_script(decoded, bindings)
        self.assertEqual(decoded["tokens"][1]["reference"], -65)

    def test_expression_boundaries_include_nested_terminators_not_following_roots(self):
        package, _, _ = class_fixture()
        decoded = read_class_script(package, Reader(b"\x70\x71\x16\x16\x25"), 5)
        self.assertEqual(
            [t["expressionEnd"] for t in decoded["tokens"]], [4, 3, 3, 4, 5]
        )
        self.assertEqual(materialize_class_script(decoded, {}), b"\x70\x71\x16\x16\x25")
        decoded["tokens"][1]["memoryOffset"] = 8
        with self.assertRaisesRegex(L2Error, "noncontiguous"):
            materialize_class_script(decoded, {})

    def test_default_boundary_never_starts_inside_a_multibyte_property_name(self):
        tags = encode_compact(131) + b"\x24" + struct.pack("<f", 7.5) + b"\0"
        package, export, expected = class_fixture(defaults=tags)
        result = read_class_default_prefix(package, export)
        reader = Reader(package.data, export.serial_offset + result["defaultsOffset"])
        self.assertEqual(package.name(reader.compact()), "CorrectField")
        other = Reader(
            package.data, export.serial_offset + expected["defaultsOffset"] + 1
        )
        self.assertEqual(package.name(other.compact()), "FalseAlias")

    def test_script_rejects_unknown_tokens_wrong_lengths_and_unfinished_native_arguments(
        self,
    ):
        for script, size in [
            (b"\x03", 1),
            (b"\x01\x01", 4),
            (b"\x77\x25", 2),
            (b"\x39\0", 2),
            (b"\x24", 2),
        ]:
            package, _, _ = class_fixture()
            with self.subTest(script=script.hex(), size=size), self.assertRaises(
                L2Error
            ):
                read_class_script(package, Reader(script), size)
        for size in [-1, 1.5, True, 0x80000000]:
            with self.assertRaises(L2Error):
                read_class_script(package, Reader(b""), size)

    def test_deep_nesting_uses_a_parser_stack_not_a_game_depth_limit(self):
        package, _, _ = class_fixture()
        script = b"\x39\0" * 1500 + b"\x25"
        result = read_class_script(package, Reader(script), len(script))
        self.assertEqual(result["sourceBytes"], len(script))
        self.assertEqual(len(result["tokens"]), 1501)

    def test_prefix_cannot_borrow_the_next_export_for_truncated_arrays_or_defaults(
        self,
    ):
        package, export, expected = class_fixture()
        for length in range(1, len(expected["prefix"]) + 1):
            export.serial_size = length
            with self.subTest(length=length), self.assertRaises(L2Error):
                read_class_default_prefix(package, export)

    def test_wrong_identity_version_reference_name_and_counts_are_rejected(self):
        for change in [
            lambda p, e: setattr(p, "file_version", 122),
            lambda p, e: setattr(e, "super_index", 0),
            lambda p, e: setattr(e, "object_flags", 0x02000000),
            lambda p, e: setattr(p, "imports", []),
            lambda p, e: setattr(p, "name", lambda i: "Wrong"),
            lambda p, e: setattr(e, "serial_offset", -1),
        ]:
            package, export, _ = class_fixture()
            change(package, export)
            with self.assertRaises(L2Error):
                read_class_default_prefix(package, export)
        package, export, expected = class_fixture()
        for bad in [b"\x80", b"\x3f"]:
            offset = expected["flagsOffset"] + 20
            package.data = package.data[:offset] + bad + package.data[offset + 1 :]
            with self.assertRaises(L2Error):
                read_class_default_prefix(package, export)

    def test_noncanonical_compact_values_and_out_of_table_script_references_fail(self):
        package, _, _ = class_fixture()
        for ref in [b"\x40\0", encode_compact(129), encode_compact(-129)]:
            with self.assertRaises(L2Error):
                read_class_script(package, Reader(b"\x01" + ref), 5)


if __name__ == "__main__":
    unittest.main()
