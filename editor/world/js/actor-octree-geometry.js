/** Elbera Tools — original FOctreeNode volume and child-selection arithmetic.
 * Retained Engine helpers 105fe810, 105fe890, 105fe920, 105feaa0 and 105feed0.
 * Native axis order/units; finite PC53/RNE only. This does not populate a tree,
 * select live actors, implement primitive collision or establish a clear route.
 */
const scope = "original-actor-octree-geometry";
const freeze = Object.freeze;
const finite = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(Math.fround(v), v);
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => finite(v[i]));
const volume = (v) =>
  vector(v?.center) && finite(v.halfExtent) && v.halfExtent >= 0;
const box = (v) =>
  vector(v?.min) &&
  vector(v.max) &&
  v.min.every((value, i) => value <= v.max[i]);
const fail = (reason) => freeze({ status: "unsupported", scope, reason });
const ready = (result) => freeze({ status: "ready", scope, ...result });
const admitted = (input) => input?.arithmeticProfile === "pc53-rne";

/** The source FPlane encodes center XYZ and a scalar half extent at +0xc. */
export function octreeChildVolume(input) {
  if (
    !admitted(input) ||
    !volume(input.volume) ||
    !Number.isInteger(input.child) ||
    input.child < 0 ||
    input.child > 7
  )
    return fail(
      "explicit source volume, child index and arithmetic profile required",
    );
  // The half extent is rounded before all three source center calculations.
  const halfExtent = Math.fround(input.volume.halfExtent * 0.5);
  const center = input.volume.center.map((value, i) =>
    Math.fround(value + (input.child & [4, 2, 1][i] ? 1 : -1) * halfExtent),
  );
  if (!center.every(finite)) return fail("nonfinite source child volume");
  return ready({ volume: freeze({ center: freeze(center), halfExtent }) });
}

/** MultiNodeFilter stops at this node when the actor box contains its volume. */
export function octreeBoxContainsVolume(input) {
  if (!admitted(input) || !volume(input.volume) || !box(input.box))
    return fail("explicit source volume, box and arithmetic profile required");
  const { center, halfExtent } = input.volume;
  return ready({
    contains: center.every(
      (v, i) =>
        input.box.min[i] <= v - halfExtent &&
        input.box.max[i] >= v + halfExtent,
    ),
  });
}

/** Original strict plane comparisons, emitted in descending child order. */
export function octreeIntersectedChildren(input) {
  if (!admitted(input) || !volume(input.volume) || !box(input.box))
    return fail("explicit source volume, box and arithmetic profile required");
  const children = [];
  for (let child = 7; child >= 0; child--) {
    if (
      input.volume.center.every((center, i) =>
        child & [4, 2, 1][i]
          ? center < input.box.max[i]
          : center > input.box.min[i],
      )
    )
      children.push(child);
  }
  return ready({ children: freeze(children) });
}

/** SingleNodeFilter keeps straddling boxes at the parent. Equality is retained
 * on the low side: max <= center, whereas the high side requires min > center.
 */
export function octreeSingleChild(input) {
  if (!admitted(input) || !volume(input.volume) || !box(input.box))
    return fail("explicit source volume, box and arithmetic profile required");
  let child = 0;
  for (let i = 0; i < 3; i++) {
    if (input.volume.center[i] < input.box.min[i]) child |= [4, 2, 1][i];
    else if (input.volume.center[i] < input.box.max[i])
      return ready({ child: -1 });
  }
  return ready({ child });
}

/** Retained 105feed0 broad-phase helper. Direction and its stored reciprocal
 * are explicit source inputs. A zero direction never consumes its reciprocal.
 */
export function octreeSegmentIntersectsBox(input) {
  if (
    !admitted(input) ||
    !vector(input.start) ||
    !vector(input.center) ||
    !vector(input.extent) ||
    input.extent.some((v) => v < 0) ||
    !vector(input.direction) ||
    !Array.isArray(input.reciprocal) ||
    input.reciprocal.length !== 3
  )
    return fail(
      "explicit source broad-phase inputs and arithmetic profile required",
    );
  let enter = 0;
  let leave = 1;
  for (let i = 0; i < 3; i++) {
    const offset = Math.fround(input.start[i] - input.center[i]);
    if (!finite(offset)) return fail("nonfinite source broad-phase offset");
    if (input.direction[i] === 0) {
      if (input.extent[i] < Math.abs(offset))
        return ready({ intersects: false });
      continue;
    }
    const reciprocal = input.reciprocal[i];
    if (!finite(reciprocal))
      return fail("missing finite consumed source reciprocal");
    const distance = reciprocal * offset;
    const radius = Math.abs(reciprocal) * input.extent[i];
    const near = Math.fround(-distance - radius);
    const far = Math.fround(radius - distance);
    if (!finite(near) || !finite(far))
      return fail("nonfinite source broad-phase interval");
    if (near > enter) enter = near;
    if (far < leave) leave = far;
    if (enter > leave) return ready({ intersects: false });
  }
  return ready({ intersects: true });
}

/** AddActor's source bounding-box expansion and cached center/extent stores.
 * Input comes from the current primitive's native bounding-box method. These
 * values do not establish that an actor has been inserted into the octree.
 */
export function prepareOctreeActorBounds(input) {
  if (!admitted(input) || !box(input.primitiveBounds))
    return fail(
      "explicit current primitive bounds and arithmetic profile required",
    );
  // Engine 108d6a34: original Float32 expansion consumed by Core.FBox.ExpandBy.
  const expansion = Math.fround(4.2);
  const min = input.primitiveBounds.min.map((v) => Math.fround(v - expansion));
  const max = input.primitiveBounds.max.map((v) => Math.fround(v + expansion));
  // Core.GetCenterAndExtents stores the subtraction before halving, then adds
  // the stored half extent to Min. Averaging Min and Max changes rounding.
  const extent = min.map((v, i) => Math.fround(Math.fround(max[i] - v) * 0.5));
  const center = min.map((v, i) => Math.fround(v + extent[i]));
  if (![...min, ...max, ...extent, ...center].every(finite))
    return fail("nonfinite source expanded actor bounds");
  // Source AddActor tests overlap with these bounds, including touching faces.
  const rootOverlap = min.every((v, i) => v <= 360448 && max[i] >= -360448);
  return ready({
    bounds: freeze({ min: freeze(min), max: freeze(max) }),
    center: freeze(center),
    extent: freeze(extent),
    rootOverlap,
  });
}
