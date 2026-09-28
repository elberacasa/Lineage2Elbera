// Authored geometry and state; no recovered game assets or live actor defaults.
import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareStaticMeshTree,
  traceStaticMeshTree,
  traceStaticMeshCollision,
} from "../js/static-mesh-tree.js";

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mesh = () => ({
  vertices: [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
  ],
  indices: [0, 1, 2],
  materials: [0],
  collisionTree: {
    trianglePlanes: [[0, 0, -1, 0, ...new Array(12).fill(0)]],
    nodes: [{ links: [0, -1, -1, -1], bounds: [0, 0, 0, 10, 10, 0], valid: 1 }],
  },
});
const input = (source = mesh()) => ({
  arithmeticProfile: "pc53-rne-math-sqrt",
  start: [2, 2, 30],
  end: [2, 2, -30],
  extent: [1, 1, 1],
  time: 1,
  ownerStatic: true,
  ownerFlags3a0: 0,
  cache: {
    worldToLocal: identity(),
    localToWorld: identity(),
    determinant: 1,
    queryTag: 1,
    planes: source.materials.map(() => ({ valid: 0, queryTag: 0 })),
    vertices: source.vertices.map(() => ({ valid: 0 })),
  },
  methods: { ownerVTableAC: () => ({ status: "ready", value: null }) },
  meshMaterials: ["authored-material"],
  inspect: true,
});
const prepared = (source) => {
  const r = prepareStaticMeshTree(source);
  assert.equal(r.status, "ready", r.reason);
  return r.model;
};
const trace = (source = mesh(), a = input(source)) => {
  const r = traceStaticMeshTree(prepared(source), a);
  assert.equal(r.status, "ready", r.reason);
  return r;
};
function secondTriangle(source, z) {
  source.vertices.push([0, 0, z], [10, 0, z], [0, 10, z]);
  source.indices.push(3, 4, 5);
  source.materials.push(1);
  source.collisionTree.trianglePlanes.push([
    0,
    0,
    -1,
    -z,
    ...new Array(12).fill(0),
  ]);
  source.collisionTree.nodes.push({
    links: [1, -1, -1, -1],
    bounds: [0, 0, z, 10, 10, z],
    valid: 1,
  });
}

test("complete original tree returns an unadjusted adopted triangle and sparse cache writes", () => {
  const r = trace();
  assert.equal(r.hit, true);
  assert.deepEqual(r.writes.result, {
    time: 0.4833333194255829,
    normal: [0, 0, 1],
    triangleIndex: 0,
    material: "authored-material",
  });
  assert.deepEqual(r.inspection, { visitedNodes: [0], triangleTests: [0] });
  assert.deepEqual(r.writes.planes, [
    { index: 0, record: { valid: 1, queryTag: 1, plane: [0, 0, -1, 0] } },
  ]);
  assert.equal(r.writes.vertices.length, 3);
  assert.equal(Object.hasOwn(r.writes.result, "point"), false);
});
test("near hit shortens the query before the root triangle is tested", () => {
  const s = mesh();
  secondTriangle(s, 10);
  s.collisionTree.nodes[0].links[2] = 1;
  s.collisionTree.nodes[0].bounds[5] = 10;
  const a = input(s);
  a.meshMaterials.push("near-material");
  const r = trace(s, a);
  assert.equal(r.writes.result.triangleIndex, 1);
  assert.deepEqual(r.inspection, { visitedNodes: [0, 1], triangleTests: [1] });
  assert.deepEqual(
    r.writes.planes.map((p) => p.index),
    [1],
  );
  assert.equal(r.writes.result.material, "near-material");
});
test("coplanar triangle wins an exact time tie before the current triangle", () => {
  const s = mesh();
  secondTriangle(s, 0);
  s.collisionTree.nodes[0].links[1] = 1;
  const a = input(s);
  a.meshMaterials.push("coplanar-material");
  const calls = [];
  a.methods.ownerVTableAC = (slot) => {
    calls.push(slot);
    return { status: "ready", value: null };
  };
  const r = trace(s, a);
  assert.equal(r.writes.result.triangleIndex, 1);
  assert.deepEqual(r.inspection.triangleTests, [1, 0]);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(
    r.writes.planes.map((p) => [p.index, p.record.queryTag]),
    [
      [1, 1],
      [0, 1],
    ],
  );
});
test("duplicate nodes share the original triangle query tag", () => {
  const s = mesh();
  s.collisionTree.nodes[0].links[1] = 1;
  s.collisionTree.nodes.push({
    ...s.collisionTree.nodes[0],
    links: [0, -1, -1, -1],
  });
  const r = trace(s);
  assert.deepEqual(r.inspection, { visitedNodes: [0, 1], triangleTests: [0] });
  assert.equal(r.writes.planes.length, 1);
});
test("already-current tag skips geometry and material state that was never consumed", () => {
  const s = mesh(),
    a = input(s);
  a.cache.planes = [{ queryTag: 1 }];
  a.cache.vertices = [];
  delete a.cache.localToWorld;
  delete a.cache.determinant;
  delete a.ownerStatic;
  delete a.methods;
  delete a.meshMaterials;
  delete a.ownerFlags3a0;
  const r = trace(s, a);
  assert.equal(r.hit, false);
  assert.deepEqual(r.writes, {
    result: {},
    planes: [],
    vertices: [],
    objectFields: [],
  });
  assert.deepEqual(r.inspection.triangleTests, []);
});
test("a rejected triangle still writes its tag and computed cache records", () => {
  const s = mesh(),
    a = input(s);
  a.start = [8, 8, 30];
  a.end = [8, 8, -30];
  delete a.methods;
  const r = trace(s, a);
  assert.equal(r.hit, false);
  assert.deepEqual(r.writes.result, {});
  assert.equal(r.writes.planes[0].record.queryTag, 1);
  assert.equal(r.writes.vertices.length, 3);
});
test("material methods are conditional and retain opaque identities", () => {
  const s = mesh(),
    a = input(s),
    ownerMaterial = { authored: "owner" },
    proxy = { authored: "proxy" },
    calls = [];
  a.ownerFlags3a0 = 1;
  delete a.meshMaterials;
  a.methods = {
    ownerVTableAC(slot) {
      calls.push(["owner", slot]);
      return { status: "ready", value: ownerMaterial };
    },
    ownerVTable124() {
      calls.push(["proxy"]);
      return { status: "ready", value: proxy };
    },
  };
  const r = trace(s, a);
  assert.equal(r.writes.result.material, proxy);
  assert.deepEqual(r.writes.objectFields, [
    { object: proxy, offset: 0x578, value: ownerMaterial },
  ]);
  assert.deepEqual(calls, [["owner", 0], ["proxy"]]);
});
test("null owner and mesh material require the explicit original default response", () => {
  const s = mesh(),
    a = input(s);
  a.meshMaterials = [null];
  const calls = [];
  a.methods.defaultMaterial = () => {
    calls.push("default");
    return { status: "ready", value: null };
  };
  delete a.ownerFlags3a0;
  const r = trace(s, a);
  assert.equal(r.writes.result.material, null);
  assert.deepEqual(calls, ["default"]);
  delete a.methods.defaultMaterial;
  assert.equal(traceStaticMeshTree(prepared(s), a).status, "unsupported");
});
test("unknown consumed cache and callback fields never become a clear query", () => {
  const s = mesh(),
    model = prepared(s);
  for (const change of [
    (a) => {
      delete a.methods;
    },
    (a) => {
      a.methods.ownerVTableAC = () => ({ status: "ready" });
    },
    (a) => {
      a.methods.ownerVTableAC = () => ({ status: "unsupported" });
    },
    (a) => {
      delete a.meshMaterials;
    },
    (a) => {
      delete a.ownerFlags3a0;
    },
    (a) => {
      a.ownerFlags3a0 = 1;
    },
    (a) => {
      delete a.cache.planes[0].queryTag;
    },
    (a) => {
      delete a.cache.planes[0].valid;
    },
    (a) => {
      a.cache.vertices = [];
    },
    (a) => {
      delete a.cache.localToWorld;
    },
    (a) => {
      delete a.cache.worldToLocal;
    },
    (a) => {
      delete a.cache.determinant;
    },
    (a) => {
      delete a.ownerStatic;
    },
    (a) => {
      a.time = Infinity;
    },
    (a) => {
      a.extent = [0, 0, 0];
    },
  ]) {
    const a = input(s);
    change(a);
    assert.equal(traceStaticMeshTree(model, a).status, "unsupported");
  }
  assert.equal(traceStaticMeshTree(model, null).status, "unsupported");
  assert.equal(traceStaticMeshTree(s, input(s)).status, "unsupported");
});
test("prepared source snapshots do not follow caller edits and reject reachable cycles", () => {
  const s = mesh(),
    model = prepared(s),
    a = input(s);
  s.vertices[0][0] = 1000;
  s.collisionTree.nodes[0].links[0] = 99;
  assert.equal(traceStaticMeshTree(model, a).hit, true);
  const cycle = mesh();
  cycle.collisionTree.nodes[0].links[2] = 0;
  assert.equal(prepareStaticMeshTree(cycle).status, "unsupported");
  const sparse = mesh();
  sparse.collisionTree.trianglePlanes = new Array(1);
  assert.equal(prepareStaticMeshTree(sparse).status, "unsupported");
  assert.equal(prepareStaticMeshTree(null).status, "unsupported");
});
test("dynamic source cache writes stay invalid and caller records remain unchanged", () => {
  const s = mesh(),
    a = input(s);
  a.ownerStatic = false;
  const before = structuredClone(a.cache);
  const r = trace(s, a);
  assert.deepEqual(a.cache, before);
  assert.equal(r.writes.planes[0].record.valid, 0);
  assert.ok(r.writes.vertices.every((p) => p.record.valid === 0));
  assert.throws(() => {
    r.writes.planes[0].record.plane[0] = 7;
  }, TypeError);
  assert.throws(() => {
    r.writes.vertices[0].record.point[0] = 7;
  }, TypeError);
  assert.throws(() => {
    r.inspection.triangleTests.push(9);
  }, TypeError);
});
test("tag-only writes own their warm numerical records", () => {
  const s = mesh(),
    a = input(s);
  a.cache.planes = [{ valid: 1, queryTag: 0, plane: [0, 0, -1, 0] }];
  a.cache.vertices = s.vertices.map((point) => ({
    valid: 1,
    point: [...point],
  }));
  const r = trace(s, a);
  a.cache.planes[0].plane[2] = 5;
  assert.deepEqual(r.writes.planes[0].record.plane, [0, 0, -1, 0]);
  assert.equal(r.writes.vertices.length, 0);
});

test("shared vertices can be updated across triangles with frozen caller cache arrays", () => {
  const s = mesh();
  secondTriangle(s, 0);
  s.indices.splice(3, 3, 0, 1, 2);
  s.collisionTree.nodes[0].links[1] = 1;
  const a = input(s);
  a.meshMaterials.push("coplanar-material");
  a.cache.vertices.forEach(Object.freeze);
  Object.freeze(a.cache.vertices);
  a.cache.planes.forEach(Object.freeze);
  Object.freeze(a.cache.planes);
  const r = trace(s, a);
  assert.deepEqual(r.inspection.triangleTests, [1, 0]);
  assert.deepEqual(
    r.writes.vertices.map((v) => v.index),
    [0, 1, 2],
  );
  assert.equal(a.cache.vertices[0].valid, 0);
});

const ordinary = (a) => ({
  ...a,
  ownerFlags2f8: 0,
  collisionModel: null,
  actorIdentity: "authored-owner",
  meshIdentity: "authored-mesh",
});
test("ordinary nonzero composition initializes Time and applies original final hit adjustment", () => {
  const s = mesh(),
    a = ordinary(input(s));
  a.time = 0; // The original outer wrapper assigns one before calling the tree.
  const r = traceStaticMeshCollision(prepared(s), a);
  assert.equal(r.status, "ready", r.reason);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.writes.result, {
    time: 0.46666663885116577,
    normal: [0, 0, 1],
    triangleIndex: 0,
    material: "authored-material",
    actor: "authored-owner",
    item: "authored-mesh",
    point: [2, 2, 2.000001907348633],
  });
});
test("ordinary mesh miss writes Time only and never clears unrelated result fields", () => {
  const s = mesh(),
    a = ordinary(input(s));
  a.start = [20, 20, 30];
  a.end = [20, 20, -30];
  delete a.methods;
  const r = traceStaticMeshCollision(prepared(s), a);
  assert.equal(r.status, "ready", r.reason);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.writes.result, { time: 1 });
});
test("alternate primitive paths and missing owner bindings remain explicit", () => {
  const s = mesh(),
    model = prepared(s),
    a = ordinary(input(s));
  for (const patch of [
    { ownerFlags2f8: 0x100 },
    { ownerFlags2f8: undefined },
    { collisionModel: {} },
    { collisionModel: undefined },
    { actorIdentity: null },
    { meshIdentity: undefined },
  ])
    assert.equal(
      traceStaticMeshCollision(model, { ...a, ...patch }).status,
      "unsupported",
    );
});
