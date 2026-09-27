#!/usr/bin/env python3
"""Elbera Tools NPC Source checks: authored fixtures, no original/client inputs.

Run from an extracted NPC Source kit. --native-fixtures additionally requires
exact Capstone 5.0.7. Neither mode executes a DLL or certifies native fidelity.
"""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SUITES = (
    ('anim', 'test_pawnanim_source.py'),
    ('anim', 'test_export_source_tracks.py'),
    ('anim', 'test_build_npc_variants.py'),
    ('ui', 'test_npc_animation_native.py'),
    ('ui', 'test_animation_linkup_native.py'),
)
ENTRYPOINTS = (
    'tools/anim/build_npc_variants.py',
    'tools/anim/export_source_tracks.py',
    'tools/ui/check_npc_animation_native.py',
    'tools/ui/check_npc_skin_native.py',
)


def verify_manifest(root):
    root = Path(root)
    manifest = json.loads((root / 'MANIFEST.json').read_text())
    if manifest.get('format') != 'elbera-tools-npc-source-release-v1' or manifest.get('sourceOnly') is not True:
        raise ValueError('NPC Source manifest format required')
    seen = set()
    for row in manifest['files']:
        name = row['path']; path = PurePosixPath(name)
        if (not name or '\\' in name or path.is_absolute() or '..' in path.parts
                or str(path) != name or name in seen):
            raise ValueError('unsafe or repeated manifest path')
        seen.add(name)
        target = root
        for part in path.parts:
            target /= part
            if target.is_symlink():
                raise ValueError('symlink in manifest source')
        raw = target.read_bytes()
        if len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise ValueError('manifest source changed: ' + name)
    if not seen:
        raise ValueError('empty source manifest')
    return len(seen)


def require_native_fixtures():
    try:
        import capstone
        version = importlib.metadata.version('capstone')
    except (ImportError, importlib.metadata.PackageNotFoundError) as error:
        raise RuntimeError('native fixtures require capstone==5.0.7; install requirements-native.txt in a venv') from error
    if capstone.__version__ != '5.0.7' or version != '5.0.7':
        raise RuntimeError('native fixtures require both Capstone module and distribution version 5.0.7')


class StandaloneSmoke(unittest.TestCase):
    def run_python(self, arguments):
        environment = os.environ.copy()
        environment.pop('PYTHONPATH', None)
        environment['PYTHONDONTWRITEBYTECODE'] = '1'
        return subprocess.run([sys.executable, '-S', *arguments], cwd=ROOT,
                              env=environment, capture_output=True, text=True, timeout=15)

    def test_advertised_commands_load_without_originals_or_site_packages(self):
        for script in ENTRYPOINTS:
            with self.subTest(script=script):
                result = self.run_python([script, '--help'])
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('--check', result.stdout)

    def test_selector_import_does_not_require_legacy_converter(self):
        code = ("import sys;sys.path.insert(0,'tools/anim');import build_npc_variants;"
                "assert not {'assemble','build_monsters','build_characters','anim_stances'} & set(sys.modules)")
        result = self.run_python(['-c', code])
        self.assertEqual(result.returncode, 0, result.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-fixtures', action='store_true')
    args = parser.parse_args()
    count = verify_manifest(ROOT)
    if args.native_fixtures:
        require_native_fixtures()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(StandaloneSmoke)
    selected = SUITES + (('ui', 'test_supplemental_pe.py'),) if args.native_fixtures else SUITES
    for directory, pattern in selected:
        path = str(ROOT / 'tools' / directory)
        sys.path.insert(0, path)
        if pattern == 'test_pawnanim_source.py':
            # The full-repository file also contains an original-input test.
            # Never activate it merely because a user later populates assets/.
            module = importlib.import_module('test_pawnanim_source')
            suite.addTests(unittest.TestLoader().loadTestsFromTestCase(module.SyntheticSourceTests))
        else:
            suite.addTests(unittest.TestLoader().discover(path, pattern=pattern, top_level_dir=path))
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if result.wasSuccessful():
        extra = 'including synthetic PE cases' if args.native_fixtures else 'native original-input checks not run'
        print(f'Elbera NPC Source: {count} manifest files verified; {extra}.')
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
