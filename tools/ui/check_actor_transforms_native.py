#!/usr/bin/env python3
"""Elbera Tools: original actor transforms versus finite retained instructions.

Requires explicitly supplied pinned supplemental images to qualify erased
imports. No native binaries are executed. Default comparisons use synthetic
sine-table inputs; --sine-profile also recovers a fresh original-derived table
in memory under its stated startup conditions. No assets are written.
"""
import argparse
from pathlib import Path
import hashlib
import json
import random
import struct
import subprocess

from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from check_cast_sound_native import RandomMachine
from check_cast_scheduler_native import f32
from supplemental_pe import PEImage
from actor_transform_source import qualify_actor_transforms

ROOT = Path(__file__).resolve().parents[2]


class TransformProgram:
    def __init__(self, engine, core):
        self.engine = engine
        self.rows = []
        for image, a, b in [
            (engine, 0x103277C5, 0x10327AAF),
            (engine, 0x103286A5, 0x103289E7),
            (engine, 0x10326FC5, 0x10327023),
            (engine, 0x103274B5, 0x10327513),
            (engine, 0x10327055, 0x103273B4),
            (core, 0x10111BB0, 0x10111C76),
            (core, 0x10111240, 0x10111488),
            (core, 0x1010C6D0, 0x1010C6FF),
            (core, 0x101111E0, 0x101111E1),
        ]:
            rows = list(
                image.dis.disasm(
                    bytes(image.data[image.offset(a) : image.offset(b)]), a
                )
            )
            assert rows[0].address == a and rows[-1].address + rows[-1].size == b
            assert all(x.address + x.size == y.address for x, y in zip(rows, rows[1:]))
            self.rows += rows


REGS = dict.fromkeys(("eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp"), 0)
DIRECT = {0x1030916F: 0x10326FC5, 0x1030D526: 0x103274B5, 0x1030FF97: 0x10327055}
CORE_CALLS = {0x1032874E: 0x1010C6D0}
CORE_CALLS.update(
    {
        p: 0x10111240
        for p in [0x103288AA, 0x103288D5, 0x10328900, 0x10327315, 0x10327339]
    }
)
CORE_CALLS.update(
    {
        p: 0x101111E0
        for p in [
            0x1032891D,
            0x10328932,
            0x10328947,
            0x1032895C,
            0x10328971,
            0x10328983,
            0x10328998,
            0x103289AD,
            0x103289C5,
            0x1032734E,
            0x10327360,
            0x10327375,
            0x10327387,
        ]
    }
)


def signed(value):
    return (
        (value & 0xFFFFFFFF) - 0x100000000 if value & 0x80000000 else value & 0xFFFFFFFF
    )


def matrix(memory, ptr):
    return [[memory[ptr + r * 16 + c * 4] for c in range(4)] for r in range(4)]


class TransformMachine(RandomMachine):
    def __init__(self, program, memory, registers):
        self.source = program
        super().__init__(memory, REGS | registers, program.rows)
        self.visited = []
        self.calls = []
        self.table_reads = []
        self.zero = self.less = self.carry = self.sign = self.parity = False

    def read(self, operand):
        if "[" in operand:
            ptr = self.address(operand)
            if 0x50008C <= ptr < 0x51008C:
                self.table_reads.append((ptr - 0x50008C) // 4)
        return super().read(operand)

    def push(self, value):
        self.registers["esp"] -= 4
        self.memory[self.registers["esp"]] = value

    def seh(self):
        # Account for the skipped normal SEH prologue. Handler/exception paths
        # never execute; a symbolic segment cell holds only the prior link.
        self.push(0xFFFFFFFF)
        self.push(0)
        self.push(self.memory[0])
        self.memory[0] = self.registers["esp"]

    def step(self, i):
        self.visited.append(i.address)
        op, args = i.mnemonic, i.op_str.split(", ")
        if i.address in CORE_CALLS:
            assert (
                bytes(
                    self.source.engine.data[
                        self.source.engine.offset(
                            i.address
                        ) : self.source.engine.offset(i.address)
                        + 6
                    ]
                )
                == b"\x90" * 6
            )
            target = CORE_CALLS[i.address]
            self.calls.append([i.address, target])
            self.push(i.address + 6)
            return target
        if op == "call":
            target = int(i.op_str, 16)
            assert target in DIRECT, (hex(i.address), hex(target))
            self.calls.append([i.address, target])
            self.push(i.address + i.size)
            self.seh()
            return DIRECT[target]
        if op == "ret":
            target = self.memory[self.registers["esp"]]
            self.registers["esp"] += 4 + int(i.op_str or "0", 0)
            return target or None
        if op == "rep movsd":
            for _ in range(self.registers["ecx"]):
                self.memory[self.registers["edi"]] = self.memory[self.registers["esi"]]
                self.registers["edi"] += 4
                self.registers["esi"] += 4
            self.registers["ecx"] = 0
        elif op == "neg":
            self.write(args[0], (-self.read(args[0])) & 0xFFFFFFFF)
        elif op == "sar":
            self.write(
                args[0],
                (signed(self.read(args[0])) >> (self.read(args[1]) & 31)) & 0xFFFFFFFF,
            )
        elif op in ("fsubr", "fdiv", "fdivr", "fdivp", "fdivrp"):
            pop = op.endswith("p")
            target = args[0] if pop or len(args) == 2 else "st(0)"
            other = "st(0)" if pop else args[1] if len(args) == 2 else args[0]
            a, b = self.read(target), self.read(other)
            value = (
                b - a
                if op == "fsubr"
                else b / a if op in ("fdivr", "fdivrp") else a / b
            )
            self.write(target, value)
            if pop:
                self.stack.pop(0)
        else:
            return super().step(i)
        return i.address + i.size

    def run(self, start):
        pc = start
        for _ in range(8192):
            if pc is None:
                return
            pc = self.step(self.program[pc])
        raise AssertionError("bounded matrix interpreter did not finish")


def native(program, kind, actor, table):
    ptr = 0x100000
    sp = 0x800000
    out = 0x200000
    memory = {
        0: 0,
        0x11D8D73C: 0x500000,
        sp: 0,
        sp + 4: out,
        ptr + 0x27C: actor["drawScale"],
    }
    for off, name in [
        (0x1BC, "location"),
        (0x1C8, "rotation"),
        (0x280, "drawScale3D"),
        (0x28C, "prePivot"),
    ]:
        for i, v in enumerate(actor[name]):
            memory[ptr + off + i * 4] = v
    memory.update({0x50008C + int(i) * 4: v for i, v in table.items()})
    m = TransformMachine(program, memory, {"ecx": ptr, "esp": sp})
    m.seh()
    m.run(0x103277C5 if kind == "local" else 0x103286A5)
    assert m.registers["esp"] == sp + 8, (kind, hex(m.registers["esp"]))
    assert not m.stack and m.memory[0] == 0
    return matrix(m.memory, out), m


def sampled_indices(rotation):
    values = []
    for r in rotation:
        values.extend(
            (
                (r >> 2) & 0x3FFF,
                (((r + 0x4000) & 0xFFFFFFFF) >> 2) & 0x3FFF,
                (((-r) & 0xFFFFFFFF) >> 2) & 0x3FFF,
                (((0x4000 - r) & 0xFFFFFFFF) >> 2) & 0x3FFF,
            )
        )
    return sorted(set(values))


def native_determinant(program, values):
    ptr, sp = 0x100000, 0x800000
    memory = {sp: 0} | {
        ptr + r * 16 + c * 4: values[r][c] for r in range(4) for c in range(4)
    }
    m = TransformMachine(program, memory, {"ecx": ptr, "esp": sp})
    m.run(0x10111BB0)
    assert len(m.stack) == 1 and m.registers["esp"] == sp + 4
    return m.stack[0], m


SCRIPT = r"""
import fs from 'node:fs';
const {originalActorTransforms}=await import(process.argv[1]);
const f=h=>{const b=Buffer.from(h,'hex');return b.readFloatLE();};
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
const out=rows.map(row=>{
 const sineTable=new Array(16384);
 for(const [i,v] of Object.entries(row.table))sineTable[i]=f(v);
 const actor={...row.actor,sineTable,arithmeticProfile:'pc53-rne'};
 for(const field of ['location','prePivot','drawScale3D'])actor[field]=actor[field].map(f);
 actor.drawScale=f(actor.drawScale);
 const r=originalActorTransforms(actor);
 if(r.status!=='ready')throw Error(JSON.stringify(r));
 return {local:r.localToWorld.map(bits),world:r.worldToLocal.map(bits),determinant:bits(r.determinant)};
});
process.stdout.write(JSON.stringify(out));
"""


def word(v):
    return struct.pack("<f", v).hex()


def words(matrix):
    return [word(v) for row in matrix for v in row]


def verify(
    engine_path,
    core_path,
    engine_package,
    comparison_engine_path,
    comparison_core_path,
    runtime_module,
    sine_profile=None,
):
    engine = Image(Path(engine_path), ENGINE_SHA, True)
    core = Image(Path(core_path), CORE_SHA)
    comparison_engine = PEImage(Path(comparison_engine_path), CANDIDATE_ENGINE_SHA)
    comparison_core = PEImage(Path(comparison_core_path), CANDIDATE_CORE_SHA)
    binding = qualify_actor_transforms(
        engine, core, comparison_engine, comparison_core, engine_package
    )
    program = TransformProgram(engine, core)
    rng = random.Random(0x41435452)
    cases = []
    expected = []
    coverage = {}
    steps = {}
    sine_receipt = None
    source_words = None
    if sine_profile is not None:
        from recover_gmath_table import recover

        sine_receipt, source_words = recover(core, comparison_core, sine_profile)
    for j in range(1400 if source_words is not None else 1200):
        rotation = [rng.randrange(-0x80000000, 0x80000000) for _ in range(3)]
        if j < 64:
            rotation = [
                [
                    -0x80000000,
                    -65537,
                    -16385,
                    -4,
                    -1,
                    0,
                    1,
                    3,
                    4,
                    16383,
                    16384,
                    65536,
                    0x7FFFFFFF,
                ][j % 13],
                j - 32,
                0,
            ]
        vec = lambda bound: [f32(rng.uniform(-bound, bound)) for _ in range(3)]
        a = dict(
            location=vec(350000),
            prePivot=vec(500),
            rotation=rotation,
            drawScale=f32(rng.choice([0.03, 0.125, 0.5, 1.0, 1.1, 2.3, -3.0])),
            drawScale3D=[
                f32(rng.choice([0.02, 0.125, 0.75, 1.0, 1.1, -2.7])) for _ in range(3)
            ],
        )
        table = {i: f32(rng.uniform(-1, 1)) for i in sampled_indices(rotation)}
        if j >= 1200:
            table = {
                i: struct.unpack("<f", bytes.fromhex(source_words[i]))[0]
                for i in sampled_indices(rotation)
            }
        if j < 1200 and j % 31 == 0:
            table = {i: rng.choice([0.0, -0.0, 1.0, -1.0]) for i in table}
            a["location"] = [0.0, -0.0, 0.0]
            a["prePivot"] = [-0.0, 0.0, -0.0]
        if j == 1:
            # Authored cancellation case: a rounded output basis is not the
            # intermediate used by the source translation expression.
            a.update(
                rotation=[0, 0, 0],
                location=[0.0, 0.0, 0.0],
                prePivot=[8192.0, 0.0, 0.0],
                drawScale=f32(1.1),
                drawScale3D=[0.75, 1.0, 1.0],
            )
            table = {0: f32(0.37), 4096: f32(0.61)}
            basis, _ = native(program, "local", a, table)
            a["location"][0] = f32(basis[0][0] * 8192)
        output = {}
        for kind in ["local", "world"]:
            result, m = native(program, kind, a, table)
            output[kind] = words(result)
            steps[kind] = steps.get(kind, 0) + len(m.visited)
            coverage.setdefault(kind, set()).update(m.visited)
            if kind == "local":
                det, dm = native_determinant(program, result)
                output["determinant"] = word(det)
                steps["determinant"] = steps.get("determinant", 0) + len(dm.visited)
                coverage.setdefault("determinant", set()).update(dm.visited)
        wire = {
            **a,
            **{
                key: [word(v) for v in a[key]]
                for key in ["location", "prePivot", "drawScale3D"]
            },
            "drawScale": word(a["drawScale"]),
        }
        cases.append(dict(actor=wire, table={i: word(v) for i, v in table.items()}))
        expected.append(output)
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
    for j, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("source comparison failed", j, cases[j], a, b)

    return dict(
        tool="Elbera Tools",
        status="pass",
        cases=len(cases),
        syntheticTableCases=1200,
        sourceTableCases=200 if source_words is not None else 0,
        sineProducer=sine_receipt,
        arithmeticProfile="pc53-rne",
        steps=steps,
        coverage={k: [hex(p) for p in sorted(v)] for k, v in coverage.items()},
        source=binding,
        runtimeSHA256=hashlib.sha256(Path(runtime_module).read_bytes()).hexdigest(),
        verifierSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        limits=[
            "Explicit finite current actor fields and consumed Float32 sine-table entries only.",
            "PC53/RNE finite arithmetic model; no other FPU mode, exception path or extended-exponent edge parity claimed.",
            "Static cache joins qualify consumers, not a live cache implementation or actor lifecycle.",
            "No static triangle sweep, material callback, spatial provider or walking admission.",
            "Supplemental correspondence does not authenticate the archive or repair a native image.",
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
    parser.add_argument(
        "--engine-package", type=Path, default=ROOT / "assets/interlude/system/Engine.u"
    )
    parser.add_argument("--comparison-engine", type=Path, required=True)
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument(
        "--sine-profile",
        choices=["source-sse2-RNE-PC53"],
        help="explicit conditional original table producer; omitted uses only authored tables",
    )
    parser.add_argument(
        "--runtime-module",
        type=Path,
        default=ROOT / "editor/world/js/actor-transforms.js",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    report = verify(
        args.engine,
        args.core,
        args.engine_package,
        args.comparison_engine,
        args.comparison_core,
        args.runtime_module,
        args.sine_profile,
    )
    if args.check:
        print(
            json.dumps(
                dict(
                    status=report["status"],
                    cases=report["cases"],
                    sourceTableCases=report["sourceTableCases"],
                    steps=report["steps"],
                    addresses={k: len(v) for k, v in report["coverage"].items()},
                    engineBlocks=len(report["source"]["blocks"]),
                    coreBodies=len(report["source"]["core"]),
                    sourceTableSHA256=(
                        report["sineProducer"]["tableSHA256"]
                        if report["sineProducer"]
                        else None
                    ),
                )
            )
        )
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
