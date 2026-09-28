"""Elbera Tools: source actor-transform bindings and static-cache boundary.

Every image/package is pinned. Declared erased imports and the named GMath
operand are normalized only after independent supplemental qualification.
This module reads files only when called; it never executes a native image.
"""

from pathlib import Path
import hashlib
import struct
import sys

from check_tutorial_quest_native import ENGINE_SHA
from check_cast_sound_native import PACKAGE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA, CANDIDATE_ENGINE_SHA
from check_hair_attachment_native import compare_call_block

ROOT = Path(__file__).resolve().parents[2]
COMPARISON_SHA = CANDIDATE_ENGINE_SHA
COMPARISON_CORE_SHA = CANDIDATE_CORE_SHA


def raw(image, a, b):
    return bytes(image.data[image.offset(a) : image.offset(b)])


def qualify_actor_collision_fields(
    engine, core, comparison_engine, comparison_core, package
):
    """Bind declared Boolean groups and primitive/level reference identities."""
    sys.path[:0] = [
        str(ROOT / "tools/world"),
        str(ROOT / "tools"),
        str(ROOT / "tools/dat"),
    ]
    from export_static_collision import actor_boolean_layout, actor_declaration

    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        COMPARISON_SHA,
        COMPARISON_CORE_SHA,
    )
    assert hashlib.sha256(package.path.read_bytes()).hexdigest() == PACKAGE_SHA
    copy = "??0AActor@@QAE@ABV0@@Z"
    assert engine.exported(copy, True) == comparison_engine.body(copy) == 0x103B60F0
    layout = actor_boolean_layout(package)
    blocks = []
    for group, (offset, start, entry, end) in zip(
        layout,
        [
            ("0x64", 0x103B6221, 0x103B6227, 0x103B635A),
            ("0x74", 0x103B635A, 0x103B636F, 0x103B64C1),
            ("0x2e4", 0x103B6B8B, 0x103B6B98, 0x103B6D52),
            ("0x2f8", 0x103B6D76, 0x103B6D82, 0x103B6EE9),
        ],
    ):
        assert group["offset"] == offset
        data = raw(engine, start, end)
        assert data == comparison_engine.read(start, len(data))
        rows = list(engine.dis.disasm(data, start))
        assert sum(row.size for row in rows) == len(data)
        masks = [
            int(row.op_str.split(", ")[1], 0) for row in rows if row.mnemonic == "and"
        ]
        assert masks == [field["mask"] for field in group["fields"]]
        blocks.append(
            dict(
                offset=offset,
                start=hex(start),
                entry=hex(entry),
                end=hex(end),
                SHA256=hashlib.sha256(data).hexdigest(),
                declaredMasks=masks,
            )
        )
    symbol = "?Link@UBoolProperty@@UAEXAAVFArchive@@PAVUProperty@@@Z"
    assert core.exported(symbol, True) == comparison_core.body(symbol) == 0x10173250
    data = raw(core, 0x10173250, 0x101732F1)
    assert data == comparison_core.read(0x10173250, len(data))
    for at, op, args in [
        (0x1017329D, "test", "dword ptr [edi + 0x78], 0x7fffffff"),
        (0x101732A6, "mov", "eax, dword ptr [ebx + 0x54]"),
        (0x101732A9, "mov", "dword ptr [esi + 0x54], eax"),
        (0x101732AC, "mov", "ecx, dword ptr [edi + 0x78]"),
        (0x101732AF, "add", "ecx, ecx"),
        (0x101732C0, "add", "eax, 3"),
        (0x101732C3, "and", "eax, 0xfffffffc"),
        (0x101732C9, "mov", "dword ptr [esi + 0x78], 1"),
        (0x101732D0, "mov", "dword ptr [esi + 0x44], 4"),
    ]:
        core.instruction(at, op, args)
    owner = next(
        e
        for e in package.exports
        if package.class_name_of(e) == "Class" and package.export_name(e) == "Actor"
    )
    owner_ref = owner.index + 1
    chains = []
    for fields, start, end in [
        (
            [
                ("Physics", "ByteProperty", "Engine.Actor.EPhysics", 0x34),
                ("DrawType", "ByteProperty", "Engine.Actor.EDrawType", 0x35),
                ("StaticMesh", "ObjectProperty", "Engine.StaticMesh", 0x38),
                ("Owner", "ObjectProperty", "Engine.Actor", 0x3C),
            ],
            0x103B6129,
            0x103B6143,
        ),
        (
            [
                ("AttachType", "ByteProperty", "Engine.Actor.EAttachType", 0xDC),
                ("Level", "ObjectProperty", "Engine.LevelInfo", 0xE0),
                ("XLevel", "ObjectProperty", "Engine.Level", 0xE4),
                ("LifeSpan", "FloatProperty", None, 0xE8),
            ],
            0x103B668E,
            0x103B66BF,
        ),
        (
            [
                ("TimerRate", "FloatProperty", None, 0x100),
                ("Mesh", "ObjectProperty", "Engine.Mesh", 0x104),
                ("LastRenderTime", "FloatProperty", None, 0x108),
            ],
            0x103B66FB,
            0x103B671F,
        ),
        (
            [
                (
                    "StaticMeshInstance",
                    "ObjectProperty",
                    "Engine.StaticMeshInstance",
                    0x274,
                ),
                ("Brush", "ObjectProperty", "Engine.Model", 0x278),
                ("DrawScale", "FloatProperty", None, 0x27C),
            ],
            0x103B6A39,
            0x103B6A5D,
        ),
        (
            [
                ("AmbientGlow", "ByteProperty", None, 0x2B4),
                ("MaxLights", "ByteProperty", None, 0x2B5),
                ("AntiPortal", "ObjectProperty", "Engine.ConvexVolume", 0x2B8),
                ("CullDistance", "FloatProperty", None, 0x2BC),
            ],
            0x103B6AF0,
            0x103B6B22,
        ),
    ]:
        matches = [
            e
            for e in package.exports
            if e.package_index == owner_ref and package.export_name(e) == fields[0][0]
        ]
        assert len(matches) == 1
        ref, declarations = matches[0].index + 1, []
        for name, kind, target, offset in fields:
            row = actor_declaration(package, ref, owner_ref)
            assert (row["name"], row["kind"], row["reference"]) == (name, kind, target)
            declarations.append(dict(row, offset=hex(offset)))
            ref = row["next"]
        data = raw(engine, start, end)
        assert data == comparison_engine.read(start, len(data))
        rows = list(engine.dis.disasm(data, start))
        assert sum(row.size for row in rows) == len(data)
        # The typed copy chain consumes exactly these source field bases in
        # declaration order. Destination offsets are checked independently.
        sources = [
            row.op_str.split("[ebp + ")[1].split("]")[0]
            for row in rows
            if "[ebp + " in row.op_str
        ]
        destinations = [
            row.op_str.split("[ebx + ")[1].split("]")[0]
            for row in rows
            if "[ebx + " in row.op_str
        ]
        assert [int(s, 0) for s in sources] == [row[3] for row in fields]
        assert [int(s, 0) for s in destinations] == [row[3] for row in fields]
        chains.append(
            dict(
                declarations=declarations,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    return dict(
        packageSHA256=PACKAGE_SHA,
        booleanLayout=layout,
        copyBlocks=blocks,
        referenceChains=chains,
        booleanLink=dict(
            start="0x10173250",
            end="0x101732f1",
            SHA256=hashlib.sha256(raw(core, 0x10173250, 0x101732F1)).hexdigest(),
        ),
        limits=[
            "Source field identities and declared bits only; padding is not assigned a value.",
            "Copy slices and Link correspondence do not execute class layout, tagged loading, reference resolution or level membership.",
            "Level is a LevelInfo reference; XLevel is a separate transient Level reference. Saved absence does not prove a null live XLevel.",
        ],
    )


def qualify_static_actor_loading(engine, core, comparison_engine, comparison_core):
    """Bind ordinary actor construction and bounded PostLoad dependencies.

    This does not supply class defaults, current class flags, linked actor
    references or gameplay state. Constructors preserve incoming property
    storage; their no-init helpers must not be replaced by zero initialization.
    """
    from check_supplemental_engine import compare_method

    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        COMPARISON_SHA,
        COMPARISON_CORE_SHA,
    )
    name = "??0FName@@QAE@XZ"
    rotator = "??0FRotator@@QAE@XZ"
    array = "??0FArray@@QAE@W4ENoInit@@@Z"
    symbols = {
        "??0UObject@@QAE@XZ": (0x1015C420, 0x1015C44D),
        name: (0x10109D90, 0x10109D93),
        rotator: (0x1010DED0, 0x1010DED3),
        array: (0x10109200, 0x10109205),
        "??0FBox@@QAE@XZ": (0x1010EF70, 0x1010EF73),
        "?PostLoad@UObject@@UAEXXZ": (0x10163C60, 0x10163CB8),
        "?GetClass@UObject@@QBEPAVUClass@@XZ": (0x1010A1E0, 0x1010A1E4),
        "?SetFlags@UObject@@QAEXK@Z": (0x1010A210, 0x1010A21A),
    }
    ctor_imports = {
        0x10328B4F: "??0UObject@@QAE@XZ",
        0x10328C45: "??0FBox@@QAE@XZ",
    }
    for sites, symbol in [
        (
            [
                0x10328B66,
                0x10328B7E,
                0x10328B8A,
                0x10328B96,
                0x10328BB9,
                0x10328BDC,
                0x10328BE8,
                0x10328BF4,
                0x10328C5D,
                0x10328D12,
            ],
            name,
        ),
        (
            [
                0x10328B72,
                0x10328C51,
                0x10328C80,
                0x10328CD6,
                0x10328CE2,
                0x10328CEE,
                0x10328CFA,
                0x10328D06,
            ],
            rotator,
        ),
        (
            [
                0x10328BA8,
                0x10328BCB,
                0x10328C06,
                0x10328C1D,
                0x10328C34,
                0x10328C6F,
                0x10328C97,
                0x10328CAE,
                0x10328CC5,
                0x10328D24,
                0x10328D3B,
                0x10328D52,
            ],
            array,
        ),
    ]:
        ctor_imports.update(dict.fromkeys(sites, symbol))
    postload_imports = {
        0x1052F59A: "?PostLoad@UObject@@UAEXXZ",
        0x1052F5A2: "?GetClass@UObject@@QBEPAVUClass@@XZ",
        0x1052F5B3: "?LoadLocalized@UObject@@QAEXXZ",
        0x1052F5C5: "?SetFlags@UObject@@QAEXK@Z",
        0x1052F5E0: "?SetFlags@UObject@@QAEXK@Z",
    }
    bindings = [
        (0x10328D69, 0x11D8D768, "?GActorCurCount@UObject@@2HA"),
        (0x10328D71, 0x11D8D764, "?GActorNewCount@UObject@@2HA"),
        (0x10328D79, 0x11D8D768, "?GActorCurCount@UObject@@2HA"),
        (0x10328D81, 0x11D8D760, "?GActorPeakCount@UObject@@2HA"),
    ]
    blocks, import_targets = [], {}
    for symbol, start, end, handler, imports in [
        (
            "??0AActor@@QAE@XZ",
            0x10328B30,
            0x10328DA5,
            (0x107F071C, 0x107F06DC),
            ctor_imports,
        ),
        (
            "??0AStaticMeshActor@@QAE@XZ",
            0x103C2A40,
            0x103C2A9E,
            (0x10804CF7, 0x10804CB7),
            {0x103C2A7E: array},
        ),
        (
            "?PostLoad@AActor@@UAEXXZ",
            0x1052F570,
            0x1052F65D,
            (0x1081A830, 0x1081A7F0),
            postload_imports,
        ),
        (
            "?Serialize@AActor@@UAEXAAVFArchive@@@Z",
            0x10530750,
            0x105307D6,
            (0x1081A8F0, 0x1081A8B0),
            {
                0x1053077E: "?Serialize@UObject@@UAEXAAVFArchive@@@Z",
                0x10530786: "?IsLoading@FArchive@@QAEHXZ",
                0x10530792: "?IsSaving@FArchive@@QAEHXZ",
            },
        ),
    ]:
        assert engine.exported(symbol, True) == comparison_engine.body(symbol) == start
        data = raw(engine, start, end)
        candidate = bytearray(comparison_engine.read(start, end - start))
        normalizations = []
        for at, owned_iat, imported in bindings if start == 0x10328B30 else []:
            offset = at - start
            assert struct.unpack_from("<I", data, offset)[0] == owned_iat
            assert struct.unpack_from("<I", candidate, offset)[0] == owned_iat - 4
            assert comparison_engine.imports[owned_iat - 4] == ("core.dll", imported)
            assert core.exported(imported) == comparison_core.exports[imported]
            struct.pack_into("<I", candidate, offset, owned_iat)
            normalizations.append(
                dict(
                    address=hex(at),
                    ownedIAT=hex(owned_iat),
                    candidateIAT=hex(owned_iat - 4),
                    symbol=imported,
                )
            )
        compared = compare_method(
            data,
            bytes(candidate),
            start,
            start,
            comparison_engine.imported_call,
            lambda va, size: raw(engine, va, va + size),
            comparison_engine.read,
            handler,
        )
        assert {
            int(row["ownedVA"], 16): row["binding"][1]
            for row in compared["differences"]
            if row["kind"] == "named-import"
        } == imports
        for at, imported in imports.items():
            if imported in symbols:
                import_targets[hex(at)] = hex(symbols[imported][0])
        blocks.append(
            dict(
                symbol=symbol,
                start=hex(start),
                end=hex(end),
                comparison=compared,
                operandBindings=normalizations,
            )
        )
    helper = "?Clear@FTextureModifyinfo@@QAEXXZ"
    assert engine.exported(helper) == comparison_engine.exports[helper] == 0x1030B9A1
    assert engine.exported(helper, True) == 0x106773B0
    assert comparison_engine.body(helper) == 0x10677370
    data = raw(engine, 0x106773B0, 0x106773D8)
    assert data == comparison_engine.read(0x10677370, len(data))
    blocks.append(
        dict(
            symbol=helper,
            start="0x106773b0",
            end="0x106773d8",
            comparisonStart="0x10677370",
            SHA256=hashlib.sha256(data).hexdigest(),
        )
    )
    core_blocks = []
    for symbol, (start, end) in symbols.items():
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        data = raw(core, start, end)
        assert data == comparison_core.read(start, len(data))
        core_blocks.append(
            dict(
                symbol=symbol,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    vtables = []
    for table in ("??_7AActor@@6B@", "??_7AStaticMeshActor@@6B@"):
        for slot, method in [
            (0x2C, "?Serialize@AActor@@UAEXAAVFArchive@@@Z"),
            (0x24, "?PostLoad@AActor@@UAEXXZ"),
        ]:
            assert engine.u32(engine.exported(table) + slot) == engine.exported(method)
            assert (
                comparison_engine.u32(comparison_engine.exports[table] + slot)
                == comparison_engine.exports[method]
            )
            vtables.append(dict(table=table, slot=hex(slot), method=method))
    engine.instruction(0x103062C1, "jmp", "0x10328b30")
    engine.instruction(0x1030B9A1, "jmp", "0x106773b0")
    return dict(
        engineBlocks=blocks,
        coreBlocks=core_blocks,
        importTargets=import_targets,
        thunkTargets={"0x103062c1": "0x10328b30", "0x1030b9a1": "0x106773b0"},
        vtables=vtables,
        actorCounters={hex(iat): core.exported(symbol) for _, iat, symbol in bindings},
        limits=[
            "Ordinary constructor storage is supplied; allocation, class defaults, tagged archive application and gameplay are not executed.",
            "PostLoad execution requires object flags 0x100 and class flags 0x20 clear and an empty attached-actor array; current references remain supplied.",
            "Serialize is source correspondence only; no native archive is executed.",
            "SEH stack effects only. Ten-byte handler correspondence does not qualify complete exception/unwind paths.",
        ],
    )


def qualify_actor_transforms(
    engine, core_image, comparison_engine, comparison_core, engine_package
):
    assert (engine.sha, core_image.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        COMPARISON_SHA,
        COMPARISON_CORE_SHA,
    )
    core = []
    for name, a, b in [
        ("?GetCacheIndex@UObject@@QBEKXZ", 0x1010A1C0, 0x1010A1C4),
        ("??1FMatrix@@QAE@XZ", 0x101111E0, 0x101111E1),
        ("?Determinant@FMatrix@@QBEMXZ", 0x10111BB0, 0x10111C76),
        ("??KFVector@@QBE?AV0@M@Z", 0x1010C6D0, 0x1010C6FF),
        ("??DFMatrix@@QBE?AV0@V0@@Z", 0x10111240, 0x10111488),
        ("??0FGlobalMath@@QAE@XZ", 0x1014D330, 0x1014D535),
        ("?SinTab@FGlobalMath@@QAEMH@Z", 0x1010F430, 0x1010F446),
        ("?CosTab@FGlobalMath@@QAEMH@Z", 0x1010F450, 0x1010F46B),
        ("?appSin@@YANN@Z", 0x1012D720, 0x1012D729),
    ]:
        assert core_image.exported(name, True) == a
        data = raw(core_image, a, b)
        candidate = comparison_core.body(name)
        assert data == comparison_core.read(candidate, len(data))
        core.append(
            dict(
                symbol=name,
                ownedRange=[hex(a), hex(b)],
                candidateVA=hex(candidate),
                SHA256=hashlib.sha256(data).hexdigest(),
                bytes=len(data),
            )
        )
    wide_a, wide_b, wide_c = 0x107A6660, 0x107A6694, 0x107A6620
    assert raw(engine, wide_a, wide_b) == comparison_engine.read(
        wide_c, wide_b - wide_a
    )
    wide = dict(
        ownedRange=[hex(wide_a), hex(wide_b)],
        candidateVA=hex(wide_c),
        SHA256=hashlib.sha256(raw(engine, wide_a, wide_b)).hexdigest(),
        meaning="Retained unsigned 64-bit product low64; includes both branches/returns, no CRT symbol assumed",
    )

    blocks = []

    def block(label, a, b, c, sites=None, math_loads=(), relocated_wide=False):
        data = raw(engine, a, b)
        candidate = bytearray(comparison_engine.read(c, b - a))
        rows = list(engine.dis.disasm(data, a))
        cursor = a
        for i in rows:
            assert i.address == cursor
            cursor += i.size
        assert cursor == b
        bindings = []
        for at in math_loads:
            i = next(i for i in rows if i.address == at)
            j = next(
                engine.dis.disasm(
                    bytes(candidate[at - a : at - a + i.size]), c + at - a
                )
            )
            assert i.mnemonic == j.mnemonic == "mov"
            assert i.op_str.endswith("dword ptr [0x11d8d73c]")
            assert j.op_str.endswith("dword ptr [0x11d8d738]")
            assert comparison_engine.imports[0x11D8D738] == (
                "core.dll",
                "?GMath@@3VFGlobalMath@@A",
            )
            assert bytes(i.bytes)[:-4] == bytes(j.bytes)[:-4]
            candidate[at - a + i.size - 4 : at - a + i.size] = struct.pack(
                "<I", 0x11D8D73C
            )
            bindings.append(
                dict(
                    ownedVA=hex(at),
                    ownedIAT="0x11d8d73c",
                    candidateIAT="0x11d8d738",
                    symbol="?GMath@@3VFGlobalMath@@A",
                    status="qualified supplemental data-import correspondence",
                )
            )
        if relocated_wide:
            at = 0x106FEB08
            offset = at - a
            assert data[offset] == candidate[offset] == 0xE8
            assert at + 5 + struct.unpack_from("<i", data, offset + 1)[0] == wide_a
            assert (
                c + offset + 5 + struct.unpack_from("<i", candidate, offset + 1)[0]
                == wide_c
            )
            candidate[offset + 1 : offset + 5] = struct.pack(
                "<i", wide_a - (c + offset + 5)
            )
            bindings.append(
                dict(
                    ownedVA=hex(at),
                    ownedTarget=hex(wide_a),
                    candidateTarget=hex(wide_c),
                    status="complete identical retained helper body",
                )
            )
        result = compare_call_block(
            data,
            bytes(candidate),
            owned_va=a,
            candidate_va=c,
            sites=[
                (at - a, ("core.dll", symbol)) for at, symbol in (sites or {}).items()
            ],
            direct_calls=[
                i.address - a
                for i in rows
                if i.mnemonic == "call" and i.bytes[0] == 0xE8
            ],
            imports=comparison_engine.imports,
        )
        blocks.append(
            dict(
                label=label,
                range=[hex(a), hex(b)],
                candidateVA=hex(c),
                instructions=len(rows),
                ownedSHA256=hashlib.sha256(data).hexdigest(),
                candidateSHA256=hashlib.sha256(
                    comparison_engine.read(c, b - a)
                ).hexdigest(),
                qualifiedBindings=bindings,
                comparison=result,
            )
        )

    block(
        "cache key complete body",
        0x106FEAD0,
        0x106FEB18,
        0x106FEA90,
        {
            0x106FEADA: "?GetCacheIndex@UObject@@QBEKXZ",
            0x106FEAEE: "?GetCacheIndex@UObject@@QBEKXZ",
        },
        relocated_wide=True,
    )
    block("transformed vertex cache whole body", 0x106FEC90, 0x106FED5C, 0x106FEC50)
    block("cache constructor normal body", 0x106FEB51, 0x106FEC0F, 0x106FEB11)
    block(
        "cache owner matrix update normal body",
        0x106FE138,
        0x106FE1CF,
        0x106FE0F8,
        {
            0x106FE16F: "??1FMatrix@@QAE@XZ",
            0x106FE1A8: "??1FMatrix@@QAE@XZ",
            0x106FE1B0: "?Determinant@FMatrix@@QBEMXZ",
        },
    )
    block(
        "nonzero query destructor unlock",
        0x106FE889,
        0x106FE8A9,
        0x106FE849,
        {0x106FE894: "?Unlock@FCacheItem@FMemCache@@QAEXXZ"},
    )
    block(
        "AActor LocalToWorld normal body",
        0x103277C5,
        0x10327AAF,
        0x103277C5,
        math_loads=[0x103277DF],
    )
    world_sites = {0x1032874E: "??KFVector@@QBE?AV0@M@Z"}
    world_sites.update(
        {at: "??DFMatrix@@QBE?AV0@V0@@Z" for at in [0x103288AA, 0x103288D5, 0x10328900]}
    )
    world_sites.update(
        {
            at: "??1FMatrix@@QAE@XZ"
            for at in [
                0x1032891D,
                0x10328932,
                0x10328947,
                0x1032895C,
                0x10328971,
                0x10328983,
                0x10328998,
                0x103289AD,
                0x103289C5,
            ]
        }
    )
    block(
        "AActor WorldToLocal normal body",
        0x103286A5,
        0x103289E7,
        0x103286A5,
        world_sites,
    )
    block(
        "translation matrix constructor normal body", 0x10326FC5, 0x10327023, 0x10326FC5
    )
    block("scale matrix constructor normal body", 0x103274B5, 0x10327513, 0x103274B5)
    rotation_sites = {}
    for at in [0x10327315, 0x10327339, 0x1032734E, 0x10327360, 0x10327375, 0x10327387]:
        dll, symbol = comparison_engine.imported_call(at)
        assert dll == "core.dll"
        rotation_sites[at] = symbol
    assert (
        list(rotation_sites.values())
        == ["??DFMatrix@@QBE?AV0@V0@@Z"] * 2 + ["??1FMatrix@@QAE@XZ"] * 4
    )
    block(
        "inverse-rotation matrix constructor normal body",
        0x10327055,
        0x103273B4,
        0x10327055,
        rotation_sites,
        math_loads=[0x10327062, 0x10327151, 0x10327242],
    )

    methods = {
        "?WorldToLocal@AActor@@UBE?AVFMatrix@@XZ": 0x10328690,
        "?LocalToWorld@AActor@@UBE?AVFMatrix@@XZ": 0x103277B0,
    }
    assert (
        engine.exported("?GetNumCollisionTriangles@UStaticMesh@@QAEHXZ") == 0x1030EEDA
    )
    assert (
        engine.exported("?GetNumCollisionTriangles@UStaticMesh@@QAEHXZ", True)
        == 0x106FE8C0
    )
    for name, body in methods.items():
        assert engine.exported(name, True) == comparison_engine.body(name) == body
    vtable = []
    for name in [
        "??_7AActor@@6B@",
        "??_7AStaticMeshActor@@6B@",
        "??_7AMover@@6B@",
        "??_7APawn@@6B@",
    ]:
        va = engine.exported(name)
        for off, method in [
            (0x148, "?LocalToWorld@AActor@@UBE?AVFMatrix@@XZ"),
            (0x150, "?WorldToLocal@AActor@@UBE?AVFMatrix@@XZ"),
        ]:
            assert engine.u32(va + off) == engine.exported(method)
            vtable.append(
                dict(
                    classVtable=name,
                    address=hex(va),
                    slot=hex(off),
                    method=method,
                    target=hex(methods[method]),
                )
            )
    anchors = []
    for at, op, arg in [
        (0x106FE140, "mov", "eax, dword ptr [eax + 0x150]"),
        (0x106FE14D, "call", "eax"),
        (0x106FE157, "lea", "edi, [ebx + 0x48]"),
        (0x106FE15A, "mov", "ecx, 0x10"),
        (0x106FE179, "mov", "edx, dword ptr [edx + 0x148]"),
        (0x106FE184, "call", "edx"),
        (0x106FE18E, "lea", "ebp, [ebx + 8]"),
        (0x106FE1BA, "fstp", "dword ptr [ebx + 0x88]"),
        (0x106FEB64, "mov", "dword ptr [esi], eax"),
        (0x106FEB69, "mov", "dword ptr [esi + 4], ecx"),
        (0x106FEB6E, "call", "0x1030e390"),
        (0x106FEB73, "lea", "edx, [esi + 0x98]"),
        (0x106FEB9B, "mov", "dword ptr [esi + 0x94], ebx"),
        (0x106FEBC1, "mov", "dword ptr [eax + ecx], ebx"),
        (0x106FEBCA, "mov", "dword ptr [eax + edx + 0x14], ebx"),
        (0x106FEBEB, "mov", "dword ptr [edx + ecx], ebx"),
        (0x106FEFBD, "test", "byte ptr [eax + 0x64], 0x10"),
        (0x106FEFC1, "jne", "0x106fefc8"),
        (0x106FEFC3, "call", "0x1030e390"),
        (0x106FE891, "mov", "ecx, dword ptr [ecx + 0x40]"),
        (0x106FEB00, "shl", "esi, 8"),
        (0x106FEB03, "add", "esi, dword ptr [esp + 0x18]"),
        (0x1010A1C0, "mov", "eax, dword ptr [ecx + 0x28]"),
        (0x106FECA2, "cmp", "dword ptr [eax], 0"),
        (0x106FECA5, "jne", "0x106fed53"),
        (0x106FECAE, "mov", "esi, dword ptr [esi + 0x64]"),
        (0x106FECB1, "shr", "esi, 4"),
        (0x106FECB4, "and", "esi, 1"),
        (0x106FECB7, "mov", "dword ptr [eax], esi"),
        (0x106FECBC, "mov", "esi, dword ptr [esi + 0x78]"),
        (0x103B6221, "mov", "ecx, dword ptr [ebp + 0x60]"),
        (0x103B6224, "mov", "dword ptr [ebx + 0x60], ecx"),
        (0x103B622A, "and", "edx, 1"),
        (0x103B6238, "and", "eax, 2"),
        (0x103B6245, "and", "ecx, 4"),
        (0x103B6252, "and", "eax, 8"),
        (0x103B625F, "and", "ecx, 0x10"),
        (0x103B6264, "mov", "dword ptr [ebx + 0x64], ecx"),
        (0x1052D7D5, "fstp", "dword ptr [esi + 0x27c]"),
        (0x1052DB04, "mov", "dword ptr [esi + 0x280], eax"),
        (0x1052DB0D, "mov", "dword ptr [esi + 0x284], ecx"),
        (0x1052DB16, "mov", "dword ptr [esi + 0x288], edx"),
        (0x103B68BF, "mov", "eax, dword ptr [ebp + 0x1b8]"),
        (0x103B68C5, "mov", "dword ptr [ebx + 0x1b8], eax"),
        (0x103B68CB, "mov", "ecx, dword ptr [ebp + 0x1bc]"),
        (0x103B68D1, "mov", "dword ptr [ebx + 0x1bc], ecx"),
        (0x103B68EF, "mov", "ecx, dword ptr [ebp + 0x1c8]"),
        (0x103B68F5, "mov", "dword ptr [ebx + 0x1c8], ecx"),
        (0x103B6913, "mov", "ecx, dword ptr [ebp + 0x1d4]"),
        (0x103B6A51, "fld", "dword ptr [ebp + 0x27c]"),
        (0x103B6A57, "fstp", "dword ptr [ebx + 0x27c]"),
        (0x103B6A5D, "mov", "ecx, dword ptr [ebp + 0x280]"),
        (0x103B6A81, "mov", "ecx, dword ptr [ebp + 0x28c]"),
        (0x103B6A9F, "lea", "edx, [ebp + 0x298]"),
        (0x1014D4AE, "lea", "ebx, [esi + 0x8c]"),
        (0x1014D4BB, "fadd", "st(0), st(0)"),
        (0x1014D4BD, "fmul", "qword ptr [0x101d4558]"),
        (0x1014D4C3, "fmul", "qword ptr [0x101d5e38]"),
        (0x1014D4C9, "fstp", "qword ptr [esp]"),
        (0x1014D4CC, "call", "0x101048fe"),
        (0x1014D4D4, "fstp", "dword ptr [ebx]"),
        (0x1014D4DC, "cmp", "edi, 0x4000"),
    ]:
        image = core_image if at < 0x10300000 else engine
        image.instruction(at, op, arg)
        anchors.append([hex(at), op, arg])

    # Bind the update bit from original reflected order plus retained typed copy.
    sys.path[:0] = [
        str(ROOT / "tools"),
        str(ROOT / "tools/dat"),
        str(ROOT / "tools/l2lib"),
        str(ROOT / "tools/world"),
    ]
    from l2lib import Reader, load_package
    from export_static_collision import qualified_ref

    package_hash = hashlib.sha256(Path(engine_package).read_bytes()).hexdigest()
    assert package_hash == PACKAGE_SHA, "unsupported Engine.u build"
    pkg, _ = load_package(engine_package)
    (owner,) = [
        e
        for e in pkg.exports
        if pkg.class_name_of(e) == "Class" and pkg.export_name(e) == "Actor"
    ]
    properties = {}
    for e in pkg.exports:
        if e.package_index != owner.index + 1 or not pkg.class_name_of(e).endswith(
            "Property"
        ):
            continue
        data = bytes(pkg.data[e.serial_offset : e.serial_offset + e.serial_size])
        r = Reader(data)
        assert pkg.name(r.compact()) == "None" and r.compact() == 0
        properties[e.index + 1] = dict(
            name=pkg.export_name(e),
            kind=pkg.class_name_of(e),
            next=r.compact(),
            dimension=r.u32(),
            flags=r.u32(),
            SHA256=hashlib.sha256(data).hexdigest(),
        )
        category = pkg.name(r.compact())
        if properties[e.index + 1]["kind"] == "StructProperty":
            properties[e.index + 1]["struct"] = qualified_ref(pkg, r.compact())
    (ref,) = [k for k, v in properties.items() if v["name"] == "CreatureID"]
    chain = []
    for name in [
        "CreatureID",
        "NoCheatCollision",
        "CanIngnoreCollision",
        "bDeleteNow",
        "bAlwaysVisible",
        "bStatic",
        "bHidden",
    ]:
        row = properties[ref]
        assert row["name"] == name and row["dimension"] == 1
        assert row["kind"] == (
            "IntProperty" if name == "CreatureID" else "BoolProperty"
        )
        chain.append(dict(exportRef=ref, **row))
        ref = row["next"]
    assert engine.exported("??0AActor@@QAE@ABV0@@Z", True) == 0x103B60F0
    input_chains = []
    for names, kinds in [
        (
            ["PhysicsVolume", "Location", "Rotation", "Velocity"],
            ["ObjectProperty", "StructProperty", "StructProperty", "StructProperty"],
        ),
        (
            ["DrawScale", "DrawScale3D", "PrePivot", "Skins"],
            ["FloatProperty", "StructProperty", "StructProperty", "ArrayProperty"],
        ),
    ]:
        (ref,) = [k for k, row in properties.items() if row["name"] == names[0]]
        selected = []
        for name, kind in zip(names, kinds):
            row = properties[ref]
            assert (row["name"], row["kind"], row["dimension"]) == (name, kind, 1)
            if kind == "StructProperty":
                assert row["struct"] == (
                    "Core.Object.Rotator"
                    if name == "Rotation"
                    else "Core.Object.Vector"
                )
            selected.append(dict(exportRef=ref, **row))
            ref = row["next"]
        input_chains.append(selected)
    for name, at in [
        ("?SetDrawScale@AActor@@QAEXM@Z", 0x1052D780),
        ("?SetDrawScale3D@AActor@@QAEXVFVector@@@Z", 0x1052DAB0),
    ]:
        assert engine.exported(name, True) == at
    assert (
        core_image.exported(
            "?Link@UBoolProperty@@UAEXAAVFArchive@@PAVUProperty@@@Z", True
        )
        == 0x10173250
    )
    for at, op, args in [
        (0x101732A6, "mov", "eax, dword ptr [ebx + 0x54]"),
        (0x101732AC, "mov", "ecx, dword ptr [edi + 0x78]"),
        (0x101732AF, "add", "ecx, ecx"),
        (0x101732C9, "mov", "dword ptr [esi + 0x78], 1"),
    ]:
        core_image.instruction(at, op, args)
        anchors.append([hex(at), op, args])
    assert core_image.exported("?appSin@@YANN@Z") == 0x101048FE
    trig = []
    for at, expected in [(0x101D4558, 3.141592653589793), (0x101D5E38, 1 / 16384)]:
        b = raw(core_image, at, at + 8)
        assert b == comparison_core.read(at, 8)
        value = struct.unpack("<d", b)[0]
        assert value == expected
        trig.append(dict(address=hex(at), storage="Float64", value=value, hex=b.hex()))

    out = dict(
        status="PASS",
        ownedEngineSHA256=ENGINE_SHA,
        ownedCoreSHA256=CORE_SHA,
        supplementalEngineSHA256=COMPARISON_SHA,
        supplementalCoreSHA256=COMPARISON_CORE_SHA,
        blocks=blocks,
        anchors=anchors,
        vtable=vtable,
        core=core,
        wideMultiply=wide,
        bStatic=dict(
            offset="0x64",
            mask="0x10",
            chain=chain,
            actorTypedCopyRange=["0x103b6221", "0x103b6267"],
            actorTypedCopySHA256=hashlib.sha256(
                raw(engine, 0x103B6221, 0x103B6267)
            ).hexdigest(),
            packageSHA256=package_hash,
        ),
        actorMatrixInputs=dict(
            chains=input_chains,
            typedCopy=[
                dict(
                    range=[hex(a), hex(b)],
                    SHA256=hashlib.sha256(raw(engine, a, b)).hexdigest(),
                )
                for a, b in [(0x103B68BF, 0x103B691F), (0x103B6A51, 0x103B6AB2)]
            ],
            fields={
                "Location": "0x1bc",
                "Rotation": "0x1c8",
                "DrawScale": "0x27c",
                "DrawScale3D": "0x280",
                "PrePivot": "0x28c",
            },
        ),
        trigTable=dict(
            count=16384,
            offset="0x8c",
            argument="Float64((index+index)*PI/16384)",
            returnStore="Float32(appSin(argument))",
            constants=trig,
        ),
        fieldContract={
            "cache+0": "owner",
            "cache+4": "mesh",
            "cache+8": "owner.LocalToWorld",
            "cache+48": "owner.WorldToLocal",
            "cache+88": "Float32 determinant(LocalToWorld)",
            "cache+8c": "triangle cache start",
            "cache+90": "vertex cache start",
            "cache+94": "query counter",
        },
        limits=[
            "Source ordering/correspondence only; arithmetic comparison is reported separately",
            "GMath constructor/table indexing pinned here; source sine profile is qualified separately",
            "Cache eviction, actor mutation and static-cache stale-state policy are not a browser lifecycle contract",
            "Actor inputs are current native field values; original serialized map defaults alone do not prove current actor state",
            "Triangle kernels/material callbacks/serialized collision data still separate",
            "Supplemental correspondence is conditional identity evidence, not owned import restoration or distributor authenticity",
        ],
    )

    # Establish the ordinary SEH stack effect used by the finite interpreter.
    # Exception dispatch/unwind is deliberately outside the admitted path.
    prologues = []
    for a, handler in [
        (0x103277B0, 0x107F03FA),
        (0x10328690, 0x107F0552),
        (0x10326FB0, 0x107F0359),
        (0x103274A0, 0x107F03C9),
        (0x10327040, 0x107F03A6),
    ]:
        data = raw(engine, a, a + 21)
        other = comparison_engine.read(a, 21)
        # The exception-handler operand moved in the supplemental image.
        # Compare the ordinary stack/link instructions only; neither handler
        # is executed or claimed equivalent by this normal-path interpreter.
        assert data[:3] == other[:3] and data[7:] == other[7:]
        assert struct.unpack_from("<I", other, 3)[0] == handler - 0x40
        for at, op, arg in [
            (a, "push", "-1"),
            (a + 2, "push", hex(handler)),
            (a + 7, "mov", "eax, dword ptr fs:[0]"),
            (a + 13, "push", "eax"),
            (a + 14, "mov", "dword ptr fs:[0], esp"),
        ]:
            engine.instruction(at, op, arg)
        prologues.append(
            dict(
                start=hex(a),
                normalBody=hex(a + 21),
                SHA256=hashlib.sha256(data).hexdigest(),
                pushedOwnedHandler=hex(handler),
                pushedSupplementalHandler=hex(handler - 0x40),
                exceptionHandlersCompared=False,
            )
        )
    thunks = []
    for a, target in [
        (0x1030916F, 0x10326FB0),
        (0x1030D526, 0x103274A0),
        (0x1030FF97, 0x10327040),
    ]:
        engine.instruction(a, "jmp", hex(target))
        assert raw(engine, a, a + 5) == comparison_engine.read(a, 5)
        thunks.append(dict(address=hex(a), target=hex(target)))
    out.update(normalPrologues=prologues, constructorThunks=thunks)
    return out
