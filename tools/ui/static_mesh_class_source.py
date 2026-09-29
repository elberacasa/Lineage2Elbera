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
MODEL_CLASS = "?PrivateStaticClass@UModel@@0VUClass@@A"
POLYS_CLASS = "?PrivateStaticClass@UPolys@@0VUClass@@A"
ACTOR_CLASS = "?PrivateStaticClass@AActor@@0VUClass@@A"
STATIC_ACTOR_CLASS = "?PrivateStaticClass@AStaticMeshActor@@0VUClass@@A"
BRUSH_CLASS = "?PrivateStaticClass@ABrush@@0VUClass@@A"
# Ordinary registration prefixes, native sizes and parent descriptors.
VOLUME_REGISTRATIONS = (
    ("Volume", "Brush", 0x1083DB80, 0x1083DBF4, 0x10C2E258, 0x10C2D2C8, 0x434, 0),
    (
        "BlockingVolume",
        "Volume",
        0x1083DEF0,
        0x1083DF67,
        0x10C2FC48,
        0x10C2E258,
        0x438,
        0x800,
    ),
    (
        "PhysicsVolume",
        "Volume",
        0x1083DC30,
        0x1083DCA7,
        0x10C2E788,
        0x10C2E258,
        0x4C8,
        0x800,
    ),
    (
        "MusicVolume",
        "Volume",
        0x1083F020,
        0x1083F097,
        0x10C37DF8,
        0x10C2E258,
        0x43C,
        0x800,
    ),
)
# Additional native descriptors referenced by original volume/structure fields.
REFERENCE_REGISTRATIONS = (
    ("ZoneInfo", "Info", 0x1083BBE0, 0x1083BC54, 0x10C1F3B8, 0x10C27038, 0x4B8, 0),
    ("Info", "Actor", 0x1083CC60, 0x1083CCD4, 0x10C27038, 0x10C1C4C8, 0x3BC, 0),
    (
        "DecorationList",
        "Keypoint",
        0x1084A3D0,
        0x1084A444,
        0x11D7F930,
        0x10C23728,
        0x3C8,
        0,
    ),
)


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


def brush_loading_bits(engine, core, engine_package, core_package):
    """Derive Brush bits from its own registration/package and Actor ancestry."""
    parent = static_actor_loading_bits(engine, core, engine_package, core_package)
    saved = read_zero_script_class_flags(engine_package, "Brush", "Engine.Actor")
    assert engine.exported(BRUSH_CLASS) == 0x10C2D2C8
    for row in [
        (0x1083D9CB, "push", "0x10c1c4c8"),
        (0x1083D9D0, "push", "0"),
        (0x1083D9D2, "push", "0x418"),
        (0x1083D9D9, "mov", "ecx, 0x10c2d2c8"),
    ]:
        engine.instruction(*row)
    native = (
        engine.data[engine.offset(0x1083D9D0) + 1]
        | core.data[core.offset(0x101358C5) + 2]
    )
    evidence = parent["evidence"]
    variants = {native, saved["flags"]}
    variants |= {
        flags | (ancestor & evidence["inheritanceMask"])
        for flags in list(variants)
        for ancestor in evidence["actorVariants"]
    }
    mask = 0x428
    values = {flags & mask for flags in variants}
    if len(values) != 1:
        raise ValueError("class loading alternatives disagree on consumed Brush bits")
    return dict(
        sourceClass="Engine.Brush",
        scope="ordinary-native-registration-and-package",
        mask=mask,
        value=values.pop(),
        sources=parent["sources"],
        evidence={
            key: evidence[key]
            for key in (
                "root",
                "actor",
                "nativeRootFlags",
                "nativeActorFlags",
                "inheritanceMask",
                "actorVariants",
            )
        }
        | dict(brush=saved, nativeBrushFlags=native, brushVariants=sorted(variants)),
    )


def model_loading_bits(engine, core, engine_package, core_package):
    """The same qualified root/Primitive inheritance, with native Model flags."""
    mesh = loading_bits(engine, core, engine_package, core_package)
    assert not [
        e
        for e in engine_package.exports
        if engine_package.class_name_of(e) == "Class"
        and engine_package.export_name(e).casefold() == "model"
    ]
    assert engine.exported(MODEL_CLASS) == 0x10C79280
    for at, op, args in [
        (0x1084633B, "push", "0x10db0448"),
        (0x10846340, "push", "0"),
        (0x10846342, "push", "0x738"),
        (0x10846349, "mov", "ecx, 0x10c79280"),
    ]:
        engine.instruction(at, op, args)
    evidence = mesh["evidence"]
    flags = (
        engine.data[engine.offset(0x10846340) + 1]
        | core.data[core.offset(0x101358C5) + 2]
    )
    inherited = evidence["inheritanceMask"]
    variants = [
        flags | ((evidence["nativePrimitiveFlags"] | (root & inherited)) & inherited)
        for root in (evidence["nativeRootFlags"], evidence["root"]["flags"])
    ]
    mask = 0x408
    assert len({value & mask for value in variants}) == 1
    return dict(
        sourceClass="Engine.Model",
        scope="ordinary-native-registration",
        mask=mask,
        value=variants[0] & mask,
        sources=mesh["sources"],
        evidence=dict(
            root=evidence["root"],
            nativeRootFlags=evidence["nativeRootFlags"],
            nativePrimitiveFlags=evidence["nativePrimitiveFlags"],
            nativeModelFlags=flags,
            inheritanceMask=inherited,
            registeredModelVariants=variants,
        ),
    )


def polys_loading_bits(engine, core, engine_package, core_package):
    """UPolys uses UObject ancestry and no saved Engine.u class replacement."""
    mesh = loading_bits(engine, core, engine_package, core_package)
    assert not [
        e
        for e in engine_package.exports
        if engine_package.class_name_of(e) == "Class"
        and engine_package.export_name(e).casefold() == "polys"
    ]
    assert engine.exported(POLYS_CLASS) == 0x10C509F8
    for at, op, args in [
        (0x10844122, "push", "0x80"),
        (0x10844127, "push", "0x44"),
        (0x1084412B, "mov", "ecx, 0x10c509f8"),
    ]:
        engine.instruction(at, op, args)
    evidence = mesh["evidence"]
    native = engine.u32(0x10844123) | core.data[core.offset(0x101358C5) + 2]
    inherited = evidence["inheritanceMask"]
    variants = [
        native | (root & inherited)
        for root in (evidence["nativeRootFlags"], evidence["root"]["flags"])
    ]
    mask = 0x408
    assert len({value & mask for value in variants}) == 1
    return dict(
        sourceClass="Engine.Polys",
        scope="ordinary-native-registration",
        mask=mask,
        value=variants[0] & mask,
        sources=mesh["sources"],
        evidence=dict(
            root=evidence["root"],
            nativeRootFlags=evidence["nativeRootFlags"],
            nativePolysFlags=native,
            inheritanceMask=inherited,
            registeredPolysVariants=variants,
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


def reference_class_loading_bits(engine, core, engine_package, core_package):
    """Recover only UObjectProperty.Link's referenced-class bit.

    Native registration and saved class words must agree; inheritance cannot
    affect this consumed bit. No complete current class word is manufactured.
    """
    from l2lib import qualified_ref
    from l2lib.classdata import read_class_default_prefix
    from l2lib.propertylayout import consensus_flag_bits

    assert (engine.sha, core.sha) == (ENGINE_SHA, CORE_SHA)
    for package, digest in (
        (engine_package, ENGINE_PACKAGE_SHA),
        (core_package, CORE_PACKAGE_SHA),
    ):
        assert hashlib.sha256(package.path.read_bytes()).hexdigest() == digest
    core.instruction(0x10171688, "test", "dword ptr [ecx + 0x4a4], 0x200000")
    mask = core.u32(0x1017168E)
    core.instruction(0x101358C5, "or", "eax, 0x12")
    core.instruction(0x10133A88, "and", "eax, 0xf86ec")
    added, inherited = core.data[core.offset(0x101358C5) + 2], core.u32(0x10133A89)
    assert mask & (added | inherited) == 0
    core.instruction(0x101C03BF, "xor", "edi, edi")
    core.instruction(0x101C03C5, "push", "edi")
    core.instruction(0x101C03BA, "push", "0x1027d240")
    core.instruction(0x101C03D6, "mov", "ecx, 0x1027d770")
    core.instruction(0x101C03DE, "call", "0x1010268a")
    core.instruction(0x1010268A, "jmp", "0x10135860")
    assert core.exported("?PrivateStaticClass@UClass@@0V1@A") == 0x1027D770
    assert core.exported("?PrivateStaticClass@UState@@0VUClass@@A") == 0x1027D240
    assert core.exported(CLASS_CTOR, True) == 0x10135860
    registrations = [
        (
            "Engine.Actor",
            "Core.Object",
            0x1083B5B0,
            0x1083B629,
            0x1083B612,
            0x800,
            True,
        ),
        (
            "Engine.PhysicsVolume",
            "Engine.Volume",
            0x1083DC30,
            0x1083DCA7,
            0x1083DC90,
            0x800,
            True,
        ),
        (
            "Engine.Sound",
            "Core.Object",
            0x1083F800,
            0x1083F872,
            0x1083F861,
            0x40,
            False,
        ),
        *[
            (
                "Engine." + name,
                "Engine." + parent,
                start,
                end,
                start + 0x60,
                flags,
                True,
            )
            for name, parent, start, end, _, _, _, flags in REFERENCE_REGISTRATIONS
        ],
        ("Core.Class", "Core.State", 0x101C0390, 0x101C03E3, None, 0, False),
    ]
    records = {}
    for identity, parent, start, end, at, expected, has_saved in registrations:
        package = engine_package if identity.startswith("Engine.") else core_package
        image = engine if package is engine_package else core
        if at is not None:
            image.instruction(at, "push", hex(expected) if expected else "0")
            instruction = next(
                image.dis.disasm(
                    bytes(image.data[image.offset(at) : image.offset(at) + 5]), at
                )
            )
            native = int(instruction.op_str, 0) | added
        else:
            native = added  # Qualified XOR EDI,EDI argument in Core.Class registration.
        matches = [
            ex
            for ex in package.exports
            if package.class_name_of(ex) == "Class"
            and package.export_name(ex) == identity.split(".")[1]
        ]
        assert len(matches) == int(has_saved), (
            identity,
            "unexpected saved class presence",
        )
        saved = None
        if matches:
            export = matches[0]
            assert qualified_ref(package, export.super_index) == parent
            prefix = read_class_default_prefix(package, export)
            saved = dict(
                flags=prefix["fields"]["0x4a4"],
                flagsOffset=prefix["flagsOffset"],
                prefixSHA256=prefix["sourceSHA256"],
            )
        variants = sorted({native, *([saved["flags"]] if saved else [])})
        records[identity.casefold()] = dict(
            sourceClass=identity,
            **consensus_flag_bits(variants, mask),
            evidence=dict(
                nativeFlags=native,
                saved=saved,
                variants=variants,
                registrationStart=hex(start),
                registrationEnd=hex(end),
            ),
        )
    return dict(
        scope="ordinary-native-registration-and-saved-class-consensus",
        mask=mask,
        addedFlags=added,
        inheritanceMask=inherited,
        records=records,
        sources=dict(
            engine=engine.sha,
            core=core.sha,
            enginePackage=ENGINE_PACKAGE_SHA,
            corePackage=CORE_PACKAGE_SHA,
        ),
        limits=[
            "Only the bit consumed by UObjectProperty.Link; all other current class bits remain unknown.",
            "Native constructor additions and Register inheritance cannot change this bit; every available native/saved variant must agree.",
            "Pinned owned edition and ordinary native registration/loading only. No custom class descriptors, external mutations or full class/CDO lifecycle claimed.",
        ],
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
            "Brush",
            0x1083D970,
            0x1083D9E4,
            [
                (
                    0x1083D989,
                    0x11D8D790,
                    0x11D8D78C,
                    "import",
                    "?StaticConstructor@UObject@@QAEXXZ",
                ),
                (0x1083D9A5, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (0x1083D9CC, 0x10C1C4C8, 0x10C1C4D8, "export", ACTOR_CLASS),
                (0x1083D9DA, 0x10C2D2C8, 0x10C2D2D8, "export", BRUSH_CLASS),
            ],
            [
                (0x1083D980, "??0FGuid@@QAE@KKKK@Z"),
                (0x1083D998, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x1083D9C4, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1083D9DE, CLASS_CTOR),
            ],
        ),
        *[
            (
                name,
                start,
                end,
                [
                    (
                        start + 0x19,
                        0x11D8D790,
                        0x11D8D78C,
                        "import",
                        "?StaticConstructor@UObject@@QAEXXZ",
                    ),
                    (start + 0x35, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                    (
                        start + 0x5C,
                        parent_at,
                        parent_at + 0x10,
                        "export",
                        "?PrivateStaticClass@A" + parent + "@@0VUClass@@A",
                    ),
                    (
                        end - 10,
                        descriptor,
                        descriptor + 0x10,
                        "export",
                        "?PrivateStaticClass@A" + name + "@@0VUClass@@A",
                    ),
                ],
                [
                    (start + 0x10, "??0FGuid@@QAE@KKKK@Z"),
                    (start + 0x28, "?StaticConfigName@UObject@@SAPBGXZ"),
                    (start + 0x54, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                    (end - 6, CLASS_CTOR),
                ],
            )
            for name, parent, start, end, descriptor, parent_at, size, flags in (
                *VOLUME_REGISTRATIONS,
                *REFERENCE_REGISTRATIONS,
            )
        ],
        (
            "Sound",
            0x1083F800,
            0x1083F872,
            [
                (
                    0x1083F807,
                    0x11D8D790,
                    0x11D8D78C,
                    "import",
                    "?StaticConstructor@UObject@@QAEXXZ",
                ),
                (0x1083F81E, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (
                    0x1083F868,
                    0x10C41CE8,
                    0x10C41CF8,
                    "export",
                    "?PrivateStaticClass@USound@@0VUClass@@A",
                ),
            ],
            [
                (0x1083F816, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x1083F832, "??0FGuid@@QAE@KKKK@Z"),
                (0x1083F853, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1083F85A, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1083F86C, CLASS_CTOR),
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
            "Model",
            0x108462E0,
            0x10846354,
            [
                (
                    0x108462F9,
                    0x11D8D790,
                    0x11D8D78C,
                    "import",
                    "?StaticConstructor@UObject@@QAEXXZ",
                ),
                (0x10846315, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (0x1084633C, 0x10DB0448, 0x10DB0458, "export", PRIMITIVE_CLASS),
                (0x1084634A, 0x10C79280, 0x10C79290, "export", MODEL_CLASS),
            ],
            [
                (0x108462F0, "??0FGuid@@QAE@KKKK@Z"),
                (0x10846308, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x10846334, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1084634E, CLASS_CTOR),
            ],
        ),
        (
            "Polys",
            0x108440C0,
            0x10844136,
            [
                (
                    0x108440D9,
                    0x11D8D790,
                    0x11D8D78C,
                    "import",
                    "?StaticConstructor@UObject@@QAEXXZ",
                ),
                (0x108440F5, 0x10A72EAC, 0x10A72E98, "export", "GPackage"),
                (0x1084412C, 0x10C509F8, 0x10C50A08, "export", POLYS_CLASS),
            ],
            [
                (0x108440D0, "??0FGuid@@QAE@KKKK@Z"),
                (0x108440E8, "?StaticConfigName@UObject@@SAPBGXZ"),
                (0x10844114, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x1084411B, "?StaticClass@UObject@@SAPAVUClass@@XZ"),
                (0x10844130, CLASS_CTOR),
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
        ("native Class registration prefix", 0x101C0390, 0x101C03E3),
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
    volume_storage = []
    for (
        name,
        parent,
        start,
        end,
        descriptor,
        parent_at,
        size,
        flags,
    ) in VOLUME_REGISTRATIONS:
        engine.instruction(start + 0x60, "push", hex(flags) if flags else "0")
        engine.instruction(end - 18, "push", hex(size))
        volume_storage.append(
            dict(
                sourceClass="Engine." + name,
                parent="Engine." + parent,
                byteSize=size,
                nativeFlags=flags,
                descriptor=hex(descriptor),
                registrationStart=hex(start),
            )
        )
    return dict(
        engineBlocks=blocks,
        coreBlocks=core_blocks,
        rootPrefixAnchors=anchors,
        volumeStorage=volume_storage,
        classDefaultPrefix=qualify_class_default_prefix(core, comparison_core),
        actorDispatch=qualify_actor_dispatch(engine, comparison_engine),
        limits=[
            "Native registration and pinned original packages; external class mutation and custom descriptors are excluded.",
            "Source correspondence, not execution of the full class registry. Class defaults/configuration target separate object storage.",
            "Only consumed resource/actor loading bits are derived; no complete current class word or script execution state is inferred.",
            "Supplemental correspondence does not authenticate an archive or restore the protected runtime.",
        ],
    )


def qualify_property_offsets(core, comparison_core):
    """Bind the recomputed class/struct property offset stage, not full Link.

    Parent/current reflection and completed archive Preload are supplied. The
    prefix stops before cleanup/reference lists and never claims to return
    from UStruct.Link. Individual admitted property Link bodies are complete.
    """
    assert (core.sha, comparison_core.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    methods = {
        "ByteProperty": (0x101044A8, 0x10170AF0, 0x10170B4B),
        "IntProperty": (0x101024F0, 0x10170D40, 0x10170DA1),
        "BoolProperty": (0x10102D74, 0x10173250, 0x101732F1),
        "FloatProperty": (0x10104340, 0x10171510, 0x10171571),
        "ObjectProperty": (0x1010278E, 0x10171630, 0x101716B6),
        "ClassProperty": (0x1010278E, 0x10171630, 0x101716B6),
        "NameProperty": (0x1010428C, 0x101719F0, 0x10171A51),
        "StrProperty": (0x101010D2, 0x10171C10, 0x10171C83),
        "StructProperty": (0x10101DE3, 0x10172690, 0x1017273D),
    }
    targets, blocks = {}, []
    helpers = (
        ("property cast", 0x10103936, 0x10132A00, 0x10132A22),
        ("Boolean cast", 0x10102EFA, 0x101329D0, 0x101329F2),
        ("UStruct.GetPropertiesSize", 0x10102199, 0x1010B310, 0x1010B314),
        ("UClass.GetInheritanceSuper", 0x10104890, 0x10115A20, 0x10115A24),
        ("UClass virtual slot 0x6c", 0x10101FC3, 0x1010B570, 0x1010B576),
        ("UStruct.GetInheritanceSuper", 0x10101ABE, 0x10115950, 0x10115954),
        ("UStruct virtual slot 0x6c", 0x10101A23, 0x101305D0, 0x101305D6),
    )
    ranges = [
        ("UStruct.Link recompute-offset prefix", 0x10135E30, 0x10135F12),
    ]
    for name, (thunk, start, end) in methods.items():
        cls = "U" + ("ObjectProperty" if name == "ClassProperty" else name)
        symbol = "?Link@" + cls + "@@UAEXAAVFArchive@@PAVUProperty@@@Z"
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        table = "??_7U" + name + "@@6B@"
        assert core.u32(core.exported(table) + 0x80) == thunk
        assert comparison_core.u32(comparison_core.exports[table] + 0x80) == thunk
        helpers += ((name + ".Link", thunk, start, end),)
    for name, thunk, start, end in helpers:
        core.instruction(thunk, "jmp", hex(start))
        assert bytes(
            core.data[core.offset(thunk) : core.offset(thunk) + 5]
        ) == comparison_core.read(thunk, 5)
        targets[hex(thunk)] = hex(start)
        if (name, start, end) not in ranges:
            ranges.append((name, start, end))
    for name, start, end in ranges:
        data = bytes(core.data[core.offset(start) : core.offset(end)])
        assert data == comparison_core.read(start, end - start)
        rows = list(core.dis.disasm(data, start))
        assert sum(row.size for row in rows) == len(data)
        blocks.append(
            dict(
                label=name,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    # The serializer binding and caller prefixes establish the load-time
    # recomputation path without claiming complete UClass/UState Link execution.
    for address, mnemonic, operands in (
        (0x1013155C, "cmp", "dword ptr [edi + 0x10], 0"),
        (0x10131564, "push", "1"),
        (0x10131569, "mov", "eax, dword ptr [edx + 0x80]"),
        (0x10136587, "call", "0x10103fc1"),
        (0x10103FC1, "jmp", "0x10136400"),
        (0x10136434, "call", "0x10103364"),
        (0x10103364, "jmp", "0x10135e30"),
    ):
        core.instruction(address, mnemonic, operands)
        row = next(
            core.dis.disasm(
                bytes(core.data[core.offset(address) : core.offset(address) + 15]),
                address,
            )
        )
        assert bytes(row.bytes) == comparison_core.read(address, row.size)
    caller_prefixes = []
    for cls, start, end in (
        ("UClass", 0x10136550, 0x1013658C),
        ("UState", 0x10136400, 0x10136439),
    ):
        symbol = "?Link@" + cls + "@@UAEXAAVFArchive@@H@Z"
        assert core.exported(symbol, True) == comparison_core.body(symbol) == start
        thunk = core.exported(symbol)
        assert thunk == comparison_core.exports[symbol]
        core.instruction(thunk, "jmp", hex(start))
        assert bytes(
            core.data[core.offset(thunk) : core.offset(thunk) + 5]
        ) == comparison_core.read(thunk, 5)
        data = bytes(core.data[core.offset(start) : core.offset(end)])
        assert data == comparison_core.read(start, len(data))
        caller_prefixes.append(
            dict(
                symbol=symbol,
                start=hex(start),
                end=hex(end),
                scope="prefix through inherited Link call",
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    field_serializers = []
    for cls, parent in (
        ("UConst", "UField"),
        ("UEnum", "UField"),
        ("UStruct", "UField"),
        ("UState", "UStruct"),
        ("UFunction", "UStruct"),
    ):
        symbol = "?Serialize@" + cls + "@@UAEXAAVFArchive@@@Z"
        inherited = "?Serialize@" + parent + "@@UAEXAAVFArchive@@@Z"
        start = core.exported(symbol, True)
        assert start == comparison_core.body(symbol)
        rows = list(
            core.dis.disasm(
                bytes(core.data[core.offset(start) : core.offset(start) + 128]), start
            )
        )
        call = next(row for row in rows if row.mnemonic == "call")
        assert (
            int(call.op_str, 16)
            == core.exported(inherited)
            == comparison_core.exports[inherited]
        )
        end = call.address + call.size
        data = bytes(core.data[core.offset(start) : core.offset(end)])
        assert data == comparison_core.read(start, len(data))
        table = "??_7" + cls + "@@6B@"
        assert core.u32(core.exported(table) + 0x2C) == core.exported(symbol)
        assert (
            comparison_core.u32(comparison_core.exports[table] + 0x2C)
            == comparison_core.exports[symbol]
        )
        field_serializers.append(
            dict(
                symbol=symbol,
                calls=inherited,
                start=hex(start),
                end=hex(end),
                scope="prefix through first inherited serializer call",
                SHA256=hashlib.sha256(data).hexdigest(),
            )
        )
    for cls, targets_by_slot in (
        (
            "UClass",
            (
                (0x6C, 0x10101FC3),
                (0x78, 0x10102199),
                (0x7C, 0x10104890),
                (0x80, 0x1010452A),
            ),
        ),
        (
            "UStruct",
            (
                (0x6C, 0x10101A23),
                (0x78, 0x10102199),
                (0x7C, 0x10101ABE),
                (0x80, 0x10103364),
            ),
        ),
    ):
        table = "??_7" + cls + "@@6B@"
        for slot, target in targets_by_slot:
            assert core.u32(core.exported(table) + slot) == target
            assert comparison_core.u32(comparison_core.exports[table] + slot) == target
    for symbol, at in (
        ("?PrivateStaticClass@UProperty@@0VUClass@@A", 0x10336D80),
        ("?PrivateStaticClass@UBoolProperty@@0VUClass@@A", 0x10338240),
    ):
        assert core.exported(symbol) == comparison_core.exports[symbol] == at
    return dict(
        coreSHA256=core.sha,
        comparisonCoreSHA256=comparison_core.sha,
        blocks=blocks,
        thunkTargets=targets,
        fieldSerializerPrefixes=field_serializers,
        callerPrefixes=caller_prefixes,
        propertyMethods={kind: hex(values[0]) for kind, values in methods.items()},
        limits=[
            "Only the recompute-offset prefix, ending before UStruct.Link's property lists; alternate preserve-offset mode is excluded.",
            "Current reflection, parent PropertiesSize and successful completed Preload are explicit inputs. No full class/archive execution.",
            "Complete admitted property Link bodies execute; Python compares only offsets, element sizes, Boolean masks and final PropertiesSize.",
            "Nested structure sizes are supplied after Preload; array properties, property-flag changes and cleanup/reference lists are outside the portable output.",
        ],
    )


def qualify_property_lists(core, comparison_core):
    """Extend offset evidence through UStruct.Link's four property lists.

    The entire ordinary body is compared. Replication grouping is not admitted
    for execution; temporary empty-map lifecycle calls remain providers.
    """
    from actor_localization_source import qualify_actor_localization

    proof = qualify_property_offsets(core, comparison_core)
    localization = qualify_actor_localization(core, comparison_core)
    helpers = (
        (0x101043BD, 0x10132A30, 0x10132A52),
        (0x101016F9, 0x10132A60, 0x10132A82),
        (0x1010411A, 0x10132A90, 0x10132AB2),
    )
    ranges = [(0x10135E30, 0x10136218)]
    for thunk, start, end in helpers:
        core.instruction(thunk, "jmp", hex(start))
        raw = bytes(core.data[core.offset(thunk) : core.offset(thunk) + 5])
        assert raw == comparison_core.read(thunk, 5)
        proof["thunkTargets"][hex(thunk)] = hex(start)
        ranges.append((start, end))
    for start, end in ranges:
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, end - start)
        assert sum(i.size for i in core.dis.disasm(raw, start)) == len(raw)
        proof["blocks"].append(
            dict(start=hex(start), end=hex(end), SHA256=hashlib.sha256(raw).hexdigest())
        )
    # Reuse the exact iterator/inheritance/cast evidence used by localization.
    reused = {0x10119210, 0x10114340, 0x101329A0}
    proof["blocks"].extend(
        b for b in localization["coreBlocks"] if int(b["start"], 16) in reused
    )
    proof["thunkTargets"].update(
        {k: v for k, v in localization["thunkTargets"].items() if int(v, 16) in reused}
    )
    kinds = (*proof["propertyMethods"], "ArrayProperty", "DelegateProperty")
    descriptors = {}
    for kind in ("Property", *kinds):
        symbol = "?PrivateStaticClass@U" + kind + "@@0VUClass@@A"
        descriptor = core.exported(symbol)
        assert descriptor == comparison_core.exports[symbol]
        descriptors[kind] = descriptor
    for kind, address in (
        ("ObjectProperty", 0x10338CA0),
        ("StructProperty", 0x1033B0F0),
        ("ArrayProperty", 0x1033A690),
        ("DelegateProperty", 0x10337D10),
    ):
        assert descriptors[kind] == address
    assert (
        core.exported("?GIsEditor@@3HA")
        == comparison_core.exports["?GIsEditor@@3HA"]
        == 0x1023E8C4
    )
    proof["propertyDescriptors"] = descriptors
    proof["limits"] = [
        "Recomputed offsets, individual Link flag changes and four inherited property lists; not full UClass/UState Link or live class startup.",
        "Current reflection, referenced class flags, parent size/lists and successful completed Preload remain explicit inputs.",
        "Noneditor execution rejects replicated fields; editor execution skips original replication grouping. Grouping and alternate preserve-offset mode are not implemented.",
        "The temporary replication map stays empty; its initialization/empty/destruction calls are supplied providers, not native container execution.",
    ]
    return proof


def qualify_script_expressions(core, comparison_core):
    """Bind loaded SerializeExpr traversal with the original base FArchive.

    The admitted token shapes remain those of the bounded class-prefix reader.
    This archive traverses existing memory; it does not resolve saved references.
    """
    prefix = qualify_class_default_prefix(core, comparison_core)
    labels = {
        "UStruct.SerializeExpr normal path",
        "object archive wrapper",
        "script reference archive wrapper",
    }
    blocks = [row for row in prefix["blocks"] if row["label"] in labels]
    targets = {}
    for label, thunk, start, end in (
        ("SerializeExpr", 0x10102248, 0x10131B90, 0x10132108),
        ("object archive wrapper", 0x10102EB4, 0x1012A9F0, 0x1012AA01),
        ("script reference archive wrapper", 0x10103B8E, 0x10130F10, 0x10130F21),
        ("byte archive wrapper", 0x10102D8D, 0x101307E0, 0x101307F9),
        ("word archive wrapper", 0x10102DE2, 0x10130800, 0x10130819),
        ("base archive constructor", 0x101039E0, 0x10108B20, 0x10108B67),
        ("base archive Serialize", 0x10103A12, 0x10108930, 0x10108933),
        ("base archive object reference", 0x101043D1, 0x10108970, 0x10108975),
        ("base archive Tell", 0x10102DEC, 0x101089A0, 0x101089A4),
        ("base archive Seek", 0x10102496, 0x10108A40, 0x10108A43),
    ):
        core.instruction(thunk, "jmp", hex(start))
        assert bytes(
            core.data[core.offset(thunk) : core.offset(thunk) + 5]
        ) == comparison_core.read(thunk, 5)
        targets[hex(thunk)] = hex(start)
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, len(raw))
        assert sum(i.size for i in core.dis.disasm(raw, start)) == len(raw)
        if not any(row["start"] == hex(start) for row in blocks):
            blocks.append(
                dict(
                    label=label,
                    start=hex(start),
                    end=hex(end),
                    SHA256=hashlib.sha256(raw).hexdigest(),
                )
            )
    constants = {}
    table = core.exported("??_7FArchive@@6B@")
    assert table == comparison_core.exports["??_7FArchive@@6B@"] == 0x101CD5EC
    for slot, thunk in (
        (4, 0x10103A12),
        (0x18, 0x101043D1),
        (0x28, 0x10102DEC),
        (0x3C, 0x10102496),
    ):
        assert core.u32(table + slot) == comparison_core.u32(table + slot) == thunk
        constants[hex(table + slot)] = thunk
    for cls in ("UStruct", "UClass"):
        symbol = "??_7" + cls + "@@6B@"
        owned, other = core.exported(symbol), comparison_core.exports[symbol]
        assert core.u32(owned + 0x90) == comparison_core.u32(other + 0x90) == 0x10102248
    return dict(
        coreSHA256=core.sha,
        comparisonCoreSHA256=comparison_core.sha,
        blocks=blocks,
        thunkTargets=targets,
        constants=constants,
        dispatch=prefix["dispatch"],
        limits=[
            "Loaded script bytes and current object-reference DWORDs are explicit inputs; no package loading or reference resolution is inferred.",
            "Only the existing bounded reader's token shapes; debug records and other tokens remain unsupported. No script execution or condition truth is evaluated.",
        ],
    )


def qualify_replication_linking(core, comparison_core):
    """Bind UStruct.Link's replication dependencies and temporary map bodies."""
    assert (core.sha, comparison_core.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    blocks, targets = [], {}
    for label, thunk, start, end in (
        ("UField.GetOwnerClass", 0x1010173A, 0x101311F0, 0x10131209),
        ("appMemcmp", 0x10103CF1, 0x1012D910, 0x1012D99E),
        ("temporary map constructor", 0x10103445, 0x10135D90, 0x10135DCC),
        ("temporary map base constructor", 0x101017FD, 0x10135CA0, 0x10135CF8),
        ("temporary map set", 0x10101280, 0x10134440, 0x101344B1),
        ("temporary map append", 0x10101FAA, 0x10132720, 0x101327BB),
        ("temporary map find", 0x10102991, 0x101325E0, 0x10132634),
        ("temporary map rehash", 0x10103DAF, 0x10132650, 0x101326EB),
        ("temporary map empty", 0x101017A3, 0x10134410, 0x10134431),
        ("temporary map destructor", 0x10101DB1, 0x10135DE0, 0x10135E15),
        ("temporary map base destructor", 0x10101BCC, 0x10135D10, 0x10135D77),
        ("temporary map array destructor", 0x10101947, 0x10134590, 0x1013463D),
        ("FArray.Realloc", 0x101031D9, 0x101522E0, 0x10152346),
        ("FArray.Remove", 0x1010303A, 0x101523C0, 0x10152437),
    ):
        core.instruction(thunk, "jmp", hex(start))
        assert bytes(
            core.data[core.offset(thunk) : core.offset(thunk) + 5]
        ) == comparison_core.read(thunk, 5)
        targets[hex(thunk)] = hex(start)
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == comparison_core.read(start, len(raw))
        assert sum(i.size for i in core.dis.disasm(raw, start)) == len(raw)
        blocks.append(
            dict(
                label=label,
                start=hex(start),
                end=hex(end),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    for name, start in (
        ("?GetOwnerClass@UField@@UAEPAVUClass@@XZ", 0x101311F0),
        ("?appMemcmp@@YAHPBX0H@Z", 0x1012D910),
        ("?Realloc@FArray@@IAEXH@Z", 0x101522E0),
        ("?Remove@FArray@@QAEXHHH@Z", 0x101523C0),
    ):
        assert core.exported(name, True) == comparison_core.body(name) == start
    for cls in ("UProperty", "UStructProperty", "UIntProperty"):
        name = "??_7" + cls + "@@6B@"
        assert (
            core.u32(core.exported(name) + 0x74)
            == comparison_core.u32(comparison_core.exports[name] + 0x74)
            == 0x1010173A
        )
    assert (
        core.exported("?PrivateStaticClass@UClass@@0V1@A")
        == comparison_core.exports["?PrivateStaticClass@UClass@@0V1@A"]
        == 0x1027D770
    )
    return dict(
        coreSHA256=core.sha,
        comparisonCoreSHA256=comparison_core.sha,
        blocks=blocks,
        thunkTargets=targets,
        limits=[
            "Original grouping, owner lookup, byte comparison and temporary map lifecycle execute; successful allocation/reallocation/free remain explicit providers. No native allocator, exception path, script truth evaluation or complete UClass/UState linking is claimed."
        ],
    )


def read_owned_loading_bits(*, actor=False, model=False, polys=False, brush=False):
    """Read this edition's owned inputs; no supplemental lookup or downloads."""
    from pathlib import Path
    from check_tutorial_quest_native import Image
    from l2lib import load_package

    root = Path(__file__).resolve().parents[2] / "assets/interlude/system"
    if sum((actor, model, polys, brush)) > 1:
        raise ValueError("choose one source class")
    derive = (
        brush_loading_bits
        if brush
        else (
            static_actor_loading_bits
            if actor
            else (
                model_loading_bits
                if model
                else polys_loading_bits if polys else loading_bits
            )
        )
    )
    return derive(
        Image(root / "engine.dll", ENGINE_SHA, True),
        Image(root / "Core.dll", CORE_SHA),
        load_package(root / "Engine.u")[0],
        load_package(root / "Core.u")[0],
    )


def read_owned_reference_class_bits():
    """Owned-edition source reader; supplemental binding is a separate check."""
    from pathlib import Path
    from check_tutorial_quest_native import Image
    from l2lib import load_package

    root = Path(__file__).resolve().parents[2] / "assets/interlude/system"
    return reference_class_loading_bits(
        Image(root / "engine.dll", ENGINE_SHA, True),
        Image(root / "Core.dll", CORE_SHA),
        load_package(root / "Engine.u")[0],
        load_package(root / "Core.u")[0],
    )
