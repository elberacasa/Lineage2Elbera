#!/usr/bin/env python3
"""Elbera Tools: bounded original local-pose and parent-coordinate arithmetic.

Portable formulas need no client assets or third-party modules. --check reads
the owner's pinned binaries; optional comparison copies are independently
pinned and never treated as restored owned imports. No native code execution.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct

from check_hair_attachment_native import f32, record12, quaternion_record
from check_legacy_skill_effects_native import LinearX87

ROOT = Path(__file__).resolve().parents[2]
THRESHOLD_BYTES = bytes.fromhex('3a8c30e28e79453e')
NORMALIZE_THRESHOLD = struct.unpack('<d', THRESHOLD_BYTES)[0]
RANGES = {
    'ApplyPivot': (0x1014d8c0, 0x1014d98a),
    'WithoutScale': (0x1014d9c0, 0x1014daf3),
    'PivotInverse': (0x1014db40, 0x1014dd1a),
    'GetNormalized': (0x1010cbb0, 0x1010cc41),
    'VectorHelper': (0x1010f5b0, 0x1010f618),
}
SYMBOLS = {
    'ApplyPivot': '?ApplyPivot@FCoords@@QBE?AV1@ABV1@@Z',
    'WithoutScale': '?ApplyPivotWithoutScale@FCoords@@QBE?AV1@ABV1@@Z',
    'PivotInverse': '?PivotInverse@FCoords@@QBE?AV1@XZ',
    'GetNormalized': '?GetNormalized@FVector@@QAE?AV1@XZ',
}
COMPARISON_CORE_SHA = 'd83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639'


def vector3(value):
    if not isinstance(value, (tuple, list)) or len(value) != 3:
        raise ValueError('three vector components required')
    return list(map(f32, value))


def vector_by(coords, vector):
    """Retained helper: row dot vector, one output f32 store per row."""
    c, v = record12(coords), vector3(vector)
    return [f32((v[0]*c[3+r*3] + v[1]*c[4+r*3]) + v[2]*c[5+r*3]) for r in range(3)]


def normalized_row(vector):
    x, y, z = vector3(vector)
    squared = f32((y*y + x*x) + z*z)
    if squared < NORMALIZE_THRESHOLD:
        return [0., 0., 0.]
    # Native appSqrt returns to x87; there is no intervening f32 sqrt store.
    reciprocal = f32(1. / math.sqrt(squared))
    return [f32(v*reciprocal) for v in (x, y, z)]


def apply_pivot(receiver, operand):
    c, p = record12(receiver), record12(operand)
    translated = vector_by(p, c[:3])
    out = [f32(p[i]+translated[i]) for i in range(3)]
    for i in range(3):
        out.extend(vector_by(c, p[3+i*3:6+i*3]))
    return out


def apply_pivot_without_scale(receiver, operand):
    """Only operand rows are normalized; origin and receiver scale remain."""
    c, p = record12(receiver), record12(operand)
    translated = vector_by(p, c[:3])
    out = [f32(p[i]+translated[i]) for i in range(3)]
    for i in range(3):
        out.extend(vector_by(c, normalized_row(p[3+i*3:6+i*3])))
    return out


def pivot_inverse(coords):
    c = record12(coords)
    a, b, z, d, e, f, g, h, i = c[3:]
    determinant = f32((((g*f-i*d)*b) + ((e*i-f*h)*a)) + ((d*h-e*g)*z))
    if determinant == 0:
        raise ValueError('singular stored determinant outside admitted domain')
    reciprocal = f32(1/determinant)
    cofactors = [f32(i*e-h*f), f32(h*z-b*i), f32(b*f-z*e),
                 f32(f*g-i*d), f32(a*i-z*g), f32(z*d-f*a),
                 f32(h*d-e*g), f32(b*g-h*a), f32(a*e-b*d)]
    result = [0., 0., 0., *[f32(value*reciprocal) for value in cofactors]]
    result[:3] = vector_by(result, [f32(-v) for v in c[:3]])
    return result


def pose_hierarchy(local_poses, parents, *, mode):
    """Compose supplied local poses; excludes native modifiers/root overrides.

    One source root at index 0 (parent 0); every other parent precedes its
    child. Returns records, never mutates inputs or applies a browser basis.
    Caller must explicitly choose reference or current composition.
    """
    if mode not in ('reference', 'current'):
        raise ValueError('explicit reference/current hierarchy mode required')
    if not isinstance(local_poses, (list, tuple)) or not local_poses \
            or not isinstance(parents, (list, tuple)) or len(parents) != len(local_poses):
        raise ValueError('complete local poses and parent indices required')
    for index, parent in enumerate(parents):
        if type(parent) is not int or (parent != 0 if index == 0 else not 0 <= parent < index):
            raise ValueError('one root and preceding source parents required')
    local = []
    for pose in local_poses:
        if not isinstance(pose, dict):
            raise ValueError('original quaternion and position required')
        local.append(quaternion_record(pose.get('quaternion'), pose.get('position')))
    compose = apply_pivot if mode == 'reference' else apply_pivot_without_scale
    result = [local[0]]
    for index in range(1, len(local)):
        result.append(compose(local[index], result[parents[index]]))
    return result


def synthetic_cases():
    """Authored public corpus; no original keys or package-derived values."""
    identity = [0,0,0,1,0,0,0,1,0,0,0,1]
    c = [10,20,30,0,-1,0,1,0,0,0,0,2]
    p = [3,-4,5,2,1,0,0,3,1,1,0,4]
    small = f32(.0001); bits = struct.unpack('<I', struct.pack('<f', small))[0]
    vectors = [[0,0,0], [-0.,0.,-0.], [1,0,0], [-9,0,0], [2,3,7],
               [1.234567,8.765432,-4.345678], [small,f32(2e-8),0],
               [struct.unpack('<f',struct.pack('<I',1))[0],0,0]]
    vectors += [[struct.unpack('<f',struct.pack('<I',bits+i))[0],0,0] for i in range(-3,4)]
    rng = random.Random(148493)
    vectors += [[f32(rng.uniform(-9,9)*10**rng.randint(-6,6)) for _ in range(3)] for _ in range(100)]
    pairs = [(identity,identity), (c,p), (p,c),
        (identity,[5,6,7,2,1,0,4,2,0,0,0,3]),
        ([9,-2,4,2,0,0,0,-3,0,0,0,4],p), (c,[5,6,7,2,0,0,0,3,0,0,0,4]),
        ([0,0,0,16777216,1,-16777216,0,1,0,0,0,1],[1,1,1,1,1,1,0,1,0,0,0,1]),
        ([16777216,1,0,*identity[3:]],[-16777216,0,0,1,1,0,0,1,0,0,0,1])]
    pairs += [(c,[3,-4,5,*v,*v,*v]) for v in vectors]
    pairs += [([f32(rng.uniform(-50,50)) for _ in range(12)],
               [f32(rng.uniform(-50,50)) for _ in range(12)]) for _ in range(100)]
    inverses = [identity,c,p,[2,-3,4,2,0,0,0,3,0,0,0,-4]] + [pair[0] for pair in pairs[-100:]]
    quaternions = [([0,0,0,1],[0,0,0]), ([.5,.5,.5,.5],[1,2,3]),
                   ([0,0,1,1],[-10,34,.125]), ([.123,-.3,.78,-.45],[15,-20,3])]
    quaternions += [([f32(rng.uniform(-2,2)) for _ in range(4)],
                     [f32(rng.uniform(-100,100)) for _ in range(3)]) for _ in range(100)]
    return {'vectors':vectors, 'pairs':pairs, 'inverses':inverses, 'quaternions':quaternions}


class CoordinateSlice(LinearX87):
    """Existing x87 evaluator plus only these bodies' stack/call/branch rules."""
    def __init__(self, memory, registers, program):
        super().__init__(memory, registers)
        self.program = program; self.addresses = set(); self.executed = 0
        self.c0 = self.zero = None; self.branches = []; self.sqrt_calls = 0

    def read(self, operand):
        if operand == 'ah': return (int(self.registers['eax']) >> 8) & 255
        if operand.startswith('0x') or operand.lstrip('-').isdigit(): return int(operand, 0)
        return super().read(operand)

    def write(self, operand, value, floating=False):
        if operand in ('eax','ebx','ecx','edx','edi','esi','esp','ebp'):
            self.registers[operand] = value
        else: super().write(operand, value, floating)

    def push(self, value):
        self.registers['esp'] -= 4; self.memory[self.registers['esp']] = value

    def pop(self):
        value = self.memory[self.registers['esp']]; self.registers['esp'] += 4
        return value

    def body(self, name):
        rows = self.program[name]; indices = {r.address:i for i,r in enumerate(rows)}
        index = 0
        while index < len(rows):
            ins = rows[index]; index += 1; self.executed += 1; self.addresses.add(ins.address)
            op, args = ins.mnemonic, ins.op_str.split(', ')
            if op == 'push': self.push(self.read(args[0]))
            elif op == 'pop': self.write(args[0], self.pop())
            elif op in ('add','sub'):
                assert args[0] in ('esp','edi')
                self.write(args[0], self.read(args[0])+(1 if op == 'add' else -1)*self.read(args[1]))
            elif op == 'lea': self.write(args[0], self.address('dword ptr '+args[1]))
            elif op == 'call':
                target, sp, ret = args[0], self.registers['esp'], ins.address+ins.size
                if target in ('0x10101dd4','0x1010493a'):
                    assert target != '0x1010493a' or name == 'WithoutScale'
                    self.push(ret)
                    assert self.body('VectorHelper' if target == '0x10101dd4' else 'GetNormalized') == ret
                elif target == '0x10104840':
                    assert name == 'GetNormalized' and ins.address == 0x1010cbe7
                    value = self.memory[sp]
                    assert math.isfinite(value) and value >= NORMALIZE_THRESHOLD
                    self.sqrt_calls += 1; self.push(ret)
                    self.stack.insert(0, math.sqrt(value))  # Explicit named CRT boundary.
                    assert self.pop() == ret
                else: raise AssertionError('unbound coordinate call '+target)
            elif op == 'fcom':
                assert ins.address == 0x1010cbd4 and args == ['qword ptr [0x101cdf50]']
                a,b = self.stack[0],self.read(args[0]); assert math.isfinite(a) and math.isfinite(b)
                self.c0 = int(a < b)
            elif op == 'fnstsw':
                assert ins.address == 0x1010cbda and args == ['ax'] and self.c0 is not None
                self.registers['eax'] = (int(self.registers.get('eax',0)) & ~0xffff) | self.c0 << 8
            elif op == 'test':
                assert ins.address == 0x1010cbdc and args == ['ah','1']
                self.zero = (self.read(args[0]) & self.read(args[1])) == 0
            elif op == 'jne':
                assert ins.address == 0x1010cbdf and args == ['0x1010cc2c'] and self.zero is not None
                self.branches.append('normalize' if self.zero else 'zero')
                if not self.zero: index = indices[int(args[0],0)]
            elif op == 'ret':
                ret = self.pop(); self.registers['esp'] += int(args[0],0) if args[0] else 0
                return ret
            elif op in ('fsubp','fdivrp'):
                target = int(args[0][3:-1]); a,b = self.stack[0],self.stack[target]
                self.stack[target] = b-a if op == 'fsubp' else a/b; self.stack.pop(0)
            elif op == 'fchs': self.stack[0] = -self.stack[0]
            else: super().run([ins])
        raise AssertionError('native return not reached')


def packed(values): return struct.pack('<'+'f'*len(values), *values)


def execute(name, receiver, operand, program):
    out,this,arg,sp,ret = 0x2000,0x3000,0x4000,0x9000,0xBADF00D
    original = list(map(f32,receiver)); memory = {this+i*4:v for i,v in enumerate(original)}
    memory.update({sp:ret,sp+4:out,0x101cdf50:NORMALIZE_THRESHOLD})
    if name in ('ApplyPivot','WithoutScale'):
        operand = record12(operand); memory[sp+8] = arg
        memory.update({arg+i*4:v for i,v in enumerate(operand)})
    elif name == 'VectorHelper':
        memory.update({sp+4:this,sp+8:arg,sp+12:out})
        memory.update({arg+i*4:v for i,v in enumerate(vector3(operand))})
    machine = CoordinateSlice(memory, {'ecx':this,'esp':sp,'ebx':0x7770,'esi':0x7780,'edi':0x7790}, program)
    assert machine.body(name) == ret and not machine.stack
    if name != 'VectorHelper': assert machine.registers['eax'] == out
    for reg,value in [('ebx',0x7770),('esi',0x7780),('edi',0x7790)]: assert machine.registers[reg] == value
    cleanup = 8 if name in ('ApplyPivot','WithoutScale') else 0 if name == 'VectorHelper' else 4
    assert machine.registers['esp'] == sp+4+cleanup
    if name != 'GetNormalized':
        assert packed([machine.memory[this+i*4] for i in range(len(original))]) == packed(original)
    if name in ('ApplyPivot','WithoutScale'):
        assert packed([machine.memory[arg+i*4] for i in range(12)]) == packed(operand)
    width = 3 if name in ('VectorHelper','GetNormalized') else 12
    return [machine.memory[out+i*4] for i in range(width)], machine


def verify(*, comparison_engine=None, comparison_core=None):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    from check_hair_attachment_native import check_quaternion
    core = Image(ROOT/'assets/interlude/system/Core.dll', CORE_SHA)
    engine = Image(ROOT/'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    program, bodies = {}, []
    for name,(start,end) in RANGES.items():
        raw = core.data[core.offset(start):core.offset(end)]
        rows = list(core.dis.disasm(raw,start))
        assert rows[0].address == start and rows[-1].address+rows[-1].size == end and rows[-1].mnemonic == 'ret'
        if name in SYMBOLS: assert core.exported(SYMBOLS[name], True) == start
        program[name] = rows
        bodies.append({'method':name,'startVA':hex(start),'endVAExclusive':hex(end),
                       'instructions':len(rows),'SHA256':hashlib.sha256(raw).hexdigest()})
    assert core.exported('?appSqrt@@YANN@Z', True) == 0x1012d790
    for anchor in [(0x10101dd4,'jmp','0x1010f5b0'), (0x1010493a,'jmp','0x1010cbb0'),
                   (0x10104840,'jmp','0x1012d790'), (0x1012d790,'fld','qword ptr [esp + 4]'),
                   (0x1012d794,'jmp','0x1017cb60'), (0x1017cb9c,'fsqrt','')]: core.instruction(*anchor)
    assert bytes(core.data[core.offset(0x101cdf50):core.offset(0x101cdf50)+8]) == THRESHOLD_BYTES
    current_anchors = [(0x106db9c3,'mov','eax, 1'),
        (0x106db9fe,'mov','eax, dword ptr [eax + edx + 0x34]'),
        (0x106dba02,'mov','ecx, dword ptr [ebp + 0xc4]'),
        (0x106dba14,'push','eax'), (0x106dba15,'lea','edi, [edx + ecx]'),
        (0x106dba1f,'push','eax'), (0x106dba20,'mov','ecx, edi'),
        (0x106dba31,'rep movsd','dword ptr es:[edi], dword ptr [esi]')]
    for anchor in current_anchors: engine.instruction(*anchor)
    assert engine.data[engine.offset(0x106dba22):engine.offset(0x106dba22)+6] == b'\x90'*6
    cases = synthetic_cases(); union = set(); counts = {}; branches = {'zero':0,'normalize':0}; sqrt_calls = 0
    jobs = [('ApplyPivot',[(a,b) for a,b in cases['pairs']],apply_pivot),
            ('WithoutScale',[(a,b) for a,b in cases['pairs']],apply_pivot_without_scale),
            ('PivotInverse',[(a,None) for a in cases['inverses']],pivot_inverse),
            ('GetNormalized',[(a,None) for a in cases['vectors']],normalized_row),
            ('VectorHelper',[(a,b[:3]) for a,b in cases['pairs']],vector_by)]
    for name,inputs,formula in jobs:
        counts[name] = len(inputs)
        for a,b in inputs:
            actual,machine = execute(name,a,b,program)
            expected = formula(a) if b is None else formula(a,b)
            assert packed(actual) == packed(expected), (name,a,b,actual,expected)
            union |= machine.addresses; sqrt_calls += machine.sqrt_calls
            for branch in machine.branches: branches[branch] += 1
    assert union == {r.address for rows in program.values() for r in rows}
    result = {'format':'elbera-pose-coordinate-evidence-v1','coreSHA256':core.sha,'engineSHA256':engine.sha,
        'bodies':bodies,'comparisons':counts,'allBodyInstructionsCovered':len(union),
        'quaternionArithmetic':check_quaternion(engine,cases['quaternions']),
        'normalizationBranches':branches,'namedSqrtEvaluations':sqrt_calls,
        'normalizationThreshold':{'type':'Float64','VA':'0x101cdf50','bytesLE':THRESHOLD_BYTES.hex()},
        'currentHierarchyABI':{'instructionChecks':len(current_anchors),'sourceParentOffset':'0x34',
            'instanceTableOffset':'0xc4','receiver':'current child record','operand':'already composed parent record',
            'return':'12 DWORD temporary copied back over child; loop starts at bone 1'},
        'comparison':'Core formula outputs equal evaluated output Float32 bits; no tolerance',
        'engineCurrentParentCall':'owned six-NOP site 0x106dba22; optional comparison names the call',
        'limits':['Number/Float64 intermediates approximate x87; no native execution or FPU-control proof',
                  'appSqrt is a named math.sqrt boundary; CRT status/precision behavior not evaluated',
                  'finite inputs and finite stored results only; inverse rejects stored zero determinant',
                  'base hierarchy only; root-motion overrides, bone modifiers, world basis and hair simulation excluded']}
    if comparison_engine is not None:
        from check_hair_attachment_native import comparison_evidence, compare_call_block, COMPARISON_SHA
        from supplemental_pe import PEImage
        candidate = PEImage(comparison_engine, COMPARISON_SHA)
        method = '?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z'
        start,end = 0x106db9f0,0x106dba33
        cstart = start+candidate.body(method)-engine.exported(method,True)
        result['comparisonEngine'] = {'priorReferenceBinding':comparison_evidence(comparison_engine),
            'currentParentBinding':compare_call_block(engine.data[engine.offset(start):engine.offset(end)],
                candidate.read(cstart,end-start),owned_va=start,candidate_va=cstart,
                sites=[(0x106dba22-start,('core.dll',SYMBOLS['WithoutScale']))],direct_calls=[],imports=candidate.imports),
            'limit':'separate copy correspondence, not authenticity or owned import restoration'}
    if comparison_core is not None:
        from supplemental_pe import PEImage
        candidate = PEImage(comparison_core, COMPARISON_CORE_SHA); compared = []
        for name in SYMBOLS:
            start,end = RANGES[name]; cstart = candidate.body(SYMBOLS[name])
            assert bytes(core.data[core.offset(start):core.offset(end)]) == candidate.read(cstart,end-start)
            compared.append({'method':name,'candidateVA':hex(cstart),'bytes':end-start,'exact':True})
        result['comparisonCore'] = {'SHA256':candidate.sha,'methods':compared,
                                   'limit':'method byte correspondence does not authenticate the copy'}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='read pinned original binaries and evaluate retained arithmetic')
    parser.add_argument('--comparison-engine',type=Path,help='optional separately obtained pinned comparison Engine.dll')
    parser.add_argument('--comparison-core',type=Path,help='optional separately obtained pinned comparison Core.dll')
    parser.add_argument('--out',type=Path,help='optional private JSON receipt below repository tmp/')
    args = parser.parse_args()
    if not args.check: parser.error('--check is required; portable formulas are importable without original inputs')
    if args.out and not args.out.resolve().is_relative_to((ROOT/'tmp').resolve()):
        parser.error('--out must remain below repository tmp/')
    result = verify(comparison_engine=args.comparison_engine,comparison_core=args.comparison_core)
    if args.out:
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ('format','comparisons','allBodyInstructionsCovered','quaternionArithmetic')}))


if __name__ == '__main__': main()
