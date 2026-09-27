import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { intersectPawnCylinder, pickPawn, PICK_EXTENT, PICK_TIME_BIAS } from '../js/picking.js';

const p = (x, y, z) => ({ x, y, z });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6,
  `${actual} != ${expected}`);
const pawn = (id, x, extra = {}) => ({ id, center: p(x, 0, 20),
  collisionRadius: 10, collisionHeight: 20, ...extra });

test('side and cap hits use radius and half-height, including source expansion', () => {
  const side = intersectPawnCylinder(p(0, 0, 20), p(1, 0, 0), p(100, 0, 20), 10, 20);
  near(side.surfaceDistance, 90 - PICK_EXTENT);
  near(side.distance, 90 - PICK_EXTENT - 10000 * PICK_TIME_BIAS);
  const cap = intersectPawnCylinder(p(100, 0, 100), p(0, 0, -1), p(100, 0, 20), 10, 20);
  near(cap.surfaceDistance, 60 - PICK_EXTENT);
  assert.equal(intersectPawnCylinder(p(0, 0, 40.2), p(1, 0, 0), p(100, 0, 20), 10, 20), null);
});

test('a nearby ground ray outside the cylinder stays a ground click', () => {
  const hit = pickPawn(p(0, 10.2, 20), p(1, 0, -0.01), [pawn(1, 100)], { worldDistance: 500 });
  assert.equal(hit, null, 'closeness in screen pixels cannot create a cylinder hit');
});

test('world geometry occludes actors even when native entry bias would move them forward', () => {
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [pawn(1, 100)], { worldDistance: 85 }), null);
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [pawn(1, 100)], { worldDistance: 90 }).id, 1);
});

test('nearest hit is independent of entity insertion order and excludes self/resources', () => {
  const hits = [pawn(3, 300), pawn(2, 200), pawn(1, 100)];
  for (const list of [hits, [...hits].reverse()]) {
    assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), list).id, 1);
    assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), list, { selfId: 1 }).id, 2);
  }
  hits[2].loading = true;
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), hits).id, 2);
});

test('normal trace excludes corpses; Shift includes them and starts 30 units forward', () => {
  const body = pawn(1, 100, { dead: true });
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [body]), null);
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [body], { shift: true }).id, 1);
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [pawn(2, 10)], { shift: true }), null);
});

test('original range, invalid dimensions, behind-camera and parallel misses', () => {
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [pawn(1, 10011)]), null);
  assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [pawn(1, -100)]), null);
  for (const value of [undefined, null, NaN, Infinity, 1e100, -1, 0]) {
    assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [pawn(1, 100, { collisionRadius: value })]), null);
    assert.equal(pickPawn(p(0, 0, 20), p(1, 0, 0), [pawn(1, 100, { collisionHeight: value })]), null);
  }
  assert.equal(intersectPawnCylinder(p(11, 0, 100), p(0, 0, -1), p(0, 0, 20), 10, 20), null);
});

test('starting inside blocks radial inward travel but permits moving outward', () => {
  const center = p(0, 0, 20), origin = p(5, 0, 20);
  assert.equal(intersectPawnCylinder(origin, p(1, 0, 0), center, 10, 20), null);
  assert.equal(intersectPawnCylinder(origin, p(-1, 0, 0), center, 10, 20).distance, 0);
  assert.equal(intersectPawnCylinder(origin, p(0, 0, 1), center, 10, 20), null);
});

test('sloped side hit agrees with independently substituted cylinder equation', () => {
  const origin = p(-100, -50, 70), direction = p(2, 1, -1), center = p(0, 0, 20);
  const hit = intersectPawnCylinder(origin, direction, center, 15, 40);
  assert.ok(hit);
  const norm = Math.hypot(2, 1, -1);
  const x = origin.x + hit.surfaceDistance * 2 / norm;
  const y = origin.y + hit.surfaceDistance / norm;
  const z = origin.z - hit.surfaceDistance / norm;
  near(x ** 2 + y ** 2, (15 + PICK_EXTENT) ** 2);
  assert.ok(z >= center.z - 40 - PICK_EXTENT && z <= center.z + 40 + PICK_EXTENT);
});

import { parseStaticCollision, pickStaticCollision, loadStaticCollision } from '../js/picking.js';
const collisionFixture = (actors = [{}]) => ({ format: 'l2-static-collision-v1', tile: 'test',
  meshes: { stairs: { vertices: [[-10, -10, 0], [10, -10, 0], [0, 10, 0]], indices: [0, 1, 2] } },
  actors: actors.map(a => ({ name: 'source-stair', mesh: 'stairs', position: [0, 0, 20],
    rotation: [0, 0, 0], scale: [1, 1, 1], traceEligible: true,
    flags: { bStatic: true, bCollideActors: true, bBlockActors: true, bBlockPlayers: true,
      bBlockZeroExtentTraces: true, bBlockNonZeroExtentTraces: true }, ...a })) });

test('source collision surface wins over a farther floor and occludes a pawn', () => {
  const data = parseStaticCollision(collisionFixture(), 'test');
  const origin = p(0, 0, 100), direction = p(0, 0, -1);
  const hit = pickStaticCollision(origin, direction, data);
  assert.equal(hit.distance, 80); assert.deepEqual(hit.point, p(0, 0, 20));
  assert.equal(hit.actor, 'source-stair');
  assert.equal(pickPawn(origin, direction,
    [{ ...pawn(1, 0), center: p(0, 0, 0), collisionHeight: 10 }],
    { worldDistance: hit.distance }), null);
});

test('mouse collision admits a known false zero-extent flag but requires nonzero blocking', () => {
  const fixture = collisionFixture();
  fixture.actors[0].flags.bBlockZeroExtentTraces = false;
  const collision = parseStaticCollision(fixture, 'test');
  assert.equal(pickStaticCollision(p(0, 0, 100), p(0, 0, -1), collision).point.z, 20);
  fixture.actors[0].flags.bBlockNonZeroExtentTraces = false;
  assert.throws(() => parseStaticCollision(fixture, 'test'), /Unsupported source collision actor/);
});

test('unknown or coerced zero-extent flags remain inadmissible', () => {
  for (const value of [undefined, null, 0, 1, 'false', 'true']) {
    const fixture = collisionFixture();
    fixture.actors[0].flags.bBlockZeroExtentTraces = value;
    assert.throws(() => parseStaticCollision(fixture, 'test'), /Unsupported source collision actor/);
  }
  const missing = collisionFixture();
  delete missing.actors[0].flags.bBlockZeroExtentTraces;
  assert.throws(() => parseStaticCollision(missing, 'test'), /Unsupported source collision actor/);
});

const privateCollision = new URL('../../../assets/world/17_25/static-collision.json', import.meta.url);
test('locally generated 17_25 collision sidecar passes the runtime admission contract',
  { skip: !fs.existsSync(privateCollision) && 'requires locally generated original static collision' }, () => {
    const source = JSON.parse(fs.readFileSync(privateCollision, 'utf8'));
    const collision = parseStaticCollision(source, '17_25');
    assert.equal(collision.surfaces.length, source.actors.length);
    assert.equal(collision.triangleCount, source.actors.reduce((sum, actor) =>
      sum + source.meshes[actor.mesh].indices.length / 3, 0));
    assert.ok(collision.surfaces.every(surface => surface.vertices.every(Number.isFinite)));
  });

test('source collision contains faces even when no render primitive contains them', () => {
  const fixture = collisionFixture();
  fixture.meshes.stairs.vertices.push([90, -10, 40], [110, -10, 40], [100, 10, 40]);
  fixture.meshes.stairs.indices.push(3, 4, 5);
  const hit = pickStaticCollision(p(100, 0, 100), p(0, 0, -1), parseStaticCollision(fixture, 'test'));
  assert.equal(hit.triangle, 1); assert.equal(hit.point.z, 60);
  assert.equal(pickStaticCollision(p(200, 0, 100), p(0, 0, -1), parseStaticCollision(fixture, 'test')), null);
});

test('static source ray uses nearest surface, finite range and Shift start on both triangle sides', () => {
  const data = parseStaticCollision(collisionFixture([{ position: [0, 0, 0] }, { position: [0, 0, 20] }]), 'test');
  assert.equal(pickStaticCollision(p(0, 0, 40), p(0, 0, -7), data).point.z, 20);
  assert.equal(pickStaticCollision(p(0, 0, 40), p(0, 0, -1), data, { shift: true }).point.z, 0);
  assert.equal(pickStaticCollision(p(0, 0, -20), p(0, 0, 1), data).point.z, 0);
  assert.equal(pickStaticCollision(p(0, 0, 10021), p(0, 0, -1), data), null);
  assert.equal(pickStaticCollision(p(0, 0, 40), p(0, 0, 0), data), null);
});

test('source placement preserves yaw, independent axis scale and actor translation', () => {
  const fixture = collisionFixture([{ position: [100, 200, 300], rotation: [0, 16384, 0], scale: [2, 3, 4] }]);
  fixture.meshes.stairs.vertices = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  const data = parseStaticCollision(fixture, 'test');
  const hit = pickStaticCollision(p(95, 205, 400), p(0, 0, -1), data);
  assert.deepEqual(hit.point, p(95, 205, 300));
  assert.equal(pickStaticCollision(p(105, 205, 400), p(0, 0, -1), data), null);
});

test('unknown flags, wrong tile, malformed vertices and indices fail closed', () => {
  assert.throws(() => parseStaticCollision(collisionFixture(), 'other'));
  for (const mutate of [d => d.actors[0].traceEligible = false,
    d => d.actors[0].flags.bBlockNonZeroExtentTraces = false,
    d => d.meshes.stairs.indices[0] = 99,
    d => d.meshes.stairs.vertices[0][0] = NaN,
    d => d.actors[0].scale[2] = 0]) {
    const fixture = collisionFixture(); mutate(fixture);
    assert.throws(() => parseStaticCollision(fixture, 'test'));
  }
});

test('optional collision loader passes abort signal and rejects missing declared data', async () => {
  let requests = 0;
  const signal = new AbortController().signal;
  const fetcher = async (url, options) => {
    requests++; assert.equal(url, '/scenes/test/static-collision.json'); assert.equal(options.signal, signal);
    return { ok: true, json: async () => collisionFixture() };
  };
  assert.equal(await loadStaticCollision('test', null, fetcher, signal), null);
  assert.equal(requests, 0);
  assert.equal((await loadStaticCollision('test', 'static-collision.json', fetcher, signal)).triangleCount, 1);
  await assert.rejects(loadStaticCollision('test', '../anything', fetcher));
  await assert.rejects(loadStaticCollision('test', 'static-collision.json', async () => ({ ok: false, status: 404 })));
});
