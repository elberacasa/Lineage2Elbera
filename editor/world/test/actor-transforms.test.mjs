// Authored fixtures, not recovered client defaults or a real sine table.
import test from "node:test";
import assert from "node:assert/strict";
import { originalActorTransforms } from "../js/actor-transforms.js";
const fixture = () => ({
  arithmeticProfile: "pc53-rne",
  location: [0, 0, 0],
  prePivot: [0, 0, 0],
  rotation: [0, 0, 0],
  drawScale: 1,
  drawScale3D: [1, 1, 1],
  sineTable: Object.assign(new Array(16384), { 0: 0, 4096: 1 }),
});
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const localIdentity = identity.map((v, i) => (i === 6 || i === 8 ? -0 : v));
const check = (x) => {
  const r = originalActorTransforms(x);
  assert.equal(r.status, "ready", r.reason);
  return r;
};
test("translation retains source intermediates when a rounded basis would cancel to zero", () => {
  const a = fixture();
  a.sineTable[0] = Math.fround(0.37);
  a.sineTable[4096] = Math.fround(0.61);
  a.drawScale = Math.fround(1.1);
  a.drawScale3D = [0.75, 1, 1];
  a.prePivot = [8192, 0, 0];
  a.location = [2514.80078125, 0, 0];
  const result = check(a);
  // This authored input's original-instruction output is Float32 word b8fff585.
  assert.equal(result.localToWorld[12], -0.00012205079110572115);
  assert.equal(a.location[0] - result.localToWorld[0] * a.prePivot[0], 0);
});
test("explicit table and actor state reproduce synthetic identity", () => {
  const r = check(fixture());
  assert.deepEqual(r.localToWorld, localIdentity);
  assert.deepEqual(r.worldToLocal, identity);
  assert.equal(r.determinant, 1);
});
test("pre-pivot is transformed before world translation", () => {
  const a = {
    ...fixture(),
    location: [10, 20, 30],
    prePivot: [2, 3, 4],
    drawScale: 2,
    drawScale3D: [1, 2, 4],
  };
  const r = check(a);
  assert.deepEqual(
    r.localToWorld,
    [2, 0, 0, 0, 0, 4, -0, 0, -0, 0, 8, 0, 6, 8, -2, 1],
  );
  assert.deepEqual(
    r.worldToLocal,
    [0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.125, 0, -3, -2, 0.25, 1],
  );
  assert.equal(r.determinant, 64);
});
test("negative source scale preserves handedness instead of an absolute-size substitute", () => {
  const r = check({ ...fixture(), drawScale3D: [-2, 3, 4] });
  assert.equal(r.localToWorld[0], -2);
  assert.equal(r.worldToLocal[0], -0.5);
  assert.equal(r.determinant, -24);
});
test("inverse rotation uses negated integer lookup indices, not inversion of rounded forward rotation", () => {
  const a = fixture();
  a.rotation = [1, 0, 0];
  a.sineTable[16383] = 0.75;
  a.sineTable[4095] = 0.5;
  const r = check(a);
  assert.deepEqual(r.localToWorld, localIdentity);
  assert.deepEqual(
    r.worldToLocal,
    [0.5, 0, 0.75, 0, 0, 1, 0, 0, -0.75, 0, 0.5, 0, 0, 0, 0, 1],
  );
});
test("signed 32-bit angle wrap preserves the original mask and table domain", () => {
  const a = fixture();
  a.rotation = [-0x80000000, 0, 0];
  assert.deepEqual(check(a).localToWorld, localIdentity);
  const b = fixture();
  b.rotation = [0x7fffffff, 0, 0];
  b.sineTable[16383] = 0.75;
  b.sineTable[4095] = 0.5;
  const r = check(b);
  assert.equal(r.localToWorld[0], 0.5);
  assert.equal(r.localToWorld[2], 0.75);
});
test("source table is read only at consumed entries; no host sine is consulted", () => {
  const a = fixture();
  const before = Math.sin;
  Math.sin = () => {
    throw Error("host sine is not original data");
  };
  try {
    assert.equal(check(a).status, "ready");
  } finally {
    Math.sin = before;
  }
  a.sineTable[4096] = undefined;
  assert.equal(originalActorTransforms(a).status, "unsupported");
});
test("Float32Array source tables are accepted; source table and actor inputs are untouched", () => {
  const a = fixture();
  a.sineTable = new Float32Array(16384);
  a.sineTable[4096] = 1;
  Object.freeze(a.location);
  Object.freeze(a.drawScale3D);
  Object.freeze(a.prePivot);
  Object.freeze(a.rotation);
  Object.freeze(a);
  const r = check(a);
  assert.deepEqual(r.localToWorld, localIdentity);
  assert.equal(a.sineTable[4096], 1);
  assert.throws(() => (r.localToWorld[0] = 8), TypeError);
  assert.throws(() => (r.worldToLocal[0] = 8), TypeError);
});
test("missing fields or a table of the wrong shape never become identity defaults", () => {
  for (const field of [
    "arithmeticProfile",
    "location",
    "prePivot",
    "rotation",
    "drawScale",
    "drawScale3D",
    "sineTable",
  ]) {
    const a = fixture();
    delete a[field];
    assert.equal(originalActorTransforms(a).status, "unsupported", field);
  }
  for (const input of [
    undefined,
    null,
    {},
    { ...fixture(), sineTable: [0, 1] },
  ])
    assert.equal(originalActorTransforms(input).status, "unsupported");
});
test("unrepresentable values, invalid integer rotations and zero inverse scales remain unsupported", () => {
  for (const replacement of [
    { drawScale: 0 },
    { drawScale: -0 },
    { drawScale: 0.1 },
    { drawScale: Infinity },
    { drawScale3D: [1, 0, 1] },
    { drawScale3D: [1, NaN, 1] },
    { rotation: [0.5, 0, 0] },
    { rotation: [0x80000000, 0, 0] },
    { location: [1, 2] },
    { prePivot: [0, 0, 0.1] },
  ]) {
    assert.equal(
      originalActorTransforms({ ...fixture(), ...replacement }).status,
      "unsupported",
    );
  }
  const a = fixture();
  a.sineTable[4096] = Infinity;
  assert.equal(originalActorTransforms(a).status, "unsupported");
});

test("sparse actor vectors or rotations never silently become zero components", () => {
  for (const field of ["rotation", "location", "prePivot", "drawScale3D"]) {
    const a = fixture();
    a[field] = new Array(3);
    assert.equal(originalActorTransforms(a).status, "unsupported", field);
  }
});
test("unqualified arithmetic profiles and nonfinite derived inverses remain unsupported", () => {
  for (const arithmeticProfile of ["pc64-rne", "pc24-rne", "browser", null])
    assert.equal(
      originalActorTransforms({ ...fixture(), arithmeticProfile }).status,
      "unsupported",
    );
  assert.equal(
    originalActorTransforms({ ...fixture(), drawScale: Math.fround(1e-45) })
      .status,
    "unsupported",
  );
});
