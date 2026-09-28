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
        coreBlocks=core_blocks,
        anchors=anchors,
        limits=[
            "Static serializer/import correspondence, not execution of native archive I/O.",
            "ByteOrderSerialize delegates to supplied archive virtual Serialize; archive loading/lifetime is outside this proof.",
            "The decoded records do not establish current actor/cache state, material callbacks or collision results.",
            "Supplemental correspondence does not authenticate the archive or repair the owned image.",
        ],
    )
