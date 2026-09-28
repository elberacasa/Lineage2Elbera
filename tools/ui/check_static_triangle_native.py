#!/usr/bin/env python3
"""Elbera Tools: original static triangle instructions versus browser output.

Reads pinned owned and supplemental images; never executes a DLL or writes
assets. Finite PC53/RNE with an explicit positive mathematical sqrt boundary.
Mesh lookup requires a supplied loaded backing array. Native cache paging,
actor lifecycle, tree admission, material callbacks and final hits are outside
this check. See docs/native-static-triangle-evidence.md.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import subprocess
from types import SimpleNamespace

from check_static_sweep_native import PreparationMachine, f32, word, IDENTITY
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage
from static_triangle_source import (
    TriangleProgram,
    DIRECT,
    SQRT_SITES,
    LOOKUP_START,
    LOOKUP_END,
    TRIANGLE_START,
    TRIANGLE_TAIL,
    SCRATCH_START,
)

ROOT = Path(__file__).resolve().parents[2]


class TriangleMachine(PreparationMachine):
    def __init__(self, *args, triangle_array=None):
        super().__init__(*args)
        self.triangle_array = triangle_array
        self.lookup_calls = self.sqrt_calls = self.plane_calls = 0

    def step(self, i):
        if i.address in self.source.import_targets:
            self.visited.append(i.address)
            self.push(i.address + 6)
            return self.source.import_targets[i.address]
        if i.mnemonic == "and" and i.op_str.startswith("dword ptr ["):
            a, b = i.op_str.split(", ")
            value, mask = self.read(a), self.read(b)
            assert mask == 0x7FFFFFFF and isinstance(value, float)
            bits = struct.unpack("<I", struct.pack("<f", value))[0] & mask
            self.write(a, struct.unpack("<f", struct.pack("<I", bits))[0])
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic == "movzx":
            a, b = i.op_str.split(", ")
            assert b.startswith("word ptr [")
            self.write(a, self.read(b) & 0xFFFF)
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic == "call":
            target = int(i.op_str, 16)
            if target in DIRECT:
                if target == 0x1030AA38:
                    self.plane_calls += 1
                self.visited.append(i.address)
                self.push(i.address + i.size)
                return DIRECT[target]
            if i.address in SQRT_SITES and target == 0x10104840:
                value = self.memory[self.registers["esp"]]
                assert math.isfinite(value) and value > 0
                self.stack.insert(0, math.sqrt(value))
                self.sqrt_calls += 1
                self.visited.append(i.address)
                return i.address + i.size
            if i.address == 0x10701C60 and target == 0x10304F43:
                assert (
                    self.triangle_array is not None
                ), "explicit loaded triangle array required"
                index, frame = self.memory[self.registers["esp"]], 0x990000
                # Interpret the original loaded-array pointer arithmetic only.
                # The native getter owns cache acquisition and argument cleanup.
                helper = TriangleMachine(
                    self.source,
                    {frame + 8: index},
                    {"ebx": self.triangle_array, "ebp": frame, "esp": 0x980000},
                )
                helper.until(LOOKUP_START, LOOKUP_END)
                self.registers["eax"] = helper.registers["eax"]
                self.registers["esp"] += 4
                self.visited.append(i.address)
                self.visited.extend(helper.visited)
                self.lookup_calls += 1
                return i.address + i.size
            raise AssertionError(
                ("unqualified triangle call", hex(i.address), i.op_str)
            )
        if i.mnemonic == "neg":
            self.carry = (self.read(i.op_str) & 0xFFFFFFFF) != 0
        if i.mnemonic == "sbb":
            assert i.op_str == "eax, eax"
            self.registers["eax"] = 0xFFFFFFFF if self.carry else 0
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic in ("fucom", "fucomp", "fucompp"):
            # Equivalent ordered finite comparisons in the admitted domain.
            i = SimpleNamespace(
                address=i.address,
                size=i.size,
                mnemonic=i.mnemonic.replace("fucom", "fcom"),
                op_str=i.op_str,
            )
        return super().step(i)


def query_memory(program, query, ptr):
    memory = dict(program.constants)
    for offset, key in [(0, "start"), (0xC, "end"), (0x18, "extent"), (0x24, "normal")]:
        memory.update({ptr + offset + i * 4: v for i, v in enumerate(query[key])})
    memory.update(
        {
            ptr + 0x30: query["entry"],
            ptr + 0x34: query["exit"],
            ptr + 0x38: query["found"],
        }
    )
    return memory


def clip_state(machine, ptr):
    return dict(
        entry=machine.memory[ptr + 0x30],
        exit=machine.memory[ptr + 0x34],
        normal=[machine.memory[ptr + 0x24 + i * 4] for i in range(3)],
        found=machine.memory[ptr + 0x38],
    )


def native_scratch(program, query, max_time):
    sp, out = 0x800000, 0x100000
    vectors = query["start"] + query["end"] + query["extent"]
    memory = dict(program.constants) | {sp: 0, sp + 0x28: max_time}
    memory.update({sp + 4 + i * 4: v for i, v in enumerate(vectors)})
    m = TriangleMachine(program, memory, {"esp": sp, "ecx": out})
    m.run(SCRATCH_START)
    assert not m.stack and m.registers["esp"] == sp + 0x2C
    assert [word(m.memory[out + i * 4]) for i in range(9)] == list(map(word, vectors))
    return clip_state(m, out), m


def native_clip(program, points, plane, query):
    sp, q = 0x800000, 0x200000
    memory = query_memory(program, query, q) | {
        sp: 0,
        sp + 4: 0,
        sp + 8: 0,
        sp + 12: 0,
        sp + 0xB4: 0,
        sp + 0xC4: q,
    }
    memory.update(
        {
            sp + 0x44 + i * 12 + k * 4: v
            for i, p in enumerate(points)
            for k, v in enumerate(p)
        }
    )
    memory.update({sp + 0x68 + i * 4: v for i, v in enumerate(plane)})
    m = TriangleMachine(program, memory, {"esp": sp})
    m.run(TRIANGLE_TAIL)
    assert not m.stack and m.registers["esp"] == sp + 0xB8
    return dict(keep=m.registers["eax"], **clip_state(m, q)), m


def native_prepare(program, inputs, query=None):
    sp, cache, actor, mesh = 0x800000, 0x100000, 0x200000, 0x300000
    triangles, vertices, plane_cache, vertex_cache, q = (
        0x400000,
        0x500000,
        0x600000,
        0x700000,
        0x900000,
    )
    index = inputs["triangleIndex"]
    tri_ptr = triangles + index * 0x54
    memory = dict(program.constants) | {
        sp: 0,
        sp + 4: cache,
        sp + 8: tri_ptr,
        sp + 12: index,
        sp + 16: q,
        cache: actor,
        cache + 4: mesh,
        cache + 0x88: inputs["determinant"],
        cache + 0x8C: plane_cache,
        cache + 0x90: vertex_cache,
        actor + 0x64: 0x10 if inputs["ownerStatic"] else 0,
        mesh + 0x78: vertices,
        plane_cache + index * 24: inputs["planeCache"]["valid"],
    }
    memory.update({cache + 8 + i * 4: v for i, v in enumerate(inputs["localToWorld"])})
    memory.update({tri_ptr + 0x40 + i * 4: v for i, v in enumerate(inputs["indices"])})
    memory.update(
        {
            vertices + i * 24 + k * 4: v
            for i, p in enumerate(inputs["vertices"])
            for k, v in enumerate(p)
        }
    )
    if "plane" in inputs["planeCache"]:
        memory.update(
            {
                plane_cache + index * 24 + 4 + i * 4: v
                for i, v in enumerate(inputs["planeCache"]["plane"])
            }
        )
    for i, record in enumerate(inputs["vertexCache"]):
        memory[vertex_cache + i * 16] = record["valid"]
        if "point" in record:
            memory.update(
                {
                    vertex_cache + i * 16 + 4 + k * 4: v
                    for k, v in enumerate(record["point"])
                }
            )
    if query is not None:
        memory.update(query_memory(program, query, q))
    m = TriangleMachine(program, memory, {"esp": sp}, triangle_array=triangles)
    m.until(TRIANGLE_START, TRIANGLE_TAIL)
    frame = m.registers["esp"]
    assert frame == sp - 0xB4 and not m.stack
    records = []
    for i in range(len(inputs["vertexCache"])):
        record = dict(valid=m.memory[vertex_cache + i * 16])
        if vertex_cache + i * 16 + 4 in m.memory:
            record["point"] = [
                m.memory[vertex_cache + i * 16 + 4 + k * 4] for k in range(3)
            ]
        records.append(record)
    result = dict(
        worldVertices=[
            [m.memory[frame + 0x44 + i * 12 + k * 4] for k in range(3)]
            for i in range(3)
        ],
        worldPlane=[m.memory[frame + 0x68 + i * 4] for i in range(4)],
        planeCache=dict(
            valid=m.memory[plane_cache + index * 24],
            plane=[m.memory[plane_cache + index * 24 + 4 + i * 4] for i in range(4)],
        ),
        vertexCache=records,
    )
    if query is not None:
        m.run(TRIANGLE_TAIL)
        assert not m.stack and m.registers["esp"] == sp + 4
        result["clip"] = dict(keep=m.registers["eax"], **clip_state(m, q))
    return result, m


def hexes(value):
    if isinstance(value, float):
        return word(value)
    if isinstance(value, list):
        return [hexes(v) for v in value]
    if isinstance(value, dict):
        return {k: hexes(v) for k, v in value.items()}
    return value


SCRIPT = r"""
import fs from 'node:fs';
const {prepareStaticTriangle,clipStaticTriangle,createStaticTriangleClipState}=await import(process.argv[1]);
const decode=a=>Array.isArray(a)?a.map(decode):a&&typeof a==='object'?Object.fromEntries(Object.entries(a).map(([k,v])=>[k,decode(v)])):typeof a==='string'&&/^[0-9a-f]{8}$/.test(a)?Buffer.from(a,'hex').readFloatLE():a;
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const state=a=>({entry:bits(a.entry),exit:bits(a.exit),normal:a.normal.map(bits),found:a.found});
const ready=r=>{if(r.status!=='ready')throw Error(JSON.stringify(r));return r;};
const profile={arithmeticProfile:'pc53-rne-math-sqrt'};
const clip=(vertices,plane,q)=>{
 const r=ready(clipStaticTriangle({...profile,worldVertices:vertices,worldPlane:plane,start:q.start,end:q.end,extent:q.extent,initialClipState:q}));
 return {keep:Number(r.keep),...state(r.clipState)};
};
const outputs=JSON.parse(fs.readFileSync(0,'utf8')).map(decode).map(row=>{
 if(row.kind==='scratch')return state(ready(createStaticTriangleClipState(row.maxTime)).clipState);
 if(row.kind==='clip')return clip(row.points,row.plane,row.query);
 const a=row.input,r=ready(prepareStaticTriangle({...profile,...a}));
 const records=a.vertexCache.map(v=>({...v}));
 for(const {index,record} of r.writes.vertices)records[index]=record;
 const pc=r.writes.plane||a.planeCache;
 const out={worldVertices:r.worldVertices.map(p=>p.map(bits)),worldPlane:r.worldPlane.map(bits),planeCache:{valid:pc.valid,plane:pc.plane.map(bits)},vertexCache:records.map(v=>({valid:v.valid,...(v.point?{point:v.point.map(bits)}:{})}))};
 if(row.query){
  const q={...row.query,...ready(createStaticTriangleClipState(row.maxTime)).clipState};
  out.clip=clip(r.worldVertices,r.worldPlane,q);
 }
 return out;
});
process.stdout.write(JSON.stringify(outputs));
"""


def fixtures(program):
    """Authored arithmetic/state inputs, never recovered client geometry."""
    rng = random.Random(0x54524953)
    cases, expected, visited = [], [], set()
    counts = dict(
        steps=0,
        planeCalls=0,
        sqrtCalls=0,
        loadedLookupCalls=0,
        scratchCases=0,
        preparationCases=0,
        clippingCases=0,
        composedCases=0,
        retained=0,
        rejected=0,
    )

    def record_machine(m):
        counts["steps"] += len(m.visited)
        counts["planeCalls"] += m.plane_calls
        counts["sqrtCalls"] += m.sqrt_calls
        counts["loadedLookupCalls"] += m.lookup_calls
        visited.update(m.visited)

    def add(row, output, machine):
        cases.append(hexes(row))
        expected.append(hexes(output))
        record_machine(machine)
        result = output.get("clip", output)
        if "keep" in result:
            counts["retained" if result["keep"] else "rejected"] += 1

    def vec(bound):
        return [f32(rng.uniform(-bound, bound)) for _ in range(3)]

    def query(bound):
        return dict(
            start=vec(bound),
            end=vec(bound),
            extent=[abs(v) for v in vec(20)],
            normal=vec(3),
            entry=f32(rng.uniform(-1, 0)),
            exit=f32(rng.uniform(0.5, 1)),
            found=rng.randrange(2),
        )

    for j in range(600):
        max_time = (
            [-0.0, 0.0, -1.0, 1.0, 0.5, -0.5][j] if j < 6 else f32(rng.uniform(-2, 2))
        )
        q = query(350000)
        out, m = native_scratch(program, q, max_time)
        add(dict(kind="scratch", maxTime=max_time), out, m)
        counts["scratchCases"] += 1

    for j in range(1600):
        a = dict(
            triangleIndex=j % 4,
            ownerStatic=bool(j % 2),
            localToWorld=vec(3)
            + [0.0]
            + vec(3)
            + [0.0]
            + vec(3)
            + [0.0]
            + vec(350000)
            + [1.0],
            determinant=rng.choice([-1.0, 0.0, 1.0]),
            vertices=[vec(100) for _ in range(6)],
            indices=rng.sample(range(6), 3),
            planeCache=dict(valid=int(j % 5 == 0)),
            vertexCache=[dict(valid=rng.choice([0, 1, 7])) for _ in range(6)],
        )
        if a["planeCache"]["valid"]:
            a["planeCache"]["plane"] = vec(1) + [f32(rng.uniform(-100, 100))]
        for record in a["vertexCache"]:
            if record["valid"]:
                record["point"] = vec(300000)
        if j < 600:
            # Isolate the cold source plane path, including degeneracy and the
            # source SafeNormal threshold. Other cases mix cold/warm records.
            a.update(
                localToWorld=IDENTITY[:],
                determinant=1.0,
                indices=[0, 1, 2],
                planeCache=dict(valid=0),
                vertexCache=[dict(valid=0) for _ in range(6)],
            )
            if j % 11 == 0:
                a["vertices"][2] = a["vertices"][1][:]
            if j % 13 == 0:
                a["vertices"][:3] = [
                    [0.0, 0.0, 0.0],
                    [f32(1e-4), 0.0, 0.0],
                    [0.0, f32(1e-4), 0.0],
                ]
        row = dict(kind="prepare", input=a)
        q = None
        if j >= 1100:
            q, max_time = query(300000), f32(rng.uniform(0.25, 1))
            if j % 11 == 0:
                a.update(
                    localToWorld=IDENTITY[:],
                    determinant=1.0,
                    indices=[0, 1, 2],
                    planeCache=dict(valid=0),
                    vertexCache=[dict(valid=0) for _ in range(6)],
                )
                a["vertices"][:3] = [
                    [0.0, 0.0, 0.0],
                    [10.0, 0.0, 0.0],
                    [0.0, 10.0, 0.0],
                ]
                q.update(
                    start=[2.0, 2.0, 1.0], end=[2.0, 2.0, -1.0], extent=[1.0, 1.0, 1.0]
                )
            scratch, machine = native_scratch(program, q, max_time)
            record_machine(machine)
            q.update(scratch)
            row.update(query=q, maxTime=max_time)
            counts["composedCases"] += 1
        out, m = native_prepare(program, a, q)
        add(row, out, m)
        counts["preparationCases"] += 1

    for j in range(3000):
        points = [vec(50) for _ in range(3)]
        if j % 11 == 0:
            points = [[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.0, 10.0, 0.0]]
        if j % 23 == 0:
            points = [[-0.0, -0.0, 0.0], [10.0, 0.0, 0.0], [0.0, 10.0, 0.0]]
        # This stage deliberately accepts an explicit plane; its source
        # construction is exercised separately by preparation/composition.
        left = [f32(x - y) for x, y in zip(points[2], points[0])]
        right = [f32(x - y) for x, y in zip(points[1], points[0])]
        n = [
            f32(left[1] * right[2] - left[2] * right[1]),
            f32(left[2] * right[0] - left[0] * right[2]),
            f32(left[0] * right[1] - left[1] * right[0]),
        ]
        length = math.sqrt(sum(v * v for v in n))
        assert length > 0
        n = [f32(v / length) for v in n]
        plane = n + [
            f32((points[0][1] * n[1] + points[0][0] * n[0]) + points[0][2] * n[2])
        ]
        q = query(100)
        if j % 11 == 0:
            q.update(
                start=[2.0, 2.0, 30.0],
                end=[2.0, 2.0, -30.0],
                extent=[1.0, 1.0, 1.0],
                entry=0.0,
                exit=1.0,
            )
        if j % 19 == 0:
            q["end"] = q["start"][:]
        if j < 6:
            points = [[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.0, 10.0, 0.0]]
            plane = [0.0, 0.0, -1.0, 0.0]
            q.update(
                start=[2.0, 2.0, 30.0],
                end=[2.0, 2.0, -30.0],
                extent=[1.0, 1.0, 1.0],
                entry=0.0,
                exit=1.0,
                found=0,
            )
            if j == 0:
                q.update(entry=0.5, exit=0.5)
            elif j == 1:
                q.update(start=[2.0, 2.0, 0.0], end=[2.0, 2.0, 0.0], entry=-1.0)
            elif j in (2, 3, 4):
                coordinate = {2: 20.0, 3: 8.0, 4: 6.0}[j]
                q.update(
                    start=[coordinate, coordinate, 30.0],
                    end=[coordinate, coordinate, -30.0],
                )
            else:
                q.update(start=[2.0, 2.0, 1.0], end=[2.0, 2.0, -1.0])
        out, m = native_clip(program, points, plane, q)
        add(dict(kind="clip", points=points, plane=plane, query=q), out, m)
        counts["clippingCases"] += 1
    return cases, expected, counts, visited


def verify(
    engine_path, core_path, comparison_engine_path, comparison_core_path, runtime_module
):
    program = TriangleProgram(
        Image(Path(engine_path), ENGINE_SHA, True),
        Image(Path(core_path), CORE_SHA),
        PEImage(Path(comparison_engine_path), CANDIDATE_ENGINE_SHA),
        PEImage(Path(comparison_core_path), CANDIDATE_CORE_SHA),
    )
    cases, expected, counts, visited = fixtures(program)
    proc = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            SCRIPT,
            Path(runtime_module).resolve().as_uri(),
        ],
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        check=True,
        timeout=60,
    )
    actual = json.loads(proc.stdout)
    assert len(actual) == len(expected)
    for index, (got, wanted) in enumerate(zip(actual, expected)):
        assert got == wanted, (
            "source triangle mismatch",
            index,
            cases[index],
            got,
            wanted,
        )
    return dict(
        tool="Elbera Tools",
        status="pass",
        cases=len(cases),
        **counts,
        arithmeticProfile="pc53-rne-math-sqrt",
        source=program.receipt,
        coverage=[hex(p) for p in sorted(visited)],
        runtimeSHA256=hashlib.sha256(Path(runtime_module).read_bytes()).hexdigest(),
        verifierSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        sourceVerifierSHA256=hashlib.sha256(
            Path(__file__).with_name("static_triangle_source.py").read_bytes()
        ).hexdigest(),
        limits=[
            "Authored finite state and geometry; no map placement or live actor provenance claim.",
            "PC53/RNE finite arithmetic, positive mathematical sqrt; native CRT, FPU startup and other profiles unobserved.",
            "Explicit loaded triangle array and consumed cache records; native paging and cache lifetime not executed.",
            "Preparation admits unsigned-WORD triangle indices only; higher original indices remain unsupported.",
            "Helper interval return and writes are not an adopted collision hit. Tree, materials, spatial admission and walking remain unfinished.",
            "Supplemental correspondence neither authenticates its archive nor repairs the owned binary.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--engine", type=Path, default=ROOT / "assets/interlude/system/engine.dll"
    )
    parser.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    parser.add_argument("--comparison-engine", type=Path, required=True)
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument(
        "--runtime-module",
        type=Path,
        default=ROOT / "editor/world/js/static-triangle.js",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    report = verify(
        args.engine,
        args.core,
        args.comparison_engine,
        args.comparison_core,
        args.runtime_module,
    )
    if args.check:
        print(
            json.dumps(
                {
                    k: report[k]
                    for k in [
                        "status",
                        "cases",
                        "steps",
                        "scratchCases",
                        "preparationCases",
                        "clippingCases",
                        "composedCases",
                        "retained",
                        "rejected",
                    ]
                }
                | {"addresses": len(report["coverage"])}
            )
        )
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
