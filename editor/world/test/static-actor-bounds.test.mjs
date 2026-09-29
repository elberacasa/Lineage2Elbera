import test from "node:test";
import assert from "node:assert/strict";
import {
  transformOriginalBox,
  prepareStaticMeshBounds,
  prepareModelBounds,
  selectActorPrimitive,
  selectBrushPrimitive,
} from "../js/actor-primitive-bounds.js";
import {
  createActorOctree,
  updateActorOctree,
  inspectActorOctree,
} from "../js/actor-octree.js";

const profile = { arithmeticProfile: "pc53-rne" };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const bounds = { min: [-1, -2, -3], max: [4, 5, 6], valid: 1 };
const input = (extra = {}) => ({
  ...profile,
  ownerFlags2f8: 0,
  ownerIdentity: "actor",
  localBounds: bounds,
  collisionModel: null,
  readLocalToWorld: () => ({ status: "ready", matrix: identity }),
  ...extra,
});
const unused = () => {
  throw Error("unconsumed field");
};

test("brush selection consumes only its own model before the shared engine fallback", () => {
  assert.equal(
    selectBrushPrimitive({
      primitive278: "brush-model",
      get primitive104() {
        unused();
      },
      get levelIdentity() {
        unused();
      },
    }).primitiveIdentity,
    "brush-model",
  );
  assert.equal(
    selectBrushPrimitive({
      primitive278: null,
      levelIdentity: "level",
      engineIdentity: null,
    }).primitiveIdentity,
    null,
  );
  assert.equal(
    selectBrushPrimitive({
      primitive278: null,
      levelIdentity: "level",
      engineIdentity: "engine",
      enginePrimitive50: "fallback",
    }).primitiveIdentity,
    "fallback",
  );
  for (const source of [
    {},
    { primitive278: null },
    { primitive278: null, levelIdentity: "level" },
    { primitive278: null, levelIdentity: "level", engineIdentity: "engine" },
  ])
    assert.equal(selectBrushPrimitive(source).status, "unsupported");
});

test("null-owner Model bounds copy validity and signed zeros without calling LocalToWorld", () => {
  for (const valid of [0, 1, 255]) {
    const local = { min: [-0, -2, -3], max: [4, 5, 6], valid };
    const r = prepareModelBounds({
      ownerIdentity: null,
      localBounds: local,
      get readLocalToWorld() {
        unused();
      },
    });
    assert.deepEqual(r.bounds, local);
    assert.notEqual(r.bounds.min, local.min);
    assert.ok(Object.isFrozen(r.bounds.min));
  }
  for (const valid of [undefined, -1, 256, 1.5])
    assert.equal(
      prepareModelBounds({
        ownerIdentity: null,
        localBounds: { ...bounds, valid },
      }).status,
      "unsupported",
    );
});

test("owned Model reads its box after LocalToWorld and does not consume source validity", () => {
  const source = {
    ...profile,
    ownerIdentity: "owner",
    localBounds: undefined,
    readLocalToWorld(owner) {
      assert.equal(owner, "owner");
      source.localBounds = {
        min: [-1, -2, -3],
        max: [4, 5, 6],
        get valid() {
          unused();
        },
      };
      return { status: "ready", matrix: identity };
    },
  };
  assert.deepEqual(prepareModelBounds(source).bounds, bounds);
  assert.equal(
    prepareModelBounds({ ...source, ownerIdentity: undefined }).status,
    "unsupported",
  );
  assert.equal(
    prepareModelBounds({
      ownerIdentity: "owner",
      readLocalToWorld: () => ({ status: "unsupported" }),
      get localBounds() {
        unused();
      },
    }).status,
    "unsupported",
  );
});

test("static auxiliary Model repeats current owner dispatch and transforms its own local box", () => {
  const events = [];
  const matrix = [...identity];
  matrix[12] = 100;
  const local = (owner) => {
    events.push(owner);
    return { status: "ready", matrix: events.length === 1 ? identity : matrix };
  };
  const r = prepareStaticMeshBounds(
    input({
      collisionModel: "model",
      readLocalToWorld: local,
      getCollisionModelBounds(model, owner) {
        assert.equal(model, "model");
        return prepareModelBounds({
          ...profile,
          ownerIdentity: owner,
          readLocalToWorld: local,
          localBounds: { ...bounds, valid: 0 },
        });
      },
    }),
  );
  assert.deepEqual(events, ["actor", "actor"]);
  assert.deepEqual(r.bounds, { min: [-1, -2, -3], max: [104, 5, 6], valid: 1 });
});

test("source box transform ignores validity, visits all corners and returns an owned box", () => {
  const source = {
    min: [-1, -2, -3],
    max: [4, 5, 6],
    get valid() {
      unused();
    },
  };
  // Swapped/reflected axes, scale and translation; opposite source corners
  // alone cannot produce this box's extrema.
  const matrix = [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, -1, 0, 10, 20, 30, 1];
  const r = transformOriginalBox({ ...profile, bounds: source, matrix });
  assert.deepEqual(r.bounds, {
    min: [-5, 18, 24],
    max: [16, 28, 33],
    valid: 1,
  });
  source.min[0] = -100;
  assert.equal(r.bounds.min[1], 18);
  assert.ok(Object.isFrozen(r.bounds.min));
});

test("corner components round at their Float32 store, not after each product", () => {
  const matrix = [...identity];
  matrix[4] = 2 ** 24;
  matrix[8] = -(2 ** 24);
  const r = transformOriginalBox({
    ...profile,
    matrix,
    bounds: { min: [1, 1, 1], max: [1, 1, 1] },
  });
  assert.equal(r.bounds.min[0], 1);
});

test("equal corner and union comparisons preserve the earlier signed zero", () => {
  const matrix = Array(16).fill(-0);
  matrix[15] = 1;
  const zero = { min: [0, 0, 0], max: [0, 0, 0], valid: 0 };
  const r = prepareStaticMeshBounds(
    input({
      localBounds: zero,
      readLocalToWorld: () => ({ status: "ready", matrix }),
      collisionModel: "model",
      getCollisionModelBounds: () => ({
        status: "ready",
        bounds: { min: [0, 0, 0], max: [0, 0, 0], valid: 255 },
      }),
    }),
  );
  // Strict comparisons retain -0 when the auxiliary box contains +0.
  assert.ok(Object.is(r.bounds.min[0], -0));
  assert.ok(Object.is(r.bounds.max[0], -0));
  assert.equal(r.bounds.valid, 1);
});

test("cylinder flag bypasses every mesh and virtual-method input", () => {
  const r = prepareStaticMeshBounds({
    ...profile,
    ownerFlags2f8: 0x100,
    location: [1, 2, 3],
    collisionRadius: 2,
    collisionHeight: 4,
    get ownerIdentity() {
      unused();
    },
    get readLocalToWorld() {
      unused();
    },
    get localBounds() {
      unused();
    },
    get collisionModel() {
      unused();
    },
  });
  assert.deepEqual(r.bounds, { min: [-2, -1, -2], max: [4, 5, 8], valid: 1 });
  assert.deepEqual(
    prepareStaticMeshBounds({
      ...profile,
      ownerFlags2f8: { mask: 0x100, value: 0x100 },
      location: [1, 2, 3],
      collisionRadius: 2,
      collisionHeight: 4,
    }).bounds,
    r.bounds,
  );
  assert.equal(
    prepareStaticMeshBounds({
      ...profile,
      ownerFlags2f8: { mask: 1, value: 1 },
    }).status,
    "unsupported",
  );
});

test("ordinary path reads the box and model after LocalToWorld returns", () => {
  const events = [];
  const state = input({
    readLocalToWorld: (actor) => {
      assert.equal(actor, "actor");
      events.push("transform");
      state.localBounds = { min: [7, 8, 9], max: [10, 11, 12] };
      return { status: "ready", matrix: identity };
    },
    getCollisionModelBounds: (model, owner) => {
      events.push("auxiliary");
      assert.deepEqual([model, owner], ["later", "actor"]);
      return {
        status: "ready",
        bounds: { min: [-10, -20, -30], max: [0, 0, 0], valid: 1 },
      };
    },
  });
  Object.defineProperty(state, "collisionModel", {
    get() {
      assert.deepEqual(events, ["transform"]);
      events.push("model");
      return "later";
    },
  });
  const r = prepareStaticMeshBounds(state);
  assert.deepEqual(events, ["transform", "model", "auxiliary"]);
  assert.deepEqual(r.bounds, {
    min: [-10, -20, -30],
    max: [10, 11, 12],
    valid: 1,
  });
});

test("invalid auxiliary box replaces transformed bounds including its validity byte", () => {
  const auxiliary = { min: [40, 50, 60], max: [-1, -2, -3], valid: 0 };
  const r = prepareStaticMeshBounds(
    input({
      collisionModel: "model",
      getCollisionModelBounds: () => ({ status: "ready", bounds: auxiliary }),
    }),
  );
  assert.deepEqual(r.bounds, auxiliary);
  assert.notEqual(r.bounds.min, auxiliary.min);
});

test("unknown transform stops before later mesh fields are consumed", () => {
  const state = {
    ...profile,
    ownerFlags2f8: 0,
    ownerIdentity: "actor",
    readLocalToWorld: () => ({ status: "unsupported" }),
    get localBounds() {
      unused();
    },
    get collisionModel() {
      unused();
    },
  };
  assert.equal(prepareStaticMeshBounds(state).status, "unsupported");
});

test("missing current state cannot silently become a null model or identity transform", () => {
  for (const extra of [
    { ownerFlags2f8: undefined },
    { ownerFlags2f8: -1 },
    { arithmeticProfile: undefined },
    { ownerIdentity: null },
    { readLocalToWorld: undefined },
    { localBounds: undefined },
    { collisionModel: undefined },
    { collisionModel: "model" },
    {
      collisionModel: "model",
      getCollisionModelBounds: () => ({
        status: "ready",
        bounds: { ...bounds, valid: undefined },
      }),
    },
  ])
    assert.equal(prepareStaticMeshBounds(input(extra)).status, "unsupported");
});

test("sparse, non-Float32 and overflowing box transforms are unsupported", () => {
  for (const matrix of [
    [...identity.slice(0, 15)],
    Array(16),
    identity.map((v, i) => (i === 0 ? 0.1 : v)),
  ]) {
    assert.equal(
      transformOriginalBox({ ...profile, bounds, matrix }).status,
      "unsupported",
    );
  }
  const matrix = [...identity];
  matrix[0] = Math.fround(3e38);
  assert.equal(
    transformOriginalBox({ ...profile, bounds, matrix }).status,
    "unsupported",
  );
  assert.equal(
    transformOriginalBox({
      ...profile,
      matrix: identity,
      bounds: { min: [0, , 0], max: [1, 1, 1] },
    }).status,
    "unsupported",
  );
});

test("static bounds join actor admission and retain source writes on root rejection", () => {
  const { tree } = createActorOctree({
    ...profile,
    volume: { center: [0, 0, 0], halfExtent: 360448 },
  });
  const matrix = [...identity];
  let cache = { flags74: 0, storedLocation: [0, 0, 0] };
  const run = () =>
    updateActorOctree(tree, {
      identity: "actor",
      flags2f8: 1,
      flags64: 0,
      flags2e4: 0,
      ...cache,
      location: matrix.slice(12, 15),
      level: null,
      getPrimitive: () => selectActorPrimitive({ primitive104: "static" }),
      getPrimitiveBounds: () =>
        prepareStaticMeshBounds(
          input({ readLocalToWorld: () => ({ status: "ready", matrix }) }),
        ),
    });
  const inserted = run();
  assert.equal(inserted.disposition, "inserted");
  cache = { ...cache, ...inserted.writes };
  matrix[12] = 500000;
  const removed = run();
  assert.equal(removed.disposition, "outside-root");
  assert.deepEqual(Object.keys(removed.writes).sort(), [
    "cachedBounds",
    "cachedCenter",
    "cachedExtent",
  ]);
  assert.deepEqual(inspectActorOctree(tree).memberships[0].nodes, []);
  matrix[12] = 0;
  assert.equal(run().disposition, "inserted");
});
