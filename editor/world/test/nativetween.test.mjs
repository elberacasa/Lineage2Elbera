import test from 'node:test';
import assert from 'node:assert/strict';
import { tweenOriginalLocalPose } from '../js/nativetween.js';
import { prepareOriginalTrack } from '../js/nativetrack.js';
import { interpolateOriginalQuaternion } from '../js/nativequaternion.js';

const f = Math.fround;
const pose = (quaternion = [0, 0, 0, 1], position = [0, 0, 0]) => ({ quaternion, position });
const input = changes => ({ cached: pose(), firstKey: pose([0, 0, 0.6, 0.8], [10, 20, -30]),
  cacheValid: true, frame: -0.05, frames: 10, sequenceId: 7, previousSequenceId: 7,
  previousFrame: -0.1, accumulated: 0.2, ...changes });

test('negative tween interpolates cached locals toward raw first keys', () => {
  const value = input(), before = structuredClone(value), result = tweenOriginalLocalPose(value);
  assert.equal(result.status, 'ready'); assert.equal(result.mode, 'tween');
  assert.equal(result.fraction, 0.5);
  assert.deepEqual(result.position, [5, 10, -15]);
  assert.deepEqual(result.state, { previousFrame: f(-0.05), previousSequenceId: 7, accumulated: f(0.6) });
  assert.ok(Math.abs(result.quaternion[2] - Math.sqrt(0.1)) < 1e-7);
  assert.deepEqual(value, before);
  result.position[0] = 999; assert.deepEqual(value.cached.position, [0, 0, 0]);
});

test('tween uses a different interpolation policy from the ordinary track helper', () => {
  const value = input({ frame: -0.07 });
  const result = tweenOriginalLocalPose(value);
  const ordinary = interpolateOriginalQuaternion(value.cached.quaternion, value.firstKey.quaternion, result.fraction);
  assert.equal(result.quaternionBranch, 'trigonometric');
  assert.ok(Math.abs(result.quaternion[2] - ordinary[2]) > 0.001);
});

test('hemisphere adjusts the destination against the cached quaternion, preserving ties', () => {
  const result = tweenOriginalLocalPose(input({ firstKey: pose([0, 0, 0, -1]) }));
  assert.equal(result.hemisphereFlipped, true); assert.deepEqual(result.quaternion, [0, 0, 0, 1]);
  const tie = tweenOriginalLocalPose(input({ firstKey: pose([1, 0, 0, 0]) }));
  assert.equal(tie.hemisphereFlipped, false);
});

test('sequence changes reset bookkeeping and fraction, while normalizing cached quaternion', () => {
  const result = tweenOriginalLocalPose(input({ cached: pose([0, 0, 0, 2], [3, 4, 5]),
    previousSequenceId: 2, frame: -0.06 }));
  assert.equal(result.fraction, 0); assert.deepEqual(result.position, [3, 4, 5]);
  assert.deepEqual(result.quaternion, [0, 0, 0, 1]);
  assert.equal(result.quaternionBranch, 'copy');
  assert.deepEqual(result.state, { previousFrame: f(-0.1), previousSequenceId: 7, accumulated: 0 });
});

test('fraction zero is admitted; out-of-range finite fraction resets instead of clamping', () => {
  const same = tweenOriginalLocalPose(input({ frame: -0.1, accumulated: 0.3 }));
  assert.equal(same.fraction, 0); assert.equal(same.state.accumulated, f(0.3));
  const reset = tweenOriginalLocalPose(input({ frame: -0.2 }));
  assert.deepEqual(reset.state, { previousFrame: f(-0.1), previousSequenceId: 7, accumulated: 0 });
  assert.equal(reset.fraction, 0);
});

test('incremental state and cached position use each prior displayed local pose', () => {
  const a = tweenOriginalLocalPose(input({ frame: -0.075, accumulated: 0 }));
  const b = tweenOriginalLocalPose(input({ ...a.state, cached: a, frame: -0.05 }));
  const fraction = f(1 - f(-0.05) / f(-0.075));
  assert.equal(b.fraction, fraction);
  assert.deepEqual(b.position, a.position.map((v, i) => f(v + f(f([10, 20, -30][i] - v) * fraction))));
  assert.equal(b.state.accumulated, f((1 - a.state.accumulated) * fraction + a.state.accumulated));
});

test('channel state is shared once across bones, not consumed once per bone', () => {
  const channel = input(), first = tweenOriginalLocalPose(channel);
  const second = tweenOriginalLocalPose({ ...channel, firstKey: pose([0.6, 0, 0, 0.8], [40, 50, 60]) });
  assert.deepEqual(first.state, second.state);
  assert.equal(second.fraction, 0.5); assert.deepEqual(second.position, [20, 25, 30]);
});

test('cache-invalid branch requires ordinary frame-zero sampling, not raw first keys', () => {
  const track = prepareOriginalTrack({ flags: 0, times: [0, 0.00005, 1],
    quaternions: [[0, 0, 0, 0.8], [0, 0, 1, 0], [0, 0, 0, 1]],
    positions: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }, 2);
  const zero = track.sample(0);
  assert.equal(zero.alpha, 1); assert.notDeepEqual(zero.quaternion, track.firstPose().quaternion);
  const result = tweenOriginalLocalPose(input({ cacheValid: false, previousFrame: 0,
    firstKey: track.firstPose(), frameZeroPose: zero, cached: undefined }));
  assert.equal(result.mode, 'frame-zero'); assert.equal(result.fraction, null);
  assert.deepEqual(result.quaternion, zero.quaternion); assert.deepEqual(result.position, zero.position);
  assert.deepEqual(result.state, { previousFrame: 0, previousSequenceId: 7, accumulated: f(0.2) });
});

test('cache-invalid sampling preserves a supplied nonunit quaternion without tween normalization', () => {
  const result = tweenOriginalLocalPose(input({ cacheValid: false, previousFrame: 0,
    frameZeroPose: pose([0, 0, 0, 0.8], [4, 5, 6]) }));
  assert.deepEqual(result.quaternion, [0, 0, 0, f(0.8)]);
  assert.equal(result.quaternionBranch, null);
});

test('native tiny-result normalization retains the nonidentity source fallback', () => {
  const result = tweenOriginalLocalPose(input({ cached: pose([0, 0, 0, 0]), firstKey: pose([0, 0, 0, 0]) }));
  assert.deepEqual(result.quaternion, [0, 0, f(0.1), 0]);
  assert.equal(result.quaternionBranch, 'trigonometric-tiny-fallback');
});

test('translation retains subtraction, product and addition Float32 stores', () => {
  const a = [-932.1904296875, 712.3893432617188, -83.52323150634766];
  const b = [522.434814453125, -999.8922119140625, 711.9132690429688];
  const result = tweenOriginalLocalPose(input({ cached: pose(undefined, a), firstKey: pose(undefined, b), frame: -0.063 }));
  assert.deepEqual(result.position, a.map((v, i) => f(v + f(f(b[i] - v) * result.fraction))));
  assert.notDeepEqual(result.position, a.map((v, i) => f(v + (b[i] - v) * result.fraction)));
});

test('missing state, nonfinite arithmetic and unproved exception inputs remain unsupported', () => {
  for (const changes of [
    { cacheValid: undefined }, { frame: 0 }, { frame: -0 }, { frame: 0.1 }, { frame: NaN },
    { frames: 0 }, { frames: 1.5 }, { previousFrame: 0 }, { previousFrame: -0 },
    { previousFrame: undefined }, { previousFrame: Infinity }, { accumulated: undefined },
    { sequenceId: undefined }, { previousSequenceId: undefined }, { firstKey: null },
    { cached: pose([Infinity, 0, 0, 1]) }, { firstKey: pose([0, 0, 0]) },
    { frame: -3e38, previousFrame: -1e-38 }, { cached: pose([3e38, 0, 0, 1]) },
    { cacheValid: false },
  ]) assert.equal(tweenOriginalLocalPose(input(changes)).status, 'unsupported', JSON.stringify(changes));
});
