import test from "node:test";
import assert from "node:assert/strict";
import {
  octreeChildVolume,
  octreeBoxContainsVolume,
  octreeIntersectedChildren,
  octreeSingleChild,
  octreeSegmentIntersectsBox,
  prepareOctreeActorBounds,
} from "../js/actor-octree-geometry.js";

const arithmeticProfile = "pc53-rne";
const volume = { center: [0, 0, 0], halfExtent: 2 };
const query = (box) => ({ arithmeticProfile, volume, box });
const broad = (fields = {}) => ({
  arithmeticProfile,
  start: [-2, 0, 0],
  center: [0, 0, 0],
  extent: [1, 1, 1],
  direction: [1, 0, 0],
  reciprocal: [1, undefined, undefined],
  ...fields,
});

test("source child bits select X, Y, Z in that order", () => {
  const actual = Array.from(
    { length: 8 },
    (_, child) =>
      octreeChildVolume({ arithmeticProfile, volume, child }).volume.center,
  );
  assert.deepEqual(actual, [
    [-1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [-1, 1, 1],
    [1, -1, -1],
    [1, -1, 1],
    [1, 1, -1],
    [1, 1, 1],
  ]);
});

test("child half extent is stored before center offsets, preserving signed zeros", () => {
  const r = octreeChildVolume({
    arithmeticProfile,
    child: 0,
    volume: { center: [-0, 0, -0], halfExtent: 2 ** -149 },
  });
  assert.equal(r.status, "ready");
  assert.equal(r.volume.halfExtent, 0);
  assert.deepEqual(r.volume.center, [-0, 0, -0]);
  assert.ok(Object.isFrozen(r.volume) && Object.isFrozen(r.volume.center));
});

test("multi-node stop tests full containment, including equal outer faces", () => {
  assert.equal(
    octreeBoxContainsVolume(query({ min: [-2, -2, -2], max: [2, 2, 2] }))
      .contains,
    true,
  );
  assert.equal(
    octreeBoxContainsVolume(query({ min: [-1, -2, -2], max: [2, 2, 2] }))
      .contains,
    false,
  );
  assert.equal(
    octreeBoxContainsVolume(query({ min: [-1, -1, -1], max: [1, 1, 1] }))
      .contains,
    false,
  );
});

test("query child enumeration is descending and uses strict split comparisons", () => {
  assert.deepEqual(
    octreeIntersectedChildren(query({ min: [-1, -1, -1], max: [1, 1, 1] }))
      .children,
    [7, 6, 5, 4, 3, 2, 1, 0],
  );
  assert.deepEqual(
    octreeIntersectedChildren(query({ min: [0, -1, -1], max: [1, 1, 1] }))
      .children,
    [7, 6, 5, 4],
  );
  assert.deepEqual(
    octreeIntersectedChildren(query({ min: [0, -1, -1], max: [0, 1, 1] }))
      .children,
    [],
  );
});

test("single-child insertion retains equality on the low side", () => {
  assert.equal(
    octreeSingleChild(query({ min: [-1, -1, -1], max: [0, 0, 0] })).child,
    0,
  );
  assert.equal(
    octreeSingleChild(query({ min: [0, 0, 0], max: [1, 1, 1] })).child,
    -1,
  );
  assert.equal(
    octreeSingleChild(query({ min: [0, 0, 0], max: [0, 0, 0] })).child,
    0,
  );
  assert.equal(
    octreeSingleChild(query({ min: [1, 1, 1], max: [2, 2, 2] })).child,
    7,
  );
});

test("broad phase admits endpoint contact and does not consume zero-direction reciprocals", () => {
  assert.equal(octreeSegmentIntersectsBox(broad()).intersects, true);
  assert.equal(
    octreeSegmentIntersectsBox(broad({ start: [-2.000001907348633, 0, 0] }))
      .intersects,
    false,
  );
  assert.equal(
    octreeSegmentIntersectsBox(broad({ start: [-2, 2, 0] })).intersects,
    false,
  );
  assert.equal(
    octreeSegmentIntersectsBox(
      broad({
        start: [0, 0, 0],
        direction: [0, 0, 0],
        reciprocal: [undefined, undefined, undefined],
      }),
    ).intersects,
    true,
  );
  assert.equal(
    octreeSegmentIntersectsBox(
      broad({ reciprocal: [undefined, undefined, undefined] }),
    ).status,
    "unsupported",
  );
});

test("unsupported geometry and profiles do not become ready collision answers", () => {
  for (const fn of [
    octreeBoxContainsVolume,
    octreeIntersectedChildren,
    octreeSingleChild,
  ]) {
    assert.equal(fn().status, "unsupported");
    assert.equal(
      fn(query({ min: [NaN, 0, 0], max: [0, 1, 1] })).status,
      "unsupported",
    );
    assert.equal(
      fn({
        ...query({ min: [0, 0, 0], max: [1, 1, 1] }),
        arithmeticProfile: "unobserved",
      }).status,
      "unsupported",
    );
  }
  assert.equal(
    octreeChildVolume({ arithmeticProfile, volume, child: 8 }).status,
    "unsupported",
  );
  assert.equal(
    octreeSegmentIntersectsBox(broad({ extent: [-1, 1, 1] })).intersects,
    false,
  );
});

test("reversed source endpoints retain native child decisions without sorting", () => {
  const q = query({ min: [1, 1, 1], max: [-1, -1, -1] });
  assert.equal(octreeBoxContainsVolume(q).contains, false);
  assert.deepEqual(octreeIntersectedChildren(q).children, []);
  assert.equal(octreeSingleChild(q).child, 7);
  const result = prepareOctreeActorBounds({
    arithmeticProfile,
    primitiveBounds: { min: [10, 0, 0], max: [-10, 0, 0] },
  });
  assert.equal(result.status, "ready");
  assert.ok(result.bounds.min[0] > result.bounds.max[0]);
  assert.ok(result.extent[0] < 0);
});

test("actor bounds retain the source expansion and intermediate stores", () => {
  const r = prepareOctreeActorBounds({
    arithmeticProfile,
    primitiveBounds: { min: [1, 0, 0], max: [100000, 0, 0] },
  });
  assert.equal(r.status, "ready");
  assert.equal(r.bounds.min[0], -3.1999998092651367);
  assert.equal(r.bounds.max[0], 100004.203125);
  assert.equal(r.extent[0], 50003.703125);
  assert.equal(r.center[0], 50000.50390625);
  assert.notEqual(
    r.center[0],
    Math.fround((r.bounds.min[0] + r.bounds.max[0]) * 0.5),
  );
  assert.equal(r.bounds.max[1], Math.fround(4.2));
  assert.ok(Object.isFrozen(r.bounds.min) && Object.isFrozen(r.center));
});

test("root admission is inclusive overlap after expansion", () => {
  const at = (x) =>
    prepareOctreeActorBounds({
      arithmeticProfile,
      primitiveBounds: { min: [x, 0, 0], max: [x, 0, 0] },
    });
  for (const sign of [-1, 1]) {
    assert.equal(at(sign * 360452.1875).rootOverlap, true);
    assert.equal(at(sign * 360452.21875).rootOverlap, false);
  }
  const crossing = prepareOctreeActorBounds({
    arithmeticProfile,
    primitiveBounds: { min: [-400000, 0, 0], max: [400000, 0, 0] },
  });
  assert.equal(crossing.rootOverlap, true);
});

test("missing bounds and nonfinite intermediate stores stay unsupported", () => {
  assert.equal(prepareOctreeActorBounds().status, "unsupported");
  const huge = Math.fround(3e38);
  assert.equal(
    prepareOctreeActorBounds({
      arithmeticProfile,
      primitiveBounds: { min: [-huge, 0, 0], max: [huge, 0, 0] },
    }).status,
    "unsupported",
  );
  assert.equal(
    prepareOctreeActorBounds({
      arithmeticProfile,
      primitiveBounds: { min: [0, , 0], max: [1, 1, 1] },
    }).status,
    "unsupported",
  );
});
