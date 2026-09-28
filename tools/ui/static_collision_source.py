"""Elbera Tools: original static collision element serializer bindings.

Inputs are explicit pinned owned and supplemental images. This qualifies code
and imported symbols; it does not execute a native archive or admit live data.
"""

import hashlib
import struct

from check_tutorial_quest_native import ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from check_supplemental_engine import compare_method
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
        packedPropertyTags=qualify_packed_property_tags(core, comparison_core),
        boundsLoader=qualify_static_bounds_loader(
            engine, core, comparison_engine, comparison_core
        ),
        loadTail=qualify_static_load_tail(
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


def qualify_packed_property_tags(core, comparison_core):
    """Bind the ordered map reader to original packed tag/index framing.

    These are retained code/data comparisons, not execution of the archive or
    evidence that arbitrary reflected properties are safe to apply to objects.
    """
    assert (core.sha, comparison_core.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    blocks = []
    for label, start, end in [
        ("tag archive operator, all normal returns", 0x10132F10, 0x10133161),
        ("tag value application, including Boolean", 0x10131090, 0x10131137),
        ("tagged-property caller", 0x101346E0, 0x10134CD8),
        ("byte archive operator", 0x101307E0, 0x101307F9),
        ("word archive operator", 0x10130800, 0x10130819),
        ("dword archive operator", 0x10130820, 0x10130839),
        ("size selector targets", 0x101331D0, 0x101331F4),
        ("size selector table", 0x101331F4, 0x10133265),
    ]:
        raw = bytes(core.data[core.offset(start) : core.offset(start) + end - start])
        assert raw == comparison_core.read(start, end - start)
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    thunks = []
    for thunk, target in [
        (0x1010380A, 0x10132F10),
        (0x10104467, 0x10131090),
        (0x10102D8D, 0x101307E0),
        (0x10102DE2, 0x10130800),
        (0x10102DFB, 0x10130820),
    ]:
        core.instruction(thunk, "jmp", hex(target))
        raw = bytes(core.data[core.offset(thunk) : core.offset(thunk) + 5])
        assert raw == comparison_core.read(thunk, 5)
        thunks.append(dict(thunk=hex(thunk), target=hex(target)))
    boolean_class = "?PrivateStaticClass@UBoolProperty@@0VUClass@@A"
    assert (
        core.exported(boolean_class)
        == comparison_core.exports[boolean_class]
        == 0x10338240
    )
    tagged = "?SerializeTaggedProperties@UStruct@@UAEXAAVFArchive@@PAEPAVUClass@@@Z"
    assert core.exported(tagged, True) == comparison_core.body(tagged) == 0x101346E0
    anchors = [
        (0x10134778, "call", "0x1010380a"),
        (0x10134B1C, "call", "0x10104467"),
        (0x10132F8E, "cmp", "al, 0xa"),
        (0x10132FA2, "and", "eax, 0x70"),
        (0x1013302F, "test", "byte ptr [ebx], 0x80"),
        (0x10133038, "cmp", "byte ptr [esi], 3"),
        (0x1013303B, "je", "0x10133147"),
        (0x101330AF, "and", "edx, 0x7f"),
        (0x101330B2, "shl", "edx, 8"),
        (0x10133113, "and", "eax, 0x3f"),
        (0x10133116, "shl", "eax, 8"),
        (0x1013311F, "shl", "eax, 8"),
        (0x10133128, "shl", "eax, 8"),
        (0x101310BD, "cmp", "dword ptr [esi + 0x24], 0x10338240"),
        (0x101310EF, "test", "byte ptr [edi + 1], 0x80"),
        (0x101310F8, "or", "dword ptr [eax], ecx"),
        (0x10131101, "and", "dword ptr [eax], edx"),
    ]
    for row in anchors:
        core.instruction(*row)
    targets = [
        0x10132FBC,
        0x10132FC5,
        0x10132FCE,
        0x10132FD7,
        0x10132FE0,
        0x10132FE9,
        0x10132FFF,
        0x10133016,
    ]
    for selector, target in enumerate(targets):
        assert core.data[core.offset(0x101331F4) + selector * 16] == selector
        assert core.u32(0x101331D0 + selector * 4) == target
    return dict(
        ownedCoreSHA256=core.sha,
        supplementalCoreSHA256=comparison_core.sha,
        blocks=blocks,
        thunks=thunks,
        anchors=anchors,
        booleanClass=dict(symbol=boolean_class, address="0x10338240"),
        limits=[
            "Original packed tag widths and byte order, plus Boolean value application; no native archive executed.",
            "Normal Boolean application reads the tag high bit without consuming a payload or array index, regardless of its size selector.",
            "Export-end bounds are decoder validation, not an inferred original game limit.",
            "No claim about arbitrary property compatibility conversions, class initialization or current object flags.",
            "Supplemental correspondence does not authenticate the distribution or restore a protected runtime.",
        ],
    )


def _engine_block(
    engine,
    comparison_engine,
    label,
    start,
    end,
    delta,
    imports=(),
    direct=(),
    operands=(),
):
    raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
    rows = list(engine.dis.disasm(raw, start))
    assert rows[0].address == start and rows[-1].address + rows[-1].size == end
    assert all(a.address + a.size == b.address for a, b in zip(rows, rows[1:]))
    other = bytearray(comparison_engine.read(start + delta, len(raw)))
    bindings = []
    for at, owned, candidate, symbol in operands:
        offset = at - start
        assert struct.unpack_from("<I", raw, offset)[0] == owned
        assert struct.unpack_from("<I", other, offset)[0] == candidate
        assert comparison_engine.imports[candidate] == ("core.dll", symbol)
        struct.pack_into("<I", other, offset, owned)
        bindings.append(
            dict(
                address=hex(at),
                owned=hex(owned),
                comparison=hex(candidate),
                symbol=symbol,
            )
        )
    proof = compare_call_block(
        raw,
        bytes(other),
        owned_va=start,
        candidate_va=start + delta,
        sites=[(at - start, ("core.dll", symbol)) for at, symbol in imports],
        direct_calls=[at - start for at in direct],
        imports=comparison_engine.imports,
    )
    return dict(
        label=label,
        start=hex(start),
        end=hex(end),
        SHA256=hashlib.sha256(raw).hexdigest(),
        comparison=proof,
        operandBindings=bindings,
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
        blocks.append(
            _engine_block(
                engine, comparison_engine, label, start, end, delta, imports, direct
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


def qualify_static_load_tail(engine, core, comparison_engine, comparison_core):
    """File123 load-tail fields, reference framing and lazy-array end seek."""
    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        CANDIDATE_ENGINE_SHA,
        CANDIDATE_CORE_SHA,
    )
    version = "?Ver@FArchive@@QAEHXZ"
    licensee = "?LicenseeVer@FArchive@@QAEHXZ"
    loading = "?IsLoading@FArchive@@QAEHXZ"
    saving = "?IsSaving@FArchive@@QAEHXZ"
    blocks = []

    def block(label, start, end, delta=-64, imports=(), direct=(), operands=()):
        blocks.append(
            _engine_block(
                engine,
                comparison_engine,
                label,
                start,
                end,
                delta,
                imports,
                direct,
                operands,
            )
        )

    block("file114 tail gate", 0x106F7DB2, 0x106F7DBF, imports=[(0x106F7DB4, version)])
    block(
        "licensee fields and file version gates",
        0x106F7DEF,
        0x106F7F45,
        imports=[
            (at, licensee)
            for at in [
                0x106F7DF1,
                0x106F7E4E,
                0x106F7E7B,
                0x106F7E98,
                0x106F7EB5,
                0x106F7EE2,
            ]
        ]
        + [(at, version) for at in [0x106F7EFF, 0x106F7F0C, 0x106F7F29, 0x106F7F3A]],
        direct=[
            0x106F7E20,
            0x106F7E29,
            0x106F7E32,
            0x106F7E3B,
            0x106F7E44,
            0x106F7E68,
            0x106F7E71,
            0x106F7E8E,
            0x106F7EAB,
            0x106F7ECF,
            0x106F7ED8,
            0x106F7EF5,
            0x106F7F1F,
        ],
    )
    block(
        "file97 lazy array and file81 gate",
        0x106F7FC2,
        0x106F7FFD,
        imports=[(0x106F7FF2, version)],
        direct=[0x106F7FE0],
        operands=[
            (0x106F7FC3, 0x11D8DA60, 0x11D8DA5C, "?GLazyLoad@@3HA"),
            (0x106F7FCD, 0x11D8DBE4, 0x11D8DBE0, "?GIsEditor@@3HA"),
            (0x106F7FEA, 0x11D8DA60, 0x11D8DA5C, "?GLazyLoad@@3HA"),
        ],
    )
    block(
        "version and final fields",
        0x106F802D,
        0x106F80B6,
        imports=[
            (0x106F802D, loading),
            (0x106F8042, saving),
            (0x106F8064, version),
            (0x106F8081, version),
        ],
        direct=[0x106F805A, 0x106F8077, 0x106F8094],
    )
    block(
        "lazy array loading path",
        0x106F6F21,
        0x106F6FFB,
        imports=[
            (0x106F6F2D, loading),
            (0x106F6F44, version),
            (0x106F6F61, COMPACT_INDEX),
        ],
        direct=[0x106F6F88, 0x106F6FA6, 0x106F6FB4],
        operands=[
            (0x106F6F91, 0x11D8DA64, 0x11D8DA60, "?GUglyHackFlags@@3KA"),
            (0x106F6FCA, 0x11D8DA60, 0x11D8DA5C, "?GLazyLoad@@3HA"),
        ],
    )
    thunks = []
    for thunk, start, end, delta, call in [
        (0x1030599D, 0x10330040, 0x10330058, 0, 0x1033004E),
        (0x10305998, 0x10330060, 0x10330078, 0, 0x1033006E),
        (0x103059A2, 0x10330020, 0x10330038, 0, 0x1033002E),
        (0x10309DA9, 0x106F47D0, 0x106F47E1, -64, None),
        (0x1030E566, 0x106F47B0, 0x106F47C1, -64, None),
    ]:
        engine.instruction(thunk, "jmp", hex(start))
        row = list(engine.dis.disasm(comparison_engine.read(thunk, 5), thunk))
        assert (
            len(row) == 1
            and row[0].mnemonic == "jmp"
            and row[0].op_str == hex(start + delta)
        )
        block(
            "tail field helper",
            start,
            end,
            delta,
            imports=[] if call is None else [(call, BYTE_ORDER)],
        )
        thunks.append(
            dict(thunk=hex(thunk), owned=hex(start), comparison=hex(start + delta))
        )
    engine.instruction(0x10308751, "jmp", "0x106f6f00")
    row = list(engine.dis.disasm(comparison_engine.read(0x10308751, 5), 0x10308751))
    assert len(row) == 1 and row[0].mnemonic == "jmp" and row[0].op_str == "0x106f6ec0"
    object_ref = "??6ULinkerLoad@@EAEAAVFArchive@@AAPAVUObject@@@Z"
    core_blocks = []
    for symbol, start, end in [
        (version, 0x10108B80, 0x10108B84),
        (licensee, 0x10108BA0, 0x10108BA4),
        (loading, 0x10108BB0, 0x10108BB4),
        (saving, 0x10108BC0, 0x10108BC4),
        (object_ref, 0x10113370, 0x101133E9),
        ("?GetReader@ULinkerLoad@@QAEPAVFArchive@@XZ", 0x10148350, 0x1014839C),
        ("?Seek@ULinkerLoad@@EAEXH@Z", 0x10148EE0, 0x10148F3A),
    ]:
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        rows = list(core.dis.disasm(raw, start))
        assert rows[-1].address + rows[-1].size == end and raw == comparison_core.read(
            start, len(raw)
        )
        core_blocks.append(
            dict(
                symbol=symbol,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    assert (
        core.exported(COMPACT_INDEX)
        == comparison_core.exports[COMPACT_INDEX]
        == 0x10102315
    )
    assert (
        core.exported("?IndexToObject@ULinkerLoad@@AAEPAVUObject@@H@Z")
        == comparison_core.exports["?IndexToObject@ULinkerLoad@@AAEPAVUObject@@H@Z"]
        == 0x10102540
    )
    vt = "??_7ULinkerLoad@@6BFArchive@@@"
    assert (
        core.u32(core.exported(vt) + 0x18)
        == comparison_core.u32(comparison_core.exports[vt] + 0x18)
        == core.exported(object_ref)
    )
    core.instruction(0x101133AF, "call", "0x10102315")
    core.instruction(0x101133BD, "call", "0x10102540")
    reader = "?GetReader@ULinkerLoad@@QAEPAVFArchive@@XZ"
    assert core.exported(reader) == comparison_core.exports[reader] == 0x10101F41
    core.instruction(0x101133A9, "call", "0x10101f41")
    engine.instruction(0x106F6FE3, "mov", "edx, dword ptr [edx + 0x3c]")
    engine.instruction(0x106F6FE6, "call", "edx")
    seek = "?Seek@ULinkerLoad@@EAEXH@Z"
    assert (
        core.u32(core.exported(vt) + 0x3C)
        == comparison_core.u32(comparison_core.exports[vt] + 0x3C)
        == core.exported(seek)
    )
    core.instruction(0x10148F0E, "call", "0x10101f41")
    core.instruction(0x10148F1B, "mov", "edx, dword ptr [edx + 0x3c]")
    core.instruction(0x10148F1E, "call", "edx")
    return dict(
        fileVersion=123,
        engineBlocks=blocks,
        coreBlocks=core_blocks,
        fieldThunks=thunks,
        linkerArchiveVtable=vt,
        objectReferenceSlot="0x18",
        seekSlot="0x3c",
        seekSymbol=seek,
        limits=[
            "Static file123 loading layout, not native archive I/O or object-reference resolution.",
            "The lazy payload is opaque; the source loader seeks its saved absolute end after conditional loading.",
            "Current thread reader, lazy-loader callbacks, IndexToObject and PostLoad remain separate.",
        ],
    )


def qualify_static_postload(engine, core, comparison_engine, comparison_core):
    """Bind the ordinary version>=8 path; older conversion stays outside scope."""
    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        CANDIDATE_ENGINE_SHA,
        CANDIDATE_CORE_SHA,
    )
    method = "?PostLoad@UStaticMesh@@UAEXXZ"
    assert engine.exported(method, True) == 0x106F5CC0
    assert comparison_engine.body(method) == 0x106F5C80
    imports = {
        0x106F5CE9: ("?PostLoad@UObject@@UAEXXZ", 0x10163C60),
        0x106F61C2: ("?Empty@FArray@@QAEXHH@Z", 0x101091C0),
        0x106F61D4: ("?AddZeroed@FArray@@QAEHHH@Z", 0x10109110),
    }
    blocks = []
    for start, end in [
        (0x106F5CE1, 0x106F5CFC),
        (0x106F603B, 0x106F605C),
        (0x106F60F5, 0x106F6102),
        (0x106F61A7, 0x106F61F3),
    ]:
        blocks.append(
            _engine_block(
                engine,
                comparison_engine,
                "version>=8 PostLoad path",
                start,
                end,
                -64,
                imports=[
                    (at, name) for at, (name, _) in imports.items() if start <= at < end
                ],
            )
        )
    core_blocks = []
    for symbol, start, end in [
        (imports[0x106F5CE9][0], 0x10163C60, 0x10163CB8),
        (imports[0x106F61C2][0], 0x101091C0, 0x101091DB),
        (imports[0x106F61D4][0], 0x10109110, 0x1010917C),
    ]:
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        core_blocks.append(
            dict(
                symbol=symbol,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    localized = "?LoadLocalized@UObject@@QAEXXZ"
    assert core.exported(localized) == comparison_core.exports[localized] == 0x101036DE
    core.instruction(0x10163C9B, "call", "0x101036de")
    core.instruction(0x10109142, "call", "0x101031d9")
    return dict(
        engineBlocks=blocks,
        coreBlocks=core_blocks,
        imports={
            hex(at): dict(symbol=name, target=hex(target))
            for at, (name, target) in imports.items()
        },
        limits=[
            "Current signed version>=8 and current UObject flags &0x100 clear only; saved export flags do not establish current flags.",
            "Older conversion/Build, LoadLocalized, exceptions and allocator failures are not admitted.",
            "Engine SEH prefix is retained for stack effects only; exception handlers are not compared or executed.",
        ],
    )


def qualify_static_mesh_constructor(engine, core, comparison_engine, comparison_core):
    """Bind the normal mesh constructor and its embedded stream/array helpers.

    This does not infer incoming allocation flags, class defaults, archive
    effects or later state. The caller supplies valid distinct object/global
    storage. Exception handlers are compared only at their ordinary entry.
    """
    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        CANDIDATE_ENGINE_SHA,
        CANDIDATE_CORE_SHA,
    )
    e, p = engine, comparison_engine
    read = lambda va, n: bytes(e.data[e.offset(va) : e.offset(va) + n])
    array = "??0FArray@@QAE@XZ"
    sized_array = "??0FArray@@IAE@HH@Z"
    index_array = "??0?$TArray@G@@QAE@XZ"
    cache_id = "?GMakeCacheIDIndex@@3_KA"
    # Endpoints include complete returns. Labels identify containing fields;
    # they do not invent meanings for the individual render streams.
    regions = [
        ("mesh", 0x106F72F0, 0x106F744A, -64),
        ("primitive", 0x10331310, 0x10331371, 0),
        ("stream+6c", 0x103ADAC0, 0x103ADB78, 0),
        ("streams+88/a4", 0x10683FE0, 0x10684098, -64),
        ("stream+cc", 0x103AE0B0, 0x103AE168, 0),
        ("stream+e8", 0x1039EBD0, 0x1039EC88, 0),
        ("buffers+104/120", 0x10680F40, 0x10680FF2, -64),
        ("lazy+148", 0x106F68B0, 0x106F6915, -64),
        ("lazy+160", 0x106F6B90, 0x106F6BF5, -64),
        ("lazy+1c4", 0x106F6E70, 0x106F6ED8, -64),
    ]
    by_start = {start: (end, delta) for _, start, end, delta in regions}
    thunks = {
        0x1030B4C4: 0x10331310,
        0x10313BD8: 0x103ADAC0,
        0x1030150A: 0x10683FE0,
        0x1030B343: 0x103AE0B0,
        0x10310DF2: 0x1039EBD0,
        0x10310712: 0x10680F40,
        0x1030DC92: 0x106F68B0,
        0x1030BF0F: 0x106F6B90,
        0x1031327D: 0x106F6E70,
    }
    for thunk, body in thunks.items():
        e.instruction(thunk, "jmp", hex(body))
        other = p.read(thunk, 5)
        assert other[0] == 0xE9
        assert (
            thunk + 5 + struct.unpack_from("<i", other, 1)[0]
            == body + by_start[body][1]
        )
    for symbol, body in [
        ("??0UStaticMesh@@QAE@XZ", 0x106F72F0),
        ("??0UPrimitive@@QAE@XZ", 0x10331310),
    ]:
        assert e.exported(symbol, True) == body
        assert p.body(symbol) == body + by_start[body][1]
    imports = {
        0x106F732A: array,
        0x106F738E: array,
        0x106F73E3: array,
        0x1033132D: "??0UObject@@QAE@XZ",
        0x10331346: "??0FBox@@QAE@H@Z",
        0x10331351: "??0FSphere@@QAE@H@Z",
        0x103ADB0F: array,
        0x1068402F: array,
        0x103AE0FF: array,
        0x1039EC1F: array,
        0x10680F89: index_array,
        0x106F68DD: sized_array,
        0x106F6BBD: sized_array,
        0x106F6EA0: sized_array,
    }
    global_sites = [
        0x103ADB1C,
        0x103ADB44,
        0x1068403C,
        0x10684064,
        0x103AE10C,
        0x103AE134,
        0x1039EC2C,
        0x1039EC54,
        0x10680F96,
        0x10680FBE,
    ]
    multiply_sites = [0x103ADB2F, 0x1068404F, 0x103AE11F, 0x1039EC3F, 0x10680FA9]
    mesh_calls = [
        0x106F7310,
        0x106F7338,
        0x106F734E,
        0x106F736F,
        0x106F739F,
        0x106F73AF,
        0x106F73BF,
        0x106F73CF,
        0x106F73F6,
        0x106F7408,
        0x106F741A,
    ]
    # Both branches of the compiler's integer product helper, including ret 16.
    multiply = read(0x107A6660, 0x34)
    assert multiply == p.read(0x107A6620, 0x34)
    blocks = []
    for label, start, end, delta in regions:
        original = read(start, end - start)
        normalized = bytearray(original)
        other = p.read(start + delta, len(original))
        bindings = []
        for at in global_sites:
            if not start <= at < end:
                continue
            offset = at - start
            assert struct.unpack_from("<I", normalized, offset)[0] == 0x11D8D900
            assert struct.unpack_from("<I", other, offset)[0] == 0x11D8D8FC
            assert p.imports[0x11D8D8FC] == ("core.dll", cache_id)
            struct.pack_into("<I", normalized, offset, 0x11D8D8FC)
            bindings.append(dict(address=hex(at), kind="named-global", symbol=cache_id))
        for at in mesh_calls + multiply_sites:
            if not start <= at < end:
                continue
            offset = at - start
            assert original[offset] == other[offset] == 0xE8
            left = at + 5 + struct.unpack_from("<i", original, offset + 1)[0]
            right = at + delta + 5 + struct.unpack_from("<i", other, offset + 1)[0]
            if at in multiply_sites:
                assert (left, right) == (0x107A6660, 0x107A6620)
            else:
                assert left == right and left in thunks
            normalized[offset : offset + 5] = other[offset : offset + 5]
            bindings.append(
                dict(
                    address=hex(at),
                    kind="qualified-helper",
                    ownedTarget=hex(left),
                    comparisonTarget=hex(right),
                )
            )
        for at, symbol in imports.items():
            if start <= at < end:
                assert original[at - start : at - start + 6] == b"\x90" * 6
                assert p.imported_call(at + delta) == ("core.dll", symbol)
        handler_pair = (
            struct.unpack_from("<I", original, 3)[0],
            struct.unpack_from("<I", other, 3)[0],
        )
        proof = compare_method(
            bytes(normalized),
            other,
            start,
            start + delta,
            p.imported_call,
            read,
            p.read,
            handler_pair,
        )
        rows = list(e.dis.disasm(original, start))
        assert sum(i.size for i in rows) == len(original)
        assert rows[-1].mnemonic == "ret" and rows[-1].address + rows[-1].size == end
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(original).hexdigest(),
                comparison=proof,
                explicitBindings=bindings,
            )
        )
    blocks.append(
        dict(
            label="integer product",
            start="0x107a6660",
            end="0x107a6694",
            SHA256=hashlib.sha256(multiply).hexdigest(),
        )
    )
    core_blocks = []
    for symbol, start, end in [
        ("??0UObject@@QAE@XZ", 0x1015C420, 0x1015C44D),
        (array, 0x101091F0, 0x101091FD),
        ("??0FBox@@QAE@H@Z", 0x101177A0, 0x101177DB),
        ("??0FSphere@@QAE@H@Z", 0x1010DBF0, 0x1010DC02),
        (index_array, 0x10113590, 0x101135CC),
        (sized_array, 0x10109280, 0x101092A3),
    ]:
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        core_blocks.append(
            dict(
                symbol=symbol,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    cache_global = core.exported(cache_id)
    assert cache_global == comparison_core.exports[cache_id]
    return dict(
        engineBlocks=blocks,
        coreBlocks=core_blocks,
        importTargets={
            hex(at): hex(core.exported(symbol, True)) for at, symbol in imports.items()
        },
        thunkTargets={hex(at): hex(target) for at, target in thunks.items()},
        cacheIdGlobal=hex(cache_global),
        limits=[
            "Normal constructor bodies and explicit current counters; allocation/class defaults and serialization are separate.",
            "Named erased imports and exact helper correspondence do not restore the owned binary or authenticate the supplemental archive.",
            "Only ten handler entry bytes are compared; exceptions and complete unwind graphs are outside scope.",
        ],
    )


def qualify_static_mesh_fresh_load(engine, core, comparison_engine, comparison_core):
    """Normal fresh-load transitions with explicitly supplied current class flags.

    Includes native property declaration bindings, not execution of the entire
    class registry, package resolver or arbitrary reflected compatibility code.
    """
    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        CANDIDATE_ENGINE_SHA,
        CANDIDATE_CORE_SHA,
    )
    start, end = 0x106F4810, 0x106F4F1D
    read = lambda va, size: bytes(
        engine.data[engine.offset(va) : engine.offset(va) + size]
    )
    original = read(start, end - start)
    owned = bytearray(original)
    other = comparison_engine.read(start - 64, end - start)
    operands = []
    for at, old, new, kind, symbol in [
        (
            0x106F4873,
            0x11D8D98C,
            0x11D8D988,
            "import",
            "??0FName@@QAE@PBGW4EFindName@@@Z",
        ),
        (
            0x106F4ACC,
            0x10DDBEA0,
            0x10DDBEB0,
            "export",
            "?PrivateStaticClass@UStaticMesh@@0VUClass@@A",
        ),
        (
            0x106F4B18,
            0x10DDBEA0,
            0x10DDBEB0,
            "export",
            "?PrivateStaticClass@UStaticMesh@@0VUClass@@A",
        ),
        (
            0x106F4D0F,
            0x10C6B258,
            0x10C6B268,
            "export",
            "?PrivateStaticClass@UMaterial@@0VUClass@@A",
        ),
    ]:
        offset = at - start
        assert struct.unpack_from("<I", owned, offset)[0] == old
        assert struct.unpack_from("<I", other, offset)[0] == new
        if kind == "import":
            assert comparison_engine.imports[new] == ("core.dll", symbol)
        else:
            assert (
                engine.exported(symbol) == old
                and comparison_engine.exports[symbol] == new
            )
        struct.pack_into("<I", owned, offset, new)
        operands.append(
            dict(
                at=hex(at),
                kind=kind,
                symbol=symbol,
                owned=hex(old),
                comparison=hex(new),
            )
        )
    handler = (
        int.from_bytes(owned[6:10], "little"),
        int.from_bytes(other[6:10], "little"),
    )
    comparison = compare_method(
        bytes(owned),
        other,
        start,
        start - 64,
        comparison_engine.imported_call,
        read,
        comparison_engine.read,
        handler,
    )
    imports = {
        "?GetClass@UObject@@QBEPAVUClass@@XZ": [
            0x106F483B,
            0x106F487B,
            0x106F48C2,
            0x106F4909,
            0x106F4950,
            0x106F4997,
            0x106F49DE,
            0x106F4A25,
            0x106F4A6C,
            0x106F4AB3,
            0x106F4AFF,
            0x106F4B4B,
            0x106F4B92,
            0x106F4BD9,
            0x106F4C20,
            0x106F4C67,
            0x106F4CBB,
            0x106F4E1E,
        ],
        "??0FName@@QAE@W4EName@@@Z": [0x106F485C],
        "??2UFloatProperty@@SAPAXIPAVUObject@@VFName@@K@Z": [
            0x106F4884,
            0x106F48CB,
            0x106F4B54,
            0x106F4B9B,
        ],
        "??0UFloatProperty@@QAE@W4ECppProperty@@HPBGK@Z": [
            0x106F48A3,
            0x106F48EA,
            0x106F4B73,
            0x106F4BBA,
        ],
        "??2UBoolProperty@@SAPAXIPAVUObject@@VFName@@K@Z": [
            0x106F4912,
            0x106F4959,
            0x106F49A0,
            0x106F49E7,
            0x106F4A2E,
            0x106F4A75,
            0x106F4BE2,
            0x106F4C29,
            0x106F4C70,
            0x106F4D43,
            0x106F4D83,
            0x106F4DC3,
        ],
        "??0UBoolProperty@@QAE@W4ECppProperty@@HPBGK@Z": [
            0x106F4931,
            0x106F4978,
            0x106F49BF,
            0x106F4A06,
            0x106F4A4D,
            0x106F4A94,
            0x106F4C01,
            0x106F4C48,
            0x106F4C8F,
            0x106F4D60,
            0x106F4DA0,
            0x106F4DE0,
        ],
        "??2UObjectProperty@@SAPAXIPAVUObject@@VFName@@K@Z": [
            0x106F4ABC,
            0x106F4B08,
            0x106F4CFE,
        ],
        "??0UObjectProperty@@QAE@W4ECppProperty@@HPBGKPAVUClass@@@Z": [
            0x106F4AE0,
            0x106F4B2C,
            0x106F4D20,
        ],
        "??0FArchive@@QAE@XZ": [0x106F4C9E],
        "??2UStruct@@SAPAXIPAVUObject@@VFName@@K@Z": [0x106F4CC7],
        "??0UStruct@@QAE@PAV0@@Z": [0x106F4CDA],
        "?SetPropertiesSize@UStruct@@QAEXH@Z": [0x106F4DF3],
        "??2UArrayProperty@@SAPAXIPAVUObject@@VFName@@K@Z": [0x106F4E27],
        "??0UArrayProperty@@QAE@W4ECppProperty@@HPBGK@Z": [0x106F4E47],
        "??2UStructProperty@@SAPAXIPAVUObject@@VFName@@K@Z": [0x106F4E79],
        "??0UStructProperty@@QAE@W4ECppProperty@@HPBGKPAVUStruct@@@Z": [0x106F4E96],
        "??1FArchive@@UAE@XZ": [0x106F4EFE],
    }
    expected = {
        hex(at): ["core.dll", symbol]
        for symbol, sites in imports.items()
        for at in sites
    }
    actual = {
        row["ownedVA"]: row["binding"]
        for row in comparison["differences"]
        if row["kind"] == "named-import"
    }
    assert actual == expected
    symbol = "?StaticConstructor@UStaticMesh@@QAEXXZ"
    assert (
        engine.exported(symbol, True) == start
        and comparison_engine.body(symbol) == start - 64
    )
    declarations = []
    # The matching FName call and C++ property constructor pass these exact
    # top-level names and offsets. Nested material members are deliberately not
    # treated as fields of the containing mesh.
    declared = [
        (
            "MaxSwayAngle",
            0x106F4877,
            0x106F486C,
            0x108E8768,
            0x106F48A3,
            0x106F489A,
            0x1B0,
            4,
        ),
        (
            "Frequency",
            0x106F48BE,
            0x106F48B9,
            0x108E8750,
            0x106F48EA,
            0x106F48E1,
            0x1AC,
            4,
        ),
        (
            "bSwayObject",
            0x106F4905,
            0x106F4900,
            0x108E8734,
            0x106F4931,
            0x106F4928,
            0x1A8,
            3,
        ),
        (
            "UseSimpleLineCollision",
            0x106F494C,
            0x106F4947,
            0x108E86FC,
            0x106F4978,
            0x106F496F,
            0x180,
            3,
        ),
        (
            "UseSimpleBoxCollision",
            0x106F4993,
            0x106F498E,
            0x108E86C8,
            0x106F49BF,
            0x106F49B6,
            0x184,
            3,
        ),
        (
            "UseSimpleKarmaCollision",
            0x106F49DA,
            0x106F49D5,
            0x108E868C,
            0x106F4A06,
            0x106F49FD,
            0x18C,
            3,
        ),
        (
            "UseVertexColor",
            0x106F4A21,
            0x106F4A1C,
            0x108E8668,
            0x106F4A4D,
            0x106F4A44,
            0x188,
            3,
        ),
        (
            "bStaticMeshLod",
            0x106F4A68,
            0x106F4A63,
            0x108E8644,
            0x106F4A94,
            0x106F4A8B,
            0x194,
            3,
        ),
        (
            "StaticMeshLod01",
            0x106F4AAF,
            0x106F4AAA,
            0x108E861C,
            0x106F4AE0,
            0x106F4AD7,
            0x198,
            5,
        ),
        (
            "StaticMeshLod02",
            0x106F4AFB,
            0x106F4AF6,
            0x108E8510,
            0x106F4B2C,
            0x106F4B23,
            0x19C,
            5,
        ),
        (
            "LodRange01",
            0x106F4B47,
            0x106F4B42,
            0x108E84F4,
            0x106F4B73,
            0x106F4B6A,
            0x1A0,
            4,
        ),
        (
            "LodRange02",
            0x106F4B8E,
            0x106F4B89,
            0x108E84D8,
            0x106F4BBA,
            0x106F4BB1,
            0x1A4,
            4,
        ),
        (
            "bStaticMeshLodBlend",
            0x106F4BD5,
            0x106F4BD0,
            0x108E84A8,
            0x106F4C01,
            0x106F4BF8,
            0x1B4,
            3,
        ),
        (
            "bMakeTwoSideMesh",
            0x106F4C1C,
            0x106F4C17,
            0x108E8480,
            0x106F4C48,
            0x106F4C3F,
            0x1B8,
            3,
        ),
        (
            "bUseBillBoard",
            0x106F4C63,
            0x106F4C5E,
            0x108E845C,
            0x106F4C8F,
            0x106F4C86,
            0x1C0,
            3,
        ),
        (
            "Materials",
            0x106F4E1A,
            0x106F4E15,
            0x108E8364,
            0x106F4E47,
            0x106F4E3E,
            0x13C,
            9,
        ),
    ]
    for name, name_call, name_at, name_ptr, ctor, offset_at, offset, kind in declared:
        engine.instruction(name_call, "call", "edi")
        engine.instruction(name_at, "push", hex(name_ptr))
        engine.instruction(offset_at, "push", hex(offset))
        assert engine.wide(name_ptr) == name
        assert bytes(
            engine.data[
                engine.offset(name_ptr) : engine.offset(name_ptr) + 2 * (len(name) + 1)
            ]
        ) == comparison_engine.read(name_ptr, 2 * (len(name) + 1))
        assert (
            ctor
            in imports[
                next(
                    s
                    for s in imports
                    if s.startswith(
                        "??0U"
                        + {3: "Bool", 4: "Float", 5: "Object", 9: "Array"}[kind]
                        + "Property@@"
                    )
                )
            ]
        )
        assert offset >= 0x34
        declarations.append(
            dict(
                name=name,
                type=kind,
                offset=hex(offset),
                nameCall=hex(name_call),
                constructor=hex(ctor),
            )
        )
    core_blocks = []
    for label, lo, hi in [
        ("CreateExport normal paths", 0x10149660, 0x101498B3),
        ("StaticAllocateObject normal paths", 0x101677C0, 0x10167CE0),
        ("StaticConstructObject", 0x10167EB0, 0x10167F3E),
        ("InitProperties", 0x1015FB00, 0x1015FC7A),
        ("Preload", 0x10148B50, 0x10148DE3),
        ("UObject.Serialize", 0x1015E820, 0x1015EA8F),
        ("ConditionalPostLoad", 0x1015E650, 0x1015E6D4),
        ("GetClass", 0x1010A1E0, 0x1010A1E4),
        ("native UProperty constructor", 0x10174F60, 0x10174FF3),
        ("native UBoolProperty constructor", 0x1011E140, 0x1011E1A6),
        ("native UFloatProperty constructor", 0x1011E3D0, 0x1011E42F),
        ("native UObjectProperty constructor", 0x1011E650, 0x1011E6B6),
        ("native UArrayProperty constructor", 0x1011F350, 0x1011F3AF),
        ("UClass.Register", 0x101339D0, 0x10133AF6),
        ("UStruct.Link normal paths", 0x10135E30, 0x10136218),
        ("SetLinker", 0x10163DF0, 0x10163EB7),
        ("AddObject", 0x101617B0, 0x10161914),
    ]:
        raw = bytes(core.data[core.offset(lo) : core.offset(lo) + hi - lo])
        assert raw == comparison_core.read(lo, hi - lo)
        core_blocks.append(
            dict(
                label=label,
                start=hex(lo),
                end=hex(hi),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    anchors = [
        (0x10149794, "and", "ecx, 0x67f01a5"),
        (0x1014979A, "or", "ecx, 0x1000200"),
        (0x10167B64, "and", "eax, 0xc000100"),
        (0x10167BE4, "test", "byte ptr [edi + 0x4a4], 8"),
        (0x10167BED, "or", "ebx, 0x4000"),
        (0x10167C10, "mov", "dword ptr [esi + 0x1c], ebx"),
        (0x10167C8B, "test", "dword ptr [edi + 0x4a4], 0x400"),
        (0x1015FB45, "mov", "ecx, 0x34"),
        (0x10148C70, "and", "dword ptr [esi + 0x1c], 0xfffffdff"),
        (0x10148C7A, "or", "eax, 0x8000"),
        (0x10148C95, "and", "dword ptr [esi + 0x1c], 0xffff7fff"),
        (0x1015E84B, "or", "dword ptr [esi + 0x1c], 0x40000000"),
        (0x1015E680, "test", "eax, 0x1000000"),
        (0x1015E687, "and", "eax, 0xdeffffff"),
        (0x10174FB4, "mov", "dword ptr [esi + 0x54], edx"),
        (0x10174F9E, "mov", "dword ptr [esi + 0x40], 1"),
        (0x10135FE5, "mov", "dword ptr [esi + 0x54], edi"),
        (0x10133AA1, "push", "0"),
    ]
    for row in anchors:
        core.instruction(*row)
    return dict(
        engineBlocks=[
            dict(
                label="native mesh property constructor",
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(original).hexdigest(),
                comparison=comparison,
                operandBindings=operands,
            )
        ],
        coreBlocks=core_blocks,
        declarations=declarations,
        anchors=anchors,
        limits=[
            "Current class flags are explicit input; class registration, custom templates, reuse, external CDO changes and complete package resolution are not executed or inferred.",
            "Fresh referenced native mesh only; normal admitted property types and native offsets. Script stacks, unknown/duplicate/indexed tags and compatibility conversions remain unsupported.",
            "Flag operations are interpreted in bounded original slices; matched callers retain branch context but do not constitute execution of the entire loader.",
            "Property declaration names/types/offsets are source bound. Only ten entry bytes qualify relocated exception handlers; full exception behavior is outside scope.",
            "Supplemental byte correspondence does not authenticate a distribution or restore a protected runtime.",
        ],
    )
