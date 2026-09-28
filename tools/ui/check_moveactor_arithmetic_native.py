"""Elbera Tools: finite original MoveActor arithmetic and source boundary check.

Reads pinned sources, never executes a DLL. Uses existing retained-instruction
arithmetic; no collision, actor predicate, callback or physics result is invented.
"""

from pathlib import Path
import hashlib
import json
import math
import random
import struct
import sys
import argparse
import subprocess

TOOL_ROOT = Path(__file__).resolve().parents[2]
ROOT = TOOL_ROOT
sys.path.insert(0, str(ROOT / "tools/ui"))
ENGINE_SHA = "07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0"
COMPARISON_SHA = "508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d"


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


CORE_SHA = "9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf"
HERE = Path(__file__).resolve().parent


def raw(image, lo, hi):
    return bytes(image.data[image.offset(lo) : image.offset(hi)])


def bits(value):
    return struct.pack("<f", value).hex()


def equations(delta, location, hit_time):
    """Non-nearly-zero finite branch; input time comes from actual hit selection.

    This is only position/time arithmetic, not MoveActor or a collision response.
    Source Size stores a qword squared sum, returns a stored Float32 sqrt. Vector
    division stores reciprocal Float32 before three multiplications. The (L+2)
    addition and final time subtraction/division have no intermediate F32 store.
    """
    length = f32(math.sqrt((delta[0] ** 2 + delta[1] ** 2) + delta[2] ** 2))
    reciprocal = f32(1 / length)
    direction = [f32(v * reciprocal) for v in delta]
    padding = [f32(v * 2) for v in direction]
    extended = [f32(a + b) for a, b in zip(delta, padding)]
    query_end = [f32(a + b) for a, b in zip(location, extended)]
    adjusted = list(delta)
    time = hit_time
    if hit_time < 1:
        travel = f32((2 + length) * hit_time)
        if travel <= 2:
            adjusted, time = [0.0, 0.0, 0.0], 0.0
        else:
            adjusted = [f32(f32(v * hit_time) - p) for v, p in zip(extended, padding)]
            time = f32((travel - 2) / length)
    return dict(
        length=length,
        direction=direction,
        extended=extended,
        queryEnd=query_end,
        adjustedDelta=adjusted,
        time=time,
        location=[f32(a + b) for a, b in zip(location, adjusted)],
        returnBool=time > 0,
    )


def native_arithmetic(engine, core, delta, location, hit_time):
    from check_cast_scheduler_native import Arithmetic
    from check_bsp_camera_native import run_sweep_slice
    from check_level_collision_native import native_size

    frame, actor, hit, sp = 0x100000, 0x200000, 0x300000, 0x400000
    memory = {frame + 0x6C: hit, frame + 0x7C: 0, hit + 0x24: hit_time}
    memory.update({frame + 0x54 + 4 * i: v for i, v in enumerate(delta)})
    memory.update({actor + 0x1BC + 4 * i: v for i, v in enumerate(location)})
    machine = Arithmetic(
        engine,
        memory,
        [],
        dict(ebp=frame, esp=sp, ebx=actor, ecx=frame + 0x54, edi=hit),
    )
    visited = set()
    # Named, owned Core Size, including its QWORD intermediate and F32 result.
    length = native_size(core, machine)
    assert machine.stack.pop(0) == length and length > 0
    machine.memory[frame + 0xC] = length
    # Exact owned Core vector division. The one reverse-pop division is not
    # supported by run_sweep_slice; execute precisely that decoded instruction.
    cm = Arithmetic(core, machine.memory, [], dict(ecx=frame + 0x54, esp=sp - 16))
    cm.memory[sp - 12], cm.memory[sp - 8] = frame, length
    run_sweep_slice(core, cm, 0x1010C6D0, 0x1010C6DA)
    core.instruction(0x1010C6DA, "fdivrp", "st(1)")
    cm.stack = [cm.stack[0] / cm.stack[1]]
    cm.trace.append(0x1010C6DA)
    run_sweep_slice(core, cm, 0x1010C6DC, 0x1010C6FC)
    assert not cm.stack
    visited.update(cm.trace)
    machine.memory.update(cm.memory)
    machine.registers["eax"] = frame
    run_sweep_slice(engine, machine, 0x105C0C26, 0x105C0C37)

    def scalar_call(m, target):
        assert target == 0x10309831
        engine.instruction(target, "jmp", "0x103301a0")
        saved = m.registers["esp"]
        m.registers["esp"] -= 4  # source CALL pushes return address
        m.memory[m.registers["esp"]] = 0xFEEDFACE
        run_sweep_slice(engine, m, 0x103301A0, 0x103301C4)
        m.registers["esp"] = saved  # cdecl RET only; caller adds its own 12

    run_sweep_slice(engine, machine, 0x105C0C37, 0x105C0C80, on_call=scalar_call)
    direction = [machine.memory[frame - 0x40 + 4 * i] for i in range(3)]
    extended = [machine.memory[frame - 0x70 + 4 * i] for i in range(3)]
    run_sweep_slice(engine, machine, 0x105C0CF8, 0x105C0D37)
    query_end = [machine.memory[frame - 0xE0 + 4 * i] for i in range(3)]
    run_sweep_slice(engine, machine, 0x105C0E19, 0x105C0F28, on_call=scalar_call)
    assert not machine.stack
    adjusted = [machine.memory[frame + 0x1C + 4 * i] for i in range(3)]
    time = machine.memory[hit + 0x24]
    run_sweep_slice(engine, machine, 0x105C100E, 0x105C103B)
    stop = run_sweep_slice(
        engine, machine, 0x105C1B3E, 0x105C1B56, stop=(0x105C0FEC, 0x105C0AA2)
    )
    visited.update(machine.trace)
    return (
        dict(
            length=length,
            direction=direction,
            extended=extended,
            queryEnd=query_end,
            adjustedDelta=adjusted,
            time=time,
            location=[machine.memory[actor + 0x1BC + 4 * i] for i in range(3)],
            returnBool=stop == 0x105C0AA2,
        ),
        visited,
    )


def verify(comparison_engine=None, runtime_module=None):
    from check_tutorial_quest_native import Image
    from supplemental_pe import PEImage
    from check_hair_attachment_native import compare_call_block
    from check_cast_scheduler_native import Arithmetic
    from check_bsp_camera_native import run_sweep_slice
    from check_cylinder_collision_native import CylinderEvaluator

    e = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    c = Image(ROOT / "assets/interlude/system/core.dll", CORE_SHA)
    p = PEImage(Path(comparison_engine), COMPARISON_SHA) if comparison_engine else None
    symbol = (
        "?MoveActor@ULevel@@UAEHPAVAActor@@VFVector@@VFRotator@@AAUFCheckResult@@HHHH@Z"
    )
    assert e.exported(symbol, True) == 0x105C08E0
    core_methods = {}
    for name, body, end in [
        ("?Size@FVector@@QBEMXZ", 0x1010CA20, 0x1010CA50),
        ("?IsNearlyZero@FVector@@QBEHXZ", 0x10115FB0, 0x10116036),
        ("??KFVector@@QBE?AV0@M@Z", 0x1010C6D0, 0x1010C6FF),
    ]:
        assert c.exported(name, True) == body
        core_methods[name] = dict(
            range=[hex(body), hex(end)],
            SHA256=hashlib.sha256(raw(c, body, end)).hexdigest(),
        )
    assert e.u32(e.exported("??_7ULevel@@6BUObject@@@") + 0xA4) == e.exported(symbol)
    anchors = []
    for a, op, args in [
        (0x105C0BB0, "push", "0"),
        (0x105C0BB3, "fld1", ""),
        (0x105C0BBE, "call", "0x103048d6"),
        (0x103048D6, "jmp", "0x104419f0"),
        (0x105C0C37, "fld", "dword ptr [0x10884cf0]"),
        (0x105C0C8F, "test", "byte ptr [ebx + 0x2f8], 3"),
        (0x105C0C9E, "call", "0x103148c6"),
        (0x105C0CA5, "jne", "0x105c0e16"),
        (0x105C0CD1, "mov", "byte ptr [ebp + 0x47], 1"),
        (0x105C0CD5, "or", "byte ptr [ebp + 0x47], 0x18"),
        (0x105C0CE0, "or", "byte ptr [ebp + 0x47], 0x86"),
        (0x105C0DAC, "call", "edx"),
        (0x105C0DB1, "test", "byte ptr [ebx + 0x2f8], 0xe"),
        (0x105C0DD2, "call", "0x1030ec5f"),
        (0x105C0DE3, "call", "0x1030ec5f"),
        (0x105C0DF0, "mov", "dword ptr [ebp - 0x50], 1"),
        (0x105C0DFD, "call", "0x10308bde"),
        (0x105C0E14, "rep movsd", "dword ptr es:[edi], dword ptr [esi]"),
        (0x105C0E3E, "cmp", "dword ptr [ebp + 0x7c], 0"),
        (0x105C0E53, "fstp", "dword ptr [ebp + 0x40]"),
        (0x105C0E60, "jp", "0x105c0e9f"),
        (0x105C0F25, "fstp", "dword ptr [edi + 0x24]"),
        (0x105C0F3E, "call", "0x103148c6"),
        (0x105C0FC2, "mov", "edx, dword ptr [edx + 0xd8]"),
        (0x105C1009, "mov", "eax, dword ptr [edx + 0xc]"),
        (0x105C1017, "fstp", "dword ptr [ebx + 0x1bc]"),
        (0x105C1063, "cmp", "dword ptr [ebx + 0x1f4], 0"),
        (0x105C106A, "jle", "0x105c193f"),
        (0x105C1949, "test", "dword ptr [ebx + 0x64], 0x4000"),
        (0x105C19E9, "call", "0x10312837"),
        (0x105C1A04, "mov", "eax, dword ptr [edx + 8]"),
        (0x105C1A1D, "test", "byte ptr [eax + 0x74], 2"),
        (0x105C1A38, "mov", "eax, dword ptr [edx + 0x168]"),
        (0x105C1A48, "mov", "edx, dword ptr [edx + 0x168]"),
        (0x105C1A81, "jne", "0x105c1abb"),
        (0x105C1A9E, "call", "0x10308bde"),
        (0x105C1AB2, "call", "0x1030dd96"),
        (0x105C1AE0, "call", "0x103132e1"),
        (0x105C1AF6, "call", "0x10309e44"),
        (0x105C1B0C, "mov", "eax, dword ptr [edx + 0x1bc]"),
        (0x105C1B23, "call", "0x10301226"),
        (0x105C1B4B, "jp", "0x105c0fec"),
    ]:
        e.instruction(a, op, args)
        anchors.append([hex(a), op, args])
    assert struct.unpack("<f", raw(e, 0x10884CF0, 0x10884CF4))[0] == 2
    direct = []
    for stub in [
        0x103148C6,
        0x1030EC5F,
        0x10308BDE,
        0x10312837,
        0x10301226,
        0x103133A9,
        0x1030DD96,
        0x103132E1,
        0x10309E44,
    ]:
        names = [n for n in e.exports if e.exported(n) == stub]
        assert len(names) == 1
        direct.append(
            dict(stub=hex(stub), body=hex(e.exported(names[0], True)), name=names[0])
        )
    vtables = []
    for table in ["??_7AActor@@6B@", "??_7APawn@@6B@"]:
        for slot in [0x168, 0x1BC, 0x6C, 0x2E0, 0x2E4, 0x2F4]:
            address = e.u32(e.exported(table) + slot)
            names = [n for n in e.exports if e.exported(n) == address]
            assert len(names) == 1
            vtables.append(
                dict(
                    table=table,
                    slot=hex(slot),
                    name=names[0],
                    body=hex(e.exported(names[0], True)),
                )
            )
    comparisons = []
    for label, lo, hi, shift, imports in (
        []
        if p is None
        else [
            (
                "metric/padding",
                0x105C0BCF,
                0x105C0C80,
                -0x40,
                {
                    0x105C0BD2: "?IsNearlyZero@FVector@@QBEHXZ",
                    0x105C0BE6: "?Size@FVector@@QBEMXZ",
                    0x105C0C20: "??KFVector@@QBE?AV0@M@Z",
                },
            ),
            ("query/filter/backoff", 0x105C0D9E, 0x105C0F28, -0x40, {}),
            ("actor location and rotation writes", 0x105C0FF3, 0x105C107A, -0x40, {}),
            (
                "ordinary no-children suffix",
                0x105C193F,
                0x105C1B28,
                -0x40,
                {
                    0x105C1961: "??0FName@@QAE@W4EName@@@Z",
                    0x105C1971: "??8FName@@QBEHABV0@@Z",
                    0x105C19DD: "??9FRotator@@QBEHABV0@@Z",
                    0x105C1B17: "?Pop@FMemMark@@QAEXXZ",
                },
            ),
            ("return predicate", 0x105C1B3E, 0x105C1B56, -0x40, {}),
            ("IsBlockedBy whole normal body", 0x1052E110, 0x1052E263, 0, {}),
        ]
    ):
        data = raw(e, lo, hi)
        direct_sites = [
            i.address - lo
            for i in e.dis.disasm(data, lo)
            if i.mnemonic == "call" and bytes(i.bytes)[:1] == b"\xe8"
        ]
        # Query block contains one relocated GMem import operand, separately
        # qualified below, not a restored erased call or generic normalization.
        other = bytearray(p.read(lo + shift, hi - lo))
        if label == "query/filter/backoff":
            assert lo == 0x105C0D9E
            assert e.dis is not None
            assert p.imports[0x11D8DC38] == ("core.dll", "?GMem@@3VFMemStack@@A")
            assert data[:5] == bytes.fromhex("a13cdcd811")
            assert other[:5] == bytes.fromhex("a138dcd811")
            other[1:5] = data[1:5]
        result = compare_call_block(
            data,
            bytes(other),
            owned_va=lo,
            candidate_va=lo + shift,
            sites=[(a - lo, ("core.dll", name)) for a, name in imports.items()],
            direct_calls=direct_sites,
            imports=p.imports,
        )
        comparisons.append(
            dict(
                label=label,
                range=[hex(lo), hex(hi)],
                ownedSHA256=hashlib.sha256(data).hexdigest(),
                supplementalSHA256=hashlib.sha256(
                    p.read(lo + shift, hi - lo)
                ).hexdigest(),
                explicitOperandNormalization=(
                    [
                        {
                            "ownedIAT": "0x11d8dc3c",
                            "supplementalIAT": "0x11d8dc38",
                            "name": "Core.GMem",
                            "instruction": "mov eax, [IAT]",
                        }
                    ]
                    if label == "query/filter/backoff"
                    else []
                ),
                **result
            )
        )
    # Reuse the existing exact FCheckResult constructor evaluator with this
    # caller's Time=1 argument, rather than copying a presumed initial record.
    ctor = CylinderEvaluator(e, c)
    sp, result = 0x200000, 0x300000
    cm = Arithmetic(e, {sp: 1.0, sp + 4: 0}, [], dict(esp=sp, ecx=result, eax=0))
    ctor.call(cm, "result")
    initial_result = ctor.result(cm, result)
    assert initial_result == dict(
        time=1.0,
        point=[0.0, 0.0, 0.0],
        normal=[0.0, 0.0, 0.0],
        actor=None,
        item=0,
        nodeIndex=-1,
        next=None,
        material=None,
    )
    nearly_cases = 0
    threshold = struct.unpack("<d", raw(c, 0x101CE290, 0x101CE298))[0]
    assert threshold == 0.0001
    near_word = struct.unpack("<I", struct.pack("<f", threshold))[0]
    values = [
        0.0,
        -0.0,
        f32(threshold),
        -f32(threshold),
        struct.unpack("<f", struct.pack("<I", near_word + 1))[0],
        0.001,
    ]
    for axis in range(3):
        for value in values:
            vec = [0.0, 0.0, 0.0]
            vec[axis] = value
            addr, sp = 0x100000, 0x200000
            nm = Arithmetic(
                c,
                {addr + i * 4: v for i, v in enumerate(vec)},
                [],
                dict(ecx=addr, esp=sp),
            )
            stop = run_sweep_slice(
                c, nm, 0x10115FB0, 0x10116036, stop=(0x10116027, 0x10116032)
            )
            assert (stop == 0x10116027) == all(abs(v) < threshold for v in vec)
            nearly_cases += 1
    rng = random.Random(202610)
    vectors = [
        [3.0, 4.0, 0.0],
        [-3.0, 0.0, 4.0],
        [f32(0.001), 0.0, 0.0],
        [1.0, -0.0, 0.0],
        [f32(1e6), f32(-0.1), f32(17.3)],
    ]
    vectors += [[f32(rng.uniform(-1000, 1000)) for _ in range(3)] for _ in range(100)]
    cases = 0
    runtime_cases = []
    visited = set()
    samples = []
    for delta in vectors:
        assert any(abs(v) >= threshold for v in delta)
        length = f32(math.sqrt(sum(v * v for v in delta)))
        boundary = f32(2 / (2 + length))
        word = struct.unpack("<I", struct.pack("<f", boundary))[0]
        times = [
            0.0,
            -0.0,
            1.0,
            f32(0.5),
            boundary,
            struct.unpack("<f", struct.pack("<I", word - 1))[0],
            struct.unpack("<f", struct.pack("<I", word + 1))[0],
        ]
        for time in times:
            loc = [f32(rng.uniform(-100000, 100000)) for _ in range(3)]
            actual, trace = native_arithmetic(e, c, delta, loc, time)
            expected = equations(delta, loc, time)
            for key in actual:
                a, b = actual[key], expected[key]
                if isinstance(a, list):
                    assert list(map(bits, a)) == list(map(bits, b)), (key, a, b)
                elif isinstance(a, bool):
                    assert a == b
                else:
                    assert bits(a) == bits(b), (key, a, b)
            runtime_cases.append(
                dict(delta=delta, start=loc, time=time, expected=actual)
            )
            cases += 1
            visited.update(trace)
            if len(samples) < 7:
                samples.append(dict(delta=delta, hitTime=time, result=actual))
    return dict(
        status="PASS",
        engineSHA256=ENGINE_SHA,
        coreSHA256=CORE_SHA,
        supplementalEngineSHA256=COMPARISON_SHA if p else None,
        importStatus=(
            "qualified-supplemental-correspondence"
            if p
            else "conditional-erased-import-bindings"
        ),
        runtime=check_runtime(
            runtime_module or TOOL_ROOT / "editor/world/js/moveactor-arithmetic.js",
            runtime_cases,
        ),
        anchors=anchors,
        anchorCount=len(anchors),
        directBindings=direct,
        vtables=vtables,
        comparisons=comparisons,
        initialResult=initial_result,
        ownedCoreMethods=core_methods,
        nearlyZeroCases=nearly_cases,
        arithmetic=dict(
            cases=cases, instructionAddresses=len(visited), samples=samples
        ),
        limits=[
            "finite non-nearly-zero delta arithmetic only; not complete MoveActor",
            "Float64 approximation of x87 intermediates and named mathematical sqrt boundary",
            "supplemental correspondence is not owned import restoration/authentication",
            "actor predicates, actual collision state, bump/touch/zone callbacks remain required",
            "no attached-child movement, encroachment or changed-rotation path admitted",
        ],
    )


def check_runtime(module, cases):
    """Actual JS module receives/returns explicit Float32 words, preserving -0."""
    payload = [
        dict(
            start=list(map(bits, c["start"])),
            delta=list(map(bits, c["delta"])),
            time=bits(c["time"]),
        )
        for c in cases
    ]
    program = r"""
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
const {prepareMoveActorSweep,finishMoveActorSweep}=await import(pathToFileURL(process.argv[1]));
const decode=x=>Buffer.from(x,'hex').readFloatLE(0);
const bits=x=>{const b=Buffer.alloc(4);b.writeFloatLE(x);return b.toString('hex');};
const rows=JSON.parse(fs.readFileSync(0,'utf8')).map(c=>{
 const start=c.start.map(decode),delta=c.delta.map(decode),t=decode(c.time);
 const p=prepareMoveActorSweep({start,delta});
 if(p.status!=='ready')throw Error('prepared fixture unsupported: '+p.reason);
 const r=finishMoveActorSweep(p,{time:t},{arg4:0});
 if(r.status!=='ready')throw Error('result fixture unsupported: '+r.reason);
 return {length:bits(p.length),direction:p.direction.map(bits),extended:p.extendedDelta.map(bits),
  queryEnd:p.query.end.map(bits),adjustedDelta:r.adjustedDelta.map(bits),
  location:r.preCallbackLocation.map(bits),time:bits('time' in r.hitWrites?r.hitWrites.time:t),
  returnBool:r.returnPredicate,hitWrites:Object.fromEntries(Object.entries(r.hitWrites).map(([k,v])=>[k,bits(v)]))};
});
process.stdout.write(JSON.stringify(rows));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", program, str(Path(module).resolve())],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
    )
    rows = json.loads(result.stdout)
    assert len(rows) == len(cases)
    for index, (case, actual) in enumerate(zip(cases, rows)):
        expected = {
            k: (
                [bits(v) for v in value]
                if isinstance(value, list)
                else value if isinstance(value, bool) else bits(value)
            )
            for k, value in case["expected"].items()
        }
        expected["hitWrites"] = (
            {"time": bits(case["expected"]["time"])} if case["time"] < 1 else {}
        )
        assert actual == expected, (index, actual, expected)
    return dict(
        status="PASS",
        cases=len(rows),
        float32Comparison="exact-bits-including-signed-zero",
        sparseWrites="Time-only-when-selected-Time<1",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", required=True)
    parser.add_argument("--comparison-engine", type=Path)
    parser.add_argument("--runtime-module", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.comparison_engine, args.runtime_module), indent=2))


if __name__ == "__main__":
    main()
