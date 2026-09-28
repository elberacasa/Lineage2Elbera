#!/usr/bin/env python3
"""Elbera Tools: original nonzero static sweep preparation versus the browser.

Interprets bounded retained Engine/Core instructions with an explicit finite
PC53/RNE profile and supplied cached matrix. No DLL execution or game assets
are emitted. Required supplemental inputs qualify erased calls independently.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct
import subprocess

from check_actor_transforms_native import TransformMachine, f32, word, signed
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from check_hair_attachment_native import compare_call_block
from supplemental_pe import PEImage
from static_collision_source import qualify_static_records

ROOT = Path(__file__).resolve().parents[2]
CORE_CALLS = {
    0x106FF09D: ("??0FBox@@QAE@ABVFVector@@0@Z", 0x1010EF80),
    0x106FF0A5: ("?TransformBy@FBox@@QBE?AV1@ABVFMatrix@@@Z", 0x10117DD0),
    0x106FF0AD: ("?GetExtent@FBox@@QBE?AVFVector@@XZ", 0x1010F1B0),
}
BOX_ADD = "??YFBox@@QAEAAV0@ABVFVector@@@Z"
OUTPUT_FIELDS = {
    "localStart": 0x60,
    "localEnd": 0x6C,
    "localExtent": 0x30,
    "localDelta": 0x78,
    "reciprocalDelta": 0x84,
}
IDENTITY = [
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
]


class PreparationProgram:
    def __init__(self, engine, core, comparison_engine, comparison_core):
        assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
            ENGINE_SHA,
            CORE_SHA,
            CANDIDATE_ENGINE_SHA,
            CANDIDATE_CORE_SHA,
        )
        self.engine, self.rows = engine, []
        engine_blocks, core_blocks = [], []
        for name, start, end in [
            (CORE_CALLS[0x106FF09D][0], 0x1010EF80, 0x1010EFB2),
            (CORE_CALLS[0x106FF0A5][0], 0x10117DD0, 0x10117F26),
            (CORE_CALLS[0x106FF0AD][0], 0x1010F1B0, 0x1010F1F8),
            (BOX_ADD, 0x101177F0, 0x10117954),
        ]:
            assert core.exported(name, True) == comparison_core.body(name) == start
            raw = bytes(core.data[core.offset(start) : core.offset(end)])
            assert raw == comparison_core.read(start, end - start)
            core_blocks.append(dict(symbol=name, **self.add(core, start, end, raw)))
        assert core.exported(BOX_ADD) == comparison_core.exports[BOX_ADD] == 0x10101866
        core.instruction(0x10117EE9, "call", "0x10101866")
        for start, end in [(0x106FEFE1, 0x106FF0C4), (0x106FF3D1, 0x106FF568)]:
            raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
            comparison = compare_call_block(
                raw,
                comparison_engine.read(start - 0x40, end - start),
                owned_va=start,
                candidate_va=start - 0x40,
                sites=[
                    (at - start, ("core.dll", name))
                    for at, (name, _) in CORE_CALLS.items()
                    if start <= at < end
                ],
                direct_calls=[],
                imports=comparison_engine.imports,
            )
            engine_blocks.append(
                dict(**self.add(engine, start, end, raw), comparison=comparison)
            )
        constants = []
        for image, comparison, at, expected in [
            (core, comparison_core, 0x101CDEA0, 0.5),
            (engine, comparison_engine, 0x108E9018, 1.0000000116860974e-7),
        ]:
            raw = bytes(image.data[image.offset(at) : image.offset(at) + 8])
            assert raw == comparison.read(at, 8)
            value = struct.unpack("<d", raw)[0]
            assert value == expected
            constants.append(
                dict(
                    address=hex(at), value=value, SHA256=hashlib.sha256(raw).hexdigest()
                )
            )
        self.half, self.epsilon = [row["value"] for row in constants]
        self.receipt = dict(
            ownedEngineSHA256=engine.sha,
            ownedCoreSHA256=core.sha,
            supplementalEngineSHA256=comparison_engine.sha,
            supplementalCoreSHA256=comparison_core.sha,
            engineBlocks=engine_blocks,
            coreBlocks=core_blocks,
            constants=constants,
        )

    def add(self, image, start, end, raw):
        rows = list(image.dis.disasm(raw, start))
        assert rows[0].address == start and rows[-1].address + rows[-1].size == end
        assert all(a.address + a.size == b.address for a, b in zip(rows, rows[1:]))
        self.rows += rows
        return dict(
            start=hex(start),
            end=hex(end),
            instructions=len(rows),
            SHA256=hashlib.sha256(raw).hexdigest(),
        )


class PreparationMachine(TransformMachine):
    def step(self, instruction):
        if instruction.address in CORE_CALLS:
            self.visited.append(instruction.address)
            self.push(instruction.address + 6)
            return CORE_CALLS[instruction.address][1]
        if instruction.mnemonic == "fnstsw" and isinstance(
            self.registers.get("eax"), float
        ):
            # MOV can carry a Float32 cell in this interpreter. Preserve EAX's
            # high word before the original FNSTSW overwrites AX.
            self.registers["eax"] = struct.unpack(
                "<I", struct.pack("<f", self.registers["eax"])
            )[0]
        if instruction.mnemonic == "call":
            assert (
                instruction.address == 0x10117EE9 and instruction.op_str == "0x10101866"
            )
            self.visited.append(instruction.address)
            self.push(instruction.address + instruction.size)
            return 0x101177F0
        if instruction.mnemonic == "sub":
            a, b = [self.read(arg) for arg in instruction.op_str.split(", ")]
            result = super().step(instruction)
            value = (a - b) & 0xFFFFFFFF
            # The FBox corner loops consume SUB's zero/carry flags. The older
            # matrix-only interpreter needed only sign after its SUB sites.
            self.zero = value == 0
            self.carry = (a & 0xFFFFFFFF) < (b & 0xFFFFFFFF)
            self.less = signed(a) < signed(b)
            return result
        return super().step(instruction)

    def until(self, start, end):
        pc = start
        for _ in range(8192):
            if pc == end:
                return
            pc = self.step(self.program[pc])
        raise AssertionError("bounded source preparation did not finish")


def native(program, inputs):
    """Start after cache acquisition with explicit original fields and frame."""
    ptr, cache, frame, sp, extent_ptr = 0x100000, 0x200000, 0x800000, 0x7FFF00, 0x300000
    memory = {ptr + 0x44: cache, 0x101CDEA0: program.half, 0x108E9018: program.epsilon}
    memory.update({ptr + 0xC + i * 4: v for i, v in enumerate(inputs["start"])})
    memory.update({extent_ptr + i * 4: v for i, v in enumerate(inputs["extent"])})
    memory.update(
        {cache + 0x48 + i * 4: v for i, v in enumerate(inputs["cacheWorldToLocal"])}
    )
    base = PreparationMachine(
        program, memory, {"esi": ptr, "edi": extent_ptr, "ebp": frame, "esp": sp}
    )
    base.until(0x106FEFE1, 0x106FF0C4)
    assert not base.stack and base.registers["esp"] == sp
    memory = base.memory
    memory.update({frame + 0x1C: inputs["start"][2]})
    memory.update({frame + 0x20 + i * 4: v for i, v in enumerate(inputs["end"])})
    query = PreparationMachine(
        program,
        memory,
        {
            "esi": ptr,
            "edi": inputs["start"][0],
            "ebx": inputs["start"][1],
            "ebp": frame,
            "esp": sp,
        },
    )
    query.until(0x106FF3D1, 0x106FF568)
    assert not query.stack and query.registers["esp"] == sp
    output = {
        key: [query.memory[ptr + offset + i * 4] for i in range(3)]
        for key, offset in OUTPUT_FIELDS.items()
    }
    return output, base, query


SCRIPT = r"""
import fs from 'node:fs';
const {prepareStaticSweep}=await import(process.argv[1]);
const val=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const inputs=JSON.parse(fs.readFileSync(0,'utf8'));
const rows=inputs.map(input=>{
 const a={arithmeticProfile:'pc53-rne'};
 for(const [key,value] of Object.entries(input))a[key]=value.map(val);
 const r=prepareStaticSweep(a);if(r.status!=='ready')throw Error(JSON.stringify(r));
 return Object.fromEntries(['localStart','localEnd','localExtent','localDelta','reciprocalDelta'].map(k=>[k,r[k].map(bits)]));
});
process.stdout.write(JSON.stringify(rows));
"""


def verify(
    engine_path, core_path, comparison_engine_path, comparison_core_path, runtime_module
):
    engine = Image(Path(engine_path), ENGINE_SHA, True)
    core = Image(Path(core_path), CORE_SHA)
    comparison_engine = PEImage(Path(comparison_engine_path), CANDIDATE_ENGINE_SHA)
    comparison_core = PEImage(Path(comparison_core_path), CANDIDATE_CORE_SHA)
    program = PreparationProgram(engine, core, comparison_engine, comparison_core)
    serializers = qualify_static_records(
        engine, core, comparison_engine, comparison_core
    )
    rng = random.Random(0x535750)
    cases, expected = [], []
    steps, exact_zero, shortcut_differences = 0, 0, 0
    visited = set()
    for j in range(800):
        vec = lambda bound: [f32(rng.uniform(-bound, bound)) for _ in range(3)]
        matrix = vec(3) + [0.0] + vec(3) + [0.0] + vec(3) + [0.0] + vec(350000) + [1.0]
        start = vec(350000)
        end = [f32(v + d) for v, d in zip(start, vec(1000))]
        if j % 7 == 0:
            end = start[:]
        if j % 11 == 0:
            matrix = IDENTITY[:]
            end[0] = start[0]
        extent = [f32(rng.uniform(1, 100)) for _ in range(3)]
        if j % 17 == 0:
            extent[1:] = [0.0, -0.0]
        if j == 1:
            matrix = IDENTITY[:]
            matrix[12:15] = [2.0**24, 2.0**25, 0.0]
            start, end, extent = [0.0, 0.0, 0.0], [8.0, 8.0, 8.0], [1.0, 1.0, 1.0]
        if j == 2:
            matrix = IDENTITY[:]
            start, end, extent = (
                [0.0, 0.0, 0.0],
                [f32(1e-9), f32(-1e-9), -0.0],
                [1.0, 1.0, 1.0],
            )
        if j == 3:
            matrix = [-0.0] * 15 + [1.0]
            start, end, extent = [1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [2.0, 3.0, 4.0]
        inputs = dict(start=start, end=end, extent=extent, cacheWorldToLocal=matrix)
        output, base, query = native(program, inputs)
        expected.append({k: list(map(word, v)) for k, v in output.items()})
        cases.append({k: list(map(word, v)) for k, v in inputs.items()})
        exact_zero += sum(
            a == b for a, b in zip(output["localStart"], output["localEnd"])
        )
        shortcut = [
            f32(sum(abs(matrix[k * 4 + i]) * extent[k] for k in range(3)))
            for i in range(3)
        ]
        shortcut_differences += list(map(word, shortcut)) != list(
            map(word, output["localExtent"])
        )
        steps += len(base.visited) + len(query.visited)
        visited.update(base.visited)
        visited.update(query.visited)
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
            "source comparison failed",
            index,
            cases[index],
            got,
            wanted,
        )
    return dict(
        tool="Elbera Tools",
        status="pass",
        cases=len(cases),
        steps=steps,
        coverage=[hex(p) for p in sorted(visited)],
        exactZeroDeltaComponents=exact_zero,
        genericExtentShortcutDifferences=shortcut_differences,
        arithmeticProfile="pc53-rne",
        source=program.receipt,
        serializers=serializers,
        runtimeSHA256=hashlib.sha256(Path(runtime_module).read_bytes()).hexdigest(),
        verifierSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        limits=[
            "Explicit finite query and cached source matrix; post-cache preparation slices only.",
            "PC53/RNE finite arithmetic; no other FPU profile, exception or extended-exponent edge parity.",
            "No cache creation/tags/lifetime, actor admission, tree traversal, triangle result, material callback or walking.",
            "Serializer binding is static code correspondence, not native archive I/O execution.",
            "Supplemental correspondence does not authenticate the archive or repair the owned image.",
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
        "--runtime-module", type=Path, default=ROOT / "editor/world/js/static-sweep.js"
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
                        "exactZeroDeltaComponents",
                        "genericExtentShortcutDifferences",
                    ]
                }
                | {"addresses": len(report["coverage"])}
            )
        )
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
