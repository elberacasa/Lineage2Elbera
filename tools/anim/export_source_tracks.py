#!/usr/bin/env python3
"""Elbera Tools: retain original sparse player animation keys for inspection.

No PSA/glTF sampling, quaternion normalization or synthesized keys. Default is
a read-only audit. --write emits private data; --check compares existing bytes.
--runtime packs complete catalog/skeleton inputs using Elbera's authored
transport metadata and exact Float32 key arrays, not a native game file format.
This preserves source inputs, not complete native playback or bone association.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
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


def collect_skeletons(model='all'):
    """Original face master, its stored animation and first-name linkup.

    No converted model or previously generated metadata is required. The exact
    class Mesh tag must independently join one original chargrp face entry.
    Source/native selection evidence is separate from browser mesh attachment.
    """
    sys.path[:0] = [str(ROOT / p) for p in ('tools/dat', 'tools/ui', 'tools/src/char_pipeline')]
    from build_hair import Sources, source_lod0, object_reference
    from check_hair_attachment_native import audit_pawn_defaults
    from check_animation_linkup_native import decoded_name_linkup, first_interned_linkup
    from extract_charcreate import decrypt, parse_chargrp
    selected = {row[0]: row for row in pawn.PAWNS if model == 'all' or row[0] == model}
    if not selected:
        raise ValueError('unknown original player model')
    defaults = audit_pawn_defaults()
    with tempfile.TemporaryDirectory() as temp:
        chargrp = decrypt('chargrp.dat', temp)
    records = parse_chargrp(chargrp)
    sources, result = Sources(), {}
    for row in defaults['rows']:
        model_id = row['modelId']
        if model_id not in selected:
            continue
        package_name, mesh_name = row['fields']['Mesh']['value']
        reference = package_name + '.' + mesh_name
        matches = [(i, record) for i, record in enumerate(records)
                   if any(ref.casefold() == reference.casefold() for ref in record['face_mesh'])]
        if len(matches) != 1 or len(matches[0][1]['face_mesh']) != 1:
            raise ValueError('missing or ambiguous original master face: ' + model_id)
        package = sources.get('animations', package_name)
        meshes = [e for e in package.exports_by_class('SkeletalMesh')
                  if package.export_name(e).casefold() == mesh_name.casefold() and e.package_index == 0]
        if len(meshes) != 1:
            raise ValueError('missing or ambiguous original master mesh: ' + reference)
        mesh = source_lod0(package, meshes[0])
        animation_ref = object_reference(package, mesh['animationReference'])
        _, animation_package, prefix = selected[model_id]
        expected = animation_package + '.' + prefix + '_anim'
        if animation_package.casefold() != package_name.casefold():
            raise ValueError('cross-package master animation is outside this source path')
        if not animation_ref or animation_ref.casefold() != expected.casefold():
            raise ValueError('master mesh animation differs from the selected original export')
        animations = [e for e in package.exports_by_class('MeshAnimation')
                      if package.export_name(e).casefold() == (prefix + '_anim').casefold()
                      and e.package_index == 0]
        if len(animations) != 1:
            raise ValueError('missing or ambiguous master MeshAnimation')
        animation_export = animations[0]
        animation_bones = pawn.original_animation(package, animation_export)['bones']
        bindings = decoded_name_linkup([bone['name'] for bone in mesh['bones']],
                                       [bone['name'] for bone in animation_bones])
        # Decoded spellings are only a safe FName adapter after this original
        # same-package name-table uniqueness gate. Recheck by serialized token.
        by_name = {}
        for index, entry in enumerate(package.names):
            by_name.setdefault(entry.casefold(), []).append(index)
        def token(bone):
            matches = by_name.get(bone['name'].casefold(), [])
            if len(matches) != 1:
                raise ValueError('missing or ambiguous original name-table token')
            return matches[0]
        if bindings != first_interned_linkup([token(b) for b in mesh['bones']],
                                             [token(b) for b in animation_bones]):
            raise ValueError('decoded linkup differs from original name-table tokens')
        start = animation_export.serial_offset
        result[model_id] = {'format': 'elbera-original-player-skeleton-v1',
            'modelId': model_id, 'meshRef': reference, 'animationRef': animation_ref,
            'bones': mesh['bones'], 'animationBones': animation_bones, 'trackBindings': bindings,
            'source': {'packageSHA256': pawn.file_sha256(package.path),
                'meshExportSHA256': mesh['sourceExportSHA256'],
                'animationExportSHA256': hashlib.sha256(package.data[start:start + animation_export.serial_size]).hexdigest(),
                'chargrpSHA256': pawn.file_sha256(ROOT / 'assets/interlude/system/chargrp.dat'),
                'decryptedChargrpSHA256': hashlib.sha256(chargrp).hexdigest(),
                'chargrpIndex': matches[0][0], 'classPackages': defaults['sourcePackages'],
                'class': row['class'], 'classDefaultsEvidence': row['defaultsEvidence']}}
    if set(result) != set(selected):
        raise ValueError('missing requested original player class')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', nargs='?', default='all', choices=['all'] + [r[0] for r in pawn.PAWNS])
    content = parser.add_mutually_exclusive_group()
    content.add_argument('--skeletons', action='store_true', help='retain source face reference bones and native track bindings')
    content.add_argument('--runtime', action='store_true', help='pack all original sequences and source skeleton as private ELBA transport')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='write ignored private source data')
    mode.add_argument('--check', action='store_true', help='freshly decode and compare private output bytes')
    args = parser.parse_args(argv)
    # Decode and encode every requested model before any output is changed.
    if args.runtime:
        from pack_source_tracks import pack_animation_bundle
        catalogs, skeletons = collect(args.model), collect_skeletons(args.model)
        if set(catalogs) != set(skeletons):
            raise ValueError('runtime source model sets differ')
        rows = [(model, data, pack_animation_bundle(data, skeletons[model]))
                for model, data in catalogs.items()]
    else:
        collector = collect_skeletons if args.skeletons else collect
        rows = [(model, data, encoded(data)) for model, data in collector(args.model).items()]
    directory = OUTPUT / 'runtime' if args.runtime else OUTPUT
    for model, data, blob in rows:
        target = directory / (model + ('.l2anim' if args.runtime else '.skeleton.json' if args.skeletons else '.json'))
        if args.check and (not target.exists() or target.read_bytes() != blob):
            raise ValueError('missing or stale private source tracks: ' + model)
        if args.write:
            directory.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=directory, prefix='.' + model, delete=False) as stream:
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
        detail = (f'{sum(i < 0 for i in data["trackBindings"])} unlinked reference bones' if args.skeletons
                  else f'{len(data["sequences"])} source sequences')
        print(f'{model}: {len(data["bones"])} bones, {detail}; '
              f'{"checked" if args.check else "written" if args.write else "read-only"}; {len(blob)} bytes')


if __name__ == '__main__':
    main()
