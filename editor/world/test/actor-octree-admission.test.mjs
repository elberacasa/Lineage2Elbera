import test from "node:test";
import assert from "node:assert/strict";
import {
  createActorOctree,
  updateActorOctree,
  inspectActorOctree,
  insertActorOctree,
  removeActorOctree,
} from "../js/actor-octree.js";
import {
  selectActorPrimitive,
  prepareGenericPrimitiveBounds,
} from "../js/actor-primitive-bounds.js";

const profile = { arithmeticProfile: "pc53-rne" };
const volume = { center: [0, 0, 0], halfExtent: 360448 };
const create = () => createActorOctree({ ...profile, volume }).tree;
const box = { min: [-10, -10, -10], max: [10, 10, 10] };
const input = (fields = {}) => ({
  identity: "actor",
  flags2f8: 1,
  flags64: 0,
  flags2e4: 0,
  flags74: 0xabcdef12,
  location: [1, 2, 3],
  storedLocation: [0, 0, 0],
  level: { infoFlags554: 0 },
  getPrimitive: () => ({ status: "ready", primitiveIdentity: "p" }),
  getPrimitiveBounds: () => ({ status: "ready", bounds: box }),
  ...fields,
});
const nodes = (tree) =>
  inspectActorOctree(tree).memberships.find((a) => a.identity === "actor")
    .nodes;

test("ordinary primitive selection respects priority and consumed unknowns", () => {
  const first = {};
  assert.equal(
    selectActorPrimitive({ primitive104: first }).primitiveIdentity,
    first,
  );
  assert.equal(
    selectActorPrimitive({ primitive104: null, primitive38: "second" })
      .primitiveIdentity,
    "second",
  );
  assert.equal(
    selectActorPrimitive({
      primitive104: null,
      primitive38: null,
      primitive2b8: "third",
    }).primitiveIdentity,
    "third",
  );
  const fallback = {
    primitive104: null,
    primitive38: null,
    primitive2b8: null,
    levelIdentity: "level",
    engineIdentity: "engine",
    enginePrimitive50: "fallback",
  };
  assert.equal(selectActorPrimitive(fallback).primitiveIdentity, "fallback");
  assert.equal(
    selectActorPrimitive({ ...fallback, engineIdentity: null })
      .primitiveIdentity,
    null,
  );
  assert.equal(
    selectActorPrimitive({ ...fallback, levelIdentity: null }).status,
    "unsupported",
  );
  assert.equal(
    selectActorPrimitive({ ...fallback, primitive38: undefined }).status,
    "unsupported",
  );
});

test("generic primitive padding has its own Float32 store before location", () => {
  const r = prepareGenericPrimitiveBounds({
    ...profile,
    location: [1, 2, 3],
    collisionRadius: 2 ** 24,
    collisionHeight: 0,
  });
  assert.equal(r.status, "ready");
  assert.deepEqual(r.bounds, {
    min: [-16777215, -16777214, 2],
    max: [16777216, 16777218, 4],
  });
  assert.ok(Object.isFrozen(r.bounds.min));
  assert.equal(
    prepareGenericPrimitiveBounds({
      ...profile,
      location: [0, , 0],
      collisionRadius: 1,
      collisionHeight: 1,
    }).status,
    "unsupported",
  );
});

test("both early gates preserve old membership without consuming later methods", () => {
  const tree = create();
  assert.equal(updateActorOctree(tree, input()).status, "ready");
  const before = inspectActorOctree(tree);
  for (const skip of [{ flags64: 0x80 }, { flags64: 0, flags2e4: 0x4000 }]) {
    const r = updateActorOctree(tree, {
      identity: "actor",
      flags2f8: 1,
      ...skip,
      get getPrimitive() {
        throw Error("unused");
      },
      get location() {
        throw Error("unused");
      },
    });
    assert.equal(r.disposition, "skipped");
    assert.deepEqual(r.writes, {});
    assert.deepEqual(inspectActorOctree(tree), before);
  }
});

test("old membership is removed before selecting the current primitive", () => {
  const tree = create();
  const first = updateActorOctree(tree, input());
  const r = updateActorOctree(
    tree,
    input({
      storedLocation: first.writes.storedLocation,
      getPrimitive: () => {
        assert.deepEqual(nodes(tree), []);
        return { status: "ready", primitiveIdentity: "p" };
      },
    }),
  );
  assert.equal(r.disposition, "inserted");
  assert.deepEqual(nodes(tree), [""]);
  assert.deepEqual(inspectActorOctree(tree).nodes[0].actors, ["actor"]);
});

test("outside-root update writes bounds while retaining mode and stored location", () => {
  const tree = create();
  updateActorOctree(tree, input());
  const r = updateActorOctree(
    tree,
    Object.defineProperties(
      input({
        getPrimitiveBounds: () => ({
          status: "ready",
          bounds: { min: [500000, 0, 0], max: [500001, 1, 1] },
        }),
      }),
      {
        flags74: {
          get() {
            throw Error("unused");
          },
        },
        level: {
          get() {
            throw Error("unused");
          },
        },
      },
    ),
  );
  assert.equal(r.disposition, "outside-root");
  assert.deepEqual(Object.keys(r.writes).sort(), [
    "cachedBounds",
    "cachedCenter",
    "cachedExtent",
  ]);
  assert.deepEqual(nodes(tree), []);
});

test("level mode changes only the original bit and stores current location", () => {
  for (const [level, expected] of [
    [null, 0xffffffff],
    [{ infoFlags554: 2 }, 0xffffffff],
    [{ infoFlags554: 0 }, 0xfffffeff],
  ]) {
    const r = updateActorOctree(
      create(),
      input({ flags74: 0xffffffff, level }),
    );
    assert.equal(r.writes.flags74, expected);
    assert.deepEqual(r.writes.storedLocation, [1, 2, 3]);
  }
});

test("unknown later state preserves completed source writes and cannot become ready", () => {
  const tree = create();
  const r = updateActorOctree(tree, input({ level: undefined }));
  assert.equal(r.status, "unsupported");
  assert.deepEqual(Object.keys(r.writes).sort(), [
    "cachedBounds",
    "cachedCenter",
    "cachedExtent",
  ]);
  assert.deepEqual(nodes(tree), []);
  const good = updateActorOctree(tree, input());
  assert.equal(good.status, "ready");
  const missing = updateActorOctree(
    tree,
    input({ getPrimitive: () => ({ status: "unsupported" }) }),
  );
  assert.equal(missing.status, "unsupported");
  assert.deepEqual(missing.writes, {});
  assert.deepEqual(nodes(tree), []);
});

test("invalid preconditions and reentrant mutations fail without silently changing membership", () => {
  const tree = create();
  assert.equal(
    updateActorOctree(tree, input({ flags2f8: 0 })).status,
    "unsupported",
  );
  const badRoot = createActorOctree({
    ...profile,
    volume: { ...volume, center: [-0, 0, 0] },
  }).tree;
  assert.equal(updateActorOctree(badRoot, input()).status, "unsupported");
  const r = updateActorOctree(
    tree,
    input({
      getPrimitive: () => {
        assert.equal(updateActorOctree(tree, input()).status, "unsupported");
        assert.equal(removeActorOctree(tree, "actor").status, "unsupported");
        assert.equal(
          insertActorOctree(tree, {
            identity: "other",
            singleNode: true,
            cachedBounds: box,
          }).status,
          "unsupported",
        );
        return { status: "ready", primitiveIdentity: "p" };
      },
    }),
  );
  assert.equal(r.status, "ready");
});
