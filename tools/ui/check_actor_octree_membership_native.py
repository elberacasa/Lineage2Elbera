#!/usr/bin/env python3
"""Elbera Tools: original octree membership versus actual browser storage.

Read-only pinned images; no native code executes or decoded payload is written.
Authored operation sequences compare every ordered tree/membership snapshot.
Normal successful allocation and memmove are explicit provider responses.
"""

import argparse
import hashlib
import json
from pathlib import Path
import random

from check_actor_octree_native import (
    source_program,
    Image,
    ENGINE_SHA,
    PEImage,
    CANDIDATE_ENGINE_SHA,
    CORE_SHA,
    CANDIDATE_CORE_SHA,
    ROOT,
)
from actor_octree_membership_source import qualify_bounds, qualify_membership
from actor_octree_machine import create_membership_machine, define_actor, snapshot
from check_static_triangle_native import f32, hexes
from check_static_mesh_native import browser_outputs


SCRIPT = r"""
import fs from 'node:fs';
const api = await import(process.argv[1]);
const val = h => Buffer.from(h, 'hex').readFloatLE();
const ready = r => { if (r.status !== 'ready') throw Error(JSON.stringify(r)); return r; };
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map(c => {
  const volume = {center:c.volume.center.map(val), halfExtent:val(c.volume.halfExtent)};
  const {tree} = ready(api.createActorOctree({arithmeticProfile:'pc53-rne', volume}));
  return c.operations.map(op => {
    if(op.kind === 'insert') ready(api.insertActorOctree(tree, {
      identity:op.identity, singleNode:op.singleNode,
      cachedBounds:{min:op.box.min.map(val), max:op.box.max.map(val)},
    }));
    else ready(api.removeActorOctree(tree, op.identity));
    const {nodes, memberships} = ready(api.inspectActorOctree(tree));
    return {nodes, memberships};
  });
})));
"""


def fixtures():
    cases = []

    def insertion(identity, box, single):
        return dict(kind="insert", identity=identity, box=box, singleNode=single)

    # Split threshold, duplicates, parent retention, strict zero-plane routing
    # and repeated removal. Input cached boxes are already expanded source fields.
    for half in [100.0, 200.0, f32(200.00001525878906), 400.0, 512.0, 360448.0]:
        for single in [False, True]:
            box = dict(min=[1.0] * 3, max=[2.0] * 3)
            operations = [insertion("repeat", box, single) for _ in range(5)]
            operations += [
                insertion("cover", dict(min=[-half] * 3, max=[half] * 3), single),
                insertion("plane", dict(min=[0.0] * 3, max=[0.0] * 3), single),
                dict(kind="remove", identity="repeat"),
                dict(kind="remove", identity="repeat"),
                insertion("repeat", dict(min=[-2.0] * 3, max=[-1.0] * 3), not single),
                dict(kind="remove", identity="cover"),
                dict(kind="remove", identity="plane"),
                dict(kind="remove", identity="repeat"),
            ]
            cases.append(
                dict(
                    volume=dict(center=[0.0] * 3, halfExtent=half),
                    operations=operations,
                )
            )
    rng = random.Random(0x4F435452)
    for j in range(48):
        half = [200.0, 256.0, 512.0, 2048.0, 360448.0][j % 5]
        center = (
            [f32(rng.uniform(-3000, 3000)) for _ in range(3)] if j % 3 else [0.0] * 3
        )
        operations, known = [], {}
        for i in range(32):
            identity = str(rng.randrange(12))
            if identity in known and i % 4 == 0:
                operations.append(dict(kind="remove", identity=identity))
                known[identity] = None
            elif known.get(identity) is not None:
                # The filter itself does not deduplicate repeated pointers.
                operations.append(known[identity].copy())
            else:
                point = [
                    f32(c + rng.choice([-0.75, -0.25, 0.0, 0.25, 0.75]) * half)
                    for c in center
                ]
                # Bounded synthetic actor extents. Root-covering boxes exercise
                # the containment stop without generating millions of leaves.
                radius = rng.choice([0.0, 1.0, min(128.0, half * 0.25), half * 2.0])
                box = dict(
                    min=[f32(v - radius) for v in point],
                    max=[f32(v + radius) for v in point],
                )
                op = insertion(identity, box, bool(rng.randrange(2)))
                known[identity] = op
                operations.append(op)
        operations += [dict(kind="remove", identity=k) for k in known]
        cases.append(
            dict(volume=dict(center=center, halfExtent=half), operations=operations)
        )
    return cases


def native_sequence(program, case):
    m, root, volume = create_membership_machine(program, case["volume"])
    identities, pointers, answers = {}, {}, []
    for step, op in enumerate(case["operations"]):
        name = op["identity"]
        if op["kind"] == "insert":
            if name not in pointers:
                pointer = 0x200000 + len(pointers) * 0x1000
                pointers[name] = pointer
                identities[pointer] = name
                define_actor(m, pointer, op["box"], op["singleNode"])
            else:
                pointer = pointers[name]
                m.memory[pointer + 0x74] = 0x100 if op["singleNode"] else 0
                m.memory.update(
                    {
                        pointer + 0x174 + i * 4: v
                        for i, v in enumerate([*op["box"]["min"], *op["box"]["max"]])
                    }
                )
            try:
                m.invoke(
                    0x10602960 if op["singleNode"] else 0x105FEB40,
                    root,
                    [pointer, 0, volume],
                )
            except Exception as error:
                raise AssertionError(
                    (case["volume"], step, op, hex(m.visited[-1]))
                ) from error
        else:
            m.remove_actor(pointers[name])
        state = snapshot(m, root, identities)
        state["memberships"] = [
            dict(identity=k, nodes=v) for k, v in state["memberships"].items()
        ]
        answers.append(state)
    return answers, m


def verify(engine, core, comparison_engine, comparison_core, runtime):
    e, c = Image(engine, ENGINE_SHA, True), Image(core, CORE_SHA)
    ce, cc = PEImage(comparison_engine, CANDIDATE_ENGINE_SHA), PEImage(
        comparison_core, CANDIDATE_CORE_SHA
    )
    program = qualify_membership(
        qualify_bounds(source_program(e, ce), c, ce, cc), c, ce, cc
    )
    cases, answers = fixtures(), []
    steps, visited, operations, max_nodes, boundaries = 0, set(), 0, 0, {}
    for case in cases:
        result, m = native_sequence(program, case)
        answers.append(result)
        steps += len(m.visited)
        visited.update(m.visited)
        operations += len(result)
        max_nodes = max(max_nodes, *(len(r["nodes"]) for r in result))
        for event in m.events:
            boundaries[event[0]] = boundaries.get(event[0], 0) + 1
    actual = browser_outputs(SCRIPT, hexes(cases), runtime)
    assert len(actual) == len(answers)
    for index, (a, b) in enumerate(zip(actual, answers)):
        assert len(a) == len(b)
        for step, (x, y) in enumerate(zip(a, b)):
            assert x == y, (
                "original membership mismatch",
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
        operations=operations,
        steps=steps,
        maxNodes=max_nodes,
        boundaries=boundaries,
        coverage=[hex(v) for v in sorted(visited)],
        source=program.receipt,
        files={
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                Path(__file__),
                Path(__file__).with_name("actor_octree_machine.py"),
                Path(__file__).with_name("actor_octree_membership_source.py"),
                Path(__file__).with_name("check_actor_octree_native.py"),
                runtime,
                runtime.with_name("actor-octree-geometry.js"),
            ]
        },
        limits=[
            "Authored cached bounds and mode flags, explicit finite PC53/RNE; no observed live FPU state.",
            "No full AddActor flag admission, primitive bounds callback, level-mode selection or live actors.",
            "Successful authored allocator/memmove responses; no native heap, allocation failure or exception parity.",
            "Bounded normal compiler vector loop frame and RemoveActor membership frame supplied explicitly.",
            "No traversal query, primitive collision hit, world population or walking claim.",
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
                    for k in ("status", "sequences", "operations", "steps", "maxNodes")
                }
                if args.check
                else result
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
