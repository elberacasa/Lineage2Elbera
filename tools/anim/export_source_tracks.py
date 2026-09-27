#!/usr/bin/env python3
"""Elbera Tools: retain original sparse player animation keys for inspection.

No PSA/glTF sampling, quaternion normalization or synthesized keys. Default is
a read-only audit. --write emits private JSON; --check compares existing bytes.
This preserves source inputs, not complete native playback or bone association.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile

import build_pawnanim as pawn

ROOT = Path(pawn.ROOT)
OUTPUT = ROOT / 'assets/gamedata/animation-tracks'


def collect(model='all'):
    selected = [row for row in pawn.PAWNS if model == 'all' or row[0] == model]
    if not selected:
        raise ValueError('unknown original player model')
    packages, result = {}, {}
    for model_id, package_name, prefix in selected:
        if package_name not in packages:
            path = Path(pawn.ANIMS) / (package_name + '.ukx')
            packages[package_name] = (pawn.load_package(str(path))[0], pawn.file_sha256(path))
        package, package_sha = packages[package_name]
        exports = [e for e in package.exports if package.class_name_of(e) == 'MeshAnimation'
                   and package.export_name(e).casefold() == (prefix + '_anim').casefold()
                   and e.package_index == 0]
        if len(exports) != 1:
            raise ValueError('missing or ambiguous qualified MeshAnimation: ' + prefix)
        export = exports[0]
        data = pawn.original_animation(package, export, include_tracks=True)
        start, end = export.serial_offset, export.serial_offset + export.serial_size
        result[model_id] = {'format': 'elbera-original-animation-tracks-v1',
            'modelId': model_id, 'animationRef': package_name + '.' + package.export_name(export),
            'source': {'packageSHA256': package_sha,
                'fileVersion': package.file_version, 'licenseeVersion': package.licensee_version,
                'exportOffset': start, 'exportSize': export.serial_size,
                'exportSHA256': hashlib.sha256(package.data[start:end]).hexdigest()}, **data}
    return result


def encoded(catalog):
    return (json.dumps(catalog, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', nargs='?', default='all', choices=['all'] + [r[0] for r in pawn.PAWNS])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='write ignored private source-key JSON')
    mode.add_argument('--check', action='store_true', help='freshly decode and compare private output bytes')
    args = parser.parse_args(argv)
    # Decode and encode every requested model before any output is changed.
    rows = [(model, data, encoded(data)) for model, data in collect(args.model).items()]
    for model, data, blob in rows:
        target = OUTPUT / (model + '.json')
        if args.check and (not target.exists() or target.read_bytes() != blob):
            raise ValueError('missing or stale private source tracks: ' + model)
        if args.write:
            OUTPUT.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=OUTPUT, prefix='.' + model, delete=False) as stream:
                staged = Path(stream.name)
                try:
                    stream.write(blob)
                    stream.flush()
                except BaseException:
                    staged.unlink(missing_ok=True)
                    raise
            try:
                staged.replace(target)
            finally:
                staged.unlink(missing_ok=True)
        print(f'{model}: {len(data["bones"])} bones, {len(data["sequences"])} source sequences; '
              f'{"checked" if args.check else "written" if args.write else "read-only"}; {len(blob)} bytes')


if __name__ == '__main__':
    main()
