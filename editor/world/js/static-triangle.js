/** Elbera Tools — original finite static triangle preparation and clipping.
 * Requires explicit source geometry, matrices and consumed cache/query state.
 * Does not manage cache lifetime, traverse the mesh tree or adopt a final hit.
 * Source contracts: docs/native-static-triangle-evidence.md.
 */
const f = Math.fround;
const scope = "original-static-triangle-clip";
const finiteF32 = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(f(v), v);
const fields = (v, n) =>
  Array.isArray(v) &&
  v.length === n &&
  Array.from({ length: n }, (_, i) => finiteF32(v[i])).every(Boolean);
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
class ArithmeticOutsideDomain extends Error {}
const store = (value) => {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new ArithmeticOutsideDomain("nonfinite source arithmetic");
  return result;
};
const cross = (a, b) => [
  store(a[1] * b[2] - a[2] * b[1]),
  store(a[2] * b[0] - a[0] * b[2]),
  store(a[0] * b[1] - a[1] * b[0]),
];
const dot = (a, b) => a[1] * b[1] + a[0] * b[0] + a[2] * b[2];

function clipPlane(plane, query, state) {
  const [x, y, z, w] = plane;
  // The original clears the sign bit of each already-stored product.
  const radius = store(
    Math.abs(store(y * query.extent[1])) +
      Math.abs(store(x * query.extent[0])) +
      Math.abs(store(z * query.extent[2])),
  );
  const start = store(dot(query.start, plane) - w);
  const end = store(dot(query.end, plane) - w);
  const delta = start - end;
  // Original qwords 108e91b8 / 108e91a8; equality enters the parallel branch.
  if (delta > 9.999999747378752e-6) {
    const time = store((radius - start) / (end - start));
    if (time > state.entry) {
      state.entry = time;
      state.normal = [x, y, z];
      state.found = 1;
    }
  } else if (delta < -9.999999747378752e-6) {
    const time = store((radius - start) / (end - start));
    if (time < state.exit) state.exit = time;
  } else if (radius < start && radius < end) return false;
  return state.exit > state.entry && state.exit > 0;
}

function clipBox(points, query, state) {
  const bounds = [...points[0], ...points[0]];
  for (const point of points.slice(1))
    for (let k = 0; k < 3; k++) {
      if (point[k] < bounds[k]) bounds[k] = point[k];
      if (point[k] > bounds[k + 3]) bounds[k + 3] = point[k];
    }
  for (let k = 0; k < 3; k++)
    for (const sign of [-1, 1]) {
      const plane = [0, 0, 0, sign < 0 ? -bounds[k] : bounds[k + 3]];
      plane[k] = sign;
      if (!clipPlane(plane, query, state)) return false;
    }
  return true;
}

function clipEdge(point, edge, inner, axis, query, state) {
  let n = cross(axis, edge);
  const squared = dot(n, n);
  if (!(squared > 0) || !Number.isFinite(squared))
    throw new ArithmeticOutsideDomain(
      "unsupported original UnsafeNormal domain",
    );
  // Named Core UnsafeNormal stores its reciprocal after positive appSqrt.
  // The API explicitly admits a mathematical sqrt boundary, not CRT/FPU state.
  const inverse = store(1 / Math.sqrt(squared));
  n = n.map((v) => store(v * inverse));
  if (store(dot(inner, n)) < 0) n = n.map((v) => store(-v));
  return clipPlane([...n, store(dot(point, n))], query, state);
}

/** Initial entry/exit are consumed, so must be supplied. Normal/found are only
 * written by this stage and remain absent when unknown until actually written.
 * A rejected interval can still contain writes; callers must retain that fact.
 * `keep` is the source helper's interval return, not an adopted collision hit.
 */
export function clipStaticTriangle(input) {
  const unsupported = (reason) =>
    Object.freeze({ status: "unsupported", scope, reason });
  if (!input || input.arithmeticProfile !== "pc53-rne-math-sqrt")
    return unsupported(
      "explicit pc53-rne-math-sqrt arithmetic profile required",
    );
  const { worldVertices, worldPlane, start, end, extent, initialClipState } =
    input;
  if (
    !Array.isArray(worldVertices) ||
    worldVertices.length !== 3 ||
    ![0, 1, 2].every((i) => fields(worldVertices[i], 3)) ||
    !fields(worldPlane, 4) ||
    ![start, end, extent].every((v) => fields(v, 3)) ||
    extent.some((v) => v < 0) ||
    !extent.some((v) => v !== 0)
  )
    return unsupported(
      "explicit finite Float32 vertices, plane and nonzero query required",
    );
  if (
    !initialClipState ||
    typeof initialClipState !== "object" ||
    Array.isArray(initialClipState) ||
    !finiteF32(initialClipState.entry) ||
    !finiteF32(initialClipState.exit) ||
    (Object.hasOwn(initialClipState, "normal") &&
      !fields(initialClipState.normal, 3)) ||
    (Object.hasOwn(initialClipState, "found") && !uint(initialClipState.found))
  )
    return unsupported(
      "explicit finite clip interval and valid optional source state required",
    );
  const state = { entry: initialClipState.entry, exit: initialClipState.exit };
  if (Object.hasOwn(initialClipState, "normal"))
    state.normal = [...initialClipState.normal];
  if (Object.hasOwn(initialClipState, "found"))
    state.found = initialClipState.found;
  const query = { start, end, extent };
  const finish = (keep) => {
    if (state.normal) Object.freeze(state.normal);
    return Object.freeze({
      status: "ready",
      scope,
      keep,
      clipState: Object.freeze(state),
    });
  };
  try {
    if (!clipBox(worldVertices, query, state)) return finish(false);
    if (
      !clipPlane(worldPlane, query, state) ||
      !clipPlane(
        worldPlane.map((v) => -v),
        query,
        state,
      )
    )
      return finish(false);
    for (let i = 0; i < 3; i++) {
      const point = worldVertices[i];
      const edge = worldVertices[(i + 1) % 3].map((v, k) =>
        store(v - point[k]),
      );
      const inner = cross(worldPlane, edge);
      for (let k = 0; k < 3; k++) {
        // The source skips only an edge parallel to the tested box axis.
        if ([0, 1, 2].every((j) => j === k || edge[j] === 0)) continue;
        if (
          !clipEdge(
            point,
            edge,
            inner,
            [0, 1, 2].map((j) => Number(j === k)),
            query,
            state,
          )
        )
          return finish(false);
      }
    }
    return finish(true);
  } catch (error) {
    if (error instanceof ArithmeticOutsideDomain)
      return unsupported(error.message);
    throw error;
  }
}

function sourcePlane(points) {
  const [a, b, c] = points;
  const left = b.map((v, i) => store(v - a[i]));
  const right = c.map((v, i) => store(v - a[i]));
  let n = cross(left, right);
  // Named Core SafeNormal used by FPlane's three-point constructor. Unlike
  // UnsafeNormal, both squared length and sqrt have separate Float32 stores.
  const squared = store(dot(n, n));
  if (squared < 1e-8) n = [0, 0, 0];
  else {
    const root = store(Math.sqrt(squared));
    const inverse = store(1 / root);
    n = n.map((v) => store(v * inverse));
  }
  return [...n, store(dot(n, a))];
}

/** Prepare one selected original triangle's world geometry and cache writes.
 * The caller selects the same original triangle/plane-cache entry by an index
 * in the source unsigned-WORD domain. Native paging and cache lifetime remain
 * caller responsibilities. Only consumed source records must be present.
 * Cache writes are returned explicitly; the caller's cache is never mutated.
 */
export function prepareStaticTriangle(input) {
  const scope = "original-static-triangle-preparation";
  const unsupported = (reason) =>
    Object.freeze({ status: "unsupported", scope, reason });
  if (!input || input.arithmeticProfile !== "pc53-rne-math-sqrt")
    return unsupported(
      "explicit pc53-rne-math-sqrt arithmetic profile required",
    );
  const {
    triangleIndex,
    indices,
    vertices,
    vertexCache,
    planeCache,
    localToWorld,
    determinant,
    ownerStatic,
  } = input;
  if (
    !Number.isInteger(triangleIndex) ||
    triangleIndex < 0 ||
    triangleIndex > 0xffff ||
    !Array.isArray(indices) ||
    indices.length !== 3 ||
    ![0, 1, 2].every(
      (i) =>
        Number.isInteger(indices[i]) &&
        indices[i] >= 0 &&
        indices[i] <= 0x7fffffff,
    ) ||
    !Array.isArray(vertexCache) ||
    !planeCache ||
    !uint(planeCache.valid) ||
    !finiteF32(determinant)
  )
    return unsupported(
      "explicit selected triangle, cache records and determinant required",
    );
  const pending = new Map();
  const sourceValid = () => {
    if (typeof ownerStatic !== "boolean")
      throw new ArithmeticOutsideDomain(
        "missing consumed source bStatic field",
      );
    return Number(ownerStatic);
  };
  const getVertex = (index) => {
    if (index >= vertexCache.length)
      throw new ArithmeticOutsideDomain("source vertex index outside cache");
    let record = pending.get(index) ?? vertexCache[index];
    if (!record || !uint(record.valid))
      throw new ArithmeticOutsideDomain(
        "missing consumed vertex cache validity",
      );
    if (!record.valid) {
      const valid = sourceValid();
      if (
        !Array.isArray(vertices) ||
        !fields(vertices[index], 3) ||
        !fields(localToWorld, 16)
      )
        throw new ArithmeticOutsideDomain(
          "missing consumed source vertex or cached matrix",
        );
      const [x, y, z] = vertices[index];
      record = {
        valid,
        point: [0, 1, 2].map((k) =>
          store(
            y * localToWorld[4 + k] +
              x * localToWorld[k] +
              z * localToWorld[8 + k] +
              localToWorld[12 + k],
          ),
        ),
      };
      pending.set(index, record);
    }
    if (!fields(record.point, 3))
      throw new ArithmeticOutsideDomain("missing consumed cached world vertex");
    return [...record.point];
  };
  try {
    let plane, planeWrite;
    if (!planeCache.valid) {
      const valid = sourceValid();
      const points = indices.map(getVertex);
      // The original caller pushes 0,1,2: constructor arguments are 2,1,0.
      plane = sourcePlane([points[2], points[1], points[0]]);
      if (determinant < 0) plane = plane.map((v) => -v);
      planeWrite = Object.freeze({ valid, plane: Object.freeze([...plane]) });
    } else {
      if (!fields(planeCache.plane, 4))
        throw new ArithmeticOutsideDomain("missing consumed cached plane");
      plane = [...planeCache.plane];
    }
    const points = indices.map(getVertex);
    if (determinant < 0) [points[0], points[2]] = [points[2], points[0]];
    const writes = {
      vertices: Object.freeze(
        [...pending].map(([index, record]) =>
          Object.freeze({
            index,
            record: Object.freeze({
              valid: record.valid,
              point: Object.freeze([...record.point]),
            }),
          }),
        ),
      ),
    };
    if (planeWrite) writes.plane = planeWrite;
    return Object.freeze({
      status: "ready",
      scope,
      triangleIndex,
      worldVertices: Object.freeze(points.map(Object.freeze)),
      worldPlane: Object.freeze(plane),
      writes: Object.freeze(writes),
    });
  } catch (error) {
    if (error instanceof ArithmeticOutsideDomain)
      return unsupported(error.message);
    throw error;
  }
}

/** Original tree's scratch constructor starts entry at -1, not zero.
 * maxTime is the current caller-owned closest result time. This constructor
 * also initializes all normal components and the found flag explicitly.
 */
export function createStaticTriangleClipState(maxTime) {
  const scope = "original-static-triangle-clip-state";
  if (!finiteF32(maxTime))
    return Object.freeze({
      status: "unsupported",
      scope,
      reason: "explicit finite Float32 current result time required",
    });
  return Object.freeze({
    status: "ready",
    scope,
    clipState: Object.freeze({
      entry: -1,
      exit: maxTime,
      normal: Object.freeze([0, 0, 0]),
      found: 0,
    }),
  });
}
