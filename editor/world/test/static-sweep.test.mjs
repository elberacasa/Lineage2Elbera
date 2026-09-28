// Authored inputs exercise the component contract, not real actor defaults.
import test from "node:test";
import assert from "node:assert/strict";
import { prepareStaticSweep } from "../js/static-sweep.js";
import { originalActorTransforms } from "../js/actor-transforms.js";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const fixture = () => ({
  arithmeticProfile: "pc53-rne",
  start: [1, 2, 3],
  end: [5, 10, 19],
  extent: [2, 3, 4],
  cacheWorldToLocal: [...identity],
});
const ready = (input) => {
  const result = prepareStaticSweep(input);
  assert.equal(result.status, "ready", result.reason);
  return result;
};
test("explicit query preserves source positions, extents and reciprocal delta", () => {
  const r = ready(fixture());
  assert.deepEqual(r.localStart, [1, 2, 3]);
  assert.deepEqual(r.localEnd, [5, 10, 19]);
  assert.deepEqual(r.localExtent, [2, 3, 4]);
  assert.deepEqual(r.localDelta, [4, 8, 16]);
  assert.deepEqual(r.reciprocalDelta, [0.25, 0.125, 0.0625]);
});
test("translated corner stores change extent even for an identity basis", () => {
  const a = fixture();
  a.extent = [1, 1, 1];
  a.cacheWorldToLocal[12] = 2 ** 24;
  a.cacheWorldToLocal[13] = 2 ** 25;
  // Native-instruction checked authored case: rounded endpoints straddle
  // Float32 spacing boundaries; abs(matrix)*extent would give [1,1,1].
  assert.deepEqual(ready(a).localExtent, [0.5, 0, 1]);
});
test("only exact zero delta receives the original adjustment", () => {
  const a = {
    ...fixture(),
    start: [0, 0, 0],
    end: [Math.fround(1e-9), Math.fround(-1e-9), -0],
  };
  const r = ready(a);
  assert.deepEqual(r.localDelta, [
    Math.fround(1e-9),
    Math.fround(-1e-9),
    Math.fround(1e-7),
  ]);
  assert.deepEqual(r.reciprocalDelta, [1e9, -1e9, 1e7]);
});
test("same-point query remains source-adjusted, not skipped as a zero-length ray", () => {
  const a = fixture();
  a.end = [...a.start];
  assert.deepEqual(ready(a).localDelta, new Array(3).fill(Math.fround(1e-7)));
});
test("zero extent on individual axes is accepted; the all-zero path is separate", () => {
  assert.deepEqual(
    ready({ ...fixture(), extent: [2, 0, -0] }).localExtent,
    [2, 0, 0],
  );
  assert.equal(
    prepareStaticSweep({ ...fixture(), extent: [0, -0, 0] }).status,
    "unsupported",
  );
});
test("source actor matrix composes without a renderer inverse or axis swap", () => {
  const actor = originalActorTransforms({
    arithmeticProfile: "pc53-rne",
    location: [10, 20, 30],
    prePivot: [2, 3, 4],
    rotation: [0, 0, 0],
    drawScale: 2,
    drawScale3D: [1, 2, 4],
    sineTable: Object.assign(new Array(16384), { 0: 0, 4096: 1 }),
  });
  const r = ready({
    ...fixture(),
    start: [10, 20, 30],
    end: [12, 24, 38],
    extent: [2, 4, 8],
    cacheWorldToLocal: actor.worldToLocal,
  });
  assert.deepEqual(r.localStart, [2, 3, 4]);
  assert.deepEqual(r.localEnd, [3, 4, 5]);
  assert.deepEqual(r.localExtent, [1, 1, 1]);
});
test("negative scale preserves direction while source bounds remain ordered", () => {
  const a = fixture();
  a.cacheWorldToLocal[0] = -2;
  const r = ready(a);
  assert.equal(r.localDelta[0], -8);
  assert.equal(r.reciprocalDelta[0], -0.125);
  assert.equal(r.localExtent[0], 4);
});
test("signed zero survives point stores and strict bounds ties", () => {
  const r = ready({
    ...fixture(),
    cacheWorldToLocal: [...new Array(15).fill(-0), 1],
  });
  assert.deepEqual(r.localStart, [-0, -0, -0]);
  assert.deepEqual(r.localEnd, [-0, -0, -0]);
  assert.deepEqual(r.localExtent, [0, 0, 0]);
});
test("missing or sparse inputs and unsupported numerical domains are explicit", () => {
  for (const field of [
    "start",
    "end",
    "extent",
    "cacheWorldToLocal",
    "arithmeticProfile",
  ]) {
    const a = fixture();
    delete a[field];
    assert.equal(prepareStaticSweep(a).status, "unsupported", field);
  }
  for (const field of ["start", "end", "extent", "cacheWorldToLocal"]) {
    const a = fixture();
    a[field] = new Array(a[field].length);
    assert.equal(prepareStaticSweep(a).status, "unsupported", field);
  }
  for (const patch of [
    { extent: [-1, 1, 1] },
    { start: [0.1, 0, 0] },
    { end: [NaN, 0, 0] },
    { extent: [Infinity, 1, 1] },
    { arithmeticProfile: "pc64-rne" },
  ])
    assert.equal(
      prepareStaticSweep({ ...fixture(), ...patch }).status,
      "unsupported",
    );
  for (const a of [null, undefined, {}])
    assert.equal(prepareStaticSweep(a).status, "unsupported");
});
test("nonfinite derived positions or reciprocal do not become a ready query", () => {
  const a = fixture();
  a.cacheWorldToLocal[0] = Math.fround(3e38);
  assert.equal(prepareStaticSweep(a).status, "unsupported");
  assert.equal(
    prepareStaticSweep({
      ...fixture(),
      start: [0, 0, 0],
      end: [Math.fround(1e-45), 0, 0],
    }).status,
    "unsupported",
  );
});
test("inputs stay untouched and all returned numerical fields are immutable", () => {
  const a = fixture();
  for (const value of Object.values(a))
    if (Array.isArray(value)) Object.freeze(value);
  Object.freeze(a);
  const r = ready(a);
  assert.deepEqual(a, fixture());
  for (const name of [
    "localStart",
    "localEnd",
    "localExtent",
    "localDelta",
    "reciprocalDelta",
  ])
    assert.throws(() => {
      r[name][0] = 55;
    }, TypeError);
  assert.throws(() => {
    r.status = "clear";
  }, TypeError);
});
