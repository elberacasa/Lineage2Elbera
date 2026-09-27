"""Independent source-edge orientation/scaling tests; no retail data required.

Run: python3 -m unittest discover -s tools/world -p 'test_terrain_edges.py'
"""
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(HERE))
import convert
import terrain_edges as edges
import terrain_topology as topology
from l2lib import L2Error


def source(tile, height_scale=1, z=0):
    tx, ty = map(int, tile.split("_"))
    # Deliberately asymmetric: transposing a column into a row changes every
    # nonzero sample by 100x. Unsigned high values test native G16 decoding.
    raw = struct.pack("<65536H", *(32768 + x + 100 * y
                                  for y in range(256) for x in range(256)))
    return {"tile": tile, "origin": [(tx-20)*32768, (ty-18)*32768, z],
            "spacing": 128, "heightScale": height_scale, "heightmap": raw,
            "rawMapSHA256": hashlib.sha256((tile + " native map").encode()).hexdigest(),
            "extractedHeightSHA256": hashlib.sha256(raw).hexdigest()}


def sources():
    return {"22_22": source("22_22", .296875, -50),
            "23_22": source("23_22", 2, 1000),
            "22_23": source("22_23", 3, -2000),
            "23_23": source("23_23", 4, 333)}


class TerrainEdgeTests(unittest.TestCase):
    def test_east_column_south_row_and_corner_use_each_source_transform(self):
        data = sources()
        result = edges.build("22_22", data.get)
        self.assertEqual(result["east"], [1000 + 200 * y for y in range(256)])
        self.assertEqual(result["south"], [-2000 + 3 * x for x in range(256)])
        self.assertEqual(result["southeast"], 333)
        self.assertEqual(result["origin"], [65536, 131072, -50])
        self.assertEqual(result["provenance"]["south"]["tile"], "22_23")
        self.assertEqual(result["provenance"]["east"]["heightScale"], 2)

    def test_edge_hashes_use_exact_ordered_little_endian_float64_world_values(self):
        data = sources()
        data["23_22"]["origin"][2] = 1000.125
        data["22_23"]["origin"][2] = -2000.5
        data["23_23"]["origin"][2] = 333.25
        result = edges.build("22_22", data.get)
        expected = {"east": [1000.125 + 200 * y for y in range(256)],
                    "south": [-2000.5 + 3 * x for x in range(256)],
                    "southeast": [333.25]}
        for side, values in expected.items():
            with self.subTest(side=side):
                # Encode independently, one expected double at a time.
                wire = b"".join(struct.pack("<d", value) for value in values)
                wrong_order = b"".join(struct.pack(">d", value) for value in values)
                actual = result["provenance"][side]["edgeValuesSHA256"]
                self.assertEqual(actual, hashlib.sha256(wire).hexdigest())
                self.assertNotEqual(actual, hashlib.sha256(wrong_order).hexdigest())
        self.assertNotIn("edgeValuesSHA256", result["provenance"]["center"])
        # JSON can spell the same number as an int or float without changing
        # the digest. Binary precision and sequence order are what matter.
        self.assertEqual(edges.edge_values_sha256([1, 2, 3]),
                         edges.edge_values_sha256([1.0, 2.0, 3.0]))
        edges.validate(json.loads(json.dumps(result)))

    def test_changed_reordered_and_unhashed_edge_values_are_rejected(self):
        valid = edges.build("22_22", sources().get)
        for side in ("east", "south", "southeast"):
            for mutation in ("changed", "missing_digest", "wrong_digest"):
                with self.subTest(side=side, mutation=mutation):
                    bad = copy.deepcopy(valid)
                    if mutation == "changed":
                        if side == "southeast":
                            bad[side] += 0.125
                        else:
                            bad[side][73] += 0.125
                    elif mutation == "missing_digest":
                        del bad["provenance"][side]["edgeValuesSHA256"]
                    else:
                        bad["provenance"][side]["edgeValuesSHA256"] = "0" * 64
                    with self.assertRaisesRegex(L2Error, "edge values|edgeValuesSHA256"):
                        edges.validate(bad)
        reordered = copy.deepcopy(valid)
        reordered["east"][1], reordered["east"][2] = reordered["east"][2], reordered["east"][1]
        with self.assertRaisesRegex(L2Error, "edge values differ"):
            edges.validate(reordered)
        swapped = copy.deepcopy(valid)
        swapped["east"], swapped["south"] = swapped["south"], swapped["east"]
        with self.assertRaisesRegex(L2Error, "edge values differ"):
            edges.validate(swapped)

    def test_missing_neighbors_remain_null_without_borrowing_another_edge(self):
        data = sources()
        del data["22_23"]
        del data["23_23"]
        result = edges.build("22_22", data.get)
        self.assertIsNone(result["south"])
        self.assertIsNone(result["southeast"])
        self.assertIsNone(result["provenance"]["south"])
        self.assertIsNone(result["provenance"]["southeast"])
        self.assertEqual(result["east"][255], 52000)
        with self.assertRaises(L2Error):
            edges.build("missing", data.get)

    def test_shifted_origins_wrong_spacing_and_truncated_g16_are_rejected(self):
        for mutation in (lambda s: s["origin"].__setitem__(0, s["origin"][0] + 128),
                         lambda s: s.__setitem__("spacing", 64),
                         lambda s: s.__setitem__("heightmap", bytes(4)),
                         lambda s: s.__setitem__("tile", "24_22")):
            with self.subTest(mutation=mutation):
                data = sources()
                mutation(data["23_22"])
                with self.assertRaises(L2Error):
                    edges.build("22_22", data.get)

    def test_contract_rejects_nonfinite_heights_missing_provenance_and_wrong_scene(self):
        valid = edges.build("22_22", sources().get)
        for bad_height in (float("inf"), float("nan"), True, "12"):
            bad = copy.deepcopy(valid)
            bad["east"][7] = bad_height
            with self.assertRaises(L2Error):
                edges.validate(bad)
        bad = copy.deepcopy(valid)
        bad["provenance"]["south"] = None
        with self.assertRaises(L2Error):
            edges.validate(bad)
        bad = copy.deepcopy(valid)
        bad["provenance"]["east"]["rawMapSHA256"] = "made-up"
        with self.assertRaises(L2Error):
            edges.validate(bad)
        scene = {k: valid[k] for k in ("tile", "gridSize", "origin", "spacing")}
        scene["heightScale"] = 0.296875
        edges.validate(valid, scene)
        scene["origin"] = [65536, 131072, 0]
        with self.assertRaises(L2Error):
            edges.validate(valid, scene)

    def test_absent_native_files_are_null_but_present_malformed_source_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with mock.patch.object(convert, "CLIENT", folder):
                self.assertIsNone(edges.load_source("22_22"))
                (root / "maps").mkdir()
                (root / "maps/22_22.unr").write_bytes(b"corrupt map")
                self.assertIsNone(edges.load_source("22_22"))
                (root / "textures").mkdir()
                (root / "textures/T_22_22.utx").write_bytes(b"corrupt texture")
                with self.assertRaises(L2Error):
                    edges.load_source("22_22")

    def test_targeted_update_changes_only_sidecar_and_scene_pointer(self):
        data = sources()
        with tempfile.TemporaryDirectory() as folder:
            tile_dir = Path(folder) / "22_22"
            tile_dir.mkdir()
            scene = {"tile": "22_22", "origin": [65536, 131072, -50],
                     "gridSize": 256, "spacing": 128, "heightScale": 0.296875,
                     "heightmap": "heightmap.u16", "heights": "heightmap.png",
                     "layers": [], "water": None, "props": []}
            scene_path = tile_dir / "scene.json"
            scene_path.write_text(json.dumps(scene))
            (tile_dir / "heightmap.u16").write_bytes(data["22_22"]["heightmap"])
            (tile_dir / "heightmap.png").write_bytes(b"preview sentinel")
            with mock.patch.object(convert, "OUT_ROOT", folder), \
                    mock.patch.object(edges, "load_source", side_effect=data.get):
                convert.update_tile_edges("22_22")
                first = scene_path.read_bytes()
                convert.update_tile_edges("22_22")
            self.assertEqual(scene_path.read_bytes(), first)
            changed = json.loads(first)
            self.assertEqual(changed.pop("terrainEdges"), edges.FILENAME)
            self.assertEqual(changed, scene)
            self.assertEqual((tile_dir / "heightmap.u16").read_bytes(), data["22_22"]["heightmap"])
            self.assertEqual((tile_dir / "heightmap.png").read_bytes(), b"preview sentinel")
            self.assertEqual({p.name for p in tile_dir.iterdir()},
                             {"scene.json", "heightmap.u16", "heightmap.png", edges.FILENAME})
            (tile_dir / "heightmap.u16").write_bytes(bytes(131072))
            with mock.patch.object(convert, "OUT_ROOT", folder), \
                    mock.patch.object(edges, "load_source", side_effect=data.get):
                with self.assertRaisesRegex(L2Error, "heightmap differs"):
                    convert.update_tile_edges("22_22")
            self.assertEqual(scene_path.read_bytes(), first)


class LocalSourceTests(unittest.TestCase):
    def test_five_native_matrices_match_source_corners_and_reject_changed_inputs(self):
        required = [ROOT / "assets/interlude/maps" / (t + ".unr")
                    for t in ("17_25", "22_22", "24_18", "16_25", "22_19")]
        if not all(path.is_file() for path in required):
            self.skipTest("optional private map inputs not installed")
        for path in required:
            with self.subTest(tile=path.stem):
                source = edges.load_source(path.stem)
                transform = source["heightTransform"]
                self.assertIsNotNone(transform)
                self.assertEqual(transform["verification"]["boundsMatched"], 1536)
                self.assertEqual(transform["origin"][2], 32225.859375)
                self.assertEqual(transform["axes"][2], [0, 0, .296875])
                topology.validate_height_transform(transform, source)
                # Original matrix, not a recomputed Location-based bias.
                height = struct.unpack_from("<H", source["heightmap"])[0]
                expected = struct.unpack("<f", struct.pack("<f", (height - 32225.859375) * .296875))[0]
                self.assertEqual(edges.world_height(source, height), expected)
                self.assertNotEqual(expected, source["origin"][2] + (height - 32768) * .296875)
                bad = copy.deepcopy(transform)
                bad["origin"][2] += 1
                with self.assertRaisesRegex(L2Error, "height transform"):
                    topology.validate_height_transform(bad, source)
        source = edges.load_source("22_22")
        package, _ = convert.load_package(str(required[1]))
        altered = bytearray(source["heightmap"])
        struct.pack_into("<H", altered, 0, 0)  # native sector corner
        self.assertIsNone(topology.native_height_transform(package, altered,
                          source["origin"], 128, source["heightScale"]))
        self.assertIsNone(topology.native_height_transform(package, source["heightmap"],
                          [source["origin"][0] + 128, *source["origin"][1:]], 128, source["heightScale"]))

    def test_giran_neighbor_original_samples_have_measured_world_heights(self):
        required = [ROOT / "assets/interlude/maps" / (t + ".unr")
                    for t in ("22_22", "22_23", "23_22", "23_23")]
        if not all(path.is_file() for path in required):
            self.skipTest("optional private Giran source maps are not installed")
        record = edges.build("22_22")
        # Independent saved source values from the forensic decode. The two
        # south values differ from center row255: repeating that row is wrong.
        # Original G16 samples are 21129 and 20116. Saved FCoords origin is
        # 2062455/64 and scale19/64; float32 storage rounds those exact ratios.
        self.assertEqual(record["south"][100], -3294.380126953125)
        self.assertEqual(record["south"][101], -3595.114501953125)
        self.assertEqual(record["provenance"]["south"]["heightTransform"]["origin"][2], 32225.859375)
        self.assertEqual(record["provenance"]["south"]["origin"][:2], [65536, 163840])
        raw = (ROOT / "assets/world/22_23/heightmap.u16").read_bytes()
        self.assertEqual(record["provenance"]["south"]["extractedHeightSHA256"],
                         hashlib.sha256(raw).hexdigest())


if __name__ == "__main__":
    unittest.main()
