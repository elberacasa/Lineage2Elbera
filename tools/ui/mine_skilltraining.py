#!/usr/bin/env python3
"""Elbera Tools: original skill-training protocol and source layout inspection.

--emit writes only ignored assets/gamedata/skilltraining.json.
--check rereads original sources and compares the existing narrow export.
No original binary/script bytes are emitted. Geometry stays as source rules;
unresolved frame defaults, text measurement and named aliases are explicit.
"""
import argparse
import hashlib
import json
import re
import struct
import sys
import tempfile

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA
from check_layout_native import verify as verify_layout, XDAT_SHA

sys.path.insert(0, str(ROOT / 'tools/xdat'))
import parse_xdat as xdat
sys.path.insert(0, str(ROOT / 'tools/dat'))
from extract_gamedata import decrypt, parse_sysstring

OUTPUT = ROOT / 'assets/gamedata/skilltraining.json'
SCRIPT_SHA = {
    'SkillTrainInfoWnd': 'c775d82d60edfd3fb13ce954abe489ebeb91b6d9471bfc2e9acb7dbcbb726309',
    'SkillTrainListWnd': '6156b6b1a9de80ad89bbc702f48d5caa97705458a4b81745443166d5c7fac85f',
}
SYSSTRING_SHA = '33053b17ca8e1d157aec8fb40b4ef8542626338858ce6c7b4d799c7609554135'


def protocol_proof():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    checks = [
        (0x10421cfe, 'movzx', 'ecx, byte ptr [eax]'),
        (0x10421d01, 'imul', 'ecx, ecx, 0x104'),
        (0x10421d0c, 'mov', 'eax, dword ptr [ecx + 0x10a57310]'),
        (0x1083796f, 'mov', 'dword ptr [0x10a5ff38], 0x103028f1'),
        (0x1083798c, 'mov', 'dword ptr [0x10a6003c], 0x1030b357'),
        (0x108379e3, 'mov', 'dword ptr [0x10a60348], 0x1030f9e3'),
        (0x10415f64, 'push', '0x1087ff44'),
        (0x10415ff3, 'push', '0x10883d84'),
        (0x104161a7, 'push', '0x108810b0'),
        (0x10416209, 'push', '0x1087ff8c'),
        (0x1041626b, 'push', '0x108810b0'),
        (0x10400ba2, 'mov', 'eax, dword ptr [edx + 0x4e8]'),
        (0x10407a9e, 'push', '0x6b'), (0x10407aa0, 'push', '0x1087fa3c'),
        (0x10407b0e, 'push', '0x6c'), (0x10407b10, 'push', '0x1087fa3c'),
    ]
    for args in checks:
        e.instruction(*args)
    for opcode, table, stub, body in [
        (0x8a, 0x10a5ff38, 0x103028f1, 0x10415f30),
        (0x8b, 0x10a6003c, 0x1030b357, 0x10416160),
        (0x8e, 0x10a60348, 0x1030f9e3, 0x10400b70),
    ]:
        assert table == 0x10a57310 + opcode * 0x104
        assert e.data[e.offset(stub)] == 0xe9
        assert stub + 5 + struct.unpack_from('<i', e.data, e.offset(stub) + 1)[0] == body
    for address, text in [(0x1087ff44, b'dd'), (0x10883d84, b'ddddd'),
                          (0x108810b0, b'dddd'), (0x1087ff8c, b'd'), (0x1087fa3c, b'cddd')]:
        p = e.offset(address)
        assert e.data[p:p + len(text) + 1] == text + b'\0'
    for address, text in [(0x1028784c, 'iMaxLevel'), (0x10287834, 'iSPConsume'),
                          (0x10287818, 'bItemConsume'), (0x102877f4, 'iType')]:
        assert w.wide(address) == text
    for args in [
        (0x1016bf2f, 'mov', 'dword ptr [ebp - 0x38], eax'),
        (0x1016c14b, 'mov', 'ecx, dword ptr [ebp - 0x38]'),
        (0x1016bf49, 'mov', 'dword ptr [ebp + 0x14a0], eax'),
        (0x1016c1b3, 'mov', 'edx, dword ptr [ebp + 0x14a0]'),
        (0x10157692, 'push', '0x802'), (0x101576a7, 'push', '0x7e4'),
    ]:
        w.instruction(*args)
    return {
        'status': 'verified-static-original', 'engineSHA256': e.sha, 'nwindowSHA256': w.sha,
        'receive': {
            'AcquireSkillList': {'opcode': 0x8a, 'header': ['type', 'count'],
                                 'row': ['id', 'level', 'maxLevel', 'spConsume', 'itemConsume']},
            'AcquireSkillInfo': {'opcode': 0x8b, 'header': ['id', 'level', 'spConsume', 'type', 'count'],
                                 'row': ['raw1', 'itemId', 'count', 'raw4']},
            'AcquireSkillDone': {'opcode': 0x8e, 'payload': [], 'hides': ['SkillTrainInfoWnd', 'SkillTrainListWnd']},
        },
        'send': {'RequestAcquireSkillInfo': {'opcode': 0x6b, 'fields': ['id', 'level', 'type']},
                 'RequestAcquireSkill': {'opcode': 0x6c, 'fields': ['id', 'level', 'type']}},
        'integerFieldEncoding': '32-bit little-endian',
        'limits': ['Packed Engine import calls were erased; proof is static data/control flow.',
                   'Requirement raw1/raw4 names and enchantment packets are not established here.'],
    }


def descendants(nodes):
    for node in nodes:
        yield node
        yield from descendants(node['children'])


def tree_flow_proof():
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    assert w.wide(0x10247c10) == 'NCXMLTree::DrawTreeNode'
    checks = [
        (0x1006b5fe, 'and', 'eax, 1'),
        (0x1006b601, 'mov', 'dword ptr [esi + 0xc], eax'),
        (0x1006ced3, 'cmp', 'dword ptr [edi + 0xc], edx'),
        (0x1006cedc, 'mov', 'eax, dword ptr [edi + 4]'),
        (0x1006cedf, 'add', 'ebx, eax'),
        (0x1006cee9, 'mov', 'ebx, dword ptr [edi + 4]'),
        (0x1006ceec, 'add', 'ebx, dword ptr [ebp + 0x10]'),
        (0x1006cef5, 'add', 'dword ptr [ebp - 0x14], eax'),
        (0x1006cf03, 'add', 'dword ptr [ebp - 0x1c], eax'),
        (0x1006cf09, 'mov', 'dword ptr [ebp - 0x18], edx'),
        (0x1006d051, 'add', 'ebx, dword ptr [ebp - 0x64]'),
        (0x1006d062, 'mov', 'ecx, dword ptr [edi + 8]'),
        (0x1006d065, 'mov', 'edx, dword ptr [ebp - 0x60]'),
        (0x1006d068, 'lea', 'eax, [edx + ecx]'),
        (0x1006d0c3, 'add', 'ebx, dword ptr [edi + 0x30]'),
        (0x1006d0d4, 'mov', 'eax, dword ptr [edi + 0x34]'),
        (0x1006d0d7, 'mov', 'ecx, dword ptr [edi + 8]'),
        (0x1006d0da, 'add', 'eax, ecx'),
        (0x1006d0dc, 'cmp', 'dword ptr [ebp - 0x18], eax'),
        (0x1006d0e1, 'mov', 'dword ptr [ebp - 0x18], eax'),
        (0x1006d0fe, 'add', 'dword ptr [ebp - 0x1c], edx'),
        (0x1006cfc3, 'fsub', 'qword ptr [0x10232588]'),
    ]
    for args in checks:
        w.instruction(*args)
    inset = struct.unpack_from('<d', w.data, w.offset(0x10232588))[0]
    return {'status': 'verified-static-original', 'drawNodeVA': '0x1006ca90',
            'instructionChecks': len(checks), 'wrapRightInset': inset,
            'fixedRowHeight': None,
            'flow': {'nonBreak': 'x += offsetX',
                     'break': 'x = nodeOriginX + offsetX; y += lineHeight; totalHeight += lineHeight; lineHeight = 0',
                     'draw': 'draw(x, y + offsetY)',
                     'advance': 'x += itemWidth; lineHeight = max(lineHeight, itemHeight + offsetY)',
                     'finish': 'totalHeight += lineHeight'},
            'textExtent': 'native measured text extent; wrapped unless t_bDrawOneLine',
            'textureExtent': 'declared texture width and height'}


def decode():
    layout_proof = verify_layout()
    protocol = protocol_proof()
    raw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == XDAT_SHA
    xdat.data_g = raw
    _, records = xdat.scan(raw)
    tree = xdat.build_tree(records)
    windows = {n['name']: n for n in descendants(tree) if n['name'] in SCRIPT_SHA}
    assert len(windows) == 2
    info_children = {n['name'] for n in windows['SkillTrainInfoWnd']['children']}
    assert {'SubWndNormal', 'SubWndEnchant'} <= info_children
    nodes = list(descendants(list(windows.values())))
    assert all(n.get('parentResolution', {}).get('status', 'resolved') == 'resolved' for n in nodes)
    textboxes = [n for n in nodes if n['type'] == 'TextBox']
    assert len(textboxes) == 37, 'pinned trainer TextBox inventory changed'
    assert all('textLayout' in n for n in textboxes), 'trainer TextBox tail is unresolved'
    ids = {n['textId'] for n in nodes if 'textId' in n}
    script_refs = set()
    for name, expected in SCRIPT_SHA.items():
        script = (ROOT / f'assets/uscript/Interface/{name}.uc').read_bytes()
        assert hashlib.sha256(script).hexdigest() == expected
        ids.update(map(int, re.findall(rb'GetSystemString\(\s*(\d+)\s*\)', script)))
        ids.update(map(int, re.findall(rb'(?:iWindowTitle|iSPIdx)\s*=\s*(\d+)\s*;', script)))
        script_refs.update(s.decode('ascii') for s in re.findall(rb'"([A-Za-z0-9_.]+)"', script)
                           if xdat.TEXREF.match(s.decode('ascii')))
    sysraw = (ROOT / 'assets/interlude/system/sysstring-e.dat').read_bytes()
    assert hashlib.sha256(sysraw).hexdigest() == SYSSTRING_SHA
    with tempfile.TemporaryDirectory(prefix='elbera-skilltraining-') as directory:
        strings = {r['id']: r['string'] for r in parse_sysstring(decrypt('sysstring-e.dat', directory))}
    assert ids <= strings.keys()
    refs = sorted({t for n in nodes for t in n['textures']} | script_refs)
    library = xdat.library_index()
    textures = {ref: xdat.resolve(ref, library) for ref in refs if xdat.resolve(ref, library)}
    return {
        'schema': 1, 'source': 'original Interlude client',
        'sources': {'Interface.xdat': XDAT_SHA, 'NWindow.dll': NWINDOW_SHA,
                    'engine.dll': ENGINE_SHA, 'sysstring-e.dat': SYSSTRING_SHA, **SCRIPT_SHA},
        'nativeLayoutProof': layout_proof, 'protocol': protocol, 'nativeTreeFlow': tree_flow_proof(),
        'geometry': {'resolvedPixels': False, 'sourceDimensions': 'total native rectangle',
                     'unresolved': ['Inherited frame style/direction and frame art mapping',
                                    'Native font measurement for TextBoxes with textLayout.autoSize=1',
                                    'Prototype resolution for TextBoxes with textLayout.autoSize=-1',
                                    'Named anchor aliases that omit intermediate window names']},
        'windows': windows, 'strings': {str(i): strings[i] for i in sorted(ids)},
        'textures': textures,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--check', action='store_true')
    action.add_argument('--emit', action='store_true')
    args = parser.parse_args()
    result = decode()
    if args.emit:
        OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    else:
        assert json.loads(OUTPUT.read_text()) == result, 'skilltraining.json is stale; run --emit'
    print(json.dumps({'status': 'PASS', 'mode': 'emit' if args.emit else 'check',
                      'controls': len(list(descendants(list(result['windows'].values())))),
                      'textIDs': len(result['strings']), 'textures': len(result['textures']),
                      'resolvedPixels': result['geometry']['resolvedPixels']}))
