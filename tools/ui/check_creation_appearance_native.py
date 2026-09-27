#!/usr/bin/env python3
"""Elbera Tools: original creation-option lists and their request fields.

Requires pinned NWindow.dll/Engine.dll and Capstone. Reads original instructions
without executing DLLs or exporting proprietary payloads. --check is compact.
"""
import argparse
import hashlib
import json
import re


def option_lists(instructions, add_address):
    """Decode straight-line control / literal / append triples, fail closed."""
    rows = list(instructions)
    if len(rows) % 3:
        raise ValueError('incomplete option append triple')
    result = {}
    for load, value, call in zip(rows[::3], rows[1::3], rows[2::3]):
        match = re.fullmatch(r'ecx, dword ptr \[esi \+ (0x[0-9a-f]+)\]', load.op_str)
        if load.mnemonic != 'mov' or not match or value.mnemonic != 'push' or (
                call.mnemonic, call.op_str) != ('call', hex(add_address)):
            raise ValueError('unsupported option append instructions')
        result.setdefault(int(match[1], 0), []).append(int(value.op_str, 0))
    return result


def sex_options(instructions, start, end, race, occupation, sex, *, add_address, clear_slot=0x174):
    """Restricted original branch interpreter. Calls are modeled append/clear
    operations only, never executed. Unknown reads, targets or instructions fail.
    """
    code = {i.address: i for i in instructions}
    regs = {'ebp': 0, 'edi': sex}
    fields = {0x1f0: race, 0x1f4: occupation, 0x1d8: ('control', 0x1d8)}
    stack, options, compared, pc = [], [], None, start

    def read(value):
        if value in regs:
            return regs[value]
        if value == 'dword ptr [esp + 0x14]':
            return sex
        m = re.fullmatch(r'dword ptr \[esi \+ (0x[0-9a-f]+)\]', value)
        if m and int(m[1], 0) in fields:
            return fields[int(m[1], 0)]
        if value == 'dword ptr [ecx]' and regs.get('ecx') == ('control', 0x1d8):
            return ('vtable', 0x1d8)
        if value == f'dword ptr [edx + {hex(clear_slot)}]' and regs.get('edx') == ('vtable', 0x1d8):
            return ('clear', 0x1d8)
        if re.fullmatch(r'-?(?:0x[0-9a-f]+|[0-9]+)', value):
            return int(value, 0)
        raise ValueError('unsupported selector operand: ' + value)

    for _ in range(200):
        if pc == end:
            if stack:
                raise ValueError('unconsumed selector arguments')
            return options
        if pc not in code:
            raise ValueError('selector branch escaped audited body')
        ins = code[pc]
        pc += ins.size
        args = ins.op_str.split(', ')
        if ins.mnemonic == 'mov' and args[0] in ('eax', 'ecx', 'edx', 'edi'):
            regs[args[0]] = read(args[1])
        elif ins.mnemonic == 'cmp':
            compared = (read(args[0]), read(args[1]))
        elif ins.mnemonic in ('je', 'jne', 'jmp'):
            if ins.mnemonic != 'jmp' and compared is None:
                raise ValueError('conditional branch without comparison')
            if ins.mnemonic == 'jmp' or (compared[0] == compared[1]) == (ins.mnemonic == 'je'):
                pc = int(ins.op_str, 0)
        elif ins.mnemonic == 'push':
            stack.append(read(ins.op_str))
        elif ins.mnemonic == 'call' and ins.op_str == hex(add_address):
            if regs.get('ecx') != ('control', 0x1d8) or len(stack) != 1 or not isinstance(stack[0], int):
                raise ValueError('invalid append context')
            options.append(stack.pop())
        elif ins.mnemonic == 'call' and ins.op_str == 'eax' and regs.get('eax') == ('clear', 0x1d8):
            options.clear()
        else:
            raise ValueError('unsupported selector instruction: ' + ins.mnemonic + ' ' + ins.op_str)
    raise ValueError('selector exceeded bounded instruction count')


def verify():
    from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA
    from check_numberpad_native import import_names
    n = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    assert n.wide(0x10291b38) == 'NCPawnSetupWnd::OnDestroy'
    assert n.wide(0x10291d58) == 'NCPawnSetupWnd::OnPaint'
    assert import_names(n)[0x1022c37c] == ('Core.dll', '?Add@FArray@@QAEHHH@Z')
    assert import_names(n)[0x1022c434] == ('Core.dll', '?Empty@FArray@@QAEXHH@Z')
    assert n.u32(0x10291db4 + 0x174) == 0x10199ac0
    anchors = [
        (n, 0x10198e4a, 'lea', 'esi, [ecx + 0x2f0]'),
        (n, 0x10198e50, 'push', '4'), (n, 0x10198e52, 'push', '1'),
        (n, 0x10198e56, 'call', 'dword ptr [0x1022c37c]'),
        (n, 0x10198e5e, 'mov', 'dword ptr [ecx + eax*4], edi'),
        (n, 0x10199a70, 'mov', 'dword ptr [esi], 0x10291db4'),
        (n, 0x10199ac3, 'push', '0'), (n, 0x10199ac5, 'push', '4'),
        (n, 0x10199ac7, 'lea', 'ecx, [esi + 0x2f0]'),
        (n, 0x10199acd, 'call', 'dword ptr [0x1022c434]'),
        (n, 0x10199ad3, 'mov', 'dword ptr [esi + 0x2ec], 0xffffffff'),
        # Race selection always offers fighter; only Dwarf (race4) skips mage.
        (n, 0x10199077, 'mov', 'dword ptr [esi + 0x1f0], ebx'),
        (n, 0x101990a5, 'mov', 'ecx, dword ptr [esi + 0x1d0]'),
        (n, 0x101990ab, 'push', '0xaf'),
        (n, 0x101990b0, 'call', '0x10198e40'),
        (n, 0x101990b5, 'cmp', 'ebx, 3'),
        (n, 0x101990b8, 'je', '0x101990bf'),
        (n, 0x101990ba, 'cmp', 'ebx, 4'),
        (n, 0x101990bd, 'je', '0x101990cf'),
        (n, 0x101990c5, 'push', '0xb0'),
        (n, 0x101990ca, 'call', '0x10198e40'),
        (n, 0x10199766, 'mov', 'dword ptr [esi + 0x1f8], edi'),
        (n, 0x1019976c, 'mov', 'dword ptr [esi + 0x1fc], ebp'),
        (n, 0x10199772, 'mov', 'dword ptr [esi + 0x200], ebp'),
        (n, 0x10199778, 'mov', 'dword ptr [esi + 0x204], ebp'),
        # Setup selections become final three DWORDs of UCharacterInfo.
        (n, 0x10198bff, 'mov', 'ecx, dword ptr [esi + 0x200]'),
        (n, 0x10198c09, 'mov', 'edx, dword ptr [esi + 0x1fc]'),
        (n, 0x10198c0f, 'mov', 'dword ptr [esp + 0x5c], edx'),
        (n, 0x10198c13, 'mov', 'eax, dword ptr [esi + 0x204]'),
        (n, 0x10198c19, 'sub', 'esp, 0x60'),
        (n, 0x10198c1e, 'mov', 'dword ptr [esp + 0xc4], eax'),
        (n, 0x10198c25, 'mov', 'ecx, 0x18'),
        (n, 0x10198c2a, 'lea', 'esi, [esp + 0x68]'),
        (n, 0x10198c36, 'call', '0x10142000'),
        (n, 0x1014205d, 'mov', 'eax, dword ptr [edx + 0x158]'),
        (e, 0x10404320, 'mov', 'edx, dword ptr [esp + 0x60]'),
        (e, 0x10404325, 'mov', 'edx, dword ptr [esp + 0x60]'),
        (e, 0x1040432a, 'mov', 'edx, dword ptr [esp + 0x60]'),
        (e, 0x10404366, 'push', '0xb'),
        (e, 0x10404368, 'push', '0x1087fce0'),
    ]
    for image, *anchor in anchors:
        image.instruction(*anchor)
    symbol = '?RequestCharacterCreate@UNetworkHandler@@UAEHUCharacterInfo@@@Z'
    assert e.exported(symbol, True) == 0x10404320
    assert e.u32(e.exported('??_7UNetworkHandler@@6BUObject@@@') + 0x158) == e.exported(symbol)
    off = e.offset(0x1087fce0)
    assert e.data[off:e.data.index(0, off)] == b'cSdddddddddddd'
    ranges = {}

    def body(name, image, start, end):
        raw = image.data[image.offset(start):image.offset(end)]
        ranges[name] = {'startVA': hex(start), 'endVA': hex(end), 'SHA256': hashlib.sha256(raw).hexdigest()}
        return list(image.dis.disasm(raw, start))

    initial = option_lists(body('initialOptions', n, 0x10198e73, 0x10198fe3), 0x10198e40)
    branch = body('sexOptions', n, 0x1019964f, 0x10199760)
    body('optionAppend', n, 0x10198e40, 0x10198e66)
    body('optionClear', n, 0x10199ac0, 0x10199adf)
    body('raceOccupationOptions', n, 0x10199060, 0x101990cf)
    body('requestPacking', e, 0x10404320, 0x10404373)
    body('creationPacking', n, 0x10198bff, 0x10198c3b)
    combinations = []
    for race in range(len(initial[0x1cc])):
        for occupation in range(1 if race == 4 else 2):
            for sex in range(len(initial[0x1d4])):
                styles = sex_options(branch, 0x1019964f, 0x10199760, race, occupation, sex, add_address=0x10198e40)
                assert len(styles) == (5 if sex == 0 else 7)
                combinations.append({'race': race, 'occupation': occupation, 'sex': sex,
                                     'styleSysStringIds': styles, 'colorSysStringIds': initial[0x1dc],
                                     'faceSysStringIds': initial[0x1e0]})
    assert len(initial[0x1dc]) == 4 and len(initial[0x1e0]) == 3
    return {'format': 'elbera-native-creation-appearance-v1', 'status': 'verified-options',
            'nwindowSHA256': n.sha, 'engineSHA256': e.sha, 'instructionChecks': len(anchors),
            'ranges': ranges, 'combinations': combinations,
            'request': {'opcode': 11, 'finalDwords': ['hairStyle', 'hairColor', 'face']},
            'limits': ['offered UI options are not inferred from available meshes or palette pixels',
                       'preview User initialization and protected empty-FName helper bindings remain unresolved',
                       'does not certify complete renderer, equipment overrides, or server creation rules']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = verify()
    print(f"PASS Elbera Tools creation appearance: {result['instructionChecks']} anchors, "
          f"{len(result['ranges'])} ranges, {len(result['combinations'])} original option paths"
          if args.check else json.dumps(result, indent=2))
