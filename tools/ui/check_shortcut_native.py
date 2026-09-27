#!/usr/bin/env python3
"""Elbera Tools: original shortcut packet layouts and ordinary registration flag.

python3 tools/ui/check_shortcut_native.py --check
Requires pinned private Engine.dll/NWindow.dll and Capstone. Decodes only in
memory; no binary execution, socket, account or database access.
"""
import argparse
import hashlib
import json
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA


def verify_script():
    from check_inventory_native import (INTERFACE_SHA, script_function,
                                        load_package, sources_from_package)
    path = ROOT / 'assets/interlude/system/Interface.u'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == INTERFACE_SHA
    package, _ = load_package(path)
    source = dict(sources_from_package(package))['ShortcutWnd']
    sha = hashlib.sha256(source.encode()).hexdigest()
    assert sha == 'cebb4bceaa18e5ab5b19b9050b2a4ea7765af9968d701258a18c5b848098d2e1'
    checks = {
        'OnPrevBtn': ['if( 0 > nNewPage ) nNewPage = MAX_Page - 1;'],
        'OnNextBtn': ['if( MAX_Page <= nNewPage ) nNewPage = 0;'],
        'InitShortPageNum': ['CurrentShortcutPage = 0; CurrentShortcutPage2 = 1; CurrentShortcutPage3 = 2;'],
        'OnPrevBtn2': ['nNewPage = CurrentShortcutPage2 - 1;', 'if( 0 > nNewPage ) nNewPage = MAX_Page - 1;', 'SetCurPage2( nNewPage );'],
        'OnPrevBtn3': ['nNewPage = CurrentShortcutPage3 - 1;', 'if( 0 > nNewPage ) nNewPage = MAX_Page - 1;', 'SetCurPage3( nNewPage );'],
        'OnNextBtn2': ['nNewPage = CurrentShortcutPage2 + 1;', 'if( MAX_Page <= nNewPage ) nNewPage = 0;', 'SetCurPage2( nNewPage );'],
        'OnNextBtn3': ['nNewPage = CurrentShortcutPage3 + 1;', 'if( MAX_Page <= nNewPage ) nNewPage = 0;', 'SetCurPage3( nNewPage );'],
        'SetCurPage': ["class'ShortcutAPI'.static.SetShortcutPage( a_nCurPage );"],
        'SetCurPage2': ['CurrentShortcutPage2 = a_nCurPage;', 'nShortcutID = CurrentShortcutPage2 * MAX_ShortcutPerPage;'],
        'SetCurPage3': ['CurrentShortcutPage3 = a_nCurPage;', 'nShortcutID = CurrentShortcutPage3 * MAX_ShortcutPerPage;'],
        'OnClickExpandShortcutButton': [
            'if (m_IsExpand2) { Reduce(); } else if (m_IsExpand1) { Expand2(); } else { Expand1(); }'],
        'Expand1': ['m_IsShortcutExpand = true;', 'm_IsExpand1 = true;'],
        'Expand2': ['m_IsShortcutExpand = false;', 'm_IsExpand2 = true;'],
        'Reduce': ['m_IsShortcutExpand = true;', 'm_IsExpand1 = false;', 'm_IsExpand2 = false;'],
        'OnDefaultPosition': [
            'm_IsExpand1 = false; m_IsExpand2 = false; SetVertical(true); InitShortPageNum(); ArrangeWnd(); ExpandWnd();'],
        'ArrangeWnd': [
            'if( m_IsJoypadOn ) ShowWindow( "ShortcutWnd." $ m_ShortcutWndName $ ".JoypadBtn" ); else HideWindow( "ShortcutWnd." $ m_ShortcutWndName $ ".JoypadBtn" );'],
    }
    for name, fragments in checks.items():
        body = script_function(source, name)
        for fragment in fragments:
            assert fragment in body, (name, fragment)
        if name in ('Expand1', 'Expand2', 'Reduce'):
            assert not any(operation in body for operation in ('MoveTo(', 'SetWindowSize(', 'SetAnchor('))
    assert 'string( CurrentShortcutPage + 1 )' in source
    return {'interfaceSHA256': INTERFACE_SHA, 'scriptSHA256': sha,
            'functions': list(checks), 'mainPageWrap': True, 'extraPageCycle': [0, 1, 2, 0],
            'fullReset': {'vertical': True, 'extraPages': 0}, 'joypadButton': 'hidden-until-enabled',
            'independentInitialPages': [0, 1, 2], 'keyboardPage': 'CurrentShortcutPage',
            'limits': 'ScriptText evidence; original input bindings outside SetShortcutPage are separate.'}


def verify_drawers(w):
    """Original serializer -> getters -> drawer creation -> completed anchors.

    Fixed-direction ordinary shortcut drawers only. No claim about slide
    timing, clipping during transition, or general inheritance/name lookup.
    """
    from check_layout_native import XDAT_SHA
    sys.path.insert(0, str(ROOT / 'tools/xdat'))
    from parse_xdat import scan, Reader, parse_text_block
    ranges = [
        (0x100f3c5d, 0x100f3df0, '4fc5ad2a4bd156a843376aff1aee92d5d1a34e60e21d7b557b286f6f5af26efb'),
        (0x100f39be, 0x100f3a22, '23bc2c12425f5acc7c3279736b8ac673b93252ad7204cbbe22a93b075197e3a8'),
        (0x1001ea50, 0x1001eaed, '00ff13f881fb893c647133cc200e3620043438b5154bc6a92ac5151dc0e2de63'),
        (0x1001c856, 0x1001c881, 'ffd0817c75d02ba0d88a292d9863b6dd4113bf28cd7240191742087873d5cd17'),
        (0x1001df14, 0x1001dfd8, 'a80d7cf37da31c55158cf7780fd7c502331c65aaa08935b9c0987933dc962264'),
        (0x1001f0f4, 0x1001f176, '7a307aaf750e5031227abe2c0db5ab2faa935dbb55d45143f63e995b8b917f94'),
        (0x100201c1, 0x10020213, '45c78326ddf7cd112120ee2cbc83574bee3bad6f2625f606469c666752513c1a'),
    ]
    for a, b, sha in ranges:
        assert hashlib.sha256(w.data[w.offset(a):w.offset(b)]).hexdigest() == sha
    for address, name in [(0x10236a24, 'NCFrameWnd::SetDrawerWnd'),
                          (0x10236780, 'NCFrameWnd::DrawerShowTransitionFinished'),
                          (0x10236dd0, 'NCDrawerWindowInfo::InitOwnerWnd')]:
        assert w.wide(address) == name
    for slot, target in [(0x110, 0x100f2860), (0x114, 0x100f2520),
                         (0x118, 0x100f2080), (0x11c, 0x100f19b0)]:
        assert w.u32(0x1026b00c + slot) == target
    assert w.u32(0x10236fd4 + 0x208) == 0x1001ea00
    assert w.u32(0x10236fd4 + 0xd4) == 0x10060790  # SetAnchor, common layout evidence
    assert [w.u32(0x1001e03c + i * 4) for i in range(4)] == [
        0x1001df80, 0x1001dfa8, 0x1001df32, 0x1001df5a]
    checks = [
        (0x100f2892, 'mov', 'eax, dword ptr [ecx + 0x124]'),
        (0x100f2552, 'mov', 'eax, dword ptr [ecx + 0x128]'),
        (0x100f20b2, 'mov', 'eax, dword ptr [ecx + 0x12c]'),
        (0x100f19ec, 'lea', 'edi, [esi + 0x130]'),
        (0x100f3d88, 'lea', 'edx, [edi + 0x124]'),
        (0x100f3d98, 'lea', 'eax, [edi + 0x128]'),
        (0x100f3da5, 'lea', 'ecx, [edi + 0x12c]'),
        (0x100f3db2, 'lea', 'edx, [edi + 0x130]'),
        (0x100f3dba, 'call', 'ebx'),
        (0x1001c869, 'mov', 'dword ptr [esi + 0x50], ecx'),
        (0x1001c86f, 'mov', 'dword ptr [esi + 0x48], edx'),
        (0x1001c87e, 'mov', 'dword ptr [esi + 0x54], ecx'),
        (0x1001c9a2, 'mov', 'eax, dword ptr [ecx + 0x54]'),
        (0x1001f0fa, 'call', '0x1001c970'),
        (0x1001f101, 'jne', '0x1001f176'),  # fixed skips screen-edge reversal
        (0x1001df86, 'mov', 'ebx, dword ptr [ecx + 0x48]'),
        (0x1001df89, 'fld', 'dword ptr [esi + 0x88]'),
        (0x1001df8f, 'fchs', ''), (0x1001df91, 'call', '0x101c19e0'),
        (0x1001df9f, 'push', 'ebx'), (0x1001dfa0, 'push', 'eax'),
        (0x1001dfa2, 'push', '1'), (0x1001dfa4, 'push', '1'),
        (0x1001df32, 'fld', 'dword ptr [esi + 0x8c]'),
        (0x1001df38, 'fchs', ''), (0x1001df3a, 'call', '0x101c19e0'),
        (0x1001df45, 'mov', 'ecx, dword ptr [ecx + 0x48]'),
        (0x1001df51, 'push', 'eax'), (0x1001df52, 'push', 'ecx'),
        (0x1001df54, 'push', '1'), (0x1001df56, 'push', '1'),
    ]
    for address, mnemonic, operands in checks:
        w.instruction(address, mnemonic, operands)
    raw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == XDAT_SHA
    _, rows = scan(raw)
    result = {}
    for orientation, direction in [('Vertical', 1), ('Horizontal', 3)]:
        base = 'ShortcutWnd' + orientation
        parent = next(r for r in rows if r['name'] == base)
        for index in (1, 2):
            name = f'{base}_{index}'
            row = next(r for r in rows if r['name'] == name)
            owner = base if index == 1 else f'{base}_1'
            assert row['drawer'] == {'direction': direction, 'offset': 0, 'fixed': 1, 'owner': owner}
            assert (row['width'], row['height'], row['textures']) == (
                parent['width'], parent['height'], [r for r in parent['textures'] if r.startswith('L2UI_')])
            for control in ('Shortcut1', 'F1Tex', 'PageNumTextBox'):
                original = next(r for r in rows if r['parent'] == base and r['name'] == control)
                extra = next(r for r in rows if r['parent'] == name and r['name'] == control)
                for field in ('width', 'height', 'position', 'textures'):
                    assert original[field] == extra[field], (name, control, field)
                if control == 'PageNumTextBox':
                    for item in (original, extra):
                        assert parse_text_block(Reader(raw), item['body'], item['end'])['align'] == 'center'
            result[name] = {'recordOffset': row['off'], **row['drawer']}
    return {'status': 'verified-static-original', 'xdatSHA256': XDAT_SHA,
            'ranges': len(ranges), 'instructions': len(checks), 'drawers': result,
            'completedOffsets': {'direction1': ['-truncate(width)', 'offset'],
                                 'direction3': ['offset', '-truncate(height)']},
            'limits': 'Fixed ordinary drawers only; transition motion/clipping, general inheritance and native name lookup remain unported.'}


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    network = e.exported('??_7UNetworkHandler@@6BUObject@@@')
    registrations = [
        (0x44, 0x10837166, 0x10306a55, 0x10414290),
        (0x45, 0x10837183, 0x10312ee0, 0x10414600),
        (0x46, 0x108371a0, 0x1030a452, 0x104149c0),
    ]
    for opcode, registration, stub, body in registrations:
        e.instruction(registration, 'mov', f'dword ptr [{hex(0x10a57310 + opcode * 0x104)}], {hex(stub)}')
        assert e.data[e.offset(stub)] == 0xe9
        assert stub + 5 + struct.unpack_from('<i', e.data, e.offset(stub) + 1)[0] == body
    for name, slot, body in [('Reg', 0x280, 0x10406ab0), ('Del', 0x288, 0x10406bc0), ('Use', 0x284, 0x10406b40)]:
        symbol = f'?RequestShortCut{name}@UNetworkHandler@@UAEXAAVL2ParamStack@@@Z'
        assert e.u32(network + slot) == e.exported(symbol)
        assert e.exported(symbol, True) == body
    formats = {0x1087ff8c: 'd', 0x1087ff44: 'dd', 0x10885e68: 'dddddhh',
               0x10885e60: 'ddcd', 0x1087fa94: 'cdddd', 0x1087f8f8: 'cd', 0x1087f698: 'cddc'}
    for address, value in formats.items():
        start = e.offset(address)
        assert e.data[start:start + len(value) + 1] == value.encode() + b'\0'
    assert e.wide(0x10881520).endswith('Type=%d RoomNum=%d ID=%d UserShortCut=%d')
    for table, expected in [
        (0x10414538, [0x104142f8, 0x10414397, 0x10414405, 0x10414446, 0x10414490]),
        (0x104148e4, [0x104146b2, 0x10414738, 0x1041478c, 0x104147cc, 0x1041480c]),
    ]:
        assert [e.u32(table + i * 4) for i in range(5)] == expected
    game = e.exported('??_7UGameEngine@@6BUObject@@@')
    assert e.u32(game + 0x400) == e.exported('?OnReceiveShortCutList@UGameEngine@@UAEXXZ')
    engine_checks = [
        (0x10406af1, 'push', '0x33'), (0x10406af3, 'push', '0x1087fa94'),
        (0x10406b71, 'push', '0x34'), (0x10406b73, 'push', '0x1087f698'),
        (0x10406bfb, 'push', '0x35'), (0x10406bfd, 'push', '0x1087f8f8'),
        (0x104142d2, 'push', '0x1087ff44'), (0x1041431e, 'push', '0x10885e68'),
        (0x104143ab, 'push', '0x10885e60'), (0x1041440f, 'push', '0x1087ff44'),
        (0x10414630, 'mov', 'eax, dword ptr [edx + 0x400]'),
        (0x10414636, 'call', 'eax'), (0x1041463f, 'push', '0x1087ff8c'),
        (0x10414685, 'push', '0x1087ff44'), (0x104146ce, 'push', '0x10885e68'),
        (0x10414748, 'push', '0x10885e60'), (0x10414794, 'push', '0x1087ff44'),
        (0x104149d0, 'push', '0x1087ff8c'),
    ]
    window_checks = [
        # Ordinary skill registration: type, room, skill ID, literal UserShortCut=1.
        (0x10185c27, 'push', '2'), (0x10185c36, 'call', '0x100473a0'),
        (0x10185c3b, 'push', 'eax'), (0x10185c50, 'mov', 'edx, dword ptr [ecx + 0x1e5c]'),
        (0x10185c56, 'push', 'edx'), (0x10185c5c, 'push', '1'),
        (0x10185c61, 'call', 'edi'), (0x10185c6d, 'call', '0x1015a3b0'),
        # Independent item and generic drag/swap registrations also use 1.
        (0x10177438, 'push', '1'), (0x10177449, 'call', '0x1015a3b0'),
        (0x10048262, 'push', '1'), (0x10048273, 'call', '0x1015a3b0'),
        (0x10048300, 'push', '1'), (0x10048311, 'call', '0x1015a3b0'),
        (0x1015a43b, 'push', 'edx'),
        (0x1015a43c, 'mov', 'eax, dword ptr [eax + 0x280]'),
        (0x1015a442, 'call', 'eax'),
    ]
    for image, checks in [(e, engine_checks), (w, window_checks)]:
        for address, mnemonic, operands in checks:
            image.instruction(address, mnemonic, operands)
    return {'status': 'verified-static-original', 'engineSHA256': e.sha, 'nwindowSHA256': w.sha,
            'script': verify_script(),
            'drawers': verify_drawers(w),
            'instructionChecks': len(registrations) + len(engine_checks) + len(window_checks),
            'register': {'opcode': '0x33', 'format': 'cdddd', 'ordinaryUserShortCut': 1},
            'delete': {'requestOpcode': '0x35', 'requestFormat': 'cd', 'nativeReplyPayload': 'd',
                       'configuredServerReplyPayload': 'dd'},
            'rows': {'prefix': 'dd', 'item': 'dddddhh', 'skill': 'ddcd', 'actionMacroRecipe': 'dd'},
            'limits': 'Static original evidence; pet registration and optimistic widget mutation unproved. Native0x34 use is DummyPacket in the configured server.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='check pinned local originals')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
