// Authored geometry/state and explicit cache-provider responses, no game assets.
import test from "node:test";
import assert from "node:assert/strict";
import { prepareStaticMeshTree } from "../js/static-mesh-tree.js";
import { originalMatrixDeterminant } from "../js/actor-transforms.js";
import {
  staticMeshCacheKey,
  bindStaticMeshCacheEntry,
  inspectStaticMeshCache,
  traceCachedStaticMeshCollision,
} from "../js/static-mesh-cache.js";

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ready = (value) => ({ status: "ready", ...value });
function fixture() {
  const source = {
    vertices: [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
    ],
    indices: [0, 1, 2],
    materials: [0],
    collisionTree: {
      trianglePlanes: [[0, 0, -1, 0, ...Array(12).fill(0)]],
      nodes: [
        { links: [0, -1, -1, -1], bounds: [0, 0, 0, 10, 10, 0], valid: 1 },
      ],
    },
  };
  const prepared = prepareStaticMeshTree(source);
  assert.equal(prepared.status, "ready");
  const events = [],
    slots = new Map(),
    locks = new Set();
  let lastEntry;
  const keyName = (key) => `${key.high}:${key.low}`;
  const acquire = (entry) => {
    const token = {};
    locks.add(token);
    return ready({ entry, token });
  };
  const provider = {
    get(key, align) {
      events.push(["get", key.low, key.high, align]);
      const entry = slots.get(keyName(key)) ?? null;
      return entry === null ? ready({ entry }) : acquire(entry);
    },
    create(key, bytes, align, extra) {
      events.push(["create", bytes, align, extra]);
      lastEntry = {};
      slots.set(keyName(key), lastEntry);
      return acquire(lastEntry);
    },
    unlock(token) {
      assert.ok(locks.delete(token));
      events.push(["unlock"]);
      return ready();
    },
    flush(key, mask, ignoreLocked) {
      assert.equal(locks.size, 0);
      events.push(["flush", mask, ignoreLocked]);
      slots.delete(keyName(key));
      return ready();
    },
  };
  const a = {
    arithmeticProfile: "pc53-rne-math-sqrt",
    ownerIdentity: {},
    meshIdentity: {},
    ownerCacheIndex: 17,
    meshCacheIndex: 29,
    ownerStatic: true,
    ownerFlags2f8: 0,
    collisionModel: null,
    ownerFlags3a0: 0,
    start: [2, 2, 30],
    end: [2, 2, -30],
    extent: [1, 1, 1],
    provider,
    readTransforms() {
      events.push(["matrices"]);
      return ready({ worldToLocal: identity(), localToWorld: identity() });
    },
    methods: {
      ownerVTableAC() {
        events.push(["material"]);
        return ready({ value: "fixture-material" });
      },
    },
    inspect: true,
  };
  const run = (changes = {}) => {
    const r = traceCachedStaticMeshCollision(prepared.model, {
      ...a,
      ...changes,
    });
    assert.equal(locks.size, 0);
    return r;
  };
  const state = () => inspectStaticMeshCache(lastEntry);
  return {
    a,
    run,
    state,
    events,
    slots,
    locks,
    provider,
    model: prepared.model,
    entry: () => lastEntry,
  };
}

test("original type-e3 cache key preserves DWORD wrap and separate mesh index", () => {
  for (const [owner, mesh, low] of [
    [0, 0, 0xe3],
    [1, 2, 0x1e3],
    [0xffffffff, 0xffffffff, 0xffffffe3],
    [0x1000000, 29, 0xe3],
  ]) {
    const r = staticMeshCacheKey(owner, mesh);
    assert.equal(r.status, "ready");
    assert.equal(r.low, low);
    assert.equal(r.high, mesh);
  }
  for (const value of [undefined, null, -1, 1.5, 0x100000000])
    assert.equal(staticMeshCacheKey(value, 0).status, "unsupported");
});

test("fresh query constructs cache, traces, commits source writes and releases its token", () => {
  const f = fixture(),
    r = f.run();
  assert.equal(r.status, "ready");
  assert.equal(r.blocked, true);
  assert.equal(r.cacheDisposition, "created");
  assert.deepEqual(f.events, [
    ["get", 0x11e3, 29, 8],
    ["create", 224, 8, 0],
    ["matrices"],
    ["material"],
    ["unlock"],
  ]);
  assert.equal(r.writes.result.actor, f.a.ownerIdentity);
  assert.equal(r.writes.result.item, f.a.meshIdentity);
  assert.equal(r.writes.result.time, 0.46666663885116577);
  const snapshot = f.state();
  assert.equal(snapshot.cache.queryTag, 1);
  assert.equal(snapshot.cache.determinant, 1);
  assert.deepEqual(snapshot.cache.planes, [
    { valid: 1, queryTag: 1, plane: [0, 0, -1, 0] },
  ]);
  assert.equal(snapshot.cache.vertices.length, 3);
  assert.ok(snapshot.cache.vertices.every((v) => v.valid === 1));
});

test("fresh clear query leaves cold numeric cells absent", () => {
  const f = fixture(),
    r = f.run({ start: [100, 100, 30], end: [100, 100, -30] });
  assert.equal(r.status, "ready");
  assert.equal(r.blocked, false);
  assert.deepEqual(r.writes.result, { time: 1 });
  assert.deepEqual(f.state().cache.planes, [{ valid: 0, queryTag: 0 }]);
  assert.deepEqual(f.state().cache.vertices, [
    { valid: 0 },
    { valid: 0 },
    { valid: 0 },
  ]);
});

test("query cache writes and unlock precede outer hit normalization", () => {
  const f = fixture(),
    sqrt = Math.sqrt,
    unlock = f.provider.unlock;
  f.provider.unlock = (token) => {
    const snapshot = f.state();
    assert.equal(snapshot.cache.queryTag, 1);
    assert.equal(snapshot.cache.planes[0].valid, 1);
    return unlock(token);
  };
  Math.sqrt = (value) => {
    f.events.push(["sqrt"]);
    return sqrt(value);
  };
  try {
    assert.equal(f.run().status, "ready");
    const released = f.events.findIndex((e) => e[0] === "unlock");
    assert.ok(released >= 0);
    assert.ok(f.events.slice(released + 1).some((e) => e[0] === "sqrt"));
  } finally {
    Math.sqrt = sqrt;
  }
});

test("static reuse retains cached matrices without consuming matrix methods", () => {
  const f = fixture();
  assert.equal(f.run().status, "ready");
  f.events.length = 0;
  const r = f.run({ readTransforms: undefined });
  assert.equal(r.status, "ready");
  assert.equal(r.cacheDisposition, "reused");
  assert.deepEqual(f.events, [
    ["get", 0x11e3, 29, 8],
    ["material"],
    ["unlock"],
  ]);
  assert.equal(f.state().cache.queryTag, 2);
  assert.equal(f.state().cache.planes[0].queryTag, 2);
});

test("dynamic reuse refreshes matrices and recomputes invalid geometry", () => {
  const f = fixture();
  assert.equal(f.run({ ownerStatic: false }).status, "ready");
  const localToWorld = identity(),
    worldToLocal = identity();
  localToWorld[14] = 5;
  worldToLocal[14] = -5;
  f.events.length = 0;
  const r = f.run({
    ownerStatic: false,
    readTransforms() {
      f.events.push(["matrices"]);
      return ready({ localToWorld, worldToLocal });
    },
  });
  assert.equal(r.status, "ready");
  assert.equal(r.writes.result.point[2], 7);
  assert.deepEqual(f.events, [
    ["get", 0x11e3, 29, 8],
    ["matrices"],
    ["material"],
    ["unlock"],
  ]);
  assert.equal(f.state().cache.planes[0].valid, 0);
  assert.ok(f.state().cache.vertices.every((v) => v.valid === 0));
});

test("matrix refresh does not clear original warm validity or unvisited tags", () => {
  const f = fixture();
  f.run();
  const before = f.state();
  const r = f.run({
    ownerStatic: false,
    start: [100, 100, 30],
    end: [100, 100, -30],
  });
  assert.equal(r.status, "ready");
  const after = f.state();
  assert.deepEqual(after.cache.planes, before.cache.planes);
  assert.deepEqual(after.cache.vertices, before.cache.vertices);
  assert.equal(after.cache.queryTag, 2);
});

test("a key collision with a different owner unlocks, flushes and creates fresh storage", () => {
  const f = fixture();
  f.run();
  const previous = f.entry();
  f.events.length = 0;
  const r = f.run({ ownerIdentity: {}, ownerCacheIndex: 17 + 0x1000000 });
  assert.equal(r.status, "ready");
  assert.equal(r.cacheDisposition, "replaced");
  assert.deepEqual(f.events, [
    ["get", 0x11e3, 29, 8],
    ["unlock"],
    ["flush", 0xffffffff, 0],
    ["create", 224, 8, 0],
    ["matrices"],
    ["material"],
    ["unlock"],
  ]);
  assert.equal(inspectStaticMeshCache(previous).status, "unsupported");
  assert.equal(f.state().cache.queryTag, 1);
});

test("different mesh identity is checked even when the owner identity agrees", () => {
  const f = fixture();
  f.run();
  const r = f.run({ meshIdentity: {} });
  assert.equal(r.status, "ready");
  assert.equal(r.cacheDisposition, "replaced");
  assert.equal(f.state().cache.queryTag, 1);
});

test("explicit recovered tag wraps to zero and preserves same-tag triangle suppression", () => {
  const f = fixture(),
    entry = {},
    cache = {
      worldToLocal: identity(),
      localToWorld: identity(),
      determinant: 1,
      queryTag: 0xffffffff,
      planes: [{ valid: 0, queryTag: 0 }],
      vertices: [{ valid: 0 }, { valid: 0 }, { valid: 0 }],
    };
  const result = bindStaticMeshCacheEntry(entry, { ...f.a, cache });
  assert.equal(result.status, "ready");
  f.slots.set("29:4579", entry);
  const r = f.run({ readTransforms: undefined });
  assert.equal(r.status, "ready");
  assert.equal(r.blocked, false);
  assert.deepEqual(r.inspection.triangleTests, []);
  assert.equal(inspectStaticMeshCache(entry).cache.queryTag, 0);
  const again = f.run({ readTransforms: undefined });
  assert.equal(again.status, "ready");
  assert.equal(again.blocked, true);
  assert.equal(inspectStaticMeshCache(entry).cache.queryTag, 1);
  assert.equal(cache.queryTag, 0xffffffff);
  assert.deepEqual(cache.planes, [{ valid: 0, queryTag: 0 }]);
});

test("unsupported transform state releases the acquired token and never becomes a clear hit", () => {
  const f = fixture(),
    r = f.run({ readTransforms: () => ({ status: "unsupported" }) });
  assert.equal(r.status, "unsupported");
  assert.equal(Object.hasOwn(r, "blocked"), false);
  assert.deepEqual(f.events.at(-1), ["unlock"]);
});

test("unrecognized existing entries and unresolved releases remain unsupported", () => {
  const f = fixture();
  f.slots.set("29:4579", {});
  assert.equal(f.run().status, "unsupported");
  assert.deepEqual(f.events, [["get", 0x11e3, 29, 8], ["unlock"]]);
  f.slots.clear();
  const unlock = f.provider.unlock;
  f.provider.unlock = (token) => {
    unlock(token);
    return { status: "unsupported" };
  };
  assert.equal(f.run().status, "unsupported");
  assert.equal(f.events.filter((e) => e[0] === "unlock").length, 2);
});

test("foreign models and alternate primitive branches do not acquire cache storage", () => {
  const f = fixture();
  assert.equal(traceCachedStaticMeshCollision({}, f.a).status, "unsupported");
  for (const changes of [
    { ownerFlags2f8: 0x100 },
    { collisionModel: {} },
    { ownerStatic: undefined },
    { ownerCacheIndex: undefined },
  ])
    assert.equal(f.run(changes).status, "unsupported");
  assert.deepEqual(f.events, []);
});

test("diagnostic snapshots own their records and recovered entries cannot be rebound", () => {
  const f = fixture();
  f.run();
  const s = f.state();
  assert.ok(Object.isFrozen(s.cache));
  assert.ok(Object.isFrozen(s.cache.planes[0].plane));
  f.run();
  assert.equal(s.cache.queryTag, 1);
  assert.equal(s.cache.planes[0].queryTag, 1);
  assert.equal(
    bindStaticMeshCacheEntry(f.entry(), { ...f.a, cache: s.cache }).status,
    "unsupported",
  );
});

test("named determinant helper rejects missing profile and sparse or nonfinite matrices", () => {
  assert.equal(
    originalMatrixDeterminant({ matrix: identity() }).status,
    "unsupported",
  );
  const sparse = identity();
  delete sparse[5];
  const bad = identity();
  bad[0] = Infinity;
  for (const matrix of [sparse, bad])
    assert.equal(
      originalMatrixDeterminant({ arithmeticProfile: "pc53-rne", matrix })
        .status,
      "unsupported",
    );
  assert.equal(
    originalMatrixDeterminant({
      arithmeticProfile: "pc53-rne",
      matrix: identity(),
    }).determinant,
    1,
  );
});
