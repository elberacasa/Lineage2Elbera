/** Elbera Tools — source actor matrices from explicit original actor/table state.
 * The sine table is caller-supplied original GMath data, not browser trigonometry.
 * Finite PC53/RNE arithmetic profile; other FPU modes are not inferred.
 * No render transforms, inverse fallback, native cache or live actor state inferred.
 */
const f = Math.fround;
const finiteF32 = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(f(v), v);
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => finiteF32(v[i]));
const int32 = (v) => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff;
const scope = "original-actor-transforms";
class Unknown extends Error {}
const fail = (reason) => {
  throw new Unknown(reason);
};
const freeze = Object.freeze;
const product = (a, b) => {
  const out = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      out.push(
        f(
          a[r * 4] * b[c] +
            a[r * 4 + 1] * b[4 + c] +
            a[r * 4 + 2] * b[8 + c] +
            a[r * 4 + 3] * b[12 + c],
        ),
      );
  return out;
};
const translation = ([x, y, z]) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
];
const scale = ([x, y, z]) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
function determinant(m) {
  const a = m[15] * m[10] - m[14] * m[11];
  const b = m[6] * m[15] - m[7] * m[14];
  const c = m[11] * m[6] - m[7] * m[10];
  const d = m[2] * m[15] - m[14] * m[3];
  const e = m[2] * m[11] - m[10] * m[3];
  const g = m[2] * m[7] - m[6] * m[3];
  return f(
    (m[5] * a - m[9] * b + m[13] * c) * m[0] -
      (m[1] * a - m[9] * d + m[13] * e) * m[4] +
      (m[1] * b - m[5] * d + m[13] * g) * m[8] -
      (m[1] * c - m[5] * e + m[9] * g) * m[12],
  );
}
/** The named Core determinant, also used by original mesh-cache updates. */
export function originalMatrixDeterminant(input) {
  const matrix = input?.matrix;
  if (
    input?.arithmeticProfile !== "pc53-rne" ||
    !Array.isArray(matrix) ||
    matrix.length !== 16 ||
    !Array.from({ length: 16 }, (_, i) => finiteF32(matrix[i])).every(Boolean)
  )
    return freeze({
      status: "unsupported",
      scope,
      reason: "explicit finite source matrix and arithmetic profile required",
    });
  const value = determinant(matrix);
  return Number.isFinite(value)
    ? freeze({ status: "ready", scope, determinant: value })
    : freeze({
        status: "unsupported",
        scope,
        reason: "nonfinite source determinant",
      });
}
function localToWorld(a, sine) {
  const [pitch, yaw, roll] = a.rotation;
  // Original read order and signed integer/table quantization.
  const sr = sine(roll),
    sp = sine(pitch),
    sy = sine(yaw);
  const cr = sine((roll + 0x4000) | 0),
    cp = sine((pitch + 0x4000) | 0),
    cy = sine((yaw + 0x4000) | 0);
  const [lx, ly, lz] = a.location,
    [px, py, pz] = a.prePivot;
  const [sx, syScale, sz] = a.drawScale3D.map((v) => f(v * a.drawScale));
  // These source qword intermediates must not be rounded with the output basis.
  const cycpScale = cy * cp * sx,
    scaleCp = sx * cp,
    cycr = cy * cr,
    cpcrScale = cp * cr * sz;
  return [
    f(cycpScale),
    f(scaleCp * sy),
    f(sx * sp),
    0,
    f((cy * sp * sr - cr * sy) * syScale),
    f((sp * sr * sy + cycr) * syScale),
    f(-cp * syScale * sr),
    0,
    f((sy * sr + sp * cycr) * -sz),
    f((cy * sr - cr * sp * sy) * sz),
    f(cpcrScale),
    0,
    f(
      lx -
        px * cycpScale +
        sz * cycr * pz * sp -
        syScale * cy * py * sp * sr +
        syScale * cr * py * sy +
        sz * pz * sr * sy,
    ),
    f(
      ly -
        (sy * (syScale * py * sp * sr) +
          (sz * cy * pz * sr + syScale * cycr * py + px * scaleCp * sy) -
          sz * cr * pz * sp * sy),
    ),
    f(lz - (sp * (sx * px) + pz * cpcrScale - sr * (syScale * cp * py))),
    1,
  ];
}
function inverseRotation(rotation, sine) {
  const [pitch, yaw, roll] = rotation;
  const cr = sine((0x4000 - roll) | 0),
    sr = sine(-roll | 0);
  const r = [1, 0, 0, 0, 0, cr, -sr, 0, 0, sr, cr, 0, 0, 0, 0, 1];
  const cp = sine((0x4000 - pitch) | 0),
    sp = sine(-pitch | 0);
  const p = [cp, 0, sp, 0, 0, 1, 0, 0, -sp, 0, cp, 0, 0, 0, 0, 1];
  const cy = sine((0x4000 - yaw) | 0),
    sy = sine(-yaw | 0);
  const y = [cy, sy, 0, 0, -sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return product(product(y, p), r);
}
export function originalActorTransforms(input) {
  try {
    if (
      !input ||
      !vector(input.location) ||
      !vector(input.prePivot) ||
      !vector(input.drawScale3D) ||
      !finiteF32(input.drawScale) ||
      !Array.isArray(input.rotation) ||
      input.rotation.length !== 3 ||
      ![0, 1, 2].every((i) => int32(input.rotation[i]))
    )
      fail("explicit source actor fields required");
    if (input.arithmeticProfile !== "pc53-rne")
      fail("explicit pc53-rne arithmetic profile required");
    const table = input.sineTable;
    if (
      !(Array.isArray(table) || table instanceof Float32Array) ||
      table.length !== 0x4000
    )
      fail("original 16384-entry sine table required");
    const sine = (rotation) => {
      const index = (rotation >> 2) & 0x3fff,
        value = table[index];
      if (!finiteF32(value))
        fail(`missing finite source sine-table entry ${index}`);
      return value;
    };
    // WorldToLocal does not invert the rounded LocalToWorld output.
    if (input.drawScale === 0 || input.drawScale3D.some((v) => v === 0))
      fail("nonfinite inverse-scale domain");
    const toLocalTranslation = translation(input.prePivot);
    const reciprocal = f(1 / input.drawScale);
    const invScale = scale(
      input.drawScale3D.map((v) => f(f(1 / v) * reciprocal)),
    );
    const invRotation = inverseRotation(input.rotation, sine);
    const worldToLocal = product(
      product(
        product(translation(input.location.map((v) => -v)), invRotation),
        invScale,
      ),
      toLocalTranslation,
    );
    const local = localToWorld(input, sine);
    const det = determinant(local);
    if (![...worldToLocal, ...local, det].every(Number.isFinite))
      fail("nonfinite derived source transform");
    return freeze({
      status: "ready",
      scope,
      arithmeticProfile: "pc53-rne",
      worldToLocal: freeze(worldToLocal),
      localToWorld: freeze(local),
      determinant: det,
    });
  } catch (error) {
    if (!(error instanceof Unknown)) throw error;
    return freeze({ status: "unsupported", scope, reason: error.message });
  }
}
