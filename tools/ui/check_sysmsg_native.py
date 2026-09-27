#!/usr/bin/env python3
"""Elbera Tools: original SystemMessage skill pair and numbered substitutions.

python3 tools/ui/check_sysmsg_native.py --check
Requires pinned private Engine.dll/NWindow.dll and Capstone. Decode only in
memory; no executable is run or copied, and no game/account state is used.
"""
import argparse
import json
import struct

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    e.instruction(0x10837512, 'mov', 'dword ptr [0x10a5d8a0], 0x1030731f')
    assert e.data[e.offset(0x1030731f)] == 0xe9
    assert 0x10307324 + struct.unpack_from('<i', e.data, e.offset(0x10307320))[0] == 0x104156d0
    for va, value in [(0x1087ff8c, b'd\0'), (0x1087ff44, b'dd\0'), (0x10886380, b'Q\0')]:
        assert e.data[e.offset(va):e.offset(va) + len(value)] == value
    assert e.u32(0x1041598c + 4 * 4) == 0x10415835
    assert e.u32(0x1041598c + 6 * 4) == 0x10415862
    assert e.exported('?GL2Console@@3PAVUL2ConsoleWnd@@A') == 0x10c5103c
    engine_checks = [
        (0x10415701, 'push', '0x1087ff8c'),
        (0x1041571a, 'push', '0x1087ff8c'),
        (0x10415771, 'push', '0x1087ff8c'),
        (0x1041579d, 'jmp', 'dword ptr [eax*4 + 0x1041598c]'),
        # Reverse vararg addresses: read first D into -50, second into -54.
        (0x10415835, 'lea', 'edx, [ebp - 0x54]'),
        (0x10415839, 'lea', 'eax, [ebp - 0x50]'),
        (0x1041583d, 'push', '0x1087ff44'),
        (0x10415854, 'mov', 'edx, dword ptr [ebp - 0x50]'),
        (0x1041585b, 'call', 'ebx'),
        (0x1041585d, 'mov', 'eax, dword ptr [ebp - 0x54]'),
        (0x104158da, 'push', 'eax'),
        (0x104158de, 'call', 'ebx'),
        (0x10415866, 'push', '0x10886380'),
        (0x104158e0, 'mov', 'ecx, dword ptr [0x10c5103c]'),
        (0x104158ec, 'mov', 'edx, dword ptr [edx + 0x350]'),
        (0x10415920, 'mov', 'ecx, dword ptr [0x10c5103c]'),
        (0x10415932, 'mov', 'edx, dword ptr [edx + 0x354]'),
    ]
    assert w.u32(0x10287da4 + 0x350) == 0x10163f10
    assert w.u32(0x10287da4 + 0x354) == 0x101640d0
    assert w.u32(0x101b7ca0 + 4 * 4) == 0x101b7bf7
    window_checks = [
        (0x10163f4d, 'call', '0x101b7af0'),
        (0x101b7b3f, 'jmp', 'dword ptr [eax*4 + 0x101b7ca0]'),
        (0x101b7bf9, 'call', 'edi'),
        (0x101b7bfb, 'mov', 'ebx, eax'),
        (0x101b7bff, 'call', 'edi'),
        (0x101b7c01, 'push', 'eax'),
        (0x101b7c02, 'push', 'ebx'),
        (0x101b7c09, 'call', '0x10164900'),
        (0x1016411a, 'call', '0x101b7cd0'),
        # Actual network renderer, not execMakeFullSystemMsg's separate helper.
        (0x101b7e98, 'movzx', 'edi, word ptr [edi + ebx*2 + 4]'),
        (0x101b7e9d, 'sub', 'edi, 0x31'),
        (0x101b7eaf, 'lea', 'ebx, [edi*8]'),
        (0x101b7eb9, 'mov', 'edx, dword ptr [ecx + 4]'),
        (0x101b7ebc, 'lea', 'eax, [edx + ebx]'),
    ]
    for image, checks in [(e, engine_checks), (w, window_checks)]:
        for address, mnemonic, operands in checks:
            image.instruction(address, mnemonic, operands)
    return {'status': 'verified-static-original', 'engineSHA256': e.sha, 'nwindowSHA256': w.sha,
            'instructionChecks': 1 + len(engine_checks) + len(window_checks),
            'packet': {'opcode': '0x64', 'bodyVA': '0x104156d0', 'skillParameterType': 4,
                       'skillParameterFormat': 'dd', 'nativeItemCountFormat': 'Q',
                       'configuredServerItemCountFormat': 'd'},
            'networkRendererVA': '0x101b7cd0',
            'substitutionIndex': 'template[current + 2] - ASCII_1; shared typed parameter array',
            'limits': 'Static original dataflow. No executed native client; local aCis type6 differs, native type8 remains unsupported by the gateway.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify the pinned original inputs')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
