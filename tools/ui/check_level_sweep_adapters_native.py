#!/usr/bin/env python3
"""Elbera Tools joined level/BSP/terrain/region differential.

No DLL execution. Reuses each existing finite native evaluator; actor-hash
results are injected source-provider fixtures, never discovered actors.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/ui"))
from check_tutorial_quest_native import Image, ENGINE_SHA
from check_supplemental_engine import CORE_SHA, CANDIDATE_ENGINE_SHA
from supplemental_pe import PEImage
from check_hair_attachment_native import compare_call_block
from check_bsp_camera_native import BspSweepEvaluator, native_sweep_query
from check_terrain_collision_native import ComposedEvaluator
from check_bsp_region_native import RegionEvaluator
from check_cast_scheduler_native import f32

# The only existing-tool delta is optional callback hooks. No second collector
# interpreter: the same retained instructions still produce every call frame.
spec = importlib.util.spec_from_file_location(
    "joined_collector", Path(__file__).with_name("check_level_query_native.py")
)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

M, MB, EMPTY = 0x820000, 0x821000, 0x822000
CURRENT, CALLER, ATTACHED = 0x800000, 0x803000, 0x801000
BACK, FRONT = 0xA00000, 0xA01000
T, HIGH, RAMP, HIDDEN = 0xB00000, 0xB00010, 0xB00020, 0xB00030
HASH = 0x840000


def word(x):
    return struct.unpack("<i", struct.pack("<f", x))[0]


def box(center=0, y=10):
    planes = [
        [1, 0, 0, center + 10],
        [-1, 0, 0, 10 - center],
        [0, 1, 0, y],
        [0, -1, 0, y],
        [0, 0, 1, 10],
        [0, 0, -1, 10],
    ]
    return dict(
        rootOutside=1,
        nodes=[
            dict(
                plane=p,
                front=-1,
                back=-1,
                flags=0,
                numVertices=4,
                collisionBound=0,
                zones=[1, 2],
                leaves=[7, 9],
            )
            for p in planes
        ],
        leafHulls=[0, 1, 2, 3, 4, 5, -1]
        + list(map(word, [center - 10, -y, -10, center + 10, y, 10])),
    )


def land(z=0, ramp=False, visible=True):
    return dict(
        width=4,
        height=4,
        vertices=[
            [x * 128, y * 128, 95 - x * 128 if ramp else z]
            for y in range(4)
            for x in range(4)
        ],
        inverseCoords=[0, 0, 0, 1 / 128, 0, 0, 0, 1 / 128, 0, 0, 0, 1],
        visibility=[visible] * 16,
        edgeTurn=[False] * 16,
        inverted=False,
        deleteMe=False,
        terrainMapPresent=True,
        owner=None,
    )


def model(identity, source):
    return dict(
        identity=identity, source=source, numZones=3, zoneActors=[None, BACK, FRONT]
    )


def fixtures():
    base = dict(
        models=[
            model(M, box()),
            model(MB, box(5)),
            model(EMPTY, dict(rootOutside=1, nodes=[], leafHulls=[])),
        ],
        terrains=[
            dict(identity=T, source=land()),
            dict(identity=HIGH, source=land(20)),
            dict(identity=RAMP, source=land(ramp=True)),
            dict(identity=HIDDEN, source=land(visible=False)),
        ],
    )

    def one(**updates):
        q = dict(
            start=[30, 30, 100],
            end=[30, 30, -100],
            extent=[1, 1, 1],
            flags=4,
            sourceActor=None,
            level=dict(
                identity=CURRENT,
                model=M,
                actorHash=HASH,
                zones=[dict(identity=FRONT, flags3d8=4, terrains=[T])] + [None] * 63,
            ),
            callerLevel=dict(identity=CALLER, model=M),
            attachedLevelsEnabled=False,
            attachedLevels=[],
            bindings=base,
            hashHits={
                str(HASH): [
                    dict(actor=0x900000, time=0.5, point=[200, 300, 400], material=None)
                ]
            },
        )
        q.update(updates)
        return q

    out = [
        one(),
        one(flags=5),
        one(flags=0x204),
        one(flags=0x205),
        one(callerLevel=dict(identity=CALLER, model=EMPTY)),
    ]
    for start, end, extent in [
        ([20, 0, 0], [0, 0, 0], [1, 1, 1]),
        ([20, 0, 0], [30, 0, 0], [1, 1, 1]),
        ([100, 0, 0], [91, 0, 0], [80, 1, 1]),
        ([0, 0, 0], [0, 0, 0], [1, 1, 1]),
        ([-20, 0, 0], [0, 0, 0], [1, 1, 1]),
    ]:
        out.append(one(start=start, end=end, extent=extent, flags=0x104))
    out.append(
        one(
            start=[30, 0, 0],
            end=[-30, 0, 0],
            flags=0x105,
            attachedLevelsEnabled=True,
            attachedLevels=[dict(identity=ATTACHED, model=MB, actorHash=None)],
        )
    )
    r = one(start=[100, 30, 0], end=[91, 30, 0], extent=[80, 1, 1])
    r["bindings"] = {**base, "models": [model(M, box(y=50))]}
    r["level"]["zones"][0]["terrains"] = [RAMP]
    out.append(r)
    r = one(callerLevel=None)
    source = dict(
        rootOutside=1,
        nodes=[
            dict(
                plane=[0, 0, 1, 10],
                front=-1,
                back=-1,
                flags=0,
                numVertices=4,
                collisionBound=-1,
                zones=[1, 2],
                leaves=[7, 9],
            )
        ],
        leafHulls=[],
    )
    r["bindings"] = {**base, "models": [model(M, source)]}
    r["level"]["zones"][0] = dict(identity=BACK, flags3d8=4, terrains=[HIGH, T])
    out.append(r)
    for point, terrain in [(30, HIDDEN), (500, T)]:
        r = one(start=[point, 30, 100], end=[point, 30, -100], callerLevel=None)
        r["level"]["zones"][0]["terrains"] = [terrain]
        out.append(r)
    r = one()
    r["level"]["zones"][63] = r["level"]["zones"][0]
    out.append(r)
    rng = random.Random(0x5C5920)
    for i in range(32):
        start = [
            f32(rng.uniform(12, 200)),
            f32(rng.uniform(-8, 180)),
            f32(rng.uniform(60, 160)),
        ]
        end = [
            f32(rng.uniform(-20, 160)),
            f32(rng.uniform(-8, 180)),
            f32(rng.uniform(-160, -60)),
        ]
        q = one(
            start=start,
            end=end,
            extent=[f32(rng.uniform(0.1, 5)) for _ in range(3)],
            flags=[4, 5, 0x104, 0x105, 0x204, 0x205][i % 6],
        )
        out.append(q)
    return out


class Providers:
    def __init__(self, engine, core, case):
        self.case = case
        self.engine = engine
        self.bsp = BspSweepEvaluator(engine, core)
        self.terrain = ComposedEvaluator(engine, core)
        self.region = RegionEvaluator(engine)
        self.models = {r["identity"]: r for r in case["bindings"]["models"]}
        self.terrains = {
            r["identity"]: r["source"] for r in case["bindings"]["terrains"]
        }

    def bsp_query(self, q):
        assert q["owner"] is None and q["extraNodeFlags"] == 0
        s = self.models[q["participant"]]["source"]
        if not s["nodes"]:
            assert s["rootOutside"] == 1
            return dict(status="ready", blocked=False, writes={})
        r = native_sweep_query(
            self.bsp, dict(source=s, **{k: q[k] for k in ["start", "end", "extent"]})
        )
        if r["hit"] is None:
            return dict(status="ready", blocked=False, writes=dict(time=2))
        h = r["hit"]
        return dict(
            status="ready",
            blocked=r["blocked"],
            writes=dict(
                actor=None,
                item=q["participant"],
                point=h["point"],
                normal=h["normal"],
                time=h["time"],
            ),
        )

    def terrain_query(self, q):
        assert q["visibilityBypass"] is False and not q["flags"] & 0x81000
        s = self.terrains[q["participant"]]
        assert not s["deleteMe"]
        hit, cells = self.terrain.sweep(
            s["vertices"],
            s["width"],
            s["height"],
            q["start"],
            q["end"],
            q["extent"],
            s["inverseCoords"],
            s["edgeTurn"],
            s["visibility"],
            s["inverted"],
        )
        # Values come from interpreted stores, not reconstructed hit/miss flags.
        offsets = dict(self.terrain.result_writes)
        writes = {}
        if 4 in offsets:
            value = offsets[4]
            assert value in (0, 0x300000)
            writes["actor"] = q["participant"] if value else None
        for key, offset in [("point", 8), ("normal", 20)]:
            if offset in offsets:
                assert all(offset + 4 * i in offsets for i in range(3))
                writes[key] = [offsets[offset + 4 * i] for i in range(3)]
        if 36 in offsets:
            writes["time"] = offsets[36]
        if 44 in offsets:
            assert offsets[44] == 0
            writes["material"] = None
        assert set(offsets) <= {4, 8, 12, 16, 20, 24, 28, 36, 44}
        return dict(status="ready", blocked=hit is not None, writes=writes)

    def region_query(self, q):
        r = self.models[q["model"]]
        value = self.region.evaluate(
            dict(
                source={
                    **r["source"],
                    "numZones": r["numZones"],
                    "zoneActors": r["zoneActors"],
                },
                point=q["point"],
                defaultZone=q["defaultZone"],
            )
        )
        return dict(status="ready", zone=value["region"]["zone"])

    def actor_query(self, q):
        return dict(status="ready", hits=self.case["hashHits"][str(q["hash"])])

    def callbacks(self):
        return dict(
            bsp=self.bsp_query,
            terrain=self.terrain_query,
            region=self.region_query,
            actorHash=self.actor_query,
        )


def flags_evidence(engine, candidate=None):
    read = lambda a, b: bytes(engine.data[engine.offset(a) : engine.offset(b)])
    anchors = [
        (0x10749248, "cmp", "dword ptr [ebx + 0x68], esi"),
        (0x1074924B, "je", "0x107498c0"),
        (0x1074925C, "lea", "eax, [ebp]"),
        (0x10749260, "lea", "ecx, [ebp + 0x64]"),
        (0x1074926B, "je", "0x107496b0"),
        (0x1074949B, "test", "dword ptr [ebp + 0x74], 0x1000"),
        (0x107496BC, "mov", "edx, dword ptr [ebp + 0x70]"),
        (0x1074970E, "call", "0x103121d9"),
        (0x107498D4, "mov", "eax, dword ptr [ebx + 0x124]"),
    ]
    for a, op, args in anchors:
        engine.instruction(a, op, args)
    spans = []
    for a, b in [(0x107496B0, 0x107498C0), (0x107498C0, 0x107498DF)]:
        raw = read(a, b)
        rows = list(engine.dis.disasm(raw, a))
        assert rows[-1].address + rows[-1].size == b
        # All instructions in these complete suffixes, including every LEA:
        # none reads or passes the address of the input TraceFlags stack word.
        assert all("[ebp + 0x74]" not in i.op_str for i in rows)
        spans.append(
            dict(
                start=hex(a),
                end=hex(b),
                sha256=hashlib.sha256(raw).hexdigest(),
                instructions=len(rows),
            )
        )
    comparison = None
    if candidate:
        a, b = 0x10749248, 0x10749271
        comparison = compare_call_block(
            read(a, b),
            candidate.read(a - 0x40, b - a),
            owned_va=a,
            candidate_va=a - 0x40,
            sites=[(0x10749263 - a, ("core.dll", "??8FVector@@QBEHABV0@@Z"))],
            direct_calls=[],
            imports=candidate.imports,
        )
    return dict(
        anchors=len(anchors),
        ranges=spans,
        nonzeroGate=comparison,
        limits=[
            "No-owner nonzero extent only; ExtraNodeFlags must be0. TraceFlags material branch is in the excluded zero-extent path.",
            "FVector equality call identity conditional without pinned supplement. No live model association claim.",
        ],
    )


def wire_cases(cases):
    """Share repeated prepared geometry without changing query identities."""
    bindings, lookup, queries = [], {}, []
    for case in cases:
        # Cases intentionally share a binding object. Do not repeatedly encode
        # full original map geometry merely to determine that same identity.
        key = id(case["bindings"])
        if key not in lookup:
            lookup[key] = len(bindings)
            bindings.append(case["bindings"])
        queries.append(
            {
                **{k: v for k, v in case.items() if k != "bindings"},
                "bindingIndex": lookup[key],
            }
        )
    return dict(bindings=bindings, cases=queries)


def map_cases(tile, comparison_engine, comparison_core):
    """Fresh original inputs, explicit conditional single-level diagnostics.

    Query offsets/extents are authored probes, not actor dimensions or game
    constants. Only the consumed terrain flag bit is projected. No live hash,
    seamless gate or terrain actor state is discovered by this check.
    """
    sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "tools/world")]
    from l2lib import load_package, read_model
    from export_bsp_collision import level_model_binding, export_model
    from export_terrain_collision import collect as collect_terrain
    from export_terrain_zones import collect as collect_zones

    zones = collect_zones(
        tile,
        normal_build=True,
        comparison_engine=comparison_engine,
        comparison_core=comparison_core,
    )
    path = ROOT / "assets/interlude/maps" / (tile + ".unr")
    pkg, protocol = load_package(path)
    model_export, binding = level_model_binding(pkg)
    bsp = export_model(
        pkg,
        read_model(pkg, model_export),
        tile,
        hashlib.sha256(path.read_bytes()).hexdigest(),
        protocol,
    )
    terrain = collect_terrain(tile, diagnostic_static_state=True)
    assert bsp["source"]["originalSHA256"] == zones["source"]["originalSHA256"]
    assert terrain["source"]["mapSHA256"] == zones["source"]["originalSHA256"]
    assert binding["model"] == zones["source"]["model"]
    assert len(zones["terrains"]) == 1
    assert terrain["source"]["terrainRef"] == zones["terrains"][0]["qualified"]
    terrain_ref = zones["terrains"][0]["reference"]
    by_ref = {a["reference"]: a for a in zones["zoneActors"]}
    tokens = {ref: 0x900000 + i * 0x1000 for i, ref in enumerate(by_ref)}
    model_id, terrain_id = 0xC00000, 0xB00000
    assert len(set(tokens.values()) | {model_id, terrain_id}) == len(tokens) + 2
    current = tokens[zones["defaultZoneActor"]["reference"]]
    reconstructed = {
        z["zoneRef"]: z["terrainRefs"]
        for z in zones["normalBuildReconstruction"]["zoneTerrains"]
    }
    resolved = []
    for ref in zones["resolvedZoneActorRefs"]:
        actor = by_ref[ref]
        record = {
            "identity": tokens[ref],
            "flags3d8": 4 if actor["bTerrainZone"] else 0,
        }
        if actor["bTerrainZone"]:
            assert reconstructed[ref] == actor["savedTerrains"] == [terrain_ref]
            record["terrains"] = [terrain_id]
        resolved.append(record)
    bindings = {
        "models": [
            {
                "identity": model_id,
                "source": bsp,
                "numZones": zones["numZones"],
                "zoneActors": [
                    tokens[r] if r else None for r in zones["zoneActorRefs"]
                ],
            }
        ],
        "terrains": [{"identity": terrain_id, "source": terrain}],
    }
    probes = []
    for y in range(24, 255, 47):
        for x in range(24, 255, 47):
            v = [terrain["vertices"][y * 256 + x + d] for d in [0, 1, 256, 257]]
            center = [f32(sum(p[a] for p in v) / 4) for a in [0, 1]]
            probes.append(
                dict(
                    start=center + [f32(max(p[2] for p in v) + 200)],
                    end=center + [f32(min(p[2] for p in v) - 200)],
                    extent=[1, 1, 5],
                )
            )
    for i in range(0, len(bsp["nodes"]), max(1, len(bsp["nodes"]) // 32)):
        node = bsp["nodes"][i]
        if not node["numVertices"]:
            continue
        point = bsp["points"][bsp["vertices"][node["vertexPool"]][0]]
        probes.append(
            dict(
                start=[f32(v + node["plane"][a] * 50) for a, v in enumerate(point)],
                end=[f32(v - node["plane"][a] * 50) for a, v in enumerate(point)],
                extent=[1, 1, 1],
            )
        )
    cases = [
        dict(
            **query,
            flags=4,
            sourceActor=None,
            level=dict(
                identity=current, model=model_id, actorHash=None, zones=resolved
            ),
            callerLevel=dict(identity=current, model=model_id),
            attachedLevelsEnabled=False,
            attachedLevels=[],
            bindings=bindings,
            hashHits={},
        )
        for query in probes
    ]
    return cases, {
        "tile": tile,
        "cases": len(cases),
        "mapSHA256": zones["source"]["originalSHA256"],
        "modelExportSHA256": zones["source"]["modelExportSHA256"],
        "terrainVertexSHA256": terrain["source"]["baseVertexFloat32SHA256"],
        "scope": "conditional original saved-map composition; no live admission",
        "conditions": zones["normalBuildReconstruction"]["conditions"],
        "diagnosticInputs": [
            "Distinct synthetic tokens represent source object identities.",
            "flags4 selects BSP/terrain only; unused hash memory is null in the interpreter fixture.",
            "Attached-level gate is explicitly disabled for this single-level diagnostic.",
            "Terrain owner=null/deleteMe=false/mapPresent=true are explicit diagnostic state.",
            "Zone flag projection carries only the consumed mask4, not a full native flag word.",
            "Probe offsets/extents are authored inspection inputs, not game or pawn values.",
        ],
    }


JS = """
import fs from 'node:fs';
const {prepareLevelSweepAdapters}=await import(process.argv[1]);
const {collectLevelHits}=await import(process.argv[2]);
const input=JSON.parse(fs.readFileSync(0,'utf8')),out=[],prepared=new Map();
const cases=Array.isArray(input)?input:input.cases;
for(const c of cases){
 const key=Array.isArray(input)?c.bindings:c.bindingIndex;
 let entry=prepared.get(key);
 if(!entry){
  const state={current:c};
  const p=prepareLevelSweepAdapters({...Array.isArray(input)?c.bindings:input.bindings[key],
   actorHash:q=>({status:'ready',hits:state.current.hashHits[q.hash]})});
  if(p.status!=='ready')throw Error(JSON.stringify(p));
  entry={state,primitives:p.primitives};prepared.set(key,entry);
 }
 entry.state.current=c;
 const calls=[],primitives=Object.fromEntries(Object.entries(entry.primitives).map(([k,fn])=>[k,q=>{calls.push([k,q]);return fn(q)}]));
 const r=collectLevelHits({...c,primitives});if(r.status!=='ready')throw Error(JSON.stringify(r));
 out.push({hits:r.hits,end:r.end,scale:r.scale,calls});
}
const bytes=new DataView(new ArrayBuffer(4));
const bits=x=>{bytes.setFloat32(0,x,true);return bytes.getUint32(0,true)};
const canon=(v,k='')=>['point','normal','end','start','extent'].includes(k)?v.map(bits):['time','scale'].includes(k)?bits(v):Array.isArray(v)?v.map(x=>canon(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,canon(x,k)])):v;
console.log(JSON.stringify(canon(out)));
"""


def verify(comparison=None, comparison_core=None, maps=()):
    if maps and not (comparison and comparison_core):
        raise ValueError("map diagnostics require both explicit supplemental inputs")
    if comparison_core and not maps:
        raise ValueError("--comparison-core is used only with --map")
    engine = Image(ROOT / "assets/interlude/system/engine.dll", ENGINE_SHA, True)
    core = Image(ROOT / "assets/interlude/system/core.dll", CORE_SHA)
    candidate = PEImage(Path(comparison), CANDIDATE_ENGINE_SHA) if comparison else None
    bindings = collector.verify_composition_bindings(engine, comparison)
    collector.verify_scratch_writes(engine)
    extra = flags_evidence(engine, candidate)
    cases = fixtures()
    map_reports = []
    for tile in maps:
        extra_cases, receipt = map_cases(tile, comparison, comparison_core)
        receipt["caseStart"] = len(cases)
        cases.extend(extra_cases)
        map_reports.append(receipt)
    expected = []
    counts = dict(cases=len(cases), hits=0, callbacks=0)
    native_addresses = set()
    bsp_addresses = set()
    terrain_addresses = set()
    region_addresses = set()
    for case in cases:
        p = Providers(engine, core, case)
        r = collector.native(engine, core, case, p.callbacks())
        native_addresses.update(r.pop("visited"))
        expected.append(collector.canonical(r))
        counts["hits"] += len(r["hits"])
        counts["callbacks"] += len(r["calls"])
        bsp_addresses.update(p.bsp.visited)
        terrain_addresses.update(p.terrain.visited)
        region_addresses.update(p.region.visited)
    actual = json.loads(
        subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                JS,
                (ROOT / "editor/world/js/level-sweep-adapters.js").as_uri(),
                (ROOT / "editor/world/js/level-query.js").as_uri(),
            ],
            cwd=ROOT,
            input=json.dumps(wire_cases(cases), allow_nan=False),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    for i, (want, got) in enumerate(zip(expected, actual)):
        assert want == got, dict(case=i, expected=want, actual=got)
    assert len(expected) == len(actual)
    for receipt in map_reports:
        start = receipt.pop("caseStart")
        rows = actual[start : start + receipt["cases"]]
        receipt["hits"] = sum(len(r["hits"]) for r in rows)
        receipt["callbacks"] = sum(len(r["calls"]) for r in rows)
    return dict(
        tool="Elbera Tools",
        engineSHA256=engine.sha,
        coreSHA256=core.sha,
        comparisonEngineSHA256=candidate.sha if candidate else None,
        flags=extra,
        collectorBindings=bindings,
        mapDiagnostics=map_reports,
        differential={
            **counts,
            "collectorInstructionAddresses": len(native_addresses),
            "bspTrackedHelperAddresses": len(bsp_addresses),
            "terrainInstructionAddresses": len(terrain_addresses),
            "regionInstructionAddresses": len(region_addresses),
        },
        limits=[
            "Finite component interpreters joined through actual collector call frames; not native DLL execution.",
            "BSP primitive result association reuses checked scratch/adoption writes; terrain uses actual interpreted write events.",
            "Explicit prepared geometry/current identities and injected actor-hash response fixtures; no discovery, live loading or actor-hash traversal proof.",
            "Existing component x87/CRT/import correspondence and source-admission limits remain.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comparison-engine")
    parser.add_argument("--comparison-core")
    parser.add_argument(
        "--map", action="append", choices=["17_25", "22_22"], default=[]
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    r = verify(args.comparison_engine, args.comparison_core, args.map)
    print(
        "Elbera Tools joined adapters PASS: " + json.dumps(r["differential"])
        if args.check
        else json.dumps(r, indent=2)
    )


if __name__ == "__main__":
    main()
