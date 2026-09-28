/** Elbera Tools — original static-mesh query cache acquisition and reuse.
 * The provider supplies explicit Get/Create/Unlock/Flush responses; this module
 * does not invent native memory-cache allocation, capacity or eviction policy.
 * Owner matrices come from the actual source methods (or the qualified actor
 * transform component), never a renderer inverse. Native units and axis order.
 */
import { originalMatrixDeterminant } from "./actor-transforms.js";
import {
  isPreparedStaticMeshTree,
  traceStaticMeshTree,
  finishStaticMeshCollision,
} from "./static-mesh-tree.js";

const states = new WeakMap();
const scope = "original-static-mesh-cache";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const object = (v) => v !== null && typeof v === "object";
const freeze = Object.freeze;
const finite = (v) =>
  typeof v === "number" && Number.isFinite(v) && Object.is(Math.fround(v), v);
const matrix = (v) =>
  Array.isArray(v) &&
  v.length === 16 &&
  Array.from({ length: 16 }, (_, i) => finite(v[i])).every(Boolean);
const fail = (reason) => freeze({ status: "unsupported", scope, reason });
class Unknown extends Error {}
const need = (condition, reason) => {
  if (!condition) throw new Unknown(reason);
};

/** The original type-e3 key, from actual UObject cache indices, not server IDs. */
export function staticMeshCacheKey(ownerCacheIndex, meshCacheIndex) {
  if (!uint(ownerCacheIndex) || !uint(meshCacheIndex))
    return fail("explicit source UObject cache indices required");
  return freeze({
    status: "ready",
    scope,
    low: ((ownerCacheIndex << 8) + 0xe3) >>> 0,
    high: meshCacheIndex,
  });
}

/** Bind an explicitly recovered existing entry. This does not establish where
 * the caller's values came from, and never overwrites a live bound entry.
 */
export function bindStaticMeshCacheEntry(entry, input) {
  const cache = input?.cache;
  const dense = (rows) =>
    Array.isArray(rows) &&
    Array.from({ length: rows.length }, (_, i) => Object.hasOwn(rows, i)).every(
      Boolean,
    );
  const vector = (v, n) =>
    Array.isArray(v) &&
    v.length === n &&
    Array.from({ length: n }, (_, i) => finite(v[i])).every(Boolean);
  if (
    !object(entry) ||
    states.has(entry) ||
    input?.ownerIdentity == null ||
    input.meshIdentity == null ||
    !cache ||
    !uint(cache.queryTag) ||
    !matrix(cache.worldToLocal) ||
    !matrix(cache.localToWorld) ||
    !finite(cache.determinant) ||
    !dense(cache.planes) ||
    !dense(cache.vertices) ||
    !cache.planes.every(
      (r) =>
        r &&
        uint(r.valid) &&
        uint(r.queryTag) &&
        (r.plane === undefined || vector(r.plane, 4)),
    ) ||
    !cache.vertices.every(
      (r) =>
        r && uint(r.valid) && (r.point === undefined || vector(r.point, 3)),
    )
  )
    return fail(
      "explicit unbound entry, identities and finite current cache records required",
    );
  states.set(entry, {
    ownerIdentity: input.ownerIdentity,
    meshIdentity: input.meshIdentity,
    cache: {
      worldToLocal: freeze([...cache.worldToLocal]),
      localToWorld: freeze([...cache.localToWorld]),
      determinant: cache.determinant,
      queryTag: cache.queryTag,
      planes: cache.planes.map((r) =>
        freeze({
          valid: r.valid,
          queryTag: r.queryTag,
          ...(r.plane ? { plane: freeze([...r.plane]) } : {}),
        }),
      ),
      vertices: cache.vertices.map((r) =>
        freeze({
          valid: r.valid,
          ...(r.point ? { point: freeze([...r.point]) } : {}),
        }),
      ),
    },
  });
  return freeze({ status: "ready", scope });
}

/** Private-state diagnostic snapshot; numeric cold cells remain absent. */
export function inspectStaticMeshCache(entry) {
  const state = states.get(entry);
  if (!state) return fail("unknown source cache entry");
  const records = (rows) =>
    freeze(
      rows.map((r) =>
        freeze({
          ...r,
          ...(r.plane ? { plane: freeze([...r.plane]) } : {}),
          ...(r.point ? { point: freeze([...r.point]) } : {}),
        }),
      ),
    );
  return freeze({
    status: "ready",
    scope,
    ownerIdentity: state.ownerIdentity,
    meshIdentity: state.meshIdentity,
    cache: freeze({
      ...state.cache,
      planes: records(state.cache.planes),
      vertices: records(state.cache.vertices),
    }),
  });
}

/** Provider methods return {status:'ready', ...} synchronously:
 * get(key, alignment) -> {entry:object|null, token?};
 * create(key, bytes, alignment, extra) -> {entry:object, token};
 * unlock(token), flush(key, mask, ignoreLocked) -> no additional fields.
 * Entries/tokens are opaque; only entries initialized here can be reused.
 * readTransforms() returns the current source worldToLocal/localToWorld arrays.
 * It is consumed for a fresh entry and for reused nonstatic owners only.
 * Successful queries apply sparse cache writes and release the acquired token.
 * Unknown input aborts the query; acquired tokens are released for browser
 * resource safety. That abort cleanup is not a native exception-path claim.
 */
export function traceCachedStaticMeshCollision(model, input) {
  if (
    !isPreparedStaticMeshTree(model) ||
    input?.arithmeticProfile !== "pc53-rne-math-sqrt" ||
    input.ownerIdentity == null ||
    input.meshIdentity == null ||
    typeof input.ownerStatic !== "boolean"
  )
    return fail(
      "prepared original mesh, source identities, bStatic and profile required",
    );
  const key = staticMeshCacheKey(input.ownerCacheIndex, input.meshCacheIndex);
  if (key.status !== "ready") return key;
  if (
    !uint(input.ownerFlags2f8) ||
    input.ownerFlags2f8 & 0x100 ||
    input.collisionModel !== null
  )
    return fail(
      "explicit ordinary mesh branch required before cache acquisition",
    );
  let token,
    acquired = false,
    state,
    entry,
    disposition;
  const provider = input.provider;
  const invoke = (name, ...args) => {
    need(
      typeof provider?.[name] === "function",
      `missing source cache provider ${name}`,
    );
    const value = provider[name](...args);
    need(value?.status === "ready", `unresolved source cache provider ${name}`);
    return value;
  };
  const release = () => {
    if (acquired) {
      // Clear first: an unresolved release must not trigger a second release.
      acquired = false;
      invoke("unlock", token);
    }
  };
  const adopt = (response) => {
    need(
      object(response.entry) && response.token != null,
      "explicit allocated cache entry and lock token required",
    );
    entry = response.entry;
    token = response.token;
    acquired = true;
  };
  const updateMatrices = (cache) => {
    need(
      typeof input.readTransforms === "function",
      "missing current source owner matrix methods",
    );
    const result = input.readTransforms();
    need(
      result?.status === "ready" &&
        matrix(result.worldToLocal) &&
        matrix(result.localToWorld),
      "unresolved source owner matrices",
    );
    const det = originalMatrixDeterminant({
      arithmeticProfile: "pc53-rne",
      matrix: result.localToWorld,
    });
    need(det.status === "ready", det.reason);
    cache.worldToLocal = freeze([...result.worldToLocal]);
    cache.localToWorld = freeze([...result.localToWorld]);
    cache.determinant = det.determinant;
    // The original update does not clear plane/vertex validity or triangle tags.
  };
  let result;
  try {
    const lookup = invoke("get", key, 8);
    need(
      Object.hasOwn(lookup, "entry"),
      "explicit cache lookup result required",
    );
    if (lookup.entry !== null) {
      adopt(lookup);
      state = states.get(entry);
      need(state, "unresolved preexisting native cache state");
      if (
        state.ownerIdentity !== input.ownerIdentity ||
        state.meshIdentity !== input.meshIdentity
      ) {
        release();
        invoke("flush", key, 0xffffffff, 0);
        states.delete(entry);
        state = undefined;
        disposition = "replaced";
      }
    }
    if (!state) {
      const bytes =
        0x98 + 24 * model.materials.length + 16 * model.vertices.length;
      need(
        bytes <= 0x7fffffff,
        "source cache allocation outside admitted signed size domain",
      );
      adopt(invoke("create", key, bytes, 8, 0));
      need(!states.has(entry), "cache create must provide fresh storage");
      const cache = {};
      updateMatrices(cache);
      cache.queryTag = 0;
      cache.planes = Array.from({ length: model.materials.length }, () => ({
        valid: 0,
        queryTag: 0,
      }));
      cache.vertices = Array.from({ length: model.vertices.length }, () => ({
        valid: 0,
      }));
      state = {
        ownerIdentity: input.ownerIdentity,
        meshIdentity: input.meshIdentity,
        cache,
      };
      states.set(entry, state);
      disposition ??= "created";
    } else {
      disposition = "reused";
      if (!input.ownerStatic) updateMatrices(state.cache);
    }
    state.cache.queryTag = (state.cache.queryTag + 1) >>> 0;
    const tree = traceStaticMeshTree(model, {
      ...input,
      time: 1,
      cache: state.cache,
    });
    need(tree.status === "ready", tree.reason);
    for (const { index, record } of tree.writes.planes)
      state.cache.planes[index] = record;
    for (const { index, record } of tree.writes.vertices)
      state.cache.vertices[index] = record;
    // Original nonzero-query destructor runs before the outer hit adjustment.
    release();
    const hit = finishStaticMeshCollision(tree, {
      ...input,
      actorIdentity: input.ownerIdentity,
    });
    need(hit.status === "ready", hit.reason);
    result = freeze({ ...hit, scope, cacheDisposition: disposition });
  } catch (error) {
    if (!(error instanceof Unknown)) throw error;
    result = fail(error.message);
  } finally {
    // Even an unsupported query cannot leave a browser provider lock held.
    try {
      release();
    } catch (error) {
      if (!(error instanceof Unknown)) throw error;
      result = fail(error.message);
    }
  }
  return result;
}
