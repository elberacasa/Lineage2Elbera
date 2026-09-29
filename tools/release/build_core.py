#!/usr/bin/env python3
"""Elbera Tools: build and test an allowlisted, standalone Python source kit."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
# Explicit paths, never a directory archive, extension glob or git checkout.
FILES = {
    'README.md': 'tools/release/CORE-README.md',
    'LICENSE': 'LICENSE',
    'docs/public-release-boundary.md': 'docs/public-release-boundary.md',
    **{f'tools/l2lib/{name}': f'tools/l2lib/{name}' for name in
       ('README.md', '__init__.py', 'ue2package.py', 'textures.py', 'l2dat.py',
        'classdata.py', 'declarations.py', 'propertylayout.py', 'stringproperty.py',
        'tests/test_classdata.py', 'tests/test_stringproperty.py',
        'tests/test_polys.py', 'tests/test_declarations.py', 'tests/test_propertylayout.py')},
    'docs/native-class-defaults-evidence.md': 'docs/native-class-defaults-evidence.md',
    **{f'tools/utx/{name}': f'tools/utx/{name}' for name in ('README.md', 'utxedit.py')},
    **{f'tools/uscript/{name}': f'tools/uscript/{name}' for name in
       ('extract_uscript.py', 'test_extract_uscript.py')},
    **{f'tools/xdat/{name}': f'tools/xdat/{name}' for name in
       ('parse_xdat.py', 'test_parse_xdat.py')},
    'tools/release/smoke_core.py': 'tools/release/smoke_core.py',
}


def source_bytes(root, name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError(f'unsafe source path: {name}')
    current = Path(root)
    for part in path.parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f'symlink is not a release source: {name}')
    if not current.is_file():
        raise ValueError(f'missing release source: {name}')
    raw = current.read_bytes()
    raw.decode('utf-8')  # This kit contains text source/docs only.
    if b'\0' in raw:
        raise ValueError(f'binary data is not a release source: {name}')
    return raw


def build_bytes(root, version, revision):
    return build_source_archive(root, version, revision, FILES, 'core')


def build_source_archive(root, version, revision, files, kit, source_state=None):
    """Shared deterministic archive machinery; each kit supplies an allowlist."""
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', version):
        raise ValueError('version must be a short filename-safe label')
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', kit):
        raise ValueError('kit must be a short lowercase filename-safe label')
    for name in files:
        path = PurePosixPath(name)
        if (not name or '\\' in name or path.is_absolute() or '..' in path.parts
                or str(path) != name or name == 'MANIFEST.json'):
            raise ValueError(f'unsafe archive path: {name}')
    prefix = f'elbera-tools-{kit}-{version}'
    payload = {name: source_bytes(root, source) for name, source in files.items()}
    manifest = {
        'format': f'elbera-tools-{kit}-release-v1', 'version': version,
        'sourceRevision': revision, 'sourceOnly': True,
        'files': [{'path': name, 'sourcePath': files[name], 'bytes': len(raw),
                   'sha256': hashlib.sha256(raw).hexdigest()}
                  for name, raw in sorted(payload.items())],
    }
    if source_state is not None:
        if source_state not in ('working-tree-candidate', 'committed-source'):
            raise ValueError('unknown source state')
        manifest['sourceState'] = source_state
    payload['MANIFEST.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(payload.items()):
            info = zipfile.ZipInfo(f'{prefix}/{name}', (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return stream.getvalue(), prefix


def smoke_archive(raw, prefix, script='tools/release/smoke_core.py', arguments=()):
    # Unpack only the archive just constructed above. No local assets, app,
    # symlinks, external package installation or inherited PYTHONPATH needed.
    with tempfile.TemporaryDirectory(prefix='elbera-tools-core-') as temp:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            archive.extractall(temp)
        subprocess.run([sys.executable, '-I', script, *arguments],
                       cwd=Path(temp) / prefix, check=True, timeout=60)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='0.1.0')
    parser.add_argument('--output', type=Path, help='write a new ZIP; refuses overwrite')
    parser.add_argument('--check', action='store_true', help='validate and smoke-test without writing')
    args = parser.parse_args()
    if args.check == bool(args.output):
        parser.error('choose exactly one of --check or --output')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    raw, prefix = build_bytes(ROOT, args.version, revision)
    smoke_archive(raw, prefix)
    digest = hashlib.sha256(raw).hexdigest()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as output:
            output.write(raw)
        print(f'Created {args.output} ({len(raw)} bytes)')
    print(f'Elbera Tools Core: {len(FILES)} allowlisted files; SHA256 {digest}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
