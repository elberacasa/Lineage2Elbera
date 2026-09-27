// Elbera Tools: bounded original local-pose/parent-coordinate arithmetic.
// Record: [originXYZ, row0XYZ, row1XYZ, row2XYZ], in original source units.
// docs/native-pose-coordinate-evidence.md records exact stores/call evidence.
// Number/Math approximate x87/CRT; no world basis or actor modifiers are added.

function f32(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || !Number.isFinite(Math.fround(value))) throw new RangeError('A finite Float32 component is required.');
  return Math.fround(value);
}

function vector(value, size) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== size) {
    throw new TypeError(`${size} source components are required.`);
  }
  return Array.from(value, f32);
}

function vectorBy(coords, value) {
  const c = vector(coords, 12), v = vector(value, 3);
  return [0, 1, 2].map(r => f32((v[0] * c[3 + r * 3] + v[1] * c[4 + r * 3]) + v[2] * c[5 + r * 3]));
}

function normalizedRow(value) {
  const [x, y, z] = vector(value, 3), square = f32((y * y + x * x) + z * z);
  if (square < 1e-8) return [0, 0, 0]; // Source FLOAT64; do not fround this threshold.
  const reciprocal = f32(1 / Math.sqrt(square)); // No Float32 store of sqrt itself.
  return [x, y, z].map(v => f32(v * reciprocal));
}

/** Original local quaternion→FCoords helper; it does not normalize q. */
export function originalQuaternionCoords(quaternion, position) {
  const [x, y, z, w] = vector(quaternion, 4), p = vector(position, 3);
  const [dx, dy, dz] = [x, y, z].map(v => f32(v * 2));
  const [xx, xy, xz, yy, yz, zz, wx, wy, wz] = [
    [x, dx], [x, dy], [x, dz], [y, dy], [y, dz], [z, dz], [w, dx], [w, dy], [w, dz],
  ].map(([a, b]) => f32(a * b));
  return [...p, 1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx, xz - wy, yz + wx, 1 - (xx + yy)].map(f32);
}

/** Reference composition: receiver=local record, operand=parent record. */
export function applyOriginalPivot(receiver, operand) {
  const c = vector(receiver, 12), p = vector(operand, 12), translated = vectorBy(p, c.slice(0, 3));
  const result = translated.map((v, i) => f32(p[i] + v));
  for (let row = 0; row < 3; row++) result.push(...vectorBy(c, p.slice(3 + row * 3, 6 + row * 3)));
  return result;
}

/** Current composition: only operand rows are normalized, before row dots. */
export function applyOriginalPivotWithoutScale(receiver, operand) {
  const c = vector(receiver, 12), p = vector(operand, 12), translated = vectorBy(p, c.slice(0, 3));
  const result = translated.map((v, i) => f32(p[i] + v));
  for (let row = 0; row < 3; row++) {
    result.push(...vectorBy(c, normalizedRow(p.slice(3 + row * 3, 6 + row * 3))));
  }
  return result;
}

/** Original determinant/cofactor/reciprocal stores; no singular fallback. */
export function originalPivotInverse(coords) {
  const c = vector(coords, 12), [a, b, z, d, e, f, g, h, i] = c.slice(3);
  const determinant = f32((((g * f - i * d) * b) + ((e * i - f * h) * a)) + ((d * h - e * g) * z));
  if (determinant === 0) throw new RangeError('Stored zero determinant is outside the admitted inverse domain.');
  const reciprocal = f32(1 / determinant);
  const cofactors = [i * e - h * f, h * z - b * i, b * f - z * e,
    f * g - i * d, a * i - z * g, z * d - f * a,
    h * d - e * g, b * g - h * a, a * e - b * d].map(f32);
  const result = [0, 0, 0, ...cofactors.map(v => f32(v * reciprocal))];
  result.splice(0, 3, ...vectorBy(result, c.slice(0, 3).map(v => f32(-v))));
  return result;
}

/**
 * Base hierarchy for explicitly supplied source-local poses and source parents.
 * Not full GetFrame: no root overrides, bone modifiers, world basis or physics.
 * Computes a complete result before returning; never mutates caller inputs.
 */
export function originalPoseHierarchy(localPoses, parents, options) {
  const mode = options?.mode;
  if (mode !== 'reference' && mode !== 'current') throw new TypeError('Explicit reference/current mode is required.');
  if (!Array.isArray(localPoses) || !localPoses.length
      || (!Array.isArray(parents) && !ArrayBuffer.isView(parents)) || parents.length !== localPoses.length) {
    throw new TypeError('Complete source poses and parent indices are required.');
  }
  for (let index = 0; index < parents.length; index++) {
    const parent = parents[index];
    if (!Number.isInteger(parent) || (index === 0 ? parent !== 0 : parent < 0 || parent >= index)) {
      throw new RangeError('One root and preceding source parents are required.');
    }
  }
  const local = Array.from(localPoses, pose => originalQuaternionCoords(pose?.quaternion, pose?.position));
  const compose = mode === 'reference' ? applyOriginalPivot : applyOriginalPivotWithoutScale;
  const result = [local[0]];
  for (let index = 1; index < local.length; index++) result.push(compose(local[index], result[parents[index]]));
  return result;
}
