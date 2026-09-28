#!/usr/bin/env python3
"""Elbera Tools: original ordinary level-query collector and scratch contract.

python3 tools/ui/check_level_query_native.py --check
python3 tools/ui/check_level_query_native.py --check --comparison-engine /local/engine.dll

Reads pinned private Engine/Core binaries without executing or writing them.
Runs retained collector control/arithmetic and the existing Core sort evaluator
against the actual browser module. Primitive, region and actor-hash callbacks
are explicit synthetic source results, not a live-world or primitive proof.
Owned-only mode leaves erased import identities conditional; a pinned optional
supplemental image qualifies finite correspondence, not import restoration or
vendor authenticity. Float64 approximates x87 with explicit Float32 stores.
No native payloads or local receipts are emitted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct
import subprocess

from check_level_collision_native import (
    Image,
    ENGINE_SHA,
    CORE_SHA,
    Arithmetic,
    read,
    bits,
    SortMachine,
    run_sweep_slice,
    native_size,
    verify_bindings,
)
from check_hair_attachment_native import compare_call_block, COMPARISON_SHA
from supplemental_pe import PEImage

ROOT = Path(__file__).resolve().parents[2]

NAMED_EXPORTS = {
    "?MultiLineCheck@ULevel@@UAEPAUFCheckResult@@AAVFMemStack@@VFVector@@11PAVALevelInfo@@KPAVAActor@@@Z": (
        0x1030BB36,
        0x105C5920,
    ),
    "?GetZoneActor@ULevel@@QAEPAVAZoneInfo@@H@Z": (0x10301D3E, 0x10377910),
    "?GetLevelInfo@ULevel@@QAEPAVALevelInfo@@XZ": (0x1030C491, 0x103778D0),
    "?PointRegion@UModel@@QBE?AUFPointRegion@@PAVAZoneInfo@@VFVector@@@Z": (
        0x10306B6D,
        0x10746950,
    ),
    "?LineCheck@UModel@@UAEHAAUFCheckResult@@PAVAActor@@VFVector@@22KK@Z": (
        0x10301636,
        0x10749210,
    ),
    "?LineCheck@ATerrainInfo@@QAEHAAUFCheckResult@@VFVector@@11KH@Z": (
        0x10301FFF,
        0x10722670,
    ),
    "?ActorLineCheck@FCollisionHash@@UAEPAUFCheckResult@@AAVFMemStack@@VFVector@@11KKPAVAActor@@@Z": (
        0x103025BD,
        0x10523900,
    ),
    "?ActorLineCheck@FCollisionOctree@@UAEPAUFCheckResult@@AAVFMemStack@@VFVector@@11KKPAVAActor@@@Z": (
        0x10309F89,
        0x106009A0,
    ),
}

SOURCE_RANGES = [
    (
        "multi-composition",
        0x105C5E07,
        0x105C672C,
        "e22ae2225ea9fac2a514c2e736b53ed2f67a0ef624a9acae9c0e4f90f89d8fec",
    ),
    (
        "material-only-ctor",
        0x10522340,
        0x1052234A,
        "53b9a66f1424860213c0cf72c9332a7ce30898addf4d65a7882a26482d7a76ff",
    ),
    (
        "get-zone",
        0x10377910,
        0x10377950,
        "0fb402440aaeed77401cc4872d7ab6491b56e819b9f87c871cc6da3d76b0729f",
    ),
    (
        "point-region-normal",
        0x1074699B,
        0x10746A7D,
        "00b29327bbb470525ed183e141aad59b812f0fa2da59e2ff427459ba9971e3aa",
    ),
    (
        "point-region-child-outside",
        0x10685790,
        0x106857D5,
        "7915cda3ee1a360dd1703103d57692c3c82ebfb24f3af29d0b87a89198e0f57a",
    ),
    (
        "bsp-nonzero-wrapper",
        0x107496B0,
        0x107498DF,
        "5c26c4a71a29a9ef444d42d9f36aa5917d844ed4a720de095a3b1d92a07b0818",
    ),
    (
        "bsp-adoption",
        0x10748E10,
        0x10748E85,
        "980b731cb4bb0f8b1823cbc5b3164985384f24759af28d36dc7bc4dfcae73264",
    ),
    (
        "terrain-outer",
        0x10722670,
        0x10722EE2,
        "23b956d9aa374f946036b7b696cf2698cbe10706b338fb690558b4ad331ea857",
    ),
    (
        "terrain-quad",
        0x10721040,
        0x10722117,
        "fd02cdebbf0f4fdd92e39090b0cf03f51e147f391313f7171ab0818102383ccd",
    ),
]

SOURCE_ANCHORS = [
    (0x105C5957, "push", "0x10305fbf"),
    (0x105C595C, "push", "0x40"),
    (0x105C595E, "push", "0x30"),
    (0x10522342, "mov", "dword ptr [eax + 0x2c], 0"),
    (0x105C5E2B, "and", "eax, 4"),
    (0x105C5E37, "mov", "esi, dword ptr [ebp + 0x70]"),
    (0x105C5E42, "mov", "eax, dword ptr [esi + 0xe4]"),
    (0x105C5E48, "mov", "ecx, dword ptr [eax + 0xc0]"),
    (0x105C5E95, "push", "0"),
    (0x105C5EA1, "call", "edx"),
    (0x105C5EAB, "mov", "dword ptr [ebp - 0xd7c], esi"),
    (0x105C6008, "mov", "eax, dword ptr [eax + 0x11b4]"),
    (0x105C6023, "mov", "edx, dword ptr [ecx + 0x11b0]"),
    (0x105C6037, "mov", "ecx, dword ptr [eax + 0xc0]"),
    (0x105C60A2, "call", "edx"),
    (0x105C60C3, "call", "0x1030c491"),
    (0x105C60C8, "mov", "dword ptr [ebp + esi - 0xd7c], eax"),
    (0x105C6227, "test", "dword ptr [ebp + 0x74], 0x200"),
    (0x105C6242, "test", "dword ptr [ebp + 0x74], 0x100"),
    (0x105C6252, "cmp", "esi, 0x40"),
    (0x105C625F, "call", "0x10301d3e"),
    (0x105C626F, "test", "byte ptr [eax + 0x3d8], 4"),
    (0x105C6281, "mov", "edx, dword ptr [eax + 0x3e0]"),
    (0x105C6296, "mov", "ecx, dword ptr [eax + 0x3dc]"),
    (0x105C62F6, "call", "0x10301fff"),
    (0x105C6322, "call", "0x1030c491"),
    (0x105C6332, "mov", "ecx, dword ptr [eax + 0xc0]"),
    (0x105C6338, "call", "0x10306b6d"),
    (0x105C6343, "cmp", "eax, dword ptr [ebp + 0x30]"),
    (0x105C6348, "cmp", "eax, dword ptr [ebp + 0x70]"),
    (0x105C6364, "mov", "dword ptr [ebp + esi - 0xd7c], eax"),
    (0x105C6493, "add", "dword ptr [ebp + 0x2c], 1"),
    (0x105C64BF, "test", "dword ptr [ebp + 0x74], 0x200"),
    (0x105C64D1, "test", "dword ptr [ebp + 0x74], 0x4009b"),
    (0x105C64E1, "mov", "ecx, dword ptr [eax + 0x120]"),
    (0x105C64F5, "push", "0"),
    (0x105C653E, "mov", "edx, dword ptr [edx + 0x10]"),
    (0x105C6541, "call", "edx"),
    (0x105C6550, "cmp", "dword ptr [ebp + 0x2c], 0x40"),
    (0x105C655B, "fstp", "dword ptr [eax + 0x24]"),
    (0x105C6575, "rep movsd", "dword ptr es:[edi], dword ptr [esi]"),
    (0x105C657D, "mov", "eax, dword ptr [eax]"),
    (0x105C65CE, "mov", "ecx, dword ptr [eax + 0x120]"),
    (0x105C6636, "call", "eax"),
    (0x105C6642, "cmp", "dword ptr [ebp + 0x2c], 0x40"),
    (0x105C664D, "fstp", "dword ptr [eax + 0x24]"),
    (0x105C667E, "add", "edx, 1"),
    (0x105C66A8, "push", "0x10310947"),
    (0x105C66BD, "push", "8"),
    (0x105C66C1, "push", "0x30"),
    (0x105C66C3, "call", "0x1030a54c"),
    (0x105C6700, "rep movsd", "dword ptr es:[edi], dword ptr [esi]"),
    (0x105C670D, "mov", "dword ptr [ebx], eax"),
    (0x105C671C, "mov", "dword ptr [ebx], eax"),
    (0x1037791D, "lea", "eax, [eax + eax*2 + 0x27]"),
    (0x10377921, "mov", "eax, dword ptr [ecx + eax*8]"),
    (0x1037794A, "mov", "eax, dword ptr [eax]"),
    (0x1074699E, "mov", "dword ptr [eax], edi"),
    (0x107469A0, "mov", "dword ptr [eax + 4], 0xffffffff"),
    (0x107469A7, "mov", "byte ptr [eax + 8], bl"),
    (0x107469AA, "cmp", "dword ptr [esi + 0x68], ebx"),
    (0x107469EA, "fstp", "dword ptr [ebp - 0x14]"),
    (0x107469FD, "mov", "edi, 1"),
    (0x10746A15, "mov", "ebx, dword ptr [esi + edi*4 + 0x20]"),
    (0x10746A2E, "mov", "ebx, dword ptr [edx + ebx*4 + 0x58]"),
    (0x10746A32, "mov", "dword ptr [eax + 4], ebx"),
    (0x10746A35, "cmp", "dword ptr [esi + 0x134], 0"),
    (0x10746A48, "movzx", "ecx, byte ptr [edx + edi + 0x54]"),
    (0x10746A5D, "mov", "esi, dword ptr [esi + ecx*8]"),
    (0x10746A64, "mov", "esi, dword ptr [ebp + 0xc]"),
    (0x10749248, "cmp", "dword ptr [ebx + 0x68], esi"),
    (0x107498D4, "mov", "eax, dword ptr [ebx + 0x124]"),
    (0x107496B9, "fstp", "dword ptr [esi + 0x24]"),
    (0x10748E4F, "fstp", "dword ptr [eax + 0x24]"),
    (0x10748E6E, "mov", "dword ptr [edx + 4], eax"),
    (0x10748E76, "mov", "dword ptr [ecx + 0x20], edx"),
    (0x1074982E, "mov", "dword ptr [esi + 8], ecx"),
    (0x10749853, "fld1", ""),
    (0x107226A7, "je", "0x10722ed8"),
    (0x107226B3, "je", "0x10722ed8"),
    (0x10722A18, "mov", "dword ptr [ecx + 4], ebx"),
    (0x107217E3, "mov", "dword ptr [edi + 8], ecx"),
    (0x107217F2, "lea", "esi, [edi + 0x14]"),
    (0x10721880, "fst", "dword ptr [edi + 0x24]"),
    (0x107218BE, "fst", "dword ptr [edi + 0x24]"),
    (0x10721917, "mov", "dword ptr [edi + 8], ecx"),
    (0x10721943, "mov", "dword ptr [edi + 0x2c], 0"),
    (0x1072194A, "mov", "dword ptr [edi + 4], ebx"),
    (0x10721951, "je", "0x10721987"),
    (0x10721F35, "mov", "dword ptr [edi + 8], edx"),
    (0x10721F44, "lea", "esi, [edi + 0x14]"),
    (0x10721FD2, "fst", "dword ptr [edi + 0x24]"),
    (0x10722010, "fst", "dword ptr [edi + 0x24]"),
    (0x10722075, "mov", "dword ptr [edi + 8], edx"),
    (0x107220A7, "mov", "dword ptr [edi + 0x2c], 0"),
    (0x107220AE, "mov", "dword ptr [edi + 4], ebx"),
    (0x107220B5, "je", "0x107220e8"),
]


def verify_composition_bindings(engine, comparison_path=None):
    for symbol, (stub, body) in NAMED_EXPORTS.items():
        assert engine.exported(symbol) == stub
        assert engine.exported(symbol, True) == body
    ranges = []
    for name, start, end, expected in SOURCE_RANGES:
        raw = read(engine, start, end)
        assert hashlib.sha256(raw).hexdigest() == expected, name
        cursor = start
        for row in engine.dis.disasm(raw, start):
            assert row.address == cursor
            cursor += row.size
        assert cursor == end, (name, hex(cursor), hex(end))
        ranges.append(
            dict(
                name=name,
                start=hex(start),
                end=hex(end),
                bytes=end - start,
                sha256=expected,
            )
        )
    for address, opcode, operands in SOURCE_ANCHORS:
        engine.instruction(address, opcode, operands)
    assert struct.unpack_from("<f", engine.data, engine.offset(0x1085222C))[0] == 0
    candidate = PEImage(comparison_path, COMPARISON_SHA) if comparison_path else None
    globals_ = []
    for start, end, operand in [
        (0x105C5FF1, 0x105C6016, 2),
        (0x105C6596, 0x105C65BA, 1),
    ]:
        raw = read(engine, start, end)
        assert raw[operand : operand + 4] == struct.pack("<I", 0x11D8DC0C)
        row = dict(
            start=hex(start),
            end=hex(end),
            bytes=end - start,
            ownedSHA256=hashlib.sha256(raw).hexdigest(),
            ownedIAT="0x11d8dc0c",
            binding="unresolved in owned image",
        )
        if candidate:
            assert candidate.imports[0x11D8DC08] == ("core.dll", "?GIsL2Seamless@@3HA")
            other = bytearray(candidate.read(start - 0x40, end - start))
            assert other[operand : operand + 4] == struct.pack("<I", 0x11D8DC08)
            other[operand : operand + 4] = raw[operand : operand + 4]
            assert bytes(other) == raw
            row.update(
                binding="exact qualified supplemental correspondence",
                symbol="Core.GIsL2Seamless",
                normalization="only independently named IAT data operand; all remaining bytes exact",
            )
        globals_.append(row)
    region = {
        "binding": "owned retained normal body; no supplemental comparison requested"
    }
    if candidate:
        region.update(
            compare_call_block(
                read(engine, 0x1074699B, 0x10746A7D),
                candidate.read(0x1074695B, 0xE2),
                owned_va=0x1074699B,
                candidate_va=0x1074695B,
                sites=[],
                direct_calls=[0x10746A0C - 0x1074699B],
                imports=candidate.imports,
            )
        )
        region["binding"] = "exact qualified supplemental correspondence"
    return {
        "namedExports": len(NAMED_EXPORTS),
        "instructionAnchors": len(SOURCE_ANCHORS),
        "ranges": ranges,
        "attachedLevelGateBlocks": globals_,
        "pointRegionNormalBlock": region,
    }


def verify_scratch_writes(engine):
    """Execute the retained constructor/adoption slices with known and unknown fields.

    The collector fixture initializes only Material in each of 64 slots, as the
    source header's constructor/count/stride arguments establish. This is not a
    claim to interpret the compiler-generated array-constructor helper itself.
    """
    cases = []
    for sparse in (True, False):
        result, state = 0x200000, 0x100000
        initial = {result + 0x2C: 0}
        if not sparse:
            initial.update({result + i: 900 + i for i in range(0, 48, 4)})
        m = Arithmetic(engine, dict(initial), [], {"ecx": result})
        run_sweep_slice(engine, m, 0x10522340, 0x10522349)
        assert m.memory == {**initial, result + 0x2C: 0}
        cases.append(
            {"case": "scratch-constructor", "sparse": sparse, "writes": ["material=0"]}
        )
        for enter, leave, adopted in [
            (0.25, 0.75, True),
            (0.75, 0.25, False),
            (1.25, 1.5, True),
            (-1.0, -0.5, False),
        ]:
            mem = {
                **initial,
                state: result,
                state + 4: 1234,
                state + 8: 0,
                state + 0x88: enter,
                state + 0x8C: leave,
                state + 0x5FC: 0,
            }
            mem.update({state + 0x60: 1.0, state + 0x64: 0.0, state + 0x68: -0.0})
            m = Arithmetic(engine, mem, [], {"edi": state, "esp": 0x300000})
            run_sweep_slice(engine, m, 0x10748E10, 0x10748E85, stop=0x10748E9D)
            assert bool(m.memory[state + 0x5FC]) == adopted
            expected = dict(initial)
            if adopted:
                expected.update(
                    {
                        result + 4: 0,
                        result + 0x14: 1.0,
                        result + 0x18: 0.0,
                        result + 0x1C: -0.0,
                        result + 0x20: 1234,
                        result + 0x24: enter,
                    }
                )
            actual = {k: v for k, v in m.memory.items() if result <= k < result + 48}
            assert actual.keys() == expected.keys()
            for address, value in expected.items():
                if isinstance(value, float):
                    assert bits(actual[address]) == bits(value)
                else:
                    assert actual[address] == value
            cases.append(
                {
                    "case": "bsp-interval-adoption",
                    "sparse": sparse,
                    "enter": enter,
                    "exit": leave,
                    "adopted": adopted,
                    "presentFields": [hex(k - result) for k in sorted(actual)],
                }
            )

    return cases


F = 0x100000
SP = 0x900000
SLOT = F - 0xD80
FIELDS = {
    "actor": 4,
    "point": 8,
    "normal": 20,
    "item": 32,
    "time": 36,
    "nodeIndex": 40,
    "material": 44,
}


def f(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def write_record(mem, p, record):
    for key, value in record.items():
        assert key in FIELDS, f"unsupported native result field: {key}"
        offset = FIELDS[key]
        if key in ("point", "normal"):
            for i, x in enumerate(value):
                mem[p + offset + 4 * i] = f(x)
        else:
            mem[p + offset] = (
                f(value) if key == "time" else 0 if value is None else value
            )


def read_record(mem, p):
    out = {}
    for key, offset in FIELDS.items():
        if key in ("point", "normal"):
            if all(p + offset + i * 4 in mem for i in range(3)):
                out[key] = [mem[p + offset + i * 4] for i in range(3)]
        elif p + offset in mem:
            value = mem[p + offset]
            out[key] = None if key in ("actor", "material") and value == 0 else value
    return out


class Machine(Arithmetic):
    def read(self, arg):
        if arg == "al":
            return self.registers.get("eax", 0) & 255
        return super().read(arg)


def native(engine, core, case):
    """Retained collector through sort with explicit fixture callbacks.

    The callback adapter consumes exact native argument frames and models each
    callee's stack cleanup. It excludes SEH/performance counters, primitive
    discovery and final FMemStack allocation/Next construction. The hit-count
    domain is nonnegative and at most64; native world-slot overflow rejects.
    """
    levelptr = 0x200000
    levels = 0x300000
    gate = 0x310000
    callerptr = case["callerLevel"]["identity"] if case["callerLevel"] else 0
    mem = {
        F + 0x24: levelptr,
        F + 0x2C: 0,
        F + 0x48: 0x330000,
        F + 0x70: callerptr if case["callerLevel"] else 0,
        F + 0x74: case["flags"],
        F + 0x78: case["sourceActor"] or 0,
        0x11D8DC0C: gate,
        gate: int(case["attachedLevelsEnabled"]),
        F - 4: 0,
        levelptr + 0x11B0: levels,
        levelptr + 0x11B4: len(case["attachedLevels"]),
    }
    # Header's vector constructor initializes only Material in all 64 slots.
    for i in range(64):
        mem[SLOT + 48 * i + 44] = 0
    for field, offset in [("start", 0x58), ("end", 0x4C), ("extent", 0x64)]:
        mem.update({F + offset + i * 4: f(x) for i, x in enumerate(case[field])})
    objects = {levelptr: case["level"]}
    models = {}
    hashes = {}
    zones = {}
    terrains = {}
    modelvt = 0x400000
    hashvt = 0x400100
    mem[modelvt + 0x6C] = 0x700001
    mem[hashvt + 0x10] = 0x700002
    for index, level in enumerate([case["level"], *case["attachedLevels"]]):
        p = levelptr if index == 0 else 0x410000 + index * 0x2000
        if index:
            mem[levels + (index - 1) * 4] = p if level else 0
        if level is None:
            continue
        objects[p] = level
        mem[p + 0xC0] = level["model"] or 0
        mem[p + 0x120] = level["actorHash"] or 0
        if level["model"] is not None:
            models[level["model"]] = level["model"]
            mem[level["model"]] = modelvt
        if level["actorHash"] is not None:
            hashes[level["actorHash"]] = level["actorHash"]
            mem[level["actorHash"]] = hashvt
    if case["callerLevel"]:
        p = 0x450000
        mem[callerptr + 0xE4] = p
        mem[p + 0xC0] = case["callerLevel"]["model"]
        mem[case["callerLevel"]["model"]] = modelvt
    for index, zone in enumerate(case["level"]["zones"]):
        if zone is None:
            continue
        p = zone["identity"]
        zones[p] = zone
        arr = 0x500000 + index * 0x1000
        mem[p + 0x3D8] = zone["flags3d8"]
        mem[p + 0x3DC] = arr
        mem[p + 0x3E0] = len(zone.get("terrains", []))
        for i, t in enumerate(zone.get("terrains", [])):
            mem[arr + i * 4] = t
            terrains[t] = t
    m = Machine(
        engine,
        mem,
        [],
        {
            "ebp": F,
            "esp": SP,
            "edi": mem[F + 0x4C],
            "esi": levelptr,
            "eax": 0,
            "ebx": 0,
            "ecx": 0,
            "edx": 0,
        },
    )
    code = {
        i.address: i
        for i in engine.dis.disasm(read(engine, 0x105C5E0F, 0x105C66BD), 0x105C5E0F)
    }
    sortcode = {
        i.address: i
        for i in core.dis.disasm(read(core, 0x1017E410, 0x1017E777), 0x1017E410)
    }
    calls = []
    consumed = {}
    lastterrain = None
    allocated = 0

    def query(sp, offset=0):
        return {
            "end": [m.memory[sp + offset + i * 4] for i in range(3)],
            "start": [m.memory[sp + offset + 12 + i * 4] for i in range(3)],
            "extent": [m.memory[sp + offset + 24 + i * 4] for i in range(3)],
        }

    def answer(kind, participant):
        key = str(participant)
        available = case["responses"][kind][key]
        index = consumed.get((kind, key), 0)
        consumed[kind, key] = index + 1
        return available[min(index, len(available) - 1)]

    def call(pc, target):
        nonlocal lastterrain, allocated
        sp = m.registers["esp"]
        receiver = m.registers["ecx"]
        if target == 0x700001 or target == 0x10301FFF:
            terrain = target == 0x10301FFF
            kind = "terrain" if terrain else "bsp"
            resultptr = m.memory[sp]
            assert SLOT <= resultptr < SLOT + 64 * 48, "source world scratch overflow"
            q = query(sp, 4 if terrain else 8)
            q["flags"] = m.memory[sp + (40 if terrain else 48)]
            q.update(
                participant=receiver, initialResult=read_record(m.memory, resultptr)
            )
            q.update(
                {"visibilityBypass": bool(m.memory[sp + 44])}
                if terrain
                else {
                    "owner": None if m.memory[sp + 4] == 0 else m.memory[sp + 4],
                    "extraNodeFlags": m.memory[sp + 44],
                }
            )
            calls.append([kind, q])
            result = answer(kind, receiver)
            write_record(m.memory, resultptr, result["writes"])
            m.registers["eax"] = 0 if result["blocked"] else 1
            m.registers["esp"] += 48 if terrain else 52
            if terrain:
                lastterrain = result
        elif target == 0x1030C491:
            m.registers["eax"] = objects[receiver]["identity"]
        elif target == 0x10301D3E:
            z = case["level"]["zones"][m.memory[sp]]
            m.registers["eax"] = 0 if z is None else z["identity"]
            m.registers["esp"] += 4
        elif target == 0x10306B6D:
            point = [m.memory[sp + 8 + i * 4] for i in range(3)]
            calls.append(
                [
                    "region",
                    {
                        "model": receiver,
                        "point": point,
                        "defaultZone": m.memory[sp + 4],
                    },
                ]
            )
            m.memory[m.memory[sp]] = lastterrain["region"] or 0
            m.registers["esp"] += 20
        elif target == 0x700002:
            q = query(sp, 4)
            q.update(
                hash=receiver,
                flags=m.memory[sp + 40],
                extra=m.memory[sp + 44],
                sourceActor=m.memory[sp + 48] or None,
            )
            calls.append(["actorHash", q])
            result = answer("actorHash", receiver)
            base = 0x600000 + allocated * 0x10000
            allocated += 1
            for i, record in enumerate(result):
                p = base + i * 48
                write_record(m.memory, p, record)
                m.memory[p] = p + 48 if i + 1 < len(result) else 0
            m.registers["eax"] = base if result else 0
            m.registers["esp"] += 52
        elif target == 0x10303DDC:
            m.registers["esp"] -= 4
            m.memory[m.registers["esp"]] = 0
            run_sweep_slice(
                engine, m, 0x104A4970, 0x104A4997, stop=(0x104A498B, 0x104A4996)
            )
            m.registers["esp"] += 4
        else:
            raise AssertionError((hex(pc), hex(target)))

    pc = 0x105C5E0F
    for steps in range(60000):
        if pc == 0x105C66BD or pc == 0x105C672C:
            count = m.memory[F + 0x2C]
            records = [read_record(m.memory, SLOT + i * 48) for i in range(count)]
            if count:
                sorter = SortMachine(engine, core, [x["time"] for x in records])
                sorter.execute(sortcode)
                records = [records[sorter.get(0x200000 + i * 48)] for i in range(count)]
            assert m.registers["esp"] == SP - (16 if count else 0) and not m.stack, (
                pc,
                m.registers["esp"],
                m.stack,
            )
            return {
                "hits": records,
                "end": [m.memory[F + 0x4C + i * 4] for i in range(3)],
                "scale": m.memory[F + 0x28],
                "calls": calls,
                "visited": sorted(set(m.trace)),
            }
        if pc in (0x105C5EF6, 0x105C6117, 0x105C63B4):
            native_size(core, m)
            pc += 6
            continue
        if pc == 0x105C66B7:
            pc += 6
            continue  # Exact source Core sort executes at capture above.
        row = code[pc]
        op = row.mnemonic
        args = row.op_str.split(", ")
        nxt = pc + row.size
        m.trace.append(pc)
        if op in ("wait", "nop"):
            pass
        elif op == "call":
            call(pc, m.read(args[0]))
        elif op in ("je", "jne", "jge", "jae", "jmp"):
            z = m.flags.get("z")
            s = m.flags.get("s")
            take = {"je": z, "jne": not z, "jge": not s, "jae": not s, "jmp": True}[op]
            if take:
                nxt = int(args[0], 0)
        elif op == "rep movsd":
            for _ in range(m.registers["ecx"]):
                src, dst = m.registers["esi"], m.registers["edi"]
                if src in m.memory:
                    m.memory[dst] = m.memory[src]
                else:
                    m.memory.pop(dst, None)
                m.registers["esi"] += 4
                m.registers["edi"] += 4
            m.registers["ecx"] = 0
        else:
            run_sweep_slice(engine, m, pc, nxt, max_steps=2)
        pc = nxt
    raise AssertionError("collector did not terminate")


def fixture(seed):
    rng = random.Random(seed)
    zones = [None] * 64
    flags = rng.choice(
        [0, 1, 4, 5, 0x100, 0x104, 0x105, 0x204, 0x205, 0x405, 0x40000, 0x40005]
    )

    def level(i):
        return {
            "identity": 0x800000 + i * 0x1000,
            "model": 0x820000 + i * 0x1000,
            "actorHash": 0x840000 + i * 0x1000,
        }

    current = level(0)
    current["zones"] = zones
    caller = None if seed % 5 == 0 else level(3)
    attached = [level(i) if rng.random() > 0.3 else None for i in (1, 2)]
    responses = {"bsp": {}, "terrain": {}, "actorHash": {}}

    def result():
        out = {
            "blocked": rng.random() < 0.55,
            "writes": {
                "time": f(rng.choice([0.0, 0.2, 0.5, 1.0])),
                "point": [f(rng.uniform(-80, 80)) for _ in range(3)],
            },
        }
        if rng.random() < 0.7:
            out["writes"]["normal"] = [0.0, 0.0, 1.0]
        if rng.random() < 0.5:
            out["writes"]["item"] = seed
        return out

    for l in [current, *attached, caller]:
        if l is None:
            continue
        responses["bsp"][str(l["model"])] = [result()]
        responses["actorHash"][str(l["actorHash"])] = [
            [
                {
                    "actor": 0x900000 + seed * 0x100 + i,
                    "time": f(rng.choice([0.0, 0.2, 0.5, 1.0])),
                    "point": [1.0, 2.0, 3.0],
                    "normal": [0.0, 1.0, 0.0],
                    "material": None,
                }
                for i in range(rng.randrange(4))
            ]
        ]
    for i in rng.sample(range(64), 3):
        z = {
            "identity": 0xA00000 + i * 0x1000,
            "flags3d8": rng.choice([0, 4]),
            "terrains": [0xB00000 + i * 0x1000 + j for j in range(rng.randrange(3))],
        }
        zones[i] = z
        for t in z["terrains"]:
            r = result()
            r["region"] = rng.choice(
                [
                    z["identity"],
                    current["identity"],
                    caller["identity"] if caller else None,
                    0xC00000,
                ]
            )
            responses["terrain"][str(t)] = [r]
    return {
        "start": [17.0, -8.0, 3.0],
        "end": [-90.0, 42.0, -60.0],
        "extent": [1.0, 2.0, 3.0],
        "flags": flags,
        "sourceActor": None if seed % 2 else 0xD00000,
        "level": current,
        "callerLevel": caller,
        "attachedLevelsEnabled": bool(seed % 3),
        "attachedLevels": attached,
        "responses": responses,
    }


def adversarial():
    from copy import deepcopy

    c = fixture(7)
    c.update(flags=5, callerLevel=None, attachedLevelsEnabled=True)
    c["level"]["zones"] = [None] * 64
    c["responses"]["actorHash"][str(c["level"]["actorHash"])] = [
        [{"actor": 0x1000000 + i, "time": f(0.5), "item": i} for i in range(65)]
    ]
    c["attachedLevels"] = [{"identity": 0x810000, "model": None, "actorHash": 0x850000}]
    c["responses"]["actorHash"]["8716288"] = [[{"actor": 0x2000000, "time": f(0.1)}]]
    cases = [c]
    d = deepcopy(c)
    d["flags"] = 4
    d["attachedLevelsEnabled"] = False
    d["level"]["actorHash"] = None
    z = {"identity": 0xA00000, "flags3d8": 4, "terrains": [0xB00000, 0xB00001]}
    d["level"]["zones"][0] = z
    d["level"]["zones"][63] = z
    d["responses"]["terrain"] = {
        str(t): [
            {
                "blocked": True,
                "writes": {
                    "time": f(0.5),
                    "point": [f(50), -0.0, f(3)],
                    "normal": [-0.0, f(1), f(0)],
                    "item": 77,
                    "nodeIndex": 9,
                },
                "region": z["identity"],
            }
        ]
        for t in z["terrains"]
    }
    cases.append(d)
    e = deepcopy(d)
    e["level"]["zones"][63] = None
    e["callerLevel"] = {"identity": 0x801000, "model": 0x821000}
    e["responses"]["bsp"][str(e["callerLevel"]["model"])] = [
        {
            "blocked": False,
            "writes": {
                "time": f(1),
                "item": 123,
                "nodeIndex": 99,
                "material": 0xC00001,
            },
        }
    ]
    e["responses"]["terrain"][str(0xB00000)] = [
        {
            "blocked": True,
            "writes": {
                "time": f(0.2),
                "point": [f(20), f(3), f(4)],
                "normal": [f(1), -0.0, f(0)],
                "actor": 0xB00000,
            },
            "region": 0xC00000,
        }
    ]
    e["responses"]["terrain"][str(0xB00001)] = [
        {
            "blocked": True,
            "writes": {"time": f(0.5), "point": [f(50), f(3), f(4)]},
            "region": 0xA00000,
        }
    ]
    cases.append(e)
    for flag in [0x204, 0x205, 0x104, 0x105, 0x304, 0x305]:
        row = deepcopy(e)
        row["flags"] = flag
        cases.append(row)
    boundary = deepcopy(d)
    boundary["level"]["zones"][63] = None
    boundary["level"]["zones"][0]["terrains"] = [0xB00000] * 64
    cases.append(boundary)
    overflow = deepcopy(boundary)
    overflow["level"]["zones"][0]["terrains"].append(0xB00000)
    return cases, overflow


def canonical(value, key=""):
    if key in ("point", "normal", "end", "start", "extent"):
        return [bits(x) for x in value]
    if key in ("time", "scale"):
        return bits(value)
    if isinstance(value, list):
        return [canonical(x) for x in value]
    if isinstance(value, dict):
        return {k: canonical(v, k) for k, v in value.items()}
    return value


JS = """
import fs from 'node:fs';
import {collectLevelHits} from './editor/world/js/level-query.js';
const all=JSON.parse(fs.readFileSync(0,'utf8')).map(c=>{
 const calls=[],used=new Map();let last=null;
 const answer=(kind,id)=>{const k=kind+id;const i=used.get(k)||0;used.set(k,i+1);const a=c.responses[kind][id];return a[Math.min(i,a.length-1)];};
 const primitives={};
 for(const kind of ['bsp','terrain'])primitives[kind]=q=>{calls.push([kind,q]);const a=answer(kind,q.participant);last=a;return {status:'ready',...a};};
 primitives.region=q=>{calls.push(['region',q]);return {status:'ready',zone:last.region};};
 primitives.actorHash=q=>{calls.push(['actorHash',q]);return {status:'ready',hits:answer('actorHash',q.hash)};};
 const r=collectLevelHits({...c,primitives});return {...r,calls};
});
const bytes=new DataView(new ArrayBuffer(4));
const bits=x=>{bytes.setFloat32(0,x,true);return bytes.getUint32(0,true);};
const canonical=(v,k='')=>['point','normal','end','start','extent'].includes(k)?v.map(bits):['time','scale'].includes(k)?bits(v):Array.isArray(v)?v.map(x=>canonical(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,canonical(x,k)])):v;
console.log(JSON.stringify(canonical(all)));
"""


def verify(comparison_path=None):
    engine = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    core = Image(ROOT / "assets/interlude/system/core.dll", CORE_SHA)
    prerequisites = verify_bindings(engine, core, comparison_path)
    composition = verify_composition_bindings(engine, comparison_path)
    scratch = verify_scratch_writes(engine)
    extra, overflow = adversarial()
    cases = [fixture(i) for i in range(250)] + extra
    expected = [native(engine, core, c) for c in cases]
    process = subprocess.run(
        ["node", "--input-type=module", "-e", JS],
        cwd=ROOT,
        input=json.dumps(cases, allow_nan=False),
        text=True,
        capture_output=True,
        check=True,
    )
    actual = json.loads(process.stdout)
    assert len(actual) == len(expected)
    for index, (raw, result) in enumerate(zip(expected, actual)):
        reference = canonical(raw)
        assert result["status"] == "ready", (index, result)
        for key in ("hits", "end", "scale", "calls"):
            assert reference[key] == result[key], (
                index,
                key,
                reference[key],
                result[key],
            )
    try:
        native(engine, core, overflow)
    except AssertionError as error:
        assert str(error) == "source world scratch overflow"
    else:
        raise AssertionError("expected source out-of-bounds guard")
    process = subprocess.run(
        ["node", "--input-type=module", "-e", JS],
        cwd=ROOT,
        input=json.dumps([overflow], allow_nan=False),
        text=True,
        capture_output=True,
        check=True,
    )
    assert json.loads(process.stdout)[0]["status"] == "unsupported"
    return {
        "tool": "Elbera Tools ordinary level-query collector evidence",
        "status": "PASS",
        "engineSHA256": engine.sha,
        "coreSHA256": core.sha,
        "comparisonEngineSHA256": COMPARISON_SHA if comparison_path else None,
        "prerequisites": prerequisites,
        "composition": composition,
        "scratchCases": len(scratch),
        "collectorCases": len(cases),
        "worldOverflowGuards": 1,
        "hits": sum(len(x["hits"]) for x in expected),
        "callbackInvocations": sum(len(x["calls"]) for x in expected),
        "retainedCollectorInstructionsExercised": len(
            {p for x in expected for p in x["visited"]}
        ),
        "floatComparison": "exact stored Float32 bits including signed zero",
        "limits": [
            "Primitive, region and actor-provider calls use authored source-result fixtures; no live participant admission.",
            "Logical collector-through-sort records; allocation failure, heap addresses and final Next pointer construction are excluded.",
            "Unknown scratch fields remain unknown; array-constructor header is anchored and its field constructor executed in bounded cases.",
            "World scratch access beyond64 is unsupported; actor callbacks still execute after64 copied hits.",
            "Owned-only import identities remain conditional. Supplemental comparison is not original import restoration or distribution authentication.",
            "Float64 approximates x87; finite input arithmetic and explicit original Float32 stores only.",
            "No gameplay camera, walking, MoveActor or complete ordinary level collision adoption.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="print a concise check summary"
    )
    parser.add_argument(
        "--comparison-engine",
        type=Path,
        help="optional pinned supplemental Engine for qualified finite correspondences",
    )
    args = parser.parse_args()
    result = verify(args.comparison_engine)
    if args.check:
        print(
            json.dumps(
                {
                    key: result[key]
                    for key in (
                        "tool",
                        "status",
                        "comparisonEngineSHA256",
                        "collectorCases",
                        "scratchCases",
                        "worldOverflowGuards",
                        "hits",
                        "callbackInvocations",
                        "retainedCollectorInstructionsExercised",
                    )
                },
                indent=2,
            )
        )
    else:
        print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
