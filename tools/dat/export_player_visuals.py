#!/usr/bin/env python3
"""Elbera Tools: exact original player scale bound to existing browser models.

Requires the owner's original Interlude packages, current creation bindings,
built glTF/buffers and Capstone. No model conversion, browser or game login.
Default writes a private receipt; --write-manifest adds compact scale records.
--check freshly resolves original fields and checks records against current
model bytes. Local scale only: no MeshOrigin, grounding or centering rule.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/dat', 'tools/ui', 'tools/src/char_pipeline')]
from export_npc_visuals import OriginalClasses, original_mesh_scale, resolve_visual

FORMAT = 'l2-interlude-player-visual-v1'
BROWSER_AXIS_ORDER = 'native-x-z-y'
MANIFEST = ROOT / 'editor/characters/manifest.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_sha(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())


def f32(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise ValueError('invalid source scale scalar')
    try:
        value = struct.unpack('<f', struct.pack('<f', value))[0]
    except OverflowError as error:
        raise ValueError('unrepresentable source scale scalar') from error
    if not math.isfinite(value):
        raise ValueError('nonfinite source scale scalar')
    return value


def exact_browser_scale(draw_scale, draw_scale3d, mesh_scale):
    if not isinstance(draw_scale3d, (list, tuple)) or len(draw_scale3d) != 3 \
            or not isinstance(mesh_scale, (list, tuple)) or len(mesh_scale) != 3:
        raise ValueError('invalid source scale vector')
    # Original ordinary MeshToWorld(1) stores Float32 after each multiply.
    axes = [f32(f32(f32(f32(draw_scale) * f32(a)) * f32(b)) * 1.0)
            for a, b in zip(draw_scale3d, mesh_scale)]
    return [axes[0], axes[2], axes[1]]


def common_mesh_scale(parts):
    if not parts:
        raise ValueError('no original mesh parts')
    scales = [tuple(f32(v) for v in p['meshScale']) for p in parts]
    if any(len(v) != 3 for v in scales) or any(v != scales[0] for v in scales[1:]):
        raise ValueError('original part scales differ; root-scale application unsupported')
    return list(scales[0])


def built_model(entry, base):
    relative = Path(entry['gltf'])
    if relative.is_absolute() or '..' in relative.parts or relative.suffix != '.gltf':
        raise ValueError('unsupported built model path')
    path = base / relative
    raw = path.read_bytes(); gltf = json.loads(raw)
    if gltf.get('asset', {}).get('generator') != 'l2vzla char_pipeline (psk full-skeleton)':
        raise ValueError('unverified scale-export pipeline')
    buffers = []
    for buffer in gltf.get('buffers', []):
        uri = buffer.get('uri')
        if not isinstance(uri, str) or Path(uri).name != uri or ':' in uri or '\\' in uri:
            raise ValueError('nonlocal built buffer')
        data = (path.parent / uri).read_bytes()
        if len(data) != buffer.get('byteLength'):
            raise ValueError('built buffer size mismatch')
        buffers.append({'uri': uri, 'byteLength': len(data), 'SHA256': sha(data)})
    if not buffers:
        raise ValueError('no built geometry buffer')
    meshes = gltf.get('meshes', [])
    names = [m.get('name') for m in meshes]
    if not names or any(not isinstance(n, str) or not n for n in names) or len(set(names)) != len(names):
        raise ValueError('missing or duplicate built mesh identity')
    nodes = gltf.get('nodes', [])
    roots = gltf.get('scenes', [])[gltf.get('scene', 0)]['nodes']
    for index, name in enumerate(names):
        matched = [(i, n) for i, n in enumerate(nodes) if n.get('mesh') == index]
        if len(matched) != 1:
            raise ValueError('ambiguous built mesh instance')
        i, node = matched[0]
        if i not in roots or node.get('name') != name or 'matrix' in node \
                or node.get('scale', [1, 1, 1]) != [1, 1, 1] \
                or node.get('translation', [0, 0, 0]) != [0, 0, 0] \
                or node.get('rotation', [0, 0, 0, 1]) != [0, 0, 0, 1] \
                or any(i in n.get('children', []) for n in nodes):
            raise ValueError('built mesh already has a local/parent transform')
    return names, {'gltf': entry['gltf'], 'gltfSHA256': sha(raw), 'buffers': buffers}


class PlayerVisualSource:
    def __init__(self):
        import build_characters as builder
        from check_actor_native import verify
        from check_cast_sound_native import model_voice_source
        self.builder = builder
        self.combos = {row[0]: row for row in builder.COMBOS}
        self.bindings = builder.load_creation_bindings()
        # Independent original chargrp/body/face identity join, not manifest labels.
        self.binding_evidence = model_voice_source()
        self.native = verify()
        self.classes = OriginalClasses()
        self.package_hashes = {}

    def model(self, entry):
        model_id = entry['id']
        if model_id not in self.combos:
            raise ValueError('unknown player model: ' + model_id)
        _, _, _, _, package_name, prefix, _ = self.combos[model_id]
        names, built = built_model(entry, ROOT / 'editor/characters')
        bindings = self.bindings[model_id]
        expected = {v['mesh'].casefold(): k for k, v in bindings.items() if v.get('mesh')}
        if any(n.casefold() not in expected for n in names):
            raise ValueError('built part absent from original creation binding')
        for suffix in ('_u', '_l', '_f'):
            if bindings[suffix]['mesh'].casefold() not in {n.casefold() for n in names}:
                raise ValueError('missing required original player part')
        class_path = 'LineageWarrior.' + prefix
        visual = resolve_visual(class_path, self.classes.get)
        package = self.builder.load_ukx(package_name)
        source = ROOT / 'assets/interlude/animations' / (package_name + '.ukx')
        if package_name not in self.package_hashes:
            self.package_hashes[package_name] = sha(source.read_bytes())
        parts = []
        for name in names:
            matches = [e for e in package.exports if package.class_name_of(e) == 'SkeletalMesh'
                       and package.export_name(e).casefold() == name.casefold()]
            if len(matches) != 1:
                raise ValueError('missing or ambiguous original skeletal mesh: ' + name)
            export = matches[0]
            scale, version, offset = original_mesh_scale(package, export)
            parts.append({'mesh': package_name + '.' + package.export_name(export),
                'suffix': expected[name.casefold()], 'meshScale': scale, 'lodMeshVersion': version,
                'meshScaleOffset': offset, 'exportOffset': export.serial_offset,
                'exportLength': export.serial_size,
                'exportSHA256': sha(package.data[export.serial_offset:export.serial_offset+export.serial_size])})
        mesh_scale = common_mesh_scale(parts)
        computed = exact_browser_scale(visual['drawScale'], visual['drawScale3D'], mesh_scale)
        evidence = {'modelId': model_id, 'classPath': class_path, 'visual': visual, 'parts': parts,
            'meshPackageSHA256': self.package_hashes[package_name], 'built': built,
            'classPackages': dict(self.classes.sources), 'classes': {
                name: self.classes.classes[name.casefold()] for name in visual['classChain']},
            'bindingEvidence': self.binding_evidence, 'nativeProofSHA256': canonical_sha(self.native),
            'browserAxisOrder': BROWSER_AXIS_ORDER, 'scaleApplication': 'unbaked-source-scale',
            'computedBrowserScale': computed}
        record = {'format': FORMAT, 'status': 'source-verified', 'modelId': model_id,
            'classPath': class_path, 'drawScale': visual['drawScale'], 'drawScale3D': visual['drawScale3D'],
            'meshScale': mesh_scale, 'built': built, 'sourceSHA256': canonical_sha(evidence),
            'nativeProofSHA256': evidence['nativeProofSHA256'], 'browserAxisOrder': BROWSER_AXIS_ORDER,
            'scaleApplication': 'unbaked-source-scale'}
        return record, evidence


_source = None


def player_visual_record(entry):
    """Pipeline entry point; cache original class/package decoding per build."""
    global _source
    if _source is None:
        _source = PlayerVisualSource()
    return _source.model(entry)[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-manifest', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'tmp/restart-audit/player-visuals.json')
    args = parser.parse_args()
    if args.check and args.write_manifest:
        parser.error('--check and --write-manifest are mutually exclusive')
    manifest = json.loads(MANIFEST.read_text()); source = PlayerVisualSource()
    records, evidence, unresolved = {}, {}, {}
    for entry in manifest['models']:
        try:
            record, detail = source.model(entry)
            records[entry['id']], evidence[entry['id']] = record, detail
        except (ValueError, KeyError) as error:
            record = {'format': FORMAT, 'status': 'unresolved', 'modelId': entry['id'], 'reason': str(error)}
            unresolved[entry['id']] = str(error)
        if args.check and entry.get('visualScale') != record:
            raise SystemExit('Player scale metadata differs from fresh original/built inputs: ' + entry['id'])
        if args.write_manifest:
            entry['visualScale'] = record
    receipt = {'format': 'elbera-player-visual-evidence-v1', 'native': source.native,
               'models': evidence, 'unresolved': unresolved,
               'limits': 'source local scale and current pipeline identity; no native MeshOrigin/grounding or pose parity'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
    if args.write_manifest:
        MANIFEST.write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    print('%d source-verified models, %d parts, %d unresolved' %
          (len(records), sum(len(e['parts']) for e in evidence.values()), len(unresolved)))
    print('Private receipt: ' + str(args.output))
    if unresolved:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
