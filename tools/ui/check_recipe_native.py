#!/usr/bin/env python3
"""Elbera Tools: original Interlude recipe data and ordinary self-crafting proof.

Requires locally supplied, pinned Engine.dll/NWindow.dll and script packages.
Disassembles decoded bytes in memory; no native execution or game connection.
The optional output is a private evidence receipt, not a runtime asset bundle.
"""
import argparse
import hashlib
import json
import re
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA

sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript'), str(ROOT / 'tools/audio')]
from l2lib import load_package
from extract_uscript import sources_from_package
from verify_falloff import PE

PACKAGE_SHA = {
    'Interface.u': '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd',
    'NWindow.u': '6f3171147d83e447f2427e249c2ad73428e2b385d1557b86c53effa1062ea791',
}
SCRIPT_SHA = {
    'RecipeBookWnd': '6ecddf19489d13c57372793d5567b59688feb2ff7decef68d9f15988d526e3d1',
    'RecipeManufactureWnd': 'a5125f67b7855b72d364d8eb11d8a529fae0081ace5201504918a6219c8002fe',
    'RecipeTreeWnd': 'b252fd23c50874fc148f6366d3a5c3777f48c2a167a4a47ae5ee0623cd669bc9',
    'RecipeAPI': 'f8ef31139bd0fdb3df99817d920c618a48810249f8e83e4023f263d4ebe40115',
    'UIDATA_RECIPE': 'f45b9566452a5e99fbc780191e37c167fd86330fdfe7c9169c118fae519cba6b',
}
FIELDS = [('name', 0x10, 'string'), ('index', 0x1c, 'dword'),
          ('recipeItemId', 0x20, 'dword'), ('level', 0x24, 'dword'),
          ('productId', 0x28, 'dword'), ('productCount', 0x2c, 'dword'),
          ('mpConsume', 0x30, 'dword'), ('successRate', 0x34, 'dword'),
          ('materialCount', 0x38, 'dword')]
CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'


def thunk(image, address):
    offset = image.offset(address)
    assert image.data[offset] == 0xe9
    return address + 5 + struct.unpack_from('<i', image.data, offset + 1)[0]


def cstring(image, address):
    at = image.offset(address)
    return bytes(image.data[at:image.data.index(0, at)]).decode('ascii')


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    c = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    imports = PE(ROOT / 'assets/interlude/system/NWindow.dll').imports()
    for name, slot in {
        '?GetRecipeDataByIndex@FL2GameData@@QAEPAUFL2RecipeData@@H@Z': 0x1022c694,
        '?GetRecipeDataBy2Condition@FL2GameData@@QAEPAUFL2RecipeData@@HH@Z': 0x1022c690,
        '?GetItemName@FL2GameData@@QAEPBGH@Z': 0x1022c71c,
        '?GetItemAdditionalName@FL2GameData@@QAEPBGH@Z': 0x1022c63c,
        '??DL2FName@@QBEPBGXZ': 0x1022c758,
    }.items():
        assert imports[name] == ('Engine.dll', slot)
    for name, slot in {'?PushBack@L2ParamStack@@QAEHPAX@Z': 0x1022c448,
                       '?Top@L2ParamStack@@QAEPAXXZ': 0x1022c28c}.items():
        assert imports[name] == ('Core.dll', slot)
    assert c.exported('?Top@L2ParamStack@@QAEPAXXZ', True) == 0x1015b5c0
    assert c.exported('?PushBack@L2ParamStack@@QAEHPAX@Z', True) == 0x1015b500
    for check in [(0x1015b5e8, 'mov', 'edx, dword ptr [ecx + 4]'),
                  (0x1015b5f2, 'mov', 'eax, dword ptr [eax + edx*4]'),
                  (0x1015b5f5, 'add', 'edx, 1'),
                  (0x1015b5f8, 'mov', 'dword ptr [ecx + 4], edx'),
                  (0x1015b528, 'mov', 'eax, dword ptr [ecx + 8]'),
                  (0x1015b535, 'mov', 'dword ptr [edx + eax*4], esi'),
                  (0x1015b538, 'add', 'dword ptr [ecx + 8], 1')]:
        c.instruction(*check)
    engine_checks = [
        (0x1047cee1, 'push', '0x1089adbc'),
        (0x1047cfe7, 'call', '0x1030eb6f'),
        (0x1047cff0, 'lea', 'edx, [esi + 0x1c]'),
        (0x1047cff7, 'mov', 'ecx, dword ptr [eax + 0x6a8cc]'),
        (0x1047cffd, 'call', '0x1030f704'),
        (0x1047d002, 'lea', 'ecx, [esi + 0x28]'),
        (0x1047d00f, 'call', '0x1030c04a'),
        (0x1047d014, 'mov', 'dword ptr [esi], eax'),
        # The binary serializer uses the same fields named by the text loader.
        (0x1045f0b8, 'lea', 'eax, [esi + 0x10]'),
        (0x1045f0c6, 'lea', 'ecx, [esi + 0x1c]'),
        (0x1045f0d0, 'lea', 'edx, [esi + 0x20]'),
        (0x1045f0da, 'lea', 'eax, [esi + 0x24]'),
        (0x1045f0e4, 'lea', 'ecx, [esi + 0x28]'),
        (0x1045f0ee, 'lea', 'edx, [esi + 0x2c]'),
        (0x1045f0f8, 'lea', 'eax, [esi + 0x30]'),
        (0x1045f102, 'lea', 'ecx, [esi + 0x34]'),
        (0x1045f10f, 'lea', 'eax, [esi + 0x38]'),
        (0x1045f12b, 'cmp', 'ebx, dword ptr [esi + 0x38]'),
        (0x1045f140, 'call', '0x10306c4e'),
        (0x10446d2a, 'push', 'esi'),
        (0x10446d2f, 'call', '0x1030599d'),
        (0x10446d34, 'add', 'esi, 4'),
        (0x10446d39, 'call', '0x1030599d'),
        (0x1047d217, 'lea', 'ecx, [edi + 0x10]'),
        (0x1047d231, 'mov', 'dword ptr [edi + 0x1c], eax'),
        (0x1047d25e, 'mov', 'dword ptr [edi + 0x28], esi'),
        (0x1047d272, 'mov', 'dword ptr [edi + 0x20], eax'),
        (0x1047d286, 'mov', 'dword ptr [edi + 0x24], eax'),
        (0x1047d29a, 'mov', 'dword ptr [edi + 0x38], eax'),
        (0x1047d428, 'mov', 'dword ptr [esi + 0x2c], eax'),
        (0x1047d43c, 'mov', 'dword ptr [esi + 0x30], eax'),
        (0x1047d442, 'mov', 'dword ptr [esi + 0x34], edx'),
        # Lookup is a linear native-entry scan, not nearest-rate selection.
        (0x10478b38, 'mov', 'eax, dword ptr [ecx + 0x6a8cc]'),
        (0x10478b6e, 'cmp', 'dword ptr [eax + 0x1c], ebx'),
        (0x10478d78, 'mov', 'eax, dword ptr [ecx + 0x6a8cc]'),
        (0x10478d7f, 'xor', 'ecx, ecx'),
        (0x10478db3, 'mov', 'eax, dword ptr [esi + eax*4 + 8]'),
        (0x10478dbb, 'cmp', 'dword ptr [eax + 0x28], ebp'),
        (0x10478dc0, 'cmp', 'dword ptr [eax + 0x34], ebx'),
        (0x10478dc3, 'je', '0x10478dee'),
        (0x10478dc5, 'add', 'ecx, 1'),
        (0x10478dce, 'jl', '0x10478db0'),
        # D6: header, ordered two-DWORD rows; only first row DWORD dispatched.
        (0x10418890, 'push', '0x1087ff0c'),
        (0x104188b0, 'mov', 'eax, dword ptr [eax + 0x554]'),
        (0x104188d3, 'push', '0x1087ff44'),
        (0x104188ea, 'mov', 'edx, dword ptr [edx + 0x558]'),
        (0x104188f2, 'mov', 'eax, dword ptr [esp + 0x28]'),
        (0x104188f9, 'push', 'eax'),
        # D7: five DWORDs are restacked as ID, MP, maxMP, result, type.
        (0x104189b1, 'push', '0x10883d84'),
        (0x104189bd, 'mov', 'edx, dword ptr [esp + 0x24]'),
        (0x104189d1, 'mov', 'eax, dword ptr [esp + 8]'),
        (0x104189dc, 'mov', 'ecx, dword ptr [esp + 0xc]'),
        (0x104189e7, 'mov', 'edx, dword ptr [esp + 0x10]'),
        (0x104189f2, 'mov', 'eax, dword ptr [esp + 0x14]'),
        (0x10418a08, 'mov', 'edx, dword ptr [edx + 0x55c]'),
        (0x10489b55, 'mov', 'eax, dword ptr [eax + 0x234]'),
        (0x10489b5b, 'jmp', 'eax'),
        (0x10489b65, 'mov', 'eax, dword ptr [eax + 0x238]'),
        (0x10489b6b, 'jmp', 'eax'),
        (0x10489b75, 'mov', 'eax, dword ptr [eax + 0x23c]'),
        (0x10489b7b, 'jmp', 'eax'),
        # Both register and full-list recipe branches address GL2Console.
        (0x104144de, 'mov', 'ecx, dword ptr [0x10c5103c]'),
        (0x104144e6, 'mov', 'edx, dword ptr [edx + 0x2d4]'),
        (0x104144f1, 'call', 'edx'),
        (0x1041484f, 'mov', 'ecx, dword ptr [0x10c5103c]'),
        (0x1041485b, 'mov', 'eax, dword ptr [eax + 0x2d4]'),
        (0x10414861, 'call', 'eax'),
    ]
    window_checks = [
        (0x10128446, 'mov', 'ecx, dword ptr [eax + 0x1c]'),
        (0x10128536, 'mov', 'ecx, dword ptr [eax + 0x20]'),
        (0x10128746, 'mov', 'ecx, dword ptr [eax + 0x34]'),
        (0x10128056, 'mov', 'ecx, dword ptr [eax + 0x2c]'),
        # Recipe[0] is the loader's product ItemData, not the recipe item.
        (0x10128869, 'mov', 'ecx, dword ptr [esi]'),
        (0x1012886b, 'add', 'ecx, 0x50'),
        (0x1012886e, 'call', 'dword ptr [0x1022c758]'),
        (0x101289b9, 'mov', 'ecx, dword ptr [esi]'),
        (0x101289bb, 'add', 'ecx, 0x3c'),
        (0x101289be, 'call', 'dword ptr [0x1022c758]'),
        (0x10128149, 'mov', 'eax, dword ptr [eax]'),
        (0x1012814b, 'mov', 'ecx, dword ptr [eax + 4]'),
        (0x10128152, 'mov', 'edx, dword ptr [eax + 0x134]'),
        (0x1012815a, 'cmp', 'ecx, 1'),
        (0x1012815f, 'mov', 'edx, dword ptr [eax + 0x5e8]'),
        (0x10128167, 'cmp', 'ecx, 2'),
        (0x1012816c, 'mov', 'edx, dword ptr [eax + 0x104]'),
        # Materials are serialized order, with an explicit native child rate.
        (0x10128c12, 'call', 'dword ptr [0x1022c694]'),
        (0x10128c2a, 'mov', 'eax, dword ptr [ebx + 8]'),
        (0x10128c48, 'mov', 'edx, dword ptr [esi]'),
        (0x10128c57, 'mov', 'eax, dword ptr [esi + 4]'),
        (0x10128d77, 'call', 'dword ptr [0x1022c690]'),
        (0x10128d86, 'cmp', 'dword ptr [edi], ebx'),
        (0x10128d96, 'mov', 'eax, dword ptr [edi + 8]'),
        (0x10128dbb, 'mov', 'eax, dword ptr [edi]'),
        (0x10128dc6, 'push', '0x64'),
        (0x10128dce, 'call', 'esi'),
        (0x10128dd0, 'mov', 'ecx, dword ptr [edi + 4]'),
        (0x10128dda, 'call', 'esi'),
        (0x1015782f, 'push', '0x334'),
        (0x10157911, 'push', '0x33e'),
        (0x101579d6, 'mov', 'edi, dword ptr [0x1022c28c]'),
        (0x10157ab7, 'push', '0x348'),
        # Full item name and grade-token wrappers used by the recipe script.
        (0x100ffc8d, 'call', '0x10146560'),
        (0x1014656d, 'call', 'dword ptr [0x1022c71c]'),
        (0x1014657c, 'call', 'dword ptr [0x1022c63c]'),
        (0x10146588, 'test', 'edi, edi'),
        (0x1014658a, 'je', '0x101465b9'),
        (0x1014658c, 'push', '0x1027f48c'),
        (0x1014659d, 'je', '0x101465b9'),
        (0x101465a5, 'push', '0x1027f480'),
        (0x101465be, 'push', '0x1022dde0'),
        (0x100ffdaf, 'call', '0x10146390'),
        (0x101463c5, 'cmp', 'eax, 1'),
        (0x101463c8, 'jl', '0x101463e5'),
        (0x101463ca, 'mov', 'eax, dword ptr [eax*4 + 0x10350f70]'),
        (0x101463e5, 'xor', 'eax, eax'),
        # Named InsertNode / IsExpandedNode paths establish fresh defaults.
        (0x10111cb4, 'call', '0x1006d2d0'),
        (0x1006d331, 'call', '0x1006c760'),
        (0x1006c885, 'call', '0x1006c230'),
        (0x1006c8e8, 'call', '0x1006c230'),
        (0x1006c260, 'xor', 'edi, edi'),
        (0x1006c2cb, 'mov', 'dword ptr [esi + 0x1c], edi'),
        (0x1006c910, 'mov', 'dword ptr [esi + 0x1c], 1'),
        (0x1006c936, 'cmp', 'dword ptr [edi + 0x2e4], 0'),
        (0x1006c952, 'mov', 'dword ptr [esi + 0x1c], 1'),
        (0x10111578, 'call', '0x1006b8f0'),
        (0x1006b943, 'mov', 'eax, dword ptr [eax + 0x1c]'),
        # Parent origins are distinct from the cursor after the button.
        (0x1006cb40, 'add', 'ebx, dword ptr [esi + 0x2c]'),
        (0x1006cb49, 'add', 'eax, dword ptr [esi + 0x30]'),
        (0x1006ccb3, 'cmp', 'dword ptr [esi + 0x18], 0'),
        (0x1006ccbd, 'cmp', 'dword ptr [esi + 0x1c], 0'),
        (0x1006cd28, 'mov', 'ecx, dword ptr [esi + 0x94]'),
        (0x1006cd2e, 'mov', 'edx, dword ptr [esi + 0x9c]'),
        (0x1006cd34, 'lea', 'eax, [ecx + edx]'),
        (0x1006cd37, 'add', 'ebx, eax'),
        (0x1006cd3f, 'mov', 'eax, dword ptr [esi + 0x98]'),
        (0x1006cd45, 'mov', 'ecx, dword ptr [esi + 0xa0]'),
        (0x1006cd4b, 'add', 'eax, ecx'),
        (0x1006ceec, 'add', 'ebx, dword ptr [ebp + 0x10]'),
        (0x1006cf12, 'mov', 'dword ptr [ebp - 0x18], edx'),
        (0x1006cf15, 'mov', 'edi, dword ptr [edi + 0x14]'),
        (0x1006cf18, 'add', 'dword ptr [ebp - 0x1c], edi'),
        (0x1006cf1b, 'mov', 'ebx, dword ptr [ebp + 0x10]'),
        (0x1006cf21, 'add', 'dword ptr [ebp - 0x14], edi'),
        (0x1006d16d, 'cmp', 'dword ptr [esi + 0x1c], 0'),
        (0x1006d188, 'mov', 'ecx, dword ptr [ebp + 0x14]'),
        (0x1006d18b, 'add', 'ecx, ebx'),
        (0x1006d18e, 'mov', 'ecx, dword ptr [ebp + 0x10]'),
        (0x1006d1a3, 'add', 'ebx, eax'),
        (0x1006d1c4, 'mov', 'esi, dword ptr [esi + 0x30]'),
        (0x1006d1c7, 'add', 'esi, dword ptr [ebp - 0x1c]'),
        # Window-specific title: four strings, then DWORD index 7 -> +e4.
        (0x100f3c5d, 'lea', 'eax, [edi + 0x88]'),
        (0x100f3c6d, 'lea', 'ecx, [edi + 0x94]'),
        (0x100f3c77, 'lea', 'edx, [edi + 0xa0]'),
        (0x100f3c81, 'lea', 'eax, [edi + 0xac]'),
        (0x100f3ce9, 'lea', 'edx, [edi + 0xe4]'),
        (0x100f3cf1, 'call', '0x100052e0'),
        (0x100f4357, 'push', '0x1026b82c'),
        (0x100f436b, 'add', 'eax, 0x9c'),
        (0x100f10b5, 'mov', 'dword ptr [ecx + 0xe4], eax'),
        (0x100f2292, 'mov', 'eax, dword ptr [ecx + 0xe4]'),
        (0x100f2298, 'cmp', 'eax, 0xffffd8f1'),
        (0x100f3a26, 'mov', 'edx, dword ptr [eax + 0xe0]'),
        (0x100f3a2e, 'cmp', 'eax, 0xffffd8f1'),
        (0x100f3a3a, 'push', 'eax'),
        (0x100f3a3b, 'mov', 'eax, dword ptr [edx + 0x164]'),
        # Named RecipeItem drag has its own registration and use branches.
        (0x100484e8, 'push', '0x1023fd00'),
        (0x100484fd, 'jne', '0x10048682'),
        (0x10048506, 'cmp', 'dword ptr [ecx + 0x1e58], eax'),
        (0x10048521, 'push', '5'),
        (0x10048530, 'call', '0x100473a0'),
        (0x1004853e, 'mov', 'eax, dword ptr [edx + 0x1e58]'),
        (0x1004854a, 'push', '1'),
        (0x10048670, 'call', '0x1015a3b0'),
        (0x1017138c, 'mov', 'eax, dword ptr [esi + 0x1e54]'),
        (0x10171625, 'cmp', 'eax, 5'),
        (0x1017162a, 'mov', 'eax, dword ptr [esi + 0x1e58]'),
        (0x10171633, 'call', '0x10143bb0'),
        (0x10143bb8, 'mov', 'edx, dword ptr [edx + 0x394]'),
        # The received recipe shortcut names the recipe item, but shows its
        # product icon. Neither field uses the recipe DAT's internal alias.
        (0x1016f5a4, 'mov', 'edi, dword ptr [0x1022c28c]'),
        (0x1016f5ac, 'mov', 'dword ptr [ebp + 0x1c20], eax'),
        (0x1016f5bc, 'mov', 'eax, dword ptr [ebp + 0x1c20]'),
        (0x1016f5c2, 'add', 'eax, ebx'),
        (0x1016f5c4, 'cmp', 'eax, 4'),
        (0x1016f5cd, 'jmp', 'dword ptr [eax*4 + 0x1016fb90]'),
        (0x1016fa46, 'call', 'edi'),
        (0x1016fa48, 'mov', 'dword ptr [ebp + 0x1c24], eax'),
        (0x1016fa50, 'call', 'edi'),
        (0x1016fa52, 'mov', 'ebx, eax'),
        (0x1016fa57, 'mov', 'edx, dword ptr [ebp + 0x1c24]'),
        (0x1016fa64, 'call', 'dword ptr [0x1022c694]'),
        (0x1016fa70, 'mov', 'eax, dword ptr [esi + 0x20]'),
        (0x1016fa77, 'call', '0x101647b0'),
        (0x1016fa8c, 'mov', 'edx, dword ptr [esi + 0x28]'),
        (0x1016fa93, 'call', '0x101646f0'),
        (0x10164801, 'lea', 'ecx, [eax + 0x50]'),
        (0x10164804, 'call', 'dword ptr [0x1022c758]'),
        (0x10164741, 'lea', 'ecx, [eax + 0x3c]'),
        (0x10164744, 'call', 'dword ptr [0x1022c758]'),
    ]
    for image, checks in ((e, engine_checks), (w, window_checks)):
        for check in checks:
            image.instruction(*check)
    assert e.exported('?RecipeDataLoad@FL2GameData@@IAEHH@Z', True) == 0x1047cea0
    assert e.wide(0x1089adbc) == 'Recipe-c.dat'
    assert thunk(e, 0x1030eb6f) == 0x1045f090
    assert thunk(e, 0x10306c4e) == 0x10446d00
    assert w.exported('?execMakeFullItemName@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x100ffbe0
    assert w.exported('?execGetItemGradeString@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x100ffd20
    assert w.exported('?execInsertNode@UUIAPI_TREECTRL@@QAEXAAUFFrame@@QAX@Z') == 0x10111b90
    assert w.exported('?execIsExpandedNode@UUIAPI_TREECTRL@@QAEXAAUFFrame@@QAX@Z') == 0x101114a0
    assert w.wide(0x1023fd00) == 'RecipeItem'
    assert w.wide(0x1026b82c) == 'title'
    assert w.wide(0x1026aaa0) == 'XMLWindowData::GetTitle'
    assert w.u32(0x1026b00c + 0x9c) == 0x100f1080
    assert w.u32(0x1026b00c + 0xe0) == 0x100f2260
    network = e.exported('??_7UNetworkHandler@@6BUObject@@@')
    assert e.u32(network + 0x394) == e.exported('?RequestRecipeItemMakeInfo@UNetworkHandler@@UAEXH@Z')
    assert e.exported('?GL2Console@@3PAVUL2ConsoleWnd@@A') == 0x10c5103c
    assert w.u32(0x10287da4 + 0x2d4) == 0x1016f540
    assert [w.u32(0x1016fb90 + i * 4) for i in range(5)] == [
        0x1016f5d4, 0x1016f889, 0x1016f954, 0x1016f9cf, 0x1016fa44]
    w.instruction(0x1016f596, 'or', 'ebx, 0xffffffff')
    assert w.wide(0x10285a54) == 'NConsoleWnd::GetIconName'
    assert w.wide(0x10285a88) == 'NConsoleWnd::GetItemName'
    for address, value in [(0x1027f48c, 'NAME_None'), (0x1027f480, '%s-%s'), (0x1022dde0, '%s')]:
        assert w.wide(address) == value
    grade_tokens = {str(i): w.wide(w.u32(0x10350f70 + i * 4)) for i in range(1, 6)}
    assert grade_tokens == dict(zip(map(str, range(1, 6)), ['graded', 'gradec', 'gradeb', 'gradea', 'grades']))
    for at in (0x1045f0cb, 0x1045f0d5, 0x1045f0df, 0x1045f0e9,
               0x1045f0f3, 0x1045f0fd, 0x1045f107, 0x1045f114):
        e.instruction(at, 'call', '0x1030599d')
    for at, name in {0x10896000: 'name', 0x1089600c: 'id', 0x1089c6c8: 'recipe_id',
                     0x1089ac08: 'level', 0x1089c6e0: 'product_id',
                     0x1089c68c: 'product_num', 0x108994c8: 'mp_consume',
                     0x1089c6fc: 'success_rate', 0x1089c6b0: 'material'}.items():
        assert e.wide(at) == name
    for at, name in {0x102418a0: 'Type', 0x10283330: 'CurrentMP',
                     0x10283384: 'RecipeID', 0x10283404: 'MaxMP',
                     0x102833e8: 'MakingResult'}.items():
        assert w.wide(at) == name
    for at, fmt in {0x1087ff0c: 'ddd', 0x1087ff44: 'dd',
                    0x10883d84: 'ddddd', 0x1087f8f8: 'cd'}.items():
        assert cstring(e, at) == fmt
    for opcode, body in [(0xd6, 0x10418870), (0xd7, 0x10418960)]:
        marker = b'\xc7\x05' + struct.pack('<I', 0x10a57310 + opcode * 0x104)
        at = e.data.find(marker)
        assert at >= 0 and e.data.find(marker, at + 1) < 0
        assert thunk(e, struct.unpack_from('<I', e.data, at + 6)[0]) == body
    game = e.exported('??_7UGameEngine@@6BUObject@@@')
    for slot, name, window_slot, body in [
        (0x554, '?OnReceiveRecipeBookItemList@UGameEngine@@UAEXHH@Z', 0x234, 0x10157790),
        (0x558, '?AddRecipeBookItem@UGameEngine@@UAEXH@Z', 0x238, 0x101578a0),
        (0x55c, '?ReceiveRecipeItemMakeInfo@UGameEngine@@UAEXAAVL2ParamStack@@@Z', 0x23c, 0x10157980),
    ]:
        assert e.u32(game + slot) == e.exported(name)
        assert w.u32(0x10287da4 + window_slot) == body
    for name, body, at, opcode in [
        ('RequestRecipeBookOpen', 0x10408620, 0x10408636, 0xac),
        ('RequestRecipeItemDelete', 0x10408670, 0x1040867a, 0xad),
        ('RequestRecipeItemMakeInfo', 0x104086c0, 0x104086ca, 0xae),
        ('RequestRecipeItemMakeSelf', 0x10408710, 0x1040871a, 0xaf),
    ]:
        suffix = 'AAVL2ParamStack@@@Z' if name.endswith('BookOpen') else 'H@Z'
        assert e.exported(f'?{name}@UNetworkHandler@@UAEX{suffix}', True) == body
        e.instruction(at, 'push', hex(opcode))
        e.instruction(at + 5, 'push', '0x1087f8f8')
        if not name.endswith('BookOpen'):
            e.instruction(body, 'mov', 'edx, dword ptr [esp + 4]')
            e.instruction(at - 1, 'push', 'edx')
    scripts = {}
    for filename, expected in PACKAGE_SHA.items():
        path = ROOT / 'assets/interlude/system' / filename
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected
        package, _ = load_package(path)
        scripts.update(sources_from_package(package))
    for name, expected in SCRIPT_SHA.items():
        assert hashlib.sha256(scripts[name].encode()).hexdigest() == expected
    book = re.sub(r'\s+', ' ', scripts['RecipeBookWnd'])
    assert "infItem.ServerID = class'UIDATA_RECIPE'.static.GetRecipeIndex(RecipeID)" in book
    assert 'infItem.ItemSubType = int(EShortCutItemType.SCIT_RECIPE)' in book
    # Decode only explicit titles. This does not resolve inherited sentinels.
    sys.path.insert(0, str(ROOT / 'tools/xdat'))
    import parse_xdat as xdat
    from check_layout_native import XDAT_SHA
    xraw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    assert hashlib.sha256(xraw).hexdigest() == XDAT_SHA
    _, records = xdat.scan(xraw)
    reader, titles = xdat.Reader(xraw), {}
    for record in records:
        if record['name'] not in ('RecipeBookWnd', 'RecipeManufactureWnd', 'RecipeTreeWnd'):
            continue
        cursor = xdat.control_tail_start(reader, record)
        for _ in range(4):
            _, cursor = reader.string(cursor)
        assert cursor + 32 <= record['end']
        assert record['name'] not in titles
        titles[record['name']] = reader.i32(cursor + 28)
    assert titles == {'RecipeBookWnd': 663, 'RecipeManufactureWnd': 663, 'RecipeTreeWnd': 662}
    manufacture = re.sub(r'\s+', ' ', scripts['RecipeManufactureWnd'])
    for token in ['GetSystemMessage(960)', 'GetSystemMessage(959)',
                  'RequestRecipeItemMakeSelf(m_RecipeID)',
                  'RequestRecipeBookOpen(m_RecipeBookClass)',
                  'if (MakingResult == 0)', 'else if (MakingResult == 1)']:
        assert token in manufacture
    return {
        'format': 'l2-recipe-native-evidence-v1', 'status': 'verified-bounded',
        'engineSHA256': ENGINE_SHA, 'nwindowSHA256': NWINDOW_SHA, 'coreSHA256': CORE_SHA,
        'packageSHA256': PACKAGE_SHA, 'scriptSHA256': SCRIPT_SHA,
        'xdatSHA256': XDAT_SHA,
        'instructionChecks': len(engine_checks) + len(window_checks) + 8,
        'fields': {name: {'serializedIndex': i, 'nativeOffset': at, 'type': kind}
                   for i, (name, at, kind) in enumerate(FIELDS)},
        'lookup': {'byIndex': 'index', 'by2Condition': ['productId', 'successRate'],
                   'nativeOrder': 'increasing-native-table-entry',
                   'conflictingDuplicatePolicy': 'unresolved', 'missing': None},
        'materials': {'directTuple': ['itemId', 'count'],
                      'treeTuple': ['itemId', 'successRate', 'count'],
                      'treeSuccessRate': 100, 'preserveSerializedOrder': True},
        'packetEvents': {'d6': [820, 830], 'd7': [840], 'tree': 810},
        'bookRow': {'recipeIdentity': 'first-dword-source-index', 'secondDword': 'not-consumed-by-native-UI'},
        'requests': {'bookOpen': 0xac, 'delete': 0xad, 'makeInfo': 0xae, 'makeSelf': 0xaf},
        'bookTitle': {'1': 1214, 'other': 1215},
        'windowTitles': titles,
        'recipeShortcut': {'status': 'verified-ordinary-RecipeItem-path', 'type': 5,
                           'id': 'index', 'characterType': 1, 'use': 'makeInfo',
                           'name': 'recipeItemId', 'icon': 'productId',
                           'nativeControlIDOffset': 0x1e58},
        'resultMessages': {'0': 960, '1': 959, 'other': None},
        'windowFlow': {'bookArrivalHidesManufacture': False, 'detailArrivalHidesBook': True,
                       'manufactureClickClosesWindow': False},
        'tree': {'status': 'verified-fresh-node-flow',
                 'nameItem': 'productId', 'iconItem': 'productId',
                 'freshRootExpanded': True, 'freshChildExpanded': False,
                 'buttonContentAdvance': 'width+offsetX',
                 'lineBreakOrigin': 'node-origin-before-button',
                 'childOrigin': 'node-origin-x,node-origin-y+accumulated-height',
                 'blank': 'flush-line-then-add-height',
                 'savedExpansion': 'separate-unverified-policy'},
        'fullItemName': {'status': 'verified-returned-name-strings',
                         'additionalNameSentinel': 'NAME_None',
                         'presentAdditionalFormat': '%s-%s', 'absentAdditionalFormat': '%s',
                         'emptyDatAdditionalGetter': 'protected-helper-unresolved'},
        'gradeTokens': grade_tokens,
        'limits': ['Public recipe shops are outside this self-crafting checkpoint.',
                   'Native map allocation binding/source insertion order is not claimed; conflicting duplicate product/rate rows remain unresolved.',
                   'Saved tree expansion policy, exact item tint, font metrics and inherited chrome are not certified.',
                   'Client recipe values do not certify configured-server crafting rules or a live manufacture outcome.'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', help='optional private receipt path')
    args = parser.parse_args()
    result = verify()
    if args.output:
        path = ROOT / args.output
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2) + '\n')
    print('PASS: original recipe fields, material tuples, self-crafting packets and UI source')
