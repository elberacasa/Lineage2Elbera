#!/usr/bin/env python3
"""Elbera Tools: original terrain-zone population and fixed-slot source evidence.

--check requires pinned owned Engine/Core and Engine.u/Core.u. Explicit paired
supplemental paths qualify six-NOP import sites; owned-only mode names them as
unresolved. No native execution, binary writes or live actor admission.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [
    str(ROOT / p) for p in ("tools/ui", "tools/world", "tools/dat", "tools")
]


def verify(comparison_engine=None, comparison_core=None):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    from supplemental_pe import PEImage
    from check_supplemental_engine import CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
    from check_hair_attachment_native import compare_call_block
    from check_picking_native import verify_actor_defaults_and_trace
    from l2lib import Reader, load_package

    if bool(comparison_engine) != bool(comparison_core):
        raise ValueError("both supplemental paths must be explicit")
    E = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    C = Image(ROOT / "assets/interlude/system/Core.dll", CORE_SHA)
    P = PEImage(comparison_engine, CANDIDATE_ENGINE_SHA) if comparison_engine else None
    SC = PEImage(comparison_core, CANDIDATE_CORE_SHA) if comparison_core else None
    sha = lambda b: hashlib.sha256(b).hexdigest()
    read = lambda a, b: bytes(E.data[E.offset(a) : E.offset(b)])
    checks = []

    def pin(a, op, arg):
        E.instruction(a, op, arg)
        checks.append([hex(a), op, arg])

    methods = {
        "?UpdateTerrainArrays@ULevel@@QAEXXZ": 0x105CDB10,
        "?BuildRenderData@ULevel@@UAEXXZ": 0x105CF3C0,
        "??0UModel@@QAE@XZ": 0x103F9D30,
        "?EmptyModel@UModel@@QAEXHH@Z": 0x105EE480,
        "?Serialize@UModel@@UAEXAAVFArchive@@@Z": 0x105EF380,
        "?SetZone@AActor@@UAEXHH@Z": 0x105C7500,
        "?GetZoneActor@ULevel@@QAEPAVAZoneInfo@@H@Z": 0x10377910,
        "??0AZoneInfo@@QAE@XZ": 0x103BEA50,
    }
    for name, va in methods.items():
        assert E.exported(name, True) == va
    for cls in ["AActor", "ATerrainInfo"]:
        assert E.u32(E.exported("??_7" + cls + "@@6B@") + 0x1BC) == E.exported(
            "?SetZone@AActor@@UAEXHH@Z"
        )
    for a, op, arg in [
        (0x1030C310, "jmp", "0x105ee480"),
        (0x1030E787, "jmp", "0x105cced0"),
        (0x1030CD79, "jmp", "0x1058b5f0"),
        (0x1037791D, "lea", "eax, [eax + eax*2 + 0x27]"),
        (0x10377921, "mov", "eax, dword ptr [ecx + eax*8]"),
        (0x10377924, "test", "eax, eax"),
        (0x10377926, "jne", "0x1037794c"),
        (0x10377947, "mov", "eax, dword ptr [esi + 0x38]"),
        (0x1037794A, "mov", "eax, dword ptr [eax]"),
        (0x1072DF06, "cdq", ""),
        (0x1072DF07, "sub", "eax, edx"),
        (0x1072DF09, "sar", "eax, 1"),
        (0x1072DF1A, "cdq", ""),
        (0x1072DF1B, "sub", "eax, edx"),
        (0x1072DF1D, "sar", "eax, 1"),
        (0x1072DF90, "fcomp", "dword ptr [0x1089139c]"),
        (0x1072DF98, "test", "ah, 0x41"),
        (0x1072DF9B, "jne", "0x1072e003"),
        (0x103F9E78, "push", "0"),
        (0x103F9E7A, "push", "1"),
        (0x103F9E88, "call", "0x1030c310"),
        (0x105EE502, "xor", "esi, esi"),
        (0x105EE629, "mov", "dword ptr [edi + 0x134], esi"),
        (0x105EE642, "cmp", "esi, 0x40"),
        (0x105EE647, "lea", "eax, [esi + esi*2 + 0x27]"),
        (0x105EE64B, "mov", "dword ptr [edi + eax*8], 0"),
        (0x105EE681, "add", "esi, 1"),
        (0x105EF41E, "cmp", "ebx, dword ptr [edi + 0x134]"),
        (0x105EF42A, "lea", "ecx, [edi + eax*8]"),
        (0x105EF42F, "call", "0x10311bcb"),
        (0x105EF437, "add", "ebx, 1"),
        (0x105CF3E8, "call", "0x103133cc"),
        (0x105CDB4D, "cmp", "esi, 0x40"),
        (0x105CDB52, "lea", "eax, [esi + esi*2 + 0x27]"),
        (0x105CDB63, "lea", "ecx, [eax + 0x3dc]"),
        (0x105CDB90, "mov", "eax, dword ptr [edi + 0x3c]"),
        (0x105CDBA1, "lea", "eax, [edx + esi]"),
        (0x105CDBAB, "test", "byte ptr [ecx + 0x64], 0x80"),
        (0x105CDBC8, "push", "0"),
        (0x105CDBCA, "push", "1"),
        (0x105CDBCC, "mov", "edx, dword ptr [eax + 0x1bc]"),
        (0x105CDBD2, "call", "edx"),
        (0x105CDBF1, "mov", "ecx, dword ptr [eax + 0xec]"),
        (0x105CDBF7, "add", "ecx, 0x3dc"),
        (0x105CDBFD, "call", "0x1030e787"),
        (0x105CDC14, "cmp", "dword ptr [ecx], 0"),
        (0x105CDC17, "je", "0x105cdc43"),
        (0x105C756B, "mov", "edx, dword ptr [esi + 0x1bc]"),
        (0x105C7573, "mov", "edx, dword ptr [esi + 0x1c0]"),
        (0x105C757C, "mov", "edx, dword ptr [esi + 0x1c4]"),
        (0x105C7596, "call", "0x10306b6d"),
        (0x105C75B1, "jne", "0x105c75c7"),
        (0x105C75C7, "mov", "dword ptr [esi + 0xec], eax"),
        (0x105C75E1, "jne", "0x105c7609"),
        (0x105C7650, "jne", "0x105c767e"),
        (0x105C767E, "mov", "dword ptr [esi + 0x1b8], edi"),
        (0x103BEBAD, "and", "ecx, 1"),
        (0x103BEBC4, "and", "eax, 2"),
        (0x103BEBD7, "and", "ecx, 4"),
        (0x103BEC02, "lea", "eax, [ebp + 0x3dc]"),
        (0x103BEC08, "lea", "ecx, [ebx + 0x3dc]"),
        (0x105C626F, "test", "byte ptr [eax + 0x3d8], 4"),
        (0x105CCEDD, "test", "ecx, ecx"),
        (0x105CCEE6, "cmp", "dword ptr [edx], edi"),
        (0x105CCEE8, "je", "0x105ccf07"),
        (0x105CCEF4, "push", "4"),
        (0x105CCEF6, "push", "1"),
        (0x105CCF04, "mov", "dword ptr [ecx + eax*4], edx"),
    ]:
        pin(a, op, arg)
    complete_owned = []
    for label, a, b in [
        ("default Model constructor", 0x103F9D30, 0x103F9EA7),
        ("GetZoneActor", 0x10377910, 0x10377950),
        ("SetZone normal path", 0x105C7500, 0x105C769E),
    ]:
        raw = read(a, b)
        rows = list(E.dis.disasm(raw, a))
        cursor = a
        for row in rows:
            assert row.address == cursor
            cursor += row.size
        assert cursor == b and rows[-1].mnemonic == "ret"
        complete_owned.append(
            dict(
                label=label,
                start=hex(a),
                endExclusive=hex(b),
                instructions=len(rows),
                SHA256=sha(raw),
                scope="contiguous complete normal path; exception handlers excluded",
            )
        )
    expected_imports = {
        0x105CDB7B: "?Empty@FArray@@QAEXHH@Z",
        0x105CDBB6: "?IsA@UObject@@QBEHPAVUClass@@@Z",
        0x105CDC3D: "?Empty@FArray@@QAEXHH@Z",
        0x105CCEFA: "?Add@FArray@@QAEHHH@Z",
        0x1058B600: "?IsA@UObject@@QBEHPAVUClass@@@Z",
        0x1072DF4B: "?TransformPointBy@FVector@@QBE?AV1@ABVFCoords@@@Z",
        0x1072DF8A: "?SizeSquared@FVector@@QBEMXZ",
        0x103BEA96: "??0FName@@QAE@XZ",
        0x103BEAA2: "??0FStringNoInit@@QAE@XZ",
        0x103BEAB9: "??0FArray@@QAE@W4ENoInit@@@Z",
        0x103BEAD0: "??0FArray@@QAE@W4ENoInit@@@Z",
    }
    blocks = []
    # Explicit operand qualification only; never normalize arbitrary data addresses.
    for label, a, b, delta, changes in [
        (
            "UpdateTerrainArrays normal",
            0x105CDB31,
            0x105CDC5B,
            -0x40,
            [
                (
                    0x105CDBB1 + 1,
                    "export",
                    "?PrivateStaticClass@ATerrainInfo@@0VUClass@@A",
                ),
                (0x105CDC0E + 2, "iat", "?GIsEditor@@3HA"),
            ],
        ),
        ("AddUnique terrain pointer", 0x105CCED0, 0x105CCF0D, -0x40, []),
        (
            "Terrain cast",
            0x1058B5F0,
            0x1058B612,
            -0x40,
            [
                (
                    0x1058B5F9 + 1,
                    "export",
                    "?PrivateStaticClass@ATerrainInfo@@0VUClass@@A",
                )
            ],
        ),
        ("EmptyModel fixed zone tail", 0x105EE629, 0x105EE6A0, -0x40, []),
        ("Terrain PostLoad location check", 0x1072DF00, 0x1072DF9D, -0x40, []),
        ("ZoneInfo members normal ctor", 0x103BEA8A, 0x103BEAF0, 0, []),
    ]:
        raw = read(a, b)
        if P is None:
            erased = []
            for site, name in expected_imports.items():
                if a <= site < b:
                    assert read(site, site + 6) == b"\x90" * 6
                    erased.append(hex(site))
            blocks.append(
                dict(
                    label=label,
                    start=hex(a),
                    end=hex(b),
                    ownedSHA256=sha(raw),
                    status="owned-call-identities-erased",
                    erasedCallSites=erased,
                )
            )
            continue
        other = bytearray(P.read(a + delta, b - a))
        qualified = []
        for va, kind, name in changes:
            offset = va - a
            left = struct.unpack_from("<I", raw, offset)[0]
            right = struct.unpack_from("<I", other, offset)[0]
            if kind == "export":
                assert left == E.exported(name) and right == P.exports[name], (
                    label,
                    hex(va),
                    hex(left),
                    hex(right),
                    hex(E.exported(name)),
                    hex(P.exports[name]),
                )
            else:
                assert P.imports[right] == ("core.dll", name) and left == right + 4
            other[offset : offset + 4] = raw[offset : offset + 4]
            qualified.append(
                dict(
                    VA=hex(va),
                    kind=kind,
                    name=name,
                    owned=hex(left),
                    supplemental=hex(right),
                )
            )
        # The one relocated direct target is qualified by its whole 31-byte body,
        # including all three returns, before changing that displacement for comparison.
        if label == "EmptyModel fixed zone tail":
            call = 0x105EE661
            off = call - a
            leftTarget = call + 5 + struct.unpack_from("<i", raw, off + 1)[0]
            rightTarget = call + delta + 5 + struct.unpack_from("<i", other, off + 1)[0]
            assert leftTarget == 0x107A8250 and rightTarget == 0x107A8210
            helper = read(0x107A8250, 0x107A826F)
            assert helper == P.read(rightTarget, len(helper))
            E.dis.detail = True
            hi = list(E.dis.disasm(helper, leftTarget))
            assert (
                hi[-1].address + hi[-1].size == 0x107A826F and hi[-1].mnemonic == "ret"
            )
            # No memory operand and no write to preserved ESI/EDI anywhere in this helper.
            assert all("[" not in i.op_str for i in hi)
            assert all(
                not ({i.reg_name(r) for r in i.regs_access()[1]} & {"esi", "edi"})
                for i in hi
            )
            struct.pack_into("<i", other, off + 1, leftTarget - (call + delta + 5))
            qualified.append(
                dict(
                    VA=hex(call),
                    kind="relocated-direct-body",
                    owned=hex(leftTarget),
                    supplemental=hex(rightTarget),
                    bytes=len(helper),
                    bodySHA256=sha(helper),
                )
            )
        instructions = list(E.dis.disasm(raw, a))
        sites = []
        direct = []
        skip = 0
        assert instructions[-1].address + instructions[-1].size == b
        for i in instructions:
            if i.mnemonic == "call" and bytes(i.bytes)[:1] == b"\xe8":
                direct.append(i.address - a)
            if i.address >= skip and read(i.address, i.address + 6) == b"\x90" * 6:
                symbol = ("core.dll", expected_imports[i.address])
                assert P.imported_call(i.address + delta) == symbol
                sites.append((i.address - a, symbol))
                skip = i.address + 6
        result = compare_call_block(
            raw,
            bytes(other),
            owned_va=a,
            candidate_va=a + delta,
            sites=sites,
            direct_calls=direct,
            imports=P.imports,
        )
        blocks.append(
            dict(
                label=label,
                start=hex(a),
                end=hex(b),
                ownedSHA256=sha(raw),
                qualifiedOperands=qualified,
                **result,
            )
        )
    core_blocks = []
    for a, b, name in [
        (0x1010F640, 0x1010F65A, "?TransformPointBy@FVector@@QBE?AV1@ABVFCoords@@@Z"),
        (0x1010F510, 0x1010F584, None),
        (0x1010CA60, 0x1010CA81, "?SizeSquared@FVector@@QBEMXZ"),
        (0x101091C0, 0x101091DB, "?Empty@FArray@@QAEXHH@Z"),
        (0x101090C0, 0x101090F8, "?Add@FArray@@QAEHHH@Z"),
        (0x10109200, 0x10109205, "??0FArray@@QAE@W4ENoInit@@@Z"),
        (0x101522E0, 0x10152346, "?Realloc@FArray@@IAEXH@Z"),
    ]:
        if name:
            assert C.exported(name, True) == a
            if SC:
                assert SC.body(name) == a
        raw = bytes(C.data[C.offset(a) : C.offset(b)])
        if SC:
            assert raw == SC.read(a, b - a)
        rows = list(C.dis.disasm(raw, a))
        assert rows[-1].address + rows[-1].size == b and rows[-1].mnemonic == "ret"
        core_blocks.append(
            dict(
                start=hex(a),
                end=hex(b),
                bytes=len(raw),
                SHA256=sha(raw),
                status="exact-identical-owned-and-supplemental" if SC else "owned-only",
            )
        )
    core_array_checks = [
        (0x101091C9, "mov", "dword ptr [ecx + 4], 0"),
        (0x101091D0, "mov", "dword ptr [ecx + 8], eax"),
        (0x101090C6, "mov", "edi, dword ptr [ecx + 4]"),
        (0x101090CF, "mov", "dword ptr [ecx + 4], esi"),
        (0x101090F1, "mov", "eax, edi"),
        (0x101031D9, "jmp", "0x101522e0"),
        (0x1015232A, "mov", "dword ptr [esi], eax"),
    ]
    for a, op, args in core_array_checks:
        C.instruction(a, op, args)
    assert struct.unpack("<f", read(0x1089139C, 0x108913A0))[0] == 5.0
    assert struct.unpack("<f", read(0x108EB380, 0x108EB384))[0] == 32767.0
    # Exact field-chain name/offset join, with source Bool Link doubling rule reused.
    pkg, _ = load_package(ROOT / "assets/interlude/system/Engine.u")
    owner = next(
        e
        for e in pkg.exports
        if pkg.class_name_of(e) == "Class" and pkg.export_name(e) == "ZoneInfo"
    )
    names = [
        "SkyZone",
        "ZoneTag",
        "LocationName",
        "KillZ",
        "KillZType",
        "bSoftKillZ",
        "bFogZone",
        "bTerrainZone",
        "bDistanceFog",
        "bClearToFogColor",
        "Terrains",
        "AmbientVector",
    ]
    fields = []
    for i, name in enumerate(names):
        ex = next(
            e
            for e in pkg.exports
            if e.package_index == owner.index + 1
            and pkg.export_name(e) == name
            and pkg.class_name_of(e).endswith("Property")
        )
        raw = bytes(pkg.data[ex.serial_offset : ex.serial_offset + ex.serial_size])
        r = Reader(raw)
        assert pkg.name(r.compact()) == "None" and r.compact() == 0
        nxt = r.compact()
        dim = r.u32()
        flags = r.u32()
        assert dim == 1
        fields.append(
            dict(
                name=name,
                kind=pkg.class_name_of(ex),
                flags=flags,
                exportIndex=ex.index + 1,
                next=nxt,
                SHA256=sha(raw),
            )
        )
        if i:
            assert fields[i - 1]["next"] == ex.index + 1
    assert [x["kind"] for x in fields[5:10]] == ["BoolProperty"] * 5
    assert fields[10]["kind"] == "ArrayProperty"
    assert all(
        not (x["flags"] & (0x4000 | 0x8000)) for x in fields[5:10]
    )  # no Config/Localized
    reused = verify_actor_defaults_and_trace(E)
    from check_bsp_region_native import serialized_binding

    serialization = serialized_binding(E, P)

    return {
        "status": "PASS",
        "ownedEngineSHA256": E.sha,
        "ownedCoreSHA256": C.sha,
        "supplementalEngineSHA256": P.sha if P else None,
        "supplementalCoreSHA256": SC.sha if SC else None,
        "namedBodies": {k: hex(v) for k, v in methods.items()},
        "anchors": checks,
        "coreArrayAnchors": len(core_array_checks),
        "completeOwnedRanges": complete_owned,
        "comparisons": blocks,
        "coreComparisons": core_blocks,
        "zoneFields": fields,
        "reusedCDOAndBoolLinkProof": reused,
        "reusedSerializedRegionBinding": serialization,
        "scope": "Saved source and conditional normal-construction/build-render reconstruction only.",
        "limits": [
            "Normal constructor return only; copied/reused/custom models excluded.",
            "Fixed actor pointer nulls only; other ZoneProperty bytes are not assumed zero.",
            "BuildRenderData call bound; actual load timing, later mutations and live actor state remain separate.",
            "SetZone(1,0) suppresses this method script callbacks but still calls GetPhysicsVolume.",
            "Supplemental archive is unauthenticated; exact finite-block correspondences do not restore owned imports.",
            "Owned-only mode retains erased-call identity limits.",
        ],
    }


def postload_location(engine, core, root, tile):
    from l2lib import load_package

    # Reuse the existing finite terrain evaluator, not a second native machine.
    from check_terrain_collision_native import TerrainEvaluator, Arithmetic, put, vec
    from check_bsp_camera_native import run_sweep_slice
    from export_terrain_collision import parse_terrain_prefix

    pkg, _ = load_package(root / "assets/interlude/maps" / f"{tile}.unr")
    ex = [e for e in pkg.exports if pkg.class_name_of(e) == "TerrainInfo"]
    assert len(ex) == 1
    info = parse_terrain_prefix(pkg, ex[0])
    assert (info["width"], info["height"]) == (256, 256)
    loc = next(p for p in info["properties"] if p["name"] == "Location")
    location = list(struct.unpack("<3f", loc["raw"]))
    actor, frame, sp = 0x100000, 0x200000, 0x300000
    # Positive dimensions 256 follow the separately pinned cdq/sub/sar path.
    # 128 is the exact integer result and exact subsequent Float32 fild/fstp.
    m = Arithmetic(
        engine,
        {frame - 0x1C: 128.0, frame - 0x14: 128.0},
        [],
        dict(ebx=actor, ebp=frame, esp=sp, eax=0, ecx=0, edx=0, esi=0, edi=0),
    )
    put(m, actor + 0x1BC, location)
    m.memory.update({actor + 0x212C + 4 * i: v for i, v in enumerate(info["forward"])})
    run_sweep_slice(engine, m, 0x1072DF28, 0x1072DF4B)
    assert m.registers["ecx"] == frame - 0x58
    assert (
        m.memory[m.registers["esp"]] == frame - 0x4C
        and m.memory[m.registers["esp"] + 4] == actor + 0x212C
    )
    ev = TerrainEvaluator(engine, core)
    m.registers["esp"] -= 4
    m.memory[m.registers["esp"]] = 0xDEAD
    ev.run(m, 0x1010F640, 0x1010F65A, core)
    assert m.registers["esp"] == sp
    point = vec(m, frame - 0x4C)
    run_sweep_slice(engine, m, 0x1072DF51, 0x1072DF8A)
    assert m.registers["ecx"] == frame - 0x64
    difference = vec(m, frame - 0x64)
    m.registers["esp"] -= 4
    m.memory[m.registers["esp"]] = 0xDEAD
    ev.run(m, 0x1010CA60, 0x1010CA81, core)
    assert m.registers["esp"] == sp and len(m.stack) == 1
    metric = m.stack[0]
    stop = run_sweep_slice(
        engine, m, 0x1072DF90, 0x1072DF9D, stop=(0x1072DF9D, 0x1072E003)
    )
    assert stop == 0x1072E003 and metric <= 5 and vec(m, actor + 0x1BC) == location
    return dict(
        tile=tile,
        serializedLocation=location,
        transformedCenter=point,
        storedDifference=difference,
        storedSizeSquared=metric,
        threshold=5.0,
        branch="skip-location-assignment",
        coreInstructions=len(ev.visited),
        engineInstructions=len({pc for pc in m.trace if pc >= engine.base}),
        scope="Actual saved finite inputs through retained TransformPointBy/SizeSquared and comparison instructions; Python binary64 approximates x87; no live terrain state.",
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--comparison-engine", type=Path)
    parser.add_argument("--comparison-core", type=Path)
    parser.add_argument("--tile", nargs="*", default=[])
    args = parser.parse_args(argv)
    report = verify(args.comparison_engine, args.comparison_core)
    if args.tile:
        if not args.comparison_engine:
            raise ValueError(
                "source reconstruction requires explicit paired supplemental paths"
            )
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "world"))
        from export_terrain_zones import collect

        report["sourceReconstructions"] = [
            collect(
                tile,
                normal_build=True,
                comparison_engine=args.comparison_engine,
                comparison_core=args.comparison_core,
            )["normalBuildReconstruction"]
            for tile in args.tile
        ]
    if args.check:
        print(
            json.dumps(
                {
                    "status": "PASS",
                    "engineAnchors": len(report["anchors"]),
                    "coreArrayAnchors": report["coreArrayAnchors"],
                    "engineBlocks": len(report["comparisons"]),
                    "coreRanges": len(report["coreComparisons"]),
                    "comparisonQualified": bool(args.comparison_engine),
                    "sourceMaps": len(args.tile),
                }
            )
        )
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
