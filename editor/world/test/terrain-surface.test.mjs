import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gridVertexCoordinate, gridCellCoordinate, sampleGridHeight, gridTriangleIndices,
  SourceTerrainSurface, loadSourceTerrainSurface } from '../js/terrain-surface.js';

test('a saddle follows triangles instead of the bilinear surface', () => {
  const heights = [0, 0, 0, 100];
  const sample = (x, y) => sampleGridHeight(2, x, y, i => heights[i]);
  assert.equal(sample(0.25, 0.25), 0);
  assert.equal(sample(0.5, 0.5), 0);
  assert.equal(sample(0.75, 0.75), 50);
  assert.equal(sample(1, 1), 100);
});

test('the stretched final interval is sampled by its physical width', () => {
  const size = 256;
  const read = i => i % size === size - 1 ? 100 : 0;
  assert.equal(gridVertexCoordinate(254, size, true), 254);
  assert.equal(gridVertexCoordinate(255, size, true), 256);
  assert.deepEqual(gridCellCoordinate(255, size, true), [254, 0.5]);
  assert.equal(sampleGridHeight(size, 255, 100, read, true), 50);
  assert.equal(sampleGridHeight(size, 256, 100, read, true), 100);
  assert.equal(sampleGridHeight(size, 257, 100, read, true), 100);
  assert.equal(sampleGridHeight(size, -1, 100, read, true), 0);
});

// Independent point-in-triangle barycentric calculation over emitted indices.
// Test every triangle, both layouts and nonplanar heights, including last rows.
function triangleHeight(vertices, p) {
  const [a, b, c] = vertices;
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
  const v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det;
  return u * a[2] + v * b[2] + (1 - u - v) * c[2];
}

test('height queries agree with independent barycentric intersection of each emitted triangle', () => {
  const size = 9;
  const heights = Array.from({ length: size ** 2 }, (_, i) => Math.sin(i * 2.73) * 1700 - 3104);
  const indices = gridTriangleIndices(size);
  assert.equal(indices.length, (size - 1) ** 2 * 6);
  for (const stretch of [false, true]) {
    const vertices = heights.map((h, i) => [gridVertexCoordinate(i % size, size, stretch), gridVertexCoordinate(Math.floor(i / size), size, stretch), h]);
    for (let i = 0; i < indices.length; i += 3) {
      const tri = [...indices.slice(i, i + 3)].map(k => vertices[k]);
      for (const weights of [[0.2, 0.3, 0.5], [0.8, 0.1, 0.1]]) {
        const p = [0, 1].map(axis => tri.reduce((sum, v, j) => sum + v[axis] * weights[j], 0));
        const expected = triangleHeight(tri, p);
        const actual = sampleGridHeight(size, p[0], p[1], k => heights[k], stretch);
        assert.ok(Math.abs(expected - actual) < 1e-8, `triangle ${i / 3}, stretched=${stretch}`);
      }
    }
  }
});

test('queries read live mesh heights after a seam or height correction', () => {
  const heights = [0, 0, 0, 0];
  assert.equal(sampleGridHeight(2, 0.75, 0.75, i => heights[i]), 0);
  heights[3] = 80;
  assert.equal(sampleGridHeight(2, 0.75, 0.75, i => heights[i]), 40);
});

// Hash fixtures independently with Node's SHA-256 and explicit wire bytes;
// production uses Web Crypto and must encode the decoded arrays little-endian.
function wordHash(words, width, littleEndian = true) {
  const bytes = Buffer.alloc(words.length * width);
  const write = width === 2
    ? (littleEndian ? 'writeUInt16LE' : 'writeUInt16BE')
    : (littleEndian ? 'writeUInt32LE' : 'writeUInt32BE');
  words.forEach((word, i) => bytes[write](word, i * width));
  return createHash('sha256').update(bytes).digest('hex');
}
function edgeHash(values, littleEndian = true) {
  const samples = Array.isArray(values) ? values : [values];
  const bytes = Buffer.alloc(samples.length * 8);
  samples.forEach((value, i) => bytes[littleEndian ? 'writeDoubleLE' : 'writeDoubleBE'](value, i * 8));
  return createHash('sha256').update(bytes).digest('hex');
}
function sourceFixture() {
  const def = { tile: '20_18', gridSize: 4, origin: [0, 0, 100], spacing: 128,
    heightScale: 0.25, terrainEdges: 'terrain-edges.json', topology: 'terrain-topology.json' };
  const raw = [32768, 32772, 32776, 32780,
    32788, 0x0102, 32796, 32800,
    32808, 32812, 32816, 32820,
    32828, 32832, 32836, 65534];
  // The decoder can return a view into a larger buffer. The hash must cover
  // only its samples, not these unrelated sentinels on either side.
  const backing = Uint16Array.from([0xabcd, ...raw, 0x1234]);
  const heights = backing.subarray(1, 17);
  const mapHash = createHash('sha256').update('synthetic map A, no retail content').digest('hex');
  const words = [0xffff & ~(1 << 5)]; // only source quad(1,1) is hidden
  const edges = { format: 'l2-terrain-edges-v1', tile: def.tile, gridSize: 4,
    origin: [...def.origin], spacing: 128, east: [900, 901, 902, 903],
    south: [-100, -101, -102, -103], southeast: 555,
    provenance: { center: { tile: def.tile, origin: [...def.origin], spacing: 128,
      heightScale: 0.25, rawMapSHA256: mapHash, extractedHeightSHA256: wordHash(heights, 2) } } };
  // Synthetic neighboring maps have distinct source identities and Z origins.
  // Their XY offsets follow this fixture's 4 * 128 extent, not a retail constant.
  for (const [side, tile, origin] of [
    ['east', '21_18', [512, 0, 200]],
    ['south', '20_19', [0, 512, -400]],
    ['southeast', '21_19', [512, 512, 500]],
  ]) {
    edges.provenance[side] = { tile, origin, spacing: 128, heightScale: 0.5,
      rawMapSHA256: createHash('sha256').update(`synthetic map ${tile}`).digest('hex'),
      extractedHeightSHA256: createHash('sha256').update(`synthetic G16 ${tile}`).digest('hex'),
      edgeValuesSHA256: edgeHash(edges[side]) };
  }
  const topology = { format: 'ue2-terrain-topology-v1', gridSize: 4,
    provenance: { sourceSHA256: mapHash },
    conventions: { status: 'visibility-verified', indexOrder: 'row-major', visibleBit: 1,
      bitmapVariant: 'visibility', bitSetDiagonal: null, boundary: null },
    bitmaps: { visibility: { words: [...words] }, visibilityOrig: { words: [...words] } },
    verification: { passed: true, method: 'native-sector-quad-table-v1', sourceSHA256: mapHash,
      expectedQuads: 9, coveredQuads: 9, missingQuads: 0, duplicateQuads: 0, errors: [],
      visibilityMismatches: 0, origVisibilityMismatches: 0,
      tableSHA256: createHash('sha256').update('synthetic native sector table').digest('hex'),
      visibilityWordsSHA256: wordHash(words, 4), origVisibilityWordsSHA256: wordHash(words, 4) } };
  return { def, heights, edges, topology };
}
function makeSource(fixture) {
  return new SourceTerrainSurface(fixture.def, fixture.heights, fixture.edges, fixture.topology);
}
function mockSourceFetch(context, fixture) {
  const replies = new Map([
    ['/source/terrain-edges.json', fixture.edges],
    ['/source/terrain-topology.json', fixture.topology],
  ]);
  return context.mock.method(globalThis, 'fetch', async url => {
    assert.ok(replies.has(url), `unexpected source URL: ${url}`);
    return { ok: true, status: 200, json: async () => structuredClone(replies.get(url)) };
  });
}

test('source vertices keep original coordinates and append distinct east/south/corner samples', () => {
  const fixture = sourceFixture(), surface = makeSource(fixture), mesh = surface.meshData();
  assert.equal(mesh.positions.length / 3, 25);
  // Expected directly from the serialized fixture, independently of indexAt.
  assert.deepEqual([...mesh.positions.slice(9, 12)], [Math.fround(3.84), Math.fround(1.03), -0]);
  assert.deepEqual([...mesh.positions.slice(36, 39)], [0, Math.fround(1.15), Math.fround(-3.84)]);
  assert.equal(surface.heightAtVertex(3, 0), 103);
  assert.equal(surface.heightAtVertex(4, 0), 900);
  assert.equal(surface.heightAtVertex(0, 4), -100);
  assert.equal(surface.heightAtVertex(4, 4), 555);
  assert.equal(surface.sample(4, 0.5), 900.5);
  assert.equal(surface.sample(0.5, 4), -100.5);
  assert.equal(surface.sample(4, 4), 555);
  assert.ok([...mesh.positions].every(Number.isFinite));
});

test('verified visibility removes a quad from both emitted triangles and queries', () => {
  const surface = makeSource(sourceFixture()), mesh = surface.meshData();
  // 4x4 quads with all boundary samples, minus exactly one hidden quad.
  assert.equal(mesh.indices.length, 15 * 6);
  assert.equal(surface.quadVisible(1, 1), false);
  assert.equal(surface.sample(1.5, 1.5), null);
  const hiddenCorners = new Set([5, 6, 9, 10]);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    assert.equal([...mesh.indices.slice(i, i + 3)].every(index => hiddenCorners.has(index)), false,
      'no actual triangle can cover the four hidden-quad corners');
  }
  // A point shared with a visible neighboring quad still belongs to terrain.
  assert.equal(surface.sample(1, 1.5), (100 + (0x0102 - 32768) * .25 + 111) / 2);
  const unverified = sourceFixture();
  unverified.topology.conventions.status = 'unverified';
  assert.equal(makeSource(unverified).meshData().indices.length, 16 * 6,
    'preserved but unverified bits cannot remove official source geometry');
});

test('missing source edges stay absent without clamping, extrapolation or phantom corners', () => {
  const f = sourceFixture();
  const savedProvenance = structuredClone(f.edges.provenance);
  f.edges.east = f.edges.south = f.edges.southeast = null;
  f.edges.provenance.east = f.edges.provenance.south = f.edges.provenance.southeast = null;
  const surface = makeSource(f), mesh = surface.meshData();
  assert.equal(mesh.positions.length / 3, 16);
  assert.equal(mesh.indices.length, 8 * 6); // nine original quads minus the hole
  assert.equal(surface.heightAtVertex(4, 1), null);
  assert.equal(surface.sample(3.5, 1.5), null);
  assert.equal(surface.sample(1.5, 3.5), null);
  assert.equal(surface.sample(-0.01, 1), null);
  assert.equal(surface.sample(NaN, 1), null);
  assert.equal(surface.sample(3, 1.5), 110.5, 'original last column still exists');
  f.edges.east = [900, 901, 902, 903];
  f.edges.southeast = 555; // a diagonal sample alone cannot supply a missing south row
  f.edges.provenance.east = savedProvenance.east;
  f.edges.provenance.southeast = savedProvenance.southeast;
  const eastOnly = makeSource(f);
  assert.equal(eastOnly.meshData().positions.length / 3, 20);
  assert.equal(eastOnly.meshData().indices.length, 11 * 6);
  assert.equal(eastOnly.heightAtVertex(4, 4), null);
  assert.equal(eastOnly.sample(3.5, 3.5), null);
});

test('source construction rejects mixed maps, coordinate changes and incomplete visibility proofs', () => {
  const anotherMap = createHash('sha256').update('different synthetic map B').digest('hex');
  const cases = [
    ['whole topology from another map', f => {
      f.topology.verification.sourceSHA256 = anotherMap;
      f.topology.provenance.sourceSHA256 = anotherMap;
    }],
    ['proof from another map', f => { f.topology.verification.sourceSHA256 = anotherMap; }],
    ['topology provenance from another map', f => { f.topology.provenance.sourceSHA256 = anotherMap; }],
    ['unknown topology format', f => { f.topology.format = 'l2-terrain-topology-v1'; }],
    ['failed proof', f => { f.topology.verification.passed = false; }],
    ['truthy nonboolean proof', f => { f.topology.verification.passed = 'true'; }],
    ['missing original visibility', f => { delete f.topology.bitmaps.visibilityOrig; }],
    ['wrong original visibility count', f => { f.topology.bitmaps.visibilityOrig.words = []; }],
    ['proof has source parsing errors', f => { f.topology.verification.errors = ['native sector parse failed']; }],
    ['proof omits error list', f => { delete f.topology.verification.errors; }],
    ['wrong expected quad count', f => { f.topology.verification.expectedQuads = 16; }],
    ['missing native quad', f => { f.topology.verification.missingQuads = 1; }],
    ['duplicate native quad', f => { f.topology.verification.duplicateQuads = 1; }],
    ['wrong coverage', f => { f.topology.verification.coveredQuads = 8; }],
    ['original bitmap disagrees', f => { f.topology.verification.origVisibilityMismatches = 1; }],
    ['wrong bit order', f => { f.topology.conventions.indexOrder = 'x-major'; }],
    ['wrong bitmap variant', f => { f.topology.conventions.bitmapVariant = 'visibilityOrig'; }],
    ['unproved diagonal claim', f => { f.topology.conventions.bitSetDiagonal = 'bc'; }],
    ['unproved boundary claim', f => { f.topology.conventions.boundary = 'visible'; }],
    ['signed bitmap word', f => { f.topology.bitmaps.visibility.words[0] = -1; }],
    ['signed original bitmap word', f => { f.topology.bitmaps.visibilityOrig.words[0] = -1; }],
    ['invalid matching source hashes', f => {
      f.edges.provenance.center.rawMapSHA256 = 'not-a-source-digest';
      f.topology.verification.sourceSHA256 = 'not-a-source-digest';
      f.topology.provenance.sourceSHA256 = 'not-a-source-digest';
    }],
    ['missing matching source hashes', f => {
      delete f.edges.provenance.center.rawMapSHA256;
      delete f.topology.verification.sourceSHA256;
      delete f.topology.provenance.sourceSHA256;
    }],
    ['empty edge origin', f => { f.edges.origin = []; }],
    ['truncated center origin', f => { f.edges.provenance.center.origin = [0, 0]; }],
    ['extra center origin coordinate', f => { f.edges.provenance.center.origin.push(0); }],
    ['shifted source origin', f => { f.edges.provenance.center.origin[0] += 128; }],
    ['changed source height scale', f => { f.edges.provenance.center.heightScale = 1; }],
    ['wrong edge sample count', f => { f.edges.east.pop(); }],
    ['nonfinite edge height', f => { f.edges.south[0] = Infinity; }],
  ];
  for (const [label, mutate] of cases) {
    const f = sourceFixture(); mutate(f);
    assert.throws(() => makeSource(f), /terrain|source|visibility/, label);
  }
});

for (const side of ['east', 'south', 'southeast']) {
  test(`source construction rejects mismatched ${side} neighbor metadata`, () => {
    const cases = [
      ['missing source record', f => { delete f.edges.provenance[side]; }],
      ['null source with present samples', f => { f.edges.provenance[side] = null; }],
      ['source record without samples', f => { f.edges[side] = null; }],
      ['nonadjacent source tile', f => { f.edges.provenance[side].tile = '24_18'; }],
      ['wrong source X', f => { f.edges.provenance[side].origin[0] += 128; }],
      ['wrong source Y', f => { f.edges.provenance[side].origin[1] -= 128; }],
      ['empty source origin', f => { f.edges.provenance[side].origin = []; }],
      ['truncated source origin', f => { f.edges.provenance[side].origin.pop(); }],
      ['nonfinite source Z', f => { f.edges.provenance[side].origin[2] = NaN; }],
      ['wrong source spacing', f => { f.edges.provenance[side].spacing = 64; }],
      ['invalid source height scale', f => { f.edges.provenance[side].heightScale = 0; }],
      ['invalid map digest', f => { f.edges.provenance[side].rawMapSHA256 = 'f'.repeat(63); }],
      ['invalid G16 digest', f => { f.edges.provenance[side].extractedHeightSHA256 = 'g'.repeat(64); }],
      ['missing derived edge digest', f => { delete f.edges.provenance[side].edgeValuesSHA256; }],
    ];
    for (const [label, mutate] of cases) {
      const f = sourceFixture(); mutate(f);
      assert.throws(() => makeSource(f), /terrain|source|edge/, label);
    }
  });
}

test('loader verifies actual little-endian SHA hashes of decoded height and visibility arrays', async context => {
  const f = sourceFixture(), before = f.heights.slice(), fetch = mockSourceFetch(context, f);
  const surface = await loadSourceTerrainSurface('/source/', f.def, f.heights);
  assert.ok(surface instanceof SourceTerrainSurface);
  assert.deepEqual(f.heights, before);
  assert.equal(surface.sample(1.5, 1.5), null);
  assert.deepEqual(fetch.mock.calls.map(call => call.arguments[0]).sort(),
    ['/source/terrain-edges.json', '/source/terrain-topology.json']);
});

test('loader rejects changed height samples and a big-endian hash of the same values', async context => {
  const f = sourceFixture(); mockSourceFetch(context, f);
  const changed = f.heights.slice(); changed[2] += 1;
  await assert.rejects(loadSourceTerrainSurface('/source/', f.def, changed), /heightmap differs/);
  const correct = f.edges.provenance.center.extractedHeightSHA256;
  f.edges.provenance.center.extractedHeightSHA256 = wordHash(f.heights, 2, false);
  assert.notEqual(f.edges.provenance.center.extractedHeightSHA256, correct, 'endianness fixture is discriminating');
  await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /heightmap differs/);
});

test('loader rejects changed current and Orig visibility payloads against their native proof hashes', async context => {
  const f = sourceFixture(); mockSourceFetch(context, f);
  for (const name of ['visibility', 'visibilityOrig']) {
    const words = f.topology.bitmaps[name].words, before = words[0];
    words[0] ^= 1;
    await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /visibility words differ/);
    words[0] = before;
  }
  f.topology.verification.visibilityWordsSHA256 = wordHash(f.topology.bitmaps.visibility.words, 4, false);
  await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /visibility words differ/);
});

test('loader rejects an absent original visibility payload even when the other proof fields survive', async context => {
  const f = sourceFixture(); mockSourceFetch(context, f);
  delete f.topology.bitmaps.visibilityOrig;
  delete f.topology.verification.origVisibilityWordsSHA256;
  await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /visibility|proof/);
});

test('loader verifies fractional edge samples as little-endian float64 world heights', async context => {
  const f = sourceFixture();
  f.edges.east[1] = 901 + 1 / 3;
  f.edges.south[2] = -102 - 1 / 7;
  f.edges.southeast = 555 + 1 / 11;
  for (const side of ['east', 'south', 'southeast']) {
    f.edges.provenance[side].edgeValuesSHA256 = edgeHash(f.edges[side]);
  }
  mockSourceFetch(context, f);
  const surface = await loadSourceTerrainSurface('/source/', f.def, f.heights);
  assert.equal(surface.heightAtVertex(4, 1), f.edges.east[1]);
  assert.equal(surface.heightAtVertex(2, 4), f.edges.south[2]);
  assert.equal(surface.heightAtVertex(4, 4), f.edges.southeast);
});

for (const side of ['east', 'south', 'southeast']) {
  test(`loader rejects changed ${side} edge heights and incorrect byte order`, async context => {
    const f = sourceFixture(); mockSourceFetch(context, f);
    const original = structuredClone(f.edges[side]);
    if (side === 'southeast') f.edges[side] += 1000;
    else f.edges[side][1] += 1000;
    await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /edge|source/);
    f.edges[side] = original;
    const correct = f.edges.provenance[side].edgeValuesSHA256;
    f.edges.provenance[side].edgeValuesSHA256 = edgeHash(original, false);
    assert.notEqual(f.edges.provenance[side].edgeValuesSHA256, correct,
      'endianness fixture distinguishes the world-height serialization');
    await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /edge|source/);
  });
}

test('loader keeps absent source opt-in explicit and fails a referenced HTTP error', async context => {
  const f = sourceFixture();
  const fetch = context.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));
  const legacy = { ...f.def }; delete legacy.terrainEdges;
  assert.equal(await loadSourceTerrainSurface('/source/', legacy, f.heights), null);
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /HTTP 404/);
});

// Synthetic geometry, no retail arrays. The exact engine identity is a fixture
// declaration; Python's optional original-input test verifies the real binary.
function nativeFixture() {
  const f = sourceFixture(), g = 256;
  f.def.gridSize = f.edges.gridSize = f.topology.gridSize = g;
  f.def.origin = f.edges.origin = f.edges.provenance.center.origin = [0, 0, 0];
  f.def.heightScale = f.edges.provenance.center.heightScale = 1;
  f.heights = new Uint16Array(g * g).fill(32768);
  for (const side of ['east', 'south']) f.edges[side] = new Array(g).fill(0);
  f.edges.southeast = 0;
  for (const [side, dx, dy] of [['east', 1, 0], ['south', 0, 1], ['southeast', 1, 1]]) {
    f.edges.provenance[side].origin = [dx * g * 128, dy * g * 128, 0];
  }
  const visibility = new Array(2048).fill(0xffffffff), turns = new Array(2048).fill(0);
  // Clear serialized outer visibility. Native PostLoad forces these bits on.
  for (let y = 0; y < g; y++) visibility[(y * g + 255) >>> 5] &= 0x7fffffff;
  visibility.fill(0, (255 * g) >>> 5);
  for (const [x, y, set] of [[31, 1, true], [32, 3, false], [255, 2, true], [255, 255, false]]) {
    const bit = y * g + x;
    if (set) turns[bit >>> 5] = (turns[bit >>> 5] | (1 << (bit & 31))) >>> 0;
    if (x + 1 === g && y + 1 === g) f.edges.southeast = 100;
    else if (x + 1 === g) f.edges.east[y + 1] = 100;
    else f.heights[(y + 1) * g + x + 1] = 32868;
  }
  const variants = { visibility, visibilityOrig: new Array(2048).fill(0),
    edgeTurn: turns, edgeTurnOrig: new Array(2048).fill(0xffffffff) };
  f.topology.bitmaps = Object.fromEntries(Object.entries(variants).map(([name, words]) => [name, { words }]));
  Object.assign(f.topology.conventions, { status: 'native-topology-verified', bitSetDiagonal: 'b-c', boundary: 'postload-visible' });
  Object.assign(f.topology.verification, { passed: false, currentPassed: true,
    expectedQuads: 255 ** 2, coveredQuads: 255 ** 2, origVisibilityMismatches: 255 ** 2,
    visibilityWordsSHA256: wordHash(visibility, 4),
    origVisibilityWordsSHA256: wordHash(variants.visibilityOrig, 4),
    edgeTurnWordsSHA256: wordHash(turns, 4), origEdgeTurnWordsSHA256: wordHash(variants.edgeTurnOrig, 4) });
  f.topology.nativeEngine = { method: 'interlude-native-terrain-v1', sourceFile: 'engine.dll',
    sourceSHA256: '07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0',
    postLoadOrig: 'copy-current', outerVisibility: 'visible', bitSetDiagonal: 'b-c', bitClearDiagonal: 'a-d' };
  f.edges.provenance.center.extractedHeightSHA256 = wordHash(f.heights, 2);
  for (const side of ['east', 'south', 'southeast']) f.edges.provenance[side].edgeValuesSHA256 = edgeHash(f.edges[side]);
  return f;
}

test('native current bits select both diagonals, including bit31 and distinct boundary vertices', () => {
  const f = nativeFixture(), before = structuredClone(f.topology.bitmaps);
  const surface = makeSource(f), mesh = surface.meshData();
  for (const [x, y, expected] of [[31, 1, 0], [32, 3, 50], [255, 2, 0], [255, 255, 50]]) {
    assert.equal(surface.sample(x + .5, y + .5), expected, `quad ${x},${y}`);
    assert.equal(surface.quadVisible(x, y), true);
  }
  assert.equal(surface.usesBCDiagonal(1, 31), false, 'index is y*width+x, not transposed');
  assert.equal(mesh.indices.length, 256 * 256 * 6, 'native outer bits are visible after load');
  assert.deepEqual([...mesh.indices.slice((1 * 256 + 31) * 6, (1 * 256 + 31) * 6 + 6)],
    [287, 288, 543, 288, 544, 543]);
  assert.deepEqual([...mesh.indices.slice((3 * 256 + 32) * 6, (3 * 256 + 32) * 6 + 6)],
    [800, 1057, 1056, 800, 801, 1057]);
  assert.equal(mesh.positions[(2 * 256 + 255) * 3], Math.fround(255 * 1.28));
  assert.equal(mesh.positions[(65536 + 2) * 3], Math.fround(256 * 1.28));
  assert.deepEqual(f.topology.bitmaps, before, 'PostLoad semantics never rewrite preserved input words');
});

test('native sampling agrees with independent intersection of both emitted diagonals and seam triangles', () => {
  const surface = makeSource(nativeFixture()), mesh = surface.meshData();
  for (const [x, y] of [[31, 1], [32, 3], [255, 2], [255, 255]]) {
    for (let t = 0; t < 2; t++) {
      const offset = (y * 256 + x) * 6 + t * 3;
      const tri = [...mesh.indices.slice(offset, offset + 3)].map(i => [
        mesh.positions[i * 3] / 1.28, -mesh.positions[i * 3 + 2] / 1.28, mesh.positions[i * 3 + 1] * 100]);
      // Cross product must face upward after the L2Y -> -Z conversion.
      const [a, b, c] = tri;
      assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0);
      const p = [0, 1].map(axis => tri[0][axis] * .2 + tri[1][axis] * .3 + tri[2][axis] * .5);
      assert.ok(Math.abs(surface.sample(...p) - triangleHeight(tri, p)) < .002,
        `mesh Float32 tolerance at ${x},${y} triangle ${t}`);
    }
  }
});

test('native loader checks current and preserved Orig edge digests and rejects unknown engine rules', async context => {
  const f = nativeFixture(); mockSourceFetch(context, f);
  assert.ok(await loadSourceTerrainSurface('/source/', f.def, f.heights));
  for (const name of ['edgeTurn', 'edgeTurnOrig']) {
    const words = f.topology.bitmaps[name].words, before = words[0];
    words[0] = (before ^ 1) >>> 0;
    await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /edge-turn words differ/);
    words[0] = before;
  }
  for (const field of ['sourceSHA256', 'method', 'postLoadOrig', 'outerVisibility', 'bitSetDiagonal', 'bitClearDiagonal']) {
    const bad = nativeFixture(); bad.topology.nativeEngine[field] = 'unknown';
    assert.throws(() => makeSource(bad), /native terrain topology proof/, field);
  }
  delete f.topology.bitmaps.edgeTurn;
  await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /native terrain topology proof/);
});

test('native saved FCoords control float32 height without recalculating the location bias', async context => {
  const f = nativeFixture(), center = f.edges.provenance.center;
  f.def.heightScale = center.heightScale = .296875;
  const values = [0, 0, 32225.859375, 128, 0, 0, 0, 128, 0, 0, 0, .296875];
  const bytes = Buffer.alloc(48);
  values.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  center.heightTransform = { method: 'native-fcoords-v1', origin: values.slice(0, 3),
    axes: [values.slice(3, 6), values.slice(6, 9), values.slice(9, 12)],
    sourceSHA256: center.rawMapSHA256, coordsSHA256: createHash('sha256').update(bytes).digest('hex'),
    engineSHA256: f.topology.nativeEngine.sourceSHA256,
    coreSHA256: '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf',
    verification: { method: 'native-sector-four-corners-v1', sectors: 256, boundsMatched: 1536,
      boundsSHA256: createHash('sha256').update('synthetic native corner bounds').digest('hex') } };
  mockSourceFetch(context, f);
  const before = f.heights.slice();
  const surface = await loadSourceTerrainSurface('/source/', f.def, f.heights);
  // Independent exact binary32 result, visibly different from prior 0.
  assert.equal(surface.heightAtVertex(0, 0), 160.947998046875);
  assert.deepEqual(f.heights, before);
  assert.equal(surface.meshData().positions[1], Math.fround(1.60947998046875));
  for (const mutate of [
    t => { t.origin[0] += 1; }, t => { t.axes[0][1] = 1; },
    t => { t.coreSHA256 = '0'.repeat(64); }, t => { t.verification.boundsMatched = 1535; },
  ]) {
    const changed = structuredClone(f); mutate(changed.edges.provenance.center.heightTransform);
    assert.throws(() => makeSource(changed), /height transform proof/);
  }
  center.heightTransform.origin[2] += 1;
  await assert.rejects(loadSourceTerrainSurface('/source/', f.def, f.heights), /height coordinates differ/);
});
