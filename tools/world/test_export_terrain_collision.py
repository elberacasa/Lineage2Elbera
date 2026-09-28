"""Source-free Elbera Tools terrain input tests; all bytes below are authored."""

from pathlib import Path
from types import SimpleNamespace as NS
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_terrain_collision as m
from l2lib import L2Error
from l2lib.ue2package import encode_compact as ci

FORWARD = [1.0, 2.0, 30000.0, 128.0, 0.0, 0.0, 0.0, 128.0, 0.0, 0.0, 0.0, 0.296875]
INVERSE = [
    -128.0,
    -256.0,
    -8906.25,
    0.0078125,
    0.0,
    0.0,
    0.0,
    0.0078125,
    0.0,
    0.0,
    0.0,
    m.float32(256 / 76),
]


def actor_fixture():
    names = ["None", "TerrainMap"]
    state = ci(-1) + ci(-1) + struct.pack("<iii", -1, -1, 0) + ci(-1)
    # One-byte Object payload, then None terminator. The property value is
    # an authored import reference; no real client export bytes are copied.
    properties = ci(1) + bytes([5]) + ci(-3) + ci(0)
    sectors = ci(256) + b"".join(ci(i) for i in range(2, 258))
    tail = sectors + struct.pack("<2i24f2i", 16, 16, *(FORWARD + INVERSE), 256, 256)
    body = state + properties + tail
    export = NS(index=0, class_index=-1, serial_offset=0, serial_size=len(body))
    pkg = NS(
        data=body + b"outside export must not be consumed",
        path="synthetic",
        file_version=123,
        licensee_version=25,
        name=lambda i: names[i],
        exports=[export] + [NS(index=i, class_index=-2) for i in range(1, 257)],
    )
    refs = {
        -1: "Engine.TerrainInfo",
        -2: "Engine.TerrainSector",
        -3: "MapTex.Height.Test",
    }
    return pkg, export, refs


class TerrainInputTests(unittest.TestCase):
    def parse(self, pkg, export, refs):
        with patch.object(m, "qualified_objref", side_effect=lambda _p, r: refs[r]):
            return m.parse_terrain_prefix(pkg, export)

    def test_bounded_source_prefix_reads_saved_values(self):
        p, e, refs = actor_fixture()
        result = self.parse(p, e, refs)
        self.assertEqual(result["terrainMap"], "MapTex.Height.Test")
        self.assertEqual(result["forward"], FORWARD)
        self.assertEqual(result["inverse"], INVERSE)
        self.assertEqual(result["evidence"]["remainingNativeBytes"], 0)
        self.assertEqual(result["evidence"]["nativePrefixBytes"], e.serial_size)

    def test_export_truncation_cannot_read_following_bytes(self):
        for missing in (1, 2, 7, 24, 96, 300):
            p, e, refs = actor_fixture()
            e.serial_size -= missing
            with self.assertRaises((L2Error, ValueError)):
                self.parse(p, e, refs)

    def test_class_version_and_state_offset_are_not_guessed(self):
        for mutate in ("version", "class", "offset"):
            p, e, refs = actor_fixture()
            if mutate == "version":
                p.licensee_version = 16
            if mutate == "class":
                refs[-1] = "Other.TerrainInfo"
            if mutate == "offset":
                p.data = p.data[:14] + ci(0) + p.data[15:]
            with self.assertRaises(ValueError):
                self.parse(p, e, refs)
        p, e, refs = actor_fixture()
        p.data = p.data[:10] + struct.pack("<I", 0x720065) + p.data[14:]
        self.assertEqual(
            self.parse(p, e, refs)["evidence"]["stateFrameWord32"], 0x720065
        )

    def test_sector_references_must_cover_exact_local_exports(self):
        p, e, refs = actor_fixture()
        p.exports[-1].index = 2560
        with self.assertRaisesRegex(ValueError, "sector reference identity"):
            self.parse(p, e, refs)

    def test_native_dimensions_and_nonfinite_coords_refused(self):
        for offset, value in (
            (-8, struct.pack("<i", 257)),
            (-104, struct.pack("<f", float("inf"))),
        ):
            p, e, refs = actor_fixture()
            at = e.serial_size + offset
            p.data = p.data[:at] + value + p.data[at + 4 :]
            with self.assertRaises(ValueError):
                self.parse(p, e, refs)

    def test_exact_grouped_reference_never_falls_back_to_basename(self):
        first, second = NS(index=0, class_index=-1), NS(index=1, class_index=-1)
        pkg = NS(exports=[first, second])
        refs = {1: "T.One.Same", 2: "T.Two.Same", -1: "Engine.Texture"}
        with patch.object(m, "qualified_objref", side_effect=lambda _p, r: refs[r]):
            self.assertIs(m.unique_export(pkg, "t.two.same", "Engine.Texture"), second)
            for requested in ("Same", "T.Same", "T.Missing.Same"):
                with self.assertRaises(ValueError):
                    m.unique_export(pkg, requested, "Engine.Texture")
            refs[1] = "T.Two.Same"
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                m.unique_export(pkg, "T.Two.Same", "Engine.Texture")

    def test_original_vertices_and_postload_bits_are_distinct_from_added_seams(self):
        raw = bytearray(131072)
        struct.pack_into("<H", raw, 2 * (17 * 256 + 9), 32123)
        words = [0] * 2048
        edge = [0] * 2048
        edge[17 * 8] |= 1 << 9
        record = m.prepared_input(
            bytes(raw), FORWARD, INVERSE, words, edge, inverted=False, delete_me=False
        )
        self.assertEqual(
            record["vertices"][17 * 256 + 9],
            [1024.0, 1920.0, m.float32(2123 * 0.296875)],
        )
        self.assertEqual(len(record["vertices"]), 65536)
        self.assertEqual(record["vertices"][255][0], 254 * 128)
        self.assertFalse(record["visibility"][254])
        self.assertTrue(record["visibility"][255])
        self.assertTrue(all(record["visibility"][-256:]))
        self.assertTrue(record["edgeTurn"][17 * 256 + 9])
        self.assertEqual(sum(record["edgeTurn"]), 1)
        self.assertEqual(words, [0] * 2048)

    def test_malformed_preparation_never_returns_partial_data(self):
        base = [bytes(131072), FORWARD, INVERSE, [0] * 2048, [0] * 2048]
        invalid = [
            (0, b""),
            (1, FORWARD[:-1]),
            (1, [m.float32(0.1)] + FORWARD[1:]),
            (1, [2**21] + FORWARD[1:]),
            (1, [True] + FORWARD[1:]),
            (2, [float("nan")] + INVERSE[1:]),
            (3, [0] * 2047),
            (3, [-1] + [0] * 2047),
            (4, [0x100000000] + [0] * 2047),
        ]
        for index, value in invalid:
            args = list(base)
            args[index] = value
            with self.assertRaises(ValueError):
                m.prepared_input(*args, inverted=False, delete_me=False)
        with self.assertRaises(ValueError):
            m.prepared_input(*base, inverted=0, delete_me=False)

    def test_live_query_state_is_absent_until_explicit_diagnostic_selection(self):
        for diagnostic in (False, True):
            record = {
                "inverted": False,
                "deleteMe": False,
                "terrainMapPresent": True,
                "owner": None,
                "vertices": ["preserved"],
            }
            flags = m.separate_query_state(record, diagnostic)
            self.assertEqual(
                flags, {"inverted": False, "deleteMe": False, "terrainMapPresent": True}
            )
            self.assertEqual(record["vertices"], ["preserved"])
            for key in ("owner", "deleteMe", "terrainMapPresent"):
                self.assertEqual(key in record, diagnostic)
        with self.assertRaises(ValueError):
            m.separate_query_state(
                {
                    "inverted": False,
                    "deleteMe": True,
                    "terrainMapPresent": True,
                    "owner": None,
                },
                True,
            )

    def test_boolean_overrides_require_exact_tags_and_do_not_coerce(self):
        self.assertFalse(m.source_boolean([], "Inverted", False))
        row = {"name": "Inverted", "type": 3, "boolval": True}
        self.assertTrue(m.source_boolean([row], "Inverted", False))
        for rows in ([row, row], [{**row, "type": 2}], [{**row, "boolval": 1}]):
            with self.assertRaises(ValueError):
                m.source_boolean(rows, "Inverted", False)

    def test_encoding_is_deterministic_and_refuses_nonfinite_json(self):
        self.assertEqual(m.encode({"a": 1, "b": -0.0}), b'{"a":1,"b":-0.0}\n')
        with self.assertRaises(ValueError):
            m.encode({"x": float("nan")})

    def test_existing_evidence_is_preserved_unless_overwrite_explicit(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "input.json"
            m.write_output(path, b"first")
            with self.assertRaises(FileExistsError):
                m.write_output(path, b"second")
            self.assertEqual(path.read_bytes(), b"first")
            self.assertEqual(list(Path(folder).iterdir()), [path])
            m.write_output(path, b"second", overwrite=True)
            self.assertEqual(path.read_bytes(), b"second")


if __name__ == "__main__":
    unittest.main()
