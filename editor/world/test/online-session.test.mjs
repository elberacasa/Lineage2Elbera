// Actual main.js lifecycle functions and handlers, with controlled resource
// promises. No browser, live gateway, character mutation or real image loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SkillTraining } from '../js/skilltraining.js';

const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const skills = fs.readFileSync(new URL('../js/skills.js', import.meta.url), 'utf8');
function slice(start, end) {
  const a = main.indexOf(start), b = main.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `actual loader boundary: ${start}`);
  return main.slice(a, b);
}
const source = [
  slice('function cancelFineNavigation(', '\nfunction startFineNavigation('),
  slice('function resetOnlineSession()', "\nnet.on('open'"),
  slice("net.on('close'", "\nnet.on('error'"),
  slice("net.on('enterWorld'", "\nnet.on('addPlayer'"),
  slice('function applySelfEquipment(', '\n// The retail shortcut bar'),
  slice('function disposeUnadoptedCharacter(', '\n// Offline review viewpoints'),
].join('\n');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function inventoryHookHarness() {
  const handlers = {}, updates = deferred(), metadata = deferred(), calls = [], toasts = [];
  const notice = name => () => calls.push(name);
  const context = {
    online: true, onlineGeneration: 1,
    net: { on: (name, fn) => { handlers[name] = fn; } },
    inventory: { setItems: () => updates.promise, applyUpdate: () => updates.promise },
    refreshWeaponGate: notice('weapon'), refreshShotMarks: notice('shots'),
    shortcutWnd: { refreshItems: notice('shortcuts') },
    ...Object.fromEntries(['shopWnd', 'storeWnd', 'multiSellWnd', 'warehouseWnd', 'questWnd', 'recipeWnd']
      .map(name => [name, { onInvUpdate: notice(name) }])),
    itemMeta: () => metadata.promise,
    itemInfo: (meta, id) => meta[id], lootToast: message => toasts.push(message),
  };
  vm.runInNewContext([
    slice("net.on('itemList'", "\nnet.on('questList'"),
    slice("net.on('invUpdate'", "\nnet.on('skillCast'"),
  ].join('\n'), context);
  return { handlers, updates, metadata, calls, toasts, context };
}

for (const event of ['itemList', 'invUpdate']) {
  test(`${event} delayed inventory work cannot refresh a later session`, async () => {
    const h = inventoryHookHarness();
    const item = { objectId: 42, itemId: 101, count: 3, change: 1 };
    const pending = h.handlers[event]({ items: [item], updated: [item] });
    // Reconnect may already be online again when the older work resolves.
    h.context.onlineGeneration++;
    h.updates.resolve(); h.metadata.resolve({ 101: { name: 'Retired item' } });
    await pending; await tick();
    assert.deepEqual(h.calls, [], 'retired packets cannot refresh current-session windows');
    assert.deepEqual(h.toasts, [], 'retired packets cannot announce old loot');
  });
}

test('inventory loot text loading cannot outlive its receiving session', async () => {
  const h = inventoryHookHarness();
  const pending = h.handlers.invUpdate({ updated: [{ objectId: 42, itemId: 101, count: 3, change: 1 }] });
  h.updates.resolve(); await pending;
  assert.ok(h.calls.includes('shortcuts'), 'the current packet is handled normally');
  assert.deepEqual(h.toasts, []);
  h.context.onlineGeneration++;
  h.metadata.resolve({ 101: { name: 'Retired item' } });
  await tick();
  assert.deepEqual(h.toasts, [], 'a late item name cannot leak old loot into the new session');
});
function vector(x = 0, y = 0, z = 0) {
  return { x, y, z, copy(p) { Object.assign(this, { x: p.x, y: p.y, z: p.z }); return this; },
    multiplyScalar() { return this; }, add() { return this; } };
}
function harness() {
  const handlers = {}, jobs = [], sceneJobs = [], notices = [], hidden = new Set(['hidden']);
  const npcEntries = [], npcScenes = [], npcResets = [];
  const clearedNavTimers = [];
  const old = { group: { position: vector(1, 2, 3), rotation: { y: .5 } }, clearTarget() {},
    cancelled: 0, cancelCast() { this.cancelled++; } };
  const children = new Set([old.group]);
  let questResets = 0, trainerResets = 0, abortedScenes = 0, sceneFailureResets = 0, connects = 0, disconnects = 0;
  const trainer = new SkillTraining({ send: () => true });
  trainer.list({ type: 2, skills: [{ id: 123, level: 1, cost: 10 }] });
  trainer.select(123, 1);
  class Character {
    constructor() {
      this.work = deferred(); jobs.push(this);
      const resource = extra => ({ count: 0, dispose() { this.count++; }, ...extra });
      this.geometry = resource();
      this.texture = resource({ isTexture: true, image: { close() { throw new Error('shared bitmap closed'); } } });
      this.material = resource({ map: this.texture, normalMap: this.texture });
      const node = { geometry: this.geometry, material: [this.material, this.material] };
      this.group = { position: vector(), rotation: { y: 0 }, traverse(fn) { fn(node); fn(node); } };
      this.model = {};
      this.mixer = { stopped: 0, stopAllAction() { this.stopped++; }, uncacheRoot() {} };
      this.heightM = 1.5; this.cleared = 0; this.equipment = []; this.admission = [];
    }
    async load(url) { this.url = url; await this.work.promise; }
    setWaitType(type, options) { this.waitType=type; this.waitOptions=options; this.admission.push('wait'); }
    setSpeeds(data) { this.speeds = data; }
    setAppearance(data) { (this.appearanceCalls ||= []).push({ ...data }); }
    cancelAppearance() { this.appearanceCancelled = (this.appearanceCancelled || 0) + 1; }
    setWeapon(id) { this.wantWeapon = id; this.equipment.push(['rhand', id]); this.admission.push('rhand'); }
    setOffhand(id) { this.wantOffhand = id; this.equipment.push(['lhand', id]); this.admission.push('lhand'); }
    setArmor(data) { this.wantArmor = data; this.equipment.push(['armor', data]); this.admission.push('armor'); }
    clearTarget() { this.cleared++; }
    cancelCast() { this.cancelled = (this.cancelled || 0) + 1; }
  }
  old.setWaitType=function(type, options){this.waitType=type;this.waitOptions=options;};
  old.equipment = []; old.admission = [];
  for (const name of ['setSpeeds', 'setWeapon', 'setOffhand', 'setArmor', 'setAppearance', 'cancelAppearance']) old[name] = Character.prototype[name];
  const noop = () => {};
  const context = {
    online: true, onlineGeneration: 1, worldEntryGeneration: 0, npcWorldEntry: null,
    characterLoadGeneration: 0, characterLoading: false,
    fineNavSync: null, fineNavFollower: null, selfServerPosition: {x:1,y:2,z:3}, moveQueue: [],
    clearTimeout: id => clearedNavTimers.push(id),
    sceneLoadGeneration: 0, sceneLoadAbort: null,
    pendingSceneSwitch: { tile: 'retired' },
    clearSceneLoadFailures: () => { sceneFailureResets++; },
    sceneLoading: false, inspectionCameraPose: null,
    character: old, selfModelId: 'old', selfId: 11, selfName: 'Old',
    currentTile: 'home', availableScenes: ['home', 'remote'],
    manifest: [{ id: 'a', gltf: 'a.gltf' }, { id: 'b', gltf: 'b.gltf' }], Character,
    scene: { add: g => children.add(g), remove: g => children.delete(g) },
    terrain: { geodata: {}, center: () => vector(), heightAtWorld: () => 4 },
    loadingEl: { classList: { add: k => hidden.add(k), remove: k => hidden.delete(k) } },
    setLoading: text => notices.push(text), setStatus: text => notices.push(text),
    chat: { addSystem: text => notices.push(text) },
    console: { error: (...args) => notices.push(args) },
    net: { on: (name, fn) => { handlers[name] = fn; },
      connect: () => { connects++; }, disconnect: () => { disconnects++; } },
    questWnd: { reset: () => { questResets++; } },
    questMark: { resets: 0, reset() { this.resets++; } },
    npcDialog: { closes: 0, visible: true, close() { this.closes++; this.visible=false; } },
    skillTrainWnd: { reset: () => { trainerResets++; trainer.reset(); } },
    hennaWnd: { resets: 0, reset() { this.resets++; } },
    recipeWnd: { resets: 0, reset() { this.resets++; } },
    trainerClanInfo: { id: 456, reputation: 987 },
    tutorialWnd: { reset: noop }, tutorialEvents: { reset: noop },
    gatewayUrl: () => 'test://gateway', closeCharCreate: noop, closeCharSelect: noop,
    entities: { clear: noop,
      resetNpcWorldEntry: () => npcResets.push(context.onlineGeneration),
      beginNpcWorldEntry(isCurrent) { const token = { isCurrent }; npcEntries.push(token); return token; },
      setNpcWorldScene(terrain, token) { npcScenes.push({ terrain, token }); },
    }, combat: { clear: noop },
    skillBar: { clears: 0, clear() { this.clears++; } },
    inventory: { toggle: noop, renders: 0, resets: 0,
      render() { this.renders++; }, resetSession() { this.resets++; } },
    shopWnd: { resets: 0, resetSession() { this.resets++; } },
    storeWnd: { hide: noop }, selfSitting: false, selfWaitInitialized: false, selfStoreOpen: false,
    skillFx: { clear: noop }, shortcutWnd: { data: {}, resets: 0,
      reset() { this.resets++; this.data = {}; }, render: noop, load: name => notices.push(['shortcuts', name]) },
    sheetPanel: { clear: noop }, statusWnd: { clear: noop, setName: name => notices.push(['name', name]) },
    skillWnd: { clears: 0, clear() { this.clears++; } }, charSheetData: { runSpeed: 120 },
    gameSound: { clear: noop, equips: [], weapons: [],
      equip(id) { this.equips.push(id); }, setWeapon(id) { this.weapons.push(id); } },
    lastRhand: null, selfAppearance: {}, onlineToggle: { checked: true },
    document: { getElementById: () => ({ classList: { contains: () => false } }) },
    scenePicker: {}, tileNameFor: x => x === 100 ? 'remote' : 'home',
    pickModelId: (_manifest, race) => race === 2 ? 'b' : 'a',
    l2ToThree: (x, y, z, result) => Object.assign(result, { x, y: z, z: -y }),
    l2HeadingToThreeYaw: h => h, pendingGoal: {},
    followCam: { setScale: noop, resetToDefaultView: noop },
    camera: { updateProjectionMatrix: noop },
    sun: { position: vector(), target: { position: vector() } }, worldLight: { direction: vector() },
    window: { __world: { ready: false } },
    loadScene: async (tile, options) => {
      const work = deferred(); sceneJobs.push({ ...work, tile, options }); await work.promise;
    },
  };
  vm.runInNewContext(source + '\nglobalThis.runLoad = loadCharacter; globalThis.runOnline = setOnline;', context);
  return { context, handlers, jobs, sceneJobs, notices, hidden, old, children, clearedNavTimers,
    npcEntries, npcScenes, npcResets,
    trainer, get trainerResets() { return trainerResets; },
    get questResets() { return questResets; }, get connects() { return connects; },
    get disconnects() { return disconnects; }, get abortedScenes() { return abortedScenes; },
    get sceneFailureResets() { return sceneFailureResets; },
    ownScene() { context.sceneLoading = true;
      context.sceneLoadAbort = { abort() { abortedScenes++; } }; } };
}

const clubPaperdoll = { rhand: 2370, lhand: 0, gloves: 0, chest: 10, legs: 0, feet: 0 };

test('latest self appearance replaces the entry snapshot during model loading', async () => {
  const h = harness();
  const entry = h.handlers.enterWorld({ char: { id: 41, name: 'Fixture', race: 2,
    face: 0, hairStyle: 1, hairColor: 2, x: 1, y: 2, z: 3, heading: 0 } });
  h.handlers.charSheet({ face: 2, hairColor: 0 });
  h.jobs[0].work.resolve(); await entry;
  assert.deepEqual(h.context.character.appearanceCalls.at(-1), { face: 2, hairStyle: 1, hairColor: 0 });
  assert.equal(h.old.appearanceCancelled, 1, 'replacement retires old texture requests');
});

test('same-model entry applies explicit appearance and absent values are never synthesized', async () => {
  const h = harness();
  h.context.selfModelId = 'a';
  await h.handlers.enterWorld({ char: { id: 41, name: 'Fixture', race: 0,
    face: 2, x: 1, y: 2, z: 3, heading: 0 } });
  assert.equal(h.jobs.length, 0);
  assert.deepEqual(h.old.appearanceCalls.at(-1), { face: 2 });
  h.handlers.charSheet({ paperdoll: clubPaperdoll });
  assert.deepEqual(JSON.parse(JSON.stringify(h.old.appearanceCalls.at(-1))),
    { face: 2, paperdoll: clubPaperdoll }, 'equipment context does not choose face0 or hair indices');
});

test('disconnect clears remembered appearance and retires pending textures on the visible actor', async () => {
  const h = harness();
  h.handlers.charSheet({ face: 2, hairStyle: 5, hairColor: 3 });
  h.context.runOnline(false);
  assert.equal(h.old.appearanceCancelled, 1);
  assert.deepEqual(Object.keys(h.context.selfAppearance), []);
  const load = h.context.runLoad('b'); h.jobs[0].work.resolve(); await load;
  assert.deepEqual(h.jobs[0].appearanceCalls, [{}], 'offline replacement cannot inherit the retired session');
});

test('session reset cannot retain corpse metadata on a reused self model', () => {
  const h = harness();
  h.old.sweepableRaw = 1; h.old.sweepable = true;
  h.context.runOnline(false);
  assert.equal(h.old.sweepableRaw, null);
  assert.equal(h.old.sweepable, null);
});

test('world-entry paperdoll reaches the adopted model after arriving on the old model', async () => {
  const h = harness();
  const entry = h.handlers.enterWorld({ char: { id: 41, name: 'Fixture', race: 2, x: 1, y: 2, z: 3, heading: 0 } });
  h.handlers.charSheet({ runSpeed: 120, paperdoll: clubPaperdoll });
  assert.equal(h.old.wantWeapon, 2370, 'the packet arrives while the previous character is still visible');
  h.jobs[0].work.resolve(); await entry;
  const adopted = h.context.character;
  assert.equal(adopted, h.jobs[0]);
  assert.deepEqual(adopted.equipment, [['rhand', 2370], ['lhand', 0], ['armor', clubPaperdoll]]);
  assert.deepEqual(adopted.admission.slice(0, 4), ['rhand', 'lhand', 'armor', 'wait'],
    'the authoritative weapon stance is admitted before selecting a standing/sitting loop');
  assert.deepEqual(h.context.gameSound.equips, [], 'adopting the model does not replay an equip sound');
});

test('paperdoll received with no character is replayed from the latest sheet after load', async () => {
  const h = harness(); h.context.character = null;
  const load = h.context.runLoad('b');
  h.handlers.charSheet({ runSpeed: 100, paperdoll: clubPaperdoll });
  assert.deepEqual(h.context.gameSound.weapons, []);
  h.jobs[0].work.resolve(); assert.equal(await load, true);
  assert.equal(h.context.character.wantWeapon, 2370);
  assert.equal(h.context.character.wantArmor, clubPaperdoll);
  assert.deepEqual(h.context.gameSound.weapons, [2370]);
  assert.deepEqual(h.context.gameSound.equips, []);
});

test('current native presence bank survives loading without borrowing template IDs', async () => {
  const h = harness(); h.context.character = null;
  const load = h.context.runLoad('b');
  const first = { head: 0, hair: 41, face: 0 }, latest = { head: 0, hair: 0, face: 42 };
  h.handlers.charSheet({ face: 2, hairStyle: 0, hairColor: 1, paperdoll: clubPaperdoll,
    appearanceItems: first });
  h.handlers.charSheet({ appearanceItems: latest });
  latest.face = 999;
  h.jobs[0].work.resolve(); assert.equal(await load, true);
  const result = h.context.character.appearanceCalls.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.appearanceItems)), { head: 0, hair: 0, face: 42 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.paperdoll)), clubPaperdoll);
  assert.equal(result.hairColor, 1);
  h.context.runOnline(false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.selfAppearance)), {});
});

test('late adoption uses a newer authoritative unequip rather than the earlier club', async () => {
  const h = harness(), load = h.context.runLoad('b');
  h.handlers.charSheet({ paperdoll: clubPaperdoll });
  const empty = { rhand: 0, lhand: 0, gloves: 0, chest: 0, legs: 0, feet: 0 };
  h.handlers.charSheet({ paperdoll: empty });
  h.jobs[0].work.resolve(); assert.equal(await load, true);
  assert.deepEqual(h.context.character.equipment, [['rhand', 0], ['lhand', 0], ['armor', empty]]);
});

test('a model retired by disconnect cannot adopt or replay its session paperdoll', async () => {
  const h = harness(), load = h.context.runLoad('b');
  h.handlers.charSheet({ paperdoll: clubPaperdoll });
  h.context.runOnline(false);
  h.jobs[0].work.resolve(); assert.equal(await load, false);
  assert.deepEqual(h.jobs[0].equipment, []);
  assert.equal(h.context.character, h.old);
  assert.equal(h.context.charSheetData, null);
});

test('out-of-order models cannot replace the latest request and retire only candidate-owned resources', async () => {
  const h = harness();
  const a = h.context.runLoad('a'), b = h.context.runLoad('b');
  h.jobs[1].work.resolve(); assert.equal(await b, true);
  const notices = h.notices.length;
  h.jobs[0].work.resolve(); assert.equal(await a, false);
  assert.equal(h.context.character, h.jobs[1]);
  assert.equal(h.context.selfModelId, 'b');
  assert.equal(h.notices.length, notices);
  assert.deepEqual([...h.children], [h.jobs[1].group]);
  for (const key of ['geometry', 'material', 'texture']) {
    assert.equal(h.jobs[0][key].count, 1, `${key} disposed once despite shared mesh references`);
    assert.equal(h.jobs[1][key].count, 0, `${key} of adopted model survives`);
  }
});

test('failed model preserves the visible character and clears loading state', async () => {
  const h = harness(), load = h.context.runLoad('a');
  h.jobs[0].work.reject(new Error('failed model decode'));
  assert.equal(await load, false);
  assert.equal(h.context.character, h.old);
  assert.deepEqual([...h.children], [h.old.group]);
  assert.equal(h.context.characterLoading, false);
  assert.equal(h.hidden.has('hidden'), true);
  assert.equal(h.jobs[0].geometry.count, 1);
});

test('successful same-session model replacement retires the old cast before detaching its actor',async()=>{
  const h=harness(),state={};h.old.nativeCast=state;
  h.old.cancelCast=function(){this.cancelled++;this.nativeCast=null;};
  const soundStillCurrent=()=>h.old.nativeCast===state;
  const load=h.context.runLoad('a');assert.equal(soundStillCurrent(),true);
  h.jobs[0].work.resolve();assert.equal(await load,true);
  assert.equal(soundStillCurrent(),false);assert.equal(h.old.cancelled,1);
  assert.equal(h.children.has(h.old.group),false);
});

test('disconnect cancels pending model adoption and resets quest/dialog state immediately', async () => {
  const h = harness(), load = h.context.runLoad('a');
  h.context.runOnline(false);
  assert.equal(h.questResets, 1);
  assert.equal(h.context.questMark.resets, 1);
  assert.equal(h.context.npcDialog.closes, 1);
  assert.equal(h.context.npcDialog.visible, false);
  assert.equal(h.context.inventory.resets, 1);
  assert.equal(h.context.shopWnd.resets, 1);
  assert.equal(h.context.hennaWnd.resets, 1);
  assert.equal(h.context.recipeWnd.resets, 1);
  assert.equal(h.sceneFailureResets, 1);
  assert.equal(h.context.pendingSceneSwitch, null);
  assert.equal(h.trainerResets, 1);
  assert.equal(h.context.skillBar.clears, 1);
  assert.equal(h.context.skillWnd.clears, 1);
  assert.equal(h.context.shortcutWnd.resets, 1);
  assert.equal(h.old.cancelled, 1);
  assert.equal(h.context.trainerClanInfo, null);
  assert.equal(h.trainer.details({ type: 2, id: 123, level: 1, cost: 10, requirements: [] }), false);
  assert.equal(h.trainer.view, null);
  assert.equal(h.disconnects, 1);
  assert.equal(h.hidden.has('hidden'), true);
  const notices = h.notices.length;
  h.jobs[0].work.resolve(); assert.equal(await load, false);
  assert.equal(h.context.character, h.old);
  assert.equal(h.context.online, false);
  assert.equal(h.notices.length, notices);
});

test('remote close cancels scene work and connecting also retires an offline build', () => {
  const h = harness(); h.ownScene();
  h.handlers.close();
  assert.equal(h.questResets, 1);
  assert.equal(h.context.questMark.resets, 1);
  assert.equal(h.context.npcDialog.closes, 1);
  assert.equal(h.context.npcDialog.visible, false);
  assert.equal(h.context.inventory.resets, 1);
  assert.equal(h.context.shopWnd.resets, 1);
  assert.equal(h.trainerResets, 1);
  assert.equal(h.context.skillBar.clears, 1);
  assert.equal(h.context.skillWnd.clears, 1);
  assert.equal(h.context.shortcutWnd.resets, 1);
  assert.equal(h.old.cancelled, 1);
  assert.equal(h.context.trainerClanInfo, null);
  assert.equal(h.abortedScenes, 1);
  assert.equal(h.sceneFailureResets, 1);
  assert.equal(h.context.pendingSceneSwitch, null);
  assert.equal(h.context.sceneLoading, false);
  assert.equal(h.context.online, false);
  h.ownScene();
  h.context.trainerClanInfo = { id: 999, reputation: 321 };
  h.context.runOnline(true);
  assert.equal(h.questResets, 2);
  assert.equal(h.context.npcDialog.closes, 2);
  assert.equal(h.context.inventory.resets, 2);
  assert.equal(h.context.shopWnd.resets, 2);
  assert.equal(h.sceneFailureResets, 2);
  assert.equal(h.context.npcDialog.visible, false);
  assert.equal(h.trainerResets, 2);
  assert.equal(h.context.skillBar.clears, 2);
  assert.equal(h.context.skillWnd.clears, 2);
  assert.equal(h.context.shortcutWnd.resets, 2);
  assert.equal(h.old.cancelled, 2);
  assert.equal(h.context.trainerClanInfo, null);
  assert.equal(h.connects, 1);
  assert.equal(h.abortedScenes, 2);
});

test('session retirement clears pending origin refresh, active follower and cached server coordinates',()=>{
  for(const close of [h=>h.context.runOnline(false),h=>h.handlers.close()]) {
    const h=harness(),reasons=[];
    h.context.fineNavSync={timer:17};h.context.moveQueue.push({x:1,y:2,z:3});
    h.context.fineNavFollower={active:true,cancel(reason){this.active=false;reasons.push(reason);}};
    close(h);
    assert.deepEqual(reasons,['session-reset']);
    assert.deepEqual(h.clearedNavTimers,[17]);
    assert.equal(h.context.fineNavSync,null);assert.equal(h.context.fineNavFollower.active,false);
    assert.equal(h.context.selfServerPosition,null);assert.equal(h.context.moveQueue.length,0);
    assert.equal(h.context.pendingGoal,null);
  }
});

test('remote close and reconnect retire deferred effects even when the same self model and ID return', async () => {
  const h = harness(), metadata = deferred(), calls = [];
  const start = skills.indexOf('export class SkillFx');
  const end = skills.indexOf('\nimport { SkillVfx', start);
  assert.ok(start >= 0 && end > start, 'actual SkillFx production boundary');
  const SkillFx = vm.runInNewContext(skills.slice(start, end).replace('export ', '') + '\nSkillFx;', {
    _activeFx: null, vfxIndex: () => metadata.promise,
    SkillVfx: class {
      clears = 0;
      cast(id, anchors, level) { calls.push({ id, anchors, level }); return true; }
      launch(id, anchors, level) { calls.push({ id, anchors, level }); return true; }
      clear() { this.clears++; }
    },
  });
  const fx = new SkillFx({}, { getEntity: id => id === h.context.selfId ? h.context.character : null });
  h.context.skillFx = fx;
  h.context.selfModelId = 'a';
  const event = { op: 'skillCast', casterId: 11, targetId: 11, skillId: 7, level: 2 };
  const oldCast = fx.handle(event), oldLaunch = fx.handle({ ...event, op: 'skillLaunch' });

  h.handlers.close();
  assert.equal(fx.vfx.clears, 1, 'unexpected close immediately clears effects');
  h.context.runOnline(true);
  assert.equal(fx.vfx.clears, 2, 'connecting retires the previous mode as well');
  await h.handlers.enterWorld({ char: { id: 11, name: 'Returned', x: 5, y: 6, z: 7, race: 1 } });
  assert.equal(h.context.character, h.old, 'the model is intentionally reused');
  assert.equal(h.context.selfId, 11);
  assert.equal(h.jobs.length, 0);

  metadata.resolve({});
  assert.equal(await oldCast, false);
  assert.equal(await oldLaunch, false);
  assert.equal(calls.length, 0, 'old metadata work cannot attach to the returned character');
  assert.equal(await fx.handle(event), true, 'new session effects still dispatch');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].anchors.caster.pos(), h.old.group.position);
  h.context.runOnline(false);
  assert.equal(fx.vfx.clears, 3, 'explicit disconnect clears once, not twice');
});

test('old enterWorld resumes after reconnect without loading/placing a character or overwriting status', async () => {
  const h = harness();
  const oldEntry = h.handlers.enterWorld({ char: { id: 1, name: 'Retired', x: 100, y: 2, z: 3, race: 1 } });
  assert.equal(h.sceneJobs.length, 1);
  h.context.runOnline(false); h.context.runOnline(true);
  const notices = h.notices.length;
  assert.equal(h.sceneJobs[0].options.isCurrentSession(), false);
  h.sceneJobs[0].resolve(); await oldEntry;
  assert.equal(h.jobs.length, 0);
  assert.equal(h.context.character, h.old);
  assert.equal(h.context.selfId, null);
  assert.equal(h.notices.length, notices);
});

test('session change during glTF load prevents adoption before the handler post-await guard', async () => {
  const h = harness();
  const oldEntry = h.handlers.enterWorld({ char: { id: 1, name: 'Retired', x: 5, y: 6, z: 7, race: 1 } });
  assert.equal(h.jobs.length, 1);
  h.handlers.close(); h.context.runOnline(true);
  const notices = h.notices.length;
  h.jobs[0].work.resolve(); await oldEntry;
  assert.equal(h.context.character, h.old);
  assert.equal(h.context.selfModelId, 'old');
  assert.equal(h.notices.length, notices);
  assert.equal(h.jobs[0].material.count, 1);
});

test('a newer entry on the same connection wins and receives only its own server position', async () => {
  const h = harness();
  const a = h.handlers.enterWorld({ char: { id: 1, name: 'First', x: 5, y: 6, z: 7, race: 1, heading: 10 } });
  const b = h.handlers.enterWorld({ char: { id: 2, name: 'Latest', x: 8, y: 9, z: 10, race: 2, heading: 20 } });
  h.jobs[1].work.resolve(); await b;
  const notices = h.notices.length;
  h.jobs[0].work.resolve(); await a;
  assert.equal(h.context.character, h.jobs[1]);
  assert.equal(h.context.selfId, 2);
  assert.equal(h.context.selfName, 'Latest');
  assert.equal(h.context.character.group.position.x, 8);
  assert.equal(h.context.character.group.position.z, -9);
  assert.equal(h.context.character.group.rotation.y, 20);
  assert.equal(h.notices.length, notices);
});

test('matching current model still retires an outstanding picker model', async () => {
  const h = harness(); h.context.selfModelId = 'a';
  const picker = h.context.runLoad('b');
  await h.handlers.enterWorld({ char: { id: 1, name: 'Current', x: 5, y: 6, z: 7, race: 1, heading: 10 } });
  h.jobs[0].work.resolve(); assert.equal(await picker, false);
  assert.equal(h.context.character, h.old);
  assert.equal(h.context.characterLoading, false);
  assert.equal(h.hidden.has('hidden'), true);
});

test('matching adopted entry map releases NPC readiness before self appearance finishes', async () => {
  const h = harness();
  h.context.terrain.def = { tile: 'home' };
  const entering = h.handlers.enterWorld({ char: { id: 1, name: 'Current', x: 5, y: 6, z: 7, race: 2 } });
  assert.equal(h.jobs.length, 1, 'self appearance is still pending');
  assert.equal(h.npcEntries.length, 1);
  assert.equal(h.context.npcWorldEntry, h.npcEntries[0]);
  assert.equal(h.npcEntries[0].isCurrent(), true);
  assert.deepEqual(h.npcScenes, [{ terrain: h.context.terrain, token: h.npcEntries[0] }]);
  h.jobs[0].work.resolve(); await entering;
  assert.equal(h.npcScenes.length, 1, 'self appearance completion does not restart NPC clocks');
});

test('entry cannot certify the previous map or a mismatched terrain definition', async () => {
  for (const remote of [false, true]) {
    const h = harness(); h.context.selfModelId = 'a';
    h.context.terrain.def = { tile: remote ? 'home' : 'foreign' };
    const entering = h.handlers.enterWorld({ char: { id: 1, x: remote ? 100 : 5, y: 6, z: 7, race: 1 } });
    assert.equal(h.npcScenes.length, 0);
    assert.equal(h.npcEntries.length, 1, 'NPCs may wait under the current entry while assets load');
    if (remote) {
      assert.equal(h.sceneJobs.length, 1);
      assert.equal(h.sceneJobs[0].options.isCurrentSession(), true);
      h.sceneJobs[0].resolve();
    }
    await entering;
    assert.equal(h.npcScenes.length, 0, 'only actual center adoption may supply later readiness');
  }
});

test('disconnect and later entries retire the exact NPC readiness owner', async () => {
  const h = harness(); h.context.selfModelId = 'a';
  h.context.terrain.def = { tile: 'home' };
  const packet = { char: { id: 1, x: 5, y: 6, z: 7, race: 1 } };
  await h.handlers.enterWorld(packet);
  const first = h.context.npcWorldEntry;
  await h.handlers.enterWorld(packet);
  const second = h.context.npcWorldEntry;
  assert.notEqual(second, first);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  h.context.runOnline(false);
  assert.equal(h.context.npcWorldEntry, null);
  assert.equal(second.isCurrent(), false);
  assert.equal(h.npcResets.length, 1);
  h.context.runOnline(true);
  assert.equal(h.context.npcWorldEntry, null, 'connecting does not certify the old visible map');
  assert.equal(h.npcResets.length, 2);
});


test('first self info initializes a reused standing model once; reconnect cannot retain old sitting or multipliers',()=>{
 const h=harness(),calls=[];
 h.context.character.setSpeeds=msg=>{h.context.character.speedMul=msg.speedMul;};
 h.context.character.setWaitType=(type,options)=>calls.push({type,snapshot:options.snapshot,initial:options.initial,speed:h.context.character.speedMul});
 h.context.document={getElementById:()=>({classList:{contains:()=>false}})};
 vm.runInNewContext(slice("net.on('charSheet'",'\n// The retail shortcut bar'),h.context);
 h.handlers.charSheet({speedMul:1.1});
 assert.deepEqual(calls,[{type:1,snapshot:true,initial:true,speed:1.1}]);
 h.handlers.charSheet({speedMul:1.2});assert.equal(calls.length,1,'ordinary stat packets must not restart entry animation');
 h.context.selfSitting=true;h.context.runOnline(true);
 assert.equal(h.context.selfSitting,false);assert.equal(h.context.selfWaitInitialized,false);assert.equal(h.context.charSheetData,null);
 h.handlers.charSheet({speedMul:.9});assert.deepEqual(calls.at(-1),{type:1,snapshot:true,initial:true,speed:.9});
});
