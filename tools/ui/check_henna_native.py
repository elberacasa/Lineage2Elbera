#!/usr/bin/env python3
"""Elbera Tools: bounded original Interlude henna UI/data/protocol evidence.

Requires the owner's pinned Engine.dll, NWindow.dll, Interface.u and NWindow.u,
the existing package decoder and capstone. Reads originals; executes no native
code and opens no game connection. --output optionally saves a private receipt.
This does not certify native item rendering, font metrics or all UI behavior.
"""
import argparse
import hashlib
import json
import re
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA

sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript')]
from l2lib import load_package
from extract_uscript import sources_from_package
sys.path.insert(0, str(ROOT / 'tools/audio'))
from verify_falloff import PE

PACKAGE_SHA = {
    'Interface.u': '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd',
    'NWindow.u': '6f3171147d83e447f2427e249c2ad73428e2b385d1557b86c53effa1062ea791',
}
SCRIPT_SHA = {
    'InventoryWnd': '198906435ca1debb898f2685134fc83376d927207d8df07839c2e18219337f01',
    'HennaListWnd': '2d6c53e27a8815344c8ee0b42c39c8d907360613aa4323904a8ec7b135e1bf81',
    'HennaInfoWnd': '1e2d4ed7e8fc40ede244078648cbf48d251da4972d44d84351f766e972478c5e',
    'UIDATA_HENNA': 'd1e0a4d22c3921901b117b841203a60c747d24b908f219b45ba6ac0c13defa4d',
    'HennaAPI': '02977fb79be3d879b96f752c6d0188bd3c3a81893a3f54794c00021af03cddac',
}


def cstring(image, address):
    offset = image.offset(address)
    return bytes(image.data[offset:image.data.index(0, offset)]).decode('ascii')


def thunk(image, address):
    offset = image.offset(address)
    assert image.data[offset] == 0xe9
    return address + 5 + struct.unpack_from('<i', image.data, offset + 1)[0]


def verify():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    window = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    engine_checks = [
        # HennaDataLoad names Hennagrp, then calls the six-field serializer.
        (0x10472b90, 'push', '0x1089aedc'),
        (0x10472c8b, 'call', '0x10310cc1'),
        (0x10446dda, 'push', 'esi'),
        (0x10446ddf, 'call', '0x1030599d'),
        (0x10446de4, 'lea', 'eax, [esi + 4]'),
        (0x10446de9, 'call', '0x1030599d'),
        (0x10446dee, 'lea', 'ecx, [esi + 8]'),
        (0x10446dfb, 'lea', 'edx, [esi + 0x14]'),
        (0x10446e02, 'lea', 'eax, [esi + 0x20]'),
        (0x10446e09, 'add', 'esi, 0x2c'),
        # The generic 'c' case writes one byte, not a signed DWORD.
        (0x104026eb, 'lea', 'ecx, [eax - 0x51]'),
        (0x104026f7, 'movzx', 'ecx, byte ptr [ecx + 0x104028ec]'),
        (0x104026fe, 'jmp', 'dword ptr [ecx*4 + 0x104028c8]'),
        (0x10402713, 'mov', 'dl, byte ptr [esi]'),
        (0x10402715, 'mov', 'byte ptr [eax], dl'),
        # Each detail decoder zeroes the complete seventeen-DWORD structure.
        (0x104193d3, 'xor', 'eax, eax'),
        (0x10419489, 'push', '0x10887168'),
        (0x104194a6, 'mov', 'edx, dword ptr [edx + 0x584]'),
        (0x10419ce3, 'xor', 'eax, eax'),
        (0x10419d99, 'push', '0x10887168'),
        (0x10419db6, 'mov', 'edx, dword ptr [edx + 0x598]'),
        # E4 alone explicitly sign-extends the six stat bytes.
        (0x10419572, 'push', '0x108871bc'),
        (0x104195b3, 'movsx', 'ecx, byte ptr [esp + 0x40]'),
        (0x104195b8, 'movsx', 'edx, byte ptr [esp + 0x3e]'),
        (0x104195c1, 'movsx', 'ecx, byte ptr [esp + 0x43]'),
        (0x104195c8, 'movsx', 'eax, byte ptr [esp + 0x3f]'),
        (0x104195d1, 'movsx', 'edx, byte ptr [esp + 0x41]'),
        (0x104195e5, 'movsx', 'eax, byte ptr [esp + 0x42]'),
        (0x10419601, 'mov', 'edx, dword ptr [edx + 0x588]'),
        (0x10419634, 'push', '0x1087ff44'),
        (0x1041964b, 'mov', 'edx, dword ptr [edx + 0x58c]'),
        # List header/row formats and receiver vtable slots.
        (0x10419271, 'push', '0x1087ff0c'),
        (0x1041928d, 'mov', 'edx, dword ptr [edx + 0x57c]'),
        (0x104192d0, 'push', '0x10883d84'),
        (0x10419342, 'mov', 'eax, dword ptr [edx + 0x580]'),
        (0x104198d1, 'push', '0x1087ff0c'),
        (0x104198ed, 'mov', 'edx, dword ptr [edx + 0x590]'),
        (0x10419930, 'push', '0x10883d84'),
        (0x104199a2, 'mov', 'eax, dword ptr [edx + 0x594]'),
        (0x10489be5, 'mov', 'eax, dword ptr [eax + 0x278]'),
        (0x10489beb, 'jmp', 'eax'),
        (0x10489c09, 'mov', 'eax, dword ptr [edx + 0x27c]'),
        (0x10489c0f, 'call', 'eax'),
        (0x10489c29, 'mov', 'edx, dword ptr [edx + 0x280]'),
        (0x10489c44, 'call', 'edx'),
        (0x10489c69, 'mov', 'edx, dword ptr [edx + 0x284]'),
        (0x10489c84, 'call', 'edx'),
        (0x10489ca5, 'mov', 'eax, dword ptr [eax + 0x288]'),
        (0x10489cab, 'jmp', 'eax'),
        (0x10489cb5, 'mov', 'eax, dword ptr [eax + 0x28c]'),
        (0x10489cbb, 'jmp', 'eax'),
        (0x10489d29, 'mov', 'eax, dword ptr [edx + 0x290]'),
        (0x10489d2f, 'call', 'eax'),
        (0x10489da9, 'mov', 'edx, dword ptr [edx + 0x294]'),
        (0x10489dc4, 'call', 'edx'),
        # The no-argument list calls still use the ordinary varargs sender.
        (0x10408b85, 'mov', 'edx, dword ptr [ecx + 0x68]'),
        (0x10408b93, 'call', 'edx'),
        (0x10408bc5, 'mov', 'edx, dword ptr [ecx + 0x68]'),
        (0x10408bd3, 'call', 'edx'),
        (0x1043c483, 'call', '0x1031178e'),
        (0x1043c48e, 'mov', 'dword ptr [esi + 0x48], eax'),
        (0x1043b903, 'mov', 'dword ptr [esi], 0x1088b5ec'),
        (0x1043c28d, 'call', '0x1031178e'),
        (0x1043c29a, 'mov', 'dword ptr [esi], 0x1088bd9c'),
        (0x10403200, 'ret', ''),
        (0x104029b0, 'mov', 'eax, 0x2000'),
        (0x104029b5, 'call', '0x107a6a10'),
        (0x104029bb, 'mov', 'esi, dword ptr [esp + 0x2008]'),
        (0x104029da, 'mov', 'eax, dword ptr [esp + 0x2010]'),
        (0x104029ea, 'lea', 'ecx, [esp + 0x2018]'),
        (0x104029f1, 'push', 'ecx'),
        (0x104029f2, 'push', 'eax'),
        (0x104029fd, 'call', '0x103068b6'),
        (0x10402215, 'mov', 'esi, dword ptr [esp + 0x2c]'),
        (0x1040221c, 'add', 'esi, -4'),
        (0x10402231, 'movzx', 'ecx, byte ptr [ecx + 0x104023f0]'),
        (0x10402238, 'jmp', 'dword ptr [ecx*4 + 0x104023cc]'),
        (0x1040232e, 'add', 'esi, 4'),
        (0x1040233c, 'mov', 'dl, byte ptr [esi]'),
        (0x1040233e, 'mov', 'byte ptr [eax], dl'),
        (0x1040235a, 'add', 'esi, 4'),
        (0x10402364, 'mov', 'edx, dword ptr [esi]'),
        (0x104023a1, 'mov', 'dword ptr [eax], edx'),
        # SysStringLoad stores its string array at base+0x6a8dc, stride12.
        (0x10455553, 'lea', 'eax, [edi + edi*2]'),
        (0x10455559, 'lea', 'edx, [ecx + eax*4 + 0x6a8dc]'),
    ]
    window_checks = [
        # UIDATA_HENNA reads the exact shared HennaData table by symbol ID.
        (0x10121f51, 'mov', 'ecx, dword ptr [ecx + 0x6a8d0]'),
        (0x10121f57, 'call', '0x10187a60'),
        (0x10121f74, 'add', 'esi, 8'),
        (0x101220d1, 'mov', 'ecx, dword ptr [ecx + 0x6a8d0]'),
        (0x101220d7, 'call', '0x10187a60'),
        (0x101220f4, 'add', 'esi, 0x20'),
        (0x10122251, 'mov', 'ecx, dword ptr [ecx + 0x6a8d0]'),
        (0x10122257, 'call', '0x10187a60'),
        (0x10122274, 'add', 'esi, 0x14'),
        # Info tattoo strings: icon, name, additional text, respectively.
        (0x10158fbd, 'lea', 'ecx, [esi + 0x14]'),
        (0x10158fd4, 'push', '0x10283a38'),
        (0x1015900f, 'lea', 'ecx, [esi + 8]'),
        (0x10159026, 'push', '0x10283a2c'),
        (0x10159061, 'lea', 'ecx, [esi + 0x2c]'),
        (0x10159078, 'push', '0x10283a1c'),
        # Remove-list description uses additional text, unlike inventory.
        (0x101596c5, 'lea', 'ecx, [esi + 0x2c]'),
        (0x10159794, 'push', '0x10283948'),
        # The HennaAPI cache is reset before EV_UpdateHennaInfo, then appended.
        (0x10159398, 'call', '0x101b1d30'),
        (0x101593bd, 'push', '0x104'),
        (0x10159480, 'call', '0x101b1e00'),
        (0x101594f2, 'push', '0xa46'),
        (0x101b1c42, 'mov', 'eax, dword ptr [ecx + 0x38]'),
        (0x101b1cc7, 'jl', '0x101b1ce8'),
        (0x101b1ccc, 'jge', '0x101b1ce8'),
        (0x1011ce36, 'mov', 'ecx, dword ptr [eax]'),
        (0x1011ce3a, 'mov', 'eax, dword ptr [eax + 4]'),
        # GetClassStep is a class-ID dispatch, not a level threshold.
        (0x100fc459, 'call', '0x10146260'),
        (0x10146295, 'cmp', 'eax, 0x39'),
        (0x10146298, 'ja', '0x101462f3'),
        (0x1014629a, 'movzx', 'ecx, byte ptr [eax + 0x10146350]'),
        (0x101462a1, 'jmp', 'dword ptr [ecx*4 + 0x10146344]'),
        (0x101462a8, 'mov', 'eax, 1'),
        (0x101462c1, 'mov', 'eax, 2'),
        (0x101462da, 'mov', 'eax, 3'),
        (0x101462f3, 'add', 'eax, -0x58'),
        (0x101462f6, 'cmp', 'eax, 0x1e'),
        (0x101462f9, 'jbe', '0x101462da'),
        (0x101462fb, 'or', 'eax, 0xffffffff'),
        # Equip rows use dye item metadata; remove rows use symbol metadata.
        (0x10158ae7, 'mov', 'ebx, dword ptr [ebp + 0x142c]'),
        (0x10158af4, 'call', 'dword ptr [0x1022c60c]'),
        (0x10158b0c, 'lea', 'ecx, [esi + 0x50]'),
        (0x10158b25, 'lea', 'ecx, [esi + 0x54]'),
        (0x10158b3b, 'lea', 'ecx, [esi + 0x3c]'),
        (0x10159687, 'mov', 'ebx, dword ptr [ebp + 0x1428]'),
        (0x10159694, 'call', 'dword ptr [0x1022c608]'),
        (0x101596ac, 'lea', 'ecx, [esi + 8]'),
        (0x101596db, 'lea', 'ecx, [esi + 0x14]'),
        # The two no-argument script APIs call NConsole, which tail-dispatches
        # to UNetworkHandler. Its top stack word remains this return address.
        (0x10102722, 'mov', 'edx, dword ptr [eax + 0x298]'),
        (0x10102728, 'call', 'edx'),
        (0x101029a2, 'mov', 'edx, dword ptr [eax + 0x29c]'),
        (0x101029a8, 'call', 'edx'),
        (0x10143c70, 'mov', 'eax, dword ptr [ecx + 0x50]'),
        (0x10143c73, 'mov', 'ecx, dword ptr [eax + 0x60]'),
        (0x10143c78, 'mov', 'eax, dword ptr [edx + 0x3cc]'),
        (0x10143c7e, 'jmp', 'eax'),
        (0x10143c80, 'mov', 'eax, dword ptr [ecx + 0x50]'),
        (0x10143c83, 'mov', 'ecx, dword ptr [eax + 0x60]'),
        (0x10143c88, 'mov', 'eax, dword ptr [edx + 0x3d0]'),
        (0x10143c8e, 'jmp', 'eax'),
        # GetNumericColor counts non-comma UTF-16 units, then uses the same
        # four-color cycle as the number edit control.
        (0x101003a0, 'call', '0x10063020'),
        (0x10063052, 'mov', 'edi, 0xffdcdcdc'),
        (0x1006305e, 'call', 'dword ptr [0x1022c438]'),
        (0x10063075, 'cmp', 'word ptr [esi + ecx*2], 0x2c'),
        (0x10063087, 'sub', 'eax, edx'),
        (0x10063089, 'cmp', 'eax, 5'),
        (0x1006308c, 'jl', '0x100630c6'),
        (0x1006308e, 'add', 'eax, -2'),
        (0x10063091, 'and', 'eax, 0x80000003'),
        (0x100630a2, 'jmp', 'dword ptr [eax*4 + 0x1006310c]'),
        (0x100630a9, 'mov', 'edi, 0xffff80ff'),
        (0x100630b0, 'mov', 'edi, 0xffffff00'),
        (0x100630b7, 'mov', 'edi, 0xff00ff00'),
        (0x100630be, 'mov', 'edi, 0xff00ffff'),
        # ConvertNumToText differs from NoAdena only in the shared helper's
        # suffix flag. Both cache and ordinary paths append after reading.
        (0x101000fd, 'push', '0'),
        (0x1010010d, 'call', '0x100676e0'),
        (0x10100208, 'mov', 'ebx, 1'),
        (0x1010025d, 'push', 'ebx'),
        (0x1010026c, 'call', '0x100676e0'),
        (0x10067736, 'mov', 'word ptr [ebx], 0'),
        (0x1006773d, 'je', '0x10067772'),
        (0x1006774e, 'jl', '0x10067772'),
        (0x10067750, 'push', '0x10233714'),
        (0x10067756, 'call', 'dword ptr [0x1022c29c]'),
        (0x10067761, 'je', '0x10067772'),
        (0x10067763, 'cmp', 'esi, 0xc'),
        (0x10067766, 'jle', '0x10067798'),
        (0x1006776a, 'call', '0x10062ee0'),
        (0x10067808, 'lea', 'ecx, [esi + 0x1036d160]'),
        (0x10067816, 'call', 'dword ptr [0x1022c474]'),
        (0x1006781d, 'call', 'dword ptr [0x1022c438]'),
        (0x10067828, 'jle', '0x10067772'),
        (0x1006782e, 'cmp', 'dword ptr [ebp + 0x114], 0'),
        (0x10067835, 'jne', '0x10067772'),
        (0x1006783b, 'push', '0x1023d5d0'),
        (0x10067841, 'mov', 'esi, dword ptr [0x1022c4b8]'),
        (0x10067847, 'call', 'esi'),
        (0x10067852, 'add', 'ecx, 0x6bed8'),
        (0x10067858, 'call', 'dword ptr [0x1022c3e4]'),
        (0x10067860, 'call', 'esi'),
        (0x10067c8f, 'lea', 'ecx, [ecx*4 + 0x1036d160]'),
        (0x10067c96, 'call', 'dword ptr [0x1022c3f4]'),
        (0x10067c9d, 'call', 'dword ptr [0x1022c438]'),
        (0x10067ca8, 'jle', '0x10067cd7'),
        (0x10067caa, 'cmp', 'dword ptr [ebp + 0x114], 0'),
        (0x10067cb1, 'jne', '0x10067cd7'),
        (0x10067cb3, 'push', '0x1023d5d0'),
        (0x10067cb9, 'call', 'esi'),
        (0x10067cc4, 'add', 'ecx, 0x6bed8'),
        (0x10067cca, 'call', 'dword ptr [0x1022c3e4]'),
        (0x10067cd2, 'call', 'esi'),
    ]
    for image, checks in [(engine, engine_checks), (window, window_checks)]:
        for args in checks:
            image.instruction(*args)
    assert engine.base == 0x10300000 and window.base == 0x10000000
    imports = PE(ROOT / 'assets/interlude/system/NWindow.dll').imports()
    for name, expected in {
        '?GetItemData@FL2GameData@@QAEPAVFL2ItemDataBase@@H@Z': ('Engine.dll', 0x1022c60c),
        '?GetHennaData@FL2GameData@@QAEPAUFL2HennaData@@H@Z': ('Engine.dll', 0x1022c608),
        '?appStrlen@@YAHPBG@Z': ('Core.dll', 0x1022c438),
        '?appStrcmp@@YAHPBG0@Z': ('Core.dll', 0x1022c29c),
        '?appStrcat@@YAPAGPAGPBG@Z': ('Core.dll', 0x1022c4b8),
        '?appStrcpy@@YAPAGPAGPBG@Z': ('Core.dll', 0x1022c474),
        '??DFString@@QBEPBGXZ': ('Core.dll', 0x1022c3e4),
        '??4FString@@QAEAAV0@PBG@Z': ('Core.dll', 0x1022c3f4),
    }.items():
        assert imports[name] == expected
    assert window.exported('?execGetNumericColor@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x10100310
    assert window.exported('?execConvertNumToText@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x10100050
    assert window.exported('?execConvertNumToTextNoAdena@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x101001b0
    assert window.wide(0x10233714) == '0' and window.wide(0x1023d5d0) == ' '
    assert (0x6bed8 - 0x6a8dc) // 12 == 469 and (0x6bed8 - 0x6a8dc) % 12 == 0
    assert [window.u32(0x1006310c + i * 4) for i in range(4)] == [
        0x100630a9, 0x100630b0, 0x100630b7, 0x100630be]
    assert engine.wide(0x1089aedc) == 'Hennagrp'
    assert thunk(engine, 0x10310cc1) == 0x10446db0
    assert thunk(engine, 0x103034e5) == 0x104026b0
    assert engine.data[engine.offset(0x104028ec) + ord('c') - 0x51] == 3
    assert engine.u32(0x104028c8 + 3 * 4) == 0x10402705
    for start in (0x104193d7, 0x10419ce7):
        for i in range(17):
            engine.instruction(start + i * 4, 'mov', f'dword ptr [esp + {hex(8 + i * 4)}], eax'
                               if i else 'dword ptr [esp + 8], eax')
    for address, expected in {
        0x10887168: 'dddddddcdcdcdcdcdc', 0x108871bc: 'ccccccdd',
        0x1087ff44: 'dd', 0x1087ff0c: 'ddd', 0x10883d84: 'ddddd',
        0x1087f8f8: 'cd',
    }.items():
        assert cstring(engine, address) == expected
    for address, expected in {0x10283a38: 'TattooIconName', 0x10283a2c: 'TattooName',
                              0x10283a1c: 'TattooAddName', 0x10283948: 'Description'}.items():
        assert cstring(window, address) == expected
    class_bytes = bytes(window.data[window.offset(0x10146350):window.offset(0x10146350) + 58])
    assert all(value in (0, 1, 2) for value in class_bytes)
    assert [window.u32(0x10146344 + i * 4) for i in range(3)] == [0x101462a8, 0x101462c1, 0x101462da]
    class_steps = {str(i): value + 1 for i, value in enumerate(class_bytes)}
    class_steps.update({str(i): 3 for i in range(88, 119)})

    # Bind actual server dispatch table -> named Engine receiver -> NWindow event.
    packet_bodies = {0xe2: 0x10419250, 0xe3: 0x104193d0, 0xe4: 0x10419530,
                     0xe5: 0x104198b0, 0xe6: 0x10419ce0}
    for opcode, expected in packet_bodies.items():
        marker = b'\xc7\x05' + struct.pack('<I', 0x10a57310 + opcode * 0x104)
        offset = engine.data.find(marker)
        assert offset >= 0 and engine.data.find(marker, offset + 1) < 0
        assert thunk(engine, struct.unpack_from('<I', engine.data, offset + 6)[0]) == expected
    receivers = [
        (0x57c, '?ReceiveHennaEquipList@UGameEngine@@UAEXHH@Z', 0x278, 0x101589c0, 0x10158a31, 1640),
        (0x580, '?AddHennaEquipInfo@UGameEngine@@UAEXUHennaInfo@@@Z', 0x27c, 0x10158aa0, 0x10158d46, 1650),
        (0x584, '?ReceiveHennaItemInfo@UGameEngine@@UAEXUHennaInfo@@H@Z', 0x280, 0x10158dd0, 0x101592df, 1660),
        (0x588, '?ReceiveHennaInfo@UGameEngine@@UAEXUHennaInfo@@H@Z', 0x284, 0x10159350, 0x101593bd, 260),
        (0x58c, '?AddHennaInfo@UGameEngine@@UAEXHH@Z', 0x288, 0x10159430, 0x101594f2, 2630),
        (0x590, '?ReceiveHennaUnequipList@UGameEngine@@UAEXHH@Z', 0x28c, 0x10159560, 0x101595d1, 1670),
        (0x594, '?AddHennaUnequipInfo@UGameEngine@@UAEXUHennaInfo@@@Z', 0x290, 0x10159640, 0x101598e6, 1680),
        (0x598, '?ReceiveHennaUnequipItemInfo@UGameEngine@@UAEXUHennaInfo@@H@Z', 0x294, 0x10159cd0, 0x1015a1df, 1690),
    ]
    table = engine.exported('??_7UGameEngine@@6BUObject@@@')
    for slot, name, window_slot, body, event_at, event in receivers:
        assert engine.u32(table + slot) == engine.exported(name)
        assert window.u32(0x10287da4 + window_slot) == body
        window.instruction(event_at, 'push', hex(event))
    requests = [
        ('RequestHennaItemList', 0x10408b80, 0x10408b88, 0xba),
        ('RequestHennaItemInfo', 0x10408a40, 0x10408a4a, 0xbb),
        ('RequestHennaEquip', 0x10408a90, 0x10408a9a, 0xbc),
        ('RequestHennaUnequipList', 0x10408bc0, 0x10408bc8, 0xbd),
        ('RequestHennaUnequipInfo', 0x10408ae0, 0x10408aea, 0xbe),
        ('RequestHennaUnequip', 0x10408b30, 0x10408b3a, 0xbf),
    ]
    for name, body, at, opcode in requests:
        symbol = f'?{name}@UNetworkHandler@@UAEX' + ('XZ' if name.endswith('List') else 'H@Z')
        assert engine.exported(symbol, True) == body
        engine.instruction(at, 'push', hex(opcode))
        engine.instruction(at + 5, 'push', '0x1087f8f8')
        # Ordinary ID requests explicitly push their argument; the two no-arg
        # list functions instead reach Send("cd", opcode) without a D push.
        if not name.endswith('List'):
            engine.instruction(body, 'mov', 'edx, dword ptr [esp + 4]')
            engine.instruction(at - 1, 'push', 'edx')
        else:
            instructions = list(engine.dis.disasm(engine.data[engine.offset(body):engine.offset(at + 11)], body))
            assert [i.op_str for i in instructions if i.mnemonic == 'push'] == [hex(opcode), '0x1087f8f8', 'eax']

    # Call -> two tail dispatches -> Send("cd", opcode). At list-method
    # entry ESP=S, the socket/format/opcode pushes put Send's first vararg at
    # S-4. Its serializer advances by one DWORD per c/d, so d reads [S]: the
    # original script call's return address, not a game value or default zero.
    assert window.u32(0x10287da4 + 0x298) == 0x10143c70
    assert window.u32(0x10287da4 + 0x29c) == 0x10143c80
    network = engine.exported('??_7UNetworkHandler@@6BUObject@@@')
    assert thunk(engine, engine.u32(network + 0x3cc)) == 0x10408b80
    assert thunk(engine, engine.u32(network + 0x3d0)) == 0x10408bc0
    assert thunk(engine, 0x1031178e) == 0x1043b8d0
    assert thunk(engine, engine.u32(0x1088b5ec + 0x68)) == 0x104029b0
    assert thunk(engine, engine.u32(0x1088bd9c + 0x68)) == 0x10403200
    assert thunk(engine, 0x103068b6) == 0x104021f0
    for char, body in [('c', 0x1040232b), ('d', 0x10402357)]:
        index = engine.data[engine.offset(0x104023f0) + ord(char) - 0x51]
        assert engine.u32(0x104023cc + 4 * index) == body
    # No native execution or image-load address is observed here. The PE has
    # relocations even though it does not opt into DYNAMIC_BASE.
    pe = struct.unpack_from('<I', window.data, 0x3c)[0]
    dll_characteristics = struct.unpack_from('<H', window.data, pe + 24 + 70)[0]
    assert dll_characteristics == 0
    relocation_rva, relocation_size = struct.unpack_from('<II', window.data, pe + 24 + 96 + 5 * 8)
    assert relocation_rva == 0x3bc000 and relocation_size == 302864

    scripts = {}
    for filename, expected in PACKAGE_SHA.items():
        path = ROOT / 'assets/interlude/system' / filename
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected
        package, _ = load_package(path)
        scripts.update(sources_from_package(package))
    for name, expected in SCRIPT_SHA.items():
        assert hashlib.sha256(scripts[name].encode()).hexdigest() == expected
    inventory = re.sub(r'\s+', ' ', scripts['InventoryWnd'])
    for source in ['ClassStep = GetClassStep( PlayerInfo.nSubClass );',
                   'm_hHennaItemWindow.SetRow( ClassStep );',
                   'HennaInfoCount = ClassStep;', 'if( 0 == IsActive )',
                   'HennaItemInfo.bDisabled = true;', 'm_hHennaItemWindow.AddItem( HennaItemInfo );']:
        assert source in inventory
    return {
        'format': 'l2-henna-native-evidence-v1', 'status': 'verified-bounded',
        'engineSHA256': ENGINE_SHA, 'nwindowSHA256': NWINDOW_SHA,
        'packageSHA256': PACKAGE_SHA, 'scriptSHA256': SCRIPT_SHA,
        'instructionAnchors': len(engine_checks) + len(window_checks) + 34,
        'fields': {name: {'serializedIndex': index, 'nativeOffset': offset}
                   for index, (name, offset) in enumerate([
                       ('symbolId', 0), ('dyeId', 4), ('name', 8), ('icon', 0x14),
                       ('description', 0x20), ('tattooAddName', 0x2c)])},
        'classSteps': class_steps, 'unknownClassStep': -1,
        'classStepTableSHA256': hashlib.sha256(class_bytes).hexdigest(),
        'inventory': {'rowSource': 'GetClassStep(UserInfo.nSubClass)',
                      'validRowCounts': [1, 2, 3], 'otherRowCount': 0,
                      'inactivePredicate': 'IsActive == 0', 'preservePacketOrder': True,
                      'pixelTint': 'unverified'},
        'packetEvents': {'e2': [1640, 1650], 'e3': [1660], 'e4': [260, 2630],
                         'e5': [1670, 1680], 'e6': [1690]},
        'statBytes': {'inventoryDelta': 'signed-int8', 'detailAfter': 'unsigned-int8'},
        'listRows': {'equip': {'identity': 'dyeId', 'metadata': 'item'},
                     'unequip': {'identity': 'symbolId', 'metadata': 'henna',
                                 'description': 'tattooAddName'}},
        'numericColor': {'defaultARGB': 0xffdcdcdc,
                         'length': 'UTF-16 code units excluding commas',
                         'cycleStartLength': 5, 'index': '(length - 2) % 4',
                         'cycleARGB': [0xffff80ff, 0xffffff00, 0xff00ff00, 0xff00ffff]},
        'numericText': {'status': 'verified-english-wrapper',
                        'baseReading': 'ConvertNumToTextNoAdena',
                        'suffixSysStringId': 469, 'suffixSeparator': ' ',
                        'appendSuffixToNonemptyReading': True,
                        'maximumMagnitudeDigits': 12,
                        'longInput': 'literal-comma-grouping-without-suffix',
                        'emptyOrZeroText': '', 'preserveReadingWhitespace': True,
                        'cacheStoresUnsuffixedReading': True},
        'listRequestExtraDword': {
            'status': 'verified-caller-return-address',
            'byMode': {'equip': 0x1010272a, 'unequip': 0x101029aa},
            'preferredImageBase': window.base,
            'relativeOffsets': {'equip': 0x10272a, 'unequip': 0x1029aa},
            'scope': 'ordinary UIScript dispatch through the sending socket',
            'meaning': 'caller return address exposed by a missing vararg, not a semantic game field',
            'relocation': 'actual encoded word follows the loaded NWindow base; no native load address observed',
            'dynamicBase': bool(dll_characteristics & 0x40),
            'baseRelocationsPresent': relocation_size > 0,
        },
        'limits': ['No native disabled-icon tint or text/font parity claim.',
                   'BA/BD words are specific to this source build and caller at the preferred image base; not universal wire values.',
                   'No invented amount, price, eligibility or server-side stat arithmetic.'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='run original-source assertions')
    parser.add_argument('--output', type=str, help='optional private JSON receipt path')
    args = parser.parse_args()
    result = verify()
    if args.output:
        path = ROOT / args.output
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2) + '\n')
    print(f"PASS: henna fields, {len(result['classSteps'])} class steps, five incoming packets, six requests and UI consumers")
