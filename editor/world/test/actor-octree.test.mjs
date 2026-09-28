import test from "node:test";
import assert from "node:assert/strict";
import {
  createActorOctree,
  insertActorOctree,
  removeActorOctree,
  inspectActorOctree,
} from "../js/actor-octree.js";

const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };
const create = (halfExtent = 512) => {
  const result = createActorOctree({
    arithmeticProfile: "pc53-rne",
    volume: { center: [0, 0, 0], halfExtent },
  });
  assert.equal(result.status, "ready");
  return result.tree;
};
const add = (tree, identity, singleNode = true, cachedBounds = bounds) => {
  const result = insertActorOctree(tree, {
    identity,
    singleNode,
    cachedBounds,
  });
  assert.equal(result.status, "ready");
};

test("fourth insertion splits only above the original half-product threshold", () => {
  for (const [half, split] of [
    [200, false],
    [200.00001525878906, true],
  ]) {
    const tree = create(half);
    for (const id of ["a", "b", "c"]) add(tree, id);
    assert.equal(inspectActorOctree(tree).nodes.length, 1);
    add(tree, "d");
    const state = inspectActorOctree(tree);
    assert.equal(state.nodes[0].split, split);
    assert.deepEqual(state.nodes[0].actors, ["a", "b", "c", "d"]);
    assert.equal(state.nodes.length, split ? 9 : 1);
  }
});

test("redistribution keeps source single-node mode and descending multi membership", () => {
  const tree = create();
  for (const id of ["a", "b", "c"]) add(tree, id);
  add(tree, "d", false);
  const state = inspectActorOctree(tree);
  assert.deepEqual(state.nodes[0].actors, ["a", "b", "c"]);
  assert.deepEqual(state.memberships[3], {
    identity: "d",
    nodes: ["7", "6", "5", "4", "3", "2", "1", "0"],
  });
  assert.equal(removeActorOctree(tree, "d").status, "ready");
  assert.equal(removeActorOctree(tree, "a").status, "ready");
  const after = inspectActorOctree(tree);
  assert.equal(after.nodes.length, 9);
  assert.deepEqual(after.nodes[0].actors, ["b", "c"]);
  assert.ok(after.nodes.slice(1).every((n) => n.actors.length === 0));
});

test("duplicate entries survive append and all disappear on removal", () => {
  const tree = create(200);
  for (const id of ["a", "a", "b", "a", "c", "a"]) add(tree, id);
  assert.deepEqual(inspectActorOctree(tree).nodes[0].actors, [
    "a",
    "a",
    "b",
    "a",
    "c",
    "a",
  ]);
  assert.deepEqual(inspectActorOctree(tree).memberships[0].nodes, [
    "",
    "",
    "",
    "",
  ]);
  removeActorOctree(tree, "a");
  assert.deepEqual(inspectActorOctree(tree).nodes[0].actors, ["b", "c"]);
  removeActorOctree(tree, "a");
  assert.deepEqual(inspectActorOctree(tree).nodes[0].actors, ["b", "c"]);
});

test("a split-plane multi box selects no child; a containing box stays at parent", () => {
  const tree = create();
  for (const id of ["a", "b", "c", "d"]) add(tree, id);
  add(tree, "plane", false, { min: [0, 0, 0], max: [0, 0, 0] });
  add(tree, "cover", false, { min: [-512, -512, -512], max: [512, 512, 512] });
  const state = inspectActorOctree(tree);
  assert.deepEqual(state.memberships[4].nodes, []);
  assert.deepEqual(state.memberships[5].nodes, [""]);
});

test("unknown or changed member state fails without silently moving an actor", () => {
  assert.equal(createActorOctree().status, "unsupported");
  assert.equal(
    createActorOctree({
      arithmeticProfile: "unobserved",
      volume: { center: [0, 0, 0], halfExtent: 1 },
    }).status,
    "unsupported",
  );
  const tree = create();
  const identity = {};
  const mutable = { min: [-1, -1, -1], max: [1, 1, 1] };
  add(tree, identity, true, mutable);
  const before = inspectActorOctree(tree);
  mutable.max[0] = 2;
  assert.equal(
    insertActorOctree(tree, {
      identity,
      singleNode: true,
      cachedBounds: mutable,
    }).status,
    "unsupported",
  );
  assert.equal(
    insertActorOctree(tree, { identity, cachedBounds: bounds }).status,
    "unsupported",
  );
  assert.equal(removeActorOctree(tree, {}).status, "unsupported");
  assert.deepEqual(inspectActorOctree(tree), before);
  assert.equal(before.memberships[0].identity, identity);
  assert.ok(Object.isFrozen(before.nodes[0].actors));
  removeActorOctree(tree, identity);
  add(tree, identity, false, mutable);
});
