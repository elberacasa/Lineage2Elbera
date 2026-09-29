"""Elbera Tools packaging checks: authored fixtures and isolated source only."""
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
import build_npc_source as kit
from smoke_npc_source import verify_manifest


class NpcSourceReleaseTests(unittest.TestCase):
    def fixture(self, root):
        for source in kit.FILES.values():
            path = root / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('# authored fixture: ' + source + '\n')

    def unpack(self, raw, prefix, root):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            archive.extractall(root)
        return root / prefix

    def test_deterministic_explicit_archive_excludes_adjacent_inputs_and_app(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            excluded = ('assets/interlude/system/engine.dll', 'assets/gamedata/npcselectors.json',
                        'editor/characters/monsters/model.gltf', 'tools/anim/private.py',
                        'tools/release/local-receipt.json', 'editor/world/js/sourcepose.js')
            for name in excluded:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'synthetic private canary\0')
            one, prefix = kit.build_bytes(root, 'fixture.1', 'revision')
            two, _ = kit.build_bytes(root, 'fixture.1', 'revision')
            self.assertEqual(one, two)
            with zipfile.ZipFile(io.BytesIO(one)) as archive:
                names = [name[len(prefix) + 1:] for name in archive.namelist()]
                self.assertEqual(len(names), len(set(names)))
                self.assertEqual(set(names), set(kit.FILES) | {'MANIFEST.json'})
                self.assertTrue(set(excluded).isdisjoint(names))
                manifest = json.loads(archive.read(prefix + '/MANIFEST.json'))
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

    def test_committed_state_and_actual_source_change_are_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            first, prefix = kit.build_bytes(root, 'test', 'revision', 'committed-source')
            candidate, _ = kit.build_bytes(root, 'test', 'revision')
            self.assertNotEqual(first, candidate)
            with zipfile.ZipFile(io.BytesIO(first)) as archive:
                manifest = json.loads(archive.read(prefix + '/MANIFEST.json'))
                self.assertEqual(manifest['sourceState'], 'committed-source')
            (root / kit.FILES['README.md']).write_text('different authored guide\n')
            changed, _ = kit.build_bytes(root, 'test', 'revision', 'committed-source')
            self.assertNotEqual(first, changed)

    def test_missing_binary_or_symlink_source_cannot_enter_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            target = root / kit.MODULES[0]
            target.unlink()
            with self.assertRaisesRegex(ValueError, 'missing'):
                kit.build_bytes(root, 'test', 'revision')
            target.write_bytes(b'not source\0')
            with self.assertRaisesRegex(ValueError, 'binary'):
                kit.build_bytes(root, 'test', 'revision')
            target.unlink(); target.symlink_to(root / 'LICENSE')
            with self.assertRaisesRegex(ValueError, 'symlink'):
                kit.build_bytes(root, 'test', 'revision')

    def test_shared_builder_rejects_unsafe_member_names_and_metadata(self):
        for name in ('../private', '/private', 'x\\private', 'x//private', 'MANIFEST.json', ''):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'archive path'):
                build_core.build_source_archive(Path('/unused'), 'test', 'revision',
                                                {name:'source.py'}, 'npc-source')
        with self.assertRaisesRegex(ValueError, 'kit'):
            build_core.build_source_archive(Path('/unused'), 'test', 'revision', {}, '../escape')
        with self.assertRaisesRegex(ValueError, 'source state'):
            build_core.build_source_archive(Path('/unused'), 'test', 'revision', {},
                                            'npc-source', 'unreviewed-but-official')

    def test_manifest_detects_mutation_and_rejects_unsafe_or_duplicate_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'source'; self.fixture(source)
            raw, prefix = kit.build_bytes(source, 'test', 'revision')
            extracted = self.unpack(raw, prefix, root / 'extracted')
            self.assertEqual(verify_manifest(extracted), len(kit.FILES))
            manifest_path = extracted / 'MANIFEST.json'
            original = manifest_path.read_text(); manifest = json.loads(original)
            row = manifest['files'][0]
            target = extracted / row['path']; data = target.read_bytes()
            target.write_bytes(data + b'changed')
            with self.assertRaisesRegex(ValueError, 'changed'):
                verify_manifest(extracted)
            target.write_bytes(data)
            target.unlink(); target.symlink_to(source / kit.FILES[row['path']])
            with self.assertRaisesRegex(ValueError, 'symlink'):
                verify_manifest(extracted)
            target.unlink(); target.write_bytes(data)
            for replacement in ('../escape', '/escape', 'x\\escape'):
                modified = json.loads(original); modified['files'][0]['path'] = replacement
                manifest_path.write_text(json.dumps(modified))
                with self.assertRaisesRegex(ValueError, 'unsafe'):
                    verify_manifest(extracted)
            modified = json.loads(original); modified['files'].append(modified['files'][0])
            manifest_path.write_text(json.dumps(modified))
            with self.assertRaisesRegex(ValueError, 'repeated'):
                verify_manifest(extracted)

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            output = root / 'existing.zip'; output.write_bytes(b'keep this archive')
            with patch.object(kit, 'ROOT', root), patch.object(kit, 'smoke_archive'), \
                    patch.object(kit.subprocess, 'check_output', side_effect=['revision\n', 'dirty\n']), \
                    patch.object(sys, 'argv', ['build_npc_source.py', '--output', str(output)]):
                with self.assertRaises(FileExistsError):
                    kit.main()
            self.assertEqual(output.read_bytes(), b'keep this archive')

    def test_actual_extracted_kit_runs_without_repository_or_site_packages(self):
        raw, prefix = kit.build_bytes(build_core.ROOT, 'portable-test', 'test-revision')
        with tempfile.TemporaryDirectory(prefix='elbera-npc-kit-test-') as directory:
            extracted = self.unpack(raw, prefix, Path(directory))
            self.assertFalse((extracted / 'assets').exists())
            self.assertFalse((extracted / 'editor').exists())
            for absent in ('assemble.py', 'build_monsters.py', 'build_characters.py', 'anim_stances.py'):
                self.assertFalse(list(extracted.rglob(absent)), absent)
            result = subprocess.run([sys.executable, '-I', '-S', 'tools/release/smoke_npc_source.py'],
                                    cwd=extracted, text=True, capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            count = re.search(r'Ran (\d+) tests', result.stderr)
            self.assertIsNotNone(count, result.stderr)
            self.assertGreaterEqual(int(count.group(1)), 89)
            self.assertNotIn('skipped=', result.stderr)
            self.assertIn('native original-input checks not run', result.stdout)
            # Explicit optional dependency cannot silently become a skipped success.
            result = subprocess.run([sys.executable, '-I', '-S', 'tools/release/smoke_npc_source.py',
                                     '--native-fixtures'], cwd=extracted,
                                    text=True, capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('require capstone==5.0.7', result.stderr)

    def test_archive_guide_relative_links_resolve_in_extraction(self):
        raw, prefix = kit.build_bytes(build_core.ROOT, 'docs-test', 'test-revision')
        with tempfile.TemporaryDirectory() as directory:
            root = self.unpack(raw, prefix, Path(directory))
            for document in (root / 'README.md', root / 'docs/source-boundary.md'):
                for link in re.findall(r'\]\(([^)]+)\)', document.read_text()):
                    if '://' not in link and not link.startswith('#'):
                        self.assertTrue((document.parent / link.split('#')[0]).is_file(), link)

    def test_core_profile_does_not_acquire_npc_files_or_manifest_fields(self):
        raw, prefix = build_core.build_bytes(build_core.ROOT, 'core-test', 'test-revision')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            manifest = json.loads(archive.read(prefix + '/MANIFEST.json'))
            self.assertEqual(manifest['format'], 'elbera-tools-core-release-v1')
            self.assertNotIn('sourceState', manifest)
            self.assertEqual({row['path'] for row in manifest['files']}, set(build_core.FILES))
            self.assertNotIn('tools/anim/export_source_tracks.py', build_core.FILES)


if __name__ == '__main__':
    unittest.main()
