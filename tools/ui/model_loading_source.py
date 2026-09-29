"""Elbera Tools: original Model loading and ordinary PostLoad source bindings.

Pinned file123 inputs; no native DLL execution. Rendering arrays with entries,
transaction archives, localization and full native object construction remain
outside the browser resource subset.
"""

from static_collision_source import (
    ENGINE_SHA,
    CORE_SHA,
    CANDIDATE_ENGINE_SHA,
    CANDIDATE_CORE_SHA,
    COMPACT_INDEX,
    _engine_block,
)


def qualify_model_loading(engine, core, comparison, comparison_core):
    assert (engine.sha, core.sha, comparison.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        CANDIDATE_ENGINE_SHA,
        CANDIDATE_CORE_SHA,
    )
    version = "?Ver@FArchive@@QAEHXZ"
    loading = "?IsLoading@FArchive@@QAEHXZ"
    licensee = "?LicenseeVer@FArchive@@QAEHXZ"
    counted = "?CountBytes@FArray@@QAEXAAVFArchive@@H@Z"
    array = "??0FArray@@QAE@XZ"
    postload = "?PostLoad@UObject@@UAEXXZ"
    add = "?Add@FArray@@QAEHHH@Z"
    blocks = []

    def block(label, start, end, delta, imports, operands=()):
        raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
        direct = [
            i.address
            for i in engine.dis.disasm(raw, start)
            if i.mnemonic == "call" and i.bytes[0] == 0xE8
        ]
        blocks.append(
            _engine_block(
                engine, comparison, label, start, end, delta, imports, direct, operands
            )
        )

    for symbol, owned, other in [
        ("?Serialize@UModel@@UAEXAAVFArchive@@@Z", 0x105EF380, 0x105EF340),
        ("?PostLoad@UModel@@UAEXXZ", 0x105EAB60, 0x105EAB20),
        ("??6@YAAAVFArchive@@AAV0@AAVFBspSurf@@@Z", 0x105EA060, 0x105EA020),
    ]:
        assert (
            engine.exported(symbol, True) == owned and comparison.body(symbol) == other
        )
    imports = [
        (at, version)
        for at in (
            0x105EF468,
            0x105EF4BC,
            0x105EF573,
            0x105EF580,
            0x105EF5B4,
            0x105EF5F8,
            0x105EF605,
            0x105EF637,
            0x105EF654,
            0x105EF676,
            0x105EF683,
            0x105EF6D9,
        )
    ] + [(at, loading) for at in (0x105EF661, 0x105EF6C1, 0x105EF6F6, 0x105EF70C)]
    imports += [(0x105EF450, "?IsTrans@FArchive@@QAEHXZ"), (0x105EF6A4, licensee)]
    block("Model normal Serialize", 0x105EF398, 0x105EF72C, -64, sorted(imports))
    block(
        "surface normal serializer and licensee gate",
        0x105EA078,
        0x105EA1D8,
        -64,
        [(at, version) for at in (0x105EA0D6, 0x105EA0FE, 0x105EA13A, 0x105EA154)]
        + [(0x105EA170, loading), (0x105EA185, licensee), (0x105EA1B3, loading)],
        [(0x105EA0B1, 0x11D8D910, 0x11D8D90C, COMPACT_INDEX)],
    )
    block(
        "surface constructor normal path",
        0x105EB9E5,
        0x105EBA20,
        -64,
        [(0x105EB9F6, array)],
    )
    block(
        "surface loading constructor dispatch",
        0x105ED251,
        0x105ED2CA,
        -64,
        [(0x105ED261, counted), (0x105ED269, loading), (0x105ED278, COMPACT_INDEX)],
    )
    block(
        "surface archive transaction gate",
        0x105EE018,
        0x105EE047,
        -64,
        [(0x105EE01D, "?IsTrans@FArchive@@QAEHXZ")],
    )
    for label, start, end, count_at, loading_at, compact_at in [
        (
            "section array",
            0x105EEFA1,
            0x105EF059,
            0x105EEFB1,
            0x105EEFB9,
            (0x105EEFC8, 0x105EF01F),
        ),
        (
            "multi-light-map array",
            0x105EF0F1,
            0x105EF1B0,
            0x105EF101,
            0x105EF109,
            (0x105EF118, 0x105EF16F),
        ),
        (
            "light-map array",
            0x105EF251,
            0x105EF30C,
            None,
            0x105EF266,
            (0x105EF275, 0x105EF2CF),
        ),
    ]:
        block(
            label,
            start,
            end,
            -64,
            ([(count_at, counted)] if count_at else [])
            + [(loading_at, loading)]
            + [(at, COMPACT_INDEX) for at in compact_at],
        )
    block(
        "Model normal PostLoad", 0x105EAB78, 0x105EABE3, -64, [(0x105EABC5, postload)]
    )
    block("surface node append", 0x104225E0, 0x104225FC, 0, [(0x104225E7, add)])
    thunks = {
        0x10315087: (0x105EEF80, -64),
        0x1030E7B4: (0x105EF230, -64),
        0x1030F3A3: (0x105EF0D0, -64),
        0x103124B8: (0x105EDFF0, -64),
        0x1030195B: (0x105ED230, -64),
        0x1030A588: (0x105EB9D0, -64),
        0x10301BC2: (0x105EA060, -64),
        0x1031502D: (0x104225E0, 0),
    }
    for thunk, (body, delta) in thunks.items():
        engine.instruction(thunk, "jmp", hex(body))
        row = next(engine.dis.disasm(comparison.read(thunk, 5), thunk))
        assert (row.mnemonic, row.op_str) == ("jmp", hex(body + delta))
    anchors = [
        (0x105EF3AC, "call", "0x10311293"),
        (0x105EA18B, "cmp", "eax, 0x15"),
        (0x105EA190, "add", "edi, 0x40"),
        (0x105EA195, "call", "0x1030599d"),
        (0x105EF5E6, "lea", "eax, [edi + 0xe4]"),
        (0x105EF642, "lea", "ebx, [edi + 0x10c]"),
        (0x105EF6AF, "lea", "eax, [edi + 0xf0]"),
        (0x105EF6CB, "mov", "dword ptr [edi + 0xfc], 1"),
        (0x105EB9EB, "lea", "ecx, [esi + 0x20]"),
        (0x105EAB8F, "cmp", "esi, dword ptr [edi + 0x68]"),
        (0x105EABA5, "mov", "eax, dword ptr [eax + 0x1c]"),
        (0x105EABB5, "lea", "ecx, [edx + ecx*4 + 0x20]"),
    ]
    for args in anchors:
        engine.instruction(*args)
    for symbol, target in [
        (array, 0x101091F0),
        (postload, 0x10163C60),
        (add, 0x101090C0),
    ]:
        assert core.exported(symbol, True) == comparison_core.body(symbol) == target
    table, method, slot = "??_7UModel@@6B@", "?PostLoad@UModel@@UAEXXZ", 0x24
    assert engine.u32(engine.exported(table) + slot) == engine.exported(method)
    assert (
        comparison.u32(comparison.exports[table] + slot) == comparison.exports[method]
    )
    return dict(
        scope="original-model-ordinary-loading",
        engineBlocks=blocks,
        anchors=len(anchors),
        postLoadVtable=dict(table=table, slot=hex(slot), method=method),
        importTargets={
            "0x105eb9f6": "0x101091f0",
            "0x105eabc5": "0x10163c60",
            "0x104225e7": "0x101090c0",
        },
        thunkTargets={hex(thunk): hex(body) for thunk, (body, _) in thunks.items()},
        limits=[
            "Serializer correspondence and selected load/PostLoad execution; not a complete native archive, class registry or renderer.",
            "Current object flags, successful storage and ordinary archive modes remain explicit inputs.",
            "SEH frame prefixes are retained separately for ordinary execution; exception handling is excluded.",
        ],
    )
