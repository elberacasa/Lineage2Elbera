"""Elbera Tools: retained nonzero octree query and method bindings.

Extends a supplied qualified admission/membership program. No private images
are read at import, and no original bytes are emitted or executed natively.
"""

import hashlib
import struct
from check_hair_attachment_native import compare_call_block
from check_static_sweep_native import PreparationProgram


def qualify_query(program, core, comparison, comparison_core):
    e, c, p, q = program.engine, core, comparison, comparison_core
    methods = {
        "?ActorLineCheck@FCollisionOctree@@UAEPAUFCheckResult@@AAVFMemStack@@VFVector@@11KKPAVAActor@@@Z": (
            0x106009A0,
            -64,
        ),
        "?ActorNonZeroExtentLineCheck@FOctreeNode@@QAEXPAVFCollisionOctree@@PBVFPlane@@@Z": (
            0x105FFDE0,
            -64,
        ),
        "?IsOwnedBy@AActor@@QBEHPBV1@@Z": (0x10363F10, 0),
        "?ShouldTrace@AActor@@UAEHPAV1@K@Z": (0x1052FE70, 0),
    }
    for name, (body, delta) in methods.items():
        assert e.exported(name, True) == body
        assert p.body(name) == body + delta
        assert e.exported(name) == p.exports[name]
        program.membership_targets[e.exported(name)] = body
    imports = {
        0x10600AAA: "?IsZero@FVector@@QBEHXZ",
        0x10600DB1: "??0FBox@@QAE@H@Z",
        0x10600DCB: "??YFBox@@QAEAAV0@ABVFVector@@@Z",
        0x10600DDA: "??YFBox@@QAEAAV0@ABVFVector@@@Z",
        0x1052FEF7: "?IsA@UObject@@QBEHPAVUClass@@@Z",
        0x10522313: "?GetThreadSafeMemStack@FMemStack@@AAEAAVFMemStackFrame@@XZ",
        0x1052231B: "?PushBytes@FMemStackFrame@@QAEPAEHH@Z",
    }
    proofs = []
    prior = program.receipt
    for name, start, end, delta in [
        ("nonzero node normal body", 0x105FFE01, 0x10600087, -64),
        ("query common preparation and extent branch", 0x106009C1, 0x10600AB8, -64),
        ("nonzero query box and common return", 0x10600DAD, 0x10600E70, -64),
        ("IsOwnedBy", 0x10363F10, 0x10363F30, 0),
        ("ordinary ShouldTrace normal body", 0x1052FE91, 0x1052FFEF, 0),
        ("FCheckResult constructor", 0x104419F0, 0x10441A28, 0),
        ("result allocation wrapper", 0x10522300, 0x10522322, 0),
        ("minimum hit reduction normal body", 0x105FF1D1, 0x105FF231, -64),
    ]:
        raw = bytes(e.data[e.offset(start) : e.offset(end)])
        other = bytearray(p.read(start + delta, end - start))
        rows = list(e.dis.disasm(raw, start))
        normal = []
        for i in rows:
            off = i.address - start
            if (
                i.mnemonic == "call"
                and i.bytes[0] == 0xE8
                and int(i.op_str, 16) in (0x105FE810, 0x105FE920, 0x105FEED0)
            ):
                target = int(i.op_str, 16)
                assert (
                    i.address + delta + 5 + struct.unpack_from("<i", other, off + 1)[0]
                    == target - 64
                )
                struct.pack_into("<i", other, off + 1, target - (i.address + delta + 5))
                normal.append(
                    dict(
                        address=hex(i.address),
                        kind="separately matched complete geometry helper",
                        target=hex(target),
                    )
                )
            if i.mnemonic == "push" and i.op_str == "0x10dad240":
                assert struct.unpack_from("<I", other, off + 1)[0] == 0x10DAD250
                struct.pack_into("<I", other, off + 1, 0x10DAD240)
                normal.append(
                    dict(
                        address=hex(i.address),
                        kind="previously qualified root volume cell",
                    )
                )
            if i.mnemonic == "push" and i.op_str == "0x10daf7d8":
                sym = "?PrivateStaticClass@APawn@@0VUClass@@A"
                assert e.exported(sym) == 0x10DAF7D8
                assert struct.unpack_from("<I", other, off + 1)[0] == p.exports[sym]
                struct.pack_into("<I", other, off + 1, e.exported(sym))
                normal.append(
                    dict(address=hex(i.address), kind="named class address", symbol=sym)
                )
        proof = compare_call_block(
            raw,
            bytes(other),
            owned_va=start,
            candidate_va=start + delta,
            sites=[
                (at - start, ("core.dll", sym))
                for at, sym in imports.items()
                if start <= at < end
            ],
            direct_calls=[
                i.address - start
                for i in rows
                if i.mnemonic == "call" and i.bytes[0] == 0xE8
            ],
            imports=p.imports,
        )
        proofs.append(
            dict(
                name=name,
                **PreparationProgram.add(program, e, start, end, raw),
                comparison=proof,
                normalizations=normal
            )
        )
    core = []
    for symbol, start, end in [
        ("?IsZero@FVector@@QBEHXZ", 0x1010CAE0, 0x1010CB0A),
        ("??0FBox@@QAE@H@Z", 0x101177A0, 0x101177DB),
        ("??YFBox@@QAEAAV0@ABVFVector@@@Z", 0x101177F0, 0x10117954),
    ]:
        assert c.exported(symbol, True) == q.body(symbol) == start
        raw = bytes(c.data[c.offset(start) : c.offset(end)])
        assert raw == q.read(start, len(raw))
        core.append(
            dict(symbol=symbol, **PreparationProgram.add(program, c, start, end, raw))
        )
        for at, name in imports.items():
            if name == symbol:
                program.import_targets[at] = start
    vtables = []
    for vt, offset, symbol in [
        ("??_7AActor@@6B@", 0x160, "?ShouldTrace@AActor@@UAEHPAV1@K@Z"),
        ("??_7AStaticMeshActor@@6B@", 0x160, "?ShouldTrace@AActor@@UAEHPAV1@K@Z"),
        (
            "??_7UPrimitive@@6B@",
            0x6C,
            "?LineCheck@UPrimitive@@UAEHAAUFCheckResult@@PAVAActor@@VFVector@@22KK@Z",
        ),
        (
            "??_7UStaticMesh@@6B@",
            0x6C,
            "?LineCheck@UStaticMesh@@UAEHAAUFCheckResult@@PAVAActor@@VFVector@@22KK@Z",
        ),
    ]:
        at = e.exported(vt)
        assert p.exports[vt] == at
        assert e.u32(at + offset) == p.u32(at + offset) == e.exported(symbol)
        vtables.append(
            dict(
                table=vt,
                offset=hex(offset),
                symbol=symbol,
                thunk=hex(e.exported(symbol)),
            )
        )
    thunks = []
    for at, target in [
        (0x103048D6, 0x104419F0),
        (0x1030A54C, 0x10522300),
        (0x1030BF8C, 0x105FF1B0),
    ]:
        e.instruction(at, "jmp", hex(target))
        other = list(e.dis.disasm(p.read(at, 5), at))
        assert len(other) == 1 and other[0].mnemonic == "jmp"
        expected = target - 64 if target == 0x105FF1B0 else target
        assert int(other[0].op_str, 16) == expected
        program.membership_targets[at] = target
        thunks.append(
            dict(thunk=hex(at), target=hex(target), comparisonTarget=hex(expected))
        )
    constant = bytes(e.data[e.offset(0x108D5DE0) : e.offset(0x108D5DE0) + 4])
    assert constant == p.read(0x108D5DE0, 4)

    # Keep retained normal prologues for actual wrapper execution; comparisons
    # above begin after SEH setup, consistently with the membership admission.
    for start, end in [
        (0x105FFDE0, 0x105FFE01),
        (0x106009A0, 0x106009C1),
        (0x1052FE70, 0x1052FE91),
        (0x105FF1B0, 0x105FF1D1),
    ]:
        raw = bytes(e.data[e.offset(start) : e.offset(end)])
        PreparationProgram.add(program, e, start, end, raw)
    program.query_max_time = struct.unpack("<f", constant)[0]
    program.query_imports = dict(imports)
    program.receipt = dict(
        prerequisites=prior,
        query=dict(
            engineBlocks=proofs,
            coreBlocks=core,
            vtables=vtables,
            thunks=thunks,
            minimumTimeConstant=dict(
                address="0x108d5de0",
                value=program.query_max_time,
                SHA256=hashlib.sha256(constant).hexdigest(),
            ),
            limits=[
                "Zero-extent traversal is excluded; the nonzero branch and common return are qualified.",
                "Selected SEH prefixes retained; supplemental comparisons begin after setup.",
                "Virtual ShouldTrace, primitive LineCheck and memory-stack providers require explicit responses.",
                "PC53/RNE with division-by-zero masked is conditional input, not a live FPU observation.",
            ],
        ),
    )
    return program
