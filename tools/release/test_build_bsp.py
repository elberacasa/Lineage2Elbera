"""Portable source-only BSP archive and extracted dependency checks."""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import build_core
import build_bsp as kit
from smoke_bsp import dependency_closure, PageLinks, verify_manifest


class BspReleaseTests(unittest.TestCase):
    def fixture(self, root):
        for source in kit.FILES.values():
            path = root / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('# authored source fixture: ' + source + '\n')

    def unpack(self, raw, prefix, root):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            archive.extractall(root)
        return root / prefix

    def actual_kit(self, root):
        raw, prefix = kit.build_bytes(build_core.ROOT, 'portable-test', 'test-revision')
        return self.unpack(raw, prefix, root)

    def test_deterministic_allowlist_excludes_private_and_unrelated_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            for name in ('assets/interlude/system/engine.dll', 'assets/gamedata/bsp-collision.json',
                         'editor/world/test/private.json', 'editor/world/test/other.html',
                         'tools/release/local-receipt.json', 'tools/ui/check_bsp_camera_native.py'):
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'synthetic private canary\0')
            raw, prefix = kit.build_bytes(root, 'test', 'revision')
            self.assertEqual(raw, kit.build_bytes(root, 'test', 'revision')[0])
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                names = [name[len(prefix) + 1:] for name in archive.namelist()]
                self.assertEqual(set(names), set(kit.FILES) | {'MANIFEST.json'})
                self.assertEqual(len(names), len(set(names)))
                manifest = json.loads(archive.read(prefix + '/MANIFEST.json'))
                self.assertTrue(manifest['sourceOnly'])
                self.assertEqual(manifest['sourceState'], 'working-tree-candidate')
                self.assertEqual(manifest['sourceRevision'], 'revision')
                for row in manifest['files']:
                    data = archive.read(prefix + '/' + row['path'])
                    self.assertEqual(row['sourcePath'], kit.FILES[row['path']])
                    self.assertEqual(row['sha256'], hashlib.sha256(data).hexdigest())
                    self.assertEqual(row['bytes'], len(data))
                for info in archive.infolist():
                    self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                    self.assertEqual(info.external_attr >> 16, 0o100644)

    def test_source_state_and_actual_bytes_are_recorded_separately(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            committed, prefix = kit.build_bytes(root, 'test', 'revision', 'committed-source')
            self.assertNotEqual(committed, kit.build_bytes(root, 'test', 'revision')[0])
            with zipfile.ZipFile(io.BytesIO(committed)) as archive:
                manifest = json.loads(archive.read(prefix + '/MANIFEST.json'))
                self.assertEqual(manifest['sourceState'], 'committed-source')
            (root / kit.FILES['README.md']).write_text('changed source guide\n')
            self.assertNotEqual(committed, kit.build_bytes(root, 'test', 'revision', 'committed-source')[0])

    def test_missing_binary_and_symlink_source_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            target = root / kit.FILES['editor/world/js/bsp-collision.js']; target.unlink()
            with self.assertRaisesRegex(ValueError, 'missing'):
                kit.build_bytes(root, 'test', 'revision')
            target.write_bytes(b'not source\0')
            with self.assertRaisesRegex(ValueError, 'binary'):
                kit.build_bytes(root, 'test', 'revision')
            target.unlink(); target.symlink_to(root / 'LICENSE')
            with self.assertRaisesRegex(ValueError, 'symlink'):
                kit.build_bytes(root, 'test', 'revision')

    def test_manifest_detects_changed_symlink_duplicate_and_unsafe_members(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.actual_kit(Path(directory))
            self.assertEqual(verify_manifest(root), len(kit.FILES))
            manifest_path = root / 'MANIFEST.json'; original = manifest_path.read_text()
            target = root / 'LICENSE'; data = target.read_bytes()
            target.write_bytes(data + b'changed')
            with self.assertRaisesRegex(ValueError, 'changed'):
                verify_manifest(root)
            target.unlink(); target.symlink_to(root / 'README.md')
            with self.assertRaisesRegex(ValueError, 'symlink'):
                verify_manifest(root)
            target.unlink(); target.write_bytes(data)
            for replacement in ('../escape', '/escape', 'x\\escape', 'assets/private.json'):
                manifest = json.loads(original); manifest['files'][0]['path'] = replacement
                manifest_path.write_text(json.dumps(manifest))
                with self.assertRaisesRegex(ValueError, 'unexpected'):
                    verify_manifest(root)
            manifest = json.loads(original); manifest['files'].append(manifest['files'][0])
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'repeated'):
                verify_manifest(root)
            manifest = json.loads(original); manifest['files'].pop()
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                verify_manifest(root)

    def test_dependency_closure_rejects_external_missing_escaping_or_dynamic_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.actual_kit(Path(directory))
            self.assertEqual(len(dependency_closure(root)['modules']), 2)
            page = root / 'editor/world/test/bsp-original.html'; original_page = page.read_text()
            for reference in ('https://example.invalid/script.js', 'missing.js', '../../../../escape.js'):
                page.write_text('<script type="module" src="' + reference + '"></script>')
                with self.assertRaisesRegex(ValueError, 'dependency'):
                    dependency_closure(root)
            page.write_text(original_page)
            module = root / 'editor/world/test/bsp-original.js'; original_module = module.read_text()
            for statement in ("import('./missing.js');", "fetch('./source.json');", "import 'unbundled';"):
                module.write_text(original_module + '\n' + statement)
                with self.assertRaisesRegex(ValueError, 'dynamic|bare module'):
                    dependency_closure(root)

    def test_existing_output_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            output = root / 'existing.zip'; output.write_bytes(b'keep original')
            with patch.object(kit, 'ROOT', root), patch.object(kit, 'smoke_archive'), \
                    patch.object(kit.subprocess, 'check_output', side_effect=['revision\n', 'dirty\n']), \
                    patch.object(sys, 'argv', ['build_bsp.py', '--output', str(output)]):
                with self.assertRaises(FileExistsError): kit.main()
            self.assertEqual(output.read_bytes(), b'keep original')

    def test_actual_extracted_tests_and_pages_without_repository_or_site_packages(self):
        with tempfile.TemporaryDirectory(prefix='elbera-bsp-kit-test-') as directory:
            root = self.actual_kit(Path(directory))
            self.assertFalse((root / 'assets').exists())
            self.assertFalse((root / 'tools/ui').exists())
            result = subprocess.run([sys.executable, '-I', '-S', 'tools/release/smoke_bsp.py'],
                                    cwd=root, text=True, capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report['manifestFiles'], len(kit.FILES))
            self.assertGreaterEqual(report['tests']['tests'], 42)
            self.assertEqual(report['tests']['tests'], report['tests']['pass'])
            for field in ('fail', 'cancelled', 'skipped', 'todo'):
                self.assertEqual(report['tests'][field], 0)
            index = PageLinks(); index.feed((root / 'editor/world/test/index.html').read_text())
            self.assertEqual(index.links, ['bsp-original.html'])
            self.assertEqual(index.modules, [])
            self.assertEqual(json.loads((root / 'package.json').read_text()), {
                'name': 'elbera-tools-bsp-inspector', 'private': True, 'type': 'module'})
            for link in re.findall(r'\]\(([^)]+)\)', (root / 'README.md').read_text()):
                if '://' not in link and not link.startswith('#'):
                    self.assertTrue((root / link.split('#')[0]).is_file(), link)

    def test_shared_core_profile_remains_unchanged(self):
        self.assertEqual(len(build_core.FILES), 15)
        raw, prefix = build_core.build_bytes(build_core.ROOT, 'core-test', 'test-revision')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            manifest = json.loads(archive.read(prefix + '/MANIFEST.json'))
            self.assertEqual(manifest['format'], 'elbera-tools-core-release-v1')
            self.assertNotIn('sourceState', manifest)
            self.assertEqual({row['path'] for row in manifest['files']}, set(build_core.FILES))
            self.assertNotIn('editor/world/js/bsp-collision.js', build_core.FILES)


if __name__ == '__main__':
    unittest.main()
