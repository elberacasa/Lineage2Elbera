#!/usr/bin/env python3
"""Elbera Tools: verify exact-level skill labels against original native code.

python3 tools/ui/check_skilltext_native.py --check
Reads pinned owned binaries in memory only; prints source evidence, no dump.
"""
import argparse
import json
import subprocess

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA


def verify():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    window = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    # Original Skillgrp.txt parser establishes column identity directly.
    for name, literal, push, store, field in [
        ('operate_type', 0x1089a424, 0x1046e54d, 0x1046e55d, '0x20'),
        ('is_magic', 0x1089a40c, 0x1046e561, 0x1046e571, '0x3c'),
    ]:
        assert engine.wide(literal) == name
        engine.instruction(push, 'push', hex(literal))
        engine.instruction(store, 'mov', f'dword ptr [esi + {field}], eax')
    # GetOperateType forwards both request arguments, then branches on the
    # same two fields. A failed exact lookup returns zero (no label).
    for va, mnemonic, operands in [
        (0x101b58b2, 'mov', 'eax, dword ptr [ebp + 0xc]'),
        (0x101b58b5, 'push', 'eax'),
        (0x101b58b6, 'mov', 'edx, dword ptr [ebp + 8]'),
        (0x101b58b9, 'push', 'edx'),
        (0x101b58ba, 'call', '0x101b5360'),
        (0x101b539b, 'mov', 'ecx, dword ptr [eax + 0x18]'),
        (0x101b539e, 'cmp', 'ecx, dword ptr [ebp + 8]'),
        (0x101b53a1, 'jne', '0x101b53ab'),
        (0x101b53a3, 'mov', 'edx, dword ptr [eax + 0x1c]'),
        (0x101b53a6, 'cmp', 'edx, dword ptr [ebp + 0xc]'),
        (0x101b53a9, 'je', '0x101b53c3'),
        (0x101b58c1, 'je', '0x101b5919'),
        (0x101b58c3, 'mov', 'ecx, dword ptr [eax + 0x3c]'),
        (0x101b58c6, 'test', 'ecx, ecx'),
        (0x101b58c8, 'je', '0x101b58fd'),
        (0x101b58ca, 'cmp', 'ecx, 3'),
        (0x101b58d3, 'je', '0x101b58f5'),
        (0x101b5903, 'cmp', 'dword ptr [eax + 0x20], 2'),
        (0x101b5907, 'je', '0x101b5911'),
        (0x101b5919, 'xor', 'eax, eax'),
        # Original GetSystemString computes 3*id, then adds 4*that + base.
        (0x100f9ae2, 'lea', 'eax, [eax + eax*2]'),
        (0x100f9aeb, 'lea', 'ecx, [ecx + eax*4 + 0x6a8dc]'),
    ]:
        window.instruction(va, mnemonic, operands)
    labels = {}
    for name, va in [('active', 0x101b5909), ('passive', 0x101b5911),
                     ('magic', 0x101b58d5), ('dance', 0x101b58f5)]:
        instruction = next(window.dis.disasm(window.data[window.offset(va):window.offset(va)+8], va))
        assert instruction.mnemonic == 'add' and instruction.op_str.startswith('ecx, ')
        offset = int(instruction.op_str.split(', ')[1], 16)
        assert (offset - 0x6a8dc) % 12 == 0
        labels[name] = (offset - 0x6a8dc) // 12
    cases = []
    for magic in range(4):
        for operate in range(4):
            branch = ('passive' if operate == 2 else 'active') if magic == 0 else 'dance' if magic == 3 else 'magic'
            cases.append({'isMagic': magic, 'operateType': operate, 'expected': labels[branch]})
    return {'status': 'verified', 'engineSHA256': engine.sha, 'nwindowSHA256': window.sha,
            'getterVA': '0x101b5880', 'labels': labels, 'cases': cases,
            'limits': ['Engine imported parser calls are protector-erased; static source inspection',
                       'does not establish enchant-level or description preprocessing']}


def check_runtime(result):
    module = (ROOT / 'editor/world/js/skilltext.js').as_uri()
    script = f'''import {{ skillDisplayTypeId }} from {json.dumps(module)};
import {{ readFileSync }} from 'node:fs';
const cases = JSON.parse(readFileSync(0, 'utf8'));
for (const c of cases) {{
  if (skillDisplayTypeId({{ ...c, hasIconRecord: true }}) !== c.expected) throw new Error('native label mismatch');
}}
if (skillDisplayTypeId(null) !== null || skillDisplayTypeId({{hasIconRecord: false}}) !== null
    || skillDisplayTypeId({{hasIconRecord: true}}) !== null)
  throw new Error('missing original record must not produce a label');
'''
    subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(result['cases']),
                   text=True, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = verify()
    if args.check:
        check_runtime(result)
    print(json.dumps(result, indent=2))
