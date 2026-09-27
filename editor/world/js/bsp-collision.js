// Elbera Tools: original UModel primary zero-extent BSP traversal, plus
// separately scoped nonzero-extent candidate/bounds/plane arithmetic slices.
// Source: Engine 0x10745bd0, no owner transform, ExtraNodeFlags=0.
// This deliberately excludes UModel::LineCheck's later hit-time adjustment,
// material resolution, actor/world query aggregation and adjacent-level policy.
// No rendered polygon, texture visibility or walking height participates.
// See docs/native-camera-evidence.md. This is not the default world camera.

const SCOPE = 'bsp-primary-zero-extent';
const EPSILON = Math.fround(0.001);
const prepared = new WeakSet();
const unsupported = reason => ({ status: 'unsupported', scope: SCOPE, reason });

/** Validate and snapshot original fields once, independently of ray direction.
 * All front/back graphs (including unreachable nodes) must be acyclic. The
 * explicit stack avoids relying on the JavaScript recursion limit.
 */
export function prepareBspPrimary(source) {
  if (prepared.has(source)) return { status: 'ready', model: source, scope: SCOPE };
  if (!source || !Array.isArray(source.nodes) || ![0, 1].includes(source.rootOutside))
    return unsupported('missing-source-model');
  const count = source.nodes.length;
  const nodes = [];
  for (const n of source.nodes) {
    if (!n || !Array.isArray(n.plane) || n.plane.length !== 4
        || !n.plane.every(x => Number.isFinite(x) && Math.fround(x) === x)
        || !n.plane.slice(0, 3).some(x => x !== 0)
        || !Number.isInteger(n.flags) || n.flags < 0 || n.flags > 255
        || !Number.isInteger(n.numVertices) || n.numVertices < 0 || n.numVertices > 255
        || ![n.front, n.back].every(x => Number.isInteger(x) && x >= -1 && x < count))
      return unsupported('invalid-source-node');
    nodes.push(Object.freeze({ plane: Object.freeze([...n.plane]), flags: n.flags,
      numVertices: n.numVertices, front: n.front, back: n.back }));
  }
  const color = new Uint8Array(count);
  for (let root = 0; root < count; root++) {
    if (color[root]) continue;
    const work = [[root, false]];
    while (work.length) {
      const [index, exit] = work.pop();
      if (index === -1) continue;
      if (exit) { color[index] = 2; continue; }
      if (color[index] === 1) return unsupported('cyclic-source-tree');
      if (color[index] === 2) continue;
      color[index] = 1;
      work.push([index, true], [nodes[index].back, false], [nodes[index].front, false]);
    }
  }
  const model = Object.freeze({ nodes: Object.freeze(nodes), rootOutside: source.rootOutside });
  prepared.add(model);
  return { status: 'ready', scope: SCOPE, model };
}

function vector(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return null;
  const result = value.map(Math.fround);
  return result.every(Number.isFinite) ? result : null;
}

function distance(plane, point) {
  // Native x87 intermediates are wider than Float32, followed by this store.
  // JS Float64 is not claimed equivalent for every cancellation/tie case.
  return Math.fround(plane[0] * point[0] + plane[1] * point[1]
    + plane[2] * point[2] - plane[3]);
}

/** Original L2 XYZ in/out. `hit:null` is a primary-tree miss; unsupported is
 * unknown, never a clear segment. Prefer prepareBspPrimary once for repeated
 * queries. The bound is a computational safety guard, not a game distance.
 */
export function traceBspPrimary(source, start, end, { maxVisits } = {}) {
  const result = prepareBspPrimary(source);
  if (result.status !== 'ready') return result;
  const model = result.model;
  start = vector(start); end = vector(end);
  if (!start || !end) return unsupported('invalid-ray');
  const budget = maxVisits ?? Math.max(1, model.nodes.length * 4);
  if (!Number.isSafeInteger(budget) || budget < 1) return unsupported('invalid-visit-budget');
  if (!model.nodes.length) {
    // UModel::LineCheck returns RootOutside without writing a hit record.
    // A solid empty model is not a clear ray, nor a source-backed hit point.
    if (!model.rootOutside) return unsupported('empty-solid-model-without-hit-record');
    return { status: 'ready', scope: SCOPE, hit: null, visited: 0 };
  }
  // Original root call passes node=0, previous node=0 and RootOutside.
  const work = [{ index: 0, previous: 0, outside: !!model.rootOutside, start, end }];
  let visited = 0;
  while (work.length) {
    const part = work.pop();
    let { index, previous, outside, start: a, end: b } = part;
    while (index !== -1) {
      if (++visited > budget) return unsupported('visit-budget-exceeded');
      const node = model.nodes[index];
      const da = distance(node.plane, a), db = distance(node.plane, b);
      if (!Number.isFinite(da) || !Number.isFinite(db)) return unsupported('nonfinite-plane-distance');
      const solid = node.numVertices > 0 && !(node.flags & 0x21);
      // Order and strict comparisons matter inside the overlapping epsilon band.
      if (da > -EPSILON && db > -EPSILON) {
        outside = outside || solid; index = node.front;
      } else if (da < EPSILON && db < EPSILON) {
        outside = outside && !solid; index = node.back;
      } else {
        const fraction = Math.fround(da / (db - da));
        const middle = a.map((value, axis) => Math.fround(value
          + Math.fround(Math.fround(value - b[axis]) * fraction)));
        if (!Number.isFinite(fraction) || !middle.every(Number.isFinite))
          return unsupported('nonfinite-plane-split');
        const startsFront = da > 0;
        // Native recurses into the start side before continuing the far side.
        // Only the far side replaces the hit's previous-node reference.
        work.push({ index: startsFront ? node.back : node.front, previous: index,
          outside: startsFront ? outside && !solid : outside || solid,
          start: middle, end: b });
        index = startsFront ? node.front : node.back;
        outside = startsFront ? outside || solid : outside && !solid;
        b = middle;
      }
    }
    if (!outside) {
      return { status: 'ready', scope: SCOPE, visited,
        hit: { point: [...a], normal: model.nodes[previous].plane.slice(0, 3), nodeIndex: previous } };
    }
  }
  return { status: 'ready', scope: SCOPE, hit: null, visited };
}

const HULL_SCOPE = 'bsp-leaf-hull-record';
const PLANE_SCOPE = 'bsp-sweep-plane-interval';
const BRANCH_SCOPE = 'bsp-sweep-branches';
const CANDIDATE_SCOPE = 'bsp-sweep-hull-candidates';
const BOUNDS_SCOPE = 'bsp-sweep-bounds-planes';
const ADOPTION_SCOPE = 'bsp-sweep-interval-adoption';
const BACKOFF_SCOPE = 'bsp-sweep-time-adjustment';
const BEVEL_SCOPE = 'bsp-sweep-bevel-axis-selection';
const SWEEP_EPSILON = Math.fround(0.00001);
const sliceUnsupported = (scope, reason) => ({ status: 'unsupported', scope, reason });

/** Retained pair/axis admission before the unbound bevel vector helpers.
 * Both planes must ALREADY have their native orientation. This does not take
 * raw LeafHulls references, flip flagged planes, construct a bevel or claim a
 * hit. Source checks X, Y, Z in that order for each saved plane pair.
 */
export function selectBspSweepBevelAxes({ planeA, planeB } = {}) {
  const fail = reason => sliceUnsupported(BEVEL_SCOPE, reason);
  for (const p of [planeA, planeB]) {
    if (!Array.isArray(p) || p.length !== 4
        || !p.every(x => Number.isFinite(x) && Math.fround(x) === x)
        || !p.slice(0, 3).some(x => x !== 0)) return fail('invalid-oriented-plane');
  }
  const mask = p => p.slice(0, 3).reduce((bits, x, axis) =>
    bits | ((x < 0 ? 1 : x > 0 ? 2 : 0) << (axis * 2)), 0);
  const maskA = mask(planeA), maskB = mask(planeB), axes = [], projectedDots = [];
  // The native block stores each cross-with-axis component before the dot.
  // These permutations/negations preserve those finite Float32 components.
  const project = p => [[0, -p[2], p[1]], [p[2], 0, -p[0]], [-p[1], p[0], 0]];
  const a = project(planeA), b = project(planeB);
  for (let axis = 0; axis < 3; axis++) {
    if (((maskA | maskB) & (3 << (axis * 2))) !== (3 << (axis * 2))) {
      projectedDots.push(null); continue;
    }
    const dot = Math.fround(a[axis][0] * b[axis][0] + a[axis][1] * b[axis][1]
      + a[axis][2] * b[axis][2]);
    if (!Number.isFinite(dot)) return fail('nonfinite-bevel-dot');
    projectedDots.push(dot);
    if (dot > Math.fround(0.001)) axes.push(['x', 'y', 'z'][axis]);
  }
  return { status: 'ready', scope: BEVEL_SCOPE, maskA, maskB, projectedDots, axes };
}

/** Decode only the retained world leaf-hull framing at Engine 0x10745580.
 * A flagged plane's native operation is deliberately left unresolved. This
 * record is not a set of admitted oriented collision planes or a world hit.
 */
export function decodeBspLeafHull(source, nodeIndex) {
  const fail = reason => sliceUnsupported(HULL_SCOPE, reason);
  if (!source || !Array.isArray(source.nodes) || !Array.isArray(source.leafHulls)
      || !Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= source.nodes.length)
    return fail('invalid-source-hull');
  const offset = source.nodes[nodeIndex]?.collisionBound;
  if (offset === -1) return { status: 'ready', scope: HULL_SCOPE, hull: null };
  if (!Number.isInteger(offset) || offset < 0 || offset >= source.leafHulls.length)
    return fail('invalid-hull-offset');
  const words = source.leafHulls, planes = [];
  let cursor = offset;
  while (words[cursor] !== -1) {
    if (cursor >= words.length) return fail('unterminated-hull');
    if (planes.length === 64) return fail('hull-exceeds-native-plane-cap');
    const word = words[cursor++];
    if (!Number.isInteger(word) || word < -0x80000000 || word > 0x7fffffff)
      return fail('invalid-hull-word');
    const index = word & 0xbfffffff;
    if (index < 0 || index >= source.nodes.length) return fail('invalid-hull-plane-reference');
    planes.push({ nodeIndex: index, requiresNativePlaneOperation: !!(word & 0x40000000) });
  }
  cursor++;
  if (cursor + 6 > words.length) return fail('truncated-hull-bounds');
  const buffer = new DataView(new ArrayBuffer(4));
  const bounds = [];
  for (let i = 0; i < 6; i++) {
    const word = words[cursor + i];
    if (!Number.isInteger(word) || word < -0x80000000 || word > 0x7fffffff)
      return fail('invalid-hull-bound-word');
    buffer.setInt32(0, word, true);
    bounds.push(buffer.getFloat32(0, true));
  }
  if (!bounds.every(Number.isFinite) || bounds.slice(0, 3).some((x, i) => x > bounds[i + 3]))
    return fail('invalid-hull-bounds');
  return { status: 'ready', scope: HULL_SCOPE, hull: { offset, nextOffset: cursor + 6,
    planes, min: bounds.slice(0, 3), max: bounds.slice(3) } };
}

/** The complete retained *one-plane* interval helper at Engine 0x10746460.
 * `continues` means only that this plane has not rejected the interval. It is
 * never a world hit/miss: hull orientation, added bounds/bevel planes, tree
 * traversal, result adoption and wrapper bias remain separate native work.
 * State enter/exit/normal is explicit (first leaf uses -1/current hit time/0).
 */
export function clipBspSweepPlane({ plane, start, end, extent, enter, exit, normal } = {}) {
  const fail = reason => sliceUnsupported(PLANE_SCOPE, reason);
  if (!Array.isArray(plane) || plane.length !== 4
      || !plane.every(x => Number.isFinite(x) && Math.fround(x) === x)
      || !plane.slice(0, 3).some(x => x !== 0)) return fail('invalid-source-plane');
  start = vector(start); end = vector(end); extent = vector(extent); normal = vector(normal);
  if (!start || !end || !extent || !normal || extent.some(x => x < 0)
      || ![enter, exit].every(x => Number.isFinite(x) && Math.fround(x) === x))
    return fail('invalid-sweep-state');
  const radius = Math.fround(Math.abs(Math.fround(plane[0] * extent[0]))
    + Math.abs(Math.fround(plane[1] * extent[1]))
    + Math.abs(Math.fround(plane[2] * extent[2])));
  // This helper multiplies Y then X, adds, then Z and plane W before storing.
  const signedDistance = p => Math.fround(plane[1] * p[1] + plane[0] * p[0]
    + plane[2] * p[2] - plane[3]);
  const startDistance = signedDistance(start), endDistance = signedDistance(end);
  let adjustedStart = Math.fround(startDistance - radius);
  const delta = startDistance - endDistance;
  if (![radius, startDistance, endDistance, adjustedStart, delta].every(Number.isFinite))
    return fail('nonfinite-plane-arithmetic');
  // Source's close-start exception: moving inward from 0 <= S < radius.
  if (endDistance < startDistance && adjustedStart >= -radius && adjustedStart < 0)
    adjustedStart = 0;
  let continues = true;
  if (delta < -SWEEP_EPSILON) {
    const time = Math.fround(adjustedStart / delta);
    if (!Number.isFinite(time)) return fail('nonfinite-plane-time');
    if (time < exit) exit = time;
  } else if (delta > SWEEP_EPSILON) {
    const time = Math.fround(adjustedStart / delta);
    if (!Number.isFinite(time)) return fail('nonfinite-plane-time');
    if (time > enter) { enter = time; normal = plane.slice(0, 3); }
  } else if (startDistance > radius && endDistance > radius) {
    continues = false;
  }
  if (exit <= enter) continues = false;
  return { status: 'ready', scope: PLANE_SCOPE, continues, enter, exit, normal,
    radius, startDistance, endDistance };
}

/** Retained no-owner branch selection at Engine 0x10748206..0x10748327.
 * This inflated extent is used for tree admission only; the plane clipper
 * above uses the original extent. No leaf plane orientation is inferred here.
 */
export function selectBspSweepBranches({ plane, start, end, extent } = {}) {
  const fail = reason => sliceUnsupported(BRANCH_SCOPE, reason);
  if (!Array.isArray(plane) || plane.length !== 4
      || !plane.every(x => Number.isFinite(x) && Math.fround(x) === x)
      || !plane.slice(0, 3).some(x => x !== 0)) return fail('invalid-source-plane');
  start = vector(start); end = vector(end); extent = vector(extent);
  if (!start || !end || !extent || extent.some(x => x < 0)) return fail('invalid-sweep-state');
  const inflated = extent.map(x => Math.fround(x * Math.fround(1.1)));
  const radius = Math.fround(inflated.reduce((sum, x, i) => sum + Math.abs(Math.fround(x * plane[i])), 0));
  const signedDistance = p => Math.fround(plane[1] * p[1] + plane[0] * p[0]
    + plane[2] * p[2] - plane[3]);
  const startDistance = signedDistance(start), endDistance = signedDistance(end);
  if (![...inflated, radius, startDistance, endDistance].every(Number.isFinite))
    return fail('nonfinite-branch-arithmetic');
  return { status: 'ready', scope: BRANCH_SCOPE, radius, startDistance, endDistance,
    back: startDistance <= radius || endDistance <= radius,
    front: startDistance >= -radius || endDistance >= -radius,
    firstSide: endDistance <= startDistance ? 'front' : 'back' };
}

/** Original no-owner tree traversal through hull selection, before clipping.
 * Returns an ordered candidate list, never a hit or a clear-segment claim.
 * Repeated leaves/hulls are retained: native traversal does not deduplicate.
 * Flags on saved hull plane references remain unresolved by this operation.
 */
export function collectBspSweepHulls(source, start, end, extent, { maxVisits } = {}) {
  const fail = reason => sliceUnsupported(CANDIDATE_SCOPE, reason);
  const checked = prepareBspPrimary(source);
  if (checked.status !== 'ready') return fail(checked.reason);
  if (!Array.isArray(source.leafHulls) || !source.nodes.every(n => Number.isInteger(n.collisionBound)
      && n.collisionBound >= -1 && n.collisionBound < source.leafHulls.length))
    return fail('invalid-source-hull-offset');
  start = vector(start); end = vector(end); extent = vector(extent);
  if (!start || !end || !extent || extent.some(x => x < 0)) return fail('invalid-sweep-state');
  const { nodes, rootOutside } = checked.model;
  const budget = maxVisits ?? Math.max(1, nodes.length * 4);
  if (!Number.isSafeInteger(budget) || budget < 1) return fail('invalid-visit-budget');
  if (!nodes.length && !rootOutside) return fail('empty-solid-model-without-hit-record');
  const work = nodes.length ? [{ index: 0, previous: 0, outside: !!rootOutside }] : [];
  const candidates = [];
  let visited = 0;
  while (work.length) {
    const { index, previous, outside } = work.pop();
    if (index === -1) {
      const collisionBound = source.nodes[previous].collisionBound;
      if (!outside && collisionBound !== -1) candidates.push({ nodeIndex: previous, collisionBound });
      continue;
    }
    if (++visited > budget) return fail('visit-budget-exceeded');
    const node = nodes[index];
    const branch = selectBspSweepBranches({ plane: node.plane, start, end, extent });
    if (branch.status !== 'ready') return fail(branch.reason);
    const solid = node.numVertices > 0 && !(node.flags & 0x21);
    const order = branch.firstSide === 'front' ? ['front', 'back'] : ['back', 'front'];
    for (const side of order.reverse()) {
      if (branch[side]) work.push({ index: node[side], previous: index,
        outside: side === 'front' ? outside || solid : outside && !solid });
    }
  }
  return { status: 'ready', scope: CANDIDATE_SCOPE, candidates, visited };
}

/** The six additional world (no-owner) planes at 0x107484b7..0x107485e9.
 * Order and the source's asymmetric 0.1 offsets are retained. These do not
 * replace saved hull planes or the later edge/bevel tests.
 */
export function bspSweepBoundsPlanes({ min, max } = {}) {
  const fail = reason => sliceUnsupported(BOUNDS_SCOPE, reason);
  if (![min, max].every(v => Array.isArray(v) && v.length === 3
      && v.every(x => Number.isFinite(x) && Math.fround(x) === x))
      || min.some((x, i) => x > max[i])) return fail('invalid-hull-bounds');
  const planes = [[0, 0, -1, Math.fround(0.1 - min[2])], [0, 0, 1, Math.fround(max[2] + 0.1)],
    [-1, 0, 0, Math.fround(0.1 - min[0])], [1, 0, 0, Math.fround(max[0] - 0.1)],
    [0, -1, 0, Math.fround(0.1 - min[1])], [0, 1, 0, Math.fround(max[1] - 0.1)]];
  if (!planes.every(p => p.every(Number.isFinite))) return fail('nonfinite-bounds-plane');
  return { status: 'ready', scope: BOUNDS_SCOPE, planes };
}

/** Retained final leaf-interval admission at 0x10748e10..0x10748e83.
 * This consumes an explicit completed interval, never manufactures one from
 * unresolved hull orientation/bevels. Negative entry is deliberately retained;
 * the enclosing wrapper adjusts/clamps it in a separate stage.
 */
export function adoptBspSweepInterval({ enter, exit, normal } = {}) {
  const fail = reason => sliceUnsupported(ADOPTION_SCOPE, reason);
  if (![enter, exit].every(x => Number.isFinite(x) && Math.fround(x) === x)
      || !Array.isArray(normal) || normal.length !== 3
      || !normal.every(x => Number.isFinite(x) && Math.fround(x) === x))
    return fail('invalid-sweep-interval');
  const adopted = enter > -1 && exit > enter && exit > 0;
  return { status: 'ready', scope: ADOPTION_SCOPE, adopted,
    ...(adopted ? { time: enter, normal: [...normal] } : {}) };
}

/** Retained nonzero UModel wrapper at 0x1074973c..0x107497a7.
 * nativeMetric is the explicit Float32 result stored by the unresolved call
 * at 0x107463e3. This API does NOT label it ray length or calculate it. Positive
 * finite inputs are the admitted arithmetic domain; this is not a world hit.
 */
export function adjustBspSweepTime({ time, nativeMetric } = {}) {
  const fail = reason => sliceUnsupported(BACKOFF_SCOPE, reason);
  if (![time, nativeMetric].every(x => Number.isFinite(x) && Math.fround(x) === x)
      || nativeMetric <= 0) return fail('invalid-native-time-metric');
  const lower = Math.fround(Math.fround(0.1) / nativeMetric);
  const upper = Math.fround(4 / nativeMetric);
  if (![lower, upper].every(Number.isFinite)) return fail('nonfinite-time-bounds');
  const backoff = Math.fround(Math.max(lower, Math.min(upper, Math.fround(0.1))));
  const adjusted = Math.fround(time - backoff);
  if (!Number.isFinite(adjusted)) return fail('nonfinite-adjusted-time');
  return { status: 'ready', scope: BACKOFF_SCOPE, lower, upper, backoff,
    time: Math.fround(Math.max(0, Math.min(1, adjusted))) };
}
