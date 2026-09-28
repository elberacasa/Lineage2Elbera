#!/usr/bin/env python3
"""Elbera Tools: original ordinary level hit ordering and result operations.

python3 tools/ui/check_level_collision_native.py --check
python3 tools/ui/check_level_collision_native.py --check --comparison-engine /local/engine.dll

Requires pinned private Engine/Core inputs, Capstone and Node. Never executes
or writes original binaries. Interprets bounded retained sort/shortening/filter
instructions against the actual browser module. Primitive hits and level/actor
identities are authored fixtures; this is not a whole-level collision proof.
Optional exact supplemental blocks qualify erased import correspondences, not
vendor authenticity or restoration of original imports. Float64 approximates
x87; original Float32 stores and signed zero are preserved.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import subprocess

from check_tutorial_quest_native import Image, ENGINE_SHA
from check_skillanim_native import CORE_SHA
from check_cast_scheduler_native import Arithmetic, f32
from check_bsp_camera_native import run_sweep_slice
from check_hair_attachment_native import compare_call_block, COMPARISON_SHA
from supplemental_pe import PEImage

ROOT = Path(__file__).resolve().parents[2]


def read(image, start, end):
    return bytes(image.data[image.offset(start) : image.offset(end)])


def bits(value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


def S32(value):
    return (int(value) & 0x7FFFFFFF) - (int(value) & 0x80000000)


def U32(value):
    return int(value) & 0xFFFFFFFF


class SortMachine(Arithmetic):
    """Integer/byte interpreter restricted to the pinned Core sort and swap bodies.
    The only external call is the actual retained Engine hit comparator.
    """

    def __init__(self, engine, core, values):
        self.engine = engine
        super().__init__(
            core,
            {},
            [],
            dict.fromkeys(["eax", "ebx", "ecx", "edx", "esi", "edi", "ebp"], 0),
        )
        self.registers["esp"] = 0x400000
        self.bytes = {}
        self.calls = 0
        self.put(0x400000, 0xDEADBEEF)
        self.put(0x400004, 0x200000)
        self.put(0x400008, len(values))
        self.put(0x40000C, 48)
        self.put(0x400010, 0x10310947)
        for index, value in enumerate(values):
            p = 0x200000 + index * 48
            for off in range(48):
                self.bytes[p + off] = 0
            self.put(p, index)
            self.put(p + 0x24, bits(value))

    def put(self, addr, value, width=4):
        for i, v in enumerate(int(value).to_bytes(width, "little", signed=False)):
            self.bytes[addr + i] = v

    def get(self, addr, width=4):
        return int.from_bytes(
            bytes(self.bytes[addr + i] for i in range(width)), "little"
        )

    def address(self, arg):
        return U32(super().address(arg))

    def read(self, arg):
        if "[" in arg:
            return self.get(self.address(arg), 1 if arg.startswith("byte") else 4)
        if arg in ["al", "bl", "cl", "dl"]:
            return self.registers["e" + arg[0] + "x"] & 255
        return U32(self.registers[arg] if arg in self.registers else int(arg, 0))

    def write(self, arg, value, **kwargs):
        value = U32(value)
        if "[" in arg:
            self.put(
                self.address(arg),
                value & (255 if arg.startswith("byte") else 0xFFFFFFFF),
                1 if arg.startswith("byte") else 4,
            )
        elif arg in ["al", "bl", "cl", "dl"]:
            reg = "e" + arg[0] + "x"
            self.registers[reg] = (self.registers[reg] & 0xFFFFFF00) | (value & 255)
        else:
            self.registers[arg] = value

    def compare(self, a, b):
        self.flags = {"z": a == b, "s": S32(a) < S32(b), "c": U32(a) < U32(b)}

    def execute(self, ins):
        pc = 0x1017E4D0
        for _ in range(300000):
            if pc == 0xDEADBEEF:
                return
            row = ins[pc]
            self.trace.append(pc)
            op, args = row.mnemonic, row.op_str.split(", ")
            nxt = pc + row.size
            if op in ("mov", "movzx", "lea"):
                self.write(
                    args[0],
                    self.address(args[1]) if op == "lea" else self.read(args[1]),
                )
            elif op == "push":
                value = self.read(args[0])
                self.registers["esp"] -= 4
                self.put(self.registers["esp"], value)
            elif op == "pop":
                self.write(args[0], self.get(self.registers["esp"]))
                self.registers["esp"] += 4
            elif op in ("add", "sub", "xor", "imul", "shr"):
                a, b = map(self.read, args)
                v = (
                    a + b
                    if op == "add"
                    else (
                        a - b
                        if op == "sub"
                        else a ^ b if op == "xor" else a * b if op == "imul" else a >> b
                    )
                )
                self.write(args[0], v)
                self.compare(U32(v), 0)
            elif op == "div":
                assert self.registers["edx"] == 0
                d = self.read(args[0])
                q, r = divmod(self.registers["eax"], d)
                self.registers.update(eax=q, edx=r)
            elif op == "cmp":
                self.compare(*map(self.read, args))
            elif op == "test":
                a, b = map(self.read, args)
                self.compare(a & b, 0)
            elif op.startswith("j"):
                z, s, c = [self.flags[k] for k in ["z", "s", "c"]]
                take = {
                    "jmp": True,
                    "je": z,
                    "jne": not z,
                    "jb": c,
                    "jbe": c or z,
                    "ja": not c and not z,
                    "jae": not c,
                    "jl": s,
                    "jle": s or z,
                    "jg": not s and not z,
                    "js": s,
                }[op]
                if take:
                    nxt = int(args[0], 0)
            elif op == "call":
                target = self.read(args[0])
                if target == 0x10310947:
                    sp = self.registers["esp"]
                    a, b = self.get(sp), self.get(sp + 4)
                    times = [
                        struct.unpack("<f", self.get(p + 0x24).to_bytes(4, "little"))[0]
                        for p in [a, b]
                    ]
                    m = Arithmetic(
                        self.engine,
                        {sp + 4: a, sp + 8: b, a + 0x24: times[0], b + 0x24: times[1]},
                        [],
                        {"esp": sp, "eax": 0},
                    )
                    run_sweep_slice(
                        self.engine,
                        m,
                        0x105BCE50,
                        0x105BCE83,
                        stop=(0x105BCE6A, 0x105BCE7F, 0x105BCE82),
                    )
                    for register in ("eax", "ecx", "edx"):
                        self.registers[register] = U32(m.registers[register])
                    self.calls += 1
                else:
                    assert target in [0x1017E440, 0x1017E410]
                    self.registers["esp"] -= 4
                    self.put(self.registers["esp"], nxt)
                    nxt = target
            elif op == "ret":
                nxt = self.get(self.registers["esp"])
                self.registers["esp"] += 4
            else:
                raise AssertionError(str(row))
            pc = nxt
        raise AssertionError("bounded sort exhausted")


def sort_source(engine, core, values, instructions):
    m = SortMachine(engine, core, values)
    m.execute(instructions)
    assert m.registers["esp"] == 0x400004
    return {
        "order": [m.get(0x200000 + i * 48) for i in range(len(values))],
        "instructions": len(set(m.trace)),
        "comparisons": m.calls,
    }


def native_size(core, m):
    addr = m.registers["ecx"]
    sp = 0x500000
    size = Arithmetic(
        core,
        {addr + i * 4: m.memory[addr + i * 4] for i in range(3)},
        [],
        {"ecx": addr, "esp": sp},
    )
    run_sweep_slice(core, size, 0x1010CA20, 0x1010CA3F)
    squared = size.memory[size.registers["esp"]]
    assert math.isfinite(squared) and squared >= 0 and not size.stack
    size.stack.insert(0, math.sqrt(squared))
    run_sweep_slice(core, size, 0x1010CA44, 0x1010CA4F)
    m.stack.insert(0, size.stack[0])
    return f32(size.stack[0])


def native_shorten(engine, core, case, path):
    frame, sp = 0x100000, 0x300000
    memory = {frame + 0x58 + i * 4: x for i, x in enumerate(case["start"])}
    memory.update({frame + 0x4C + i * 4: x for i, x in enumerate(case["originalEnd"])})
    memory.update({frame - 0x1C + i * 4: x for i, x in enumerate(case["originalEnd"])})
    memory.update(
        {frame - 0xD78 + i * 4: x for i, x in enumerate(case["hit"]["point"])}
    )
    memory[frame - 0xD5C] = case["hit"]["time"]
    memory[frame + 0x28] = case["scale"]
    m = Arithmetic(
        engine,
        memory,
        [],
        {
            "ebp": frame,
            "esp": sp,
            "esi": frame - 0xD5C if path == "terrain" else 0,
            "ebx": frame - 0xD78,
        },
    )
    if path == "terrain":
        lo, stop, back, end = 0x105C6372, 0x105C63B4, 0x105C63BA, 0x105C6493
    elif path == "adjacent":
        lo, stop, back, end = 0x105C60CF, 0x105C6117, 0x105C611D, 0x105C6208
    else:
        lo, stop, back, end = 0x105C5EB1, 0x105C5EF6, 0x105C5EFC, 0x105C5FE5
    run_sweep_slice(engine, m, lo, stop)
    distance = native_size(core, m)

    def call(m, target):
        assert target == 0x10303DDC
        m.registers["esp"] -= 4
        m.memory[m.registers["esp"]] = 0
        run_sweep_slice(
            engine, m, 0x104A4970, 0x104A4997, stop=(0x104A498B, 0x104A4996)
        )
        m.registers["esp"] += 4

    run_sweep_slice(engine, m, back, end, on_call=call, max_steps=1000)
    assert m.registers["esp"] == sp and not m.stack
    return {
        "distance": bits(distance),
        "time": bits(m.memory[frame - 0xD5C]),
        "scale": bits(m.memory[frame + 0x28]),
        "end": [bits(m.memory[frame + 0x4C + i * 4]) for i in range(3)],
    }


def native_single(engine, case):
    frame, level, levels, hitbase = 0x100000, 0x200000, 0x300000, 0x400000
    current = case["currentLevel"]
    adj = case["adjacentLevels"]
    hits = case["hits"]
    memory = {
        frame + 0x18: case["flags"],
        level + 0x11B0: levels,
        level + 0x11B4: len(adj),
    }
    infos = {level: current["identity"]}
    for index, info in enumerate([current, *adj]):
        p = level if index == 0 else 0x500000 + index * 0x100
        model, nodes, surfaces = (
            0x600000 + index * 0x10000,
            0x600800 + index * 0x10000,
            0x604000 + index * 0x10000,
        )
        infos[p] = info["identity"]
        memory[p + 0xC0] = model
        memory[model + 0x64] = nodes
        memory[model + 0xA4] = surfaces
        if index:
            memory[levels + (index - 1) * 4] = p
        for i, node in enumerate(info["model"]["nodes"]):
            memory[nodes + i * 120 + 0x1C] = node["surface"]
        for i, surface in enumerate(info["model"]["surfaces"]):
            memory[surfaces + i * 68 + 4] = surface["flags"]
    for index, hit in enumerate(hits):
        p = hitbase + index * 48
        memory[p] = p + 48 if index + 1 < len(hits) else 0
        memory[p + 4] = hit["actor"]
        memory[p + 0x28] = hit["nodeIndex"]
        memory[hit["actor"] + 0x2E4] = hit["actorFlags2e4"]
    m = Arithmetic(
        engine,
        memory,
        [],
        {"esp": 0x700000, "ebp": frame, "edi": level, "ebx": hitbase if hits else 0},
    )
    code = {
        i.address: i
        for i in engine.dis.disasm(read(engine, 0x105C2E56, 0x105C2F53), 0x105C2E56)
    }
    pc = 0x105C2E56
    for _ in range(10000):
        if pc == 0x105C2F4F:
            return (m.registers["ebx"] - hitbase) // 48 if m.registers["ebx"] else None
        if pc == 0x105C2F61:
            return None
        row = code[pc]
        op, args = row.mnemonic, row.op_str.split(", ")
        nxt = pc + row.size
        m.trace.append(pc)
        if op in ["mov", "lea"]:
            m.write(args[0], m.address(args[1]) if op == "lea" else m.read(args[1]))
        elif op == "call":
            assert args == ["0x1030c491"]
            m.registers["eax"] = infos[m.registers["ecx"]]
        elif op in ["add", "sub", "shl", "xor"]:
            a, b = (0, 0) if op == "xor" and args[0] == args[1] else map(m.read, args)
            v = (
                a + b
                if op == "add"
                else a - b if op == "sub" else a << b if op == "shl" else a ^ b
            )
            m.write(args[0], v)
            m.compare(v, 0)
        elif op == "cmp":
            m.compare(*map(m.read, args))
        elif op == "test":
            a, b = map(m.read, args)
            m.compare(a & b, 0)
        elif op in ["je", "jne", "jge", "jmp"]:
            z, s = m.flags.get("z"), m.flags.get("s")
            take = {"je": z, "jne": not z, "jge": not s, "jmp": True}[op]
            if take:
                nxt = int(args[0], 0)
        else:
            raise AssertionError(str(row))
        pc = nxt
    raise AssertionError("single filter did not terminate")


def verify_bindings(engine, core, comparison_path):
    ranges = [
        (
            engine,
            0x105C2DDA,
            0x105C2F70,
            "be18e0dd6f3903219bf7de6177235181064d2d79f43c600945028a2f3f998dee",
        ),
        (
            engine,
            0x105C5E28,
            0x105C672C,
            "8c072f8d873634c986684267da7d3998c0ca1cd491b7535a7bcedae444ec4ec1",
        ),
        (
            engine,
            0x105BCE50,
            0x105BCE83,
            "8734730755f43a5b52702fea7d0becfe331e06609b0423f0b2e0043db562a0f2",
        ),
        (
            core,
            0x1017E410,
            0x1017E777,
            "aa53e0186ff16d4317203ed1397f0ab6531572de5dbc1cd58d2b83b6715e3d8c",
        ),
        (
            core,
            0x1010CA20,
            0x1010CA50,
            "eff8ee1827b63fe97f8c8a9a07d298a63207f2cbad5dbd5fd16679671df42110",
        ),
        (
            engine,
            0x104A4970,
            0x104A4997,
            "8bf476fbbb8052854e6df97c1661b69dcfde985ea669d3e1ead40f5da676fdc1",
        ),
    ]
    for image, start, end, digest in ranges:
        assert hashlib.sha256(read(image, start, end)).hexdigest() == digest
    assert core.exported("?appQsort@@YAXPAXHHP6AHPBX1@Z@Z", True) == 0x1012DDC0
    core.instruction(0x1012DDC0, "jmp", "0x1017e4d0")
    assert core.exported("?Size@FVector@@QBEMXZ", True) == 0x1010CA20
    core.instruction(0x1010CA3F, "call", "0x10104840")
    assert core.exported("?appSqrt@@YANN@Z") == 0x10104840
    core.instruction(0x10104840, "jmp", "0x1012d790")
    core.instruction(0x1012D790, "fld", "qword ptr [esp + 4]")
    core.instruction(0x1012D794, "jmp", "0x1017cb60")
    anchors = [
        (0x10310947, "jmp", "0x105bce50"),
        (0x10303DDC, "jmp", "0x104a4970"),
        (0x1030C491, "jmp", "0x103778d0"),
        (0x103778D3, "mov", "eax, dword ptr [esi + 0x38]"),
        (0x103778FC, "mov", "eax, dword ptr [edx]"),
        (0x105C2DDD, "or", "ebx, 0x400"),
        (0x105C2E4C, "mov", "edx, dword ptr [edx + 0xf4]"),
        (0x105C2E9C, "test", "byte ptr [eax + edx*4 + 4], 0x80"),
        (0x105C2F27, "mov", "eax, dword ptr [ebx + 4]"),
        (0x105C2F2A, "test", "byte ptr [eax + 0x2e4], 2"),
        (0x105C2F33, "test", "dword ptr [ebp + 0x18], 0x100"),
        (0x105C2F5D, "rep movsd", "dword ptr es:[edi], dword ptr [esi]"),
        (0x105C2F66, "fstp", "dword ptr [eax + 0x24]"),
        (0x105C2F69, "mov", "dword ptr [eax + 4], 0"),
        (0x105C5E2B, "and", "eax, 4"),
        (0x105C5E48, "mov", "ecx, dword ptr [eax + 0xc0]"),
        (0x105C5EA1, "call", "edx"),
        (0x105C6008, "mov", "eax, dword ptr [eax + 0x11b4]"),
        (0x105C6227, "test", "dword ptr [ebp + 0x74], 0x200"),
        (0x105C6242, "test", "dword ptr [ebp + 0x74], 0x100"),
        (0x105C6252, "cmp", "esi, 0x40"),
        (0x105C626F, "test", "byte ptr [eax + 0x3d8], 4"),
        (0x105C62F6, "call", "0x10301fff"),
        (0x105C6338, "call", "0x10306b6d"),
        (0x105C6343, "cmp", "eax, dword ptr [ebp + 0x30]"),
        (0x105C6348, "cmp", "eax, dword ptr [ebp + 0x70]"),
        (0x105C64BF, "test", "dword ptr [ebp + 0x74], 0x200"),
        (0x105C64D1, "test", "dword ptr [ebp + 0x74], 0x4009b"),
        (0x105C653E, "mov", "edx, dword ptr [edx + 0x10]"),
        (0x105C6550, "cmp", "dword ptr [ebp + 0x2c], 0x40"),
        (0x105C655B, "fstp", "dword ptr [eax + 0x24]"),
        (0x105C6642, "cmp", "dword ptr [ebp + 0x2c], 0x40"),
        (0x105C66A8, "push", "0x10310947"),
        (0x105C66AD, "push", "0x30"),
        (0x105C671C, "mov", "dword ptr [ebx], eax"),
        (0x10522342, "mov", "dword ptr [eax + 0x2c], 0"),
    ]
    for address, mnemonic, operands in anchors:
        engine.instruction(address, mnemonic, operands)
    for address, value in [
        (0x10891850, 5.0),
        (0x1089F9A8, 20.0),
        (0x108A8A50, f32(0.0001)),
    ]:
        assert struct.unpack_from("<d", engine.data, engine.offset(address))[0] == value
    candidate = PEImage(comparison_path, COMPARISON_SHA) if comparison_path else None
    blocks = []
    for label, start, end, site, symbol in [
        (
            "primary BSP shortening",
            0x105C5EAB,
            0x105C5FEC,
            0x105C5EF6,
            "?Size@FVector@@QBEMXZ",
        ),
        (
            "adjacent BSP shortening",
            0x105C60C8,
            0x105C620C,
            0x105C6117,
            "?Size@FVector@@QBEMXZ",
        ),
        (
            "terrain shortening",
            0x105C6351,
            0x105C6497,
            0x105C63B4,
            "?Size@FVector@@QBEMXZ",
        ),
        (
            "sort dispatch",
            0x105C66A8,
            0x105C66BD,
            0x105C66B7,
            "?appQsort@@YAXPAXHHP6AHPBX1@Z@Z",
        ),
    ]:
        raw = read(engine, start, end)
        assert read(engine, site, site + 6) == b"\x90" * 6
        row = {
            "label": label,
            "range": [hex(start), hex(end)],
            "ownedSHA256": hashlib.sha256(raw).hexdigest(),
            "binding": "unresolved in owned image",
            "compatibleCoreSymbol": symbol,
        }
        if candidate:
            direct = [
                i.address - start
                for i in engine.dis.disasm(raw, start)
                if i.mnemonic == "call" and bytes(i.bytes)[:1] == b"\xe8"
            ]
            row.update(
                compare_call_block(
                    raw,
                    candidate.read(start - 0x40, end - start),
                    owned_va=start,
                    candidate_va=start - 0x40,
                    sites=[(site - start, ("core.dll", symbol))],
                    direct_calls=direct,
                    imports=candidate.imports,
                )
            )
            row["binding"] = "exact qualified supplemental correspondence"
        blocks.append(row)
    return {
        "engineSHA256": ENGINE_SHA,
        "coreSHA256": CORE_SHA,
        "comparisonEngineSHA256": COMPARISON_SHA if candidate else None,
        "instructionAnchors": len(anchors) + 7,
        "ranges": [
            {
                "image": "engine.dll" if image is engine else "core.dll",
                "start": hex(a),
                "end": hex(b),
                "sha256": sha,
            }
            for image, a, b, sha in ranges
        ],
        "blocks": blocks,
    }


def run_javascript(code, cases):
    process = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=ROOT,
        input=json.dumps(cases, allow_nan=False),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(process.stdout)


def verify(comparison_path=None):
    engine = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    core = Image(ROOT / "assets/interlude/system/core.dll", CORE_SHA)
    result = verify_bindings(engine, core, comparison_path)
    rng = random.Random(0x5C66B7)
    sorts = [[], [1.0], [1.0] * 2, [1.0] * 8, [1.0] * 9, [1.0] * 64]
    sorts += [[float(i) for i in range(n)] for n in [7, 8, 9, 16, 63, 64]]
    sorts += [[float(i) for i in range(n - 1, -1, -1)] for n in [7, 8, 9, 16, 63, 64]]
    sorts += [
        [f32(rng.randrange(-5, 6) / 5) for _ in range(rng.randrange(65))]
        for _ in range(120)
    ]
    instructions = {
        i.address: i
        for i in core.dis.disasm(read(core, 0x1017E410, 0x1017E777), 0x1017E410)
    }
    expected = [sort_source(engine, core, values, instructions) for values in sorts]
    actual = run_javascript(
        """
import fs from 'node:fs';
import {orderLevelHits} from './editor/world/js/level-collision.js';
console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(c => {
  const result = orderLevelHits(c.map((time,id) => ({time,id})));
  if (result.status !== 'ready') throw Error(JSON.stringify(result));
  return result.hits.map(x => x.id);
})));
""",
        sorts,
    )
    assert actual == [x["order"] for x in expected]
    result["sort"] = {
        "cases": len(sorts),
        "comparisons": sum(x["comparisons"] for x in expected),
        "maxDistinctInstructions": max(x["instructions"] for x in expected),
    }
    rng = random.Random(0x5C6372)
    cases, expected = [], []
    for path in ["primary", "adjacent", "terrain"]:
        for _ in range(128):
            case = {
                "start": [f32(rng.uniform(-300000, 300000)) for _ in range(3)],
                "originalEnd": [f32(rng.uniform(-300000, 300000)) for _ in range(3)],
                "hit": {
                    "point": [f32(rng.uniform(-300000, 300000)) for _ in range(3)],
                    "time": f32(rng.uniform(0, 1)),
                },
                "scale": 1.0 if path == "primary" else f32(rng.uniform(0, 1)),
                "kind": "terrain" if path == "terrain" else "bsp",
            }
            cases.append(case)
            expected.append(native_shorten(engine, core, case, path))
        for time in [0.0, -0.0, 1.0, 0.5]:
            case = {
                "start": [0.0, -0.0, 0.0],
                "originalEnd": [0.0, 0.0, 0.0],
                "hit": {"point": [0.0, 0.0, -0.0], "time": time},
                "scale": 1.0,
                "kind": "terrain" if path == "terrain" else "bsp",
            }
            cases.append(case)
            expected.append(native_shorten(engine, core, case, path))
    # Transport all floating inputs/outputs as bits; JSON numeric zero has no sign.
    encoded = [
        {
            **c,
            "start": list(map(bits, c["start"])),
            "originalEnd": list(map(bits, c["originalEnd"])),
            "hit": {
                "point": list(map(bits, c["hit"]["point"])),
                "time": bits(c["hit"]["time"]),
            },
            "scale": bits(c["scale"]),
        }
        for c in cases
    ]
    actual = run_javascript(
        """
import fs from 'node:fs';
import {shortenLevelTrace} from './editor/world/js/level-collision.js';
const v = new DataView(new ArrayBuffer(4));
const bits = x => {v.setFloat32(0,x,true); return v.getUint32(0,true)};
const from = x => {v.setUint32(0,x,true); return v.getFloat32(0,true)};
console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(c => {
  const r = shortenLevelTrace({...c, start:c.start.map(from), originalEnd:c.originalEnd.map(from),
    hit:{point:c.hit.point.map(from),time:from(c.hit.time)}, scale:from(c.scale)});
  if (r.status !== 'ready') throw Error(JSON.stringify(r));
  return {distance:bits(r.distance),time:bits(r.time),scale:bits(r.scale),end:r.end.map(bits)};
})));
""",
        encoded,
    )
    assert actual == expected
    result["shortening"] = {
        "cases": len(cases),
        "comparison": "all result Float32 bits including signed zero",
    }
    rng = random.Random(0x5C2E56)
    cases, expected = [], []
    for _ in range(500):
        levels = [
            {
                "identity": 0x800000 + i * 0x1000,
                "model": {
                    "nodes": [{"surface": 0}, {"surface": 1}],
                    "surfaces": [{"flags": 0}, {"flags": 0x80}],
                },
            }
            for i in range(3)
        ]
        actors = {level["identity"]: rng.randrange(2) * 2 for level in levels}
        actors.update({0x810000: 0, 0x820000: 2})
        case = {
            "flags": 0x400 | rng.choice([0, 0x100]),
            "currentLevel": levels[0],
            "adjacentLevels": levels[1 : 1 + rng.randrange(3)],
            "hits": [
                {
                    "actor": actor,
                    "actorFlags2e4": actors[actor],
                    "time": f32(i * 0.1),
                    "nodeIndex": rng.randrange(2),
                    "id": i,
                }
                for i, actor in enumerate(rng.choices(list(actors), k=rng.randrange(9)))
            ],
        }
        cases.append(case)
        expected.append(native_single(engine, case))
    actual = run_javascript(
        """
import fs from 'node:fs';
import {selectSingleLevelHit} from './editor/world/js/level-collision.js';
console.log(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(c => {
  const result = selectSingleLevelHit(c);
  if (result.status !== 'ready') throw Error(JSON.stringify(result));
  return result.hit?.id ?? null;
})));
""",
        cases,
    )
    assert actual == expected
    result["singleFiltering"] = {
        "cases": len(cases),
        "accepted": sum(x is not None for x in expected),
    }
    result["limits"] = [
        "authored primitive hit/identity fixtures, not a native client run or live world sweep",
        "live MultiLineCheck participant/provider admission and gameplay integration remain unresolved; a separate collector checks explicit callbacks",
        "sort is the pinned retained Core implementation, not a generic stable language sort",
        "shortening models finite Float64 intermediates and original Float32 stores; sqrt is a mathematical boundary",
        "filter requires actual Model node/surface identity and raw Actor+0x2e4 flags; raw bit has no inferred property name",
        "owned erased import targets are unresolved unless explicit supplemental correspondence is supplied",
    ]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", required=True)
    parser.add_argument("--comparison-engine", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.comparison_engine), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
