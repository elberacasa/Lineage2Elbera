import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTerrainSweep, traceTerrainSweep } from '../js/terrain-collision.js';

function grid(width = 4, height = 4) {
  return { width, height,
    vertices: Array.from({ length: width * height }, (_, i) => [(i % width) * 128, Math.floor(i / width) * 128, 0]),
    inverseCoords: [0, 0, 0, 1 / 128, 0, 0, 0, 1 / 128, 0, 0, 0, 1],
    visibility: Array(width * height).fill(true), edgeTurn: Array(width * height).fill(false),
    inverted: false, deleteMe: false, owner: null, terrainMapPresent: true };
}
const down = (source, extent = [24, 24, 50], x = 30, y = 30) =>
  traceTerrainSweep(source, [x, y, 100], [x, y, -100], extent);

test('vertical native sweep shifts the surface by height and backs off half a unit', () => {
  const r = down(grid());
  assert.equal(r.status, 'ready'); assert.equal(r.blocked, true);
  assert.deepEqual(r.hit.point, [30, 30, 50.5]);
  assert.deepEqual(r.hit.normal, [0, 0, 1]);
  assert.equal(r.hit.rawTime, .25); assert.equal(r.hit.time, Math.fround(.2475));
  assert.deepEqual(r.cells, [[0, 0]]);
});

test('one-sidedness and Inverted retain the opposite source normal and height sign', () => {
  const source = grid();
  assert.equal(traceTerrainSweep(source, [30, 30, -100], [30, 30, 100], [24, 24, 50]).hit, null);
  source.inverted = true;
  assert.equal(down(source).hit, null);
  const r = traceTerrainSweep(source, [30, 30, -100], [30, 30, 100], [24, 24, 50]);
  assert.deepEqual(r.hit.point, [30, 30, -50.5]);
  assert.deepEqual(r.hit.normal, [0, 0, -1]);
});

test('both saved diagonal branches change a nonplanar cell surface', () => {
  const source = grid(); source.vertices[5][2] = 128;
  const a = down(source, [1, 1, 10], 32, 32);
  source.edgeTurn[0] = true;
  const b = down(source, [1, 1, 10], 32, 32);
  assert.equal(a.hit.point[2], 42.5);
  assert.equal(b.hit.point[2], 10.5);
});

test('hidden quads and explicitly deleted terrain do not adopt hits', () => {
  const source = grid(); source.visibility[0] = false;
  assert.equal(down(source).hit, null);
  source.visibility[0] = true; source.deleteMe = true;
  assert.equal(down(source).hit, null);
});

test('same-cell path visits only that cell and zero-length segments miss', () => {
  assert.deepEqual(down(grid()).cells, [[0, 0]]);
  const r = traceTerrainSweep(grid(), [30, 30, 0], [30, 30, 0], [1, 1, 1]);
  assert.equal(r.status, 'ready'); assert.equal(r.hit, null);
});

test('traversal preserves forward and reverse primary-axis order', () => {
  const source = grid(8, 8); source.visibility.fill(false);
  const a = traceTerrainSweep(source, [10, 64, 100], [650, 64, 100], [1, 1, 1]);
  const b = traceTerrainSweep(source, [650, 64, 100], [10, 64, 100], [1, 1, 1]);
  assert.deepEqual(a.cells, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  assert.deepEqual(b.cells, [...a.cells].reverse());
  const c = traceTerrainSweep(source, [64, 10, 100], [64, 650, 100], [1, 1, 1]);
  assert.deepEqual(c.cells, a.cells.map(([x, y]) => [y, x]));
});

test('native outer rejection uses dimensions minus two, without invented seam cells', () => {
  assert.equal(down(grid(), [1, 1, 1], 300, 30).visited, 0);
  assert.equal(down(grid(), [1, 1, 1], 256, 30).hit.point[0], 256);
  assert.equal(down(grid(), [1, 1, 1], -1, 30).visited, 0);
});

test('Extent.Y is not substituted for the source Extent.X arithmetic', () => {
  assert.deepEqual(down(grid(), [24, 1, 50]), down(grid(), [24, 9000, 50]));
});

test('raw edge cross products are not silently normalized', () => {
  const source = grid(); source.visibility.fill(false); source.visibility[1] = true;
  const query = x => traceTerrainSweep(source, [x + .2, 30, 100], [x - .2, 30, -100], [24, 24, 0]);
  assert.ok(query(127.9).hit);
  assert.equal(query(127.8).hit, null);
});

test('immutable preparation is separate from mutable caller arrays', () => {
  const source = grid(), prepared = prepareTerrainSweep(source);
  assert.equal(prepared.status, 'ready');
  source.vertices[0][2] = 999; source.visibility[0] = false; source.inverseCoords[3] = 99;
  assert.deepEqual(down(prepared.model).hit.point, [30, 30, 50.5]);
  assert.equal(prepareTerrainSweep(prepared.model).model, prepared.model);
  assert.throws(() => { prepared.model.vertices[0][2] = 10; }, TypeError);
});

test('unknown fields, sparse inputs and non-Float32 source values remain unsupported', () => {
  for (const field of ['owner', 'deleteMe', 'inverted', 'terrainMapPresent']) {
    const source = grid(); delete source[field];
    assert.equal(prepareTerrainSweep(source).status, 'unsupported', field);
  }
  for (const mutate of [s => { s.owner = {}; }, s => { delete s.vertices[0]; },
    s => { delete s.vertices[0][1]; }, s => { delete s.visibility[0]; },
    s => { delete s.edgeTurn[0]; }, s => { delete s.inverseCoords[0]; },
    s => { s.vertices[0][0] = 1 / 3; }, s => { s.visibility[0] = 0; }]) {
    const source = grid(); mutate(source);
    assert.equal(prepareTerrainSweep(source).status, 'unsupported');
  }
});

test('unsupported flags and extents never become a clear result', () => {
  const source = grid();
  for (const flags of [0x1000, 0x80000, -1, 0x100000000, NaN]) {
    assert.equal(traceTerrainSweep(source, [0, 0, 1], [0, 0, -1], [1, 1, 1], { flags }).status, 'unsupported');
  }
  for (const extent of [[0, 0, 0], [-1, 1, 1], [Infinity, 1, 1], [, 1, 1]]) {
    assert.equal(traceTerrainSweep(source, [0, 0, 1], [0, 0, -1], extent).status, 'unsupported');
  }
  assert.equal(traceTerrainSweep(source, [30, 30, 100], [30, 30, -100], [1, 1, 1], { flags: 0x86 }).status, 'ready');
});

test('finite inputs with overflowing derived arithmetic fail explicitly', () => {
  const r = traceTerrainSweep(grid(), [0, 0, 3e38], [0, 0, -3e38], [1, 1, 1]);
  assert.equal(r.status, 'unsupported');
  assert.match(r.reason, /nonfinite/); assert.equal('hit' in r, false);
});

test('finite crossing coordinates outside native integer conversion remain unsupported', () => {
  const r = traceTerrainSweep(grid(), [-1e12, 30, 100], [1e12, 30, -100], [1, 1, 1]);
  assert.equal(r.status, 'unsupported');
  assert.equal(r.reason, 'unsupported-native-coordinate-conversion');
});
