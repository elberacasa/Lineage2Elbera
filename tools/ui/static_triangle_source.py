"""Elbera Tools: pinned original triangle/cache/helper instruction program.

This qualifies bounded blocks and named joins, not the full native mesh cache,
CRT, live FPU state or collision tree. Original bytes stay in memory.
"""

import hashlib
import struct

from check_tutorial_quest_native import ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA, CANDIDATE_CORE_SHA
from check_hair_attachment_native import compare_call_block
from check_static_sweep_native import PreparationProgram

PLANE_CTOR = "??0FPlane@@QAE@VFVector@@00@Z"
PLANE_FLIP = "?Flip@FPlane@@QBE?AV1@XZ"
BOX_CTOR = "??0FBox@@QAE@H@Z"
BOX_ADD = "??YFBox@@QAEAAV0@ABVFVector@@@Z"
SAFE_NORMAL = "?SafeNormal@FVector@@QBE?AV1@XZ"
UNSAFE_NORMAL = "?UnsafeNormal@FVector@@QBE?AV1@XZ"
SQRT = "?appSqrt@@YANN@Z"
TRIANGLE_GETTER = (
    "?GetCollisionTriangle@UStaticMesh@@QAEPAUFStaticMeshCollisionTriangle@@H@Z"
)

IMPORTS = {
    0x106FFE84: UNSAFE_NORMAL,
    0x10701F08: PLANE_CTOR,
    0x10701F3E: PLANE_FLIP,
    0x1070222C: BOX_CTOR,
    0x1070223E: BOX_ADD,
    0x10702250: BOX_ADD,
    0x10702262: BOX_ADD,
    0x107022B8: PLANE_FLIP,
}
DIRECT = {
    0x1030AA38: 0x106FF1C0,
    0x10306C8A: 0x106FFCB0,
    0x1030FF6F: 0x106FFE30,
    0x101029A0: 0x1014E070,
}
SQRT_SITES = {0x1010CCD2, 0x1014E0BC}
LOOKUP_START, LOOKUP_END = 0x106FF716, 0x106FF71E
TRIANGLE_START, TRIANGLE_TAIL, TRIANGLE_END = 0x10701C30, 0x10702223, 0x107025B5
SCRATCH_START, SCRATCH_END = 0x106FE2C0, 0x106FE33D


class TriangleProgram:
    add = PreparationProgram.add

    def __init__(self, engine, core, comparison_engine, comparison_core):
        assert (engine.sha, core.sha, comparison_engine.sha, comparison_core.sha) == (
            ENGINE_SHA,
            CORE_SHA,
            CANDIDATE_ENGINE_SHA,
            CANDIDATE_CORE_SHA,
        )
        self.engine, self.rows, self.constants, self.import_targets = engine, [], {}, {}
        engine_blocks, core_blocks, constants, joins = [], [], [], []
        for label, start, end in [
            ("scratch constructor", SCRATCH_START, SCRATCH_END),
            ("plane interval", 0x106FF1C0, 0x106FF30D),
            ("box planes", 0x106FFCB0, 0x106FFDDC),
            ("edge plane", 0x106FFE30, 0x106FFF37),
            ("loaded triangle pointer", LOOKUP_START, LOOKUP_END),
            ("world triangle preparation", TRIANGLE_START, TRIANGLE_TAIL),
            ("triangle clipping", TRIANGLE_TAIL, TRIANGLE_END),
        ]:
            raw = bytes(engine.data[engine.offset(start) : engine.offset(end)])
            block = self.add(engine, start, end, raw)
            rows = list(engine.dis.disasm(raw, start))
            comparison = compare_call_block(
                raw,
                comparison_engine.read(start - 0x40, end - start),
                owned_va=start,
                candidate_va=start - 0x40,
                sites=[
                    (at - start, ("core.dll", name))
                    for at, name in IMPORTS.items()
                    if start <= at < end
                ],
                direct_calls=[i.address - start for i in rows if i.mnemonic == "call"],
                imports=comparison_engine.imports,
            )
            engine_blocks.append(dict(name=label, **block, comparison=comparison))
        for name, start, end in [
            (UNSAFE_NORMAL, 0x1010CCB0, 0x1010CD07),
            (SAFE_NORMAL, 0x1014E070, 0x1014E0F9),
            (PLANE_CTOR, 0x1010D560, 0x1010D6E4),
            (PLANE_FLIP, 0x1010D780, 0x1010D7A5),
            (BOX_CTOR, 0x101177A0, 0x101177DB),
            (BOX_ADD, 0x101177F0, 0x10117954),
        ]:
            assert core.exported(name, True) == comparison_core.body(name) == start
            raw = bytes(core.data[core.offset(start) : core.offset(end)])
            assert raw == comparison_core.read(start, end - start)
            core_blocks.append(dict(symbol=name, **self.add(core, start, end, raw)))
            for at, symbol in IMPORTS.items():
                if symbol == name:
                    self.import_targets[at] = start
        assert core.exported(SQRT) == comparison_core.exports[SQRT] == 0x10104840
        assert (
            core.exported(SAFE_NORMAL)
            == comparison_core.exports[SAFE_NORMAL]
            == 0x101029A0
        )
        assert engine.exported(TRIANGLE_GETTER, True) == 0x106FF650
        # Full-source hashes pin every join; Engine thunks are at shared VAs,
        # whereas the independently compared Engine bodies are 0x40 earlier.
        for image, at, mnemonic, operand in [
            *[
                (engine if at >= 0x10300000 else core, at, "jmp", hex(target))
                for at, target in DIRECT.items()
            ],
            (core, 0x10104840, "jmp", "0x1012d790"),
            (core, 0x1010D635, "call", "0x101029a0"),
            (core, 0x1010D6BB, "call", "0x101029a0"),
            *[(core, at, "call", "0x10104840") for at in sorted(SQRT_SITES)],
            (engine, 0x10304F43, "jmp", "0x106ff650"),
            (engine, 0x10701C60, "call", "0x10304f43"),
            (engine, 0x10307608, "jmp", "0x106fe2c0"),
            (engine, 0x10702F83, "call", "0x10307608"),
        ]:
            image.instruction(at, mnemonic, operand)
            joins.append(dict(address=hex(at), mnemonic=mnemonic, operand=operand))
        for image, comparison, at, kind, expected in [
            (engine, comparison_engine, 0x108E91B8, "d", 9.999999747378752e-6),
            (engine, comparison_engine, 0x108E91A8, "d", -9.999999747378752e-6),
            (engine, comparison_engine, 0x10854358, "f", -1.0),
            (engine, comparison_engine, 0x1085222C, "f", 0.0),
            (engine, comparison_engine, 0x108A0660, "d", -1.0),
            (core, comparison_core, 0x101CDF50, "d", 1e-8),
        ]:
            size = struct.calcsize(kind)
            raw = bytes(image.data[image.offset(at) : image.offset(at) + size])
            assert raw == comparison.read(at, size)
            value = struct.unpack("<" + kind, raw)[0]
            assert value == expected
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
            ownedEngineSHA256=engine.sha,
            ownedCoreSHA256=core.sha,
            supplementalEngineSHA256=comparison_engine.sha,
            supplementalCoreSHA256=comparison_core.sha,
            engineBlocks=engine_blocks,
            coreBlocks=core_blocks,
            constants=constants,
            joins=joins,
        )
