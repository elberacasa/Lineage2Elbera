#!/usr/bin/env python3
"""Elbera Tools: original ordinary player face mesh/texture selection.

Pinned original files, in-memory decoding only. No native execution or asset
output. The separate appearance wire checker binds packet fields to User+248.
"""
import argparse
import hashlib
import json
import re
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    symbols = {
        '?GetPcTexName@User@@QAE?AVFName@@HH@Z': 0x10486000,
        '?GetPcMeshName@User@@QAE?AVFName@@H@Z': 0x10482c90,
        '?CharDataLoad@FL2GameData@@IAEHH@Z': 0x104504d0,
    }
    for name, va in symbols.items():
        assert e.exported(name, True) == va
    assert e.exported('?GL2GameData@@3VFL2GameData@@A') == 0x10b3c890
    anchors = [
        (0x10450519, 'mov', 'eax, 0x10895d4c'),
        (0x104505db, 'cmp', 'ebx, 0xf'),
        (0x104505e3, 'imul', 'eax, eax, 0x274'),
        (0x104505ec, 'lea', 'ecx, [eax + ecx + 0x183c]'),
        (0x104505f3, 'call', '0x1030a597'),
        (0x1030a597, 'jmp', '0x1044c2c0'),
        # Binary array counts and the exact two destination arrays.
        (0x1044c306, 'lea', 'ecx, [esi + 0xc]'),
        (0x1044c310, 'lea', 'edx, [esi + 0x10]'),
        (0x1044c35a, 'cmp', 'ebx, dword ptr [esi + 0xc]'),
        (0x1044c35f, 'lea', 'edx, [esi + ebx*4 + 0xb4]'),
        (0x1044c37a, 'cmp', 'ebx, dword ptr [esi + 0x10]'),
        (0x1044c37f, 'lea', 'eax, [esi + ebx*4 + 0x104]'),
        # Named text-loader keys independently identify those same arrays.
        (0x10450a67, 'push', '0x10895b6c'),
        (0x10450a7c, 'imul', 'ecx, ecx, 0x9d'),
        (0x10450a8b, 'mov', 'dword ptr [eax + ecx*4 + 0x18f0], edx'),
        (0x10450ac8, 'push', '0x10895b4c'),
        (0x10450add, 'imul', 'eax, eax, 0x9d'),
        (0x10450aec, 'mov', 'dword ptr [edx + eax*4 + 0x1940], ecx'),
        # Exact face selector: fixed first mesh; indexed texture, layer zero.
        (0x10483852, 'cmp', 'eax, 9'),
        (0x1048385b, 'jmp', 'dword ptr [eax*4 + 0x10483dbc]'),
        (0x104838af, 'imul', 'esi, esi, 0x274'),
        (0x104838b5, 'mov', 'edx, dword ptr [esi + 0x10b3e180]'),
        (0x1048686c, 'cmp', 'dword ptr [ebp + 0x10], 0'),
        (0x10486870, 'jne', '0x1048673b'),
        (0x10486883, 'jmp', 'dword ptr [ecx*4 + 0x10486efc]'),
        (0x104868d7, 'imul', 'ebx, ebx, 0x9d'),
        (0x104868dd, 'add', 'ebx, dword ptr [edi + 0x248]'),
        (0x104868e3, 'mov', 'eax, dword ptr [ebx*4 + 0x10b3e1d0]'),
    ]
    for va, op, args in anchors:
        e.instruction(va, op, args)
    assert e.wide(0x10895d4c) == 'Chargrp.dat'
    assert e.wide(0x10895b6c) == 'face_mesh'
    assert e.wide(0x10895b4c) == 'face_texture'
    assert e.u32(0x10483dbc + 9 * 4) == 0x104838af
    assert e.u32(0x10486efc + 9 * 4) == 0x104868d7
    assert 0x10b3c890 + 0x183c + 0xb4 == 0x10b3e180
    assert 0x10b3c890 + 0x183c + 0x104 == 0x10b3e1d0
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript')]
    from l2lib import load_package
    from extract_uscript import sources_from_package
    path = ROOT / 'assets/interlude/system/Engine.u'
    package_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    assert package_sha == '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
    p, _ = load_package(str(path))
    actor = dict(sources_from_package(p))['Actor']
    enum = re.search(r'enum EPawnSubMeshStyle\s*\{([^}]+)\}', actor).group(1)
    assert [s.strip() for s in enum.split(',')].index('PMS_Face') == 9
    # Exact instruction-backed address arithmetic, independently expressed
    # against the serializer's table base. This is not native emulation or a
    # sentinel-memory test; the instructions themselves are checked above.
    code = list(e.dis.disasm(e.data[e.offset(0x104868d7):e.offset(0x104868ea)], 0x104868d7))
    assert [(i.mnemonic, i.op_str) for i in code] == [(a[1], a[2]) for a in anchors[-3:]]
    cases = 0
    for row in range(14):
        for face in range(3):
            ebx = row * 0x9d
            ebx += face
            selected_address = ebx * 4 + 0x10b3e1d0
            assert selected_address == 0x10b3c890 + row * 0x274 + 0x1940 + face * 4
            cases += 1
    ranges = [(0x1044c2c0, 0x1044c395), (0x10450a29, 0x10450af9),
              (0x1048384f, 0x104838c3), (0x1048686c, 0x104868ef)]
    return {'format': 'elbera-face-selector-evidence-v1', 'engineSHA256': e.sha,
            'enginePackageSHA256': package_sha, 'instructionChecks': len(anchors),
            'addressCases': cases, 'faceSlot': 9, 'userFaceOffset': '0x248',
            'ranges': [{'startVA': hex(a), 'endVAExclusive': hex(b),
                        'SHA256': hashlib.sha256(e.data[e.offset(a):e.offset(b)]).hexdigest()} for a, b in ranges],
            'limits': ['ordinary built player models, texture layer zero, no face item override',
                       'hair selection, transformed pawn and complete native material rendering are separate',
                       'erased serialization/name imports are not assigned guessed identities']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = verify()
    print(f"PASS Elbera Tools face selector: {result['instructionChecks']} anchors, 42 address cases, PMS_Face=9" if args.check else json.dumps(result, indent=2))
