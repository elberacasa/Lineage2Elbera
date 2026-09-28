/**
 * Elbera Tools — ordinary Interlude level-query operations.
 *
 * Recovered from the pinned Engine/Core inputs described by
 * docs/native-level-collision-evidence.md. Coordinates are original XYZ/Z-up.
 * These operations consume actual primitive results and preserve source order;
 * they do not discover collision participants or make an incomplete scene clear.
 */
const f = Math.fround;
const unsupported = reason => ({status: 'unsupported', reason});
const scalar = x => typeof x === 'number' && Number.isFinite(x) && Number.isFinite(f(x));
const vector = v => Array.isArray(v) && v.length === 3 &&
  [0, 1, 2].every(i => Object.hasOwn(v, i) && scalar(v[i]));
const uint = x => Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
const dense = v => Array.isArray(v) && Array.from({length: v.length},
  (_, i) => Object.hasOwn(v, i)).every(Boolean);

/** Source Core appQsort, specialized to the level's <=64 finite hit records.
 * Equal times are NOT stable. Preserve the native short-sort/partition swaps.
 * Records themselves remain opaque and unchanged; the returned array is new.
 */
export function orderLevelHits(hits) {
  if (!Array.isArray(hits) || hits.length > 64 ||
      !Array.from({length: hits.length}, (_, i) => Object.hasOwn(hits, i) &&
        hits[i] && scalar(hits[i].time)).every(Boolean)) {
    return unsupported('at most 64 dense finite source hit records required');
  }
  const rows = hits.slice();
  const compare = (a, b) => f(rows[a].time) < f(rows[b].time) ? -1 :
    f(rows[a].time) > f(rows[b].time) ? 1 : 0;
  const swap = (a, b) => { [rows[a], rows[b]] = [rows[b], rows[a]]; };
  const pending = [];
  let lo = 0, hi = rows.length - 1;
  while (hi > lo || pending.length) {
    if (hi <= lo) { [lo, hi] = pending.pop(); continue; }
    const count = hi - lo + 1;
    if (count <= 8) {
      // The first strictly greatest item is exchanged with the high item.
      // A run of equal times therefore has observable, nonstable ordering.
      for (let end = hi; end > lo; end--) {
        let max = lo;
        for (let p = lo + 1; p <= end; p++) if (compare(p, max) > 0) max = p;
        swap(max, end);
      }
      hi = lo;
      continue;
    }
    let middle = lo + (count >>> 1);
    if (compare(lo, middle) > 0) swap(lo, middle);
    if (compare(lo, hi) > 0) swap(lo, hi);
    if (compare(middle, hi) > 0) swap(middle, hi);
    let low = lo, high = hi;
    for (;;) {
      if (middle > low) {
        do { low++; } while (low < middle && compare(low, middle) <= 0);
      }
      if (middle <= low) {
        do { low++; } while (low <= hi && compare(low, middle) <= 0);
      }
      do { high--; } while (high > middle && compare(high, middle) > 0);
      if (low > high) break;
      swap(low, high);
      if (middle === high) middle = low;
    }
    high++;
    if (middle < high) {
      do { high--; } while (high > middle && compare(high, middle) === 0);
    }
    if (middle >= high) {
      do { high--; } while (high > lo && compare(high, middle) === 0);
    }
    // Native stack processes the smaller partition first.
    if (high - lo >= hi - low) {
      if (lo < high) pending.push([lo, high]);
      lo = low;
    } else {
      if (low < hi) pending.push([low, hi]);
      hi = high;
    }
  }
  return {status: 'ready', hits: rows};
}

/** MultiLineCheck's accepted BSP/terrain hit rescales later query endpoints.
 * `scale` is the previous stored factor; hit.time is relative to that segment.
 * The hit location stays as returned by the primitive. This does not establish
 * primitive admission, source identity, terrain region or collision coverage.
 */
export function shortenLevelTrace({start, originalEnd, hit, scale, kind} = {}) {
  if (!vector(start) || !vector(originalEnd) || !vector(hit?.point) ||
      !scalar(hit?.time) || !scalar(scale) || !['bsp', 'terrain'].includes(kind)) {
    return unsupported('source vectors, hit, previous scale and primitive kind required');
  }
  const from = start.map(f), to = originalEnd.map(f), point = hit.point.map(f);
  const delta = point.map((x, i) => f(x - from[i]));
  const distance = f(Math.sqrt((delta[0] * delta[0] + delta[1] * delta[1]) + delta[2] * delta[2]));
  const time = f(f(hit.time) * f(scale));
  const candidate = f(((distance + (kind === 'bsp' ? 5 : 20)) * time) / (distance + f(.0001)));
  // Native FMin(1,candidate), followed by explicit Float32 vector stores.
  const nextScale = f(1 < candidate ? 1 : candidate);
  const end = to.map((x, i) => f(from[i] + f(f(x - from[i]) * nextScale)));
  if (![distance, time, nextScale, ...end].every(Number.isFinite)) {
    return unsupported('nonfinite source arithmetic outside the supported domain');
  }
  return {status: 'ready', time, scale: nextScale, end, distance};
}

/** Ordinary SingleLineCheck's filtering of an ALREADY ordered MultiLineCheck
 * result. The caller must have added 0x400 before producing that result.
 * Level identities, Model nodes/surfaces and actorFlags2e4 are source inputs.
 * The source's actor-bit filter is inside the attached-level loop; do not move
 * it outside that loop or label the raw bit from a guessed property name.
 */
export function selectSingleLevelHit({hits, flags, currentLevel, adjacentLevels} = {}) {
  if (!dense(hits) || hits.length > 64 || !uint(flags) || !(flags & 0x400) ||
      !currentLevel || currentLevel.identity == null || !dense(adjacentLevels)) {
    return unsupported('ordered multi hits, single-query flags and source levels required');
  }
  function surfaceRejected(level, hit) {
    if (hit.actor !== level.identity || !(flags & 0x100)) return false;
    if (!Number.isInteger(hit.nodeIndex) || hit.nodeIndex < 0) return null;
    const node = level.model?.nodes?.[hit.nodeIndex];
    if (!node || !Number.isInteger(node.surface) || node.surface < 0) return null;
    const surface = level.model?.surfaces?.[node.surface];
    return uint(surface?.flags) ? Boolean(surface.flags & 0x80) : null;
  }
  outer: for (const hit of hits) {
    if (!hit || hit.actor == null || !scalar(hit.time)) return unsupported('incomplete source hit record');
    const rejected = surfaceRejected(currentLevel, hit);
    if (rejected === null) return unsupported('missing source BSP node or surface flags');
    if (rejected) continue;
    for (const level of adjacentLevels) {
      if (!level || level.identity == null) return unsupported('missing source attached-level identity');
      const rejected = surfaceRejected(level, hit);
      if (rejected === null) return unsupported('missing attached source BSP node or surface flags');
      if (rejected) continue outer;
      if (hit.actor !== level.identity && (flags & 0x100)) {
        if (!uint(hit.actorFlags2e4)) return unsupported('missing original actor +0x2e4 flags');
        if (!(hit.actorFlags2e4 & 2)) continue outer;
      }
    }
    return {status: 'ready', blocked: true, hit};
  }
  // The native miss only writes Actor=null and Time=1; it does not clear
  // Location, Normal, Item, node index or Material in the caller's record.
  return {status: 'ready', blocked: false, hit: null, writes: {actor: null, time: 1}};
}
