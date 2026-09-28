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
from static_collision_source import qualify_static_postload

METHOD = "?GetCollisionBoundingBox@UStaticMesh@@UBE?AVFBox@@PBVAActor@@@Z"
LOCAL = "?LocalToWorld@AActor@@UBE?AVFMatrix@@XZ"
IMPORTS = {
    0x106FE724: ("??0FBox@@QAE@XZ", 0x1010EF70),
    0x106FE777: ("?TransformBy@FBox@@QBE?AV1@ABVFMatrix@@@Z", 0x10117DD0),
    0x106FE794: ("??1FMatrix@@QAE@XZ", 0x101111E0),
    0x106FE7C0: ("??YFBox@@QAEAAV0@ABV0@@Z", 0x10117A00),
}


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
    program.receipt = dict(
        prerequisites=prior,
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
        staticPostLoad=postload,
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
        self.current = None

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
        if i.address in (0x106FE764, 0x106FE7BB):
            sp = self.registers["esp"]
            dest = self.memory[sp]
            if i.address == 0x106FE764:
                assert self.registers["edx"] == self.source.local_thunk
                owner = self.registers["ecx"]
                self.bound_events.append(["local", owner])
                self.memory.update(
                    {dest + j * 4: v for j, v in enumerate(self.current["matrix"])}
                )
                self.registers["esp"] += 4
            else:
                assert self.registers["edx"] == 0xA60000
                self.bound_events.append(
                    ["model", self.registers["ecx"], self.memory[sp + 4]]
                )
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
                admissionEvents=[r for r in m.admission_events if r[0] != "remove"]
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


def verify(engine, core, comparison_engine, comparison_core, runtime):
    program = load_program(engine, core, comparison_engine, comparison_core)
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
        postLoad=dict(
            cases=len(rows),
            instructions=postload_steps,
            uniqueInstructions=len(postload_visited),
            boundsUnchanged=True,
            browserStateCompared=True,
            directionFlag="clear",
        ),
        source=program.receipt,
        runtimeSHA256=hashlib.sha256(Path(runtime).read_bytes()).hexdigest(),
        verifierSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        runtimeDependenciesSHA256={
            name: hashlib.sha256((Path(runtime).parent / name).read_bytes()).hexdigest()
            for name in [
                "actor-octree.js",
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
                        "postLoad",
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
