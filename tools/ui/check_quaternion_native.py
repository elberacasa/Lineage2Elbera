#!/usr/bin/env python3
"""Elbera Tools: original ordinary quaternion interpolation, bounded to one helper.

Pure functions and synthetic_cases() use only Python's standard library.
The source check reads pinned owned inputs; named-import correspondence requires
an explicit --comparison-engine. No binary execution or decoded payload output.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct

ROOT = Path(__file__).resolve().parents[2]
OLD_START, NEW_START, SIZE = 0x106ae090, 0x106ae050, 519
COPY_ABOVE = 0.9999998807907104
LINEAR_ABOVE = 0.550000011920929
MINIMUM_SQUARE = 9.999999747378752e-06
FALLBACK_COMPONENT = 0.10000000149011612
CONSTANTS = [(0x108e2140, 'd', COPY_ABOVE), (0x108e213c, 'f', LINEAR_ABOVE),
             (0x108a7494, 'f', MINIMUM_SQUARE), (0x1089df54, 'f', FALLBACK_COMPONENT)]
CALLS = [(0xcb, '?appAcos@@YANN@Z'), (0xdc, '?appSin@@YANN@Z'),
         (0xf8, '?appSin@@YANN@Z'), (0x110, '?appSin@@YANN@Z'), (0x1a7, '?appSqrt@@YANN@Z')]
MATH = {'?appAcos@@YANN@Z': math.acos, '?appSin@@YANN@Z': math.sin, '?appSqrt@@YANN@Z': math.sqrt}


def f32(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('finite numeric component required')
    try:
        value = struct.unpack('<f', struct.pack('<f', value))[0]
    except OverflowError as error:
        raise ValueError('finite Float32 component required') from error
    if not math.isfinite(value):
        raise ValueError('finite Float32 component required')
    return value


def quaternion(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError('four quaternion components required')
    return list(map(f32, value))


def interpolation_details(first, second, alpha):
    """Source branch/store policy, with Float64/Python math approximations.

    No normalization of inputs, hemisphere selection, or alpha/dot clamp is
    added. Invalid math domains and nonfinite results are rejected; this is an
    API boundary, not a claim about native exception or NaN behavior.
    """
    a, b, t = quaternion(first), quaternion(second), f32(alpha)
    dot = f32(((a[0]*b[0] + a[1]*b[1]) + a[2]*b[2]) + a[3]*b[3])
    if dot > COPY_ABOVE:
        return {'value': a, 'branch': 'copy', 'dot': dot}
    if dot > LINEAR_ABOVE:
        wa, wb, branch = f32(1-t), t, 'linear'
    else:
        theta = f32(math.acos(dot))
        inverse_sine = f32(1 / math.sin(theta))
        wa = f32(math.sin((1-t)*theta) * inverse_sine)
        wb = f32(math.sin(theta*t) * inverse_sine)
        branch = 'trigonometric'
    q = [f32(wa*x + wb*y) for x, y in zip(a, b)]
    square = f32(((q[1]*q[1] + q[0]*q[0]) + q[2]*q[2]) + q[3]*q[3])
    if square < MINIMUM_SQUARE:
        return {'value': [0., 0., FALLBACK_COMPONENT, 0.],
                'branch': branch + '-tiny-fallback', 'dot': dot, 'square': square}
    factor = f32(1 / f32(math.sqrt(square)))
    return {'value': [f32(v*factor) for v in q], 'branch': branch,
            'dot': dot, 'square': square}


def interpolate_quaternion(first, second, alpha):
    """Return four source-ordered components under the bounded model above."""
    return interpolation_details(first, second, alpha)['value']


def synthetic_cases():
    """Authored finite fixtures; no original keys, assets, or client reads."""
    identity = [0, 0, 0, 1]
    triples = [(identity, identity, .4), (identity, [0, 0, .6, .8], .3),
               (identity, [0, 0, 1, 0], .3), (identity, [0, 0, 0, -1], .5),
               ([0, 0, 0, 0], [0, 0, 0, 0], .5)]
    for dot in [LINEAR_ABOVE, f32(LINEAR_ABOVE+2**-24), f32(LINEAR_ABOVE-2**-24),
                COPY_ABOVE, f32(COPY_ABOVE+2**-24)]:
        triples.append((identity, [f32(math.sqrt(1-dot*dot)), 0, 0, dot], .37))
    rng = random.Random(0x51554154)
    for _ in range(200):
        pair = []
        for _ in range(2):
            q = [rng.uniform(-1, 1) for _ in range(4)]
            length = math.sqrt(sum(x*x for x in q))
            pair.append([f32(x/length) for x in q])
        triples.append((*pair, f32(rng.random())))
    return [{'first': list(a), 'second': list(b), 'alpha': t} for a, b, t in triples]


def evaluate_source(candidate, instructions, constants):
    """One bounded instruction body; no general VM or other import support."""
    from check_legacy_skill_effects_native import LinearX87

    class QuaternionSlice(LinearX87):
        def __init__(self, memory, registers):
            super().__init__(memory, registers)
            self.program = {i.address: i for i in instructions}
            self.status = 0
            self.zero = self.parity = False

        def read(self, operand):
            if operand == 'ah': return (self.status >> 8) & 0xff
            if operand.startswith('0x') or operand.lstrip('-').isdigit(): return int(operand, 0)
            return super().read(operand)

        def write(self, operand, value, floating=False):
            if operand in ('eax', 'ebx', 'ecx', 'edx', 'edi', 'esi', 'esp', 'ebp'):
                self.registers[operand] = value
            else: super().write(operand, value, floating)

        def body(self):
            pc = NEW_START
            for _ in range(256):
                ins = self.program[pc]
                op, args = ins.mnemonic, ins.op_str.split(', ')
                pc = ins.address + ins.size
                if op == 'push':
                    value = self.read(args[0]); self.registers['esp'] -= 4
                    self.memory[self.registers['esp']] = value
                elif op == 'pop':
                    self.write(args[0], self.memory[self.registers['esp']]); self.registers['esp'] += 4
                elif op in ('and', 'add', 'sub'):
                    assert args[0] == 'esp'
                    a, b = self.read(args[0]), self.read(args[1])
                    self.write(args[0], a & b if op == 'and' else a+b if op == 'add' else a-b)
                elif op in ('fcom', 'fcomp'):
                    a, b = self.stack[0], self.read(args[0])
                    assert math.isfinite(a) and math.isfinite(b)
                    self.status = 0x100 if a < b else 0x4000 if a == b else 0
                    if op == 'fcomp': self.stack.pop(0)
                elif op == 'fnstsw':
                    assert args == ['ax']
                    self.registers['eax'] = (self.registers.get('eax', 0) & 0xffff0000) | self.status
                elif op == 'test':
                    assert args[0] == 'ah'
                    bits = self.read(args[0]) & self.read(args[1])
                    self.zero, self.parity = bits == 0, bin(bits & 0xff).count('1') % 2 == 0
                elif op in ('jne', 'jp', 'jmp'):
                    if op == 'jmp' or op == 'jne' and not self.zero or op == 'jp' and self.parity:
                        pc = int(args[0], 16)
                elif op == 'call':
                    dll, name = candidate.imported_call(ins.address)
                    assert dll == 'core.dll' and name in MATH
                    result = MATH[name](self.memory[self.registers['esp']])
                    assert math.isfinite(result)
                    self.stack.insert(0, result)
                elif op == 'fdivrp':
                    at = int(args[0][3:-1]); a, b = self.stack[at], self.stack[0]
                    self.stack[at] = b/a; self.stack.pop(0)
                elif op == 'ret':
                    assert args == ['']
                    result = self.memory[self.registers['esp']]; self.registers['esp'] += 4
                    return result
                else: super().run([ins])
            raise AssertionError('bounded quaternion step limit')

    counts = {}
    for index, case in enumerate(synthetic_cases()):
        a, b, t = case['first'], case['second'], case['alpha']
        memory = dict(constants)
        sp, first, second, out = 0x900c, 0x2000, 0x3000, 0x4000
        memory.update({sp: 0xabcdef, sp+4: first, sp+8: second, sp+12: f32(t), sp+16: out})
        memory.update({first+k*4: f32(v) for k, v in enumerate(a)})
        memory.update({second+k*4: f32(v) for k, v in enumerate(b)})
        registers = {'esp': sp, 'ebp': 0x7770, 'ebx': 0x7780, 'esi': 0x7790, 'edi': 0x77a0}
        machine = QuaternionSlice(memory, registers)
        assert machine.body() == 0xabcdef
        assert machine.registers['esp'] == sp+4 and not machine.stack
        for reg in ('ebp', 'ebx', 'esi', 'edi'): assert machine.registers[reg] == registers[reg]
        actual = [machine.memory[out+k*4] for k in range(4)]
        expected = interpolation_details(a, b, t)
        assert actual == expected['value'], (index, actual, expected)
        branch = expected['branch']; counts[branch] = counts.get(branch, 0)+1
    return {'cases': sum(counts.values()), 'branchCases': counts,
            'ABI': 'cdecl A/B/alpha/output at entry ESP+4/+8/+12/+16; caller cleanup'}


def verify(comparison_engine=None):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_supplemental_engine import compare_method, CANDIDATE_ENGINE_SHA, CORE_SHA
    from supplemental_pe import PEImage

    owned = Image(ROOT/'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    read_owned = lambda va, n: bytes(owned.data[owned.offset(va):owned.offset(va)+n])
    stub = 0x1030f024
    owned.instruction(stub, 'jmp', hex(OLD_START))
    old = read_owned(OLD_START, SIZE)
    assert hashlib.sha256(old).hexdigest() == '094131c196c85a7656129d56adacdb2ccb938ea209427559c17b71891eccf839'
    constants = {}
    for va, kind, value in CONSTANTS:
        assert struct.unpack('<'+kind, read_owned(va, struct.calcsize('<'+kind)))[0] == value
        constants[va] = value
    for offset, _ in CALLS:
        assert read_owned(OLD_START+offset, 6) == b'\x90'*6
    core = PEImage(ROOT/'assets/interlude/system/Core.dll', CORE_SHA)
    wrappers = []
    for symbol, va, target in [('?appAcos@@YANN@Z', 0x1012d750, 0x1017c7e0),
                               ('?appSin@@YANN@Z', 0x1012d720, 0x1017c430),
                               ('?appSqrt@@YANN@Z', 0x1012d790, 0x1017cb60)]:
        assert core.body(symbol) == va
        raw = core.read(va, 9)
        assert raw[:4] == b'\xdd\x44\x24\x04' and raw[4] == 0xe9
        assert va+9+struct.unpack('<i', raw[5:])[0] == target
        wrappers.append({'symbol': symbol, 'VA': hex(va), 'targetVA': hex(target),
                         'SHA256': hashlib.sha256(raw).hexdigest()})
    result = {'status': 'owned-body-verified-imports-erased', 'ownedEngineSHA256': owned.sha,
              'ownedCoreSHA256': core.sha, 'ownedRange': [hex(OLD_START), hex(OLD_START+SIZE)],
              'ownedBodySHA256': hashlib.sha256(old).hexdigest(), 'ownedErasedCallCount': len(CALLS),
              'constants': [{'VA': hex(va), 'type': kind, 'value': value} for va, kind, value in CONSTANTS],
              'ownedNamedMathWrappers': wrappers, 'namedImportCorrespondence': None,
              'instructionComparisons': None,
              'limits': ['supplemental archive is not vendor authenticated',
                         'Float64/Python math with explicit f32 stores; not exact CRT/x87/FPU-control parity',
                         'finite domain only; unordered comparisons and native exceptions not emulated',
                         'no hemisphere selection, clamp, compressed-key or separate tween-helper proof',
                         'no original code executed, decoded payload emitted or game assets changed']}
    if comparison_engine is not None:
        candidate = PEImage(comparison_engine, CANDIDATE_ENGINE_SHA)
        assert candidate.read(stub, 1) == b'\xe9'
        assert stub+5+struct.unpack('<i', candidate.read(stub+1, 4))[0] == NEW_START
        new = candidate.read(NEW_START, SIZE)
        correspondence = compare_method(old, new, OLD_START, NEW_START, candidate.imported_call,
                                         read_owned, candidate.read)
        assert len(correspondence['differences']) == len(CALLS)
        for row, (offset, symbol) in zip(correspondence['differences'], CALLS):
            assert (row['kind'], row['offset'], row['binding']) == ('named-import', hex(offset), ['core.dll', symbol])
        for va, kind, _ in CONSTANTS:
            count = struct.calcsize('<'+kind)
            assert read_owned(va, count) == candidate.read(va, count)
        instructions = list(owned.dis.disasm(new, NEW_START))
        assert instructions[-1].address+instructions[-1].size == NEW_START+SIZE
        result.update(status='supplemental-imports-and-bounded-arithmetic-verified',
                      comparisonEngineSHA256=candidate.sha, namedImportCorrespondence=correspondence,
                      instructionComparisons=evaluate_source(candidate, instructions, constants))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comparison-engine', type=Path, help='explicit pinned supplemental Engine.dll for import bindings')
    parser.add_argument('--check', action='store_true', help='print a compact result instead of metadata JSON')
    args = parser.parse_args()
    result = verify(args.comparison_engine)
    if args.check:
        if result['instructionComparisons']:
            print('Quaternion: 519 complete method bytes, 5 supplemental named imports, 4 source constants, '
                  f"{result['instructionComparisons']['cases']} bounded instruction comparisons; archive unauthenticated.")
        else:
            print('Quaternion: owned 519-byte body and 4 constants verified; 5 calls remain erased. '
                  'No named-import or instruction-arithmetic claim without --comparison-engine.')
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
