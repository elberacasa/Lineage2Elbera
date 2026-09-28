import test from "node:test";
import assert from "node:assert/strict";
import {
  createActorOctree,
  updateActorOctree,
  queryActorOctree,
  removeActorOctree,
} from "../js/actor-octree.js";
import { isActorOwnedBy } from "../js/actor-blocking.js";

function fixture(ids = ["a", "b"]) {
  const { tree } = createActorOctree({
    arithmeticProfile: "pc53-rne",
    volume: { center: [0, 0, 0], halfExtent: 360448 },
  });
  const actors = new Map();
  for (const identity of ids) {
    const r = updateActorOctree(tree, {
      identity,
      flags2f8: 0x41,
      flags64: 0,
      flags2e4: 0,
      flags74: 0,
      level: null,
      location: [0, 0, 0],
      getPrimitive: () => ({ status: "ready", primitiveIdentity: identity }),
      getPrimitiveBounds: () => ({
        status: "ready",
        bounds: { min: [-5, -5, -5], max: [5, 5, 5] },
      }),
    });
    assert.equal(r.status, "ready");
    actors.set(identity, { ...r.writes, flags2f8: 0x41, tag1b0: 0 });
  }
  const input = {
    start: [-10, 0, 0],
    end: [10, 0, 0],
    extent: [1, 1, 1],
    maskedZeroDivision: true,
    currentTag: 0,
    flags: 0x10,
    extra: 0,
    sourceActor: null,
    readActor: (id) => ({ status: "ready", actor: actors.get(id) }),
    isOwnedBy: (actor, owner) =>
      isActorOwnedBy({ actor, owner, ownerOf: () => null }),
    shouldTrace: () => ({ status: "ready", value: 1 }),
    getPrimitive: (id) => ({ status: "ready", primitiveIdentity: id }),
    lineCheck: (primitive, { initialResult }) => {
      assert.deepEqual(initialResult, {
        next: null,
        actor: null,
        point: [0, 0, 0],
        normal: [0, 0, 0],
        item: 0,
        time: 0,
        nodeIndex: -1,
        material: null,
      });
      return {
        status: "ready",
        hit: true,
        writes: { actor: primitive, time: 0.5 },
      };
    },
  };
  return { tree, actors, input };
}

test("query prepends hits, keeps equal-time list order and distinguishes first-hit mode", () => {
  for (const [flags, expected] of [
    [0x10, ["b", "a"]],
    [0x410, ["b"]],
    [0x210, ["a"]],
    [0x610, ["a"]],
  ]) {
    const { tree, input } = fixture();
    const r = queryActorOctree(tree, { ...input, flags });
    assert.equal(r.status, "ready");
    assert.deepEqual(
      r.hits.map((h) => h.actor),
      expected,
    );
    assert.ok(r.hits.every((h) => !Object.hasOwn(h, "next")));
    assert.ok(Object.isFrozen(r.hits));
  }
});

test("tag wrap suppresses previously tagged actors before later fields are consumed", () => {
  const { tree, input } = fixture(["a"]);
  const r = queryActorOctree(tree, {
    ...input,
    currentTag: 0xffffffff,
    readActor: () => ({ status: "ready", actor: { tag1b0: 0 } }),
    shouldTrace: () => {
      throw Error("unreachable");
    },
  });
  assert.equal(r.status, "ready");
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.writes, { actorTags: [], currentTag: 0 });
});

test("rejected actor still receives its tag and source/self gates precede virtual methods", () => {
  const { tree, actors, input } = fixture();
  actors.get("a").flags2f8 = 1;
  const r = queryActorOctree(tree, {
    ...input,
    sourceActor: "b",
    isOwnedBy: () => {
      throw Error("unreachable");
    },
  });
  assert.equal(r.status, "ready");
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.writes.actorTags, [
    { identity: "a", tag1b0: 1 },
    { identity: "b", tag1b0: 1 },
  ]);
});

test("minimum reduction uses strict comparison with original max-float sentinel", () => {
  const { tree, input } = fixture();
  const r = queryActorOctree(tree, {
    ...input,
    flags: 0x410,
    lineCheck: () => ({
      status: "ready",
      hit: true,
      writes: { time: 3.4028234663852886e38 },
    }),
  });
  assert.equal(r.status, "ready");
  assert.deepEqual(r.hits, []);
});

test("unsupported later method preserves partial hits and ordered tag writes", () => {
  const { tree, input } = fixture();
  const r = queryActorOctree(tree, {
    ...input,
    shouldTrace: (id) =>
      id === "a" ? { status: "ready", value: 1 } : { status: "unsupported" },
  });
  assert.equal(r.status, "unsupported");
  assert.deepEqual(
    r.hits.map((h) => h.actor),
    ["a"],
  );
  assert.deepEqual(
    r.writes.actorTags.map((w) => w.identity),
    ["a", "b"],
  );
  assert.equal(removeActorOctree(tree, "a").status, "ready");
});

test("zero-direction arithmetic and zero-extent traversal require distinct admission", () => {
  const { tree, input } = fixture();
  assert.equal(
    queryActorOctree(tree, { ...input, maskedZeroDivision: false }).status,
    "unsupported",
  );
  assert.equal(
    queryActorOctree(tree, { ...input, extent: [0, 0, 0] }).status,
    "unsupported",
  );
  assert.equal(
    queryActorOctree(tree, { ...input, end: input.start }).status,
    "ready",
  );
});

test("tree mutation or nested query during a virtual call is rejected", () => {
  const { tree, input } = fixture();
  const r = queryActorOctree(tree, {
    ...input,
    shouldTrace: () => {
      assert.equal(removeActorOctree(tree, "a").status, "unsupported");
      assert.equal(queryActorOctree(tree, input).status, "unsupported");
      return { status: "ready", value: 1 };
    },
  });
  assert.equal(r.status, "ready");
  assert.equal(r.hits.length, 2);
});

test("ordinary ownership follows Owner, includes receiver and fails on unknown or cyclic state", () => {
  const ownerOf = (id) => ({ child: "parent", parent: null })[id];
  assert.equal(
    isActorOwnedBy({ actor: "child", owner: "child", ownerOf }).value,
    1,
  );
  assert.equal(
    isActorOwnedBy({ actor: "child", owner: "parent", ownerOf }).value,
    1,
  );
  assert.equal(isActorOwnedBy({ actor: null, owner: null, ownerOf }).value, 0);
  assert.equal(
    isActorOwnedBy({ actor: "missing", owner: "parent", ownerOf }).status,
    "unsupported",
  );
  assert.equal(
    isActorOwnedBy({ actor: "child", owner: "other", ownerOf: (id) => id })
      .status,
    "unsupported",
  );
});

test("a primitive miss never adopts scratch writes and unknown result fields stay unsupported", () => {
  const { tree, input } = fixture(["a"]);
  const miss = queryActorOctree(tree, {
    ...input,
    lineCheck: () => ({ status: "ready", hit: false, writes: { time: 0 } }),
  });
  assert.equal(miss.status, "ready");
  assert.deepEqual(miss.hits, []);
  const unknown = queryActorOctree(tree, {
    ...input,
    lineCheck: () => ({
      status: "ready",
      hit: true,
      writes: { inventedField: 1 },
    }),
  });
  assert.equal(unknown.status, "unsupported");
});

test("query consumes only its trace bit and preserves negative cached extents", () => {
  for (const padding of [1, 20]) {
    const { tree, actors, input } = fixture(["a"]),
      actor = actors.get("a");
    const update = updateActorOctree(tree, {
      identity: "a",
      flags2f8: { mask: 1, value: 1 },
      flags64: { mask: 0x80, value: 0 },
      flags2e4: { mask: 0x4000, value: 0 },
      flags74: actor.flags74,
      storedLocation: actor.storedLocation,
      location: [0, 0, 0],
      level: null,
      getPrimitive: () => ({ status: "ready", primitiveIdentity: "a" }),
      getPrimitiveBounds: () => ({
        status: "ready",
        bounds: { min: [10, -5, -5], max: [-10, 5, 5] },
      }),
    });
    assert.equal(update.status, "ready");
    Object.assign(actor, update.writes, {
      flags2f8: { mask: 0x40, value: 0x40 },
    });
    const result = queryActorOctree(tree, {
      ...input,
      extent: [padding, 1, 1],
    });
    assert.equal(result.status, "ready");
    assert.equal(result.hits.length, padding === 1 ? 0 : 1);
    actor.flags2f8 = { mask: 1, value: 1 };
    const unresolved = queryActorOctree(tree, { ...input, currentTag: 2 });
    assert.equal(unresolved.status, "unsupported");
    assert.equal(unresolved.writes.actorTags.length, 1);
  }
});
