import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleOriginalTrack } from '../js/nativetrack.js';

const identity = [0, 0, 0, 1];
const track = (times, quaternions = times.map(() => identity), positions = [[0, 0, 0]]) =>
  ({ flags: 0, times, quaternions, positions });

test('constant source track preserves the stored nonunit quaternion and position', () => {
  const source = track([0], [[0, 0, 0, 0.8]], [[3, -2, 7]]);
  const result = sampleOriginalTrack(source, 10, 0.7);
  assert.deepEqual(result, { quaternion: [0, 0, 0, Math.fround(0.8)], position: [3, -2, 7],
    first: 0, second: 0, alpha: 0, wrapped: true, hemisphereFlipped: false });
  result.position[0] = 900; result.quaternion[3] = 0;
  assert.deepEqual(source.positions, [[3, -2, 7]]);
  assert.deepEqual(source.quaternions, [[0, 0, 0, 0.8]]);
});

test('exact key time copies that key without interpolation or normalization', () => {
  const source = track([0, 1, 3], [identity, [0, 0, 0, 0.8], identity], [[0, 0, 0], [3, 4, 5], [8, 9, 10]]);
  const result = sampleOriginalTrack(source, 4, 0.25);
  assert.deepEqual(result.quaternion, [0, 0, 0, Math.fround(0.8)]);
  assert.deepEqual(result.position, [3, 4, 5]);
  assert.equal(result.alpha, 0); assert.equal(result.first, 1); assert.equal(result.second, 2);
});

test('sparse source times select the actual interval and preserve constant positions', () => {
  const result = sampleOriginalTrack(track([0, 1, 4], [identity, identity, identity], [[9, 8, 7]]), 8, 0.25);
  assert.equal(result.first, 1); assert.equal(result.second, 2);
  assert.equal(result.alpha, Math.fround(1 / 3));
  assert.deepEqual(result.position, [9, 8, 7]);
});

test('source-duration closing interval interpolates final position back to key zero', () => {
  const result = sampleOriginalTrack(track([0, 1, 3], undefined, [[2, 4, 6], [5, 7, 9], [10, 20, 30]]), 4, 0.875);
  assert.deepEqual(result.position, [6, 12, 18]);
  assert.equal(result.first, 2); assert.equal(result.second, 0);
  assert.equal(result.alpha, 0.5); assert.equal(result.wrapped, true);
});

test('wrapped antipodal successor uses the original hemisphere rule, only on blending', () => {
  const source = track([0, 1], [[0, 0, 0, -1], identity]);
  const atLast = sampleOriginalTrack(source, 2, 0.5);
  assert.equal(atLast.hemisphereFlipped, false);
  const result = sampleOriginalTrack(source, 2, 0.75);
  assert.equal(result.hemisphereFlipped, true);
  assert.deepEqual(result.quaternion, identity);
});

test('ordinary adjacent negative-dot pair is not silently sign-adjusted', () => {
  const source = track([0, 1], [identity, [0, 0, 0, -1]]);
  const result = sampleOriginalTrack(source, 2, 0.25);
  assert.equal(result.wrapped, false); assert.equal(result.hemisphereFlipped, false);
  // Original helper's degenerate normalized-blend fallback, not generic slerp.
  assert.deepEqual(result.quaternion, [0, 0, Math.fround(0.1), 0]);
});

test('wrapped equal-distance hemisphere tie remains unchanged', () => {
  const result = sampleOriginalTrack(track([0, 1], [identity, [1, 0, 0, 0]]), 2, 0.75);
  assert.equal(result.hemisphereFlipped, false);
  assert.ok(result.quaternion.every(v => Number.isFinite(v)));
});

test('small-denominator branch uses alpha one, including zero closing denominator', () => {
  for (const duration of [1, Math.fround(1.00005)]) {
    const result = sampleOriginalTrack(track([0, 1], undefined, [[2, 4, 6], [10, 20, 30]]), duration, 1);
    assert.equal(result.alpha, 1);
    assert.deepEqual(result.position, [2, 4, 6]);
  }
  // Below epsilon on an ordinary interval also chooses its successor.
  const result = sampleOriginalTrack(track([0, 0.00005, 1], undefined, [[0, 0, 0], [8, 4, 2], [9, 9, 9]]), 2, 0.00001);
  assert.equal(result.alpha, 1); assert.deepEqual(result.position, [8, 4, 2]);
});

test('linear/binary search boundary and exact source key selection agree with native domain', () => {
  for (const size of [2, 3, 30, 31, 32, 100, 1000]) {
    const times = Array.from({ length: size }, (_, i) => i * 0.5);
    const source = track(times), duration = size * 0.5;
    for (const index of [0, 1, Math.floor(size / 2), size - 1]) {
      const frame = times[index] / duration;
      const sourceTime = Math.fround(Math.fround(duration) * Math.fround(frame));
      const first = times.findLastIndex(t => t <= sourceTime);
      const result = sampleOriginalTrack(source, duration, frame);
      assert.equal(result.first, first, `size=${size} key=${index}`);
      assert.equal(result.second, (first + 1) % size);
    }
    assert.equal(sampleOriginalTrack(source, duration, 1).alpha, 1);
  }
});

test('translation rounds difference and product before adding original position', () => {
  const source = track([0, 1], undefined, [[-932.1904296875, 712.3893432617188, -83.52323150634766],
    [522.434814453125, -999.8922119140625, 711.9132690429688]]);
  const result = sampleOriginalTrack(source, 2, 0.185);
  // Independently calculated explicit Float32 stores; not a weighted-sum lerp.
  const alpha = Math.fround(Math.fround(2) * Math.fround(0.185));
  const expected = source.positions[0].map((v, i) => Math.fround(v + Math.fround(
    Math.fround(source.positions[1][i] - v) * alpha)));
  assert.deepEqual(result.position, expected);
});

test('invalid, missing, unsupported and nonfinite inputs never fabricate a pose', () => {
  const valid = track([0, 1]);
  for (const [value, duration, frame] of [
    [null, 2, 0], [{ ...valid, flags: undefined }, 2, 0], [{ ...valid, flags: 1 }, 2, 0],
    [{ ...valid, times: [] }, 2, 0], [{ ...valid, times: [1, 2] }, 3, 0],
    [{ ...valid, times: [0, 0] }, 2, 0], [{ ...valid, times: [0, -1] }, 2, 0],
    [{ ...valid, times: [-0, 1] }, 2, 0], [{ ...valid, times: [0, NaN] }, 2, 0],
    [{ ...valid, quaternions: [identity] }, 2, 0], [{ ...valid, positions: [] }, 2, 0],
    [{ ...valid, quaternions: [identity, [NaN, 0, 0, 1]] }, 2, 0],
    [{ ...valid, positions: [[0, 0]] }, 2, 0], [valid, 0, 0], [valid, 0.5, 0],
    [valid, Infinity, 0], [valid, 2, -0.1], [valid, 2, 1.1], [valid, 2, NaN], [valid, 2, -0],
  ]) assert.throws(() => sampleOriginalTrack(value, duration, frame));
});
