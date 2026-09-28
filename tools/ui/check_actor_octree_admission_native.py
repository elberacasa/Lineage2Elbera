#!/usr/bin/env python3
"""Elbera Tools: ordinary actor admission versus retained Interlude code.

Composes the actual selector, generic/provided primitive box, AddActor bounds,
level mode, membership and RemoveActor paths. Finite PC53/RNE and null GLog are
explicit conditions. No native DLL executes and no proprietary bytes are output.
"""

import argparse
import copy
import hashlib
import json
from pathlib import Path
import random

from check_actor_octree_native import (
    source_program,
    Image,
    ENGINE_SHA,
    CORE_SHA,
    PEImage,
    CANDIDATE_ENGINE_SHA,
    CANDIDATE_CORE_SHA,
    ROOT,
)
from actor_octree_membership_source import qualify_bounds, qualify_membership
from actor_octree_admission_source import qualify_admission
from actor_octree_admission_machine import create_admission_machine
from actor_octree_machine import snapshot
from check_static_triangle_native import f32, hexes
from check_static_mesh_native import browser_outputs

PRIMITIVES = {
    "generic": 0x300000,
    "first": 0x301000,
    "second": 0x302000,
    "third": 0x303000,
    "fallback": 0x304000,
}

SCRIPT = r"""
import fs from 'node:fs';
const api=await import(process.argv[1]);
const helpers=await import(new URL('./actor-primitive-bounds.js', process.argv[1]));
const val=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const ready=r=>{if(r.status!=='ready')throw Error(JSON.stringify(r));return r;};
const vector=v=>v.map(val);
const box=b=>({min:vector(b.min),max:vector(b.max)});
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(cases.map(c=>{
 const {tree}=ready(api.createActorOctree({arithmeticProfile:'pc53-rne', volume:{center:[0,0,0],halfExtent:360448}}));
 const fields=new Map();
 return c.operations.map(op=>{
  if(!fields.has(op.identity)) {
   const s=c.initial;
   fields.set(op.identity,{cachedBounds:box(s.cachedBounds),cachedCenter:vector(s.cachedCenter),cachedExtent:vector(s.cachedExtent),storedLocation:vector(s.storedLocation),flags74:s.flags74});
  }
  const cache=fields.get(op.identity),events=[];
  let r;
  if(op.kind==='remove') {
   events.push(['remove',op.identity]); r=ready(api.removeActorOctree(tree,op.identity));
  } else {
   r=ready(api.updateActorOctree(tree,{
    identity:op.identity,flags2f8:op.flags2f8,flags64:op.flags64,flags2e4:op.flags2e4,
    flags74:cache.flags74,location:vector(op.location),storedLocation:cache.storedLocation,
    level:op.level,
    getPrimitive:()=>{const s=ready(helpers.selectActorPrimitive(op.primitive));const n=ready(api.inspectActorOctree(tree)).memberships.find(a=>a.identity===op.identity).nodes.length;events.push(['primitive',s.primitiveIdentity,n]);return s;},
    getPrimitiveBounds:(id,actor)=>{
     events.push(['bounds',id,actor]);
     return id==='generic' ? helpers.prepareGenericPrimitiveBounds({arithmeticProfile:'pc53-rne',location:vector(op.location),collisionRadius:val(op.radius),collisionHeight:val(op.height)}) : {status:'ready',bounds:box(op.providedBounds)};
    },
   }));
   Object.assign(cache,r.writes);
  }
  const {nodes,memberships}=ready(api.inspectActorOctree(tree));
  return {nodes,memberships,events,disposition:r.disposition??'removed',
   writes:Object.keys(r.writes??{}).sort(),
   cache:{cachedBounds:{min:cache.cachedBounds.min.map(bits),max:cache.cachedBounds.max.map(bits)},cachedCenter:cache.cachedCenter.map(bits),cachedExtent:cache.cachedExtent.map(bits),storedLocation:cache.storedLocation.map(bits),flags74:cache.flags74}};
 });
})));
"""


def fixtures():
    rng = random.Random(0x41444D49)
    initial = dict(
        cachedBounds=dict(min=[11.0, 22.0, 33.0], max=[44.0, 55.0, 66.0]),
        cachedCenter=[77.0, 88.0, 99.0],
        cachedExtent=[12.0, 23.0, 34.0],
        storedLocation=[45.0, 56.0, 67.0],
        flags74=0xAA55FCFF,
    )
    cases = []

    def operation(identity, selector, level, location, skip=0):
        keys = ["primitive104", "primitive38", "primitive2b8"]
        fields = {k: None for k in keys}
        for i, k in enumerate(keys):
            if i == selector:
                fields[k] = "generic" if selector % 2 == 0 else "second"
        fields.update(
            levelIdentity="level" if level is not None else None,
            engineIdentity="engine",
            enginePrimitive50="fallback",
        )
        return dict(
            kind="update",
            identity=identity,
            flags2f8=1,
            flags64=0x80000080 if skip == 1 else 0x80000000,
            flags2e4=0xC0004000 if skip == 2 else 0xC0000000,
            location=location,
            level=level,
            primitive=fields,
            radius=f32(rng.uniform(0, 45)),
            height=f32(rng.uniform(0, 80)),
            providedBounds=dict(
                min=[f32(v - 13) for v in location], max=[f32(v + 17) for v in location]
            ),
        )

    # Existing membership survives both early gates, but root rejection removes
    # it and writes new bounds while preserving mode/location. Reentry reuses id.
    for selector in range(4):
        operations = []
        for j, (location, skip, level) in enumerate(
            [
                ([0.0, 0.0, 0.0], 0, {"infoFlags554": 0}),
                ([100.0, 100.0, 100.0], 1, {"infoFlags554": 2}),
                ([-100.0, -100.0, -100.0], 2, None),
                ([500000.0, 0.0, 0.0], 0, {"infoFlags554": 2}),
                ([100.0, 100.0, 100.0], 0, {"infoFlags554": 2}),
                ([200.0, 200.0, 200.0], 0, {"infoFlags554": 0}),
            ]
        ):
            # Ordinary fallback dereferences a level; its null-level counterpart
            # is tested with an earlier nonnull primitive instead.
            if selector == 3 and level is None:
                level = {"infoFlags554": 2}
            operations.append(operation("actor", selector, level, location, skip))
        operations.append(
            dict(
                kind="remove",
                identity="actor",
                flags2f8=1,
                flags64=0,
                location=[300.0, 300.0, 300.0],
            )
        )
        cases.append(dict(initial=copy.deepcopy(initial), operations=operations))
    for j in range(28):
        operations = []
        for k in range(32):
            identity = str(rng.randrange(8))
            selector = rng.randrange(4)
            level = rng.choice(
                [
                    None,
                    {"infoFlags554": 0},
                    {"infoFlags554": 2},
                    {"infoFlags554": 0xFFFFFFFD},
                ]
            )
            if selector == 3 and level is None:
                level = {"infoFlags554": 2}
            location = [f32(rng.uniform(-250, 250)) for _ in range(3)]
            if k % 9 == 0:
                location[0] = 500000.0
            skip = rng.choice([0, 0, 0, 1, 2]) if k % 3 else 0
            operations.append(operation(identity, selector, level, location, skip))
        cases.append(dict(initial=copy.deepcopy(initial), operations=operations))
    for location, radius, height in [
        ([1.0, 2.0, 3.0], 2.0**24, 0.0),
        ([-0.0, 0.0, -0.0], 2.0**-149, 2.0**-149),
        ([0.0, 0.0, 0.0], 360447.0, 360447.0),
        ([0.001, -0.001, 0.001], 1e-20, 1e-20),
        ([360453.1875, 0.0, 0.0], 0.0, 0.0),
        ([360453.21875, 0.0, 0.0], 0.0, 0.0),
        ([-360453.1875, 0.0, 0.0], 0.0, 0.0),
        ([-360453.21875, 0.0, 0.0], 0.0, 0.0),
    ]:
        op = operation("boundary", 0, {"infoFlags554": 0}, list(map(f32, location)))
        op.update(radius=f32(radius), height=f32(height))
        cases.append(dict(initial=copy.deepcopy(initial), operations=[op]))
    for refs in [
        ["first", "second", "third"],
        ["generic", "second", "third"],
        [None, "second", "generic"],
    ]:
        op = operation("priority", 0, {"infoFlags554": 0}, [1.0, 2.0, 3.0])
        op["primitive"].update(
            dict(zip(["primitive104", "primitive38", "primitive2b8"], refs))
        )
        cases.append(dict(initial=copy.deepcopy(initial), operations=[op]))
    return cases


def native_sequence(program, case):
    m, provider, root = create_admission_machine(program)
    identities, pointers, answers = {}, {}, []
    for name, ptr in PRIMITIVES.items():
        m.memory[ptr] = 0x10853A6C if name == "generic" else 0xA10000
    for op in case["operations"]:
        identity = op["identity"]
        if identity not in pointers:
            actor = 0x200000 + len(pointers) * 0x1000
            pointers[identity] = actor
            identities[actor] = identity
            m.invoke(0x101091F0, actor + 0x168)
            m.memory[actor] = 0x10851E6C
            init = case["initial"]
            for offset, values in [
                (0x174, init["cachedBounds"]["min"]),
                (0x180, init["cachedBounds"]["max"]),
                (0x190, init["cachedCenter"]),
                (0x19C, init["cachedExtent"]),
                (0x33C, init["storedLocation"]),
            ]:
                m.memory.update(
                    {actor + offset + i * 4: v for i, v in enumerate(values)}
                )
            m.memory[actor + 0x74] = init["flags74"]
        actor = pointers[identity]
        for key, offset in [
            ("flags2f8", 0x2F8),
            ("flags64", 0x64),
            ("flags2e4", 0x2E4),
        ]:
            if key in op:
                m.memory[actor + offset] = op[key]
        m.memory.update(
            {actor + 0x1BC + i * 4: v for i, v in enumerate(op["location"])}
        )
        start_steps, start_events = len(m.visited), len(m.admission_events)
        if op["kind"] == "update":
            level, engine, info, data = (
                actor + 0x300000,
                actor + 0x400000,
                actor + 0x500000,
                actor + 0x600000,
            )
            level_info = op["level"]
            m.memory[actor + 0xE4] = level if level_info is not None else 0
            if level_info is not None:
                m.memory.update(
                    {
                        level + 0x38: data,
                        data: info,
                        info + 0x554: level_info["infoFlags554"],
                        level + 0x74: engine,
                        engine + 0x50: PRIMITIVES["fallback"],
                    }
                )
            for key, offset in [
                ("primitive104", 0x104),
                ("primitive38", 0x38),
                ("primitive2b8", 0x2B8),
            ]:
                m.memory[actor + offset] = (
                    PRIMITIVES[op["primitive"][key]] if op["primitive"][key] else 0
                )
            m.memory.update({actor + 0x2F0: op["radius"], actor + 0x2F4: op["height"]})
            m.responses = {
                ptr: op["providedBounds"]
                for name, ptr in PRIMITIVES.items()
                if name != "generic"
            }
            m.invoke(0x10602B30, provider, [actor])
        else:
            m.invoke(0x106025E0, provider, [actor])
        visited = set(m.visited[start_steps:])
        writes = []
        if 0x10602C4C in visited:
            writes += ["cachedBounds", "cachedCenter", "cachedExtent"]
        if 0x10602CE3 in visited or 0x10602CFE in visited:
            writes += ["flags74"]
        if 0x10602D30 in visited:
            writes += ["storedLocation"]
        disposition = (
            "removed"
            if op["kind"] == "remove"
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
        names = {**identities, **{v: k for k, v in PRIMITIVES.items()}}
        events = []
        for row in m.admission_events[start_events:]:
            if row[0] == "remove" and op["kind"] == "update":
                continue  # Internal call; compare membership at the next method boundary.
            if row[0] == "primitive":
                events.append([row[0], names[row[1]], row[2]])
            else:
                events.append([row[0], *[names[p] for p in row[1:]]])
        answers.append(
            dict(
                **state,
                cache=cache,
                events=events,
                disposition=disposition,
                writes=sorted(writes)
            )
        )
    return answers, m


def verify(engine, core, comparison_engine, comparison_core, runtime):
    e, c = Image(engine, ENGINE_SHA, True), Image(core, CORE_SHA)
    ce, cc = PEImage(comparison_engine, CANDIDATE_ENGINE_SHA), PEImage(
        comparison_core, CANDIDATE_CORE_SHA
    )
    program = qualify_admission(
        qualify_membership(qualify_bounds(source_program(e, ce), c, ce, cc), c, ce, cc),
        c,
        ce,
        cc,
    )
    cases, answers = fixtures(), []
    steps, visited, counts = 0, set(), {}
    for case in cases:
        result, m = native_sequence(program, case)
        answers.append(result)
        steps += len(m.visited)
        visited.update(m.visited)
        for row in result:
            counts[row["disposition"]] = counts.get(row["disposition"], 0) + 1
    actual = browser_outputs(SCRIPT, hexes(cases), runtime)
    assert len(actual) == len(answers)
    for index, (a, b) in enumerate(zip(actual, answers)):
        assert len(a) == len(b)
        for step, (x, y) in enumerate(zip(a, b)):
            assert x == y, (
                "actor admission mismatch",
                index,
                step,
                cases[index]["operations"][step],
                x,
                y,
            )
    return dict(
        tool="Elbera Tools",
        status="pass",
        sequences=len(cases),
        operations=sum(counts.values()),
        dispositions=counts,
        steps=steps,
        coverage=[hex(v) for v in sorted(visited)],
        source=program.receipt,
        files={
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                Path(__file__),
                Path(__file__).with_name("actor_octree_admission_source.py"),
                Path(__file__).with_name("actor_octree_admission_machine.py"),
                Path(__file__).with_name("actor_octree_machine.py"),
                Path(__file__).with_name("actor_octree_membership_source.py"),
                Path(__file__).with_name("check_actor_octree_native.py"),
                runtime,
                runtime.with_name("actor-loading.js"),
                runtime.with_name("actor-primitive-bounds.js"),
                runtime.with_name("actor-octree-geometry.js"),
            ]
        },
        limits=[
            "Authored finite PC53/RNE actor/level state with null GLog; no live world/FPU observation.",
            "Ordinary AActor selector and generic nonnull-owner UPrimitive box executed; other bounding boxes supplied as explicit virtual responses.",
            "Successful authored allocation and bounded compiler frames inherited from membership verifier; no exception parity.",
            "Query traversal, primitive hit dispatch and live movement remain unjoined.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--engine", type=Path, default=ROOT / "assets/interlude/system/engine.dll"
    )
    parser.add_argument(
        "--core", type=Path, default=ROOT / "assets/interlude/system/Core.dll"
    )
    parser.add_argument("--comparison-engine", type=Path, required=True)
    parser.add_argument("--comparison-core", type=Path, required=True)
    parser.add_argument(
        "--runtime-module", type=Path, default=ROOT / "editor/world/js/actor-octree.js"
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = verify(
        args.engine,
        args.core,
        args.comparison_engine,
        args.comparison_core,
        args.runtime_module.resolve(),
    )
    print(
        json.dumps(
            (
                {
                    k: result[k]
                    for k in (
                        "status",
                        "sequences",
                        "operations",
                        "dispositions",
                        "steps",
                    )
                }
                if args.check
                else result
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
