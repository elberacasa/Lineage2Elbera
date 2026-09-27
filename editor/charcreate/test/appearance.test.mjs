// Elbera Tools: actual creator functions with synthetic DOM/assets. No browser,
// original packages, account, game connection or listening service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import * as THREE from '../../world/vendor/three.module.min.js';
import { PlayerAppearance, facePlan } from '../../world/js/appearance.js';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function chunk(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `actual creator boundary ${start}`); return source.slice(a, b);
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function element() {
  const classes = new Set(), e = { children: [], value: '', style: {}, listeners: {}, disabled: false,
    classList: { add: (...x) => x.forEach(v => classes.add(v)), remove: (...x) => x.forEach(v => classes.delete(v)),
      toggle: (x, on) => on ? classes.add(x) : classes.delete(x), contains: x => classes.has(x) },
    appendChild(child) { this.children.push(child); }, addEventListener(name, fn) { this.listeners[name] = fn; } };
  Object.defineProperty(e, 'innerHTML', { set() { this.children = []; } }); return e;
}
function model() {
  const root = new THREE.Group(), map = new THREE.Texture({ original: true });
  const material = new THREE.MeshBasicMaterial({ map }); material.name = 'ExactFace:source';
  const node = new THREE.Mesh(new THREE.BoxGeometry(), material); node.name = 'ExactFace'; root.add(node);
  return { root, node, material, map };
}
function catalog() {
  const row = { nodeName: 'ExactFace', materialName: 'ExactFace:source', faces: [3, 7].map(index => ({
    index, texture: `Source.Face${index}`, url: `/faces/Source/Face${index}.png`,
  })) };
  return { format: 'l2-interlude-player-appearance-v1', models: { a: row, b: structuredClone(row) } };
}
function harness() {
  const nodes = new Map(), pageHandlers = {}, packets = [], images = [], loads = [];
  const $ = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  $('name-input').value = 'SourceName';
  const original = model(), race = { id: 'human', name: 'Human', genders: ['male'],
    classes: [{ id: 'fighter', classId: 0, name: 'Human Fighter', type: 'fighter' }],
    appearance: { faces: ['Invented A', 'Invented B'], hairStyles: [], hairColors: [] },
    appearanceDetail: { male: { fighter: {
      faces: [3, 7].map(index => ({ index, sysStringId: 40 + index, name: `Source face ${index}` })),
      hairStyleOptions: [{ index: 0, sysStringId: 20, name: 'Source style' }],
      hairColors: [{ index: 0, sysStringId: 30, name: 'Source color' }],
    } } } };
  const state = { race: 'human', gender: 'male', classId: 'fighter', face: 3, hairStyle: 0, hairColor: 0,
    appearanceCatalog: catalog(), modelEntry: { id: 'a', gltf: 'models/a.gltf' }, selectedModel: 'a',
    usingPlaceholder: false, data: { races: [race], nativeAppearance: { status: 'verified-options' } },
    manifest: { models: [{ id: 'a' }, { id: 'b' }] } };
  const context = vm.createContext({ THREE, PlayerAppearance, facePlan, state, $, console,
    document: { createElement: element }, modelStatusEl: $('model-status'),
    currentModel: original.root, mixer: null, currentClip: null, placeholder: null,
    turntable: new THREE.Group(), modelLoadGen: 0, lastFacingRy: 0, pageActive: true,
    getRace: () => race, pickModel: () => ({ id: state.selectedModel, gltf: `models/${state.selectedModel}.gltf` }),
    pickModelFor: () => ({}), comboAvailable: () => true,
    itemLabel: (v, i) => typeof v === 'string' ? v : v?.name || String(i), itemTexture: () => null, itemColor: () => null,
    RACE_ICONS: {}, RACE_INDEX: { human: 0 }, FALLBACK_CLASS_ID: {}, NAME_RE: /^[A-Za-z]{1,16}$/,
    EMBEDDED: true, creating: false, createPulse: 0, location: { origin: 'http://fixture' },
    window: { parent: { postMessage: (...args) => packets.push(args) }, addEventListener: (name, fn) => { pageHandlers[name] = fn; } },
    setCreating: on => { context.creating = on; },
    texLoader: { loadAsync(url) { const task = deferred(); images.push({ url, ...task }); return task.promise; } },
    gltfLoader: { loadAsync(url) { const task = deferred(); loads.push({ url, ...task }); return task.promise; } },
    frameModel() {}, faceCamera: () => 0, norm: x => x,
  });
  const code = [
    chunk('const faceTexCache =', '\nfunction setModelStatus('),
    chunk('function setModelStatus(', '\nfunction frameModel('),
    chunk('function sourceFaceChoices(', '\n// PlayerAppearance owns'),
    chunk('function loadFaceTexture(', '\n/* ================================================================\n * UI rendering'),
    chunk('function renderUI(', '\n/* ---------- name + create'),
    chunk('function validateName(', "\n$('name-input')"),
    chunk("$('create-btn').addEventListener('click'", "\n$('summary-close')"),
    chunk('async function refreshModel(', '\n/* ================================================================\n * Appearance'),
    chunk("window.addEventListener('pagehide'", '\n// verification/debug handle'),
  ].join('\n');
  vm.runInContext(code, context);
  return { context, state, $, nodes, pageHandlers, packets, images, loads, original,
    pending: () => vm.runInContext('previewAppearance.request?.promise', context) };
}

test('creator offers only exact catalog indices and retains the source index through UI and cc:create', () => {
  const h = harness(); h.context.renderUI();
  assert.equal(h.$('face-list').children.length, 2);
  h.$('face-list').children[1].onclick(); assert.equal(h.state.face, 7);
  h.$('create-btn').listeners.click();
  assert.equal(h.packets.length, 1); assert.equal(h.packets[0][0].face, 7);
  assert.equal(h.packets[0][0].hairStyle, 0); assert.equal(h.packets[0][1], 'http://fixture');
});
test('missing or malformed source catalog cannot fall back to legacy faces or submit face zero', () => {
  for (const mutate of [s => { s.appearanceCatalog = null; }, s => { s.appearanceCatalog.format = 'old'; },
    s => { s.appearanceCatalog.models.a.faces.push({ ...s.appearanceCatalog.models.a.faces[0] }); }]) {
    const h = harness(); mutate(h.state); h.context.renderUI();
    assert.equal(h.$('face-group').classList.contains('hidden'), true);
    assert.equal(h.$('create-btn').disabled, true); h.$('create-btn').listeners.click();
    assert.equal(h.packets.length, 0); assert.match(h.$('combo-note').textContent, /Face options are unavailable/);
  }
});
test('a non-admitted previous face is not clamped or reindexed after render', () => {
  const h = harness(); h.state.face = 1; h.context.renderUI();
  assert.equal(h.state.face, 1); assert.equal(h.$('create-btn').disabled, true);
  h.$('face-list').children[0].onclick(); assert.equal(h.state.face, 3);
  assert.equal(h.$('create-btn').disabled, false);
});
test('creator uses per-sex source hair choices and submits exact indices without claiming a preview', () => {
  const h = harness(), race = h.state.data.races[0], male = race.appearanceDetail.male.fighter;
  const choices = count => Array.from({ length: count }, (_, index) => ({ index,
    sysStringId: 200 + index, name: `Source choice ${index}` }));
  male.hairStyleOptions = choices(5); male.hairColors = choices(4);
  race.appearanceDetail.female = { fighter: { ...male, hairStyleOptions: choices(7) } };
  race.appearance.hairStyles = 99;
  h.context.renderUI(); assert.equal(h.$('hairstyle-list').children.length, 5);
  race.genders.push('female'); h.state.gender = 'female'; h.context.renderUI();
  assert.equal(h.$('hairstyle-list').children.length, 7);
  assert.equal(h.$('haircolor-list').children.length, 4);
  h.$('hairstyle-list').children[6].onclick(); h.$('haircolor-list').children[3].onclick();
  assert.equal(h.state.hairStyle, 6); assert.equal(h.state.hairColor, 3);
  assert.match(h.$('combo-note').textContent, /not previewed/);
  assert.equal(h.$('haircolor-list').children[3].textContent, 'Source choice 3');
  assert.equal(h.$('haircolor-list').children[3].style.background, undefined);
  h.$('create-btn').listeners.click();
  assert.equal(h.packets[0][0].sex, 1); assert.equal(h.packets[0][0].hairStyle, 6);
  assert.equal(h.packets[0][0].hairColor, 3);
});
test('source indices survive sparse fixture choices and an out-of-domain selection cannot create', () => {
  const h = harness(), row = h.state.data.races[0].appearanceDetail.male.fighter;
  row.hairStyleOptions = [{ index: 0, sysStringId: 30, name: 'First' }, { index: 4, sysStringId: 40, name: 'Last' }];
  h.context.renderUI(); h.$('hairstyle-list').children[1].onclick();
  assert.equal(h.state.hairStyle, 4);
  row.hairStyleOptions.pop(); h.context.renderUI();
  assert.equal(h.state.hairStyle, 4); assert.equal(h.$('create-btn').disabled, true);
  h.$('create-btn').listeners.click(); assert.equal(h.packets.length, 0);
});
test('missing or malformed source hair options do not inherit race-wide defaults', () => {
  for (const mutate of [h => { delete h.state.data.nativeAppearance; },
    h => { delete h.state.data.races[0].appearanceDetail; },
    h => { h.state.data.races[0].appearanceDetail.male.fighter.hairColors.push({ index: 0, sysStringId: 90, name: 'Duplicate' }); }]) {
    const h = harness(); mutate(h); h.context.renderUI();
    assert.equal(h.$('create-btn').disabled, true); h.$('create-btn').listeners.click();
    assert.equal(h.packets.length, 0);
  }
});
test('hair choice changes preserve source material color and only request the bound face image', async () => {
  const h = harness(); h.state.data.races[0].appearanceDetail.male.fighter.hairColors[0].color = '#ff0000';
  const hairMaterial = new THREE.MeshBasicMaterial({ color: 0x336699 });
  hairMaterial.name = 'Hair_m000_t00_m00_ah';
  h.original.root.add(new THREE.Mesh(new THREE.BoxGeometry(), hairMaterial));
  const before = hairMaterial.color.clone(), work = h.context.applyAppearance(); await tick();
  assert.ok(hairMaterial.color.equals(before)); assert.equal(h.images.length, 1);
  h.images[0].resolve(new THREE.Texture({ face: 3 })); await work;
  assert.ok(hairMaterial.color.equals(before));
});
test('actual creator controller chooses exact material and newer image wins out of order', async () => {
  const h = harness(); const old = h.context.applyAppearance(); await tick();
  h.state.face = 7; const current = h.context.applyAppearance(); await tick();
  h.images[1].resolve(new THREE.Texture({ face: 7 })); await current;
  h.images[0].resolve(new THREE.Texture({ face: 3 })); assert.equal((await old).status, 'cancelled');
  assert.equal(h.original.node.material.map.image.face, 7); assert.equal(h.state.appearanceResult.face, 7);
});
test('clearModel cancels pending appearance before disposal and does not dispose cached decoded image', async () => {
  const h = harness(), image = new THREE.Texture({}); let disposed = 0;
  image.addEventListener('dispose', () => disposed++);
  const work = h.context.applyAppearance(); await tick(); h.context.clearModel();
  h.images[0].resolve(image); assert.equal((await work).status, 'cancelled');
  assert.equal(h.context.currentModel, null); assert.equal(h.state.appearanceResult.status, 'cancelled'); assert.equal(disposed, 0);
});
test('completed face wrappers are retired before original model materials are disposed', async () => {
  const h = harness(), order = []; const work = h.context.applyAppearance(); await tick();
  h.images[0].resolve(new THREE.Texture({})); await work;
  h.original.node.material.addEventListener('dispose', () => order.push('wrapper'));
  h.original.material.addEventListener('dispose', () => order.push('original'));
  h.context.clearModel(); assert.deepEqual(order, ['wrapper', 'original']);
});
test('model adoption uses latest selection and an old glTF completion cannot adopt its face', async () => {
  const h = harness(), a = model(), b = model(); const first = h.context.refreshModel();
  h.state.selectedModel = 'b'; h.state.face = 7; const second = h.context.refreshModel();
  h.loads[0].resolve({ scene: a.root, animations: [] }); await first; assert.equal(h.context.currentModel, null);
  h.loads[1].resolve({ scene: b.root, animations: [] }); await second; await tick();
  assert.match(h.images[0].url, /Face7/); h.images[0].resolve(new THREE.Texture({ face: 7 })); await h.pending();
  assert.equal(h.context.currentModel, b.root); assert.equal(h.state.appearanceResult.face, 7);
});
test('pagehide retires glTF admission and pageshow restoration reloads the selected source model', async () => {
  const h = harness(), old = model(); const work = h.context.refreshModel(); h.pageHandlers.pagehide();
  h.loads[0].resolve({ scene: old.root, animations: [] }); await work;
  assert.equal(h.context.currentModel, null);
  await h.context.refreshModel(); assert.equal(h.loads.length, 1, 'late boot work cannot reload a retired page');
  h.pageHandlers.pageshow({ persisted: false }); assert.equal(h.loads.length, 1);
  h.pageHandlers.pageshow({ persisted: true }); assert.equal(h.loads.length, 2);
});
test('failed preview image yields an explicit visible result, with no silent face replacement', async () => {
  const h = harness(); const work = h.context.applyAppearance(); await tick(); h.images[0].reject(new Error('missing'));
  assert.equal((await work).status, 'error'); assert.match(h.$('model-status').textContent, /Face preview unavailable/);
  assert.equal(h.original.node.material, h.original.material);
});

test('standalone server exposes only the two exact shared appearance resources without starting a service', () => {
  const script = `import importlib.util, json\nfrom unittest.mock import patch\nfrom pathlib import Path\np=Path('editor/charcreate/server.py')\ns=importlib.util.spec_from_file_location('creator_test_server',p)\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nresults=[]\nfor path in ['/js/appearance.js','/gamedata/appearance.json','/js/main.js','/gamedata/itemmeta.json']:\n h=object.__new__(m.Handler);h.path=path\n h._send_file=lambda p:results.append(['file',p])\n h._send_api_file=lambda p:results.append(['api',p])\n h._send_json=lambda body,status=200:results.append(['error',status])\n with patch.object(m.os.path,'isfile',return_value=False),patch.object(m.os.path,'isdir',return_value=False):h.do_GET()\nprint(json.dumps(results))`;
  const result = spawnSync('python3', ['-c', script], { cwd: new URL('../../../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); const rows = JSON.parse(result.stdout);
  assert.match(rows[0][1], /editor\/world\/js\/appearance\.js$/);
  assert.match(rows[1][1], /assets\/gamedata\/appearance\.json$/);
  assert.deepEqual(rows.slice(2), [['error', 404], ['error', 404]]);
});
