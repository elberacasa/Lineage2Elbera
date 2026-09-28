// Synthetic primitive operands. The original instruction/module comparison is
// tools/ui/check_cylinder_collision_native.py; these are portable regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceActorCylinder, createActorHashResult } from '../js/cylinder-collision.js';

function fixture(start = [-20, 0, 0], end = [20, 0, 0]) {
  return {start, end, extent: [0, 0, 0],
    actor: {identity: {id: 42}, location: [0, 0, 0], collisionRadius: 5, collisionHeight: 10, skins: []},
    initialResult: {normal: [11, 12, 13], point: [77, 77, 77], actor: 77, item: 77,
      material: {retained: true}, time: 77, nodeIndex: 88}};
}
const trace = f => {const r = traceActorCylinder(f); assert.equal(r.status, 'ready'); return r;};

test('actor-hash constructor is explicit and independent from partially initialized caller records', () => {
  const a = createActorHashResult(), b = createActorHashResult();
  assert.deepEqual(a, {next: null, actor: null, point: [0, 0, 0], normal: [0, 0, 0],
    time: 0, item: 0, nodeIndex: -1, material: null});
  a.normal[0] = 12; a.point[0] = 13;
  assert.deepEqual(b.normal, [0, 0, 0]); assert.deepEqual(b.point, [0, 0, 0]);
  const input = fixture([5, 0, 10], [5, 0, 10]); input.initialResult = b;
  const r = trace(input);
  assert.equal(r.hit, true); assert.deepEqual(r.result.normal, [0, 0, 0]);
  assert.equal(r.result.nodeIndex, -1); assert.equal(r.result.next, null);
});

test('radial hit retains material and opaque result fields, with source time bias', () => {
  const input = fixture(), {hit, result} = trace(input);
  assert.equal(hit, true);
  assert.equal(result.time, Math.fround(.375 - Math.fround(.001)));
  assert.deepEqual(result.normal, [-1, 0, 0]);
  assert.deepEqual(result.point, [Math.fround(-20 + Math.fround(40 * result.time)), 0, 0]);
  assert.equal(result.actor, input.actor.identity);
  assert.equal(result.item, 0);
  assert.equal(result.material, input.initialResult.material);
  assert.equal(result.nodeIndex, 88);
});

test('inside requires inward approach and selects only the first material reference', () => {
  const input = fixture([2, 0, -2], [1, 0, -2]);
  const material = {exact: 9}; input.actor.skins = [material, {unused: 10}];
  const r = trace(input);
  assert.equal(r.hit, true); assert.equal(r.result.time, 0);
  assert.deepEqual(r.result.point, input.start);
  assert.equal(r.result.material, material);
  assert.ok(Object.is(r.result.normal[2], -0));
  input.actor.skins = [];
  assert.equal(trace(input).result.material, null);
  input.end = [3, 0, -2]; assert.equal(trace(input).hit, false);
  input.end = [2, 0, -2]; assert.equal(trace(input).hit, false);
});

test('inside approach strict threshold is not an arbitrary start-inside hit', () => {
  const input = fixture([1, 0, 0], [Math.fround(.95), 0, 0]);
  assert.equal(trace(input).hit, false);
  input.end = [.5, 0, 0]; assert.equal(trace(input).hit, true);
});

test('cap hit has cap normal; broad bounds do not replace cylinder radial test', () => {
  const input = fixture([0, 0, 20], [0, 0, -20]);
  const r = trace(input);
  assert.equal(r.hit, true); assert.deepEqual(r.result.normal, [0, 0, 1]);
  assert.equal(r.result.time, Math.fround(.25 - Math.fround(.001)));
  assert.equal(trace(fixture([4, 4, 0], [4, 4, 1])).hit, false);
});

test('exact cap/radial touch can hit with caller normal unchanged', () => {
  for (const end of [[5, 0, 10], [4, 0, 9]]) {
    const input = fixture([5, 0, 10], end), r = trace(input);
    assert.equal(r.hit, true); assert.equal(r.result.time, 0);
    assert.deepEqual(r.result.normal, [11, 12, 13]);
    assert.deepEqual(r.result.point, input.start);
  }
});

test('a touching hit does not invent an initially unknown normal', () => {
  const input = fixture([5, 0, 10], [5, 0, 10]); input.initialResult = {material: null};
  const r = trace(input);
  assert.equal(r.hit, true);
  assert.equal(Object.hasOwn(r.result, 'normal'), false);
  assert.equal(Object.hasOwn(r.result, 'nodeIndex'), false);
  assert.equal(r.result.material, null);
});

test('miss can change clipping normal but must retain actor, point and material', () => {
  const input = fixture([0, 0, 20], [20, 0, 0]), r = trace(input);
  assert.equal(r.hit, false); assert.equal(r.result.time, 1);
  assert.deepEqual(r.result.normal, [0, 0, 1]);
  assert.equal(r.result.actor, 77); assert.equal(r.result.item, 77);
  assert.deepEqual(r.result.point, [77, 77, 77]);
  assert.equal(r.result.material, input.initialResult.material);
});

test('expanded Y bounds do not silently replace the native expanded X radius', () => {
  const input = fixture([0, 7, 0], [0, 7, 1]); input.extent = [1, 3, 2];
  assert.equal(trace(input).hit, false); // Within Y bound 8, outside radius 6.
  input.extent = [3, 1, 2];
  assert.equal(trace(input).hit, false); // Outside Y bound 6, even though radius 8.
  input.start = [0, 5, 0]; input.end = [0, 4, 0];
  assert.equal(trace(input).hit, true);
});

test('actor Location is the supplied cylinder center, with no feet conversion', () => {
  const input = fixture([0, 0, 115], [0, 0, 85]); input.actor.location = [0, 0, 100];
  const r = trace(input);
  assert.equal(r.hit, true); assert.ok(r.result.point[2] > 110);
  assert.ok(r.result.point[2] < 111);
});

test('result vectors are owned; caller inputs and identity references are not modified', () => {
  const input = fixture([5, 0, 10], [5, 0, 10]), before = structuredClone(input), r = trace(input);
  assert.deepEqual(input, before);
  r.result.normal[0] = -99; r.result.point[0] = -99;
  assert.deepEqual(input, before);
});

test('null actor initializes only Time, without requiring unused geometry', () => {
  const r = trace({actor: null, initialResult: {material: null, actor: 81}});
  assert.equal(r.hit, false); assert.deepEqual(r.result, {material: null, actor: 81, time: 1});
});

test('missing inputs, holes, negative extent and nonfinite derived geometry fail closed', () => {
  for (const mutate of [x => {delete x.actor;}, x => {delete x.initialResult;},
    x => {x.initialResult.normal = [1, 2];}, x => {x.actor.skins = new Array(1);},
    x => {x.actor.skins = [undefined];}, x => {x.start = [0, NaN, 0];},
    x => {x.end = [Infinity, 0, 0];}, x => {x.extent[0] = -1;},
    x => {x.actor.collisionRadius = '5';}, x => {x.actor.location = new Array(3);},
    x => {x.actor.collisionRadius = 3e38; x.extent = [3e38, 0, 0];}]) {
    const input = fixture(); mutate(input);
    assert.equal(traceActorCylinder(input).status, 'unsupported');
  }
});
