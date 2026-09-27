#!/usr/bin/env python3
"""Elbera Tools: verify original Interlude clan reputation wire interpretation.

python3 tools/ui/check_clan_native.py --check
Reads pinned private Engine/NWindow DLLs; decodes Engine in memory only.
Requires Capstone. No network, execution of client code, or asset output.
"""
import argparse
import json
import re
import struct

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA


def destinations(image, start, format_push, format_string, unused=()):
    """Recover local addresses from the original reverse-order varargs pushes.

    The bounded call sites only use LEA(reg,[esp+offset]) and PUSH; ESP moves
    with every push. Uppercase S takes capacity then buffer pointer. This
    computes packet-to-structure offsets rather than asserting a guessed one.
    """
    esp, registers, pushed = 0, {}, []
    for ins in image.dis.disasm(image.data[image.offset(start):image.offset(format_push)], start):
        if ins.mnemonic == 'lea':
            match = re.fullmatch(r'(\w+), \[esp \+ (0x[0-9a-f]+|\d+)\]', ins.op_str)
            assert match, (hex(ins.address), ins.op_str)
            registers[match[1]] = ('local', esp + int(match[2], 0))
        elif ins.mnemonic == 'push':
            pushed.append(registers[ins.op_str] if ins.op_str in registers
                          else ('immediate', int(ins.op_str, 0)))
            esp -= 4
        elif ins.mnemonic != 'mov':
            raise AssertionError((hex(ins.address), ins.mnemonic, ins.op_str))
    args = iter(reversed(pushed))
    result = []
    for field in format_string:
        if field == 'S':
            assert next(args) == ('immediate', 0x30)
        kind, offset = next(args)
        assert kind == 'local'
        result.append(offset)
    assert tuple(args) == unused
    return result


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    for opcode, registration, stub, body in [
        (0x53, 0x1083731f, 0x10307423, 0x10438df0),
        (0x88, 0x10837935, 0x10310b81, 0x10439280),
    ]:
        e.instruction(registration, 'mov', f'dword ptr [{hex(0x10a57310 + opcode * 0x104)}], {hex(stub)}')
        assert e.data[e.offset(stub)] == 0xe9
        assert stub + 5 + struct.unpack_from('<i', e.data, e.offset(stub) + 1)[0] == body
    for pointer, value in [(0x1088b210, 'dddSS'), (0x10885018, 'dddddddddSdd'),
                           (0x1088b270, 'ddddddddddSdd')]:
        p = e.offset(pointer)
        assert e.data[p:p + len(value) + 1] == value.encode() + b'\0'
    full = destinations(e, 0x10438e6c, 0x10438ece, 'dddddddddSdd')
    # The original update call passes one extra trailing local pointer that
    # its format string does not consume; it is not another wire field.
    update = destinations(e, 0x10439290, 0x10439310, 'ddddddddddSdd', (('local', 0xe0),))
    # Full's struct was initialized at esp+0x48 before three saved-register
    # pushes, hence +0x54 here; Update's struct begins at esp+4.
    e.instruction(0x10438e0c, 'lea', 'ecx, [esp + 0x48]')
    e.instruction(0x10438e69, 'push', 'ebx')
    e.instruction(0x10438e6a, 'push', 'ebp')
    e.instruction(0x10438e6b, 'push', 'esi')
    e.instruction(0x10439287, 'lea', 'ecx, [esp + 4]')
    assert full[5] - 0x54 == update[6] - 4 == 0x74
    assert w.wide(0x10283e1c) == 'ClanNameValue'
    assert w.exported('?execGetClanNameValue@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x100fc5c0
    w.instruction(0x1015afae, 'push', '0x10283e1c')
    w.instruction(0x1015afc0, 'mov', 'eax, dword ptr [esi + 0x74]')
    w.instruction(0x100fc64c, 'call', '0x10145a60')
    w.instruction(0x100fc655, 'mov', 'esi, dword ptr [eax + 0x74]')
    return {'status': 'verified-static-original', 'engineSHA256': e.sha,
            'nwindowSHA256': w.sha, 'nativeField': 'ClanNameValue',
            'nativeStructOffset': '0x74', 'encoding': 'signed little-endian int32',
            'full': 'opcode 0x53: dddSS prefix, then sixth int32',
            'update': 'opcode 0x88: seventh int32, packet byte 25 including opcode',
            'limits': 'Static native dataflow; packed Engine import calls were erased. No subpledge/permission implementation.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
