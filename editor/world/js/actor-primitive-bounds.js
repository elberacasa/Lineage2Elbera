/** Ordinary AActor primitive selection and UPrimitive's nonnull-owner box.
 * Source offsets retain their identity; unresolved fields never become null.
 * Overrides and static-mesh bounding boxes remain separate method paths.
 */
const scope = "original-actor-primitive-bounds";
const freeze = Object.freeze;
const fail = (reason) => freeze({ status: "unsupported", scope, reason });
const finite = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(Math.fround(v), v);
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => finite(v[i]));

/** 1052dfb0, ordinary AActor.GetPrimitive. Each consumed reference must be an
 * explicit identity or null. Undefined means unknown, not a fallback choice.
 */
export function selectActorPrimitive(input) {
  for (const key of ["primitive104", "primitive38", "primitive2b8"]) {
    if (input?.[key] === undefined) return fail(`missing source ${key}`);
    if (input[key] !== null)
      return freeze({ status: "ready", scope, primitiveIdentity: input[key] });
  }
  if (input.levelIdentity == null)
    return fail("ordinary primitive fallback requires the current level");
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
