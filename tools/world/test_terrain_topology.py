"""Synthetic contract checks plus optional local source round-trips.

Run: python3 -m unittest discover -s tools/world -p 'test_terrain_topology.py'
The public tests contain no retail bitmap or map data.
"""

import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(HERE))

import convert
import terrain_topology as topology
from l2lib import L2Error, Reader


def properties():
    # Two uint32 words per 8x8 synthetic grid. Include bits 0, 31 and 63;
    # treating these arrays as signed or float values must not lose a bit.
    values = [(1, 0x80000000), (0xffffffff, 0),
              (0x80000001, 7), (42, 0xffffffff)]
    return [{"name": name, "type": 9,
             "raw": b"\x02" + struct.pack("<2I", *words)}
            for name, words in zip(topology.PROPERTIES, values)]


class TerrainTopologyTests(unittest.TestCase):
    def test_unsigned_bits_and_orig_variants_are_preserved(self):
        props = properties()
        bitmaps = topology.read_bitmaps(props, 8)
        self.assertEqual(set(bitmaps), set(topology.PROPERTIES.values()))
        for prop in props:
            bitmap = bitmaps[topology.PROPERTIES[prop["name"]]]
            self.assertEqual(struct.pack("<2I", *bitmap["words"]),
                             prop["raw"][1:])
            self.assertEqual(bitmap["sourcePropertySHA256"],
                             hashlib.sha256(prop["raw"]).hexdigest())
        self.assertEqual(bitmaps["visibility"]["words"][1], 2147483648)
        self.assertEqual(bitmaps["edgeTurn"]["words"][0], 4294967295)

    def test_missing_required_arrays_are_rejected_but_orig_is_optional(self):
        for missing in (0, 1):
            props = properties()
            props.pop(missing)
            with self.assertRaises(L2Error):
                topology.read_bitmaps(props, 8)
        self.assertEqual(len(topology.read_bitmaps(properties()[:2], 8)), 2)

    def test_malformed_array_payloads_are_rejected(self):
        for raw in (b"", b"\x02\x00", b"\x01" + bytes(8),
                    b"\x02" + bytes(9), b"\x82" + bytes(8)):
            with self.subTest(raw=raw):
                props = properties()
                props[0]["raw"] = raw
                with self.assertRaises(L2Error):
                    topology.read_bitmaps(props, 8)
        props = properties()
        props[0]["type"] = 10
        with self.assertRaises(L2Error):
            topology.read_bitmaps(props, 8)
        with self.assertRaises(L2Error):
            topology.read_bitmaps(properties() + properties()[:1], 8)

    def test_source_hash_and_output_are_deterministic_and_unverified(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.unr"
            source.write_bytes(b"synthetic source, not retail data")
            bitmaps = topology.read_bitmaps(properties(), 8)
            first = topology.write(bitmaps, 8, source, "synthetic.unr", folder)
            first_bytes = (Path(folder) / topology.FILENAME).read_bytes()
            second = topology.write(bitmaps, 8, source, "synthetic.unr", folder)
            self.assertEqual(first, second)
            self.assertEqual(first_bytes,
                             (Path(folder) / topology.FILENAME).read_bytes())
            self.assertEqual(first["provenance"]["sourceSHA256"],
                             hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(first["conventions"], topology.UNVERIFIED)
            guessed = copy.deepcopy(first)
            guessed["conventions"]["indexOrder"] = "row-major"
            with self.assertRaises(L2Error):
                topology.validate(guessed, 8)
            with self.assertRaises(L2Error):
                topology.validate(first, 256)
            for bad_word in (-1, 0x100000000, True, 1.5):
                bad = copy.deepcopy(first)
                bad["bitmaps"]["visibility"]["words"][0] = bad_word
                with self.assertRaises(L2Error):
                    topology.validate(bad, 8)

    def test_targeted_update_only_adds_pointer_and_sidecar(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            client = base / "client"
            (client / "maps").mkdir(parents=True)
            (client / "maps/17_25.unr").write_bytes(b"synthetic map")
            tile_dir = base / "world/17_25"
            tile_dir.mkdir(parents=True)
            raw = bytes(256 * 256 * 2)
            (tile_dir / "heightmap.u16").write_bytes(raw)
            (tile_dir / "heightmap.png").write_bytes(b"preview sentinel")
            scene = {"tile": "17_25", "origin": [-98304, 229376, 0],
                     "gridSize": 256, "spacing": 128,
                     "heightScale": 0.296875, "heightmap": "heightmap.u16",
                     "heights": "heightmap.png", "layers": [], "water": None,
                     "props": []}
            scene_path = tile_dir / "scene.json"
            scene_path.write_text(json.dumps(scene))
            props = [{"name": p["name"], "type": 9,
                      "raw": b"\x40\x20" + bytes(8192)}
                     for p in properties()]
            bitmaps = topology.read_bitmaps(props, 256)
            with mock.patch.object(convert, "CLIENT", str(client)), \
                    mock.patch.object(convert, "OUT_ROOT", str(base / "world")), \
                    mock.patch.object(convert, "load_package", return_value=(None, None)), \
                    mock.patch.object(convert, "read_terrain_info", return_value={"topology": bitmaps}):
                convert.update_tile_topology("17_25")
                first = scene_path.read_bytes()
                convert.update_tile_topology("17_25")
            self.assertEqual(first, scene_path.read_bytes())
            changed = json.loads(first)
            self.assertEqual(changed.pop("topology"), topology.FILENAME)
            self.assertEqual(changed, scene)
            self.assertEqual((tile_dir / "heightmap.u16").read_bytes(), raw)
            self.assertEqual((tile_dir / "heightmap.png").read_bytes(),
                             b"preview sentinel")
            self.assertEqual({p.name for p in tile_dir.iterdir()},
                             {"scene.json", "heightmap.u16", "heightmap.png",
                              topology.FILENAME})


class NativeVisibilityProofTests(unittest.TestCase):
    def fixture(self, folder):
        # One native 16x16-quad sector over a 17x17 bitmap grid. No retail data.
        words = [0xffffffff] * 10
        words[(3 * 17 + 4) // 32] &= ~(1 << ((3 * 17 + 4) % 32))
        props = [{"name": name, "type": 9,
                  "raw": bytes([10]) + struct.pack("<10I", *words)}
                 for name in topology.PROPERTIES]
        bitmaps = topology.read_bitmaps(props, 17)
        table = [1] * 256
        table[3 * 16 + 4] = 0
        body = (b"\0\1" + struct.pack("<4i6fB", 16, 16, 0, 0,
                                    0, 0, 0, 2048, 2048, 0, 1)
                + bytes(64) + b"\x40\x04" + struct.pack("<256H", *table))
        source = Path(folder) / "source.unr"
        source.write_bytes(body)
        info = SimpleNamespace(index=0, cls="TerrainInfo", name="TerrainInfo0")
        sector = SimpleNamespace(index=1, cls="TerrainSector", name="TerrainSector0",
                                 serial_offset=0, serial_size=len(body))
        pkg = SimpleNamespace(data=body, path=str(source), exports=[info, sector],
                              name=lambda i: "None" if i == 0 else "other",
                              class_name_of=lambda e: e.cls, export_name=lambda e: e.name)
        return pkg, bitmaps, source

    def test_complete_independent_table_promotes_only_visibility(self):
        with tempfile.TemporaryDirectory() as folder:
            pkg, bitmaps, source = self.fixture(folder)
            record = topology.build(bitmaps, 17, source, "source.unr", pkg)
            self.assertEqual(record["conventions"], topology.VISIBILITY_VERIFIED)
            proof = record["verification"]
            self.assertEqual(proof["coveredQuads"], 256)
            self.assertEqual(proof["hiddenQuads"], 1)
            self.assertIsNone(record["conventions"]["bitSetDiagonal"])
            self.assertIsNone(record["conventions"]["boundary"])
            tampered = copy.deepcopy(record)
            tampered["bitmaps"]["visibility"]["words"][0] ^= 1
            with self.assertRaises(L2Error):
                topology.validate(tampered, 17)
            tampered = copy.deepcopy(record)
            tampered["conventions"]["bitSetDiagonal"] = "bc"
            with self.assertRaises(L2Error):
                topology.validate(tampered, 17)

    def test_disagreement_missing_coverage_and_bad_framing_never_promote(self):
        with tempfile.TemporaryDirectory() as folder:
            for scenario in ("wrong-bit", "wrong-orig", "missing", "duplicate", "bad-count"):
                with self.subTest(scenario=scenario):
                    pkg, bitmaps, source = self.fixture(folder)
                    if scenario == "wrong-bit":
                        bitmaps["visibility"]["words"][0] ^= 1
                    elif scenario == "wrong-orig":
                        bitmaps["visibilityOrig"]["words"][0] ^= 1
                    elif scenario == "missing":
                        pkg.exports.pop()
                    elif scenario == "duplicate":
                        pkg.exports.append(pkg.exports[-1])
                    else:
                        pkg.data = pkg.data[:-514] + b"\x41\x04" + pkg.data[-512:]
                    record = topology.build(bitmaps, 17, source, "source.unr", pkg)
                    self.assertEqual(record["conventions"], topology.UNVERIFIED)
                    self.assertFalse(record["verification"]["passed"])


class LocalSourceRoundTripTests(unittest.TestCase):
    def test_unknown_or_absent_engine_never_claims_native_rules(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "engine.dll"
            self.assertIsNone(topology.native_engine_evidence(path))
            path.write_bytes(b"unknown engine; not an executable fixture")
            self.assertIsNone(topology.native_engine_evidence(path))

    def test_local_native_engine_proves_current_selection_without_rewriting_orig(self):
        client = ROOT / "assets/interlude"
        engine = client / "system/engine.dll"
        source = client / "maps/22_19.unr"
        if not engine.is_file() or not source.is_file():
            self.skipTest("optional private client inputs not installed")
        native = topology.native_engine_evidence(engine)
        if native is None:
            self.skipTest("installed client engine is not the inspected version")
        self.assertEqual(native["decoder"]["key"], 0x7965b551)
        self.assertEqual(native["imageBase"], 0x10300000)
        self.assertEqual(len(native["functions"]), 10)
        pkg, _ = convert.load_package(str(source))
        bitmaps = convert.read_terrain_info(pkg)["topology"]
        before = copy.deepcopy(bitmaps)
        # The engine recovery above is real; reuse its immutable evidence so
        # this map selection test does not decode the same section twice.
        with mock.patch.object(topology, "native_engine_evidence", return_value=native):
            record = topology.build(bitmaps, 256, source, source.name, pkg)
        self.assertEqual(bitmaps, before)
        self.assertEqual(record["conventions"], topology.NATIVE_VERIFIED)
        self.assertTrue(record["verification"]["currentPassed"])
        self.assertFalse(record["verification"]["passed"])
        self.assertEqual(record["verification"]["origVisibilityMismatches"], 430)
        self.assertNotEqual(bitmaps["visibility"]["words"], bitmaps["visibilityOrig"]["words"])
        for name in ("visibility", "visibilityOrig", "edgeTurn", "edgeTurnOrig"):
            tampered = copy.deepcopy(record)
            tampered["bitmaps"][name]["words"][0] ^= 1
            with self.subTest(changed=name), self.assertRaises(L2Error):
                topology.validate(tampered, 256)
        for field in ("decoder", "functions", "sourceSHA256", "postLoadOrig"):
            tampered = copy.deepcopy(record)
            del tampered["nativeEngine"][field]
            with self.subTest(missing=field), self.assertRaises(L2Error):
                topology.validate(tampered, 256)
        with mock.patch.object(topology, "native_engine_evidence", return_value=None):
            unknown = topology.build(bitmaps, 256, source, source.name, pkg)
        self.assertEqual(unknown["conventions"], topology.UNVERIFIED)

    def test_three_retail_maps_round_trip_each_native_payload(self):
        paths = [ROOT / "assets/interlude/maps" / (tile + ".unr")
                 for tile in ("17_25", "22_22", "24_18")]
        if not all(path.is_file() for path in paths):
            self.skipTest("optional private client map files not installed")
        for path in paths:
            with self.subTest(tile=path.stem):
                pkg, _ = convert.load_package(str(path))
                terrain = convert.read_terrain_info(pkg)
                export = next(e for e in pkg.exports
                              if pkg.class_name_of(e) == "TerrainInfo")
                props = convert.find_prop_start(pkg, export,
                                                want_first=("TerrainMap",))
                bitmaps = terrain["topology"]
                self.assertEqual(len(bitmaps), 4)
                for prop in props:
                    if prop["name"] not in topology.PROPERTIES:
                        continue
                    reader = Reader(prop["raw"])
                    count = reader.compact()
                    words = bitmaps[topology.PROPERTIES[prop["name"]]]["words"]
                    self.assertEqual(count, 2048)
                    self.assertEqual(struct.pack("<%dI" % count, *words),
                                     prop["raw"][reader.pos:])
                proof = topology.verify_sector_visibility(pkg, bitmaps, 256)
                self.assertTrue(proof["passed"], proof)
                self.assertEqual(proof["coveredQuads"], 255 * 255)
                self.assertEqual(proof["sectorCount"], 256)


if __name__ == "__main__":
    unittest.main()
