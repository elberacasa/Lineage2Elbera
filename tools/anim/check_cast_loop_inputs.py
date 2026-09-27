#!/usr/bin/env python3
"""Elbera Tools: audit existing castEnd glTF tracks without changing assets.

Default: validate dense source-frame sampling or byte-constant endpoint pairs
against private pawnanim v2 timing. --source additionally re-extracts original
PSA/PSK into a temporary ignored directory and independently checks every key,
the skeleton permutation, original .int binding and direct UKX frames/rate.
Requires supplied local client/converted models; --source also requires umodel.
This audits castEnd inputs, not native pose interpolation or MS01 atk02 loops.
"""
import argparse
import json
import math
from pathlib import Path
import struct

import recover_pawn_clips as recovery

ROOT = recovery.ROOT


def check_tracks(g, blob, clip, frames, rate):
    if (not isinstance(frames, int) or frames < 2
            or not math.isfinite(rate) or rate <= 0):
        raise ValueError('unsupported source timing')
    matches = [a for a in g.get('animations', []) if a.get('name') == clip]
    if len(matches) != 1 or not matches[0].get('channels'):
        raise ValueError('missing, duplicate or empty animation')
    animation = matches[0]
    dense_times = struct.pack('<%df' % frames, *(i / rate for i in range(frames)))
    endpoint_times = struct.pack('<2f', 0, (frames - 1) / rate)
    counts = {'dense': 0, 'constantEndpoints': 0}
    seen = set()
    for channel in animation['channels']:
        target = channel['target']; key = (target['node'], target['path'])
        if key in seen or key[1] not in ('translation', 'rotation', 'scale'):
            raise ValueError('duplicate or unsupported animation channel')
        seen.add(key)
        sampler = animation['samplers'][channel['sampler']]
        if sampler.get('interpolation', 'LINEAR') != 'LINEAR':
            raise ValueError('unsupported interpolation')
        kind = 'VEC4' if key[1] == 'rotation' else 'VEC3'
        values, count = recovery.accessor_bytes(g, blob, sampler['output'], kind)
        times, time_count = recovery.accessor_bytes(g, blob, sampler['input'], 'SCALAR')
        if count != time_count or not all(math.isfinite(x) for x in struct.unpack('<%df' % (len(values) // 4), values)):
            raise ValueError('mismatched or nonfinite animation values')
        if count == frames and times == dense_times:
            counts['dense'] += 1
        elif (frames > 2 and count == 2 and times == endpoint_times
                and values[:len(values) // 2] == values[len(values) // 2:]):
            counts['constantEndpoints'] += 1
        else:
            raise ValueError('unsupported loop input sampling: %s %s' % (clip, key))
    return dict(counts, channels=len(seen), frames=frames, rate=rate,
                sourceEndpoint=struct.unpack('<f', endpoint_times[4:])[0],
                sourcePeriod=struct.unpack('<f', struct.pack('<f', frames / rate))[0])


def audit(model_id, original=False):
    base = ROOT / 'editor/characters'
    manifest = json.loads((base / 'manifest.json').read_text())
    pawn = json.loads((base / 'pawnanim.json').read_text())
    if pawn.get('format') != 'l2-interlude-pawn-animation-v2':
        raise ValueError('requires original pawn timing v2')
    model = next(m for m in manifest['models'] if m['id'] == model_id)
    path = base / model['gltf']; g = json.loads(path.read_text())
    if len(g['buffers']) != 1 or Path(g['buffers'][0]['uri']).name != g['buffers'][0]['uri']:
        raise ValueError('requires one local animation buffer')
    binary = path.parent / g['buffers'][0]['uri']; blob = binary.read_bytes()
    if len(blob) != g['buffers'][0]['byteLength']:
        raise ValueError('buffer length mismatch')
    info = pawn['clips'][model_id]['castEnd']
    if info.get('originalTiming') is not True:
        raise ValueError('missing original timing marker')
    result = dict(model=model_id, clip='castEnd', sequence=info['seq'],
                  gltfSHA256=recovery.sha(path.read_bytes()), binarySHA256=recovery.sha(blob),
                  pawnTimingSHA256=recovery.sha((base / 'pawnanim.json').read_bytes()),
                  sampling=check_tracks(g, blob, 'castEnd', info['frames'], info['rate']),
                  evidence='shape-only')
    if original:
        # Existing verifier reads fresh original extracts and compares packed
        # keys independently of the animation emitter. It never writes here.
        source = recovery.recover(model_id, write=False)
        if source['added']:
            raise ValueError('source verifier would add missing clips; assets are incomplete')
        clip = source['clips']['castEnd']
        _, package, prefix = next(p for p in recovery.pawnanim.PAWNS if p[0] == model_id)
        pkg, _ = recovery.load_package(str(ROOT / 'assets/interlude/animations' / (package + '.ukx')))
        exports = [e for e in pkg.exports if pkg.export_name(e) == prefix + '_anim'
                   and pkg.class_name_of(e) == 'MeshAnimation']
        if len(exports) != 1:
            raise ValueError('missing or ambiguous original animation')
        sequences = recovery.pawnanim.original_sequences(pkg, exports[0])
        original_clip = next(s for s in sequences if s['name'].lower() == clip['sequence'].lower())
        if (clip['sequence'] != info['seq'] or any(
                original_clip[k] != clip[k] or clip[k] != info[k] for k in ('frames', 'rate'))):
            raise ValueError('original timing or binding mismatch')
        result.update(evidence='original-keys-and-timing', source=source)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=[p[0] for p in recovery.pawnanim.PAWNS],
                        help='one model; otherwise all 14 supported player models')
    parser.add_argument('--source', action='store_true', help='verify original keys, binding and direct UKX timing')
    parser.add_argument('--output', type=Path, default=ROOT / 'tmp/restart-audit/cast-loop-inputs.json')
    args = parser.parse_args()
    rows = []
    for model in [args.model] if args.model else [p[0] for p in recovery.pawnanim.PAWNS]:
        row = audit(model, args.source); rows.append(row)
        print('%s: %s, %d dense / %d byte-constant tracks' %
              (model, row['evidence'], row['sampling']['dense'], row['sampling']['constantEndpoints']), flush=True)
    result = {'format': 'elbera-cast-loop-input-audit-v1', 'models': rows,
              'limits': 'castEnd only; source extraction and lossless exported samples do not prove native subframe interpolation'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print('Receipt: ' + str(args.output))


if __name__ == '__main__':
    main()
