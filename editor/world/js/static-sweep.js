/** Elbera Tools — original nonzero static-mesh sweep preparation.
 * Current cached source matrix and query fields must be supplied explicitly.
 * No cache creation, actor admission, triangle query or collision result here.
 */
const f = Math.fround;
const scope = "original-static-sweep-preparation";
const finiteF32 = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(f(v), v);
const fields = (v, n) =>
  Array.isArray(v) &&
  v.length === n &&
  Array.from({ length: n }, (_, i) => i).every((i) => finiteF32(v[i]));
const point = ([x, y, z], m) =>
  [0, 1, 2].map((i) => f(y * m[4 + i] + x * m[i] + z * m[8 + i] + m[12 + i]));

function transformedExtent(extent, m) {
  let bounds;
  // Original FBox::TransformBy visits every corner in this exact order.
  for (const x of [-extent[0], extent[0]])
    for (const y of [-extent[1], extent[1]])
      for (const z of [-extent[2], extent[2]]) {
        const corner = point([x, y, z], m);
        if (!bounds) bounds = [...corner, ...corner];
        else
          for (let i = 0; i < 3; i++) {
            // Both source comparisons are strict. Ties retain the previous sign.
            if (corner[i] < bounds[i]) bounds[i] = corner[i];
            if (corner[i] > bounds[3 + i]) bounds[3 + i] = corner[i];
          }
      }
  // GetExtent stores the subtraction before multiplying by the source 1/2.
  return [0, 1, 2].map((i) => f(f(bounds[3 + i] - bounds[i]) * 0.5));
}

export function prepareStaticSweep(input) {
  const unsupported = (reason) =>
    Object.freeze({ status: "unsupported", scope, reason });
  if (!input || input.arithmeticProfile !== "pc53-rne")
    return unsupported("explicit pc53-rne arithmetic profile required");
  const { start, end, extent, cacheWorldToLocal } = input;
  if (
    ![start, end, extent].every((v) => fields(v, 3)) ||
    !fields(cacheWorldToLocal, 16)
  )
    return unsupported(
      "explicit finite Float32 query and cached source matrix required",
    );
  if (extent.some((v) => v < 0) || !extent.some((v) => v !== 0))
    return unsupported("nonnegative nonzero source extent required");
  const localStart = point(start, cacheWorldToLocal);
  const localEnd = point(end, cacheWorldToLocal);
  const localExtent = transformedExtent(extent, cacheWorldToLocal);
  const localDelta = localEnd.map((v, i) => f(v - localStart[i]));
  // Original Engine Float64 at 108e9018, consumed only for exact zero delta.
  for (let i = 0; i < 3; i++)
    if (localDelta[i] === 0)
      localDelta[i] = f(localDelta[i] + 1.0000000116860974e-7);
  const reciprocalDelta = localDelta.map((v) => f(1 / v));
  const arrays = {
    localStart,
    localEnd,
    localExtent,
    localDelta,
    reciprocalDelta,
  };
  if (
    Object.values(arrays).some((values) =>
      values.some((v) => !Number.isFinite(v)),
    )
  )
    return unsupported("nonfinite derived source preparation");
  for (const values of Object.values(arrays)) Object.freeze(values);
  return Object.freeze({
    status: "ready",
    scope,
    arithmeticProfile: "pc53-rne",
    ...arrays,
  });
}
