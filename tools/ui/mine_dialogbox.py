#!/usr/bin/env python3
"""Elbera Tools: decode original Warning/Notice/NumberPad dialog source data.

python3 tools/ui/mine_dialogbox.py --emit   # private assets/gamedata/dialogbox.json
python3 tools/ui/mine_dialogbox.py --check  # reread sources and compare output

This is deliberately a narrow decoder for the pinned Interlude build. The
previous general xdat parser treated body+12/+16 as fixed point. These records contain
three int32 fields, a length-prefixed anchor-name string, then signed pixel
offsets. An empty string occupies ONE byte: -40 is at +13, not +12. Native
TopCenter anchor arithmetic independently establishes the resolved positions.
The shared parser now preserves these fields too; this miner additionally
pins the dialog's narrow signatures and resolves its reviewed anchor pairs.
No original binary or decompiled script is emitted by this tool.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

from check_tutorial_quest_native import Image, NWINDOW_SHA, ROOT

sys.path.insert(0, str(ROOT / 'tools/xdat'))
from parse_xdat import Reader, parse_text_block, scan, control_tail_start

XDAT_SHA = 'a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4'
SCRIPT_SHA = 'e921df49020a01c000b8a1dce0a462d133beb77a4a88180d7f66fa27322e164d'
OUTPUT = ROOT / 'assets/gamedata/dialogbox.json'


def anchor_fields(raw, body):
    """Decode the bounded hasSize=1 anchor tail; reject unsupported forms."""
    r = Reader(raw)
    enabled, own, parent = struct.unpack_from('<3i', raw, body)
    target = r.string(body + 12)
    if enabled != 1 or target is None:
        raise ValueError('unsupported dialog anchor header')
    name, p = target
    if name or own not in (1, 2) or parent != own:
        raise ValueError('unsupported dialog anchor target or pair')
    dx, dy = struct.unpack_from('<2i', raw, p)
    if struct.unpack_from('<3i', raw, p + 8) != (-1, -1, 0):
        raise ValueError('dialog anchor tail signature changed')
    if r.string(p + 20) != ('undefined', p + 31):
        raise ValueError('dialog anchor terminator changed')
    return {'self': own, 'parent': parent, 'target': name,
            'offsetX': dx, 'offsetY': dy}


def resolved_rect(raw, record, parent_width):
    anchor = anchor_fields(raw, record['body'])
    w, h = record['width'], record['height']
    # Native enum2 = TopCenter; update subtracts the self anchor point and
    # adds the parent's. All these source dimensions are even integers.
    x = anchor['offsetX']
    if anchor['self'] == 2:
        x += (parent_width - w) / 2
    if int(x) != x:
        raise ValueError('native integer rounding is not covered by this decoder')
    return {'x': int(x), 'y': anchor['offsetY'], 'width': w, 'height': h,
            'anchor': anchor, 'recordOffset': record['off']}


def pad_rect(record, resolved, parent):
    """Resolve source named-sibling anchors in the pad's local coordinates."""
    position = record.get('position')
    if not position or record.get('sizeMode') != 'absolute':
        raise ValueError('missing NumberPad position or dimensions')
    own, other = position['selfAnchor'], position['targetAnchor']
    if own != 1 or other not in (1, 3, 7):
        raise ValueError('unsupported NumberPad anchor pair')
    target = position['target']
    if target:
        if not target.startswith('DialogBox.') or target[10:] not in resolved:
            raise ValueError('unresolved NumberPad named target')
        rect = resolved[target[10:]]
    else:
        rect = parent
    x, y = rect['x'], rect['y']
    if other == 3: x += rect['width']
    if other == 7: y += rect['height']
    return {'x': x + position['offsetX'], 'y': y + position['offsetY'],
            'width': record['width'], 'height': record['height'],
            'position': position, 'recordOffset': record['off']}


def button_textures(raw, record):
    """Four native XMLButtonData FString fields, not a texture-name scan."""
    r, p, result = Reader(raw), control_tail_start(Reader(raw), record), []
    for _ in range(4):
        item = r.string(p)
        if item is None or item[1] > record['end']:
            raise ValueError('truncated NumberPad button texture')
        value, p = item
        result.append(value)
    return result


def native_anchor_proof(window):
    assert window.base == 0x10000000
    assert window.wide(0x1025ae1c) == 'TopCenter'
    window.instruction(0x101147d7, 'push', '0x1025ae1c')
    window.instruction(0x10114805, 'mov', 'esi, 2')
    window.instruction(0x101149c1, 'push', '0x1025ae1c')
    window.instruction(0x101149f1, 'mov', 'edi, 2')
    assert window.u32(0x1022fd2c + 0xd4) == 0x10060790
    assert window.u32(0x1022fd2c + 0xbc) == 0x1005c720
    window.instruction(0x100607f6, 'mov', 'dword ptr [esi + 0x13c], eax')
    window.instruction(0x100607ff, 'mov', 'dword ptr [esi + 0x140], eax')
    window.instruction(0x10060833, 'mov', 'dword ptr [esi + 0x154], ecx')
    window.instruction(0x1006083c, 'mov', 'dword ptr [esi + 0x158], edx')
    window.instruction(0x1005a756, 'add', 'eax, -1')
    assert window.u32(0x1005a8cc + 4) == 0x1005a77d
    # Named NumberPad sibling anchors use TopLeft, TopRight and BottomLeft.
    for enum, address in ((1, 0x1005a765), (3, 0x1005a7a6), (7, 0x1005a84a)):
        assert window.u32(0x1005a8cc + (enum-1)*4) == address
    window.instruction(0x1005a765, 'mov', 'eax, dword ptr [esi + 0x80]')
    window.instruction(0x1005a76d, 'mov', 'ecx, dword ptr [esi + 0x84]')
    window.instruction(0x1005a7a6, 'fild', 'dword ptr [esi + 0x80]')
    window.instruction(0x1005a7ac, 'fadd', 'dword ptr [esi + 0x88]')
    window.instruction(0x1005a84a, 'mov', 'edx, dword ptr [esi + 0x80]')
    window.instruction(0x1005a852, 'jmp', '0x1005a87b')
    window.instruction(0x1005a87b, 'fild', 'dword ptr [esi + 0x84]')
    window.instruction(0x1005a881, 'fadd', 'dword ptr [esi + 0x8c]')
    assert struct.unpack_from('<d', window.data, window.offset(0x1022f270))[0] == 0.5
    window.instruction(0x1005a77d, 'fld', 'dword ptr [esi + 0x88]')
    window.instruction(0x1005a783, 'fmul', 'qword ptr [0x1022f270]')
    window.instruction(0x1005a789, 'fiadd', 'dword ptr [esi + 0x80]')
    window.instruction(0x1005c7ad, 'mov', 'eax, dword ptr [esi + 0x154]')
    window.instruction(0x1005c7b3, 'sub', 'eax, dword ptr [ebp - 0x24]')
    window.instruction(0x1005c7b6, 'add', 'eax, dword ptr [ebp - 0x1c]')
    # NCButton enabled-label color; independent of TextBox's xdat color.
    window.instruction(0x100035a2, 'and', 'ebx, 0x463c1e')
    window.instruction(0x100035a8, 'add', 'ebx, 0xffa0a0a0')
    color = (window.u32(0x100035aa) + window.u32(0x100035a4)) & 0xffffffff
    return {'status': 'verified', 'nwindowSHA256': window.sha,
            'topCenterEnum': 2, 'setAnchorVA': '0x10060790',
            'anchorPointVA': '0x1005a700', 'anchorUpdateVA': '0x1005c720',
            'buttonLabelColor': f'#{color & 0xffffff:06X}'}


def decode():
    raw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    script = (ROOT / 'assets/uscript/Interface/DialogBox.uc').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == XDAT_SHA, 'unsupported Interface.xdat'
    assert hashlib.sha256(script).hexdigest() == SCRIPT_SHA, 'unsupported DialogBox.uc'
    native = native_anchor_proof(Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA))
    _, all_records = scan(raw)
    dialog_records = [r for r in all_records if 94091 <= r['off'] <= 99910]
    records = {r['name']: r for r in dialog_records}
    assert len(records) == len(dialog_records), 'ambiguous dialog records'
    body = records['DialogBody']
    assert body['parent'] == 'DialogBox'
    controls = {}
    ids = re.search(rb'SetButtonName\(\s*(\d+),\s*(\d+)\s*\)', script)
    assert ids
    for name in ('DialogText', 'DialogReadingText', 'DialogBoxEdit',
                 'OKButton', 'CancelButton', 'CenterOKButton'):
        record = records[name]
        assert record['parent'] == 'DialogBody'
        entry = resolved_rect(raw, record, body['width'])
        if name in ('DialogText', 'DialogReadingText'):
            text = parse_text_block(Reader(raw), record['body'], record['end'])
            assert text and text.get('align') == ('left' if name == 'DialogText' else 'center')
            entry.update(text)
        elif name == 'DialogBoxEdit':
            p = control_tail_start(Reader(raw), record)
            fields = struct.unpack_from('<4i', raw, p)
            assert fields == (1, -9999, -1, 0), 'unsupported dialog edit fields'
            entry['sourceEditFields'] = list(fields)
            entry.update({'color': None, 'textInsetX': None, 'textInsetY': None, 'texture': None})
        else:
            assert record['type'] == 'Button' and len(record['textures']) == 2
            entry['texture'] = record['textures'][0]
            entry['labelId'] = int(ids[2 if name == 'CancelButton' else 1])
        controls[name] = entry
    back = records['BackTexture']
    assert back['autosize'] == (1.0, 1.0) and back['insets'] == (0, 0)
    assert len(back['textures']) == 1
    pad = records['NumberPad']
    assert pad['parent'] == 'DialogBox' and len(pad['textures']) == 1
    pad_entry = pad_rect(pad, {}, {'x': 0, 'y': 0, 'width': body['width'], 'height': body['height']})
    pad_entry['texture'] = pad['textures'][0]
    buttons = {}
    for name in [*(f'num{i}' for i in range(1, 10)), 'num0', 'numAll', 'numBS', 'numC']:
        record = records[name]
        assert record['parent'] == 'NumberPad' and record['type'] == 'Button'
        entry = pad_rect(record, buttons, {'x': 0, 'y': 0, 'width': pad['width'], 'height': pad['height']})
        entry['sourceTextures'] = button_textures(raw, record)
        assert entry['sourceTextures'][3] == 'undefined'
        entry['texture'] = entry['sourceTextures'][0]
        buttons[name] = entry
    from check_numberpad_native import verify as verify_numberpad
    number_proof = verify_numberpad()
    controls['DialogBoxEdit'].update(number_proof['editRender'])
    pad_entry.update({'buttons': buttons, 'dialogWidth': body['width'] + pad['width'],
                      'dialogHeight': body['height'], 'native': number_proof})
    return {'format': 'l2-dialogbox-v1',
            'source': {'interfaceSHA256': XDAT_SHA, 'scriptSHA256': SCRIPT_SHA,
                       'script': 'Interface/DialogBox.uc', 'native': native},
            'body': {'width': body['width'], 'height': body['height'],
                     'texture': back['textures'][0]},
            'controls': controls,
            'numberPad': pad_entry,
            'behavior': {'warning': ['OKButton', 'CancelButton'],
                         'notice': ['CenterOKButton'], 'anchor': 'CenterCenter',
                         'defaultAction': 'cancel', 'whileInUse': 'refuse'},
            'limits': ['only Warning, Notice and NumberPad styles',
                       'native pressed/hover texture selection not decoded here',
                       'full cursor/selection/IME and edit width-gate behavior remain separate from geometry',
                       'bitmap-font wrapping uses the browser port text renderer']}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    modes = p.add_mutually_exclusive_group()
    modes.add_argument('--emit', action='store_true')
    modes.add_argument('--check', action='store_true')
    args = p.parse_args()
    data = decode()
    if args.emit:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(data, indent=2) + '\n')
    if args.check:
        assert json.loads(OUTPUT.read_text()) == data, 'dialogbox.json drift; regenerate from source'
    print(json.dumps({'status': 'verified', 'format': data['format'],
                      'body': data['body'], 'buttonRects': {
                          k: {field: v[field] for field in ('x', 'y', 'width', 'height')}
                          for k, v in data['controls'].items() if k.endswith('Button')}}))
