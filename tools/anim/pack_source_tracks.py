"""Elbera Tools' authored animation transport, not an original game format.

ELBA, u32 version=1, u32 UTF-8 metadata length, u32 payload length (all LE).
Metadata is padded with zero bytes to a four-byte boundary. Track q/p/time
descriptors are {offset,count,width}, relative to the payload; count is rows.
Arrays occur in sequence/track order, then each movement's root track, with
quaternions, positions, times in that order. No sharing, gaps or trailing data.
All other original catalog/skeleton fields and fingerprints remain metadata.
Only exact finite Float32 input components are accepted; no keys are resampled.
"""
import hashlib
import json
import math
import re
import struct

FORMAT = 'elbera-original-animation-runtime-v1'
FIELDS = (('quaternions', 4), ('positions', 3), ('times', 1))


def source_pair(catalog, skeleton):
    """Validate the paired source identities and original first-name links."""
    def need(condition, label):
        if not condition:
            raise ValueError('invalid animation bundle: ' + label)
    npc = skeleton.get('format') == 'elbera-original-npc-skeleton-v1'
    need(catalog.get('format') == 'elbera-original-animation-tracks-v1'
         and (npc or skeleton.get('format') == 'elbera-original-player-skeleton-v1'), 'source formats')
    model = catalog.get('modelId')
    need(isinstance(model, str) and re.fullmatch(r'[a-z][a-z0-9_]{0,63}', model)
         and skeleton.get('modelId') == model, 'model identity')
    ref = catalog.get('animationRef')
    need(isinstance(ref, str) and ref and isinstance(skeleton.get('animationRef'), str)
         and ref.casefold() == skeleton['animationRef'].casefold(), 'animation identity')
    a, b = catalog.get('source', {}), skeleton.get('source', {})
    if npc:
        mesh_ref = skeleton.get('meshRef')
        qualified = r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+'
        need(isinstance(mesh_ref, str) and re.fullmatch(qualified, mesh_ref)
             and isinstance(catalog.get('meshRef'), str)
             and catalog['meshRef'].casefold() == mesh_ref.casefold()
             and re.fullmatch(qualified, ref), 'qualified NPC source identity')
        need(model == 'npc_' + hashlib.sha256(mesh_ref.lower().encode('utf8')).hexdigest()[:32],
             'opaque NPC model identity')
        for key in ('meshPackageSHA256', 'animationPackageSHA256',
                    'meshExportSHA256', 'animationExportSHA256'):
            need(isinstance(b.get(key), str) and re.fullmatch(r'[a-f0-9]{64}', b[key]),
                 'NPC source fingerprint')
    for key, other in [('packageSHA256', 'animationPackageSHA256' if npc else 'packageSHA256'),
                       ('exportSHA256', 'animationExportSHA256')]:
        need(isinstance(a.get(key), str) and re.fullmatch(r'[a-f0-9]{64}', a[key])
             and a[key] == b.get(other), 'source fingerprint')
    bones, mesh = catalog.get('bones'), skeleton.get('bones')
    need(isinstance(bones, (tuple, list)) and len(bones) > 0
         and isinstance(mesh, (tuple, list)) and len(mesh) > 0, 'source bones')
    need(bones == skeleton.get('animationBones'), 'animation bone records')
    spellings, first = {}, {}
    def name(bone):
        value = bone.get('name')
        need(isinstance(value, str) and re.fullmatch(r'[\x20-\x7e]+', value), 'bone name')
        key = value.lower()
        need(key not in spellings or spellings[key] == value, 'ambiguous name interning')
        spellings[key] = value
        return key
    for index, bone in enumerate(bones):
        need(type(bone.get('parent')) is int and 0 <= bone['parent'] < len(bones), 'animation parent')
        first.setdefault(name(bone), index)
    bindings = []
    for index, bone in enumerate(mesh):
        parent = bone.get('parent')
        need(type(parent) is int and (parent == 0 if index == 0 else 0 <= parent < index), 'mesh parent')
        for key, width in [('orientation', 4), ('position', 3)]:
            values = bone.get(key)
            need(isinstance(values, (list, tuple)) and len(values) == width, 'reference pose')
            for value in values:
                exact_float(value)
        bindings.append(first.get(name(bone), -1))
    need(bindings == skeleton.get('trackBindings')
         and all(type(i) is int for i in skeleton['trackBindings']), 'first-name bindings')
    need(isinstance(catalog.get('sequences'), (list, tuple)), 'sequences')


def exact_float(value):
    if type(value) not in (float, int) or not math.isfinite(value):
        raise ValueError('animation array requires finite exact Float32 values')
    try:
        packed = struct.pack('<f', value)
    except (OverflowError, struct.error) as exc:
        raise ValueError('animation array Float32 overflow') from exc
    if struct.unpack('<f', packed)[0] != value:
        raise ValueError('animation array component is not an exact Float32 value')
    return packed


def signed_word(value):
    return type(value) is int and -0x80000000 <= value <= 0x7fffffff


def pack_animation_bundle(catalog, skeleton):
    """Return canonical bytes, preserving inputs; no original files required."""
    source_pair(catalog, skeleton)
    payload = bytearray()
    def track(record, allow_empty=False):
        if not isinstance(record, dict) or not signed_word(record.get('flags')):
            raise ValueError('invalid animation track record')
        result = dict(record)
        counts = []
        for key, width in FIELDS:
            rows = record.get(key)
            if not isinstance(rows, (tuple, list)):
                raise ValueError('missing animation array: ' + key)
            counts.append(len(rows))
            result[key] = {'offset': len(payload), 'count': len(rows), 'width': width}
            for row in rows:
                values = [row] if width == 1 else row
                if not isinstance(values, (tuple, list)) or len(values) != width:
                    raise ValueError('invalid animation vector width: ' + key)
                for value in values:
                    payload.extend(exact_float(value))
        q, p, t = counts
        if (not t and not allow_empty) or q not in (1, t) or p not in (1, t):
            raise ValueError('invalid animation track cardinality')
        if any(value < 0 for value in record['times']) or any(a > b for a, b in zip(record['times'], record['times'][1:])):
            raise ValueError('invalid original key-time order')
        return result
    compact = dict(catalog)
    compact['sequences'] = []
    names = set()
    for sequence in catalog['sequences']:
        name = sequence.get('name')
        if not isinstance(name, str) or not name or name.lower() in names:
            raise ValueError('missing or duplicate original sequence name')
        names.add(name.lower())
        if not signed_word(sequence.get('frames')) or sequence['frames'] <= 0:
            raise ValueError('invalid original frame count')
        exact_float(sequence.get('rate'))
        if sequence['rate'] <= 0:
            raise ValueError('invalid original sequence rate')
        movement = sequence.get('movement')
        if not isinstance(movement, dict) or not isinstance(movement.get('tracks'), (tuple, list)):
            raise ValueError('missing animation movement tracks')
        if len(movement['tracks']) != len(catalog['bones']):
            raise ValueError('incomplete animation movement tracks')
        if not signed_word(movement.get('flags')) or not signed_word(movement.get('startBone')):
            raise ValueError('invalid original movement flags/start bone')
        exact_float(movement.get('duration'))
        if movement['duration'] <= 0:
            raise ValueError('invalid original movement duration')
        indices, speed = movement.get('boneIndices'), movement.get('rootSpeed')
        if not isinstance(indices, (tuple, list)) or any(not signed_word(i) for i in indices):
            raise ValueError('invalid original movement index words')
        if not isinstance(speed, (tuple, list)) or len(speed) != 3:
            raise ValueError('invalid original root speed')
        for value in speed:
            exact_float(value)
        packed_movement = {**movement, 'tracks': [track(row) for row in movement['tracks']],
                           'rootTrack': track(movement.get('rootTrack'), allow_empty=True)}
        compact['sequences'].append({**sequence, 'movement': packed_movement})
    meta = json.dumps({'format': FORMAT, 'catalog': compact, 'skeleton': skeleton},
                      sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf8')
    if len(meta) > 0xffffffff or len(payload) > 0xffffffff:
        raise ValueError('animation transport exceeds version-one length fields')
    return (struct.pack('<4sIII', b'ELBA', 1, len(meta), len(payload)) + meta
            + b'\0' * (-len(meta) % 4) + payload)
