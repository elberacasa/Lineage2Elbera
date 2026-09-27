#!/usr/bin/env python3
"""Elbera Tools: append original pawn skill/wait clips without rebuilding geometry.

Requires the private Interlude client, umodel and existing character glTFs.
Default is a dry run. Example: recover_pawn_clips.py human_fighter_m --write
Every selected .int slot, complete source skeleton and emitted PSA key is
checked before writing. No animation phase/rate scheduling is inferred here.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/src/char_pipeline'))
import assemble
import build_characters as characters
import build_pawnanim as pawnanim
from l2lib import load_package, read_properties

SLOTS = {'castEnd': 'CastEndAnimName', 'magicShot': 'MagicShotAnimName',
         'magicNoTarget': 'MagicNoTargetAnimName', 'picItem': 'PicItemAnimName',
         'sitDown': 'SitAnimName', 'standUp': 'StandAnimName'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_original_bones(package, prefix):
    """Read MeshAnimation.RefBones directly; PSA does not retain its parents."""
    pkg, _ = load_package(str(package))
    exports = [e for e in pkg.exports if pkg.export_name(e).lower() == (prefix + '_anim').lower()]
    if len(exports) != 1:
        raise ValueError('ambiguous/missing original MeshAnimation')
    reader = pkg.body_reader(exports[0])
    read_properties(pkg, reader)
    if reader.i32() != 1:
        raise ValueError('unsupported MeshAnimation version')
    count = reader.compact()
    end = exports[0].serial_offset + exports[0].serial_size
    if count <= 0 or count > (end - reader.pos) // 9:
        raise ValueError('invalid RefBones count')
    bones = []
    for i in range(count):
        name_index, _flags, parent = reader.compact(), reader.i32(), reader.i32()
        if not 0 <= name_index < len(pkg.names) or not 0 <= parent <= i:
            raise ValueError('invalid original RefBones name/hierarchy')
        bones.append({'name': pkg.names[name_index], 'parent': parent})
    if reader.pos > end:
        raise ValueError('RefBones crosses export boundary')
    return bones


def read_source_psa(path, original_bones):
    """Bounded, independent ANIMINFO/key reader used to verify the emitter."""
    data = Path(path).read_bytes()
    chunks, pos = {}, 0
    while pos < len(data):
        if len(data) - pos < 32:
            raise ValueError('truncated PSA chunk header')
        name = data[pos:pos + 20].split(b'\0')[0].decode('ascii')
        _, size, count = struct.unpack_from('<III', data, pos + 20)
        end = pos + 32 + size * count
        if end > len(data) or name in chunks:
            raise ValueError('truncated or duplicate PSA chunk: ' + name)
        chunks[name] = (size, count, pos + 32)
        pos = end
    bs, bn, bo = chunks['BONENAMES']
    ins, inn, ino = chunks['ANIMINFO']
    ks, kn, ko = chunks['ANIMKEYS']
    if (bs, ins, ks) != (120, 168, 32) or not bn:
        raise ValueError('unsupported PSA record sizes or empty skeleton')
    bones = []
    for i in range(bn):
        p = bo + i * bs
        name = data[p:p + 64].split(b'\0')[0].decode('latin1')
        if not name:
            raise ValueError('empty PSA bone name')
        bones.append(name)
    if [n.lower() for n in bones] != [b['name'].lower() for b in original_bones]:
        raise ValueError('PSA order differs from original MeshAnimation.RefBones')
    seqs, consumed = {}, 0
    for i in range(inn):
        p = ino + i * ins
        name = data[p:p + 64].split(b'\0')[0].decode('latin1')
        n, keys = struct.unpack_from('<i', data, p + 128)[0], struct.unpack_from('<i', data, p + 140)[0]
        rate = struct.unpack_from('<f', data, p + 152)[0]
        first, frames = struct.unpack_from('<ii', data, p + 160)
        if (not name or name.lower() in seqs or n != bn or frames <= 0
                or keys != frames * bn or first * bn != consumed
                or consumed + keys > kn or not math.isfinite(rate) or rate <= 0):
            raise ValueError('invalid, duplicate or noncontiguous PSA sequence: ' + name)
        seqs[name.lower()] = {'name': name, 'frames': frames, 'rate': rate,
                             'offset': ko + consumed * ks}
        consumed += keys
    if consumed != kn:
        raise ValueError('PSA has unaccounted animation keys')
    return {'data': data, 'bones': original_bones, 'sequences': seqs}


def select_slots(table, prefix, source):
    """Only exact .int entries, identical across the six decoded stances."""
    selected = {}
    for slot, field in SLOTS.items():
        values = [table[prefix].get((field, i)) for i in range(6)]
        if any(not v for v in values) or len({v.lower() for v in values}) != 1:
            raise ValueError('%s %s: missing or stance-dependent source slot' % (prefix, field))
        seq = source['sequences'].get(values[0].lower())
        if seq is None:
            raise ValueError('source slot is absent from PSA: ' + values[0])
        selected[slot] = seq['name']
    return selected


def strict_context(g, parts, source):
    """Require the existing full skeleton and a complete PSA reference match.

    Uses the established structural permutation (including the original
    MFighter duplicate finger name), never inject_animations' name fallback.
    """
    skel, refs = assemble.CanonicalSkeleton(), []
    for label, part in parts:
        if not assemble.is_hair_only(part):
            refs.append((part, skel.add_part(part, label)))
    n = len(skel.bones)
    if not n or not g['skins'] or any(s.get('joints') != list(range(n)) for s in g['skins']):
        raise ValueError('existing skin joints do not match the complete source skeleton')
    parents = {}
    for i, node in enumerate(g['nodes']):
        for child in node.get('children', []):
            if child in parents:
                raise ValueError('existing skeleton has multiple parents')
            parents[child] = i
    for i, bone in enumerate(skel.bones):
        node = g['nodes'][i]
        x, y, z = bone['pos']
        qx, qy, qz, qw = bone['quat']
        rotation = [qx, qz, -qy, -qw]
        root = bone['parent'] == i
        if root:
            rotation[:3] = [-v for v in rotation[:3]]
        if (node.get('name') != bone['name'] or node.get('translation') != [x * .01, z * .01, -y * .01]
                or node.get('rotation') != rotation or 'matrix' in node
                or node.get('scale', [1, 1, 1]) != [1, 1, 1]
                or parents.get(i) != (None if root else bone['parent'])):
            raise ValueError('existing bind node differs from original source: %d %s' % (i, bone['name']))
    names = [(b['name'].lower(), b['parent']) for b in source['bones']]
    matched = [(p, perm) for p, perm in refs
               if [(b['name'].lower(), b['parent']) for b in p['bones']] == names]
    if not matched:
        raise ValueError('PSA has no complete name-and-parent source reference match')
    permutations = {tuple(perm) for _, perm in matched}
    if len(permutations) != 1 or len(set(matched[0][1])) != n or len(names) != n:
        raise ValueError('ambiguous or partial PSA skeleton permutation')
    # Put the exact match first: the legacy emitter must take its full-match
    # path, even if an earlier mesh happens to have the same names but parents differ.
    return {'skeleton': skel, 'bone_node': list(range(n)), 'parts': matched}, matched[0][1]


def accessor_bytes(g, blob, index, kind):
    ac = g['accessors'][index]
    view = g['bufferViews'][ac['bufferView']]
    width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[kind] * 4
    if ac['componentType'] != 5126 or ac['type'] != kind or view.get('buffer', 0) != 0 or 'sparse' in ac:
        raise ValueError('unexpected animation accessor type')
    start = view.get('byteOffset', 0) + ac.get('byteOffset', 0)
    length = ac['count'] * width
    if (ac['count'] <= 0 or ac.get('byteOffset', 0) < 0 or start < 0
            or view.get('byteStride', width) != width or start + length > len(blob)
            or ac.get('byteOffset', 0) + length > view['byteLength']):
        raise ValueError('invalid animation accessor bounds/stride')
    return blob[start:start + length], ac['count']


def verify_tracks(g, blob, source, selected, permutation):
    """Compare every output channel with independently indexed raw PSA keys."""
    animations = {a['name']: a for a in g['animations']}
    if len(animations) != len(g['animations']):
        raise ValueError('duplicate glTF animation names')
    verified = {}
    for slot, name in selected.items():
        animation = animations[slot]
        seq = source['sequences'][name.lower()]
        frames, rate = seq['frames'], seq['rate']
        expected = {}
        for b, node in enumerate(permutation):
            translations, rotations = [], []
            for f in range(frames):
                p = seq['offset'] + (f * len(permutation) + b) * 32
                x, y, z, qx, qy, qz, qw, _ = struct.unpack_from('<8f', source['data'], p)
                values = [x, y, z, qx, qy, qz, qw]
                if not all(math.isfinite(v) for v in values):
                    raise ValueError('nonfinite source key')
                translations.append(struct.pack('<3f', x / 100, z / 100, -y / 100))
                q = [qx, qz, -qy, -qw]
                if source['bones'][b]['parent'] == b:
                    q[:3] = [-v for v in q[:3]]
                rotations.append(struct.pack('<4f', *q))
            expected[node, 'translation'] = translations
            expected[node, 'rotation'] = rotations
        seen = set()
        for channel in animation['channels']:
            target = channel['target']; key = (target['node'], target['path'])
            if key not in expected or key in seen:
                raise ValueError('unexpected/duplicate animation channel')
            seen.add(key)
            sampler = animation['samplers'][channel['sampler']]
            if sampler.get('interpolation', 'LINEAR') != 'LINEAR':
                raise ValueError('unexpected key interpolation')
            actual, count = accessor_bytes(g, blob, sampler['output'], 'VEC3' if key[1] == 'translation' else 'VEC4')
            values = expected[key]
            indices = list(range(frames))
            if count == 2 and frames > 2 and len(set(values)) == 1:
                indices = [0, frames - 1]
            if count != len(indices) or actual != b''.join(values[i] for i in indices):
                raise ValueError('source key mismatch: %s %s' % (slot, key))
            actual_times, time_count = accessor_bytes(g, blob, sampler['input'], 'SCALAR')
            if time_count != count or actual_times != struct.pack('<%df' % count, *(i / rate for i in indices)):
                raise ValueError('source timestamp mismatch: ' + slot)
        if seen != set(expected):
            raise ValueError('incomplete skeleton channels: ' + slot)
        verified[slot] = {'sequence': name, 'frames': frames, 'rate': rate,
                          'channels': len(seen), 'sourceKeys': frames * len(permutation)}
    return verified


def append_verified(g, blob, psa, parts, table, prefix, original_bones):
    source = read_source_psa(psa, original_bones)
    selected = select_slots(table, prefix, source)
    ctx, permutation = strict_context(g, parts, source)
    old = copy.deepcopy(g)
    existing = {a['name'] for a in g.get('animations', [])}
    added = {slot: name for slot, name in selected.items() if slot not in existing}
    result = assemble.inject_animations(g, blob, str(psa), added, ctx) if added else blob
    if result[:len(blob)] != blob:
        raise ValueError('existing binary bytes changed')
    for field, value in old.items():
        if field in ('animations', 'accessors', 'bufferViews'):
            if g[field][:len(value)] != value:
                raise ValueError('existing %s changed' % field)
        elif field != 'buffers' and g[field] != value:
            raise ValueError('existing %s changed' % field)
    if len(g['buffers']) != 1 or g['buffers'][0]['uri'] != old['buffers'][0]['uri']:
        raise ValueError('existing binary reference changed')
    verified = verify_tracks(g, result, source, selected, permutation)
    return result, {'clips': verified, 'added': list(added), 'bones': len(permutation),
                    'sourcePSASHA256': sha(source['data']), 'originalBinarySHA256': sha(blob),
                    'outputBinarySHA256': sha(result), 'preservedBytes': len(blob)}


def recover(model_id, write=False):
    combo = next(c for c in characters.COMBOS if c[0] == model_id)
    package, prefix = combo[4:6]
    manifest_path = ROOT / 'editor/characters/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    entry = next(m for m in manifest['models'] if m['id'] == model_id)
    path = ROOT / 'editor/characters' / entry['gltf']
    g = json.loads(path.read_text())
    names = [a['name'] for a in g.get('animations', [])]
    if len(set(names)) != len(names) or set(entry['animations']) != set(names):
        raise ValueError('existing manifest/glTF animation inventory disagrees')
    if len(g['buffers']) != 1 or Path(g['buffers'][0]['uri']).name != g['buffers'][0]['uri']:
        raise ValueError('expected one local binary buffer')
    binpath = path.parent / g['buffers'][0]['uri']
    blob = binpath.read_bytes()
    if len(blob) != g['buffers'][0]['byteLength']:
        raise ValueError('existing buffer length mismatch')
    stage_root = ROOT / 'tmp/restart-audit/pawn-clips'
    stage_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=model_id + '-', dir=stage_root) as stage:
        ukx = 'animations/%s.ukx' % package
        objects = characters.list_objects(ukx)
        parts, hashes = [], {}
        for mesh in g['meshes']:
            name = mesh['name']
            actual = characters.find_ci(objects.get('SkeletalMesh', []), name)
            if actual is None:
                raise ValueError('existing mesh is absent from original package: ' + name)
            characters.export_one(ukx, actual, [], stage)
            psk = characters.find_exported(stage, actual, '.psk')
            parts.append((name, assemble.parse_psk(psk)))
            hashes[name] = sha(Path(psk).read_bytes())
        anim = characters.find_ci(objects.get('MeshAnimation', []), prefix + '_anim')
        if not anim:
            raise ValueError('original MeshAnimation missing')
        characters.export_one(ukx, anim, [], stage)
        psa = characters.find_exported(stage, anim, '.psa')
        original_bones = read_original_bones(ROOT / 'assets/interlude' / ukx, prefix)
        result, report = append_verified(g, blob, psa, parts, pawnanim.read_warrior_int(), prefix, original_bones)
        report.update(model=model_id, sourcePackage=package, sourcePSKSHA256=hashes,
                      sourceUKXSHA256=sha((ROOT / 'assets/interlude' / ukx).read_bytes()),
                      sourceSlotTableSHA256=sha(Path(pawnanim.WARRIOR_INT).read_bytes()),
                      extractorSHA256=sha(Path(characters.UMODEL).read_bytes()))
        if write and report['added']:
            # Old glTF remains valid against the appended binary. Replace the
            # binary first, glTF second, manifest last; keep private originals.
            backup = stage_root / (model_id + '-before-' + report['originalBinarySHA256'][:12])
            backup.mkdir(exist_ok=True)
            for original in (path, binpath, manifest_path):
                if not (backup / original.name).exists():
                    shutil.copy2(original, backup / original.name)
            for target, data in ((binpath, result), (path, json.dumps(g).encode())):
                temp = target.with_name(target.name + '.recover-tmp')
                temp.write_bytes(data); temp.replace(target)
            entry['animations'] = sorted(set(entry['animations']) | set(report['added']))
            temp = manifest_path.with_suffix('.recover-tmp')
            temp.write_text(json.dumps(manifest, indent=2) + '\n'); temp.replace(manifest_path)
        report['written'] = bool(write and report['added'])
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', choices=[c[0] for c in characters.COMBOS])
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = recover(args.model, args.write)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
