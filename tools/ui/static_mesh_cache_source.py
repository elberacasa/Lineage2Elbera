"""Elbera Tools: pinned static-mesh cache/key/lifetime instruction program.

Reuses the mesh/triangle/preparation program. Native memory-cache operations
and owner matrix methods remain explicit responses, not inferred live state.
Original bytes stay in memory and no files are read at module import.
"""

import hashlib
import struct

from check_hair_attachment_native import compare_call_block
from static_mesh_source import MeshProgram

GET_INDEX = "?GetCacheIndex@UObject@@QBEKXZ"
MATRIX_DTOR = "??1FMatrix@@QAE@XZ"
DETERMINANT = "?Determinant@FMatrix@@QBEMXZ"
GET = "?Get@FMemCache@@QAEPAE_KAAPAVFCacheItem@1@H@Z"
CREATE = "?Create@FMemCache@@QAEPAE_KAAPAVFCacheItem@1@HHH@Z"
UNLOCK = "?Unlock@FCacheItem@FMemCache@@QAEXXZ"
FLUSH = "?Flush@FMemCache@@QAEX_KKH@Z"
GCACHE = "?GCache@@3VFMemCache@@A"
IMPORTS = {
    0x106FE16F: MATRIX_DTOR,
    0x106FE1A8: MATRIX_DTOR,
    0x106FE1B0: DETERMINANT,
    0x106FEADA: GET_INDEX,
    0x106FEAEE: GET_INDEX,
    0x106FEF22: GET,
    0x106FEF41: UNLOCK,
    0x106FEF55: FLUSH,
    0x106FEF96: CREATE,
    0x106FE894: UNLOCK,
}
STATISTICS_GAPS = {
    0x106FEF62: 0x106FEF71,
    0x106FEFB2: 0x106FEFD7,
    0x106FEFC8: 0x106FEFD7,
}


class CacheProgram(MeshProgram):
    def __init__(self, engine, core, comparison_engine, comparison_core):
        super().__init__(engine, core, comparison_engine, comparison_core)
        mesh_receipt = self.receipt
        engine_blocks, core_blocks, joins = [], [], []
        for name, start, end in [
            ("fresh cache constructor normal body", 0x106FEB51, 0x106FEC0F),
            ("allocation size", 0x106FED90, 0x106FEDAC),
            ("reused cache update gate", 0x106FEFBA, 0x106FEFC8),
            ("query tag increment", 0x106FEFD7, 0x106FEFE1),
            ("matrix update normal body", 0x106FE138, 0x106FE1CF),
            ("base lookup and identity mismatch", 0x106FEEB1, 0x106FEF62),
            ("base cache creation", 0x106FEF71, 0x106FEFB2),
            ("cache key complete body", 0x106FEAD0, 0x106FEB18),
            ("wide product complete body", 0x107A6660, 0x107A6694),
            ("query destructor normal body", 0x106FE889, 0x106FE8A9),
        ]:
            raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
            candidate = bytearray(comparison_engine.read(start - 0x40, end - start))
            normalized = []
            for at in [0x106FEF1D, 0x106FEF50, 0x106FEF91]:
                if start <= at < end:
                    offset = at - start
                    owned, other = (
                        engine.exported(GCACHE),
                        comparison_engine.exports[GCACHE],
                    )
                    assert (owned, other) == (0x10B222F0, 0x10B222E0)
                    assert raw[offset : offset + 5] == b"\xb9" + struct.pack(
                        "<I", owned
                    )
                    assert candidate[offset : offset + 5] == b"\xb9" + struct.pack(
                        "<I", other
                    )
                    candidate[offset + 1 : offset + 5] = struct.pack("<I", owned)
                    normalized.append(
                        dict(
                            address=hex(at),
                            symbol=GCACHE,
                            owned=hex(owned),
                            comparison=hex(other),
                        )
                    )
            if start == 0x106FEAD0:
                at = 0x106FEB08
                offset = at - start
                assert raw[offset] == candidate[offset] == 0xE8
                assert (
                    at + 5 + struct.unpack_from("<i", raw, offset + 1)[0] == 0x107A6660
                )
                assert (
                    at - 0x40 + 5 + struct.unpack_from("<i", candidate, offset + 1)[0]
                    == 0x107A6620
                )
                candidate[offset + 1 : offset + 5] = struct.pack(
                    "<i", 0x107A6660 - (at - 0x40 + 5)
                )
                normalized.append(
                    dict(
                        address=hex(at),
                        ownedTarget="0x107a6660",
                        comparisonTarget="0x107a6620",
                        basis="complete identical wide-product body",
                    )
                )
            rows = list(engine.dis.disasm(raw, start))
            comparison = compare_call_block(
                raw,
                bytes(candidate),
                owned_va=start,
                candidate_va=start - 0x40,
                sites=[
                    (at - start, ("core.dll", symbol))
                    for at, symbol in IMPORTS.items()
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
                    name=name,
                    **self.add(engine, start, end, raw),
                    comparison=comparison,
                    normalizedOperands=normalized
                )
            )
        for symbol, start, end in [
            (GET_INDEX, 0x1010A1C0, 0x1010A1C4),
            (MATRIX_DTOR, 0x101111E0, 0x101111E1),
            (DETERMINANT, 0x10111BB0, 0x10111C76),
        ]:
            assert core.exported(symbol, True) == comparison_core.body(symbol) == start
            raw = bytes(core.data[core.offset(start) : core.offset(end)])
            assert raw == comparison_core.read(start, end - start)
            core_blocks.append(dict(symbol=symbol, **self.add(core, start, end, raw)))
            for at, name in IMPORTS.items():
                if name == symbol:
                    self.import_targets[at] = start
        for at, target in [
            (0x1030E390, 0x106FE120),
            (0x1030DF58, 0x106FEAD0),
            (0x10302D47, 0x106FED90),
            (0x10313101, 0x106FEB30),
            (0x1030EEDA, 0x106FE8C0),
            (0x10314E6B, 0x106FE870),
        ]:
            engine.instruction(at, "jmp", hex(target))
            other = next(engine.dis.disasm(comparison_engine.read(at, 5), at))
            assert other.mnemonic == "jmp" and int(other.op_str, 16) == target - 0x40
            joins.append(
                dict(
                    address=hex(at),
                    target=hex(target),
                    comparisonTarget=hex(target - 0x40),
                )
            )
        name = "?GetNumCollisionTriangles@UStaticMesh@@QAEHXZ"
        assert engine.exported(name, True) == 0x106FE8C0
        assert comparison_engine.body(name) == 0x106FE880
        engine.instruction(0x1070351C, "call", "0x10314e6b")
        joins.append(
            dict(
                address="0x1070351c",
                target="0x10314e6b",
                scope="query destructor precedes post-hit slice",
            )
        )
        at = 0x108A4C30
        raw = bytes(engine.data[engine.offset(at) : engine.offset(at) + 4])
        assert raw == comparison_engine.read(at, 4)
        self.constants[at] = struct.unpack("<f", raw)[0]
        self.receipt = dict(
            mesh=mesh_receipt,
            engineBlocks=engine_blocks,
            coreBlocks=core_blocks,
            joins=joins,
            constants=[
                dict(
                    address=hex(at),
                    kind="f",
                    value=self.constants[at],
                    SHA256=hashlib.sha256(raw).hexdigest(),
                    meaning="base query +0x3c initial scalar; not assigned an inferred role",
                )
            ],
            excludedStatisticsGaps=[
                dict(start=hex(a), continueAt=hex(b))
                for a, b in STATISTICS_GAPS.items()
            ],
            suppliedBoundaries=[
                "memory-cache Get/Create/Unlock/Flush responses",
                "stable triangle count",
                "owner matrix method results",
                "normal SEH frame setup",
                "published mesh arithmetic boundaries",
            ],
        )
