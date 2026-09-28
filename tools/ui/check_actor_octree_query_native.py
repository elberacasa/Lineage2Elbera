#!/usr/bin/env python3
"""Elbera Tools: joined actor admission and nonzero queries versus original code.

Explicit authored actor/provider state, PC53/RNE and masked division by zero.
Actual source methods execute in a bounded interpreter, never as native DLLs.
Virtual ShouldTrace/LineCheck responses and successful storage remain supplied.
"""
import argparse
import copy
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
from actor_octree_query_source import qualify_query
from actor_octree_query_machine import QueryMachine

SCRIPT = r"""
import fs from 'node:fs';
const api=await import(process.argv[1]);
const {isActorOwnedBy}=await import(new URL('./actor-blocking.js',process.argv[1]));
const val=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?val(v):v;
const encode=v=>({...v,time:bits(v.time),point:v.point.map(bits),normal:v.normal.map(bits)});
const ready=r=>{if(r.status!=='ready')throw Error(JSON.stringify(r));return r;};
const cases=decode(JSON.parse(fs.readFileSync(0,'utf8')));
process.stdout.write(JSON.stringify(cases.map(c=>{
 const {tree}=ready(api.createActorOctree({arithmeticProfile:'pc53-rne',volume:{center:[0,0,0],halfExtent:360448}}));
 const actors=new Map(c.actors.map(a=>[a.identity,{...a}]));
 for(const id of c.insertions){const a=actors.get(id);Object.assign(a,ready(api.updateActorOctree(tree,{
  ...a,flags64:0,flags2e4:0,flags74:0,level:a.level,storedLocation:a.location,
  getPrimitive:()=>({status:'ready',primitiveIdentity:a.primitive}),
  getPrimitiveBounds:()=>({status:'ready',bounds:a.bounds}),
 })).writes);}
 const ownerOf=id=>id==='source'?c.sourceOwner:actors.get(id)?.owner;
 return c.queries.map(q=>{
  const events=[];
  const r=ready(api.queryActorOctree(tree,{...q,maskedZeroDivision:true,
   readActor:id=>{const a=actors.get(id);return {status:'ready',actor:{...a,flags2f8:{mask:0x40,value:a.flags2f8&0x40}}};},
   isOwnedBy:(a,b)=>{events.push(['owned',a,b]);return isActorOwnedBy({actor:a,owner:b,ownerOf});},
   shouldTrace:(a,s,f)=>{events.push(['should',a,s,f]);return {status:'ready',value:q.trace[a]};},
   getPrimitive:id=>{const p=actors.get(id).primitive;events.push(['primitive',id,p]);return {status:'ready',primitiveIdentity:p};},
   lineCheck:(p,request)=>{const {actor,end,start,extent,extra,flags,initialResult}=request;
    events.push(['line',p,actor,[...end,...start,...extent].map(bits).concat([extra,flags]),encode(initialResult)]);
    return {status:'ready',...q.lines[actor]};
   },
  }));
  for(const w of r.writes.actorTags)actors.get(w.identity).tag1b0=w.tag1b0;
  return {hits:r.hits.map(encode),writes:r.writes,events,tags:Object.fromEntries([...actors].map(([id,a])=>[id,a.tag1b0]))};
 });
})));
"""


def fixtures():
    rng = random.Random(0x51554552)
    cases = []
    for j in range(100):
        actors = []
        for n in range(12 if j >= 8 else 5):
            center = [f32(rng.uniform(-220, 220)) for _ in range(3)]
            size = [f32(rng.uniform(1, 55)) for _ in range(3)]
            if j < 8:
                center = [0.0, 0.0, 0.0]
                size = [20.0, 20.0, 20.0]
            actors.append(
                dict(
                    identity="actor" + str(n),
                    primitive="primitive" + str(n),
                    location=center,
                    flags2f8=1 | (0x40 if n % 5 or j < 8 else 0),
                    tag1b0=0xFFFFFFFF if n == 0 else n,
                    owner=None,
                    level={"infoFlags554": 2 if n % 3 == 0 else 0},
                    bounds=dict(
                        min=[f32(x - d) for x, d in zip(center, size)],
                        max=[f32(x + d) for x, d in zip(center, size)],
                    ),
                )
            )
        queries = []
        for k in range(6):
            if j < 8:
                start, end, extent = (
                    [-100.0, 0.0, 0.0],
                    [100.0, 0.0, 0.0],
                    [1.0, 2.0, 3.0],
                )
                if j == 1:
                    start = end = [0.0, -0.0, 0.0]
                if j == 2:
                    start, end = [0.0, 0.0, 0.0], [1.0, 2.0, 3.0]
                if j == 3:
                    start, end = [-100.0, -100.0, -100.0], [100.0, 100.0, 100.0]
                if j == 4:
                    start, end = [0.0, -0.0, 0.0], [-0.0, 0.0, -0.0]
                if j == 5:
                    start, end = [-100.0, 30.0, 0.0], [100.0, 30.0, 0.0]
                if j == 6:
                    start, end = [-500000.0, 0.0, 0.0], [500000.0, 0.0, 0.0]
                if j == 7:
                    extent = [0.0, 0.0, 1.0]
            else:
                start = [f32(rng.uniform(-300, 300)) for _ in range(3)]
                end = [f32(rng.uniform(-300, 300)) for _ in range(3)]
                extent = [f32(rng.uniform(0, 80)) for _ in range(3)]
                if k % 2 == 0:
                    end[k % 3] = start[k % 3]
            flags = [0x10, 0x210, 0x410, 0x610, 0x10, 0x410][k]
            tag = [0xFFFFFFFE, 0xFFFFFFFF, 0, 1, 2, 3][k] if j % 2 == 0 else 100 + k
            source = None if k % 3 == 0 else "source" if k % 3 == 1 else "actor1"
            trace = {
                a["identity"]: (0 if (j + k + idx) % 9 == 0 else 128 if idx % 2 else 1)
                for idx, a in enumerate(actors)
            }
            lines = {}
            for idx, a in enumerate(actors):
                time = f32(rng.choice([0.0, 0.25, 0.5, 1.0]))
                if j == 2:
                    time = f32(3.4028234663852886e38)
                writes = dict(
                    time=time,
                    actor=a["identity"],
                    item="mesh" + str(idx),
                    point=[f32(rng.uniform(-20, 20)) for _ in range(3)],
                    material=None if idx % 2 else "material",
                    nodeIndex=idx,
                )
                if idx % 2:
                    writes["normal"] = [1.0, 0.0, 0.0]
                if j == 3:
                    writes = (
                        {}
                    )  # An explicit zero-return method can leave scratch untouched.
                lines[a["identity"]] = dict(
                    hit=(idx + k) % 4 != 0,
                    writes=writes,
                    clearReturn=0x80000000 if idx % 2 else 1,
                )
            queries.append(
                dict(
                    start=start,
                    end=end,
                    extent=extent,
                    flags=flags,
                    extra=0x12345678,
                    currentTag=tag,
                    sourceActor=source,
                    trace=trace,
                    lines=lines,
                )
            )
        cases.append(
            dict(
                actors=actors,
                insertions=[a["identity"] for a in actors],
                sourceOwner="actor2" if j % 2 else None,
                queries=queries,
            )
        )
    # The source AddActor path can retain an invalid auxiliary box with reversed
    # endpoints. Query padding may leave a negative extent or make it positive.
    for extent in (1.0, 20.0):
        case = copy.deepcopy(cases[0])
        case["actors"] = case["actors"][:1]
        case["actors"][0]["tag1b0"] = 0
        case["actors"][0]["bounds"] = dict(
            min=[10.0, -5.0, -5.0], max=[-10.0, 5.0, 5.0]
        )
        case["insertions"] = ["actor0"]
        case["queries"] = case["queries"][:1]
        case["queries"][0].update(
            currentTag=0,
            sourceActor=None,
            extent=[extent, 2.0, 3.0],
            trace={"actor0": 1},
        )
        case["queries"][0]["lines"]["actor0"]["hit"] = True
        case["queries"][0]["lines"] = {"actor0": case["queries"][0]["lines"]["actor0"]}
        cases.append(case)
    return cases


def native_sequence(program, case):
    m = QueryMachine(program)
    provider, root = 0x120000, 0x100000
    m.memory.update({provider: 0x108B3024, provider + 4: root})
    m.invoke(0x10601A10, root)
    m.invoke(0x108464A0)
    ids = {a["identity"]: 0x200000 + i * 0x1000 for i, a in enumerate(case["actors"])}
    ids.update(
        {a["primitive"]: 0x300000 + i * 0x1000 for i, a in enumerate(case["actors"])}
    )
    ids.update({"source": 0x500000, "material": 0x510000})
    ids.update(
        {"mesh" + str(i): 0x520000 + i * 0x1000 for i in range(len(case["actors"]))}
    )
    names = {v: k for k, v in ids.items()}
    ptr = lambda v: 0 if v is None else ids[v] if isinstance(v, str) else v
    name = lambda v: None if v == 0 else names.get(v, v)
    actors = {a["identity"]: a for a in case["actors"]}
    for a in case["actors"]:
        actor, primitive = ids[a["identity"]], ids[a["primitive"]]
        m.invoke(0x101091F0, actor + 0x168)
        m.memory.update(
            {
                actor: 0x10851E6C,
                actor + 0x64: 0,
                actor + 0x2E4: 0,
                actor + 0x74: 0,
                actor + 0x2F8: a["flags2f8"],
                actor + 0x1B0: a["tag1b0"],
                actor + 0x3C: ptr(a["owner"]),
                actor + 0x104: primitive,
                primitive: 0xA10000,
            }
        )
        for off in [0x1BC, 0x33C]:
            m.memory.update(
                {actor + off + i * 4: v for i, v in enumerate(a["location"])}
            )
        level, data, info = actor + 0x400000, actor + 0x500000, actor + 0x600000
        m.memory.update(
            {
                actor + 0xE4: level,
                level + 0x38: data,
                data: info,
                info + 0x554: a["level"]["infoFlags554"],
            }
        )
        m.responses[primitive] = a["bounds"]
    m.memory[ids["source"] + 0x3C] = ptr(case["sourceOwner"])
    for identity in case["insertions"]:
        m.invoke(0x10602B30, provider, [ids[identity]])
    answers = []

    def result(values, next_field=False):
        out = dict(values)
        if next_field:
            out["next"] = name(out["next"])
        else:
            out.pop("next")
        out["actor"] = name(out["actor"])
        out["material"] = name(out["material"])
        out["item"] = names.get(out["item"], out["item"])
        if out["nodeIndex"] == 0xFFFFFFFF:
            out["nodeIndex"] = -1
        return hexes(out)

    for q in case["queries"]:
        m.trace_responses = {ids[k]: v for k, v in q["trace"].items()}
        m.line_responses = {
            ids[k]: {
                **v,
                "writes": {
                    field: (
                        ptr(value)
                        if field in ("actor", "item", "material", "next")
                        else value
                    )
                    for field, value in v["writes"].items()
                },
            }
            for k, v in q["lines"].items()
        }
        m.memory[provider + 8] = q["currentTag"]
        m.query_events = []
        m.invoke(
            0x106009A0,
            provider,
            [
                0xB10000,
                *q["end"],
                *q["start"],
                *q["extent"],
                q["flags"],
                q["extra"],
                ptr(q["sourceActor"]),
            ],
        )
        head = m.registers["eax"]
        hits = []
        while head:
            record = m.result(head)
            hits.append(result(record))
            head = record["next"]
        events = []
        tagwrites = []
        for row in m.query_events:
            if row[0] == "tag":
                tagwrites.append(dict(identity=name(row[1]), tag1b0=row[2]))
            elif row[0] == "line":
                events.append(
                    [
                        row[0],
                        name(row[1]),
                        name(row[2]),
                        hexes(row[3]),
                        result(row[4], True),
                    ]
                )
            elif row[0] == "should":
                events.append([row[0], name(row[1]), name(row[2]), row[3]])
            else:
                events.append([row[0], *[name(v) for v in row[1:]]])
        answers.append(
            dict(
                hits=hits,
                writes=dict(actorTags=tagwrites, currentTag=m.memory[provider + 8]),
                events=events,
                tags={k: m.memory[ids[k] + 0x1B0] for k in actors},
            )
        )
    return answers, m


def verify(engine, core, comparison_engine, comparison_core, runtime):
    e, c = Image(engine, ENGINE_SHA, True), Image(core, CORE_SHA)
    ce, cc = PEImage(comparison_engine, CANDIDATE_ENGINE_SHA), PEImage(
        comparison_core, CANDIDATE_CORE_SHA
    )
    program = qualify_query(
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
    cases = fixtures()
    expected = []
    visited = set()
    steps = zero_divisions = 0
    for case in cases:
        rows, m = native_sequence(program, case)
        expected.append(rows)
        visited.update(m.visited)
        steps += len(m.visited)
        zero_divisions += m.zero_divisions
    actual = browser_outputs(SCRIPT, hexes(cases), runtime)
    assert len(actual) == len(expected)
    for i, (a, b) in enumerate(zip(actual, expected)):
        assert len(a) == len(b)
        for j, (x, y) in enumerate(zip(a, b)):
            assert x == y, ("query mismatch", i, j, x, y)
    return dict(
        tool="Elbera Tools",
        status="pass",
        sequences=len(cases),
        queries=sum(len(c["queries"]) for c in cases),
        admittedActors=sum(len(c["insertions"]) for c in cases),
        adoptedHits=sum(len(row["hits"]) for sequence in expected for row in sequence),
        candidateTagWrites=sum(
            len(row["writes"]["actorTags"]) for sequence in expected for row in sequence
        ),
        steps=steps,
        maskedZeroDivisions=zero_divisions,
        coverage=[hex(v) for v in sorted(visited)],
        source=program.receipt,
        files={
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                Path(__file__),
                Path(__file__).with_name("actor_octree_query_source.py"),
                Path(__file__).with_name("actor_octree_query_machine.py"),
                Path(__file__).with_name("actor_octree_admission_source.py"),
                Path(__file__).with_name("actor_octree_admission_machine.py"),
                Path(__file__).with_name("actor_octree_membership_source.py"),
                Path(__file__).with_name("actor_octree_machine.py"),
                Path(__file__).with_name("check_actor_octree_native.py"),
                runtime,
                runtime.with_name("actor-loading.js"),
                runtime.with_name("actor-blocking.js"),
                runtime.with_name("actor-octree-geometry.js"),
                runtime.with_name("cylinder-collision.js"),
            ]
        },
        limits=[
            "Authored actor/provider fields and successful allocation; no live population or walking.",
            "ShouldTrace and LineCheck are supplied virtual responses; admission, owner-chain and traversal execute retained instructions.",
            "PC53/RNE and masked zero division explicit; zero-extent traversal, native exceptions and reentrancy excluded.",
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
        "--runtime-module", type=Path, default=ROOT / "editor/world/js/actor-octree.js"
    )
    p.add_argument("--check", action="store_true")
    a = p.parse_args()
    r = verify(
        a.engine,
        a.core,
        a.comparison_engine,
        a.comparison_core,
        a.runtime_module.resolve(),
    )
    print(
        json.dumps(
            (
                {
                    k: r[k]
                    for k in [
                        "status",
                        "sequences",
                        "queries",
                        "steps",
                        "maskedZeroDivisions",
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
