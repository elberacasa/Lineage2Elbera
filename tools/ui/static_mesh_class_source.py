"""Elbera Tools: loading bits of the original native StaticMesh class.

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


def read_root_class_flags(package):
    """Read the source-bound, zero-script file-123 root-class prefix only."""
    from l2lib import Reader

    if package.file_version != 123:
        raise ValueError("unsupported root-class file version")
    matches = [
        e
        for e in package.exports
        if package.class_name_of(e) == "Class" and package.export_name(e) == "Object"
    ]
    if len(matches) != 1:
        raise ValueError("expected one root Object class")
    export = matches[0]
    if export.super_index != 0 or export.object_flags & 0x02000000:
        raise ValueError("unsupported root-class superclass or script stack")
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if not 0 <= start < end <= len(package.data):
        raise ValueError("invalid root-class export boundary")
    reader = Reader(memoryview(package.data)[:end], start, package.path)
    refs = [reader.compact() for _ in range(6)]
    if refs[0] != 0 or package.name(refs[4]) != "Object":
        raise ValueError("unexpected root-class prefix identity")
    reader.bytes(8)  # Original line and text-position fields.
    if reader.i32() != 0:
        raise ValueError("root-class script bytecode is outside this reader")
    reader.bytes(8 + 8 + 2 + 4)  # Probe/ignore masks, label offset, state flags.
    offset = reader.pos
    flags = reader.u32()
    return dict(
        flags=flags,
        sourceOffset=offset,
        prefixBytes=reader.pos - start,
        prefixSHA256=hashlib.sha256(package.data[start : reader.pos]).hexdigest(),
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
    # Root UClass bypasses tagged UObject properties. The six compact fields
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
        limits=[
            "Native registration and pinned original packages; external class mutation and custom descriptors are excluded.",
            "Source correspondence, not execution of the full class registry. Class defaults/configuration target separate object storage.",
            "Only allocation bits 0x408 are exported as known current state; no complete class word is inferred.",
            "Supplemental correspondence does not authenticate an archive or restore the protected runtime.",
        ],
    )


def read_owned_loading_bits():
    """Read this edition's owned inputs; no supplemental lookup or downloads."""
    from pathlib import Path
    from check_tutorial_quest_native import Image
    from l2lib import load_package

    root = Path(__file__).resolve().parents[2] / "assets/interlude/system"
    return loading_bits(
        Image(root / "engine.dll", ENGINE_SHA, True),
        Image(root / "Core.dll", CORE_SHA),
        load_package(root / "Engine.u")[0],
        load_package(root / "Core.u")[0],
    )
