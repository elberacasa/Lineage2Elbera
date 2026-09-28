import test from 'node:test';
import assert from 'node:assert/strict';
import {collectLevelHits} from '../js/level-query.js';
const f = Math.fround;
const query = (extra) => ({
  start: [0, 0, 0],
  end: [100, 0, 0],
  extent: [1, 2, 3],
  flags: 0,
  sourceActor: null,
  level: {identity: 'current', model: 'world', actorHash: null, zones: Array(64).fill(null)},
  callerLevel: null,
  attachedLevelsEnabled: false,
  attachedLevels: [],
  primitives: {},
  ...extra
});
const hit = (time = 0.5, more = {}) => ({
  status: 'ready',
  blocked: true,
  writes: {point: [50, 0, 0], time, normal: [1, 0, 0], ...more}
});
const miss = (writes) => ({status: 'ready', blocked: false, writes});
const zone = (terrains, identity = 'zone') => ({identity, flags3d8: 4, terrains});
function terrainQuery(terrains, primitive, extra = {}) {
  const q = query({flags: 4, ...extra});
  q.level.zones[0] = zone(terrains);
  q.primitives = {
    terrain: primitive,
    region: () => ({status: 'ready', zone: 'zone'}),
    ...q.primitives
  };
  return q;
}

test('no selected phases need no fabricated primitive or region result', () => {
  const r = collectLevelHits(query());
  assert.equal(r.status, 'ready');
  assert.deepEqual(r.hits, []);
  assert.equal(r.scale, 1);
});
test('caller model and current region model are independent; attached null model is skipped', () => {
  const calls = [];
  const q = terrainQuery(
    ['terrain'],
    (r) => {
      calls.push(['terrain', r]);
      return hit();
    },
    {
      callerLevel: {identity: 'caller', model: 'caller-model'},
      attachedLevelsEnabled: true,
      attachedLevels: [null, {identity: 'a', model: null}, {identity: 'b', model: 'b-model'}],
      primitives: {
        bsp: (r) => {
          calls.push(['bsp', r]);
          return miss({time: 2});
        },
        region: (r) => {
          calls.push(['region', r]);
          return {status: 'ready', zone: 'zone'};
        }
      }
    }
  );
  const r = collectLevelHits(q);
  assert.equal(r.status, 'ready');
  assert.deepEqual(
    calls.map((x) => [x[0], x[1].participant ?? x[1].model]),
    [
      ['bsp', 'caller-model'],
      ['bsp', 'b-model'],
      ['terrain', 'terrain'],
      ['region', 'world']
    ]
  );
  assert.equal(calls[2][1].initialResult.time, 2);
  assert.equal(calls[3][1].defaultZone, 'current');
});
test('scratch begins material-only and retains rejected BSP writes before accepted terrain', () => {
  const q = terrainQuery(
    ['terrain'],
    (r) => {
      assert.deepEqual(r.initialResult, {
        material: null,
        time: 1,
        item: 'original-model',
        nodeIndex: 8,
        actor: null
      });
      return hit(0.5);
    },
    {
      callerLevel: {identity: 'caller', model: 'caller-model'},
      primitives: {
        bsp: (r) => {
          assert.deepEqual(r.initialResult, {material: null});
          return miss({time: 1, item: 'original-model', nodeIndex: 8, actor: null});
        }
      }
    }
  );
  const r = collectLevelHits(q);
  assert.equal(r.hits[0].item, 'original-model');
  assert.equal(r.hits[0].nodeIndex, 8);
  assert.equal(r.hits[0].actor, 'terrain');
});
test('region rejected terrain writes survive in slot but do not shorten next query', () => {
  const q = terrainQuery(['wrong', 'right'], (r) => {
    if (r.participant === 'wrong') return hit(0.25, {item: 7, nodeIndex: 19});
    assert.equal(r.initialResult.item, 7);
    assert.equal(r.initialResult.nodeIndex, 19);
    assert.deepEqual(r.end, [100, 0, 0]);
    return hit(0.5);
  });
  let i = 0;
  q.primitives.region = () => ({status: 'ready', zone: i++ ? 'zone' : 'foreign'});
  const r = collectLevelHits(q);
  assert.equal(r.status, 'ready');
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].actor, 'right');
  assert.equal(r.hits[0].item, 7);
});
test('null region equals explicit null caller LevelInfo in retained comparison', () => {
  const q = terrainQuery(['terrain'], () => hit());
  q.primitives.region = () => ({status: 'ready', zone: null});
  assert.equal(collectLevelHits(q).hits.length, 1);
});
test('0x200 finishes after whole BSP phase including attached models', () => {
  const calls = [];
  const q = query({
    flags: 0x205,
    callerLevel: {identity: 'caller', model: 'first'},
    attachedLevelsEnabled: true,
    attachedLevels: [{identity: 'second', model: 'second-model'}],
    primitives: {
      bsp: (r) => {
        calls.push(r.participant);
        return hit();
      }
    }
  });
  const r = collectLevelHits(q);
  assert.equal(r.status, 'ready');
  assert.equal(r.hits.length, 2);
  assert.deepEqual(calls, ['first', 'second-model']);
});
test('0x200 finishes after whole terrain phase and never asks for actor state', () => {
  const q = terrainQuery(['a', 'b'], () => hit(), {flags: 0x205});
  delete q.level.actorHash;
  const r = collectLevelHits(q);
  assert.equal(r.status, 'ready');
  assert.equal(r.hits.length, 2);
});
test('0x100 skips terrain but preserves ordinary BSP phase', () => {
  const q = query({
    flags: 0x104,
    callerLevel: {identity: 'caller', model: 'model'},
    primitives: {bsp: () => hit()}
  });
  delete q.level.zones;
  assert.equal(collectLevelHits(q).hits.length, 1);
});
test('all 64 resolved zones retain repeated identities and repeated terrain calls', () => {
  let n = 0;
  const q = terrainQuery(['a', 'a'], () => {
    n++;
    return miss({actor: null});
  });
  q.level.zones[63] = q.level.zones[0];
  const r = collectLevelHits(q);
  assert.equal(r.status, 'ready');
  assert.equal(n, 4);
});
test('world scratch overflow is unsupported at the next primitive access', () => {
  let n = 0;
  const q = terrainQuery(Array(65).fill('a'), () => {
    n++;
    return hit();
  });
  const r = collectLevelHits(q);
  assert.equal(r.status, 'unsupported');
  assert.match(r.reason, /capacity/);
  assert.equal(n, 64);
});
test('actor copying stops at 64 while later providers are still invoked', () => {
  const calls = [];
  const q = query({
    flags: 1,
    attachedLevelsEnabled: true,
    attachedLevels: [{identity: 'attached', actorHash: 'second'}],
    primitives: {
      actorHash: (r) => {
        calls.push(r);
        return {
          status: 'ready',
          hits: Array.from({length: 65}, (_, i) => ({actor: `actor${i}`, time: 0.5, item: i}))
        };
      }
    }
  });
  q.level.actorHash = 'first';
  const r = collectLevelHits(q);
  assert.equal(r.status, 'ready');
  assert.equal(r.hits.length, 64);
  assert.deepEqual(
    calls.map((x) => x.hash),
    ['first', 'second']
  );
  assert.ok(r.hits.every((x) => x.item < 64));
  assert.equal(calls[0].extra, 0);
  assert.equal(calls[0].sourceActor, null);
});
test('actor relative times use current scale but actor points remain unchanged', () => {
  const q = query({
    flags: 0x105,
    callerLevel: {identity: 'caller', model: 'model'},
    primitives: {
      bsp: () => hit(0.25),
      actorHash: (r) => {
        assert.notDeepEqual(r.end, q.end);
        return {status: 'ready', hits: [{actor: 'actor', time: 0.5, point: [1000, 2, 3]}]};
      }
    }
  });
  q.level.actorHash = 'hash';
  const r = collectLevelHits(q);
  const actor = r.hits.find((x) => x.actor === 'actor');
  assert.equal(actor.time, f(0.5 * r.scale));
  assert.deepEqual(actor.point, [1000, 2, 3]);
});
test('two equal actor records use original unstable sort and inputs remain unchanged', () => {
  const original = [
    {actor: 'a', time: 0.5},
    {actor: 'b', time: 0.5}
  ];
  const q = query({flags: 1, primitives: {actorHash: () => ({status: 'ready', hits: original})}});
  q.level.actorHash = 'hash';
  assert.deepEqual(
    collectLevelHits(q).hits.map((x) => x.actor),
    ['b', 'a']
  );
  assert.deepEqual(original, [
    {actor: 'a', time: 0.5},
    {actor: 'b', time: 0.5}
  ]);
});
test('unknown provider stays unsupported after an earlier known hit', () => {
  const q = query({
    flags: 0x105,
    callerLevel: {identity: 'caller', model: 'model'},
    primitives: {bsp: () => hit()}
  });
  q.level.actorHash = 'missing';
  assert.equal(collectLevelHits(q).status, 'unsupported');
});
test('missing zone/attached inputs and sparse records never become clear', () => {
  const q = query({flags: 4});
  q.level.zones.length = 63;
  assert.equal(collectLevelHits(q).status, 'unsupported');
  q.level.zones = Array(64);
  assert.equal(collectLevelHits(q).status, 'unsupported');
  assert.equal(
    collectLevelHits(query({attachedLevelsEnabled: true, attachedLevels: Array(1)})).status,
    'unsupported'
  );
});
test('source writes and accepted point/time must be explicit', () => {
  const q = query({
    flags: 0x104,
    callerLevel: {identity: 'caller', model: 'model'},
    primitives: {bsp: () => ({status: 'ready', blocked: false})}
  });
  assert.equal(collectLevelHits(q).status, 'unsupported');
  q.primitives.bsp = () => ({status: 'ready', blocked: true, writes: {time: 0}});
  assert.equal(collectLevelHits(q).status, 'unsupported');
});
