/** Original primitive selection, generic bounds and static-mesh owner bounds.
 * Source offsets retain their identity; unresolved fields never become null.
 * Current geometry, actor transforms and overridden method replies are inputs.
 */
import { readKnownFlagBits } from "./actor-loading.js";
const scope = "original-actor-primitive-bounds";
const freeze = Object.freeze;
const fail = (reason) => freeze({ status: "unsupported", scope, reason });
const finite = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(Math.fround(v), v);
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => finite(v[i]));
const matrix = (v) =>
  Array.isArray(v) &&
  v.length === 16 &&
  Array.from({ length: 16 }, (_, i) => finite(v[i])).every(Boolean);
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const box = (v) => vector(v?.min) && vector(v?.max);
const ownBox = (min, max, valid) =>
  freeze({ min: freeze(min), max: freeze(max), valid });

/** Core FBox.TransformBy (10117dd0). It consumes the six coordinates even if
 * input IsValid is zero; the transformed result is rebuilt from all 8 corners.
 * Strict comparisons keep the earlier corner on equal values/signed zeros.
 */
export function transformOriginalBox(input) {
  if (
    input?.arithmeticProfile !== "pc53-rne" ||
    !box(input.bounds) ||
    !matrix(input.matrix)
  )
    return fail(
      "explicit finite source box/matrix and arithmetic profile required",
    );
  const { min, max } = input.bounds,
    m = input.matrix;
  let lower, upper;
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const p = [0, 1, 2].map((i) =>
          Math.fround(y * m[4 + i] + x * m[i] + z * m[8 + i] + m[12 + i]),
        );
        if (!p.every(finite))
          return fail("nonfinite transformed source corner");
        if (!lower) {
          lower = [...p];
          upper = [...p];
        } else
          for (let i = 0; i < 3; i++) {
            if (p[i] < lower[i]) lower[i] = p[i];
            if (p[i] > upper[i]) upper[i] = p[i];
          }
      }
  return freeze({ status: "ready", scope, bounds: ownBox(lower, upper, 1) });
}

/** UModel.GetCollisionBoundingBox (10744ee0). A null owner copies the local
 * box, including its validity byte. With an owner, LocalToWorld runs before
 * the local box is read. The native record's three padding bytes stay unknown.
 */
export function prepareModelBounds(input) {
  if (input?.ownerIdentity === undefined)
    return fail("explicit Model owner identity or null required");
  if (input.ownerIdentity !== null) {
    if (typeof input.readLocalToWorld !== "function")
      return fail("current Model owner LocalToWorld method required");
    const transform = input.readLocalToWorld(input.ownerIdentity);
    if (transform?.status !== "ready")
      return fail("unknown current Model owner LocalToWorld response");
    return transformOriginalBox({
      arithmeticProfile: input.arithmeticProfile,
      bounds: input.localBounds,
      matrix: transform.matrix,
    });
  }
  const local = input.localBounds;
  if (!box(local) || !uint(local.valid) || local.valid > 255)
    return fail("explicit finite local Model box and validity byte required");
  return freeze({
    status: "ready",
    scope,
    bounds: ownBox([...local.min], [...local.max], local.valid),
  });
}

/** UStaticMesh.GetCollisionBoundingBox (106fe700), nonnull owner. The cylinder
 * branch bypasses mesh geometry, transforms and the auxiliary collision model.
 * LocalToWorld and collision-model bounds retain explicit virtual dispatch.
 */
export function prepareStaticMeshBounds(input) {
  const cylinder = readKnownFlagBits(input?.ownerFlags2f8, 0x100);
  if (input?.arithmeticProfile !== "pc53-rne" || cylinder === undefined)
    return fail("explicit owner flags and arithmetic profile required");
  if (cylinder) {
    const generic = prepareGenericPrimitiveBounds(input);
    if (generic.status !== "ready") return generic;
    return freeze({
      ...generic,
      bounds: ownBox([...generic.bounds.min], [...generic.bounds.max], 1),
    });
  }
  const owner = input.ownerIdentity;
  if (owner == null || typeof input.readLocalToWorld !== "function")
    return fail("current owner identity and LocalToWorld method required");
  const transform = input.readLocalToWorld(owner);
  if (transform?.status !== "ready")
    return fail("unknown current LocalToWorld response");
  const transformed = transformOriginalBox({
    arithmeticProfile: input.arithmeticProfile,
    bounds: input.localBounds,
    matrix: transform.matrix,
  });
  if (transformed.status !== "ready") return transformed;
  // Read after LocalToWorld, as the original wrapper does.
  const collisionModel = input.collisionModel;
  if (collisionModel === undefined)
    return fail("explicit current collision-model reference required");
  if (collisionModel === null) return transformed;
  if (typeof input.getCollisionModelBounds !== "function")
    return fail("current collision-model bounding-box method required");
  const response = input.getCollisionModelBounds(collisionModel, owner);
  const other = response?.bounds;
  if (
    response?.status !== "ready" ||
    !box(other) ||
    !uint(other.valid) ||
    other.valid > 255
  )
    return fail("unknown finite collision-model box/validity response");
  // Core FBox += FBox copies the right record if either IsValid is zero.
  // It does not ignore an invalid right record as a generic union might.
  if (other.valid === 0)
    return freeze({
      status: "ready",
      scope,
      bounds: ownBox([...other.min], [...other.max], 0),
    });
  const previous = transformed.bounds;
  const min = previous.min.map((v, i) => (other.min[i] < v ? other.min[i] : v));
  const max = previous.max.map((v, i) => (other.max[i] > v ? other.max[i] : v));
  return freeze({
    status: "ready",
    scope,
    bounds: ownBox(min, max, previous.valid),
  });
}

/** 1052dfb0, ordinary AActor.GetPrimitive. Each consumed reference must be an
 * explicit identity or null. Undefined means unknown, not a fallback choice.
 */
export function selectActorPrimitive(input) {
  for (const key of ["primitive104", "primitive38", "primitive2b8"]) {
    if (input?.[key] === undefined) return fail(`missing source ${key}`);
    if (input[key] !== null)
      return freeze({ status: "ready", scope, primitiveIdentity: input[key] });
  }
  return selectEnginePrimitive(input);
}

/** 1052dff0..1052e00e, ABrush.GetPrimitive, also bound by original volume
 * vtables. It reads Brush (+278), then the level engine fallback; ordinary
 * actor Mesh/StaticMesh fields are not part of this method.
 */
export function selectBrushPrimitive(input) {
  if (input?.primitive278 === undefined)
    return fail("explicit current Brush reference required");
  if (input.primitive278 !== null)
    return freeze({
      status: "ready",
      scope,
      primitiveIdentity: input.primitive278,
    });
  return selectEnginePrimitive(input);
}

function selectEnginePrimitive(input) {
  if (input.levelIdentity == null)
    return fail("primitive fallback requires the current level");
  if (input.engineIdentity === undefined)
    return fail("unknown current level engine");
  if (input.engineIdentity === null)
    return freeze({ status: "ready", scope, primitiveIdentity: null });
  if (input.enginePrimitive50 === undefined)
    return fail("unknown current engine primitive");
  return freeze({
    status: "ready",
    scope,
    primitiveIdentity: input.enginePrimitive50,
  });
}

/** 10645519..106455e6: generic method with a nonnull actor. Radius/height plus
 * one are stored before adding/subtracting location. Octree expansion is later.
 */
export function prepareGenericPrimitiveBounds(input) {
  if (
    input?.arithmeticProfile !== "pc53-rne" ||
    !vector(input.location) ||
    !finite(input.collisionRadius) ||
    !finite(input.collisionHeight) ||
    input.collisionRadius < 0 ||
    input.collisionHeight < 0
  )
    return fail(
      "explicit finite nonnull-owner cylinder fields and profile required",
    );
  const radius = Math.fround(input.collisionRadius + 1);
  const height = Math.fround(input.collisionHeight + 1);
  const extent = [radius, radius, height];
  const min = input.location.map((v, i) => Math.fround(v - extent[i]));
  const max = input.location.map((v, i) => Math.fround(v + extent[i]));
  if (![...min, ...max].every(finite))
    return fail("nonfinite source generic primitive bounds");
  return freeze({
    status: "ready",
    scope,
    bounds: freeze({ min: freeze(min), max: freeze(max) }),
  });
}
