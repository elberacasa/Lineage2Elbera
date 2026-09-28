/** Elbera Tools — original UStaticMesh post-hit adjustment.
 * Consumes an already adopted tree hit. Does not admit actors, select the
 * primitive path or supply cache state. Native XYZ and original units only.
 */
const f = Math.fround;
const scope = "original-static-hit-adjustment";
const scalar = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(f(v), v);
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => scalar(v[i]));
const clamp = (value, low, high) =>
  low > value ? low : high <= value ? high : value;
const squared = (v) => v[1] * v[1] + v[0] * v[0] + v[2] * v[2];

/** Actor/item identities are opaque source bindings. Small source normals
 * remain unchanged: Normalize's below-threshold branch does not zero them.
 * The original hit flag is not recomputed from the adjusted time.
 */
export function adjustStaticMeshHit(input) {
  const fail = (reason) =>
    Object.freeze({ status: "unsupported", scope, reason });
  if (!input || input.arithmeticProfile !== "pc53-rne-math-sqrt")
    return fail("explicit pc53-rne-math-sqrt arithmetic profile required");
  const { start, end, normal, time, actor, mesh } = input;
  if (
    ![start, end, normal].every(vector) ||
    !scalar(time) ||
    actor == null ||
    mesh == null
  )
    return fail(
      "explicit adopted hit, query and owner/mesh identities required",
    );
  const delta = end.map((v, i) => f(v - start[i]));
  // Named Core Size stores sqrt as Float32; both original calls use this delta.
  const length = f(Math.sqrt(squared(delta)));
  if (!(length > 0) || !Number.isFinite(length))
    return fail("positive finite source segment length required");
  const inverse = f(1 / length),
    minimum = f(0.10000000149011612 / length);
  if (!Number.isFinite(inverse) || !Number.isFinite(minimum))
    return fail("nonfinite source hit bias");
  const bias = clamp(0.10000000149011612, minimum, inverse);
  const difference = f(time - bias);
  if (!Number.isFinite(difference))
    return fail("nonfinite adjusted source time");
  const adjustedTime = clamp(difference, 0, 1);
  const point = start.map((v, i) => f(v + f(delta[i] * adjustedTime)));
  const size = f(squared(normal));
  if (!Number.isFinite(size) || !point.every(Number.isFinite))
    return fail("nonfinite source point or normal arithmetic");
  let adjustedNormal = [...normal];
  if (size >= 1e-8) {
    // Normalize stores squared length and reciprocal, but not sqrt separately.
    const scale = f(1 / Math.sqrt(size));
    if (!Number.isFinite(scale)) return fail("nonfinite source normalization");
    adjustedNormal = normal.map((v) => f(v * scale));
  }
  if (!adjustedNormal.every(Number.isFinite))
    return fail("nonfinite normalized source vector");
  return Object.freeze({
    status: "ready",
    scope,
    writes: Object.freeze({
      actor,
      item: mesh,
      time: adjustedTime,
      point: Object.freeze(point),
      normal: Object.freeze(adjustedNormal),
    }),
  });
}
