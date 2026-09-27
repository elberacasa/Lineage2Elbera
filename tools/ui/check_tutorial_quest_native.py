#!/usr/bin/env python3
"""Verify tutorial and quest behavior against the owner's Interlude binaries.

Run: python3 tools/ui/check_tutorial_quest_native.py --check
Requires capstone. Decodes Engine.dll only in memory; never runs or writes it.
Output is provenance and recovered behavior, not proprietary source or assets.
The fixed build hashes deliberately reject a different client edition.
See docs/native-tutorial-quest-evidence.md for control-flow interpretation.
"""
import argparse
import array
import hashlib
import json
from pathlib import Path
import struct
import sys

from capstone import Cs, CS_ARCH_X86, CS_MODE_32

ROOT = Path(__file__).resolve().parents[2]
ENGINE_SHA = '07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0'
NWINDOW_SHA = 'af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7'


class Image:
    def __init__(self, path, expected_sha, decode=False):
        raw = path.read_bytes()
        self.sha = hashlib.sha256(raw).hexdigest()
        assert self.sha == expected_sha, f'unsupported source build: {path}'
        pe = struct.unpack_from('<I', raw, 60)[0]
        assert raw[pe:pe + 4] == b'PE\0\0'
        optional = pe + 24
        self.base = struct.unpack_from('<I', raw, optional + 28)[0]
        sections_start = optional + struct.unpack_from('<H', raw, pe + 20)[0]
        sections = [struct.unpack_from('<4I', raw, sections_start + i * 40 + 8)
                    for i in range(struct.unpack_from('<H', raw, pe + 6)[0])]
        self.sections = sections
        export_rva = struct.unpack_from('<I', raw, optional + 96)[0]
        table = struct.unpack_from('<IIHH7I', raw, export_rva)
        count, functions, names, ordinals = table[7:]
        self.exports = {}
        for i in range(count):
            p = struct.unpack_from('<I', raw, names + i * 4)[0]
            name = raw[p:raw.index(b'\0', p)].decode('ascii')
            ordinal = struct.unpack_from('<H', raw, ordinals + i * 2)[0]
            self.exports[name] = struct.unpack_from('<I', raw, functions + ordinal * 4)[0]
        self.data = bytearray(raw)
        if decode:
            sentinel = '?__FUNC_NAME__@?2??IsTriangleAll@UTerrainSector@@QAEHHHHHHE@Z@4QBGB'
            pos = self.exports[sentinel]
            key = (struct.unpack_from('<I', raw, pos)[0]
                   - int.from_bytes('UT'.encode('utf-16le'), 'little')) & 0xffffffff
            assert key == 0x7965b551
            _, _, size, start = sections[0]
            words = array.array('I', raw[start:start + size])
            if sys.byteorder != 'little':
                words.byteswap()
            words = array.array('I', ((word - key) & 0xffffffff for word in words))
            if sys.byteorder != 'little':
                words.byteswap()
            self.data[start:start + size] = words.tobytes()
            assert self.wide(self.base + pos) == 'UTerrainSector::IsTriangleAll'
        self.dis = Cs(CS_ARCH_X86, CS_MODE_32)

    def u32(self, va):
        return struct.unpack_from('<I', self.data, self.offset(va))[0]

    def offset(self, va):
        rva = va - self.base
        for _, address, size, start in self.sections:
            if address <= rva < address + size:
                return start + rva - address
        raise ValueError(f'unmapped address {hex(va)}')

    def wide(self, va):
        p = self.offset(va)
        end = p
        while self.data[end:end + 2] != b'\0\0':
            end += 2
        return self.data[p:end].decode('utf-16le')

    def exported(self, name, body=False):
        rva = self.exports[name]
        if body:
            assert self.data[rva] == 0xe9
            rva += 5 + struct.unpack_from('<i', self.data, rva + 1)[0]
        return self.base + rva

    def instruction(self, va, mnemonic, operands):
        start = self.offset(va)
        instruction = next(self.dis.disasm(self.data[start:start+16], va))
        assert (instruction.mnemonic, instruction.op_str) == (mnemonic, operands), (
            hex(va), instruction.mnemonic, instruction.op_str, mnemonic, operands)


def verify():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    window = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    assert engine.base == 0x10300000 and window.base == 0x10000000
    game_vtable = engine.exported('??_7UGameEngine@@6BUObject@@@')
    network_vtable = engine.exported('??_7UNetworkHandler@@6BUObject@@@')
    assert engine.u32(game_vtable + 0x204) == engine.exported(
        '?CheckTutorialClientEvent@UGameEngine@@UAEHH@Z')
    assert engine.exported('?CheckTutorialClientEvent@UGameEngine@@UAEHH@Z', True) == 0x10488ae0
    engine.instruction(0x10488ae9, 'mov', 'eax, dword ptr [eax + 0x158]')
    assert window.u32(0x10287da4 + 0x158) == 0x10144c20
    assert window.u32(0x10287da4 + 0x150) == 0x10144c50
    window.instruction(0x10144c54, 'mov', 'dword ptr [ecx + 0x50dc], eax')
    window.instruction(0x10144c28, 'test', 'dword ptr [esi + 0x50dc], edi')
    window.instruction(0x10144c41, 'xor', 'dword ptr [esi + 0x50dc], edi')
    # Input commands and their exact report sites, all in UInput::Exec.
    commands = [
        ('PLAYERPAWNMOVETO', 1, 0x105aebc7, 0x105af4cc, 0x105af4ce, 'edx', 'eax'),
        ('CAMERAPITCH', 2, 0x105b4e42, 0x105b4f39, 0x105b4f3b, 'eax', 'edx'),
        ('CAMERAYAW', 2, 0x105b4fb4, 0x105b50b3, 0x105b50b5, 'eax', 'edx'),
        ('ZOOMINPRESS', 4, 0x105ae6a2, 0x105ae891, 0x105ae893, 'eax', 'edx'),
        ('ZOOMOUTPRESS', 4, 0x105ae8a0, 0x105aea7f, 0x105aea81, 'edx', 'eax'),
        ('DEFAULTCAMERA', 8, 0x105acb59, 0x105acd19, 0x105acd1b, 'edx', 'eax'),
        ('FIXEDDEFAULTCAMERA', 8, 0x105acd28, 0x105acfb6, 0x105acfb8, 'eax', 'edx'),
        ('TURNBACK', 16, 0x105acfc5, 0x105ad0b7, 0x105ad0b9, 'eax', 'edx'),
    ]
    # Resolve the string operand directly from the original command push.
    # Its spelling and the fixed build pin are what identify the branch.
    for name, bit, start, report, dispatch, dest, owner in commands:
        instruction = next(engine.dis.disasm(engine.data[start-engine.base:start-engine.base+8], start))
        assert instruction.mnemonic == 'push'
        assert engine.wide(int(instruction.op_str, 16)) == name
        engine.instruction(report, 'push', str(bit) if bit < 10 else hex(bit))
        engine.instruction(dispatch, 'mov', f'{dest}, dword ptr [{owner} + 0x204]')
        engine.instruction(dispatch + 6, 'call', dest)
    # Ground movement sends only after MTL, not in object-target branches.
    assert engine.u32(network_vtable + 0xe4) == engine.exported(
        '?MTL@UNetworkHandler@@UAEXPAVAActor@@VFVector@@10H@Z')
    engine.instruction(0x105af4bc, 'mov', 'edx, dword ptr [esi + 0xe4]')
    engine.instruction(0x105af4c2, 'call', 'edx')
    engine.instruction(0x105af43e, 'push', '0x10')  # Shift KeyDown gate
    engine.instruction(0x105af44a, 'jne', '0x105b0076')
    # Rotation uses an integer absolute delta >100, not any camera redraw.
    # The conversion helper truncates the current command before that check.
    engine.instruction(0x107a66b5, 'cvttsd2si', 'eax, qword ptr [esp]')
    engine.instruction(0x105b4f01, 'call', '0x107a66a0')
    engine.instruction(0x105b5073, 'call', '0x107a66a0')
    engine.instruction(0x10533e04, 'test', 'eax, eax')
    engine.instruction(0x10533e08, 'neg', 'eax')
    for compare in (0x105b4f2c, 0x105b50a2):
        engine.instruction(compare, 'cmp', 'eax, 0x64')
    for slot, name, opcode, push in [
        (0x1b8, 'QuestionMarkPressed', 0x7d, 0x10404e3a),
        (0x1bc, 'ClientEvent', 0x7e, 0x10404e8a),
    ]:
        assert engine.u32(network_vtable + slot) == engine.exported(
            f'?RequestTutorial{name}@UNetworkHandler@@UAEHH@Z')
        engine.instruction(push, 'push', hex(opcode))
    engine.instruction(0x10404df6, 'push', '0x7b')
    engine.instruction(0x10404fe6, 'push', '0x7c')

    # QuestID/flags are forwarded to the original console AddQuestID.
    assert engine.u32(game_vtable + 0x43c) == engine.exported('?AddQuestID@UGameEngine@@UAEXHH@Z')
    engine.instruction(0x10489725, 'mov', 'eax, dword ptr [eax + 0x30c]')
    assert window.u32(0x10287da4 + 0x30c) == 0x1016ac70
    assert struct.unpack_from('<f', window.data, 0x249830)[0] == 2.0
    window.instruction(0x1016ad15, 'mov', 'eax, 0x1f')
    window.instruction(0x1016ad4b, 'test', 'ebx, eax')
    window.instruction(0x1016ad4d, 'jne', '0x1016ad7e')
    window.instruction(0x1016ad5b, 'cmp', 'esi, edi')
    window.instruction(0x1016ad77, 'or', 'ebx, eax')
    window.instruction(0x1016ad83, 'cmp', 'esi, 0x1e')
    window.instruction(0x1016adcf, 'lea', 'eax, [esi + 1]')
    window.instruction(0x1016ae79, 'cmp', 'esi, eax')
    window.instruction(0x1016ae8a, 'push', '0')
    window.instruction(0x1016aeae, 'push', '1')
    window.instruction(0x1016aecd, 'push', '0x2c6')
    assert [window.wide(p) for p in (0x102874d0, 0x102461c0, 0x102874bc)] == [
        'QuestID', 'Level', 'Completed']
    # Script thunks -> native predicates -> native record fields.
    window.instruction(0x101262b7, 'call', '0x10143630')
    window.instruction(0x101263b7, 'call', '0x101436e0')
    window.instruction(0x10143690, 'cmp', 'dword ptr [eax + 0x24], 0')
    window.instruction(0x10143740, 'cmp', 'dword ptr [eax + 0x4c], 0')
    # Complete stream order after tag, read from the original serializer.
    # Note the out-of-order memory fields +24/+4c; stream order alone could
    # not have established the meaning of these two booleans.
    quest_fields = [
        ('id', 0x04, 0x104659f4, 'eax'), ('level', 0x08, 0x104659fe, 'ecx'),
        ('title', 0x0c, 0x10465a08, 'edx'), ('journal', 0x18, 0x10465a15, 'eax'),
        ('description', 0x28, 0x10465a1c, 'ecx'), ('itemIds', 0x34, 0x10465a23, 'edx'),
        ('itemCounts', 0x40, 0x10465a2d, 'eax'), ('targetLoc', 0x50, 0x10465a3a, 'ecx'),
        ('minLevel', 0x5c, 0x10465a44, 'edx'), ('maxLevel', 0x60, 0x10465a4e, 'eax'),
        ('questType', 0x64, 0x10465a58, 'ecx'), ('targetName', 0x68, 0x10465a62, 'edx'),
        ('getItemInQuest', 0x74, 0x10465a69, 'eax'), ('unknown1', 0x24, 0x10465a73, 'ecx'),
        ('unknown2', 0x4c, 0x10465a7d, 'edx'), ('startNpcId', 0x78, 0x10465a8a, 'eax'),
        ('startNpcLoc', 0x7c, 0x10465a94, 'ecx'), ('requirements', 0x88, 0x10465a9e, 'edx'),
        ('intro', 0x94, 0x10465aa8, 'eax'), ('classLimits', 0xa0, 0x10465ab2, 'ecx'),
        ('requiredItems', 0xac, 0x10465abf, 'edx'), ('clanPetQuest', 0xb8, 0x10465acc, 'eax'),
        ('requiredQuest', 0xbc, 0x10465ad9, 'ecx'), ('unknown3', 0xc0, 0x10465ae9, 'edx'),
    ]
    for _, field, address, register in quest_fields:
        literal = str(field) if field < 10 else hex(field)
        engine.instruction(address, 'lea', f'{register}, [esi + {literal}]')
    engine.instruction(0x104659ea, 'push', 'esi')  # tag at +0
    engine.instruction(0x10465af6, 'add', 'esi, 0xc4')  # final areaId
    return {
        'status': 'verified', 'edition': 'this owned Interlude build',
        'engineSHA256': engine.sha, 'nwindowSHA256': window.sha,
        'tutorialCommands': [{'command': row[0], 'bit': row[1],
                              'dispatchVA': hex(row[4])} for row in commands],
        'rotationMinimumExclusive': 100,
        'rotationThresholdScope': 'truncated native angular delta of each command, before pitch clamp',
        'tutorialOpcodes': {'link': 0x7b, 'passCommand': 0x7c,
                            'question': 0x7d, 'clientEvent': 0x7e},
        'questEvent': 710, 'questStageBits': [0, 29],
        'questFlag31': 'set: stage bitmask; clear: sequential stage count',
        'questCompleted': 'all emitted stages except final stage',
        'questShowJournal': 'record unknown1 != 0 (native field +0x24)',
        'questShowItemCount': 'record unknown2 != 0 (native field +0x4c)',
        'questFieldOffsets': dict([('tag', '0x0')]
                                  + [(name, hex(field)) for name, field, _, _ in quest_fields]
                                  + [('areaId', '0xc4')]),
        'limits': ['full camera input state guards remain native-client specific',
                   'no tutorial meanings assigned to other numeric bits'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify sources; this tool is always read-only')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
