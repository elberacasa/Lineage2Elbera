// Shared coordinate conventions.
//
// L2 world space: Z-up, units ~centimeters. A terrain tile is
// gridSize x gridSize samples spaced `spacing` L2 units apart
// (256 x 256 x 128 = 32768 units per tile edge).
// three.js space: Y-up, units meters. Character pipeline models are
// normalized to ~1.7 units tall, so we render the world at 1 unit = 1 m
// (L2 cm -> m: x0.01) and keep the characters at their native scale.
//
// Axis mapping (same convention as the character pipeline):
//   (x, y, z)_L2  ->  (x, z, -y)_three

import * as THREE from 'three';

export const L2_TO_M = 0.01;

export function l2ToThree(x, y, z, out = new THREE.Vector3()) {
  return out.set(x * L2_TO_M, z * L2_TO_M, -y * L2_TO_M);
}

// three.js world -> L2 world (inverse of l2ToThree)
export function threeToL2(p, out = {}) {
  out.x = Math.round(p.x / L2_TO_M);
  out.y = Math.round(-p.z / L2_TO_M);
  out.z = Math.round(p.y / L2_TO_M);
  return out;
}

// L2 heading (0..65535) -> three.js yaw (rotation.y, 0 facing +Z_three).
// Verified against the aCis source AND live traffic (M2): aCis
// MathUtil.calculateHeadingFrom = atan2(dy, dx) * 65536/2pi, i.e. the
// heading angle theta is measured CCW from the +X axis toward +Y, and the
// facing direction is (cos t, sin t) in L2 (x, y). In three space that
// direction is (cos t, -sin t), so yaw = atan2(cos t, -sin t) = pi/2 + t.
export function l2HeadingToThreeYaw(heading) {
  return Math.PI / 2 + (heading || 0) * (Math.PI * 2 / 65536);
}
