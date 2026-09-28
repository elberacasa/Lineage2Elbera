"""Elbera Tools: original actor bounds and octree membership source bindings.

Extends the octree geometry program without loading images at import. These
bounded slices do not establish live actor membership or native allocation.
"""

import hashlib
import struct

from check_hair_attachment_native import compare_call_block
from check_static_sweep_native import PreparationProgram

EXPAND = "?ExpandBy@FBox@@QBE?AV1@M@Z"
CENTER = "?GetCenterAndExtents@FBox@@QBEXAAVFVector@@0@Z"
IMPORTS = {0x10602C1F: EXPAND, 0x10602C46: CENTER}


def qualify_bounds(program, core, comparison_engine, comparison_core):
    engine = program.engine
    geometry_receipt = program.receipt
    engine_blocks, core_blocks, constants = [], [], []
    for name, start, end in [
        ("primitive bounding-box dispatch", 0x10602BE4, 0x10602BFE),
        ("expanded bounds and cached center/extent", 0x10602BFE, 0x10602C4C),
        ("root bounds overlap", 0x10602C4C, 0x10602CC4),
        ("rejected bounds FPU cleanup", 0x10602D6E, 0x10602D76),
    ]:
        raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        proof = compare_call_block(
            raw,
            comparison_engine.read(start - 0x40, end - start),
            owned_va=start,
            candidate_va=start - 0x40,
            sites=[
                (at - start, ("core.dll", symbol))
                for at, symbol in IMPORTS.items()
                if start <= at < end
            ],
            direct_calls=[],
            imports=comparison_engine.imports,
        )
        engine_blocks.append(
            dict(
                name=name,
                **PreparationProgram.add(program, engine, start, end, raw),
                comparison=proof
            )
        )
    for symbol, start, end in [
        (EXPAND, 0x1010F0A0, 0x1010F10F),
        (CENTER, 0x1010F210, 0x1010F2B6),
    ]:
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        core_blocks.append(
            dict(
                symbol=symbol, **PreparationProgram.add(program, core, start, end, raw)
            )
        )
        for at, name in IMPORTS.items():
            if name == symbol:
                program.import_targets[at] = start
    program.bounds_constants = {}
    for source, other, at, kind, meaning in [
        (engine, comparison_engine, 0x108D6A34, "f", "AddActor expansion"),
        (engine, comparison_engine, 0x108D6A30, "f", "root overlap lower bound"),
        (engine, comparison_engine, 0x108D6A2C, "f", "root overlap upper bound"),
        (core, comparison_core, 0x101CDEA0, "d", "Core center/extent half"),
    ]:
        raw = bytes(
            source.data[source.offset(at) : source.offset(at) + struct.calcsize(kind)]
        )
        assert raw == other.read(at, len(raw))
        value = struct.unpack("<" + kind, raw)[0]
        program.bounds_constants[at] = value
        constants.append(
            dict(
                address=hex(at),
                kind=kind,
                value=value,
                meaning=meaning,
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    name = "?AddActor@FCollisionOctree@@UAEXPAVAActor@@@Z"
    assert engine.exported(name, True) == 0x10602B30
    assert comparison_engine.body(name) == 0x10602AF0
    program.receipt = dict(
        geometry=geometry_receipt,
        bounds=dict(
            engineBlocks=engine_blocks,
            coreBlocks=core_blocks,
            constants=constants,
            namedAddActor=dict(
                symbol=name, owned="0x10602b30", comparison="0x10602af0"
            ),
            ownedCoreSHA256=core.sha,
            comparisonCoreSHA256=comparison_core.sha,
            limits=[
                "Primitive bounding-box response is supplied; its virtual implementation is not executed.",
                "No flags, membership removal, level-mode selection or insertion execution in this bounds check.",
                "FBox validity byte is written by ExpandBy; opaque padding bytes are outside the numeric comparison.",
            ],
        ),
    )
    return program


# Bounded membership operations. Their full normal instructions are retained
# for interpretation; supplemental comparisons start after SEH setup where
# specified. Exception-handler identities and unwinding remain outside scope.
MEMBERSHIP_REGIONS = [
    ("allocator forwarding", 0x10329E10, 0x10329E28, 0x10329E10, 0),
    ("node construction", 0x10601A10, 0x10601A68, 0x10601A31, -0x40),
    ("store and redistribute actor", 0x10601D20, 0x10601E97, 0x10601D41, -0x40),
    ("single-node filter", 0x10602960, 0x106029F2, 0x10602981, -0x40),
    ("multi-node filter", 0x105FEB40, 0x105FEBF9, 0x105FEB61, -0x40),
    ("append actor pointer", 0x1037AE60, 0x1037AE7C, 0x1037AE60, 0),
    ("append node pointer", 0x104225E0, 0x104225FC, 0x104225E0, 0),
    ("remove actor pointer occurrences", 0x104E9650, 0x104E968D, 0x104E9650, 0),
    ("remove node pointer occurrences", 0x106016A0, 0x106016DD, 0x106016A0, -0x40),
    ("copy actor-pointer array", 0x1032BEF0, 0x1032BF77, 0x1032BF07, 0),
    ("clear temporary actor-pointer array", 0x10326630, 0x103266C0, 0x10326648, 0),
    ("remove actor pointer slice", 0x10326200, 0x10326274, 0x10326200, 0),
    ("remove node pointer slice", 0x103256B0, 0x10325724, 0x103256B0, 0),
    ("RemoveActor membership body", 0x10602698, 0x106026F7, 0x10602698, -0x40),
]
ARRAY_ADD = "?Add@FArray@@QAEHHH@Z"
ARRAY_EMPTY = "?Empty@FArray@@QAEXHH@Z"
ARRAY_REMOVE = "?Remove@FArray@@QAEXHHH@Z"
ARRAY_CTOR = "??0FArray@@IAE@HH@Z"
ARRAY_DEFAULT = "??0FArray@@QAE@XZ"
ARRAY_DTOR = "??1FArray@@QAE@XZ"
MEMBERSHIP_IMPORTS = {
    0x10601A36: ARRAY_DEFAULT,
    0x10601DF0: ARRAY_EMPTY,
    0x1037AE67: ARRAY_ADD,
    0x104225E7: ARRAY_ADD,
    0x1032BF19: ARRAY_CTOR,
    0x1032BF3B: ARRAY_ADD,
    0x10326698: ARRAY_REMOVE,
    0x103266A8: ARRAY_DTOR,
    0x10326267: ARRAY_REMOVE,
    0x10325717: ARRAY_REMOVE,
    0x106026F1: ARRAY_EMPTY,
    0x106026C7: "?appFailAssert@@YAXPBD0H@Z",
}
MEMBERSHIP_CORE = [
    (ARRAY_ADD, 0x101090C0, 0x101090F8),
    (ARRAY_EMPTY, 0x101091C0, 0x101091DB),
    (ARRAY_DEFAULT, 0x101091F0, 0x101091FD),
    (ARRAY_DTOR, 0x10109210, 0x1010923D),
    (ARRAY_CTOR, 0x10109280, 0x101092A3),
    (ARRAY_REMOVE, 0x101523C0, 0x10152437),
    ("?Realloc@FArray@@IAEXH@Z", 0x101522E0, 0x10152346),
]
MEMBERSHIP_THUNKS = {
    0x1030D733: 0x10329E10,
    0x103020C7: 0x10601A10,
    0x1030525E: 0x10601D20,
    0x10303CF1: 0x10602960,
    0x1030AF1A: 0x105FEB40,
    0x1031109F: 0x1037AE60,
    0x1031502D: 0x104225E0,
    0x1030F952: 0x104E9650,
    0x103013A2: 0x106016A0,
    0x103083C3: 0x1032BEF0,
    0x1030FF06: 0x10326630,
    0x1030FCD6: 0x10326200,
    0x1030314D: 0x103256B0,
}


def qualify_membership(program, core, comparison_engine, comparison_core):
    """Qualify membership code for the next composed lifecycle comparison.

    This source check alone makes no browser membership or allocation claim.
    """
    engine = program.engine
    prior_receipt = program.receipt
    engine_blocks, core_blocks, joins = [], [], []
    named = {
        "??0FOctreeNode@@QAE@XZ": 0x10601A10,
        "?StoreActor@FOctreeNode@@AAEXPAVAActor@@PAVFCollisionOctree@@PBVFPlane@@@Z": 0x10601D20,
        "?RemoveActor@FCollisionOctree@@UAEXPAVAActor@@@Z": 0x106025E0,
    }
    for symbol, at in named.items():
        assert engine.exported(symbol, True) == at
        assert comparison_engine.body(symbol) == at - 0x40
    # Only the ordinary forward construction loop is compared here. The
    # compiler's exception-frame setup and unwinding are outside this boundary.
    start, end = 0x107A6757, 0x107A6784
    raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
    assert raw == comparison_engine.read(start - 0x40, end - start)
    vector_loop = PreparationProgram.add(program, engine, start, end, raw)
    engine.instruction(0x107A6795, "ret", "0x14")
    row = next(engine.dis.disasm(comparison_engine.read(0x107A6755, 3), 0x107A6755))
    assert row.mnemonic == "ret" and row.op_str == "0x14"
    helper_starts = {0x105FE810, 0x105FE890, 0x105FE920, 0x105FEAA0, 0x107A674B}
    for name, start, end, comparison_start, delta in MEMBERSHIP_REGIONS:
        full = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        raw = full[comparison_start - start :]
        other = bytearray(comparison_engine.read(comparison_start + delta, len(raw)))
        rows = list(engine.dis.disasm(raw, comparison_start))
        normalized = []
        for ins in rows:
            off = ins.address - comparison_start
            if ins.address == 0x10329E10:
                assert ins.op_str == "eax, dword ptr [0x11d8d6a4]"
                assert struct.unpack_from("<I", other, off + 1)[0] == 0x11D8D6A0
                assert comparison_engine.imports[0x11D8D6A0] == (
                    "core.dll",
                    "?GMalloc@@3PAVFMalloc@@A",
                )
                struct.pack_into("<I", other, off + 1, 0x11D8D6A4)
                normalized.append(
                    dict(address=hex(ins.address), kind="named GMalloc IAT read")
                )
            if (
                ins.mnemonic == "call"
                and bytes(ins.bytes)[:1] == b"\xe8"
                and int(ins.op_str, 16) in helper_starts
            ):
                target = int(ins.op_str, 16)
                candidate_at = ins.address + delta
                assert other[off] == 0xE8
                assert (
                    candidate_at + 5 + struct.unpack_from("<i", other, off + 1)[0]
                    == target - 0x40
                )
                struct.pack_into("<i", other, off + 1, target - (candidate_at + 5))
                normalized.append(
                    dict(
                        address=hex(ins.address),
                        kind="matched geometry helper or bounded vector-construction loop target",
                    )
                )
            if ins.address in (0x10326202, 0x103256B2, 0x1032665C):
                assert ins.mnemonic == "mov" and "dword ptr [0x11d8d6b0]" in ins.op_str
                assert struct.unpack_from("<I", other, off + 2)[0] == 0x11D8D6AC
                symbol = comparison_engine.imports[0x11D8D6AC]
                assert symbol[0].lower() == "core.dll" and symbol[1].startswith(
                    "?appFailAssert@@"
                )
                struct.pack_into("<I", other, off + 2, 0x11D8D6B0)
                normalized.append(
                    dict(
                        address=hex(ins.address),
                        kind="assertion IAT read",
                        symbol=symbol,
                    )
                )
            if ins.address == 0x10601DB8:
                assert (
                    ins.mnemonic == "add"
                    and ins.op_str == "dword ptr [0x10dad23c], 0x80"
                )
                assert struct.unpack_from("<I", other, off + 2)[0] == 0x10DAD24C
                struct.pack_into("<I", other, off + 2, 0x10DAD23C)
                normalized.append(
                    dict(
                        address=hex(ins.address),
                        kind="node allocation statistics cell",
                        owned="0x10dad23c",
                        comparison="0x10dad24c",
                    )
                )
        proof = compare_call_block(
            raw,
            bytes(other),
            owned_va=comparison_start,
            candidate_va=comparison_start + delta,
            sites=[
                (at - comparison_start, ("core.dll", symbol))
                for at, symbol in MEMBERSHIP_IMPORTS.items()
                if comparison_start <= at < end
            ],
            direct_calls=[
                i.address - comparison_start
                for i in rows
                if i.mnemonic == "call" and bytes(i.bytes)[:1] == b"\xe8"
            ],
            imports=comparison_engine.imports,
        )
        engine_blocks.append(
            dict(
                name=name,
                **PreparationProgram.add(program, engine, start, end, full),
                comparisonStart=hex(comparison_start),
                comparison=proof,
                normalizedOperands=normalized
            )
        )
    for symbol, start, end in MEMBERSHIP_CORE:
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        core_blocks.append(
            dict(
                symbol=symbol, **PreparationProgram.add(program, core, start, end, raw)
            )
        )
        for at, name in MEMBERSHIP_IMPORTS.items():
            if name == symbol:
                program.import_targets[at] = start
    deltas = {start: delta for _, start, _, _, delta in MEMBERSHIP_REGIONS}
    program.membership_targets = dict(MEMBERSHIP_THUNKS)
    for at, target in MEMBERSHIP_THUNKS.items():
        engine.instruction(at, "jmp", hex(target))
        row = next(engine.dis.disasm(comparison_engine.read(at, 5), at))
        assert row.mnemonic == "jmp" and int(row.op_str, 16) == target + deltas[target]
        joins.append(
            dict(
                address=hex(at),
                target=hex(target),
                comparisonTarget=hex(target + deltas[target]),
            )
        )
    for symbol, at, target in [
        ("?Realloc@FArray@@IAEXH@Z", 0x101031D9, 0x101522E0),
        ("?appMemmove@@YAPAXPAXPBXH@Z", 0x1010177B, 0x1012DA10),
    ]:
        assert core.exported(symbol) == comparison_core.exports[symbol] == at
        assert core.exported(symbol, True) == comparison_core.body(symbol) == target
        core.instruction(at, "jmp", hex(target))
        program.membership_targets[at] = target
        joins.append(dict(address=hex(at), target=hex(target), symbol=symbol))
    assert core.exported("?GMalloc@@3PAVFMalloc@@A") == 0x10235034
    assert comparison_core.exports["?GMalloc@@3PAVFMalloc@@A"] == 0x10235034
    # The original root-volume initializer writes all four fields. Merely
    # qualifying it does not observe its execution or the current global state.
    start, end = 0x108464A0, 0x108464C1
    raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
    other = bytearray(comparison_engine.read(start - 0x40, end - start))
    for offset, value in [
        (4, 0x10DAD240),
        (10, 0x10DAD244),
        (16, 0x10DAD248),
        (28, 0x10DAD24C),
    ]:
        assert struct.unpack_from("<I", raw, offset)[0] == value
        assert struct.unpack_from("<I", other, offset)[0] == value + 16
        struct.pack_into("<I", other, offset, value)
    assert raw == bytes(other)
    root = PreparationProgram.add(program, engine, start, end, raw)
    at = 0x10883C40
    raw = bytes(engine.data[engine.offset(at) : engine.offset(at) + 8])
    assert raw == comparison_engine.read(at, 8)
    split = struct.unpack("<d", raw)[0]
    program.membership_constants = {at: split}
    program.receipt = dict(
        prerequisites=prior_receipt,
        membership=dict(
            namedBodies={symbol: hex(at) for symbol, at in named.items()},
            engineBlocks=engine_blocks,
            coreBlocks=core_blocks,
            joins=joins,
            vectorConstructionLoop=vector_loop,
            rootInitializer=root,
            rootCellCorrespondence=dict(owned="0x10dad240", comparison="0x10dad250"),
            splitConstant=dict(
                address=hex(at), value=split, SHA256=hashlib.sha256(raw).hexdigest()
            ),
            limits=[
                "Source qualification only until joined membership execution is added.",
                "SEH setup prefixes retained from pinned owned source but omitted from supplemental body comparisons.",
                "Allocator virtual responses and appMemmove remain explicit external boundaries; no actual heap or CRT execution.",
                "Vector construction is limited to its matched forward loop; compiler exception-frame setup and unwinding are excluded.",
                "Root initializer qualification does not prove startup execution or current global values.",
            ],
        ),
    )
    return program
