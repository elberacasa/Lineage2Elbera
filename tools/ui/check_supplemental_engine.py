#!/usr/bin/env python3
"""Elbera Tools: compare a pinned, unauthenticated archive with owned originals.

Never executes binaries, downloads inputs, replaces originals, or writes decoded
images. This qualifies specific matching methods, not an entire distribution.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

from supplemental_pe import PEImage

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_ENGINE_SHA = '508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d'
CANDIDATE_CORE_SHA = 'd83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639'
CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
MESH_SYMBOL = '?MeshToWorld@USubSkeletalMeshInstance@@UAE?AVFMatrix@@M@Z'


def compare_method(old, new, old_va, new_va, imported_call, old_read, new_read,
                   handler_pair=None):
    """Compare every byte, accepting only individually checked differences.

    Import calls must replace exactly six NOPs. Rel32 calls must resolve to
    the same absolute thunk and its five bytes must match. One explicit pushed
    handler pair can differ if its first ten bytes match. This last allowance
    does not prove the complete exception/unwind graph equivalent.
    """
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32
    if len(old) != len(new):
        raise ValueError('method lengths differ')
    rows = []
    cursor = 0
    normalized = bytearray(new)
    for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(new, new_va):
        offset = instruction.address - new_va
        if offset != cursor:
            raise ValueError('instruction stream is not contiguous')
        cursor += instruction.size
        before, after = old[offset:cursor], bytes(instruction.bytes)
        if before == after:
            continue
        row = {'offset': hex(offset), 'ownedVA': hex(old_va + offset),
               'candidateVA': hex(new_va + offset)}
        if before == b'\x90' * 6 and after[:2] == b'\xff\x15' and len(after) == 6:
            row.update(kind='named-import', binding=list(imported_call(new_va + offset)))
        elif len(after) == 5 and before[:1] == after[:1] == b'\xe8':
            left = old_va + offset + 5 + struct.unpack('<i', before[1:])[0]
            right = new_va + offset + 5 + struct.unpack('<i', after[1:])[0]
            if left != right or old_read(left, 5) != new_read(right, 5):
                raise ValueError(f'direct-call target mismatch at {offset:#x}')
            row.update(kind='same-direct-call-target', target=hex(left))
        elif len(after) == 5 and before[:1] == after[:1] == b'\x68' and handler_pair:
            left, right = struct.unpack('<I', before[1:])[0], struct.unpack('<I', after[1:])[0]
            if (left, right) != tuple(handler_pair) or old_read(left, 10) != new_read(right, 10):
                raise ValueError(f'handler reference mismatch at {offset:#x}')
            row.update(kind='explicit-handler-reference', ownedTarget=hex(left), candidateTarget=hex(right),
                       comparedEntryBytes=10, completeUnwindEquivalent=False)
        else:
            raise ValueError(f'unexplained method difference at {offset:#x}')
        rows.append(row)
        normalized[offset:cursor] = before
    if cursor != len(new) or bytes(normalized) != old:
        raise ValueError('method comparison did not cover every byte')
    return {'bytes': len(old), 'ownedSHA256': hashlib.sha256(old).hexdigest(),
            'candidateSHA256': hashlib.sha256(new).hexdigest(),
            'normalizedSHA256': hashlib.sha256(normalized).hexdigest(), 'differences': rows}


def verify(engine_path, core_path):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    owned = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    candidate = PEImage(engine_path, CANDIDATE_ENGINE_SHA)
    read_owned = lambda va, n: bytes(owned.data[owned.offset(va):owned.offset(va) + n])
    old_va, new_va, size = owned.exported(MESH_SYMBOL, True), candidate.body(MESH_SYMBOL), 2379
    assert (old_va, new_va) == (0x106b5f20, 0x106b5ee0)
    old, new = read_owned(old_va, size), candidate.read(new_va, size)
    assert old[-3:] == new[-3:] == b'\xc2\x08\x00'
    method = compare_method(old, new, old_va, new_va, candidate.imported_call,
                            read_owned, candidate.read, (0x10827e70, 0x10827e30))
    assert method['ownedSHA256'] == 'fa2354338aa0a33d670d0d1ff78a488ec53df55782d001ce0158a1b5ef8fc2f3'
    assert method['candidateSHA256'] == '8e140732ae4142c3ffcba563388f6533393b9d39342b19be030f681049a8950d'
    counts = {kind: sum(row['kind'] == kind for row in method['differences'])
              for kind in ('named-import', 'same-direct-call-target', 'explicit-handler-reference')}
    assert counts == {'named-import': 25, 'same-direct-call-target': 10, 'explicit-handler-reference': 1}
    for offset in (0x51d, 0x548, 0x573):
        assert candidate.imported_call(new_va + offset) == ('core.dll', '??DFMatrix@@QBE?AV0@V0@@Z')
    method.update(symbol=MESH_SYMBOL, ownedVA=hex(old_va), candidateVA=hex(new_va), counts=counts)

    core = PEImage(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    companion = PEImage(core_path, CANDIDATE_CORE_SHA)
    assert len(core.data) == len(companion.data)
    core_differences = [i for i, (a, b) in enumerate(zip(core.data, companion.data)) if a != b]
    assert core_differences == list(range(0x77a54, 0x77a5a)) + list(range(0x77a85, 0x77a8b)) + [0x1373b0]
    methods = []
    for symbol, va, length in [
        ('??DFMatrix@@QBE?AV0@V0@@Z', 0x10111240, 584),
        ('??1FMatrix@@QAE@XZ', 0x101111e0, 1),
        ('?Matrix@FCoords@@QBE?AVFMatrix@@XZ', 0x1014df30, 244),
        ('?ApplyPivot@FCoords@@QBE?AV1@ABV1@@Z', 0x1014d8c0, 202),
        ('?PivotInverse@FCoords@@QBE?AV1@XZ', 0x1014db40, 474),
    ]:
        assert core.body(symbol) == companion.body(symbol) == va
        data = core.read(va, length)
        assert data == companion.read(va, length)
        methods.append({'symbol': symbol, 'VA': hex(va), 'bytes': length,
                        'SHA256': hashlib.sha256(data).hexdigest(), 'exactBytesEqual': True})
    return {'status': 'bounded-supplemental-comparison-passed', 'ownedEngineSHA256': owned.sha,
            'candidateEngineSHA256': candidate.sha, 'ownedCoreSHA256': core.sha,
            'candidateCoreSHA256': companion.sha, 'meshToWorld': method,
            'core': {'differentByteOffsets': list(map(hex, core_differences)), 'methods': methods},
            'limits': ['archive is third-party and not vendor authenticated',
                       'no whole-build equivalence or protected import restoration claimed',
                       'handler entry matched, complete exception/unwind cleanup not compared',
                       'no binaries executed, decoded payloads written, or runtime geometry changed']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', type=Path, required=True, help='pinned supplemental Engine.dll')
    parser.add_argument('--core', type=Path, required=True, help='pinned archive companion Core.dll')
    parser.add_argument('--check', action='store_true', help='print compact verification summary')
    args = parser.parse_args()
    result = verify(args.engine, args.core)
    if args.check:
        print('Supplemental Engine: 2379 method bytes, 25 named imports, 10 direct calls, '
              '1 bounded handler relocation, 5 exact Core bodies verified; archive unauthenticated.')
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
