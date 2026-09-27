#!/usr/bin/env python3
"""Elbera Tools: original Interlude learned-skill and target-difference proof.

python3 tools/ui/check_skill_state_native.py --check
Requires the pinned private Engine.dll and Capstone. Decode in memory only;
no execution, network, binary output or game-data mutation.
"""
import argparse
import json
import struct

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    for opcode, registration, stub, body in [
        (0x58, 0x108373b3, 0x1030a399, 0x10415450),
        (0xa6, 0x10837ca4, 0x1030951b, 0x10427590),
    ]:
        e.instruction(registration, 'mov', f'dword ptr [{hex(0x10a57310 + opcode * 0x104)}], {hex(stub)}')
        assert e.data[e.offset(stub)] == 0xe9
        assert stub + 5 + struct.unpack_from('<i', e.data, e.offset(stub) + 1)[0] == body
    for address, value in [(0x1087ff8c, 'd'), (0x10881140, 'dddc'), (0x1088545c, 'dhd')]:
        offset = e.offset(address)
        assert e.data[offset:offset + len(value) + 1] == value.encode() + b'\0'
    # Header count, reset before the row loop, row wire format, countdown.
    e.instruction(0x1041547a, 'push', '0x1087ff8c')
    e.instruction(0x104154ab, 'mov', 'eax, dword ptr [edx + 0x45c]')
    e.instruction(0x104154b4, 'call', 'eax')
    e.instruction(0x104154b6, 'cmp', 'dword ptr [esp + 8], 0')
    e.instruction(0x104154bb, 'jle', '0x10415571')
    e.instruction(0x104154d0, 'sub', 'dword ptr [esp + 0x10], 1')
    e.instruction(0x104154fc, 'push', '0x10881140')
    # Original reverse-varargs destinations, relative to the pre-push ESP:
    # row [D +14, D +18, D +1c, C +40]. These are subsequently dispatched
    # in that order. No boolean/category values are inferred by this check.
    for address, operands in [(0x104154e5, 'ecx, [esp + 0x40]'),
                              (0x104154ea, 'edx, [esp + 0x20]'),
                              (0x104154f2, 'eax, [esp + 0x20]'),
                              (0x104154f7, 'ecx, [esp + 0x20]')]:
        e.instruction(address, 'lea', operands)
    e.instruction(0x1041552e, 'movsx', 'eax, byte ptr [esp + 0x40]')
    e.instruction(0x10415545, 'mov', 'edx, dword ptr [edx + 0x464]')
    e.instruction(0x10415564, 'cmp', 'dword ptr [esp + 0x10], 0')
    e.instruction(0x10415569, 'jg', '0x104154d0')
    # Native target packet has an additional D after the signed H. The
    # current local server emits only D/H; changing its format is out of
    # scope. Sign extension of the H is independently proven in both cases.
    e.instruction(0x104275b1, 'push', '0x1088545c')
    e.instruction(0x104276b6, 'movsx', 'esi, word ptr [esp + 0x1c]')
    e.instruction(0x104276c0, 'push', 'esi')
    e.instruction(0x104276c9, 'mov', 'eax, dword ptr [edx + 0x26c]')
    return {'status': 'verified-static-original', 'engineSHA256': e.sha,
            'skillList': {'opcode': '0x58', 'bodyVA': '0x10415450',
                          'header': 'd', 'row': 'dddc', 'rowBytes': 13},
            'target': {'opcode': '0xa6', 'bodyVA': '0x10427590',
                       'nativeFormat': 'dhd', 'levelDifference': 'signed int16',
                       'localServerFormat': 'dh'},
            'limits': 'Static original call/dataflow only; erased Engine import calls. Does not prove shortcut persistence, category lookup or cast scheduler parity.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify pinned original evidence')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
