// Authored finite hit records; original-client comparison is a separate tool.
import test from "node:test";
import assert from "node:assert/strict";
import { adjustStaticMeshHit } from "../js/static-hit.js";
const fixture = () => ({
  arithmeticProfile: "pc53-rne-math-sqrt",
  start: [2, 2, 30],
  end: [2, 2, -30],
  time: 0.4833333194255829,
  normal: [0, 0, 1],
  actor: "owner",
  mesh: "mesh",
});
const ready = (a) => {
  const r = adjustStaticMeshHit(a);
  assert.equal(r.status, "ready", r.reason);
  return r.writes;
};
test("source bias and separately rounded displacement retain exact final coordinates", () => {
  assert.deepEqual(ready(fixture()), {
    actor: "owner",
    item: "mesh",
    time: 0.46666663885116577,
    point: [2, 2, 2.000001907348633],
    normal: [0, 0, 1],
  });
});
test("Normalize preserves below-threshold source normals including signed zero", () => {
  for (const normal of [
    [Math.fround(1e-5), 0, 0],
    [0, -0, 0],
  ]) {
    const a = { ...fixture(), time: 0.5, normal };
    const r = ready(a);
    assert.deepEqual(r.normal, normal);
    assert.deepEqual(r.point, [2, 2, 1]);
  }
  assert.deepEqual(
    ready({ ...fixture(), normal: [0, 0, 2] }).normal,
    [0, 0, 1],
  );
});
test("source time clamp preserves identity fields and does not infer a collision flag", () => {
  const owner = {},
    mesh = {};
  const r = ready({ ...fixture(), actor: owner, mesh, time: -0.5 });
  assert.equal(r.actor, owner);
  assert.equal(r.item, mesh);
  assert.equal(r.time, 0);
  assert.deepEqual(r.point, fixture().start);
  assert.equal(Object.hasOwn(r, "blocked"), false);
});
test("missing source state and unsupported arithmetic do not gain substitute values", () => {
  for (const patch of [
    { actor: null },
    { mesh: undefined },
    { normal: new Array(3) },
    { end: [2, 2, 30] },
    { time: 0.1 },
    { time: Infinity },
    { arithmeticProfile: "pc53-rne" },
    { start: [0, 0, 0], end: [Math.fround(3e38), Math.fround(3e38), 0] },
    { normal: [Math.fround(3e38), 0, 0] },
  ])
    assert.equal(
      adjustStaticMeshHit({ ...fixture(), ...patch }).status,
      "unsupported",
    );
});
test("adjustment owns returned vectors and does not modify the adopted input", () => {
  const a = fixture(),
    before = structuredClone(a);
  Object.freeze(a.normal);
  Object.freeze(a.start);
  Object.freeze(a.end);
  const r = ready(a);
  assert.deepEqual(a, before);
  assert.throws(() => {
    r.normal[0] = 3;
  }, TypeError);
  assert.throws(() => {
    r.point[0] = 3;
  }, TypeError);
});
