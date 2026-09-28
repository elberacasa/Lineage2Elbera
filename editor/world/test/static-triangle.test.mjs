// Authored triangles/queries; no recovered geometry or client defaults.
import test from "node:test";
import assert from "node:assert/strict";
import {
  clipStaticTriangle,
  prepareStaticTriangle,
  createStaticTriangleClipState,
} from "../js/static-triangle.js";
const fixture = () => ({
  arithmeticProfile: "pc53-rne-math-sqrt",
  worldVertices: [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
  ],
  worldPlane: [0, 0, -1, 0],
  start: [2, 2, 30],
  end: [2, 2, -30],
  extent: [1, 1, 1],
  initialClipState: { entry: 0, exit: 1 },
});
const ready = (a) => {
  const r = clipStaticTriangle(a);
  assert.equal(r.status, "ready", r.reason);
  return r;
};
const crossed = {
  entry: 0.4833333194255829,
  exit: 0.5166666507720947,
  normal: [0, 0, 1],
  found: 1,
};
test("original triangle stage clips the interval and writes the entering plane", () => {
  const r = ready(fixture());
  assert.equal(r.keep, true);
  assert.deepEqual(r.clipState, crossed);
});
test("a later edge rejection preserves earlier clipping writes", () => {
  const r = ready({ ...fixture(), start: [8, 8, 30], end: [8, 8, -30] });
  assert.equal(r.keep, false);
  assert.deepEqual(r.clipState, crossed);
});
test("an early bounds rejection leaves unknown normal and found absent", () => {
  const r = ready({ ...fixture(), start: [20, 20, 30], end: [20, 20, -30] });
  assert.equal(r.keep, false);
  assert.deepEqual(r.clipState, { entry: 0, exit: 1 });
});
test("exact entry tie retains known state instead of inventing a face normal", () => {
  const a = {
    ...fixture(),
    start: [2, 2, 1],
    end: [2, 2, -1],
    initialClipState: { entry: 0, exit: 1, normal: [9, 8, 7], found: 0 },
  };
  const r = ready(a);
  assert.equal(r.keep, true);
  assert.deepEqual(r.clipState, a.initialClipState);
  delete a.initialClipState.normal;
  delete a.initialClipState.found;
  assert.deepEqual(ready(a).clipState, { entry: 0, exit: 1 });
});
test("edge tangency is retained at the original rounded plane boundary", () => {
  const r = ready({ ...fixture(), start: [6, 6, 30], end: [6, 6, -30] });
  assert.equal(r.keep, true);
  assert.deepEqual(r.clipState, crossed);
});
test("triangle order and supplied plane are explicit and never repaired", () => {
  const a = fixture();
  for (const name of [
    "worldVertices",
    "worldPlane",
    "start",
    "end",
    "extent",
    "initialClipState",
    "arithmeticProfile",
  ]) {
    const b = { ...a };
    delete b[name];
    assert.equal(clipStaticTriangle(b).status, "unsupported", name);
  }
  for (const patch of [
    { worldVertices: new Array(3) },
    { worldVertices: [[0, 0, 0], new Array(3), [0, 1, 0]] },
    { worldPlane: [0, 0, 1, 0.1] },
    { extent: [0, 0, 0] },
    { extent: [-1, 1, 1] },
    { initialClipState: { exit: 1 } },
    { initialClipState: { entry: 0, exit: Infinity } },
    { initialClipState: { entry: 0, exit: 1, normal: new Array(3) } },
    { initialClipState: { entry: 0, exit: 1, found: -1 } },
    { arithmeticProfile: "pc53-rne" },
  ])
    assert.equal(clipStaticTriangle({ ...a, ...patch }).status, "unsupported");
});
test("nonfinite derived plane arithmetic remains unsupported", () => {
  const a = fixture();
  a.worldPlane = [0, 0, Math.fround(3e38), 0];
  assert.equal(clipStaticTriangle(a).status, "unsupported");
});
test("inputs are unchanged and returned state is owned and immutable", () => {
  const a = fixture();
  a.initialClipState.normal = [9, 8, 7];
  const before = structuredClone(a);
  for (const p of a.worldVertices) Object.freeze(p);
  Object.freeze(a.worldVertices);
  Object.freeze(a.initialClipState.normal);
  Object.freeze(a.initialClipState);
  const r = ready(a);
  assert.deepEqual(a, before);
  assert.throws(() => {
    r.clipState.normal[0] = 12;
  }, TypeError);
  assert.throws(() => {
    r.clipState.exit = 12;
  }, TypeError);
});

const sourceFixture = () => ({
  arithmeticProfile: "pc53-rne-math-sqrt",
  triangleIndex: 7,
  indices: [0, 1, 2],
  vertices: fixture().worldVertices,
  vertexCache: [{ valid: 0 }, { valid: 0 }, { valid: 0 }],
  planeCache: { valid: 0 },
  localToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  determinant: 1,
  ownerStatic: true,
});
const prepared = (a) => {
  const r = prepareStaticTriangle(a);
  assert.equal(r.status, "ready", r.reason);
  return r;
};

test("cold source cache derives the plane in original reversed argument order", () => {
  const r = prepared(sourceFixture());
  assert.deepEqual(r.worldVertices, fixture().worldVertices);
  assert.deepEqual(r.worldPlane, [0, 0, -1, 0]);
  assert.deepEqual(r.writes.plane, { valid: 1, plane: [0, 0, -1, 0] });
  assert.deepEqual(
    r.writes.vertices,
    fixture().worldVertices.map((point, index) => ({
      index,
      record: { valid: 1, point },
    })),
  );
});

test("source bStatic controls cache validity without changing the geometry", () => {
  const a = sourceFixture();
  const cold = prepared({ ...a, ownerStatic: false });
  assert.equal(cold.writes.plane.valid, 0);
  assert.ok(cold.writes.vertices.every(({ record }) => record.valid === 0));
  a.vertexCache = cold.writes.vertices.map(({ record }) => record);
  a.planeCache = cold.writes.plane;
  a.ownerStatic = false;
  a.localToWorld[14] = 4;
  const moved = prepared(a);
  assert.deepEqual(moved.worldVertices, [
    [0, 0, 4],
    [10, 0, 4],
    [0, 10, 4],
  ]);
  assert.deepEqual(moved.worldPlane, [0, 0, -1, -4]);
  assert.equal(moved.writes.plane.valid, 0);
});

test("warm source cache consumes its values and does not request unused fields", () => {
  const a = sourceFixture();
  a.vertexCache = a.vertices.map((point) => ({ valid: 9, point }));
  a.planeCache = { valid: 8, plane: [2, 3, 4, 5] };
  delete a.vertices;
  delete a.ownerStatic;
  delete a.localToWorld;
  const r = prepared(a);
  assert.deepEqual(r.worldPlane, [2, 3, 4, 5]);
  assert.deepEqual(r.writes, { vertices: [] });
  a.determinant = -1;
  const flipped = prepared(a);
  assert.deepEqual(flipped.worldVertices, [...r.worldVertices].reverse());
  assert.deepEqual(flipped.worldPlane, r.worldPlane);
});

test("negative determinant flips a newly computed plane and reverses winding", () => {
  const a = sourceFixture();
  a.determinant = -1;
  a.localToWorld[0] = -1;
  const r = prepared(a);
  assert.deepEqual(r.worldVertices, [
    [0, 10, 0],
    [-10, 0, 0],
    [0, 0, 0],
  ]);
  assert.deepEqual(r.worldPlane, [-0, -0, -1, -0]);
  assert.deepEqual(r.writes.plane.plane, r.worldPlane);
});

test("source SafeNormal returns its zero plane for a degenerate triangle", () => {
  const a = sourceFixture();
  a.indices = [0, 0, 0];
  const r = prepared(a);
  assert.deepEqual(r.worldPlane, [0, 0, 0, 0]);
  assert.equal(r.writes.vertices.length, 1);
});

test("only referenced cold vertices need source data, but missing consumed data fails", () => {
  const a = sourceFixture();
  a.vertices.push(undefined);
  a.vertexCache.push(undefined);
  assert.equal(prepared(a).writes.vertices.length, 3);
  for (const patch of [
    { triangleIndex: 65536 },
    { triangleIndex: -1 },
    { indices: new Array(3) },
    { indices: [0, 1, 3] },
    { indices: [0, 1, 4] },
    { planeCache: {} },
    { planeCache: { valid: 1 } },
    { vertexCache: [{ valid: 1 }, { valid: 0 }, { valid: 0 }] },
    { ownerStatic: undefined },
    { determinant: undefined },
    { localToWorld: new Array(16) },
    { vertices: [] },
    { arithmeticProfile: "pc53-rne" },
  ])
    assert.equal(
      prepareStaticTriangle({ ...a, ...patch }).status,
      "unsupported",
    );
});

test("preparation returns immutable sparse writes without mutating cache inputs", () => {
  const a = sourceFixture(),
    before = structuredClone(a);
  const r = prepared(a);
  assert.deepEqual(a, before);
  for (const mutate of [
    () => {
      r.writes.vertices[0].record.point[0] = 7;
    },
    () => {
      r.worldPlane[0] = 7;
    },
    () => {
      r.worldVertices[0][0] = 7;
    },
    () => {
      r.writes.plane.valid = 0;
    },
    () => {
      r.writes.vertices.push({});
    },
  ])
    assert.throws(mutate, TypeError);
});

test("scratch constructor retains explicit closest time and initializes entry to minus one", () => {
  for (const maxTime of [-0, 0, -2, 0.25, 1, 2]) {
    const r = createStaticTriangleClipState(maxTime);
    assert.equal(r.status, "ready");
    assert.deepEqual(r.clipState, {
      entry: -1,
      exit: maxTime,
      normal: [0, 0, 0],
      found: 0,
    });
    assert.throws(() => {
      r.clipState.normal[0] = 8;
    }, TypeError);
  }
  for (const maxTime of [undefined, null, NaN, Infinity, 0.1])
    assert.equal(createStaticTriangleClipState(maxTime).status, "unsupported");
});

test("source scratch entry allows a zero-time entering plane to replace the normal", () => {
  const r = ready({
    ...fixture(),
    start: [2, 2, 1],
    end: [2, 2, -1],
    initialClipState: createStaticTriangleClipState(1).clipState,
  });
  assert.equal(r.keep, true);
  assert.deepEqual(r.clipState, {
    entry: -0,
    exit: 1,
    normal: [0, 0, 1],
    found: 1,
  });
});
