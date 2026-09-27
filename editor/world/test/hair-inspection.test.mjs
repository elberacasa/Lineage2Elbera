import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { selectHairSource, hairGeometryData, fetchVerifiedHairBytes, HairInspectionSlot } from './hair-inspection.js';

const sha = 'a'.repeat(64), lod = 'b'.repeat(64);
function fixture(stream = 'rigid') {
  const record = { format: 'l2-interlude-hair-lod0-v1', sourceExportSHA256: sha, sourceLOD0: { SHA256: lod }, sourceStream: stream, vertices: 3, bones: 1 };
  const raw = { ...structuredClone(record), stream, bones: [{ name: 'source-bone' }],
    vertices: [[2, 4, 8], [-1, 3, 6], [7, 8, 9]].map((position, i) => ({ position, uv: [i / 2, 1 - i / 2], normal: [0, 0, stream === 'soft' ? 511 : 1], sourceInfluences: [[0, 1]] })),
    materialSlots: [{ textureIndex: 0, polyFlags: 0 }],
    [stream + 'Indices']: [2, 0, 1],
    [stream + 'Sections']: [{ material: 0, firstFace: 0, numFaces: 1 }] };
  return { raw, record };
}
function catalogFixture() {
  return { format: 'l2-interlude-player-hair-v1', models: { model: { slots: [{ index: 7, parts: [
    { part: 1, nativeSlot: 5, status: 'source-absent' },
    { part: 2, nativeSlot: 4, status: 'source-present', mesh: 'Pkg.Mesh', colors: [{ index: 3, material: 'Pkg.Texture' }] }
  ] }] } }, meshes: { 'Pkg.Mesh': { sourceExportSHA256: sha } }, materials: { 'Pkg.Texture': { sourceExportSHA256: sha } } };
}

test('selects exact stored indices and preserves source absence without a fallback', () => {
  const catalog = catalogFixture(), before = structuredClone(catalog);
  const parts = selectHairSource(catalog, 'model', 7, 3);
  assert.equal(parts[0].status, 'source-absent'); assert.equal(parts[1].color.index, 3);
  assert.equal(parts[1].meshRecord, catalog.meshes['Pkg.Mesh']);
  assert.throws(() => selectHairSource(catalog, 'model', 0, 3), /Unknown/);
  assert.throws(() => selectHairSource(catalog, 'model', 7, 0), /Unknown/);
  assert.throws(() => selectHairSource(catalog, 'toString', 7, 3), /Unknown/);
  assert.deepEqual(catalog, before);
});

test('rejects ambiguous source rows or swapped native slot identity', () => {
  const c = catalogFixture(); c.models.model.slots.push(structuredClone(c.models.model.slots[0]));
  assert.throws(() => selectHairSource(c, 'model', 7, 3), /Unknown/);
  c.models.model.slots.pop(); c.models.model.slots[0].parts[1].nativeSlot = 5;
  assert.throws(() => selectHairSource(c, 'model', 7, 3), /Invalid/);
});

for (const stream of ['rigid', 'soft']) test(`preserves original ${stream} position/UV/winding/order without skinning`, () => {
  const { raw, record } = fixture(stream), before = structuredClone(raw), data = hairGeometryData(raw, record);
  assert.deepEqual(data.indices, [2, 0, 1]); assert.deepEqual(data.positions, [2, 4, 8, -1, 3, 6, 7, 8, 9]);
  assert.deepEqual(data.uvs, [0, 1, .5, .5, 1, 0]);
  assert.deepEqual(data.groups, [{ start: 0, count: 3, materialIndex: 0 }]);
  assert.equal(data.raw.bones[0].name, 'source-bone'); assert.deepEqual(raw, before);
  data.indices.reverse(); assert.deepEqual(raw[stream + 'Indices'], [2, 0, 1]);
});

test('rejects mismatched identity, invalid indices and unsupported material mapping', () => {
  for (const mutate of [
    ({ raw }) => { raw.sourceExportSHA256 = lod; },
    ({ raw }) => { raw.sourceLOD0.SHA256 = sha; },
    ({ raw }) => { raw.rigidIndices[0] = 3; },
    ({ raw }) => { raw.vertices[0].position[1] = NaN; },
    ({ raw }) => { raw.vertices[0].sourceInfluences[0][0] = 1; },
    ({ raw }) => { raw.materialSlots[0].textureIndex = 1; },
    ({ raw }) => { raw.rigidSections[0].firstFace = 1; },
    ({ raw }) => { raw.rigidSections.push({ ...raw.rigidSections[0] }); },
    ({ raw }) => { raw.rigidIndices.push(0, 1, 2); }
  ]) { const f = fixture(); mutate(f); assert.throws(() => hairGeometryData(f.raw, f.record)); }
});

test('verifies exact served bytes and rejects hash/network/URL failures', async () => {
  const bytes = new TextEncoder().encode('{"synthetic":true}\n');
  const SHA256 = createHash('sha256').update(bytes).digest('hex');
  const record = { SHA256, url: `/characters/hair/meshes/${SHA256}.json` };
  const seen = [], fetcher = async (...args) => { seen.push(args); return { ok: true, arrayBuffer: async () => bytes.buffer }; };
  assert.deepEqual(new Uint8Array(await fetchVerifiedHairBytes(record, fetcher, webcrypto)), bytes);
  assert.equal(seen[0][1].cache, 'no-store');
  await assert.rejects(fetchVerifiedHairBytes({ ...record, SHA256: sha }, fetcher, webcrypto), /hash mismatch/);
  await assert.rejects(fetchVerifiedHairBytes({ ...record, url: 'https://outside.invalid/a' }, fetcher, webcrypto), /identity/);
  await assert.rejects(fetchVerifiedHairBytes(record, async () => ({ ok: false, status: 404 }), webcrypto), /404/);
});

test('rejects material PolyFlags overrides and missing flag evidence', () => {
  for (const value of [1, 2, 0x400, null, undefined, '0', false]) {
    const { raw, record } = fixture(); raw.materialSlots[0].polyFlags = value;
    assert.throws(() => hairGeometryData(raw, record), /Unsupported source material slots/);
  }
  const { raw, record } = fixture();
  assert.equal(hairGeometryData(raw, record).indices.length, 3);
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
test('rapid selection retires resources and prevents stale view/status adoption', async () => {
  const adopted = [], disposed = [], states = [], first = deferred(), second = deferred(); let firstSignal;
  const slot = new HairInspectionSlot({ adopt: v => adopted.push(v), dispose: v => disposed.push(v), status: (...v) => states.push(v) });
  const p1 = slot.replace(signal => { firstSignal = signal; return first.promise; });
  const p2 = slot.replace(() => second.promise); assert.equal(firstSignal.aborted, true);
  second.resolve('new'); assert.equal(await p2, true);
  first.resolve('old'); assert.equal(await p1, false);
  assert.deepEqual(adopted, ['new']); assert.deepEqual(disposed, ['old']);
  assert.deepEqual(states, [['loading'], ['loading'], ['ready', 'new']]);
  slot.clear(); slot.clear(); assert.deepEqual(disposed, ['old', 'new']);
});

test('stale rejection cannot replace ready state and current failure stays explicit', async () => {
  const states = [], old = deferred();
  const slot = new HairInspectionSlot({ adopt() {}, dispose() {}, status: (...v) => states.push(v) });
  const pending = slot.replace(() => old.promise); await slot.replace(async () => 'new');
  old.reject(new Error('old')); await pending;
  assert.deepEqual(states.at(-1), ['ready', 'new']);
  await slot.replace(async () => { throw new Error('missing original'); });
  assert.equal(states.at(-1)[0], 'error'); assert.equal(states.at(-1)[1].message, 'missing original');
});

test('render adoption failure disposes the failed view and does not retain resources', async () => {
  const disposed = [], states = [];
  const slot = new HairInspectionSlot({ adopt() { throw new Error('renderer failed'); }, dispose: v => disposed.push(v), status: (...v) => states.push(v) });
  assert.equal(await slot.replace(async () => 'failed-view'), false);
  assert.deepEqual(disposed, ['failed-view']); assert.equal(slot.value, null);
  assert.equal(states.at(-1)[0], 'error');
  slot.clear(); assert.deepEqual(disposed, ['failed-view']);
});
