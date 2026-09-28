"""Elbera Tools: original static collision element serializer bindings.

Inputs are explicit pinned owned and supplemental images. This qualifies code
and imported symbols; it does not execute a native archive or admit live data.
"""

import hashlib
import struct

from check_tutorial_quest_native import ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from check_hair_attachment_native import compare_call_block

BYTE_ORDER = "?ByteOrderSerialize@FArchive@@QAEAAV1@PAXH@Z"
COMPACT_INDEX = "??6@YAAAVFArchive@@AAV0@AAVFCompactIndex@@@Z"


def qualify_static_records(engine, core, comparison_engine, comparison_core):
    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        CANDIDATE_ENGINE_SHA,
        CANDIDATE_CORE_SHA,
    )
    blocks = []
    triangle_calls = [
        0x10366730,
        0x1036673E,
        0x1036674C,
        0x1036675A,
        0x10366768,
        0x10366776,
        0x10366784,
        0x10366792,
        0x103667A0,
        0x103667AE,
        0x103667BC,
        0x103667CA,
        0x103667D8,
        0x103667E6,
        0x103667F4,
        0x10366802,
    ]
    box_calls = [0x103302D0, 0x103302DE, 0x103302EC, 0x103302FA, 0x10330308, 0x10330316]
    for label, start, end, imported_operand, byte_calls, direct in [
        ("triangle", 0x10366720, 0x1036683A, 0x10366819, triangle_calls, []),
        ("node", 0x10366940, 0x10366983, 0x10366945, [], [0x10366979]),
        ("node box", 0x103302C0, 0x10330331, None, box_calls, []),
    ]:
        raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        other = bytearray(comparison_engine.read(start, end - start))
        rows = list(engine.dis.disasm(raw, start))
        assert rows[0].address == start and rows[-1].address + rows[-1].size == end
        assert all(a.address + a.size == b.address for a, b in zip(rows, rows[1:]))
        normalization = []
        if imported_operand is not None:
            offset = imported_operand - start
            assert raw[offset : offset + 2] == other[offset : offset + 2] == b"\x8b\x35"
            assert struct.unpack_from("<I", raw, offset + 2)[0] == 0x11D8D910
            assert struct.unpack_from("<I", other, offset + 2)[0] == 0x11D8D90C
            assert comparison_engine.imports[0x11D8D90C] == ("core.dll", COMPACT_INDEX)
            other[offset + 2 : offset + 6] = struct.pack("<I", 0x11D8D910)
            normalization.append(
                dict(
                    address=hex(imported_operand),
                    ownedOperand="0x11d8d910",
                    supplementalOperand="0x11d8d90c",
                    symbol=COMPACT_INDEX,
                )
            )
        comparison = compare_call_block(
            raw,
            bytes(other),
            owned_va=start,
            candidate_va=start,
            sites=[(at - start, ("core.dll", BYTE_ORDER)) for at in byte_calls],
            direct_calls=[at - start for at in direct],
            imports=comparison_engine.imports,
        )
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                instructions=len(rows),
                SHA256=hashlib.sha256(raw).hexdigest(),
                comparison=comparison,
                operandNormalization=normalization,
            )
        )
    for name, body in [
        ("??6@YAAAVFArchive@@AAV0@AAUFStaticMeshCollisionTriangle@@@Z", 0x10366720),
        ("??6@YAAAVFArchive@@AAV0@AAUFStaticMeshCollisionNode@@@Z", 0x10366940),
    ]:
        assert engine.exported(name, True) == comparison_engine.body(name) == body
    engine.instruction(0x1030ABE1, "jmp", "0x103302c0")
    assert bytes(
        engine.data[engine.offset(0x1030ABE1) : engine.offset(0x1030ABE1) + 5]
    ) == comparison_engine.read(0x1030ABE1, 5)
    core_blocks = []
    for name, start, end in [
        (BYTE_ORDER, 0x10108AD0, 0x10108AEC),
        (COMPACT_INDEX, 0x1015CFB0, 0x1015D18D),
    ]:
        assert core.exported(name, True) == comparison_core.body(name) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        core_blocks.append(
            dict(
                symbol=name,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    anchors = [
        (0x1033031E, "mov", "edx, dword ptr [eax + 4]"),
        (0x10330321, "push", "1"),
        (0x10330323, "add", "edi, 0x18"),
        (0x10330329, "call", "edx"),
    ]
    for row in anchors:
        engine.instruction(*row)
    core.instruction(0x10108ADD, "mov", "eax, dword ptr [eax + 4]")
    core.instruction(0x10108AE4, "call", "eax")
    return dict(
        ownedEngineSHA256=engine.sha,
        ownedCoreSHA256=core.sha,
        supplementalEngineSHA256=comparison_engine.sha,
        supplementalCoreSHA256=comparison_core.sha,
        engineBlocks=blocks,
        boundsLoader=qualify_static_bounds_loader(
            engine, core, comparison_engine, comparison_core
        ),
        coreBlocks=core_blocks,
        anchors=anchors,
        limits=[
            "Static serializer/import correspondence, not execution of native archive I/O.",
            "ByteOrderSerialize delegates to supplied archive virtual Serialize; archive loading/lifetime is outside this proof.",
            "The decoded records do not establish current actor/cache state, material callbacks or collision results.",
            "Supplemental correspondence does not authenticate the archive or repair the owned image.",
        ],
    )


def qualify_static_bounds_loader(engine, core, comparison_engine, comparison_core):
    """Bind the file-123 prefix that writes the same mesh box twice.

    This is a static serializer proof. Allocation, native archive execution,
    the remainder of mesh loading and post-load state are not inferred here.
    """
    version = "?Ver@FArchive@@QAEHXZ"
    object_serialize = "?Serialize@UObject@@UAEXAAVFArchive@@@Z"
    blocks = []

    def block(label, start, end, delta, imports=(), direct=()):
        raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        rows = list(engine.dis.disasm(raw, start))
        assert rows[0].address == start and rows[-1].address + rows[-1].size == end
        assert all(a.address + a.size == b.address for a, b in zip(rows, rows[1:]))
        proof = compare_call_block(
            raw,
            comparison_engine.read(start + delta, len(raw)),
            owned_va=start,
            candidate_va=start + delta,
            sites=[(at - start, ("core.dll", symbol)) for at, symbol in imports],
            direct_calls=[at - start for at in direct],
            imports=comparison_engine.imports,
        )
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
                comparison=proof,
            )
        )

    for symbol, owned, candidate in [
        ("?Serialize@UPrimitive@@UAEXAAVFArchive@@@Z", 0x10645810, 0x106457D0),
        ("?Serialize@UStaticMesh@@UAEXAAVFArchive@@@Z", 0x106F7A80, 0x106F7A40),
        ("?PostLoad@UStaticMesh@@UAEXXZ", 0x106F5CC0, 0x106F5C80),
    ]:
        assert engine.exported(symbol, True) == owned
        assert comparison_engine.body(symbol) == candidate
    thunks = []
    for at, target, delta in [
        (0x10311293, 0x10645810, -64),
        (0x10308DF5, 0x105E98F0, -64),
        (0x1030A41B, 0x106F7910, -64),
        (0x10308A17, 0x103EC2E0, 0),
    ]:
        engine.instruction(at, "jmp", hex(target))
        other = list(engine.dis.disasm(comparison_engine.read(at, 5), at))
        assert (
            len(other) == 1
            and other[0].mnemonic == "jmp"
            and other[0].op_str == hex(target + delta)
        )
        thunks.append(
            dict(
                address=hex(at),
                ownedTarget=hex(target),
                comparisonTarget=hex(target + delta),
            )
        )
    block(
        "UPrimitive normal serializer",
        0x10645831,
        0x10645878,
        -64,
        [(0x1064583E, object_serialize)],
        [0x1064584D, 0x10645856],
    )
    block(
        "UStaticMesh serializer through second box",
        0x106F7AA1,
        0x106F7B0F,
        -64,
        [(0x106F7AAD, version), (0x106F7ABB, object_serialize), (0x106F7ACA, version)],
        [0x106F7AC3, 0x106F7AE4, 0x106F7AED, 0x106F7AFE, 0x106F7B07],
    )
    sphere_calls = [
        0x105E990C,
        0x105E991A,
        0x105E9928,
        0x105E9933,
        0x105E9941,
        0x105E994F,
        0x105E995D,
    ]
    block(
        "sphere serializer",
        0x105E98F0,
        0x105E9968,
        -64,
        [(0x105E98F8, version)] + [(at, BYTE_ORDER) for at in sphere_calls],
    )
    block(
        "section array normal serializer",
        0x106F7931,
        0x106F7A03,
        -64,
        [
            (0x106F7941, "?CountBytes@FArray@@QAEXAAVFArchive@@H@Z"),
            (0x106F7949, "?IsLoading@FArchive@@QAEHXZ"),
            (0x106F7958, COMPACT_INDEX),
            (0x106F7978, "?Empty@FArray@@QAEXHH@Z"),
            (0x106F79C1, COMPACT_INDEX),
        ],
        [0x106F7989, 0x106F7997, 0x106F799E, 0x106F79AF, 0x106F79E0],
    )
    block("section version branch", 0x103EC2FA, 0x103EC315, 0, [(0x103EC304, version)])
    block("section file112 branch", 0x103EC39F, 0x103EC3AE, 0, [(0x103EC39F, version)])
    section_calls = [
        0x103EC4EC,
        0x103EC4FA,
        0x103EC508,
        0x103EC516,
        0x103EC524,
        0x103EC532,
    ]
    block(
        "section file112+ fields",
        0x103EC4DD,
        0x103EC54C,
        0,
        [(at, BYTE_ORDER) for at in section_calls],
    )
    block("post-load Build gate only", 0x106F6197, 0x106F61A7, -64, direct=[0x106F61A2])
    build = "?Build@UStaticMesh@@QAEXXZ"
    assert engine.exported(build) == comparison_engine.exports[build] == 0x1030C851
    anchors = [
        (0x10645844, "lea", "eax, [esi + 0x50]"),
        (0x10645848, "add", "esi, 0x34"),
        (0x106F7AB6, "cmp", "eax, 0x55"),
        (0x106F7AD0, "cmp", "eax, 0x5c"),
        (0x106F7AF5, "lea", "edx, [esi + 0x34]"),
        (0x106F7AF9, "lea", "eax, [esi + 0x60]"),
        (0x105E98FE, "cmp", "eax, 0x3d"),
        (0x103EC30A, "cmp", "eax, 0x5c"),
        (0x103EC3A5, "cmp", "eax, 0x70"),
        (0x103EC4E4, "push", "4"),
        (0x106F6197, "cmp", "dword ptr [esi + 0x1dc], 8"),
    ] + [
        (at, "push", "2")
        for at in [0x103EC4F2, 0x103EC500, 0x103EC50E, 0x103EC51C, 0x103EC52A]
    ]
    for row in anchors:
        engine.instruction(*row)
    assert core.exported(version, True) == comparison_core.body(version) == 0x10108B80
    raw = bytes(core.data[core.offset(0x10108B80) : core.offset(0x10108B84)])
    assert raw == comparison_core.read(0x10108B80, 4)
    core.instruction(0x10108B80, "mov", "eax, dword ptr [ecx + 4]")
    core.instruction(0x10108B83, "ret", "")
    return dict(
        fileVersion=123,
        meshFieldOffset="0x34",
        boxWriteOrder=["baseSerializedBounds", "savedLocalBounds"],
        boxBytes=25,
        sphereBytes=16,
        sectionBytes=14,
        engineBlocks=blocks,
        thunks=thunks,
        anchors=anchors,
        archiveVersionGetter=dict(
            start="0x10108b80", end="0x10108b84", SHA256=hashlib.sha256(raw).hexdigest()
        ),
        limits=[
            "File123 serializer prefix and byte widths, not full native loading or allocation.",
            "The separate PostLoad gate invokes Build when its signed field is below 8; neither full PostLoad nor Build is executed.",
            "Saved bounds do not establish post-load or current actor state.",
        ],
    )
