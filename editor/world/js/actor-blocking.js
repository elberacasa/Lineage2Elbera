/** Elbera Tools — finite original actor blocking and MoveActor hit selection.
 * Explicit source fields and virtual predicate results only. No actor registry,
 * physics, class inference, spatial query or movement side effects supplied.
 */
const scope = "original-actor-blocking";
class UnknownSource extends Error {}
const unknown = (reason) => {
  throw new UnknownSource(reason);
};
const ready = (operation) => {
  try {
    return { status: "ready", scope, ...operation() };
  } catch (error) {
    if (!(error instanceof UnknownSource)) throw error;
    return { status: "unsupported", scope, reason: error.message };
  }
};
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const field = (actor, name) => {
  if (!actor || actor[name] === undefined) unknown(`missing source ${name}`);
  return actor[name];
};
const bits = (actor, name) => {
  const value = field(actor, name);
  if (!uint(value)) unknown(`invalid source ${name}`);
  return value;
};
const identity = (actor) => {
  const value = field(actor, "identity");
  if (value === null) unknown("missing source actor identity");
  return value;
};
const call = (helpers, name, ...args) => {
  if (typeof helpers?.[name] !== "function")
    unknown(`missing source ${name} predicate`);
  const value = helpers[name](...args);
  if (value === undefined) unknown(`unknown source ${name} result`);
  return value;
};
const predicate = (value) => {
  if (typeof value === "boolean") return value;
  if (!uint(value)) unknown("native predicate DWORD required");
  return value !== 0;
};
const pred = (helpers, name, actor) =>
  predicate(call(helpers, name, identity(actor)));
const playerPawn = (helpers, actor) => {
  const value = call(helpers, "getPlayerPawn", identity(actor));
  if (typeof value === "boolean")
    unknown("nullable GetPlayerPawn identity required");
  return value !== null;
};
const brush = (actor, helpers) =>
  field(actor, "primitive278") !== null && pred(helpers, "isABrush", actor);
const encroacher = (actor, helpers) => {
  if (!(bits(actor, "collisionBits") & 1)) return false;
  if (field(actor, "primitive38") !== null && pred(helpers, "isAMover", actor))
    return true;
  const physics = bits(actor, "physicsByte34");
  if (physics > 255) unknown("Physics byte outside source domain");
  if (physics === 14) return true;
  return physics === 13 && !pred(helpers, "isKConstraint", actor);
};

/** Ordinary AActor::IsBasedOn includes the receiver itself and follows Base.
 * Null is explicit; missing/cyclic links never become an invented false result.
 */
export function isActorBasedOn(input) {
  return ready(() => {
    let { actor, base, baseOf } = input ?? {};
    if (actor === undefined || base === undefined)
      unknown("explicit actor/base identities required");
    const seen = new Set();
    while (actor !== null) {
      if (actor === base) return { value: 1 };
      if (seen.has(actor))
        unknown("cyclic base chain outside terminating source domain");
      seen.add(actor);
      if (typeof baseOf !== "function") unknown("missing source Base provider");
      actor = baseOf(actor);
      if (actor === undefined) unknown("missing source Base link");
    }
    return { value: 0 };
  });
}

/** Ordinary AActor::IsOwnedBy includes the receiver and follows Owner +0x3c.
 * It is distinct from IsBasedOn's Base chain. Null is an explicit terminator.
 */
export function isActorOwnedBy(input) {
  return ready(() => {
    let { actor, owner, ownerOf } = input ?? {};
    if (actor === undefined || owner === undefined)
      unknown("explicit actor/owner identities required");
    const seen = new Set();
    while (actor !== null) {
      if (actor === owner) return { value: 1 };
      if (seen.has(actor))
        unknown("cyclic owner chain outside terminating source domain");
      seen.add(actor);
      if (typeof ownerOf !== "function")
        unknown("missing source Owner provider");
      actor = ownerOf(actor);
      if (actor === undefined) unknown("missing source Owner link");
    }
    return { value: 0 };
  });
}

/** Native direct helpers retain conditional virtual/class calls and byte fields.
 * Source aliases primitive38/primitive278 and physicsByte34 name offsets only.
 */
export function isActorEncroacher(input) {
  return ready(() => {
    const { actor, helpers } = input ?? {};
    return { value: Number(encroacher(actor, helpers)) };
  });
}
export function isActorBrush(input) {
  return ready(() => {
    const { actor, helpers } = input ?? {};
    return { value: Number(brush(actor, helpers)) };
  });
}

/** Original AActor::IsBlockedBy. Virtual responses must use actual subclass
 * dispatch. Reads and helper calls remain lazy and repeated in source order;
 * repeated source predicates are deliberately not cached.
 */
export function actorIsBlockedBy(input) {
  return ready(() => {
    const { actor, other, helpers } = input ?? {};
    if (bits(other, "bits74") & 2)
      return { value: (bits(actor, "collisionBits") >>> 1) & 1 };
    if (encroacher(actor, helpers) && bits(other, "bits74") & 0x40)
      return { value: 0 };
    if (encroacher(other, helpers) && bits(actor, "bits74") & 0x40)
      return { value: 0 };
    if (brush(other, helpers) || encroacher(other, helpers)) {
      if (!(bits(actor, "collisionBits") & 2)) return { value: 0 };
      const shift = playerPawn(helpers, actor) ? 3 : 2;
      return {
        value: (bits(other, "collisionBits") >>> shift) & 1,
      };
    }
    if (brush(actor, helpers) || encroacher(actor, helpers)) {
      if (!(bits(other, "collisionBits") & 2)) return { value: 0 };
      const shift = playerPawn(helpers, other) ? 3 : 2;
      return {
        value: (bits(actor, "collisionBits") >>> shift) & 1,
      };
    }
    const kind =
      playerPawn(helpers, actor) || pred(helpers, "isAProjectile", actor);
    if (!(bits(other, "collisionBits") & (kind ? 8 : 4))) return { value: 0 };
    const otherKind =
      playerPawn(helpers, other) || pred(helpers, "isAProjectile", other);
    return {
      value: (bits(actor, "collisionBits") >>> (otherKind ? 3 : 2)) & 1,
    };
  });
}

/** MoveActor's ordered blocking-result scan, after actual collection.
 * Selected record is returned by identity instead of copying its native 48 bytes.
 * Nothing here initializes a result or changes any result time. A null selected
 * record means no adoption by this loop, never proof of a clear spatial query.
 */
export function selectMoveActorBlockingHit(input) {
  return ready(() => {
    const { actor, hits, arg3, helpers } = input ?? {};
    let passedBaseChecks = false;
    if (!(bits(actor, "collisionBits") & 0x0e))
      return { selected: null, passedBaseChecks };
    if (!Array.isArray(hits))
      unknown("actual ordered collision records required");
    for (const hit of hits) {
      if (!uint(arg3)) unknown("explicit native arg3 DWORD required");
      const mover = identity(actor);
      if (!hit || hit.actor === undefined || hit.actor === null)
        unknown("missing result actor identity");
      if (arg3 && predicate(call(helpers, "isBasedOn", mover, hit.actor)))
        continue;
      if (predicate(call(helpers, "isBasedOn", hit.actor, mover))) continue;
      passedBaseChecks = true;
      if (predicate(call(helpers, "isBlockedBy", mover, hit.actor)))
        return { selected: hit, passedBaseChecks };
    }
    return { selected: null, passedBaseChecks };
  });
}
