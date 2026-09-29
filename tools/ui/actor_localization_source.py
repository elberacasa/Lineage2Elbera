"""Elbera Tools: pinned original object-localization control flow.

Current reflection, names, language, configuration and property storage remain
caller inputs. This qualifier reads images; it never executes a native DLL.
"""

import hashlib

from actor_transform_source import raw
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA


def qualify_string_property_text(core, comparison):
    """Bind the flags&2-clear ImportText path and complete assignment helpers.

    The ImportText block is deliberately a guarded PREFIX, not the full quoted
    parser. Stack probing is interpreted over supplied committed stack memory.
    Allocation and memcpy stay explicit providers; no native DLL executes.
    """
    assert (core.sha, comparison.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    symbol = "?ImportText@UStrProperty@@UBEPBGPBGPAEH@Z"
    assert core.exported(symbol, True) == comparison.body(symbol) == 0x10173AE0
    thunk = core.exported(symbol)
    assert comparison.exports[symbol] == thunk
    targets = {hex(thunk): "0x10173ae0"}
    for name, at in (
        ("??4FString@@QAEAAV0@PBG@Z", 0x1010492B),
        ("?Realloc@FArray@@IAEXH@Z", 0x101031D9),
        ("?appStrlen@@YAHPBG@Z", 0x101034CC),
    ):
        assert core.exported(name) == comparison.exports[name] == at
    for at, body in (
        (thunk, 0x10173AE0),
        (0x1010492B, 0x10114FD0),
        (0x101031D9, 0x101522E0),
        (0x101034CC, 0x1012DB60),
    ):
        core.instruction(at, "jmp", hex(body))
        assert raw(core, at, at + 5) == comparison.read(at, 5)
        targets[hex(at)] = hex(body)
    table = "??_7UStrProperty@@6B@"
    assert core.u32(core.exported(table) + 0x9C) == thunk
    assert comparison.u32(comparison.exports[table] + 0x9C) == thunk
    blocks = []
    for name, start, end, scope in (
        (
            "UStrProperty.ImportText",
            0x10173AE0,
            0x10173B3A,
            "portFlags & 2 clear prefix",
        ),
        ("FString wide assignment", 0x10114FD0, 0x1011501E, "complete ordinary body"),
        ("FArray.Realloc", 0x101522E0, 0x10152346, "complete ordinary body"),
        ("UTF-16 strlen", 0x1012DB60, 0x1012DB77, "complete body"),
        (
            "compiler stack probe",
            0x1017ECE0,
            0x1017ED0B,
            "complete normal control flow",
        ),
    ):
        data = raw(core, start, end)
        assert data == comparison.read(start, len(data))
        rows = list(core.dis.disasm(data, start))
        assert sum(row.size for row in rows) == len(data)
        blocks.append(
            dict(
                name=name,
                start=hex(start),
                end=hex(end),
                scope=scope,
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    anchors = (
        (0x10173B13, "test", "byte ptr [ebp + 0x10], 2"),
        (0x10173B17, "jne", "0x10173b3a"),
        (0x10173B20, "call", "0x1010492b"),
        (0x10173B25, "mov", "eax, esi"),
        (0x10114FD8, "cmp", "dword ptr [esi], edi"),
        (0x10114FF6, "mov", "dword ptr [esi + 8], eax"),
        (0x10114FF9, "mov", "dword ptr [esi + 4], eax"),
        (0x10114FF2, "push", "2"),
        (0x1011500F, "call", "0x1017ac60"),
        (0x10152328, "call", "eax"),
    )
    for anchor in anchors:
        core.instruction(*anchor)
    return dict(
        coreBlocks=blocks,
        thunkTargets=targets,
        importTextTarget=hex(thunk),
        vtable=hex(core.exported(table)),
        anchors=anchors,
        limits=[
            "Only the flags&2-clear ImportText prefix; quoted parsing is not ported.",
            "Successful supplied allocator/memcpy and committed stack memory; not OS allocation, guard faults or SEH execution.",
            "Browser compares text code units; native pointers and heap capacities remain interpreter evidence only.",
        ],
    )


def qualify_actor_localization(core, comparison):
    assert (core.sha, comparison.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    methods = (
        ("?LoadLocalized@UObject@@QAEXXZ", 0x1015F5E0, 0x1015F6C4),
        ("?appStaticString1024@@YAPAGXZ", 0x10152570, 0x101525CC),
        ("?Localize@@YAPBGPBG000H@Z", 0x10153E70, 0x10153F9D),
        ("?GetLanguage@UObject@@SAPBGXZ", 0x1015B9F0, 0x1015BA2E),
        ("?GetInheritanceSuper@UStruct@@UAEPAV1@XZ", 0x10115950, 0x10115954),
        ("?GetInheritanceSuper@UClass@@UAEPAVUStruct@@XZ", 0x10115A20, 0x10115A24),
    )
    internal = (
        (None, 0x1015F460, 0x1015F559),  # recursive field worker
        (None, 0x1015C690, 0x1015C73F),  # struct-first property dispatch
        (0x10101EB0, 0x101329A0, 0x101329C2),  # StructProperty cast
        (0x101014CE, 0x10119210, 0x1011923E),  # TFieldIterator constructor
        (0x101040C0, 0x10114340, 0x10114395),  # iterator filtering/inheritance
        (0x10102E23, 0x1012E080, 0x1012E09D),  # appSprintf -> CRT boundary
        (0x10103C47, 0x1012DD00, 0x1012DD05),  # case-insensitive CRT boundary
        (0x10101F4B, 0x1012DD10, 0x1012DD35),  # UTF-16 copy
    )
    blocks, targets = [], {}
    for symbol, start, end in methods:
        assert core.exported(symbol, True) == comparison.body(symbol) == start
        thunk = core.exported(symbol)
        assert comparison.exports[symbol] == thunk
        targets[hex(thunk)] = hex(start)
        core.instruction(thunk, "jmp", hex(start))
        assert raw(core, thunk, thunk + 5) == comparison.read(thunk, 5)
    for thunk, start, end in internal:
        if thunk is not None:
            core.instruction(thunk, "jmp", hex(start))
            assert raw(core, thunk, thunk + 5) == comparison.read(thunk, 5)
            targets[hex(thunk)] = hex(start)
    for label, start, end in (*methods, *internal):
        data = raw(core, start, end)
        assert data == comparison.read(start, len(data)), hex(start)
        rows = list(core.dis.disasm(data, start))
        assert sum(row.size for row in rows) == len(data)
        assert rows[-1].mnemonic in ("ret", "jmp")
        blocks.append(
            dict(
                start=hex(start), end=hex(end), SHA256=hashlib.sha256(data).hexdigest()
            )
        )

    names = {
        "?GIsEditor@@3HA": 0x1023E8C4,
        "?GIsStarted@@3HA": 0x1023E8E0,
        "?GConfig@@3PAVFConfigCache@@A": 0x1023C68C,
        "?Names@FName@@0V?$TArray@PAUFNameEntry@@@@A": 0x10327AE0,
        "?PrivateStaticClass@UStructProperty@@0VUClass@@A": 0x1033B0F0,
        "?GLanguage@UObject@@1PAGA": 0x1023A4C8,
    }
    for name, address in names.items():
        assert core.exported(name) == comparison.exports[name] == address
    strings = {
        0x101D9814: "%s.",
        0x101D981C: "%s%s[%d]",
        0x101D9830: "%s%s",
        0x101D6318: "%s.%s",
        0x101D6324: "int",
        0x101D632C: "int",
    }
    for address, value in strings.items():
        assert core.wide(address) == value
        encoded = value.encode("utf-16le") + b"\0\0"
        assert comparison.read(address, len(encoded)) == encoded
    vtables = []
    for cls, method in (("UStruct", methods[4][0]), ("UClass", methods[5][0])):
        table = "??_7" + cls + "@@6B@"
        assert core.u32(core.exported(table) + 0x7C) == core.exported(method)
        assert (
            comparison.u32(comparison.exports[table] + 0x7C)
            == comparison.exports[method]
        )
        vtables.append(dict(table=table, slot="0x7c", method=method))
    return dict(
        ownedCoreSHA256=core.sha,
        supplementalCoreSHA256=comparison.sha,
        coreBlocks=blocks,
        thunkTargets=targets,
        globals={name: hex(at) for name, at in names.items()},
        strings={hex(at): value for at, value in strings.items()},
        vtables=vtables,
        limits=[
            "Complete ordinary control-flow ranges; exception/unwind handlers are excluded.",
            "Optional localization only. Nonoptional diagnostics and missing-text markers are not admitted.",
            "CRT formatting/comparison, current configuration and virtual ImportText are explicit provider boundaries.",
            "Current class flags, linked metadata, names and storage are supplied, not inferred from saved exports.",
        ],
    )
