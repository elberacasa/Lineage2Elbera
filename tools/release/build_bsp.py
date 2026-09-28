#!/usr/bin/env python3
"""Elbera Tools: build the standalone, source-only BSP Inspector kit."""
import argparse
import hashlib
from pathlib import Path
import subprocess

from build_core import ROOT, build_source_archive, smoke_archive

FILES = {
    'README.md': 'tools/release/BSP-README.md',
    'LICENSE': 'LICENSE',
    'package.json': 'tools/release/BSP-package.json',
    'editor/world/js/bsp-collision.js': 'editor/world/js/bsp-collision.js',
    'editor/world/test/bsp-collision.test.mjs': 'editor/world/test/bsp-collision.test.mjs',
    'editor/world/test/bsp-original.html': 'editor/world/test/bsp-original.html',
    'editor/world/test/bsp-original.js': 'editor/world/test/bsp-original.js',
    # The full repository index links to tools deliberately absent from this kit.
    'editor/world/test/index.html': 'tools/release/BSP-INDEX.html',
    'tools/release/smoke_bsp.py': 'tools/release/smoke_bsp.py',
}


def build_bytes(root, version, revision, source_state='working-tree-candidate'):
    return build_source_archive(root, version, revision, FILES, 'bsp-inspector', source_state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='0.1.0')
    parser.add_argument('--output', type=Path, help='write a new ZIP; refuses overwrite')
    parser.add_argument('--check', action='store_true', help='build and check extracted sources without writing a ZIP')
    args = parser.parse_args()
    if args.check == bool(args.output):
        parser.error('choose exactly one of --check or --output')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT, text=True)
    state = 'working-tree-candidate' if dirty else 'committed-source'
    raw, prefix = build_bytes(ROOT, args.version, revision, state)
    smoke_archive(raw, prefix, 'tools/release/smoke_bsp.py')
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as output:
            output.write(raw)
        print(f'Created {args.output} ({len(raw)} bytes)')
    print(f'Elbera Tools BSP Inspector: {len(FILES)} allowlisted files; {state}; SHA256 {hashlib.sha256(raw).hexdigest()}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
