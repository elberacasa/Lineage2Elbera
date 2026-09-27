// Elbera Tools: source-free face selection, material ownership and real
// Character adoption methods. Synthetic assets; no browser or original data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.min.js';
import { PlayerAppearance, facePlan } from '../js/appearance.js';

const catalog = { format: 'l2-interlude-player-appearance-v1', models: { fixture: {
  nodeName: 'OriginalFace', materialName: 'OriginalFace:section',
  faces: [0, 1, 2].map(index => ({ index, texture: `Source.Face${index}`, url: `/faces/Source/Face${index}.png` })),
} } };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function model() {
  const root = new THREE.Group();
  const map = new THREE.Texture({ source: 'built-default' }); map.flipY = false;
  map.wrapS = THREE.RepeatWrapping; map.repeat.set(2, 3); map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map }); material.name = 'OriginalFace:section';
  const node = new THREE.Mesh(new THREE.BoxGeometry(), material); node.name = 'OriginalFace'; root.add(node);
  const body = new THREE.Mesh(new THREE.BoxGeometry(), material); body.name = 'Body'; root.add(body);
  return { root, node, body, material, map };
}
function harness(loadTexture = async () => new THREE.Texture({ source: 'selected' })) {
  const state = model(), results = []; let current = state.root;
  const controller = new PlayerAppearance({ getModel: () => ({ model: current, modelId: 'fixture' }),
    loadCatalog: async () => catalog, loadTexture, onResult: result => results.push(result) });
  return { ...state, results, controller, replace: root => { current = root; } };
}

test('exact face choices preserve zero; absent/out-of-range/ambiguous selections have no alias', () => {
  assert.equal(facePlan(catalog, 'fixture', 0).texture, 'Source.Face0');
  for (const value of [undefined, null, -1, 3, '1', 1.5]) assert.equal(facePlan(catalog, 'fixture', value).status, 'unsupported');
  assert.equal(facePlan(catalog, 'other', 1).status, 'unsupported');
  const duplicate = structuredClone(catalog); duplicate.models.fixture.faces.push(duplicate.models.fixture.faces[1]);
  assert.equal(facePlan(duplicate, 'fixture', 1).status, 'unsupported');
});
test('applies only exact face mesh/material, preserving sampler and shared body material', async () => {
  const h = harness(); const result = await h.controller.set({ face: 2, hairStyle: 4, hairColor: 1 });
  assert.equal(result.status, 'ready'); assert.equal(result.texture, 'Source.Face2');
  assert.deepEqual(result.unsupported, ['hairStyle', 'hairColor']);
  assert.notEqual(h.node.material, h.material); assert.equal(h.body.material, h.material);
  assert.equal(h.node.material.map.image.source, 'selected'); assert.equal(h.map.image.source, 'built-default');
  assert.equal(h.node.material.map.flipY, false); assert.equal(h.node.material.map.wrapS, THREE.RepeatWrapping);
  assert.deepEqual(h.node.material.map.repeat.toArray(), [2, 3]);
  assert.equal(h.node.material.map.colorSpace, THREE.SRGBColorSpace);
  assert.deepEqual(h.node.material.color.toArray(), [1, 1, 1]);
});
test('repeated identical received snapshots coalesce even while image decoding is pending', async () => {
  const image = deferred(); let calls = 0;
  const h = harness(() => { calls++; return image.promise; });
  const first = h.controller.set({ face: 1, hairColor: 2 }); await tick();
  for (let i = 0; i < 20; i++) assert.equal(h.controller.set({ face: 1, hairColor: 2 }), first);
  assert.equal(calls, 1); image.resolve(new THREE.Texture({ source: 'one' }));
  assert.equal((await first).status, 'ready'); assert.equal(h.node.material.map.image.source, 'one');
});
test('a newer face wins when old texture completes later', async () => {
  const old = deferred(), next = deferred(); const h = harness(url => url.includes('Face1') ? old.promise : next.promise);
  const p = h.controller.set({ face: 1 }); await tick(); const q = h.controller.set({ face: 2 }); await tick();
  next.resolve(new THREE.Texture({ source: 'two' })); await q;
  old.resolve(new THREE.Texture({ source: 'one' })); assert.equal((await p).status, 'cancelled');
  assert.equal(h.node.material.map.image.source, 'two'); assert.equal(h.results.at(-1).face, 2);
});
test('cancelled work cannot mutate a detached actor or resurrect its result', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  const p = h.controller.set({ face: 1 }); await tick(); h.controller.cancel();
  pending.resolve(new THREE.Texture({ source: 'one' })); assert.equal((await p).status, 'cancelled');
  assert.equal(h.node.material, h.material); assert.equal(h.results.at(-1).status, 'cancelled');
  assert.equal((await h.controller.set({ face: 2 })).status, 'ready', 'future explicit requests remain allowed');
});
test('model replacement replays selected face and cannot adopt old model texture work', async () => {
  const image = deferred(), h = harness(() => image.promise), replacement = model();
  const old = h.controller.set({ face: 1 }); await tick(); h.replace(replacement.root);
  const next = h.controller.refresh(); await tick(); image.resolve(new THREE.Texture({ source: 'one' }));
  assert.equal((await old).status, 'cancelled'); assert.equal((await next).status, 'ready');
  assert.equal(h.node.material, h.material); assert.equal(replacement.node.material.map.image.source, 'one');
});
test('unknown selected face does not replace an existing source face with face zero', async () => {
  const h = harness(); await h.controller.set({ face: 2 }); const selected = h.node.material;
  assert.equal((await h.controller.set({ face: 999 })).status, 'unsupported');
  assert.equal(h.node.material, selected); assert.equal(h.results.at(-1).face, 999);
});
test('mesh/material ambiguity refuses mutation; no suffix or generic head matching', async () => {
  for (const mutate of [h => { h.node.name = 'Similar_f'; }, h => { h.node.material.name = 'Other'; },
    h => { const duplicate = h.node.clone(); h.root.add(duplicate); }]) {
    const h = harness(); mutate(h); assert.equal((await h.controller.set({ face: 1 })).status, 'unsupported');
    assert.equal(h.node.material, h.material);
  }
});
test('image failure resolves an explicit error and a later snapshot can retry', async () => {
  let attempts = 0; const h = harness(async () => { if (++attempts === 1) throw new Error('offline'); return new THREE.Texture({}); });
  assert.equal((await h.controller.set({ face: 1 })).status, 'error');
  assert.equal((await h.controller.set({ face: 1 })).status, 'ready'); assert.equal(attempts, 2);
});
test('owned wrappers are retired without disposing the source image or shared original', async () => {
  const source = new THREE.Texture({}); let sourceDisposed = 0, originalDisposed = 0;
  source.addEventListener('dispose', () => sourceDisposed++); const h = harness(async () => source);
  h.material.addEventListener('dispose', () => originalDisposed++);
  await h.controller.set({ face: 1 }); const owned = h.node.material; let ownedDisposed = 0;
  owned.addEventListener('dispose', () => ownedDisposed++); h.controller.cancel();
  assert.equal(ownedDisposed, 1); assert.equal(sourceDisposed, 0); assert.equal(originalDisposed, 0);
  assert.equal(h.node.material, h.material);
});

test('actual Character retains pre-load appearance, replays after adoption, and cancels through its public API', async () => {
  const source = fs.readFileSync(new URL('../js/character.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async load(url) {'), end = source.indexOf('  // Logical clip name', start);
  assert.ok(start >= 0 && end > start);
  let next = model();
  class Loader { setRequestHeader() { return this; } async loadAsync() { return { scene: next.root, animations: [] }; } }
  class Appearance extends PlayerAppearance { constructor(options) { super({ ...options, loadCatalog: async () => catalog }); } }
  const Prototype = vm.runInNewContext(`class Subject {${source.slice(start, end)}}; Subject.prototype`, {
    THREE, PlayerAppearance: Appearance, GLTFLoader: Loader,
    charManifest: async () => [{ id: 'fixture', visualScale: {} }], pawnAnim: async () => ({}),
    fetchOriginalAnimationBundle: async () => { throw new Error('source-free appearance fixture'); },
    playerVisualScale: () => ({ x: 1, y: 1, z: 1 }), detachArmor() {}, applyArmor() {}, equipWeapon() {},
    faceImage: async () => new THREE.Texture({ source: 'selected' }),
  });
  const ch = Object.assign(Object.create(Prototype), { group: new THREE.Group(), model: null, play() {}, cancelCast() {}, armor: {} });
  assert.equal((await ch.setAppearance({ face: 1 })).status, 'pending');
  await ch.load('/characters/models/fixture.gltf'); await ch._appearance.request.promise;
  assert.match(ch.lastOriginalPose.reason, /source-free appearance fixture/);
  assert.equal(ch.lastAppearance.status, 'ready'); assert.equal(next.node.material.map.image.source, 'selected');
  const old = next; next = model(); await ch.load('/characters/models/fixture.gltf'); await ch._appearance.request.promise;
  assert.equal(old.node.material, old.material); assert.equal(next.node.material.map.image.source, 'selected');
  ch.cancelAppearance(); assert.equal(ch.lastAppearance.status, 'cancelled'); assert.equal(next.node.material, next.material);
});
