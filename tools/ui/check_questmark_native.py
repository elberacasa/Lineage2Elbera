#!/usr/bin/env python3
"""Elbera Tools: original quest marker packet, click, and anchored source art.

--check rereads pinned original files; --emit writes only private questmark.json.
Verifies discrete native glow timers/paint; native GPU composition remains separate.
"""
import argparse
import hashlib
import json
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA
from check_layout_native import verify as verify_layout, XDAT_SHA

sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'tools/xdat'))
sys.path.insert(0, str(ROOT / 'tools/uscript'))
from l2lib import load_package
from extract_uscript import sources_from_package
from parse_xdat import scan, Reader, parse_position

INTERFACE_SHA = '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd'
OUTPUT = ROOT / 'assets/gamedata/questmark.json'


def decode_layout(raw):
    """Bounded EffectButton record after common position/tail, no byte scan."""
    _, records = scan(raw)
    windows = [r for r in records if r['name'] == 'QuestBtnWnd' and not r['parent']]
    buttons = [r for r in records if r['name'] == 'btnQuest' and r['parent'] == 'QuestBtnWnd']
    if len(windows) != 1 or len(buttons) != 1:
        raise ValueError('ambiguous original quest marker records')
    window, button = windows[0], buttons[0]
    reader = Reader(raw)
    position, _ = parse_position(reader, window['body'])
    child_position, cursor = parse_position(reader, button['body'])
    if position != {'selfAnchor': 7, 'targetAnchor': 1, 'target': 'ChatWnd', 'offsetX': 42, 'offsetY': -5}:
        raise ValueError('unsupported quest marker anchor')
    if child_position != {'selfAnchor': 1, 'targetAnchor': 1, 'target': '', 'offsetX': 0, 'offsetY': 0}:
        raise ValueError('unsupported quest button local anchor')
    if struct.unpack_from('<3i', raw, cursor) != (-1, -1, 0):
        raise ValueError('unexpected common source tail')
    tail = reader.string(cursor + 12)
    if tail is None or tail[0] != 'undefined':
        raise ValueError('unexpected common source tail string')
    cursor = tail[1]
    tooltip, effect_type = struct.unpack_from('<2i', raw, cursor)
    if tooltip != -9999 or effect_type != 1:
        raise ValueError('unsupported EffectButton type')
    cursor += 8
    textures = []
    for _ in range(5):
        item = reader.string(cursor)
        if item is None:
            raise ValueError('truncated EffectButton texture')
        value, cursor = item
        textures.append(value)
    if cursor != button['end'] or textures != button['textures']:
        raise ValueError('unexplained EffectButton tail')
    if (window['width'], window['height'], button['width'], button['height']) != (32, 32, 32, 32):
        raise ValueError('unsupported source dimensions')
    return {'width': button['width'], 'height': button['height'], 'position': position,
            'texture': textures[0], 'sourceTextures': textures, 'effectType': effect_type,
            'recordOffsets': [window['off'], button['off']],
            'recordsSHA256': hashlib.sha256(raw[window['off']:button['end']]).hexdigest()}


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def timer_step(elapsed, delta, period_ms):
    """Portable finite nonnegative reference for original TimerCheck."""
    elapsed = f32(f32(elapsed) + f32(delta))
    period = f32(period_ms / 1000)
    return (True, f32(elapsed - period)) if elapsed > period else (False, elapsed)


def native_timer_cases(window):
    """Execute original finite TimerCheck arithmetic/branches, without imports.

    Python double approximates extended intermediates; original f32 stores are
    retained. This bounded executor proves its listed cases, not all x87 inputs.
    """
    def run(elapsed, delta, period):
        memory = {'dword ptr [esp + 4]': f32(delta), 'dword ptr [ecx + 0xc]': f32(elapsed),
                  'dword ptr [ecx + 4]': period, 'qword ptr [0x102325f0]': 1000.0}
        stack, pc, result, above = [], 0x1014b160, None, False
        for _ in range(40):
            ins = next(window.dis.disasm(window.data[window.offset(pc):window.offset(pc)+16], pc))
            op, arg = ins.mnemonic, ins.op_str
            pc += ins.size
            if op == 'fld' or op == 'fild': stack.insert(0, memory[arg])
            elif op == 'fadd': stack[0] += memory[arg]
            elif op == 'fdiv': stack[0] /= memory[arg]
            elif op in ('fst', 'fstp'):
                if arg == 'st(1)': stack[1] = stack[0]
                elif arg != 'st(0)': memory[arg] = f32(stack[0])
                if op == 'fstp': stack.pop(0)
            elif op == 'fcom': above = stack[1] > stack[0]
            elif op == 'jge': pc = int(arg, 0)  # positive period domain
            elif op == 'jp':
                if not above: pc = int(arg, 0)
            elif op == 'fsubp': stack[1] -= stack[0]; stack.pop(0)
            elif op == 'mov' and arg == 'eax, 1': result = True
            elif op == 'xor' and arg == 'eax, eax': result = False
            elif op == 'ret': return result, memory['dword ptr [ecx + 0xc]']
            else:
                assert op in ('mov', 'test', 'fnstsw'), (op, arg)
        raise AssertionError('original timer did not return')
    cases = [(0, .01, 10), (0, .010001, 10), (0, .5, 500), (0, 1, 500),
             (.001, .009, 10), (.99, 0, 10), (.05, .000001, 50)]
    for elapsed, delta, period in cases:
        assert run(elapsed, delta, period) == timer_step(elapsed, delta, period)
    return len(cases)


def verify_effect(window):
    """Pinned EffectButton consumer, timer arithmetic, queue and paint decisions."""
    checks = [
        (0x100dbc7e, 'push', '0x1f4'),
        (0x10007613, 'mov', 'edi, dword ptr [ebp + 0x18]'),
        (0x10007626, 'mov', 'dword ptr [esi + 0x350], eax'),
        (0x1000762e, 'mov', 'ecx, edi'),
        (0x1000763e, 'mov', 'dword ptr [esi + 0x354], eax'),
        (0x10005124, 'mov', 'dword ptr [esi + 0x364], 0x32'),
        (0x1000512e, 'mov', 'dword ptr [esi + 0x360], 0'),
        (0x10005149, 'push', '0xf0e0f0'),
        (0x1000515b, 'push', '0xa'), (0x1000515d, 'push', '0xf0e0f1'),
        (0x10005171, 'push', '0x32'), (0x10005173, 'push', '0xf0e0f2'),
        (0x10005014, 'sete', 'al'),
        (0x1000502e, 'add', 'dword ptr [esi + 0x360], 0xf'),
        (0x1000503b, 'cmp', 'eax, 0xff'), (0x10005040, 'jle', '0x10005098'),
        (0x10005054, 'add', 'dword ptr [esi + 0x360], -0xf'),
        (0x1000505b, 'jns', '0x10005098'),
        (0x1000506a, 'push', '0xf0e0f1'), (0x10005076, 'push', '0xf0e0f2'),
        (0x10005082, 'mov', 'byte ptr [esi + 0x369], bl'),
        (0x10005091, 'add', 'dword ptr [esi + 0x364], 5'),
        (0x101505a2, 'call', '0x1014f980'),
        (0x1014b16c, 'fstp', 'dword ptr [esp + 4]'),
        (0x1014b174, 'fst', 'dword ptr [ecx + 0xc]'),
        (0x1014b182, 'fdiv', 'qword ptr [0x102325f0]'),
        (0x1014b190, 'fcom', 'st(1)'), (0x1014b194, 'test', 'ah, 5'),
        (0x1014b197, 'jp', '0x1014b1a6'), (0x1014b199, 'fsubp', 'st(1)'),
        (0x1014b1a0, 'fstp', 'dword ptr [ecx + 0xc]'),
        (0x1014b652, 'mov', 'dword ptr [edx + 8], eax'),
        (0x1016a728, 'call', '0x1014b160'),
        (0x1016a758, 'add', 'esi, 1'), (0x1016a75b, 'jmp', '0x1016a6ea'),
        (0x1016a790, 'push', '0x113'), (0x1016a79a, 'call', 'eax'),
        (0x10005b1b, 'call', '0x100034b0'),
        (0x10005b29, 'movzx', 'ecx, byte ptr [esi + 0x360]'),
        (0x10005b31, 'mov', 'edx, dword ptr [esi + 0x350]'),
        (0x10005b4e, 'push', '-0x30'), (0x10005b50, 'push', '-0x30'),
        (0x10005b5f, 'shl', 'ecx, 7'), (0x10005b62, 'mov', 'eax, 0x51eb851f'),
        (0x10005b78, 'mov', 'edx, eax'), (0x10005b7a, 'sar', 'edx, 1'),
        (0x10005b7c, 'mov', 'eax, 0x10'), (0x10005b81, 'sub', 'eax, edx'),
        (0x10005b8c, 'mov', 'edx, dword ptr [esi + 0x354]'),
        (0x10005bb4, 'mov', 'eax, dword ptr [esi + 0x2ec]'),
        (0x1000381c, 'mov', 'dword ptr [esi + 0x2d8], 1'),
        (0x10003949, 'mov', 'dword ptr [esi + 0x2d8], 2'),
        (0x100057ac, 'mov', 'dword ptr [esi + 0x2d8], eax'),
    ]
    for va, op, operands in checks:
        window.instruction(va, op, operands)
    for va, text in [(0x1022f934, 'NCEffectButton::OnTimer'),
                     (0x1022f964, 'NCEffectButton::StartEffect'),
                     (0x1022fb10, 'NCEffectButton::OnPaint')]:
        assert window.wide(va) == text
    assert struct.unpack_from('<d', window.data, window.offset(0x102325f0))[0] == 1000
    ranges = [
        (0x10004fd0, 0x1000509a, '5529da0e10708eee2ba1e205fa3c5cc2ffbe89a8baf0e8a174a24f2e9f4ba0eb'),
        (0x100050f0, 0x1000518c, '1402b96f5a7508801c45c56fe59e999f39bf156568693bf1a64c120de79a842c'),
        (0x100075fb, 0x10007644, 'af0d44efc64e4cea96684212ac3965a4b7383734ddc0be4bb15691b51fe5ee80'),
        (0x1016a6ea, 0x1016a7a6, '48a7a41b30ed80d8eb7d4e500e5b55281ab7dc8eb90990ec89d6f65d34945c94'),
    ]
    for start, end, sha in ranges:
        assert hashlib.sha256(window.data[window.offset(start):window.offset(end)]).hexdigest() == sha
    return len(checks), [{'start': hex(a), 'end': hex(b), 'sha256': h} for a, b, h in ranges]


def verify():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    window = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    effect_checks, effect_ranges = verify_effect(window)
    verify_layout()  # independently named enum7 BottomLeft / enum1 TopLeft + native update
    engine_checks = [
        (0x10421be0, 'cmp', 'cl, 0xfe'), (0x10421be3, 'jne', '0x10421ccd'),
        (0x10421c33, 'movsx', 'ecx, word ptr [eax + 2]'),
        (0x10421c37, 'imul', 'ecx, ecx, 0x104'),
        (0x10421c42, 'mov', 'eax, dword ptr [ecx + 0x10a67610]'),
        (0x10839124, 'push', '0x1088fe84'),
        (0x10839135, 'mov', 'dword ptr [0x10a69078], 0x1030cde7'),
        (0x1030cde7, 'jmp', '0x1041cb90'),
        (0x1041cbbc, 'push', '0x1087ff8c'),
        (0x1041cbcc, 'call', '0x103034e5'),
        (0x1041cbe3, 'mov', 'ecx, dword ptr [ebp - 0x14]'),
        (0x1041cbe6, 'push', 'ecx'),
        (0x1041cbff, 'mov', 'eax, dword ptr [eax + 0x49c]'),
        (0x10489fc5, 'mov', 'eax, dword ptr [eax + 0x3bc]'),
        (0x10544b6d, 'cmp', 'byte ptr [esp + 0x38], 0'),
        (0x10544b74, 'je', '0x10544d47'),
        (0x10544d47, 'movzx', 'ecx, byte ptr [esp + 0x34]'),
        (0x10544d78, 'fild', 'dword ptr [esp + 0x7c]'),
        (0x10544d7c, 'fstp', 'dword ptr [eax + 0xc]'),
    ]
    assert engine.exported('?DrawTexture@UCanvas@@UAEXHHHHMMMMPAVUTexture@@E_N@Z', True) == 0x10544b50
    assert 0x10a67610 + 0x1a * 0x104 == 0x10a69078
    assert engine.wide(0x1088fe84) == 'ExShowQuestMarkPacket'
    assert engine.wide(0x1087ff8c) == 'd'
    game_table = engine.exported('??_7UGameEngine@@6BUObject@@@')
    assert engine.u32(game_table + 0x49c) == engine.exported('?OnShowQuestMark@UGameEngine@@UAEXAAVL2ParamStack@@@Z')
    assert engine.exported('?OnShowQuestMark@UGameEngine@@UAEXAAVL2ParamStack@@@Z', True) == 0x10489fc0
    assert window.u32(0x10287da4 + 0x3bc) == 0x10153b50
    window_checks = [
        (0x10153b85, 'call', 'dword ptr [0x1022c28c]'),
        (0x10153b9a, 'push', '0x1022fd14'),
        (0x10153bac, 'push', 'esi'), (0x10153bc9, 'push', '0x5f0'),
        (0x10153bd5, 'call', '0x100d1790'),
        (0x1010ac5b, 'call', '0x100051e0'),
        (0x10005215, 'mov', 'dword ptr [ecx + 0x34c], eax'),
        (0x10006633, 'mov', 'eax, dword ptr [esi + 0x348]'),
        (0x10006642, 'sub', 'eax, ebx'), (0x10006644, 'je', '0x100066a9'),
        (0x100066a9, 'push', 'ebx'), (0x100066aa, 'push', '4'),
        (0x100066b8, 'call', '0x1013d7f0'),
        (0x100066d7, 'mov', 'edx, dword ptr [esi + 0x34c]'),
        (0x100066dd, 'push', 'edx'), (0x100066fa, 'push', '0x2da'),
        (0x10006706, 'call', '0x100d1790'),
        (0x1013d919, 'cmp', 'eax, 4'), (0x1013d947, 'call', '0x10050ec0'),
        (0x1013d95d, 'mov', 'eax, dword ptr [edx + 0x138]'),
        (0x1013d969, 'mov', 'eax, dword ptr [edx + 0x78]'),
        (0x100db3fd, 'lea', 'eax, [esi + 0x88]'),
        (0x100db405, 'call', '0x100059f0'),
        (0x100db40a, 'lea', 'ecx, [esi + 0x8c]'),
        (0x100db41a, 'lea', 'edx, [esi + 0x98]'),
        (0x100db424, 'lea', 'eax, [esi + 0xa4]'),
        (0x100db42e, 'lea', 'ecx, [esi + 0xb0]'),
        (0x100db438, 'add', 'esi, 0xbc'),
        (0x100dbca6, 'mov', 'edx, dword ptr [esi + 0x88]'),
        (0x100dbcaf, 'call', '0x100075a0'),
        (0x100075fb, 'mov', 'dword ptr [esi + 0x348], ecx'),
        (0x100075e2, 'call', '0x10006a90'),
        (0x10006b1f, 'call', '0x10004250'),
        (0x10004308, 'mov', 'dword ptr [esi + 0x2e4], eax'),
    ]
    assert bytes(window.data[window.offset(0x1022fd14):window.offset(0x1022fd14)+8]) == b'QuestID\0'
    assert window.wide(0x1022fcdc) == 'NCEffectButton::OnLButtonUp'
    assert window.wide(0x102602d4) == 'XMLEffectButtonData::Serialize'
    assert window.wide(0x10260854) == 'XMLEffectButtonData::Create'
    assert window.wide(0x1027d220) == 'MainWnd'
    assert window.wide(0x1027d1f8) == 'MainWnd.MainTabCtrl'
    for image, checks in [(engine, engine_checks), (window, window_checks)]:
        for va, op, operands in checks:
            image.instruction(va, op, operands)

    source_path = ROOT / 'assets/interlude/system/Interface.u'
    assert hashlib.sha256(source_path.read_bytes()).hexdigest() == INTERFACE_SHA
    package, _ = load_package(source_path)
    scripts = dict(sources_from_package(package))
    snippets = {
        'QuestBtnWnd': ['RegisterEvent( EV_ArriveShowQuest )', 'ShowWindowWithFocus("QuestBtnWnd")',
                        'BeginEffect("QuestBtnWnd.btnQuest", iEffectNumber)', 'HideWindow("QuestBtnWnd")'],
        'QuestTreeWnd': ['RegisterEvent( EV_QuestSetCurrentID )', 'if (RecentlyAddedQuestID>0)',
                         'strNodeName = "root." $ RecentlyAddedQuestID',
                         'arrSplit[SplitCount-1], true'],
        'MainWnd': ['strID == "MainTabCtrl4"', 'SetWindowTitle("MainWnd", 118)'],
        'SystemMsgWnd': ['ChangeAnchorEffectButton("SystemMsgWnd")',
                         'ChangeAnchorEffectButton("ChatWnd")',
                         '"QuestBtnWnd", StrID, "TopLeft", "BottomLeft", 42, -5'],
    }
    for name, tokens in snippets.items():
        assert all(token in scripts[name] for token in tokens), f'original {name} behavior changed'
    raw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == XDAT_SHA
    return {'format': 'l2-questmark-v1', 'source': {'status': 'verified',
            'engineSHA256': engine.sha, 'nwindowSHA256': window.sha,
            'interfacePackageSHA256': INTERFACE_SHA, 'interfaceSHA256': XDAT_SHA,
            'scriptSHA256': {name: hashlib.sha256(scripts[name].encode('latin-1')).hexdigest() for name in snippets},
            'instructionChecks': len(engine_checks) + len(window_checks) + effect_checks,
            'effectRanges': effect_ranges, 'originalTimerArithmeticCases': native_timer_cases(window)},
            'button': decode_layout(raw),
            'behavior': {'serverOpcode': 254, 'extendedOpcode': 26, 'arriveEvent': 1520,
                         'clickEvent': 730, 'mainTab': 4, 'labelId': 118,
                         'effectClock': 'nwindow-effectbutton-v1'},
            'limits': ['native discrete timer, pointer artwork and glow geometry; GPU compositing/gamma not verified',
                       'ChatWnd anchor branch; source SystemMsgWnd reanchoring requires that separate window',
                       'browser journal window substitutes for the unported MainWnd tab container',
                       'quest target guidance and native TreeCtrl painting remain unported']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--emit', action='store_true')
    modes.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = verify()
    if args.emit:
        OUTPUT.write_text(json.dumps(data, indent=2) + '\n')
    elif args.check and OUTPUT.exists():
        assert json.loads(OUTPUT.read_text()) == data, 'quest marker metadata drift; regenerate'
    print(json.dumps({'status': 'verified', 'instructions': data['source']['instructionChecks'],
                      'button': data['button'], 'behavior': data['behavior']}))
