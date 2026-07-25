"""UE2 package parsing tests against real Interlude client files.

Cross-checks export table offsets/sizes against the reference tool
`tools/bin/umodel -game=l2 -list` (UEViewer build) for every package.
"""

import os
import unittest

from l2lib import (
    L2Error, Package, Reader, decode_121, detect_protocol, encode_compact,
    load_package, mesh_material_slots, parse_texture,
    resolve_material,
)
from l2lib.tests.common import (
    FIGHTER_UKX, SAMPLE_UTX, STATS, SYSTEX_DIR, TEXTURES_DIR, umodel_list,
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


if __name__ == "__main__":
    unittest.main()
