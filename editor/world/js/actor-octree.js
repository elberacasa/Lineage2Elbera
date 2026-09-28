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
  octreeSegmentIntersectsBox,
} from "./actor-octree-geometry.js";
import { createActorHashResult } from "./cylinder-collision.js";

const states = new WeakMap();
const freeze = Object.freeze;
const scope = "original-actor-octree-membership";
const profile = { arithmeticProfile: "pc53-rne" };
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const scalar = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(Math.fround(v), v);
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => scalar(v[i]));
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

/** Original nonzero-extent ActorLineCheck. Source tags and actor fields are
 * explicit; returned tag writes must be applied before the next query. Callbacks
 * are synchronous, with stable inputs and no nested mutation of this tree.
 * Hits encode native linked-list order; allocation addresses/Next are omitted.
 * A ready empty result covers ONLY this explicitly populated tree.
 */
export function queryActorOctree(tree, input) {
  const state = states.get(tree);
  const queryScope = "original-actor-octree-nonzero-query";
  const writes = { actorTags: [] };
  let hits = [];
  const finish = (status, fields = {}) =>
    freeze({
      status,
      scope: queryScope,
      ...fields,
      hits: freeze([...hits].reverse()),
      writes: freeze({ ...writes, actorTags: freeze([...writes.actorTags]) }),
    });
  const ensure = (value, reason) => {
    if (!value) throw Error(reason);
  };
  try {
    ensure(state && !state.updating, "known idle actor tree required");
    ensure(
      state.root.volume.halfExtent === 360448 &&
        state.root.volume.center.every((v) => Object.is(v, 0)),
      "query requires the original root volume",
    );
    ensure(
      input &&
        [input.start, input.end, input.extent].every(vector) &&
        input.extent.every((v) => v >= 0) &&
        input.extent.some((v) => v !== 0),
      "finite source query with nonzero nonnegative extent required",
    );
    ensure(
      uint(input.currentTag) &&
        uint(input.flags) &&
        uint(input.extra) &&
        input.sourceActor !== undefined,
      "explicit tag, query flags and source actor required",
    );
    const start = freeze([...input.start]),
      end = freeze([...input.end]);
    const extent = freeze([...input.extent]);
    const direction = end.map((v, i) => Math.fround(v - start[i]));
    ensure(vector(direction), "nonfinite source query direction");
    ensure(
      !direction.includes(0) || input.maskedZeroDivision === true,
      "zero direction requires explicit masked x87 division-by-zero admission",
    );
    const reciprocal = direction.map((v) => Math.fround(1 / v));
    ensure(
      reciprocal.every((v, i) => direction[i] === 0 || Number.isFinite(v)),
      "nonfinite consumed source reciprocal",
    );
    // Core.FBox += Start, then End: equality keeps the first stored endpoint,
    // including its sign of zero. Math.min/max would change that rule.
    const min = start.map((v, i) =>
      Math.fround((end[i] < v ? end[i] : v) - extent[i]),
    );
    const max = start.map((v, i) =>
      Math.fround((end[i] > v ? end[i] : v) + extent[i]),
    );
    ensure(vector(min) && vector(max), "nonfinite source query box");
    const tag = (input.currentTag + 1) >>> 0;
    const fields = new Map(),
      tags = new Map();
    const call = (name, ...args) => {
      ensure(
        typeof input[name] === "function",
        `missing source ${name} method`,
      );
      const value = input[name](...args);
      ensure(
        value?.status === "ready",
        value?.reason ?? `unresolved source ${name} response`,
      );
      return value;
    };
    const predicate = (name, ...args) => {
      const r = call(name, ...args);
      ensure(uint(r.value), `source DWORD ${name} response required`);
      return r.value !== 0;
    };
    const actorState = (identity) => {
      if (!fields.has(identity))
        fields.set(identity, call("readActor", identity).actor);
      return fields.get(identity);
    };
    const intersects = (center, size) => {
      const result = octreeSegmentIntersectsBox({
        ...profile,
        start,
        center,
        extent: size,
        direction,
        reciprocal,
      });
      ensure(result.status === "ready", result.reason);
      return result.intersects;
    };
    const expanded = (values) => {
      ensure(
        vector(values) && values.every((v) => v >= 0),
        "current source cached extents required",
      );
      const size = values.map((v, i) => Math.fround(v + extent[i]));
      ensure(vector(size), "nonfinite expanded query extent");
      return size;
    };
    const visit = (current) => {
      for (const entry of current.actors) {
        const identity = entry.identity,
          actor = actorState(identity);
        const previousTag = tags.has(identity)
          ? tags.get(identity)
          : actor?.tag1b0;
        ensure(uint(previousTag), "current source actor query tag required");
        if (previousTag === tag) continue;
        tags.set(identity, tag);
        writes.actorTags.push(freeze({ identity, tag1b0: tag }));
        ensure(uint(actor.flags2f8), "current source actor flags2f8 required");
        if (!(actor.flags2f8 & 0x40) || identity === input.sourceActor)
          continue;
        if (predicate("isOwnedBy", input.sourceActor, identity)) continue;
        if (!predicate("shouldTrace", identity, input.sourceActor, input.flags))
          continue;
        ensure(
          vector(actor.cachedCenter),
          "current source cached actor center required",
        );
        if (!intersects(actor.cachedCenter, expanded(actor.cachedExtent)))
          continue;
        const scratch = createActorHashResult();
        const selected = call("getPrimitive", identity);
        ensure(
          selected.primitiveIdentity != null,
          "nonnull current primitive required",
        );
        const response = call("lineCheck", selected.primitiveIdentity, {
          actor: identity,
          start,
          end,
          extent,
          flags: input.flags,
          extra: input.extra,
          initialResult: scratch,
        });
        ensure(
          typeof response.hit === "boolean",
          "explicit primitive hit response required",
        );
        if (!response.hit) continue;
        ensure(
          response.writes &&
            typeof response.writes === "object" &&
            !Array.isArray(response.writes) &&
            Object.keys(response.writes).every((k) =>
              Object.hasOwn(scratch, k),
            ),
          "explicit source result-field writes required",
        );
        const record = { ...scratch, ...response.writes };
        ensure(
          vector(record.point) &&
            vector(record.normal) &&
            scalar(record.time) &&
            ["actor", "item", "material", "nodeIndex"].every(
              (k) => record[k] !== undefined,
            ),
          "complete finite source hit record required",
        );
        delete record.next;
        record.point = freeze([...record.point]);
        record.normal = freeze([...record.normal]);
        // Collect forward, then reverse once on return to preserve native
        // prepend order without moving the entire browser array at each hit.
        hits.push(freeze(record));
        if (input.flags & 0x200) return true;
      }
      if (current.children) {
        const selected = octreeIntersectedChildren({
          ...profile,
          volume: current.volume,
          box: { min, max },
        });
        ensure(selected.status === "ready", selected.reason);
        for (const child of selected.children) {
          const next = current.children[child];
          if (
            intersects(
              next.volume.center,
              expanded(Array(3).fill(next.volume.halfExtent)),
            )
          ) {
            visit(next);
            if (hits.length && input.flags & 0x200) return true;
          }
        }
      }
      return false;
    };
    state.updating = true;
    try {
      writes.currentTag = tag;
      visit(state.root);
      if (input.flags & 0x400) {
        let selected = null,
          time = 3.4028234663852886e38;
        for (let i = hits.length - 1; i >= 0; i--) {
          const hit = hits[i];
          if (hit.time < time) {
            selected = hit;
            time = hit.time;
          }
        }
        hits = selected === null ? [] : [selected];
      }
      return finish("ready");
    } finally {
      state.updating = false;
    }
  } catch (error) {
    return finish("unsupported", { reason: error.message });
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
