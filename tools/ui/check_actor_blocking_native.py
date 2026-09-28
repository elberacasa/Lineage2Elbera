#!/usr/bin/env python3
"""Elbera Tools: original actor blocking and MoveActor selection comparison.

Reads pinned owned/supplemental Engine files; never executes a native image.
Interprets finite retained instructions and compares the actual JS module.
See docs/native-actor-blocking-evidence.md for boundaries and required inputs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct
import subprocess

from check_cast_sound_native import RandomMachine
from check_tutorial_quest_native import Image, ENGINE_SHA

ROOT = Path(__file__).resolve().parents[2]

RANGES = [
    (0x1052E110, 0x1052E263),
    (0x10363DD0, 0x10363DF0),
    (0x10363EB0, 0x10363EF7),
    (0x10363FA0, 0x10363FC7),
    (0x105C0DB1, 0x105C0E16),
    (0x105C0E98, 0x105C0E9F),
]


def qualify_source(engine, comparison_engine):
    from supplemental_pe import PEImage
    from check_supplemental_engine import CANDIDATE_ENGINE_SHA
    from check_hair_attachment_native import compare_call_block

    candidate = PEImage(Path(comparison_engine), CANDIDATE_ENGINE_SHA)
    methods = [
        ("?IsBlockedBy@AActor@@QBEHPBV1@@Z", 0x10308BDE, 0x1052E110),
        ("?IsBasedOn@AActor@@QBEHPBV1@@Z", 0x1030EC5F, 0x10363F70),
        ("?IsBrush@AActor@@QBEHXZ", 0x1030C086, 0x10363DD0),
        ("?IsEncroacher@AActor@@QBEHXZ", 0x103148C6, 0x10363EB0),
    ]
    for name, thunk, body in methods:
        assert engine.exported(name) == thunk
        assert engine.exported(name, True) == body
        assert candidate.body(name) == body
    move = (
        "?MoveActor@ULevel@@UAEHPAVAActor@@VFVector@@VFRotator@@AAUFCheckResult@@HHHH@Z"
    )
    assert engine.exported(move, True) == 0x105C08E0
    assert candidate.body(move) == 0x105C08A0
    assert engine.u32(
        engine.exported("??_7ULevel@@6BUObject@@@") + 0xA4
    ) == engine.exported(move)
    virtuals = [
        (0x6C, "?GetPlayerPawn@AActor@@UBEPAVAPawn@@XZ"),
        (0x2E0, "?IsABrush@AActor@@UAEHXZ"),
        (0x2E4, "?IsAMover@AActor@@UAEHXZ"),
        (0x2F4, "?IsAProjectile@AActor@@UAEHXZ"),
    ]
    vtable = engine.exported("??_7AActor@@6B@")
    for offset, name in virtuals:
        assert engine.u32(vtable + offset) == engine.exported(name)
    # Bind the sliced entry registers and the caller's accumulated flag.
    anchors = [
        (0x10363F91, "mov", "eax, ecx"),
        (0x10363F9A, "mov", "ecx, dword ptr [ebp + 8]"),
        (0x10363FC0, "mov", "eax, dword ptr [eax + 0x40]"),
        (0x105C0C80, "xor", "esi, esi"),
        (0x105C0C82, "mov", "dword ptr [ebp - 0x50], esi"),
        (0x105C0DF0, "mov", "dword ptr [ebp - 0x50], 1"),
        (0x105C0E0A, "mov", "ecx, 0xc"),
        (0x105C0E14, "rep movsd", "dword ptr es:[edi], dword ptr [esi]"),
        (0x10363EDB, "push", "0x10b35800"),
    ]
    for anchor in anchors:
        engine.instruction(*anchor)
    comparisons = []
    blocks = [
        ("IsBlockedBy normal body", 0x1052E110, 0x1052E263, 0, []),
        ("IsBrush normal body", 0x10363DD0, 0x10363DF0, 0, []),
        (
            "IsEncroacher normal body",
            0x10363EB0,
            0x10363EF7,
            0,
            [(0x32, ("core.dll", "?IsA@UObject@@QBEHPAVUClass@@@Z"))],
        ),
        ("IsBasedOn loop and normal cleanup", 0x10363F91, 0x10363FDA, 0, []),
        ("MoveActor flag initialization", 0x105C0C80, 0x105C0C88, -0x40, []),
        ("MoveActor selection", 0x105C0DB1, 0x105C0E16, -0x40, []),
        ("MoveActor next result", 0x105C0E98, 0x105C0E9F, -0x40, []),
    ]
    for label, start, end, delta, imports in blocks:
        raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        other_raw = candidate.read(start + delta, end - start)
        other = bytearray(other_raw)
        normalization = []
        if start == 0x10363EB0:
            symbol = "?PrivateStaticClass@AKConstraint@@0VUClass@@A"
            offset = 0x10363EDC - start
            assert struct.unpack_from("<I", raw, offset)[0] == engine.exported(symbol)
            assert (
                struct.unpack_from("<I", other, offset)[0] == candidate.exports[symbol]
            )
            normalization.append(
                dict(
                    symbol=symbol,
                    owned=hex(engine.exported(symbol)),
                    candidate=hex(candidate.exports[symbol]),
                )
            )
            other[offset : offset + 4] = raw[offset : offset + 4]
        direct_calls = [
            i.address - start
            for i in engine.dis.disasm(raw, start)
            if i.mnemonic == "call" and i.bytes[0] == 0xE8
        ]
        result = compare_call_block(
            raw,
            bytes(other),
            owned_va=start,
            candidate_va=start + delta,
            sites=imports,
            direct_calls=direct_calls,
            imports=candidate.imports,
        )
        comparisons.append(
            dict(
                label=label,
                ownedRange=[hex(start), hex(end)],
                candidateStart=hex(start + delta),
                ownedSHA256=hashlib.sha256(raw).hexdigest(),
                candidateSHA256=hashlib.sha256(other_raw).hexdigest(),
                explicitOperandNormalization=normalization,
                comparison=result,
            )
        )
    return dict(
        ownedEngineSHA256=engine.sha,
        comparisonEngineSHA256=CANDIDATE_ENGINE_SHA,
        instructionAnchors=len(anchors),
        virtualSlots=[dict(offset=hex(off), name=name) for off, name in virtuals],
        comparisons=comparisons,
    )


def instruction_rows(engine):
    result = []
    for a, b in RANGES:
        rows = list(
            engine.dis.disasm(
                bytes(engine.data[engine.offset(a) : engine.offset(b)]), a
            )
        )
        assert rows[0].address == a and rows[-1].address + rows[-1].size == b
        assert all(x.address + x.size == y.address for x, y in zip(rows, rows[1:]))
        result += rows
    return result


REGS = dict.fromkeys(("eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp"), 0)
VIRTUALS = {
    0x10363DE1: "isABrush",
    0x1052E169: "isABrush",
    0x10363ECA: "isAMover",
    0x1052E1A3: "getPlayerPawn",
    0x1052E1DF: "getPlayerPawn",
    0x1052E22A: "getPlayerPawn",
    0x1052E24B: "getPlayerPawn",
    0x1052E1B3: "isAProjectile",
    0x1052E1EF: "isAProjectile",
    0x10363EE2: "isKConstraint",
}
DIRECT = {0x103148C6: 0x10363EB0, 0x1030C086: 0x10363DD0, 0x10308BDE: 0x1052E110}
ALIASES = {"al": "eax", "bl": "ebx", "cl": "ecx", "dl": "edx"}


class BlockingMachine(RandomMachine):
    def __init__(self, memory, registers, answers, program):
        super().__init__(memory, REGS | registers, program)
        self.answers = answers
        self.calls = []
        self.visited = []
        self.indices = {}
        self.zero = self.less = self.carry = self.sign = self.parity = False

    def read(self, operand):
        if operand in ALIASES:
            return self.registers[ALIASES[operand]] & 255
        value = super().read(operand)
        return value & 255 if operand.startswith("byte ptr ") else value

    def write(self, operand, value, floating=False):
        if operand in ALIASES:
            reg = ALIASES[operand]
            self.registers[reg] = (self.registers[reg] & 0xFFFFFF00) | (value & 255)
        else:
            super().write(operand, value, floating)

    def answer(self, name, *args):
        self.calls.append([name, *args])
        key = (name, *args)
        n = self.indices.get(key, 0)
        self.indices[key] = n + 1
        values = self.answers[str(args[0])][name]
        assert n < len(values), (name, args, n)
        value = values[n]
        if isinstance(value, dict):
            for write in value["collisionWrites"]:
                self.memory[write["actor"] + 0x2F8] = write["value"]
            value = value["value"]
        return value or 0

    def step(self, i):
        self.visited.append(i.address)
        if i.address in VIRTUALS:
            name = VIRTUALS[i.address]
            if name == "isKConstraint":
                assert self.memory[self.registers["esp"]] == 0x10B35800
                self.registers["esp"] += 4
            self.registers["eax"] = self.answer(name, self.registers["ecx"])
            return i.address + (6 if name == "isKConstraint" else i.size)
        if i.mnemonic == "call":
            target = int(i.op_str, 16)
            assert target in DIRECT
            self.registers["esp"] -= 4
            self.memory[self.registers["esp"]] = i.address + i.size
            return DIRECT[target]
        if i.mnemonic == "ret":
            target = self.memory[self.registers["esp"]]
            self.registers["esp"] += 4 + (int(i.op_str, 0) if i.op_str else 0)
            return target or None
        return super().step(i)

    def run(self, start, stops=()):
        pc = start
        for _ in range(4096):
            if pc is None or pc in stops:
                return pc
            pc = self.step(self.program[pc])
        raise AssertionError("nonterminating source fixture")


def actor_memory(actors):
    memory = {}
    for a in actors:
        ptr = a["identity"]
        vt = ptr + 0x100000
        memory[ptr] = vt
        for off, name in [
            (0x74, "bits74"),
            (0x2F8, "collisionBits"),
            (0x38, "primitive38"),
            (0x278, "primitive278"),
            (0x34, "physicsByte34"),
        ]:
            memory[ptr + off] = a[name] or 0
        # Opaque explicit virtual targets, hooked only at qualified call sites.
        for off in (0x6C, 0x2E0, 0x2E4, 0x2F4):
            memory[vt + off] = vt + 0x1000 + off
    return memory


def native_blocked(row, program):
    a, b = row["actor"], row["other"]
    sp = 0x9000
    actors = [a] if a["identity"] == b["identity"] else [a, b]
    m = BlockingMachine(
        actor_memory(actors) | {sp: 0, sp + 4: b["identity"]},
        {"esp": sp, "ecx": a["identity"]},
        row["answers"],
        program,
    )
    m.run(0x1052E110)
    assert m.registers["esp"] == sp + 8
    return {"value": m.registers["eax"], "calls": m.calls}, m.visited


def native_based(actor, base, bases, program):
    m = BlockingMachine(
        {int(a) + 0x40: b or 0 for a, b in bases.items()},
        {"eax": actor or 0, "ecx": base or 0},
        {},
        program,
    )
    m.run(0x10363FA0, {0x10363FAD, 0x10363FC7})
    return m.registers["eax"], m.visited


def native_selection(row, program):
    a = row["actor"]
    ptr = a["identity"]
    frame = 0x6000
    sp = 0x9000
    dest = 0x8000
    records = [0x500000 + i * 0x40 for i in range(len(row["hits"]))]
    memory = {
        ptr + 0x2F8: a["collisionBits"],
        frame + 0x78: row["arg3"],
        frame - 0x50: 0,
        frame + 0x6C: dest,
    }
    for j, (addr, hit) in enumerate(zip(records, row["hits"])):
        memory.update({addr + 4 * k: (j + 1) * 100 + k for k in range(12)})
        memory[addr] = records[j + 1] if j + 1 < len(records) else 0
        memory[addr + 4] = hit["actor"]
    memory.update(actor_memory(row.get("actors", [])))
    m = BlockingMachine(
        memory,
        {"ebx": ptr, "eax": records[0] if records else 0, "ebp": frame, "esp": sp},
        row.get("answers", {}),
        program,
    )
    selected = None

    def step(i):
        nonlocal selected
        if i.address in (0x105C0DD2, 0x105C0DE3, 0x105C0DFD):
            m.visited.append(i.address)
            receiver = m.registers["ecx"]
            arg = m.memory[m.registers["esp"]]
            if i.address == 0x105C0DFD:
                name = "isBlockedBy"
                if row["kind"] == "composed":
                    m.calls.append([name, receiver, arg])
                    m.visited.pop()
                    return original_step(i)
                value = row["blocked"][str(arg)]
            else:
                name = "isBasedOn"
                value, visited = native_based(receiver, arg, row["bases"], program)
                m.visited += visited
            m.calls.append([name, receiver, arg])
            m.registers["eax"] = value
            m.registers["esp"] += 4
            return i.address + i.size
        if i.mnemonic == "rep movsd":
            m.visited.append(i.address)
            assert m.registers["ecx"] == 12
            src = m.registers["esi"]
            selected = records.index(src)
            for k in range(12):
                m.memory[m.registers["edi"] + 4 * k] = m.memory[src + 4 * k]
            m.registers["ecx"] = 0
            m.registers["esi"] += 48
            m.registers["edi"] += 48
            return i.address + i.size
        return original_step(i)

    original_step = m.step
    m.step = step
    m.run(0x105C0DB1, {0x105C0E16, 0x105C0E19})
    if selected is not None:
        assert [m.memory[dest + 4 * k] for k in range(12)] == [
            m.memory[records[selected] + 4 * k] for k in range(12)
        ]
    return {
        "selected": selected,
        "passedBaseChecks": bool(m.memory[frame - 0x50]),
        "calls": m.calls,
    }, m.visited


SCRIPT = r"""
import fs from "node:fs";
const api = await import(process.argv[1]);
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const result = data.map((row) => {
  const calls = [],
    counts = {};
  const helpers = Object.fromEntries(
    [
      "isABrush",
      "isAMover",
      "isKConstraint",
      "getPlayerPawn",
      "isAProjectile",
    ].map((name) => [
      name,
      (id) => {
        calls.push([name, id]);
        const key = name + ":" + id;
        const n = counts[key] || 0;
        counts[key] = n + 1;
        let value = row.answers[id][name][n];
        if (value !== null && typeof value === "object") {
          for (const write of value.collisionWrites) {
            for (const actor of [row.actor, row.other, ...(row.actors || [])]) {
              if (actor?.identity === write.actor)
                actor.collisionBits = write.value;
            }
          }
          value = value.value;
        }
        return value;
      },
    ]),
  );
  if (row.kind === "blocking") {
    const r = api.actorIsBlockedBy({ ...row, helpers });
    if (r.status !== "ready") throw Error(JSON.stringify(r));
    return { value: r.value, calls };
  }
  if (row.kind === "based") {
    const r = api.isActorBasedOn({
      actor: row.actor,
      base: row.base,
      baseOf: (id) => row.bases[id],
    });
    if (r.status !== "ready") throw Error(JSON.stringify(r));
    return { value: r.value };
  }
  const r = api.selectMoveActorBlockingHit({
    ...row,
    helpers: {
      isBasedOn: (a, b) => {
        calls.push(["isBasedOn", a, b]);
        const r = api.isActorBasedOn({
          actor: a,
          base: b,
          baseOf: (id) => row.bases[id],
        });
        if (r.status !== "ready") throw Error(JSON.stringify(r));
        return r.value;
      },
      isBlockedBy: (a, b) => {
        calls.push(["isBlockedBy", a, b]);
        if (row.kind !== "composed") return row.blocked[b];
        const r = api.actorIsBlockedBy({
          actor: row.actors.find((x) => x.identity === a),
          other: row.actors.find((x) => x.identity === b),
          helpers,
        });
        if (r.status !== "ready") throw Error(JSON.stringify(r));
        return r.value;
      },
    },
  });
  if (r.status !== "ready") throw Error(JSON.stringify(r));
  return {
    selected: r.selected === null ? null : row.hits.indexOf(r.selected),
    passedBaseChecks: r.passedBaseChecks,
    calls,
  };
});
process.stdout.write(JSON.stringify(result));
"""


def verify(engine_path, comparison_engine, runtime_module):
    engine = Image(Path(engine_path), ENGINE_SHA, True)
    binding = qualify_source(engine, comparison_engine)
    program = instruction_rows(engine)
    rng = random.Random(0x424C4F43)
    cases = []
    expected = []
    visited = {}
    steps = {}
    counts = {}

    def add(row, answer, trace):
        cases.append(row)
        expected.append(answer)
        k = row["kind"]
        visited.setdefault(k, set()).update(trace)
        steps[k] = steps.get(k, 0) + len(trace)
        counts[k] = counts.get(k, 0) + 1

    def actor(ptr):
        return dict(
            identity=ptr,
            bits74=rng.choice([0, 2, 0x40, 0x42, 0xFFFFFFFF]),
            collisionBits=rng.randrange(32),
            primitive38=rng.choice([None, 0x333000]),
            primitive278=rng.choice([None, 0x444000]),
            physicsByte34=rng.choice([0, 12, 13, 14, 15, 255]),
        )

    for j in range(5000):
        a = actor(0x10000)
        b = a if j % 13 == 0 else actor(0x20000)
        answers = {
            str(p): {
                name: [
                    (
                        rng.choice([None, 0x700000])
                        if name == "getPlayerPawn"
                        else rng.choice([0, 1, 0x80000000, 0xFFFFFFFF])
                    )
                    for _ in range(16)
                ]
                for name in sorted(set(VIRTUALS.values()))
            }
            for p in [a["identity"], b["identity"]]
        }
        if j < 4:
            # The class callback runs before the final collision-word read in
            # either brush branch. Static-only fixtures cannot detect a stale
            # read moved across this source call boundary.
            a = dict(
                identity=0x10000,
                bits74=0,
                collisionBits=2,
                primitive38=None,
                primitive278=None,
                physicsByte34=0,
            )
            b = dict(
                identity=0x20000,
                bits74=0,
                collisionBits=4 if j % 2 == 0 else 0,
                primitive38=None,
                primitive278=0x444000,
                physicsByte34=0,
            )
            if j >= 2:
                a, b = b, a
            brush_actor = b if j < 2 else a
            player_receiver = a if j < 2 else b
            answers = {
                str(p["identity"]): {
                    name: [None if name == "getPlayerPawn" else 0] * 16
                    for name in sorted(set(VIRTUALS.values()))
                }
                for p in (a, b)
            }
            answers[str(brush_actor["identity"])]["isABrush"] = [1] * 16
            answers[str(player_receiver["identity"])]["getPlayerPawn"][0] = dict(
                value=None,
                collisionWrites=[
                    dict(actor=brush_actor["identity"], value=0 if j % 2 == 0 else 4)
                ],
            )
        row = dict(kind="blocking", actor=a, other=b, answers=answers)
        result, trace = native_blocked(row, program)
        add(row, result, trace)
    for _ in range(300):
        pointers = [0x10000 + 0x10000 * i for i in range(rng.randrange(1, 12))]
        bases = {
            str(a): rng.choice([None, *pointers[i + 1 :]])
            for i, a in enumerate(pointers)
        }
        a = rng.choice([None, *pointers])
        b = rng.choice([None, *pointers, 0xDEAD000])
        value, trace = native_based(a, b, bases, program)
        add(dict(kind="based", actor=a, base=b, bases=bases), dict(value=value), trace)
    for j in range(1000):
        pointers = [0x10000 + 0x10000 * i for i in range(rng.randrange(1, 12))]
        bases = {
            str(a): rng.choice([None, *pointers[i + 1 :]])
            for i, a in enumerate(pointers)
        }
        a = rng.choice(pointers)
        hits = [
            dict(actor=rng.choice(pointers), time=rng.choice([0, 0.5, 1]))
            for _ in range(rng.randrange(20))
        ]
        row = dict(
            kind="selection",
            actor=dict(identity=a, collisionBits=rng.randrange(32)),
            hits=hits,
            arg3=rng.choice([0, 1, 0x80000000]),
            bases=bases,
            blocked={str(a): rng.choice([0, 1, 0x80000000]) for a in pointers},
        )
        result, trace = native_selection(row, program)
        add(row, result, trace)
    for _ in range(300):
        actors = [actor(0x10000 + i * 0x10000) for i in range(5)]
        pointers = [a["identity"] for a in actors]
        answers = {
            str(p): {
                name: [
                    (
                        rng.choice([None, 0x700000])
                        if name == "getPlayerPawn"
                        else rng.choice([0, 1, 0x80000000])
                    )
                    for _ in range(64)
                ]
                for name in sorted(set(VIRTUALS.values()))
            }
            for p in pointers
        }
        bases = {
            str(a): rng.choice([None, *pointers[i + 1 :]])
            for i, a in enumerate(pointers)
        }
        row = dict(
            kind="composed",
            actor=rng.choice(actors),
            actors=actors,
            answers=answers,
            bases=bases,
            arg3=rng.choice([0, 1]),
            hits=[dict(actor=rng.choice(pointers)) for _ in range(rng.randrange(8))],
        )
        result, trace = native_selection(row, program)
        add(row, result, trace)
    module = Path(runtime_module).resolve().as_uri()
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", SCRIPT, module],
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    actual = json.loads(proc.stdout)
    assert len(actual) == len(expected)
    for i, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, (i, cases[i], a, b)
    return dict(
        tool="Elbera Tools",
        status="pass",
        counts=counts,
        steps=steps,
        coverage={k: [hex(a) for a in sorted(v)] for k, v in visited.items()},
        source=binding,
        runtimeSHA256=hashlib.sha256(Path(runtime_module).read_bytes()).hexdigest(),
        verifierSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        limits=[
            "Virtual subclass responses are explicit boundary inputs; no live class/resource state is inferred.",
            "Finite terminating base chains only; exception paths and arbitrary predicate mutations are not evaluated. Four explicit collision-word mutations test reads across GetPlayerPawn.",
            "Selection starts after an actual ordered collision query; it does not supply a spatial provider.",
            "No MoveActor membership, bump/touch/zone callbacks or walking response is executed.",
            "Supplemental correspondence qualifies declared erased calls, not archive authenticity or a repaired native image.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--engine",
        type=Path,
        default=ROOT / "assets/interlude/system/engine.dll",
        help="pinned owned Engine.dll",
    )
    parser.add_argument(
        "--comparison-engine",
        type=Path,
        required=True,
        help="explicit pinned supplemental Engine.dll for erased IsA binding",
    )
    parser.add_argument(
        "--runtime-module",
        type=Path,
        default=ROOT / "editor/world/js/actor-blocking.js",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="print a compact summary; omit for the full JSON receipt",
    )
    args = parser.parse_args()
    report = verify(args.engine, args.comparison_engine, args.runtime_module)
    if args.check:
        print(
            json.dumps(
                dict(
                    status=report["status"],
                    counts=report["counts"],
                    steps=report["steps"],
                    comparisons=len(report["source"]["comparisons"]),
                    instructionAddresses={
                        k: len(v) for k, v in report["coverage"].items()
                    },
                )
            )
        )
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
