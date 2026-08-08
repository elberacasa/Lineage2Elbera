"""UE2 package parsing tests against real Interlude client files.

Cross-checks export table offsets/sizes against the reference tool
`tools/bin/umodel -game=l2 -list` (UEViewer build) for every package.
"""

import os
import unittest

from l2lib import (
    L2Error, PF_ANTIPORTAL, PF_INVISIBLE, PF_PORTAL, Package, Reader,
    decode_121, detect_protocol, encode_compact, level_model, load_package,
    mesh_material_slots, parse_texture, read_model, read_polys,
    resolve_material,
)
from l2lib.tests.common import (
    FIGHTER_UKX, MAPS_DIR, SAMPLE_UTX, STATS, SYSTEX_DIR, TEXTURES_DIR,
    umodel_list,
)


def check_against_umodel(testcase, pkg, umodel_path):
    """Every export's serial offset/size/class/name must match umodel."""
    listed = umodel_list(umodel_path)
    testcase.assertEqual(len(listed), len(pkg.exports),
                         "export count mismatch vs umodel")
    for item in listed:
        e = pkg.exports[item["index"]]
        testcase.assertEqual(e.serial_offset, item["offset"],
                             "offset mismatch for export %d" % item["index"])
        testcase.assertEqual(e.serial_size, item["size"],
                             "size mismatch for export %d" % item["index"])
        testcase.assertEqual(pkg.export_name(e), item["name"])
        testcase.assertEqual(pkg.class_name_of(e), item["cls"])
        STATS["umodel_offsets_checked"] += 1


class TestCompactIndex(unittest.TestCase):
    VECTORS = [0, 1, 63, 64, 127, 8191, 8192, 0x3FFFF, 0x1FFFFF,
               0xFFFFFFF, -1, -63, -64, -8192, -12345678]

    def test_roundtrip(self):
        for v in self.VECTORS:
            encoded = encode_compact(v)
            r = Reader(encoded)
            self.assertEqual(r.compact(), v, "roundtrip failed for %d" % v)
            self.assertEqual(r.pos, len(encoded))

    def test_sign_and_continue_bits(self):
        # the gotcha: bit7=sign and bit6=continue in the FIRST byte only
        # value 64 -> b0 = 0x40 (continue flag) | 0, then 0x01
        r = Reader(encode_compact(64))
        self.assertEqual(r.compact(), 64)
        self.assertEqual(encode_compact(64), bytes([0x40, 0x01]))
        self.assertEqual(encode_compact(-64), bytes([0xC0, 0x01]))
        self.assertEqual(encode_compact(0), bytes([0x00]))


class TestSamplePackage(unittest.TestCase):
    """tools/samples/t_aden.utx: Lineage2Ver121, package v117."""

    @classmethod
    def setUpClass(cls):
        cls.pkg, cls.protocol = load_package(SAMPLE_UTX)

    def test_encryption_detected_and_decoded_natively(self):
        self.assertEqual(self.protocol, 121)
        with open(SAMPLE_UTX, "rb") as f:
            raw = f.read()
        self.assertEqual(detect_protocol(raw), 121)
        plain = decode_121(raw)
        self.assertEqual(plain[:4], b"\xc1\x83\x2a\x9e")  # 0x9E2A83C1 LE

    def test_header(self):
        self.assertEqual(self.pkg.file_version, 117)
        self.assertEqual(self.pkg.licensee_version, 0)
        self.assertEqual(len(self.pkg.names), 74)
        self.assertEqual(len(self.pkg.exports), 59)
        self.assertEqual(len(self.pkg.imports), 2)
        STATS["packages_parsed"] += 1
        STATS["exports_listed"] += len(self.pkg.exports)

    def test_exports_match_umodel(self):
        check_against_umodel(self, self.pkg, SAMPLE_UTX)

    def test_texture_bodies_parse(self):
        count = 0
        for e in self.pkg.exports_by_class("Texture"):
            tex = parse_texture(self.pkg, e)
            self.assertGreater(len(tex.mips), 0)
            self.assertEqual(tex.body_end,
                             e.serial_offset + e.serial_size,
                             "mip data must end exactly at the export end")
            m0 = tex.mips[0]
            self.assertGreaterEqual(m0.u, 1)
            self.assertGreaterEqual(m0.v, 1)
            # mip chain shrinks by 2 each level
            for i in range(1, len(tex.mips)):
                pm, cm = tex.mips[i - 1], tex.mips[i]
                self.assertEqual(cm.u, max(1, pm.u // 2))
                self.assertEqual(cm.v, max(1, pm.v // 2))
            count += 1
        self.assertGreater(count, 50)


class TestFighterUkx(unittest.TestCase):
    """assets/interlude/animations/Fighter.ukx: Lineage2Ver111, v123/30."""

    @classmethod
    def setUpClass(cls):
        cls.pkg, cls.protocol = load_package(FIGHTER_UKX)

    def test_header(self):
        self.assertEqual(self.protocol, 111)
        self.assertEqual(self.pkg.file_version, 123)
        self.assertEqual(self.pkg.licensee_version, 30)
        self.assertEqual(len(self.pkg.exports), 797)
        STATS["packages_parsed"] += 1
        STATS["exports_listed"] += len(self.pkg.exports)

    def test_exports_match_umodel(self):
        check_against_umodel(self, self.pkg, FIGHTER_UKX)

    def test_mesh_material_slots(self):
        meshes = self.pkg.exports_by_class("SkeletalMesh")
        self.assertGreater(len(meshes), 0, "Fighter.ukx has skeletal meshes")
        parsed = 0
        for e in meshes:
            version, textures, mats = mesh_material_slots(self.pkg, e)
            self.assertGreater(len(mats), 0)
            for ti in mats:
                self.assertTrue(0 <= ti < len(textures),
                                "TextureIndex %d out of %d slots"
                                % (ti, len(textures)))
            parsed += 1
        self.assertGreater(parsed, 5)


class TestShaderResolution(unittest.TestCase):
    """Shader -> Diffuse texture resolution on a real character package."""

    def test_ffighter_shaders(self):
        path = os.path.join(SYSTEX_DIR, "FFighter.utx")
        if not os.path.exists(path):
            self.skipTest("FFighter.utx not present")
        pkg, _proto = load_package(path)
        shaders = pkg.exports_by_class("Shader")
        self.assertGreater(len(shaders), 0)
        resolved = 0
        for s in shaders:
            tex = resolve_material(pkg, s)
            self.assertIsNotNone(tex,
                                 "shader %s did not resolve"
                                 % pkg.export_name(s))
            self.assertEqual(pkg.class_name_of(tex), "Texture")
            # the resolved texture body must actually parse
            info = parse_texture(pkg, tex)
            self.assertGreater(len(info.mips), 0)
            resolved += 1
        STATS["packages_parsed"] += 1
        STATS["exports_listed"] += len(pkg.exports)
        self.assertGreater(resolved, 10)


class TestTexturePackagesCorpus(unittest.TestCase):
    """Parse a spread of real terrain texture packages end to end."""

    FILES = ["T_16_25.utx", "T_20_20.utx", "T_22_13.utx",
             "Elmo_fielddeco_T.utx", "FX_E_T.utx"]

    def test_corpus(self):
        total_tex = 0
        for name in self.FILES:
            path = os.path.join(TEXTURES_DIR, name)
            if not os.path.exists(path):
                self.skipTest("%s not present" % path)
            pkg, _proto = load_package(path)
            STATS["packages_parsed"] += 1
            STATS["exports_listed"] += len(pkg.exports)
            check_against_umodel(self, pkg, path)
            for e in pkg.exports_by_class("Texture"):
                tex = parse_texture(pkg, e)
                self.assertGreater(len(tex.mips), 0)
                total_tex += 1
        self.assertGreater(total_tex, 20)

    def test_bad_tag_rejected(self):
        with self.assertRaises(L2Error):
            Package(b"\x00" * 64, path="<synthetic>")


class TestBsp(unittest.TestCase):
    """UModel / UPolys (the BSP buildings) on real map tiles.

    The bar is exact byte consumption: every brush UModel must end 3 bytes
    before its serial size (the three empty lightmap arrays) and every
    UPolys must land exactly on it. Tiles cover both FPoly layouts --
    17_25 licensee 25, 22_22 licensee 28, 17_18 licensee 18 (no
    LightingChannels / iLightmapIndex).
    """

    TILES = ["17_25", "22_22", "20_21", "17_18"]

    def test_models_and_polys_consume_exactly(self):
        polygons = 0
        for tile in self.TILES:
            path = os.path.join(MAPS_DIR, tile + ".unr")
            if not os.path.exists(path):
                self.skipTest("%s not present" % path)
            pkg, _proto = load_package(path)
            STATS["packages_parsed"] += 1
            levels = 0
            for e in pkg.exports:
                cls = pkg.class_name_of(e)
                if not e.serial_size:
                    continue
                if cls == "Model":
                    m = read_model(pkg, e)
                    if m.is_level:
                        levels += 1
                    else:
                        self.assertEqual(
                            m.lightmap_tail, 3,
                            "%s %s: brush UModel did not consume its body"
                            % (tile, pkg.export_name(e)))
                elif cls == "Polys":
                    polygons += len(read_polys(pkg, e))
            self.assertEqual(levels, 1, "%s: expected one level UModel" % tile)
        self.assertGreater(polygons, 5000)

    def test_level_bsp_is_world_space_and_wound_ccw(self):
        """The level BSP needs no brush placement and its stored vertex
        order is already front-facing: the Newell normal of every node
        polygon agrees in sign with the node plane, and every node plane
        agrees with its surface plane."""
        path = os.path.join(MAPS_DIR, "22_22.unr")
        if not os.path.exists(path):
            self.skipTest("%s not present" % path)
        pkg, _proto = load_package(path)
        m = level_model(pkg)
        self.assertIsNotNone(m)
        for i, nd in enumerate(m.nodes):
            s = m.surfs[nd.i_surf]
            self.assertGreater(
                sum(nd.plane[k] * s.plane[k] for k in range(3)), 0,
                "node %d faces away from its surf" % i)
            pts = [m.points[m.verts[nd.i_vert_pool + k][0]]
                   for k in range(nd.num_vertices)]
            nx = ny = nz = 0.0
            for a, b in zip(pts, pts[1:] + pts[:1]):
                nx += (a[1] - b[1]) * (a[2] + b[2])
                ny += (a[2] - b[2]) * (a[0] + b[0])
                nz += (a[0] - b[0]) * (a[1] + b[1])
            self.assertGreater(nx * nd.plane[0] + ny * nd.plane[1]
                               + nz * nd.plane[2], 0,
                               "node %d winding is not CCW about its plane" % i)
        # world space: the Giran walls land on the tile scene.json origin
        # [65536, 131072] .. +32768, not around the brush-local zero
        wall = [s for s in m.surfs
                if pkg.ref_name(s.material) == ("Giran_Village_T",
                                                "Giran_wall07")]
        self.assertTrue(wall)
        xs = [m.points[s.p_base][0] for s in wall]
        ys = [m.points[s.p_base][1] for s in wall]
        self.assertTrue(all(65536 <= x <= 65536 + 32768 for x in xs), xs[:4])
        self.assertTrue(all(131072 <= y <= 131072 + 32768 for y in ys), ys[:4])

    def test_invisible_flag_marks_only_helper_surfaces(self):
        """PF_INVISIBLE (0x1) is named from the data, not from a header:
        across three town tiles a surface carries it if and only if it is
        an editor helper -- either painted with an AntiPortal /
        WaterAntiportal / ZonePortal texture, or flagged PF_PORTAL /
        PF_ANTIPORTAL (a few zone portals keep the wall texture they were
        cut from, e.g. 22_22 interior_A_top01 0x4000109)."""
        invisible = 0
        for tile in ("17_25", "22_22", "20_21"):
            path = os.path.join(MAPS_DIR, tile + ".unr")
            if not os.path.exists(path):
                self.skipTest("%s not present" % path)
            pkg, _proto = load_package(path)
            for s in level_model(pkg).surfs:
                name = ((pkg.ref_name(s.material) or (None, ""))[1]
                        or "").lower()
                helper = "antiportal" in name or "zoneportal" in name \
                    or bool(s.flags & (PF_PORTAL | PF_ANTIPORTAL))
                self.assertEqual(helper, bool(s.flags & PF_INVISIBLE),
                                 "%s surface '%s' flags 0x%X"
                                 % (tile, name, s.flags))
                invisible += bool(s.flags & PF_INVISIBLE)
        self.assertGreater(invisible, 100)


if __name__ == "__main__":
    unittest.main()
