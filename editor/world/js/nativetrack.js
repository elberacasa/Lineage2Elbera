// Elbera Tools: ordinary original sparse-track sampler (special mode 0).
// Source ranges and finite-domain limits: docs/native-track-evidence.md.
// This samples source-local data; it does not associate a track with a mesh bone.
import { interpolateOriginalQuaternion } from './nativequaternion.js';

const EPSILON = 0.00009999999747378752; // Original double at 0x108a8a50.

function f32(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || !Number.isFinite(Math.fround(value))) {
    throw new RangeError('Original track requires finite Float32 values.');
  }
  return Math.fround(value);
}

function array(value, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value))
      || !Number.isInteger(value.length)) {
    throw new TypeError(`Original track is missing its ${label} array.`);
  }
  return value;
}

function vector(value, size, label) {
  if (array(value, label).length !== size) {
    throw new RangeError(`Original track ${label} requires ${size} components.`);
  }
  return Array.from(value, f32);
}

// Native comparisons are unsigned Float32 words. Numeric comparisons have the
// same ordering only in the admitted nonnegative finite domain (excluding -0).
function previousKey(times, time) {
  const count = times.length, last = count - 1;
  if (count === 1) return 0;
  if (count <= 30) {
    let next = 1;
    while (next < count && time >= times[next]) next++;
    return next - 1;
  }
  if (time < times[1]) return 0;
  if (times[last] <= time) return last;
  let first = Math.floor(last / 2), step = first;
  for (let iteration = 0; iteration < 32; iteration++) {
    if (step > 1) step = Math.floor(step / 2);
    if (first >= last) return last;
    if (time < times[first]) first = Math.max(0, first - step);
    else if (times[first + 1] > time) return first;
    else first = Math.min(last, first + step);
  }
  return first;
}

function hemisphere(candidate, reference) {
  const minus = candidate.map((v, i) => f32(v - reference[i]));
  const plus = candidate.map((v, i) => f32(v + reference[i]));
  const norm = v => f32(((f32(v[1] * v[1]) + f32(v[0] * v[0]))
    + f32(v[2] * v[2])) + f32(v[3] * v[3]));
  const flipped = norm(plus) < norm(minus);
  return { value: flipped ? candidate.map(v => -v) : candidate, flipped };
}

/**
 * Source-local pose from one ordinary sparse track and normalized frame [0,1].
 * Missing data, special flags, unsupported cardinalities and nonfinite derived
 * values throw; no reference pose or invented key is substituted. Float64/Math
 * remains a bounded approximation of original x87/CRT intermediates.
 */
export function sampleOriginalTrack(track, duration, frame) {
  if (!track || track.flags !== 0) {
    throw new RangeError('Only explicit original ordinary track flags=0 are supported.');
  }
  duration = f32(duration); frame = f32(frame);
  if (duration <= 0 || frame < 0 || frame > 1 || Object.is(frame, -0)) {
    throw new RangeError('Original track requires positive duration and normalized frame [0,1].');
  }
  const times = Array.from(array(track.times, 'times'), f32);
  const quaternions = array(track.quaternions, 'quaternions');
  const positions = array(track.positions, 'positions');
  if (!times.length || times.length > 0x7fffffff || times[0] !== 0
      || times.some((t, i) => Object.is(t, -0) || t < 0 || (i > 0 && t <= times[i - 1]))
      || times.at(-1) > duration) {
    throw new RangeError('Original track times must start at zero and strictly increase within duration.');
  }
  if (quaternions.length !== times.length
      || (positions.length !== 1 && positions.length !== times.length)) {
    throw new RangeError('Unsupported original track quaternion/position cardinality.');
  }
  // Validate the entire admitted record, not only this frame's selected keys.
  const rotations = Array.from(quaternions, q => vector(q, 4, 'quaternion'));
  const translations = Array.from(positions, p => vector(p, 3, 'position'));
  const time = f32(duration * frame), first = previousKey(times, time);
  const wrapped = first + 1 >= times.length;
  const second = wrapped ? 0 : first + 1;
  let alpha = 0, hemisphereFlipped = false;
  if (first !== second) {
    const denominator = wrapped ? f32(duration - times[first])
      : Math.abs(f32(times[second] - times[first]));
    alpha = denominator > EPSILON ? f32((time - times[first]) / denominator) : 1;
  }
  let quaternion = rotations[first].slice();
  if (first !== second && alpha !== 0) {
    let successor = rotations[second];
    if (wrapped) {
      const adjusted = hemisphere(successor, quaternion);
      successor = adjusted.value; hemisphereFlipped = adjusted.flipped;
    }
    quaternion = interpolateOriginalQuaternion(quaternion, successor, alpha);
  }
  let position = translations[positions.length === 1 ? 0 : first].slice();
  if (positions.length !== 1 && first !== second && alpha !== 0) {
    position = position.map((v, i) => f32(v + f32(f32(translations[second][i] - v) * alpha)));
  }
  return { quaternion, position, first, second, alpha, wrapped, hemisphereFlipped };
}
