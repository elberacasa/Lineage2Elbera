#!/usr/bin/env python3
"""Elbera Tools: bounded original current-coordinate terrain extent sweep.

Requires pinned owned Engine/Core, Capstone and Node. Reads original bytes;
never executes or emits DLLs. Optional explicit supplemental files qualify
specific import identities; they do not authenticate a distribution or restore
owned imports. Synthetic prepared Vertices values/current bitmaps separate
arithmetic from loaded-level/actor state. Binary64 approximates x87; sqrt and
finite signed-DWORD truncation are explicit mathematical boundaries.
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
from check_cast_scheduler_native import Arithmetic, f32
from check_bsp_camera_native import run_sweep_slice
from check_supplemental_engine import (
    compare_method,
    CANDIDATE_ENGINE_SHA,
    CANDIDATE_CORE_SHA,
    CORE_SHA,
)
from supplemental_pe import PEImage

ROOT = Path(__file__).resolve().parents[2]
EPS = 1e-8


def read(image, va, size):
    return bytes(image.data[image.offset(va) : image.offset(va) + size])


def vec(m, p):
    return [m.memory[p + 4 * i] for i in range(3)]


def put(m, p, v):
    m.memory.update({p + 4 * i: f32(x) for i, x in enumerate(v)})


RESULT_OFFSETS = tuple(range(0, 0x30, 4))
RESULT_FLOATS = (8, 12, 16, 20, 24, 28, 36)
RESULT_SEED = {offset: 1000 + offset for offset in RESULT_OFFSETS}


class ResultMemory(dict):
    """Observe actual interpreted writes to the caller's 48-byte hit record.

    Unique initial sentinels keep unchanged fields visible. Writes are logged
    even if they happen to store the value already present in memory.
    """

    def __init__(self, values, result):
        super().__init__(values)
        self.result = result
        self.writes = []
        self.recording = False

    def __setitem__(self, address, value):
        super().__setitem__(address, value)
        if self.recording and self.result <= address < self.result + 0x30:
            self.writes.append((address - self.result, value))

    def update(self, values):
        for address, value in values.items():
            self[address] = value


class TerrainArithmetic(Arithmetic):
    def read(self, operand):
        if operand == "cl":
            return self.registers["ecx"] & 255
        return super().read(operand)

    def write(self, operand, value, floating=False):
        if operand == "cl":
            self.registers["ecx"] = (self.registers["ecx"] & ~255) | (value & 255)
        else:
            super().write(operand, value, floating)


Arithmetic = TerrainArithmetic


class TerrainEvaluator:
    def __init__(self, engine, core):
        self.visited = set()
        self.engine = engine
        self.core = core
        self.code = {}

    def run(self, m, start, end, image=None, stops=()):
        image = image or self.engine
        before = m.image
        m.image = image
        pc = start
        key = (image.sha, start, end)
        if key not in self.code:
            rows = list(
                image.dis.disasm(
                    image.data[image.offset(start) : image.offset(end)], start
                )
            )
            cursor = start
            for row in rows:
                assert row.address == cursor
                cursor += row.size
            assert cursor == end
            self.code[key] = {i.address: i for i in rows}
        code = self.code[key]
        try:
            for _ in range(12000):
                if pc == end or pc in stops:
                    return pc
                i = code[pc]
                self.visited.add(pc)
                op = i.mnemonic
                args = i.op_str.split(", ")
                nxt = pc + i.size
                if pc in IMPORTS:
                    assert read(image, pc, 6) == b"\x90" * 6
                    helper = IMPORTS[pc][0]
                    a, b = CORE_RANGES[helper][1:]
                    m.registers["esp"] -= 4
                    m.memory[m.registers["esp"]] = 0xDEAD
                    self.run(m, a, b, self.core)
                    nxt = pc + 6
                elif op == "call":
                    target = int(args[0], 0)
                    sp = m.registers["esp"]
                    if hasattr(self, "cell_call") and self.cell_call(m, target, pc):
                        pass
                    elif target == 0x10308ABC:
                        out = m.memory[sp]
                        index = m.memory[sp + 4]
                        put(m, out, self.vertices[index])
                        m.registers["eax"] = out
                        m.registers["esp"] += 8
                    elif target == 0x10719D10:
                        saved = m.registers["esp"]
                        m.registers["esp"] -= 4
                        m.memory[m.registers["esp"]] = 0xDEAD
                        self.run(m, 0x10719D10, 0x10719DA4)
                        assert m.registers["esp"] == saved
                    elif target == 0x10306A05:
                        saved = m.registers["esp"]
                        m.registers["esp"] -= 4
                        m.memory[m.registers["esp"]] = 0xDEAD
                        self.run(m, 0x10585C00, 0x10585CD8)
                        assert m.registers["esp"] == saved
                    elif target == 0x10104840:
                        m.stack.insert(0, math.sqrt(m.memory[sp]))
                    elif target == 0x103058DF:
                        m.registers["esp"] -= 4
                        m.memory[m.registers["esp"]] = 0xDEAD
                        self.run(m, 0x10370480, 0x1037049C)
                    elif target == 0x10307743:
                        m.registers["esp"] -= 4
                        m.memory[m.registers["esp"]] = 0xDEAD
                        self.run(m, 0x103704B0, 0x103704E6)
                    elif target in (0x10101424, 0x10101DD4):
                        a, b = (
                            (0x1010F510, 0x1010F584)
                            if target == 0x10101424
                            else (0x1010F5B0, 0x1010F618)
                        )
                        m.registers["esp"] -= 4
                        m.memory[m.registers["esp"]] = 0xDEAD
                        self.run(m, a, b, self.core)
                    else:
                        raise AssertionError(("unboundcall", hex(pc), hex(target)))
                elif op == "fucompp":
                    a, b = m.stack[:2]
                    assert math.isfinite(a) and math.isfinite(b)
                    m.status = 0x4000 if a == b else 0x100 if a < b else 0
                    del m.stack[:2]
                elif op == "ret":
                    m.registers["esp"] += 4 + int(i.op_str or "0", 0)
                    return pc
                elif op == "pop":
                    m.write(args[0], m.memory[m.registers["esp"]])
                    m.registers["esp"] += 4
                elif op == "setle":
                    m.write(args[0], int(m.flags.get("s") or m.flags.get("z")))
                elif op == "fild":
                    m.stack.insert(0, float(m.read(args[0])))
                elif op == "imul":
                    m.write(args[0], m.read(args[0]) * m.read(args[1]))
                elif op in ("fdivp", "fdivrp"):
                    n = int(args[0][3:-1])
                    a, b = m.stack[n], m.stack[0]
                    m.stack[n] = a / b if op == "fdivp" else b / a
                    m.stack.pop(0)
                elif op.startswith("j"):
                    f = m.flags
                    take = {
                        "jmp": True,
                        "je": f.get("z"),
                        "jne": not f.get("z"),
                        "jp": f.get("p"),
                        "jnp": not f.get("p"),
                        "jg": not f.get("s") and not f.get("z"),
                        "jle": f.get("s") or f.get("z"),
                        "jns": not f.get("s"),
                        "jl": f.get("s"),
                        "jge": not f.get("s"),
                    }[op]
                    if take:
                        nxt = int(args[0], 0)
                else:
                    run_sweep_slice(image, m, pc, nxt, max_steps=2)
                pc = nxt
            raise AssertionError("boundedquadbudget")
        finally:
            m.image = before

    def quad(
        self,
        vertices,
        start,
        end,
        extent,
        edge=False,
        inverted=False,
        prior=None,
        record=None,
    ):
        self.vertices = vertices
        frame = 0x200000
        terrain = 0x300000
        result = 0x400000
        mem = {
            terrain + 0x210C: 2,
            terrain + 0x20E0: int(inverted),
            terrain + 0x3C: 0,
            frame + 0x3C: -1 if inverted else 1,
            frame - 0x30: int(edge),
            frame + 0x38: 0,
            frame - 0x50: 0,
            frame + 0x48: 0,
            frame + 0x4C: 0,
            frame + 0x50: result,
            frame + 0x78: 0,
            result + 4: 0,
        }
        m = Arithmetic(
            self.engine,
            mem,
            [],
            dict(
                ebp=frame,
                ebx=terrain,
                edi=0,
                esi=0,
                esp=frame - 0x400,
                eax=0,
                ecx=0,
                edx=0,
            ),
        )
        m.memory = ResultMemory(m.memory, result)
        m.memory.update(
            {result + offset: value for offset, value in RESULT_SEED.items()}
        )
        m.memory[result + 4] = 0
        if record is not None:
            m.memory.update(
                {result + offset: value for offset, value in record.items()}
            )
        for p, v in [
            (frame + 0x54, end),
            (frame + 0x60, start),
            (frame + 0x6C, extent),
        ]:
            put(m, p, v)
        if prior:
            m.memory[result + 4] = terrain
            put(m, result + 8, prior)
        m.memory.recording = True
        self.run(m, 0x10721111, 0x10722117, stops=(0x107210A0,))
        assert not m.stack, m.stack
        self.result_writes = m.memory.writes
        self.result_snapshot = {
            offset: m.memory[result + offset] for offset in RESULT_OFFSETS
        }
        if not m.memory[frame - 0x50]:
            return None
        return dict(
            point=vec(m, result + 8),
            normal=vec(m, result + 0x14),
            time=m.memory[result + 0x24],
        )


class CellEvaluator(TerrainEvaluator):
    def cell_call(self, m, target, pc):
        sp = m.registers["esp"]
        if target == 0x107A66A0:
            v = m.stack.pop(0)
            assert math.isfinite(v) and -0x80000000 <= math.trunc(v) <= 0x7FFFFFFF
            m.registers["eax"] = math.trunc(v)
            return True
        if target == 0x10307838:
            m.registers["esp"] -= 4
            m.memory[m.registers["esp"]] = 0xDEAD
            self.run(m, 0x10370460, 0x10370477)
            return True
        if target == 0x10301C17:
            x, y = m.memory[sp], m.memory[sp + 4]
            self.cells.append([x, y])
            m.registers["eax"] = int((x, y) in self.hits)
            m.registers["esp"] += 0x38
            return True
        return False


class ComposedEvaluator(CellEvaluator):
    def cell_call(self, m, target, pc):
        if target != 0x10301C17:
            return super().cell_call(m, target, pc)
        sp = m.registers["esp"]
        x, y = m.memory[sp], m.memory[sp + 4]
        self.cells.append([x, y])
        # Exact by-value call frame: x/y, result pointer, End, Start, Extent, flags,bypass.
        result = m.memory[sp + 8]
        end = vec(m, sp + 12)
        start = vec(m, sp + 24)
        extent = vec(m, sp + 36)
        assert m.memory[sp + 48] == 0 and m.memory[sp + 52] == 0
        prior = vec(m, result + 8) if m.memory[result + 4] else None
        out = None
        if self.visible[y * self.width + x]:
            ids = [
                y * self.width + x,
                y * self.width + x + 1,
                (y + 1) * self.width + x,
                (y + 1) * self.width + x + 1,
            ]
            out = self.q.quad(
                [self.grid[i] for i in ids],
                start,
                end,
                extent,
                self.edges[y * self.width + x],
                self.inverted,
                prior,
                record={offset: m.memory[result + offset] for offset in RESULT_OFFSETS},
            )
            # Apply precisely the actual interpreted quad writes, including
            # Material=NULL, rather than reconstructing a generic hit record.
            for offset, value in self.q.result_writes:
                m.memory[result + offset] = value
        if out:
            self.best = out
        m.registers["eax"] = int(out is not None)
        m.registers["esp"] += 0x38
        return True

    def sweep(
        self,
        grid,
        width,
        height,
        start,
        end,
        extent,
        inverse,
        edges,
        visible,
        inverted=False,
    ):
        self.cells = []
        self.grid = grid
        self.width = width
        self.edges = edges
        self.visible = visible
        self.inverted = inverted
        self.best = None
        self.q = TerrainEvaluator(self.engine, self.core)
        frame = 0x200000
        terrain = 0x300000
        result = 0x400000
        m = Arithmetic(
            self.engine,
            {
                terrain + 0x210C: width,
                terrain + 0x2110: height,
                frame + 0x50: result,
                frame + 8: 0,
                frame + 0x78: 0,
                frame + 0x7C: 0,
            },
            [],
            dict(
                ebp=frame,
                esi=terrain,
                ebx=0,
                edi=0,
                esp=frame - 0x400,
                eax=0,
                ecx=0,
                edx=0,
            ),
        )
        m.memory = ResultMemory(m.memory, result)
        m.memory.update(
            {result + offset: value for offset, value in RESULT_SEED.items()}
        )
        # Execute the exact Engine transform/direction prefix, including
        # retained Core implementations at the qualified erased-call sites.
        m.memory.update(
            {terrain + 0x215C + i * 4: f32(v) for i, v in enumerate(inverse)}
        )
        for p, v in [
            (frame + 0x54, end),
            (frame + 0x60, start),
            (frame + 0x6C, extent),
        ]:
            put(m, p, v)
        m.memory.recording = True
        self.run(m, 0x107226CB, 0x10722753)
        assert not m.stack
        # Nonzero extent takes the pinned no-sector-allocation branch.
        # FMemMark allocation/cleanup and GIsEditor are outside this evaluator.
        m.stack.insert(0, 0.0)
        stop = self.run(m, 0x107227DF, 0x107227FD, stops=(0x107228B5,))
        assert stop == 0x107228B5
        self.run(m, 0x107228B5, 0x107228BA)
        self.run(m, 0x107228BA, 0x10722ED8, stops=(0x10722973,))
        self.visited.update(self.q.visited)
        self.result_writes = m.memory.writes
        self.result_snapshot = {
            offset: m.memory[result + offset] for offset in RESULT_OFFSETS
        }
        return self.best, self.cells


# Symbols bind the retained Core implementations. Engine calls at IMPORTS are
# six NOPs in the owned image; their identities remain conditional unless the
# explicitly requested supplemental Engine comparison succeeds.
CORE_RANGES = {
    "equal": ("??8FVector@@QBEHABV0@@Z", 0x1010C740, 0x1010C77C),
    "safe": ("?SafeNormal@FVector@@QBE?AV1@XZ", 0x1014E070, 0x1014E0F9),
    "size": ("?Size@FVector@@QBEMXZ", 0x1010CA20, 0x1010CA53),
    "size2": ("?SizeSquared@FVector@@QBEMXZ", 0x1010CA60, 0x1010CA81),
    "normalize": ("?Normalize@FVector@@QAEHXZ", 0x1010CB20, 0x1010CB92),
    "point": (
        "?TransformPointBy@FVector@@QBE?AV1@ABVFCoords@@@Z",
        0x1010F640,
        0x1010F65A,
    ),
    "vector": (
        "?TransformVectorBy@FVector@@QBE?AV1@ABVFCoords@@@Z",
        0x1010F660,
        0x1010F67A,
    ),
}
IMPORTS = {
    site: (name, CORE_RANGES[name][0])
    for name, sites in {
        "equal": [0x107227EF],
        "size2": [0x10721400, 0x1072140F, 0x10721B33, 0x10721B42],
        "size": [0x10721897, 0x10721FE9],
        "normalize": [0x107217DA, 0x10721F2C],
        "safe": [0x10719D98, 0x1072273B],
        "point": [0x107226D9, 0x107226E7],
        "vector": [0x107226F5, 0x10721971, 0x107220D2],
    }.items()
    for site in sites
}
THUNKS = {
    0x10308ABC: (0x1071D430, 0x1071D3F0, "?Vertices@ATerrainInfo@@QAE?AVFVector@@H@Z"),
    0x10306A05: (0x10585C00, 0x10585BC0, None),
    # Unexecuted zero-extent sector optimization: correspondence of this call
    # target does not admit its body or the zero-extent path.
    0x1030124E: (0x107225A0, 0x10722560, None),
    0x10301C17: (
        0x10721040,
        0x10721000,
        "?LineCheckWithQuad@ATerrainInfo@@QAEHHHAAUFCheckResult@@VFVector@@11KH@Z",
    ),
}
BLOCKS = [
    (
        0x107227DF,
        0x107227FD,
        "898bbaf4beef22975b74ee6a18d44f20882a5522b960007e1f6994fcf9dfab5e",
        None,
    ),
    (
        0x10721040,
        0x10722117,
        "fd02cdebbf0f4fdd92e39090b0cf03f51e147f391313f7171ab0818102383ccd",
        (0x1082D380, 0x1082D340),
    ),
    (
        0x10719D10,
        0x10719DA4,
        "c15bd89fb4fd576a5855cd483add67cb5cacaa80c15d843c781d1d5c1587c169",
        None,
    ),
    (
        0x10585C00,
        0x10585CD8,
        "711a153525b6ad62e6a8ebb92cfeb8217c1093d13b1b1cebbfa05bd0ccb00b33",
        None,
    ),
    (
        0x1071D430,
        0x1071D4FB,
        "85ef2813d6743a5542140a556283104e15140b6155054c1a98086c75dce2ef9f",
        (0x1082D1D0, 0x1082D190),
    ),
    (
        0x107226CB,
        0x10722753,
        "aea5184bfbbca8489a825ea0642a66ddf13da517a0a158ea9ec933f782e86271",
        None,
    ),
    (
        0x107228BA,
        0x10722973,
        "f5199b65882aa270bfe11e2706632b3de104bf47df0dd94d0e880d16b89d3772",
        None,
    ),
    (
        0x107229B1,
        0x10722EE2,
        "e552075b9bf6f21b5a5b7d1a85097d1afbad1cf8ce70ee0324296aacdca4e6f2",
        None,
    ),
]


def source_evidence(engine, core, candidate=None, companion=None):
    evidence = []
    for thunk, (old, new, symbol) in THUNKS.items():
        raw = read(engine, thunk, 5)
        assert raw[0] == 0xE9 and thunk + 5 + struct.unpack("<i", raw[1:])[0] == old
        if symbol:
            assert engine.exported(symbol) == thunk
        if candidate:
            raw = candidate.read(thunk, 5)
            assert raw[0] == 0xE9 and thunk + 5 + struct.unpack("<i", raw[1:])[0] == new
            if symbol:
                assert candidate.exports[symbol] == thunk
    for site, (_, symbol) in IMPORTS.items():
        assert read(engine, site, 6) == b"\x90" * 6
        if candidate:
            assert candidate.imported_call(site - 0x40) == ("core.dll", symbol)
    for a, b, expected, handler in BLOCKS:
        old = read(engine, a, b - a)
        assert hashlib.sha256(old).hexdigest() == expected
        row = {"start": hex(a), "end": hex(b), "bytes": b - a, "sha256": expected}
        if candidate:
            new = bytearray(candidate.read(a - 0x40, b - a))
            paired = []
            if a == 0x1071D430:
                # Explicitly qualify each relocation. The third operand is
                # not named or given a runtime value by this comparison.
                for site, before, after, symbol in [
                    (0x1071D458, 0x11D8DC0C, 0x11D8DC08, "?GIsL2Seamless@@3HA"),
                    (0x1071D466, 0x11D8DBE4, 0x11D8DBE0, "?GIsEditor@@3HA"),
                    (0x1071D471, 0x10C51040, 0x10C51050, None),
                ]:
                    instruction = next(
                        engine.dis.disasm(candidate.read(site - 0x40, 15), site - 0x40)
                    )
                    offset = site - a
                    left = old[offset : offset + instruction.size]
                    right = bytes(instruction.bytes)
                    assert (
                        struct.pack("<I", before) in left
                        and struct.pack("<I", after) in right
                    )
                    assert (
                        right.replace(
                            struct.pack("<I", after), struct.pack("<I", before)
                        )
                        == left
                    )
                    if symbol:
                        assert candidate.imports[after] == ("core.dll", symbol)
                    new[offset : offset + instruction.size] = left
                    paired.append(
                        {
                            "site": hex(site),
                            "ownedOperand": hex(before),
                            "comparisonOperand": hex(after),
                            "symbol": symbol,
                        }
                    )

            def comparison_read(va, size):
                # These thunks have already been checked by exact named export
                # and destination in both images. Their corresponding bodies
                # above are compared separately; sector optimization excluded.
                return (
                    read(engine, va, size)
                    if va in THUNKS and size == 5
                    else candidate.read(va, size)
                )

            row["comparison"] = compare_method(
                old,
                bytes(new),
                a,
                a - 0x40,
                candidate.imported_call,
                lambda va, n: read(engine, va, n),
                comparison_read,
                handler,
            )
            row["pairedDataOperands"] = paired
            row["originalComparisonSHA256"] = hashlib.sha256(
                candidate.read(a - 0x40, b - a)
            ).hexdigest()
        evidence.append(row)
    core_bodies = []
    for name, (symbol, a, b) in CORE_RANGES.items():
        assert core.exported(symbol, True) == a
        raw = read(core, a, b - a)
        if companion:
            assert companion.body(symbol) == a and companion.read(a, b - a) == raw
        core_bodies.append(
            {
                "name": name,
                "symbol": symbol,
                "start": hex(a),
                "bytes": b - a,
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    for thunk, a, b in [
        (0x10101424, 0x1010F510, 0x1010F584),
        (0x10101DD4, 0x1010F5B0, 0x1010F618),
    ]:
        raw = read(core, thunk, 5)
        assert raw[0] == 0xE9 and thunk + 5 + struct.unpack("<i", raw[1:])[0] == a
        if companion:
            assert companion.read(thunk, 5) == raw and companion.read(a, b - a) == read(
                core, a, b - a
            )
        core_bodies.append(
            {
                "name": "coordinate-arithmetic",
                "start": hex(a),
                "bytes": b - a,
                "sha256": hashlib.sha256(read(core, a, b - a)).hexdigest(),
            }
        )
    for thunk, a in [
        (0x10307743, 0x103704B0),
        (0x10307838, 0x10370460),
        (0x103058DF, 0x10370480),
    ]:
        raw = read(engine, thunk, 5)
        assert raw[0] == 0xE9 and thunk + 5 + struct.unpack("<i", raw[1:])[0] == a
    assert struct.unpack("<d", read(core, 0x101CDF50, 8))[0] == EPS
    assert struct.unpack("<d", read(engine, 0x108E8B10, 8))[0] == f32(-0.0001)
    assert struct.unpack("<d", read(engine, 0x10859038, 8))[0] == 0.5
    anchors = [
        (0x10721073, "test", "byte ptr [ebx + 0x64], 0x80"),
        (0x10721077, "jne", "0x1072109e"),
        (0x107210B7, "cmp", "dword ptr [ebp + 0x7c], 0"),
        (0x107210CC, "test", "eax, eax"),
        (0x107210CE, "je", "0x1072109e"),
        (0x107227D9, "jne", "0x107228b7"),
        (0x107227F5, "test", "eax, eax"),
        (0x107227F7, "je", "0x107228b5"),
        (0x107228B5, "fldz", ""),
        (0x107228B7, "mov", "dword ptr [ebp + 8], ebx"),
        (0x107226A1, "cmp", "dword ptr [esi + 0x3c0], ebx"),
        (0x107226AD, "cmp", "dword ptr [esi + 0x2104], ebx"),
        (0x107226CB, "lea", "edi, [esi + 0x215c]"),
        (0x10722753, "test", "dword ptr [ebp + 0x78], 0x80000"),
        (0x107210DA, "mov", "eax, dword ptr [ebx + 0x20e0]"),
        (0x107210E0, "and", "al, 1"),
        (0x107210C7, "call", "0x1030fde4"),
        (0x107210F6, "call", "0x1030b2e9"),
        (0x107A66B2, "fstp", "qword ptr [esp]"),
        (0x107A66B5, "cvttsd2si", "eax, qword ptr [esp]"),
        (0x10722A18, "mov", "dword ptr [ecx + 4], ebx"),
        (0x10721880, "fst", "dword ptr [edi + 0x24]"),
        (0x107218BE, "fst", "dword ptr [edi + 0x24]"),
        (0x10721943, "mov", "dword ptr [edi + 0x2c], 0"),
        (0x1072194A, "mov", "dword ptr [edi + 4], ebx"),
        (0x10721FD2, "fst", "dword ptr [edi + 0x24]"),
        (0x10722010, "fst", "dword ptr [edi + 0x24]"),
        (0x107220A7, "mov", "dword ptr [edi + 0x2c], 0"),
        (0x107220AE, "mov", "dword ptr [edi + 4], ebx"),
    ]
    for a, op, args in anchors:
        engine.instruction(a, op, args)
    # The source bitmap getter identities are independently named. Their
    # current values are explicit prepared inputs, not inferred defaults.
    for thunk, suffix in [
        (0x1030FDE4, "GetQuadVisibilityBitmap"),
        (0x1030B2E9, "GetEdgeTurnBitmap"),
    ]:
        symbols = [
            name for name in engine.exports if name.startswith("?" + suffix + "@")
        ]
        assert len(symbols) == 1 and engine.exported(symbols[0]) == thunk
    return {
        "blocks": evidence,
        "coreBodies": core_bodies,
        "anchors": len(anchors),
        "importSites": len(IMPORTS),
        "bindingStatus": (
            "qualified-supplemental-correspondence"
            if candidate
            else "conditional-erased-import-identities"
        ),
    }


def differential_cases(count=100):
    rng = random.Random(64721)
    inverse = [0, 0, 0, 1 / 128, 0, 0, 0, 1 / 128, 0, 0, 0, 1]
    cases = []
    for n in range(count):
        w = h = 8
        grid = [
            [f32(x * 128), f32(y * 128), f32(rng.uniform(-80, 80))]
            for y in range(h)
            for x in range(w)
        ]
        edges = [bool(rng.randrange(2)) for _ in grid]
        visible = [bool(rng.randrange(4)) for _ in grid]
        start = [rng.uniform(-128, 900), rng.uniform(-128, 900), rng.uniform(100, 500)]
        end = [rng.uniform(-128, 900), rng.uniform(-128, 900), rng.uniform(-500, -100)]
        extent = [rng.uniform(0.1, 60), rng.uniform(0.1, 60), rng.uniform(0.1, 65)]
        inverted = n % 4 == 0
        if inverted:
            start, end = end, start
        if n < 4:
            grid = [
                [f32(x * 128), f32(y * 128), 0.0] for y in range(h) for x in range(w)
            ]
            start = [30, 30, 100]
            end = [30, 30, -100]
            visible = [True] * 64
            if inverted:
                start, end = end, start
        cases.append(
            {
                "source": dict(
                    width=w,
                    height=h,
                    vertices=grid,
                    inverseCoords=inverse,
                    visibility=visible,
                    edgeTurn=edges,
                    inverted=inverted,
                    deleteMe=False,
                    owner=None,
                    terrainMapPresent=True,
                ),
                "start": start,
                "end": end,
                "extent": extent,
            }
        )
    return cases


def runtime_comparison(engine, core, cases):
    evaluator = ComposedEvaluator(engine, core)
    expected = []
    bits = lambda x: struct.unpack("<I", struct.pack("<f", x))[0]
    for c in cases:
        s = c["source"]
        hit, cells = evaluator.sweep(
            s["vertices"],
            s["width"],
            s["height"],
            c["start"],
            c["end"],
            c["extent"],
            s["inverseCoords"],
            s["edgeTurn"],
            s["visibility"],
            s["inverted"],
        )
        offsets = {offset for offset, _ in evaluator.result_writes}
        entered = bool(evaluator.result_writes)
        if hit:
            assert offsets == {4, 8, 12, 16, 20, 24, 28, 36, 44}, offsets
            assert evaluator.result_snapshot[4] == 0x300000
            assert evaluator.result_snapshot[44] == 0
        elif entered:
            assert evaluator.result_writes == [(4, 0)], evaluator.result_writes
        else:
            assert evaluator.result_snapshot == RESULT_SEED
        # Next(+0), Item(+20 hex), node(+28 hex) are never written in this
        # admitted primitive path, including its successful triangle branches.
        for offset in (0, 0x20, 0x28):
            assert evaluator.result_snapshot[offset] == RESULT_SEED[offset]
        expected.append(
            {
                "cells": cells,
                "enteredTraversal": entered,
                "resultRecord": [
                    (
                        bits(evaluator.result_snapshot[offset])
                        if offset in RESULT_FLOATS
                        else evaluator.result_snapshot[offset]
                    )
                    for offset in RESULT_OFFSETS
                ],
                "hit": (
                    {
                        "point": list(map(bits, hit["point"])),
                        "normal": list(map(bits, hit["normal"])),
                        "time": bits(hit["time"]),
                    }
                    if hit
                    else None
                ),
            }
        )
    sources = []
    source_ids = {}
    wire_cases = []
    for case in cases:
        key = id(case["source"])
        if key not in source_ids:
            source_ids[key] = len(sources)
            sources.append(case["source"])
        wire_cases.append(
            {
                **{k: v for k, v in case.items() if k != "source"},
                "source": source_ids[key],
            }
        )
    script = """
import fs from 'node:fs';
import {prepareTerrainSweep,traceTerrainSweep} from './editor/world/js/terrain-collision.js';
const view=new DataView(new ArrayBuffer(4));
const bits=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true)};
const wire=JSON.parse(fs.readFileSync(0,'utf8'));
const sources=wire.sources.map(s=>{const r=prepareTerrainSweep(s);if(r.status!=='ready')throw Error(JSON.stringify(r));return r.model});
console.log(JSON.stringify(wire.cases.map(c=>{
 const r=traceTerrainSweep(sources[c.source],c.start,c.end,c.extent);
 if(r.status!=='ready')throw Error(JSON.stringify(r));
 const record=Array.from({length:12},(_,i)=>1000+4*i);
 if(r.enteredTraversal)record[1]=0;
 if(r.hit){record[1]=0x300000;record.splice(2,3,...r.hit.point);record.splice(5,3,...r.hit.normal);record[9]=r.hit.time;record[11]=0}
 const floatIndices=new Set([2,3,4,5,6,7,9]);
 return {cells:r.cells,enteredTraversal:r.enteredTraversal,
 resultRecord:record.map((v,i)=>floatIndices.has(i)?bits(v):v),
 hit:r.hit?{point:r.hit.point.map(bits),normal:r.hit.normal.map(bits),time:bits(r.hit.time)}:null};
})));
"""
    process = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        input=json.dumps({"sources": sources, "cases": wire_cases}),
        text=True,
        capture_output=True,
        check=True,
    )
    actual = json.loads(process.stdout)
    assert len(actual) == len(expected)
    for index, (wanted, got) in enumerate(zip(expected, actual)):
        assert wanted == got, {
            "case": index,
            "input": {k: v for k, v in cases[index].items() if k != "source"},
            "native": wanted,
            "runtime": got,
        }
    return {
        "cases": len(cases),
        "hits": sum(r["hit"] is not None for r in expected),
        "untouchedMisses": sum(not r["enteredTraversal"] for r in expected),
        "actorClearOnlyMisses": sum(
            r["enteredTraversal"] and not r["hit"] for r in expected
        ),
        "resultWrites": "actual interpreted stores; full 48-byte sentinel record compared",
        "retainedInstructionAddresses": len(evaluator.visited),
    }


def prepared_diagnostic_cases(path):
    """Queries source-generated geometry with explicitly supplied diagnostic actor state.

    No source identity/live-actor authority is inferred from a JSON filename.
    The producer verifier and the caller's admission remain separate checks.
    """
    raw = Path(path).read_bytes()
    source = json.loads(raw)
    assert source.get("format") == "elbera-original-terrain-collision-v1"
    assert (
        source.get("scope", {}).get("actorState") == "explicit-diagnostic-query-state"
    )
    assert source.get("owner", "unknown") is None and source.get("deleteMe") is False
    assert source.get("terrainMapPresent") is True
    assert source["width"] == source["height"] == 256
    assert len(source["vertices"]) == 65536
    rng = random.Random(0x722670)
    cases = []
    for _ in range(12):
        x, y = rng.randrange(1, 254), rng.randrange(1, 254)
        a, b, c, d = [
            source["vertices"][i]
            for i in [
                y * 256 + x,
                y * 256 + x + 1,
                (y + 1) * 256 + x,
                (y + 1) * 256 + x + 1,
            ]
        ]
        px = f32((a[0] + b[0] + c[0] + d[0]) / 4)
        py = f32((a[1] + b[1] + c[1] + d[1]) / 4)
        start = [px, py, f32(max(v[2] for v in [a, b, c, d]) + 200)]
        end = [px, py, f32(min(v[2] for v in [a, b, c, d]) - 200)]
        cases.append(
            {
                "source": source,
                "start": start,
                "end": end,
                "extent": [f32(0.1), f32(0.1), 5],
            }
        )
    return cases, {
        "inputSHA256": hashlib.sha256(raw).hexdigest(),
        "scope": "explicit diagnostic state; not live actor or world admission",
    }


def verify(comparison_engine=None, comparison_core=None, prepared_inputs=()):
    engine = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    core = Image(ROOT / "assets/interlude/system/Core.dll", CORE_SHA)
    candidate = (
        PEImage(Path(comparison_engine), CANDIDATE_ENGINE_SHA)
        if comparison_engine
        else None
    )
    companion = (
        PEImage(Path(comparison_core), CANDIDATE_CORE_SHA) if comparison_core else None
    )
    evidence = source_evidence(engine, core, candidate, companion)
    result = runtime_comparison(engine, core, differential_cases())
    diagnostics = []
    for path in prepared_inputs:
        cases, receipt = prepared_diagnostic_cases(path)
        receipt.update(runtime_comparison(engine, core, cases))
        diagnostics.append(receipt)
    return {
        "tool": "Elbera Tools",
        "engineSHA256": engine.sha,
        "coreSHA256": core.sha,
        "comparisonEngineSHA256": candidate.sha if candidate else None,
        "comparisonCoreSHA256": companion.sha if companion else None,
        "source": evidence,
        "runtime": result,
        "preparedDiagnostics": diagnostics,
        "limits": [
            "Prepared current Vertices values, current bitmaps and finite no-owner terrain state are caller inputs.",
            "No level/zone membership, actual runtime deletion/edit/loading state or aggregate world query is proved.",
            "Zero extent, alternate original coordinates, visibility bypass and material lookup are not admitted.",
            "Owned Engine import identities are conditional without explicit pinned supplemental correspondence.",
            "Supplemental comparison is not vendor authentication or restored protected imports.",
            "Binary64 approximates x87; sqrt and finite signed-DWORD conversion remain mathematical boundaries.",
            "No exception-unwind equivalence, arbitrary callbacks, world placement, walking or camera integration.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--comparison-engine", help="Explicit pinned supplemental Engine.dll"
    )
    parser.add_argument(
        "--comparison-core", help="Explicit pinned supplemental Core.dll"
    )
    parser.add_argument(
        "--prepared-input",
        action="append",
        default=[],
        help="Explicit source-exported diagnostic JSON; never a live-state claim",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = verify(args.comparison_engine, args.comparison_core, args.prepared_input)
    if args.check:
        print(
            f"Elbera Tools terrain PASS: {result['runtime']['cases']} actual-module cases, "
            f"{result['runtime']['retainedInstructionAddresses']} retained instructions, "
            f"{len(result['source']['blocks'])} source blocks; {result['source']['bindingStatus']}"
        )
        for row in result["preparedDiagnostics"]:
            print(
                f"Prepared terrain diagnostic PASS: {row['cases']} cases/{row['hits']} hits; {row['scope']}"
            )
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
