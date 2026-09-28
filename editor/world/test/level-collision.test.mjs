import test from 'node:test';
import assert from 'node:assert/strict';
import {orderLevelHits, shortenLevelTrace, selectSingleLevelHit} from '../js/level-collision.js';

// Authored synthetic records. Original-binary differentials are a separate
// private-input command; these checks make no claim about actual map geometry.
const level = (identity, flags = 0) => ({identity,
  model: {nodes: [{surface: 0}], surfaces: [{flags}]}});
const hit = (actor, fields = {}) => ({actor, time: .5, nodeIndex: 0, ...fields});
const select = fields => selectSingleLevelHit({hits: [], flags: 0x400,
  currentLevel: level('main'), adjacentLevels: [], ...fields});

test('sort preserves records and input array while ordering finite source times', () => {
  const input = [{id: 'late', time: .9}, {id: 'early', time: .1}, {id: 'middle', time: .5}];
  const result = orderLevelHits(input);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.hits.map(x => x.id), ['early', 'middle', 'late']);
  assert.equal(result.hits[0], input[1]);
  assert.deepEqual(input.map(x => x.id), ['late', 'early', 'middle']);
});

test('source short-sort tie order changes at the partition threshold', () => {
  for (const [count, expected] of [[2, [1, 0]], [8, [1, 2, 3, 4, 5, 6, 7, 0]],
    [9, [0, 1, 2, 3, 4, 5, 6, 7, 8]]]) {
    const result = orderLevelHits(Array.from({length: count}, (_, id) => ({id, time: 1})));
    assert.deepEqual(result.hits.map(x => x.id), expected);
  }
});

test('sort rejects missing records, invalid times and overflow of native result capacity', () => {
  for (const input of [null, [null], new Array(2), [{time: NaN}], [{time: Infinity}],
    [{time: '1'}], [{time: 1e40}], Array.from({length: 65}, () => ({time: .5}))]) {
    assert.equal(orderLevelHits(input).status, 'unsupported');
  }
  assert.deepEqual(orderLevelHits([]), {status: 'ready', hits: []});
});

test('source BSP and terrain shortening retain distinct forward allowances', () => {
  const query = {start: [0, 0, 0], originalEnd: [100, 0, 0],
    hit: {point: [50, 0, 0], time: .5}, scale: 1};
  const bsp = shortenLevelTrace({...query, kind: 'bsp'});
  const terrain = shortenLevelTrace({...query, kind: 'terrain'});
  assert.equal(bsp.time, .5);
  assert.equal(bsp.scale, 0.5499988794326782);
  assert.equal(bsp.end[0], 54.9998893737793);
  assert.equal(terrain.scale, 0.6999986171722412);
  assert.equal(terrain.end[0], 69.99986267089844);
  assert.deepEqual(query.hit.point, [50, 0, 0]);
});

test('shortened primitive time maps to the original segment and preserves signed zero', () => {
  const result = shortenLevelTrace({start: [0, 0, 0], originalEnd: [100, 0, 0],
    hit: {point: [25, 0, 0], time: .5}, scale: .5, kind: 'bsp'});
  assert.equal(result.time, .25);
  const zero = shortenLevelTrace({start: [0, -0, 0], originalEnd: [0, 0, 0],
    hit: {point: [0, 0, -0], time: -0}, scale: 1, kind: 'terrain'});
  assert.equal(zero.status, 'ready');
  assert.ok(Object.is(zero.time, -0));
  assert.ok(Object.is(zero.scale, -0));
});

test('shortening never substitutes missing vectors or unsupported participant kinds', () => {
  const query = {start: [0, 0, 0], originalEnd: [1, 1, 1],
    hit: {point: [0, 0, 0], time: .5}, scale: 1, kind: 'bsp'};
  for (const change of [{start: [, 0, 0]}, {hit: null}, {scale: NaN}, {kind: 'actor'},
    {originalEnd: [Infinity, 0, 0]}]) {
    assert.equal(shortenLevelTrace({...query, ...change}).status, 'unsupported');
  }
});

test('ordinary single result passes through the source record unchanged', () => {
  const source = hit('pawn', {material: null});
  const result = select({hits: [source]});
  assert.equal(result.blocked, true);
  assert.equal(result.hit, source);
  assert.equal(Object.hasOwn(result.hit, 'normal'), false);
});

test('single miss describes only the two original record writes', () => {
  assert.deepEqual(select({}), {status: 'ready', blocked: false, hit: null,
    writes: {actor: null, time: 1}});
});

test('flag100 filters a current or attached BSP surface carrying bit80', () => {
  const next = hit('pawn', {actorFlags2e4: 2});
  assert.equal(select({flags: 0x500, currentLevel: level('main', 0x80),
    hits: [hit('main'), next]}).hit, next);
  assert.equal(select({flags: 0x500, adjacentLevels: [level('other', 0x80)],
    hits: [hit('other'), next]}).hit, next);
  assert.equal(select({flags: 0x400, currentLevel: level('main', 0x80),
    hits: [hit('main')]}).blocked, true);
});

test('raw actor bit filtering remains inside the attached-level loop', () => {
  const source = hit('pawn', {actorFlags2e4: 0});
  assert.equal(select({flags: 0x500, hits: [source]}).blocked, true);
  assert.equal(select({flags: 0x500, hits: [source],
    adjacentLevels: [level('other')]}).blocked, false);
  assert.equal(select({flags: 0x500, hits: [hit('other', {actorFlags2e4: 0})],
    adjacentLevels: [level('other')]}).blocked, true);
  assert.equal(select({flags: 0x500, hits: [hit('other', {actorFlags2e4: 0})],
    adjacentLevels: [level('other'), level('third')]}).blocked, false);
});

test('missing source fields stay unsupported only when their branch needs them', () => {
  const source = hit('pawn');
  assert.equal(select({flags: 0x500, hits: [source]}).status, 'ready');
  assert.equal(select({flags: 0x500, hits: [source], adjacentLevels: [level('other')]}).status, 'unsupported');
  assert.equal(select({flags: 0x500, hits: [hit('main', {nodeIndex: -1})]}).status, 'unsupported');
  assert.equal(select({flags: 0x400, hits: [hit('main', {nodeIndex: -1})]}).status, 'ready');
  for (const change of [{flags: 0}, {hits: new Array(1)}, {adjacentLevels: new Array(1)}]) {
    assert.equal(select(change).status, 'unsupported');
  }
});
