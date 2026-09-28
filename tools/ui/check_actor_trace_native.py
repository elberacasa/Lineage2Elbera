#!/usr/bin/env python3
"""Elbera Tools: ordinary actor/pawn ShouldTrace versus retained Interlude code.

Explicit current fields and named helper responses; no native DLL execution,
live actor population, loader emulation or private inputs at module import.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import random
import struct
import subprocess

from check_actor_blocking_native import BlockingMachine
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CANDIDATE_ENGINE_SHA
from supplemental_pe import PEImage
from check_hair_attachment_native import compare_call_block

ROOT = Path(__file__).resolve().parents[2]
ACTOR = "?ShouldTrace@AActor@@UAEHPAV1@K@Z"
PAWN = "?ShouldTrace@APawn@@UAEHPAVAActor@@K@Z"
CLASS = "?PrivateStaticClass@APawn@@0VUClass@@A"
LOADER = "?GL2ActorResourceLoader@@3VFNActorResourceLoader@@A"
FIELDS = {
    "levelIdentity": 0xE4,
    "bits74": 0x74,
    "flags64": 0x64,
    "flags2e4": 0x2E4,
    "collisionBits": 0x2F8,
    "primitive38": 0x38,
    "primitive104": 0x104,
    "drawTypeByte35": 0x35,
    "controllerIdentity": 0x14D8,
    "flags678": 0x678,
}
CALLS = {
    0x1052FEA4: ("getLevelInfo", 0),
    0x1052FEF7: ("isPawn", 4),
    0x1052FFCA: ("isBlockedBy", 4),
    0x106177A0: ("checkLoadingResource", 8),
    0x106177CB: ("isPawn", 4),
}


def instruction_rows(engine):
    rows = []
    for start, end in [(0x1052FE91, 0x1052FFEF), (0x10617740, 0x10617829)]:
        code = list(
            engine.dis.disasm(
                bytes(engine.data[engine.offset(start) : engine.offset(end)]), start
            )
        )
        assert code[0].address == start and code[-1].address + code[-1].size == end
        assert all(a.address + a.size == b.address for a, b in zip(code, code[1:]))
        rows.extend(code)
    return rows


def qualify_source(engine, comparison):
    candidate = PEImage(Path(comparison), CANDIDATE_ENGINE_SHA)
    for symbol, start, delta in [(ACTOR, 0x1052FE70, 0), (PAWN, 0x10617740, -64)]:
        assert engine.exported(symbol, True) == start
        assert candidate.body(symbol) == start + delta
        assert engine.exported(symbol) == candidate.exports[symbol]
    named_calls = {
        0x1030C491: "?GetLevelInfo@ULevel@@QAEPAVALevelInfo@@XZ",
        0x10308BDE: "?IsBlockedBy@AActor@@QBEHPBV1@@Z",
        0x1030D9D6: "?CheckLoadingResource@FNActorResourceLoader@@QAEHPAVAPawn@@H@Z",
    }
    for address, name in named_calls.items():
        assert engine.exported(name) == candidate.exports[name] == address
    comparisons = []
    for label, start, end, delta, imported in [
        ("AActor normal body", 0x1052FE91, 0x1052FFEF, 0, 0x1052FEF7),
        ("APawn complete body", 0x10617740, 0x10617829, -64, 0x106177CB),
    ]:
        raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        other_raw = candidate.read(start + delta, end - start)
        other = bytearray(other_raw)
        rows = list(engine.dis.disasm(raw, start))
        normal = []
        for i in rows:
            symbol = (
                CLASS
                if i.mnemonic == "push" and i.op_str == hex(engine.exported(CLASS))
                else (
                    LOADER
                    if i.mnemonic == "mov"
                    and i.op_str == "ecx, " + hex(engine.exported(LOADER))
                    else None
                )
            )
            if symbol:
                offset = i.address - start + 1
                assert (
                    struct.unpack_from("<I", other, offset)[0]
                    == candidate.exports[symbol]
                )
                struct.pack_into("<I", other, offset, engine.exported(symbol))
                normal.append(dict(address=hex(i.address), symbol=symbol))
        proof = compare_call_block(
            raw,
            bytes(other),
            owned_va=start,
            candidate_va=start + delta,
            sites=[(imported - start, ("core.dll", "?IsA@UObject@@QBEHPAVUClass@@@Z"))],
            direct_calls=[
                i.address - start
                for i in rows
                if i.mnemonic == "call" and i.bytes[0] == 0xE8
            ],
            imports=candidate.imports,
        )
        comparisons.append(
            dict(
                label=label,
                start=hex(start),
                endExclusive=hex(end),
                ownedSHA256=hashlib.sha256(raw).hexdigest(),
                candidateSHA256=hashlib.sha256(other_raw).hexdigest(),
                namedOperands=normal,
                comparison=proof,
            )
        )
    vtables = []
    for name, symbol in [
        ("AActor", ACTOR),
        ("AStaticMeshActor", ACTOR),
        ("APawn", PAWN),
        ("AVehicle", PAWN),
    ]:
        vt = f"??_7{name}@@6B@"
        assert engine.u32(engine.exported(vt) + 0x160) == engine.exported(symbol)
        assert candidate.u32(candidate.exports[vt] + 0x160) == candidate.exports[symbol]
        vtables.append(dict(table=vt, slot="0x160", method=symbol))
    # The sliced actor entry follows the checked ordinary SEH frame setup.
    anchors = [
        (0x1052FE71, "mov", "ebp, esp"),
        (0x1052FE88, "sub", "esp, 0xc"),
        (0x1052FE8B, "push", "ebx"),
        (0x1052FE8C, "push", "esi"),
        (0x1052FE8D, "push", "edi"),
        (0x1052FE8E, "mov", "dword ptr [ebp - 0x10], esp"),
    ]
    for row in anchors:
        engine.instruction(*row)
    return dict(
        ownedEngineSHA256=engine.sha,
        comparisonEngineSHA256=candidate.sha,
        comparisons=comparisons,
        vtables=vtables,
        frameAnchors=len(anchors),
        namedCalls={hex(k): v for k, v in named_calls.items()},
        limits=[
            "AActor SEH setup/handlers are not interpreted; its normal entry frame is supplied.",
            "Named class, level, blocking and resource-loader helper results remain explicit inputs.",
            "Supplemental correspondence does not authenticate the archive or restore erased imports.",
        ],
    )


class TraceMachine(BlockingMachine):
    def __init__(self, row, program):
        memory = {}
        for a in [row["actor"], row["source"]]:
            if a is not None:
                for name, offset in FIELDS.items():
                    if name in a:
                        memory[a["identity"] + offset] = a[name] or 0
        controller = row["actor"].get("controllerIdentity")
        if controller is not None:
            memory[controller + 0x41C] = row["controllerFlags"]
        frame = 0x9000
        if row["kind"] == "actor":
            # Normal generic entry: 24 local bytes plus three saved registers.
            memory.update(
                {
                    frame - 36: 0,
                    frame - 32: 0,
                    frame - 28: 0,
                    frame - 12: 0,
                    frame: 0,
                    frame + 4: 0,
                    frame + 8: (row["source"] or {}).get("identity", 0),
                    frame + 12: row["flags"],
                }
            )
            registers = {"esp": frame - 36, "ebp": frame}
        else:
            memory.update(
                {
                    frame: 0,
                    frame + 4: (row["source"] or {}).get("identity", 0),
                    frame + 8: row["flags"],
                }
            )
            registers = {"esp": frame}
        super().__init__(
            memory, registers | {"ecx": row["actor"]["identity"]}, {}, program
        )
        self.row = row

    def step(self, i):
        if i.address not in CALLS:
            return super().step(i)
        self.visited.append(i.address)
        name, size = CALLS[i.address]
        sp = self.registers["esp"]
        receiver = self.registers["ecx"]
        args = [receiver]
        if name == "isPawn":
            assert self.memory[sp] == 0x10DAF7D8
        elif name == "isBlockedBy":
            args += [self.memory[sp]]
        elif name == "checkLoadingResource":
            assert receiver == 0x10BDC620
            args = [self.memory[sp], self.memory[sp + 4]]
        self.calls.append([name, *args])
        answer = self.row["answers"][name]
        if isinstance(answer, dict):
            for write in answer["writes"]:
                target = self.row[write["target"]]["identity"]
                self.memory[target + FIELDS[write["field"]]] = write["value"] or 0
            answer = answer["value"]
        self.registers["eax"] = answer or 0
        self.registers["esp"] += size
        return i.address + (6 if name == "isPawn" else i.size)


def native_trace(row, program):
    machine = TraceMachine(row, program)
    machine.run(0x1052FE91 if row["kind"] == "actor" else 0x10617740)
    assert machine.registers["esp"] == (0x9010 if row["kind"] == "actor" else 0x900C)
    return dict(value=machine.registers["eax"], calls=machine.calls), machine.visited


SCRIPT = r"""
import fs from 'node:fs';
const api = await import(process.argv[1]);
const rows = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(rows.map(row => {
 const calls = [];
 const helpers = Object.fromEntries(['getLevelInfo','isPawn','isBlockedBy','checkLoadingResource'].map(name => [name,(...args) => {
  calls.push([name,...args]);
  let answer = row.answers[name];
  if (answer !== null && typeof answer === 'object') {
   for (const w of answer.writes) row[w.target][w.field] = w.value;
   answer = answer.value;
  }
  return answer;
 }]));
 helpers.readController = () => ({flags41c:row.controllerFlags});
 const result = api[row.kind === 'actor' ? 'actorShouldTrace' : 'pawnShouldTrace']({...row, helpers});
 if (result.status !== 'ready') throw Error(JSON.stringify({row,result}));
 return {value:result.value,calls};
})));
"""


def fixtures():
    rng = random.Random(0x54524143)
    cases = []
    categories = [
        0,
        1,
        2,
        4,
        0x10,
        0x20,
        0x30,
        0x50,
        0x70,
        0x80,
        0x86,
        0x486,
        0x100,
        0x110,
        0x2000,
        0x2100,
        0x8000,
        0x8100,
        0x10000,
        0x200BF,
        0x300BF,
        0xFFFFFFFF,
    ]
    for kind in ("actor", "pawn"):
        for n in range(4000):
            actor = dict(
                identity=0x200000,
                levelIdentity=rng.choice([None, 0x600000]),
                bits74=rng.choice([0, 2, 4, 0x10, 0x16]),
                flags2e4=rng.choice([0, 2]),
                collisionBits=rng.randrange(32),
                primitive38=rng.choice([None, 0x500000]),
                primitive104=rng.choice([None, 0x510000]),
                drawTypeByte35=rng.choice([0, 2, 8]),
                controllerIdentity=rng.choice([None, 0x400000]),
                flags678=rng.choice([0, 2, 8, 10]),
            )
            source = rng.choice(
                [
                    None,
                    dict(
                        identity=0x300000,
                        bits74=rng.choice([0, 0x10]),
                        flags64=rng.choice([0, 2]),
                    ),
                ]
            )
            if kind == "pawn" and n % 17 == 0:
                source = dict(actor, flags64=0)
            elif kind == "pawn" and n % 19 == 0:
                source = dict(identity=0x400000, bits74=0, flags64=0)
            cases.append(
                dict(
                    kind=kind,
                    actor=actor,
                    source=source,
                    flags=categories[n % len(categories)],
                    controllerFlags=rng.choice([0, 1, 0x80]),
                    answers=dict(
                        getLevelInfo=rng.choice([0x200000, 0x610000]),
                        isPawn=rng.choice([0, 1, 0x80000000]),
                        isBlockedBy=rng.choice([0, 1, 128]),
                        checkLoadingResource=rng.choice([0, 0, 0, 1, 0x80000000]),
                    ),
                )
            )
    # State after a helper must be read afresh; these deliberate helper writes
    # are authored callback inputs, not claims about real loader behavior.
    for field, values in [
        ("flags2e4", (0, 2)),
        ("bits74", (0, 0x10, 4)),
        ("flags678", (0, 2)),
    ]:
        for v in values:
            for flags in (0x100, 0x8000, 0x86, 1):
                cases.append(
                    dict(
                        kind="pawn",
                        actor=dict(
                            identity=0x200000,
                            controllerIdentity=None,
                            flags2e4=2,
                            bits74=0,
                            flags678=0,
                            primitive38=None,
                        ),
                        source=None,
                        flags=flags,
                        controllerFlags=0,
                        answers=dict(
                            checkLoadingResource=dict(
                                value=0,
                                writes=[dict(target="actor", field=field, value=v)],
                            )
                        ),
                    )
                )
    return cases


def verify(engine_path, comparison_engine, runtime_module):
    engine = Image(Path(engine_path), ENGINE_SHA, True)
    binding = qualify_source(engine, comparison_engine)
    program = instruction_rows(engine)
    cases = fixtures()
    expected, visited, steps, categories = [], set(), Counter(), Counter()
    for row in cases:
        result, trace = native_trace(row, program)
        expected.append(result)
        visited.update(trace)
        steps[row["kind"]] += len(trace)
        categories[(row["kind"], result["value"])] += 1
    module = Path(runtime_module).resolve()
    process = subprocess.run(
        ["node", "--input-type=module", "-e", SCRIPT, module.as_uri()],
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        cwd=ROOT,
        timeout=60,
    )
    if process.returncode:
        raise AssertionError(process.stderr)
    actual = json.loads(process.stdout)
    assert len(actual) == len(expected)
    for n, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, (n, cases[n], a, b)
    return dict(
        scope="original-actor-pawn-trace-filter",
        source=binding,
        cases=len(cases),
        interpretedInstructions=dict(steps),
        uniqueInstructions=len(visited),
        outcomes=[
            dict(kind=k, value=v, count=n) for (k, v), n in sorted(categories.items())
        ],
        runtimeSHA256=hashlib.sha256(module.read_bytes()).hexdigest(),
        limits=[
            "Authored current fields and helper replies; not live collision/placement acceptance.",
            "Exact DWORD results and helper call arguments/order compared, including explicit post-helper field mutations.",
            "Subclass overrides other than these two methods, native exception paths and helper internals remain outside scope.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--engine", type=Path, default=ROOT / "assets/interlude/system/engine.dll"
    )
    parser.add_argument("--comparison-engine", type=Path, required=True)
    parser.add_argument(
        "--runtime-module",
        type=Path,
        default=ROOT / "editor/world/js/actor-blocking.js",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    receipt = verify(args.engine, args.comparison_engine, args.runtime_module)
    print(
        json.dumps(
            (
                {
                    k: receipt[k]
                    for k in (
                        "scope",
                        "cases",
                        "interpretedInstructions",
                        "uniqueInstructions",
                    )
                }
                if args.check
                else receipt
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
