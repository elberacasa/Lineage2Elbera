// Portable synthetic geometry; no game files or original runtime execution.
import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareMoveActorSweep,
  finishMoveActorSweep,
} from "../js/moveactor-arithmetic.js";
const f = Math.fround;
const prepare = (start = [100, 200, 300], delta = [10, 0, 0]) =>
  prepareMoveActorSweep({ start, delta });
const finish = (p, time, extra = {}) =>
  finishMoveActorSweep(p, { time, ...extra }, { arg4: 0 });

test("padding follows movement direction and keeps start independent of collision point", () => {
  const p = prepare();
  assert.deepEqual(p.query, { start: [100, 200, 300], end: [112, 200, 300] });
  assert.deepEqual(p.direction, [1, 0, 0]);
  assert.equal(p.length, 10);
  const r = finish(p, f(0.5), { point: [999, 999, 999], normal: [0, 1, 0] });
  assert.deepEqual(r.adjustedDelta, [4, 0, 0]);
  assert.deepEqual(r.preCallbackLocation, [104, 200, 300]);
  assert.deepEqual(r.hitWrites, { time: f(0.4) });
  assert.equal(r.returnPredicate, true);
});

test("hitWrites preserves unknown fields and the unmodified Time=1 branch", () => {
  const hit = Object.freeze({
    time: 1,
    actor: "actor",
    item: 43,
    normal: null,
  });
  const r = finishMoveActorSweep(prepare(), hit, { arg4: 0 });
  assert.deepEqual(r.hitWrites, {});
  assert.deepEqual(r.preCallbackLocation, [110, 200, 300]);
  assert.deepEqual({ ...hit, ...r.hitWrites }, hit);
  assert.equal(r.returnPredicate, true);
  assert.equal("actor" in r, false);
  assert.equal("normal" in r, false);
});

test("rounded travel at the two-unit boundary stops, just-above moves partially", () => {
  const p = prepare([0, 0, 0], [2, 0, 0]);
  const at = finish(p, 0.5);
  assert.deepEqual(at.adjustedDelta, [0, 0, 0]);
  assert.deepEqual(at.hitWrites, { time: 0 });
  assert.equal(at.returnPredicate, false);
  const next = finish(p, f(0.5000000596046448));
  assert.equal(next.adjustedDelta[0], 2 ** -22);
  assert.equal(next.hitWrites.time, 2 ** -23);
  assert.equal(next.returnPredicate, true);
});

test("signed zero is preserved until the source zero-travel store overwrites it", () => {
  const p = prepare([0, 0, 0], [1, -0, 0]);
  assert.equal(Object.is(p.delta[1], -0), true);
  assert.equal(Object.is(p.extendedDelta[1], -0), true);
  assert.equal(Object.is(finish(p, 1).adjustedDelta[1], -0), true);
  const zero = finish(p, -0);
  assert.equal(Object.is(zero.hitWrites.time, 0), true);
  assert.equal(
    zero.adjustedDelta.every((v) => Object.is(v, 0)),
    true,
  );
});

test("preparation owns immutable copies and accepts repeated independent results", () => {
  const start = [0, 0, 0],
    delta = [10, 0, 0];
  const p = prepare(start, delta);
  start[0] = 999;
  delta[0] = 1;
  assert.deepEqual(p.query.end, [12, 0, 0]);
  assert.throws(() => (p.query.end[0] = 1), TypeError);
  assert.throws(() => (p.length = 1), TypeError);
  assert.throws(() => (finish(p, 0.5).hitWrites.time = 7), TypeError);
  assert.deepEqual(finish(p, 0.5), finish(p, 0.5));
  assert.deepEqual(finish(p, 1).adjustedDelta, [10, 0, 0]);
});

test("nearly-zero, absent, non-Float32 and overflowing queries stay unsupported", () => {
  for (const delta of [
    [0, 0, 0],
    [f(0.0001), 0, 0],
    [0.1, 0, 0],
    [Infinity, 0, 0],
    [1, 2],
  ]) {
    assert.equal(prepare([0, 0, 0], delta).status, "unsupported");
  }
  assert.equal(prepare([f(3e38), 0, 0], [f(3e38), 0, 0]).status, "unsupported");
  assert.equal(prepareMoveActorSweep().status, "unsupported");
  assert.equal(prepareMoveActorSweep(null).status, "unsupported");
  assert.equal(prepare([0, 0, 0], [f(0.00010000001), 0, 0]).status, "ready");
});

test("unknown modes/times and forged preparation never become a clear move", () => {
  const p = prepare();
  for (const options of [
    undefined,
    {},
    { arg4: 1 },
    { arg4: "0" },
    { arg4: null },
  ]) {
    assert.equal(
      finishMoveActorSweep(p, { time: 1 }, options).status,
      "unsupported",
    );
  }
  for (const time of [undefined, null, NaN, Infinity, -1, 1.1, 0.1]) {
    assert.equal(finish(p, time).status, "unsupported");
  }
  assert.equal(finish({ ...p }, 1).status, "unsupported");
  assert.equal(finishMoveActorSweep(p, {}, { arg4: 0 }).status, "unsupported");
});
