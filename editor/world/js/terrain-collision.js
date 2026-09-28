// Elbera Tools: ATerrainInfo::LineCheck (0x10722670) and LineCheckWithQuad
// (0x10721040), finite nonzero-extent / no-owner / current-coordinate path.
// Inputs are already-resolved native Vertices() values and current bitmaps.
// This module does not infer them from a rendered mesh or a height marcher.
// Float32 stores are retained; Float64 only approximates x87 intermediates.

const SCOPE = 'terrain-current-extent-sweep';
const prepared = new WeakSet();
const unsupported = reason => ({ status: 'unsupported', scope: SCOPE, reason });
const dense = (a, n, predicate) => Array.isArray(a) && a.length === n
  && Array.from({ length: n }, (_, i) => predicate(a[i])).every(Boolean);
const stored = x => Number.isFinite(x) && Math.fround(x) === x;
const vector = v => dense(v, 3, Number.isFinite) ? v.map(Math.fround) : null;
const f = x => {
  const value = Math.fround(x);
  if (!Number.isFinite(value)) throw new RangeError('nonfinite-terrain-arithmetic');
  return value;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => a.map((x, i) => f(x - b[i]));
const cross = (a, b) => [f(a[1] * b[2] - a[2] * b[1]),
  f(a[2] * b[0] - a[0] * b[2]), f(a[0] * b[1] - a[1] * b[0])];
function safeNormal(v) {
  const square = f(dot(v, v));
  // Core SafeNormal stores both sqrt and reciprocal as Float32. Its zero
  // branch includes equality; Normalize has a different equality contract.
  if (square <= 1e-8) return [0, 0, 0];
  const reciprocal = f(1 / f(Math.sqrt(square)));
  return v.map(x => f(x * reciprocal));
}
function transform(v, coords, isVector = false) {
  // TransformPointBy retains the subtraction in extended registers until
  // each final dot-product store; do not round those subtractions first.
  const p = isVector ? v : v.map((x, i) => x - coords[i]);
  return [0, 1, 2].map(i => f(dot(p, coords.slice(3 + i * 3, 6 + i * 3))));
}

/** Snapshot a prepared current native grid. Source identity, Level/Zone list
 * membership, post-load vertex production and runtime field values must be
 * established by the caller. These checks validate data, not provenance.
 */
export function prepareTerrainSweep(source) {
  if (prepared.has(source)) return { status: 'ready', scope: SCOPE, model: source };
  if (!source || !Number.isSafeInteger(source.width) || source.width < 2
      || !Number.isSafeInteger(source.height) || source.height < 2
      || !Number.isSafeInteger(source.width * source.height))
    return unsupported('missing-source-dimensions');
  const count = source.width * source.height;
  if (!dense(source.vertices, count, v => dense(v, 3, stored))
      || !dense(source.inverseCoords, 12, stored))
    return unsupported('missing-prepared-native-vertices-or-coordinates');
  if (!dense(source.visibility, count, v => typeof v === 'boolean')
      || !dense(source.edgeTurn, count, v => typeof v === 'boolean'))
    return unsupported('missing-current-source-bitmaps');
  if (typeof source.inverted !== 'boolean' || typeof source.deleteMe !== 'boolean'
      || source.terrainMapPresent !== true || source.owner !== null)
    return unsupported('unsupported-or-missing-terrain-state');
  const model = Object.freeze({ width: source.width, height: source.height,
    vertices: Object.freeze(source.vertices.map(v => Object.freeze([...v]))),
    inverseCoords: Object.freeze([...source.inverseCoords]),
    visibility: Object.freeze([...source.visibility]), edgeTurn: Object.freeze([...source.edgeTurn]),
    inverted: source.inverted, deleteMe: source.deleteMe, terrainMapPresent: true, owner: null });
  prepared.add(model);
  return { status: 'ready', scope: SCOPE, model };
}

function quad(model, x, y, start, end, extent, previous) {
  const index = y * model.width + x;
  if (model.deleteMe || !model.visibility[index]) return null;
  const sign = model.inverted ? -1 : 1;
  const offset = f(sign * extent[2]);
  const v = [index, index + 1, index + model.width, index + model.width + 1]
    .map(i => { const p = model.vertices[i]; return [p[0], p[1], f(p[2] + offset)]; });
  const triples = model.edgeTurn[index] ? [[0, 1, 2], [2, 1, 3]] : [[0, 1, 3], [0, 3, 2]];
  const delta = subtract(end, start);
  let best = null;
  for (let triangle = 0; triangle < 2; triangle++) {
    const [a, b, c] = triples[triangle].map(i => v[i]);
    const u = subtract(b, a), w = subtract(c, a);
    const normal = safeNormal(model.inverted ? cross(w, u) : cross(u, w));
    if (!(f(dot(delta, normal)) < Math.fround(-0.0001))) continue;
    // The second branch anchors its plane at d, even when its normal was
    // constructed from a or c. This matters at the stored Float32 boundary.
    const planeW = f(dot(v[triangle === 0 ? 0 : 3], normal));
    // Native line/plane helper is called with End first, then Start.
    const reverse = subtract(start, end);
    const alpha = f((planeW - f(dot(end, normal))) / f(dot(reverse, normal)));
    let point = end.map((e, i) => f(e + f(reverse[i] * alpha)));
    const relative = subtract(point, start);
    if (previous) {
      const oldRelative = subtract(previous.point, start);
      if (!(f(dot(oldRelative, oldRelative)) > f(dot(relative, relative)))) continue;
    }
    const rawTime = f(f(dot(relative, delta)) / f(dot(delta, delta)));
    if (rawTime < 0 || rawTime > 1) continue;
    const edgeNormal = normal.map(n => f(sign * n));
    let inside = true;
    for (const [origin, target] of [[a, b], [b, c], [c, a]]) {
      const side = cross(subtract(target, origin), edgeNormal);
      const distance = f(dot(side, point) - f(dot(side, origin)));
      // The source does NOT normalize this edge plane or use Extent.Y.
      if (distance > extent[0]) { inside = false; break; }
    }
    if (!inside) continue;
    const length = f(Math.sqrt(dot(delta, delta)));
    const shifted = f(rawTime - 0.5 / length);
    const time = shifted < 0 ? 0 : shifted < 1 ? shifted : 1;
    point = start.map((s, i) => f(s + f(delta[i] * time)));
    best = { point, normal, time, rawTime, cell: [x, y], triangle };
    previous = best;
  }
  return best;
}

/** Original L2 XYZ and nonnegative half extent. A ready miss is only this
 * terrain primitive's result. Unsupported is unknown, never a clear world.
 * flags0x80000 (alternate original coordinates) and0x1000 (material lookup)
 * need separate source inputs and remain unsupported. No owner transform,
 * level aggregation, world shortening, stepping or physics is performed.
 */
export function traceTerrainSweep(source, start, end, extent, { flags = 0 } = {}) {
  const checked = prepareTerrainSweep(source);
  if (checked.status !== 'ready') return checked;
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff || (flags & 0x81000))
    return unsupported('unsupported-trace-flags');
  start = vector(start); end = vector(end); extent = vector(extent);
  if (!start || !end || !extent || ![...start, ...end, ...extent].every(Number.isFinite)
      || extent.some(x => x < 0) || !extent.some(x => x > 0))
    return unsupported('invalid-nonzero-extent-sweep');
  const model = checked.model, cells = [];
  let hit = null;
  const ready = () => ({ status: 'ready', scope: SCOPE, blocked: hit !== null,
    hit, visited: cells.length, cells });
  try {
    const a = transform(start, model.inverseCoords), b = transform(end, model.inverseCoords);
    const transformedX = transform(extent, model.inverseCoords, true)[0];
    const radius = transformedX < 0 ? -transformedX : transformedX;
    const direction = safeNormal(subtract(b, a));
    const s = a.map((v, i) => f(v - f(direction[i] * radius)));
    const e = b.map((v, i) => f(v + f(direction[i] * radius)));
    for (const [axis, size] of [[0, model.width], [1, model.height]]) {
      if ((s[axis] < 0 && e[axis] < 0) || (s[axis] > size - 2 && e[axis] > size - 2))
        return ready();
    }
    const cell = (value, size) => {
      // Native integer conversion outside signed DWORD range has a separate
      // exception/indefinite-result contract; do not imitate it with JS clamp.
      const integer = Math.trunc(value);
      if (integer < -0x80000000 || integer > 0x7fffffff)
        throw new RangeError('unsupported-native-coordinate-conversion');
      return Math.min(Math.max(integer, 0), size - 2);
    };
    const sx = cell(s[0], model.width), ex = cell(e[0], model.width);
    const sy = cell(s[1], model.height), ey = cell(e[1], model.height);
    const visit = (x, y) => {
      cells.push([x, y]);
      const result = quad(model, x, y, start, end, extent, hit);
      if (result) hit = result;
      return result !== null;
    };
    if (sx === ex && sy === ey) { visit(sx, sy); return ready(); }
    const axis = sx === ex ? 1 : 0, other = 1 - axis;
    const size = axis === 0 ? model.width : model.height;
    const otherSize = other === 0 ? model.width : model.height;
    const first = cell(s[axis], size), last = cell(e[axis], size);
    const step = first <= last ? 1 : -1;
    const slope = f((e[other] - s[other]) / (e[axis] - s[axis]));
    const intercept = f(e[other] - slope * e[axis]);
    let firstHit = null;
    for (let primary = first; step * primary <= step * last; primary += step) {
      const v0 = f(primary * slope + intercept), v1 = f((primary + 1) * slope + intercept);
      const low = cell(f(Math.min(v0, v1) - radius), otherSize);
      const high = cell(f(Math.max(v0, v1) + radius), otherSize);
      for (let secondary = low; secondary <= high; secondary++) {
        const adopted = axis === 0 ? visit(primary, secondary) : visit(secondary, primary);
        if (adopted && firstHit === null) firstHit = primary;
      }
      if (firstHit !== null && Math.abs(firstHit - primary) > radius) break;
    }
    return ready();
  } catch (error) {
    if (error instanceof RangeError) return unsupported(error.message);
    throw error;
  }
}
