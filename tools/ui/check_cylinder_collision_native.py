#!/usr/bin/env python3
"""Elbera Tools: finite original actor cylinder arithmetic/runtime check.

Requires pinned owned Engine/Core, capstone and Node. Optional explicit pinned
supplemental Engine provides method-relative named-call correspondence, never
restored imports or distribution authentication. Does not execute native DLLs
or emit original data. Binary64 approximates x87; sqrt is a mathematical boundary.
Actor filtering, collision-hash ordering and native placement remain separate.
"""
import argparse
import hashlib
import json
import math
import random
import struct
import subprocess

from check_bsp_camera_native import run_sweep_slice
from check_hair_attachment_native import compare_call_block


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


NAMED = {
    0x10646328: ('safe', '?SafeNormal@FVector@@QBE?AV1@XZ'),
    0x106463c0: ('sqrt', '?appSqrt@@YANN@Z'),
    0x106464c2: ('normalize', '?Normalize@FVector@@QAEHXZ'),
}
DIRECT = {0x1030a2b3: 'extent', 0x10305ed9: 'maximum',
          0x10303ddc: 'minimum', 0x10307743: 'clamp'}


def bound_cylinder_import(site, raw):
    """Only three explicitly qualified erased sites are modeled as helpers."""
    if site not in NAMED or raw != b'\x90' * 6:
        raise ValueError('unknown cylinder import site or byte pattern')
    return NAMED[site][0]

class CylinderEvaluator:
    """Finite call/frame adapter; all ordinary arithmetic uses existing runner.

    The ordinary solver starts after SEH setup and stops at the shared epilogue.
    Every supported call is explicitly declared; unknown calls/instructions fail.
    """
    def __init__(self, engine, core):
        from check_cast_scheduler_native import Arithmetic
        self.engine, self.core, self.machine = engine, core, Arithmetic
        self.ranges = {
            'cylinder': (engine, 0x10645e0f, 0x106465a7),
            'extent': (engine, 0x1033e620, 0x1033e641),
            'maximum': (engine, 0x104a4940, 0x104a4967),
            'minimum': (engine, 0x104a4970, 0x104a4997),
            'clamp': (engine, 0x103704b0, 0x103704e6),
            'safe': (core, 0x1014e070, 0x1014e0f9),
            'normalize': (core, 0x1010cb20, 0x1010cb92),
            'result': (engine, 0x104419f0, 0x10441a28),
        }
        self.code = {}
        for key, (image, start, end) in self.ranges.items():
            rows = list(image.dis.disasm(image.data[image.offset(start):image.offset(end)],start))
            cursor = start
            for row in rows:
                assert row.address == cursor
                cursor += row.size
            assert cursor == end
            self.code[key] = {row.address: row for row in rows}
        self.visited, self.branches = set(), set()

    def call(self, machine, key):
        machine.registers['esp'] -= 4
        machine.memory[machine.registers['esp']] = 0xdead0000
        self.run(machine, key)

    def run(self, machine, key):
        image, start, _ = self.ranges[key]
        previous_image, machine.image, pc = machine.image, image, start
        try:
            for _ in range(5000):
                if key == 'cylinder' and pc == 0x10645e78:
                    return  # Common SEH/register-restoration epilogue, separately pinned.
                instruction = self.code[key][pc]
                op, args = instruction.mnemonic, instruction.op_str.split(', ')
                nxt = pc + instruction.size
                self.visited.add(pc)
                if pc in NAMED:
                    name = bound_cylinder_import(pc, bytes(image.data[image.offset(pc):image.offset(pc) + 6]))
                    if name == 'sqrt':
                        self.sqrt(machine)
                    else:
                        self.call(machine, name)
                    nxt = pc + 6
                elif op == 'call':
                    target = int(args[0], 0)
                    if target == 0x10104840:
                        self.sqrt(machine)
                    else:
                        self.call(machine, DIRECT[target])
                elif op == 'ret':
                    machine.registers['esp'] += 4 + int(instruction.op_str or '0', 0)
                    return
                elif op == 'pop':
                    machine.write(args[0], machine.memory[machine.registers['esp']])
                    machine.registers['esp'] += 4
                elif op in ('fdivp', 'fdivrp'):
                    index = int(args[0][3:-1])
                    numerator, denominator = machine.stack[index], machine.stack[0]
                    if op == 'fdivrp':
                        numerator, denominator = denominator, numerator
                    assert denominator != 0 and math.isfinite(numerator) and math.isfinite(denominator)
                    machine.stack[index] = numerator / denominator
                    machine.stack.pop(0)
                elif op == 'wait':
                    pass
                elif op.startswith('j'):
                    take = {'jmp': True, 'je': machine.flags.get('z'),
                            'jne': not machine.flags.get('z'), 'jp': machine.flags.get('p'),
                            'jnp': not machine.flags.get('p')}[op]
                    if take:
                        nxt = int(args[0], 0)
                else:
                    nxt = run_sweep_slice(image, machine, pc, nxt, max_steps=2)
                if op.startswith('j'):
                    self.branches.add((pc, nxt))
                pc = nxt
            raise AssertionError('cylinder instruction step cap')
        finally:
            machine.image = previous_image

    @staticmethod
    def sqrt(machine):
        value = machine.memory[machine.registers['esp']]
        assert math.isfinite(value) and value >= 0
        machine.stack.insert(0, math.sqrt(value))

    def evaluate(self, case):
        frame, sp, result, actor, skins = 0x100000, 0x200000, 0x300000, 0x400000, 0x500000
        memory = {frame + 0x44: result, frame + 0x48: 0 if case.get('nullActor') else actor,
                  actor + 0x2f0: case['radius'], actor + 0x2f4: case['height'],
                  actor + 0x298: skins, actor + 0x29c: len(case.get('skins', []))}
        for index, value in enumerate(case.get('skins', [])):
            memory[skins + index * 4] = value
        for offset, values in [(0x4c, case['end']), (0x58, case['start']), (0x64, case['extent'])]:
            memory.update({frame + offset + i * 4: f32(x) for i, x in enumerate(values)})
        memory.update({actor + 0x1bc + i * 4: f32(x) for i, x in enumerate(case['center'])})
        for offset in (0, 4, 8, 0xc, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c):
            memory[result + offset] = 77
        for i, value in enumerate(case.get('initialNormal', [11., 12., 13.])):
            memory[result + 0x14 + i * 4] = value
        machine = self.machine(self.engine, memory, [],
            dict(ebp=frame, esp=sp, ebx=0, esi=0, edi=0, ecx=0, eax=0, edx=0))
        self.run(machine, 'cylinder')
        assert not machine.stack and machine.registers['eax'] in (0, 1)
        return {'hit': machine.registers['eax'] == 0, **self.result(machine, result)}

    @staticmethod
    def result(machine, result):
        material = machine.memory[result + 0x2c]
        actor, next_result = machine.memory[result + 4], machine.memory[result]
        node = machine.memory[result + 0x28]
        node = struct.unpack('<i', struct.pack('<I', node & 0xffffffff))[0]
        return {'time': machine.memory[result + 0x24],
                'point': [machine.memory[result + offset] for offset in (8, 12, 16)],
                'normal': [machine.memory[result + offset] for offset in (20, 24, 28)],
                'actor': None if actor == 0 else actor, 'item': machine.memory[result + 0x20],
                'nodeIndex': node,
                'next': None if next_result == 0 else next_result,
                'material': None if material == 0 else material}

    def actor_hash_initial_result(self):
        sp, result = 0x200000, 0x300000
        machine = self.machine(self.engine, {sp: 0., sp + 4: 0}, [],
            dict(esp=sp, ecx=result, eax=0))
        self.call(machine, 'result')
        assert not machine.stack and machine.registers['eax'] == result
        return self.result(machine, result)


def differential_cases():
    """Synthetic finite geometry only; no source asset or captured game fixture."""
    rng = random.Random(0x645de0)
    cases = []
    for _ in range(1000):
        center = [f32(rng.uniform(-10000, 10000)) for _ in range(3)]
        cases.append({'center': center, 'radius': f32(rng.uniform(.1, 30)),
            'height': f32(rng.uniform(.1, 50)), 'extent': [f32(rng.uniform(0, 10)) for _ in range(3)],
            'start': [f32(center[i] + rng.uniform(-70, 70)) for i in range(3)],
            'end': [f32(center[i] + rng.uniform(-70, 70)) for i in range(3)]})
    for extent in ([0., 0., 0.], [1., 1., 2.], [1., 3., 2.]):
        radius, height = 5 + extent[0], 10 + extent[2]
        starts = [[x, y, z] for x, y in [(-radius, 0.), (radius, 0.), (0., radius),
            (0., -radius), (0., 0.), (radius * .5, radius * .5), (radius, radius)]
            for z in [-height, -height + f32(.00001), 0., height - f32(.00001), height]]
        ends = [[x, y, z] for x, y in [(-2 * radius, 0.), (2 * radius, 0.), (0., 0.), (0., radius)]
                for z in [-2 * height, 0., 2 * height]]
        for start in starts:
            for end in ends:
                cases.append({'center': [0., 0., 0.], 'radius': 5., 'height': 10.,
                    'extent': extent, 'start': list(map(f32, start)), 'end': list(map(f32, end))})
    base = {'center': [0., 0., 0.], 'radius': 5., 'height': 10., 'extent': [0., 0., 0.]}
    for skins in ([], [0], [99], [99, 100]):
        for z in (0., -0., -2.):
            cases.append({**base, 'start': [2., 0., z], 'end': [1., 0., z], 'skins': skins})
    for point in ([5., 0., 10.], [0., 0., 10.], [0., 0., -10.], [5., -0., 0.]):
        cases.append({**base, 'start': point, 'end': list(point)})
    cases.append({**base, 'start': [2., 0., 0.], 'end': [1., 0., 0.], 'nullActor': True})
    return cases


def result_bits(result):
    bits = lambda value: struct.unpack('<I', struct.pack('<f', value))[0]
    return {**result, 'time': bits(result['time']),
            'point': list(map(bits, result['point'])), 'normal': list(map(bits, result['normal']))}


def verify(comparison_engine=None):
    from pathlib import Path
    from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    from check_supplemental_engine import CANDIDATE_ENGINE_SHA
    from supplemental_pe import PEImage
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    candidate = PEImage(Path(comparison_engine), CANDIDATE_ENGINE_SHA) if comparison_engine else None
    evaluator = CylinderEvaluator(engine, core)
    read = lambda image, start, end: bytes(image.data[image.offset(start):image.offset(end)])
    digests = {
        'cylinder': 'fcf35350898a9c593d1a6fbfb045612d80c21363bb28ddbdc62397af587bc55e',
        'extent': '5975fc09dff5e53b4867b1b1a5237f01210d18cfeb7d8c863758f7eb06cd1473',
        'maximum': 'b99398a92cf30c3236765c5a933645d5d5116f790b9b69f4fd8d7fc4e28d1abc',
        'minimum': '8bf476fbbb8052854e6df97c1661b69dcfde985ea669d3e1ead40f5da676fdc1',
        'clamp': 'b70b787f404c9dea5d3a4cec672683404a3d63b72c4a1e4f532abda3e90cba8b',
        'safe': '65be4f91a62f0af78d7b1698596e0de19a68e457d58bcd122fc1c8cc172c0414',
        'normalize': 'b25deaaa4c169a8bc74ebe2f8c5ee8a48e79d6d5d91f18329cd1dc592cd3a011',
        'result': '1dc62e2438bbb2e80a56bee31ca54d3129aeed5b7b7178b25c27423de27a5d67',
    }
    ranges = []
    for name, (image, start, end) in evaluator.ranges.items():
        raw = read(image, start, end)
        assert hashlib.sha256(raw).hexdigest() == digests[name], name
        ranges.append({'name': name, 'start': hex(start), 'end': hex(end), 'SHA256': digests[name]})
    line_symbol = '?LineCheck@UPrimitive@@UAEHAAUFCheckResult@@PAVAActor@@VFVector@@22KK@Z'
    assert engine.exported(line_symbol, True) == 0x10645de0
    engine.instruction(0x10645de1, 'lea', 'ebp, [esp - 0x3c]')
    engine.instruction(0x10645e09, 'xor', 'ebx, ebx')
    for name in ('UPrimitive', 'UMesh', 'ULodMesh', 'USkeletalMesh'):
        table = engine.exported(f'??_7{name}@@6B@')
        assert engine.u32(table + 0x6c) == engine.exported(line_symbol)
    assert engine.exported('?GetCylinderExtent@AActor@@QBE?AVFVector@@XZ', True) == 0x1033e620
    for thunk, key in DIRECT.items():
        engine.instruction(thunk, 'jmp', hex(evaluator.ranges[key][1]))
    for site, (key, symbol) in NAMED.items():
        assert read(engine, site, site + 6) == b'\x90' * 6
        if key != 'sqrt':
            assert core.exported(symbol, True) == evaluator.ranges[key][1]
    assert core.exported('?appSqrt@@YANN@Z') == 0x10104840
    assert core.exported('?appSqrt@@YANN@Z', True) == 0x1012d790
    core.instruction(0x1012d790, 'fld', 'qword ptr [esp + 4]')
    core.instruction(0x1012d794, 'jmp', '0x1017cb60')
    # No geometry/result writes in the common return cleanup.
    epilogue = [(0x10645e78, 'wait', ''), (0x10645e79, 'mov', 'ecx, dword ptr [ebp - 0xc]'),
        (0x10645e7c, 'mov', 'dword ptr fs:[0], ecx'), (0x10645e83, 'pop', 'edi'),
        (0x10645e84, 'pop', 'esi'), (0x10645e85, 'pop', 'ebx'),
        (0x10645e86, 'add', 'ebp, 0x3c'), (0x10645e89, 'mov', 'esp, ebp'),
        (0x10645e8b, 'pop', 'ebp'), (0x10645e8c, 'ret', '0x34')]
    for address, mnemonic, operands in epilogue:
        engine.instruction(address, mnemonic, operands)
    for address, mnemonic, operands in [
        (0x10523e88, 'push', '0'), (0x10523e8a, 'push', 'ecx'),
        (0x10523e8b, 'fldz', ''), (0x10523e8d, 'fstp', 'dword ptr [esp]'),
        (0x10523e90, 'lea', 'ecx, [ebp - 0x8c]'), (0x10523e96, 'call', '0x103048d6'),
        (0x103048d6, 'jmp', '0x104419f0'),
    ]:
        engine.instruction(address, mnemonic, operands)
    binding = {'status': 'unresolved-without-comparison', 'sites': [hex(x) for x in NAMED]}
    if candidate:
        _, start, end = evaluator.ranges['cylinder']
        raw = read(engine, start, end)
        binding = compare_call_block(raw, candidate.read(start - 0x40, end - start),
            owned_va=start, candidate_va=start - 0x40,
            sites=[(site - start, ('core.dll', symbol)) for site, (_, symbol) in NAMED.items()],
            direct_calls=[i.address - start for i in evaluator.code['cylinder'].values() if i.mnemonic == 'call'],
            imports=candidate.imports)
        assert binding['normalizedSHA256'] == '5d7225937e9b849930be6b6e341a8c6717612ce8a5c61abf1a130d9a602067e1'
        binding['status'] = 'exact-qualified-supplemental-correspondence'
    cases = differential_cases()
    expected = [result_bits(evaluator.evaluate(case)) for case in cases]
    script = r"""
import fs from 'node:fs';
import {traceActorCylinder, createActorHashResult} from './editor/world/js/cylinder-collision.js';
const view = new DataView(new ArrayBuffer(4));
const bits = value => {view.setFloat32(0, value, true); return view.getUint32(0, true)};
const out = JSON.parse(fs.readFileSync(0, 'utf8')).map(c => {
  const actor = c.nullActor ? null : {identity: 0x400000, location: c.center,
    collisionRadius: c.radius, collisionHeight: c.height, skins: (c.skins || []).map(x => x === 0 ? null : x)};
  const initialResult = {normal: c.initialNormal || [11, 12, 13], point: [77, 77, 77],
    actor: 77, item: 77, material: 77, time: 77, next: 77, nodeIndex: 77};
  const value = traceActorCylinder({...c, actor, initialResult});
  if (value.status !== 'ready') throw Error(JSON.stringify({c, value}));
  const r = value.result;
  return {hit: value.hit, time: bits(r.time), point: r.point.map(bits), normal: r.normal.map(bits),
    actor: r.actor, item: r.item, material: r.material, next: r.next, nodeIndex: r.nodeIndex};
});
const initial = createActorHashResult();
console.log(JSON.stringify({cases: out, initial: {...initial, time: bits(initial.time),
  point: initial.point.map(bits), normal: initial.normal.map(bits)}}));
"""
    process = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
        input=json.dumps(cases), text=True, capture_output=True, check=True)
    output = json.loads(process.stdout)
    actual = output['cases']
    assert len(actual) == len(expected)
    for index, (wanted, got) in enumerate(zip(expected, actual)):
        assert wanted == got, {'case': index, 'input': cases[index], 'native': wanted, 'runtime': got}
    initial = evaluator.actor_hash_initial_result()
    assert result_bits(initial) == output['initial']
    return {'tool': 'Elbera Tools', 'engineSHA256': ENGINE_SHA, 'coreSHA256': CORE_SHA,
        'comparisonEngineSHA256': candidate.sha if candidate else None, 'callBindings': binding,
        'ranges': ranges, 'vtableClasses': ['UPrimitive', 'UMesh', 'ULodMesh', 'USkeletalMesh'],
        'actualRuntimeCases': len(cases), 'hits': sum(row['hit'] for row in expected),
        'actorHashInitialResult': initial, 'actualInitializerComparisons': 1,
        'retainedInstructionsExercised': len(evaluator.visited), 'branchEdges': len(evaluator.branches),
        'limits': ['Owned-only mode conditionally evaluates the three explicitly assumed imported helper identities.',
            'Supplemental correspondence is qualified evidence, not restored owned imports or authenticated distribution.',
            'Finite binary64 approximates x87; mathematical sqrt is not full CRT/extended-precision execution.',
            'Actual Actor.Location/dimensions and caller result fields are operands, not inferred from packets or renderer.',
            'No actor hash/filter admission, native world placement, aggregate collision or gameplay integration.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--comparison-engine', help='Explicit pinned supplemental Engine; qualified correspondence only')
    args = parser.parse_args()
    result = verify(args.comparison_engine)
    if args.check:
        print(f"Elbera Tools actor cylinder PASS: {result['actualRuntimeCases']} actual-module comparisons, "
              f"{result['hits']} hits, {result['retainedInstructionsExercised']} retained instruction addresses; "
              f"{result['callBindings']['status']}")
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
