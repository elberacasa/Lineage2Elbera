"""Elbera Tools: consumed loading bits of original static resource/actor classes.

This is a bounded native-registration/package reader, not a general class
registry. Original files stay private. Supplemental binding is a separate,
explicit verification step; export requires only the pinned owned edition.
"""

import hashlib
import struct

from static_collision_source import ENGINE_SHA, CORE_SHA
from check_supplemental_engine import (
    CANDIDATE_ENGINE_SHA,
    CANDIDATE_CORE_SHA,
    compare_method,
)

ENGINE_PACKAGE_SHA = "9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761"
CORE_PACKAGE_SHA = "de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0"
CLASS_CTOR = "??0UClass@@QAE@W4ENativeConstructor@@KKPAV0@1VFGuid@@PBG33KP6AXPAX@ZP8UObject@@AEXXZ@Z"
OBJECT_CLASS = "?PrivateStaticClass@UObject@@0VUClass@@A"
PRIMITIVE_CLASS = "?PrivateStaticClass@UPrimitive@@0VUClass@@A"
MESH_CLASS = "?PrivateStaticClass@UStaticMesh@@0VUClass@@A"
ACTOR_CLASS = "?PrivateStaticClass@AActor@@0VUClass@@A"
STATIC_ACTOR_CLASS = "?PrivateStaticClass@AStaticMeshActor@@0VUClass@@A"


def read_root_class_flags(package):
    """Read the source-bound, zero-script file-123 root-class prefix only."""
    return read_zero_script_class_flags(package, "Object", None)


def qualify_actor_dispatch(engine, comparison_engine):
    """Bind consumed virtual slots without substituting one class's lifecycle.

    Pointer/symbol correspondence only. Subclass method bodies and their
    constructor/PostLoad effects are not executed or supplied by this receipt.
    """
    assert (engine.sha, comparison_engine.sha) == (ENGINE_SHA, CANDIDATE_ENGINE_SHA)
    records = []
    for cls in (
        "AActor",
        "AStaticMeshActor",
        "AMover",
        "ABrush",
        "AVolume",
        "ABlockingVolume",
        "APhysicsVolume",
        "AMusicVolume",
    ):
        brush = cls in (
            "ABrush",
            "AVolume",
            "ABlockingVolume",
            "APhysicsVolume",
            "AMusicVolume",
        )
        postload = "AMover" if cls == "AMover" else "ABrush" if brush else "AActor"
        table = "??_7" + cls + "@@6B@"
        owned, other = engine.exported(table), comparison_engine.exports[table]
        slots = []
        for offset, symbol in [
            (0x24, "?PostLoad@" + postload + "@@UAEXXZ"),
            (0x2C, "?Serialize@AActor@@UAEXAAVFArchive@@@Z"),
            (0x148, "?LocalToWorld@AActor@@UBE?AVFMatrix@@XZ"),
            (
                0x164,
                "?GetPrimitive@"
                + ("ABrush" if brush else "AActor")
                + "@@UAEPAVUPrimitive@@XZ",
            ),
        ]:
            assert engine.u32(owned + offset) == engine.exported(symbol)
            assert (
                comparison_engine.u32(other + offset)
                == comparison_engine.exports[symbol]
            )
            slots.append(
                dict(
                    offset=hex(offset),
                    symbol=symbol,
                    ownedTarget=hex(engine.exported(symbol)),
                    comparisonTarget=hex(comparison_engine.exports[symbol]),
                )
            )
        records.append(
            dict(
                sourceClass=cls,
                table=table,
                ownedTable=hex(owned),
                comparisonTable=hex(other),
                slots=slots,
            )
        )
    return dict(
        scope="original-native-actor-virtual-slot-bindings",
        records=records,
        limits=[
            "Method identity only; subclass constructors, method bodies and live state are not executed by this check."
        ],
    )


def qualify_class_default_prefix(core, comparison_core):
    """Bind the supported class-prefix reader to original Core serialization.

    Code correspondence and field/dispatch bindings; native linking, archive
    factories and class-default construction are not executed by this check.
    """
    from l2lib.classdata import (
        NO_OPERAND_TOKENS,
        REFERENCE_TOKENS,
        REFERENCE_EXPRESSION_TOKENS,
        WORD_EXPRESSION_TOKENS,
        BYTE_TOKENS,
    )

    assert (core.sha, comparison_core.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    blocks = []
    for label, start, end in [
        ("UObject.Serialize", 0x1015E820, 0x1015EA8F),
        ("UField.Serialize", 0x10131210, 0x10131287),
        ("UStruct.Serialize", 0x10131450, 0x1013158B),
        ("UState.Serialize", 0x101316E0, 0x1013176D),
        ("UClass.Serialize", 0x101351C0, 0x10135425),
        ("UStruct.SerializeExpr normal path", 0x10131B90, 0x10132108),
        ("four-word field serializer", 0x10130DC0, 0x10130E30),
        ("dependency array serializer", 0x101342F0, 0x101343A6),
        ("FDependency serializer", 0x10131B40, 0x10131B77),
        ("name array serializer", 0x10132470, 0x10132526),
        ("object archive wrapper", 0x1012A9F0, 0x1012AA01),
        ("script reference archive wrapper", 0x10130F10, 0x10130F21),
    ]:
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        rows = list(core.dis.disasm(raw, start))
        assert sum(i.size for i in rows) == len(raw)
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    symbols = {
        "?SerializeExpr@UStruct@@UAE?AW4EExprToken@@AAHAAVFArchive@@@Z": 0x10131B90,
        "??6@YAAAVFArchive@@AAV0@AAVFDependency@@@Z": 0x10131B40,
    }
    for symbol, address in symbols.items():
        assert core.exported(symbol, True) == comparison_core.body(symbol) == address
    for thunk, target in [
        (0x101045FC, 0x10130DC0),
        (0x101015C3, 0x101342F0),
        (0x10103D91, 0x10131B40),
        (0x101033B4, 0x10132470),
        (0x10102EB4, 0x1012A9F0),
        (0x10103B8E, 0x10130F10),
        (0x10102248, 0x10131B90),
    ]:
        core.instruction(thunk, "jmp", hex(target))
        assert bytes(
            core.data[core.offset(thunk) : core.offset(thunk) + 5]
        ) == comparison_core.read(thunk, 5)
    table_start, table_end = 0x10132148, 0x10132212
    table = bytes(core.data[core.offset(table_start) : core.offset(table_end)])
    assert table == comparison_core.read(table_start, len(table))
    groups = {}
    for token in range(0x46):
        index = core.data[core.offset(0x101321CC + token)]
        assert index < 33
        groups.setdefault(core.u32(table_start + index * 4), set()).add(token)
    supported = {}
    for target, tokens in [
        (0x101320F2, NO_OPERAND_TOKENS),
        (0x10131CA4, REFERENCE_TOKENS),
        (0x10131F84, REFERENCE_EXPRESSION_TOKENS),
        (0x10131FF8, WORD_EXPRESSION_TOKENS),
        (0x10131F72, BYTE_TOKENS),
        (0x10131C63, {0x39}),
    ]:
        assert groups[target] == set(tokens)
        supported[hex(target)] = sorted(tokens)
    anchors = [
        (0x1013152D, "jge", "0x10131545"),
        (0x10131545, "je", "0x1013155c"),
        (0x10131BD6, "add", "dword ptr [esi], 1"),
        (0x10131BEA, "cmp", "edx, 0x70"),
        (0x10131BFE, "cmp", "eax, 0x16"),
        (0x10131C4C, "cmp", "edx, 0x45"),
        (0x10131C55, "movzx", "edx, byte ptr [edx + 0x101321cc]"),
        (0x10131C5C, "jmp", "dword ptr [edx*4 + 0x10132148]"),
        (0x10131C6D, "add", "dword ptr [esi], 1"),
        (0x10131CAE, "add", "dword ptr [esi], 4"),
        (0x10131F7C, "add", "dword ptr [esi], 1"),
        (0x10131F8E, "add", "dword ptr [esi], 4"),
        (0x10132002, "add", "dword ptr [esi], 2"),
        (0x1013521A, "lea", "edx, [esi + 0x4a4]"),
        (0x10135213, "lea", "ecx, [esi + 0x4ac]"),
        (0x10135233, "lea", "eax, [esi + 0x4e8]"),
        (0x1013523A, "lea", "ecx, [esi + 0x4dc]"),
        (0x10135259, "lea", "edx, [esi + 0x4bc]"),
        (0x1013526B, "lea", "ecx, [esi + 0x4c0]"),
        (0x10135298, "lea", "ecx, [esi + 0x500]"),
        (0x10134331, "call", "0x10102315"),
        (0x10134358, "call", "0x10103d91"),
        (0x10131B59, "push", "4"),
        (0x10131B5B, "lea", "ecx, [edi + 4]"),
        (0x10131B68, "push", "4"),
        (0x10131B6A, "add", "edi, 8"),
        (0x101324B1, "call", "0x10102315"),
        (0x101324DE, "mov", "eax, dword ptr [edx + 0x1c]"),
    ]
    for row in anchors:
        core.instruction(*row)
    return dict(
        coreSHA256=core.sha,
        comparisonCoreSHA256=comparison_core.sha,
        blocks=blocks,
        symbols=symbols,
        anchors=anchors,
        dispatch=dict(
            start=hex(table_start),
            end=hex(table_end),
            SHA256=hashlib.sha256(table).hexdigest(),
            supportedCases=supported,
        ),
        limits=[
            "Original file-version123 loading structure; class linking, binding, archive factories and default construction are not executed.",
            "Only listed expression shapes and native-call argument serialization are decoded. Unknown tokens remain unsupported; no script execution or condition meaning is inferred.",
            "A serialized default boundary is not a current actor or collision-state claim.",
        ],
    )


def read_zero_script_class_flags(package, name, superclass):
    """Read a named zero-script class prefix, checking both superclass records.

    The flags are serialized evidence only. A nonzero script length requires
    bytecode decoding and is never skipped as an assumed raw byte count.
    """
    from l2lib import Reader, qualified_ref

    if package.file_version != 123:
        raise ValueError("unsupported class-prefix file version")
    matches = [
        e
        for e in package.exports
        if package.class_name_of(e) == "Class" and package.export_name(e) == name
    ]
    if len(matches) != 1:
        raise ValueError("expected one named class")
    export = matches[0]
    if superclass is None:
        parent_matches = export.super_index == 0
    else:
        parent_matches = (
            export.super_index != 0
            and qualified_ref(package, export.super_index) == superclass
        )
    if not parent_matches or export.object_flags & 0x02000000:
        raise ValueError("unsupported class-prefix superclass or script stack")
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if not 0 <= start < end <= len(package.data):
        raise ValueError("invalid class-prefix export boundary")
    reader = Reader(memoryview(package.data)[:end], start, package.path)
    refs = [reader.compact() for _ in range(6)]
    if refs[0] != export.super_index or package.name(refs[4]) != name:
        raise ValueError("unexpected class-prefix identity")
    reader.bytes(8)  # Original line and text-position fields.
    if reader.i32() != 0:
        raise ValueError("class script bytecode is outside this reader")
    reader.bytes(8 + 8 + 2 + 4)  # Probe/ignore masks, label offset, state flags.
    offset = reader.pos
    flags = reader.u32()
    return dict(
        flags=flags,
        sourceOffset=offset,
        prefixBytes=reader.pos - start,
        prefixSHA256=hashlib.sha256(package.data[start : reader.pos]).hexdigest(),
    )


def static_actor_loading_bits(engine, core, engine_package, core_package):
    """Derive only allocation/localization bits across the original class chain.

    Registration may precede serialized flag replacement. Include both sources
    and inherited alternatives; they must agree on every consumed bit. This
    does not infer a complete current class word or script execution state.
    """
    mesh = loading_bits(engine, core, engine_package, core_package)
    saved_actor = read_zero_script_class_flags(engine_package, "Actor", "Core.Object")
    saved_static = read_zero_script_class_flags(
        engine_package, "StaticMeshActor", "Engine.Actor"
    )
    assert engine.exported(ACTOR_CLASS) == 0x10C1C4C8
    assert engine.exported(STATIC_ACTOR_CLASS) == 0x10DDC900
    for at, op, args in [
        (0x1083B612, "push", "0x800"),
        (0x1083B617, "push", "0x3bc"),
        (0x1083B61E, "mov", "ecx, 0x10c1c4c8"),
        (0x1084982B, "push", "0x10c1c4c8"),
        (0x10849830, "push", "0"),
        (0x10849832, "push", "0x3f8"),
        (0x10849839, "mov", "ecx, 0x10ddc900"),
    ]:
        engine.instruction(at, op, args)
    added = core.data[core.offset(0x101358C5) + 2]
    native_actor = engine.u32(0x1083B612 + 1) | added
    native_static = engine.data[engine.offset(0x10849830) + 1] | added
    inherited = mesh["evidence"]["inheritanceMask"]
    roots = {mesh["evidence"]["nativeRootFlags"], mesh["evidence"]["root"]["flags"]}
    actors = {native_actor, saved_actor["flags"]}
    actors |= {flags | (root & inherited) for flags in list(actors) for root in roots}
    variants = {native_static, saved_static["flags"]}
    variants |= {
        flags | (parent & inherited) for flags in list(variants) for parent in actors
    }
    mask = 0x428  # Existing allocation tests plus AActor.PostLoad's class test.
    values = {flags & mask for flags in variants}
    if len(values) != 1:
        raise ValueError("class loading alternatives disagree on consumed actor bits")
    return dict(
        sourceClass="Engine.StaticMeshActor",
        scope="ordinary-native-registration-and-package",
        mask=mask,
        value=values.pop(),
        sources=mesh["sources"],
        evidence=dict(
            root=mesh["evidence"]["root"],
            actor=saved_actor,
            staticActor=saved_static,
            nativeRootFlags=mesh["evidence"]["nativeRootFlags"],
            nativeActorFlags=native_actor,
            nativeStaticActorFlags=native_static,
            inheritanceMask=inherited,
            actorVariants=sorted(actors),
            staticActorVariants=sorted(variants),
        ),
    )


def loading_bits(engine, core, engine_package, core_package):
    """Derive only the two class bits consumed by fresh resource loading.

    Other class bits are deliberately not supplied as current runtime state.
    Native registration with the original descriptors/packages is the scope;
    custom class metadata, reuse and external class mutation are excluded.
    """
    assert (engine.sha, core.sha) == (ENGINE_SHA, CORE_SHA)
    for package, digest in [
        (engine_package, ENGINE_PACKAGE_SHA),
        (core_package, CORE_PACKAGE_SHA),
    ]:
        assert hashlib.sha256(package.path.read_bytes()).hexdigest() == digest
    assert not [
        e
        for e in engine_package.exports
        if engine_package.class_name_of(e) == "Class"
        and engine_package.export_name(e).casefold() in {"primitive", "staticmesh"}
    ]
    saved_root = read_root_class_flags(core_package)
    for image, address, mnemonic, operand in [
        (core, 0x101C8093, "push", "0x400001"),
        (core, 0x101C809F, "push", "0x34"),
        (core, 0x101C80A7, "mov", "ecx, 0x103308f8"),
        (engine, 0x10846BD2, "push", "0"),
        (engine, 0x10846BD4, "push", "0x60"),
        (engine, 0x108496CA, "push", "0x10db0448"),
        (engine, 0x108496CF, "push", "0x2040"),
        (engine, 0x108496D4, "push", "0x1fc"),
        (core, 0x101358C5, "or", "eax, 0x12"),
        (core, 0x101358C8, "mov", "dword ptr [esi + 0x4a4], eax"),
        (core, 0x10133A88, "and", "eax, 0xf86ec"),
        (core, 0x10133A8D, "or", "dword ptr [esi + 0x4a4], eax"),
    ]:
        image.instruction(address, mnemonic, operand)
    assert core.exported(OBJECT_CLASS) == 0x103308F8
    assert engine.exported(PRIMITIVE_CLASS) == 0x10DB0448
    assert engine.exported(MESH_CLASS) == 0x10DDBEA0
    added = core.data[core.offset(0x101358C5) + 2]
    inherited_mask = core.u32(0x10133A88 + 1)
    root_initial = core.u32(0x101C8093 + 1) | added
    primitive_initial = engine.data[engine.offset(0x10846BD2) + 1] | added
    mesh_initial = engine.u32(0x108496CF + 1) | added
    variants = []
    for root in (root_initial, saved_root["flags"]):
        primitive = primitive_initial | (root & inherited_mask)
        variants.append(mesh_initial | (primitive & inherited_mask))
    consumed_mask = 0x408  # Original allocation tests, not a complete class word.
    assert len({flags & consumed_mask for flags in variants}) == 1
    return dict(
        sourceClass="Engine.StaticMesh",
        scope="ordinary-native-registration",
        mask=consumed_mask,
        value=variants[0] & consumed_mask,
        sources=dict(
            engine=engine.sha,
            core=core.sha,
            enginePackage=ENGINE_PACKAGE_SHA,
            corePackage=CORE_PACKAGE_SHA,
        ),
        evidence=dict(
            root=saved_root,
            nativeRootFlags=root_initial,
            nativePrimitiveFlags=primitive_initial,
            nativeMeshFlags=mesh_initial,
            inheritanceMask=inherited_mask,
            registeredMeshVariants=variants,
        ),
    )


def qualify_registration(engine, core, comparison_engine, comparison_core):
    """Bind native declarations and normal lifecycle bodies to named sources."""
    assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
        ENGINE_SHA,
        CORE_SHA,
        CANDIDATE_ENGINE_SHA,
        CANDIDATE_CORE_SHA,
    )
    read = lambda va, n: bytes(engine.data[engine.offset(va) : engine.offset(va) + n])
    blocks = []
    for label, start, end, bindings, imports in [
        (
            "Actor",
            0x1083B5B0,
            0x1083B629,
            [
                (
                    0x1083B5C9,
                    0x11D8D790,
                    0x11D8D78C,
                    "import",
                    "?StaticConstructor@UObject@@QAEXXZ",
                ),
                (0x1083B5E5, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (0x1083B61F, 0x10C1C4C8, 0x10C1C4D8, "export", ACTOR_CLASS),
            ],
            [
                (0x1083B5C0, "??0FGuid@@QAE@KKKK@Z"),
                (0x1083B5D8, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x1083B604, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1083B60B, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1083B623, CLASS_CTOR),
            ],
        ),
        (
            "StaticMeshActor",
            0x108497D0,
            0x10849844,
            [
                (
                    0x108497E9,
                    0x11D8D790,
                    0x11D8D78C,
                    "import",
                    "?StaticConstructor@UObject@@QAEXXZ",
                ),
                (0x10849805, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (0x1084982C, 0x10C1C4C8, 0x10C1C4D8, "export", ACTOR_CLASS),
                (0x1084983A, 0x10DDC900, 0x10DDC910, "export", STATIC_ACTOR_CLASS),
            ],
            [
                (0x108497E0, "??0FGuid@@QAE@KKKK@Z"),
                (0x108497F8, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x10849824, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1084983E, CLASS_CTOR),
            ],
        ),
        (
            "Primitive",
            0x10846B70,
            0x10846BE3,
            [
                (
                    0x10846B89,
                    0x11D8D790,
                    0x11D8D78C,
                    "import",
                    "?StaticConstructor@UObject@@QAEXXZ",
                ),
                (0x10846BA5, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (0x10846BD9, 0x10DB0448, 0x10DB0458, "export", PRIMITIVE_CLASS),
            ],
            [
                (0x10846B80, "??0FGuid@@QAE@KKKK@Z"),
                (0x10846B98, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x10846BC4, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x10846BCB, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x10846BDD, CLASS_CTOR),
            ],
        ),
        (
            "StaticMesh",
            0x10849670,
            0x108496E6,
            [
                (0x108496A4, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (0x108496CB, 0x10DB0448, 0x10DB0458, "export", PRIMITIVE_CLASS),
                (0x108496DC, 0x10DDBEA0, 0x10DDBEB0, "export", MESH_CLASS),
            ],
            [
                (0x10849680, "??0FGuid@@QAE@KKKK@Z"),
                (0x10849697, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x108496C3, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x108496E0, CLASS_CTOR),
            ],
        ),
    ]:
        raw = bytearray(read(start, end - start))
        other = comparison_engine.read(start - 64, end - start)
        for at, old, new, kind, symbol in bindings:
            offset = at - start
            assert struct.unpack_from("<I", raw, offset)[0] == old
            assert struct.unpack_from("<I", other, offset)[0] == new
            if kind == "import":
                assert comparison_engine.imports[new] == ("core.dll", symbol)
            else:
                assert (
                    engine.exported(symbol) == old
                    and comparison_engine.exports[symbol] == new
                )
            struct.pack_into("<I", raw, offset, new)
        compared = compare_method(
            bytes(raw),
            other,
            start,
            start - 64,
            comparison_engine.imported_call,
            read,
            comparison_engine.read,
        )
        assert [
            (int(d["ownedVA"], 16), d["binding"][1]) for d in compared["differences"]
        ] == imports
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(read(start, end - start)).hexdigest(),
                operandBindings=bindings,
                comparison=compared,
            )
        )
    core_blocks = []
    for label, start, end in [
        ("native root registration prefix", 0x101C8060, 0x101C80B4),
        ("native UClass constructor", 0x10135860, 0x101359ED),
        ("UClass.Register", 0x101339D0, 0x10133AF6),
        ("UClass.Link", 0x10136550, 0x10136703),
        ("UState.Link", 0x10136400, 0x101364D6),
        ("UStruct.Link normal paths", 0x10135E30, 0x10136218),
        ("UClass.Bind", 0x101317D0, 0x1013196E),
        ("UClass.PostLoad", 0x10131A50, 0x10131AC8),
        ("UStruct.PostLoad", 0x101308F0, 0x10130935),
        ("UObject.Serialize", 0x1015E820, 0x1015EA8F),
        ("UField.Serialize", 0x10131210, 0x10131287),
        ("UStruct.Serialize", 0x10131450, 0x1013158B),
        ("UState.Serialize", 0x101316E0, 0x1013176D),
        ("UClass.Serialize", 0x101351C0, 0x10135425),
    ]:
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        rows = list(core.dis.disasm(raw, start))
        assert sum(i.size for i in rows) == len(raw)
        assert rows[-1].address + rows[-1].size == end
        core_blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    assert (
        core.exported(CLASS_CTOR, True)
        == comparison_core.body(CLASS_CTOR)
        == 0x10135860
    )
    core.instruction(0x101C80AF, "call", "0x1010268a")
    core.instruction(0x1010268A, "jmp", "0x10135860")
    # UClass objects bypass tagged UObject properties. The six compact fields
    # precede two ints, zero script size and the UState scalar fields.
    anchors = [
        (0x1015EA2F, "cmp", "ecx, 0x1027d770"),
        (0x1015EA35, "je", "0x1015ea5e"),
        (0x10131246, "lea", "eax, [esi + 0x38]"),
        (0x1013124A, "lea", "ecx, [esi + 0x34]"),
        (0x10131486, "lea", "eax, [esi + 0x48]"),
        (0x1013148A, "lea", "ecx, [esi + 0x40]"),
        (0x101314A0, "lea", "ebx, [esi + 0x50]"),
        (0x101314C9, "cmp", "dword ptr [edi + 4], 0x78"),
        (0x101314CF, "lea", "ecx, [esi + 0x44]"),
        (0x101314DC, "lea", "edx, [esi + 0x60]"),
        (0x101314E0, "lea", "eax, [esi + 0x64]"),
        (0x101314F9, "lea", "ecx, [ebp + 8]"),
        (0x1013152D, "jge", "0x10131545"),
        (0x10131713, "lea", "eax, [esi + 0x94]"),
        (0x1013171A, "lea", "ecx, [esi + 0x8c]"),
        (0x10131733, "lea", "edx, [esi + 0x9c]"),
        (0x1013173A, "add", "esi, 0xa0"),
        (0x1013521A, "lea", "edx, [esi + 0x4a4]"),
        (0x10135222, "call", "0x10102e05"),
        # State's table ends BEFORE the class flags at +0x4a4.
        (0x10136440, "push", "0x400"),
        (0x1013644B, "lea", "edx, [esi + 0xa4]"),
        (0x10136495, "and", "ecx, 0xff"),
    ]
    for row in anchors:
        core.instruction(*row)
    for thunk, start, end in [
        (0x1010405C, 0x10130860, 0x10130879),
        (0x10102DE2, 0x10130800, 0x10130819),
        (0x10102E05, 0x10108C50, 0x10108C69),
        (0x10102DFB, 0x10130820, 0x10130839),
        (0x10103210, 0x10130ED0, 0x10130EE1),
        (0x10101965, 0x10130E90, 0x10130EA1),
    ]:
        core.instruction(thunk, "jmp", hex(start))
        for lo, hi in [(thunk, thunk + 5), (start, end)]:
            raw = bytes(core.data[core.offset(lo) : core.offset(hi)])
            assert raw == comparison_core.read(lo, hi - lo)
            core_blocks.append(
                dict(
                    label="root prefix scalar helper",
                    start=hex(lo),
                    end=hex(hi),
                    SHA256=hashlib.sha256(raw).hexdigest(),
                )
            )
    return dict(
        engineBlocks=blocks,
        coreBlocks=core_blocks,
        rootPrefixAnchors=anchors,
        classDefaultPrefix=qualify_class_default_prefix(core, comparison_core),
        actorDispatch=qualify_actor_dispatch(engine, comparison_engine),
        limits=[
            "Native registration and pinned original packages; external class mutation and custom descriptors are excluded.",
            "Source correspondence, not execution of the full class registry. Class defaults/configuration target separate object storage.",
            "Only consumed resource/actor loading bits are derived; no complete current class word or script execution state is inferred.",
            "Supplemental correspondence does not authenticate an archive or restore the protected runtime.",
        ],
    )


def read_owned_loading_bits(*, actor=False):
    """Read this edition's owned inputs; no supplemental lookup or downloads."""
    from pathlib import Path
    from check_tutorial_quest_native import Image
    from l2lib import load_package

    root = Path(__file__).resolve().parents[2] / "assets/interlude/system"
    derive = static_actor_loading_bits if actor else loading_bits
    return derive(
        Image(root / "engine.dll", ENGINE_SHA, True),
        Image(root / "Core.dll", CORE_SHA),
        load_package(root / "Engine.u")[0],
        load_package(root / "Core.u")[0],
    )
