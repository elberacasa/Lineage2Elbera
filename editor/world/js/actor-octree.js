/** Original FOctreeNode insertion, redistribution and actor membership removal.
 * Finite PC53/RNE, native axes/units, successful browser storage only. The caller
 * supplies current source state. The ordinary update wrapper joins bounds and
 * membership with explicit virtual responses; live population/query hits remain
 * separate. See docs/native-actor-octree-evidence.md for the lower-level API.
 */
import {
  octreeChildVolume,
  octreeBoxContainsVolume,
  octreeIntersectedChildren,
  octreeSingleChild,
  prepareOctreeActorBounds,
} from "./actor-octree-geometry.js";

const states = new WeakMap();
const freeze = Object.freeze;
const scope = "original-actor-octree-membership";
const profile = { arithmeticProfile: "pc53-rne" };
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  [0, 1, 2].every(
    (i) =>
      typeof v[i] === "number" &&
      Number.isFinite(v[i]) &&
      Object.is(Math.fround(v[i]), v[i]),
  );
const ready = (fields = {}) => freeze({ status: "ready", scope, ...fields });
const fail = (reason) => freeze({ status: "unsupported", scope, reason });
const node = (volume, path) => ({ volume, path, actors: [], children: null });
const sameBounds = (a, b) =>
  ["min", "max"].every((key) =>
    a[key].every((v, i) => Object.is(v, b[key][i])),
  );

/** Create empty membership storage for an explicit source node volume. This is
 * also usable with authored diagnostic volumes; it does not claim live startup.
 */
export function createActorOctree(input) {
  const check = octreeChildVolume({ ...input, child: 0 });
  if (check.status !== "ready") return fail(check.reason);
  const { center, halfExtent } = input.volume;
  // Domain guard only: all descendant source arithmetic must remain finite.
  if (
    center.some(
      (v) => !Number.isFinite(Math.fround(Math.abs(v) + 2 * halfExtent)),
    )
  )
    return fail("finite descendant node volumes required");
  const volume = freeze({ center: freeze([...center]), halfExtent });
  const tree = freeze({});
  states.set(tree, { root: node(volume, ""), actors: new Map() });
  return ready({ tree });
}

function store(current, actor) {
  // 10601d4b..10601d76: compare the unrounded half product with source 100.
  if (
    current.actors.length >= 3 &&
    !current.children &&
    current.volume.halfExtent * 0.5 > 100
  ) {
    current.children = Array.from({ length: 8 }, (_, child) =>
      node(
        octreeChildVolume({ ...profile, volume: current.volume, child }).volume,
        current.path + child,
      ),
    );
    const previous = [...current.actors, actor];
    current.actors = [];
    // Source order is old entries followed by the incoming actor. Repeated
    // identities stay repeated; both native append wrappers use FArray.Add.
    for (const item of previous) {
      item.nodes = item.nodes.filter((n) => n !== current);
      insert(current, item);
    }
  } else {
    current.actors.push(actor);
    actor.nodes.push(current);
  }
}

function insert(current, actor) {
  const query = { ...profile, volume: current.volume, box: actor.box };
  if (actor.singleNode) {
    const { child } = octreeSingleChild(query);
    if (current.children && child !== -1)
      insert(current.children[child], actor);
    else store(current, actor);
  } else if (current.children && !octreeBoxContainsVolume(query).contains) {
    for (const child of octreeIntersectedChildren(query).children)
      insert(current.children[child], actor);
  } else store(current, actor);
}

/** Invoke the source single/multi filter using explicit already-expanded bounds.
 * singleNode is actor +0x74 mask 0x100, not an inferred actor class. Duplicate
 * insertion is retained. Remove a member before changing its cached fields.
 */
export function insertActorOctree(tree, input) {
  const state = states.get(tree);
  if (
    !state ||
    state.updating ||
    input?.identity == null ||
    typeof input.singleNode !== "boolean"
  )
    return fail(
      "known tree, nonnull actor identity and explicit mode required",
    );
  const check = octreeSingleChild({
    ...profile,
    volume: state.root.volume,
    box: input.cachedBounds,
  });
  if (check.status !== "ready") return fail(check.reason);
  let actor = state.actors.get(input.identity);
  if (
    actor?.nodes.length &&
    (actor.singleNode !== input.singleNode ||
      !sameBounds(actor.box, input.cachedBounds))
  )
    return fail(
      "remove existing membership before changing actor bounds or mode",
    );
  if (!actor) {
    actor = { identity: input.identity, nodes: [] };
    state.actors.set(input.identity, actor);
  }
  actor.box = freeze({
    min: freeze([...input.cachedBounds.min]),
    max: freeze([...input.cachedBounds.max]),
  });
  actor.singleNode = input.singleNode;
  insert(state.root, actor);
  return ready();
}

/** Original normal RemoveActor membership body; arrays keep survivor order.
 * All pointer occurrences are removed. Child nodes remain allocated.
 */
export function removeActorOctree(tree, identity) {
  const state = states.get(tree);
  const actor = state?.actors.get(identity);
  if (!actor || state.updating)
    return fail("known idle tree and actor identity required");
  remove(actor);
  return ready();
}

function remove(actor) {
  for (const current of actor.nodes)
    current.actors = current.actors.filter((entry) => entry !== actor);
  actor.nodes = [];
}

/** Normal FCollisionOctree.AddActor, with current external fields and explicit
 * synchronous virtual-method responses. The tree must use the original root
 * volume. GLog is admitted as null; assertion/exception behavior is unported.
 * Sparse writes are returned even after an unsupported later stage. The caller
 * must apply those writes and must not interpret unsupported as a clear route.
 */
export function updateActorOctree(tree, input) {
  const state = states.get(tree);
  if (!state || state.updating || input?.identity == null)
    return fail("known idle tree and explicit actor identity required");
  if (
    state.root.volume.halfExtent !== 360448 ||
    state.root.volume.center.some((v) => !Object.is(v, 0))
  )
    return fail("AddActor requires the original initialized root volume");
  const writes = {};
  const result = (status, fields) =>
    freeze({ status, scope, ...fields, writes: freeze({ ...writes }) });
  const unknown = (reason) => result("unsupported", { reason });
  if (!uint(input.flags2f8) || !(input.flags2f8 & 1))
    return unknown(
      "source AddActor collision-flag assertion precondition required",
    );
  if (!uint(input.flags64)) return unknown("unknown source actor flags64");
  let actor = state.actors.get(input.identity);
  if (!actor) {
    actor = { identity: input.identity, nodes: [] };
    state.actors.set(input.identity, actor);
  }
  if (input.flags64 & 0x80) return result("ready", { disposition: "skipped" });
  if (!uint(input.flags2e4)) return unknown("unknown source actor flags2e4");
  if (input.flags2e4 & 0x4000)
    return result("ready", { disposition: "skipped" });
  state.updating = true;
  try {
    if (actor.nodes.length) {
      // Full RemoveActor consumes both locations on this ordinary path. With
      // finite vectors and null GLog its comparisons have no membership gate.
      if (!vector(input.location) || !vector(input.storedLocation))
        return unknown(
          "current and stored locations required before native membership removal",
        );
      remove(actor);
    }
    if (typeof input.getPrimitive !== "function")
      return unknown("missing current primitive method");
    const selected = input.getPrimitive(input.identity);
    if (selected?.status !== "ready" || selected.primitiveIdentity == null)
      return unknown("unresolved or null current primitive");
    if (typeof input.getPrimitiveBounds !== "function")
      return unknown("missing primitive bounding-box method");
    const response = input.getPrimitiveBounds(
      selected.primitiveIdentity,
      input.identity,
    );
    if (response?.status !== "ready")
      return unknown("unresolved primitive bounding-box response");
    const prepared = prepareOctreeActorBounds({
      ...profile,
      primitiveBounds: response.bounds,
    });
    if (prepared.status !== "ready") return unknown(prepared.reason);
    actor.box = writes.cachedBounds = prepared.bounds;
    writes.cachedCenter = prepared.center;
    writes.cachedExtent = prepared.extent;
    if (!prepared.rootOverlap)
      return result("ready", { disposition: "outside-root" });
    if (!uint(input.flags74)) return unknown("unknown source actor flags74");
    let singleNode;
    if (input.level === null) singleNode = true;
    else if (uint(input.level?.infoFlags554))
      singleNode = Boolean(input.level.infoFlags554 & 2);
    else
      return unknown(
        "explicit null level or current LevelInfo infoFlags554 required",
      );
    actor.singleNode = singleNode;
    writes.flags74 =
      (singleNode ? input.flags74 | 0x100 : input.flags74 & ~0x100) >>> 0;
    insert(state.root, actor);
    if (!vector(input.location))
      return unknown("finite current actor location required for source store");
    writes.storedLocation = freeze([...input.location]);
    return result("ready", { disposition: "inserted" });
  } catch {
    return unknown("source virtual-method response failed");
  } finally {
    state.updating = false;
  }
}

/** Immutable diagnostic paths and source array order; opaque identities retain
 * their identity. Paths describe this tree, not original native pointer values.
 */
export function inspectActorOctree(tree) {
  const state = states.get(tree);
  if (!state) return fail("known tree required");
  const nodes = [];
  function visit(current) {
    nodes.push(
      freeze({
        path: current.path,
        actors: freeze(current.actors.map((a) => a.identity)),
        split: Boolean(current.children),
      }),
    );
    current.children?.forEach(visit);
  }
  visit(state.root);
  return ready({
    nodes: freeze(nodes),
    memberships: freeze(
      [...state.actors.values()].map((a) =>
        freeze({
          identity: a.identity,
          nodes: freeze(a.nodes.map((n) => n.path)),
        }),
      ),
    ),
  });
}
