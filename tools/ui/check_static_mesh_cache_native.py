#!/usr/bin/env python3
"""Elbera Tools: original static mesh cache lifetime versus browser queries.

Pinned images are read only when verify() runs. No DLL executes or source bytes
are emitted. Memory-cache responses, stable counts and owner matrix responses
are explicit inputs; statistics-only gaps and exception paths are excluded.
See docs/native-static-mesh-cache-evidence.md for contracts and limits.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import random

from check_static_mesh_native import (
    MeshMachine,
    native_tree,
    native_hit,
    browser_outputs,
)
from check_static_triangle_native import hexes, f32, word
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from supplemental_pe import PEImage
from static_mesh_cache_source import CacheProgram, STATISTICS_GAPS
from static_mesh_fixtures import fixture, expected, simple_fixture
from static_mesh_cache_fixtures import SCRIPT, DETERMINANT_SCRIPT

ROOT = Path(__file__).resolve().parents[2]


class CacheMatrixMachine(MeshMachine):
    def __init__(self, *args, matrices, count):
        super().__init__(*args)
        self.matrices = matrices
        self.count = count
        self.events = []

    def step(self, i):
        if i.mnemonic == "call":
            if i.op_str == "0x1030eeda":
                assert i.address in (0x106FEB82, 0x106FEBA9, 0x106FED98)
                self.registers["eax"] = self.count
                self.events.append(["triangleCount", self.count])
                self.visited.append(i.address)
                return i.address + i.size
            if i.op_str == "0x1030e390":
                assert i.address in (0x106FEB6E, 0x106FEFC3)
                self.visited.append(i.address)
                self.push(i.address + i.size)
                sp = self.registers["esp"]
                self.memory[sp - 0xC] = self.memory[0]
                self.memory[0] = sp - 0xC
                self.registers["esp"] = sp - 0x4C
                self.events.append(["matrixUpdate"])
                return 0x106FE138
            if i.address in [0x106FE14D, 0x106FE184]:
                assert i.op_str == ("eax" if i.address == 0x106FE14D else "edx")
                key = "worldToLocal" if i.address == 0x106FE14D else "localToWorld"
                target = self.memory[self.registers["esp"]]
                self.memory.update(
                    {target + k * 4: v for k, v in enumerate(self.matrices[key])}
                )
                self.registers["eax"] = target
                self.registers["esp"] += 4
                self.events.append([key])
                self.visited.append(i.address)
                return i.address + i.size
        return super().step(i)


def matrix_cache_machine(program, count, verts, matrices):
    frame, cache, owner, mesh, query, sp = (
        0x800000,
        0x100000,
        0x200000,
        0x300000,
        0x400000,
        0x7FFD00,
    )
    memory = {
        0: 0x999,
        frame + 8: owner,
        frame + 12: mesh,
        cache: owner,
        cache + 4: mesh,
        query + 4: owner,
        query + 0x44: cache,
        mesh + 0x7C: verts,
        owner: 0xA00000,
        0xA00150: 0,
        0xA00148: 0,
        owner + 0x64: 0,
        sp: 0,
    }
    return (
        CacheMatrixMachine(
            program,
            memory,
            dict(ebp=frame, ecx=cache, esi=query, esp=sp),
            matrices=matrices,
            count=count,
        ),
        cache,
        mesh,
        query,
    )


class CacheMachine(CacheMatrixMachine):
    def __init__(self, *args, mode, old, new, token_old, token_new, **kwargs):
        assert mode in ("miss", "reuse", "wrong-owner", "wrong-mesh")
        super().__init__(*args, **kwargs)
        self.mode = mode
        self.old = old
        self.new = new
        self.token_old = token_old
        self.token_new = token_new
        self.skipped_statistics = []

    def step(self, i):
        if i.address in [0x106FEF22, 0x106FEF96]:
            sp = self.registers["esp"]
            low, high, ref = [self.memory[sp + k * 4] for k in range(3)]
            if i.address == 0x106FEF22:
                align = self.memory[sp + 12]
                self.events.append(["get", low, high, align])
                value = 0 if self.mode == "miss" else self.old
                token = 0 if not value else self.token_old
                size = 16
            else:
                size_arg, align, extra = [self.memory[sp + k * 4] for k in [3, 4, 5]]
                self.events.append(["create", size_arg, align, extra])
                value = self.new
                token = self.token_new
                size = 24
            self.memory[ref] = token
            self.registers["eax"] = value
            self.registers["esp"] += size
            self.visited.append(i.address)
            return i.address + 6
        if i.address in [0x106FEF41, 0x106FE894]:
            assert self.registers["ecx"] in [self.token_old, self.token_new]
            self.events.append(["unlock"])
            self.visited.append(i.address)
            return i.address + 6
        if i.address == 0x106FEF55:
            sp = self.registers["esp"]
            low, high, mask, ignore = [self.memory[sp + k * 4] for k in range(4)]
            self.events.append(["flush", mask & 0xFFFFFFFF, ignore])
            self.registers["esp"] += 16
            self.visited.append(i.address)
            return i.address + 6
        if i.mnemonic == "call" and i.op_str in [
            "0x1030df58",
            "0x10302d47",
            "0x107a6660",
        ]:
            assert (
                i.address
                == {
                    "0x1030df58": 0x106FEF08,
                    "0x10302d47": 0x106FEF7F,
                    "0x107a6660": 0x106FEB08,
                }[i.op_str]
            )
            self.visited.append(i.address)
            self.push(i.address + i.size)
            return {
                "0x1030df58": 0x106FEAD0,
                "0x10302d47": 0x106FED90,
                "0x107a6660": 0x107A6660,
            }[i.op_str]
        if i.mnemonic == "call" and i.op_str == "0x10313101":
            assert i.address == 0x106FEFAD
            self.visited.append(i.address)
            self.push(i.address + i.size)
            sp = self.registers["esp"]
            self.memory[sp - 4] = self.registers["ebp"]
            self.memory[sp - 0x10] = self.memory[0]
            self.memory[0] = sp - 0x10
            for off, reg in [(0x2C, "ebx"), (0x30, "esi"), (0x34, "edi")]:
                self.memory[sp - off] = self.registers[reg]
            self.registers["ebp"] = sp - 4
            self.registers["esp"] = sp - 0x34
            return 0x106FEB51
        if i.mnemonic in ["or", "mul", "adc", "add"]:
            args = i.op_str.split(", ")
            if i.mnemonic == "mul":
                product = (self.registers["eax"] & 0xFFFFFFFF) * (
                    self.read(args[0]) & 0xFFFFFFFF
                )
                self.registers["eax"] = product & 0xFFFFFFFF
                self.registers["edx"] = product >> 32
                self.carry = bool(product >> 32)
            else:
                a, b = self.read(args[0]) & 0xFFFFFFFF, self.read(args[1]) & 0xFFFFFFFF
                value = (
                    (a | b)
                    if i.mnemonic == "or"
                    else a + b + (int(self.carry) if i.mnemonic == "adc" else 0)
                )
                self.write(args[0], value & 0xFFFFFFFF)
                self.carry = False if i.mnemonic == "or" else value > 0xFFFFFFFF
                self.zero = (value & 0xFFFFFFFF) == 0
                self.sign = bool(value & 0x80000000)
            self.visited.append(i.address)
            return i.address + i.size
        return super().step(i)

    def acquire(self):
        pc = 0x106FEEB1
        for _ in range(100000):
            if pc == 0x106FEFE1:
                return
            if pc in STATISTICS_GAPS:
                self.skipped_statistics.append(pc)
                pc = STATISTICS_GAPS[pc]
                continue
            pc = self.step(self.program[pc])
        raise AssertionError("bounded acquisition did not finish")


def native_acquire(
    program, a, mode, old_cache, owner_index, mesh_index, matrices, release=True
):
    frame, sp, query, old, new, owner, mesh, token_old, token_new = (
        0x900000,
        0x8FFD00,
        0x500000,
        0x1000000,
        0x2000000,
        0x3000000,
        0x4000000,
        0x7000000,
        0x7000010,
    )
    count = len(a["mesh"]["materials"])
    verts = len(a["mesh"]["vertices"])
    memory = dict(program.constants) | {
        0: 0x999,
        frame + 8: 0x600000,
        frame + 12: owner,
        frame + 16: mesh,
        owner + 0x28: owner_index,
        mesh + 0x28: mesh_index,
        mesh + 0x7C: verts,
        owner: 0xA00000,
        0xA00150: 0,
        0xA00148: 0,
        owner + 0x64: 0x10 if a["ownerStatic"] else 0,
    }
    for off, key in [(0x14, "start"), (0x20, "extent")]:
        memory.update({frame + off + k * 4: v for k, v in enumerate(a[key])})
    if mode != "miss":
        memory.update(
            {
                old: owner if mode != "wrong-owner" else 0xDEAD,
                old + 4: mesh if mode != "wrong-mesh" else 0xBEEF,
                old + 0x94: old_cache["queryTag"],
                old + 0x88: old_cache["determinant"],
                old + 0x8C: old + 0x98,
                old + 0x90: old + 0x98 + count * 24,
            }
        )
        for off, key in [(8, "localToWorld"), (0x48, "worldToLocal")]:
            memory.update({old + off + k * 4: v for k, v in enumerate(old_cache[key])})
        for i, r in enumerate(old_cache["planes"]):
            p = old + 0x98 + i * 24
            memory[p] = r["valid"]
            memory[p + 20] = r["queryTag"]
            if "plane" in r:
                memory.update({p + 4 + k * 4: v for k, v in enumerate(r["plane"])})
        for i, r in enumerate(old_cache["vertices"]):
            p = old + 0x98 + count * 24 + i * 16
            memory[p] = r["valid"]
            if "point" in r:
                memory.update({p + 4 + k * 4: v for k, v in enumerate(r["point"])})
    m = CacheMachine(
        program,
        memory,
        {"esp": sp, "ebp": frame, "ecx": query},
        matrices=matrices,
        count=count,
        mode=mode,
        old=old,
        new=new,
        token_old=token_old,
        token_new=token_new,
    )
    m.acquire()
    assert not m.stack and m.memory[0] == 0x999 and m.registers["esp"] == sp
    ptr = m.memory[query + 0x44]
    p = m.memory[ptr + 0x8C]
    v = m.memory[ptr + 0x90]
    cache = dict(
        determinant=m.memory[ptr + 0x88],
        queryTag=m.memory[ptr + 0x94],
        localToWorld=[m.memory[ptr + 8 + k * 4] for k in range(16)],
        worldToLocal=[m.memory[ptr + 0x48 + k * 4] for k in range(16)],
        planes=[],
        vertices=[],
    )
    for i in range(count):
        r = dict(valid=m.memory[p + i * 24], queryTag=m.memory[p + i * 24 + 20])
        if p + i * 24 + 4 in m.memory:
            r["plane"] = [m.memory[p + i * 24 + 4 + k * 4] for k in range(4)]
        cache["planes"].append(r)
    for i in range(verts):
        r = dict(valid=m.memory[v + i * 16])
        if v + i * 16 + 4 in m.memory:
            r["point"] = [m.memory[v + i * 16 + 4 + k * 4] for k in range(3)]
        cache["vertices"].append(r)
    m.query_pointer = query
    if release:
        release_query(m)
    return cache, m


def release_query(m):
    # Actual normal query destructor with explicit supplied frame.
    end_sp = 0x980000
    m.memory[end_sp] = 0
    m.memory[end_sp - 12] = m.memory[0]
    m.memory[0] = end_sp - 12
    m.memory[end_sp - 16] = m.query_pointer
    m.registers.update(esp=end_sp - 16, ecx=m.query_pointer)
    m.run(0x106FE889)
    assert not m.stack and m.memory[0] == 0x999 and m.registers["esp"] == end_sp + 4


def query_fixtures(program):
    rng = random.Random(0x43414351)
    cases = []
    answers = []
    steps = 0
    visited = set()
    stats = dict(created=0, reused=0, replaced=0, hits=0, wrap=0)
    for j in range(600):
        a = fixture(rng, j) if j else simple_fixture()
        a["time"] = 1.0
        a["ownerStatic"] = bool((j // 4) % 2)
        old = copy.deepcopy(a["cache"])
        if j % 3 == 0:
            # Some authored old entries were computed while bStatic was set.
            # A later matrix refresh must not silently clear their validity.
            prior = a | dict(ownerStatic=True) if j % 8 == 1 else a
            prev, _ = native_tree(program, prior)
            old.update(planes=prev["planes"], vertices=prev["vertices"])
        if j % 19 == 0:
            old["queryTag"] = 0xFFFFFFFF
        mode = ["miss", "reuse", "wrong-owner", "wrong-mesh"][j % 4]
        owner_index = rng.getrandbits(32)
        mesh_index = rng.getrandbits(32)
        if j % 7 == 0:
            owner_index = mesh_index = 0xFFFFFFFF
        matrices = {
            key: copy.deepcopy(a["cache"][key])
            for key in ["localToWorld", "worldToLocal"]
        }
        if j % 9 == 0:
            matrices["localToWorld"][12] += 32.0
            matrices["worldToLocal"][12] -= 32.0 / matrices["localToWorld"][0]
        cache, m = native_acquire(
            program, a, mode, old, owner_index, mesh_index, matrices, release=False
        )
        new, tree = native_tree(program, a | dict(cache=cache))
        out = expected(new)
        cache.update(planes=out["planes"], vertices=out["vertices"])
        events = []
        for e in m.events:
            if e[0] == "matrixUpdate":
                events.append(["matrices"])
            elif e[0] in ["get", "create", "unlock", "flush"]:
                events.append(e)
        events += out["events"]
        release_query(m)
        events.append(m.events[-1])
        assert m.events[-1] == ["unlock"]
        if out["hit"]:
            hit, h = native_hit(
                program,
                dict(
                    start=a["start"],
                    end=a["end"],
                    normal=out["result"]["normal"],
                    time=out["result"]["time"],
                ),
            )
            out["result"].update(hit)
            steps += len(h.visited)
            visited.update(h.visited)
            stats["hits"] += 1
        disposition = (
            "created" if mode == "miss" else "reused" if mode == "reuse" else "replaced"
        )
        stats[disposition] += 1
        if cache["queryTag"] == 0:
            stats["wrap"] += 1
        wanted = dict(
            blocked=out["hit"],
            cacheDisposition=disposition,
            result=out["result"],
            cache=cache,
            events=events,
            visitedNodes=out["visitedNodes"],
            triangleTests=out["triangleTests"],
            objectFields=out["objectFields"],
        )
        cases.append(
            hexes(
                dict(
                    a=a,
                    mode=mode,
                    oldCache=old,
                    ownerIndex=owner_index,
                    meshIndex=mesh_index,
                    matrices=matrices,
                )
            )
        )
        answers.append(hexes(wanted))
        steps += len(m.visited) + len(tree.visited)
        visited.update(m.visited)
        visited.update(tree.visited)
    return cases, answers, dict(steps=steps, **stats), visited


def determinant_fixtures(program):
    rng = random.Random(0x44455443)
    cases = []
    expected = []
    steps = 0
    coverage = set()
    for j in range(1000):
        matrix = [f32(rng.uniform(-100, 100)) for _ in range(16)]
        if j % 11 == 0:
            matrix[8:12] = matrix[4:8]
        m, cache, _, _ = matrix_cache_machine(
            program, 0, 0, dict(localToWorld=matrix, worldToLocal=matrix)
        )
        m.until(0x106FEB51, 0x106FEBF3)
        cases.append(hexes(matrix))
        expected.append(word(m.memory[cache + 0x88]))
        steps += len(m.visited)
        coverage.update(m.visited)
    return cases, expected, steps, coverage


def verify(
    engine_path, core_path, comparison_engine_path, comparison_core_path, runtime_module
):
    program = CacheProgram(
        Image(Path(engine_path), ENGINE_SHA, True),
        Image(Path(core_path), CORE_SHA),
        PEImage(Path(comparison_engine_path), CANDIDATE_ENGINE_SHA),
        PEImage(Path(comparison_core_path), CANDIDATE_CORE_SHA),
    )
    cases, answers, stats, visited = query_fixtures(program)
    matrices, determinants, determinant_steps, determinant_coverage = (
        determinant_fixtures(program)
    )
    runtime_module = Path(runtime_module).resolve()
    for script, inputs, wanted, module in [
        (SCRIPT, cases, answers, runtime_module),
        (
            DETERMINANT_SCRIPT,
            matrices,
            determinants,
            runtime_module.with_name("actor-transforms.js"),
        ),
    ]:
        actual = browser_outputs(script, inputs, module)
        assert len(actual) == len(wanted)
        for i, (got, expected_value) in enumerate(zip(actual, wanted)):
            assert got == expected_value, (
                "original cache mismatch",
                module.name,
                i,
                inputs[i],
                got,
                expected_value,
            )
    runtime_names = [
        "static-mesh-cache.js",
        "static-mesh-tree.js",
        "static-hit.js",
        "static-triangle.js",
        "static-sweep.js",
        "actor-transforms.js",
    ]
    tool_names = [
        "check_static_mesh_cache_native.py",
        "static_mesh_cache_source.py",
        "static_mesh_cache_fixtures.py",
        "check_static_mesh_native.py",
        "static_mesh_source.py",
        "static_mesh_fixtures.py",
    ]
    paths = [
        (
            runtime_module
            if name == "static-mesh-cache.js"
            else runtime_module.with_name(name)
        )
        for name in runtime_names
    ]
    paths += [Path(__file__).with_name(name) for name in tool_names]
    return dict(
        tool="Elbera Tools",
        status="pass",
        cases=len(cases) + len(matrices),
        queryCases=len(cases),
        determinantCases=len(matrices),
        steps=stats.pop("steps") + determinant_steps,
        queryResults=stats,
        arithmeticProfile="pc53-rne-math-sqrt",
        source=program.receipt,
        coverage=[hex(at) for at in sorted(visited | determinant_coverage)],
        files={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
        limits=[
            "Authored geometry, matrices, identities and current cache state; no live actor or map placement claim.",
            "Native memory-cache responses and stable triangle counts are supplied; allocation, capacity, eviction and provider membership unported.",
            "Owner matrix method responses are supplied; the original matrix copy and determinant instructions execute.",
            "Normal SEH frames supplied and statistics-only gaps excluded; no complete native constructor or exception execution claim.",
            "Finite PC53/RNE with mathematical sqrt inherited from mesh checks; native CRT/FPU startup and other profiles unobserved.",
            "Unsupported-query cleanup is browser resource management, not original exception parity.",
            "Spatial actor admission, level integration and live walking remain unfinished.",
            "Supplemental correspondence does not authenticate its archive or repair the owned image.",
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
        default=ROOT / "editor/world/js/static-mesh-cache.js",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = verify(
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
                    key: result[key]
                    for key in [
                        "status",
                        "cases",
                        "queryCases",
                        "determinantCases",
                        "steps",
                        "queryResults",
                    ]
                }
                | {"addresses": len(result["coverage"])}
            )
        )
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
