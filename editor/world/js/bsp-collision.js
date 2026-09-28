// Elbera Tools: original UModel primary zero-extent traversal and no-owner
// nonzero-extent BSP sweep. Sources: Engine 0x10745bd0 and 0x10748160,
// ExtraNodeFlags=0. The extent path includes hulls, bevels and wrapper timing.
// Actor/terrain aggregation, transformed brushes and adjacent levels remain
// separate; the primary zero-extent path omits its own wrapper adjustment.
// No rendered polygon, texture visibility or walking height participates.
// See docs/native-camera-evidence.md. This is not the default world camera.

const SCOPE = 'bsp-primary-zero-extent';
const EPSILON = Math.fround(0.001);
const prepared = new WeakSet();
const unsupported = reason => ({ status: 'unsupported', scope: SCOPE, reason });
const storedFloats = (value, size) => Array.isArray(value) && value.length === size
  && Array.from({ length: size }, (_, i) => value[i]).every(x =>
    Number.isFinite(x) && Math.fround(x) === x);
const sourcePlane = p => storedFloats(p, 4) && p.slice(0, 3).some(x => x !== 0);

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
    if (!n || !sourcePlane(n.plane)
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
  if (!Array.isArray(value) || value.length !== 3 || ![0, 1, 2].every(i => Number.isFinite(value[i]))) return null;
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
const SWEEP_SCOPE = 'bsp-world-extent-sweep';
const sweepModels = new WeakMap();
const SWEEP_EPSILON = Math.fround(0.00001);
const sliceUnsupported = (scope, reason) => ({ status: 'unsupported', scope, reason });

/** Retained pair/axis admission before the bevel vector helpers.
 * Both planes must ALREADY have their native orientation. This does not take
 * raw LeafHulls references, flip flagged planes, construct a bevel or claim a
 * hit. Source checks X, Y, Z in that order for each saved plane pair.
 */
export function selectBspSweepBevelAxes({ planeA, planeB } = {}) {
  const fail = reason => sliceUnsupported(BEVEL_SCOPE, reason);
  for (const p of [planeA, planeB]) {
    if (!sourcePlane(p)) return fail('invalid-oriented-plane');
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

/** Decode world leaf-hull framing and orientation at Engine 0x10745580.
 * The original 0x40000000 flag invokes Core.FPlane.Flip: negate all four
 * components, including W and signed zeros. The matching call block is bound
 * separately by the pinned supplemental image. No owner transform is applied
 * here; these are world-model planes, not transformed brush planes or a hit.
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
    const original = source.nodes[index]?.plane;
    if (!sourcePlane(original)) return fail('invalid-source-hull-plane');
    const flipped = !!(word & 0x40000000);
    planes.push({ nodeIndex: index, requiresNativePlaneOperation: flipped,
      plane: original.map(x => flipped ? -x : x) });
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
 * never a world hit/miss: traceBspSweep composes hull orientation, bounds,
 * bevel planes, tree traversal, result adoption and wrapper adjustment.
 * State enter/exit/normal is explicit (first leaf uses -1/current hit time/0).
 */
export function clipBspSweepPlane({ plane, start, end, extent, enter, exit, normal } = {}) {
  const fail = reason => sliceUnsupported(PLANE_SCOPE, reason);
  if (!sourcePlane(plane)) return fail('invalid-source-plane');
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
  if (!sourcePlane(plane)) return fail('invalid-source-plane');
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
 * This operation does not itself decode the saved hull plane references.
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
  if (![min, max].every(v => storedFloats(v, 3))
      || min.some((x, i) => x > max[i])) return fail('invalid-hull-bounds');
  const planes = [[0, 0, -1, Math.fround(0.1 - min[2])], [0, 0, 1, Math.fround(max[2] + 0.1)],
    [-1, 0, 0, Math.fround(0.1 - min[0])], [1, 0, 0, Math.fround(max[0] - 0.1)],
    [0, -1, 0, Math.fround(0.1 - min[1])], [0, 1, 0, Math.fround(max[1] - 0.1)]];
  if (!planes.every(p => p.every(Number.isFinite))) return fail('nonfinite-bounds-plane');
  return { status: 'ready', scope: BOUNDS_SCOPE, planes };
}

/** Retained final leaf-interval admission at 0x10748e10..0x10748e83.
 * This consumes an explicit completed interval. Negative entry is retained;
 * the enclosing wrapper adjusts/clamps it in a separate stage.
 */
export function adoptBspSweepInterval({ enter, exit, normal } = {}) {
  const fail = reason => sliceUnsupported(ADOPTION_SCOPE, reason);
  if (![enter, exit].every(x => Number.isFinite(x) && Math.fround(x) === x)
      || !storedFloats(normal, 3))
    return fail('invalid-sweep-interval');
  const adopted = enter > -1 && exit > enter && exit > 0;
  return { status: 'ready', scope: ADOPTION_SCOPE, adopted,
    ...(adopted ? { time: enter, normal: [...normal] } : {}) };
}

/** Retained nonzero UModel wrapper at 0x1074973c..0x107497a7.
 * The bound Core.Size call stores segment length, including a stationary zero.
 * Infinity from the divisions is retained through the native clamps. This
 * models masked floating-point exceptions, not the original FPU control word.
 */
export function adjustBspSweepTime({ time, nativeMetric } = {}) {
  const fail = reason => sliceUnsupported(BACKOFF_SCOPE, reason);
  if (![time, nativeMetric].every(x => Number.isFinite(x) && Math.fround(x) === x)
      || nativeMetric < 0 || Object.is(nativeMetric, -0)) return fail('invalid-native-time-metric');
  const lower = Math.fround(Math.fround(0.1) / nativeMetric);
  const upper = Math.fround(4 / nativeMetric);
  const backoff = Math.fround(Math.max(lower, Math.min(upper, Math.fround(0.1))));
  const adjusted = Math.fround(time - backoff);
  return { status: 'ready', scope: BACKOFF_SCOPE, lower, upper, backoff,
    time: Math.fround(Math.max(0, Math.min(1, adjusted))) };
}

/** Engine constructor's stored (end-start), then the bound Core.FVector.Size.
 * Core stores the ordered square sum as Float64 and the square root as Float32.
 */
export function bspSweepSegmentMetric(start, end) {
  const scope = 'bsp-sweep-segment-metric';
  start = vector(start); end = vector(end);
  if (!start || !end) return sliceUnsupported(scope, 'invalid-segment');
  const delta = end.map((x, i) => Math.fround(x - start[i]));
  const metric = Math.fround(Math.sqrt((delta[0] * delta[0] + delta[1] * delta[1])
    + delta[2] * delta[2]));
  if (!delta.every(Number.isFinite) || !Number.isFinite(metric))
    return sliceUnsupported(scope, 'nonfinite-segment-metric');
  return { status: 'ready', scope, delta, metric };
}

const cross = (a, b) => [Math.fround(a[1] * b[2] - a[2] * b[1]),
  Math.fround(a[2] * b[0] - a[0] * b[2]), Math.fround(a[0] * b[1] - a[1] * b[0])];
const dot = (a, b) => (a[0] * b[0] + a[1] * b[1]) + a[2] * b[2];

// Keep construction lazy: native rejects a hull immediately when a clip fails,
// before evaluating any subsequent (potentially degenerate) bevel operation.
function* sweepBevels(planes) {
  const scope = 'bsp-sweep-bevel-planes';
  const units = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < planes.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = planes[i], b = planes[j];
      const selection = selectBspSweepBevelAxes({ planeA: a, planeB: b });
      if (selection.status !== 'ready') { yield selection; return; }
      for (const axis of selection.axes) {
        const direction = cross(a, b);
        const sizeSquared = Math.fround(dot(direction, direction));
        // Native helper returns zero vectors below this source threshold, and
        // its caller ignores the return before UnsafeNormal. Never skip it.
        if (sizeSquared < Math.fround(1.0000001111620804e-6)) {
          yield sliceUnsupported(scope, 'degenerate-bevel-intersection'); return;
        }
        const ca = cross(direction, a), cb = cross(b, direction);
        const reciprocal = Math.fround(1 / sizeSquared);
        const point = ca.map((x, k) => Math.fround(Math.fround(
          Math.fround(x * b[3]) + Math.fround(cb[k] * a[3])) * reciprocal));
        const scale = Math.fround(1 / Math.sqrt(sizeSquared));
        const normalized = direction.map(x => Math.fround(x * scale));
        const raw = cross(units['xyz'.indexOf(axis)], normalized);
        // UnsafeNormal's sum is stored as Float64, unlike SizeSquared above.
        const inverse = Math.fround(1 / Math.sqrt(dot(raw, raw)));
        let normal = raw.map(x => Math.fround(x * inverse));
        if (Math.fround(dot(normal, a)) < 0) normal = normal.map(x => -x);
        const plane = [...normal, Math.fround(dot(normal, point))];
        if (![sizeSquared, reciprocal, scale, inverse, ...point, ...plane].every(Number.isFinite)
            || !normal.some(x => x !== 0)) {
          yield sliceUnsupported(scope, 'nonfinite-bevel-arithmetic'); return;
        }
        yield { status: 'ready', scope, pair: [i, j], axis, plane };
      }
    }
  }
}

/** Ordered native edge planes, useful independently in the source inspector.
 * Degenerate admitted pairs are unknown; they are never silently omitted.
 */
export function bspSweepBevelPlanes(planes) {
  const scope = 'bsp-sweep-bevel-planes';
  if (!Array.isArray(planes) || planes.length > 64 || Array.from(planes).some(p => !sourcePlane(p)))
    return sliceUnsupported(scope, 'invalid-oriented-planes');
  const bevels = [];
  for (const result of sweepBevels(planes)) {
    if (result.status !== 'ready') return result;
    bevels.push({ pair: result.pair, axis: result.axis, plane: result.plane });
  }
  return { status: 'ready', scope, bevels };
}

/** Snapshot serialized world BSP data once. No polygons or rendered meshes.
 * The caller must establish that this is the level's actual world UModel.
 */
export function prepareBspSweep(source) {
  const fail = reason => sliceUnsupported(SWEEP_SCOPE, reason);
  if (sweepModels.has(source)) return { status: 'ready', scope: SWEEP_SCOPE, model: source };
  const primary = prepareBspPrimary(source);
  if (primary.status !== 'ready') return fail(primary.reason);
  if (!Array.isArray(source.leafHulls)) return fail('missing-source-leaf-hulls');
  const nodes = primary.model.nodes.map((n, i) => Object.freeze({ ...n,
    collisionBound: source.nodes[i].collisionBound }));
  const model = Object.freeze({ nodes: Object.freeze(nodes), rootOutside: source.rootOutside,
    leafHulls: Object.freeze([...source.leafHulls]) });
  const hulls = new Map();
  for (let i = 0; i < nodes.length; i++) {
    if (hulls.has(nodes[i].collisionBound)) continue;
    const decoded = decodeBspLeafHull(model, i);
    if (decoded.status !== 'ready') return fail(decoded.reason);
    hulls.set(nodes[i].collisionBound, decoded.hull);
  }
  prepared.add(model);
  sweepModels.set(model, hulls);
  return { status: 'ready', scope: SWEEP_SCOPE, model };
}

/** No-owner, nonzero-extent UModel sweep in original L2 XYZ (Z up).
 * `blocked` is the native wrapper decision; `hit` retains an adopted record
 * even if its clamped time is 1 and the wrapper therefore returns clear.
 * This is world BSP only: no actor/terrain/adjacent-level aggregation or
 * walking response. Float64 approximates x87 intermediates; unsupported is
 * unknown, never permission to move through a segment.
 */
export function traceBspSweep(source, start, end, extent, options = {}) {
  const fail = reason => sliceUnsupported(SWEEP_SCOPE, reason);
  const checked = prepareBspSweep(source);
  if (checked.status !== 'ready') return checked;
  start = vector(start); end = vector(end); extent = vector(extent);
  if (!start || !end || !extent || extent.some(x => x < 0) || !extent.some(x => x > 0))
    return fail('invalid-nonzero-extent-sweep');
  const segment = bspSweepSegmentMetric(start, end);
  if (segment.status !== 'ready') return fail(segment.reason);
  const traversal = collectBspSweepHulls(checked.model, start, end, extent, options);
  if (traversal.status !== 'ready') return fail(traversal.reason);
  let time = 2, adopted = null;
  let clippedPlanes = 0;
  for (const candidate of traversal.candidates) {
    const hull = sweepModels.get(checked.model).get(candidate.collisionBound);
    let interval = { enter: -1, exit: time, normal: [0, 0, 0] };
    const bounds = bspSweepBoundsPlanes(hull);
    if (bounds.status !== 'ready') return fail(bounds.reason);
    function* planes() {
      for (const p of hull.planes) yield { status: 'ready', plane: p.plane };
      for (const plane of bounds.planes) yield { status: 'ready', plane };
      yield* sweepBevels(hull.planes.map(p => p.plane));
    }
    let rejected = false;
    for (const step of planes()) {
      if (step.status !== 'ready') return fail(step.reason);
      const clip = clipBspSweepPlane({ ...interval, plane: step.plane, start, end, extent });
      if (clip.status !== 'ready') return fail(clip.reason);
      clippedPlanes++;
      interval = clip;
      if (!clip.continues) { rejected = true; break; }
    }
    if (rejected) continue;
    const result = adoptBspSweepInterval(interval);
    if (result.status !== 'ready') return fail(result.reason);
    if (result.adopted) { time = result.time; adopted = result; }
  }
  const counts = { visited: traversal.visited, candidates: traversal.candidates.length, clippedPlanes };
  if (!adopted) return { status: 'ready', scope: SWEEP_SCOPE, blocked: false, hit: null, ...counts };
  const adjusted = adjustBspSweepTime({ time, nativeMetric: segment.metric });
  if (adjusted.status !== 'ready') return fail(adjusted.reason);
  const point = start.map((x, i) => Math.fround(x + Math.fround(segment.delta[i] * adjusted.time)));
  if (!point.every(Number.isFinite)) return fail('nonfinite-hit-location');
  return { status: 'ready', scope: SWEEP_SCOPE, blocked: adjusted.time < 1,
    hit: { time: adjusted.time, rawTime: time, point, normal: adopted.normal }, ...counts };
}
