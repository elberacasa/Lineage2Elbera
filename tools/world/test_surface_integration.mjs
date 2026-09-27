#!/usr/bin/env node
// Offline integration: compare the real mesh buffers with the public height
// query. No browser, textures, asset regeneration, or terrain-surface oracle.
// Run: node --test tools/world/test_surface_integration.mjs
// Requires the existing tools/src/char_pipeline Three.js dependency.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

const threeRoot = new URL('../src/char_pipeline/node_modules/three/', import.meta.url);
const threeModule = new URL('build/three.module.js', threeRoot);
if (!fs.existsSync(threeModule)) {
  throw new Error('Surface integration tests require Three.js: run npm ci --prefix tools/src/char_pipeline first. No private assets are required.');
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: threeModule.href, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) {
      return { url: new URL(`examples/jsm/${specifier.slice('three/addons/'.length)}`, threeRoot).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
// The modules only read this browser setting at import time. Eight vertices
// retain genuine decimation while keeping the fixtures and oracle small.
globalThis.location = { search: '?nres=8' };
const [{ Terrain }, { NeighborTile }, THREE, { Geodata }, { BspFloor }, { SourceTerrainSurface }] = await Promise.all([
  import('../../editor/world/js/terrain.js'),
  import('../../editor/world/js/neighbors.js'),
  import('three'),
  import('../../editor/world/js/geodata.js'),
  import('../../editor/world/js/bspfloor.js'),
  import('../../editor/world/js/terrain-surface.js'),
]);

const RENDER_PER_L2 = 0.01;
const EPSILON = 0.0002; // mesh buffers are Float32: 0.02 L2-unit tolerance
const close = (actual, expected, label, tolerance = EPSILON) => {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${label}: numeric heights required`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}; delta=${actual - expected} renderer units`);
};
function scene(gridSize = 256, origin = [0, 0, 0], spacing = 128) {
  return { gridSize, origin, spacing, heightScale: 1, layers: [], props: [] };
}
function heights(g, fn) {
  return Uint16Array.from({ length: g * g }, (_, i) => 32768 + fn(i % g, Math.floor(i / g)));
}
async function terrain(def, data, surface = null) {
  const t = new Terrain(def, '/unused-offline/');
  t.heights = data;
  t.surface = surface;
  // Geometry construction is untouched; only image/material I/O is replaced.
  t._buildMaterial = async () => new THREE.MeshBasicMaterial();
  await t._buildMesh();
  return t;
}
function neighbor(def, data, surface = null) {
  const t = new NeighborTile('synthetic', '/unused-offline/');
  t.def = def;
  t.heights = data;
  t.surface = surface;
  t.mesh = new THREE.Mesh(t._buildGeometry(), new THREE.MeshBasicMaterial());
  t.group.add(t.mesh);
  return t;
}

// Independent oracle: search the triangles the renderer receives, using only
// their index and position attributes. No grid-size, diagonal, stretch, source
// heights, or production interpolation code participates in the answer.
function renderedHeight(mesh, x, z, required = true) {
  const positions = mesh.geometry.attributes.position;
  const indices = mesh.geometry.index;
  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
    const ax = positions.getX(a), az = positions.getZ(a);
    const bx = positions.getX(b), bz = positions.getZ(b);
    const cx = positions.getX(c), cz = positions.getZ(c);
    const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(determinant) < 1e-14) continue;
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant;
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant;
    const wc = 1 - wa - wb;
    // Exact L2 boundaries may lie a Float32 ULP outside their stored mesh
    // coordinate. Allow that rounding only; height assertions stay strict.
    if (Math.min(wa, wb, wc) >= -1e-6) {
      return wa * positions.getY(a) + wb * positions.getY(b) + wc * positions.getY(c);
    }
  }
  if (required) assert.fail(`No rendered triangle covers (${x}, ${z})`);
  return null;
}
function trianglePoints(mesh) {
  const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
  const points = [];
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const w = [0.23, 0.31, 0.46];
    points.push(ids.reduce((v, id, j) => [v[0] + p.getX(id) * w[j], v[1] + p.getZ(id) * w[j]], [0, 0]));
  }
  return points;
}
function verifyPoints(tile, points, label) {
  for (const [x, z] of points) {
    const drawn = renderedHeight(tile.mesh, x, z);
    close(tile.heightAtWorld(x, z, drawn), drawn, `${label} (${x}, ${z})`);
  }
}

test('Terrain public query follows actual saddle triangles, not bilinear corners', async () => {
  const t = await terrain(scene(4), heights(4, (x, y) => x === 1 && y === 1 ? 200 : 0));
  verifyPoints(t, trianglePoints(t.mesh), 'saddle');
  // A-B-C is flat here; bilinear blending would incorrectly put its midpoint
  // 50 L2 units above the drawn diagonal.
  close(renderedHeight(t.mesh, 0.64, -0.64), 0, 'known saddle midpoint');
  close(t.heightAtWorld(0.64, -0.64), 0, 'saddle midpoint query');
  t.dispose();
});

test('Terrain final doubled interval and negative world coordinates match mesh', async () => {
  const t = await terrain(scene(4, [-32768, 65536, -3200]), heights(4, (x, y) => x * x * 40 + y * 70));
  const positions = t.mesh.geometry.attributes.position;
  close(positions.getX(3), (-32768 + 4 * 128) * RENDER_PER_L2, 'far edge position');
  verifyPoints(t, trianglePoints(t.mesh), 'stretched edge');
  verifyPoints(t, [[(-32768 + 3 * 128) * .01, -(65536 + 3 * 128) * .01]], 'last-cell middle');
  t.dispose();
});

test('Neighbor query follows the decimated mesh rather than an omitted source peak', () => {
  const t = neighbor(scene(), heights(256, (x, y) => x === 1 && y === 1 ? 200 : 0));
  assert.equal(t.mesh.geometry.attributes.position.count, 64, 'fixture really is decimated');
  assert.equal(t.heights[257], 32968, 'source has the deliberately omitted peak');
  close(renderedHeight(t.mesh, 1.28, -1.28), 0, 'peak absent from rendered mesh');
  close(t.heightAtWorld(1.28, -1.28), 0, 'query ignores invisible source peak');
  verifyPoints(t, trianglePoints(t.mesh), 'decimated neighbor');
  t.dispose();
});

test('Neighbor query follows noncoplanar decimated triangles at translated origin', () => {
  const t = neighbor(scene(256, [-65536, 98304, -1000]),
    heights(256, (x, y) => Math.round(400 * Math.sin(x / 17) * Math.cos(y / 23))));
  verifyPoints(t, trianglePoints(t.mesh), 'translated decimation');
  t.dispose();
});

test('stitching changes both neighbor mesh and the public ground query', async () => {
  const center = await terrain(scene(8, [0, 0, -500], 4096),
    heights(8, (x, y) => x * 20 + y * y * 15));
  const t = neighbor(scene(256, [32768, 0, -500]), heights(256, () => 0));
  t.stitchTo(center, 1, 0);
  const p = t.mesh.geometry.attributes.position;
  for (let row = 0; row < 8; row++) {
    const x = p.getX(row * 8), z = p.getZ(row * 8);
    close(p.getY(row * 8), renderedHeight(center.mesh, x, z), `stitched row ${row}`);
    close(t.heightAtWorld(x, z), p.getY(row * 8), `stitched query ${row}`);
  }
  verifyPoints(t, trianglePoints(t.mesh), 'stitched neighbor');
  center.dispose();
  t.dispose();
});

test('lazy geodata correction updates the actual decimated mesh and its query', async (context) => {
  const t = neighbor(scene(), heights(256, () => 0));
  const geo = {
    heightAt: () => 160,
    anchoredHeightAt: (_x, _y, _z, _maxUp, drawn) => drawn,
  };
  const load = context.mock.method(Geodata, 'load', async () => geo);
  context.mock.method(BspFloor, 'load', async () => null);
  close(t.heightAtWorld(80, -70), 0, 'before lazy correction');
  const first = t.ensureGeodata();
  assert.equal(first, t.ensureGeodata(), 'concurrent lazy load is reused');
  await first;
  assert.equal(load.mock.callCount(), 1);
  assert.equal(t.geoFixedCells, 256 * 256, 'large connected correction was exercised');
  close(renderedHeight(t.mesh, 80, -70), 1.6, 'corrected mesh');
  verifyPoints(t, trianglePoints(t.mesh), 'corrected neighbor');
  t.dispose();
});

function edgeFixture(def, { east = null, south = null, southeast = null } = {}) {
  const [tx, ty] = def.tile.split('_').map(Number);
  const provenance = { center: { tile: def.tile, origin: [...def.origin],
    spacing: def.spacing, heightScale: def.heightScale, rawMapSHA256: '1'.repeat(64),
    extractedHeightSHA256: '2'.repeat(64) } };
  for (const [side, dx, dy, value] of [['east', 1, 0, east], ['south', 0, 1, south], ['southeast', 1, 1, southeast]]) {
    provenance[side] = value === null ? null : { ...provenance.center,
      tile: `${tx + dx}_${ty + dy}`,
      origin: [def.origin[0] + dx * def.gridSize * def.spacing,
        def.origin[1] + dy * def.gridSize * def.spacing, 0], edgeValuesSHA256: '3'.repeat(64) };
  }
  return { format: 'l2-terrain-edges-v1', tile: def.tile,
    gridSize: def.gridSize, origin: [...def.origin], spacing: def.spacing,
    east, south, southeast, provenance };
}
function topologyFixture(g, hiddenX, hiddenY) {
  const words = Array(Math.ceil(g * g / 32)).fill(0xffffffff);
  const hidden = hiddenY * g + hiddenX;
  words[hidden >>> 5] = (words[hidden >>> 5] & ~(1 << (hidden & 31))) >>> 0;
  const encoded = Buffer.alloc(words.length * 4);
  words.forEach((word, i) => encoded.writeUInt32LE(word, i * 4));
  const digest = createHash('sha256').update(encoded).digest('hex');
  return { format: 'ue2-terrain-topology-v1', gridSize: g,
    bitmaps: { visibility: { words }, visibilityOrig: { words: [...words] } },
    provenance: { sourceSHA256: '1'.repeat(64) },
    conventions: { status: 'visibility-verified', indexOrder: 'row-major', visibleBit: 1,
      bitmapVariant: 'visibility', bitSetDiagonal: null, boundary: null },
    verification: { passed: true, method: 'native-sector-quad-table-v1', sourceSHA256: '1'.repeat(64),
      expectedQuads: (g - 1) ** 2, coveredQuads: (g - 1) ** 2, errors: [],
      visibilityWordsSHA256: digest, origVisibilityWordsSHA256: digest,
      missingQuads: 0, duplicateQuads: 0,
      visibilityMismatches: 0, origVisibilityMismatches: 0 } };
}
function flatGeodata(height, origin = [0, 0]) {
  // Four by four FLAT blocks, 512 L2 units per side. The expected floor is
  // supplied independently here, not sampled from the surface under test.
  const bytes = new ArrayBuffer(8 + 16 * 3), view = new DataView(bytes);
  view.setUint32(0, 0x4c324731, true);
  for (let block = 0; block < 16; block++) view.setInt16(9 + block * 3, height, true);
  return new Geodata({ origin, blocks: 4, blockCells: 8, cells: 32, cellSize: 16 }, bytes);
}
function flatBspFloor(g, height, spacing = 128) {
  const bytes = new ArrayBuffer(20 + g * g * 3), view = new DataView(bytes);
  view.setUint32(0, 0x46505342, true);
  view.setUint16(4, g, true); view.setUint16(6, 1, true);
  view.setInt32(16, spacing, true);
  for (let cell = 0; cell < g * g; cell++) {
    view.setUint8(20 + cell * 3, 1);
    view.setInt16(21 + cell * 3, height, true);
  }
  return new BspFloor(bytes);
}

test('source Terrain retains original samples and adds separate source edges without heightfix', async () => {
  const def = { ...scene(8, [0, 0, 0]), tile: '20_18' };
  const raw = heights(8, (x, y) => x * y), before = raw.slice();
  const edges = edgeFixture(def, { east: Array.from({ length: 8 }, (_, y) => 100 + y * 10),
    south: Array.from({ length: 8 }, (_, x) => -100 - x * 10), southeast: 777 });
  const t = new Terrain(def, '/unused-offline/');
  t.heights = raw;
  t.surface = new SourceTerrainSurface(def, raw, edges);
  // This geodata would trigger the old >100-unit, >50-cell correction.
  t.geodata = flatGeodata(160);
  t._correctHeights();
  assert.deepEqual(raw, before, 'source heights must not be inferred from geodata');
  t.geodata = null;
  t._buildMaterial = async () => new THREE.MeshBasicMaterial();
  await t._buildMesh();
  const positions = t.mesh.geometry.attributes.position;
  assert.equal(positions.count, 81, '64 original + 8 east + 8 south + source corner');
  assert.equal(positions.getX(7), Math.fround(7 * 128 * .01), 'last original column stays at7');
  assert.equal(positions.getZ(7 * 8), Math.fround(-7 * 128 * .01), 'last original row stays at7');
  close(renderedHeight(t.mesh, 8 * 128 * .01, -3 * 128 * .01), 1.3, 'separate east source sample');
  close(renderedHeight(t.mesh, 3 * 128 * .01, -8 * 128 * .01), -1.3, 'separate south source sample');
  verifyPoints(t, trianglePoints(t.mesh), 'source edges');
  t.dispose();
});

test('masked source holes use actual BSP/geodata floors and missing edges stay absent', async () => {
  const def = { ...scene(4), tile: '20_18' }, raw = heights(4, () => 0);
  const surface = new SourceTerrainSurface(def, raw, edgeFixture(def), topologyFixture(4, 1, 1));
  const center = await terrain(def, raw, surface), distant = neighbor(def, raw, surface);
  const geo = flatGeodata(320), bsp = flatBspFloor(4, 288);
  for (const tile of [center, distant]) {
    assert.equal(renderedHeight(tile.mesh, 1.92, -1.92, false), null, 'hole has no rendered triangle');
    assert.equal(tile.heightAtWorld(1.92, -1.92), null, 'no source or floor is not world-Z zero');
    tile.geodata = geo; tile.bspFloor = bsp;
    close(tile.heightAtWorld(1.92, -1.92, 2.88), 2.88, 'BSP floor inside the terrain hole');
    tile.bspFloor = null;
    close(tile.heightAtWorld(1.92, -1.92, 2.88), 3.2, 'raw geodata fallback inside the hole');
    close(tile.heightAtWorld(1.92, -1.92, 2.4), 2.4,
      'terrain holes cannot bypass the walking step ceiling');
    tile.geodata = null;
    assert.equal(renderedHeight(tile.mesh, 4.48, -1.92, false), null, 'missing neighbor adds no invented strip');
    assert.equal(tile.heightAtWorld(4.48, -1.92), null, 'missing neighbor query stays absent');
    tile.dispose();
  }
});

test('source neighbor and center share source coordinates without moving either mesh', async () => {
  const centerDef = { ...scene(8, [0, 0, -500], 4096), tile: '20_18' };
  const neighborDef = { ...scene(8, [32768, 0, -700], 4096), tile: '21_18' };
  const centerRaw = heights(8, (x, y) => x * y), neighborRaw = heights(8, (x, y) => x * 20 + y * 40);
  const east = Array.from({ length: 8 }, (_, y) => -700 + y * 40);
  const center = await terrain(centerDef, centerRaw,
    new SourceTerrainSurface(centerDef, centerRaw, edgeFixture(centerDef, { east })));
  const t = neighbor(neighborDef, neighborRaw,
    new SourceTerrainSurface(neighborDef, neighborRaw, edgeFixture(neighborDef)));
  const beforeVertices = t.mesh.geometry.attributes.position.array.slice(), beforeHeights = neighborRaw.slice();
  t.stitchTo(center, 1, 0);
  t.geodata = flatGeodata(160, neighborDef.origin.slice(0, 2));
  t._applyGeodataCorrection();
  t.geodata = null;
  assert.deepEqual(t.mesh.geometry.attributes.position.array, beforeVertices, 'stitch/correction cannot alter source vertices');
  assert.deepEqual(neighborRaw, beforeHeights, 'neighbor source samples remain unchanged');
  for (const row of [0.25, 1.5, 4.75, 6.5]) {
    const x = 32768 * .01, z = -row * 4096 * .01;
    const centerZ = renderedHeight(center.mesh, x, z);
    const neighborZ = renderedHeight(t.mesh, x, z);
    close(centerZ, (-700 + row * 40) * .01, 'independent source edge slope');
    close(neighborZ, centerZ, 'both actual meshes share the edge');
    close(center.heightAtWorld(x, z), centerZ, 'center query at source edge');
    close(t.heightAtWorld(x, z), neighborZ, 'neighbor query at source edge');
  }
  center.dispose(); t.dispose();
});

const giran = new URL('../../assets/world/22_22/', import.meta.url);
test('optional private Giran: original row255 and new source edge agree with real grounded height', {
  skip: !['scene.json', 'terrain-edges.json', 'terrain-topology.json'].every(f => fs.existsSync(new URL(f, giran)))
    ? 'private Giran source-edge assets are not installed' : false,
}, async (context) => {
  const def = JSON.parse(fs.readFileSync(new URL('scene.json', giran)));
  const buffer = fs.readFileSync(new URL(def.heightmap, giran));
  const data = Uint16Array.from({ length: buffer.length / 2 }, (_, i) => buffer.readUInt16LE(i * 2));
  const meta = JSON.parse(fs.readFileSync(new URL(def.geodata, giran)));
  const bytes = fs.readFileSync(new URL(meta.layers[0].data, giran));
  const toBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const t = new Terrain(def, '/unused-offline/');
  t.heights = data;
  const before = data.slice();
  const edges = JSON.parse(fs.readFileSync(new URL(def.terrainEdges, giran)));
  const topology = JSON.parse(fs.readFileSync(new URL(def.topology, giran)));
  if (!edges.provenance?.center?.heightTransform) {
    context.skip('private Giran sidecars need regeneration for native FCoords');
    return;
  }
  t.surface = new SourceTerrainSurface(def, data, edges, topology);
  t.geodata = new Geodata(meta, toBuffer(bytes));
  t.bspFloor = new BspFloor(toBuffer(fs.readFileSync(new URL('bspfloor.bin', giran))));
  t._correctHeights();
  assert.deepEqual(data, before, 'official raw heights survive ground setup byte-for-byte');
  t._buildMaterial = async () => new THREE.MeshBasicMaterial();
  await t._buildMesh();
  const positions = t.mesh.geometry.attributes.position;
  const originalRowVertex = 255 * 256 + 100;
  assert.equal(positions.getX(originalRowVertex), Math.fround(78336 * .01));
  assert.equal(positions.getZ(originalRowVertex), Math.fround(-163712 * .01), 'row255 stays at source Y163712');
  // Independently decoded original G16: row255 columns100/101 are21790/20346;
  // adjacent row0 column100 is21129. Saved FCoords Z origin2062455/64 and
  // scale19/64 yield these float32 native vertex values, not the old bias.
  close(positions.getY(originalRowVertex), -3098.145751953125 * .01, 'original row255 source height');
  close(renderedHeight(t.mesh, 78336 * .01, -163840 * .01), -3294.380126953125 * .01,
    'distinct adjacent source row256 at Y163840');
  const x = 78400 * .01, z = -163712 * .01;
  const drawn = renderedHeight(t.mesh, x, z), routed = t.heightAtWorld(x, z, drawn);
  close(drawn, -3312.489501953125 * .01, 'independent original G16 row interpolation');
  close(routed, drawn, 'grounded height agrees with actual mesh at audited Giran boundary');
  context.diagnostic(`Giran (78400,163712): rendered=${drawn / .01} L2; grounded=${routed / .01} L2; gap=${Math.abs(drawn - routed) / .01} L2`);
  // This vertex used to be raised by1422 L2 units by the ring-fill heuristic.
  close(positions.getY(214 * 256 + 201), -3582.348876953125 * .01,
    'interior source vertex is not turned into an invented terrain peak');
  t.dispose();
});
