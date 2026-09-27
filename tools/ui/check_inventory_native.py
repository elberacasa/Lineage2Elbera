#!/usr/bin/env python3
"""Elbera Tools: original inventory warnings, quantity actions and accessories.

Read-only; requires the owner's pinned Engine.dll, NWindow.dll, Interface.u,
four item DATs, l2encdec and capstone. No native execution or game connection.
--check also compares current private itemmeta action fields with fresh DATs.
--output writes a private provenance receipt, never original source text.
"""
import argparse
import hashlib
import json
import re
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA

sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript'), str(ROOT / 'tools/dat')]
from l2lib import load_package
from extract_uscript import sources_from_package
import build_meta

sys.path.insert(0, str(ROOT / 'tools/audio'))
from verify_falloff import PE

INTERFACE_SHA = '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd'
NWINDOW_U_SHA = '6f3171147d83e447f2427e249c2ad73428e2b385d1557b86c53effa1062ea791'


def script_function(source, name):
    """Bounded function extraction for these pinned script checks, not a parser."""
    source = re.sub(r'//[^\r\n]*|/\*.*?\*/', '', source, flags=re.S)
    matches = list(re.finditer(r'\bfunction\b[^;{}]*?\b' + re.escape(name)
                              + r'\s*\([^)]*\)\s*\{', source))
    if len(matches) != 1:
        raise ValueError(f'missing or ambiguous function {name}')
    start, depth = matches[0].end(), 1
    for end in range(start, len(source)):
        depth += (source[end] == '{') - (source[end] == '}')
        if depth == 0:
            return re.sub(r'\s+', ' ', source[start:end]).strip()
    raise ValueError(f'truncated function {name}')


def field_argument_index(packet_format, field_index):
    """Native disassembler S has destination+capacity; other fields one arg."""
    if type(field_index) is not int or not 0 <= field_index < len(packet_format):
        raise ValueError('invalid field index')
    if any(char not in 'cdhQfS' for char in packet_format):
        raise ValueError('unsupported native packet format')
    return field_index + packet_format[:field_index].count('S')


def verify(check_items=False):
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    window = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    engine_checks = [
        # Original text-field names and binary field destinations agree.
        (0x1045fc92, 'push', '0x10897f18'),
        (0x1045fc9d, 'call', '0x10310ca8'),
        (0x1045fca2, 'mov', 'dword ptr [ebx + 0x64], eax'),
        (0x10462354, 'mov', 'eax, dword ptr [eax + 0x64]'),
        (0x1046235a, 'or', 'eax, 0xffffffff'),
        (0x1044c63f, 'lea', 'eax, [esi + 0x64]'),
        (0x1044c644, 'call', '0x1030599d'),
        (0x10468dd2, 'mov', 'dword ptr [edi + 4], 2'),
        (0x10468fd5, 'push', '0x10898f74'),
        (0x10468ff9, 'imul', 'ebx, ebx, 0x204'),
        (0x10468fff, 'lea', 'ecx, [ebx + 0x10a87d20]'),
        (0x1046901b, 'mov', 'eax, dword ptr [ebx + 0x10a87f20]'),
        (0x10469021, 'mov', 'dword ptr [edi + 0x100], eax'),
        (0x10468be7, 'call', '0x1030b695'),
        (0x1030b695, 'jmp', '0x1044e650'),
        (0x1044e70d, 'lea', 'ecx, [esi + 0xfc]'),
        (0x1044e715, 'call', '0x1030599d'),
        (0x1044e71a, 'lea', 'edx, [esi + 0x100]'),
        (0x1044e722, 'call', '0x1030599d'),
        (0x1044e727, 'add', 'esi, 0x104'),
        (0x1044e72f, 'call', '0x1030599d'),
        (0x1030599d, 'jmp', '0x10330040'),
        (0x10330049, 'push', '4'),
        # Actual UserInfo destinations, before its second template-ID bank.
        (0x1043467f, 'lea', 'ecx, [esi + 0x9c]'),
        (0x10434678, 'lea', 'eax, [esi + 0xa0]'),
        (0x1043466a, 'lea', 'ecx, [esi + 0xa8]'),
        (0x10434663, 'lea', 'eax, [esi + 0xac]'),
        # Native crystallizable and consume_type columns and binary destinations.
        (0x10468fc4, 'push', '0x10898f94'),
        (0x10468fce, 'mov', 'dword ptr [edi + 0xcc], eax'),
        (0x1044c75b, 'lea', 'edx, [esi + 0xcc]'),
        (0x1044c763, 'call', '0x1030599d'),
        (0x104690a0, 'push', '0x10898ef0'),
        (0x104690c0, 'cmp', 'dword ptr [ebp + 0x4c], 4'),
        (0x104690c9, 'imul', 'ebx, ebx, 0x204'),
        (0x104690cf, 'lea', 'eax, [ebx + 0x10a7d5d0]'),
        (0x104690eb, 'mov', 'edx, dword ptr [ebx + 0x10a7d7d0]'),
        (0x104690f1, 'mov', 'dword ptr [edi + 0xfc], edx'),
        # UserInfo's crystallize byte is an input, not a class/skill inference.
        (0x1043436a, 'lea', 'ebp, [esi + 0x2a8]'),
        (0x10434370, 'push', 'ebp'),
        # Interface sound call arguments; unresolved radius is preserved as a limit.
        (0x1049297f, 'fldz', ''),
        (0x10492981, 'fst', 'dword ptr [ebp - 0x24]'),
        (0x10492984, 'fst', 'dword ptr [ebp - 0x20]'),
        (0x10492987, 'fst', 'dword ptr [ebp - 0x1c]'),
        (0x1049299b, 'push', '0x10'),
        (0x104929a0, 'fld1', ''),
        (0x104929a2, 'fstp', 'dword ptr [esp + 4]'),
        (0x104929a6, 'mov', 'eax, dword ptr [0x11d8dc10]'),
        (0x104929ab, 'fld', 'dword ptr [eax]'),
        (0x104929ad, 'fstp', 'dword ptr [esp]'),
        (0x104929b2, 'mov', 'eax, dword ptr [edx + 0xa8]'),
        (0x104929b8, 'call', 'eax'),
        (0x104929bd, 'fstp', 'dword ptr [esp + 0xc]'),
        (0x104929d4, 'push', 'esi'),
        (0x104929d5, 'push', '0'),
        (0x104929d7, 'push', '0'),
        (0x104929dc, 'mov', 'edx, dword ptr [ebx + 0x80]'),
        (0x104929e2, 'call', 'edx'),
    ]
    window_checks = [
        (0x1002f708, 'call', '0x1002cd30'),
        (0x1002cd5b, 'xor', 'eax, eax'),
        (0x1002cea4, 'mov', 'dword ptr [ecx + 0x1ee0], eax'),
        (0x1002f73d, 'mov', 'ecx, dword ptr [edi + 4]'),
        (0x1002f740, 'mov', 'dword ptr [esp + 0x14], ecx'),
        (0x1002f869, 'mov', 'eax, dword ptr [esp + 0x14]'),
        (0x1002f86f, 'mov', 'ecx, dword ptr [edi + 0x64]'),
        (0x1002f872, 'mov', 'dword ptr [esi + 0x1ef4], ecx'),
        (0x1002f94f, 'mov', 'ecx, 1'),
        (0x1002f9c6, 'cmp', 'eax, 2'),
        (0x1002f9c9, 'jne', '0x1002fa3a'),
        (0x1002fa13, 'cmp', 'dword ptr [edi + 0x100], 2'),
        (0x1002fa1c, 'mov', 'edi, dword ptr [edi + 0x100]'),
        (0x1002fa22, 'cmp', 'edi, 0x10'),
        (0x1002fa2f, 'cmp', 'edi, 5'),
        (0x1002fa32, 'jne', '0x1002fa3a'),
        (0x1002fa34, 'mov', 'dword ptr [esi + 0x1ee0], ecx'),
        (0x10063f8b, 'push', '0x10245f0c'),
        (0x10063f9d, 'mov', 'ecx, dword ptr [esi + 0x1ee0]'),
        (0x1006407b, 'push', '0x10245e90'),
        (0x1006408d, 'mov', 'edx, dword ptr [esi + 0x1ef4]'),
        # Control item → script ItemInfo copied popup and packed recipe flag.
        (0x1002c871, 'mov', 'ecx, dword ptr [edi + 0x1ef4]'),
        (0x1002c877, 'mov', 'dword ptr [esi + 0x104], ecx'),
        (0x1002c900, 'mov', 'edx, dword ptr [edi + 0x1ee0]'),
        (0x1002c90c, 'add', 'edx, edx'),
        (0x1002c910, 'and', 'edx, 2'),
        # Accessory getter obtains the local User through named GetUser vslot.
        (0x100fc324, 'call', '0x1014dd00'),
        (0x1014dd40, 'mov', 'eax, dword ptr [eax + 0x3bc]'),
        (0x1014dd4a, 'mov', 'edx, dword ptr [eax + 0x60]'),
        (0x1014dd4e, 'call', '0x10145910'),
        (0x10145918, 'mov', 'edx, dword ptr [edx + 0x94]'),
        (0x100fc346, 'mov', 'ecx, dword ptr [eax + 0xa0]'),
        (0x100fc34f, 'mov', 'dword ptr [edx], ecx'),
        (0x100fc351, 'mov', 'ecx, dword ptr [eax + 0x9c]'),
        (0x100fc35a, 'mov', 'dword ptr [edx], ecx'),
        (0x100fc35c, 'mov', 'ecx, dword ptr [eax + 0xac]'),
        (0x100fc365, 'mov', 'dword ptr [edx], ecx'),
        (0x100fc367, 'mov', 'eax, dword ptr [eax + 0xa8]'),
        (0x100fc36d, 'mov', 'dword ptr [ebx], eax'),
        # All item groups start ConsumeType=0; only group 2 copies the DAT field.
        (0x1002ce8c, 'mov', 'dword ptr [ecx + 0x1e88], eax'),
        (0x1002f9fb, 'mov', 'edx, dword ptr [edi + 0xfc]'),
        (0x1002fa01, 'mov', 'dword ptr [esi + 0x1e88], edx'),
        (0x10063b94, 'push', '0x102460f4'),
        (0x10063ba6, 'mov', 'eax, dword ptr [esi + 0x1e88]'),
        (0x1002c8ba, 'mov', 'ecx, dword ptr [edi + 0x1e88]'),
        (0x1002c8c0, 'mov', 'dword ptr [esi + 0x120], ecx'),
        (0x100f6a82, 'cmp', 'eax, 1'),
        (0x100f6a85, 'je', '0x100f6a9c'),
        (0x100f6a87, 'cmp', 'eax, 2'),
        (0x100f6a8a, 'je', '0x100f6a9c'),
        (0x100f6a8c, 'cmp', 'eax, 3'),
        (0x100f6a8f, 'je', '0x100f6a9c'),
        (0x100f6a94, 'mov', 'dword ptr [eax], 0'),
        (0x100f6a9a, 'jmp', '0x100f6aa5'),
        (0x100f6a9f, 'mov', 'dword ptr [ecx], 1'),
        (0x10125fad, 'mov', 'dword ptr [esi], 0'),
        (0x10125fb9, 'call', '0x1014dd00'),
        (0x10125fc0, 'je', '0x10125fdc'),
        (0x10125fc8, 'call', '0x1014dd00'),
        (0x10125fcd, 'cmp', 'dword ptr [eax + 0x2a8], 0'),
        (0x10125fd4, 'je', '0x10125fdc'),
        (0x10125fd6, 'mov', 'dword ptr [esi], 1'),
        (0x101238c2, 'mov', 'dword ptr [esi], 0'),
        (0x101238c8, 'lea', 'eax, [ebp - 0x14]'),
        (0x101238cc, 'mov', 'ecx, dword ptr [0x1022c790]'),
        (0x101238d2, 'mov', 'ecx, dword ptr [ecx + 0x1834]'),
        (0x101238d8, 'call', '0x10187a60'),
        (0x101238df, 'je', '0x101238e9'),
        (0x101238e1, 'mov', 'edx, dword ptr [eax + 0xcc]'),
        (0x101238e7, 'mov', 'dword ptr [esi], edx'),
        # Per-drag AllItemCount is separate from the template ConsumeType.
        (0x1002cdc2, 'mov', 'dword ptr [ecx + 0x1e90], eax'),
        (0x1002cdc8, 'mov', 'dword ptr [ecx + 0x1e94], eax'),
        (0x10063bf4, 'push', '0x102460d4'),
        (0x10063c06, 'mov', 'ecx, dword ptr [esi + 0x1e94]'),
        (0x10063c0d, 'mov', 'edx, dword ptr [esi + 0x1e90]'),
        (0x1002eb66, 'xor', 'ebx, ebx'),
        (0x1002eba7, 'mov', 'ebp, 1'),
        (0x1002ebe9, 'mov', 'dword ptr [edi + 0x1f0c], ebx'),
        (0x1002ec23, 'cmp', 'dword ptr [edi + 0x1e64], ebp'),
        (0x1002ec29, 'jle', '0x1002ecc9'),
        (0x1002ec2f, 'push', '0x12'),
        (0x1002ec31, 'call', 'dword ptr [0x1022cabc]'),
        (0x1002ec37, 'test', 'ax, ax'),
        (0x1002ec3a, 'jns', '0x1002ecc9'),
        (0x1002ec40, 'mov', 'ebp, dword ptr [edi + 0x1e90]'),
        (0x1002ec46, 'cmp', 'ebp, ebx'),
        (0x1002ec48, 'je', '0x1002ec52'),
        (0x1002ec4a, 'cmp', 'dword ptr [edi + 0x1e64], ebp'),
        (0x1002ec50, 'jge', '0x1002ec58'),
        (0x1002ec52, 'mov', 'ebp, dword ptr [edi + 0x1e64]'),
        (0x1002ec5b, 'mov', 'dword ptr [edi + 0x1f0c], ebp'),
        (0x1006419b, 'push', '0x10245e00'),
        (0x100641ad, 'mov', 'edx, dword ptr [esi + 0x1f0c]'),
        (0x1002c95a, 'mov', 'eax, dword ptr [edi + 0x1f0c]'),
        (0x1002c961, 'mov', 'dword ptr [esi + 0x128], eax'),
        (0x1010049f, 'mov', 'eax, dword ptr [ebp - 0x14]'),
        (0x101004a2, 'push', 'eax'),
        (0x101004a9, 'call', '0x1014ed50'),
        (0x1014ed50, 'mov', 'eax, dword ptr [esp + 4]'),
        (0x1014ed54, 'mov', 'edx, dword ptr [eax*4 + 0x10350fa0]'),
        (0x1014ed5f, 'jmp', '0x10147e60'),
        (0x10147eb4, 'mov', 'ecx, dword ptr [edi + 0x50]'),
        (0x10147eb9, 'push', 'esi'),
        (0x10147eba, 'mov', 'edx, dword ptr [eax + 0x63c]'),
        (0x10147ec0, 'call', 'edx'),
    ]
    for image, checks in [(engine, engine_checks), (window, window_checks)]:
        for address, mnemonic, operands in checks:
            image.instruction(address, mnemonic, operands)
    assert engine.wide(0x10897f18) == 'popup'
    assert engine.wide(0x10898f74) == 'etcitem_type'
    assert engine.wide(0x10898f94) == 'crystallizable'
    assert engine.wide(0x10898ef0) == 'consume_type'
    for index, suffix in enumerate(('normal', 'charge', 'stackable', 'asset')):
        assert engine.wide(0x10a7d5d0 + index * 0x204) == 'consume_type_' + suffix
        assert engine.u32(0x10a7d7d0 + index * 0x204) == index
    assert engine.wide(0x10a87d20 + 5 * 0x204) == 'recipe'
    assert engine.u32(0x10a87f20 + 5 * 0x204) == 5
    assert window.wide(0x10245f0c) == 'Recipe'
    assert window.wide(0x10245e90) == 'PopMsgNum'
    for address, name in [(0x102460f4, 'ConsumeType'), (0x102460d4, 'Count'),
                          (0x10245e00, 'AllItemCount')]:
        assert window.wide(address) == name
    assert PE(ROOT / 'assets/interlude/system/NWindow.dll').imports()['GetAsyncKeyState'][1] == 0x1022cabc
    for name, owner, address in [('IsStackableItem', 'UUIScript', 0x100f6a00),
                                  ('IsCrystallizable', 'UUIDATA_ITEM', 0x10123840),
                                  ('HasCrystallizeAbility', 'UUIDATA_PLAYER', 0x10125f50)]:
        assert window.exported(f'?exec{name}@{owner}@@QAEXAAUFFrame@@QAX@Z') == address
    assert engine.exported('?GetItemPopMsgNum@FL2GameData@@QAEHH@Z', True) == 0x10462340
    assert window.exported('?execGetAccessoryServerID@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x100fc170
    assert engine.u32(engine.exported('??_7UNetworkHandler@@6BUObject@@@') + 0x94) == engine.exported(
        '?GetUser@UNetworkHandler@@UAEPAUUser@@H@Z')
    assert window.exported('?execPlayConsoleSound@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x10100420
    assert window.wide(window.u32(0x10350fa0 + 4 * 4)) == 'itemsound.trash_basket'
    assert engine.u32(engine.exported('??_7UGameEngine@@6BUObject@@@') + 0x63c) == engine.exported(
        '?OnInterfacePlaySound@UGameEngine@@UAEXPBG@Z')
    assert engine.exported('?OnInterfacePlaySound@UGameEngine@@UAEXPBG@Z', True) == 0x104928f0
    for slot, name in [(0xa8, '?GetSoundVolume@UDummyAudio@@UAEMXZ'),
                       (0x80, '?PlaySoundW@UDummyAudio@@UAEHPAVAActor@@HPAVUSound@@VFVector@@MMMHMM@Z')]:
        assert engine.u32(engine.exported('??_7UDummyAudio@@6BUObject@@@') + slot) == engine.exported(name)

    start = engine.offset(0x1088ae38)
    packet_format = engine.data[start:engine.data.index(0, start)].decode('ascii')
    instructions = list(engine.dis.disasm(engine.data[0x134357:0x13473e], 0x10434357))
    pushes = [i for i in instructions if i.mnemonic == 'push']
    assert len(pushes) == 138
    arguments = list(reversed(pushes[:-3]))
    slots = {'rear': (26, 1, 0x10434685), 'lear': (27, 2, 0x1043467e),
             'rfinger': (29, 4, 0x10434670), 'lfinger': (30, 5, 0x10434669)}
    for field, _, address in slots.values():
        assert packet_format[field] == 'd'
        assert arguments[field_argument_index(packet_format, field)].address == address
    assert packet_format[129] == 'c'
    assert arguments[field_argument_index(packet_format, 129)].address == 0x10434370

    path = ROOT / 'assets/interlude/system/Interface.u'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == INTERFACE_SHA
    package, _ = load_package(path)
    scripts = dict(sources_from_package(package))
    native_path = ROOT / 'assets/interlude/system/NWindow.u'
    assert hashlib.sha256(native_path.read_bytes()).hexdigest() == NWINDOW_U_SHA
    native_package, _ = load_package(native_path)
    native_scripts = dict(sources_from_package(native_package))
    sound_enum = re.search(r'enum\s+EInterfaceSoundType\s*\{([^}]*)\}',
                           native_scripts['UIEventManager']).group(1)
    sound_members = [value.strip() for value in sound_enum.split(',') if value.strip()]
    assert sound_members[4] == 'IFST_TRASH_BASKET'
    source = scripts['InventoryWnd']
    assert re.search(r'const\s+DIALOG_USE_RECIPE\s*=\s*1111\s*;', source)
    assert re.search(r'const\s+DIALOG_POPUP\s*=\s*2222\s*;', source)
    for name in ('OnDBClickItemWithHandle', 'OnRClickItemWithHandle'):
        assert 'UseItem( a_hItemWindow, index );' in script_function(source, name)
    use = script_function(source, 'UseItem')
    tokens = ['if( info.bRecipe )', 'DialogSetID(DIALOG_USE_RECIPE)', 'GetSystemMessage(798)',
              'else if( info.PopMsgNum > 0 )', 'DialogSetID(DIALOG_POPUP)',
              'GetSystemMessage(info.PopMsgNum)', 'RequestUseItem(info.ServerID)']
    assert all(token in use for token in tokens)
    assert [use.index(token) for token in tokens] == sorted(use.index(token) for token in tokens)
    accepted = script_function(source, 'HandleDialogOK')
    assert 'if( DialogIsMine() )' in accepted
    assert 'if( id == DIALOG_USE_RECIPE || id == DIALOG_POPUP )' in accepted
    assert 'RequestUseItem(reserved)' in accepted
    constants = {'DROPITEM': 3333, 'DROPITEM_ASKCOUNT': 4444, 'DROPITEM_ALL': 5555,
                 'DESTROYITEM': 6666, 'DESTROYITEM_ALL': 7777,
                 'DESTROYITEM_ASKCOUNT': 8888, 'CRYSTALLIZE': 9999}
    for name, value in constants.items():
        assert re.search(r'const\s+DIALOG_' + name + r'\s*=\s*' + str(value) + r'\s*;', source)
    # Full branch fragments bind count admission, dialog and reserved identity.
    dropped = re.sub(r'\s+', '', script_function(source, 'OnDropItem'))
    assert ('elseif(strTarget=="TrashButton"){if(IsStackableItem(info.ConsumeType)&&info.ItemNum>1){'
            'if(info.AllItemCount>0){DialogSetID(DIALOG_DESTROYITEM_ALL);'
            'DialogSetReservedInt(info.ServerID);DialogSetReservedInt2(info.AllItemCount);'
            'DialogShow(DIALOG_Warning,MakeFullSystemMsg(GetSystemMessage(74),info.Name,""));}'
            'else{DialogSetID(DIALOG_DESTROYITEM_ASKCOUNT);DialogSetReservedInt(info.ServerID);'
            'DialogSetParamInt(info.ItemNum);DialogShow(DIALOG_NumberPad,'
            'MakeFullSystemMsg(GetSystemMessage(73),info.Name));}}'
            'else{DialogSetID(DIALOG_DESTROYITEM);DialogSetReservedInt(info.ServerID);'
            'DialogShow(DIALOG_Warning,MakeFullSystemMsg(GetSystemMessage(74),info.Name));}}') in dropped
    assert ('elseif(strTarget=="CrystallizeButton"){if(info.DragSrcName=="InventoryItem"||'
            '(-1!=InStr(info.DragSrcName,"EquipItem"))){'
            "if(class'UIDATA_PLAYER'.static.HasCrystallizeAbility()&&"
            "class'UIDATA_ITEM'.static.IsCrystallizable(info.ClassID)){"
            'DialogSetID(DIALOG_CRYSTALLIZE);DialogSetReservedInt(info.ServerID);'
            'DialogShow(DIALOG_Warning,MakeFullSystemMsg(GetSystemMessage(336),info.Name));}}}') in dropped
    accepted_compact = re.sub(r'\s+', '', accepted)
    for name, request in [('DESTROYITEM', 'RequestDestroyItem(reserved,1);'),
                          ('DESTROYITEM_ASKCOUNT', 'RequestDestroyItem(reserved,number);'),
                          ('DESTROYITEM_ALL', 'RequestDestroyItem(reserved,reserved2);'),
                          ('CRYSTALLIZE', 'RequestCrystallizeItem(reserved,1);')]:
        assert f'elseif(id==DIALOG_{name}){{{request}PlayConsoleSound(IFST_TRASH_BASKET);}}' in accepted_compact
    assert 'number=int(DialogGetString());' in accepted_compact
    # Zero→one belongs only to dropping on the ground, not the destroy branch.
    assert ('elseif(id==DIALOG_DROPITEM_ASKCOUNT){if(number==0)number=1;'
            'RequestDropItem(reserved,number,m_clickLocation);}') in accepted_compact
    assert accepted_compact.count('if(number==0)') == 1
    common = scripts['UICommonAPI']
    assert script_function(common, 'DialogShow') == (
        'local DialogBox script; script = DialogBox(GetScript("DialogBox")); '
        'script.ShowDialog( dialogType, strMessage, string(Self) );')
    assert script_function(common, 'DialogIsMine') == (
        'local DialogBox script; script = DialogBox(GetScript("DialogBox")); '
        'if( script.GetTarget() == string(Self) ) return true; return false;')
    dialog = scripts['DialogBox']
    show = script_function(dialog, 'ShowDialog')
    assert 'if( m_bInUse ) { debug("Error!! DialogBox in Use"); return; }' in show
    assert 'm_strTargetScript = target; m_bInUse = true;' in show
    assert script_function(dialog, 'GetTarget') == 'return m_strTargetScript;'
    for name, left, right in [('IsLOrREar', 'LEar', 'REar'), ('IsLOrRFinger', 'LFinger', 'RFinger')]:
        body = script_function(source, name)
        assert 'GetAccessoryServerID( LEar, REar, LFinger, RFinger )' in body
        assert f'if( a_ServerID == {left} ) return -1; else if( a_ServerID == {right} ) return 1; else return 0;' in body

    tables, provenance = build_meta.original_item_tables()
    expected = build_meta.build_items(tables)
    if check_items:
        actual = build_meta.load('itemmeta.json')
        assert set(actual) == set(expected)
        for key, row in expected.items():
            for field in ('isRecipe', 'popMsgNum', 'consumeType', 'crystallizable'):
                assert (field in actual[key] and type(actual[key][field]) is type(row[field])
                        and actual[key][field] == row[field]), (key, field)
    return {'format': 'elbera-native-inventory-evidence-v1', 'source': {
        'engineSHA256': ENGINE_SHA, 'nwindowSHA256': NWINDOW_SHA,
        'interfaceSHA256': INTERFACE_SHA,
        'nwindowPackageSHA256': NWINDOW_U_SHA,
        'inventoryScriptSHA256': hashlib.sha256(source.encode('latin-1')).hexdigest(),
        'commonScriptSHA256': hashlib.sha256(common.encode('latin-1')).hexdigest(),
        'dialogScriptSHA256': hashlib.sha256(dialog.encode('latin-1')).hexdigest(),
        'instructionChecks': len(engine_checks) + len(window_checks), 'itemTables': provenance},
        'use': {'recipeGroup': 2, 'recipeSubtype': 5, 'recipeMessage': 798,
                'recipeDialog': 1111, 'popupDialog': 2222, 'popupPositiveOnly': True,
                'recipeBeforePopup': True, 'acknowledgmentUsesReservedServerID': True},
        'itemActions': {'stackableConsumeTypes': [1, 2, 3],
                        'weaponArmorConsumeType': 0,
                        'crystallizableRecordOffset': 0xcc,
                        'crystallizeAbilityUserOffset': 0x2a8,
                        'crystallizeAbilityUserInfoField': 129,
                        'dialogs': constants, 'destroyCountPassedUnchanged': True,
                        'crystallizeCount': 1,
                        'trashSound': {'enumIndex': 4, 'reference': 'itemsound.trash_basket',
                                       'timing': 'after request, before any server result',
                                       'actor': None, 'slot': 0, 'position': [0, 0, 0],
                                       'pitch': 1, 'flags': 16, 'volume': 'GetSoundVolume()',
                                       'radius': 'unresolved pointer 0x11d8dc10',
                                       'browserPlaybackParityProven': False},
                        'sharedDialogOwner': 'calling script identity',
                        'allItemCount': {'ordinaryDragValue': 0, 'modifierVirtualKey': 0x12,
                                         'countDefault': 0, 'requiresItemNumAbove': 1,
                                         'countZeroUsesItemNum': True,
                                         'nonzeroCountClampedToItemNum': True,
                                         'completeCountProducerLifecycleProven': False}},
        'accessoryObjectSlots': {name: slot for name, (_, slot, _) in slots.items()},
        'metadata': {'rows': len(expected),
                     'recipes': sum(row['isRecipe'] is True for row in expected.values()),
                     'positivePopup': sum(isinstance(row['popMsgNum'], int) and row['popMsgNum'] > 0
                                          for row in expected.values()),
                     'unknownRecipe': sum(row['isRecipe'] is None for row in expected.values()),
                     'unknownPopup': sum(row['popMsgNum'] is None for row in expected.values()),
                     'unknownConsumeType': sum(row['consumeType'] is None for row in expected.values()),
                     'unknownCrystallizable': sum(row['crystallizable'] is None for row in expected.values()),
                     'stackable': sum(row['consumeType'] in (1, 2, 3) for row in expected.values()),
                     'crystallizable': sum(row['crystallizable'] is not None and row['crystallizable'] != 0
                                            for row in expected.values()),
                     'currentOutputChecked': check_items},
        'limits': ['Bounded warning, quantity-action and paired-slot rules; no server outcome claim.',
                   'Existing DAT decoders reread originals; native anchors bind the relevant columns and consumers, not all item fields.',
                   'AllItemCount has a native Alt producer and zero default, but complete Count/drag lifecycle remains unported.',
                   'No proof of inventory packet/UI event ordering, full DialogBox layout, trash-feedback audio, or shortcut-use confirmation behavior.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=str)
    args = parser.parse_args()
    result = verify(args.check)
    if args.output:
        path = ROOT / args.output
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2) + '\n')
    print('inventory native: PASS (%d instructions, %d original item rows)' % (
        result['source']['instructionChecks'], result['metadata']['rows']))


if __name__ == '__main__':
    main()
