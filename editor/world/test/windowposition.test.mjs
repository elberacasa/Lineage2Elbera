// Elbera Tools: finite native saved-window arithmetic without private assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowCornerInside, defaultWindowPosition } from '../js/ui/windowposition.js';
const rect = (x, y, width, height) => ({ x, y, width, height });
const viewport = rect(0, 0, 623, 760);
const rule = { anchor: 6, offsetX: -46, offsetY: -50, anchored: false, w: null, h: null };

test('saved offscreen Inventory uses the separate source reset offsets', () => {
  const saved = rect(722, 127, 256, 401);
  assert.equal(windowCornerInside(saved, viewport), false);
  assert.deepEqual(defaultWindowPosition(rule, saved, viewport), rect(321, 130, 256, 401));
});

test('any corner, including exact screen boundaries, admits a saved window', () => {
  const parent = rect(0, 0, 100, 100);
  for (const window of [rect(100, 50, 10, 10), rect(-10, 50, 10, 10),
    rect(50, 100, 10, 10), rect(50, -10, 10, 10)]) assert.equal(windowCornerInside(window, parent), true);
  for (const window of [rect(101, 50, 10, 10), rect(-11, 50, 10, 10),
    rect(50, 101, 10, 10), rect(50, -11, 10, 10)]) assert.equal(windowCornerInside(window, parent), false);
});

test('four-corner admission differs from general overlap and containment', () => {
  assert.equal(windowCornerInside(rect(622, 759, 256, 401), viewport), true);
  assert.equal(windowCornerInside(rect(-10, -10, 643, 780), viewport), false);
  assert.equal(windowCornerInside(rect(-10, 25, 643, 50), viewport), false);
});

test('child corner sums truncate toward zero; parent bounds do not', () => {
  assert.equal(windowCornerInside(rect(-2, 1, 1.5, 1), rect(0, 0, 10, 10)), true);
  assert.equal(windowCornerInside(rect(1, -2, 1, 1.5), rect(0, 0, 10, 10)), true);
  // Fractional browser root dimensions remain fractional upper bounds.
  assert.equal(windowCornerInside(rect(0, 0, 1, 1), rect(-10, 0, 9.75, 10)), false);
});

test('default anchor computes separate absolute points before subtraction', () => {
  assert.deepEqual(defaultWindowPosition(rule, rect(0, -250, 256, 401), viewport), rect(321, 129, 256, 401));
  assert.deepEqual(defaultWindowPosition(rule, rect(0, 0, 256, 401), rect(10, 20, 623, 761)), rect(331, 150, 256, 401));
});

test('unanchored reset positions before applying a new explicit size', () => {
  assert.deepEqual(defaultWindowPosition({ ...rule, w: 300 }, rect(722, 127, 256, 401), viewport),
    rect(321, 130, 300, 401));
});

test('invalid bounds or unknown anchor cannot produce an invented placement', () => {
  assert.equal(windowCornerInside(rect(NaN, 0, 10, 10), viewport), false);
  assert.equal(defaultWindowPosition({ ...rule, anchor: 0 }, rect(0, 0, 1, 1), viewport), null);
  assert.equal(defaultWindowPosition(rule, rect(0, 0, Infinity, 1), viewport), null);
});
