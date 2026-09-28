/** Elbera Tools: explicit current BSP/terrain/region participants for the
 * ordinary nonzero-extent collector. No scene discovery or live admission.
 */
import { prepareBspSweep, traceBspSweep } from "./bsp-collision.js";
import { prepareBspRegion, queryBspRegion } from "./bsp-region.js";
import { prepareTerrainSweep, traceTerrainSweep } from "./terrain-collision.js";

const fail = (reason) => ({
  status: "unsupported",
  scope: "level-sweep-adapters",
  reason,
});
const dense = (a) =>
  Array.isArray(a) &&
  Array.from({ length: a.length }, (_, i) => Object.hasOwn(a, i)).every(
    Boolean,
  );
const identity = (value) => value !== null && value !== undefined;
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** models: [{identity,source,numZones,zoneActors}], terrains: [{identity,source}].
 * The same source nodes/rootOutside feed both BSP geometry and PointRegion.
 * Identities are opaque, compared exactly; they are not names or model indices.
 * Existing primitive preparation snapshots all numeric inputs. A separate
 * actorHash callback is required whenever the collector actually invokes it.
 */
export function prepareLevelSweepAdapters({
  models,
  terrains,
  actorHash,
} = {}) {
  if (
    !dense(models) ||
    !dense(terrains) ||
    (actorHash !== undefined && typeof actorHash !== "function")
  )
    return fail(
      "explicit participant arrays and optional actor-hash callback required",
    );
  const modelMap = new Map(),
    terrainMap = new Map();
  for (const record of models) {
    if (!record || !identity(record.identity) || modelMap.has(record.identity))
      return fail("missing or duplicate model identity");
    const sweep = prepareBspSweep(record.source);
    if (sweep.status !== "ready") return fail(sweep.reason);
    const region = prepareBspRegion({
      nodes: record.source.nodes,
      rootOutside: record.source.rootOutside,
      numZones: record.numZones,
      zoneActors: record.zoneActors,
    });
    if (region.status !== "ready") return fail(region.reason);
    modelMap.set(record.identity, { sweep: sweep.model, region: region.model });
  }
  for (const record of terrains) {
    if (
      !record ||
      !identity(record.identity) ||
      terrainMap.has(record.identity)
    )
      return fail("missing or duplicate terrain identity");
    const checked = prepareTerrainSweep(record.source);
    if (checked.status !== "ready") return fail(checked.reason);
    terrainMap.set(record.identity, checked.model);
  }
  const primitives = Object.freeze({
    bsp({
      participant,
      start,
      end,
      extent,
      flags,
      owner,
      extraNodeFlags,
    } = {}) {
      if (owner !== null || extraNodeFlags !== 0 || !uint(flags))
        return fail(
          "BSP requires explicit no-owner, zero extra-node flags and trace flags",
        );
      const model = modelMap.get(participant);
      if (!model) return fail("missing explicit BSP participant");
      // The nonzero wrapper does not consume TraceFlags. Its zero-extent
      // material branch is separate; extra-node flags are explicitly zero.
      const result = traceBspSweep(model.sweep, start, end, extent);
      if (result.status !== "ready") return result;
      if (!model.sweep.nodes.length)
        return { status: "ready", blocked: false, writes: {} };
      if (!result.hit)
        return { status: "ready", blocked: false, writes: { time: 2 } };
      // An adopted record at clamped Time=1 is still written despite returning
      // clear. No node index or material is assigned on this original path.
      return {
        status: "ready",
        blocked: result.blocked,
        writes: {
          actor: null,
          item: participant,
          point: [...result.hit.point],
          normal: [...result.hit.normal],
          time: result.hit.time,
        },
      };
    },
    terrain({ participant, start, end, extent, flags, visibilityBypass } = {}) {
      if (visibilityBypass !== false || !uint(flags))
        return fail(
          "terrain requires explicit visibility check and trace flags",
        );
      const model = terrainMap.get(participant);
      if (!model) return fail("missing explicit terrain participant");
      const result = traceTerrainSweep(model, start, end, extent, { flags });
      if (result.status !== "ready") return result;
      if (!result.enteredTraversal)
        return { status: "ready", blocked: false, writes: {} };
      if (!result.hit)
        return { status: "ready", blocked: false, writes: { actor: null } };
      return {
        status: "ready",
        blocked: result.blocked,
        writes: {
          actor: participant,
          point: [...result.hit.point],
          normal: [...result.hit.normal],
          time: result.hit.time,
          material: null,
        },
      };
    },
    region({ model: identity, point, defaultZone } = {}) {
      const model = modelMap.get(identity);
      if (!model) return fail("missing explicit region participant");
      const result = queryBspRegion(model.region, point, defaultZone);
      return result.status === "ready"
        ? { status: "ready", zone: result.region.zone }
        : result;
    },
    actorHash(query) {
      return actorHash
        ? actorHash(query)
        : fail("missing actual actor-hash provider");
    },
  });
  return { status: "ready", primitives };
}
