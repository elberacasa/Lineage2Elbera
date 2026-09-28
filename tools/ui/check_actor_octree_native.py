#!/usr/bin/env python3
"""Elbera Tools: original octree geometry against the actual browser helpers.

Pinned Engine images stay in memory; no native code executes. These authored
volume/box cases do not establish actor membership or a complete spatial query.
Finite PC53/RNE is explicit; live FPU state and other profiles remain unknown.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct
from types import SimpleNamespace

from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CANDIDATE_ENGINE_SHA, CORE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage
from check_hair_attachment_native import compare_call_block
from check_static_sweep_native import PreparationProgram, PreparationMachine
from check_actor_transforms_native import signed
from check_static_triangle_native import f32, hexes
from check_static_mesh_native import browser_outputs
from actor_octree_membership_source import qualify_bounds

ROOT = Path(__file__).resolve().parents[2]
REGIONS = [
    ("child volume", 0x105FE810, 0x105FE86D),
    ("box contains node volume", 0x105FE890, 0x105FE902),
    ("ordered intersected children", 0x105FE920, 0x105FEA4D),
    ("single child selection", 0x105FEAA0, 0x105FEB14),
    ("segment and expanded box", 0x105FEED0, 0x105FF114),
    ("candidate cached bounds dispatch", 0x105FFE77, 0x105FFED0),
    ("multi-node filter normal dispatch", 0x105FEB6D, 0x105FEBDF),
    ("single-node filter normal dispatch", 0x1060298D, 0x106029D8),
]


def source_program(engine, comparison):
    program = SimpleNamespace(engine=engine, rows=[], import_targets={})
    evidence = []
    for name, start, end in REGIONS:
        raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        rows = list(engine.dis.disasm(raw, start))
        other = bytearray(comparison.read(start - 0x40, end - start))
        normalized = []
        for instruction in rows:
            if (
                instruction.mnemonic != "call"
                or bytes(instruction.bytes)[:1] != b"\xe8"
            ):
                continue
            target = int(instruction.op_str, 16)
            if target not in {a for _, a, _ in REGIONS[:5]}:
                continue
            offset = instruction.address - start
            candidate_at = instruction.address - 0x40
            assert other[offset] == 0xE8
            candidate_target = (
                candidate_at + 5 + struct.unpack_from("<i", other, offset + 1)[0]
            )
            assert candidate_target == target - 0x40
            struct.pack_into("<i", other, offset + 1, target - (candidate_at + 5))
            normalized.append(
                dict(
                    address=hex(instruction.address),
                    ownedTarget=hex(target),
                    comparisonTarget=hex(candidate_target),
                    basis="complete separately matched helper body",
                )
            )
        proof = compare_call_block(
            raw,
            bytes(other),
            owned_va=start,
            candidate_va=start - 0x40,
            sites=[],
            direct_calls=[
                i.address - start
                for i in rows
                if i.mnemonic == "call" and bytes(i.bytes)[:1] == b"\xe8"
            ],
            imports=comparison.imports,
        )
        evidence.append(
            dict(
                name=name,
                **PreparationProgram.add(program, engine, start, end, raw),
                comparison=proof,
                normalizedHelperCalls=normalized,
            )
        )
    names = {
        "?MultiNodeFilter@FOctreeNode@@QAEXPAVAActor@@PAVFCollisionOctree@@PBVFPlane@@@Z": 0x105FEB40,
        "?SingleNodeFilter@FOctreeNode@@QAEXPAVAActor@@PAVFCollisionOctree@@PBVFPlane@@@Z": 0x10602960,
        "?ActorNonZeroExtentLineCheck@FOctreeNode@@QAEXPAVFCollisionOctree@@PBVFPlane@@@Z": 0x105FFDE0,
    }
    for name, at in names.items():
        assert engine.exported(name, True) == at
        assert comparison.body(name) == at - 0x40
    joins = [
        (0x105FEB81, "call", "0x105fe890"),
        (0x105FEB8F, "call", "0x105fe920"),
        (0x105FEBAC, "call", "0x105fe810"),
        (0x10602999, "call", "0x105feaa0"),
        (0x106029B1, "call", "0x105fe810"),
        (0x105FFEC0, "call", "0x105feed0"),
    ]
    for row in joins:
        engine.instruction(*row)
    at = 0x10859038
    raw = bytes(engine.data[engine.offset(at) : engine.offset(at) + 8])
    assert raw == comparison.read(at, 8)
    program.half = struct.unpack("<d", raw)[0]
    assert program.half == 0.5
    program.receipt = dict(
        engineSHA256=engine.sha,
        comparisonEngineSHA256=comparison.sha,
        blocks=evidence,
        namedBodies={name: hex(at) for name, at in names.items()},
        joins=[[hex(at), op, arg] for at, op, arg in joins],
        halfConstant=dict(
            address=hex(at), value=program.half, SHA256=hashlib.sha256(raw).hexdigest()
        ),
        limits=[
            "Named filter slices bind helper roles; membership and dispatch are not dynamically interpreted here.",
            "Supplemental correspondence neither authenticates the archive nor repairs the owned image.",
        ],
    )
    return program


class OctreeGeometryMachine(PreparationMachine):
    def step(self, instruction):
        op, args = instruction.mnemonic, instruction.op_str.split(", ")
        if op in ("fild", "fimul"):
            value = float(signed(self.read(args[0])))
            if op == "fild":
                self.stack.insert(0, value)
            else:
                self.stack[0] *= value
        elif op == "fabs":
            self.stack[0] = abs(self.stack[0])
        elif op == "or":
            value = (self.read(args[0]) | self.read(args[1])) & 0xFFFFFFFF
            self.write(args[0], value)
            self.zero, self.sign, self.carry = (
                value == 0,
                bool(value & 0x80000000),
                False,
            )
            self.parity = bin(value & 255).count("1") % 2 == 0
        else:
            return super().step(instruction)
        self.visited.append(instruction.address)
        return instruction.address + instruction.size


class OctreeBoundsMachine(OctreeGeometryMachine):
    def step(self, instruction):
        if instruction.address in self.source.import_targets:
            self.visited.append(instruction.address)
            self.push(instruction.address + 6)
            return self.source.import_targets[instruction.address]
        return super().step(instruction)


def native_bounds(program, bounds):
    frame, sp, actor = 0x800000, 0x7FFE00, 0x100000
    response = frame - 0x38
    memory = dict(program.bounds_constants)
    # The original primitive method's output is explicit authored input. Its
    # padding is neither inferred nor included in the numerical cache result.
    memory.update(
        {response + i * 4: v for i, v in enumerate([*bounds["min"], *bounds["max"], 1])}
    )
    m = OctreeBoundsMachine(
        program, memory, dict(eax=response, ebx=actor, ebp=frame, esp=sp)
    )
    pc = 0x10602BFE
    for _ in range(8192):
        if pc in (0x10602CC4, 0x10602D76):
            break
        pc = m.step(m.program[pc])
    else:
        raise AssertionError("original actor bounds did not finish")
    assert not m.stack and m.registers["esp"] == sp
    vector = lambda offset: [m.memory[actor + offset + i * 4] for i in range(3)]
    return (
        dict(
            bounds=dict(min=vector(0x174), max=vector(0x180)),
            center=vector(0x190),
            extent=vector(0x19C),
            rootOverlap=pc == 0x10602CC4,
        ),
        m,
    )


def native(program, kind, volume, box=None, child=None):
    sp, node, bounds, output = 0x900000, 0x100000, 0x200000, 0x300000
    memory = {sp: 0, 0x10859038: program.half}
    memory.update(
        {
            node + i * 4: v
            for i, v in enumerate([*volume["center"], volume["halfExtent"]])
        }
    )
    if box:
        memory.update(
            {bounds + i * 4: v for i, v in enumerate([*box["min"], *box["max"]])}
        )
    registers = dict(esp=sp)
    if kind == "child":
        registers.update(eax=output, ecx=child, edx=node)
        start = 0x105FE810
    elif kind == "contains":
        registers.update(ecx=node, edx=bounds)
        start = 0x105FE890
    elif kind == "intersects":
        registers.update(esi=node, edx=bounds, edi=output)
        start = 0x105FE920
    else:
        assert kind == "single"
        registers.update(ecx=bounds, edx=node)
        start = 0x105FEAA0
    m = OctreeGeometryMachine(program, memory, registers)
    m.run(start)
    assert not m.stack and m.registers["esp"] == sp + 4
    if kind == "child":
        result = dict(
            volume=dict(
                center=[m.memory[output + i * 4] for i in range(3)],
                halfExtent=m.memory[output + 12],
            )
        )
    elif kind == "contains":
        result = dict(contains=bool(m.registers["eax"]))
    elif kind == "intersects":
        result = dict(
            children=[m.memory[output + i * 4] for i in range(m.registers["eax"])]
        )
    else:
        result = dict(child=signed(m.registers["eax"]))
    return result, m


def native_broad(program, inputs):
    sp = 0x900000
    pointers = dict(
        start=0x100000,
        center=0x200000,
        extent=0x300000,
        direction=0x400000,
        reciprocal=0x500000,
    )
    memory = {sp: 0, sp + 4: pointers["center"]}
    for name, ptr in pointers.items():
        memory.update(
            {ptr + i * 4: v for i, v in enumerate(inputs[name]) if v is not None}
        )
    m = OctreeGeometryMachine(
        program,
        memory,
        dict(
            esp=sp,
            eax=pointers["start"],
            ecx=pointers["reciprocal"],
            esi=pointers["extent"],
            edi=pointers["direction"],
        ),
    )
    m.run(0x105FEED0)
    assert not m.stack and m.registers["esp"] == sp + 4
    return dict(intersects=bool(m.registers["eax"])), m


SCRIPT = r"""
import fs from 'node:fs';
const api=await import(process.argv[1]);
const names={child:'octreeChildVolume',contains:'octreeBoxContainsVolume',intersects:'octreeIntersectedChildren',single:'octreeSingleChild',broad:'octreeSegmentIntersectsBox',bounds:'prepareOctreeActorBounds'};
const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?Buffer.from(v,'hex').readFloatLE():v;
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const out=JSON.parse(fs.readFileSync(0,'utf8')).map(decode).map(({kind,...input})=>{
 const r=api[names[kind]]({...input,arithmeticProfile:'pc53-rne'});
 if(r.status!=='ready')throw Error(JSON.stringify(r));
 if(kind==='child')return {volume:{center:r.volume.center.map(bits),halfExtent:bits(r.volume.halfExtent)}};
 if(kind==='contains')return {contains:r.contains};
 if(kind==='intersects')return {children:r.children};
 if(kind==='broad')return {intersects:r.intersects};
 if(kind==='bounds')return {bounds:{min:r.bounds.min.map(bits),max:r.bounds.max.map(bits)},center:r.center.map(bits),extent:r.extent.map(bits),rootOverlap:r.rootOverlap};
 return {child:r.child};
});process.stdout.write(JSON.stringify(out));
"""


def fixtures(program):
    rng = random.Random(0x4F43544E)
    cases, answers, visited, steps = [], [], set(), 0

    def add(kind, volume, box=None, child=None):
        nonlocal steps
        result, m = native(program, kind, volume, box, child)
        cases.append(hexes(dict(kind=kind, volume=volume, box=box, child=child)))
        answers.append(hexes(result))
        visited.update(m.visited)
        steps += len(m.visited)

    volumes = [
        dict(center=[0.0, -0.0, 0.0], halfExtent=f32(2.0**power))
        for power in [-149, -148, -126, -1, 0, 18, 50]
    ]
    volumes.append(
        dict(center=[2.0**-149, -(2.0**-149), 3 * 2.0**-149], halfExtent=2.0**-149)
    )
    volumes += [
        dict(
            center=[f32(rng.uniform(-500000, 500000)) for _ in range(3)],
            halfExtent=f32(rng.uniform(0, 600000)),
        )
        for _ in range(100)
    ]
    for volume in volumes:
        for child in range(8):
            add("child", volume, child=child)
    volume = dict(center=[0.0, 0.0, 0.0], halfExtent=1.0)
    intervals = [
        (-2.0, -1.0),
        (-1.0, 0.0),
        (0.0, 0.0),
        (0.0, 1.0),
        (1.0, 2.0),
        (-1.0, 1.0),
    ]
    for x in intervals:
        for y in intervals:
            for z in intervals:
                box = dict(min=[x[0], y[0], z[0]], max=[x[1], y[1], z[1]])
                for kind in ["contains", "intersects", "single"]:
                    add(kind, volume, box)
    for volume in volumes:
        for _ in range(4):
            values = [
                sorted(
                    [
                        f32(rng.uniform(-600000, 600000)),
                        f32(rng.uniform(-600000, 600000)),
                    ]
                )
                for _ in range(3)
            ]
            box = dict(min=[v[0] for v in values], max=[v[1] for v in values])
            for kind in ["contains", "intersects", "single"]:
                add(kind, volume, box)

    def add_broad(inputs):
        nonlocal steps
        result, m = native_broad(program, inputs)
        cases.append(hexes(dict(kind="broad", **inputs)))
        answers.append(hexes(result))
        visited.update(m.visited)
        steps += len(m.visited)

    from itertools import product

    for start in product([-1.0, 0.0, 1.0], repeat=3):
        for direction in product([-1.0, 0.0, 1.0], repeat=3):
            add_broad(
                dict(
                    start=list(start),
                    center=[0.0] * 3,
                    extent=[1.0] * 3,
                    direction=list(direction),
                    reciprocal=[f32(1 / v) if v else None for v in direction],
                )
            )
    for j in range(1000):
        direction = [
            f32(rng.uniform(-1000, 1000)) if (j + i) % 5 else 0.0 for i in range(3)
        ]
        add_broad(
            dict(
                start=[f32(rng.uniform(-100, 100)) for _ in range(3)],
                center=[f32(rng.uniform(-100, 100)) for _ in range(3)],
                extent=[f32(rng.uniform(0, 50)) for _ in range(3)],
                direction=direction,
                reciprocal=[f32(1 / v) if v else None for v in direction],
            )
        )
    return cases, answers, steps, visited


def bounds_fixtures(program):
    rng = random.Random(0x424F554E)
    cases, answers, steps, visited = [], [], 0, set()
    bounds = []
    for axis in range(3):
        for v in [
            -360454.0,
            -360452.21875,
            -360452.1875,
            -360448.0,
            0.0,
            360448.0,
            360452.1875,
            360452.21875,
            360454.0,
        ]:
            center = [0.0] * 3
            center[axis] = v
            bounds.append(dict(min=center[:], max=center[:]))
    bounds += [dict(min=[-0.0, 0.0, -0.0], max=[0.0, -0.0, 0.0])]
    for _ in range(1000):
        values = [
            sorted(
                [f32(rng.uniform(-500000, 500000)), f32(rng.uniform(-500000, 500000))]
            )
            for _ in range(3)
        ]
        bounds.append(dict(min=[v[0] for v in values], max=[v[1] for v in values]))
    for b in bounds:
        result, m = native_bounds(program, b)
        cases.append(hexes(dict(kind="bounds", primitiveBounds=b)))
        answers.append(hexes(result))
        steps += len(m.visited)
        visited.update(m.visited)
    return cases, answers, steps, visited


def verify(engine, comparison, runtime, core, comparison_core):
    program = source_program(
        Image(engine, ENGINE_SHA, True), PEImage(comparison, CANDIDATE_ENGINE_SHA)
    )
    qualify_bounds(
        program,
        Image(core, CORE_SHA),
        PEImage(comparison, CANDIDATE_ENGINE_SHA),
        PEImage(comparison_core, CANDIDATE_CORE_SHA),
    )
    cases, answers, steps, visited = fixtures(program)
    bounds_cases, bounds_answers, bounds_steps, bounds_visited = bounds_fixtures(
        program
    )
    geometry_cases = len(cases)
    cases += bounds_cases
    answers += bounds_answers
    steps += bounds_steps
    visited.update(bounds_visited)
    actual = browser_outputs(SCRIPT, cases, runtime)
    assert len(actual) == len(answers)
    for i, (a, b) in enumerate(zip(actual, answers)):
        assert a == b, ("original octree mismatch", i, cases[i], a, b)
    return dict(
        tool="Elbera Tools",
        status="pass",
        cases=len(cases),
        geometryCases=geometry_cases,
        boundsCases=len(bounds_cases),
        steps=steps,
        coverage=[hex(v) for v in sorted(visited)],
        source=program.receipt,
        files={
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                runtime,
                Path(__file__),
                Path(__file__).with_name("actor_octree_membership_source.py"),
            ]
        },
        limits=[
            "Authored finite geometry only; explicit PC53/RNE, no live FPU observation.",
            "No actor membership, full traversal, cached bounds lifecycle or gameplay collision claim.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--engine", type=Path, default=ROOT / "assets/interlude/system/engine.dll"
    )
    parser.add_argument("--comparison-engine", type=Path, required=True)
    parser.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument(
        "--runtime-module",
        type=Path,
        default=ROOT / "editor/world/js/actor-octree-geometry.js",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    r = verify(
        args.engine,
        args.comparison_engine,
        args.runtime_module.resolve(),
        args.core,
        args.comparison_core,
    )
    print(
        json.dumps(
            (
                {k: r[k] for k in ("status", "cases", "steps")}
                | {"addresses": len(r["coverage"])}
                if args.check
                else r
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
