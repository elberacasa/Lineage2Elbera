"""Portable authored fixtures; no original packages, DLLs or generated outputs."""

from pathlib import Path
from types import SimpleNamespace as NS
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_terrain_zones as m
from l2lib import L2Error
from l2lib.ue2package import encode_compact as ci

NAMES = ["None", "Zone", "iLeaf", "ZoneNumber", "Location"]


def package(data):
    return NS(data=data, path="authored", name=lambda i: NAMES[i])


def region(zone=7, leaf=-1, number=3):
    return (
        ci(1)
        + b"\x05"
        + ci(zone)
        + ci(2)
        + b"\x22"
        + struct.pack("<i", leaf)
        + ci(3)
        + b"\x01"
        + bytes([number])
        + ci(0)
    )


def actor():
    body = (
        ci(-1)
        + ci(-1)
        + struct.pack("<iiI", -1, -1, 0x12345678)
        + ci(-1)
        + ci(0)
        + b"opaque tail"
    )
    return package(body + b"outside export"), NS(
        class_index=-1, object_flags=0x02000000, serial_offset=0, serial_size=len(body)
    )


class ZoneSourceTests(unittest.TestCase):
    def test_array_reference_order_duplicates_nulls_are_preserved(self):
        values = [8, 0, 8, 12]
        self.assertEqual(
            m.decode_refs(ci(len(values)) + b"".join(map(ci, values))), values
        )
        self.assertEqual(m.decode_refs(ci(0)), [])

    def test_array_framing_refuses_truncation_and_trailing_bytes(self):
        for raw in (ci(-1), ci(3) + ci(1), ci(0) + b"extra", ci(1) + b"\x40"):
            with self.assertRaises((ValueError, L2Error)):
                m.decode_refs(raw)

    def test_region_requires_all_exact_named_fields(self):
        self.assertEqual(
            m.decode_region(package(b""), region()),
            {"zoneRef": 7, "leaf": -1, "zoneNumber": 3},
        )
        for raw in (
            region()[:-1],
            region() + b"other",
            region(number=64),
            ci(0),
            region()[:-1] + ci(3) + b"\x01\x01" + ci(0),
        ):
            with self.assertRaises((ValueError, L2Error, IndexError)):
                m.decode_region(package(b""), raw)

    def test_actor_prefix_is_bounded_and_preserves_opaque_word(self):
        p, e = actor()
        rows, proof = m.actor_properties(p, e)
        self.assertEqual(rows, [])
        self.assertEqual(proof["stateFrameWord32"], 0x12345678)
        self.assertEqual(proof["unparsedTailBytes"], len(b"opaque tail"))
        e.serial_size = 15
        with self.assertRaises((ValueError, L2Error)):
            m.actor_properties(p, e)

    def test_actor_state_class_is_not_inferred(self):
        p, e = actor()
        p.data = ci(-2) + p.data[1:]
        with self.assertRaisesRegex(ValueError, "state-frame class"):
            m.actor_properties(p, e)

    def test_current_actor_array_uses_exact_bound_span_and_slot_zero(self):
        prefix = b"unrelated"
        data = struct.pack("<ii", 4, 4) + b"".join(map(ci, [4, 0, 8, 8]))
        suffix = b"following"
        p = package(prefix + data + suffix)
        binding = {"spans": {"array0x38": [len(prefix), len(prefix) + len(data)]}}
        self.assertEqual(m.level_actor_refs(p, binding), [4, 0, 8, 8])
        for bad in (
            struct.pack("<ii", 4, 3) + data[8:],
            struct.pack("<ii", 1, 1) + ci(0),
            struct.pack("<ii", 1, 1) + ci(1) + b"tail",
        ):
            with self.assertRaises((ValueError, L2Error)):
                m.level_actor_refs(
                    package(bad), {"spans": {"array0x38": [0, len(bad)]}}
                )

    def test_fixed_zone_tail_retains_repeated_slots_and_does_not_mutate(self):
        saved = [0, 7, 7, 0]
        result = m.fixed_zone_refs(saved)
        self.assertEqual(result[:4], saved)
        self.assertEqual(result[4:], [0] * 60)
        self.assertEqual(saved, [0, 7, 7, 0])
        for invalid in ([0] * 65, [-1], [True], None):
            with self.assertRaises(ValueError):
                m.fixed_zone_refs(invalid)

    def test_conditional_build_preserves_actor_order_and_add_unique(self):
        terrains = {
            9: {"savedDeleteMe": False},
            7: {"savedDeleteMe": False},
            8: {"savedDeleteMe": True},
        }
        regions = {9: {"zoneRef": 3}, 7: {"zoneRef": 3}}
        result = m.conditional_lists(
            [0, 3, 3, 5], [100, 9, 0, 7, 9, 8], terrains, regions
        )
        self.assertEqual(
            result,
            [{"zoneRef": 3, "terrainRefs": [9, 7]}, {"zoneRef": 5, "terrainRefs": []}],
        )

    def test_conditional_build_refuses_unknown_state_or_unpreserved_fallback(self):
        for terrains, regions in (
            ({7: {"savedDeleteMe": None}}, {7: {"zoneRef": 3}}),
            ({7: {"savedDeleteMe": False}}, {}),
            ({7: {"savedDeleteMe": False}}, {7: {"zoneRef": 2}}),
        ):
            with self.assertRaises(ValueError):
                m.conditional_lists([3], [7], terrains, regions)

    def test_default_reader_refuses_ambiguous_nonvisual_stream(self):
        ex = NS()
        pkg = NS(
            exports=[ex],
            class_name_of=lambda e: "Class",
            export_name=lambda e: "ZoneInfo",
        )
        classes = NS(
            packages={"Engine": pkg},
            get=lambda q: {"super": None},
            property_types=lambda q, s: {},
        )
        with patch.object(
            m,
            "terminal_defaults",
            return_value=([], {"defaultsBoundary": "ambiguous-visual-consensus"}),
        ):
            with self.assertRaisesRegex(ValueError, "ambiguous nonvisual"):
                m.default_boolean(classes, "Engine.ZoneInfo", "bTerrainZone")
        with patch.object(
            m,
            "terminal_defaults",
            return_value=(
                [("bTerrainZone", "bool", True)],
                {"defaultsBoundary": "unique-validated-candidate"},
            ),
        ):
            self.assertTrue(
                m.default_boolean(classes, "Engine.ZoneInfo", "bTerrainZone")[0]
            )

    def test_deterministic_encoding_has_no_nonfinite_coercion(self):
        self.assertEqual(m.encode({"b": -0.0, "a": 1}), b'{"a":1,"b":-0.0}\n')
        with self.assertRaises(ValueError):
            m.encode({"bad": float("nan")})

    def test_evidence_output_refuses_overwrite_unless_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "record.json"
            m.write_output(p, b"first")
            with self.assertRaises(FileExistsError):
                m.write_output(p, b"second")
            self.assertEqual(p.read_bytes(), b"first")
            m.write_output(p, b"second", overwrite=True)
            self.assertEqual(p.read_bytes(), b"second")


if __name__ == "__main__":
    unittest.main()
