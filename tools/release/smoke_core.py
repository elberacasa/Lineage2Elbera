#!/usr/bin/env python3
"""Elbera Tools Core portable smoke tests; no game files or application."""
from pathlib import Path
import struct
import subprocess
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from l2lib import L2Error, Package, Reader, qualified_ref
from l2lib.l2dat import DatReader
from l2lib.textures import decode_dxt1, decode_rgb8


class CoreSmoke(unittest.TestCase):
    def test_qualified_references_keep_groups_without_world_exporter(self):
        package = Package.__new__(Package)
        package.path = Path('Example.usx')
        package.names = ['Group', 'Mesh', 'Assets']
        package.exports = [SimpleNamespace(name_index=0, package_index=0),
                           SimpleNamespace(name_index=1, package_index=1)]
        package.imports = [SimpleNamespace(object_name=2, package_index=0),
                           SimpleNamespace(object_name=0, package_index=-1),
                           SimpleNamespace(object_name=1, package_index=-2)]
        self.assertEqual(qualified_ref(package, 2), 'Example.Group.Mesh')
        self.assertEqual(qualified_ref(package, -3), 'Assets.Group.Mesh')
        for reference in (99, -99):
            with self.assertRaises(L2Error): qualified_ref(package, reference)
        with self.assertRaisesRegex(ValueError, 'null'): qualified_ref(package, 0)
        package.imports[1].package_index = -3
        with self.assertRaisesRegex(ValueError, 'cyclic'): qualified_ref(package, -3)

    def test_independent_compact_integer_vectors(self):
        for wire, expected in [(b'\0', 0), (b'\x3f', 63), (b'\x40\x01', 64),
                               (b'\xc0\x01', -64), (b'\x40\x80\x01', 8192)]:
            self.assertEqual(Reader(wire).compact(), expected)
        with self.assertRaises((L2Error, IndexError, struct.error)):
            Reader(b'\x40').compact()

    def test_dat_strings_preserve_unicode_and_boundaries(self):
        reader = DatReader(b'\x04\0\0\0A\0\xa9\x03\x03Hi\0')
        self.assertEqual(reader.ustr(), 'AΩ')
        self.assertEqual(reader.ascf(), 'Hi')
        self.assertTrue(reader.done())
        with self.assertRaises(L2Error):
            DatReader(b'\x04\0\0\0A\0').ustr()

    def test_pixel_decoders_on_synthetic_known_colors(self):
        self.assertEqual(decode_rgb8(bytes([3, 2, 1]), 1, 1), bytes([1, 2, 3, 255]))
        red_block = struct.pack('<HHI', 0xf800, 0x07e0, 0)
        self.assertEqual(decode_dxt1(red_block, 4, 4), bytes([255, 0, 0, 255]) * 16)

    def test_decoder_entrypoints_load_without_app_or_client(self):
        for script in ['tools/xdat/parse_xdat.py', 'tools/uscript/extract_uscript.py']:
            result = subprocess.run([sys.executable, '-I', script, '--help'], cwd=ROOT,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('--check', result.stdout)
        result = subprocess.run([sys.executable, '-I', 'tools/utx/utxedit.py'], cwd=ROOT,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)  # documented usage, not false success
        self.assertIn('replace', result.stderr)


def main():
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CoreSmoke)
    for directory, pattern in [('uscript', 'test_extract_uscript.py'), ('xdat', 'test_parse_xdat.py')]:
        path = str(ROOT / 'tools' / directory)
        sys.path.insert(0, path)
        loader = unittest.TestLoader()
        suite.addTests(loader.discover(path, pattern=pattern, top_level_dir=path))
    return 0 if unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
