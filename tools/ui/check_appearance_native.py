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


def equipment_evidence(e):
    """Join packet argument addresses to the native User item-slot bank.

    The first UserInfo bank contains object IDs; CharInfo's corresponding
    bank contains template IDs. HaveItem deliberately consumes that bank,
    whereas GetItemClassID resolves local object IDs through the item list.
    """
    assert e.exported('?HaveItem@User@@QAEHW4ItemSlotType@@@Z', True) == 0x10480f40
    assert e.exported('?GetItemClassID@User@@QAEHH@Z', True) == 0x10482100
    assert e.exported('?GetItem@UNetworkHandler@@UAEPAUItem@@H@Z', True) == 0x1042b8c0
    table = e.exported('??_7UNetworkHandler@@6BUObject@@@')
    assert e.u32(table + 0xa0) == e.exported('?GetItem@UNetworkHandler@@UAEPAUItem@@H@Z')
    anchors = [
        (0x10480f4b, 'cmp', 'dword ptr [ecx + edx*4 + 0x98], eax'),
        (0x10480f52, 'setg', 'al'),
        (0x10434a61, 'mov', 'dword ptr [esi + 0x94], 1'),
        (0x1048212e, 'cmp', 'dword ptr [edi + 0x94], edx'),
        (0x10482134, 'je', '0x1048266e'),
        (0x10483608, 'call', '0x10305394'),
        (0x10305394, 'jmp', '0x10482100'),
        (0x10482297, 'mov', 'edi, dword ptr [edi + 0xb0]'),
        (0x104825d5, 'mov', 'edi, dword ptr [edi + 0xdc]'),
        (0x104825e0, 'mov', 'eax, dword ptr [edi + 0xdc]'),
        (0x104825f6, 'mov', 'eax, dword ptr [edx + 0xa0]'),
        (0x104825fc, 'call', 'eax'),
        (0x10482617, 'cmp', 'dword ptr [eax + 4], 1'),
        (0x1048261d, 'cmp', 'dword ptr [eax + 0xd4], 0x13'),
        (0x10482624, 'jne', '0x10482634'),
        (0x10482629, 'mov', 'eax, dword ptr [esi + 4]'),
        (0x10482634, 'mov', 'edi, dword ptr [edi + 0xe0]'),
        (0x1048264e, 'mov', 'edx, dword ptr [eax + 0xa0]'),
        (0x10482654, 'call', 'edx'),
        (0x10482663, 'mov', 'eax, dword ptr [esi + 4]'),
        (0x10482759, 'mov', 'edi, dword ptr [edi + 0xb0]'),
        (0x10482961, 'mov', 'eax, dword ptr [edi + 0xdc]'),
        (0x1048296c, 'mov', 'ecx, dword ptr [edi + 0xe0]'),
    ]
    for anchor in anchors:
        e.instruction(*anchor)
    for table, targets in [(0x104829c8, [0x10482297, 0x104825d5, 0x104825e0]),
                           (0x10482a04, [0x10482759, 0x10482961, 0x1048296c])]:
        assert [e.u32(table + part * 4) for part in (6, 7, 8)] == targets
    result = {}
    for packet, fmtva, start, end, first, slots in [
        ('UserInfo', 0x1088ae38, 0x10434357, 0x1043473e, 25, [*range(15), 17, 18]),
        ('CharInfo', 0x1088b080, 0x10436777, 0x104369c3, 9, [0, *range(6, 15), 17, 18]),
    ]:
        off = e.offset(fmtva)
        fmt = e.data[off:e.data.index(0, off)].decode('ascii')
        ins = list(e.dis.disasm(e.data[e.offset(start):e.offset(end)], start))
        args = list(reversed([i for i in ins if i.mnemonic == 'push'][:-3]))
        previous = {b.address: a for a, b in zip(ins, ins[1:])}
        fields = []
        for index, slot in enumerate(slots):
            field = first + index
            push = args[field_argument_index(fmt, field)]
            lea = previous[push.address]
            expected = f'{push.op_str}, [esi + {hex(0x98 + slot * 4)}]'
            assert fmt[field] == 'd' and (lea.mnemonic, lea.op_str) == ('lea', expected)
            fields.append({'wireField': field, 'bankIndex': index, 'nativeSlot': slot,
                           'UserOffset': hex(0x98 + slot * 4), 'pushVA': hex(push.address)})
        result[packet] = fields
    return {'instructionChecks': len(anchors), 'packetBankFields': result,
            'HaveItem': 'signed bank[slot] > 0',
            'appearanceItems': {'UserInfo': 'first/object-ID bank', 'CharInfo': 'template-ID bank'},
            'meshParts': {'6': 'slot6', '7': 'slot17',
                          '8': 'remote slot18; local slot17 only if resolved item category1/bodypart19, else slot18'},
            'limits': ['local mesh selection requires inventory object-to-template resolution and item category/bodypart',
                       'does not certify preview initialization or infer accessory table keys from item IDs']}


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
    equipment = equipment_evidence(e)
    return {'format': 'elbera-native-appearance-wire-evidence-v1', 'status': 'verified',
            'engineSHA256': e.sha, 'instructionChecks': len(anchors), 'packetReaders': packets,
            'scope': 'original DWORD positions and User destinations; configured writer field-name correspondence',
            'equipment': equipment,
            'limits': ['not a complete native packet-reader emulation or malformed-packet compatibility claim',
                       'not proof of hair/face selector rules, palette support or visual parity']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = verify()
    if args.check:
        print(f"PASS Elbera Tools appearance wire: {result['instructionChecks']} appearance + "
              f"{result['equipment']['instructionChecks']} equipment anchors, 2 original readers, "
              '8 appearance + 29 item-bank DWORD destinations, 2 source-format packet fixtures')
    else:
        print(json.dumps(result, indent=2))
