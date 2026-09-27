import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOriginalTrack, sampleOriginalTrack } from '../js/nativetrack.js';

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

test('prepared sampling matches fresh sampling across source interval and search branches', () => {
  const cases = [
    [track([0], [[-0, 0, 0, 0.8]], [[3, -2, 7]]), 10],
    [track([0, 1, 3], [identity, [0, 0, 0, -1], identity], [[2, 4, 6], [5, 7, 9], [10, 20, 30]]), 4],
    [track([0, 0.00005, 1]), 1],
    [track(Array.from({ length: 31 }, (_, i) => i * 0.5)), 16],
    [track(Array.from({ length: 100 }, (_, i) => i * 0.5)), 50],
  ];
  for (const [source, duration] of cases) {
    const prepared = prepareOriginalTrack(source, duration);
    for (const frame of [0, 0.00001, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
      assert.deepEqual(prepared.sample(frame), sampleOriginalTrack(source, duration, frame));
    }
  }
});

test('prepared reader owns nested and typed input arrays without later caller reads', () => {
  let retired = false;
  const watched = values => new Proxy(values, {
    get(target, key, receiver) {
      assert.equal(retired, false, 'prepared reader accessed caller storage');
      return Reflect.get(target, key, receiver);
    },
  });
  const rotations = [[0, 0, 0, 0.8], [0, 0, 0, 1]];
  const translations = [new Float32Array([2, 4, 6]), new Float32Array([10, 20, 30])];
  const times = new Float32Array([0, 1]);
  const source = { flags: 0, times, quaternions: watched(rotations.map(watched)), positions: watched(translations) };
  const prepared = prepareOriginalTrack(source, 2), expected = prepared.sample(0.75);
  times[1] = NaN; rotations[0][3] = NaN; translations[1].fill(NaN);
  for (const key of Object.keys(source)) Object.defineProperty(source, key, {
    get() { throw new Error('prepared reader retained caller track'); },
  });
  retired = true;
  assert.deepEqual(prepared.sample(0.75), expected);
  assert.deepEqual(prepared.firstPose(), { quaternion: [0, 0, 0, Math.fround(0.8)], position: [2, 4, 6] });
});

test('prepared reader exposes no writable storage and returns independent first/sample poses', () => {
  const prepared = prepareOriginalTrack(track([0, 1], [[-0, 0, 0, 0.8], identity], [[3, -2, 7]]), 2);
  assert.equal(Object.isFrozen(prepared), true);
  assert.deepEqual(Object.keys(prepared).sort(), ['firstPose', 'sample']);
  assert.throws(() => { prepared.sample = () => null; }, TypeError);
  assert.throws(() => { prepared.times = [0]; }, TypeError);
  const expected = { quaternion: [-0, 0, 0, Math.fround(0.8)], position: [3, -2, 7] };
  const first = prepared.firstPose(), sample = prepared.sample(0);
  assert.deepEqual(first, expected);
  first.quaternion[0] = 10; first.position[0] = 20;
  sample.quaternion[3] = 0; sample.position.length = 0;
  assert.deepEqual(prepared.firstPose(), expected);
  const next = prepared.sample(0);
  assert.deepEqual(next.quaternion, expected.quaternion);
  assert.deepEqual(next.position, expected.position);
});

test('fresh public sampling observes mutations while a prepared reader remains stable', () => {
  const source = track([0, 1], [identity.slice(), identity.slice()], [[1, 2, 3]]);
  const prepared = prepareOriginalTrack(source, 2);
  source.positions[0][0] = 99;
  assert.deepEqual(sampleOriginalTrack(source, 2, 0).position, [99, 2, 3]);
  assert.deepEqual(prepared.sample(0).position, [1, 2, 3]);
  // The unused later key is still validated by the public call.
  source.quaternions[1][0] = NaN;
  assert.throws(() => sampleOriginalTrack(source, 2, 0));
  assert.deepEqual(prepared.sample(0).quaternion, identity);
});

test('preparation validates complete source records before any sampling', () => {
  const valid = track([0, 1]);
  for (const [source, duration] of [
    [null, 2], [{ ...valid, flags: 1 }, 2], [valid, 0], [valid, Infinity], [valid, 0.5],
    [{ ...valid, times: [-0, 1] }, 2], [{ ...valid, times: [0, 0] }, 2],
    [{ ...valid, quaternions: [identity, [Infinity, 0, 0, 1]] }, 2],
    [{ ...valid, positions: [[0, 0, 0], [0, NaN, 0]] }, 2],
    [{ ...valid, positions: new Array(1) }, 2],
  ]) assert.throws(() => prepareOriginalTrack(source, duration));
});

test('prepared sample rejects invalid frames and retains existing Float32 frame admission', () => {
  const prepared = prepareOriginalTrack(track([0, 1]), 2);
  for (const frame of [-0, -0.01, 1.01, NaN, Infinity, 1e100, undefined, null, '0', []]) {
    assert.throws(() => prepared.sample(frame));
  }
  // Existing semantics round to Float32 before testing the normalized domain.
  assert.deepEqual(prepared.sample(1 + 2 ** -25), prepared.sample(1));
  assert.deepEqual(prepared.sample(0).position, [0, 0, 0]);
});
