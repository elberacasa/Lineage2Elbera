#!/usr/bin/env python3
"""Elbera Tools: verify shared layout and Button labels in original NWindow.

python3 tools/ui/check_layout_native.py --check
Reads private originals; writes nothing. Requires Capstone.
See docs/native-layout-evidence.md for interpretation and remaining scope.
"""
import argparse
import hashlib
import json
import math
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, NWINDOW_SHA

XDAT_SHA = 'a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4'


def native_corner_intersects(root, window):
    """NCRect::Intersects: any of the argument's four integer corners.

    This intentionally is not general rectangle overlap or containment.
    Input rectangle is (integer left, integer top, float32 width, height).
    The bounded evaluator omits native integer-overflow/NaN behavior.
    """
    rx, ry, rw, rh = root
    x, y, width, height = window
    right, bottom = math.trunc(x + width), math.trunc(y + height)
    return any(rx <= px <= rx + rw and ry <= py <= ry + rh
               for px, py in ((x, y), (right, y), (x, bottom), (right, bottom)))


def native_anchor_position(parent, window, anchor, offset_x, offset_y):
    """NCWnd anchor update with the same self/target enum (default reset)."""
    if not 1 <= anchor <= 9:
        raise ValueError('unsupported anchor enum')
    fx, fy = ((anchor - 1) % 3) / 2, ((anchor - 1) // 3) / 2
    px, py, pw, ph = parent
    x, y, width, height = window
    return (x + offset_x - math.trunc(x + width * fx) + math.trunc(px + pw * fx),
            y + offset_y - math.trunc(y + height * fy) + math.trunc(py + ph * fy))


# Whole surviving control-flow slices supplement individual arithmetic anchors.
SAVED_WINDOW_RANGES = (
    (0x100053e0, 0x1000542d, '148ffbf7e60b95dda923002dd4d2829b7367ab45905c3ed7d391f803443ea5e3'),
    (0x1004fad0, 0x1004fbb3, 'b14878143458b7569f9a1013694ca596f20d4d2102e0ec22b934bd8da1c26f49'),
    (0x1005c100, 0x1005c1de, 'b3b6cca33c946ce2f8140dd3a5c6be7dbb1c56c92c8cc57e9029489050686d08'),
    (0x1014d6a0, 0x1014d82a, '31b4bab1227f2a52872a21091a58608d7c0ff67811a2fa59cbb0486c2430a831'),
    (0x100d98f0, 0x100d99bd, '3993c5cb20ac4d3ca4061c3761ed73575a118d810878a25dc601bebe79656fe1'),
    (0x100d9a50, 0x100d9bae, '062871c61dc8dd13b98772b5fa5fd2d52986909188db26789ff0121ba356d933'),
    (0x100da0a0, 0x100da185, '8ce1a6dfce23cefed319576978e9c53ee95123bd84c2e92dc36eb25456f70b98'),
    (0x10060005, 0x10060065, 'fcc263d66bbc1e4af9ad0a41dc7e5e21f990b1bd89fd62571e1cd581fb2b6355'),
    (0x1005dd44, 0x1005dd91, '3ae7ee70466dcfc08272ec06a2e96443b8fc7225fd96dec2eb30655ad94dfa31'),
    (0x1005a692, 0x1005a6b6, '8e1b4ea9fd3af0dec274927faa9f90276f4597143abe269f4ea4a29ead77d0b8'),
    (0x1005a835, 0x1005a84a, 'cc0cd2b3d123f7036707f8ca883427e6baac821ae3d2aa786417d6d5abaaef78'),
)


def verify():
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    anchors = ['TopLeft', 'TopCenter', 'TopRight', 'CenterLeft', 'CenterCenter',
               'CenterRight', 'BottomLeft', 'BottomCenter', 'BottomRight']
    literals = [0x1025ae30, 0x1025ae1c, 0x1025ae08, 0x1025adf0, 0x1025add4,
                0x1025adbc, 0x1025ada4, 0x1025ad88, 0x1025ad70]
    string_sites = [0x1011479f, 0x101147d7, 0x1011480f, 0x10114847, 0x1011487c,
                    0x101148b4, 0x101148ec, 0x10114921, 0x10114956]
    cases = [0x1005a765, 0x1005a77d, 0x1005a7a6, 0x1005a7cc, 0x1005a7f8,
             0x1005a835, 0x1005a84a, 0x1005a854, 0x1005a868]
    for i, (name, literal, site, case) in enumerate(zip(anchors, literals, string_sites, cases)):
        assert w.wide(literal) == name
        w.instruction(site, 'push', hex(literal))
        assert w.u32(0x1005a8cc + i * 4) == case
    assert struct.unpack_from('<d', w.data, w.offset(0x1022f270))[0] == .5
    assert w.wide(0x10269c6c) == 'XMLUIData::Serialize'
    assert w.wide(0x1026a224) == 'XMLUIData::Create'
    assert w.wide(0x102446f8) == 'NCWnd::GetAnchorPoint'
    assert w.wide(0x1025d244) == 'XMLButtonData::Serialize'
    assert w.wide(0x1025d3d8) == 'XMLButtonData::Create'
    assert w.wide(0x1022f3e4) == 'NCButton::SetButtonName'
    assert w.wide(0x1026a688) == 'XMLWindowData::GetParent'
    assert w.wide(0x1025a014) == 'XMLDataManager::AddParentInfo'
    assert w.u32(0x1026b00c + 0xb0) == 0x100f1410
    assert w.u32(0x10236fd4 + 0x128) == 0x1005ee10
    assert w.wide(0x1026815c) == 'XMLTextBoxData::GetAutosize'
    assert w.u32(0x10268354 + 0xc4) == 0x100eb900
    for slot, target in [(0x144, 0x10058ec0), (0x148, 0x100623e0),
                         (0xbc, 0x1005c720)]:
        assert w.u32(0x102427dc + slot) == target
    assert w.exported('?execGetSystemString@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x100f9a60
    for slot, target in [(0xd8, 0x1005dbc0), (0xbc, 0x1005c720),
                         (0x128, 0x1005ee10), (0x130, 0x1005cf50)]:
        assert w.u32(0x1022fd2c + slot) == target
    checks = [
        (0x101146be, 'mov', 'ebx, 4'),
        (0x101147cd, 'mov', 'esi, 1'), (0x10114805, 'mov', 'esi, 2'),
        (0x1011483d, 'mov', 'esi, 3'), (0x10114875, 'mov', 'esi, ebx'),
        (0x101148aa, 'mov', 'esi, 5'), (0x101148e2, 'mov', 'esi, 6'),
        (0x1011491a, 'mov', 'esi, 7'), (0x1011494f, 'mov', 'esi, 8'),
        (0x10114980, 'neg', 'esi'), (0x10114982, 'sbb', 'esi, esi'),
        (0x10114984, 'and', 'esi, 9'),
        (0x1005a756, 'add', 'eax, -1'), (0x1005a759, 'cmp', 'eax, 8'),
        (0x1005a783, 'fmul', 'qword ptr [0x1022f270]'),
        (0x1005a789, 'fiadd', 'dword ptr [esi + 0x80]'),
        (0x1005a7da, 'fmul', 'qword ptr [0x1022f270]'),
        (0x1005a7e0, 'fiadd', 'dword ptr [esi + 0x84]'),
        (0x101c19f5, 'cvttsd2si', 'eax, qword ptr [esp]'),
        # Scalar serializer writes four bytes; anchor offset pair uses it twice.
        (0x100052e9, 'push', '4'),
        (0x100cf4fa, 'call', '0x1005b9e0'),
        (0x100cf504, 'call', '0x1005b9e0'),
        (0x100cf50e, 'call', 'dword ptr [0x1022c1a8]'),
        (0x100cf519, 'call', '0x1003feb0'),
        (0x1003feea, 'call', '0x100052e0'),
        (0x1003fef4, 'call', '0x100052e0'),
        (0x100efa96, 'call', '0x100cf4c0'),
        (0x100efb03, 'push', '0x10269c6c'),
        # Common record creation preserves serialized enum/string/offset order.
        (0x100f0a7b, 'mov', 'ecx, dword ptr [edi + 0x18]'),
        (0x100f0a7f, 'mov', 'edx, dword ptr [edi + 0x14]'),
        (0x100f0a83, 'lea', 'eax, [edi + 8]'),
        (0x100f0a87, 'mov', 'ecx, dword ptr [edi + 4]'),
        (0x100f0a8b, 'mov', 'edx, dword ptr [edi]'),
        (0x100f0a91, 'mov', 'eax, dword ptr [ebx + 0xd8]'),
        (0x1005dc4a, 'mov', 'dword ptr [esi + 0x13c], eax'),
        (0x1005dc53, 'mov', 'dword ptr [esi + 0x140], eax'),
        (0x1005dc68, 'mov', 'dword ptr [esi + 0x154], edx'),
        (0x1005dc71, 'mov', 'dword ptr [esi + 0x158], eax'),
        (0x1005c7ad, 'mov', 'eax, dword ptr [esi + 0x154]'),
        (0x1005c7b3, 'sub', 'eax, dword ptr [ebp - 0x24]'),
        (0x1005c7b6, 'add', 'eax, dword ptr [ebp - 0x1c]'),
        # Relative size begins with FString and four scalar fields, not a flag.
        (0x100cfacd, 'call', 'dword ptr [0x1022c1a8]'),
        (0x100cfad3, 'lea', 'ecx, [edi + 0x18]'),
        (0x100cfadd, 'lea', 'edx, [edi + 0x1c]'),
        (0x100cfae7, 'lea', 'eax, [edi + 0x20]'),
        (0x100cfaf1, 'add', 'edi, 0x24'),
        (0x100f0a41, 'fld', 'dword ptr [edi + 0x1c]'),
        (0x100f0a48, 'fld', 'dword ptr [edi + 0x18]'),
        (0x100f0a4e, 'mov', 'edx, dword ptr [edx + 0x130]'),
        (0x1005bef8, 'fld', 'dword ptr [esi]'),
        (0x1005befa, 'fmul', 'dword ptr [ebp - 0x20]'),
        (0x1005befd, 'fiadd', 'dword ptr [esi + 8]'),
        (0x1005bf00, 'call', '0x101c19e0'),
        (0x1005c000, 'fld', 'dword ptr [edi + 4]'),
        (0x1005c003, 'fmul', 'dword ptr [ebp - 0x1c]'),
        (0x1005c006, 'fiadd', 'dword ptr [edi + 0xc]'),
        # Common suffix, then Button's four texture strings and label ID.
        (0x100efa9e, 'lea', 'ecx, [edi + 0x60]'),
        (0x100efaa8, 'lea', 'edx, [edi + 0x64]'),
        (0x100efab2, 'lea', 'eax, [edi + 0x68]'),
        (0x100efabc, 'lea', 'ecx, [edi + 0x6c]'),
        (0x100efac1, 'call', 'dword ptr [0x1022c1a8]'),
        (0x100efac7, 'add', 'edi, 0x78'),
        (0x100d41c8, 'call', '0x100ef8c0'),
        (0x100d41cd, 'lea', 'eax, [esi + 0x88]'),
        (0x100d41d5, 'mov', 'ebx, dword ptr [0x1022c1a8]'),
        (0x100d41dd, 'lea', 'ecx, [esi + 0x94]'),
        (0x100d41e7, 'lea', 'edx, [esi + 0xa0]'),
        (0x100d41f1, 'lea', 'eax, [esi + 0xac]'),
        (0x100d41fb, 'lea', 'ecx, [esi + 0xb8]'),
        (0x100d4203, 'call', '0x100052e0'),
        (0x100d48ea, 'mov', 'eax, dword ptr [esi + 0xb8]'),
        (0x100d48f0, 'cmp', 'eax, 0xffffd8f1'),
        (0x100d48fa, 'call', '0x10003cf0'),
        (0x10003d27, 'lea', 'esi, [edi + edi*2]'),
        (0x10003d2a, 'add', 'esi, esi'),
        (0x10003d2c, 'add', 'esi, esi'),
        (0x10003d33, 'lea', 'ecx, [esi + eax + 0x6a8dc]'),
        (0x100f9ae2, 'lea', 'eax, [eax + eax*2]'),
        (0x100f9aeb, 'lea', 'ecx, [ecx + eax*4 + 0x6a8dc]'),
        # Window-specific parent follows common fields and resolves later.
        (0x100f3c58, 'call', '0x100ef8c0'),
        (0x100f3c5d, 'lea', 'eax, [edi + 0x88]'),
        (0x100f144c, 'lea', 'edi, [esi + 0x88]'),
        (0x100f3b62, 'mov', 'edx, dword ptr [edx + 0xb0]'),
        (0x100f3ba6, 'call', '0x100ca430'),
        # Absolute dimensions become the native rectangle dimensions directly.
        (0x100f0a27, 'mov', 'eax, dword ptr [ebx + 0x128]'),
        (0x1005ef39, 'fstp', 'dword ptr [edi + 0x8c]'),
        (0x1005ef42, 'fstp', 'dword ptr [edi + 0x88]'),
        (0x100ec128, 'call', '0x100ef8c0'),
        (0x100ec1a5, 'add', 'esi, 0xbc'),
        (0x100eb932, 'mov', 'eax, dword ptr [ecx + 0xbc]'),
        (0x10052d14, 'mov', 'dword ptr [esi + 0x350], edx'),
        (0x10051b67, 'add', 'dword ptr [edi], 1'),
        (0x10051b75, 'cmp', 'dword ptr [esi + 0x350], ebx'),
        (0x10051be7, 'fild', 'dword ptr [esi + 0x304]'),
        (0x10051bf4, 'fild', 'dword ptr [edi]'),
        (0x10051bfb, 'call', '0x1005ee10'),
        (0x100529c9, 'call', '0x100527a0'),
        (0x10052881, 'call', '0x10051af0'),
        (0x10051cfb, 'call', '0x10051af0'),
        # Inherited autosize is resolved through the prototype before default0.
        (0x100eb938, 'cmp', 'eax, -1'),
        (0x100eb93f, 'mov', 'edx, dword ptr [eax + 0x6c]'),
        (0x100eb94c, 'mov', 'eax, dword ptr [edx + 0xc4]'),
        (0x100eb959, 'xor', 'eax, eax'),
        # Right-aligned autosize requests a move, but active anchors recompute
        # their saved offsets through the normal move/resize lifecycle.
        (0x10051b96, 'fisub', 'dword ptr [ebp - 0x14]'),
        (0x10051bdf, 'mov', 'edx, dword ptr [edx + 0x144]'),
        (0x10058f10, 'mov', 'eax, dword ptr [eax + 0x148]'),
        (0x1006246f, 'mov', 'eax, dword ptr [eax + 0xbc]'),
        (0x1005a362, 'cmp', 'dword ptr [ecx + 0x13c], 0'),
        (0x1005c769, 'call', '0x1005a330'),
        (0x1005ef4a, 'call', '0x1005a5c0'),
    ]
    checks += [
        # Saved INI coordinates are applied, then invalid positions reset.
        (0x1014d783, 'push', '0x10280f60'),
        (0x1014d78c, 'push', '0x10280f54'),
        (0x1014d7bf, 'push', '0x10280f48'),
        (0x1014d7f3, 'mov', 'eax, dword ptr [eax + 0xc0]'),
        (0x1014d7f9, 'call', 'eax'),
        (0x1014d7fd, 'call', '0x1005c100'),
        (0x1014d804, 'je', '0x1014d812'),
        (0x1014d80a, 'mov', 'eax, dword ptr [edx + 0xc8]'),
        (0x1001e994, 'call', '0x1005ffd0'),
        (0x1005c14a, 'mov', 'ecx, dword ptr [ecx + 0x50ac]'),
        (0x1005c179, 'call', '0x1004fad0'),
        (0x1005c180, 'je', '0x1005c196'),
        (0x1005c182, 'xor', 'eax, eax'),
        (0x1005c196, 'mov', 'eax, 1'),
        # Inclusive point boundaries; four corners, no edge-overlap fallback.
        (0x100053ea, 'jg', '0x10005427'),
        (0x100053fd, 'jne', '0x10005427'),
        (0x10005409, 'jg', '0x10005427'),
        (0x1000541c, 'jne', '0x10005427'),
        (0x1004fb0d, 'call', '0x100053e0'),
        (0x1004fb33, 'fadd', 'dword ptr [ebp + 0x10]'),
        (0x1004fb44, 'call', '0x100053e0'),
        (0x1004fb56, 'fadd', 'dword ptr [ebp + 0x14]'),
        (0x1004fb67, 'call', '0x100053e0'),
        (0x1004fb77, 'call', '0x100053e0'),
        # Separate default-position table serialization and native creation.
        (0x100d9aef, 'call', '0x100052e0'),
        (0x100d9b58, 'mov', 'edx, dword ptr [eax + 0x10]'),
        (0x100d992c, 'call', 'dword ptr [0x1022c1a8]'),
        (0x100d9937, 'call', '0x1005b9e0'),
        (0x100d9941, 'call', '0x100052e0'),
        (0x100d994b, 'call', '0x100052e0'),
        (0x100d9955, 'call', '0x100052e0'),
        (0x100d995f, 'call', '0x100052e0'),
        (0x100d9969, 'call', '0x100052e0'),
        (0x100d94c5, 'cmp', 'eax, 0xffffd8f1'),
        (0x100d94cc, 'or', 'eax, 0xffffffff'),
        (0x100d9555, 'cmp', 'eax, 0xffffd8f1'),
        (0x100da135, 'mov', 'edx, dword ptr [edx + 0xcc]'),
        (0x10060013, 'call', '0x10056d10'),
        (0x10060024, 'call', '0x10056e10'),
        (0x1006002f, 'call', '0x10056d90'),
        (0x10060043, 'mov', 'edx, dword ptr [edx + 0xd0]'),
        (0x1006004d, 'jne', '0x10060065'),
        (0x1006005d, 'mov', 'eax, dword ptr [edx + 0xd0]'),
        (0x1005dd51, 'mov', 'dword ptr [esi + 0x13c], eax'),
        (0x1005dd57, 'mov', 'dword ptr [esi + 0x140], eax'),
        (0x1005dd6e, 'mov', 'dword ptr [esi + 0x150], 0'),
        (0x1005dd8c, 'call', '0x1005a5c0'),
        # Empty target after SetAnchor means the actual parent node.
        (0x1005a692, 'mov', 'eax, dword ptr [ecx + 0x150]'),
        (0x1005a69c, 'mov', 'eax, dword ptr [ecx + 0xb8]'),
        (0x1005a6a6, 'mov', 'eax, dword ptr [eax + 0xc]'),
        (0x1005a6ad, 'mov', 'eax, dword ptr [eax + 4]'),
        (0x1005c790, 'call', '0x1005a700'),
        (0x1005c7a8, 'call', '0x1005a700'),
        (0x1005a83b, 'fadd', 'dword ptr [esi + 0x88]'),
        (0x1005a848, 'jmp', '0x1005a7d4'),
    ]
    for va, literal in ((0x10280f60, 'WindowsInfo.ini'), (0x10280f54, 'posX'),
                        (0x10280f48, 'posY'), (0x10244a44, 'NCWnd::IsOutOfRange'),
                        (0x10241f20, 'NCRect::Intersects')):
        assert w.wide(va) == literal
    for slot, target in ((0xc0, 0x1005e8f0), (0xc8, 0x1001e960),
                         (0xcc, 0x1005ca60), (0xd0, 0x1005dd10)):
        assert w.u32(0x10236fd4 + slot) == target
    for start, end, digest in SAVED_WINDOW_RANGES:
        assert hashlib.sha256(w.data[w.offset(start):w.offset(end)]).hexdigest() == digest
    for address, mnemonic, operands in checks:
        w.instruction(address, mnemonic, operands)
    raw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == XDAT_SHA
    sys.path.insert(0, str(ROOT / 'tools/xdat'))
    from parse_xdat import Reader, scan, parse_button_text, parse_text_layout
    declared, records = scan(raw)
    assert declared == 140 and len(records) == 1962
    assert all(r['position'] is not None for r in records)
    relative = [r['relativeSize'] for r in records if r.get('relativeSize')]
    named = sum(bool(r['position']['target']) for r in records)
    nontrivial = sum(bool(r['position']['target']) or
                     (r['position']['selfAnchor'], r['position']['targetAnchor']) != (1, 1)
                     for r in records)
    assert len(relative) == 200 and named == 132 and nontrivial == 405
    buttons = [r for r in records if r['type'] == 'Button']
    captions = [parse_button_text(Reader(raw), r) for r in buttons]
    assert len(buttons) == 352 and all(c is not None for c in captions)
    assert sum('textId' in c for c in captions) == 229
    quest_close = next(r for r in buttons if r['parent'] == 'QuestTreeWnd' and r['name'] == 'btnClose')
    assert quest_close['off'] == 340093
    assert parse_button_text(Reader(raw), quest_close) == {'textId': 385}
    for name in ('SubWndNormal', 'SubWndEnchant'):
        record = next(r for r in records if r['name'] == name)
        assert not record['parent'] and record['declaredWindowParent'] == 'SkillTrainInfoWnd'
    mp = next(r for r in records if r['parent'] == 'SubWndNormal' and r['name'] == 'txtMPString')
    assert mp['width'] == 245 and parse_text_layout(Reader(raw), mp)['autoSize'] == 1
    from mine_windowsinfo import decode_default_positions, DEFAULT_START, DEFAULT_END
    defaults, default_count = decode_default_positions(raw, DEFAULT_START, DEFAULT_END)
    assert default_count == 56 and len(defaults) == 53
    assert defaults['InventoryWnd'] == {'anchor': 6, 'offsetX': -46, 'offsetY': -50,
        'anchored': False, 'w': None, 'h': None, 'sourceOffsets': [533238]}
    inventory = next(r for r in records if r['name'] == 'InventoryWnd')
    assert (inventory['width'], inventory['height']) == (256, 401)
    assert inventory['position'] == {'selfAnchor': 6, 'targetAnchor': 6,
        'target': '', 'offsetX': 0, 'offsetY': -70}
    assert not native_corner_intersects((0, 0, 623, 760), (722, 127, 256, 401))
    assert native_anchor_position((0, 0, 623, 760), (722, 127, 256, 401), 6, -46, -50) == (321, 130)
    return {'status': 'verified', 'nwindowSHA256': w.sha, 'xdatSHA256': XDAT_SHA,
            'anchors': {str(i + 1): name for i, name in enumerate(anchors)},
            'instructionChecks': len(checks) + len(string_sites),
            'positionRecords': len(records), 'relativeSizeRecords': len(relative),
            'namedTargets': named, 'nontrivialAnchors': nontrivial,
            'buttonRecords': len(buttons), 'buttonTextIDs': 229, 'questCloseTextID': 385,
            'coordinateConversion': 'truncate-toward-zero',
            'savedWindowRanges': len(SAVED_WINDOW_RANGES),
            'defaultPositionRecords': default_count, 'uniqueDefaultNames': len(defaults),
            'inventoryResetAt623x760': [321, 130],
            'scope': 'shared layout, saved-window predicate and separate reset records; no general resize fidelity claim'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify without writing files')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
