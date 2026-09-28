/** Original FOctreeNode insertion, redistribution and actor membership removal.
 * Finite PC53/RNE, native axes/units, successful browser storage only. The caller
 * supplies the current node volume, expanded actor bounds and source mode bit.
 * This does not establish AddActor admission, live level state or query hits.
 */
import {
  octreeChildVolume,
  octreeBoxContainsVolume,
  octreeIntersectedChildren,
  octreeSingleChild,
} from "./actor-octree-geometry.js";

const states = new WeakMap();
const freeze = Object.freeze;
const scope = "original-actor-octree-membership";
const profile = { arithmeticProfile: "pc53-rne" };
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
  if (!actor) return fail("known tree and actor identity required");
  for (const current of actor.nodes)
    current.actors = current.actors.filter((entry) => entry !== actor);
  actor.nodes = [];
  return ready();
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
