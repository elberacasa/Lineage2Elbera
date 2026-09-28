"""Elbera Tools: pinned original static mesh tree and hit instruction program.

Qualifies the ordinary nonzero wrapper, but interprets only its supplied-state
preparation/tree/final-hit stages. Paging, method implementations, exceptions
and alternate primitive delegation remain explicit boundaries.
"""

import hashlib
import struct

from check_hair_attachment_native import compare_call_block
from check_static_sweep_native import PreparationProgram
from static_triangle_source import TriangleProgram

TREE_START, TREE_END = 0x10702CC0, 0x1070315D
HIT_START, HIT_END = 0x10703529, 0x10703685
NODE_START, NODE_END = 0x106FF8C6, 0x106FF8CE
BOUNDS_START = 0x106FFF9B
SIZE, NORMALIZE = "?Size@FVector@@QBEMXZ", "?Normalize@FVector@@QAEHXZ"
EQUAL = "??8FVector@@QBEHABV0@@Z"
ASSERT = "?appFailAssert@@YAXPBD0H@Z"
DEFAULT = "?GetDefaultObject@UClass@@QAEPAVUObject@@XZ"
MATERIAL_CLASS = "?PrivateStaticClass@UMaterial@@0VUClass@@A"
LINE_CHECK = "?LineCheck@UStaticMesh@@UAEHAAUFCheckResult@@PAVAActor@@VFVector@@22KK@Z"
IMPORTS = {
    0x10702D0C: ASSERT,
    0x10703012: DEFAULT,
    0x10703326: EQUAL,
    0x107035A5: SIZE,
    0x107035BC: SIZE,
    0x1070367F: NORMALIZE,
}
HIT_SQRT_SITES = {0x1010CA3F, 0x1010CB57}


class MeshProgram:
    add = PreparationProgram.add

    def __init__(self, engine, core, comparison_engine, comparison_core):
        # The reused programs check all four complete source fingerprints.
        self.triangle = TriangleProgram(
            engine, core, comparison_engine, comparison_core
        )
        self.sweep = PreparationProgram(
            engine, core, comparison_engine, comparison_core
        )
        self.engine, self.rows = engine, list(self.triangle.rows)
        self.constants = dict(self.triangle.constants)
        self.import_targets = dict(self.triangle.import_targets)
        engine_blocks, core_blocks, constants, joins = [], [], [], []
        for label, start, end, shift in [
            ("bounds after normal SEH setup", BOUNDS_START, 0x10700233, -0x40),
            ("plane pushout", 0x105E9990, 0x105E99D9, -0x40),
            ("float maximum", 0x104A4940, 0x104A4967, 0),
            ("loaded node pointer", NODE_START, NODE_END, -0x40),
            ("cached node count return", 0x106FEA10, 0x106FEA27, -0x40),
            ("tree after normal SEH setup", TREE_START, TREE_END, -0x40),
            ("ordinary mesh wrapper and final hit", 0x10703314, HIT_END, -0x40),
            ("float clamp", 0x103704B0, 0x103704E6, 0),
        ]:
            raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
            candidate = bytearray(comparison_engine.read(start + shift, end - start))
            normalized_symbols = []
            if start == TREE_START:
                owned, other = (
                    engine.exported(MATERIAL_CLASS),
                    comparison_engine.exports[MATERIAL_CLASS],
                )
                assert (owned, other) == (0x10C6B258, 0x10C6B268)
                offset = 0x1070300D - start
                assert raw[offset : offset + 5] == b"\xb9" + struct.pack("<I", owned)
                assert candidate[offset : offset + 5] == b"\xb9" + struct.pack(
                    "<I", other
                )
                candidate[offset + 1 : offset + 5] = struct.pack("<I", owned)
                normalized_symbols.append(
                    dict(
                        address=hex(start + offset),
                        symbol=MATERIAL_CLASS,
                        owned=hex(owned),
                        comparison=hex(other),
                    )
                )
            rows = list(engine.dis.disasm(raw, start))
            comparison = compare_call_block(
                raw,
                bytes(candidate),
                owned_va=start,
                candidate_va=start + shift,
                sites=[
                    (at - start, ("core.dll", name))
                    for at, name in IMPORTS.items()
                    if start <= at < end
                ],
                direct_calls=[
                    i.address - start
                    for i in rows
                    if i.mnemonic == "call" and bytes(i.bytes)[:1] == b"\xe8"
                ],
                imports=comparison_engine.imports,
            )
            engine_blocks.append(
                dict(
                    name=label,
                    **self.add(engine, start, end, raw),
                    comparison=comparison,
                    normalizedSymbols=normalized_symbols
                )
            )
        for name, start, end in [
            (EQUAL, 0x1010C740, 0x1010C77C),
            (SIZE, 0x1010CA20, 0x1010CA50),
            (NORMALIZE, 0x1010CB20, 0x1010CB92),
        ]:
            assert core.exported(name, True) == comparison_core.body(name) == start
            raw = bytes(core.data[core.offset(start) : core.offset(end)])
            assert raw == comparison_core.read(start, end - start)
            core_blocks.append(dict(symbol=name, **self.add(core, start, end, raw)))
            for at, symbol in IMPORTS.items():
                if symbol == name:
                    self.import_targets[at] = start
        assert engine.exported(LINE_CHECK, True) == 0x107032D0
        assert comparison_engine.body(LINE_CHECK) == 0x10703290
        assert engine.u32(
            engine.exported("??_7UStaticMesh@@6B@") + 0x6C
        ) == engine.exported(LINE_CHECK)
        assert (
            engine.exported("?GetNumCollisionNodes@UStaticMesh@@QAEHXZ", True)
            == 0x106FE9B0
        )
        for at, target, shift in [
            (0x103116F8, 0x106FFF80, -0x40),
            (0x10304F0C, 0x105E9990, -0x40),
            (0x10305ED9, 0x104A4940, 0),
            (0x1030AB96, 0x10702CA0, -0x40),
            (0x10305D76, 0x106FF800, -0x40),
            (0x10306C99, 0x10701C30, -0x40),
            (0x1030F781, 0x106FE9B0, -0x40),
            (0x10307743, 0x103704B0, 0),
        ]:
            engine.instruction(at, "jmp", hex(target))
            other = next(engine.dis.disasm(comparison_engine.read(at, 5), at))
            assert other.mnemonic == "jmp" and int(other.op_str, 16) == target + shift
            joins.append(
                dict(
                    address=hex(at),
                    target=hex(target),
                    comparisonTarget=hex(target + shift),
                )
            )
        for at in sorted(HIT_SQRT_SITES):
            core.instruction(at, "call", "0x10104840")
            joins.append(dict(address=hex(at), target="0x10104840"))
        for at, kind in [(0x108A01B0, "d"), (0x1089DF54, "f")]:
            size = struct.calcsize(kind)
            raw = bytes(engine.data[engine.offset(at) : engine.offset(at) + size])
            assert raw == comparison_engine.read(at, size)
            value = struct.unpack("<" + kind, raw)[0]
            assert value == 0.10000000149011612
            self.constants[at] = value
            constants.append(
                dict(
                    address=hex(at),
                    kind=kind,
                    value=value,
                    SHA256=hashlib.sha256(raw).hexdigest(),
                )
            )
        self.receipt = dict(
            triangle=self.triangle.receipt,
            preparation=self.sweep.receipt,
            engineBlocks=engine_blocks,
            coreBlocks=core_blocks,
            constants=constants,
            joins=joins,
            interpretedStages=[
                "supplied-cache query preparation",
                "normal tree body and helpers",
                "post-hit arithmetic",
            ],
            qualifiedOnly=[
                "wrapper admission and delegation",
                "cached node count return",
                "Core exact vector equality",
            ],
        )
