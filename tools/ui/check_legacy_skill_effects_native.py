#!/usr/bin/env python3
"""Elbera Tools: verify original no-Agent skill effect dispatch.

Pins the owner's Engine/Core binaries, original packages and skillgrp.dat.
Evaluates bounded call-free ID switches and physics slices, checks native spawn sites and
original class ownership. Never executes or emits original code or assets.
Checks bounded lifecycle gates and original class defaults as well. Complete
placement, motion, emitter evaluation and timing are not emulated.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ENGINE_SHA = '07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0'

EFFECT_SHA = 'ea090154c4b8eb2f4fafab331c85fd8f7e42869ec71eb4f11323b546b550114a'
DAT_SHA = '4e245e914048cee34ada7fb6ed6b499976cbe961ad5bd0a8bfdcf00a1e2288d9'
ENGINE_PACKAGE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
CORE_PACKAGE_SHA = 'de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0'
MASK, SIGN = 0xffffffff, 0x80000000


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def velocity_before_bound(velocity, acceleration, delta, fluid_friction):
    """Only the verified pre-BoundProjectileVelocity slice, not full physics.

    Inputs are native Float32 fields. The caller must supply the effective
    volume field (zero when native volume+0x490 bit0x20 is clear). No initialization,
    normalized direction, speed bound, collision or arrival is substituted.
    """
    assert len(velocity) == len(acceleration) == 3
    values = [*velocity, *acceleration, delta, fluid_friction]
    assert all(math.isfinite(value) for value in values) and delta >= 0
    velocity, acceleration = [list(map(f32, v)) for v in (velocity, acceleration)]
    delta, fluid_friction = f32(delta), f32(fluid_friction)
    factor = f32(1 - fluid_friction * f32(.2) * delta)
    return [f32(f32(v * factor) + f32(a * delta)) for v, a in zip(velocity, acceleration)]


def displacement_after_bound(velocity, delta):
    """Input is the actual bound helper's output; this does not emulate it."""
    assert len(velocity) == 3 and delta >= 0 and all(math.isfinite(v) for v in [*velocity, delta])
    return [f32(f32(v) * f32(delta)) for v in velocity]


class LinearX87:
    """Call-free straight-line slices with explicit memory; no erased imports.

    Float64 arithmetic approximates x87 extended intermediates. Float32 stores
    are preserved; comparisons against finite cases are not a universal x87
    equivalence proof. NOP is rejected because it can hide an erased call.
    """
    def __init__(self, memory, registers, stack=()):
        self.memory, self.registers, self.stack = dict(memory), dict(registers), list(stack)

    def address(self, operand):
        match = re.fullmatch(r'(?:dword|qword) ptr \[([a-z]+|0x[0-9a-f]+)(?: ([+-]) (0x[0-9a-f]+|[0-9]+))?\]', operand)
        assert match, 'unsupported arithmetic address: ' + operand
        value = self.registers[match[1]] if match[1] in self.registers else int(match[1], 0)
        return value + (int(match[3], 0) * (-1 if match[2] == '-' else 1) if match[3] else 0)

    def read(self, operand):
        if operand.startswith('st('): return self.stack[int(operand[3:-1])]
        if '[' in operand: return self.memory[self.address(operand)]
        return self.registers[operand]

    def write(self, operand, value, floating=False):
        if operand.startswith('st('): self.stack[int(operand[3:-1])] = value
        elif '[' in operand:
            self.memory[self.address(operand)] = f32(value) if floating and operand.startswith('dword') else value
        else:
            assert operand in ('eax', 'ecx', 'edx'), 'unsupported register write'
            self.registers[operand] = value

    def run(self, instructions):
        for instruction in instructions:
            op, args = instruction.mnemonic, instruction.op_str.split(', ')
            if op == 'mov': self.write(args[0], self.read(args[1]))
            elif op in ('fld', 'fld1', 'fldz'):
                self.stack.insert(0, self.read(args[0]) if op == 'fld' else 1. if op == 'fld1' else 0.)
            elif op in ('fst', 'fstp'):
                self.write(args[0], self.stack[0], floating=True)
                if op == 'fstp': self.stack.pop(0)
            elif op == 'fxch':
                index = int(args[0][3:-1])
                self.stack[0], self.stack[index] = self.stack[index], self.stack[0]
            elif op in ('fmul', 'fmulp', 'fadd', 'faddp', 'fsub', 'fsubrp'):
                pop = op.endswith('p')
                target = args[0] if pop or len(args) == 2 else 'st(0)'
                other = 'st(0)' if pop else args[1] if len(args) == 2 else args[0]
                a, b = self.read(target), self.read(other)
                value = a * b if op.startswith('fmul') else a + b if op.startswith('fadd') else b - a if op == 'fsubrp' else a - b
                self.write(target, value)
                if pop: self.stack.pop(0)
            else: raise AssertionError('unsupported arithmetic instruction: ' + op)


class Dispatch:
    """Small fail-closed x86 DWORD switch evaluator, not a general emulator."""
    def __init__(self, decode, read, code_ranges):
        self.decode, self.read, self.code_ranges = decode, read, code_ranges

    def run(self, start, skill_id, stops, max_steps=64):
        registers, flags, trace, pc = {'eax': skill_id & MASK, 'ecx': skill_id & MASK}, None, [], start

        def value(operand):
            if operand in registers: return registers[operand]
            return int(operand, 0) & MASK

        def address(operand):
            match = re.fullmatch(r'(?:byte|dword) ptr \[(eax|ecx)(?:\*(4))? \+ (0x[0-9a-f]+)\]', operand)
            if not match: raise AssertionError('unsupported switch address: ' + operand)
            return (registers[match[1]] * int(match[2] or 1) + int(match[3], 16)) & MASK

        for _ in range(max_steps):
            if pc in stops: return {'target': pc, 'trace': trace}
            assert any(a <= pc < b for a, b in self.code_ranges), 'dispatch escaped allowed code'
            instruction = self.decode(pc)
            op, args = instruction.mnemonic, instruction.op_str.split(', ')
            trace.append(pc)
            nxt = pc + instruction.size
            if op in ('cmp', 'sub', 'add'):
                assert args[0] in registers, 'unsupported dispatch register'
                a, b = value(args[0]), value(args[1])
                total = a + b if op == 'add' else a - b
                result = total & MASK
                flags = {'z': result == 0, 's': bool(result & SIGN),
                         'c': total > MASK if op == 'add' else a < b,
                         'o': bool((~(a ^ b) if op == 'add' else a ^ b) & (a ^ result) & SIGN)}
                if op != 'cmp': registers[args[0]] = result
            elif op == 'movzx':
                assert args[0] in registers and args[1].startswith('byte ptr ')
                registers[args[0]] = self.read(address(args[1]), 1)
            elif op == 'jmp':
                nxt = self.read(address(args[0]), 4) if args[0].startswith('dword ptr ') else int(args[0], 0)
            elif op.startswith('j'):
                assert flags is not None, 'dispatch branch has no flags'
                z, s, c, o = (flags[k] for k in ('z', 's', 'c', 'o'))
                conditions = {'je': z, 'jne': not z, 'ja': not c and not z, 'jae': not c,
                              'jb': c, 'jbe': c or z, 'jg': not z and s == o,
                              'jge': s == o, 'jl': s != o, 'jle': z or s != o}
                assert op in conditions, 'unsupported dispatch branch'
                if conditions[op]: nxt = int(args[0], 0)
            else:
                raise AssertionError('unsupported dispatch instruction: ' + op)
            pc = nxt
        raise AssertionError('dispatch did not terminate')


def source_audit():
    sys.path.insert(0, str(ROOT / 'tools'))
    sys.path.insert(0, str(ROOT / 'tools/dat'))
    from l2lib import load_package
    from extract_gamedata import decrypt, parse_skillgrp
    from parse_skillfx import read_packed, EMITTER_CLASSES
    from export_npc_visuals import OriginalClasses, terminal_defaults
    path = ROOT / 'assets/interlude/system/LineageEffect.u'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == EFFECT_SHA
    package, _ = load_package(str(path))
    assert (package.file_version, package.licensee_version) == (123, 30)
    classes = []
    for name, parent, expected in [('m_u000_a', 'Emitter', 2), ('m_u000_b', 'Emitter', 2),
                                   ('m_u000_c', 'NSkillProjectile', 4), ('m_u000_d', 'Emitter', 3),
                                   ('s_u002_a', 'Emitter', 3)]:
        matches = [e for e in package.exports_by_class('Class') if package.export_name(e) == name]
        assert len(matches) == 1
        export = matches[0]
        assert package.ref_name(export.super_index) == ('Engine', parent)
        emitters = []
        for child in package.exports:
            kind = package.class_name_of(child)
            if child.package_index != export.index + 1 or kind not in EMITTER_CLASSES: continue
            reader = package.body_reader(child)
            read_packed(package, reader)
            assert reader.pos == child.serial_offset + child.serial_size, 'unconsumed original emitter bytes'
            emitters.append({'name': package.export_name(child), 'class': kind,
                             'SHA256': hashlib.sha256(package.data[child.serial_offset:reader.pos]).hexdigest()})
        assert len(emitters) == expected
        raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
        classes.append({'name': 'LineageEffect.' + name, 'super': 'Engine.' + parent,
                        'exportIndex': export.index, 'offset': export.serial_offset,
                        'size': export.serial_size, 'SHA256': hashlib.sha256(raw).hexdigest(),
                        'ownedEmitterSubobjects': emitters})
    assert hashlib.sha256((ROOT / 'assets/interlude/system/skillgrp.dat').read_bytes()).hexdigest() == DAT_SHA
    with tempfile.TemporaryDirectory() as temp:
        rows = parse_skillgrp(decrypt('skillgrp.dat', temp))
    selected = []
    for skill_id, level, style, animation in [(1177, 1, 2, 'E'), (3, 3, 3, 'S')]:
        matches = [r for r in rows if (r['skill_id'], r['skill_level']) == (skill_id, level)]
        assert len(matches) == 1
        row = matches[0]
        assert row['skill_visual_effect'] == '' and (row['cast_style'], row['animation']) == (style, animation)
        selected.append({k: row[k] for k in ('skill_id', 'skill_level', 'skill_visual_effect', 'cast_style', 'animation')})
    for filename, sha in [('Engine.u', ENGINE_PACKAGE_SHA), ('Core.u', CORE_PACKAGE_SHA)]:
        assert hashlib.sha256((ROOT / 'assets/interlude/system' / filename).read_bytes()).hexdigest() == sha
    originals = OriginalClasses()
    defaults = []
    fields = {'Physics', 'Speed', 'AccSpeed', 'LifeSpan', 'CollisionRadius', 'CollisionHeight',
              'AutoDestroy', 'AutoReset', 'bTrailerPrePivot', 'bRelativeTrail', 'bPreDestroy',
              'bHermiteInterpolation', 'RelativeTrailOffset', 'TrailerPrePivot', 'DrawScale',
              'SpeedRate', 'Role', 'RemoteRole', 'Velocity', 'Acceleration'}
    expected = {'LineageEffect.m_u000_a': {'Physics': 10, 'bTrailerPrePivot': True, 'AutoDestroy': True},
                'LineageEffect.m_u000_b': {'Physics': 10, 'bRelativeTrail': True, 'AutoDestroy': True},
                'LineageEffect.m_u000_c': {'Speed': 1000., 'AccSpeed': 3000., 'AutoDestroy': True},
                'LineageEffect.m_u000_d': {'AutoDestroy': True, 'AutoReset': True},
                'Engine.NProjectile': {'LifeSpan': 100., 'CollisionRadius': 5., 'CollisionHeight': 5.}}
    for qualified in [r['name'] for r in classes[:4]] + ['Engine.NSkillProjectile', 'Engine.NProjectile', 'Engine.Emitter', 'Engine.Actor']:
        types = originals.property_types(qualified, set())
        package_name, name = qualified.split('.')
        pkg = originals.packages[package_name]
        matches = [e for e in pkg.exports_by_class('Class') if pkg.export_name(e) == name]
        assert len(matches) == 1
        props, evidence = terminal_defaults(pkg, matches[0], types)
        assert evidence['defaultsBoundary'] == 'unique-validated-candidate'
        values = {n: v for n, _, v in props}
        assert all(values.get(n) == v for n, v in expected.get(qualified, {}).items())
        defaults.append({'class': qualified, 'declaredOverrides': {n: v for n, v in values.items() if n in fields},
                         'evidence': evidence})
    # Read the original bounded Actor source solely to bind native enum values.
    # Return names/indices and a fingerprint, never the source text.
    from uscript.extract_uscript import sources_from_package
    engine = originals.packages['Engine']
    actor = next(text for name, text in sources_from_package(engine) if name == 'Actor')
    pawn = next(text for name, text in sources_from_package(engine) if name == 'Pawn')
    enum = re.search(r'enum\s+EPhysics\s*\{([^}]+)\}', actor).group(1)
    enum = re.sub(r'//[^\n]*', '', enum)
    physics = re.findall(r'\bPHYS_\w+\b', enum)
    assert physics[10] == 'PHYS_Trailer' and physics[17] == 'PHYS_NProjectile'
    targets = []
    for name, source, sha, function_sha in [
        ('Actor', actor, 'c45bce0e6cff979d2eecc6281066932b013cd0ee11e353bc298add73288f2d01',
         '1d8170de43fe7192b0e1892c43008d0d0cb57ce6b6362c785aebabe3bae1744b'),
        ('Pawn', pawn, 'eb9a2e2f9ba8464e7f628c7fd941b2c83100cedada08f1c822d93ebf9fa4d691',
         'b8783f0988a71b640b55356fe0b54a920fadba1d407803431b0dbe77c47907d9'),
    ]:
        assert hashlib.sha256(source.encode('latin-1')).hexdigest() == sha
        matches = [e for e in engine.exports if engine.export_name(e) == 'GetEffTargetLocation'
                   and engine.ref_name(e.package_index) == (None, name)]
        assert len(matches) == 1
        export = matches[0]
        raw = engine.data[export.serial_offset:export.serial_offset + export.serial_size]
        assert hashlib.sha256(raw).hexdigest() == function_sha
        targets.append({'class': 'Engine.' + name, 'sourceSHA256': sha,
                        'compiledFunctionExportIndex': export.index, 'compiledFunctionSHA256': function_sha})
    # Inspect source with comments removed; keep compiled export provenance but
    # do not imply that its VM bytecode was executed by this verifier.
    clean = re.sub(r'//[^\n]*|/\*.*?\*/', '', pawn, flags=re.S)
    body = clean[clean.index('event GetEffTargetLocation'):clean.index('function Died')]
    ordered = ['EffectSpawnBoneIdx != -1', 'GetBoneCoordsWithBoneIndex( EffectSpawnBoneIdx )',
               'HasBoneName( SpineBone )', 'GetBoneCoords( SpineBone )',
               'GetBoneCoordsWithBoneIndex( 0 )', 'LocVector = c.origin']
    positions = [body.index(token) for token in ordered]
    assert positions == sorted(positions)
    for row in defaults:
        if row['class'] in ('LineageEffect.m_u000_c', 'Engine.NSkillProjectile', 'Engine.NProjectile', 'Engine.Emitter', 'Engine.Actor'):
            assert not ({'Velocity', 'Acceleration', 'bHermiteInterpolation'} & row['declaredOverrides'].keys())
    return {'effectPackageSHA256': EFFECT_SHA, 'skillgrpSHA256': DAT_SHA, 'rows': selected, 'classes': classes,
            'enginePackageSHA256': ENGINE_PACKAGE_SHA, 'corePackageSHA256': CORE_PACKAGE_SHA,
            'classDefaults': defaults, 'physicsEnum': {physics[i]: i for i in (0, 10, 17)},
            'actorSourceSHA256': hashlib.sha256(actor.encode('latin-1')).hexdigest(),
            'targetPointSources': targets,
            'targetBoneSelection': ['explicit EffectSpawnBoneIdx unless -1', 'existing SpineBone', 'bone index 0'],
            'initialVelocity': 'not inferred from absent class overrides or Speed default'}


def lifecycle_audit(image):
    """Bounded attachment, clock, target-update and terminal-call evidence.

    This deliberately does not replace missing native vector imports,
    complete bone evaluation, projectile initialization or the particle loop.
    """
    methods = {
        '?SpawnSkillEffect@AActor@@QAEPAV1@PAV1@0VFName@@HVFVector@@VFRotator@@MHHHH@Z': 0x1eeec0,
        '?GetTrailerPrePivot@AEmitter@@UAE?AVFVector@@XZ': 0x42b00,
        '?physTrailer@AActor@@QAEXM@Z': 0x338cc0,
        '?TickAuthoritative@AActor@@UAEXM@Z': 0x2d2ed0,
        '?Tick@ANSkillProjectile@@UAEHMW4ELevelTick@@@Z': 0x1e3540,
        '?Tick@ANProjectile@@UAEHMW4ELevelTick@@@Z': 0x1e2490,
        '?physNProjectile@AActor@@QAEXMH@Z': 0x33dd90,
        '?PreDestroy@ANSkillProjectile@@UAEXXZ': 0x1e2d90,
        '?PreDestroy@ANProjectile@@UAEXXZ': 0x1e2cc0,
    }
    for name, rva in methods.items(): assert image.exported(name, True) == image.base + rva
    vt = image.exported('??_7ANSkillProjectile@@6B@')
    for slot, name in [(0x1a8, '?GetTrailerPrePivot@AEmitter@@UAE?AVFVector@@XZ'),
                       (0x1c8, '?setPhysics@AActor@@UAEXEPAV1@VFVector@@@Z'),
                       (0x1d4, '?processHitWall@ANSkillProjectile@@UAEXVFVector@@PAVAActor@@@Z'),
                       (0x334, '?PreDestroy@ANSkillProjectile@@UAEXXZ')]:
        assert image.u32(vt + slot) == image.exported(name)
    for stub, name in [(0x1205d, '?AdjustparticleLife@AEmitter@@QAEXM@Z'),
                       (0x4c23, '?SetSizeScale@AEmitter@@QAEXM@Z'),
                       (0xb4ab, '?Tick@ANProjectile@@UAEHMW4ELevelTick@@@Z'),
                       (0xcc84, '?PreDestroy@ANProjectile@@UAEXXZ')]:
        assert image.exported(name) == image.base + stub
    level = image.exported('??_7ULevel@@6BUObject@@@')
    # Identify method by its existing exported address rather than a guessed slot.
    destroy = [name for name in image.exports if name.startswith('?DestroyActor@ULevel@@')]
    assert len(destroy) == 1 and image.u32(level + 0xac) == image.exported(destroy[0])
    anchors = [
        # Casting a is owner-relative; the named emitter getter identifies its pivot.
        (0x1eef39, 'cmp', 'dword ptr [ebp + 0x34], edi'),
        (0x1eef3c, 'je', '0x104ef0c4'),
        (0x1eeff9, 'fld', 'dword ptr [eax + 0x98]'),
        (0x1ef005, 'fmul', 'dword ptr [edi + 0x27c]'),
        (0x1ef028, 'fld', 'dword ptr [edi + 0x2f4]'),
        (0x1ef041, 'fstp', 'dword ptr [esi + 0x484]'),
        (0x42b00, 'mov', 'edx, dword ptr [ecx + 0x47c]'),
        (0x42b12, 'mov', 'ecx, dword ptr [ecx + 0x484]'),
        # Casting b records relative offset X and a source-dependent expiry clock.
        (0x1f7ffe, 'fdiv', 'qword ptr [0x10853b28]'),
        (0x1f804d, 'push', '0'), (0x1f8067, 'fstp', 'dword ptr [eax + 0x68]'),
        (0x338ea4, 'test', 'edx, 0x100000'),
        (0x338eca, 'lea', 'ecx, [esi + 0x68]'),
        (0x338ed3, 'mov', 'ecx, dword ptr [esi + 0x3c]'),
        (0x338f24, 'test', 'edx, 0x40000'),
        (0x338f34, 'mov', 'edx, dword ptr [edx + 0x1a8]'),
        # Casting helper scales source particle life and records effect association.
        (0x1ef255, 'cmp', 'dword ptr [ebp + 0x38], 0'),
        (0x1ef25e, 'fstp', 'dword ptr [edi + 0x3f0]'),
        (0x1ef270, 'fld', 'dword ptr [eax + 0x24]'),
        (0x1ef273, 'fadd', 'qword ptr [0x10852238]'),
        (0x1ef285, 'call', '0x1031205d'),
        (0x1ef2fb, 'lea', 'ecx, [eax + 0x6c]'),
        (0x1ef2fe, 'call', '0x1031109f'),
        # Actor +e8 is a decrementing destruction clock, independently of particles.
        (0x2d2f10, 'fld', 'dword ptr [esi + 0xe8]'),
        (0x2d2f16, 'fsub', 'dword ptr [esp + 0xc]'),
        (0x2d2f22, 'fst', 'dword ptr [esi + 0xe8]'),
        (0x2d2f3d, 'mov', 'edx, dword ptr [eax + 0xac]'),
        (0x2d2f46, 'call', 'edx'),
        # Projectile creation and repeated target-point update.
        (0x208744, 'push', '0x11'), (0x208748, 'mov', 'edx, dword ptr [edx + 0x1c8]'),
        (0x208762, 'mov', 'dword ptr [esi + 0x4e4], eax'),
        (0x1e356b, 'mov', 'ecx, dword ptr [esi + 0x4e4]'),
        (0x1e3575, 'mov', 'eax, dword ptr [esi + 0x3c]'),
        (0x1e357e, 'lea', 'edx, [esi + 0x4e8]'),
        (0x1e359f, 'mov', 'edx, dword ptr [edi + 0x2b4]'),
        (0x1e35c2, 'call', '0x1030b4ab'),
        (0x1e2665, 'fld', 'dword ptr [esi + 0x4e8]'),
        (0x1e266b, 'fsub', 'dword ptr [esi + 0x1bc]'),
        (0x1e275a, 'fst', 'dword ptr [esi + 0x4dc]'),
        (0x1e2a69, 'fld', 'dword ptr [esi + 0x4e0]'),
        # Physical arrival invokes the named impact hook and stops physics.
        (0x33e1b3, 'lea', 'eax, [esi + 0x1bc]'),
        (0x33e1c6, 'lea', 'ebx, [edi + 0x4e8]'),
        (0x33e2ec, 'mov', 'eax, dword ptr [edi + 0x4e4]'),
        (0x33e30b, 'mov', 'edx, dword ptr [edx + 0x1d4]'),
        (0x33e311, 'call', 'edx'),
        (0x33e33a, 'push', '0'),
        (0x33e33e, 'mov', 'edx, dword ptr [edx + 0x1c8]'),
        (0x1e9ba1, 'mov', 'edx, dword ptr [eax + 0x334]'),
        (0x1e9ba7, 'call', 'edx'),
        (0x1e2db8, 'call', '0x1030cc84'),
        (0x1e2ce8, 'test', 'byte ptr [ecx + 0x504], 2'),
        (0x1e2cfe, 'mov', 'eax, dword ptr [edx + 0xac]'),
        # Impact uses the stored target point and an original cylinder-relative offset.
        (0x1e4eee, 'fld', 'dword ptr [0x108a8604]'),
        (0x1e4f4c, 'jne', '0x104e4f6e'),
        (0x1e4f4e, 'mov', 'ecx, dword ptr [esi + 0x4e8]'),
        (0x1e4f6e, 'fld', 'dword ptr [edi + 0x2f0]'),
        (0x1e4f9d, 'fsubr', 'dword ptr [esi + 0x4e8]'),
        (0x1e5084, 'push', 'edi'),
    ]
    for rva, op, args in anchors: image.instruction(image.base + rva, op, args)
    constants = {}
    for va, expected in [(0x10853b28, 3.), (0x10852238, 1.), (0x108a0660, -1.),
                         (0x108a3588, 9.), (0x108a8a50, 0.00009999999747378752)]:
        actual = struct.unpack_from('<d', image.data, image.offset(va))[0]
        assert actual == expected
        constants[hex(va)] = actual
    constants['0x108a8604'] = struct.unpack_from('<f', image.data, image.offset(0x108a8604))[0]
    assert constants['0x108a8604'] == struct.unpack('<f', struct.pack('<f', 1.2))[0]
    ranges = [
        ('casting setup and ownership', 0x1ef22b, 0x1ef303, '588c3117e7d67a935eeea408e0bd691738bb1f6d6096261aedbd04b97b8bbb2b'),
        ('actor destruction clock', 0x2d2f01, 0x2d2f4d, 'f147367bfc5cc916373ee2c42665ca2ed482398ed3633bfee4a716c9b05757ed'),
        ('skill projectile target update', 0x1e356b, 0x1e35c7, '35267829aea68047a011e5d0a2b5986b17149b674364173afb42647cc1fef80f'),
        ('projectile arrival path', 0x33e1b3, 0x33e34b, '596ca76251f4bab3213f935cfdb8344c3021f88e1510473248eead402238689c'),
        ('emitter trailer path', 0x338e98, 0x338fa3, '69e68d1d6e79fd49d1a232816fb30c4509a8f825c485ed94aa38127d722cdcaa'),
    ]
    for _, start, end, sha in ranges: assert hashlib.sha256(image.data[start:end]).hexdigest() == sha
    return {'instructionAnchors': len(anchors), 'constants': constants,
            'ranges': [{'name': n, 'startRVA': hex(a), 'endRVAExclusive': hex(b), 'SHA256': h} for n, a, b, h in ranges]}


def motion_audit(image, core):
    """Pin resolved target/clock dataflow while retaining erased-call limits."""
    methods = {
        '?GetTargetLocation@AActor@@UAEXVFVector@@AAV2@@Z': 0x28ac0,
        '?eventGetEffTargetLocation@AActor@@QAEXAAVFVector@@@Z': 0x28610,
        '?GetBoneCoords@USubSkeletalMeshInstance@@QAE?AVFCoords@@K@Z': 0x3b79e0,
        '?BoundProjectileVelocity@AActor@@UAEXXZ': 0x333750,
        '?performPhysics@AActor@@UAEXM@Z': 0x33f510,
        '?Tick@AActor@@UAEHMW4ELevelTick@@@Z': 0x2d3560,
    }
    for name, rva in methods.items(): assert image.exported(name, True) == image.base + rva
    for cls in ('AActor', 'APawn', 'AEmitter', 'ANProjectile', 'ANSkillProjectile'):
        assert image.u32(image.exported('??_7' + cls + '@@6B@') + 0x2b4) == image.exported(
            '?GetTargetLocation@AActor@@UAEXVFVector@@AAV2@@Z')
    vt = image.exported('??_7ANSkillProjectile@@6B@')
    for slot, name in [(0x184, '?TickAuthoritative@AActor@@UAEXM@Z'),
                       (0x1cc, '?performPhysics@AActor@@UAEXM@Z'),
                       (0x1d0, '?BoundProjectileVelocity@AActor@@UAEXXZ')]:
        assert image.u32(vt + slot) == image.exported(name)
    vt = image.exported('??_7USubSkeletalMeshInstance@@6B@')
    assert image.u32(vt + 0x128) == image.exported('?MeshToWorld@USubSkeletalMeshInstance@@UAE?AVFMatrix@@M@Z')
    anchors = [
        (0x28ac0, 'mov', 'eax, dword ptr [esp + 0x10]'), (0x28ac5, 'call', '0x10314f92'),
        (0x3a440e, 'call', '0x103051c8'), (0x3a15fe, 'call', '0x103051c8'),
        (0x3b7a80, 'fld1', ''), (0x3b7a85, 'mov', 'edx, dword ptr [eax + 0x128]'),
        (0x3b7a99, 'call', 'edx'),
        (0x20865f, 'fld', 'dword ptr [ebx + 0x2f4]'),
        (0x208665, 'fdiv', 'qword ptr [0x10853b28]'),
        (0x20866b, 'fadd', 'dword ptr [ebp + 0x64]'),
        (0x20866e, 'fstp', 'dword ptr [ebp + 0x64]'),
        # Spawn calls setPhysics before assigning TargetActor; this branch
        # cannot be treated as an initial-velocity assignment.
        (0x20874e, 'call', 'edx'), (0x208762, 'mov', 'dword ptr [esi + 0x4e4], eax'),
        (0x339609, 'cmp', 'bl, 0x11'), (0x33962f, 'test', 'byte ptr [edi + 0x504], 4'),
        (0x1e24d7, 'call', '0x10310f96'), (0x30bd74, 'call', '0x103073b5'),
        (0x2d2f68, 'mov', 'edx, dword ptr [eax + 0x1cc]'),
        (0x33f5f8, 'call', '0x1030cc9d'),
        (0x33de38, 'test', 'byte ptr [eax + 0x490], 0x20'),
        (0x33de43, 'fld', 'dword ptr [eax + 0x474]'),
        (0x33de53, 'fmul', 'qword ptr [0x108a0530]'),
        (0x33df2c, 'mov', 'edx, dword ptr [eax + 0x1d0]'), (0x33df32, 'call', 'edx'),
        (0x1e2754, 'fstp', 'dword ptr [ebp + 0xc]'),
        (0x1e275a, 'fst', 'dword ptr [esi + 0x4dc]'),
        (0x33377b, 'lea', 'edi, [esi + 0x1e0]'),
        (0x33378b, 'jne', '0x106337f2'),
        (0x3337a6, 'fcomp', 'qword ptr [ebp - 0x18]'),
        (0x3337ae, 'jp', '0x106337f2'),
        (0x33e1be, 'call', '0x10304bb0'), (0x33e1d7, 'call', '0x10304bb0'),
        (0x33e1df, 'fcomp', 'qword ptr [ebp + 0x5c]'),
        (0x33e1e7, 'jp', '0x1063de1c'),
        # Exact per-skill sound owners; these are separate from visual lifetime.
        (0x1f8076, 'mov', 'esi, ebx'), (0x1f8078, 'jmp', '0x104fa6a0'),
        (0x1f43e6, 'mov', 'esi, ebx'), (0x1f43e8, 'jmp', '0x104fa6a0'),
        (0x1f5efc, 'mov', 'esi, eax'), (0x1f5f7b, 'jmp', '0x104f3290'),
        (0x1f32bf, 'jne', '0x104fa6a0'), (0x1f32cc, 'jne', '0x104fa6a0'),
        (0x1f32e7, 'jmp', '0x104fa6a0'),
        (0x1fa6a5, 'je', '0x104fa6b2'), (0x1fa6ad, 'call', '0x10307360'),
        (0x207f98, 'mov', 'dword ptr [ebp + 0x68], esi'),
        (0x207f9e, 'jmp', '0x1050cea5'), (0x20ceaa, 'je', '0x1050ceb7'),
        (0x20ceb2, 'call', '0x10307360'),
    ]
    for rva, op, args in anchors: image.instruction(image.base + rva, op, args)
    # Actual two-table PHYS_NProjectile dispatch, not an assumed enum branch.
    selector = image.data[0x33f6fc + 17 - 2]
    assert image.u32(image.base + 0x33f6dc + selector * 4) == image.base + 0x33f5ed
    coefficient = struct.unpack_from('<d', image.data, image.offset(0x108a0530))[0]
    assert coefficient == f32(.2)
    # Preserve erasures explicitly. No downstream evaluator is allowed to
    # silently use SafeNormal/Size/IsZero/sqrt at these unresolved call sites.
    erased = [0x1e26ab, 0x1e274e, 0x333783, 0x333795, 0x3337a0, 0x3337b6, 0x3337ce, 0x7388f]
    for rva in erased: assert image.data[rva:rva + 6] == b'\x90' * 6
    # These distinct original Core exports fit the erased call-site ABIs.
    # Their existence is evidence against silently choosing one by shape.
    candidates = {
        '?SafeNormal@FVector@@QBE?AV1@XZ': 0x4e070,
        '?UnsafeNormal@FVector@@QBE?AV1@XZ': 0xccb0,
        '?Size@FVector@@QBEMXZ': 0xca20,
        '?SizeSquared@FVector@@QBEMXZ': 0xca60,
        '?IsZero@FVector@@QBEHXZ': 0xcae0,
        '?IsNearlyZero@FVector@@QBEHXZ': 0x15fb0,
    }
    for name, rva in candidates.items(): assert core.exported(name, True) == core.base + rva
    ranges = [
        ('target-event-wrapper', 0x28ac0, 0x28ace, '357b3f9c43cc07110aa159b53f4265ef10eb742ffc7ab53e0c3454e37553103a'),
        ('target-bone-world-coordinates', 0x3b7a80, 0x3b7aec, '0f758aeb3f1ff2264fd6bb1d9fd130a6776c3cbd36d0504e0988c33fc6bd6c2f'),
        ('physics-velocity-before-bound', 0x33de4d, 0x33df28, '578ebe9d412c8537f5729d2d525b556889360f3b1c6f20f37098425dbf86037b'),
        ('physics-displacement-after-bound', 0x33df39, 0x33df71, '19577f12d7fef3fe520f09223f1fb8a26b763cf8ce0035f2369f89b2f08f903e'),
        ('ordinary-projectile-steering', 0x1e2665, 0x1e279c, 'dd489fb54f3f42a634ef877170928cb36e3e0f5e4dc542088be04e75525ba606'),
        ('bound-projectile-velocity', 0x333750, 0x33380c, '587f24f4e94058c048dd9ebb2f8b68d155400617e64e7b34c4d5b942545204c1'),
        ('set-physics-projectile-branch', 0x339609, 0x33978e, '2f346dad0cf6237113415774b5a55214066c27d90fa97ae6a5172f76b7e965dc'),
        ('Power-cast-sound-owner-tail', 0x1f3290, 0x1f32ec, '700c90a95dff37871ab29aeb1d81068a1966790bce4e42778a5e9ba462d97908'),
    ]
    for _, start, end, sha in ranges: assert hashlib.sha256(image.data[start:end]).hexdigest() == sha
    cases = 0
    for velocity, acceleration in [([0, 0, 0], [0, 0, 0]), ([10, -25, .75], [3, -4, 5]),
                                   ([3000, 1000, -900], [-3000, .01, 3000]),
                                   ([1e7, -.1234567, 44.55], [-.9876543, 200.3, -1000.1])]:
        velocity, acceleration = list(map(f32, velocity)), list(map(f32, acceleration))
        for delta in [0., 1 / 120, 1 / 30, .25, 2.]:
            for friction in [0., 1.1, 10.]:
                delta, friction = f32(delta), f32(friction)
                actor, frame = 0x10000, 0x20000
                memory = {actor + 0x1d4 + i * 4: v for i, v in enumerate(velocity)}
                memory.update({actor + 0x1e0 + i * 4: a for i, a in enumerate(acceleration)})
                memory[0x108a0530] = coefficient
                machine = LinearX87(memory, {'esi': actor, 'ebp': frame}, [friction, delta])
                machine.run(image.dis.disasm(image.data[0x33de4d:0x33df28], image.base + 0x33de4d))
                actual = [machine.memory[actor + 0x1d4 + i * 4] for i in range(3)]
                assert actual == velocity_before_bound(velocity, acceleration, delta, friction)
                # The bound is deliberately an external input, not evaluated.
                machine.memory[frame + 0x78] = delta
                machine.run(image.dis.disasm(image.data[0x33df39:0x33df71], image.base + 0x33df39))
                movement = [machine.memory[frame + 0x4c + i * 4] for i in range(3)]
                assert movement == displacement_after_bound(actual, delta)
                cases += 1
    return {'instructionAnchors': len(anchors), 'arithmeticCases': cases,
            'fluidFrictionCoefficient': coefficient, 'unresolvedErasedCallRVAs': list(map(hex, erased)),
            'coreSHA256': core.sha, 'unselectedCoreVectorCandidates': {n: hex(r) for n, r in candidates.items()},
            'ranges': [{'name': n, 'startRVA': hex(a), 'endRVAExclusive': hex(b), 'SHA256': h} for n, a, b, h in ranges],
            'limit': 'arithmetic before/after external bound only; no complete motion or bone evaluator'}


def verify():
    from check_tutorial_quest_native import Image
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT / 'assets/interlude/system/Core.dll',
                 '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf')
    methods = {
        '?MagicProcess@APawn@@QAEXM@Z': 0x211ab0,
        '?SkillEffectInit@APawn@@QAEXXZ': 0x1f2ed0,
        '?SkillEffectFinalize@APawn@@QAEXXZ': 0x211640,
        '?SkillEffectShot@APawn@@QAEPAVANSkillProjectile@@XZ': 0x1fe660,
        '?SkillEffectExplosion@ANSkillProjectile@@QAEXVFVector@@PAVAActor@@@Z': 0x1e3650,
        '?processHitWall@ANSkillProjectile@@UAEXVFVector@@PAVAActor@@@Z': 0x1e98b0,
        '?Notify@UAnimNotify_AttackShot@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': 0x3bd100,
        '?Notify@UAnimNotify_Effect@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': 0x3bdb10,
    }
    for name, rva in methods.items(): assert image.exported(name, True) == image.base + rva
    for name, stub in [
        ('?SkillEffectInit@APawn@@QAEXXZ', 0x11cca),
        ('?SkillEffectFinalize@APawn@@QAEXXZ', 0xf457),
        ('?SkillEffectShot@APawn@@QAEPAVANSkillProjectile@@XZ', 0x7cf7),
        ('?SkillEffectExplosion@ANSkillProjectile@@QAEXVFVector@@PAVAActor@@@Z', 0x293c),
        ('?SkillEffectChanneling@APawn@@QAEXXZ', 0x113bf),
        ('?SkillEffectPreShot@APawn@@QAEXXZ', 0x13610),
    ]:
        assert image.exported(name) == image.base + stub
    spawn_name = '?SpawnSkillEffect@AActor@@QAEPAV1@PAV1@0VFName@@HVFVector@@VFRotator@@MHHHH@Z'
    assert image.exported(spawn_name) == 0x103147c7
    level_vtable = image.exported('??_7ULevel@@6BUObject@@@')
    assert image.u32(level_vtable + 0xc0) == image.exported(
        '?SpawnActor@ULevel@@UAEPAVAActor@@PAVUClass@@VFName@@VFVector@@VFRotator@@PAV2@HH4PAVAPawn@@@Z')
    anchors = [
        # Agent-null paths, not alias selection from Skill.usk.
        (0x211b1e, 'mov', 'ecx, dword ptr [esi + 0x4f0]'),
        (0x211b26, 'je', '0x10511b37'), (0x211b39, 'call', '0x10311cca'),
        (0x211c3d, 'je', '0x10511c4e'), (0x211c50, 'call', '0x103113bf'),
        (0x211c72, 'je', '0x10511c7c'), (0x211c7e, 'call', '0x10313610'),
        (0x211c93, 'call', '0x1030f457'),
        (0x211734, 'mov', 'ecx, dword ptr [esi + 0x4f0]'),
        (0x21173a, 'add', 'dword ptr [esi + 0x508], 1'),
        (0x211743, 'je', '0x1051184e'), (0x211850, 'call', '0x10307cf7'),
        (0x1e9ad9, 'cmp', 'dword ptr [edi + 0x538], 0'),
        (0x1e9ae0, 'je', '0x104e9b17'), (0x1e9b33, 'call', '0x1030293c'),
        # Original IDs feed the compiled switches.
        (0x1f2f40, 'mov', 'eax, dword ptr [ebx + 0x4f8]'),
        (0x1fe6cd, 'mov', 'ecx, dword ptr [ebx + 0x4f8]'),
        (0x1e3690, 'mov', 'eax, dword ptr [esi + 0x5f0]'),
        # Wind casting actor spawns and source-clock field assignment.
        (0x1f7f08, 'push', '0x108a9cb8'), (0x1f7f19, 'call', '0x103147c7'),
        (0x1f8045, 'push', '0x108a9c80'), (0x1f8051, 'call', '0x103147c7'),
        (0x1f806a, 'fld', 'dword ptr [ebx + 0x514]'),
        (0x1f8070, 'fstp', 'dword ptr [eax + 0xe8]'),
        # Wind shot requires final notify and an actual target.
        (0x20862b, 'cmp', 'dword ptr [ebx + 0x59c], 2'),
        (0x208632, 'jne', '0x1050ceb7'),
        (0x208638, 'cmp', 'dword ptr [ebx + 0x520], esi'),
        (0x20863e, 'je', '0x1050ceb7'),
        (0x208680, 'push', '0x108a7a88'),
        (0x2086a2, 'add', 'esi, 0xc0'), (0x2086fc, 'call', 'eax'),
        (0x208750, 'mov', 'eax, dword ptr [ebx + 0x4f8]'),
        (0x208756, 'mov', 'dword ptr [esi + 0x5f0], eax'),
        (0x208775, 'mov', 'eax, dword ptr [ebx + 0x4f8]'),
        (0x20877b, 'mov', 'dword ptr [esi + 0x540], eax'),
        (0x208781, 'mov', 'ecx, dword ptr [ebx + 0x4fc]'),
        (0x208787, 'mov', 'dword ptr [esi + 0x544], ecx'),
        (0x1e5057, 'push', '0x108a8360'),
        (0x1e507c, 'add', 'ebx, 0xc0'), (0x1e50ce, 'call', 'edx'),
        # Power Strike's separately selected casting effect.
        (0x1f5ee8, 'push', '0x108aa2dc'), (0x1f5ef7, 'call', '0x103147c7'),
        # A shot notify requests phase work; a generic effect notify spawns independently.
        (0x3bd18c, 'mov', 'dword ptr [esi + 0x59c], 2'),
        (0x3bd1a3, 'mov', 'dword ptr [esi + 0x59c], 1'),
        (0x3bdb43, 'mov', 'ecx, dword ptr [esi + 0x38]'),
        (0x3bdb48, 'je', '0x106be099'),
        (0x3bdc45, 'mov', 'edx, dword ptr [esi + 0x38]'),
        (0x3bdc48, 'push', 'edx'), (0x3bdc4d, 'call', 'eax'),
    ]
    for rva, op, args in anchors: image.instruction(image.base + rva, op, args)
    for va, name in [(0x108a9cb8, 'm_u000_a'), (0x108a9c80, 'm_u000_b'),
                     (0x108a7a88, 'm_u000_c'), (0x108a8360, 'm_u000_d'), (0x108aa2dc, 's_u002_a')]:
        assert image.wide(va) == 'LineageEffect.' + name
    ranges = [(0x1f2f46, 0x1f2f73), (0x1f3760, 0x1f3792), (0x1f3e07, 0x1f3e36),
              (0x1fe6d5, 0x1fe702), (0x1ff643, 0x1ff660), (0x200a31, 0x200a60),
              (0x1e3696, 0x1e36e1), (0x1e3e39, 0x1e3e68)]
    def decode(va):
        offset = image.offset(va)
        return next(image.dis.disasm(image.data[offset:offset + 16], va))
    def read(va, width):
        return int.from_bytes(image.data[image.offset(va):image.offset(va) + width], 'little')
    evaluator = Dispatch(decode, read, [(image.base + a, image.base + b) for a, b in ranges])
    cases = [(1177, 'casting', 0x1f2f46, 0x1f7ec5), (1177, 'shot', 0x1fe6d5, 0x20862b),
             (1177, 'impact', 0x1e3696, 0x1e4ecd), (3, 'casting', 0x1f2f46, 0x1f5e83)]
    dispatches = []
    for sid, phase, start, target in cases:
        result = evaluator.run(image.base + start, sid, {image.base + target})
        dispatches.append({'skillId': sid, 'phase': phase, 'targetRVA': hex(result['target'] - image.base),
                           'visitedRVAs': [hex(pc - image.base) for pc in result['trace']]})
    pinned = [
        ('Wind casting', 0x1f7ec5, 0x1f807d, '9883a9b2a7b2f5e3da90ec7a82c2745353fea1b29a1c5dbbf56c1321dd646ac5'),
        ('Wind shot', 0x20862b, 0x208798, '178316353df5b4de90ebc6cbfed8a031c12d8c462ce57b51179de54626ee2ac4'),
        ('Wind impact', 0x1e4ecd, 0x1e50db, '30fa5c4fcd682c127ba126a8df3a0ead139bcadac23be16ae5cae6759537f254'),
        ('Power casting', 0x1f5e83, 0x1f5f80, 'f5b4b5591393de48086425b183996774a8b21854b910ba7d84ebce4c65acac9b'),
        ('HitWall Agent gate', 0x1e9ad9, 0x1e9b38, '9c1cb6144484a8a36edbb725d2772a1812b90aef1a11640eba982407e727098d'),
    ]
    for _, start, end, sha in pinned: assert hashlib.sha256(image.data[start:end]).hexdigest() == sha
    return {'tool': 'Elbera Tools', 'engineSHA256': ENGINE_SHA, 'instructionAnchors': len(anchors),
            'dispatches': dispatches, 'originalSources': source_audit(),
            'lifecycle': lifecycle_audit(image),
            'motion': motion_audit(image, core),
            'ranges': [{'name': n, 'startRVA': hex(a), 'endRVAExclusive': hex(b), 'SHA256': h} for n, a, b, h in pinned],
            'limits': ['static source proof, not original client execution',
                       'imported class-load and vector helper calls remain erased',
                       'target bone selection established; complete bone transform/helper execution remains open',
                       'initial projectile velocity, complete movement/collision and emitter parity not established',
                       'default overrides and bounded lifecycle gates do not emulate the complete effect',
                       'Power Strike shot/impact and other IDs are outside this bounded proof']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = verify()
    if args.json: print(json.dumps(result, indent=2))
    else: print(f"PASS: Elbera Tools legacy effects; {result['instructionAnchors']} dispatch + {result['lifecycle']['instructionAnchors']} lifecycle + {result['motion']['instructionAnchors']} motion/sound anchors, 4 ID dispatches, {result['motion']['arithmeticCases']} arithmetic cases, 5 classes, 18 pinned ranges")
