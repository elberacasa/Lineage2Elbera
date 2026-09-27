#!/usr/bin/env python3
"""Elbera Tools: verify skill animation slots against the owned native client.

python3 tools/ui/check_skillanim_native.py --check
python3 tools/ui/check_skillanim_native.py --json  # evidence/mapping, no binary dump

Reads the pinned original Engine/Core DLLs in memory. The selector's literal
names, success branches and exported pawn getters independently derive the
browser mapping. Imported calls were erased by the original protector; this
is a static proof, not execution of an unpacked client. It does not establish
full animation phase durations, interpolation or projectile timing.
"""
import argparse
import hashlib
import json
import re

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA

CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'
START, END, SUCCESS_END = 0x1ed930, 0x1ee2e9, 0x1ee26f
JAVASCRIPT = ROOT / 'editor/world/js/native-skillanim.js'


def derive():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    assert engine.exported('?SetSkillAnim@APawn@@QAEHHH@Z', True) == engine.base + START
    # The file loader's named animation column constructs an L2FName, then
    # stores its index at +40. The selector reads that same field.
    assert engine.wide(0x10899674) == 'animation'
    engine.instruction(0x1046e5c7, 'push', '0x10899674')
    engine.instruction(0x1046e5db, 'call', '0x10309fa2')
    assert engine.exported('??0L2FName@@QAE@PBGW4EFindName@@@Z', True) == 0x103575f0
    engine.instruction(0x1046e5e3, 'mov', 'dword ptr [esi + 0x40], ecx')
    # L2FName forwards both constructor arguments and preserves the native
    # name-index layout. Its imported base-constructor call is NOP-erased.
    engine.instruction(0x103575fb, 'push', 'eax')
    engine.instruction(0x103575fc, 'push', 'ecx')
    engine.instruction(0x103575fd, 'mov', 'ecx, esi')
    # Native FName interning compares case-insensitively; skillgrp includes
    # lowercase t/f/i/j although SetSkillAnim has uppercase literals only.
    assert core.exported('??0FName@@QAE@PBGW4EFindName@@@Z', True) == 0x101570e0
    assert core.exported('?appStricmp@@YAHPBG0@Z') == 0x10103c47
    core.instruction(0x1015718c, 'call', '0x10103c47')
    core.instruction(0x10109d48, 'cmp', 'eax, dword ptr [edx]')
    # The phase index belongs to FNMagicInfo at Pawn+4f0. Clear initializes
    # it to -1; MagicProcess increments it and plays the corresponding slot.
    # This establishes ordered phases, not their time/rate calculation.
    engine.instruction(0x10342740, 'lea', 'eax, [ecx + 0x4f0]')
    engine.instruction(0x1038e695, 'or', 'ebx, 0xffffffff')
    engine.instruction(0x1038e698, 'mov', 'dword ptr [esi + 0x14], ebx')
    engine.instruction(0x1038e6a6, 'mov', 'dword ptr [esi + 0x10], ebx')
    engine.instruction(0x10511e1f, 'mov', 'edi, 1')
    engine.instruction(0x10511e51, 'add', 'dword ptr [esi + 0x500], edi')
    engine.instruction(0x10511e57, 'mov', 'ecx, dword ptr [esi + 0x500]')
    engine.instruction(0x10511f95, 'mov', 'ecx, dword ptr [esi + ecx*4 + 0x580]')

    getters = {}
    for name in engine.exports:
        match = re.fullmatch(r'\?Get(\w+)AnimName@APawn@@QAE\?AVFName@@XZ', name)
        if not match:
            continue
        address = engine.exported(name, True)
        instructions = list(engine.dis.disasm(engine.data[address-engine.base:address-engine.base+24], address))
        for instruction in instructions:
            field = re.fullmatch(r'ecx, dword ptr \[ecx \+ eax\*4 \+ (0x[0-9a-f]+)\]', instruction.op_str)
            if instruction.mnemonic == 'mov' and field:
                slot = match[1][0].lower() + match[1][1:]
                getters[int(field[1], 16)] = slot

    instructions = list(engine.dis.disasm(engine.data[START:END], engine.base + START))
    by_address = {i.address: n for n, i in enumerate(instructions)}
    branches, mapping = [], {}
    for index, instruction in enumerate(instructions):
        if instruction.mnemonic != 'push' or not instruction.op_str.startswith('0x10'):
            continue
        literal = int(instruction.op_str, 16)
        try:
            code = engine.wide(literal)
        except (ValueError, IndexError, UnicodeDecodeError):
            continue
        if not re.fullmatch(r'[A-Z]|Mix0[1-9]|MS01', code):
            continue
        # Every comparison operates on current skill-data +40 and the first
        # conditional jumps to the next code only when it did not match.
        compare = next(n for n in range(index + 1, len(instructions))
                       if instructions[n].mnemonic == 'je')
        ops = [(i.mnemonic, i.op_str) for i in instructions[index:compare]]
        assert ('mov', 'ecx, dword ptr [esi + 0x4f4]') in ops
        assert ('add', 'ecx, 0x40') in ops
        assert ('test', 'eax, eax') in ops
        registers, fields = {'ebx': 1}, {}
        pc = compare + 1
        for _ in range(40):
            current = instructions[pc]
            if current.address == engine.base + SUCCESS_END:
                break
            if current.mnemonic == 'jmp':
                pc = by_address[int(current.op_str, 16)]
                continue
            if current.mnemonic == 'mov':
                read = re.fullmatch(r'(e\w+), dword ptr \[esi \+ e\w+\*4 \+ (0x[0-9a-f]+)\]', current.op_str)
                write = re.fullmatch(r'dword ptr \[esi \+ (0x[0-9a-f]+)\], (\w+)', current.op_str)
                if read:
                    registers[read[1]] = getters[int(read[2], 16)]
                if write:
                    operand = write[2]
                    fields[int(write[1], 16)] = registers.get(operand) if operand.startswith('e') else int(operand, 0)
            pc += 1
        else:
            raise AssertionError('selector success path did not reach common end')
        count = fields[0x534]
        assert count in (1, 2, 3)
        slots = [fields[0x580 + n*4] for n in range(count)]
        assert all(isinstance(s, str) for s in slots)
        assert code.upper() not in mapping
        mapping[code.upper()] = slots
        branches.append({'code': code, 'stringRVA': hex(literal-engine.base),
                         'branchRVA': hex(instructions[compare+1].address-engine.base),
                         'slots': slots, 'flexiblePhaseIndex': fields.get(0x504, -1)})
    assert len(mapping) == 32
    return {'status': 'verified', 'engineSHA256': engine.sha, 'coreSHA256': core.sha,
            'selectorRVA': hex(START), 'selectorSHA256': hashlib.sha256(engine.data[START:END]).hexdigest(),
            'animationColumnStoreRVA': '0x16e5e3', 'nameComparison': 'case-insensitive FName interning',
            'mapping': mapping, 'branches': branches,
            'flexiblePhases': {b['code'].upper(): b['flexiblePhaseIndex'] for b in branches},
            'limits': ['imported constructor/comparison calls are NOP-erased; static source proof only',
                       'phase scheduling/durations and renderer clip completeness are not verified here']}


def check_javascript(result):
    source = JAVASCRIPT.read_text()
    payload = re.search(r'const SLOTS = (\{.*?\});', source, re.S)
    assert payload, 'native skill slot table not found'
    assert json.loads(payload[1]) == result['mapping'], 'browser selector differs from original native branches'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = derive()
    if args.check:
        check_javascript(result)
    print(json.dumps(result if args.json else {'status': result['status'],
          'selectors': len(result['mapping']), 'selectorRVA': result['selectorRVA']}, indent=2))
