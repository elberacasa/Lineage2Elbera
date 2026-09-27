#!/usr/bin/env python3
"""Elbera Tools: independently check original Human Fighter sit sound identities.

Requires supplied local Fighter.ukx, its existing PSA and original UAX banks.
Re-reads package names/imports/exports without l2lib's reference resolver;
compares the traversal and older PSA-guided sequence readers. This validates
serialized references, not whether a sound is appropriate or audibly identical.
No audio extraction, playback, login or asset writes. The receipt is private.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/audio')]
import build_pawnanim as pawn
import build_stepnotify as older
from sound_reference_aliases import original_path


def compact(data, pos):
    """Independent signed UE compact integer reader, with bounded continuation."""
    first = data[pos]; pos += 1
    value, more, shift = first & 63, first & 64, 6
    for _ in range(4):
        if not more:
            return (-value if first & 128 else value), pos
        byte = data[pos]; pos += 1
        value |= (byte & 127) << shift
        more, shift = byte & 128, shift + 7
    if more or value > 0x7fffffff:
        raise ValueError('invalid compact integer')
    return (-value if first & 128 else value), pos


def raw_tables(data):
    """Independent table parse; shared decryption is the only package prerequisite."""
    assert struct.unpack_from('<I', data)[0] == 0x9e2a83c1
    nc, no, ec, eo, ic, io = struct.unpack_from('<6I', data, 12)
    names, imports, exports = [], [], []
    pos = no
    for _ in range(nc):
        size, pos = compact(data, pos)
        if not size:
            raise ValueError('zero-length source name unsupported by this audit')
        width = 2 if size < 0 else 1
        raw = data[pos:pos + abs(size)*width]
        assert len(raw) == abs(size)*width and raw[-width:] == b'\0'*width
        names.append(raw[:-width].decode('utf-16le' if size < 0 else 'latin1'))
        pos += abs(size)*width + 4
    pos = io
    for _ in range(ic):
        cp, pos = compact(data, pos); cn, pos = compact(data, pos)
        outer = struct.unpack_from('<i', data, pos)[0]; pos += 4
        name, pos = compact(data, pos)
        imports.append({'classPackage': cp, 'class': cn, 'outer': outer, 'name': name})
    pos = eo
    for _ in range(ec):
        cls, pos = compact(data, pos); parent, pos = compact(data, pos)
        outer = struct.unpack_from('<i', data, pos)[0]; pos += 4
        name, pos = compact(data, pos); pos += 4
        size, pos = compact(data, pos)
        offset, pos = compact(data, pos) if size else (0, pos)
        assert 0 <= offset <= offset + size <= len(data)
        exports.append({'class': cls, 'outer': outer, 'name': name, 'offset': offset, 'size': size})
    return names, imports, exports


def imported_path(ref, names, imports):
    path, seen = [], set()
    while ref:
        if ref >= 0 or ref in seen or not 0 <= -ref-1 < len(imports):
            raise ValueError('not a bounded original import chain')
        seen.add(ref)
        row = imports[-ref-1]
        path.append(names[row['name']]); ref = row['outer']
    return '.'.join(reversed(path))


def audit():
    path = ROOT / 'assets/interlude/animations/Fighter.ukx'
    package, _ = pawn.load_package(str(path))
    names, imports, exports = raw_tables(package.data)
    assert names == package.names
    source = pawn.read_warrior_int()['MFighter']['SitAnimName', 0]
    anim = package.find_export('MFighter_anim', 'MeshAnimation')
    sequence = next(s for s in pawn.original_sequences(package, anim) if s['name'] == source)
    psa = ROOT / 'tools/anim/psa/Fighter/MeshAnimation/MFighter_anim.psa'
    old, missing = older.read_sequences(package, anim, older.psa_seqs(str(psa)))
    assert not missing
    independent = next(s for s in old if s['name'] == source)
    assert (independent['frames'], independent['rate']) == (sequence['frames'], sequence['rate'])
    assert independent['notifys'] == [(n['t'], n['function'], n['objectRef']) for n in sequence['notifies']]
    exported = json.loads(Path(pawn.OUT).read_text())['clips']['human_fighter_m']['sitDown']
    assert exported['source'] == sequence['source']
    manifest = json.loads((ROOT / 'assets/audio/manifest.json').read_text())
    banks, rows = {}, []
    assert len(sequence['notifies']) == len(exported['notifies'])
    for note, built in zip(sequence['notifies'], exported['notifies']):
        ref = note['objectRef']; assert ref > 0
        obj = exports[ref-1]
        cls = imported_path(obj['class'], names, imports)
        assert cls == 'Engine.AnimNotify_Sound'
        body = package.data[obj['offset']:obj['offset']+obj['size']]
        field, pos = compact(body, 0)
        assert names[field] == 'Sound', 'this focused audit requires Sound as the first packed tag'
        tag = body[pos]; pos += 1
        assert tag & 15 == 5 and not tag & 128
        size_code = (tag >> 4) & 7
        assert size_code <= 4
        size = (1,2,4,12,16)[size_code]
        sound_ref, end = compact(body, pos)
        assert end == pos + size
        sound = imported_path(sound_ref, names, imports)
        assert built['objectRef'] == ref and built['t'] == note['t'] and built['sound'] == sound
        assert names[imports[-sound_ref-1]['class']] == 'Sound'
        bank_name = sound.split('.')[0]
        if bank_name not in banks:
            bank_path = next(p for p in (ROOT / 'assets/interlude/sounds').iterdir()
                             if p.name.casefold() == (bank_name + '.uax').casefold())
            bank, _ = pawn.load_package(str(bank_path))
            banks[bank_name] = (bank, hashlib.sha256(bank_path.read_bytes()).hexdigest())
        bank, fingerprint = banks[bank_name]
        matches = [e for e in bank.exports_by_class('Sound')
                   if original_path(bank, e, bank_name).casefold() == sound.casefold()]
        assert len(matches) == 1, 'original qualified UAX Sound must resolve uniquely'
        same_leaf = [e for e in bank.exports_by_class('Sound')
                     if bank.export_name(e).casefold() == sound.split('.')[-1].casefold()]
        alias = manifest['sfx'].get(sound.casefold())
        if len(same_leaf) != 1:
            assert alias is None, 'ambiguous output basename must not receive a playable alias'
        rows.append({'t': note['t'], 'notifyObjectRef': ref, 'notifyName': names[obj['name']],
                     'notifySHA256': hashlib.sha256(body).hexdigest(), 'soundPayloadHex': body[pos:end].hex(),
                     'soundImportRef': sound_ref, 'sound': sound, 'uaxSHA256': fingerprint,
                     'uaxExport': matches[0].index, 'originalSameBasenameCount': len(same_leaf),
                     'audioAlias': alias})
    return {'format': 'elbera-sitting-sound-reference-audit-v1',
            'packageSHA256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'psaSHA256': hashlib.sha256(psa.read_bytes()).hexdigest(), 'sequence': source,
            'sequenceSource': sequence['source'], 'notifies': rows,
            'limits': 'Serialized identity and existing alias admission; no audible/codec parity claim.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'tmp/restart-audit/sitting-sound-references.json')
    args = parser.parse_args(); report = audit()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Verified %d original sound references; %d have verified playable aliases.' % (
        len(report['notifies']), sum(r['audioAlias'] is not None for r in report['notifies'])))


if __name__ == '__main__':
    main()
