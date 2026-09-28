import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBspRegion, queryBspRegion } from '../js/bsp-region.js';
const node = (overrides = {}) => ({ plane: [1, 0, 0, 0], front: -1, back: -1,
  flags: 0, numVertices: 3, zones: [1, 2], leaves: [17, 23], ...overrides });
const source = nodes => ({ nodes, rootOutside: 1, numZones: 3, zoneActors: [null, 'back', 'front'] });

test('negative back, positive/front and exact plane ties use source leaf and zone slots', () => {
  for (const [x, leaf, zone] of [[-1, 17, 'back'], [1, 23, 'front'], [0, 23, 'front'], [-0, 23, 'front']]) {
    const r = queryBspRegion(source([node()]), [x, 0, 0], 'fallback');
    assert.equal(r.status, 'ready'); assert.equal(r.region.leaf, leaf); assert.equal(r.region.zone, zone);
  }
});
test('stored negative zero chooses front after the source Float32 plane-distance store', () => {
  const n = node({ plane: [.5, 0, 0, 0] });
  assert.equal(queryBspRegion(source([n]), [-Math.fround(2 ** -149), 0, 0], 'fallback').region.zone, 'front');
});
test('only final traversed node supplies leaf and zone, ignoring coplanar links', () => {
  const s = source([node({ front: 1, planeChild: 0 }), node({ plane: [0, 1, 0, 0], leaves: [71, 93] })]);
  const r = queryBspRegion(s, [1, -1, 0], 'fallback');
  assert.deepEqual(r.visited, [0, 1]); assert.deepEqual(r.region, { zone: 'back', leaf: 71, zoneNumber: 1 });
});
test('null actor falls back without erasing selected leaf or zone number', () => {
  const s = source([node()]); s.zoneActors[2] = null;
  assert.deepEqual(queryBspRegion(s, [1, 0, 0], 'default').region, { zone: 'default', leaf: 23, zoneNumber: 2 });
});
test('NumZones zero uses explicit slot0; unknown slot0 is not assumed null', () => {
  const s = source([node()]); s.numZones = 0; s.zoneActors = ['explicit-slot0'];
  assert.deepEqual(queryBspRegion(s, [-1, 0, 0], 'default').region, { zone: 'explicit-slot0', leaf: 17, zoneNumber: 0 });
  s.zoneActors = []; assert.equal(prepareBspRegion(s).status, 'unsupported');
});
test('empty tree returns caller default without reading a zone slot', () => {
  assert.deepEqual(queryBspRegion({ nodes: [], rootOutside: 0, numZones: 0, zoneActors: [] }, [1, 2, 3], 'default'),
    { status: 'ready', region: { zone: 'default', leaf: -1, zoneNumber: 0 }, visited: [] });
});
test('CSG/outside bookkeeping does not replace the PointRegion leaf decision', () => {
  for (const rootOutside of [0, 1]) for (const flags of [0, 1, 0x20, 0xff]) for (const numVertices of [0, 3]) {
    const s = source([node({ flags, numVertices })]); s.rootOutside = rootOutside;
    assert.equal(queryBspRegion(s, [-1, 0, 0], 'default').region.zone, 'back');
  }
});
test('snapshot owns numeric arrays and preserves opaque actor identity', () => {
  const actor = {}; const s = source([node()]); s.zoneActors[2] = actor;
  const p = prepareBspRegion(s); s.nodes[0].plane[3] = 100; s.zoneActors[2] = 'replacement';
  assert.equal(queryBspRegion(p.model, [1, 0, 0], 'default').region.zone, actor);
  assert.equal(prepareBspRegion(p.model).model, p.model);
});
test('all cycles reject, while shared children are permitted', () => {
  const s = source([node({ front: 1, back: 1 }), node()]);
  assert.equal(prepareBspRegion(s).status, 'ready');
  s.nodes.push(node({ front: 2 })); assert.equal(prepareBspRegion(s).status, 'unsupported');
});
test('sparse, nonstored or invalid source fields remain unsupported', () => {
  for (const mutate of [s => { delete s.nodes[0]; }, s => { delete s.nodes[0].plane[0]; },
    s => { delete s.zoneActors[1]; }, s => { s.nodes[0].zones[1] = 3; },
    s => { s.nodes[0].front = 9; }, s => { s.nodes[0].plane[0] = 1 / 3; },
    s => { s.nodes[0].leaves[0] = -2; }, s => { delete s.rootOutside; },
    s => { delete s.nodes[0].flags; }]) {
    const s = source([node()]); mutate(s); assert.equal(prepareBspRegion(s).status, 'unsupported');
  }
});
test('missing caller default and overflowing finite arithmetic stay unsupported', () => {
  assert.equal(queryBspRegion(source([node()]), [0, 0, 0], null).status, 'unsupported');
  const s = source([node({ plane: [Math.fround(3e38), 0, 0, 0] })]);
  assert.equal(queryBspRegion(s, [2, 0, 0], 'default').status, 'unsupported');
});
