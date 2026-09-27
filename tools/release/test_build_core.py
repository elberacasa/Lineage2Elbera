"""Release boundary regressions use synthetic files, never client assets."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from build_core import FILES, build_bytes, source_bytes


class CoreReleaseTests(unittest.TestCase):
    def fixture(self, root):
        for source in FILES.values():
            path = root / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('# synthetic source: ' + source + '\n')

    def test_archive_is_reproducible_and_cannot_sweep_adjacent_game_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            private = root / 'tools/l2lib/private.dat'
            private.write_bytes(b'not a release input\0')
            one, prefix = build_bytes(root, 'test.1', 'revision')
            two, _ = build_bytes(root, 'test.1', 'revision')
            self.assertEqual(one, two)
            with zipfile.ZipFile(io.BytesIO(one)) as archive:
                paths = {name[len(prefix) + 1:] for name in archive.namelist()}
                self.assertEqual(paths, set(FILES) | {'MANIFEST.json'})
                manifest = json.loads(archive.read(prefix + '/MANIFEST.json'))
                for row in manifest['files']:
                    raw = archive.read(prefix + '/' + row['path'])
                    self.assertEqual(row['sha256'], hashlib.sha256(raw).hexdigest())
                    self.assertEqual(row['bytes'], len(raw))

    def test_symlinks_missing_source_and_binary_replacement_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, 'missing'):
                source_bytes(root, 'missing.py')
            (root / 'private').write_bytes(b'private\0data')
            (root / 'link.py').symlink_to(root / 'private')
            with self.assertRaisesRegex(ValueError, 'symlink'):
                source_bytes(root, 'link.py')
            with self.assertRaisesRegex(ValueError, 'binary'):
                source_bytes(root, 'private')
            for name in ('../private', '/private'):
                with self.assertRaisesRegex(ValueError, 'unsafe'):
                    source_bytes(root, name)

    def test_unsafe_version_cannot_change_archive_paths(self):
        for version in ('../escape', 'x/y', '', 'a' * 65):
            with self.assertRaisesRegex(ValueError, 'version'):
                build_bytes(Path('/unused'), version, 'revision')


if __name__ == '__main__':
    unittest.main()
