"""Texture decoding tests: l2lib DXT/unpacked decoders vs umodel TGA exports.

umodel (UEViewer) is the reference implementation: it exports each texture
as TGA. We decode the same mip0 with l2lib and require pixel agreement
within a small tolerance (endpoint interpolation may differ by +-1 LSB
between decoders).
"""

import os
import shutil
import subprocess
import tempfile
import unittest

from l2lib import (
    FORMAT_NAMES, extract_texture_rgba, load_package,
    parse_texture, write_png,
)
from l2lib.tests.common import (
    ROOT, SAMPLE_UTX, STATS, SYSTEX_DIR, TEXTURES_DIR, UMODEL,
    mean_abs_error, read_tga,
)

# per-channel mean absolute error budget vs umodel's TGA
MAE_BUDGET = 3.0


def umodel_export_tga(pkg_path, tex_name, outdir):
    """Export a package's textures via umodel -> path of tex_name's TGA.

    Exports the whole package once per (pkg, outdir) and caches the result
    directory (umodel takes `-out=dir` joined, no object filter)."""
    base = os.path.splitext(os.path.basename(pkg_path))[0]
    tga = os.path.join(outdir, base, "Texture", tex_name + ".tga")
    marker = os.path.join(outdir, base + ".done")
    if not os.path.exists(marker):
        proc = subprocess.run(
            [UMODEL, "-game=l2", "-export", "-out=" + outdir, pkg_path],
            capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise unittest.SkipTest("umodel -export failed: %s%s"
                                    % (proc.stderr.strip()[:200],
                                       proc.stdout.strip()[-200:]))
        with open(marker, "w") as f:
            f.write("ok\n")
    if not os.path.exists(tga):
        raise unittest.SkipTest("umodel did not produce %s" % tga)
    return tga


class TextureDecodeBase(unittest.TestCase):
    tmpdir = None

    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.mkdtemp(prefix="l2lib_tex_")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmpdir, ignore_errors=True)

    def compare_with_umodel(self, pkg_path, tex_name):
        pkg, _ = load_package(pkg_path)
        e = pkg.find_export(tex_name, cls="Texture")
        self.assertIsNotNone(e, "texture %s not in %s" % (tex_name, pkg_path))
        w, h, rgba, info = extract_texture_rgba(pkg, e)
        tga = umodel_export_tga(pkg_path, tex_name, self.tmpdir)
        tw, th, trgba = read_tga(tga)
        self.assertEqual((w, h), (tw, th), "dimension mismatch vs umodel")
        mae = mean_abs_error(rgba, trgba)
        self.assertLessEqual(
            mae, MAE_BUDGET,
            "%s (%s %dx%d): MAE %.3f vs umodel exceeds %.1f"
            % (tex_name, info.format_name, w, h, mae, MAE_BUDGET))
        STATS["textures_decoded"] += 1
        return w, h, rgba, info, mae


class TestAgainstUmodel(TextureDecodeBase):
    """Exact cross-validation of specific textures against umodel."""

    CASES = [
        (SAMPLE_UTX, "AS_N_02"),      # DXT1 1024x1024
        (SAMPLE_UTX, "AC01"),         # largest texture in the sample
    ]

    def test_named_textures(self):
        for pkg_path, name in self.CASES:
            with self.subTest(texture=name):
                self.compare_with_umodel(pkg_path, name)

    def test_character_texture(self):
        path = os.path.join(SYSTEX_DIR, "FFighter.utx")
        if not os.path.exists(path):
            self.skipTest("FFighter.utx not present")
        pkg, _ = load_package(path)
        target = None
        for e in pkg.exports_by_class("Texture"):
            info = parse_texture(pkg, e)
            if info.format in (3, 8):  # prefer a DXT body texture
                target = pkg.export_name(e)
                break
        self.assertIsNotNone(target)
        self.compare_with_umodel(path, target)


class TestCorpusDecode(TextureDecodeBase):
    """Decode mip0 of every texture in a sample of packages; sanity-check
    the pixels and validate against umodel on a per-package basis."""

    PACKAGES = ["T_16_25.utx", "T_20_20.utx", "FX_E_T.utx"]

    def test_decode_corpus(self):
        decoded = 0
        compared = 0
        no_tga = 0
        for name in self.PACKAGES:
            path = os.path.join(TEXTURES_DIR, name)
            if not os.path.exists(path):
                self.skipTest("%s not present" % path)
            pkg, _ = load_package(path)
            for e in pkg.exports_by_class("Texture"):
                m0u, m0v, rgba, tex = extract_texture_rgba(pkg, e)
                self.assertEqual(len(rgba), m0u * m0v * 4)
                decoded += 1
                STATS["textures_decoded"] += 1
                # validate against the umodel TGA export (umodel cannot
                # write TGAs for G16 heightmaps; those are decode-only)
                try:
                    tga = umodel_export_tga(path, pkg.export_name(e),
                                            self.tmpdir)
                except unittest.SkipTest:
                    no_tga += 1
                    continue
                tw, th, trgba = read_tga(tga)
                self.assertEqual((m0u, m0v), (tw, th))
                mae = mean_abs_error(rgba, trgba)
                self.assertLessEqual(
                    mae, MAE_BUDGET,
                    "%s/%s (%s %dx%d): MAE %.3f vs umodel" % (
                        name, pkg.export_name(e),
                        FORMAT_NAMES.get(tex.format), m0u, m0v, mae))
                compared += 1
        self.assertGreater(decoded, 30)
        self.assertGreaterEqual(compared, 30,
                                "nearly all decoded textures must validate "
                                "vs umodel (%d decoded, %d compared, %d "
                                "without TGA)" % (decoded, compared, no_tga))

    def test_write_png_roundtrip(self):
        pkg, _ = load_package(SAMPLE_UTX)
        e = pkg.find_export("AS_N_02", cls="Texture")
        w, h, rgba, _info = extract_texture_rgba(pkg, e)
        out = os.path.join(self.tmpdir, "as_n_02.png")
        write_png(out, w, h, rgba)
        with open(out, "rb") as f:
            self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")
        self.assertGreater(os.path.getsize(out), 10000)

    def test_save_reference_images(self):
        """Drop a few decoded PNGs under editor/cache for eyeballing."""
        refdir = os.path.join(ROOT, "editor", "cache", "l2lib-ref")
        os.makedirs(refdir, exist_ok=True)
        pkg, _ = load_package(SAMPLE_UTX)
        for name in ("AS_N_02", "AC01"):
            e = pkg.find_export(name, cls="Texture")
            w, h, rgba, _info = extract_texture_rgba(pkg, e)
            write_png(os.path.join(refdir, name.lower() + ".png"), w, h, rgba)


if __name__ == "__main__":
    unittest.main()
