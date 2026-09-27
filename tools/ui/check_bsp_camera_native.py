#!/usr/bin/env python3
"""Elbera Tools: original world BSP primary ray and runtime arithmetic check.

python3 tools/ui/check_bsp_camera_native.py --check

Requires the owner's pinned Engine/Core DLLs, capstone and Node. Interprets
retained arithmetic, the single-plane box-sweep helper, and no-owner candidate
traversal against JavaScript. Bounds-plane calls capture arguments only;
candidate traversal models only its verified self-recursion. Never executes
the DLLs or writes source assets. Float64 approximates extended intermediates,
with Float32 stores preserved. No isolated primitive is a complete camera trace.
"""
import argparse
import hashlib
import json
import math
import random
import struct
import subprocess


def native_plane_interval(image, case):
    """Interpret the entire retained 0x10746460 helper, never native calls.

    This small instruction runner admits only operations present in that exact
    pinned function. Float64 approximates extended intermediates; source DWORD
    stores and bitwise absolute values are preserved. An unused divide-by-zero
    result in the native parallel branch is modeled with IEEE infinities/NaN.
    """
    from check_cast_scheduler_native import Arithmetic, f32
    state, plane, sp = 0x100000, 0x200000, 0x300000
    memory = {sp + 4: plane, state + 0x88: case['enter'], state + 0x8c: case['exit']}
    for offset, values in [(0x4c, case['extent']), (0x5e0, case['start']),
                           (0x5d4, case['end']), (0x60, case['normal'])]:
        memory.update({state + offset + i * 4: f32(value) for i, value in enumerate(values)})
    memory.update({plane + i * 4: f32(value) for i, value in enumerate(case['plane'])})
    machine = Arithmetic(image, memory, [], {'ecx': state, 'esp': sp})
    run_sweep_slice(image, machine, 0x10746460, 0x107465f0)
    return {'continues': bool(machine.registers['eax']),
            'enter': machine.memory[state + 0x88], 'exit': machine.memory[state + 0x8c],
            'normal': [machine.memory[state + 0x60 + i * 4] for i in range(3)],
            'visited': machine.trace}


def run_sweep_slice(image, machine, start, end, *, stop=None, on_call=None, max_steps=512):
    """Interpret only retained bounded instructions; calls require an explicit hook.

    The bounds-plane hook captures arguments and returns synthetic success; it
    proves emitted planes, not the subsequent clipping result. Other slices
    reject every call. No six-NOP import is admitted as a callable operation.
    """
    instructions = {i.address: i for i in image.dis.disasm(
        image.data[image.offset(start):image.offset(end)], start)}
    pc = start
    stops = {end} if stop is None else set(stop) if isinstance(stop, tuple) else {stop}
    for _ in range(max_steps):
        if pc in stops: return pc
        instruction = instructions[pc]
        machine.trace.append(pc)
        op, args = instruction.mnemonic, instruction.op_str.split(', ')
        nxt = pc + instruction.size
        if op == 'ret':
            assert instruction.op_str == '8' and not machine.stack
            return
        if op in ('mov', 'lea'):
            machine.write(args[0], machine.address(args[1]) if op == 'lea' else machine.read(args[1]))
        elif op == 'push':
            value = machine.read(args[0]); machine.registers['esp'] -= 4
            machine.memory[machine.registers['esp']] = value
        elif op == 'call':
            assert on_call is not None, 'call not admitted by this bounded slice'
            on_call(machine, int(args[0], 0))
        elif op in ('sub', 'add', 'xor', 'or', 'shl'):
            a, b = (0, 0) if op == 'xor' and args[0] == args[1] else map(machine.read, args)
            value = a - b if op == 'sub' else a + b if op == 'add' else a | b if op == 'or' else a << b if op == 'shl' else a ^ b
            machine.write(args[0], value)
            machine.compare(value, 0)
        elif op == 'neg':
            value = -machine.read(args[0]); machine.write(args[0], value); machine.compare(value, 0)
        elif op == 'cmp': machine.compare(*map(machine.read, args))
        elif op == 'and':
            if args[0] in ('eax', 'edx'):
                value = machine.read(args[0]) & machine.read(args[1])
                machine.write(args[0], value); machine.compare(value, 0)
            else:
                assert args[0].startswith('dword ptr [esp') and args[1] == 'eax'
                bits = struct.unpack('<I', struct.pack('<f', machine.read(args[0])))[0]
                machine.write(args[0], struct.unpack('<f', struct.pack('<I', bits & machine.read(args[1])))[0])
        elif op == 'test':
            value = machine.read(args[0]) & machine.read(args[1])
            machine.flags = {'z': value == 0, 'p': bin(value & 255).count('1') % 2 == 0}
        elif op == 'fnstsw': machine.write(args[0], machine.status)
        elif op in ('jmp', 'je', 'jne', 'jp', 'jnp', 'jbe'):
            take = {'jmp': True, 'je': machine.flags.get('z'), 'jne': not machine.flags.get('z'),
                    'jp': machine.flags.get('p'), 'jnp': not machine.flags.get('p'),
                    'jbe': machine.flags.get('s') or machine.flags.get('z')}[op]
            if take: nxt = int(args[0], 0)
        elif op in ('fld', 'fldz', 'fld1'):
            machine.stack.insert(0, machine.read(args[0]) if op == 'fld' else 0. if op == 'fldz' else 1.)
        elif op in ('fst', 'fstp'):
            machine.write(args[0], machine.stack[0], floating=True)
            if op == 'fstp': machine.stack.pop(0)
        elif op == 'fxch':
            index = int(args[0][3:-1])
            machine.stack[0], machine.stack[index] = machine.stack[index], machine.stack[0]
        elif op == 'fchs': machine.stack[0] = -machine.stack[0]
        elif op in ('fcom', 'fcomp', 'fcompp'):
            a, b = machine.stack[0], machine.stack[1] if op == 'fcompp' else machine.read(args[0])
            assert math.isfinite(a) and math.isfinite(b), 'comparison outside finite verifier domain'
            machine.status = 0x4000 if a == b else 0x100 if a < b else 0
            if op != 'fcom': del machine.stack[:2 if op == 'fcompp' else 1]
        elif op in ('fmul', 'fmulp', 'fadd', 'faddp', 'fsub', 'fsubr', 'fsubp', 'fsubrp', 'fdiv', 'fdivr'):
            pop = op.endswith('p')
            target = args[0] if pop or len(args) == 2 else 'st(0)'
            other = 'st(0)' if pop else args[1] if len(args) == 2 else args[0]
            a, b = machine.read(target), machine.read(other)
            if op.startswith('fmul'): value = a * b
            elif op.startswith('fadd'): value = a + b
            elif op.startswith('fsubr'): value = b - a
            elif op.startswith('fsub'): value = a - b
            elif op == 'fdivr': value = b / a
            elif b != 0: value = a / b
            else: value = float('nan') if a == 0 else math.copysign(float('inf'), a * math.copysign(1, b))
            machine.write(target, value)
            if pop: machine.stack.pop(0)
        else: raise AssertionError('unsupported sweep instruction: ' + str(instruction))
        pc = nxt
    raise AssertionError('bounded source sweep slice did not return')


def native_sweep_branches(image, case):
    from check_cast_scheduler_native import Arithmetic, f32
    state, sp = 0x100000, 0x200000
    memory = {sp + 0x14 + i * 4: f32(x) for i, x in enumerate(case['plane'])}
    for offset, values in [(0x4c, case['extent']), (0x5e0, case['start']), (0x5d4, case['end'])]:
        memory.update({state + offset + i * 4: f32(x) for i, x in enumerate(values)})
    factor = struct.unpack_from('<d', image.data, image.offset(0x108ceb98))[0]
    machine = Arithmetic(image, memory, [factor], {'edi': state, 'esp': sp, 'ebp': 0})
    run_sweep_slice(image, machine, 0x10748206, 0x10748269)
    end_distance = machine.memory[sp + 0x10]
    run_sweep_slice(image, machine, 0x10748269, 0x10748327)
    # Local+10 is reused to hold -radius after the original end-distance store.
    return {'back': bool(machine.memory[sp + 0x34]), 'front': bool(machine.memory[sp + 0x38]),
            'firstSide': 'front' if machine.registers['ebp'] else 'back',
            'radius': machine.memory[sp + 0x30], 'startDistance': machine.memory[sp + 0x78], 'endDistance': end_distance,
            'visited': machine.trace}


def native_bevel_axis_selection(image, case):
    """Execute sign classification and all three retained axis-admission blocks.

    Inputs are explicitly already oriented planes. No flagged-plane operation,
    plane-intersection helper or normalization import is executed/substituted.
    Each block stops before its first call; admitted later clipping is unknown.
    """
    from check_cast_scheduler_native import Arithmetic

    class BevelArithmetic(Arithmetic):
        def read(self, operand):
            if operand in ('al', 'dl'):
                return self.registers['eax' if operand == 'al' else 'edx'] & 255
            return super().read(operand)

    state, a, b, sp = 0x100000, 0x200000, 0x300000, 0x400000
    masks, visited = [], set()
    for plane in [case['planeA'], case['planeB']]:
        memory = {a + i * 4: x for i, x in enumerate(plane)}
        memory[state + 0x5c] = 0
        machine = BevelArithmetic(image, memory, [0.], {'edi': a, 'esi': state})
        run_sweep_slice(image, machine, 0x1074566e, 0x107456e6)
        assert machine.stack == [0.]
        masks.append(machine.memory[state + 0x4d0])
        visited.update(machine.trace)
    axes, dots = [], []
    for axis, start, success, skip in [
        ('x', 0x10748856, 0x10748914, 0x10748a4a),
        ('y', 0x10748a4a, 0x10748afa, 0x10748c2a),
        ('z', 0x10748c2a, 0x10748cc2, 0x10748dd1),
    ]:
        ma, mb = state + 0x4d0, state + 0x4d4
        memory = {a + i * 4: x for i, x in enumerate(case['planeA'])}
        memory.update({b + i * 4: x for i, x in enumerate(case['planeB'])})
        memory.update({sp + 0x24: ma, ma: masks[0], mb: masks[1]})
        machine = BevelArithmetic(image, memory, [0.],
            {'esp': sp, 'esi': a + 8, 'ebp': b + 4, 'eax': mb, 'edx': masks[0] | masks[1]})
        stopped = run_sweep_slice(image, machine, start, success, stop=(success, skip))
        assert machine.stack == [0.]
        if stopped == success: axes.append(axis)
        dots.append(machine.memory.get(sp + 0x10))
        visited.update(machine.trace)
    return {'maskA': masks[0], 'maskB': masks[1], 'axes': axes, 'projectedDots': dots,
            'visited': sorted(visited)}


def verify_bevel_axis_selection(engine):
    from check_tutorial_quest_native import ROOT
    from check_cast_scheduler_native import f32
    ranges = [
        (0x1074566e, 0x107456e6, 'ea13aa713e1df69e2ac2eb3331479bf96331753befc35e1e9c61b09ac41acb66'),
        (0x10748856, 0x10748914, 'cfa6cbd9f5f289482718dc3f276ae4c1c63fceac0fa2c89531fb5d14f5ed37fc'),
        (0x10748a4a, 0x10748afa, '165914c054c09340cb87ed1e8f309f973c03a1dfd429962c494053dbd77c4b5a'),
        (0x10748c2a, 0x10748cc2, '2e6bf7317eb0520536c521778cb04365aee77269177aec48c7ad4e81c8687154'),
    ]
    for a, b, digest in ranges:
        assert hashlib.sha256(engine.data[engine.offset(a):engine.offset(b)]).hexdigest() == digest
    anchors = [
        (0x1074566e, 'fcom', 'dword ptr [edi]'),
        (0x10745677, 'mov', 'edx, 1'), (0x10745687, 'mov', 'edx, 2'),
        (0x1074569a, 'mov', 'ecx, 4'), (0x107456ab, 'mov', 'ecx, 8'),
        (0x107456be, 'mov', 'eax, 0x10'), (0x107456cf, 'mov', 'eax, 0x20'),
        (0x107456df, 'mov', 'dword ptr [esi + ecx*4 + 0x4d0], eax'),
        (0x10748860, 'and', 'eax, 3'), (0x10748a4c, 'and', 'eax, 0xc'),
        (0x10748c2a, 'and', 'edx, 0x30'),
        (0x10748903, 'fcomp', 'dword ptr [0x108d7100]'),
        (0x10748ae9, 'fcomp', 'dword ptr [0x108d7100]'),
        (0x10748cb1, 'fcomp', 'dword ptr [0x108d7100]'),
        # Both loop counters are source order; prior clip rejection can abort.
        (0x10748815, 'xor', 'ecx, ecx'),
        (0x10748838, 'mov', 'dword ptr [esp + 0x2c], 0'),
        (0x10748ddd, 'add', 'edx, 1'), (0x10748de6, 'cmp', 'edx, ecx'),
        (0x10748dfb, 'add', 'ecx, 1'), (0x10748e01, 'cmp', 'ecx, dword ptr [edi + 0x5c]'),
    ]
    for anchor in anchors: engine.instruction(*anchor)
    threshold = struct.unpack_from('<f', engine.data, engine.offset(0x108d7100))[0]
    assert threshold == f32(.001)
    # Exhaust every finite sign/zero combination, plus source-threshold ties,
    # oblique magnitudes and permutations. These are synthetic source inputs.
    normals = [[float(x), float(y), float(z)] for x in (-1, 0, 1)
               for y in (-1, 0, 1) for z in (-1, 0, 1) if (x, y, z) != (0, 0, 0)]
    cases = [{'planeA': a + [0.], 'planeB': b + [17.]} for a in normals for b in normals]
    bits = struct.unpack('<I', struct.pack('<f', threshold))[0]
    adjacent = [struct.unpack('<f', struct.pack('<I', bits + step))[0] for step in (-1, 0, 1)]
    for axis in range(3):
        for value in [0., *adjacent, -threshold]:
            a, b = [0.] * 4, [0.] * 4
            a[axis], b[axis] = 1., -1.
            a[(axis + 1) % 3], b[(axis + 1) % 3] = 1., value
            cases.append({'planeA': a, 'planeB': b})
    rng = random.Random(0x748856)
    for _ in range(96):
        cases.append({key: [f32(rng.uniform(-1, 1)) for _ in range(3)] + [f32(rng.uniform(-1e5, 1e5))]
                      for key in ('planeA', 'planeB')})
    native = [native_bevel_axis_selection(engine, case) for case in cases]
    code = """
import fs from 'node:fs';
import {selectBspSweepBevelAxes} from './editor/world/js/bsp-collision.js';
console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(selectBspSweepBevelAxes)));
"""
    process = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
        input=json.dumps(cases), text=True, capture_output=True, check=True)
    js = json.loads(process.stdout)
    assert len(js) == len(native)
    for case, expected, actual in zip(cases, native, js):
        assert actual['status'] == 'ready', (case, actual)
        for key in ('maskA', 'maskB', 'axes', 'projectedDots'):
            assert actual[key] == expected[key], (case, key, expected, actual)
    visited = {pc for x in native for pc in x['visited']}
    retained = {i.address for a, b, _ in ranges for i in engine.dis.disasm(
        engine.data[engine.offset(a):engine.offset(b)], a)}
    assert visited == retained, 'every instruction in the four bounded blocks must be exercised'
    return {'anchors': len(anchors), 'ranges': [{'start': hex(a), 'end': hex(b), 'sha256': c} for a, b, c in ranges],
            'cases': len(cases), 'retainedInstructionsExercised': len(visited),
            'limits': ['inputs are already oriented planes; raw flagged hull references are not admitted',
                       'axis admission only: no bevel plane, intersection helper, normalized vector or collision result',
                       'Float64 approximation of x87 intermediates with original Float32 stores']}


def native_bounds_planes(image, case):
    from check_cast_scheduler_native import Arithmetic, f32
    state, sp = 0x100000, 0x200000
    memory = {state + 8: 0}
    memory.update({state + 0x6c + i * 4: f32(x) for i, x in enumerate(case['min'] + case['max'])})
    machine = Arithmetic(image, memory, [0.], {'edi': state, 'esp': sp})
    planes = []
    def capture(machine, target):
        assert target == 0x1030a182
        stack = machine.registers['esp']
        ptr = machine.memory[stack]
        assert machine.memory[stack + 4] == -1
        planes.append([machine.memory[ptr + i * 4] for i in range(4)])
        machine.registers['eax'] = 1  # Continue only to capture all six arguments.
        machine.registers['esp'] += 8  # Verified callee RET8; no native call executed.
        machine.flags = {}
    run_sweep_slice(image, machine, 0x107484ad, 0x107485fb, stop=0x10748815, on_call=capture)
    assert len(planes) == 6 and not machine.stack
    return {'planes': planes, 'visited': machine.trace}


def native_hull_candidates(image, case):
    """Execute retained world tree traversal, stopping before each hull test.

    Only the verified self-recursion call is modeled. Hull math cannot affect
    subsequent tree admission: the retained traversal never reads result time.
    No skipped hull is classified as a native hit or miss.
    """
    from check_cast_scheduler_native import Arithmetic, f32
    state, model, nodes, sp = 0x100000, 0x200000, 0x300000, 0x400000
    memory = {state + 4: model, state + 8: 0, model + 0x64: nodes}
    for offset, values in [(0x4c, case['extent']), (0x5e0, case['start']), (0x5d4, case['end'])]:
        memory.update({state + offset + i * 4: f32(x) for i, x in enumerate(values)})
    for index, node in enumerate(case['source']['nodes']):
        ptr = nodes + index * 120
        memory.update({ptr + i * 4: x for i, x in enumerate(node['plane'])})
        for offset, key in [(0x20, 'back'), (0x24, 'front'), (0x4c, 'collisionBound'), (0x56, 'numVertices'), (0x57, 'flags')]:
            memory[ptr + offset] = node[key]
    trace, candidates = [], []
    calls = 0
    def traverse(previous, index, outside):
        nonlocal calls
        calls += 1
        assert calls < 1000, 'native candidate fixture recursion bound'
        local = {**memory, sp + 0x188: previous, sp + 0x194: outside}
        machine = Arithmetic(image, local, [], {'edi': state, 'ebx': index, 'esp': sp})
        def recurse(current, target):
            assert target == 0x103051cd
            at = current.registers['esp']
            parent, child, side, next_outside = [current.memory[at + i * 4] for i in range(4)]
            assert side in (0, 1)
            traverse(parent, child, next_outside)
            current.registers['esp'] += 16  # Original RET0x10.
            current.flags = {}
        at = run_sweep_slice(image, machine, 0x107483ff if index == -1 else 0x10748191,
                             0x1074842e, stop=(0x1074842e, 0x10748e9b, 0x10748e9d),
                             on_call=recurse, max_steps=20000)
        trace.extend(machine.trace)
        if at == 0x1074842e:
            ptr = machine.registers['eax']
            candidates.append({'nodeIndex': (ptr - nodes) // 120, 'collisionBound': memory[ptr + 0x4c]})
    traverse(0, 0, case['source']['rootOutside'])
    return {'candidates': candidates, 'visited': trace.count(0x10748197), 'instructions': trace}


def verify_sweep_candidates_bounds(engine):
    from check_tutorial_quest_native import Image, ROOT
    from check_skillanim_native import CORE_SHA
    from check_cast_scheduler_native import f32
    ranges = [
        (0x10748191, 0x1074842e, 'd576b36842737e0c77e1cc9c832030209c5f7ca8853603ac574e36eac45373a7'),
        (0x107484ad, 0x107485fb, '7a2cfa31ad33147298f6e51894f3552e22d374d7efc1dfbf0d436802ce1cd18d'),
        (0x10745635, 0x1074566e, 'f17c2cfc8df394f3dc8e04f4c6cdf54cbac1e7afe9ff77e22d23f6b8a3a6520a'),
    ]
    for a, b, digest in ranges:
        assert hashlib.sha256(engine.data[engine.offset(a):engine.offset(b)]).hexdigest() == digest
    assert struct.unpack_from('<d', engine.data, engine.offset(0x108ceb98))[0] == f32(1.1)
    assert struct.unpack_from('<d', engine.data, engine.offset(0x108bcba0))[0] == .1
    anchors = [
        (0x107481a6, 'cmp', 'dword ptr [edi + 8], ebp'),
        (0x107481ac, 'je', '0x107481eb'),
        (0x1074833e, 'cmp', 'byte ptr [esi + 0x56], 0'),
        (0x10748344, 'test', 'byte ptr [esi + 0x57], 0x21'),
        (0x1074836e, 'push', 'eax'), (0x1074836f, 'push', 'ebp'),
        (0x10748370, 'push', 'ecx'), (0x10748371, 'push', 'ebx'),
        (0x10748374, 'call', '0x103051cd'),
        (0x10748eb5, 'ret', '0x10'),
        (0x10748410, 'cmp', 'dword ptr [esp + 0x194], 0'),
        (0x1074841e, 'jne', '0x10748e9d'),
        (0x10748424, 'cmp', 'dword ptr [eax + 0x4c], -1'),
        (0x10748428, 'je', '0x10748e9d'),
        (0x10748575, 'fsub', 'qword ptr [0x108bcba0]'),
        (0x107485df, 'fsub', 'qword ptr [0x108bcba0]'),
        (0x1074850b, 'fadd', 'qword ptr [0x108bcba0]'),
        (0x1074564d, 'push', 'edx'), (0x1074564e, 'mov', 'ecx, edi'),
        (0x10745658, 'mov', 'ecx, dword ptr [eax]'),
        (0x10745668, 'mov', 'edx, dword ptr [eax + 0xc]'),
    ]
    for address, op, args in anchors: engine.instruction(address, op, args)
    # Independently reconstruct the NOP bytes from the encoded original words.
    raw = (ROOT / 'assets/interlude/system/engine.dll').read_bytes()
    first = engine.offset(0x10745650)
    restored = b''.join(struct.pack('<I', (struct.unpack_from('<I', raw, offset)[0] - 0x7965b551) & 0xffffffff)
                        for offset in range(first, first + 8, 4))
    assert restored[:6] == b'\x90' * 6 == engine.data[first:first + 6]
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    assert core.exported('?Flip@FPlane@@QBE?AV1@XZ', True) == 0x1010d780
    core.instruction(0x1010d780, 'mov', 'eax, dword ptr [esp + 4]')
    core.instruction(0x1010d7a2, 'ret', '4')
    for address in (0x1010d786, 0x1010d78d, 0x1010d795, 0x1010d79d): core.instruction(address, 'fchs', '')
    # This is a candidate ABI, deliberately not an asserted binding of the NOP.
    flip_body = core.data[core.offset(0x1010d780):core.offset(0x1010d7a5)]
    assert hashlib.sha256(flip_body).hexdigest() == '96f66fdcc588cbe0005298a7cfe87f66d04e3ab899d7a050906c127d0be7a9f8'
    rng = random.Random(0x748191)
    base = {'plane': [1., 0., 0., 0.], 'start': [10., 0., 0.], 'end': [-10., 0., 0.], 'extent': [f32(.1), f32(.1), 5.]}
    r = f32(f32(.1) * f32(1.1))
    branch_cases = [{**base, 'start': [a, 0., 0.], 'end': [b, 0., 0.]}
                    for a, b in [(10, -10), (-10, 10), (0, 0), (r, r), (-r, -r), (2, 3), (-2, -3)]]
    for _ in range(96):
        branch_cases.append({**base, 'plane': [f32(rng.uniform(-1, 1)) for _ in range(3)] + [f32(rng.uniform(-100, 100))],
                             'start': [f32(rng.uniform(-200, 200)) for _ in range(3)],
                             'end': [f32(rng.uniform(-200, 200)) for _ in range(3)]})
    bounds_cases = [{'min': [-10., -20., -30.], 'max': [10., 20., 30.]}, {'min': [0., 0., 0.], 'max': [0., 0., 0.]},
                    {'min': [-84200., 240300., -3800.], 'max': [-84100., 240400., -3700.]}]
    for _ in range(24):
        low = [f32(rng.uniform(-300000, 300000)) for _ in range(3)]
        bounds_cases.append({'min': low, 'max': [f32(x + rng.uniform(0, 32768)) for x in low]})
    tree_cases = []
    for root_outside in (0, 1):
        for flags, vertices in [(0, 4), (1, 4), (32, 4), (0, 0), (4, 4)]:
            for start, end in [(10., -10.), (-10., 10.), (0., 0.)]:
                nodes = [dict(plane=[1., 0., 0., 0.], front=1, back=2, flags=flags, numVertices=vertices, collisionBound=0),
                         dict(plane=[0., 1., 0., 5.], front=-1, back=-1, flags=0, numVertices=4, collisionBound=1),
                         dict(plane=[0., 0., 1., 0.], front=-1, back=-1, flags=1, numVertices=4, collisionBound=2)]
                tree_cases.append({**base, 'source': {'nodes': nodes, 'rootOutside': root_outside, 'leafHulls': [0] * 3},
                                   'start': [start, start, start], 'end': [end, end, end]})
    for _ in range(64):
        nodes = [dict(plane=[f32(rng.uniform(-1, 1)) for _ in range(3)] + [f32(rng.uniform(-20, 20))],
                      front=i * 2 + 1 if i < 3 else -1, back=i * 2 + 2 if i < 3 else -1,
                      flags=rng.choice([0, 1, 4, 32]), numVertices=rng.choice([0, 4]),
                      collisionBound=rng.choice([-1, i])) for i in range(7)]
        tree_cases.append({**base, 'source': {'nodes': nodes, 'rootOutside': rng.randrange(2), 'leafHulls': [0] * 7},
                           'start': [f32(rng.uniform(-30, 30)) for _ in range(3)],
                           'end': [f32(rng.uniform(-30, 30)) for _ in range(3)]})
    expected = {'branches': [native_sweep_branches(engine, case) for case in branch_cases],
                'bounds': [native_bounds_planes(engine, case) for case in bounds_cases],
                'trees': [native_hull_candidates(engine, case) for case in tree_cases]}
    code = """
import fs from 'node:fs';
import {selectBspSweepBranches,collectBspSweepHulls,bspSweepBoundsPlanes} from './editor/world/js/bsp-collision.js';
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify({branches:cases.branches.map(selectBspSweepBranches),bounds:cases.bounds.map(bspSweepBoundsPlanes),
  trees:cases.trees.map(c=>collectBspSweepHulls(c.source,c.start,c.end,c.extent))}));
"""
    process = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                             input=json.dumps({'branches': branch_cases, 'bounds': bounds_cases, 'trees': tree_cases}),
                             text=True, capture_output=True, check=True)
    results = json.loads(process.stdout)
    for group, values in expected.items():
        assert len(results[group]) == len(values)
        for native, js in zip(values, results[group]):
            assert js['status'] == 'ready', (group, js)
            for key, value in native.items():
                if key != ('instructions' if group == 'trees' else 'visited'):
                    assert js[key] == value, (group, key, native, js)
    return {'anchors': len(anchors), 'ranges': [{'start': hex(a), 'end': hex(b), 'sha256': c} for a, b, c in ranges],
            'branchCases': len(branch_cases), 'boundsCases': len(bounds_cases), 'treeCases': len(tree_cases),
            'retainedTreeInstructionsExercised': len({pc for x in expected['trees'] for pc in x['instructions']}),
            'flaggedPlane': {'status': 'unresolved', 'callSite': '0x10745650', 'rawEncodedNOPsVerified': True,
                             'compatibleCoreExport': '?Flip@FPlane@@QBE?AV1@XZ', 'coreSHA256': CORE_SHA,
                             'candidateBodySHA256': hashlib.sha256(flip_body).hexdigest(),
                             'limit': 'compatible ABI and operation are not evidence of the actual NOP target'},
            'limits': ['candidate selection and emitted bounds only, never a world hit or clear-ray proof',
                       'flagged plane binding, bevel helpers and final wrapper remain unresolved',
                       'no-owner finite Float64 approximation of x87 with original Float32 stores']}


def native_interval_adoption(image, case):
    """Run final retained admission with a supplied already-clipped interval."""
    from check_cast_scheduler_native import Arithmetic
    state, result, sp = 0x100000, 0x200000, 0x300000
    memory = {state: result, state + 4: 1234, state + 8: 0,
              state + 0x88: case['enter'], state + 0x8c: case['exit'], state + 0x5fc: 0,
              result + 0x24: 1.75, result + 4: 5678, result + 0x20: 4321}
    memory.update({state + 0x60 + i * 4: x for i, x in enumerate(case['normal'])})
    memory.update({result + 0x14 + i * 4: x for i, x in enumerate([9., 8., 7.])})
    machine = Arithmetic(image, memory, [], {'edi': state, 'esp': sp})
    run_sweep_slice(image, machine, 0x10748e10, 0x10748e85, stop=0x10748e9d)
    adopted = bool(machine.memory[state + 0x5fc])
    if not adopted:
        assert all(machine.memory[address] == value for address, value in memory.items()
                   if result <= address <= result + 0x24), 'rejected interval mutated result'
        return {'adopted': False}
    assert machine.memory[result + 4] == 0 and machine.memory[result + 0x20] == 1234
    return {'adopted': True, 'time': machine.memory[result + 0x24],
            'normal': [machine.memory[result + 0x14 + i * 4] for i in range(3)]}


def native_time_adjustment(image, case):
    """Run retained wrapper and its actual directly-bound clamp helper.

    The unresolved preceding metric-returning call is NOT emulated: the
    fixture supplies its explicit stored Float32 result at local -0xf4.
    """
    from check_cast_scheduler_native import Arithmetic
    frame, result, sp = 0x100000, 0x200000, 0x300000
    memory = {frame - 0xf4: case['nativeMetric'], result + 0x24: case['time']}
    machine = Arithmetic(image, memory, [], {'ebp': frame, 'esi': result, 'esp': sp})
    arguments, returned = [], []
    def clamp(current, target):
        assert target == 0x10307743  # Retained E9 -> 0x103704b0, pinned below.
        at = current.registers['esp']
        arguments.append([current.memory[at + i * 4] for i in range(3)])
        current.registers['esp'] -= 4  # Model CALL's return address only.
        current.memory[current.registers['esp']] = 0
        run_sweep_slice(image, current, 0x103704b0, 0x103704e6,
                        stop=(0x103704da, 0x103704e5))
        current.registers['esp'] += 4  # Original helper's RET, caller cleans args.
        returned.append(current.stack[0])
        current.flags = {}
    run_sweep_slice(image, machine, 0x1074973c, 0x107497a7, on_call=clamp)
    assert len(arguments) == 2 and len(machine.stack) == 1
    return {'lower': arguments[0][1], 'upper': arguments[0][2], 'backoff': returned[0],
            'time': machine.memory[result + 0x24]}


def verify_sweep_adoption_adjustment(engine):
    from check_tutorial_quest_native import ROOT
    from check_cast_scheduler_native import f32
    ranges = [
        (0x10748e10, 0x10748e85, '980b731cb4bb0f8b1823cbc5b3164985384f24759af28d36dc7bc4dfcae73264'),
        (0x1074973c, 0x107497a7, '9001150b3ec2c9f3e63dd0b416b757c523bf3de0438dc6c30d842557d6496c7d'),
        (0x103704b0, 0x103704e6, 'b70b787f404c9dea5d3a4cec672683404a3d63b72c4a1e4f532abda3e90cba8b'),
    ]
    for start, end, digest in ranges:
        assert hashlib.sha256(engine.data[engine.offset(start):engine.offset(end)]).hexdigest() == digest
    anchors = [
        (0x10748e10, 'fld', 'dword ptr [0x10854358]'),
        (0x10748e21, 'jp', '0x10748e9d'), (0x10748e36, 'jne', '0x10748e9d'),
        (0x10748e45, 'jp', '0x10748e9d'), (0x10748e4f, 'fstp', 'dword ptr [eax + 0x24]'),
        (0x10748e79, 'mov', 'dword ptr [edi + 0x5fc], 1'),
        (0x1074972f, 'cmp', 'dword ptr [ebp - 0xf0], 0'),
        (0x10749736, 'je', '0x10749892'),
        (0x10749751, 'fld', 'dword ptr [ebp - 0xf4]'),
        (0x10749759, 'fdivr', 'qword ptr [0x108a42e0]'),
        (0x10749769, 'fdivr', 'qword ptr [0x108a01b0]'),
        (0x10749782, 'call', '0x10307743'), (0x10749796, 'call', '0x10307743'),
        (0x107497a4, 'fst', 'dword ptr [esi + 0x24]'),
        (0x10307743, 'jmp', '0x103704b0'),
        (0x103704da, 'ret', ''), (0x103704e5, 'ret', ''),
    ]
    for address, op, args in anchors: engine.instruction(address, op, args)
    for address, kind, value in [(0x10854358, 'f', -1.), (0x108a42e0, 'd', 4.),
                                  (0x108a01b0, 'd', f32(.1)), (0x1089df54, 'f', f32(.1))]:
        assert struct.unpack_from('<' + kind, engine.data, engine.offset(address))[0] == value
    rng = random.Random(0x748e10)
    admissions = [{'enter': f32(a), 'exit': f32(b), 'normal': [2., -3., 0.]}
                  for a, b in [(-2, 1), (-1, 1), (-.9999, 1), (-.5, 0), (-.5, .25),
                               (0, 0), (0, .00001), (.5, .5), (.5, .50001), (1.25, 2)]]
    admissions += [{'enter': f32(rng.uniform(-2, 2)), 'exit': f32(rng.uniform(-2, 2)),
                    'normal': [f32(rng.uniform(-4, 4)) for _ in range(3)]} for _ in range(96)]
    adjustments = [{'time': f32(t), 'nativeMetric': f32(m)} for t in [-.5, 0, .05, .5, 1, 2]
                   for m in [.0001, .1, .5, 1, 10, 40, 100, 10000]]
    adjustments += [{'time': f32(rng.uniform(-1, 2)), 'nativeMetric': f32(10 ** rng.uniform(-4, 5))}
                    for _ in range(96)]
    expected = {'adoptions': [native_interval_adoption(engine, c) for c in admissions],
                'adjustments': [native_time_adjustment(engine, c) for c in adjustments]}
    code = """
import fs from 'node:fs';
import {adoptBspSweepInterval,adjustBspSweepTime} from './editor/world/js/bsp-collision.js';
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify({adoptions:cases.adoptions.map(adoptBspSweepInterval),
  adjustments:cases.adjustments.map(adjustBspSweepTime)}));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                            input=json.dumps({'adoptions': admissions, 'adjustments': adjustments}),
                            text=True, capture_output=True, check=True)
    actual = json.loads(result.stdout)
    for group, rows in expected.items():
        assert len(rows) == len(actual[group])
        for native, js in zip(rows, actual[group]):
            assert js['status'] == 'ready', (group, js)
            assert {k: js[k] for k in native} == native, (group, native, js)
    return {'anchors': len(anchors), 'ranges': [{'start': hex(a), 'end': hex(b), 'sha256': c} for a, b, c in ranges],
            'adoptionCases': len(admissions), 'adjustmentCases': len(adjustments),
            'boundHelper': {'stub': '0x10307743', 'body': '0x103704b0', 'operation': 'finite-float-clamp'},
            'limits': ['completed interval is a fixture input; unresolved hull/bevel work is not bypassed',
                       'nativeMetric is an explicit fixture value, not a recovered segment-length binding',
                       'time only; hit position, material and complete world/camera trace remain separate']}


def verify_nonzero_slice(engine):
    from check_legacy_skill_effects_native import f32
    ranges = [
        (0x10745580, 0x10745743, '1190d11ef10b89bffa22dc1a729c72274584e9370b576b83be7701fb09ec570f'),
        (0x10746460, 0x107465f0, '6b39021f650ac61b39b2c3b4ec2c85520af5e1074f66ae1778425fd539714420'),
        (0x107496b0, 0x1074972f, '6a49f898219839f69abd64cacadfa2c14f12d777d5823eeebdd6718c8d5c83c9'),
        (0x10746369, 0x107463ef, '1261c56b456e3504451ad099c14087e7cc81b9ad8aa4e0e6bd5bb243de9ce8e0'),
        (0x10748424, 0x107484ad, 'd0b87dca5b86b15085e985c86542e9e5538f744c1980c810c66a89de537b2a36'),
        (0x107498c0, 0x107498df, '5ad056b6b8bbf84bf74162061c467ccec9c5d2f5014eaca9698f709b2ffc6105'),
        (0x10745494, 0x107454b8, 'cd44f6df9347a01b8708d209e2e2219938b08ad98615f6be8cc226b73670a35d'),
    ]
    for a, b, digest in ranges:
        assert hashlib.sha256(engine.data[engine.offset(a):engine.offset(b)]).hexdigest() == digest
    anchors = [
        (0x103121d9, 'jmp', '0x10746310'), (0x103051cd, 'jmp', '0x10748160'),
        (0x1030d904, 'jmp', '0x10745580'), (0x1030a182, 'jmp', '0x10746460'),
        (0x10313a9d, 'jmp', '0x10745400'),
        (0x107454a0, 'mov', 'dword ptr [ebp + 0x4c], eax'),
        (0x107454aa, 'mov', 'dword ptr [ebp + 0x50], ecx'),
        (0x107454b2, 'mov', 'dword ptr [ebp + 0x54], edx'),
        (0x107496b9, 'fstp', 'dword ptr [esi + 0x24]'),
        (0x1074970e, 'call', '0x103121d9'), (0x1074972a, 'call', '0x103051cd'),
        (0x10746381, 'mov', 'dword ptr [esi + 0x5d4], edx'),
        (0x107463af, 'mov', 'dword ptr [esi + 0x5e0], edx'),
        (0x1074558e, 'mov', 'ecx, dword ptr [ebp + 0x4c]'),
        (0x10745591, 'mov', 'edx, dword ptr [eax + 0xc0]'),
        (0x10745597, 'lea', 'eax, [edx + ecx*4]'),
        (0x107455a9, 'cmp', 'dword ptr [ecx], -1'),
        (0x107455b8, 'cmp', 'eax, 0x40'), (0x107455bb, 'jae', '0x107456fd'),
        (0x107455d0, 'and', 'eax, 0xbfffffff'),
        (0x1074563e, 'test', 'dword ptr [ecx + eax*4], 0x40000000'),
        (0x1074570f, 'fld', 'dword ptr [eax + ecx*4 + 4]'),
        (0x10745717, 'fstp', 'dword ptr [esi + 0x6c]'),
        (0x10745735, 'fstp', 'dword ptr [esi + 0x80]'),
        (0x10748424, 'cmp', 'dword ptr [eax + 0x4c], -1'),
        (0x10748431, 'call', '0x1030d904'),
        (0x1074843e, 'fstp', 'dword ptr [edi + 0x88]'),
        (0x1074844c, 'fstp', 'dword ptr [edi + 0x8c]'),
        (0x10748493, 'call', '0x1030a182'),
        (0x10746539, 'fdiv', 'st(1)'),
        (0x1074653f, 'fld', 'qword ptr [0x108e91a8]'),
        (0x10746571, 'fcomp', 'qword ptr [0x108e91b8]'),
        (0x10746529, 'fstp', 'dword ptr [esp + 0xc]'),
        (0x10746569, 'fstp', 'dword ptr [ecx + 0x8c]'),
        (0x10746597, 'fstp', 'dword ptr [ecx + 0x88]'),
        (0x107465e3, 'jne', '0x107465c4'),
        (0x107498d4, 'mov', 'eax, dword ptr [ebx + 0x124]'),
    ]
    for address, op, args in anchors: engine.instruction(address, op, args)
    for address, value in [(0x108e91a8, -f32(.00001)), (0x108e91b8, f32(.00001))]:
        assert struct.unpack_from('<d', engine.data, engine.offset(address))[0] == value
    for address, value in [(0x10884cf0, 2.), (0x10854358, -1.)]:
        assert struct.unpack_from('<f', engine.data, engine.offset(address))[0] == value
    for address in (0x10745650, 0x107463e3):
        assert engine.data[engine.offset(address):engine.offset(address) + 6] == b'\x90' * 6
    base = dict(plane=[0., 0., 1., 0.], start=[0., 0., 10.], end=[0., 0., -10.],
                extent=[f32(.1), f32(.1), 5.], enter=-1., exit=2., normal=[0., 0., 0.])
    changes = [{}, {'start': [0., 0., -10.], 'end': [0., 0., 10.]},
        {'start': [0., 0., 2.]}, {'start': [0., 0., -2.]},
        {'start': [0., 0., 2.], 'end': [0., 0., 10.]},
        {'start': [0., 0., 6.], 'end': [1., 0., 6.]},
        {'start': [0., 0., 5.], 'end': [1., 0., 5.]},
        {'exit': .25}, {'enter': .25, 'normal': [1., 0., 0.]},
        {'start': [0., 0., f32(.00001)], 'end': [0., 0., 0.], 'extent': [0., 0., 0.]},
        {'start': [0., 0., -f32(.00001)], 'end': [0., 0., 0.], 'extent': [0., 0., 0.]},
        {'plane': [f32(.6), f32(.8), 0., -3300.],
         'start': [-84200., 240400., -3700.], 'end': [-84300., 240600., -3800.]},
    ]
    cases = [{**base, **change} for change in changes]
    rng = random.Random(0x7456460)
    for _ in range(96):
        cases.append({**base, 'plane': [f32(rng.uniform(-1, 1)) for _ in range(3)] + [f32(rng.uniform(-100, 100))],
                      'start': [f32(rng.uniform(-100, 100)) for _ in range(3)],
                      'end': [f32(rng.uniform(-100, 100)) for _ in range(3)]})
    expected = [native_plane_interval(engine, case) for case in cases]
    visited = {pc for result in expected for pc in result['visited']}
    entire_helper = {i.address for i in engine.dis.disasm(
        engine.data[engine.offset(0x10746460):engine.offset(0x107465f0)], 0x10746460)}
    assert visited == entire_helper, 'fixtures must exercise every retained helper instruction'
    code = """
import fs from 'node:fs';
import {clipBspSweepPlane} from './editor/world/js/bsp-collision.js';
console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(clipBspSweepPlane)));
"""
    from check_tutorial_quest_native import ROOT
    process = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                             input=json.dumps(cases), text=True, capture_output=True, check=True)
    results = json.loads(process.stdout)
    assert len(results) == len(expected)
    for case, native, js in zip(cases, expected, results):
        assert js['status'] == 'ready' and js['scope'] == 'bsp-sweep-plane-interval'
        for key in ('continues', 'enter', 'exit', 'normal'):
            assert js[key] == native[key], (case, key, native, js)
    return {'scope': 'complete retained one-plane interval helper, not full world sweep',
            'anchors': len(anchors), 'arithmeticCases': len(cases),
            'visitedInstructions': len(visited), 'totalHelperInstructions': len(entire_helper),
            'ranges': [{'start': hex(a), 'end': hex(b), 'sha256': c} for a, b, c in ranges],
            'limits': ['flagged hull-plane operation and owner transforms unverified',
                       'tree admission and bounds are separate slices; bevel planes, final adoption and wrapper bias unported',
                       'finite Float64 approximation of x87, not universal native precision parity']}


def verify():
    from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
    from check_legacy_skill_effects_native import LinearX87, f32
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    stub = 0x10302c5c
    assert engine.data[engine.offset(stub)] == 0xe9
    assert stub + 5 + struct.unpack_from('<i', engine.data, engine.offset(stub) + 1)[0] == 0x10745bd0
    ranges = [
        (0x10745bd0, 0x10746193, 'cbfb2587f1824da65546a9ba8b3383817c00a3d3654277e301c879797d5e7397'),
        (0x10749307, 0x10749498, 'ef8af4a0e27ee6fd35c455661bf1e8dd64ed989ab9b8af1f7f804bfdde81e935'),
        (0x10745dbc, 0x10745df3, '9c4073fe3cf1d197b6c9a470d3f0a29f633a6f3e85ca6cb0ec7e10f8f3e83efa'),
        (0x10745e7a, 0x10745f09, '8061e9712637ee8411265b97126ead860b57f7e712510b31f7c12ffa6ffdc669'),
    ]
    for a, b, digest in ranges:
        assert hashlib.sha256(engine.data[engine.offset(a):engine.offset(b)]).hexdigest() == digest
    anchors = [
        (0x1074930b, 'mov', 'ecx, dword ptr [ebx + 0x124]'),
        (0x1074933e, 'push', 'esi'), (0x1074933f, 'push', 'esi'),
        (0x10749340, 'push', 'esi'), (0x10749346, 'call', '0x10302c5c'),
        # Runtime FBspNode stride120; raw branch children +20/+24.
        (0x10745caf, 'shl', 'ecx, 4'), (0x10745cb2, 'sub', 'ecx, eax'),
        (0x10745cb6, 'mov', 'eax, dword ptr [edx + 0x64]'),
        (0x10745cb9, 'lea', 'esi, [eax + ecx*8]'),
        (0x10745d66, 'fld', 'dword ptr [0x108a4e3c]'),
        (0x10745d78, 'test', 'ah, 0x41'), (0x10745d7b, 'jne', '0x10745e09'),
        (0x10745d8c, 'cmp', 'byte ptr [esi + 0x56], 0'),
        (0x10745d9d, 'and', 'dl, 0xef'), (0x10745da0, 'or', 'dl, 0x21'),
        (0x10745da3, 'test', 'byte ptr [esi + 0x57], dl'),
        (0x10745dad, 'or', 'dword ptr [esp + 0x10c], eax'),
        (0x10745db4, 'mov', 'eax, dword ptr [esi + 0x24]'),
        (0x10745e0b, 'fld', 'dword ptr [0x108d7100]'),
        (0x10745e4e, 'mov', 'eax, dword ptr [esi + 0x20]'),
        (0x10745e54, 'and', 'dword ptr [esp + 0x10c], edx'),
        (0x10745fa9, 'mov', 'ecx, dword ptr [esi + eax*4 + 0x20]'),
        (0x10745fc7, 'call', '0x10302c5c'),
        (0x10745fd1, 'je', '0x107460f0'),
        (0x1074604e, 'mov', 'eax, dword ptr [esi + eax*4 + 0x24]'),
        (0x10746087, 'mov', 'dword ptr [esp + 0xec], edx'),
        (0x107460c2, 'cmp', 'dword ptr [esp + 0x10c], 0'),
        (0x1074611e, 'mov', 'dword ptr [ecx + 8], edx'),
        (0x10746128, 'mov', 'dword ptr [ecx + 0xc], edi'),
        (0x1074612b, 'mov', 'dword ptr [ecx + 0x10], ebp'),
        (0x1074614f, 'mov', 'dword ptr [ecx + 0x28], edx'),
        # UModel wrapper has an additional 0.5 / erased-call-result backoff.
        (0x10749412, 'fdivr', 'qword ptr [0x10859038]'),
        (0x10749418, 'fsubr', 'qword ptr [ebp + 0x50]'),
        (0x10749425, 'call', '0x10307743'),
        (0x10749433, 'fst', 'dword ptr [esi + 0x24]'),
    ]
    for address, op, args in anchors: engine.instruction(address, op, args)
    assert struct.unpack_from('<f', engine.data, engine.offset(0x108a4e3c))[0] == f32(-0.001)
    assert struct.unpack_from('<f', engine.data, engine.offset(0x108d7100))[0] == f32(0.001)
    assert struct.unpack_from('<d', engine.data, engine.offset(0x10859038))[0] == 0.5
    assert engine.data[engine.offset(0x1074940c):engine.offset(0x10749412)] == b'\x90' * 6

    class SplitArithmetic(LinearX87):
        def run(self, instructions):
            for instruction in instructions:
                if instruction.mnemonic == 'fdivp':
                    target = instruction.op_str
                    self.write(target, self.read(target) / self.stack[0])
                    self.stack.pop(0)
                else:
                    super().run([instruction])

    def instructions(a, b):
        return list(engine.dis.disasm(engine.data[engine.offset(a):engine.offset(b)], a))
    planes = instructions(0x10745dbc, 0x10745df3)
    split = instructions(0x10745e7a, 0x10745f09)
    fixtures = [
        ([1, 0, 0, 1], [11, 3, 7], [-9, -1, 9]),
        ([-1, 0, 0, 3], [-13, 9, 2], [7, -5, 8]),
        ([0, 0, 1, -3728], [-84200, 240400, -3700], [-84000, 240200, -3800]),
        ([f32(.6), f32(.8), 0, 10], [50, 40, 7], [-20, -30, 3]),
    ]
    cases = []
    for plane, start, end in fixtures:
        p, sp = 0x1000, 0x2000
        memory = {p + i * 4: float(value) for i, value in enumerate(plane)}
        memory[sp + 0xf4] = float(end[0])
        evaluator = SplitArithmetic(memory, {'esi': p, 'esp': sp},
                                    [*map(float, start), float(end[1]), float(end[2])])
        evaluator.run(planes)
        da, db = evaluator.memory[sp + 0x14], evaluator.memory[sp + 0x10]
        assert da > 0 and db < 0
        # This is the actual x87 stack retained at entry to the split branch.
        evaluator.stack.insert(0, da)
        evaluator.run(split)
        point = [evaluator.memory[sp + offset] for offset in (0x24, 0x28, 0x2c)]
        cases.append({'plane': plane, 'start': start, 'end': end,
                      'nativePlaneDistances': [da, db], 'nativeSplitPoint': point})
    code = """
import fs from 'node:fs';
import {traceBspPrimary} from './editor/world/js/bsp-collision.js';
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(cases.map(c=>traceBspPrimary({rootOutside:1,nodes:[
  {plane:c.plane,front:-1,back:-1,numVertices:4,flags:0}]},c.start,c.end))));
"""
    process = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                             input=json.dumps(cases), text=True, capture_output=True, check=True)
    results = json.loads(process.stdout)
    assert len(results) == len(cases)
    for case, result in zip(cases, results):
        assert result['status'] == 'ready' and result['scope'] == 'bsp-primary-zero-extent'
        assert result['hit']['point'] == case['nativeSplitPoint'], (case, result)
        assert result['hit']['normal'] == case['plane'][:3]
    nonzero = verify_nonzero_slice(engine)
    candidates = verify_sweep_candidates_bounds(engine)
    adoption = verify_sweep_adoption_adjustment(engine)
    bevel_axes = verify_bevel_axis_selection(engine)
    return {'tool': 'Elbera Tools', 'engineSHA256': ENGINE_SHA,
            'primaryBody': '0x10745bd0', 'nativeAnchors': len(anchors),
            'ranges': [{'start': hex(a), 'end': hex(b), 'sha256': c} for a, b, c in ranges],
            'runtimeDifferentialCases': cases,
            'nonzeroPlaneSlice': nonzero,
            'nonzeroCandidatesAndBounds': candidates,
            'nonzeroAdoptionAndAdjustment': adoption,
            'nonzeroBevelAxisSelection': bevel_axes,
            'limits': ['four finite no-owner arithmetic cases, not full native emulation',
                       'Float64 intermediates approximate native x87 extended precision',
                       'wrapper hit backoff, material resolution and overall trace aggregation unported']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = verify()
    if args.check:
        print(f"Elbera Tools BSP primary PASS: {result['nativeAnchors']} native anchors, "
              f"{len(result['ranges'])} code ranges, {len(result['runtimeDifferentialCases'])} "
              'primary arithmetic/runtime comparisons; nonzero plane slice '
              f"{result['nonzeroPlaneSlice']['anchors']} anchors, "
              f"{len(result['nonzeroPlaneSlice']['ranges'])} ranges, "
              f"{result['nonzeroPlaneSlice']['arithmeticCases']} full-helper/runtime comparisons; "
              f"candidate/bounds {result['nonzeroCandidatesAndBounds']['anchors']} anchors, "
              f"{result['nonzeroCandidatesAndBounds']['branchCases']} branches, "
              f"{result['nonzeroCandidatesAndBounds']['treeCases']} native tree traversals, "
              f"{result['nonzeroCandidatesAndBounds']['boundsCases']} bounds/runtime comparisons; "
              f"adoption/adjustment {result['nonzeroAdoptionAndAdjustment']['anchors']} anchors, "
              f"{result['nonzeroAdoptionAndAdjustment']['adoptionCases']} admissions, "
              f"{result['nonzeroAdoptionAndAdjustment']['adjustmentCases']} time adjustments; "
              f"bevel admission {result['nonzeroBevelAxisSelection']['anchors']} anchors, "
              f"{result['nonzeroBevelAxisSelection']['cases']} pair/axis comparisons over "
              f"{result['nonzeroBevelAxisSelection']['retainedInstructionsExercised']} instructions; "
              'flagged plane operation remains unresolved')
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
