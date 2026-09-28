"""Elbera Tools: pinned GMath sine producer and static startup joins.

No native execution. Source ordering establishes conditional path admission;
it does not observe the startup CPU capabilities or floating-point state.
"""

import hashlib
import struct
from check_supplemental_engine import CORE_SHA, CANDIDATE_CORE_SHA


def qualify_gmath(core, comparison_core):
    assert (core.sha, comparison_core.sha) == (CORE_SHA, CANDIDATE_CORE_SHA)
    BLOCKS = [
        ("DLL entry normal dispatch", 0x1017FE60, 0x1017FE81),
        ("attach calls CRT before DllMain", 0x1017FD93, 0x1017FDD6),
        ("CRT attach calls initializers", 0x1017FC94, 0x1017FCAF),
        ("C and C++ initializer order", 0x10183394, 0x10183426),
        ("C initializer loop", 0x101831DF, 0x101831FF),
        ("SSE initialization", 0x1017FFEB, 0x1017FFFF),
        ("CPU probe", 0x101901ED, 0x1019024D),
        ("OS XMM probe", 0x1019019D, 0x101901ED),
        ("GMath static initializer", 0x101C0010, 0x101C001A),
        ("GMath constructor", 0x1014D330, 0x1014D535),
        ("appSin wrapper", 0x1012D720, 0x1012D729),
        ("sin SSE2 admission", 0x1017C430, 0x1017C47F),
        ("x87-to-SSE2 bridge", 0x10186480, 0x10186498),
        ("SSE2 sine finite kernel", 0x1018649E, 0x10186647),
    ]
    blocks = []
    for label, a, b in BLOCKS:
        raw = bytes(core.data[core.offset(a) : core.offset(b)])
        assert raw == comparison_core.read(a, b - a), label
        rows = list(core.dis.disasm(raw, a))
        assert rows[-1].address + rows[-1].size == b
        assert rows[0].address == a and all(
            x.address + x.size == y.address for x, y in zip(rows, rows[1:])
        )
        blocks.append(
            dict(
                label=label,
                range=[hex(a), hex(b)],
                bytes=b - a,
                instructions=len(rows),
                SHA256=hashlib.sha256(raw).hexdigest(),
            )
        )
    for name, a in [
        ("??0FGlobalMath@@QAE@XZ", 0x1014D330),
        ("?appSin@@YANN@Z", 0x1012D720),
    ]:
        assert core.exported(name, True) == a and comparison_core.body(name) == a
    for name, thunk in [
        ("??0FGlobalMath@@QAE@XZ", 0x10102333),
        ("?appSin@@YANN@Z", 0x101048FE),
    ]:
        assert core.exported(name) == comparison_core.exports[name] == thunk
    assert (
        core.exported("?GMath@@3VFGlobalMath@@A")
        == comparison_core.exports["?GMath@@3VFGlobalMath@@A"]
        == 0x1023FF48
    )
    for data in [core.data, comparison_core.data]:
        pe = struct.unpack_from("<I", data, 60)[0]
        assert 0x10100000 + struct.unpack_from("<I", data, pe + 40)[0] == 0x1017FE60
    assert core.u32(0x101CCAF4) == comparison_core.u32(0x101CCAF4) == 0x1017FFEB
    assert core.u32(0x101CC10C) == comparison_core.u32(0x101CC10C) == 0x101C0010
    anchors = [
        (0x101833BC, "push", "0x101ccc08"),
        (0x101833C1, "push", "0x101cc9ec"),
        (0x101833C6, "call", "0x101831df"),
        (0x101833DD, "mov", "esi, 0x101cc000"),
        (0x101833E4, "mov", "edi, 0x101cc8e8"),
        (0x101833F4, "call", "eax"),
        (0x1017FFF2, "call", "0x101901ed"),
        (0x1017FFF7, "mov", "dword ptr [0x1033fe24], eax"),
        (0x10190231, "test", "dword ptr [ebp - 4], 0x4000000"),
        (0x1019023A, "call", "0x1019019d"),
        (0x101901AD, "movapd", "xmm0, xmm1"),
        (0x101C0010, "mov", "ecx, 0x1023ff48"),
        (0x101C0015, "jmp", "0x10102333"),
        (0x1017C430, "cmp", "dword ptr [0x1033fe24], 0"),
        (0x1017C445, "and", "eax, 0x1f80"),
        (0x1017C44A, "cmp", "eax, 0x1f80"),
        (0x1017C458, "and", "ax, 0x7f"),
        (0x1017C45C, "cmp", "ax, 0x7f"),
        (0x1017C466, "jmp", "0x10186480"),
        (0x10186489, "fstp", "qword ptr [esp]"),
        (0x1018648C, "movq", "xmm0, qword ptr [esp]"),
        (0x10186491, "call", "0x1018649e"),
        (0x1014D4AE, "lea", "ebx, [esi + 0x8c]"),
        (0x1014D4C9, "fstp", "qword ptr [esp]"),
        (0x1014D4CC, "call", "0x101048fe"),
        (0x1014D4D4, "fstp", "dword ptr [ebx]"),
        (0x1014D4DC, "cmp", "edi, 0x4000"),
        (0x1014D4E6, "jl", "0x1014d4b4"),
    ]
    for row in anchors:
        core.instruction(*row)
    tables = []
    for label, a, b in [
        ("C initializers", 0x101CC9EC, 0x101CCC08),
        ("C++ initializers", 0x101CC000, 0x101CC8E8),
    ]:
        raw = bytes(core.data[core.offset(a) : core.offset(b)])
        assert raw == comparison_core.read(a, b - a), label
        tables.append(
            dict(
                label=label,
                range=[hex(a), hex(b)],
                SHA256=hashlib.sha256(raw).hexdigest(),
                nonzeroEntries=[
                    {"slot": hex(p), "function": hex(core.u32(p))}
                    for p in range(a, b, 4)
                    if core.u32(p)
                ],
            )
        )
    for a in [0x101D4558, 0x101D5E38]:
        assert bytes(
            core.data[core.offset(a) : core.offset(a) + 8]
        ) == comparison_core.read(a, 8)
    receipt = dict(
        status="PASS",
        ownedCoreSHA256=core.sha,
        supplementalCoreSHA256=comparison_core.sha,
        blocks=blocks,
        anchors=anchors,
        initializerTables=tables,
        profile={
            "cpu": "source CPUID EDX bit26 set",
            "os": "source XMM probe succeeds",
            "sinAdmission": "source feature DWORD nonzero and masked MXCSR/x87 exceptions",
            "rounding": "explicit round-to-nearest, ties-to-even",
            "precision": "explicit x87 significand precision53",
        },
        conclusions=[
            "C initializers, including SSE CPU/OS probing, precede the C++ GMath initializer on successful CRT attach.",
            "Named GMath constructor calls named appSin once per stored Float32 table entry, through the source admission guards.",
            "SSE2 evaluation uses literal source instructions and coefficient/table bytes, not a host sine replacement.",
        ],
        limits=[
            "Static source ordering does not capture actual machine CPU capabilities or incoming floating-point control state.",
            "RNE and PC53 remain explicit profile inputs, not an invented unconditional startup default.",
            "x87 FSIN fallback and other rounding/precision profiles remain unimplemented.",
            "No DLL is executed, native startup is not observed, and source correspondence does not authenticate the supplemental archive.",
        ],
    )
    return receipt
