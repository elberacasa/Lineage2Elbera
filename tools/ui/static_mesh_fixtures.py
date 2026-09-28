"""Elbera Tools: authored finite mesh fixtures and browser comparison bridges.

These records, cache states and identities are synthetic, not recovered maps.
Original-instruction results are supplied by check_static_mesh_native.py.
"""

from check_static_triangle_native import f32

SCRIPT = r"""
import fs from 'node:fs';
const {prepareStaticMeshTree,traceStaticMeshTree,traceStaticMeshCollision}=await import(process.argv[1]);
const decode=a=>Array.isArray(a)?a.map(decode):a&&typeof a==='object'?Object.fromEntries(Object.entries(a).map(([k,v])=>[k,decode(v)])):typeof a==='string'&&/^[0-9a-f]{8}$/.test(a)?Buffer.from(a,'hex').readFloatLE():a;
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const ready=r=>{if(r.status!=='ready')throw Error(JSON.stringify(r));return r;};
const outputs=JSON.parse(fs.readFileSync(0,'utf8')).map(decode).map(a=>{
 const events=[];
 const methods={
  ownerVTableAC(slot){const value=a.methods.ownerMaterials[slot];events.push(['ownerMaterial',slot,value]);return {status:'ready',value:value||null};},
  defaultMaterial(){events.push(['defaultMaterial']);return {status:'ready',value:a.methods.defaultMaterial||null};},
  ownerVTable124(){events.push(['ownerMethod124',a.methods.ownerMethod124]);return {status:'ready',value:a.methods.ownerMethod124||null};},
 };
 const model=ready(prepareStaticMeshTree(a.mesh)).model;
 const run=a.kind==='composed'?traceStaticMeshCollision:traceStaticMeshTree;
 const r=ready(run(model,{...a,ownerFlags2f8:0,collisionModel:null,actorIdentity:'owner',meshIdentity:'mesh',methods,meshMaterials:a.meshMaterials.map(v=>v||null),arithmeticProfile:'pc53-rne-math-sqrt',inspect:true}));
 const planes=a.cache.planes.map(p=>({...p})),vertices=a.cache.vertices.map(p=>({...p}));
 for(const {index,record} of r.writes.planes)planes[index]=record;
 for(const {index,record} of r.writes.vertices)vertices[index]=record;
 const result={time:bits(r.writes.result.time??a.time)};
 if(r.writes.result.normal)Object.assign(result,{normal:r.writes.result.normal.map(bits),triangleIndex:r.writes.result.triangleIndex,material:r.writes.result.material??0});
 if(a.kind==='composed'&&r.blocked){if(r.writes.result.actor!=='owner'||r.writes.result.item!=='mesh')throw Error('lost source identities');result.point=r.writes.result.point.map(bits);}
 return {hit:Number(a.kind==='composed'?r.blocked:r.hit),result,planes:planes.map(p=>({...p,...(p.plane?{plane:p.plane.map(bits)}:{})})),vertices:vertices.map(p=>({...p,...(p.point?{point:p.point.map(bits)}:{})})),events,visitedNodes:r.inspection.visitedNodes,triangleTests:r.inspection.triangleTests,objectFields:r.writes.objectFields.map(w=>[w.object,w.value])};
});process.stdout.write(JSON.stringify(outputs));
"""

HIT_SCRIPT = r"""
import fs from 'node:fs';
const {adjustStaticMeshHit}=await import(process.argv[1]);
const val=h=>Buffer.from(h,'hex').readFloatLE();
const bits=v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);return b.toString('hex');};
const out=JSON.parse(fs.readFileSync(0,'utf8')).map(a=>{
 const r=adjustStaticMeshHit({arithmeticProfile:'pc53-rne-math-sqrt',start:a.start.map(val),end:a.end.map(val),normal:a.normal.map(val),time:val(a.time),actor:'actor',mesh:'mesh'});
 if(r.status!=='ready')throw Error(JSON.stringify(r));
 if(r.writes.actor!=='actor'||r.writes.item!=='mesh')throw Error('identity lost');
 return {time:bits(r.writes.time),point:r.writes.point.map(bits),normal:r.writes.normal.map(bits)};
});process.stdout.write(JSON.stringify(out));
"""


def simple_fixture():
    identity = [
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
    return dict(
        start=[2.0, 2.0, 30.0],
        end=[2.0, 2.0, -30.0],
        extent=[1.0, 1.0, 1.0],
        time=1.0,
        ownerStatic=True,
        ownerFlags3a0=0,
        mesh=dict(
            vertices=[[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.0, 10.0, 0.0]],
            indices=[0, 1, 2],
            materials=[0],
            collisionTree=dict(
                trianglePlanes=[[0.0, 0.0, -1.0, 0.0] + [0.0] * 12],
                nodes=[
                    dict(
                        links=[0, -1, -1, -1],
                        bounds=[0.0, 0.0, 0.0, 10.0, 10.0, 0.0],
                        valid=1,
                    )
                ],
            ),
        ),
        cache=dict(
            worldToLocal=identity,
            localToWorld=identity,
            determinant=1.0,
            queryTag=1,
            planes=[dict(valid=0, queryTag=0)],
            vertices=[dict(valid=0) for _ in range(3)],
        ),
        meshMaterials=[0x7100000],
        methods=dict(ownerMaterials=[0], defaultMaterial=0x7200000, ownerMethod124=0),
    )


def fixture(rng, j):
    a = simple_fixture()
    n = 1 + j % 13
    zs = sorted(rng.sample(range(-80, 81), n))
    verts = []
    planes = []
    for z in zs:
        x = rng.choice([0.0, -5.0, 5.0])
        verts += [[x, 0.0, float(z)], [x + 10.0, 0.0, float(z)], [x, 10.0, float(z)]]
        planes.append([0.0, 0.0, -1.0, float(-z)] + [0.0] * 12)
    nodes = []

    def build(ids):
        if not ids:
            return -1
        mid = len(ids) // 2
        i = len(nodes)
        tri = ids[mid]
        nodes.append(None)
        back = build(ids[mid + 1 :])
        front = build(ids[:mid])
        same = -1
        if (tri + j) % 5 == 0:
            same = len(nodes)
            nodes.append(
                dict(
                    links=[tri, -1, -1, -1],
                    bounds=[-5.0, 0.0, float(zs[tri]), 15.0, 10.0, float(zs[tri])],
                    valid=1,
                )
            )
        nodes[i] = dict(
            links=[tri, same, back, front],
            bounds=[-5.0, 0.0, float(zs[ids[0]]), 15.0, 10.0, float(zs[ids[-1]])],
            valid=1,
        )
        return i

    build(list(range(n)))
    a["mesh"].update(
        vertices=verts,
        indices=list(range(n * 3)),
        materials=[i % 3 for i in range(n)],
        collisionTree=dict(trianglePlanes=planes, nodes=nodes),
    )
    a["cache"].update(
        planes=[dict(valid=0, queryTag=0) for _ in range(n)],
        vertices=[dict(valid=0) for _ in verts],
    )
    scale = [rng.choice([-2.0, -1.0, 0.5, 1.0, 2.0]) for _ in range(3)]
    translation = [float(rng.randint(-1000, 1000)) for _ in range(3)]
    matrix = a["cache"]["localToWorld"][:]
    inverse = a["cache"]["worldToLocal"][:]
    for k in range(3):
        matrix[k * 4 + k] = scale[k]
        matrix[12 + k] = translation[k]
        inverse[k * 4 + k] = 1 / scale[k]
        inverse[12 + k] = -translation[k] / scale[k]
    a["cache"].update(
        localToWorld=matrix,
        worldToLocal=inverse,
        determinant=f32(scale[0] * scale[1] * scale[2]),
    )
    p = [rng.uniform(-10, 20), rng.uniform(-5, 15), rng.uniform(-100, 100)]
    q = [rng.uniform(-10, 20), rng.uniform(-5, 15), rng.uniform(-100, 100)]
    if j % 3 == 0:
        p = [2.0, 2.0, 100.0]
        q = [2.0, 2.0, -100.0]
    if j % 7 == 0:
        q = p[:]
    if j % 11 == 0:
        p = [2.0, 2.0, float(zs[n // 2] + 1)]
        q = [2.0, 2.0, float(zs[n // 2] - 1)]
    a.update(
        start=[f32(v * scale[k] + translation[k]) for k, v in enumerate(p)],
        end=[f32(v * scale[k] + translation[k]) for k, v in enumerate(q)],
        extent=[f32(rng.uniform(0.1, 4)) for _ in range(3)],
        time=f32(rng.choice([1.0, 0.5, 0.25, 0.0, -0.25])),
        ownerStatic=bool(j % 2),
        ownerFlags3a0=j % 2,
    )
    a["methods"] = dict(
        ownerMaterials=[rng.choice([0, 0x7100010 + i]) for i in range(3)],
        defaultMaterial=rng.choice([0, 0x7200010]),
        ownerMethod124=rng.choice([0, 0x7300010]),
    )
    a["meshMaterials"] = [rng.choice([0, 0x7400010 + i]) for i in range(3)]
    if j % 17 == 0:
        a["cache"]["queryTag"] = 0
    return a


def expected(r):
    events = []
    fields = []
    nodes = []
    triangles = []
    for e in r.pop("events"):
        if e[0] == "node":
            nodes.append(e[1])
        elif e[0] == "triangle":
            triangles.append(e[1])
        elif e[0] == "defaultObject":
            events.append(["defaultMaterial"])
        elif e[0] in ["ownerMaterial", "ownerMethod124"]:
            events.append(e)
        elif e[0] == "object578":
            fields.append(e[1:])
    return r | dict(
        events=events, visitedNodes=nodes, triangleTests=triangles, objectFields=fields
    )
