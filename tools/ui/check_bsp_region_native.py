#!/usr/bin/env python3
"""Elbera Tools: retained original UModel PointRegion and serialized operands.

Reads pinned private input bytes, never executes or emits original DLLs.
Finite synthetic cases execute the retained helper and compare the actual JS
module. Supplemental input is optional and qualifies serializer import names,
not vendor authenticity or live level/zone actor state. Binary64 approximates
x87 while preserving the original Float32 plane-distance store.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_cast_scheduler_native import Arithmetic, f32
from check_bsp_camera_native import run_sweep_slice
from check_supplemental_engine import compare_method, CANDIDATE_ENGINE_SHA
from supplemental_pe import PEImage

SYMBOL = "?PointRegion@UModel@@QBE?AUFPointRegion@@PAVAZoneInfo@@VFVector@@@Z"


def read(image, a, b):
    return bytes(image.data[image.offset(a) : image.offset(b)])


class RegionMachine(Arithmetic):
    def read(self, arg):
        if arg in ("al", "ah", "bl", "cl", "dl"):
            register = "e" + arg[0] + "x"
            shift = 8 if arg == "ah" else 0
            return (self.registers[register] >> shift) & 255
        if arg == "ax":
            return self.registers["eax"] & 65535
        return super().read(arg)

    def write(self, arg, value, floating=False):
        if arg in ("al", "bl", "cl", "dl", "ax"):
            register = "e" + arg[0] + "x"
            mask = 65535 if arg == "ax" else 255
            self.registers[register] = (self.registers[register] & ~mask) | (
                int(value) & mask
            )
        elif arg.startswith("byte ptr "):
            self.memory[self.address(arg)] = int(value) & 255
        else:
            super().write(arg, value, floating)


class RegionEvaluator:
    def __init__(self, image):
        self.image = image
        self.visited = set()
        self.nodes = []
        self.code = {}

    def run(self, m, a, b):
        pc = a
        if (a, b) not in self.code:
            rows = list(self.image.dis.disasm(read(self.image, a, b), a))
            cursor = a
            for i in rows:
                assert i.address == cursor
                cursor += i.size
            assert cursor == b
            self.code[(a, b)] = {i.address: i for i in rows}
        code = self.code[(a, b)]
        for _ in range(20000):
            if pc == b:
                return
            i = code[pc]
            self.visited.add(pc)
            nxt = pc + i.size
            if pc == 0x107469C5:
                self.nodes.append(m.registers["ebx"])
            if i.mnemonic == "call":
                assert i.op_str == "0x103080bc"
                m.registers["esp"] -= 4
                m.memory[m.registers["esp"]] = 0xDEAD
                self.run(m, 0x10685790, 0x106857D5)
            elif i.mnemonic == "ret":
                assert i.op_str == "0xc"
                m.registers["esp"] += 16
                return
            elif i.mnemonic.startswith("j"):
                f = m.flags
                take = {
                    "jmp": True,
                    "je": f.get("z"),
                    "jne": not f.get("z"),
                    "jbe": f.get("s") or f.get("z"),
                    "jp": f.get("p"),
                    "jnp": not f.get("p"),
                }[i.mnemonic]
                if take:
                    nxt = int(i.op_str, 0)
            elif i.mnemonic == "movzx":
                dst, src = i.op_str.split(", ")
                m.write(dst, m.read(src) & 255)
            else:
                nxt = run_sweep_slice(self.image, m, pc, nxt, max_steps=2)
            pc = nxt
        raise AssertionError("bounded PointRegion step cap")

    def evaluate(self, case):
        model, table, frame, result = 0x100000, 0x200000, 0x300000, 0x400000
        s = case["source"]
        self.nodes = []
        memory = {
            model + 0x64: table,
            model + 0x68: len(s["nodes"]),
            model + 0x124: s["rootOutside"],
            model + 0x134: s["numZones"],
            frame - 0x18: model,
            frame + 8: result,
            frame + 0xC: case["defaultZone"],
        }
        memory.update(
            {frame + 0x10 + 4 * i: f32(v) for i, v in enumerate(case["point"])}
        )
        memory.update(
            {
                model + 0x138 + 24 * i: 0 if v is None else v
                for i, v in enumerate(s["zoneActors"])
            }
        )
        for i, n in enumerate(s["nodes"]):
            ptr = table + 120 * i
            memory.update({ptr + 4 * j: f32(v) for j, v in enumerate(n["plane"])})
            memory.update(
                {
                    ptr + 0x20: n["back"],
                    ptr + 0x24: n["front"],
                    ptr + 0x54: n["zones"][0],
                    ptr + 0x55: n["zones"][1],
                    ptr + 0x56: n["numVertices"],
                    ptr + 0x57: n["flags"],
                    ptr + 0x58: n["leaves"][0],
                    ptr + 0x5C: n["leaves"][1],
                }
            )
        m = RegionMachine(
            self.image,
            memory,
            [],
            dict(
                ebp=frame,
                esp=frame - 0x100,
                esi=model,
                edi=case["defaultZone"],
                ebx=0,
                eax=0,
                ecx=0,
                edx=0,
            ),
        )
        self.run(m, 0x1074699B, 0x10746A69)
        assert not m.stack
        return {
            "region": {
                "zone": m.memory[result],
                "leaf": (int(m.memory[result + 4]) & 0x7FFFFFFF)
                - (int(m.memory[result + 4]) & 0x80000000),
                "zoneNumber": m.memory[result + 8],
            },
            "visited": self.nodes.copy(),
        }


def fixtures():
    rng = random.Random(0x746950)
    out = []
    for count in (0, 1, 15, 63):
        for k in range(75):
            nz = rng.choice([0, 1, 3, 6])
            nodes = []
            for i in range(count):
                plane = [f32(rng.uniform(-1, 1)) for _ in range(3)] + [
                    f32(rng.uniform(-25, 25))
                ]
                nodes.append(
                    {
                        "plane": plane,
                        "back": 2 * i + 1 if 2 * i + 1 < count else -1,
                        "front": 2 * i + 2 if 2 * i + 2 < count else -1,
                        "flags": rng.randrange(256),
                        "numVertices": rng.randrange(8),
                        "zones": [
                            rng.randrange(nz) if nz else rng.randrange(256)
                            for _ in range(2)
                        ],
                        "leaves": [rng.randrange(-1, 100) for _ in range(2)],
                    }
                )
            actors = [
                None if rng.randrange(3) == 0 else 0x600000 + j * 16
                for j in range(max(1, nz))
            ]
            out.append(
                {
                    "source": {
                        "nodes": nodes,
                        "rootOutside": k % 2,
                        "numZones": nz,
                        "zoneActors": actors,
                    },
                    "point": [f32(rng.uniform(-100, 100)) for _ in range(3)],
                    "defaultZone": 0x700000,
                }
            )
    for x in [-1.0, 0.0, -0.0, 1.0, f32(-(2**-149)), f32(2**-149)]:
        for plane in ([1.0, 0.0, 0.0, 0.0], [0.5, 0.0, 0.0, 0.0]):
            out.append(
                {
                    "source": {
                        "nodes": [
                            {
                                "plane": plane,
                                "front": -1,
                                "back": -1,
                                "flags": 0,
                                "numVertices": 3,
                                "zones": [1, 2],
                                "leaves": [17, 23],
                            }
                        ],
                        "rootOutside": 0,
                        "numZones": 3,
                        "zoneActors": [None, 0x600001, 0x600002],
                    },
                    "point": [x, 0, 0],
                    "defaultZone": 0x700000,
                }
            )
    return out


def verify_runtime(engine, module, cases):
    evaluator = RegionEvaluator(engine)
    expected = [evaluator.evaluate(c) for c in cases]
    code = """
import fs from 'node:fs';
const {queryBspRegion}=await import(process.argv[1]);
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(cases.map(c=>{const r=queryBspRegion(c.source,c.point,c.defaultZone);if(r.status!=='ready')throw Error(JSON.stringify(r));return {region:r.region,visited:r.visited}})));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", code, Path(module).resolve().as_uri()],
        cwd=ROOT,
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        check=True,
    )
    actual = json.loads(result.stdout)
    assert len(actual) == len(expected)
    for i, (a, b) in enumerate(zip(expected, actual)):
        assert a == b, {"case": i, "native": a, "runtime": b}
    return {"cases": len(cases), "retainedInstructions": len(evaluator.visited)}


def native_evidence(engine, comparison=None):
    assert engine.exported(SYMBOL, True) == 0x10746950
    engine.instruction(0x103080BC, "jmp", "0x10685790")
    assert struct.unpack("<f", read(engine, 0x1085222C, 0x10852230))[0] == 0
    # Complete ordinary output/traversal and complete ChildOutside helper.
    spans = [(0x1074699B, 0x10746A69), (0x10685790, 0x106857D5)]
    result = []
    for a, b in spans:
        raw = read(engine, a, b)
        row = {
            "start": hex(a),
            "end": hex(b),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        if comparison:
            if a == 0x1074699B:
                assert comparison.body(SYMBOL) == 0x10746910
                # The same retained thunk targets the matching shifted callee.
                assert comparison.read(0x103080BC, 1) == b"\xe9"
                assert (
                    0x103080C1 + struct.unpack("<i", comparison.read(0x103080BD, 4))[0]
                    == 0x10685750
                )
                row["comparison"] = compare_method(
                    raw,
                    comparison.read(a - 0x40, b - a),
                    a,
                    a - 0x40,
                    comparison.imported_call,
                    lambda va, n: read(engine, va, va + n),
                    lambda va, n: (
                        read(engine, va, va + n)
                        if va == 0x103080BC and n == 5
                        else comparison.read(va, n)
                    ),
                )
            else:
                assert raw == comparison.read(a - 0x40, b - a)
                row["comparison"] = "exact bytes"
        result.append(row)
    return result


def serialized_binding(engine, comparison=None):
    from check_hair_attachment_native import compare_call_block

    anchors = [
        (0x105EF3B1, "lea", "eax, [edi + 0x134]"),
        (0x105EF3CA, "lea", "eax, [edi + 0x64]"),
        (0x105EF3EF, "call", "0x1030317a"),
        (0x105EF413, "call", "0x1030599d"),
        (0x105EF41E, "cmp", "ebx, dword ptr [edi + 0x134]"),
        (0x105EF426, "lea", "eax, [ebx + ebx*2 + 0x27]"),
        (0x105EF42A, "lea", "ecx, [edi + eax*8]"),
        (0x105EF42F, "call", "0x10311bcb"),
        (0x105EE226, "push", "0x78"),
        (0x105EE243, "lea", "eax, [ebp - 0x14]"),
        (0x105EE265, "push", "0x78"),
        (0x105EE27C, "call", "0x1030e935"),
        (0x105EE29A, "lea", "eax, [edi + 4]"),
        (0x105EE2AB, "cmp", "esi, dword ptr [edi + 4]"),
        (0x105EE2B9, "lea", "ecx, [eax + edx*8]"),
        (0x105EBAAF, "lea", "ecx, [esi + 0x28]"),
        (0x105EBAB3, "lea", "edx, [esi + 0x24]"),
        (0x105EBAB7, "lea", "eax, [esi + 0x20]"),
        (0x105EBB08, "lea", "edx, [esi + 0x55]"),
        (0x105EBB0C, "lea", "eax, [esi + 0x54]"),
        (0x105EBB11, "call", "0x10305911"),
        (0x105EBB1A, "call", "0x10305911"),
        (0x105EBB2C, "lea", "edx, [esi + 0x5c]"),
        (0x105EBB30, "lea", "eax, [esi + 0x58]"),
        (0x105EBB35, "call", "0x1030599d"),
        (0x105EBB3E, "call", "0x1030599d"),
        (0x105E9A18, "mov", "eax, dword ptr [ebp + 0xc]"),
        (0x105E9A2C, "push", "eax"),
        (0x105E9A2D, "mov", "eax, dword ptr [edx + 0x18]"),
        (0x105E9A30, "call", "eax"),
        (0x1032FFEE, "push", "1"),
        (0x10330049, "push", "4"),
        (0x107469CC, "mov", "ecx, dword ptr [esi + 0x64]"),
        (0x107469CF, "lea", "esi, [ecx + eax*8]"),
        (0x10746A15, "mov", "ebx, dword ptr [esi + edi*4 + 0x20]"),
        (0x10746A2E, "mov", "ebx, dword ptr [edx + ebx*4 + 0x58]"),
        (0x10746A35, "cmp", "dword ptr [esi + 0x134], 0"),
        (0x10746A48, "movzx", "ecx, byte ptr [edx + edi + 0x54]"),
        (0x10746A57, "add", "ecx, 0xd"),
        (0x10746A5A, "lea", "ecx, [ecx + ecx*2]"),
        (0x10746A5D, "mov", "esi, dword ptr [esi + ecx*8]"),
    ]
    for a, op, args in anchors:
        engine.instruction(a, op, args)
    assert engine.exported("?Serialize@UModel@@UAEXAAVFArchive@@@Z", True) == 0x105EF380
    assert (
        engine.exported("??6@YAAAVFArchive@@AAV0@AAVFBspNode@@@Z", True) == 0x105EBA40
    )
    for stub, body in [
        (0x1030317A, 0x105EEED0),
        (0x10311149, 0x105EE200),
        (0x1030E935, 0x105EBA40),
        (0x10311BCB, 0x105E99F0),
        (0x10305911, 0x1032FFE0),
        (0x1030599D, 0x10330040),
    ]:
        engine.instruction(stub, "jmp", hex(body))
    blocks = []
    if comparison:
        compact = "??6@YAAAVFArchive@@AAV0@AAVFCompactIndex@@@Z"
        fixed = "?ByteOrderSerialize@FArchive@@QAEAAV1@PAXH@Z"
        for name, a, b, delta, imports in [
            ("model operand order/table", 0x105EF3B1, 0x105EF43C, -0x40, {}),
            (
                "node array ordinary archive",
                0x105EEEF8,
                0x105EEF14,
                -0x40,
                {0x105EEEFD: "?IsTrans@FArchive@@QAEHXZ"},
            ),
            (
                "node array loading/stride",
                0x105EE226,
                0x105EE2CB,
                -0x40,
                {
                    0x105EE231: "?CountBytes@FArray@@QAEXAAVFArchive@@H@Z",
                    0x105EE239: "?IsLoading@FArchive@@QAEHXZ",
                    0x105EE248: compact,
                    0x105EE29F: compact,
                },
            ),
            ("node serialized zones/leaves", 0x105EBB08, 0x105EBB46, -0x40, {}),
            ("zone actor object-reference", 0x105E9A18, 0x105E9A4D, -0x40, {}),
            ("fixed DWORD", 0x10330040, 0x10330058, 0, {0x1033004E: fixed}),
            (
                "fixed plane",
                0x10330260,
                0x103302A4,
                0,
                {
                    0x1033026F: fixed,
                    0x1033027D: fixed,
                    0x1033028B: fixed,
                    0x10330299: fixed,
                },
            ),
        ]:
            raw = read(engine, a, b)
            direct = [
                i.address - a
                for i in engine.dis.disasm(raw, a)
                if i.mnemonic == "call" and bytes(i.bytes)[0] == 0xE8
            ]
            check = compare_call_block(
                raw,
                comparison.read(a + delta, b - a),
                owned_va=a,
                candidate_va=a + delta,
                sites=[
                    (site - a, ("core.dll", symbol)) for site, symbol in imports.items()
                ],
                direct_calls=direct,
                imports=comparison.imports,
            )
            blocks.append({"label": name, "start": hex(a), "end": hex(b), **check})
        # Compact scalar serializer is loaded into EBX, then called five times.
        a, b = 0x105EBA68, 0x105EBAE1
        old = read(engine, a, b)
        new = bytearray(comparison.read(a - 0x40, b - a))
        assert read(engine, 0x105EBA9E, 0x105EBAA4) == bytes.fromhex("8b1d10d9d811")
        assert comparison.read(0x105EBA5E, 6) == bytes.fromhex("8b1d0cd9d811")
        assert comparison.imports[0x11D8D90C] == ("core.dll", compact)
        new[0x105EBA9E - a : 0x105EBAA4 - a] = read(engine, 0x105EBA9E, 0x105EBAA4)
        direct = [
            i.address - a
            for i in engine.dis.disasm(old, a)
            if i.mnemonic == "call" and bytes(i.bytes)[0] == 0xE8
        ]
        check = compare_call_block(
            old,
            bytes(new),
            owned_va=a,
            candidate_va=a - 0x40,
            sites=[],
            direct_calls=direct,
            imports=comparison.imports,
        )
        blocks.append(
            {
                "label": "node compact links/plane",
                "namedIAT": "Core.FCompactIndex archive operator",
                "start": hex(a),
                "end": hex(b),
                **check,
            }
        )
    # Reuse the previously checked archive object-reference virtual identity,
    # avoiding a second unrelated archive/Level parser.
    sys.path.insert(0, str(ROOT / "tools/world"))
    from export_bsp_collision import native_binding_evidence

    prior = native_binding_evidence()
    return {
        "anchors": len(anchors),
        "comparisons": blocks,
        "reusedLevelModelBinding": {
            "tool": "tools/world/export_bsp_collision.py",
            "instructionChecks": prior["instructionChecks"],
            "serializedField": prior["serializedField"],
        },
        "fields": {
            "nodes": "Model+64 pointer/+68 count; stride120",
            "plane": "Node+0",
            "backFront": "Node+20/+24",
            "zoneNumbers": "Node+54/+55",
            "leaves": "Node+58/+5c",
            "numZones": "Model+134",
            "zoneActors": "Model+138+24*zone",
        },
        "limits": [
            "Field mapping plus qualified saved archive references, not live UObject pointer identity.",
            "Serialized empty zone table does not establish the unrecorded runtime slot0.",
        ],
    }


def map_diagnostic(engine, runtime, tile):
    """Fresh saved model data with explicit diagnostic actor-token substitution.

    Saved package refs are not live UObject pointers. Unique synthetic pointer
    tokens only preserve null/equality for testing this helper's arithmetic.
    """
    if not re.fullmatch(r"\d{2}_\d{2}", tile):
        raise ValueError("expected original tile NN_NN")
    sys.path.insert(0, str(ROOT / "tools/world"))
    from export_bsp_collision import (
        load_package,
        read_model,
        level_model_binding,
        export_model,
    )

    path = ROOT / "assets/interlude/maps" / (tile + ".unr")
    pkg, protocol = load_package(path)
    model_export, _ = level_model_binding(pkg)
    model = read_model(pkg, model_export)
    data = export_model(
        pkg, model, tile, hashlib.sha256(path.read_bytes()).hexdigest(), protocol
    )
    if data["nodes"] and not data["zones"]:
        raise ValueError("saved NumZones0 does not establish runtime slot0")
    source = dict(
        nodes=data["nodes"],
        rootOutside=data["rootOutside"],
        numZones=len(data["zones"]),
        zoneActors=[
            None if z["actor"] is None else 0x600000 + 16 * z["actor"]["reference"]
            for z in data["zones"]
        ],
    )
    if 0x700000 in source["zoneActors"] or 0 in source["zoneActors"]:
        raise ValueError("diagnostic actor token collides with default or null")
    # Equally spaced serialized BSP points; offset pairs also exercise the
    # finite tree with coordinates not copied from its own node planes.
    points = data["points"]
    if not points:
        raise ValueError("diagnostic map has no saved points")
    probes = [points[(i * (len(points) - 1)) // 7] for i in range(8)]
    probes += [[f32(v + d) for v, d in zip(p, (0.125, -0.25, 0.5))] for p in probes]
    cases = [dict(source=source, point=p, defaultZone=0x700000) for p in probes]
    return dict(
        tile=tile,
        source=data["source"],
        nodes=len(data["nodes"]),
        zones=len(data["zones"]),
        diagnosticActorTokens=True,
        differential=verify_runtime(engine, runtime, cases),
        limits=["Saved model and zone references; no live Level/Zone state assertion."],
    )


def verify(comparison_engine=None, runtime=None, maps=()):
    engine = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    comparison = (
        PEImage(Path(comparison_engine), CANDIDATE_ENGINE_SHA)
        if comparison_engine
        else None
    )
    ranges = native_evidence(engine, comparison)
    binding = serialized_binding(engine, comparison)
    runtime = runtime or ROOT / "editor/world/js/bsp-region.js"
    result = verify_runtime(engine, runtime, fixtures())
    return {
        "tool": "Elbera Tools",
        "engineSHA256": engine.sha,
        "comparisonEngineSHA256": comparison.sha if comparison else None,
        "ranges": ranges,
        "serializedBinding": binding,
        "runtime": result,
        "mapDiagnostics": [map_diagnostic(engine, runtime, tile) for tile in maps],
        "limits": [
            "Explicit current tree and actor identities; no loaded-level admission.",
            "Owned ordinary PointRegion path has no erased calls; optional supplement corroborates the retained body.",
            "Binary64 approximates x87; Float32 distance store and finite branch domain retained.",
            "No CDO/default slot0 inference when NumZones=0; explicit slot remains required for nonempty tree.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comparison-engine")
    parser.add_argument("--runtime-module", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--map",
        action="append",
        default=[],
        help="fresh saved-map diagnostic, repeatable NN_NN",
    )
    args = parser.parse_args()
    result = verify(args.comparison_engine, args.runtime_module, args.map)
    if args.check:
        print(
            f"Elbera Tools PointRegion PASS: {result['runtime']['cases']} actual-module cases/{result['runtime']['retainedInstructions']} retained instructions"
        )
        for row in result["mapDiagnostics"]:
            print(
                f"  {row['tile']}: {row['differential']['cases']} saved-map diagnostic probes PASS"
            )
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
