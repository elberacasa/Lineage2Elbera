#!/usr/bin/env python3
"""Elbera Tools: audit original player scale against built browser geometry.

No browser, game server or account is required. Private prerequisites:
the supported local Interlude client under assets/interlude/, generated
editor/characters/charcreate-data.json, manifest.json and model glTF/buffers.
Python needs the native verifier's Capstone dependency; Node.js runs the
vendored GLTFLoader. No original binary is executed or written.

Only the requested receipt is written. This checks ordinary static local
scale and measures browser centering; native placement/grounding and full
animation/render fidelity remain outside its proof.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / 'tmp/restart-audit/player-transform-audit.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def collect_receipt():
    sys.path[:0] = [str(ROOT / p) for p in (
        'tools/dat', 'tools/ui', 'tools/src/char_pipeline')]
    from export_npc_visuals import OriginalClasses, original_mesh_scale, resolve_visual
    from check_actor_native import verify
    import build_characters as builder
    import scale_util

    # Reject unsupported native binaries before doing the geometry pass.
    proof = verify()
    classes = OriginalClasses()
    bindings = builder.load_creation_bindings()
    bounds = {m['id']: m for m in json.loads(subprocess.check_output(
        ['node', str(Path(__file__).with_name('audit_player_bounds.mjs'))], cwd=ROOT))}
    receipt = {'format': 'elbera-player-transform-audit-v2',
               'createdUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'scope': 'ordinary local scale; native placement/grounding unresolved',
               'nativeScaleProof': proof, 'models': [], 'packages': {}}
    for cid, _, _, _, pkgname, prefix, _ in builder.COMBOS:
        qualified = 'LineageWarrior.' + prefix
        visual = resolve_visual(qualified, classes.get)
        package = builder.load_ukx(pkgname)
        package_path = ROOT / 'assets/interlude/animations' / (pkgname + '.ukx')
        receipt['packages'][str(package_path.relative_to(ROOT))] = sha(package_path.read_bytes())
        parts = []
        for suffix, binding in bindings[cid].items():
            if suffix in ('_ah', '_bh'):
                if binding.get('sourceStatus') == 'source-absent':
                    builder.required_hair_mesh(binding, package, [])  # Reject conflicting absence metadata.
                    continue
                export = builder.source_hair_export(package, binding['sourceMesh'],
                    'SkeletalMesh', binding['meshExportSHA256'])
            else:
                export = package.find_export(binding['mesh'])
            if export is None:
                raise ValueError(f'missing required source mesh {pkgname}.{binding["mesh"]}')
            scale, version, offset = original_mesh_scale(package, export)
            parts.append({
                'suffix': suffix, 'mesh': pkgname + '.' + binding['mesh'],
                'exportSHA256': sha(package.data[export.serial_offset:export.serial_offset + export.serial_size]),
                'version': version, 'scaleOffset': offset, 'meshScale': scale,
                'meshOrigin': list(struct.unpack_from('<3f', package.data, offset + 12)),
                'rotOrigin': list(struct.unpack_from('<3i', package.data, offset + 24)),
            })
        model = {**bounds[cid], 'class': qualified, 'visual': visual,
                 'sourceParts': parts, 'bindAccessorYExtent': scale_util.gltf_y_extent(
                     str(ROOT / 'editor/characters' / bounds[cid]['gltf']))}
        upper = next(part for part in parts if part['suffix'] == '_u')
        # Preserve the original float32 multiply stages, not a height fit.
        f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
        source_scale = [f32(f32(visual['drawScale'] * visual['drawScale3D'][i])
                            * upper['meshScale'][i]) for i in range(3)]
        model['sourceDiagonalBrowserXYZ'] = [source_scale[i] for i in (0, 2, 1)]
        model['relativeScaleErrorPercent'] = [
            (actual / expected - 1) * 100 for actual, expected in zip(
                model['runtimeScale'], model['sourceDiagonalBrowserXYZ'])]
        model['legacyHeightFitErrorPercent'] = (model['legacyHeightFitScale'] / source_scale[2] - 1) * 100
        receipt['models'].append(model)
    receipt['classPackages'] = classes.sources
    receipt['classes'] = classes.classes
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT,
                        help='private JSON receipt; relative paths use the current directory')
    args = parser.parse_args()
    receipt = collect_receipt()
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'receipt': str(output), 'models': len(receipt['models']),
                      'parts': sum(len(m['sourceParts']) for m in receipt['models']),
                      'maxAbsoluteScaleErrorPercent': max(
                          abs(v) for m in receipt['models'] for v in m['relativeScaleErrorPercent'])}))


if __name__ == '__main__':
    main()
