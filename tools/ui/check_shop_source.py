#!/usr/bin/env python3
"""Elbera Tools: read-only original ShopWnd source and layout verification.

python3 tools/ui/check_shop_source.py --check

Reads the owner's pinned Interface.u, Interface.xdat, NWindow.dll and two
language DATs. Pins the selected type-0 background's size and sampling path.
Uses fresh bounded TextBuffer extraction, not the cached .uc as an oracle.
--check additionally compares cached source and the selected exported language,
layout, backdrop crop and reset records. Default output is a source-free provenance JSON;
--check prints a compact result. No files are written or native DLLs executed.

This pins script branches and decoded data, not complete renderer/protocol
parity. Native INT64 overflow, preview/drag/weight, item tooltips, text painting
and button states remain outside this check. systemmsg uses the existing DAT
parser's bounded record-header search; this is not proof of every native tail.
Shared anchor/frame semantics are checked by check_layout_native.py.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript'),
               str(ROOT / 'tools/xdat'), str(ROOT / 'tools/dat')]

FILES = {
    'Interface.u': '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd',
    'Interface.xdat': 'a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4',
    'sysstring-e.dat': '33053b17ca8e1d157aec8fb40b4ef8542626338858ce6c7b4d799c7609554135',
    'systemmsg-e.dat': '74c8424d9e6007719a3bf7934bc8708d0405ba03684ccf89a1c9fd70d21f65ee',
}
SCRIPT_SHA = '7f2979305f4155b099c6630e1b261c77b575d1250c8eb02e5021e1485b9a8855'
# Hashes cover whole comment-free, whitespace-normalized function bodies.
# Branch snippets below identify the interpretation without bundling scripts.
FUNCTIONS = {
    'MoveItemTopToBottom': '131429532195cf1845863dcc12f31a2d47419d546e2a7f722e52bba39162bf29',
    'MoveItemBottomToTop': '91572bacf4d5063348a8284a2d04858c889287d8d3028397193e2271d1bbd667',
    'HandleDialogOK': 'd01c69e8a01eb194889042f08d78a53826a10e175ed981b0bcf190baf5cf9230',
    'HandleOKButton': 'd570adace497a1c346e2efe963ffdf20874b12427d5a61c59457e9935fdce3d3',
    'HandleOpenWindow': 'bbd20ac9249b53fe34f634f8086671c035e631e44a4e418ac512c60cf954a5c6',
    'AddPrice': '3eba167dbc9a843a3b22d8133b612c98867de838749a163ff4803bae309e931e',
    'Clear': '82aff694dea2e75534ae560d9e9e3f08ed48ff77d04f5f63debc5e36ab54f6f6',
}


def verify_backdrop(raw, records, check_exported=False):
    """Join the original Shop records to the surviving NCTexture type-0 path.

    This is a selected-control proof, not an interpreter for arbitrary windows
    or texture types. Hashes cover the complete identified arithmetic branches.
    """
    import parse_xdat as xdat
    from check_tutorial_quest_native import Image, NWINDOW_SHA

    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    assert w.base == 0x10000000
    reader = xdat.Reader(raw)
    shop, = [r for r in records if r['name'] == 'ShopWnd' and not r['parent']]
    back, = [r for r in records if r['name'] == 'BackTexture' and r['parent'] == 'ShopWnd']
    assert (shop['off'], shop['end'], back['off'], back['end']) == (380631, 380957, 380957, 381172)
    p = xdat.control_tail_start(reader, shop)
    strings = []
    for _ in range(4):
        value, p = reader.string(p)
        assert p <= shop['end']
        strings.append(value)
    assert strings == ['undefined', 'undefined', 'ShopWnd', 'GamingState']
    # XMLWindowData::Serialize: +b8..d0, +e4, +d4, +ec, +f0.
    assert p == 380794 and p + 44 <= shop['end']
    fields = struct.unpack_from('<11i', raw, p)
    assert fields == (1, -1, -1, 1, 0, -1, -1, 136, -1, 0, 3)
    assert (shop['width'], shop['height']) == (256, 401)
    assert back['relativeSize'] == dict(reference='', widthRate=1.0, heightRate=1.0,
                                        widthOffset=0, heightOffset=0)
    assert back['position'] == dict(selfAnchor=1, targetAnchor=1, target='', offsetX=0, offsetY=20)
    p = xdat.control_tail_start(reader, back)
    texture, p = reader.string(p)
    assert texture == 'L2UI_CH3.StoreWnd.Store1_back'
    assert p == 381128 and p + 32 <= back['end']
    texture_fields = struct.unpack_from('<4i2f2i', raw, p)
    assert texture_fields == (0, 2, 0, 0, 0.0, 0.0, -9999, -1)

    for address, name in ((0x10269118, 'XMLTextureCtrlData::Serialize'),
                          (0x1026b35c, 'XMLWindowData::Serialize'),
                          (0x10242db8, 'NCTextureCtrl::OnPaint'),
                          (0x102373e4, 'NCGDevice::DrawTexture')):
        assert w.wide(address) == name
    assert w.u32(0x1026b00c + 0xc0) == 0x100f1ad0  # XML GetFrame
    assert w.u32(0x1026b00c + 0xec) == 0x100f2720  # XML GetFrameDirection
    assert w.u32(0x1026b00c + 0x30) == 0x100eebc0  # XML AddWindowStyle
    assert w.u32(0x10236fd4 + 0x84) == 0x10002a30  # NCFrameWnd GetWindowStyle
    assert w.u32(0x10053b70) == 0x10053921  # NCTexture type 0 jump table
    title_height, = struct.unpack_from('<d', w.data, w.offset(0x10244a08))
    assert title_height == 20.0
    anchors = [
        (0x100f1b02, 'mov', 'eax, dword ptr [ecx + 0xb8]'),
        (0x100f2752, 'mov', 'eax, dword ptr [ecx + 0xf0]'),
        (0x100f3667, 'push', '0x80'),
        (0x100f366e, 'mov', 'edx, dword ptr [eax + 0x30]'),
        (0x100eebf5, 'or', 'dword ptr [ecx + 0x68], eax'),
        (0x100f369c, 'mov', 'edx, dword ptr [eax + 0xec]'),
        (0x100f36a8, 'call', '0x10057bb0'),
        (0x10057be5, 'mov', 'dword ptr [ecx + 0x58], eax'),
        (0x10057eb2, 'mov', 'eax, dword ptr [ecx + 0x58]'),
        (0x1005ee9a, 'call', '0x1005bf40'),
        (0x1005bfa3, 'call', '0x10058770'),
        (0x1005bfac, 'mov', 'eax, dword ptr [edx + 0x84]'),
        (0x1005bfb4, 'test', 'al, al'),
        (0x1005bfb6, 'jns', '0x1005c000'),
        (0x1005bfba, 'call', '0x10057e80'),
        (0x1005bfbf, 'cmp', 'eax, 3'),
        (0x1005bfcb, 'fsub', 'qword ptr [0x10244a08]'),
        (0x1005bfd7, 'fmul', 'dword ptr [ebp - 0x1c]'),
        (0x1005bfda, 'fiadd', 'dword ptr [edi + 0xc]'),
        (0x1005bfdd, 'call', '0x101c19e0'),
        (0x100ee00b, 'mov', 'ecx, dword ptr [esi + 0x9c]'),
        (0x100ee025, 'mov', 'edx, dword ptr [esi + 0xa8]'),
        (0x100ee02e, 'mov', 'eax, dword ptr [esi + 0x94]'),
        (0x100ee053, 'call', '0x10054020'),
        (0x100538c9, 'jnp', '0x100538d3'),
        (0x100538d3, 'fld', 'dword ptr [esi + 0x88]'),
        (0x100538f0, 'jnp', '0x100538fa'),
        (0x100538fa, 'fld', 'dword ptr [esi + 0x8c]'),
        (0x1005390c, 'call', '0x10053270'),
        (0x1005391a, 'jmp', 'dword ptr [eax*4 + 0x10053b70]'),
        (0x1005392f, 'push', 'edi'),
        (0x10053930, 'push', 'ebx'),
        (0x10053931, 'mov', 'eax, dword ptr [esi + 0x2e0]'),
        (0x10053938, 'mov', 'ecx, dword ptr [esi + 0x2dc]'),
        (0x1005393f, 'fld', 'dword ptr [esi + 0x8c]'),
        (0x1005394b, 'fld', 'dword ptr [esi + 0x88]'),
        (0x10053957, 'push', '0'),
        (0x10053959, 'push', '0'),
        (0x1005395e, 'call', '0x10021a00'),
    ]
    for address, mnemonic, operands in anchors:
        w.instruction(address, mnemonic, operands)
    ranges = [
        (0x1005bf40, 0x1005c013, '4ccef6fe2adfd12f2d1ebf2cb5f50aaf65f0665604404705e0f93bc73499f551'),
        (0x100538b8, 0x10053968, '7fbe6d39f1133b4b99f1d86a29bc4ce1c6142c45362a3ada2fb4c184ea290625'),
        (0x100eda54, 0x100edaac, '9d6ecd31719fc95e681823542950bc3e318094dab534020a638de6fa5fa6a315'),
        (0x100f3c54, 0x100f3d1d, 'b09dcd44a2cc5be306ca6ce1d9655e62a62227f8e5a496bb683bc98769e807b8'),
        (0x10021a63, 0x10021ab8, 'd9b9d5b64d6c913c5968f1d7fba98a80688244202423a290c15261fb9bdee1ee'),
    ]
    for start, end, digest in ranges:
        assert hashlib.sha256(w.data[w.offset(start):w.offset(end)]).hexdigest() == digest
    if check_exported:
        sprite = json.loads((ROOT / 'editor/world/ui/skin.json').read_text())['sprites'][texture]
        assert {key: sprite[key] for key in ('w', 'h', 'cx', 'cy', 'cw', 'ch')} == dict(
            w=256, h=512, cx=0, cy=0, cw=256, ch=381), 'Shop background crop differs'
    return dict(sourceSHA256=w.sha, imageBase=hex(w.base), anchors=len(anchors),
                ranges=[dict(start=hex(a), end=hex(b), sha256=c) for a, b, c in ranges],
                windowRecord=shop['off'], textureRecord=back['off'],
                frameFieldOffset=380794, frameDirectionFieldOffset=380834,
                texture=texture, textureType=texture_fields[0], layer=texture_fields[1],
                destination=[0, 20, 256, int(401 - title_height)], sourceRect=[0, 0, 256, 381],
                limits=['selected type-0 unscaled control only',
                        'not a proof of all texture types, alpha inheritance, filtering or GPU blending'])


def verify(check_exported=False):
    from l2lib import load_package
    from extract_uscript import sources_from_package
    from check_inventory_native import script_function
    from extract_gamedata import decrypt, parse_sysstring, parse_systemmsg
    from mine_windowsinfo import decode_default_positions, DEFAULT_START, DEFAULT_END
    import parse_xdat as xdat

    system = ROOT / 'assets/interlude/system'
    for name, digest in FILES.items():
        assert hashlib.sha256((system / name).read_bytes()).hexdigest() == digest, name
    package, _ = load_package(system / 'Interface.u')
    source = dict(sources_from_package(package))['ShopWnd']
    assert hashlib.sha256(source.encode('latin-1')).hexdigest() == SCRIPT_SHA
    functions = {name: script_function(source, name) for name in FUNCTIONS}
    for name, digest in FUNCTIONS.items():
        assert hashlib.sha256(functions[name].encode('latin-1')).hexdigest() == digest, name
    compact = {name: re.sub(r'\s+', '', body) for name, body in functions.items()}
    anchors = {
        'MoveItemTopToBottom': ['!bAllItem&&IsStackableItem(info.ConsumeType)&&(info.ItemNum!=1)',
                               'DialogSetReservedInt(info.ClassID)', 'DialogSetParamInt(-1)',
                               'GetSystemMessage(72)', 'info.ItemNum=1;',
                               'AddPrice(Int64Mul(info.Price,info.ItemNum))'],
        'MoveItemBottomToTop': ['!bAllItem&&IsStackableItem(info.ConsumeType)',
                               'DialogSetReservedInt(info.ClassID)',
                               'FindItemWithServerID', 'AddPrice(Int64Mul(-info.Price,info.ItemNum))'],
        'HandleDialogOK': ['DialogIsMine()', 'num=int(DialogGetString())',
                          'classID=DialogGetReservedInt()', 'num=Min(num,topInfo.ItemNum)',
                          'info.ItemNum+=num;', 'topInfo.ItemNum+=num;',
                          'info.ItemNum=num;', 'if(info.ItemNum<=0)num=info.ItemNum+num;',
                          'AddPrice(Int64Mul(-num,info.Price))'],
        'HandleOKButton': ['if(topInfo.ItemNum>0)', 'bottomInfo.ClassID==topInfo.ClassID',
                           'limitedItemCount+=bottomInfo.ItemNum;',
                           'if(limitedItemCount>topInfo.ItemNum)', 'GetSystemMessage(1338)',
                           'RequestBuyItem(param)', 'RequestSellItem(param)', 'HideWindow(m_WindowName)'],
        'AddPrice': ['Int64Add(m_currentprice,price)', 'm_currentPrice.nLeft<0||m_currentPrice.nRight<0'],
    }
    for name, tokens in anchors.items():
        for token in tokens:
            assert token in compact[name], (name, token)
    # First-class lookup is intentionally different from direct row selection.
    accepted = compact['HandleDialogOK']
    assert accepted.count('FindItemWithClassID') == 4
    sell_return = accepted[accepted.index('id==DIALOG_BOTTOM_TO_TOP'):accepted.index('id==DIALOG_PREVIEW')]
    assert sell_return.index('info.ItemNum=num;') < sell_return.index('if(info.ItemNum<=0)')
    # The whole checked OK body has no positive-bottomCount guard for buy/sell.
    ordinary_ok = compact['HandleOKButton'].split('elseif(m_shopType==ShopPreview)')[0]
    assert 'if(bottomCount>0)' not in ordinary_ok
    language_ids = sorted(set(map(int, re.findall(r'GetSystemString\((\d+)\)', compact['HandleOpenWindow']))))
    assert language_ids == [137, 138, 139, 142, 143, 811, 812, 813]

    raw = (system / 'Interface.xdat').read_bytes()
    _, records = xdat.scan(raw)
    backdrop = verify_backdrop(raw, records, check_exported)
    selected = [row for row in records if row['name'] == 'ShopWnd' or row['parent'] == 'ShopWnd']
    assert len(selected) == 15 and len({row['name'] for row in selected}) == 15
    xdat.data_g = raw
    tree = xdat.build_tree(selected)
    assert len(tree) == 1 and tree[0]['name'] == 'ShopWnd'
    shop = tree[0]
    assert (shop['width'], shop['height']) == (256, 401)
    assert shop['position'] == dict(selfAnchor=4, targetAnchor=4, target='', offsetX=0, offsetY=0)
    controls = {row['name']: row for row in shop['children']}
    assert controls['OKButton']['textId'] == 140 and controls['CancelButton']['textId'] == 141
    assert controls['AdenaConstText']['textId'] == 134
    assert controls['TopList']['grid'] == dict(rows=4, capacity=300, cellX=32, cellY=32, gapX=5, gapY=3)
    assert controls['BottomList']['grid'] == dict(rows=3, capacity=300, cellX=32, cellY=32, gapX=5, gapY=3)
    defaults, _ = decode_default_positions(raw, DEFAULT_START, DEFAULT_END)
    reset = defaults['ShopWnd']
    assert {k: v for k, v in reset.items() if k != 'sourceOffsets'} == dict(
        anchor=1, offsetX=200, offsetY=150, anchored=False, w=None, h=None)

    with tempfile.TemporaryDirectory(prefix='elbera-shop-source-') as tmp:
        strings = parse_sysstring(decrypt('sysstring-e.dat', tmp))
        messages = parse_systemmsg(decrypt('systemmsg-e.dat', tmp))
    by_id = {row['id']: row for row in strings}
    assert len(by_id) == len(strings)
    needed_strings = [134, 136, 137, 138, 139, 140, 141, 142, 143]
    assert all(by_id[i]['string'] for i in needed_strings)
    assert '$s1' in messages['72']['text'] and messages['1338']['text']
    if check_exported:
        cached = (ROOT / 'assets/uscript/Interface/ShopWnd.uc').read_text()
        assert cached == source.replace('\r\n', '\n'), 'cached ShopWnd.uc differs from original package'
        data = ROOT / 'assets/gamedata'
        actual_strings = json.loads((data / 'sysstring.json').read_text())
        assert isinstance(actual_strings, list), 'sysstring export must be an array'
        actual_strings = {row['id']: row for row in actual_strings}
        for key in needed_strings: assert actual_strings[key] == by_id[key], key
        actual_messages = json.loads((data / 'systemmsg.json').read_text())
        for key in ('72', '1338'): assert actual_messages[key] == messages[key], key
        actual_shop = [row for row in json.loads((data / 'interface.json').read_text())['windows']
                       if row['name'] == 'ShopWnd']
        assert len(actual_shop) == 1
        actual_rows = {row['name']: row for row in [actual_shop[0], *actual_shop[0]['children']]}
        for row in [shop, *shop['children']]:
            for key in ('width', 'height', 'x', 'y', 'position', 'relativeSize', 'grid', 'textId', 'align'):
                if key in row: assert actual_rows[row['name']].get(key) == row[key], (row['name'], key)
        assert json.loads((data / 'windowsinfo.json').read_text())['defaults']['ShopWnd'] == reset
    return {'tool': 'Elbera Tools', 'format': 'original-shop-source-v1',
            'sourceSHA256': FILES, 'scriptSHA256': SCRIPT_SHA, 'functionSHA256': FUNCTIONS,
            'branchAnchors': sum(map(len, anchors.values())), 'layoutRecords': len(selected),
            'languageRecords': len(needed_strings) + 2, 'exportedDataChecked': check_exported,
            'creation': shop['position'], 'reset': reset, 'backdrop': backdrop,
            'limits': ['not full UI or packet parity', 'native signed INT64/overflow',
                       'preview, drag/AllItemCount, weight and tooltip presentation',
                       'native text and button-state rendering', 'systemmsg tail framing is heuristic']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='also compare private exports; print compact result')
    args = parser.parse_args()
    result = verify(args.check)
    if args.check:
        print(f"Elbera Tools: ShopWnd PASS; {len(FUNCTIONS)} original functions, "
              f"{result['branchAnchors']} branch anchors, {result['layoutRecords']} layout records, "
              f"{result['languageRecords']} language records; "
              f"{result['backdrop']['anchors']} native backdrop anchors; cached exports match original inputs")
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
