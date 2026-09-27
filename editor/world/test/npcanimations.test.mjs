import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { originalNpcAnimationRecord, verifiedNpcAnimationModel } from '../js/npcanimations.js';
globalThis.crypto ??= webcrypto;

const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = () => {
  const binary = new Uint8Array([1, 2, 3, 4]);
  const native = {
    meshPackageSHA256: sha('mesh'), animationPackageSHA256: sha('animation'),
    pskSHA256: sha('psk'), psaSHA256: sha('psa'),
    boneMapping: 'complete-positional-PSA-PSK-agreement',
    clips: { 'native:DeathWait': 'DeathWait' },
  };
  const json = { buffers: [{ uri: 'guard.bin', byteLength: 4 }],
    animations: [{ name: 'idle' }, { name: 'native:DeathWait' }],
    extras: { originalNpcAnimations: native } };
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const model = { ...native, gltf: 'models/guard.gltf', buffer: 'models/guard.bin',
    gltfSHA256: sha(bytes), bufferSHA256: sha(binary) };
  const field = { value: 'deathwait', declaredBy: 'npc.corpse' };
  const catalog = { format: 'l2-interlude-npc-animations-v1', edition: 'Interlude',
    sourceSHA256: sha('catalog'), models: { guard: model }, npcs: {
      123: { className: 'NPC.Corpse', meshId: 'Guard', meshName: 'Meshes.Guard',
        inheritance: ['npc.corpse', 'engine.pawn'],
        fields: { WaitAnimName: { 0: field } },
        overrides: { idle: { ...field, property: 'WaitAnimName', index: 0,
          sequence: 'DeathWait', clip: 'native:DeathWait' } } },
    } };
  const entry = { id: 'guard', gltf: model.gltf };
  const fetcher = async url => new Response(url.endsWith('.gltf') ? bytes : binary);
  const loader = { async parseAsync(text, base) {
    const parsed = JSON.parse(text);
    assert.equal(base, '/characters/monsters/models/');
    assert.ok(parsed.buffers[0].uri.startsWith('blob:'));
    assert.deepEqual(new Uint8Array(await (await fetch(parsed.buffers[0].uri)).arrayBuffer()), binary);
    return { animations: parsed.animations };
  } };
  return { catalog, entry, model, bytes, binary, json, fetcher, loader };
};

test('only the original NPC class receives the exact override, despite a shared mesh', () => {
  const f = fixture();
  assert.deepEqual(originalNpcAnimationRecord(f.catalog, 123, f.entry).overrides,
    { idle: 'native:DeathWait' });
  assert.equal(originalNpcAnimationRecord(f.catalog, 124, f.entry), null);
});

test('rejects mismatched mesh, class, property, array index and absent source evidence', () => {
  for (const mutate of [
    f => { f.catalog.npcs[123].meshId = 'different'; },
    f => { f.catalog.npcs[123].className = 'NPC.Live'; },
    f => { f.catalog.npcs[123].overrides.idle.property = 'NpcSocialAnimName'; },
    f => { f.catalog.npcs[123].overrides.idle.index = 1; },
    f => { f.catalog.npcs[123].overrides.idle.value = 'Wait'; },
    f => { f.catalog.npcs[123].overrides.idle.clip = 'idle'; },
    f => { delete f.catalog.npcs[123].fields.WaitAnimName; },
    f => { delete f.model.psaSHA256; },
    f => { f.model.buffer = '../elsewhere.bin'; },
    f => { f.model.boneMapping = 'partial-name-match'; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => originalNpcAnimationRecord(f.catalog, 123, f.entry));
  }
});

test('the loader consumes the very glTF and buffer bytes that passed SHA-256 checks', async () => {
  const f = fixture();
  const result = await verifiedNpcAnimationModel(originalNpcAnimationRecord(f.catalog, 123, f.entry), f.loader, f.fetcher);
  assert.deepEqual(result.overrides, { idle: 'native:DeathWait' });
});

test('stale glTF or buffer bytes reject before the loader or keyword mapping runs', async () => {
  for (const broken of ['gltf', 'bin']) {
    const f = fixture();
    f.model.gltf = `models/uncached_${broken}.gltf`;
    let parsed = false;
    const fetcher = url => url.endsWith('.' + broken)
      ? Promise.resolve(new Response('stale model')) : f.fetcher(url);
    await assert.rejects(verifiedNpcAnimationModel({ model: f.model, overrides: { idle: 'native:DeathWait' } },
      { parseAsync() { parsed = true; } }, fetcher), /SHA-256 mismatch/);
    assert.equal(parsed, false);
  }
});

test('a cached asset cannot validate different source-package provenance', async () => {
  const f = fixture();
  await verifiedNpcAnimationModel(originalNpcAnimationRecord(f.catalog, 123, f.entry), f.loader, f.fetcher);
  f.model.psaSHA256 = sha('different source');
  await assert.rejects(verifiedNpcAnimationModel(originalNpcAnimationRecord(f.catalog, 123, f.entry), f.loader, f.fetcher),
    /provenance mismatch/);
});

test('a source clip missing after parsing is rejected, not substituted with idle', async () => {
  const f = fixture();
  await assert.rejects(verifiedNpcAnimationModel(originalNpcAnimationRecord(f.catalog, 123, f.entry),
    { async parseAsync() { return { animations: [{ name: 'idle' }] }; } }, f.fetcher), /did not preserve/);
});
