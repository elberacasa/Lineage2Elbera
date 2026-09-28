"""Elbera Tools: source joins for ordinary octree actor admission and updates.

Extends the qualified geometry/membership program. Images are supplied by the
caller; no files are loaded at import. Diagnostic, primitive-response and live
state boundaries remain explicit in the composed verifier.
"""

import struct

from check_hair_attachment_native import compare_call_block
from check_static_sweep_native import PreparationProgram
from actor_octree_membership_source import EXPAND, CENTER, ARRAY_EMPTY

ASSERT = "?appFailAssert@@YAXPBD0H@Z"
NAME = "?GetName@UObject@@QBEPBGXZ"
LOG = "?Logf2@FOutputDevice@@QAAXPBGZZ"
EQUAL = "??8FVector@@QBEHABV0@@Z"
UNEQUAL = "??9FVector@@QBEHABV0@@Z"
BOX_CTOR = "??0FBox@@QAE@ABVFVector@@0@Z"
IMPORTS = {
    0x10602B79: ASSERT,
    0x10602BBC: NAME,
    0x10602BD1: LOG,
    0x10602C1F: EXPAND,
    0x10602C46: CENTER,
    0x10602D31: EQUAL,
    0x10602D4A: ASSERT,
    0x10602D83: NAME,
    0x10602D98: LOG,
    0x10602623: ASSERT,
    0x1060263F: UNEQUAL,
    0x1060264C: EQUAL,
    0x10602665: ASSERT,
    0x1060267A: NAME,
    0x1060268F: LOG,
    0x106026C7: ASSERT,
    0x106026F1: ARRAY_EMPTY,
    0x103778EA: ASSERT,
    0x106455CA: BOX_CTOR,
}
METHODS = {
    "?AddActor@FCollisionOctree@@UAEXPAVAActor@@@Z": (0x10602B30, -64),
    "?RemoveActor@FCollisionOctree@@UAEXPAVAActor@@@Z": (0x106025E0, -64),
    "?GetLevelInfo@ULevel@@QAEPAVALevelInfo@@XZ": (0x103778D0, 0),
    "?GetPrimitive@AActor@@UAEPAVUPrimitive@@XZ": (0x1052DFB0, 0),
    "?GetCollisionBoundingBox@UPrimitive@@UBE?AVFBox@@PBVAActor@@@Z": (0x106454F0, -64),
}


def qualify_admission(program, core, comparison, comparison_core):
    engine, prior = program.engine, program.receipt
    blocks, core_blocks, vtables, joins = [], [], [], []
    for symbol, (start, delta) in METHODS.items():
        assert engine.exported(symbol, True) == start
        assert comparison.body(symbol) == start + delta
        thunk = engine.exported(symbol)
        assert comparison.exports[symbol] == thunk
        program.membership_targets[thunk] = start
        joins.append(dict(symbol=symbol, thunk=hex(thunk), target=hex(start)))
    for name, start, body, end, delta in [
        ("AddActor", 0x10602B30, 0x10602B51, 0x10602DB5, -64),
        ("RemoveActor", 0x106025E0, 0x10602601, 0x10602711, -64),
        ("GetLevelInfo", 0x103778D0, 0x103778D0, 0x10377900, 0),
        ("ordinary GetPrimitive", 0x1052DFB0, 0x1052DFB0, 0x1052DFDF, 0),
        (
            "generic primitive box, nonnull owner",
            0x106454F0,
            0x10645511,
            0x106455E6,
            -64,
        ),
    ]:
        full = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        raw = full[body - start :]
        other = bytearray(comparison.read(body + delta, len(raw)))
        normal = []
        for i in engine.dis.disasm(raw, body):
            off = i.address - body
            if i.mnemonic == "mov" and "ptr [0x11d" in i.op_str:
                at = int(i.op_str[i.op_str.index("[") + 1 : -1], 16)
                assert at in (0x11D8DBE4, 0x11D8D6D4)
                symbol = (
                    "?GIsEditor@@3HA"
                    if at == 0x11D8DBE4
                    else "?GLog@@3PAVFOutputDevice@@A"
                )
                pos = 1 if i.bytes[0] == 0xA1 else 2
                assert struct.unpack_from("<I", other, off + pos)[0] == at - 4
                assert comparison.imports[at - 4] == ("core.dll", symbol)
                struct.pack_into("<I", other, off + pos, at)
                normal.append(
                    dict(address=hex(i.address), kind="named global IAT", symbol=symbol)
                )
            elif i.mnemonic == "push" and i.op_str == "0x10dad240":
                assert struct.unpack_from("<I", other, off + 1)[0] == 0x10DAD250
                struct.pack_into("<I", other, off + 1, 0x10DAD240)
                normal.append(
                    dict(address=hex(i.address), kind="qualified root-volume cell")
                )
        rows = list(engine.dis.disasm(raw, body))
        proof = compare_call_block(
            raw,
            bytes(other),
            owned_va=body,
            candidate_va=body + delta,
            sites=[
                (at - body, ("core.dll", symbol))
                for at, symbol in IMPORTS.items()
                if body <= at < end
            ],
            direct_calls=[
                i.address - body
                for i in rows
                if i.mnemonic == "call" and i.bytes[0] == 0xE8
            ],
            imports=comparison.imports,
        )
        blocks.append(
            dict(
                name=name,
                **PreparationProgram.add(program, engine, start, end, full),
                comparisonStart=hex(body),
                comparison=proof,
                normalizedOperands=normal
            )
        )
    for symbol, start, end in [
        (EQUAL, 0x1010C740, 0x1010C77C),
        (UNEQUAL, 0x1010C790, 0x1010C7CC),
        (BOX_CTOR, 0x1010EF80, 0x1010EFB2),
    ]:
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, len(raw))
        core_blocks.append(
            dict(
                symbol=symbol, **PreparationProgram.add(program, core, start, end, raw)
            )
        )
        for at, name in IMPORTS.items():
            if name == symbol:
                program.import_targets[at] = start
    for vt, offset, method in [
        (
            "??_7FCollisionOctree@@6B@",
            12,
            "?RemoveActor@FCollisionOctree@@UAEXPAVAActor@@@Z",
        ),
        ("??_7AActor@@6B@", 0x164, "?GetPrimitive@AActor@@UAEPAVUPrimitive@@XZ"),
        (
            "??_7AStaticMeshActor@@6B@",
            0x164,
            "?GetPrimitive@AActor@@UAEPAVUPrimitive@@XZ",
        ),
        (
            "??_7UPrimitive@@6B@",
            0x78,
            "?GetCollisionBoundingBox@UPrimitive@@UBE?AVFBox@@PBVAActor@@@Z",
        ),
    ]:
        address = engine.exported(vt)
        assert comparison.exports[vt] == address
        assert (
            engine.u32(address + offset)
            == comparison.u32(address + offset)
            == engine.exported(method)
        )
        vtables.append(
            dict(
                symbol=vt,
                table=hex(address),
                offset=hex(offset),
                method=method,
                thunk=hex(engine.exported(method)),
            )
        )
    program.admission_imports = dict(IMPORTS)
    program.receipt = dict(
        prerequisites=prior,
        admission=dict(
            engineBlocks=blocks,
            coreBlocks=core_blocks,
            namedJoins=joins,
            vtables=vtables,
            limits=[
                "Selected SEH prefixes retained from pinned owned image; supplemental comparisons start after setup.",
                "Generic UPrimitive bounding box includes only nonnull-owner path; null-owner branch is unadmitted.",
                "Virtual selector/bounds overrides, logging and assertion handlers are not assumed ordinary methods.",
                "Matched root initializer does not establish live process startup/current state.",
            ],
        ),
    )
    return program
