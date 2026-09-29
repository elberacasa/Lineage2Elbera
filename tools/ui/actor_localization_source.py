"""Elbera Tools: pinned original object-localization control flow.

Current reflection, names, language, configuration and property storage remain
caller inputs. This qualifier reads images; it never executes a native DLL.
"""

import hashlib

from actor_transform_source import raw
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA


def qualify_class_default_initialization(core, comparison):
    """Bind CDO header/parent initialization and LoadConfig's nonconfig return.

    Configuration-enabled classes stop at the next instruction. Class linking,
    tagged properties, native constructors and actual configuration are separate
    stages; this does not claim the entire UClass lifecycle.
    """
    assert (core.sha, comparison.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    methods = (
        ("?InitClassDefaultObject@UObject@@QAEXPAVUClass@@H@Z", 0x1015FE10),
        ("?InitProperties@UObject@@SAXPAEHPAVUClass@@0HPAV1@2@Z", 0x1015FB00),
        ("?GetPropertiesSize@UStruct@@UAEHXZ", 0x1010B310),
        ("?GetDefaultObject@UClass@@QAEPAVUObject@@XZ", 0x10115BB0),
        ("?LoadConfig@UObject@@QAEXHPAVUClass@@PBG@Z", 0x10166740),
        ("?appMemset@@YAXPAXHH@Z", 0x1012DA20),
    )
    targets, blocks = {}, []
    for symbol, start in methods:
        assert core.exported(symbol, True) == comparison.body(symbol) == start
        thunk = core.exported(symbol)
        assert comparison.exports[symbol] == thunk
        core.instruction(thunk, "jmp", hex(start))
        assert raw(core, thunk, thunk + 5) == comparison.read(thunk, 5)
        targets[hex(thunk)] = hex(start)
    for label, start, end, terminal in (
        ("InitClassDefaultObject", 0x1015FE10, 0x1015FE9F, "ret"),
        ("InitProperties", 0x1015FB00, 0x1015FC7A, "ret"),
        ("GetPropertiesSize", 0x1010B310, 0x1010B314, "ret"),
        ("GetDefaultObject", 0x10115BB0, 0x10115BE5, "ret"),
        ("appMemset CRT boundary", 0x1012DA20, 0x1012DA25, "jmp"),
        ("LoadConfig gate", 0x10166740, 0x1016678C, "je"),
        ("LoadConfig normal return", 0x10166AC4, 0x10166AD7, "ret"),
        ("UClass.Serialize initialization call", 0x10135325, 0x10135336, "call"),
        ("UClass.Serialize config/localization calls", 0x1013534A, 0x1013536C, "call"),
        ("UClass.Register initialization call", 0x10133A44, 0x10133A55, "call"),
        ("UClass.Register config/localization calls", 0x10133AB1, 0x10133AD3, "call"),
    ):
        data = raw(core, start, end)
        assert data == comparison.read(start, len(data))
        rows = list(core.dis.disasm(data, start))
        assert sum(row.size for row in rows) == len(data)
        assert rows[-1].mnemonic == terminal
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    anchors = (
        (0x1015FE3A, "push", "0x34"),
        (0x1015FE3C, "push", "0"),
        (0x1015FE3F, "call", "0x10101505"),
        (0x1015FE4C, "mov", "dword ptr [esi], eax"),
        (0x1015FE4E, "mov", "dword ptr [esi + 0x24], ecx"),
        (0x1015FE54, "mov", "dword ptr [esi + 4], edi"),
        (0x1015FE57, "mov", "dword ptr [esi + 0x28], edi"),
        (0x1015FE64, "mov", "dword ptr [esi + 0x18], edx"),
        (0x1015FE67, "mov", "edx, dword ptr [ecx + 0x34]"),
        (0x1015FE81, "call", "0x1010119f"),
        (0x10166776, "mov", "eax, dword ptr [edi + 0x24]"),
        (0x1016677F, "test", "byte ptr [ebx + 0x4a4], 4"),
        (0x10166786, "je", "0x10166ac4"),
        (0x10166AD4, "ret", "0xc"),
    )
    for anchor in anchors:
        core.instruction(*anchor)
    # Both original CDO callers pass zero for InitClassDefaultObject's second
    # argument and for all three LoadConfig arguments. Named callees are bound
    # above, plus LoadLocalized by qualify_actor_localization.
    for at in (
        0x10135325,
        0x10133A44,
        0x1013534A,
        0x1013534C,
        0x1013534E,
        0x10133AB1,
        0x10133AB3,
        0x10133AB5,
    ):
        core.instruction(at, "push", "0")
    table = "??_7UClass@@6B@"
    size_thunk = core.exported(methods[2][0])
    assert core.u32(core.exported(table) + 0x78) == size_thunk
    assert comparison.u32(comparison.exports[table] + 0x78) == size_thunk
    return dict(
        coreBlocks=blocks,
        thunkTargets=targets,
        anchors=anchors,
        configMask=4,
        configContinuation="0x1016678c",
        limits=[
            "Normal CDO header initialization and parent-default copying with explicit current metadata/storage. No tagged-property or class-binding execution is implied.",
            "Only the bit-4-clear LoadConfig path returns here; enabled configuration stops at the qualified continuation, before any provider call.",
            "CRT memset/memcpy and successful allocation are explicit providers. No DLL or operating-system I/O executes.",
        ],
    )


def qualify_string_property_loading(core, comparison):
    """Bind original string archive loading and single-value deep copying.

    Entire ordinary bodies include their later saving branches. Only loading
    is interpreted; archive I/O/accounting and successful allocation remain
    explicit providers. Exception handlers and malformed data are not admitted.
    """
    assert (core.sha, comparison.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    blocks, targets = [], {}
    methods = (
        (
            "?SerializeItem@UStrProperty@@UBEXAAVFArchive@@PAXH@Z",
            0x1016F040,
            0x1016F055,
        ),
        (
            "?CopySingleValue@UStrProperty@@UBEXPAX0PAVUObject@@@Z",
            0x10175380,
            0x101753DC,
        ),
        (
            "?CopyCompleteValue@UProperty@@UBEXPAX0PAVUObject@@@Z",
            0x1016E050,
            0x1016E092,
        ),
        ("??6@YAAAVFArchive@@AAV0@AAVFString@@@Z", 0x10155360, 0x101554A9),
        ("??6@YAAAVFArchive@@AAV0@AAVFCompactIndex@@@Z", 0x1015CFB0, 0x1015D18D),
        ("?CountBytes@?$TArray@G@@QAEXAAVFArchive@@@Z", 0x101137E0, 0x101137FE),
        ("?appIsPureAnsi@@YAHPBG@Z", 0x1014F6F0, 0x1014F71B),
        ("?Empty@FString@@QAEXXZ", 0x10115040, 0x10115050),
    )
    for symbol, start, end in methods:
        assert core.exported(symbol, True) == comparison.body(symbol) == start
        thunk = core.exported(symbol)
        assert comparison.exports[symbol] == thunk
        core.instruction(thunk, "jmp", hex(start))
        assert raw(core, thunk, thunk + 5) == comparison.read(thunk, 5)
        targets[hex(thunk)] = hex(start)
    helpers = (
        (0x10101023, 0x101150B0, 0x101150BF),
        (0x10102D8D, 0x101307E0, 0x101307F9),
        (0x10102DE2, 0x10130800, 0x10130819),
    )
    for thunk, start, end in helpers:
        core.instruction(thunk, "jmp", hex(start))
        assert raw(core, thunk, thunk + 5) == comparison.read(thunk, 5)
        targets[hex(thunk)] = hex(start)
    for label, start, end in (*methods, *helpers):
        data = raw(core, start, end)
        assert data == comparison.read(start, len(data))
        rows = list(core.dis.disasm(data, start))
        assert sum(row.size for row in rows) == len(data)
        assert rows[-1].mnemonic in ("ret", "jmp")
        blocks.append(
            dict(
                start=hex(start), end=hex(end), SHA256=hashlib.sha256(data).hexdigest()
            )
        )
    table = "??_7UStrProperty@@6B@"
    dispatch = []
    for slot, method in (
        (0x90, methods[0][0]),
        (0xA4, methods[1][0]),
        (0xA8, methods[2][0]),
    ):
        thunk = core.exported(method)
        assert core.u32(core.exported(table) + slot) == thunk
        assert comparison.u32(comparison.exports[table] + slot) == thunk
        dispatch.append(dict(slot=hex(slot), method=method, target=hex(thunk)))
    assert (
        raw(core, 0x101CDD44, 0x101CDD46) == comparison.read(0x101CDD44, 2) == b"\0\0"
    )
    anchors = (
        (0x101553BD, "cmp", "dword ptr [ebx + 0x10], edi"),
        (0x101553D5, "push", "2"),
        (0x101553F8, "movzx", "dx, byte ptr [ebp - 0x13]"),
        (0x10155422, "mov", "cx, word ptr [ebp - 0x14]"),
        (0x10155435, "cmp", "dword ptr [esi + 4], 1"),
        (0x1015543D, "call", "0x101034e0"),
        (0x1017538A, "cmp", "esi, edi"),
        (0x101753B6, "call", "0x1017ac60"),
        (0x101753CF, "call", "0x1017ac60"),
    )
    for anchor in anchors:
        core.instruction(*anchor)
    return dict(
        coreBlocks=blocks,
        thunkTargets=targets,
        vtable=table,
        dispatch=dispatch,
        emptyTextAddress="0x101cdd44",
        anchors=anchors,
        limits=[
            "Loading and single/complete string copying; saving and full class/property admission remain separate work.",
            "Bounded nonoverflowing successful reads, supplied byte accounting/allocation/memcpy; no DLL or OS I/O executes.",
            "Terminated values (plus original count-one clearing) are an explicit decoder admission, not a native validation claim.",
            "Copying uses distinct stable headers and nonoverlapping allocations or the same-header no-op. Providers do not mutate the source.",
        ],
    )


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
