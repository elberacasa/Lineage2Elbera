/** Elbera Tools — finite ordinary MultiLineCheck collector.
 * Source query participants and primitive record writes are explicit inputs.
 * This does not discover a world, supply actor state or replace MoveActor.
 */
import {orderLevelHits, shortenLevelTrace} from './level-collision.js';

const f = Math.fround;
const dense = (value) =>
  Array.isArray(value) &&
  Array.from({length: value.length}, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value) && Number.isFinite(f(value));
const vector = (value) => dense(value) && value.length === 3 && value.every(finite);
const uint = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const unsupported = (reason) => ({
  status: 'unsupported',
  scope: 'ordinary-level-collector',
  reason
});
const copy = (record) =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      ['point', 'normal'].includes(key) && Array.isArray(value) ? [...value] : value
    ])
  );

/** `level` is the current level's explicit {identity,model,actorHash,zones}.
 * `callerLevel` is null or {identity,model}; it need not equal `level`.
 * Attached levels are ordered, may contain null entries and require an explicit
 * live gate. Zone slots are 64 resolved GetZoneActor results, including repeats.
 * A zone has {identity,flags3d8,terrains}; terrain values are opaque identities.
 *
 * Adapters: bsp/terrain -> {status:'ready',blocked,writes}; region -> ready/zone;
 * actorHash -> ready/hits in source linked-list order. Writes are exact native
 * writes, including on a miss. Omitted scratch fields stay unknown. Arrays
 * encode linked-list order; native heap addresses/Next pointers are excluded.
 */
export function collectLevelHits({
  start,
  end,
  extent,
  flags,
  sourceActor,
  level,
  callerLevel,
  attachedLevelsEnabled,
  attachedLevels,
  primitives
} = {}) {
  if (
    !vector(start) ||
    !vector(end) ||
    !vector(extent) ||
    !uint(flags) ||
    sourceActor === undefined ||
    !level ||
    level.identity == null ||
    typeof attachedLevelsEnabled !== 'boolean' ||
    !primitives ||
    callerLevel === undefined
  )
    return unsupported('incomplete explicit source query');
  start = start.map(f);
  end = end.map(f);
  extent = extent.map(f);
  const originalEnd = [...end],
    hits = [],
    slots = Array.from({length: 64}, () => ({material: null}));
  let scale = 1;
  const query = () => ({start: [...start], end: [...end], extent: [...extent], flags});
  const call = (name, args) => {
    if (typeof primitives[name] !== 'function')
      return unsupported(`missing ${name} source adapter`);
    const value = primitives[name](args);
    return value?.status === 'ready'
      ? value
      : unsupported(value?.reason ?? `unsupported ${name} participant`);
  };
  const finish = () => {
    const ordered = orderLevelHits(hits);
    return ordered.status === 'ready'
      ? {
          status: 'ready',
          scope: 'ordinary-level-collector',
          hits: ordered.hits,
          end: [...end],
          scale
        }
      : ordered;
  };
  const collectPrimitive = (kind, participant, actor, zone = null) => {
    if (hits.length === 64) return unsupported('world primitive exceeds native scratch capacity');
    const record = slots[hits.length];
    const result = call(kind, {
      participant,
      ...query(),
      initialResult: copy(record),
      ...(kind === 'terrain' ? {visibilityBypass: false} : {owner: null, extraNodeFlags: 0})
    });
    if (result.status !== 'ready') return result;
    if (
      typeof result.blocked !== 'boolean' ||
      !result.writes ||
      typeof result.writes !== 'object' ||
      Array.isArray(result.writes) ||
      Object.hasOwn(result.writes, 'next')
    )
      return unsupported('primitive must report exact non-link result writes');
    Object.assign(record, copy(result.writes));
    if (!result.blocked) return {status: 'ready'};
    if (!vector(record.point) || !finite(record.time))
      return unsupported('accepted primitive lacks source point/time');
    if (kind === 'terrain') {
      if (level.model == null)
        return unsupported('terrain region requires the current source model');
      const region = call('region', {
        model: level.model,
        point: [...record.point],
        defaultZone: level.identity
      });
      if (region.status !== 'ready') return region;
      if (region.zone === undefined) return unsupported('missing source region identity');
      if (region.zone !== zone && region.zone !== (callerLevel?.identity ?? null))
        return {status: 'ready'};
    }
    record.actor = actor;
    const shortened = shortenLevelTrace({start, originalEnd, hit: record, scale, kind});
    if (shortened.status !== 'ready') return shortened;
    record.time = shortened.time;
    scale = shortened.scale;
    end = shortened.end;
    hits.push(copy(record));
    return {status: 'ready'};
  };
  if (flags & 4 && callerLevel !== null) {
    if (!callerLevel || callerLevel.identity == null || callerLevel.model == null)
      return unsupported('missing caller LevelInfo/model');
    const result = collectPrimitive('bsp', callerLevel.model, callerLevel.identity);
    if (result.status !== 'ready') return result;
  }
  if (attachedLevelsEnabled) {
    if (!dense(attachedLevels)) return unsupported('missing ordered attached levels');
    if (flags & 4)
      for (const attached of attachedLevels) {
        if (attached === null) continue;
        if (!attached || attached.model === undefined)
          return unsupported('missing attached source model state');
        if (attached.model === null) continue;
        if (attached.identity == null) return unsupported('missing attached LevelInfo');
        const result = collectPrimitive('bsp', attached.model, attached.identity);
        if (result.status !== 'ready') return result;
      }
  }
  if (hits.length && flags & 0x200) return finish();
  if (flags & 4 && !(flags & 0x100)) {
    if (!dense(level.zones) || level.zones.length !== 64)
      return unsupported('all 64 resolved source zone slots required');
    for (const zone of level.zones) {
      if (zone === null) continue;
      if (!zone || !uint(zone.flags3d8)) return unsupported('missing source zone flags');
      if (!(zone.flags3d8 & 4)) continue;
      if (zone.identity == null || !dense(zone.terrains))
        return unsupported('missing source terrain list');
      for (const terrain of zone.terrains) {
        if (terrain == null) return unsupported('source terrain entry is null or missing');
        const result = collectPrimitive('terrain', terrain, terrain, zone.identity);
        if (result.status !== 'ready') return result;
      }
    }
  }
  if (hits.length && flags & 0x200) return finish();
  const collectActors = (sourceLevel) => {
    if (sourceLevel.actorHash === undefined) return unsupported('missing source actor-hash state');
    if (sourceLevel.actorHash === null) return {status: 'ready'};
    const result = call('actorHash', {
      hash: sourceLevel.actorHash,
      ...query(),
      sourceActor,
      extra: 0
    });
    if (result.status !== 'ready') return result;
    if (!dense(result.hits)) return unsupported('source actor list required');
    for (const hit of result.hits) {
      if (hits.length === 64) break;
      if (!hit || hit.actor == null || !finite(hit.time) || Object.hasOwn(hit, 'next'))
        return unsupported('incomplete or linked source actor record');
      const record = copy(hit);
      record.time = f(f(record.time) * scale);
      if (!Number.isFinite(record.time)) return unsupported('nonfinite actor time');
      hits.push(record);
    }
    return {status: 'ready'};
  };
  if (flags & 0x4009b) {
    const result = collectActors(level);
    if (result.status !== 'ready') return result;
    if (attachedLevelsEnabled)
      for (const attached of attachedLevels) {
        if (attached === null) continue;
        if (!attached) return unsupported('missing attached source level');
        const result = collectActors(attached);
        if (result.status !== 'ready') return result;
      }
  }
  return finish();
}
