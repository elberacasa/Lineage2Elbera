#!/usr/bin/env python3
"""Elbera Tools: static-mesh bounds and actor admission versus original code.

Pinned private images; finite PC53/RNE, explicit current transforms and auxiliary
bounds. Reuses the existing actor admission interpreter. Never executes a DLL.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct

from check_actor_octree_admission_native import (
    ROOT,
    Image,
    ENGINE_SHA,
    CORE_SHA,
    PEImage,
    CANDIDATE_ENGINE_SHA,
    CANDIDATE_CORE_SHA,
    source_program,
    qualify_bounds,
    qualify_membership,
    qualify_admission,
    f32,
    hexes,
    browser_outputs,
)
from actor_octree_admission_machine import AdmissionMachine, PartialWord
from actor_octree_machine import MembershipMachine, snapshot
from check_static_sweep_native import PreparationProgram, IDENTITY
from check_hair_attachment_native import compare_call_block
from static_mesh_class_source import (
    qualify_registration,
    loading_bits,
    static_actor_loading_bits,
)
from actor_transform_source import (
    qualify_static_actor_loading,
    qualify_actor_collision_fields,
    qualify_level_actor_population,
    qualify_level_collision_mode,
    qualify_level_actor_loading,
    qualify_actor_state_frames,
    qualify_actor_reference_loading,
    qualify_actor_transform_loading,
)
from static_collision_source import (
    qualify_static_postload,
    qualify_static_mesh_constructor,
    qualify_static_mesh_fresh_load,
    qualify_packed_property_tags,
)

METHOD = "?GetCollisionBoundingBox@UStaticMesh@@UBE?AVFBox@@PBVAActor@@@Z"
LOCAL = "?LocalToWorld@AActor@@UBE?AVFMatrix@@XZ"
IMPORTS = {
    0x106FE724: ("??0FBox@@QAE@XZ", 0x1010EF70),
    0x106FE777: ("?TransformBy@FBox@@QBE?AV1@ABVFMatrix@@@Z", 0x10117DD0),
    0x106FE794: ("??1FMatrix@@QAE@XZ", 0x101111E0),
    0x106FE7C0: ("??YFBox@@QAEAAV0@ABV0@@Z", 0x10117A00),
}


def qualify_model_bounds(program, candidate):
    """Bind brush selection and Model bounds to full ordinary method ranges.

    The Core transform/destructor bodies are qualified by the existing static
    bounds check. Owner LocalToWorld remains an explicit virtual response.
    """
    e = program.engine
    brush = "?GetPrimitive@ABrush@@UAEPAVUPrimitive@@XZ"
    model = "?GetCollisionBoundingBox@UModel@@UBE?AVFBox@@PBVAActor@@@Z"
    assert e.exported(brush, True) == candidate.body(brush) == 0x1052DFF0
    assert e.exported(model, True) == 0x10744EE0
    assert candidate.body(model) == 0x10744EA0
    blocks = []
    for start, end in [(0x1052DFF0, 0x1052E00E), (0x10744EE0, 0x10744F7C)]:
        raw = bytes(e.data[e.offset(start) : e.offset(end)])
        blocks.append(PreparationProgram.add(program, e, start, end, raw))
    assert bytes(e.data[e.offset(0x1052DFF0) : e.offset(0x1052E00E)]) == candidate.read(
        0x1052DFF0, 0x1E
    )
    start, end = 0x10744EF8, 0x10744F7C
    imports = {
        0x10744F34: ("?TransformBy@FBox@@QBE?AV1@ABVFMatrix@@@Z", 0x10117DD0),
        0x10744F60: ("??1FMatrix@@QAE@XZ", 0x101111E0),
    }
    comparison = compare_call_block(
        bytes(e.data[e.offset(start) : e.offset(end)]),
        candidate.read(start - 64, end - start),
        owned_va=start,
        candidate_va=start - 64,
        sites=[
            (at - start, ("core.dll", symbol)) for at, (symbol, _) in imports.items()
        ],
        direct_calls=[],
        imports=candidate.imports,
    )
    vtables = []
    for cls, slot, symbol in [
        *[
            (cls, 0x164, brush)
            for cls in (
                "ABrush",
                "AVolume",
                "ABlockingVolume",
                "APhysicsVolume",
                "AMusicVolume",
            )
        ],
        ("UModel", 0x78, model),
    ]:
        table = "??_7" + cls + "@@6B@"
        assert e.u32(e.exported(table) + slot) == e.exported(symbol)
        assert (
            candidate.u32(candidate.exports[table] + slot) == candidate.exports[symbol]
        )
        vtables.append(dict(table=table, slot=hex(slot), method=symbol))
    program.import_targets.update({at: target for at, (_, target) in imports.items()})
    program.membership_targets.update(
        {
            e.exported(brush): 0x1052DFF0,
            e.exported(model): 0x10744EE0,
        }
    )
    program.model_bounds_thunk = e.exported(model)
    return dict(
        blocks=blocks,
        normalComparison=comparison,
        vtables=vtables,
        limits=[
            "Model SEH prefix retained for ordinary stack effects; exception handlers are not executed.",
            "Current owner matrix is a supplied virtual response; construction, Model PostLoad and live membership remain separate.",
        ],
    )


def qualify(program, core, candidate, candidate_core):
    e = program.engine
    prior = program.receipt
    assert e.exported(METHOD, True) == 0x106FE700
    assert candidate.body(METHOD) == 0x106FE6C0
    assert e.exported(METHOD) == candidate.exports[METHOD]
    start, end = 0x106FE719, 0x106FE7DD
    raw = bytes(e.data[e.offset(start) : e.offset(end)])
    proof = compare_call_block(
        raw,
        candidate.read(start - 64, len(raw)),
        owned_va=start,
        candidate_va=start - 64,
        sites=[
            (at - start, ("core.dll", symbol)) for at, (symbol, _) in IMPORTS.items()
        ],
        direct_calls=[0x106FE745 - start],
        imports=candidate.imports,
    )
    full = bytes(e.data[e.offset(0x106FE700) : e.offset(end)])
    body = PreparationProgram.add(program, e, 0x106FE700, end, full)
    core_blocks = []
    for symbol, start, end in [
        ("??0FBox@@QAE@XZ", 0x1010EF70, 0x1010EF73),
        ("?TransformBy@FBox@@QBE?AV1@ABVFMatrix@@@Z", 0x10117DD0, 0x10117F26),
        ("??1FMatrix@@QAE@XZ", 0x101111E0, 0x101111E1),
        ("??YFBox@@QAEAAV0@ABV0@@Z", 0x10117A00, 0x10117B62),
        ("??YFBox@@QAEAAV0@ABVFVector@@@Z", 0x101177F0, 0x10117954),
    ]:
        assert core.exported(symbol, True) == candidate_core.body(symbol) == start
        raw = bytes(core.data[core.offset(start) : core.offset(end)])
        assert raw == candidate_core.read(start, len(raw))
        core_blocks.append(
            dict(
                symbol=symbol, **PreparationProgram.add(program, core, start, end, raw)
            )
        )
    program.import_targets.update({at: target for at, (_, target) in IMPORTS.items()})
    program.membership_targets[e.exported(METHOD)] = 0x106FE700
    program.membership_targets[0x10101866] = 0x101177F0
    assert core.exported("??YFBox@@QAEAAV0@ABVFVector@@@Z") == 0x10101866
    vtables = []
    for vt, slot, method in [
        ("??_7UStaticMesh@@6B@", 0x78, METHOD),
        ("??_7AActor@@6B@", 0x148, LOCAL),
        ("??_7AStaticMeshActor@@6B@", 0x148, LOCAL),
    ]:
        assert e.u32(e.exported(vt) + slot) == e.exported(method)
        assert candidate.u32(candidate.exports[vt] + slot) == candidate.exports[method]
        vtables.append(dict(table=vt, slot=hex(slot), method=method))
    for anchor in [
        (0x106FE715, "sub", "esp, 0x5c"),
        (0x106FE764, "call", "edx"),
        (0x106FE7BB, "call", "edx"),
        (0x106FE745, "call", "0x1030cea0"),
    ]:
        e.instruction(*anchor)
    program.static_bounds_thunk = e.exported(METHOD)
    program.local_thunk = e.exported(LOCAL)
    model_bounds = qualify_model_bounds(program, candidate)
    postload = qualify_static_postload(e, core, candidate, candidate_core)
    for image, blocks in [
        (e, postload["engineBlocks"]),
        (core, postload["coreBlocks"]),
    ]:
        for block in blocks:
            start, end = int(block["start"], 16), int(block["end"], 16)
            raw = bytes(image.data[image.offset(start) : image.offset(end)])
            PreparationProgram.add(program, image, start, end, raw)
    start, end = 0x106F5CC0, 0x106F5CE1
    postload["ordinaryFrame"] = PreparationProgram.add(
        program, e, start, end, bytes(e.data[e.offset(start) : e.offset(end)])
    )
    program.import_targets.update(
        {int(at, 16): int(row["target"], 16) for at, row in postload["imports"].items()}
    )
    constructor = qualify_static_mesh_constructor(e, core, candidate, candidate_core)
    for image, blocks in [
        (e, constructor["engineBlocks"]),
        (core, constructor["coreBlocks"]),
    ]:
        for block in blocks:
            start, end = int(block["start"], 16), int(block["end"], 16)
            PreparationProgram.add(
                program,
                image,
                start,
                end,
                bytes(image.data[image.offset(start) : image.offset(end)]),
            )
    program.import_targets.update(
        {
            int(at, 16): int(target, 16)
            for at, target in constructor["importTargets"].items()
        }
    )
    program.membership_targets.update(
        {
            int(at, 16): int(target, 16)
            for at, target in constructor["thunkTargets"].items()
        }
    )
    program.cache_id_global = int(constructor["cacheIdGlobal"], 16)
    loading = qualify_static_mesh_fresh_load(e, core, candidate, candidate_core)
    registration = qualify_registration(e, core, candidate, candidate_core)
    from l2lib import load_package

    engine_package = load_package(ROOT / "assets/interlude/system/Engine.u")[0]
    core_package = load_package(ROOT / "assets/interlude/system/Core.u")[0]
    class_loading = loading_bits(
        e,
        core,
        engine_package,
        core_package,
    )
    actor_class_loading = static_actor_loading_bits(
        e, core, engine_package, core_package
    )
    actor_state_frames = qualify_actor_state_frames(core, candidate_core)
    actor_reference_loading = qualify_actor_reference_loading(core, candidate_core)
    for block in actor_reference_loading["coreBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    program.membership_targets.update(
        {
            int(a, 16): int(b, 16)
            for a, b in actor_reference_loading["thunkTargets"].items()
        }
    )
    property_loading = qualify_packed_property_tags(core, candidate_core)
    for start, end in [(0x1010B6D0, 0x1010B717), (0x10131090, 0x10131137)]:
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    for block in loading["coreBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    postload_symbol = "?PostLoad@UStaticMesh@@UAEXXZ"
    postload_thunk = e.exported(postload_symbol)
    vt = e.exported("??_7UStaticMesh@@6B@")
    assert e.u32(vt + 0x24) == postload_thunk
    assert (
        candidate.u32(candidate.exports["??_7UStaticMesh@@6B@"] + 0x24)
        == candidate.exports[postload_symbol]
    )
    program.membership_targets[postload_thunk] = 0x106F5CC0
    actor_loading = qualify_static_actor_loading(e, core, candidate, candidate_core)
    actor_fields = qualify_actor_collision_fields(
        e, core, candidate, candidate_core, engine_package
    )
    transform_loading = qualify_actor_transform_loading(
        core,
        candidate_core,
        engine_package.path,
        ROOT / "assets/interlude/system/Core.u",
    )
    for block in transform_loading["coreBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program,
            core,
            start,
            end,
            bytes(core.data[core.offset(start) : core.offset(end)]),
        )
    program.membership_targets.update(
        {
            int(at, 16): int(target, 16)
            for at, target in transform_loading["thunkTargets"].items()
        }
    )
    level_mode = qualify_level_collision_mode(
        e, core, candidate, candidate_core, engine_package
    )
    for image, blocks in [
        (
            e,
            level_mode["engineBlocks"]
            + [level_mode["copyBlock"]]
            + level_mode["startup"],
        ),
        (core, level_mode["coreBlocks"]),
    ]:
        for block in blocks:
            start, end = int(block["start"], 16), int(block["end"], 16)
            PreparationProgram.add(
                program,
                image,
                start,
                end,
                bytes(image.data[image.offset(start) : image.offset(end)]),
            )
    program.import_targets.update(
        {int(a, 16): int(b, 16) for a, b in level_mode["importTargets"].items()}
    )
    program.membership_targets.update(
        {int(a, 16): int(b, 16) for a, b in level_mode["thunkTargets"].items()}
    )
    level_population = qualify_level_actor_population(e, candidate)
    level_loading = qualify_level_actor_loading(e, core, candidate, candidate_core)
    for image, blocks in [
        (e, level_loading["engineBlocks"]),
        (core, level_loading["coreBlocks"]),
    ]:
        for block in blocks:
            start, end = int(block["start"], 16), int(block["end"], 16)
            PreparationProgram.add(
                program,
                image,
                start,
                end,
                bytes(image.data[image.offset(start) : image.offset(end)]),
            )
    program.import_targets.update(
        {
            int(at, 16): int(target, 16)
            for at, target in level_loading["importTargets"].items()
        }
    )
    program.membership_targets.update(
        {
            int(at, 16): int(target, 16)
            for at, target in level_loading["thunkTargets"].items()
        }
    )
    start, end = int(level_population["start"], 16), int(level_population["end"], 16)
    PreparationProgram.add(
        program, e, start, end, bytes(e.data[e.offset(start) : e.offset(end)])
    )
    for block in actor_fields["copyBlocks"]:
        start, end = int(block["start"], 16), int(block["end"], 16)
        PreparationProgram.add(
            program, e, start, end, bytes(e.data[e.offset(start) : e.offset(end)])
        )
    for image, blocks in [
        (e, actor_loading["engineBlocks"]),
        (core, actor_loading["coreBlocks"]),
    ]:
        for block in blocks:
            start, end = int(block["start"], 16), int(block["end"], 16)
            PreparationProgram.add(
                program,
                image,
                start,
                end,
                bytes(image.data[image.offset(start) : image.offset(end)]),
            )
    program.import_targets.update(
        {
            int(at, 16): int(target, 16)
            for at, target in actor_loading["importTargets"].items()
        }
    )
    program.membership_targets.update(
        {
            int(at, 16): int(target, 16)
            for at, target in actor_loading["thunkTargets"].items()
        }
    )
    program.receipt = dict(
        prerequisites=prior,
        freshLoading=loading,
        classRegistration=registration,
        classLoading=class_loading,
        actorClassLoading=actor_class_loading,
        actorStateFrames=actor_state_frames,
        actorReferenceLoading=actor_reference_loading,
        actorTransformLoading=transform_loading,
        propertyLoading=property_loading,
        staticBounds=dict(
            normalComparison=proof,
            body=body,
            coreBlocks=core_blocks,
            vtables=vtables,
            limits=[
                "SEH prefix retained for ordinary stack effects; handlers/unwinding not compared or executed.",
                "Current LocalToWorld and auxiliary collision-model bounding-box replies are supplied.",
                "Supplemental correspondence does not authenticate archive origin.",
            ],
        ),
        modelBounds=model_bounds,
        staticPostLoad=postload,
        staticConstructor=constructor,
        actorLoading=actor_loading,
        actorFields=actor_fields,
        levelCollisionMode=level_mode,
        levelPopulation=level_population,
        levelLoading=level_loading,
    )
    return program


class StaticBoundsMachine(AdmissionMachine):
    def __init__(self, program):
        super().__init__(program)
        self.memory.update(
            {
                0x10851E6C + 0x148: program.local_thunk,
                0xA10078: program.static_bounds_thunk,
                0xA50078: 0xA60000,
            }
        )
        self.bound_events = []
        self.population_events = []
        self.level_loading_events = []
        self.current = None

    def read(self, operand):
        if operand in ("al", "cl", "bl"):
            return (
                self.registers[{"al": "eax", "cl": "ecx", "bl": "ebx"}[operand]] & 255
            )
        return super().read(operand)

    def write(self, operand, value, floating=False):
        if operand in ("al", "cl", "bl"):
            register = {"al": "eax", "cl": "ecx", "bl": "ebx"}[operand]
            self.registers[register] = (self.registers[register] & 0xFFFFFF00) | (
                value & 255
            )
            return
        return super().write(operand, value, floating)

    def put_box(self, dest, box):
        self.memory.update(
            {dest + i * 4: v for i, v in enumerate([*box["min"], *box["max"]])}
        )
        self.memory[dest + 24] = PartialWord(box["valid"], 255)

    def box(self, ptr):
        valid = self.memory[ptr + 24]
        if isinstance(valid, PartialWord):
            assert valid.mask & 255 == 255
            valid = valid.value
        return dict(
            min=[self.memory[ptr + i * 4] for i in range(3)],
            max=[self.memory[ptr + 12 + i * 4] for i in range(3)],
            valid=valid & 255,
        )

    def postload(self, mesh):
        version, flags = self.memory[mesh + 0x1DC], self.memory[mesh + 0x1C]
        assert (
            type(version) is int and 8 <= version <= 0x7FFFFFFF
        ), "unadmitted mesh version"
        assert (
            type(flags) is int and 0 <= flags <= 0xFFFFFFFF and not flags & 0x100
        ), "unadmitted current object flags"
        count = self.memory[mesh + 0x7C]
        assert type(count) is int and 0 <= count <= 0x100000, "unadmitted vertex count"
        self.array(mesh + 0xD8)  # explicit, valid supplied storage
        ptr, capacity = self.memory[mesh + 0xD8], self.memory[mesh + 0xE0]
        assert (
            not capacity or ptr + capacity * 4 <= mesh or mesh + 0x1F4 <= ptr
        ), "mesh aliases array storage"
        self.invoke(0x106F5CC0, mesh)

    def step(self, i):
        if i.address in (0x1015FBFF, 0x1016FF56):
            # Qualified InitProperties/array-copy memory-provider boundary.
            # Fixtures are nonoverlapping, aligned ordinary source buffers.
            assert i.op_str == "0x1017ac60"
            sp = self.registers["esp"]
            dest, source, size = [self.memory[sp + n * 4] for n in range(3)]
            assert 0 <= size <= 0x400 and size % 4 == 0
            if i.address == 0x1016FF56:
                assert size == 0
            self.memmove(dest, source, size)
            self.registers["eax"] = dest
            self.visited.append(i.address)
            return i.address + i.size
        if i.address == 0x1015FC32:
            assert i.op_str == "0x101022e3"
            sp = self.registers["esp"]
            dest, size = self.memory[sp], self.memory[sp + 4]
            assert size in (4, 12) and dest % 4 == 0
            for off in range(0, size, 4):
                self.memory[dest + off] = 0
            self.visited.append(i.address)
            return i.address + i.size
        if i.address in (0x10171600, 0x10170E30):
            # Original 4-byte archive Serialize virtual call. The private
            # fixture supplies bytes at this boundary, not a native file handle.
            assert self.registers["ecx"] == self.transform_archive
            assert self.registers["eax"] == 0xA80000
            sp = self.registers["esp"]
            destination, size = self.memory[sp], self.memory[sp + 4]
            assert size == 4 and self.transform_payload
            self.memory[destination] = self.transform_payload.pop(0)
            self.transform_reads.append(destination)
            self.registers["esp"] += 8
            self.visited.append(i.address)
            return i.address + i.size
        if i.address == 0x10172824:
            # Struct metadata is supplied already loaded. Verify the precise
            # Preload target and leave that metadata unchanged.
            assert self.registers["ecx"] == self.transform_archive
            assert self.registers["edx"] == 0xA80010
            assert self.memory[self.registers["esp"]] == self.transform_struct
            self.registers["esp"] += 4
            self.visited.append(i.address)
            return i.address + i.size
        if i.address == 0x10133625:
            assert self.registers["ecx"] == self.transform_archive
            assert self.registers["edx"] == 0xA80028
            self.registers["eax"] = len(self.transform_reads) * 4
            self.visited.append(i.address)
            return i.address + i.size
        if i.address in (0x1014B304, 0x1014B362):
            # Exact IndexToObject factory boundary, with supplied synchronous
            # replies. Do not pretend to execute construction or import lookup.
            assert self.registers["ecx"] == self.reference_linker
            sp = self.registers["esp"]
            index = self.memory[sp]
            imported = i.address == 0x1014B362
            kind = "import" if imported else "export"
            if not imported:
                assert self.memory[sp + 4] == 0
            self.reference_events.append([kind, index])
            self.registers["eax"] = self.reference_replies[kind][index]
            self.registers["esp"] += 4 if imported else 8
            self.visited.append(i.address)
            return i.address + i.size
        if i.address == 0x1016ED9E:
            # SerializeItem's explicit archive callback. IndexToObject is
            # interpreted separately above; compact archive I/O is not mocked
            # as a complete native load.
            assert self.registers["eax"] == 0xA70000
            assert self.registers["ecx"] == self.reference_archive
            sp = self.registers["esp"]
            self.memory[self.memory[sp]] = self.reference_reply
            self.registers["esp"] += 4
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic == "not" and i.op_str in self.registers:
            self.write(i.op_str, ~self.read(i.op_str) & 0xFFFFFFFF)
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic == "sete" and i.op_str in ("al", "cl"):
            self.write(i.op_str, int(self.zero))
            self.visited.append(i.address)
            return i.address + i.size
        if i.address in (0x105CD6C7, 0x105CD735):
            actor, level, frame = (self.registers[r] for r in ("esi", "edi", "ebp"))
            first = i.address == 0x105CD6C7
            nxt = super().step(i)
            assert (
                self.memory[actor + 0xE4] == level and self.memory[actor + 0x2CC] == 0
            )
            self.level_loading_events.append(
                dict(
                    source="registry" if first else "buffer",
                    index=self.memory[frame - (0x28 if first else 0x14)],
                    identity=actor,
                    writes=dict(xLevelIdentity=level, collisionTag=0),
                )
            )
            return nxt
        if i.address == 0x105CAC19:
            proof = self.source.receipt["levelPopulation"]
            assert self.registers["eax"] == int(proof["vtable"]["target"], 16)
            assert self.registers["ecx"] == self.population_provider
            sp = self.registers["esp"]
            self.population_events.append([self.registers["ebx"], self.memory[sp]])
            if hasattr(self, "population_rows"):
                self.current = self.population_rows[self.memory[sp]]
                return MembershipMachine.step(self, i)
            # Supplied synchronous AddActor response. Its internal mutation is
            # covered separately; it must not change the array in this fixture.
            self.registers.update(eax=0xA5A5A5A5, ecx=0x5A5A5A5A, edx=0x12345678)
            self.registers["esp"] += 4
            self.visited.append(i.address)
            return i.address + i.size
        if i.address in (0x10602CE3, 0x10602CFE) and hasattr(self, "population_rows"):
            self.population_mode_writes.add(self.registers["ebx"])
        if i.address in (0x1052F5B3, 0x1052F5F3):
            raise AssertionError("unadmitted actor localization or attached-array path")
        if i.address == 0x1015E68F:
            self.before_postload_flags = self.memory[self.registers["esi"] + 0x1C]
        if i.mnemonic == "adc":
            dest, source = i.op_str.split(", ")
            a, b = self.read(dest) & 0xFFFFFFFF, self.read(source) & 0xFFFFFFFF
            total = a + b + int(self.carry)
            value = total & 0xFFFFFFFF
            self.flags(
                value, total > 0xFFFFFFFF, bool(~(a ^ b) & (a ^ value) & 0x80000000)
            )
            self.write(dest, value)
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic == "mul":
            product = (self.registers["eax"] & 0xFFFFFFFF) * (
                self.read(i.op_str) & 0xFFFFFFFF
            )
            self.registers["eax"] = product & 0xFFFFFFFF
            self.registers["edx"] = product >> 32
            # The admitted product helper consumes no undefined arithmetic
            # flags. Its caller immediately replaces them with ADD/ADC.
            self.carry = bool(product >> 32)
            self.visited.append(i.address)
            return i.address + i.size
        if i.mnemonic in ("rep stosd", "rep stosb"):
            # Explicit ordinary ABI profile: direction flag clear. Preserve
            # unknown surrounding bytes, as with the existing byte stores.
            width = 4 if i.mnemonic == "rep stosd" else 1
            count = self.registers["ecx"]
            assert type(count) is int and 0 <= count <= 0x100000
            for _ in range(count):
                self.write(
                    "dword ptr [edi]" if width == 4 else "byte ptr [edi]",
                    self.registers["eax"] & (0xFFFFFFFF if width == 4 else 255),
                )
                self.registers["edi"] += width
            self.registers["ecx"] = 0
            self.visited.append(i.address)
            return i.address + i.size
        if i.address in (0x106FE764, 0x106FE7BB, 0x10744F1E):
            sp = self.registers["esp"]
            dest = self.memory[sp]
            if i.address != 0x106FE7BB:
                register = "eax" if i.address == 0x10744F1E else "edx"
                assert self.registers[register] == self.source.local_thunk
                owner = self.registers["ecx"]
                self.bound_events.append(["local", owner])
                self.memory.update(
                    {dest + j * 4: v for j, v in enumerate(self.current["matrix"])}
                )
                self.registers["esp"] += 4
            else:
                concrete = getattr(self, "concrete_model_bounds", False)
                assert self.registers["edx"] == (
                    self.source.model_bounds_thunk if concrete else 0xA60000
                )
                self.bound_events.append(
                    ["model", self.registers["ecx"], self.memory[sp + 4]]
                )
                if concrete:
                    return MembershipMachine.step(self, i)
                self.put_box(dest, self.current["auxiliary"])
                self.registers["esp"] += 8
            self.registers["eax"] = dest
            self.visited.append(i.address)
            return i.address + i.size
        if (
            i.address == 0x10602BFC
            and self.registers["edx"] == self.source.static_bounds_thunk
        ):
            sp = self.registers["esp"]
            self.admission_events.append(
                ["bounds", self.registers["ecx"], self.memory[sp + 4]]
            )
            return MembershipMachine.step(self, i)
        return super().step(i)


def fixture_rows():
    rng = random.Random(0x424F554E)
    rows = []
    for n in range(600):
        vec = lambda bound: [f32(rng.uniform(-bound, bound)) for _ in range(3)]
        minimum, size = vec(100), [f32(rng.uniform(0, 100)) for _ in range(3)]
        matrix = vec(3) + [0.0] + vec(3) + [0.0] + vec(3) + [0.0] + vec(400000) + [1.0]
        bounds = dict(
            min=minimum, max=[f32(a + b) for a, b in zip(minimum, size)], valid=n % 3
        )
        aux = dict(min=vec(1000), max=vec(1000), valid=n % 3)
        if n % 11 == 0:
            bounds = dict(
                min=[0.0 if n % 22 else -0.0] * 3, max=[0.0, 0.0, 0.0], valid=0
            )
            matrix = [-0.0] * 15 + [1.0]
            aux = dict(min=[0.0] * 3, max=[0.0] * 3, valid=255)
        if n % 13 == 0:
            matrix = IDENTITY[:]
            matrix[12:15] = [2.0**24, 2.0**25, -0.0]
            bounds = dict(min=[-1.0] * 3, max=[1.0] * 3, valid=0)
        rows.append(
            dict(
                ownerFlags2f8=0x100 if n % 5 == 0 else 0,
                location=vec(400000),
                collisionRadius=f32(rng.uniform(0, 80)),
                collisionHeight=f32(rng.uniform(0, 120)),
                localBounds=bounds,
                matrix=matrix,
                auxiliary=aux if n % 4 else None,
            )
        )
    # Cancellation exposes an intermediate Float32 store that broad random
    # translated boxes can hide. This is an authored arithmetic probe.
    rows[-1].update(
        ownerFlags2f8=0,
        localBounds=dict(min=[1.0, 1.0, 1.0], max=[1.0, 1.0, 1.0], valid=0),
        matrix=[
            1.0,
            0.0,
            0.0,
            0.0,
            2.0**24,
            1.0,
            0.0,
            0.0,
            -(2.0**24),
            0.0,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
        auxiliary=None,
    )
    return rows


def setup_actor(m, row, actor=0x200000, mesh=0x300000):
    m.current = row
    m.memory.update(
        {
            actor: 0x10851E6C,
            actor + 0x2F8: row["ownerFlags2f8"] | 1,
            actor + 0x2F0: row["collisionRadius"],
            actor + 0x2F4: row["collisionHeight"],
            actor + 0x104: mesh,
            mesh: 0xA10000,
            mesh + 0x178: 0x400000 if row["auxiliary"] is not None else 0,
            0x400000: 0xA50000,
        }
    )
    m.memory.update({actor + 0x1BC + i * 4: v for i, v in enumerate(row["location"])})
    m.put_box(mesh + 0x34, row["localBounds"])


def native_one(program, row):
    m = StaticBoundsMachine(program)
    setup_actor(m, row)
    m.invoke(0x106FE700, 0x300000, [0x600000, 0x200000])
    assert m.registers["eax"] == 0x600000
    return dict(bounds=hexes(m.box(0x600000)), events=m.bound_events), m


def model_bounds_cases(program, runtime):
    """Compare real Model bodies, also called from the real static wrapper."""
    rows, expected, steps, visited = fixture_rows(), [], 0, set()
    for index, row in enumerate(rows):
        results = []
        for joined in (False, True):
            m = StaticBoundsMachine(program)
            setup_actor(m, row)
            if joined:
                m.concrete_model_bounds = True
                m.memory[0xA50078] = program.model_bounds_thunk
                if row["auxiliary"] is not None:
                    m.put_box(0x400000 + 0x34, row["auxiliary"])
                m.invoke(0x106FE700, 0x300000, [0x600000, 0x200000])
            else:
                m.invoke(
                    0x10744EE0, 0x300000, [0x600000, 0 if index % 3 == 0 else 0x200000]
                )
            assert m.registers["eax"] == 0x600000
            results.append(dict(bounds=hexes(m.box(0x600000)), events=m.bound_events))
            steps += len(m.visited)
            visited.update(m.visited)
        expected.append(results)
    script = r"""
import fs from 'node:fs';
const api=await import(process.argv[1]);
const val=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?val(v):v;
const box=b=>({min:b.min.map(bits),max:b.max.map(bits),valid:b.valid});
process.stdout.write(JSON.stringify(decode(JSON.parse(fs.readFileSync(0,'utf8'))).map((row,index)=>[false,true].map(joined=>{
 const events=[],profile={arithmeticProfile:'pc53-rne'};
 const local=owner=>{events.push(['local',owner]);return {status:'ready',matrix:row.matrix};};
 const r=joined?api.prepareStaticMeshBounds({...row,...profile,ownerIdentity:0x200000,
  collisionModel:row.auxiliary===null?null:0x400000,readLocalToWorld:local,
  getCollisionModelBounds:(model,owner)=>{
   events.push(['model',model,owner]);
   return api.prepareModelBounds({...profile,ownerIdentity:owner,localBounds:row.auxiliary,readLocalToWorld:local});
  }
 }):api.prepareModelBounds({...profile,ownerIdentity:index%3===0?null:0x200000,localBounds:row.localBounds,readLocalToWorld:local});
 if(r.status!=='ready')throw Error(JSON.stringify(r));
 return {bounds:box(r.bounds),events};
}))));
"""
    actual = browser_outputs(script, hexes(rows), Path(runtime))
    assert len(actual) == len(expected)
    for index, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("Model bounds", index, a, b)
    selections, selected = [], []
    for brush, engine, primitive in [
        (0x410000, None, None),
        (0, 0, None),
        (0, 0x420000, 0),
        (0, 0x420000, 0x430000),
    ]:
        m = StaticBoundsMachine(program)
        actor, level = 0x200000, 0x400000
        m.memory[actor + 0x278] = brush
        row = dict(primitive278=brush or None)
        if not brush:
            m.memory.update({actor + 0xE4: level, level + 0x74: engine})
            row.update(levelIdentity=level, engineIdentity=engine or None)
            if engine:
                m.memory[engine + 0x50] = primitive
                row["enginePrimitive50"] = primitive or None
        m.invoke(0x1052DFF0, actor)
        selected.append(m.registers["eax"] or None)
        selections.append(row)
        steps += len(m.visited)
        visited.update(m.visited)
    script = r"""
import fs from 'node:fs';
const api=await import(process.argv[1]);
process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(row=>{
 const result=api.selectBrushPrimitive(row);
 if(result.status!=='ready')throw Error(JSON.stringify(result));
 return result.primitiveIdentity;
})));
"""
    assert browser_outputs(script, selections, Path(runtime)) == selected
    return dict(
        cases=len(rows),
        joinedStaticCases=len(rows),
        brushSelectionCases=len(selections),
        nullOwnerCases=sum(index % 3 == 0 for index in range(len(rows))),
        instructions=steps,
        uniqueInstructions=len(visited),
        browserStateCompared=True,
        scope="supplied current local boxes and owner matrix responses; original Model bounds and static auxiliary dispatch, not lifecycle or live queries",
    )


def level_population_cases(program):
    """Execute source slot ordering and gates with explicit AddActor callbacks."""
    rng = random.Random(0x4C455645)
    proof = program.receipt["levelPopulation"]
    steps, calls, nulls, repeated, visited = 0, 0, 0, 0, set()
    for index in range(256):
        m = StaticBoundsMachine(program)
        level, provider, storage = 0x700000, 0x710000, 0x720000
        m.population_provider = provider
        pool = [0x730000 + j * 0x1000 for j in range(8)]
        flags = [0, 1, 0xFFFFFFFE, 0x80000001, 0x100, 3, 2, 0xFFFFFFFF]
        if index >= 128:
            flags = [rng.getrandbits(32) for _ in pool]
        refs = [rng.choice([0, *pool]) for _ in range(index % 49)]
        if index % 8 == 1:
            refs = [pool[1], 0, pool[0], pool[1], pool[4], pool[3]]
        fields = {
            level + 0x38: storage,
            level + 0x3C: len(refs),
            level + 0x120: provider,
            provider: int(proof["vtable"]["address"], 16),
            int(proof["vtable"]["address"], 16) + 8: int(proof["vtable"]["target"], 16),
        }
        fields.update({storage + j * 4: ref for j, ref in enumerate(refs)})
        fields.update({actor + 0x2F8: flag for actor, flag in zip(pool, flags)})
        m.memory.update(fields)
        m.registers.update(esi=level, edi=0, ebp=0x800000)
        initial_sp = m.registers["esp"]
        m.execute_until(int(proof["start"], 16), int(proof["stop"], 16))
        by_actor = dict(zip(pool, flags))
        expected = [
            [slot, ref] for slot, ref in enumerate(refs) if ref and by_actor[ref] & 1
        ]
        assert m.population_events == expected
        assert {at: m.memory[at] for at in fields} == fields
        assert m.registers["esp"] == initial_sp
        steps += len(m.visited)
        visited.update(m.visited)
        calls += len(expected)
        nulls += refs.count(0)
        repeated += len([ref for ref in refs if ref]) - len(set(refs) - {0})
    return dict(
        cases=256,
        instructions=steps,
        uniqueInstructions=len(visited),
        addActorCalls=calls,
        nullSlots=nulls,
        repeatedNonNullSlots=repeated,
        scope="stable supplied current array; AddActor callback boundary, not map loading",
    )


POPULATION_SCRIPT = r"""
import fs from 'node:fs';
const helper=await import(process.argv[1]);
const api=await import(new URL('./actor-octree.js',process.argv[1]));
const loading=await import(new URL('./actor-loading.js',process.argv[1]));
const val=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?val(v):v;
const ready=r=>{if(r.status!=='ready')throw Error(JSON.stringify(r));return r;};
const profile={arithmeticProfile:'pc53-rne'};
const encodeBox=b=>({min:b.min.map(bits),max:b.max.map(bits)});
const cases=decode(JSON.parse(fs.readFileSync(0,'utf8')));
process.stdout.write(JSON.stringify(cases.map(c=>{
 const {tree}=ready(api.createActorOctree({...profile,volume:{center:[0,0,0],halfExtent:360448}}));
 const fields=new Map(c.rows.map(r=>[r.identity,{...r,
  cachedBounds:{min:[0,0,0],max:[0,0,0]},cachedCenter:[0,0,0],cachedExtent:[0,0,0],storedLocation:[0,0,0]}]));
 const result=ready(loading.populateLevelActorCollision({freshHash:true,actors:c.actors,
  readActorFlags:id=>id===c.levelInfo?{mask:1,value:0}:fields.get(id).ownerFlags2f8,
  addActor:id=>{
   const row=fields.get(id);
   const response=api.updateActorOctree(tree,{...row,flags2f8:row.ownerFlags2f8,
    getPrimitive:()=>helper.selectActorPrimitive({primitive104:null,primitive38:row.primitiveIdentity}),
    getPrimitiveBounds:(primitive,owner)=>{
     if(primitive!==row.primitiveIdentity||owner!==id)throw Error('wrong primitive dispatch');
     return helper.prepareStaticMeshBounds({...row,...profile,ownerIdentity:id,
      collisionModel:row.auxiliary===null?null:0x400000,
      readLocalToWorld:()=>({status:'ready',matrix:row.matrix}),
      getCollisionModelBounds:()=>({status:'ready',bounds:row.auxiliary})});
    }});
   Object.assign(row,response.writes);return response;
  }}));
 const {nodes,memberships}=ready(api.inspectActorOctree(tree));
 const caches=[...fields].map(([identity,r])=>({identity,flags74:r.flags74,
  cachedBounds:encodeBox(r.cachedBounds),cachedCenter:r.cachedCenter.map(bits),
  cachedExtent:r.cachedExtent.map(bits),storedLocation:r.storedLocation.map(bits)}));
 return {nodes,memberships,caches,completedSlots:result.completedSlots,calls:result.calls.map(r=>[r.index,r.identity])};
})));
"""


def joined_level_population_cases(program, runtime):
    """Execute the original level loop THROUGH AddActor and static bounds.

    Incoming current actor fields, LevelInfo mode and LocalToWorld/auxiliary
    replies are supplied. Native words contain random unknown padding; the
    browser sees only required bits and returns partial mode-word writes.
    """
    rng = random.Random(0x504F5055)
    proof, source_rows = program.receipt["levelPopulation"], fixture_rows()
    cases, answers, visited, steps, call_count = [], [], set(), 0, 0
    for case in range(64):
        m = StaticBoundsMachine(program)
        level, provider, root, storage, info = (
            0x700000,
            0x710000,
            0x100000,
            0x720000,
            0x740000,
        )
        m.population_provider, m.population_rows, m.population_mode_writes = (
            provider,
            {},
            set(),
        )
        m.invoke(0x10601A10, root)
        m.invoke(0x108464A0)
        actors = [0x200000 + i * 0x1000 for i in range(8)]
        refs = [info, *actors, None, actors[1], actors[0]]
        refs += [rng.choice([None, *actors]) for _ in range(case % 17)]
        mode = rng.getrandbits(32)
        table = int(proof["vtable"]["address"], 16)
        stable = {
            level + 0x38: storage,
            level + 0x3C: len(refs),
            level + 0x120: provider,
            provider: table,
            provider + 4: root,
            table + 8: int(proof["vtable"]["target"], 16),
            info + 0x554: mode,
            info + 0x2F8: rng.getrandbits(32) & ~1,
        }
        stable.update({storage + i * 4: ref or 0 for i, ref in enumerate(refs)})
        rows, flags = [], {}
        for i, actor in enumerate(actors):
            row = dict(source_rows[case * 8 + i])
            # These are authored current response fixtures, not map defaults.
            flags2f8 = (
                (rng.getrandbits(32) & ~0x101)
                | row["ownerFlags2f8"]
                | (0 if i == 7 else 1)
            )
            flags64 = (rng.getrandbits(32) & ~0x80) | (0x80 if i == 6 else 0)
            flags2e4 = (rng.getrandbits(32) & ~0x4000) | (0x4000 if i == 5 else 0)
            flags74, mask74 = rng.getrandbits(32), (
                rng.getrandbits(32) if case % 3 else 0
            )
            flags[actor] = (flags74, mask74)
            primitive = 0x300000 + i * 0x1000
            setup_actor(m, row, actor, primitive)
            # Ordinary static actors select StaticMesh at +38, not Mesh +104.
            m.memory.update(
                {
                    actor + 0x104: 0,
                    actor + 0x38: primitive,
                    actor + 0x64: flags64,
                    actor + 0x2E4: flags2e4,
                    actor + 0x2F8: flags2f8,
                    actor + 0x74: flags74,
                    actor + 0xE4: 0 if case % 4 == 1 else level,
                }
            )
            m.invoke(0x101091F0, actor + 0x168)
            for off in (0x174, 0x180, 0x190, 0x19C, 0x33C):
                m.memory.update({actor + off + j * 4: 0.0 for j in range(3)})
            m.population_rows[actor] = row
            rows.append(
                dict(
                    row,
                    identity=actor,
                    primitiveIdentity=primitive,
                    ownerFlags2f8=dict(mask=0x101, value=flags2f8 & 0x101),
                    flags64=dict(mask=0x80, value=flags64 & 0x80),
                    flags2e4=dict(mask=0x4000, value=flags2e4 & 0x4000),
                    flags74=dict(mask=mask74, value=flags74 & mask74),
                    level=(
                        None
                        if case % 4 == 1
                        else dict(infoFlags554=dict(mask=2, value=mode & 2))
                    ),
                )
            )
        m.memory.update(stable)
        m.registers.update(esi=level, edi=0, ebp=0x800000)
        sp = m.registers["esp"]
        m.execute_until(int(proof["start"], 16), int(proof["stop"], 16))
        assert m.registers["esp"] == sp
        assert {at: m.memory[at] for at in stable} == stable
        identities = {actor: actor for _, actor in m.population_events}
        state = snapshot(m, root, identities)
        state["memberships"] = [
            dict(identity=k, nodes=v) for k, v in state["memberships"].items()
        ]
        caches = []
        for actor in actors:
            initial, known = flags[actor]
            assert m.memory[actor + 0x74] & ~0x100 == initial & ~0x100
            if actor in m.population_mode_writes:
                known |= 0x100
            values = lambda off: [m.memory[actor + off + i * 4] for i in range(3)]
            caches.append(
                hexes(
                    dict(
                        identity=actor,
                        flags74=dict(mask=known, value=m.memory[actor + 0x74] & known),
                        cachedBounds=dict(min=values(0x174), max=values(0x180)),
                        cachedCenter=values(0x190),
                        cachedExtent=values(0x19C),
                        storedLocation=values(0x33C),
                    )
                )
            )
        cases.append(dict(rows=rows, actors=refs, levelInfo=info))
        answers.append(
            dict(
                state,
                caches=caches,
                completedSlots=len(refs),
                calls=m.population_events,
            )
        )
        visited.update(m.visited)
        steps += len(m.visited)
        call_count += len(m.population_events)
    actual = browser_outputs(POPULATION_SCRIPT, hexes(cases), Path(runtime))
    assert len(actual) == len(answers)
    for index, (a, b) in enumerate(zip(actual, answers)):
        assert a == b, ("joined level population", index, a, b)
    return dict(
        cases=len(cases),
        addActorCalls=call_count,
        instructions=steps,
        uniqueInstructions=len(visited),
        browserStateCompared=True,
        unknownBitsPreserved=True,
        sourceArrayPreserved=True,
        scope="current level loop through AddActor, static bounds and membership; supplied current fields/matrix/model replies, not map startup",
    )


def level_collision_mode_cases(program, runtime):
    """Compare declared mode copying, original construction and startup writes.

    Default words, allocation/counters and the point after successful actor
    execution initialization are supplied boundaries. No whole LoadMap claim.
    """
    rng = random.Random(0x4C455645)
    proof = program.receipt["levelCollisionMode"]
    actor, template = 0x200000, 0x300000
    table = program.engine.exported("??_7ALevelInfo@@6B@")
    rows, expected, visited, steps = [], [], set(), 0
    counters = program.receipt["actorLoading"]["actorCounters"]
    for case in range(128):
        m = StaticBoundsMachine(program)
        initial = {actor + off: rng.getrandbits(32) for off in range(0, 0x660, 4)}
        m.memory.update(initial)
        source = rng.getrandbits(32)
        m.memory[template + 0x554] = source
        known, later_known = rng.getrandbits(32), rng.getrandbits(32)
        if case % 4 == 0:
            known = later_known = 0
        row = dict(
            before=dict(mask=known, value=initial[actor + 0x554] & known),
            defaults=dict(mask=7, value=source & 7),
            later=dict(mask=later_known, value=initial[actor + 0x55C] & later_known),
        )
        m.registers.update(esi=actor, edi=template)
        m.execute_until(
            int(proof["copyBlock"]["start"], 16), int(proof["copyBlock"]["end"], 16)
        )
        after_copy = initial | {
            actor + 0x554: (initial[actor + 0x554] & ~7) | (source & 7)
        }
        assert {at: m.memory[at] for at in initial} == after_copy
        assert m.memory[template + 0x554] == source
        for iat, address in counters.items():
            m.memory[int(iat, 16)] = address
            m.memory[address] = rng.randrange(100000)
        m.memory.update(
            {
                address: rng.randrange(100000)
                for address in (0x103307E8, 0x103307EC, 0x103307F0)
            }
        )
        m.invoke(0x103BF970, actor)
        constructed = after_copy | {
            actor: table,
            actor + 0x3A0: initial[actor + 0x3A0] & 0xFFFFFFF8,
            actor + 0x3A4: 0xFFFFFFFF,
            actor + 0x3A8: 1,
            actor + 0x3AC: 1,
        }
        assert {at: m.memory[at] for at in initial} == constructed, (
            "LevelInfo constructor",
            case,
        )
        loaded_word = m.memory[actor + 0x554]
        # This is precisely the later write slice, not a simulated completion
        # of the intervening map/actor initialization callbacks.
        m.registers["esi"] = actor
        m.execute_until(0x10595FB1, 0x10595FBF)
        final = constructed | {
            actor + 0x554: loaded_word | 2,
            actor + 0x55C: constructed[actor + 0x55C] | 4,
        }
        assert {at: m.memory[at] for at in initial} == final
        rows.append(row)
        expected.append(
            dict(
                loaded=dict(mask=known | 7, value=loaded_word & (known | 7)),
                started=dict(mask=known | 7, value=final[actor + 0x554] & (known | 7)),
                later=dict(
                    mask=later_known | 4, value=final[actor + 0x55C] & (later_known | 4)
                ),
            )
        )
        visited.update(m.visited)
        steps += len(m.visited)
    script = r"""
const {writeKnownFlagBits}=await import(new URL('./actor-loading.js',process.argv[1]));
let raw='';for await(const part of process.stdin)raw+=part;
process.stdout.write(JSON.stringify(JSON.parse(raw).map(row=>{
 const loaded=writeKnownFlagBits(row.before,7,row.defaults.value);
 return {loaded,started:writeKnownFlagBits(loaded,2,2),later:writeKnownFlagBits(row.later,4,4)};
})));
"""
    actual = browser_outputs(script, rows, Path(runtime))
    assert actual == expected, "LevelInfo mode words differ from original stores"
    return dict(
        cases=len(rows),
        instructions=steps,
        uniqueInstructions=len(visited),
        declaredModeConstructorPreserved=True,
        unknownBitsPreserved=True,
        scope="supplied default words and successful constructor; later startup writes are a separate supplied stage",
    )


def level_loading_cases(program, runtime):
    """Compare both actual registry loops and class/outer helpers with browser writes."""
    proof = program.receipt["levelLoading"]
    actor_class = proof["classes"]["AActor"]["owned"]
    controller_class = proof["classes"]["APlayerController"]["owned"]
    parent_class, prop_class, subclass, unrelated = (
        0xA90000,
        0xAA0000,
        0xAB0000,
        0xAC0000,
    )
    parents = {
        actor_class: parent_class,
        parent_class: None,
        prop_class: actor_class,
        controller_class: actor_class,
        subclass: controller_class,
        unrelated: parent_class,
    }
    rng = random.Random(0x584C4556)
    cases, expected, steps, visited = [], [], 0, set()
    for index in range(192):
        m = StaticBoundsMachine(program)
        level, outer, foreign = 0x700000, 0x710000, 0x720000
        pool = [0x200000 + j * 0x1000 for j in range(12)]
        records, initial = [], {}
        for j, identity in enumerate(pool):
            cls = [
                actor_class,
                prop_class,
                controller_class,
                subclass,
                unrelated,
                None,
            ][j % 6]
            obj_outer = foreign if (j + index) % 5 == 0 else outer
            flags = rng.getrandbits(32)
            words = {identity + off: rng.getrandbits(32) for off in range(0, 0x600, 4)}
            words.update(
                {
                    identity + 0x18: obj_outer,
                    identity + 0x24: cls or 0,
                    identity + 0x5AC: flags,
                }
            )
            initial.update(words)
            records.append(
                dict(
                    identity=identity,
                    classIdentity=cls,
                    outerIdentity=obj_outer,
                    playerControllerFlags5ac=flags,
                )
            )
        registry = [rng.choice([None, *pool]) for _ in range(index % 41)]
        buffer = [rng.choice([None, *pool]) for _ in range(index % 23)]
        if index % 8 == 1:
            registry, buffer = [pool[1], None, pool[1], pool[2], pool[4]], [
                pool[1],
                pool[3],
                None,
                pool[5],
            ]
        m.memory.update(initial)
        m.memory.update({level + 0x18: outer})
        m.memory.update({cls + 0x34: parent or 0 for cls, parent in parents.items()})
        registry_words = {level + 0x18: outer}
        for iat, array, data, refs in [
            (0x11D8D8FC, 0x900000, 0x910000, registry),
            (0x11D8E324, 0x900020, 0x920000, buffer),
        ]:
            registry_words.update({iat: array, array: data, array + 4: len(refs)})
            registry_words.update(
                {data + slot * 4: ref or 0 for slot, ref in enumerate(refs)}
            )
        m.memory.update(registry_words)
        m.registers.update(edi=level, ebp=0x800000, esp=0x7FFF00)
        m.execute_until(0x105CD651, 0x105CD747)
        assert m.registers["esp"] == 0x7FFF00
        changed = dict(initial)
        for event in m.level_loading_events:
            changed.update(
                {event["identity"] + 0xE4: level, event["identity"] + 0x2CC: 0}
            )
        assert {at: m.memory[at] for at in initial} == changed
        assert {at: m.memory[at] for at in registry_words} == registry_words
        steps += len(m.visited)
        visited.update(m.visited)
        cases.append(
            dict(
                level=dict(identity=level, outerIdentity=outer),
                registry=registry,
                buffer=buffer,
                objects=records,
                classParents=list(parents.items()),
                actorClass=actor_class,
                playerControllerClass=controller_class,
            )
        )
        expected.append(m.level_loading_events)
    script = r"""
import fs from 'node:fs';
const {collectLevelActorAssignments}=await import(process.argv[1]);
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(rows.map(row=>{
 row.objects=new Map(row.objects.map(obj=>[obj.identity,obj]));
 row.classParents=new Map(row.classParents);
 const result=collectLevelActorAssignments(row);
 if(result.status!=='ready')throw Error(JSON.stringify(result));
 return result.assignments;
})));
"""
    module = Path(runtime).parent / "actor-loading.js"
    actual = browser_outputs(script, cases, module)
    assert (
        actual == expected
    ), "browser Level.PostLoad actor assignment differs from original loops"
    return dict(
        cases=len(cases),
        assignments=sum(map(len, expected)),
        instructions=steps,
        uniqueInstructions=len(visited),
        browserStateCompared=True,
        otherObjectWordsPreserved=True,
        sourceListsPreserved=True,
        runtimeSHA256=hashlib.sha256(module.read_bytes()).hexdigest(),
        scope="current supplied registries/class ancestry/outer identities; not saved-to-current loading",
    )


def actor_field_cases(program):
    """Execute the typed-copy bit slices, retaining undeclared destination bits."""
    rng = random.Random(0x424F4F4C)
    steps, visited, cases = 0, set(), 0
    for block, group in zip(
        program.receipt["actorFields"]["copyBlocks"],
        program.receipt["actorFields"]["booleanLayout"],
    ):
        offset, mask = int(block["offset"], 16), group["mask"]
        for index in range(128):
            source = (
                [0, 0xFFFFFFFF, 0xAAAAAAAA, 0x55555555][index]
                if index < 4
                else rng.getrandbits(32)
            )
            destination = rng.getrandbits(32)
            m = StaticBoundsMachine(program)
            m.registers.update(ebp=0x700000, ebx=0x710000, edx=destination)
            m.memory.update(
                {
                    0x700000 + offset: source,
                    0x710000 + offset: destination,
                    0x710000 + offset - 4: 0x12345678,
                    0x710000 + offset + 4: 0x89ABCDEF,
                }
            )
            m.execute_until(int(block["entry"], 16), int(block["end"], 16))
            assert m.memory[0x710000 + offset] == (destination & ~mask) | (
                source & mask
            )
            assert m.memory[0x700000 + offset] == source
            assert m.memory[0x710000 + offset - 4] == 0x12345678
            assert m.memory[0x710000 + offset + 4] == 0x89ABCDEF
            steps += len(m.visited)
            visited.update(m.visited)
            cases += 1
    return dict(
        cases=cases,
        declaredBooleans=sum(
            len(g["fields"]) for g in program.receipt["actorFields"]["booleanLayout"]
        ),
        instructions=steps,
        uniqueInstructions=len(visited),
        undeclaredDestinationBitsPreserved=True,
        scope="typed actor-copy slices with supplied source/destination words; not map loading",
    )


def actor_loading_cases(program):
    """Check exact actor storage preservation before resolving saved state.

    These are supplied-storage cases, not a map loader. PostLoad's localization,
    debug hook and attached-array mutation paths remain outside this contract.
    """
    rng = random.Random(0x41435452)
    constructor_steps, postload_steps = 0, 0
    constructor_visited, postload_visited = set(), set()
    actor, mesh, reference60, cls = 0x200000, 0x300000, 0x400000, 0x900000
    table = program.engine.exported("??_7AStaticMeshActor@@6B@")
    actor_counters = program.receipt["actorLoading"]["actorCounters"]
    class_bits = program.receipt["actorClassLoading"]
    for index in range(192):
        m = StaticBoundsMachine(program)
        initial = {actor + off: rng.getrandbits(32) for off in range(0, 0x400, 4)}
        m.memory.update(initial)
        counters = {}
        for iat, address in actor_counters.items():
            m.memory[int(iat, 16)] = address
            counters[address] = rng.randrange(100000)
        counters.update(
            {
                0x103307E8: rng.randrange(100000),
                0x103307EC: rng.randrange(100000),
                0x103307F0: rng.randrange(100000),
            }
        )
        # Alternate both signed peak-counter branches without arithmetic overflow.
        for current, peak in [
            (0x103307E8, 0x103307F0),
            (actor_counters["0x11d8d768"], actor_counters["0x11d8d760"]),
        ]:
            counters[peak] = counters[current] + (20 if index % 2 else 0)
        m.memory.update(counters)
        saved_registers = {
            name: rng.getrandbits(32) for name in ("ebx", "esi", "edi", "ebp")
        }
        m.registers.update(saved_registers)
        m.invoke(0x103C2A40, actor)
        expected = initial | {
            actor: table,
            actor + 0x3A0: initial[actor + 0x3A0] & 0xFFFFFFF8,
            actor + 0x3A4: 0xFFFFFFFF,
            actor + 0x3A8: 1,
            actor + 0x3AC: 1,
        }
        assert {at: m.memory[at] for at in initial} == expected, (
            "actor constructor",
            index,
        )
        assert m.registers["eax"] == actor
        assert {name: m.registers[name] for name in saved_registers} == saved_registers
        for current, total, peak in [
            (0x103307E8, 0x103307EC, 0x103307F0),
            (
                actor_counters["0x11d8d768"],
                actor_counters["0x11d8d764"],
                actor_counters["0x11d8d760"],
            ),
        ]:
            assert m.memory[current] == counters[current] + 1
            assert m.memory[total] == counters[total] + 1
            assert m.memory[peak] == max(counters[peak], counters[current] + 1)
        constructor_steps += len(m.visited)
        constructor_visited.update(m.visited)

        # Explicit current fields: no inference from the constructor above.
        m.memory.update(
            {
                actor + 0x1C: rng.getrandbits(32) & ~0x100,
                actor + 0x24: cls,
                cls + 0x4A4: (rng.getrandbits(32) & ~class_bits["mask"])
                | class_bits["value"],
                actor + 0x278: mesh if index % 3 else 0,
                actor + 0x1F4: 0,
                mesh + 0x1C: rng.getrandbits(32),
                mesh + 0x60: reference60 if index % 3 == 2 else 0,
                reference60 + 0x1C: rng.getrandbits(32),
            }
        )
        before = {at: m.memory[at] for at in initial}
        mesh_flags, reference_flags = (
            m.memory[mesh + 0x1C],
            m.memory[reference60 + 0x1C],
        )
        m.visited.clear()
        m.invoke(0x1052F570, actor)
        expected = before | {
            actor + 0x1C: before[actor + 0x1C] | 0x20000000,
            actor + 0x5C: before[actor + 0x5C] | 0x40,
        }
        expected.update(
            {actor + 0x2D0 + i * 4: before[actor + 0x1C8 + i * 4] for i in range(3)}
        )
        assert {at: m.memory[at] for at in initial} == expected, (
            "actor PostLoad",
            index,
        )
        assert m.memory[mesh + 0x1C] == mesh_flags | (1 if index % 3 else 0)
        assert m.memory[reference60 + 0x1C] == reference_flags | (
            1 if index % 3 == 2 else 0
        )
        assert {name: m.registers[name] for name in saved_registers} == saved_registers
        postload_steps += len(m.visited)
        postload_visited.update(m.visited)
    return dict(
        cases=192,
        classLoadingBits={
            key: class_bits[key] for key in ("mask", "value", "sourceClass", "scope")
        },
        suppliedStorageBytes=0x400,
        construction=dict(
            instructions=constructor_steps,
            uniqueInstructions=len(constructor_visited),
            allOtherSuppliedWordsPreserved=True,
        ),
        postLoad=dict(
            instructions=postload_steps,
            uniqueInstructions=len(postload_visited),
            allOtherSuppliedWordsPreserved=True,
            referenceForms=["null", "reference278", "reference278-and-reference60"],
        ),
        limits=[
            "Incoming storage/counters/object flags remain authored. Only class mask0x428 comes from original loading metadata; no allocation/CDO/archive or live actor state is derived.",
            "Object 0x100 and class 0x20 clear, empty attached array, nonaliasing references; SEH ordinary stack effects only.",
        ],
    )


def constructor_cases(program):
    """Execute source construction with authored incoming storage and counters.

    A constructor is not zero-initialization: the unconsumed incoming header,
    version and tail fields must survive. Allocation/CDO and archive loading
    are intentionally not supplied by this check.
    """
    rng = random.Random(0x4D455348)
    counts, visited = 0, set()
    edges = [0, 1, 0xFFFFFFFF, 0x100000000, 0xFFFFFFFFFFFFFFF9, 0xFFFFFFFFFFFFFFFF]
    for index in range(128):
        m = StaticBoundsMachine(program)
        mesh = 0x300000
        initial = {mesh + offset: rng.getrandbits(32) for offset in range(0, 0x1FC, 4)}
        m.memory.update(initial)
        counter = edges[index] if index < len(edges) else rng.getrandbits(64)
        cache = program.cache_id_global
        current_count, total_count = rng.randrange(100000), rng.randrange(100000)
        peak = current_count + (20 if index % 2 else 0)
        m.memory.update(
            {
                0x11D8D900: cache,
                cache: counter & 0xFFFFFFFF,
                cache + 4: counter >> 32,
                0x103307E8: current_count,
                0x103307EC: total_count,
                0x103307F0: peak,
            }
        )
        saved_registers = {
            name: rng.getrandbits(32) for name in ("ebx", "esi", "edi", "ebp")
        }
        m.registers.update(saved_registers)
        m.invoke(0x106F72F0, mesh)
        assert m.registers["eax"] == mesh
        assert {name: m.registers[name] for name in saved_registers} == saved_registers
        assert {at: m.memory[at] for at in range(mesh + 4, mesh + 0x34, 4)} == {
            at: initial[at] for at in range(mesh + 4, mesh + 0x34, 4)
        }
        # None of these current fields is initialized by the ordinary ctor.
        for offset in [*range(0x178, 0x1C4, 4), *range(0x1DC, 0x1F4, 4)]:
            assert m.memory[mesh + offset] == initial[mesh + offset]
        assert m.memory[mesh] == program.engine.exported("??_7UStaticMesh@@6B@")
        assert m.box(mesh + 0x34) == dict(min=[0.0] * 3, max=[0.0] * 3, valid=0)
        assert m.memory[mesh + 0x4C] & 0xFFFFFF00 == initial[mesh + 0x4C] & 0xFFFFFF00
        assert [m.memory[mesh + offset] for offset in range(0x50, 0x60, 4)] == [0.0] * 4
        for offset in [
            0x60,
            0x78,
            0x94,
            0xB0,
            0xC0,
            0xD8,
            0xF4,
            0x110,
            0x12C,
            0x13C,
            0x154,
            0x16C,
            0x1D0,
        ]:
            assert [m.memory[mesh + offset + j * 4] for j in range(3)] == [0, 0, 0]
        for number, offset in enumerate([0x6C, 0x88, 0xA4, 0xCC, 0xE8, 0x104, 0x120]):
            value = (
                ((counter + number) << 8) + (0xE1 if number < 5 else 0xE2)
            ) & 0xFFFFFFFFFFFFFFFF
            assert m.memory[mesh + offset + 4] == value & 0xFFFFFFFF
            assert m.memory[mesh + offset + 8] == value >> 32
            assert m.memory[mesh + offset + 0x18] == 0
        assert (
            m.memory[cache] | (m.memory[cache + 4] << 32)
            == (counter + 7) & 0xFFFFFFFFFFFFFFFF
        )
        assert m.memory[0x103307E8] == current_count + 1
        assert m.memory[0x103307EC] == total_count + 1
        assert m.memory[0x103307F0] == max(peak, current_count + 1)
        assert m.memory[mesh + 0x1F4] == m.memory[mesh + 0x1F8] == 0xFFFFFFFF
        assert not m.blocks
        counts += len(m.visited)
        visited.update(m.visited)
    return dict(
        cases=128,
        instructions=counts,
        uniqueInstructions=len(visited),
        headerPreserved=True,
        currentVersionPreserved=True,
        initializedStreams=7,
        directionFlag="clear",
    )


def native_postload_one(program, row, index):
    """Execute PostLoad before the same bounds query with explicit current state."""
    m = StaticBoundsMachine(program)
    mesh = 0x300000
    m.memory.update({mesh + offset: 0x13579BDF for offset in range(0, 0x1F4, 4)})
    setup_actor(m, row, mesh=mesh)
    flags = [0, 0x000F0004, 0x20000000, 0xFFFFFEFF][index % 4]
    count = [0, 1, 2, 7, 64, 257][index % 6]
    old_count = [0, 1, 9, 3, 16][index % 5]
    capacity = old_count + (index % 3)
    ptr = m.allocate(capacity * 4)
    m.memory.update({ptr + i * 4: 0xA5A5A5A5 for i in range(capacity)})
    m.memory.update(
        {
            mesh + 0x1C: flags,
            mesh + 0x1DC: [8, 9, 0x7FFFFFFF][(index // 6) % 3],
            mesh + 0x7C: count,
            mesh + 0xD8: ptr,
            mesh + 0xDC: old_count,
            mesh + 0xE0: capacity,
        }
    )
    before = {at: value for at, value in m.memory.items() if mesh <= at < mesh + 0x1F4}
    m.postload_input = dict(
        objectFlags=flags,
        meshVersion=m.memory[mesh + 0x1DC],
        vertexCount=count,
        vertexArray=dict(count=old_count, capacity=capacity),
    )
    m.postload(mesh)
    expected = {
        **before,
        mesh + 0x1C: flags | 0x20000000,
        mesh + 0xD8: m.memory[mesh + 0xD8],
        mesh + 0xDC: count,
        mesh + 0xE0: count,
        mesh + 0x1E4: 0,
        mesh + 0x1E8: 0,
        mesh + 0x1EC: 0,
    }
    assert {at: m.memory[at] for at in before} == expected
    assert m.array(mesh + 0xD8) == [0] * count
    m.postload_writes = dict(
        objectFlags=m.memory[mesh + 0x1C],
        field1e4=m.memory[mesh + 0x1E4],
        field1e8=m.memory[mesh + 0x1E8],
        field1ec=m.memory[mesh + 0x1EC],
        vertexArray=dict(
            count=m.memory[mesh + 0xDC],
            capacity=m.memory[mesh + 0xE0],
            words=m.array(mesh + 0xD8),
        ),
    )
    assert hexes(m.box(mesh + 0x34)) == hexes(row["localBounds"])
    m.invoke(0x106FE700, mesh, [0x600000, 0x200000])
    assert m.registers["eax"] == 0x600000
    return dict(bounds=hexes(m.box(0x600000)), events=m.bound_events), m


def admission_fixtures():
    """Authored ordered boxes; repeated updates exercise removal and level modes."""
    rows = fixture_rows()
    cases = []
    for sequence in range(8):
        operations = []
        for phase in range(3):
            for actor in range(12):
                row = dict(rows[sequence * 36 + phase * 12 + actor])
                location = [
                    f32((actor % 3 - 1) * 100 + phase),
                    f32((actor % 4 - 2) * 100),
                    f32(sequence * 10),
                ]
                if phase == 1 and actor % 4 == 0:
                    location[0] = 500000.0
                matrix = row["matrix"][:]
                matrix[12:15] = location
                auxiliary = row["auxiliary"]
                if auxiliary is not None:
                    auxiliary = dict(
                        min=[f32(v - 20) for v in location],
                        max=[f32(v + 20) for v in location],
                        valid=auxiliary["valid"],
                    )
                row.update(
                    location=location,
                    matrix=matrix,
                    auxiliary=auxiliary,
                    identity=actor,
                    kind="remove" if phase == 2 and actor % 5 == 0 else "update",
                    flags64=0x80 if phase == 1 and actor % 5 == 1 else 0,
                    flags2e4=0x4000 if phase == 1 and actor % 5 == 2 else 0,
                    level=(
                        None
                        if (actor + phase) % 3 == 0
                        else {"infoFlags554": 2 if phase == 2 else 0}
                    ),
                )
                operations.append(row)
        cases.append(operations)
    return cases


def native_admission(program, operations):
    m = StaticBoundsMachine(program)
    provider, root = 0x120000, 0x100000
    m.memory.update({provider: 0x108B3024, provider + 4: root})
    m.invoke(0x10601A10, root)
    m.invoke(0x108464A0)
    identities, answers = {}, []
    for row in operations:
        actor = 0x200000 + row["identity"] * 0x1000
        if actor not in identities:
            identities[actor] = row["identity"]
            m.invoke(0x101091F0, actor + 0x168)
            for offset in (0x174, 0x180, 0x190, 0x19C, 0x33C):
                m.memory.update({actor + offset + i * 4: 0.0 for i in range(3)})
            m.memory[actor + 0x74] = 2
        setup_actor(m, row, actor)
        m.memory.update(
            {
                actor + 0x64: row["flags64"],
                actor + 0x2E4: row["flags2e4"],
                actor + 0xE4: 0x500000 if row["level"] is not None else 0,
            }
        )
        if row["level"] is not None:
            m.memory.update(
                {
                    0x500038: 0x510000,
                    0x510000: 0x520000,
                    0x520554: row["level"]["infoFlags554"],
                }
            )
        start = len(m.visited)
        m.bound_events = []
        m.admission_events = []
        m.invoke(
            0x106025E0 if row["kind"] == "remove" else 0x10602B30, provider, [actor]
        )
        visited = set(m.visited[start:])
        writes = []
        if 0x10602C4C in visited:
            writes += ["cachedBounds", "cachedCenter", "cachedExtent"]
        if 0x10602CE3 in visited or 0x10602CFE in visited:
            writes += ["flags74"]
        if 0x10602D30 in visited:
            writes += ["storedLocation"]
        disposition = (
            "removed"
            if row["kind"] == "remove"
            else (
                "inserted"
                if "storedLocation" in writes
                else "outside-root" if "cachedBounds" in writes else "skipped"
            )
        )
        v = lambda offset: [m.memory[actor + offset + i * 4] for i in range(3)]
        cache = hexes(
            dict(
                cachedBounds=dict(min=v(0x174), max=v(0x180)),
                cachedCenter=v(0x190),
                cachedExtent=v(0x19C),
                storedLocation=v(0x33C),
                flags74=m.memory[actor + 0x74],
            )
        )
        state = snapshot(m, root, identities)
        state["memberships"] = [
            dict(identity=k, nodes=v) for k, v in state["memberships"].items()
        ]
        answers.append(
            dict(
                **state,
                cache=cache,
                writes=sorted(writes),
                disposition=disposition,
                boundsEvents=m.bound_events,
                admissionEvents=[r for r in m.admission_events if r[0] != "remove"],
            )
        )
    return answers, m


SCRIPT = r"""
import fs from 'node:fs';
const api=await import(process.argv[1]);
const value=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?value(v):v;
const box=b=>({min:b.min.map(bits),max:b.max.map(bits),valid:b.valid});
process.stdout.write(JSON.stringify(decode(JSON.parse(fs.readFileSync(0,'utf8'))).map(row=>{
 const events=[];
 const r=api.prepareStaticMeshBounds({...row,arithmeticProfile:'pc53-rne',ownerIdentity:0x200000,
  collisionModel:row.auxiliary===null?null:0x400000,
  readLocalToWorld:owner=>{events.push(['local',owner]);return {status:'ready',matrix:row.matrix};},
  getCollisionModelBounds:(model,owner)=>{events.push(['model',model,owner]);return {status:'ready',bounds:row.auxiliary};},
 });
 if(r.status!=='ready')throw Error(JSON.stringify(r));
 return {bounds:box(r.bounds),events};
})));
"""


POSTLOAD_SCRIPT = (
    SCRIPT.replace(
        "const api=await import(process.argv[1]);",
        "const api=await import(process.argv[1]);const mesh=await import(new URL('./static-mesh-tree.js',process.argv[1]));",
    )
    .replace(
        ".map(row=>{",
        ".map(({row,postload})=>{const loaded=mesh.postLoadStaticMesh(postload);if(loaded.status!=='ready')throw Error(JSON.stringify(loaded));",
    )
    .replace(
        "return {bounds:box(r.bounds),events};",
        "return {bounds:box(r.bounds),events,writes:loaded.writes};",
    )
)


ADMISSION_SCRIPT = r"""
import fs from 'node:fs';
const helpers=await import(process.argv[1]);
const api=await import(new URL('./actor-octree.js',process.argv[1]));
const val=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?val(v):v;
const ready=r=>{if(r.status!=='ready')throw Error(JSON.stringify(r));return r;};
const hexBox=b=>({min:b.min.map(bits),max:b.max.map(bits)});
const profile={arithmeticProfile:'pc53-rne'};
process.stdout.write(JSON.stringify(decode(JSON.parse(fs.readFileSync(0,'utf8'))).map(operations=>{
 const {tree}=ready(api.createActorOctree({...profile,volume:{center:[0,0,0],halfExtent:360448}}));
 const fields=new Map();
 return operations.map(row=>{
  const identity=row.identity,owner=0x200000+identity*0x1000;
  if(!fields.has(identity)) fields.set(identity,{cachedBounds:{min:[0,0,0],max:[0,0,0]},cachedCenter:[0,0,0],cachedExtent:[0,0,0],storedLocation:[0,0,0],flags74:2});
  const cache=fields.get(identity),boundsEvents=[],admissionEvents=[];
  const r=ready(row.kind==='remove'?api.removeActorOctree(tree,identity):api.updateActorOctree(tree,{
   ...row,flags2f8:row.ownerFlags2f8|1,flags74:cache.flags74,storedLocation:cache.storedLocation,
   getPrimitive:()=>{
    const result=ready(helpers.selectActorPrimitive({primitive104:0x300000}));
    const count=ready(api.inspectActorOctree(tree)).memberships.find(a=>a.identity===identity).nodes.length;
    admissionEvents.push(['primitive',result.primitiveIdentity,count]);return result;
   },
   getPrimitiveBounds:(primitive)=>{
    admissionEvents.push(['bounds',primitive,owner]);
    return helpers.prepareStaticMeshBounds({...row,...profile,ownerIdentity:owner,
     collisionModel:row.auxiliary===null?null:0x400000,
     readLocalToWorld:who=>{boundsEvents.push(['local',who]);return {status:'ready',matrix:row.matrix};},
     getCollisionModelBounds:(model,who)=>{boundsEvents.push(['model',model,who]);return {status:'ready',bounds:row.auxiliary};},
    });
   },
  }));
  Object.assign(cache,r.writes);
  const {nodes,memberships}=ready(api.inspectActorOctree(tree));
  return {nodes,memberships,boundsEvents,admissionEvents,disposition:r.disposition??'removed',writes:Object.keys(r.writes??{}).sort(),
   cache:{cachedBounds:hexBox(cache.cachedBounds),cachedCenter:cache.cachedCenter.map(bits),cachedExtent:cache.cachedExtent.map(bits),storedLocation:cache.storedLocation.map(bits),flags74:cache.flags74}};
 });
})));
"""


def load_program(engine, core, comparison_engine, comparison_core):
    e, c = Image(Path(engine), ENGINE_SHA, True), Image(Path(core), CORE_SHA)
    ce, cc = PEImage(Path(comparison_engine), CANDIDATE_ENGINE_SHA), PEImage(
        Path(comparison_core), CANDIDATE_CORE_SHA
    )
    return qualify(
        qualify_admission(
            qualify_membership(
                qualify_bounds(source_program(e, ce), c, ce, cc), c, ce, cc
            ),
            c,
            ce,
            cc,
        ),
        c,
        ce,
        cc,
    )


FRESH_SCRIPT = r"""
import fs from 'node:fs';
const api=await import(new URL('./static-mesh-tree.js',process.argv[1]));
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(rows.map(({source,classFlags})=>{
 const r=api.prepareFreshStaticMeshTree(source,{classFlags});
 if(r.status!=='ready')throw Error(JSON.stringify(r));
 const fromSource=api.prepareFreshStaticMeshTree(source);
 if(JSON.stringify(fromSource.loadingFlags)!==JSON.stringify(r.loadingFlags)||
    JSON.stringify(fromSource.postLoadWrites)!==JSON.stringify(r.postLoadWrites))
   throw Error('source class bits differ from explicit current class state');
 return {loadingFlags:r.loadingFlags,writes:r.postLoadWrites};
})));
"""


ACTOR_FRESH_SCRIPT = r"""
import fs from 'node:fs';
const api=await import(new URL('./actor-loading.js',process.argv[1]));
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(rows.map(row=>{
 const loading=api.freshObjectLoadingFlags(row.savedFlags,row.classFlags);
 if(loading.status!=='ready')throw Error(JSON.stringify(loading));
 const result=api.postLoadStaticActor({...row.postLoad,
   objectFlags:loading.flags.beforePostLoad,classFlags:row.classFlags});
 if(result.status!=='ready')throw Error(JSON.stringify(result));
 return {loadingFlags:loading.flags,writes:result.writes};
})));
"""


def fresh_actor_loading_cases(program, runtime):
    """Join flag stages, default copy, ctor and bounded actor PostLoad.

    This executes InitProperties with a supplied class-default buffer and a
    reduced specialized-copy list containing Attached. Other property/reference
    copies have their own differential checks. Decoded payload writes remain an
    explicit boundary; no UObject archive or script frame is executed here.
    """
    rng = random.Random(0x41545441)
    rows, expected, visited, steps = [], [], set(), 0
    actor, export, cls, template, prop, inner = (
        0x200000,
        0x300000,
        0x400000,
        0x500000,
        0x600000,
        0x610000,
    )
    array = program.receipt["actorLoading"]["attached"]
    class_bits = program.receipt["actorClassLoading"]
    counters = program.receipt["actorLoading"]["actorCounters"]
    for n in range(128):
        saved_flags = (
            0x02070001 if not n else (rng.getrandbits(32) & ~0x100) | 0x02000000
        )
        class_flags = (rng.getrandbits(32) & ~class_bits["mask"]) | class_bits["value"]
        m = StaticBoundsMachine(program)
        storage = {actor + off: rng.getrandbits(32) for off in range(0, 0x3F8, 4)}
        defaults = {template + off: rng.getrandbits(32) for off in range(0, 0x3F8, 4)}
        defaults.update({template + 0x1F0 + off: 0 for off in (0, 4, 8)})
        m.memory.update(
            storage
            | defaults
            | {
                export + 0x10: saved_flags,
                cls + 0x4A4: class_flags,
                actor + 0x24: cls,
                cls + 0x4F4: template,
                cls + 0x4F8: 0x3F8,
                cls + 0x78: prop,
                prop: int(array["vtable"], 16),
                prop + 0x40: 1,
                prop + 0x44: 12,
                prop + 0x48: array["layout"]["propertyFlags"],
                prop + 0x54: 0x1F0,
                prop + 0x60: 0,
                prop + 0x78: inner,
                inner + 0x44: 4,
                inner + 0x48: array["inner"]["propertyFlags"],
                int(array["vtable"], 16) + 0xA8: int(array["copyTarget"], 16),
            }
        )
        m.registers["esi"] = export
        m.execute_until(0x10149791, 0x101497A0)
        created = m.registers["ecx"]
        m.registers.update(edi=cls, ebx=created, ebp=0xE00000, esi=actor)
        m.execute_until(0x10167BE4, 0x10167BF6)
        allocated = m.registers["ebx"]
        m.execute_until(0x10167C10, 0x10167C13)
        header = {at: m.memory[at] for at in range(actor, actor + 0x34, 4)}
        # InitProperties is cdecl: restore the caller's seven argument slots.
        sp, previous_link = m.registers["esp"], m.memory[0]
        saved_registers = {
            name: m.registers[name] for name in ("ebx", "esi", "edi", "ebp")
        }
        for value in reversed([actor, 0x3F8, cls, 0, 0, actor, 0]):
            m.push(value)
        m.push(0)
        m.execute_until(0x1015FB00)
        assert (
            m.registers["esp"] == sp - 28
            and m.memory[0] == previous_link
            and not m.stack
        )
        m.registers["esp"] = sp
        assert {name: m.registers[name] for name in saved_registers} == saved_registers
        assert {at: m.memory[at] for at in header} == header
        assert all(
            m.memory[actor + off] == defaults[template + off]
            for off in range(0x34, 0x3F8, 4)
        )
        assert m.array(actor + 0x1F0) == []
        for iat, address in counters.items():
            m.memory[int(iat, 16)] = address
            m.memory[address] = 0
        m.memory.update({0x103307E8: 0, 0x103307EC: 0, 0x103307F0: 0})
        m.invoke(0x103C2A40, actor)
        assert m.memory[actor + 0x1C] == allocated and m.array(actor + 0x1F0) == []
        # Explicit decoded collision payload boundary. The separate property
        # differentials exercise ordered tag admission and source value copies.
        rotation = [rng.randrange(-0x80000000, 0x80000000) for _ in range(3)]
        m.memory.update(
            {
                actor + 0x1C8 + i * 4: value & 0xFFFFFFFF
                for i, value in enumerate(rotation)
            }
        )
        m.memory[actor + 0x278] = 0
        word, mask = m.memory[actor + 0x5C], rng.getrandbits(32) if n else 0
        m.registers["esi"] = actor
        m.execute_until(0x10148C70, 0x10148C82)
        serializing = m.memory[actor + 0x1C]
        m.execute_until(0x1015E84B, 0x1015E852)
        m.execute_until(0x10148C95, 0x10148C9C)
        serialized = m.memory[actor + 0x1C]
        before = {at: m.memory[at] for at in storage}
        m.memory[m.memory[actor] + 0x24] = program.engine.exported(
            "?PostLoad@AActor@@UAEXXZ"
        )
        m.invoke(0x1015E650, actor)
        changed = {
            actor + 0x1C,
            actor + 0x5C,
            actor + 0x2D0,
            actor + 0x2D4,
            actor + 0x2D8,
        }
        assert all(
            m.memory[at] == value for at, value in before.items() if at not in changed
        )
        assert m.memory[actor + 0x5C] == word | 0x40
        assert {at: m.memory[at] for at in defaults} == defaults
        sway = [m.memory[actor + 0x2D0 + i * 4] for i in range(3)]
        sway = [v - 0x100000000 if v & 0x80000000 else v for v in sway]
        rows.append(
            dict(
                savedFlags=saved_flags,
                classFlags=class_flags,
                postLoad=dict(
                    brushReference=None,
                    attachedCount=0,
                    rotation=rotation,
                    flags5c=dict(mask=mask, value=word & mask),
                ),
            )
        )
        expected.append(
            dict(
                loadingFlags=dict(
                    created=created,
                    allocated=allocated,
                    serializing=serializing,
                    serialized=serialized,
                    beforePostLoad=m.before_postload_flags,
                ),
                writes=dict(
                    objectFlags=m.memory[actor + 0x1C],
                    swayRotationOrig=sway,
                    flags5c=dict(
                        mask=mask | 0x40, value=m.memory[actor + 0x5C] & (mask | 0x40)
                    ),
                ),
            )
        )
        visited.update(m.visited)
        steps += len(m.visited)
    actual = browser_outputs(ACTOR_FRESH_SCRIPT, rows, Path(runtime))
    assert len(actual) == len(expected)
    for n, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("fresh actor loading", n, rows[n], a, b)
    return dict(
        cases=len(rows),
        instructions=steps,
        uniqueInstructions=len(visited),
        browserStateCompared=True,
        defaultBufferPreserved=True,
        unknownFlagBitsPreserved=True,
        scope="fresh collision-state stages with supplied CDO/payload, empty Attached and null Brush",
        limits=[
            "Reduced specialized default-copy list; full class construction, archive application, script frame and world population are not executed.",
            "Memory copy/zero/allocation use the explicitly supplied memory provider.",
        ],
    )


def fresh_loading_cases(program, runtime):
    """Actual flag instructions and complete ConditionalPostLoad/PostLoad.

    CDO/class loading and archive payload application are NOT simulated as
    success callbacks. Fresh storage and the admitted decoded payload are
    explicit boundaries between the compared source stages.
    """
    rng = random.Random(0x46524553)
    rows, expected, visited, steps = [], [], set(), 0
    edge_flags = [0, 0xF0004, 0x04000000, 0xFDFFFEFF]
    for n in range(256):
        flags = (
            edge_flags[n] if n < len(edge_flags) else rng.getrandbits(32) & ~0x02000100
        )
        class_flags = rng.getrandbits(32) & ~0x400
        source = dict(
            sourceClass="Engine.StaticMesh",
            classLoading=dict(
                sourceClass="Engine.StaticMesh",
                scope="ordinary-native-registration",
                mask=0x408,
                value=class_flags & 0x408,
            ),
            fileVersion=123,
            savedProperties=dict(
                savedExportFlags=flags,
                tags=[
                    dict(name=d["name"], type=d["type"], index=0, struct=None)
                    for d in program.receipt["freshLoading"]["declarations"]
                ],
            ),
            savedLocalBounds=dict(min=[0, 0, 0], max=[10, 10, 0], valid=1),
            loadTail=dict(fields={"0x1dc": dict(encoding="i32", value=8)}),
            vertices=[[0, 0, 0], [10, 0, 0], [0, 10, 0]],
            indices=[0, 1, 2],
            materials=[0],
            collisionTree=dict(
                trianglePlanes=[[0, 0, -1, 0] + [0] * 12],
                nodes=[
                    dict(links=[0, -1, -1, -1], bounds=[0, 0, 0, 10, 10, 0], valid=1)
                ],
            ),
        )
        rows.append(dict(source=source, classFlags=class_flags))
        m = StaticBoundsMachine(program)
        mesh, export, cls = 0x300000, 0x310000, 0x320000
        m.memory.update({export + 0x10: flags, cls + 0x4A4: class_flags})
        m.registers.update(esi=export)
        m.execute_until(0x10149791, 0x101497A0)
        created = m.registers["ecx"]
        m.registers.update(edi=cls, ebx=created, ebp=0xE00000, esi=mesh)
        m.execute_until(0x10167BE4, 0x10167BF6)
        allocated = m.registers["ebx"]
        m.memory.update({mesh + off: rng.getrandbits(32) for off in range(0, 0x1FC, 4)})
        m.execute_until(0x10167C10, 0x10167C13)
        cache = program.cache_id_global
        m.memory.update(
            {
                0x11D8D900: cache,
                cache: 0,
                cache + 4: 0,
                0x103307E8: 0,
                0x103307EC: 0,
                0x103307F0: 0,
            }
        )
        m.invoke(0x106F72F0, mesh)
        assert m.memory[mesh + 0x1C] == allocated
        assert m.array(mesh + 0xD8) == []
        # Explicit decoded payload boundary: archive execution and object
        # references remain outside this differential. The constructor's empty
        # array is preserved; known declared properties cannot target it.
        m.memory.update({mesh + 0x1DC: 8, mesh + 0x7C: 3})
        m.put_box(mesh + 0x34, source["savedLocalBounds"])
        m.registers["esi"] = mesh
        m.execute_until(0x10148C70, 0x10148C82)
        serializing = m.memory[mesh + 0x1C]
        m.execute_until(0x1015E84B, 0x1015E852)
        m.execute_until(0x10148C95, 0x10148C9C)
        serialized = m.memory[mesh + 0x1C]
        m.memory[m.memory[mesh] + 0x24] = program.engine.exported(
            "?PostLoad@UStaticMesh@@UAEXXZ"
        )
        m.invoke(0x1015E650, mesh)
        assert m.box(mesh + 0x34) == source["savedLocalBounds"]
        writes = dict(
            objectFlags=m.memory[mesh + 0x1C],
            field1e4=m.memory[mesh + 0x1E4],
            field1e8=m.memory[mesh + 0x1E8],
            field1ec=m.memory[mesh + 0x1EC],
            vertexArray=dict(
                count=m.memory[mesh + 0xDC],
                capacity=m.memory[mesh + 0xE0],
                words=m.array(mesh + 0xD8),
            ),
        )
        expected.append(
            dict(
                loadingFlags=dict(
                    created=created,
                    allocated=allocated,
                    serializing=serializing,
                    serialized=serialized,
                    beforePostLoad=m.before_postload_flags,
                ),
                writes=writes,
            )
        )
        visited.update(m.visited)
        steps += len(m.visited)
    actual = browser_outputs(FRESH_SCRIPT, rows, Path(runtime))
    assert len(actual) == len(expected)
    for n, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("fresh loading", n, rows[n], a, b)
    return dict(
        cases=len(rows),
        instructions=steps,
        uniqueInstructions=len(visited),
        browserStateCompared=True,
        sourceDeclaredPropertyTypes=len(
            program.receipt["freshLoading"]["declarations"]
        ),
        classFlags="explicit current input",
        classInputForms=["explicit current word", "source-known allocation bits"],
        archivePayload="supplied boundary",
    )


def actor_boolean_loading_cases(program, runtime):
    """Run the actual property gate and Boolean writer, including both returns.

    Complete native words contain random unknown bits; the browser receives
    only the supplied known subset. Compare that subset and every native write.
    """
    rng = random.Random(0x50524F50)
    rows, expected, visited, steps = [], [], set(), 0
    tags_checked = writes = rejected = 0
    source_layout = program.receipt["actorFields"]["booleanLayout"]
    for case in range(128):
        # Half the cases retain all 82 original declaration masks/flags. The
        # other half exercise every admission-bit combination and every Boolean bit slot.
        layout = (
            source_layout
            if case < 64
            else [
                dict(
                    offset="0x64",
                    mask=0xFFFFFFFF,
                    fields=[
                        dict(
                            name=f"authored{n}",
                            mask=1 << n,
                            propertyFlags=(rng.getrandbits(32) & ~0x20003000)
                            | (0x1000 if n & 1 else 0)
                            | (0x2000 if n & 2 else 0)
                            | (0x20000000 if n & 4 else 0),
                        )
                        for n in range(32)
                    ],
                )
            ]
        )
        archive = dict(
            loading=bool(case & 1), saving=bool(case & 2), persistent=bool(case & 4)
        )
        m = StaticBoundsMachine(program)
        actor, prop, ar, tag_ptr = 0x200000, 0x300000, 0x400000, 0x500000
        m.memory.update({actor + n: rng.getrandbits(32) for n in range(0, 0x400, 4)})
        fields, words, known = {}, {}, {}
        for group in layout:
            offset = int(group["offset"], 16)
            mask = rng.getrandbits(32)
            known[group["offset"]] = mask
            words[group["offset"]] = dict(
                mask=mask, value=m.memory[actor + offset] & mask
            )
            fields.update({f["name"]: (f, offset) for f in group["fields"]})
        m.memory.update(
            {
                ar + 0x10: int(archive["loading"]),
                ar + 0x14: int(archive["saving"]),
                ar + 0x1C: int(archive["persistent"]),
            }
        )
        tags = [dict(name=name, value=bool(rng.getrandbits(1))) for name in fields]
        rng.shuffle(tags)
        tags += [dict(name=t["name"], value=not t["value"]) for t in tags[::3]]
        skipped = []
        initial = {
            at: value for at, value in m.memory.items() if actor <= at < actor + 0x400
        }
        last_values = dict(initial)
        for index, tag in enumerate(tags):
            field, offset = fields[tag["name"]]
            m.memory.update(
                {
                    prop + 0x48: field["propertyFlags"],
                    prop + 0x24: 0x10338240,
                    prop + 0x78: field["mask"],
                    tag_ptr: 0x8000 if tag["value"] else 0,
                }
            )
            before = len(m.visited)
            m.invoke(0x1010B6D0, prop, [ar])
            admitted = m.registers["eax"]
            assert admitted in (0, 1)
            if admitted:
                m.invoke(0x10131090, tag_ptr, [ar, prop, actor + offset, 0])
            else:
                skipped.append(index)
            did_write = any(at in (0x101310F8, 0x10131101) for at in m.visited[before:])
            if did_write:
                key = hex(offset)
                known[key] |= field["mask"]
                writes += 1
                assert (
                    last_values[actor + offset] ^ m.memory[actor + offset]
                ) & ~field["mask"] == 0
                last_values[actor + offset] = m.memory[actor + offset]
            assert {at: m.memory[at] for at in initial} == last_values
        rows.append(dict(layout=layout, words=words, tags=tags, archive=archive))
        expected.append(
            dict(
                status="ready",
                scope="original-actor-boolean-loading",
                skipped=skipped,
                groups={
                    key: dict(mask=mask, value=m.memory[actor + int(key, 16)] & mask)
                    for key, mask in known.items()
                },
            )
        )
        tags_checked += len(tags)
        rejected += len(skipped)
        visited.update(m.visited)
        steps += len(m.visited)
    script = r"""
const { applyActorBooleanTags } = await import(new URL('./actor-loading.js', process.argv[1]));
let raw=''; for await (const part of process.stdin) raw+=part;
process.stdout.write(JSON.stringify(JSON.parse(raw).map(applyActorBooleanTags)));
"""
    actual = browser_outputs(script, rows, Path(runtime))
    assert len(actual) == len(expected)
    for index, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("actor Boolean loading", index, a, b)
    return dict(
        cases=len(rows),
        tags=tags_checked,
        writes=writes,
        rejected=rejected,
        instructions=steps,
        uniqueInstructions=len(visited),
        scope="supplied archive modes, declarations and incoming known bits",
        preservedUnwrittenBits=True,
        repeatedTags=True,
    )


def actor_transform_loading_cases(program, runtime):
    """Run source property gates, struct dispatch/iteration and scalar stores.

    Incoming default values and linked reflection metadata are explicit. This
    does not execute allocation, whole class-default construction or archive I/O.
    """
    rng = random.Random(0x5452414E)
    proof = program.receipt["actorTransformLoading"]
    offsets = dict(
        Location=0x1BC,
        Rotation=0x1C8,
        DrawScale=0x27C,
        DrawScale3D=0x280,
        PrePivot=0x28C,
    )
    rows, expected, visited = [], [], set()
    steps = tag_count = skipped_count = read_count = 0
    for case in range(128):
        layout = [dict(field) for field in proof["layout"]]
        if case >= 64:
            for index, field in enumerate(layout):
                field["propertyFlags"] = (rng.getrandbits(32) & ~0x20003000) | (
                    (0x1000 if index & 1 else 0)
                    | (0x2000 if index & 2 else 0)
                    | (0x20000000 if index & 4 else 0)
                )

        def value(field):
            if field["name"] == "Rotation":
                return [rng.randrange(-0x80000000, 0x80000000) for _ in range(3)]
            scalar = lambda: (
                -0.0 if rng.randrange(8) == 0 else rng.randrange(-100000, 100001) / 16.0
            )
            return (
                scalar()
                if field["kind"] == "FloatProperty"
                else [scalar() for _ in range(3)]
            )

        def words(field, v):
            values = v if isinstance(v, list) else [v]
            fmt = "<i" if field["name"] == "Rotation" else "<f"
            return [struct.unpack("<I", struct.pack(fmt, part))[0] for part in values]

        defaults = {field["name"]: value(field) for field in layout}
        tags = [dict(name=field["name"], value=value(field)) for field in layout]
        rng.shuffle(tags)
        tags += [dict(name=field["name"], value=value(field)) for field in layout[::2]]
        archive = dict(loading=True, saving=False, persistent=bool(case & 1))
        m = StaticBoundsMachine(program)
        actor, ar, prop, struct_ptr, property_class, children = (
            0x200000,
            0x300000,
            0x400000,
            0x500000,
            0x600000,
            0x700000,
        )
        initial = {actor + off: rng.getrandbits(32) for off in range(0, 0x400, 4)}
        m.memory.update(initial)
        m.transform_archive = ar
        m.transform_struct = struct_ptr
        m.transform_reads = []
        m.memory.update(
            {
                ar: 0xA90000,
                0xA90004: 0xA80000,
                0xA90010: 0xA80010,
                0xA90028: 0xA80028,
                ar + 4: 123,
                ar + 0x10: 1,
                ar + 0x14: 0,
                ar + 0x1C: int(archive["persistent"]),
                property_class + 0x4A4: 0x8000,
            }
        )
        tables = {}
        for row in proof["vtables"]:
            table, slot, target = (
                int(row[k], 16) for k in ("address", "slot", "target")
            )
            m.memory[table + slot] = target
            tables[row["name"]] = table
        fields = {field["name"]: field for field in layout}
        consumed = set()
        for field in layout:
            for index, word in enumerate(words(field, defaults[field["name"]])):
                address = actor + offsets[field["name"]] + index * 4
                m.memory[address] = word
                consumed.add(address)
        skipped = []
        for index, tag in enumerate(tags):
            field = fields[tag["name"]]
            m.memory[prop + 0x48] = field["propertyFlags"]
            m.invoke(0x1010B6D0, prop, [ar])
            if not m.registers["eax"]:
                skipped.append(index)
                continue
            payload = words(field, tag["value"])
            m.transform_payload = list(payload)
            destination = actor + offsets[field["name"]]
            before = len(m.transform_reads)
            if field["kind"] == "FloatProperty":
                m.invoke(0x101715F0, prop, [ar, destination, 4])
            else:
                name = "Rotator" if field["name"] == "Rotation" else "Vector"
                native_name = next(
                    row["index"] for row in proof["nativeNames"] if row["name"] == name
                )
                m.memory.update(
                    {
                        prop + 0x78: struct_ptr,
                        struct_ptr: tables["??_7UStruct@@6B@"],
                        struct_ptr + 0x20: native_name,
                        struct_ptr + 0x34: 0,
                        struct_ptr + 0x48: children,
                    }
                )
                for component, declaration in enumerate(
                    proof["componentLayouts"][name]
                ):
                    ptr = children + component * 0x100
                    m.memory.update(
                        {
                            ptr: tables[
                                (
                                    "??_7UIntProperty@@6B@"
                                    if name == "Rotator"
                                    else "??_7UFloatProperty@@6B@"
                                )
                            ],
                            ptr + 0x20: component + 1000,
                            ptr + 0x24: property_class,
                            ptr + 0x38: ptr + 0x100 if component < 2 else 0,
                            ptr + 0x40: 1,
                            ptr + 0x44: 4,
                            ptr + 0x48: declaration["propertyFlags"],
                            ptr + 0x54: component * 4,
                        }
                    )
                m.invoke(0x101727D0, prop, [ar, destination, 12])
            assert not m.transform_payload
            assert m.transform_reads[before:] == [
                destination + off * 4 for off in range(len(payload))
            ]
        assert {at: m.memory[at] for at in initial if at not in consumed} == {
            at: word for at, word in initial.items() if at not in consumed
        }
        rows.append(dict(layout=layout, defaults=defaults, tags=tags, archive=archive))
        expected.append(
            dict(
                status="ready",
                scope="original-actor-transform-loading",
                skipped=skipped,
                words={
                    field["name"]: [
                        m.memory[actor + offsets[field["name"]] + n * 4]
                        for n in range(1 if field["kind"] == "FloatProperty" else 3)
                    ]
                    for field in layout
                },
            )
        )
        visited.update(m.visited)
        steps += len(m.visited)
        tag_count += len(tags)
        skipped_count += len(skipped)
        read_count += len(m.transform_reads)
    script = r"""
const {applyActorTransformTags}=await import(new URL('./actor-loading.js',process.argv[1]));
let raw='';for await(const part of process.stdin)raw+=part;
const word=(value,integer)=>{const b=new DataView(new ArrayBuffer(4));
 if(integer)b.setInt32(0,value,true);else b.setFloat32(0,value,true);return b.getUint32(0,true);};
process.stdout.write(JSON.stringify(JSON.parse(raw).map(input=>{
 const r=applyActorTransformTags(input);if(r.status!=='ready')return r;
 const words=Object.fromEntries(Object.entries(r.values).map(([name,value])=>[name,
  (Array.isArray(value)?value:[value]).map(v=>word(v,name==='Rotation'))]));
 return {status:r.status,scope:r.scope,skipped:r.skipped,words};
})));
"""
    actual = browser_outputs(script, rows, Path(runtime))
    assert (
        actual == expected
    ), "browser actor transform loading differs from source instructions"
    return dict(
        cases=len(rows),
        tags=tag_count,
        skipped=skipped_count,
        scalarReads=read_count,
        instructions=steps,
        uniqueInstructions=len(visited),
        signedZeroAndInt32BitsPreserved=True,
        unrelatedActorStoragePreserved=True,
        scope="source gates/struct dispatch/field iteration/scalar writes; supplied defaults, reflection metadata and archive bytes",
    )


def actor_reference_loading_cases(program, runtime):
    """Compare ordinary default copies, property gates, index routing and writes.

    These are bounded composed stages. Factory replies and decoded indices are
    supplied; native archive I/O, import discovery and allocation are not run.
    """
    rng = random.Random(0x52454653)
    source_layout = program.receipt["actorFields"]["savedReferenceDeclarations"]
    assert all(not f["propertyFlags"] & 0x400000 for f in source_layout)
    rows, expected, visited = [], [], set()
    steps, tag_count, copy_count, skipped_count, factory_count = 0, 0, 0, 0, 0
    for case in range(128):
        layout = [dict(f) for f in source_layout]
        if case >= 64:
            for index, field in enumerate(layout):
                field["propertyFlags"] = (rng.getrandbits(32) & ~0x20403000) | (
                    (0x1000 if index & 1 else 0)
                    | (0x2000 if index & 2 else 0)
                    | (0x20000000 if index & 4 else 0)
                )
        archive = dict(loading=True, saving=False, persistent=bool(case & 1))
        m = StaticBoundsMachine(program)
        actor, defaults_ptr, prop, ar, linker = (
            0x200000,
            0x210000,
            0x300000,
            0x400000,
            0x500000,
        )
        export_replies = [0 if n == case % 5 else 0x600000 + n * 256 for n in range(5)]
        import_replies = [0 if n == case % 4 else 0x700000 + n * 256 for n in range(4)]
        m.reference_linker, m.reference_archive = linker, ar
        m.reference_events = []
        m.reference_replies = {"export": export_replies, "import": import_replies}
        m.memory.update(
            {
                0x1023E8C4: case & 1,
                0x1023E8CC: case & 2,
                ar: 0xA71000,
                0xA71018: 0xA70000,
                ar + 0x10: 1,
                ar + 0x14: 0,
                ar + 0x1C: int(archive["persistent"]),
                linker + 0x94: len(export_replies),
                linker + 0x88: len(import_replies),
                prop + 0x40: 1,
            }
        )
        defaults, fields = {}, {}
        for index, field in enumerate(layout):
            offset = index * 4
            value = rng.choice([0, 0x800000 + index * 256])
            m.memory[defaults_ptr + offset] = value
            m.memory[actor + offset] = 0xFFFFFFFF
            m.memory[prop + 0x48] = field["propertyFlags"]
            m.invoke(0x10171740, prop, [actor + offset, defaults_ptr + offset, actor])
            assert m.memory[actor + offset] == value
            defaults[field["name"]] = value or None
            fields[field["name"]] = (field, offset)
            copy_count += 1
        initial_defaults = {
            at: m.memory[at]
            for at in range(defaults_ptr, defaults_ptr + len(layout) * 4, 4)
        }
        tags = [
            dict(name=name, reference=rng.randrange(-4, 6), package="authored")
            for name in fields
        ]
        tags += [
            dict(tag, reference=-tag["reference"] if abs(tag["reference"]) < 5 else 0)
            for tag in tags[::2]
        ]
        skipped = []
        for index, tag in enumerate(tags):
            field, offset = fields[tag["name"]]
            m.memory[prop + 0x48] = field["propertyFlags"]
            m.invoke(0x1010B6D0, prop, [ar])
            if not m.registers["eax"]:
                skipped.append(index)
                continue
            m.invoke(0x1014B290, linker, [tag["reference"]])
            m.reference_reply = m.registers["eax"]
            m.invoke(0x1016ED90, prop, [ar, actor + offset, 0])
            assert m.memory[actor + offset] == m.reference_reply
        assert {at: m.memory[at] for at in initial_defaults} == initial_defaults
        rows.append(
            dict(
                layout=layout,
                defaults=defaults,
                tags=tags,
                archive=archive,
                exportReplies=export_replies,
                importReplies=import_replies,
            )
        )
        expected.append(
            dict(
                status="ready",
                scope="original-actor-reference-loading",
                references={
                    name: m.memory[actor + offset] or None
                    for name, (_, offset) in fields.items()
                },
                skipped=skipped,
                factories=m.reference_events,
            )
        )
        tag_count += len(tags)
        skipped_count += len(skipped)
        factory_count += len(m.reference_events)
        steps += len(m.visited)
        visited.update(m.visited)
    script = r"""
const {applyActorReferenceTags,resolvePackageReference}=await import(new URL('./actor-loading.js',process.argv[1]));
let raw='';for await(const part of process.stdin)raw+=part;
const results=JSON.parse(raw).map(row=>{
 const factories=[];
 const linker={exportCount:row.exportReplies.length,importCount:row.importReplies.length,
  createExport(index,flags){if(flags!==0)throw Error('wrong export flags');factories.push(['export',index]);return {status:'ready',value:row.exportReplies[index]||null};},
  createImport(index){factories.push(['import',index]);return {status:'ready',value:row.importReplies[index]||null};}};
 return {...applyActorReferenceTags({...row,resolveReference:(pkg,ref)=>{
  if(pkg!=='authored')throw Error('wrong package');return resolvePackageReference(linker,ref);
 }}),factories};
});
process.stdout.write(JSON.stringify(results));
"""
    actual = browser_outputs(script, rows, Path(runtime))
    assert len(actual) == len(expected)
    for index, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, ("actor reference loading", index, a, b)
    return dict(
        cases=len(rows),
        defaultCopies=copy_count,
        tags=tag_count,
        skipped=skipped_count,
        factoryCalls=factory_count,
        instructions=steps,
        uniqueInstructions=len(visited),
        scope="supplied dimension-one defaults, decoded indices and factory replies; not a complete map load",
        browserStateCompared=True,
        defaultStoragePreserved=True,
    )


def verify(engine, core, comparison_engine, comparison_core, runtime):
    program = load_program(engine, core, comparison_engine, comparison_core)
    model_bounds = model_bounds_cases(program, runtime)
    actor_loading = actor_loading_cases(program)
    actor_fields = actor_field_cases(program)
    actor_boolean_loading = actor_boolean_loading_cases(program, runtime)
    actor_reference_loading = actor_reference_loading_cases(program, runtime)
    actor_transform_loading = actor_transform_loading_cases(program, runtime)
    level_mode = level_collision_mode_cases(program, runtime)
    level_population = level_population_cases(program)
    joined_population = joined_level_population_cases(program, runtime)
    level_loading = level_loading_cases(program, runtime)
    construction = constructor_cases(program)
    fresh_loading = fresh_loading_cases(program, runtime)
    fresh_actor_loading = fresh_actor_loading_cases(program, runtime)
    rows = fixture_rows()
    expected = []
    visited = set()
    steps = 0
    for row in rows:
        result, m = native_one(program, row)
        expected.append(result)
        visited.update(m.visited)
        steps += len(m.visited)
    actual = browser_outputs(SCRIPT, hexes(rows), Path(runtime))
    assert len(actual) == len(expected)
    for n, (a, b) in enumerate(zip(actual, expected)):
        assert a == b, (n, rows[n], a, b)
    postload_steps, postload_visited = 0, set()
    postload_inputs, postload_expected = [], []
    for n, row in enumerate(rows):
        result, m = native_postload_one(program, row, n)
        assert result == expected[n], ("PostLoad bounds", n, result, expected[n])
        postload_inputs.append(dict(row=row, postload=m.postload_input))
        postload_expected.append(dict(**result, writes=m.postload_writes))
        postload_steps += len(m.visited)
        postload_visited.update(m.visited)
    actual = browser_outputs(POSTLOAD_SCRIPT, hexes(postload_inputs), Path(runtime))
    assert len(actual) == len(postload_expected)
    for n, (a, b) in enumerate(zip(actual, postload_expected)):
        assert a == b, ("browser mesh PostLoad", n, a, b)
    sequences = admission_fixtures()
    joined = []
    counts = {}
    for operations in sequences:
        result, m = native_admission(program, operations)
        joined.append(result)
        visited.update(m.visited)
        steps += len(m.visited)
        for result_row in result:
            key = result_row["disposition"]
            counts[key] = counts.get(key, 0) + 1
    actual = browser_outputs(ADMISSION_SCRIPT, hexes(sequences), Path(runtime))
    assert len(actual) == len(joined)
    for n, (a, b) in enumerate(zip(actual, joined)):
        assert len(a) == len(b)
        for step, (x, y) in enumerate(zip(a, b)):
            assert x == y, (
                "static bounds admission",
                n,
                step,
                sequences[n][step],
                x,
                y,
            )
    return dict(
        tool="Elbera Tools",
        status="pass",
        scope="original-static-actor-bounds",
        cases=len(rows),
        sequences=len(sequences),
        operations=sum(counts.values()),
        dispositions=counts,
        instructions=steps,
        uniqueInstructions=len(visited),
        construction=construction,
        actorLoading=actor_loading,
        actorFields=actor_fields,
        actorBooleanLoading=actor_boolean_loading,
        actorReferenceLoading=actor_reference_loading,
        actorTransformLoading=actor_transform_loading,
        levelPopulation=level_population,
        joinedLevelPopulation=joined_population,
        levelCollisionMode=level_mode,
        levelLoading=level_loading,
        freshLoading=fresh_loading,
        freshActorLoading=fresh_actor_loading,
        postLoad=dict(
            cases=len(rows),
            instructions=postload_steps,
            uniqueInstructions=len(postload_visited),
            boundsUnchanged=True,
            browserStateCompared=True,
            directionFlag="clear",
        ),
        modelBounds=model_bounds,
        source=program.receipt,
        runtimeSHA256=hashlib.sha256(Path(runtime).read_bytes()).hexdigest(),
        verifierSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        constructorQualifierSHA256=hashlib.sha256(
            Path(__file__).with_name("static_collision_source.py").read_bytes()
        ).hexdigest(),
        classQualifierSHA256=hashlib.sha256(
            Path(__file__).with_name("static_mesh_class_source.py").read_bytes()
        ).hexdigest(),
        actorLoadingQualifierSHA256=hashlib.sha256(
            Path(__file__).with_name("actor_transform_source.py").read_bytes()
        ).hexdigest(),
        runtimeDependenciesSHA256={
            name: hashlib.sha256((Path(runtime).parent / name).read_bytes()).hexdigest()
            for name in [
                "actor-octree.js",
                "actor-loading.js",
                "actor-octree-geometry.js",
                "cylinder-collision.js",
                "static-mesh-tree.js",
                "static-hit.js",
                "static-triangle.js",
                "static-sweep.js",
            ]
        },
        limits=[
            "Finite authored inputs, PC53/RNE and supplied current matrices/auxiliary boxes; not live placement.",
            "FBox padding remains partially unknown; only numeric coordinates and validity byte are compared.",
            "PostLoad cases supply current version>=8, flags &0x100 clear, valid nonaliasing storage and successful allocation with direction flag clear. Saved data does not prove those current conditions.",
            "Constructor cases supply incoming object storage and nonaliasing current counters; class registration/CDO, allocation flags and archive effects are not executed or inferred.",
        ],
    )


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--engine", type=Path, default=ROOT / "assets/interlude/system/engine.dll"
    )
    p.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    p.add_argument("--comparison-engine", type=Path, required=True)
    p.add_argument("--comparison-core", type=Path, required=True)
    p.add_argument(
        "--runtime-module",
        type=Path,
        default=ROOT / "editor/world/js/actor-primitive-bounds.js",
    )
    p.add_argument("--check", action="store_true")
    a = p.parse_args()
    r = verify(
        a.engine, a.core, a.comparison_engine, a.comparison_core, a.runtime_module
    )
    print(
        json.dumps(
            (
                {
                    k: r[k]
                    for k in [
                        "scope",
                        "cases",
                        "sequences",
                        "operations",
                        "dispositions",
                        "instructions",
                        "uniqueInstructions",
                        "construction",
                        "actorLoading",
                        "actorFields",
                        "actorBooleanLoading",
                        "actorReferenceLoading",
                        "levelPopulation",
                        "joinedLevelPopulation",
                        "levelCollisionMode",
                        "levelLoading",
                        "freshLoading",
                        "freshActorLoading",
                        "actorTransformLoading",
                        "postLoad",
                        "modelBounds",
                    ]
                }
                if a.check
                else r
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
