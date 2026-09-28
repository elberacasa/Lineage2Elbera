import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBspPrimary, traceBspPrimary, decodeBspLeafHull, clipBspSweepPlane,
  selectBspSweepBranches, collectBspSweepHulls, bspSweepBoundsPlanes,
  adoptBspSweepInterval, adjustBspSweepTime, selectBspSweepBevelAxes,
  bspSweepSegmentMetric, bspSweepBevelPlanes, prepareBspSweep, traceBspSweep } from '../js/bsp-collision.js';

const node = (overrides = {}) => ({ plane: [1, 0, 0, 0], back: -1, front: -1,
  numVertices: 4, flags: 0, ...overrides });
const model = (nodes = [node()], rootOutside = 1) => ({ nodes, rootOutside });

test('solid half-space returns its plane entry, independently of polygons/art', () => {
  const result = traceBspPrimary(model(), [10, 3, 7], [-10, 3, 7]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.hit, { point: [0, 3, 7], normal: [1, 0, 0], nodeIndex: 0 });
});

test('starting inside reports original start even when moving out', () => {
  assert.deepEqual(traceBspPrimary(model(), [-10, 0, 0], [10, 0, 0]).hit.point, [-10, 0, 0]);
});

test('both points in front miss and a zero-length solid segment hits', () => {
  assert.equal(traceBspPrimary(model(), [10, 0, 0], [20, 0, 0]).hit, null);
  assert.deepEqual(traceBspPrimary(model(), [-10, 2, 0], [-10, 2, 0]).hit.point, [-10, 2, 0]);
});

test('native node flags1/32 and zero vertex count do not define solid partitions', () => {
  for (const overrides of [{ flags: 1 }, { flags: 32 }, { numVertices: 0 }]) {
    assert.equal(traceBspPrimary(model([node(overrides)]), [10, 0, 0], [-10, 0, 0]).hit, null);
  }
  // A rendered visibility flag must not be invented here: raw node bit4 alone
  // does not disable this source predicate.
  assert.ok(traceBspPrimary(model([node({ flags: 4 })]), [10, 0, 0], [-10, 0, 0]).hit);
});

test('rootOutside is real data, not assumed true for empty-space leaves', () => {
  assert.ok(traceBspPrimary(model([node({ flags: 1 })], 0), [10, 0, 0], [20, 0, 0]).hit);
  assert.equal(traceBspPrimary(model([], 0), [10, 0, 0], [20, 0, 0]).reason,
    'empty-solid-model-without-hit-record');
  assert.equal(traceBspPrimary(model([], 1), [10, 0, 0], [20, 0, 0]).hit, null);
});

test('overlapping epsilon band takes the front branch first', () => {
  assert.equal(traceBspPrimary(model(), [-0.0005, 0, 0], [-0.0009, 0, 0]).hit, null);
  assert.ok(traceBspPrimary(model(), [0.0008, 0, 0], [-0.002, 0, 0]).hit);
  const epsilon = Math.fround(0.001);
  assert.ok(traceBspPrimary(model(), [-epsilon, 0, 0], [-epsilon, 0, 0]).hit);
});

test('near subtree wins before a farther solid partition', () => {
  const source = model([node({ front: 1 }), node({ plane: [1, 0, 0, 5] })]);
  const result = traceBspPrimary(source, [10, 0, 0], [-10, 0, 0]);
  assert.deepEqual(result.hit, { point: [5, 0, 0], normal: [1, 0, 0], nodeIndex: 1 });
});

test('coplanar zero points and opposite root orientation retain source normal', () => {
  assert.equal(traceBspPrimary(model(), [0, 0, 0], [0, 4, 0]).hit, null);
  const result = traceBspPrimary(model([node({ plane: [-1, 0, 0, 0] })]), [-10, 0, 0], [10, 0, 0]);
  assert.deepEqual(result.hit.normal, [-1, 0, 0]);
});

test('prepared snapshots cannot be changed by later input mutations', () => {
  const source = model();
  const prepared = prepareBspPrimary(source);
  source.nodes[0].flags = 1; source.nodes[0].plane[3] = 99;
  assert.ok(traceBspPrimary(prepared.model, [10, 0, 0], [-10, 0, 0]).hit);
  assert.ok(Object.isFrozen(prepared.model.nodes[0].plane));
});

test('all front/back graph cycles reject even when the ray cannot reach them', () => {
  for (const nodes of [[node({ front: 0 })], [node(), node({ back: 1 })],
    [node({ front: 1 }), node({ back: 0 })]]) {
    assert.equal(prepareBspPrimary(model(nodes)).reason, 'cyclic-source-tree');
  }
});

test('invalid links, incomplete fields and nonfinite source data are unsupported', () => {
  for (const source of [model([node({ back: 9 })]), model([node({ plane: [Infinity, 0, 0, 0] })]),
    model([node({ flags: undefined })]), model([node({ plane: [0, 0, 0, 0] })]), { nodes: [] }]) {
    assert.equal(traceBspPrimary(source, [0, 0, 0], [1, 0, 0]).status, 'unsupported');
  }
});

test('derived overflow and exhausted visit budgets never become a clear ray', () => {
  assert.equal(traceBspPrimary(model([node({ plane: [Math.fround(3e38), 0, 0, 0] })]),
    [10, 0, 0], [-10, 0, 0]).reason, 'nonfinite-plane-distance');
  assert.equal(traceBspPrimary(model([node({ front: 1 }), node()]),
    [1, 0, 0], [2, 0, 0], { maxVisits: 1 }).reason, 'visit-budget-exceeded');
});

test('deep original-size trees validate and traverse without recursive JS calls', () => {
  const nodes = Array.from({ length: 12000 }, (_, i) => node({ front: i === 11999 ? -1 : i + 1 }));
  const result = traceBspPrimary(model(nodes), [1, 0, 0], [2, 0, 0]);
  assert.equal(result.status, 'ready'); assert.equal(result.hit, null); assert.equal(result.visited, 12000);
});

const word = value => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true); return view.getInt32(0, true);
};
const bounds = [-10, -20, -30, 10, 20, 30].map(word);
const hullSource = words => ({ nodes: [node({ collisionBound: 0 }), node()], leafHulls: words });

test('leaf-hull words preserve raw references, original plane orientation and six float bounds', () => {
  const source = hullSource([0x40000001, 0, -1, ...bounds]);
  const result = decodeBspLeafHull(source, 0);
  assert.equal(result.scope, 'bsp-leaf-hull-record');
  assert.deepEqual(result.hull, { offset: 0, nextOffset: 9,
    planes: [{ nodeIndex: 1, requiresNativePlaneOperation: true, plane: [-1, -0, -0, -0] },
      { nodeIndex: 0, requiresNativePlaneOperation: false, plane: [1, 0, 0, 0] }],
    min: [-10, -20, -30], max: [10, 20, 30] });
  assert.notEqual(result.hull.planes[0].plane, source.nodes[1].plane);
  assert.equal(decodeBspLeafHull({ nodes: [node({ collisionBound: -1 })], leafHulls: [] }, 0).hull, null);
});

test('native hull flip negates W and signed zeros without mutating the source node', () => {
  const source=hullSource([0x40000001,1,-1,...bounds]);
  source.nodes[1].plane=[-0,1,0,-12];
  const result=decodeBspLeafHull(source,0);
  assert.deepEqual(result.hull.planes.map(p=>p.plane),[[0,-1,-0,12],[-0,1,0,-12]]);
  assert.deepEqual(source.nodes[1].plane,[-0,1,0,-12]);
  source.nodes[1].plane[3]=99;
  assert.equal(result.hull.planes[0].plane[3],12,'decoded planes are independent snapshots');
});

test('unusable original hull planes cannot become collision planes', () => {
  for(const plane of [undefined,[0,0,0,1],[1,0,0,NaN],[1,0,0,0.1]]){
    const source=hullSource([0x40000001,-1,...bounds]);source.nodes[1].plane=plane;
    assert.equal(decodeBspLeafHull(source,0).reason,'invalid-source-hull-plane');
  }
});

test('leaf framing rejects malformed boundaries and respects native 64-plane cap', () => {
  assert.equal(decodeBspLeafHull(hullSource([...Array(64).fill(0), -1, ...bounds]), 0).status, 'ready');
  const cases = [
    [[0], 'unterminated-hull'], [[0, -1, ...bounds.slice(1)], 'truncated-hull-bounds'],
    [[...Array(65).fill(0), -1, ...bounds], 'hull-exceeds-native-plane-cap'],
    [[2, -1, ...bounds], 'invalid-hull-plane-reference'],
    [[-0x80000000, -1, ...bounds], 'invalid-hull-plane-reference'],
    [[0.5, -1, ...bounds], 'invalid-hull-word'],
    [[-1, word(NaN), ...bounds.slice(1)], 'invalid-hull-bounds'],
    [[-1, word(11), ...bounds.slice(1)], 'invalid-hull-bounds'],
  ];
  for (const [words, reason] of cases) assert.equal(decodeBspLeafHull(hullSource(words), 0).reason, reason);
});

const sweep = changes => ({ plane: [0, 0, 1, 0], start: [0, 0, 10], end: [0, 0, -10],
  extent: [0.1, 0.1, 5], enter: -1, exit: 2, normal: [0, 0, 0], ...changes });

test('native plane slice uses the camera vertical extent for entry and exit', () => {
  const entering = clipBspSweepPlane(sweep());
  assert.equal(entering.scope, 'bsp-sweep-plane-interval');
  assert.equal(entering.enter, 0.25); assert.equal(entering.exit, 2);
  assert.equal(entering.radius, 5); assert.deepEqual(entering.normal, [0, 0, 1]);
  assert.equal(entering.continues, true); assert.equal(entering.hit, undefined);
  const leaving = clipBspSweepPlane(sweep({ start: [0, 0, -10], end: [0, 0, 10] }));
  assert.equal(leaving.enter, -1); assert.equal(leaving.exit, 0.75);
});

test('source close-start rule zeros inward entry only on positive side of plane', () => {
  assert.equal(clipBspSweepPlane(sweep({ start: [0, 0, 2] })).enter, 0);
  assert.equal(clipBspSweepPlane(sweep({ start: [0, 0, -2] })).enter, -0.875);
  assert.equal(clipBspSweepPlane(sweep({ start: [0, 0, 2], end: [0, 0, 10] })).exit, 0.375);
});

test('parallel and touching interval predicates retain native strictness', () => {
  assert.equal(clipBspSweepPlane(sweep({ start: [0, 0, 6], end: [1, 0, 6] })).continues, false);
  assert.equal(clipBspSweepPlane(sweep({ start: [0, 0, 5], end: [1, 0, 5] })).continues, true);
  assert.equal(clipBspSweepPlane(sweep({ exit: 0.25 })).continues, false);
  const tie = clipBspSweepPlane(sweep({ enter: 0.25, normal: [1, 0, 0] }));
  assert.deepEqual(tie.normal, [1, 0, 0], 'equal entry time retains previous plane normal');
  const eps = Math.fround(0.00001);
  const parallel = clipBspSweepPlane(sweep({ start: [0, 0, eps], end: [0, 0, 0], extent: [0, 0, 0] }));
  assert.equal(parallel.enter, -1, 'native threshold equality follows parallel branch');
});

test('incomplete and overflowing plane state remains unsupported', () => {
  assert.equal(clipBspSweepPlane().status, 'unsupported');
  assert.equal(clipBspSweepPlane(sweep({ normal: undefined })).reason, 'invalid-sweep-state');
  assert.equal(clipBspSweepPlane(sweep({ extent: [-1, 1, 1] })).reason, 'invalid-sweep-state');
  assert.equal(clipBspSweepPlane(sweep({ plane: [0, 0, Math.fround(3e38), 0] })).reason,
    'nonfinite-plane-arithmetic');
});

test('sweep branch selection uses inflated extent with inclusive overlap and direction order', () => {
  const radius = Math.fround(Math.fround(.1) * Math.fround(1.1));
  const base = { plane: [1, 0, 0, 0], start: [radius, 0, 0], end: [radius, 0, 0], extent: [.1, .1, 5] };
  const equal = selectBspSweepBranches(base);
  assert.equal(equal.radius, radius);
  assert.equal(equal.front, true); assert.equal(equal.back, true);
  assert.equal(equal.firstSide, 'front', 'equal signed distances use native front-first tie');
  assert.equal(selectBspSweepBranches({ ...base, start: [-radius, 0, 0], end: [-radius, 0, 0] }).front, true);
  assert.equal(selectBspSweepBranches({ ...base, start: [1, 0, 0], end: [2, 0, 0] }).back, false);
  assert.equal(selectBspSweepBranches({ ...base, start: [-1, 0, 0], end: [-2, 0, 0] }).front, false);
  assert.equal(selectBspSweepBranches({ ...base, start: [-10, 0, 0], end: [10, 0, 0] }).firstSide, 'back');
  assert.equal(selectBspSweepBranches(sweep()).radius, 5.5, 'native vertical admission differs from plane clipping radius5');
});

const sweepModel = (nodes, rootOutside = 1) => ({ ...model(nodes.map(n => node({ collisionBound: 0, ...n })), rootOutside), leafHulls: [0] });

test('sweep candidate traversal retains near-first hull order without claiming hits', () => {
  const source = sweepModel([{ front: 1 }, { plane: [1, 0, 0, 5] }]);
  const into = collectBspSweepHulls(source, [10, 0, 0], [-10, 0, 0], [.1, .1, 5]);
  assert.equal(into.scope, 'bsp-sweep-hull-candidates'); assert.equal(into.status, 'ready');
  assert.deepEqual(into.candidates.map(c => c.nodeIndex), [1, 0]);
  assert.equal(into.visited, 2); assert.equal(into.hit, undefined);
  assert.deepEqual(collectBspSweepHulls(source, [-10, 0, 0], [10, 0, 0], [.1, .1, 5])
    .candidates.map(c => c.nodeIndex), [0, 1]);
});

test('sweep candidates retain solid/outside rules and repeated leaf hulls', () => {
  for (const n of [{ flags: 1 }, { flags: 32 }, { numVertices: 0 }, { collisionBound: -1 }])
    assert.deepEqual(collectBspSweepHulls(sweepModel([n]), [10, 0, 0], [-10, 0, 0], [.1, .1, 5]).candidates, []);
  const repeated = collectBspSweepHulls(sweepModel([{ flags: 1 }], 0), [10, 0, 0], [-10, 0, 0], [.1, .1, 5]);
  assert.deepEqual(repeated.candidates, [{ nodeIndex: 0, collisionBound: 0 }, { nodeIndex: 0, collisionBound: 0 }]);
  const unresolved = sweepModel([{}]); unresolved.leafHulls = [0x40000000];
  assert.equal(collectBspSweepHulls(unresolved, [10, 0, 0], [-10, 0, 0], [.1, .1, 5]).candidates.length, 1,
    'candidate collection does not fabricate or consume flagged hull-plane orientation');
});

test('sweep candidates reject cycles, invalid offsets and budget exhaustion without partial result', () => {
  assert.equal(collectBspSweepHulls(sweepModel([{ front: 0 }]), [1, 0, 0], [2, 0, 0], [.1, .1, 5]).reason, 'cyclic-source-tree');
  assert.equal(collectBspSweepHulls(sweepModel([{ collisionBound: 1 }]), [1, 0, 0], [2, 0, 0], [.1, .1, 5]).reason, 'invalid-source-hull-offset');
  const source = sweepModel([{ front: 1 }, {}]);
  const stopped = collectBspSweepHulls(source, [-10, 0, 0], [10, 0, 0], [.1, .1, 5], { maxVisits: 1 });
  assert.equal(stopped.reason, 'visit-budget-exceeded'); assert.equal(stopped.candidates, undefined);
  assert.equal(collectBspSweepHulls(sweepModel([], 0), [1, 0, 0], [2, 0, 0], [.1, .1, 5]).status, 'unsupported');
  assert.deepEqual(collectBspSweepHulls(sweepModel([]), [1, 0, 0], [2, 0, 0], [.1, .1, 5]).candidates, []);
});

test('sweep candidates use explicit stacks for deep trees and reject overflow', () => {
  const source = sweepModel(Array.from({ length: 12000 }, (_, i) => ({ front: i === 11999 ? -1 : i + 1 })));
  const result = collectBspSweepHulls(source, [1, 0, 0], [2, 0, 0], [.1, .1, 5]);
  assert.equal(result.status, 'ready'); assert.equal(result.visited, 12000);
  assert.equal(selectBspSweepBranches(sweep({ extent: [0, 0, Number.MAX_VALUE] })).status, 'unsupported');
  assert.equal(selectBspSweepBranches(sweep({ plane: [0, 0, Math.fround(3e38), 0] })).reason, 'nonfinite-branch-arithmetic');
});

test('world bounds planes retain source order and asymmetric margins', () => {
  const result = bspSweepBoundsPlanes({ min: [-10, -20, -30], max: [10, 20, 30] });
  assert.equal(result.scope, 'bsp-sweep-bounds-planes');
  assert.deepEqual(result.planes, [[0, 0, -1, Math.fround(30.1)], [0, 0, 1, Math.fround(30.1)],
    [-1, 0, 0, Math.fround(10.1)], [1, 0, 0, Math.fround(9.9)],
    [0, -1, 0, Math.fround(20.1)], [0, 1, 0, Math.fround(19.9)]]);
  assert.equal(result.hit, undefined);
  for (const invalid of [{}, { min: [0, 0, 0], max: [-1, 0, 0] },
    { min: [0, 0, 0], max: [Infinity, 0, 0] }, { min: [.1, 0, 0], max: [1, 1, 1] }])
    assert.equal(bspSweepBoundsPlanes(invalid).status, 'unsupported');
});

test('final interval admission preserves negative entry and raw normal without claiming a world hit', () => {
  const normal = [2, -3, 0];
  const result = adoptBspSweepInterval({ enter: -.5, exit: .25, normal });
  assert.equal(result.scope, 'bsp-sweep-interval-adoption');
  assert.equal(result.adopted, true); assert.equal(result.time, -.5);
  assert.deepEqual(result.normal, normal); assert.notEqual(result.normal, normal);
  assert.equal(result.hit, undefined);
  assert.equal(adoptBspSweepInterval({ enter: 1.25, exit: 2, normal }).adopted, true,
    'this stage has no authored [0,1] time clamp');
});

test('final interval strict boundaries reject without emitting a candidate hit record', () => {
  for (const [enter, exit] of [[-1, 1], [-2, 1], [0, 0], [.5, .5], [.75, .5], [-.5, 0]]) {
    const result = adoptBspSweepInterval({ enter, exit, normal: [1, 0, 0] });
    assert.equal(result.adopted, false); assert.equal(result.time, undefined); assert.equal(result.normal, undefined);
  }
  assert.equal(adoptBspSweepInterval({ enter: .5, exit: 1 }).status, 'unsupported');
  assert.equal(adoptBspSweepInterval({ enter: .1, exit: 1, normal: [1, 0, 0] }).status, 'unsupported');
});

test('wrapper time adjustment uses supplied native metric and source two-stage clamp', () => {
  const short = adjustBspSweepTime({ time: .5, nativeMetric: .5 });
  assert.equal(short.scope, 'bsp-sweep-time-adjustment');
  assert.equal(short.backoff, Math.fround(Math.fround(.1) / .5));
  assert.equal(short.time, Math.fround(.5 - short.backoff));
  const long = adjustBspSweepTime({ time: .5, nativeMetric: 100 });
  assert.equal(long.backoff, Math.fround(.04));
  assert.equal(adjustBspSweepTime({ time: -.5, nativeMetric: 10 }).time, 0);
  assert.equal(adjustBspSweepTime({ time: 2, nativeMetric: 10 }).time, 1);
  assert.equal(long.hit, undefined);
});

test('invalid metric refuses a hit while zero and tiny source lengths retain native clamps', () => {
  for (const nativeMetric of [undefined, -0, -1, Infinity, .1])
    assert.equal(adjustBspSweepTime({ time: .5, nativeMetric }).status, 'unsupported');
  for (const nativeMetric of [0, Math.fround(1e-45)]) {
    const adjusted = adjustBspSweepTime({ time: .5, nativeMetric });
    assert.equal(adjusted.status, 'ready');
    assert.equal(adjusted.backoff, Infinity);
    assert.equal(adjusted.time, 0);
  }
});

test('bevel admission needs opposite axis signs and positive projected alignment', () => {
  const pair = { planeA: [1, 1, 0, 17], planeB: [-1, 1, 0, -99] };
  const result = selectBspSweepBevelAxes(pair);
  assert.equal(result.status, 'ready'); assert.equal(result.scope, 'bsp-sweep-bevel-axis-selection');
  assert.equal(result.maskA, 10); assert.equal(result.maskB, 9);
  assert.deepEqual(result.axes, ['x']); assert.deepEqual(result.projectedDots, [1, null, null]);
  assert.equal(result.hit, undefined); assert.equal(result.planes, undefined);
  assert.deepEqual(selectBspSweepBevelAxes({ planeA: [1, 1, 0, 0], planeB: [1, 1, 0, 0] }).axes, [],
    'aligned projections alone do not admit a bevel without opposite axis signs');
  assert.deepEqual(selectBspSweepBevelAxes({ planeA: [1, 1, 0, 0], planeB: [-1, -1, 0, 0] }).axes, [],
    'opposite signs alone do not admit a bevel with opposed projections');
  assert.deepEqual(selectBspSweepBevelAxes({ planeA: [1, 0, -0, 0], planeB: [-1, -0, 0, 0] }).axes, [],
    'axis-aligned opposite planes have zero projected dot; signed zero contributes no mask');
});

test('bevel threshold is strict after native Float32 dot store on every axis', () => {
  const threshold = Math.fround(.001), bytes = new DataView(new ArrayBuffer(4));
  bytes.setFloat32(0, threshold); const bits = bytes.getUint32(0);
  for (let axis = 0; axis < 3; axis++) {
    for (const step of [-1, 0, 1]) {
      bytes.setUint32(0, bits + step);
      const a = [0, 0, 0, 0], b = [0, 0, 0, 0];
      a[axis] = 1; b[axis] = -1;
      a[(axis + 1) % 3] = 1; b[(axis + 1) % 3] = bytes.getFloat32(0);
      const result = selectBspSweepBevelAxes({ planeA: a, planeB: b });
      assert.deepEqual(result.axes, step === 1 ? [['x', 'y', 'z'][axis]] : []);
    }
  }
});

test('bevel selection retains axis order and ignores plane W without mutating source planes', () => {
  const pair = { planeA: [1, 1, 3, 7], planeB: [-1, -1, 3, -8] };
  const before = structuredClone(pair), result = selectBspSweepBevelAxes(pair);
  assert.deepEqual(result.axes, ['x', 'y']); assert.deepEqual(result.projectedDots, [8, 8, null]);
  assert.deepEqual(pair, before);
  const changedW = selectBspSweepBevelAxes({ planeA: [1, 1, 3, -10000], planeB: [-1, -1, 3, 10000] });
  assert.deepEqual(changedW, result, 'this admission slice uses normals, not intersection-point reconstruction');
});

test('bevel admission refuses unresolved references, non-Float32 planes and derived overflow', () => {
  for (const planeA of [undefined, { nodeIndex: 0, requiresNativePlaneOperation: true },
    [0, 0, 0, 0], [.1, 1, 0, 0], [1, 1, Infinity, 0]])
    assert.equal(selectBspSweepBevelAxes({ planeA, planeB: [-1, 1, 0, 0] }).reason, 'invalid-oriented-plane');
  const large = Math.fround(3e38);
  assert.equal(selectBspSweepBevelAxes({ planeA: [1, large, 0, 0], planeB: [-1, large, 0, 0] }).reason,
    'nonfinite-bevel-dot');
});

test('source segment metric retains stored subtraction and square-root return', () => {
  assert.equal(bspSweepSegmentMetric([0, 0, 0], [3, 4, 0]).metric, 5);
  const tiny = Math.fround(1e-40);
  assert.equal(bspSweepSegmentMetric([0, 0, 0], [tiny, 0, 0]).metric, tiny,
    'the squared sum is not rounded to Float32 before sqrt');
  const stored = bspSweepSegmentMetric([16777216, 0, 0], [16777217, 0, 0]);
  assert.deepEqual(stored.delta, [0, 0, 0], 'source endpoints are stored Float32');
  assert.equal(stored.metric, 0);
  assert.equal(bspSweepSegmentMetric([-3e38, 0, 0], [3e38, 0, 0]).status, 'unsupported');
});

test('bevel construction retains source pair order and fails explicitly on degenerate admitted pairs', () => {
  const result = bspSweepBevelPlanes([[1, 1, 3, 7], [-1, -1, 3, -8], [1, -1, 3, 2]]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.bevels.map(b => [b.pair, b.axis]),
    [[[1, 0], 'x'], [[1, 0], 'y'], [[2, 0], 'y'], [[2, 1], 'x']]);
  const small = Math.fround(.0001);
  assert.equal(bspSweepBevelPlanes([[small, 1, 0, 1], [-small, 1, 0, 1]]).reason,
    'degenerate-bevel-intersection');
  assert.equal(bspSweepBevelPlanes([[1, 0, 0, NaN]]).reason, 'invalid-oriented-planes');
});

// Synthetic geometry, not a sample of official game values. The production
// native checker separately interprets original instructions against runtime.
const box = () => ({ rootOutside: 1,
  nodes: [[1, 0, 0, 10], [-1, 0, 0, 10], [0, 1, 0, 10], [0, -1, 0, 10],
    [0, 0, 1, 10], [0, 0, -1, 10]].map(plane => node({ plane, collisionBound: 0 })),
  leafHulls: [0, 1, 2, 3, 4, 5, -1, ...[-10, -10, -10, 10, 10, 10].map(word)] });

test('complete extent sweep clips hull plus bounds, adjusts time, and retains the entry normal', () => {
  const result = traceBspSweep(box(), [20, 0, 0], [0, 0, 0], [1, 1, 1]);
  assert.equal(result.status, 'ready'); assert.equal(result.blocked, true);
  assert.deepEqual(result.hit.normal, [1, 0, 0]);
  assert.ok(result.hit.rawTime > .45 && result.hit.rawTime < .46,
    'the asymmetric native X bound is stricter than the saved plane');
  assert.ok(result.hit.time < result.hit.rawTime);
  assert.ok(result.hit.point[0] > 10.9);
  assert.equal(result.clippedPlanes, 12);
  assert.equal(result.hit.nodeIndex, undefined, 'the wrapper does not assign a hit node index');
});

test('complete extent sweep distinguishes stationary containment, misses and unsupported data', () => {
  for (const [start, end] of [[[20, 0, 0], [30, 0, 0]], [[0, 0, 0], [0, 0, 0]],
    [[20, 30, 0], [0, 30, 0]]]) {
    const result = traceBspSweep(box(), start, end, [1, 1, 1]);
    assert.equal(result.status, 'ready'); assert.equal(result.blocked, false);
    assert.equal(result.hit, null);
  }
  assert.equal(traceBspSweep(box(), [20, 0, 0], [0, 0, 0], [0, 0, 0]).reason,
    'invalid-nonzero-extent-sweep');
  const broken = box(); broken.leafHulls.pop();
  assert.equal(traceBspSweep(broken, [20, 0, 0], [0, 0, 0], [1, 1, 1]).reason,
    'truncated-hull-bounds');
});

test('wrapper can retain a hit record at time one while returning clear', () => {
  const end = [91, 0, 0];
  const result = traceBspSweep(box(), [100, 0, 0], end, [80, 1, 1]);
  assert.equal(result.status, 'ready');
  assert.equal(result.blocked, false);
  assert.equal(result.hit.time, 1);
  assert.ok(result.hit.rawTime > 1);
  assert.deepEqual(result.hit.point, end);
});

test('prepared extent model snapshots planes, references and bounds independently of source mutation', () => {
  const source = box(), snapshot = prepareBspSweep(source);
  const before = traceBspSweep(snapshot.model, [20, 0, 0], [0, 0, 0], [1, 1, 1]);
  source.nodes[0].plane[3] = 100; source.nodes[0].collisionBound = -1;
  source.leafHulls[0] = 99; source.leafHulls[7] = word(100);
  assert.deepEqual(traceBspSweep(snapshot.model, [20, 0, 0], [0, 0, 0], [1, 1, 1]), before);
  assert.ok(Object.isFrozen(snapshot.model.nodes[0].plane));
  assert.ok(Object.isFrozen(snapshot.model.leafHulls));
  assert.equal(prepareBspSweep(snapshot.model).model, snapshot.model);
});

test('flagged references produce the same full sweep as explicitly oriented source planes', () => {
  const source = box(), flagged = box();
  flagged.nodes[1].plane = [1, -0, -0, -10];
  flagged.leafHulls[1] = 0x40000001;
  assert.deepEqual(traceBspSweep(flagged, [-20, 0, 0], [0, 0, 0], [1, 1, 1]),
    traceBspSweep(source, [-20, 0, 0], [0, 0, 0], [1, 1, 1]));
});


test('sparse reusable API inputs stay unknown instead of becoming empty geometry or clear sweeps', () => {
  for (const planes of [Array(1), [[1, , , 0]]])
    assert.equal(bspSweepBevelPlanes(planes).reason, 'invalid-oriented-planes');
  assert.equal(prepareBspPrimary(model([node({ plane: [1, , , 0] })])).status, 'unsupported');
  assert.equal(traceBspSweep({ rootOutside: 1, nodes: [], leafHulls: [] },
    Array(3), [1, 2, 3], [1, 1, 1]).status, 'unsupported');
  assert.equal(bspSweepBoundsPlanes({ min: Array(3), max: [1, 1, 1] }).status, 'unsupported');
});
