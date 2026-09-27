#!/usr/bin/env python3
"""Elbera Tools: original UserInfo/CharInfo appearance wire destinations.

Requires the owner's pinned Engine.dll and Capstone; decodes only in memory.
No native execution, asset output, game connection or account access. --check
prints a compact result. Default output is public-safe provenance JSON.
"""
import argparse
import hashlib
import json
import re

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
from check_inventory_native import field_argument_index


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    anchors = [
        # Native d branch copies one DWORD and advances by four bytes.
        (0x1040274d, 'mov', 'eax, dword ptr [edi + 4]'),
        (0x1040275b, 'mov', 'edx, dword ptr [esi]'),
        (0x1040275d, 'mov', 'dword ptr [eax], edx'),
        (0x1040275f, 'add', 'esi, 4'),
        # UserInfo passes its three appearance destinations directly.
        (0x104343b0, 'lea', 'eax, [esi + 0x248]'),
        (0x104343b6, 'push', 'eax'),
        (0x104343b7, 'lea', 'ecx, [esi + 0x244]'),
        (0x104343bd, 'push', 'ecx'),
        (0x104343be, 'lea', 'edx, [esi + 0x240]'),
        (0x104343c4, 'push', 'edx'),
        # Its earlier sex pointer is saved/reloaded through the same stack slot.
        (0x1043441d, 'lea', 'ebx, [esi + 0x50]'),
        (0x10434420, 'mov', 'dword ptr [esp + 0xe8], ebx'),
        (0x104346de, 'mov', 'ecx, dword ptr [esp + 0x264]'),
        (0x104346fb, 'push', 'ecx'),
        (0x10434732, 'push', '0x1088ae38'),
        (0x10434739, 'call', '0x103034e5'),
        # CharInfo passes the same four destinations directly.
        (0x104367d3, 'lea', 'edx, [esi + 0x248]'),
        (0x104367d9, 'push', 'edx'),
        (0x104367da, 'lea', 'eax, [esi + 0x244]'),
        (0x104367e0, 'push', 'eax'),
        (0x104367e1, 'lea', 'ecx, [esi + 0x240]'),
        (0x104367e7, 'push', 'ecx'),
        (0x1043696b, 'lea', 'eax, [esi + 0x50]'),
        (0x1043696f, 'push', 'eax'),
        (0x104369b7, 'push', '0x1088b080'),
        (0x104369be, 'call', '0x103034e5'),
        (0x103034e5, 'jmp', '0x104026b0'),
        # Named original mesh-type selection consumes the sex destination.
        (0x10480c05, 'cmp', 'dword ptr [ecx + 0x50], 0'),
        (0x10480c09, 'jne', '0x10480c1e'),
    ]
    for va, mnemonic, operands in anchors:
        e.instruction(va, mnemonic, operands)
    assert e.exported('?GetMeshType@User@@QAEHXZ', True) == 0x10480bb0
    branch = e.data[e.offset(0x104028ec) + ord('d') - 0x51]
    assert e.u32(0x104028c8 + branch * 4) == 0x1040274d
    packets = {}
    fixture = (ROOT / 'gateway/test/appearance-packets.test.js').read_text()
    for name, fmt_va, start, end, push_count, fields in [
        ('UserInfo', 0x1088ae38, 0x10434357, 0x1043473e, 138,
         [('sex', 7, 0x50, 0x104346fb), ('hairStyle', 117, 0x240, 0x104343c4),
          ('hairColor', 118, 0x244, 0x104343bd), ('face', 119, 0x248, 0x104343b6)]),
        ('CharInfo', 0x1088b080, 0x10436777, 0x104369c3, 85,
         [('sex', 7, 0x50, 0x1043696f), ('hairStyle', 63, 0x240, 0x104367e7),
          ('hairColor', 64, 0x244, 0x104367e0), ('face', 65, 0x248, 0x104367d9)]),
    ]:
        offset = e.offset(fmt_va)
        fmt = e.data[offset:e.data.index(0, offset)].decode('ascii')
        code = e.data[e.offset(start):e.offset(end)]
        instructions = list(e.dis.disasm(code, start))
        pushes = [i for i in instructions if i.mnemonic == 'push']
        assert len(pushes) == push_count
        # Three final pushes are format, packet pointer, network handler.
        arguments = list(reversed(pushes[:-3]))
        assert len(arguments) == len(fmt) + fmt.count('S')
        assert fmt[fields[1][1] - 4:fields[1][1]] == 'ffff'
        for key, index, destination, push_va in fields:
            assert fmt[index] == 'd'
            assert arguments[field_argument_index(fmt, index)].address == push_va
        if name == 'UserInfo':
            before_save = sum(i.address < 0x10434420 for i in pushes)
            before_load = sum(i.address < 0x104346de for i in pushes)
            assert (before_save, before_load) == (29, 124)
            assert 0xe8 - before_save * 4 == 0x264 - before_load * 4 == 0x74
        # Test wire strings are fresh-checked against the original, not against
        # gateway parsing code. Test fields remain wholly synthetic.
        kind = 'user' if name == 'UserInfo' else 'char'
        assert re.search(r"\b" + kind + r": '([^']+)'", fixture).group(1) == fmt
        java_path = ROOT / 'server/aCis_gameserver/java/net/sf/l2j/gameserver/network/serverpackets' / (name + '.java')
        java = java_path.read_text()
        assert 'writeD(_player.getAppearance().getSex().ordinal());' in java
        assert re.search(r'writeD\(_player.getAppearance\(\).getHairStyle\(\)\);\s*'
                         r'writeD\(_player.getAppearance\(\).getHairColor\(\)\);\s*'
                         r'writeD\(_player.getAppearance\(\).getFace\(\)\);', java)
        packets[name] = {
            'formatVA': hex(fmt_va), 'format': fmt, 'pushCount': push_count,
            'range': [hex(start), hex(end)], 'recoveredCodeSHA256': hashlib.sha256(code).hexdigest(),
            'fields': {key: {'zeroBasedField': index, 'UserOffset': hex(destination), 'argumentPushVA': hex(push_va)}
                       for key, index, destination, push_va in fields},
            'configuredWriterSHA256': hashlib.sha256(java_path.read_bytes()).hexdigest(),
        }
    return {'format': 'elbera-native-appearance-wire-evidence-v1', 'status': 'verified',
            'engineSHA256': e.sha, 'instructionChecks': len(anchors), 'packetReaders': packets,
            'scope': 'original DWORD positions and User destinations; configured writer field-name correspondence',
            'limits': ['not a complete native packet-reader emulation or malformed-packet compatibility claim',
                       'not proof of hair/face selector rules, palette support or visual parity']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = verify()
    if args.check:
        print(f"PASS Elbera Tools appearance wire: {result['instructionChecks']} instruction anchors, "
              '2 original readers, 8 DWORD destinations, 2 source-format packet fixtures')
    else:
        print(json.dumps(result, indent=2))
