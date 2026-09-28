// Elbera Tools: finite UModel::PointRegion (owned Engine 0x10746950).
// Current node/tree/zone actor values are explicit inputs, not live-state claims.
const prepared = new WeakSet();
const unsupported = reason => ({ status: 'unsupported', reason });
const dense = (a, predicate) => Array.isArray(a)
  && Array.from({ length: a.length }, (_, i) => Object.hasOwn(a, i) && predicate(a[i])).every(Boolean);
const stored = x => Number.isFinite(x) && Math.fround(x) === x;
const byte = x => Number.isInteger(x) && x >= 0 && x <= 255;
const leaf = x => Number.isInteger(x) && x >= -1 && x <= 0x7fffffff;
const identity = x => x !== null && x !== undefined;

/** Preserve actor identities as opaque references. A null slot means native
 * NULL; an absent slot is unknown. NumZones=0 still reads slot 0 on a nonempty
 * tree, so a serialized empty zone table cannot supply that slot implicitly.
 */
export function prepareBspRegion(source) {
  if (prepared.has(source)) return { status: 'ready', model: source };
  if (!source || !Array.isArray(source.nodes) || !Number.isInteger(source.numZones)
      || source.numZones < 0 || source.numZones > 64
      || ![0, 1].includes(source.rootOutside)) return unsupported('missing-source-model-fields');
  const count = source.nodes.length;
  if (!dense(source.zoneActors, actor => actor === null || identity(actor))
      || source.zoneActors.length > 64
      || source.zoneActors.length < Math.max(count ? 1 : 0, source.numZones))
    return unsupported('missing-explicit-zone-actor-slots');
  const child = value => Number.isInteger(value) && value >= -1 && value < count;
  if (!dense(source.nodes, n => n && dense(n.plane, stored) && n.plane.length === 4
      && child(n.front) && child(n.back) && byte(n.flags) && byte(n.numVertices)
      && dense(n.zones, byte) && n.zones.length === 2
      && (!source.numZones || n.zones.every(z => z < source.numZones))
      && dense(n.leaves, leaf) && n.leaves.length === 2))
    return unsupported('invalid-source-region-node');
  // Validate every front/back component, including unreachable ones. Shared
  // children are legal; cycles are not. PlaneChild is not read by PointRegion.
  const colors = new Uint8Array(count);
  for (let root = 0; root < count; root++) {
    if (colors[root]) continue;
    const stack = [[root, false]];
    while (stack.length) {
      const [index, leaving] = stack.pop();
      if (leaving) { colors[index] = 2; continue; }
      if (colors[index] === 1) return unsupported('cyclic-region-tree');
      if (colors[index] === 2) continue;
      colors[index] = 1; stack.push([index, true]);
      for (const next of [source.nodes[index].back, source.nodes[index].front])
        if (next !== -1) stack.push([next, false]);
    }
  }
  const nodes = source.nodes.map(n => Object.freeze({
    plane: Object.freeze([...n.plane]), front: n.front, back: n.back,
    flags: n.flags, numVertices: n.numVertices,
    zones: Object.freeze([...n.zones]), leaves: Object.freeze([...n.leaves]),
  }));
  const model = Object.freeze({ nodes: Object.freeze(nodes), rootOutside: source.rootOutside,
    numZones: source.numZones, zoneActors: Object.freeze([...source.zoneActors]) });
  prepared.add(model);
  return { status: 'ready', model };
}

/** Original XYZ point; explicit nonnull caller ZoneInfo identity. The returned
 * zone retains its input identity. This is a region lookup, not a collision or
 * loaded-world admission. Native ChildOutside's result is computed but never
 * used in this helper's output or traversal; its retained body has no writes.
 */
export function queryBspRegion(source, point, defaultZone) {
  const checked = prepareBspRegion(source);
  if (checked.status !== 'ready') return checked;
  if (!dense(point, Number.isFinite) || point.length !== 3 || !identity(defaultZone))
    return unsupported('missing-point-or-default-zone');
  point = point.map(Math.fround);
  if (!point.every(Number.isFinite)) return unsupported('nonfinite-region-point');
  const { model } = checked, visited = [];
  let region = { zone: defaultZone, leaf: -1, zoneNumber: 0 };
  if (!model.nodes.length) return { status: 'ready', region, visited };
  let index = 0;
  for (;;) {
    const node = model.nodes[index], p = node.plane;
    visited.push(index);
    // Preserve source y-product + x-product, then z and W, one final f32 store.
    const distance = Math.fround(p[1] * point[1] + p[0] * point[0] + p[2] * point[2] - p[3]);
    if (!Number.isFinite(distance)) return unsupported('nonfinite-region-distance');
    const side = distance >= 0 ? 1 : 0; // includes positive and negative zero
    const next = side ? node.front : node.back;
    if (next !== -1) { index = next; continue; }
    const zoneNumber = model.numZones ? node.zones[side] : 0;
    region = { zone: model.zoneActors[zoneNumber] ?? defaultZone,
      leaf: node.leaves[side], zoneNumber };
    return { status: 'ready', region, visited };
  }
}
