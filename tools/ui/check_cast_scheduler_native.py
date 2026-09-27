#!/usr/bin/env python3
"""Elbera Tools: static evidence for Interlude's ordinary cast scheduler.

Reads pinned original Engine.dll bytes; never executes or emits the DLL.
The small arithmetic evaluator consumes disassembled instructions from the
bounded InitSkillProcess arithmetic region, rejects calls/unknown operations,
and compares finite synthetic cases with the documented equations. Python
Float64 intermediates approximate x87 precision; source Float32 stores are
retained. This is not an executable original client or a runtime scheduler.
"""
import argparse
import hashlib
import json
import math
import re
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
from check_skillanim_native import derive as derive_slots


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


class Arithmetic:
    """Evaluate only the original bounded, call-free timing arithmetic."""
    def __init__(self, image, memory, stack, registers):
        self.image, self.memory = image, dict(memory)
        self.stack, self.registers = list(stack), dict(registers)
        self.flags, self.status, self.trace = {}, 0, []

    def address(self, operand):
        expression = operand[operand.index('[') + 1:operand.index(']')]
        total = 0
        for sign, term in re.findall(r'([+-]?)\s*([^+-]+)', expression):
            parts = term.strip().split('*')
            value = self.registers[parts[0]] if parts[0] in self.registers else int(parts[0], 0)
            if len(parts) == 2:
                value *= int(parts[1], 0)
            total += -value if sign == '-' else value
        return total

    def read(self, operand):
        if operand.startswith('st('):
            return self.stack[int(operand[3:-1])]
        if '[' in operand:
            address = self.address(operand)
            if address in self.memory:
                return self.memory[address]
            offset = self.image.offset(address)
            kind = 'd' if operand.startswith('qword') else 'f'
            return struct.unpack_from('<' + kind, self.image.data, offset)[0]
        if operand == 'ah':
            return self.registers.get('ax', 0) >> 8
        if operand == 'bl':
            return self.registers['ebx'] & 255
        return self.registers[operand] if operand in self.registers else int(operand, 0)

    def write(self, operand, value, floating=False):
        if operand.startswith('st('):
            self.stack[int(operand[3:-1])] = value
        elif '[' in operand:
            self.memory[self.address(operand)] = f32(value) if floating else value
        else:
            self.registers[operand] = value

    def compare(self, a, b):
        self.flags = {'z': a == b, 's': a < b}

    def run(self, start=0x1ef69e, end=0x1ef959):
        instructions = {i.address: i for i in self.image.dis.disasm(
            self.image.data[start:end], self.image.base + start)}
        pc = self.image.base + start
        for _ in range(2000):
            if pc == self.image.base + end:
                return
            instruction = instructions[pc]
            self.trace.append(pc - self.image.base)
            mnemonic, operands = instruction.mnemonic, instruction.op_str.split(', ')
            nxt = pc + instruction.size
            if mnemonic in ('wait', 'nop'):
                pass
            elif mnemonic in ('mov', 'lea'):
                self.write(operands[0], self.address(operands[1]) if mnemonic == 'lea' else self.read(operands[1]))
            elif mnemonic in ('add', 'sub', 'xor'):
                a, b = (0, 0) if mnemonic == 'xor' and operands[0] == operands[1] else map(self.read, operands)
                value = a + b if mnemonic == 'add' else a - b if mnemonic == 'sub' else a ^ b
                self.write(operands[0], value); self.compare(value, 0)
            elif mnemonic == 'cmp':
                self.compare(*map(self.read, operands))
            elif mnemonic == 'test':
                value = self.read(operands[0]) & self.read(operands[1])
                self.flags = {'z': value == 0, 's': value < 0 or bool(value & 0x80000000), 'p': bin(value & 255).count('1') % 2 == 0}
            elif mnemonic == 'fnstsw':
                self.write(operands[0], self.status)
            elif mnemonic.startswith('j'):
                take = {'jmp': True, 'je': self.flags.get('z'), 'jne': not self.flags.get('z'),
                        'jl': self.flags.get('s'), 'jle': self.flags.get('s') or self.flags.get('z'), 'jge': not self.flags.get('s'),
                        'jg': not self.flags.get('s') and not self.flags.get('z'),
                        'jp': self.flags.get('p'), 'jnp': not self.flags.get('p')}[mnemonic]
                if take:
                    nxt = int(operands[0], 0)
            elif mnemonic in ('fld', 'fldz', 'fld1'):
                value = self.read(operands[0]) if mnemonic == 'fld' else 0.0 if mnemonic == 'fldz' else 1.0
                self.stack.insert(0, value)
            elif mnemonic in ('fst', 'fstp'):
                self.write(operands[0], self.stack[0], floating=True)
                if mnemonic == 'fstp':
                    self.stack.pop(0)
            elif mnemonic == 'fxch':
                index = int(operands[0][3:-1])
                self.stack[0], self.stack[index] = self.stack[index], self.stack[0]
            elif mnemonic in ('fcom', 'fcomp'):
                a, b = self.stack[0], self.read(operands[0])
                assert math.isfinite(a) and math.isfinite(b), 'nonfinite comparison outside verifier domain'
                self.status = (0x4000 if a == b else 0x100 if a < b else 0)
                if mnemonic == 'fcomp':
                    self.stack.pop(0)
            elif mnemonic in ('fadd', 'faddp', 'fsub', 'fsubr', 'fsubp', 'fsubrp', 'fmul', 'fdiv', 'fdivr', 'fdivp'):
                pop = mnemonic.endswith('p')
                target = operands[0] if pop or len(operands) == 2 else 'st(0)'
                other = 'st(0)' if pop else operands[1] if len(operands) == 2 else operands[0]
                a, b = self.read(target), self.read(other)
                if mnemonic.startswith('fadd'): value = a + b
                elif mnemonic.startswith('fsubr'): value = b - a
                elif mnemonic.startswith('fsub'): value = a - b
                elif mnemonic.startswith('fmul'): value = a * b
                elif mnemonic.startswith('fdivr'): value = b / a
                else: value = a / b
                self.write(target, value)
                if pop:
                    self.stack.pop(0)
            else:
                raise AssertionError('unsupported instruction in bounded arithmetic: ' + str(instruction))
            pc = nxt
        raise AssertionError('bounded arithmetic did not terminate')


def evaluate_native_arithmetic(image, durations, shot_phase, shot_offset, flexible, hit_time, lead, speed, style=1):
    """Synthetic inputs to the decoded arithmetic, after source-sequence scan."""
    assert style != 13 and speed > 0 and 0 <= shot_phase < len(durations)
    durations = [f32(d) for d in durations]
    source_attack_time = f32(shot_offset)
    for i in range(shot_phase - 1, -1, -1):
        if i != flexible:
            source_attack_time = f32(source_attack_time + durations[i])
    pawn, frame = 0x100000, 0x200000
    memory = {pawn + 0x504: flexible, pawn + 0x510: f32(hit_time), pawn + 0x524: 1.0,
              pawn + 0x52c: style, pawn + 0x534: len(durations), pawn + 0x6b8: f32(speed),
              frame - 0x20: f32(shot_offset), frame - 0x24: shot_phase}
    memory.update({pawn + 0x58c + i * 4: 0.0 if i == flexible else d for i, d in enumerate(durations)})
    machine = Arithmetic(image, memory, [f32(lead), source_attack_time, 0.0],
                         {'esi': pawn, 'ebp': frame, 'ebx': 2})
    machine.run()
    return {'rate': memory_value(machine, pawn + 0x524), 'tween': memory_value(machine, pawn + 0x518),
            'shotTime': memory_value(machine, pawn + 0x514),
            'dues': [memory_value(machine, pawn + 0x58c + i * 4) for i in range(len(durations))],
            'sourceAttackTime': source_attack_time, 'visitedRVAs': sorted(set(machine.trace))}


def memory_value(machine, address):
    return machine.memory[address]


def equations(durations, shot_phase, shot_offset, flexible, hit_time, lead, speed, style=1):
    """Independent real-arithmetic specification, not used by the browser."""
    assert style != 13
    a = sum(d for i, d in enumerate(durations[:shot_phase]) if i != flexible) + shot_offset
    tween = f32(.2) / speed if flexible >= 0 else f32(.2)
    if flexible >= 0:
        loop = hit_time - lead - (a + f32(.2)) / speed
        rate = speed
        remaining = hit_time - lead - f32(.2) / speed
        if loop < 0 and remaining > .0001:
            loop, rate = 0, a / remaining
    else:
        loop, rate = 0, a / (hit_time - lead - f32(.2))
    dues, previous, shot = [], tween, None
    for i, duration in enumerate(durations):
        if i == shot_phase:
            shot = previous + shot_offset / rate if rate > 0 else previous
        due = previous + (loop if i == flexible else duration / rate if rate > 0 else duration)
        if i != flexible and i == 0 and len(durations) > 1 and lead >= f32(.15) and rate > 0:
            due -= due * f32(.15) / (hit_time - lead)
        dues.append(due); previous = due
    return {'rate': rate, 'tween': tween, 'shotTime': shot, 'dues': dues}


def verify_arithmetic(image):
    cases = [
        ('ordinary-long', [.8, .1, 1.5], 2, .5, 1, 4., f32(.15), 1.),
        ('ordinary-fast', [.8, .1, 1.5], 2, .5, 1, 1.5, f32(.4), 2.),
        ('collapsed-flex', [.8, .1, 1.5], 2, .5, 1, 1., f32(.15), 1.),
        ('flex-first', [.1, 1.5], 1, .5, 0, 4., f32(.15), 1.),
        ('physical-one-phase', [1.5], 0, .5, -1, 1.4, 0., 1.),
        ('physical-multiple-phases', [.3, .6, 1.5], 2, .5, -1, 1.8, 0., 1.),
        ('nonflex-flight', [.3, .6, 1.5], 2, .5, -1, 1.8, f32(.4), 1.),
        ('no-shot-fallback', [.8, .1, 1.5], 2, 1.5, 1, 4., f32(.15), 1.),
        ('slow-flex', [.8, .1, 1.5], 2, .5, 1, 6., f32(.15), .5),
        ('shot-in-earlier-phase', [.8, .1, 1.5], 0, .5, 1, 4., f32(.15), 1.),
        ('guard-preserves-negative-flex', [.8, .1, 1.5], 2, .5, 1, .35005, f32(.15), 1.),
        ('negative-remaining-budget', [.8, .1, 1.5], 2, .5, 1, .1, f32(.15), 1.),
    ]
    results = []
    for label, *args in cases:
        actual = evaluate_native_arithmetic(image, *args)
        expected = equations(*args)
        for key in ('rate', 'tween', 'shotTime'):
            assert math.isclose(actual[key], expected[key], rel_tol=2e-6, abs_tol=2e-6), (label, key, actual, expected)
        assert all(math.isclose(a, b, rel_tol=2e-6, abs_tol=2e-6) for a, b in zip(actual['dues'], expected['dues'])), (label, actual, expected)
        results.append({'case': label, **{k: v for k, v in actual.items() if k != 'visitedRVAs'}})
    return results



def verify_source_fields():
    """Bind names to the original bounded Actor/Pawn ScriptText exports."""
    sys.path.insert(0, str(ROOT / 'tools'))
    from l2lib import load_package
    from uscript.extract_uscript import source_text
    path = ROOT / 'assets/interlude/system/Engine.u'
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
    package, _ = load_package(str(path))
    texts, exports = {}, {}
    for name in ('Actor', 'Pawn'):
        owner = next(e for e in package.exports_by_class('Class') if package.export_name(e) == name)
        candidates = [e for e in package.exports if package.export_name(e) == 'ScriptText'
                      and e.package_index == owner.index + 1]
        assert len(candidates) == 1
        export = candidates[0]
        raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
        class_name, text = source_text(raw)
        assert class_name == name
        texts[name] = re.sub(r'//[^\n]*', '', text)
        exports[name] = {'index': export.index, 'offset': export.serial_offset,
                         'length': export.serial_size, 'SHA256': hashlib.sha256(raw).hexdigest()}
    body = re.search(r'struct NMagicInfo\s*\{(.*?)\};', texts['Actor'], re.S)[1]
    fields = re.findall(r'var\s+(?:transient\s+)?[\w<>]+\s+(\w+)(?:\[3\])?\s*;', body)
    expected = ['Agent', 'DummyPtr', 'MagicID', 'LevelID', 'AniIndex', 'FlexibleAniIndex',
                'StageShot', 'StagePreshot', 'SkillHitTime', 'ShotTime', 'TweenTime', 'ActiveTime',
                'TargetPawn', 'MagicSpeed', 'MagicAniStatus', 'MagicType', 'bTargetExcepted', 'nSlice',
                'NormalRotationRate', 'SkillRotationRate', 'AssociatedActor', 'EffectActor',
                'EffectID', 'LocLIst', 'Anis', 'AniDues', 'LastShotName', 'PendingNotify',
                'PendingPreshotNotify', 'PendingChannelingNotify']
    assert fields == expected
    assert re.search(r'var float\s+SkillSpeedRate;', texts['Pawn'])
    return {'enginePackageSHA256': digest, 'exports': exports, 'magicInfoFields': fields}


def verify():
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    ranges = {'init': (0x1ef470, 0x1ef98f), 'process': (0x211ab0, 0x211fd6),
              'cancel': (0x212760, 0x212b67), 'stop': (0x212160, 0x212573),
              'reverseShot': (0x3ba5d0, 0x3ba6a9)}
    methods = {'?InitSkillProcess@APawn@@QAEHXZ': 'init', '?MagicProcess@APawn@@QAEXM@Z': 'process',
               '?MagicCancel@APawn@@QAEXXZ': 'cancel', '?MagicStop@APawn@@QAEXXZ': 'stop',
               '?AnimGetAttackShotNotifyTimeRev@USkeletalMeshInstance@@QAEMVFName@@AAV2@@Z': 'reverseShot'}
    for name, key in methods.items():
        assert image.exported(name, True) == image.base + ranges[key][0]
    vtable = image.exported('??_7APawn@@6B@')
    assert image.u32(vtable + 0x328) == image.exported('?PlayAnim@APawn@@UAEHHVFName@@MMHH@Z')
    anchors = [
        # Named input field and server budget conversion.
        (0x16e5e7, 'push', '0x1089a3a0'), (0x16e5f7, 'mov', 'dword ptr [esi + 0x30], eax'),
        (0x19c84d, 'fild', 'dword ptr [esp + 0x28]'), (0x19c856, 'fdiv', 'qword ptr [0x10888760]'),
        (0x19c897, 'call', '0x10310b7c'), (0x1f299a, 'fld', 'dword ptr [esp + 0x20]'),
        (0x1f29a1, 'fstp', 'dword ptr [esi + 0x510]'),
        # Native speed field and frame-count/rate accessors identify inputs.
        (0x1889ec, 'mov', 'dword ptr [eax + 0x23c], ecx'),
        (0x195366, 'fild', 'dword ptr [ebp + 0x23c]'),
        (0x19536c, 'fld', 'qword ptr [0x1088ae20]'),
        (0x195378, 'fdiv', 'st(1), st(0)'),
        (0x195384, 'fstp', 'dword ptr [edx + 0x6b8]'),
        (0x3ae978, 'fild', 'dword ptr [eax + 0x14]'),
        (0x3ae998, 'fld', 'dword ptr [eax + 0x18]'),
        # Source duration and last-shot scan, excluding the flexible phase.
        (0x1ef58a, 'call', '0x10303f85'), (0x1ef5a1, 'cmp', 'dword ptr [esi + 0x504], edi'),
        (0x1ef5a9, 'fild', 'dword ptr [ecx + 0x14]'), (0x1ef5ac, 'fdiv', 'dword ptr [ecx + 0x18]'),
        (0x1ef5e1, 'call', '0x103142d1'), (0x1ef5e6, 'fmul', 'dword ptr [esi + edi*4 + 0x58c]'),
        (0x1eee69, 'push', '0x10dd51b0'), (0x3ba657, 'call', '0x10307dd3'),
        (0x3ba63e, 'sub', 'edi, 1'), (0x3ba661, 'je', '0x106ba63e'),
        (0x3ba67f, 'mov', 'dword ptr [ecx], edx'), (0x3ba68d, 'call', 'edx'),
        # One shared elapsed clock; strict elapsed > due comparison.
        (0x211e24, 'fcom', 'dword ptr [esi + 0x51c]'), (0x211e2f, 'jnp', '0x10511e51'),
        (0x211e31, 'fld', 'dword ptr [esi + 0x51c]'), (0x211e3d, 'fld', 'dword ptr [esi + ecx*4 + 0x58c]'),
        (0x211e44, 'fcompp', ''), (0x211e48, 'test', 'ah, 5'), (0x211e4b, 'jp', '0x10511faa'),
        (0x211e51, 'add', 'dword ptr [esi + 0x500], edi'),
        (0x211f4c, 'fcom', 'dword ptr [esi + ecx*4 + 0x58c]'), (0x211f58, 'je', '0x10511e24'),
        (0x211f6d, 'fld', 'dword ptr [esi + 0x518]'), (0x211f7b, 'cmp', 'ecx, dword ptr [esi + 0x504]'),
        (0x211f81, 'sete', 'dl'), (0x211f95, 'mov', 'ecx, dword ptr [esi + ecx*4 + 0x580]'),
        (0x211fa0, 'mov', 'edx, dword ptr [eax + 0x328]'), (0x211fa6, 'call', 'edx'),
        (0x211fac, 'fld', 'dword ptr [ebp + 8]'), (0x211faf, 'fadd', 'dword ptr [esi + 0x51c]'),
        (0x211fb5, 'fstp', 'dword ptr [esi + 0x51c]'),
        # Notify dispatch and server target association are different paths.
        (0x211c93, 'call', '0x1030f457'), (0x21173a, 'add', 'dword ptr [esi + 0x508], 1'),
        (0x21174a, 'call', '0x10305051'), (0x1925ff, 'call', '0x10306aa0'),
        (0x19c46f, 'call', '0x10306aa0'), (0x2132b1, 'mov', 'dword ptr [esi + 0x530], 1'),
        # Server cancellation routes to complete magic-info clearing.
        (0x189b15, 'call', '0x1030917e'), (0x212a82, 'call', '0x10309b83'),
        (0x212b09, 'push', '1'), (0x212b0b, 'lea', 'ecx, [esi + 0x4f0]'),
        (0x212b11, 'call', '0x103091a1'), (0x8e698, 'mov', 'dword ptr [esi + 0x14], ebx'),
        (0x8e6a6, 'mov', 'dword ptr [esi + 0x10], ebx'), (0x8e6ab, 'fst', 'dword ptr [esi + 0x2c]'),
        (0x8e70c, 'mov', 'dword ptr [esi + 0xac], edi'),
    ]
    assert image.wide(0x1089a3a0) == 'cast_style'
    assert image.exported('?PrivateStaticClass@UAnimNotify_AttackShot@@0VUClass@@A') == 0x10dd51b0
    assert image.exported('?AnimGetFrameCount@USkeletalMeshInstance@@UAEMPAX@Z', True) == image.base + 0x3ae970
    assert image.exported('?AnimGetRate@USkeletalMeshInstance@@UAEMPAX@Z', True) == image.base + 0x3ae990
    assert image.exported('?OnMagicCastingSpeed@UGameEngine@@UAEHPAUUser@@H@Z', True) == image.base + 0x1889e0
    for rva, mnemonic, operands in anchors:
        image.instruction(image.base + rva, mnemonic, operands)
    constants = {}
    for name, rva, fmt, value in [('milliseconds', 0x588760, 'd', 1000.), ('speedDivisor', 0x58ae20, 'd', 333.),
        ('tween', 0x5a052c, 'f', f32(.2)), ('tweenDouble', 0x5a0530, 'd', f32(.2)),
        ('minimumLead', 0x5a91a0, 'f', f32(.15)), ('firstPhaseCorrection', 0x5a9188, 'd', f32(.15)),
        ('projectileLead', 0x5a53f0, 'f', f32(.4)), ('areaLead', 0x584cf0, 'f', 2.), ('rateGuard', 0x5a74a8, 'd', .0001)]:
        decoded = struct.unpack_from('<' + fmt, image.data, rva)[0]
        assert decoded == value
        constants[name] = {'value': decoded, 'rva': hex(rva), 'storage': fmt}
    return {'status': 'verified', 'engineSHA256': image.sha,
            'bodies': {name: {'rva': hex(a), 'endRVA': hex(b), 'SHA256': hashlib.sha256(image.data[a:b]).hexdigest()} for name, (a, b) in ranges.items()},
            'instructionAnchors': len(anchors), 'constants': constants, 'arithmeticCases': verify_arithmetic(image),
            'sourceFields': verify_source_fields(), 'flexiblePhases': derive_slots()['flexiblePhases'],
            'limits': ['static reconstruction; imported identity/constructor calls were NOP-erased',
                       'arithmetic comparison uses Float64 intermediates plus original Float32 stores, not x87 bit parity',
                       'type13, NPC overrides, renderer interpolation and native last-frame handling are not covered']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = verify()
    print(json.dumps(result if args.json else {'status': result['status'], 'instructionAnchors': result['instructionAnchors'],
          'arithmeticCases': len(result['arithmeticCases'])}, indent=2))
