// Elbera Tools: source-free browser/Python ordinary-quaternion comparison.
// Python's formula has a separate original-instruction check; no original
// binaries, keys, scene assets or Capstone are read by this portable suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  interpolateOriginalQuaternion,
  originalQuaternionDetails,
} from '../js/nativequaternion.js';

const toolsDirectory = fileURLToPath(new URL('../../../tools/ui/', import.meta.url));
function bits(value) {
  const buffer = new ArrayBuffer(4), view = new DataView(buffer);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

test('matches the independent Python formula for all 210 authored cases at Float32 stores', () => {
  const python = `
import json, struct, sys
sys.path.insert(0, sys.argv[1])
from check_quaternion_native import synthetic_cases, interpolation_details
def bits(value):
    return struct.unpack('<I', struct.pack('<f', value))[0]
rows = []
for case in synthetic_cases():
    details = interpolation_details(**case)
    rows.append(dict(case, branch=details['branch'], dotBits=bits(details['dot']),
                     valueBits=[bits(v) for v in details['value']]))
assert 'capstone' not in sys.modules
assert 'check_tutorial_quest_native' not in sys.modules
print(json.dumps(rows, allow_nan=False))
`;
  const result = spawnSync('python3', ['-S', '-c', python, toolsDirectory], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const cases = JSON.parse(result.stdout);
  assert.equal(cases.length, 210);
  const counts = {};
  for (const [index, row] of cases.entries()) {
    const actual = originalQuaternionDetails(row.first, row.second, row.alpha);
    const label = `authored case ${index}`;
    assert.equal(actual.branch, row.branch, `${label}: branch`);
    assert.equal(bits(actual.dot), row.dotBits, `${label}: stored dot`);
    assert.deepEqual(actual.value.map(bits), row.valueBits, `${label}: output stores`);
    assert.deepEqual(interpolateOriginalQuaternion(row.first, row.second, row.alpha), actual.value);
    counts[actual.branch] = (counts[actual.branch] || 0) + 1;
  }
  assert.deepEqual(counts, {
    copy: 2, linear: 34, trigonometric: 172, 'trigonometric-tiny-fallback': 2,
  });
});

test('uses strict original thresholds on equality and the next Float32', () => {
  const first = [0, 0, 0, 1], copyThreshold = 0.9999998807907104;
  const linearThreshold = Math.fround(.55);
  for (const [dot, branch] of [
    [copyThreshold, 'linear'], [Math.fround(copyThreshold + 2 ** -24), 'copy'],
    [linearThreshold, 'trigonometric'], [Math.fround(linearThreshold + 2 ** -24), 'linear'],
  ]) {
    const second = [Math.fround(Math.sqrt(1 - dot * dot)), 0, 0, dot];
    assert.equal(originalQuaternionDetails(first, second, .37).branch, branch);
  }
});

test('preserves the larger normalized-linear region instead of generic slerp', () => {
  const result = originalQuaternionDetails([0, 0, 0, 1], [.6, 0, 0, .8], .25);
  assert.equal(result.branch, 'linear');
  assert.deepEqual(result.value.map(bits), [0x3e1fb4a8, 0, 0, 0x3f7cde0a]);
  assert.ok(Math.abs(result.value[0] - Math.sin(Math.acos(.8) * .25)) > .004);
});

test('preserves square-root and reciprocal stores before component multiplication', () => {
  const result = interpolateOriginalQuaternion([0, 0, 0, 1], [0, 0, 1, 0], .5);
  assert.deepEqual(result.map(bits), [0, 0, 0x3f3504f4, 0x3f3504f4]);
  assert.notEqual(result[2], Math.fround(Math.sqrt(.5)));
});

test('does not silently flip endpoint hemispheres or replace the source tiny fallback', () => {
  for (const [first, second] of [
    [[0, 0, 0, 1], [0, 0, 0, -1]], [[0, 0, 0, 0], [0, 0, 0, 0]],
  ]) {
    const result = originalQuaternionDetails(first, second, .5);
    assert.equal(result.branch, 'trigonometric-tiny-fallback');
    assert.deepEqual(result.value, [0, 0, Math.fround(.1), 0]);
  }
});

test('copies without renormalizing and does not mutate or alias typed input arrays', () => {
  const first = new Float32Array([0, 0, 0, 2]), second = new Float64Array([0, 0, 0, 1]);
  const result = interpolateOriginalQuaternion(first, second, -4);
  assert.deepEqual(result, [0, 0, 0, 2]);
  result[3] = 99;
  assert.deepEqual(Array.from(first), [0, 0, 0, 2]);
  assert.deepEqual(Array.from(second), [0, 0, 0, 1]);
});

test('retains extrapolation instead of clamping the caller fraction', () => {
  const result = interpolateOriginalQuaternion([0, 0, 0, 1], [.6, 0, 0, .8], 1.5);
  assert.ok(result[0] > .78);
  assert.ok(result[3] < .62);
});

test('rejects missing, nonnumeric, nonfinite and unsupported trig-domain inputs', () => {
  for (const value of [undefined, null, '0001', [0, 0, 1], [0, 0, 0, true],
    [0, 0, 0, NaN], [0, 0, 0, Infinity], [0, 0, 0, 1e100], new DataView(new ArrayBuffer(16))]) {
    assert.throws(() => interpolateOriginalQuaternion(value, [0, 0, 0, 1], .5));
  }
  for (const alpha of [undefined, true, '0.5', NaN, Infinity, 1e100]) {
    assert.throws(() => interpolateOriginalQuaternion([0, 0, 0, 1], [0, 0, 0, 1], alpha));
  }
  assert.throws(() => interpolateOriginalQuaternion([0, 0, 0, 2], [0, 0, 0, -1], .5));
});
