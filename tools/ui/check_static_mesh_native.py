#!/usr/bin/env python3
"""Elbera Tools: original mesh tree and final hit versus actual browser modules.

Pinned original images are read only when verify() is called. Original bytes
are interpreted in memory, never executed or emitted. Explicit supplied-state
boundaries cover loaded arrays, stable material-method responses, successful
UMaterial default-object type checking, normal SEH frames and mathematical sqrt.
See docs/native-static-mesh-evidence.md for inputs and limits.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess

from check_static_triangle_native import TriangleMachine, hexes, f32
from check_static_sweep_native import native as native_prepare
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage
from static_mesh_source import (
    MeshProgram,
    TREE_START,
    HIT_START,
    HIT_END,
    HIT_SQRT_SITES,
)
from static_mesh_fixtures import SCRIPT, HIT_SCRIPT, simple_fixture, fixture, expected

ROOT = Path(__file__).resolve().parents[2]


class MeshMachine(TriangleMachine):
    def read(self, operand):
        if operand == "cl":
            return self.registers["ecx"] & 255
        return super().read(operand)

    def step(self, i):
        # Finite no-pending-exception profile; native exception dispatch is excluded.
        if i.mnemonic == "wait":
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic == "call" and i.op_str == "0x10305ed9":
            assert i.address in [0x107000B0, 0x107000BF]
            self.visited.append(i.address)
            self.push(i.address + i.size)
            return 0x104A4940
        return super().step(i)


class TreeMachine(MeshMachine):
    def __init__(self, *args, triangles, nodes, methods, default_object):
        super().__init__(*args, triangle_array=triangles)
        self.nodes = nodes
        self.methods = methods
        self.default_object = default_object
        self.events = []

    def enter_tree(self):
        sp = self.registers["esp"]
        self.memory[sp - 4] = self.registers["ebp"]
        self.memory[sp - 0x60] = self.memory[0]
        self.memory[0] = sp - 0x60
        self.registers["ebp"] = sp - 0x54
        self.registers["esp"] = sp - 0xD0
        return TREE_START

    def enter_bounds(self):
        sp = self.registers["esp"]
        self.memory[sp - 4] = self.registers["ebp"]
        self.memory[sp - 0x10] = self.memory[0]
        self.memory[0] = sp - 0x10
        self.registers["ebp"] = sp - 4
        self.registers["esp"] = sp - 0x50
        return 0x106FFF9B

    def step(self, i):
        if i.address == 0x10702D0C:
            raise AssertionError("original missing triangle assertion reached")
        if i.address == 0x10703012:
            self.events.append(["defaultObject"])
            self.registers["eax"] = self.default_object
            self.visited.append(i.address)
            return i.address + 6
        if i.mnemonic == "call":
            if i.address in [0x10702FEF, 0x1070303C]:
                if i.address == 0x10702FEF:
                    slot = self.memory[self.registers["esp"]]
                    value = self.methods["ownerMaterials"][slot]
                    self.registers["esp"] += 4
                    self.events.append(["ownerMaterial", slot, value])
                else:
                    value = self.methods["ownerMethod124"]
                    self.events.append(["ownerMethod124", value])
                self.registers["eax"] = value
                self.visited.append(i.address)
                return i.address + i.size
            target = int(i.op_str, 16)
            if target == 0x1030AB96:
                self.visited.append(i.address)
                self.push(i.address + i.size)
                return self.enter_tree()
            if target == 0x103116F8:
                self.visited.append(i.address)
                self.push(i.address + i.size)
                return self.enter_bounds()
            if target in [0x10304F0C, 0x10307608, 0x10306C99]:
                if target == 0x10306C99:
                    self.events.append(
                        ["triangle", self.memory[self.registers["esp"] + 8]]
                    )
                self.visited.append(i.address)
                self.push(i.address + i.size)
                return {
                    0x10304F0C: 0x105E9990,
                    0x10307608: 0x106FE2C0,
                    0x10306C99: 0x10701C30,
                }[target]
            if i.address in [0x10702CE1, 0x10702CF1]:
                index = self.memory[self.registers["esp"]]
                frame = 0x990000
                is_node = i.address == 0x10702CE1
                base = self.nodes if is_node else self.triangle_array
                helper = MeshMachine(
                    self.source,
                    {frame + 8: index},
                    {"ebp": frame, "ebx": base, "esp": 0x980000},
                )
                helper.until(
                    0x106FF8C6 if is_node else 0x106FF716,
                    0x106FF8CE if is_node else 0x106FF71E,
                )
                self.registers["eax"] = helper.registers["eax"]
                self.registers["esp"] += 4
                self.visited.append(i.address)
                self.visited.extend(helper.visited)
                self.events.append(["node" if is_node else "triangleRecord", index])
                return i.address + i.size
            if i.address == 0x10703019:
                # Explicit known UMaterial default object / successful CastChecked boundary.
                value = self.memory[self.registers["esp"]]
                assert value == self.default_object and value != 0
                self.registers["eax"] = value
                self.visited.append(i.address)
                self.events.append(["checkedDefaultObject"])
                return i.address + i.size
        if i.address == 0x10703042:
            self.events.append(
                ["object578", self.registers["eax"], self.registers["edi"]]
            )
        return super().step(i)

    def run_tree(self):
        pc = self.enter_tree()
        for _ in range(2000000):
            if pc is None:
                return
            pc = self.step(self.program[pc])
        raise AssertionError("bounded authored tree did not finish")


def native_tree(program, a):
    (
        sp,
        query,
        result,
        cache,
        owner,
        mesh,
        triangles,
        vertices,
        plane_cache,
        vertex_cache,
        nodes,
        mats,
        default_obj,
    ) = (
        0x1800000,
        0x100000,
        0x200000,
        0x300000,
        0x400000,
        0x500000,
        0x10000000,
        0x20000000,
        0x30000000,
        0x40000000,
        0x50000000,
        0x60000000,
        0x70000000,
    )
    memory = dict(program.constants) | {
        0: 0,
        sp: 0,
        sp + 4: 0,
        query: result,
        query + 4: owner,
        query + 8: mesh,
        query + 0x44: cache,
        cache: owner,
        cache + 4: mesh,
        cache + 0x88: a["cache"]["determinant"],
        cache + 0x8C: plane_cache,
        cache + 0x90: vertex_cache,
        cache + 0x94: a["cache"]["queryTag"],
        owner: 0xD00000,
        0xD000AC: 0,
        0xD00124: 0,
        owner + 0x64: 0x10 if a["ownerStatic"] else 0,
        owner + 0x3A0: a["ownerFlags3a0"],
        mesh + 0x78: vertices,
        mesh + 0x13C: mats,
        default_obj + 0x38: a["methods"]["defaultMaterial"],
        result + 0x24: a["time"],
    }
    for i, v in enumerate(a["cache"]["localToWorld"]):
        memory[cache + 8 + i * 4] = v
    for off, key in [(0x48, "start"), (0x54, "end"), (0x18, "extent")]:
        memory.update({query + off + i * 4: v for i, v in enumerate(a[key])})
    local, base, preparation = native_prepare(
        program.sweep,
        dict(
            start=a["start"],
            end=a["end"],
            extent=a["extent"],
            cacheWorldToLocal=a["cache"]["worldToLocal"],
        ),
    )
    for off, key in [
        (0x60, "localStart"),
        (0x6C, "localEnd"),
        (0x30, "localExtent"),
        (0x78, "localDelta"),
        (0x84, "reciprocalDelta"),
    ]:
        memory.update({query + off + i * 4: v for i, v in enumerate(local[key])})
    for i, p in enumerate(a["mesh"]["vertices"]):
        memory.update({vertices + i * 24 + k * 4: v for k, v in enumerate(p)})
    for i, planes in enumerate(a["mesh"]["collisionTree"]["trianglePlanes"]):
        p = triangles + i * 0x54
        memory.update({p + k * 4: v for k, v in enumerate(planes)})
        memory.update(
            {
                p + 0x40 + k * 4: v
                for k, v in enumerate(a["mesh"]["indices"][3 * i : 3 * i + 3])
            }
        )
        memory[p + 0x4C] = a["mesh"]["materials"][i]
    for i, node in enumerate(a["mesh"]["collisionTree"]["nodes"]):
        p = nodes + i * 0x2C
        memory.update({p + k * 4: v for k, v in enumerate(node["links"])})
        memory.update({p + 0x10 + k * 4: v for k, v in enumerate(node["bounds"])})
        memory[p + 0x28] = node["valid"]
    for i, r in enumerate(a["cache"]["planes"]):
        p = plane_cache + i * 24
        memory[p] = r["valid"]
        memory[p + 0x14] = r["queryTag"]
        if "plane" in r:
            memory.update({p + 4 + k * 4: v for k, v in enumerate(r["plane"])})
    for i, r in enumerate(a["cache"]["vertices"]):
        p = vertex_cache + i * 16
        memory[p] = r["valid"]
        if "point" in r:
            memory.update({p + 4 + k * 4: v for k, v in enumerate(r["point"])})
    for i, v in enumerate(a["meshMaterials"]):
        memory[mats + i * 20] = v
    m = TreeMachine(
        program,
        memory,
        {"esp": sp, "ecx": query},
        triangles=triangles,
        nodes=nodes,
        methods=a["methods"],
        default_object=default_obj,
    )
    m.run_tree()
    assert not m.stack and m.registers["esp"] == sp + 8 and m.memory[0] == 0
    state = dict(time=m.memory[result + 0x24])
    if result + 0x14 in m.memory:
        state.update(
            normal=[m.memory[result + 0x14 + k * 4] for k in range(3)],
            triangleIndex=m.memory[result + 0x28],
            material=m.memory[result + 0x2C],
        )
    planes = []
    verts = []
    for i in range(len(a["cache"]["planes"])):
        p = plane_cache + i * 24
        r = dict(valid=m.memory[p], queryTag=m.memory[p + 0x14])
        if p + 4 in m.memory:
            r["plane"] = [m.memory[p + 4 + k * 4] for k in range(4)]
        planes.append(r)
    for i in range(len(a["cache"]["vertices"])):
        p = vertex_cache + i * 16
        r = dict(valid=m.memory[p])
        if p + 4 in m.memory:
            r["point"] = [m.memory[p + 4 + k * 4] for k in range(3)]
        verts.append(r)
    m.visited = base.visited + preparation.visited + m.visited
    return (
        dict(
            hit=m.registers["eax"],
            result=state,
            planes=planes,
            vertices=verts,
            events=m.events,
        ),
        m,
    )


class HitMachine(MeshMachine):
    def step(self, i):
        if i.mnemonic == "call" and i.op_str == "0x10307743":
            assert i.address in (0x107035DE, 0x107035F2)
            self.visited.append(i.address)
            self.push(i.address + i.size)
            return 0x103704B0
        if i.address in HIT_SQRT_SITES:
            assert i.mnemonic == "call" and i.op_str == "0x10104840"
            value = self.memory[self.registers["esp"]]
            assert value > 0 and math.isfinite(value)
            self.stack.insert(0, math.sqrt(value))
            self.sqrt_calls += 1
            self.visited.append(i.address)
            return i.address + i.size
        return super().step(i)


def native_hit(program, a):
    frame, sp, result, owner, mesh = 0x1800000, 0x17FFD00, 0x100000, 0x200000, 0x300000
    memory = dict(program.constants) | {frame - 0x1C: mesh, result + 0x24: a["time"]}
    for offset, key in [(0x10, "end"), (0x1C, "start")]:
        memory.update({frame + offset + i * 4: v for i, v in enumerate(a[key])})
    memory.update({result + 0x14 + i * 4: v for i, v in enumerate(a["normal"])})
    m = HitMachine(
        program, memory, {"esp": sp, "ebp": frame, "edi": result, "ebx": owner}
    )
    m.until(HIT_START, HIT_END)
    assert not m.stack and m.registers["esp"] == sp
    assert m.memory[result + 4] == owner and m.memory[result + 0x20] == mesh
    return (
        dict(
            time=m.memory[result + 0x24],
            point=[m.memory[result + 8 + i * 4] for i in range(3)],
            normal=[m.memory[result + 0x14 + i * 4] for i in range(3)],
        ),
        m,
    )


def fixtures(program):
    """Expected results come from retained instructions, not browser formulas."""
    cases, results, hit_cases, hit_results, visited = [], [], [], [], set()
    counts = dict(
        steps=0,
        treeCases=600,
        composedCases=400,
        hitCases=1600,
        hits=0,
        clear=0,
        triangleTests=0,
        visitedNodes=0,
        objectFields=0,
        defaultMaterials=0,
    )

    def record(machine):
        counts["steps"] += len(machine.visited)
        visited.update(machine.visited)

    for kind, seed, count in [("tree", 0x4D455348, 600), ("composed", 0x434F4D50, 400)]:
        rng = random.Random(seed)
        for j in range(count):
            a = simple_fixture() if kind == "tree" and j == 0 else fixture(rng, j)
            if kind == "composed":
                a["time"] = 1.0
            elif j % 9 == 0:
                old, _ = native_tree(program, a)
                a["cache"]["planes"] = old["planes"]
                a["cache"]["vertices"] = old["vertices"]
                a["cache"]["queryTag"] = (a["cache"]["queryTag"] + 1) & 0xFFFFFFFF
            row, machine = native_tree(program, a)
            out = expected(row)
            record(machine)
            if kind == "composed" and out["hit"]:
                hit, machine = native_hit(
                    program,
                    dict(
                        start=a["start"],
                        end=a["end"],
                        normal=out["result"]["normal"],
                        time=out["result"]["time"],
                    ),
                )
                out["result"].update(hit)
                record(machine)
            counts["hits" if out["hit"] else "clear"] += 1
            for key in ["triangleTests", "visitedNodes", "objectFields"]:
                counts[key] += len(out[key])
            counts["defaultMaterials"] += sum(
                e[0] == "defaultMaterial" for e in out["events"]
            )
            cases.append(hexes(a | dict(kind=kind)))
            results.append(hexes(out))

    rng = random.Random(0x484954)
    for j in range(1600):

        def vec(bound):
            return [f32(rng.uniform(-bound, bound)) for _ in range(3)]

        start = vec(300000)
        end = [f32(a + b) for a, b in zip(start, vec(500))]
        normal = vec(10)
        if j % 11 == 0:
            normal = vec(1e-5)
        if j % 13 == 0:
            normal = [0.0, -0.0, 0.0]
        if j % 17 == 0:
            start = [0.0, 0.0, 0.0]
            end = [
                f32(rng.choice([0.00001, 0.01, 0.1, 1.0, 10.0, 100.0, 10000.0])),
                0.0,
                0.0,
            ]
        a = dict(start=start, end=end, normal=normal, time=f32(rng.uniform(-0.2, 1.2)))
        out, machine = native_hit(program, a)
        record(machine)
        hit_cases.append(hexes(a))
        hit_results.append(hexes(out))
    return (
        [(SCRIPT, cases, results), (HIT_SCRIPT, hit_cases, hit_results)],
        counts,
        visited,
    )


def browser_outputs(script, cases, runtime):
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script, Path(runtime).resolve().as_uri()],
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        check=True,
        timeout=60,
    )
    return json.loads(proc.stdout)


def verify(
    engine_path, core_path, comparison_engine_path, comparison_core_path, runtime_module
):
    program = MeshProgram(
        Image(Path(engine_path), ENGINE_SHA, True),
        Image(Path(core_path), CORE_SHA),
        PEImage(Path(comparison_engine_path), CANDIDATE_ENGINE_SHA),
        PEImage(Path(comparison_core_path), CANDIDATE_CORE_SHA),
    )
    batches, counts, visited = fixtures(program)
    runtime_module = Path(runtime_module).resolve()
    for (script, cases, results), runtime in zip(
        batches, [runtime_module, runtime_module.with_name("static-hit.js")]
    ):
        actual = browser_outputs(script, cases, runtime)
        assert len(actual) == len(results)
        for index, (got, wanted) in enumerate(zip(actual, results)):
            assert got == wanted, (
                "source mesh mismatch",
                runtime.name,
                index,
                cases[index],
                got,
                wanted,
            )
    files = [
        runtime_module,
        *[
            runtime_module.with_name(name)
            for name in ["static-hit.js", "static-triangle.js", "static-sweep.js"]
        ],
        Path(__file__),
        Path(__file__).with_name("static_mesh_source.py"),
        Path(__file__).with_name("static_mesh_fixtures.py"),
    ]
    return dict(
        tool="Elbera Tools",
        status="pass",
        cases=sum(len(cases) for _, cases, _ in batches),
        **counts,
        arithmeticProfile="pc53-rne-math-sqrt",
        source=program.receipt,
        coverage=[hex(at) for at in sorted(visited)],
        files={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
        limits=[
            "Authored geometry and current state; no map placement or live actor provenance claim.",
            "Finite PC53/RNE and mathematical sqrt; native CRT, FPU startup and exception behavior unobserved.",
            "Normal SEH frames supplied. Setup, unwind and exception paths are not interpreted.",
            "Loaded arrays and advanced query tag supplied; native cache paging, acquisition and lifetime excluded.",
            "Stable virtual method returns and successful UMaterial default-object type check supplied; implementations excluded.",
            "Ordinary nonzero mesh branch only. Wrapper admission is qualified, not interpreted; alternate primitive branches unported here.",
            "No current actor provider, level integration, walking or visual fidelity claim.",
            "Supplemental correspondence neither authenticates its archive nor restores the owned binary.",
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
        default=ROOT / "editor/world/js/static-mesh-tree.js",
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
                    key: report[key]
                    for key in [
                        "status",
                        "cases",
                        "treeCases",
                        "composedCases",
                        "hitCases",
                        "steps",
                        "hits",
                        "clear",
                    ]
                }
                | {"addresses": len(report["coverage"])}
            )
        )
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
