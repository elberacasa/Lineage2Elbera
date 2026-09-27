// Elbera Tools: actual EntityManager admission/removal methods, controlled
// character loads and owned GPU resources. No browser, assets or live server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/entities.js', import.meta.url), 'utf8');
const start = source.indexOf('export class EntityManager {');
assert.ok(start >= 0, 'actual EntityManager class boundary');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness() {
  const jobs = [], children = new Set(), errors = [];
  const scene = { add: group => children.add(group), remove: group => children.delete(group) };
  class Character {
    constructor() {
      this.work = deferred(); jobs.push(this);
      const resource = extra => ({ disposed: 0, dispose() { this.disposed++; }, ...extra });
      this.texture = resource({ isTexture: true, image: { close() { assert.fail('shared image cache closed'); } } });
      this.material = resource({ map: this.texture, normalMap: this.texture });
      this.geometry = resource();
      const node = { geometry: this.geometry, material: [this.material, this.material] };
      this.group = { position: {}, rotation: {}, userData: {}, add() {},
        traverse(fn) { fn(node); fn(node); } };
      this.model = {}; this.heightM = 1.7; this.cancelled = 0; this.equipment = [];
      this.mixer = { stopped: 0, roots: [], stopAllAction() { this.stopped++; },
        uncacheRoot(root) { this.roots.push(root); } };
    }
    async load(url) { this.url = url; await this.work.promise; }
    cancelCast() { this.cancelled++; }
    setWaitType(type, options) { this.sitting = type === 0; (this.waitCalls ||= []).push({type, snapshot:!!options?.snapshot}); }
    setSpeeds(data) { this.speeds = data; }
    setAppearance(data) { assert.ok(children.has(this.group)); (this.appearanceCalls ||= []).push({ ...data }); }
    cancelAppearance() { this.appearanceCancelled = (this.appearanceCancelled || 0) + 1; }
    setWeapon(id) { assert.ok(children.has(this.group)); this.equipment.push(['rhand', id]); }
    setOffhand(id) { assert.ok(children.has(this.group)); this.equipment.push(['lhand', id]); }
    setArmor(paperdoll) { assert.ok(children.has(this.group)); this.equipment.push(['armor', paperdoll]); }
  }
  const context = vm.createContext({ Character, L2_TO_M: .01, NAME_COLOR: '#ffffff',
    pickModelId: () => 'synthetic', l2HeadingToThreeYaw: h => h,
    l2ToThree: (x, y, z, output) => Object.assign(output, { x, y: z, z: -y }),
    makeLabel: () => ({ position: {}, userData: { nameplate: {} } }), labelScale: () => 1,
    console: { error: (...args) => errors.push(args) } });
  const EntityManager = vm.runInContext(source.slice(start).replace('export class', 'class') + '\nEntityManager', context);
  return { manager: new EntityManager(scene, [{ id: 'synthetic', gltf: 'synthetic.gltf' }]),
    jobs, children, errors };
}
const message = (id = 7, name = 'Synthetic') => ({ id, name, x: 1, y: 2, z: 3,
  heading: 4, running: true, paperdoll: { rhand: 111, lhand: 222, chest: 333 } });
function assertDisposed(ch) {
  for (const name of ['geometry', 'material', 'texture']) assert.equal(ch[name].disposed, 1, `${name} once`);
  assert.equal(ch.mixer.stopped, 1); assert.deepEqual(ch.mixer.roots, [ch.model]);
  assert.equal(ch.cancelled, 1); assert.deepEqual(ch.equipment, []);
}

test('remove during remote load prevents admission and disposes only the unadopted base model', async () => {
  const h = harness(), load = h.manager.addPlayer(message());
  assert.equal(h.manager.has(7), true); assert.deepEqual(h.jobs[0].equipment, []);
  h.manager.remove(7); assert.equal(h.manager.has(7), false);
  h.jobs[0].work.resolve(); await load;
  assert.equal(h.manager.entities.size, 0); assert.equal(h.children.size, 0);
  assert.equal(h.manager.pending.size, 0); assertDisposed(h.jobs[0]);
  assert.equal(h.jobs[0].appearanceCalls, undefined, 'retired model never starts a texture request');
});

test('remote appearance updates received during loading replace only supplied fields', async () => {
  const h = harness(), load = h.manager.addPlayer({ ...message(), face: 0, hairStyle: 1, hairColor: 2 });
  await h.manager.addPlayer({ ...message(), face: 2, hairColor: 0 });
  assert.equal(h.jobs[0].appearanceCalls, undefined, 'appearance loading starts after actor admission');
  h.jobs[0].work.resolve(); await load;
  assert.deepEqual(h.jobs[0].appearanceCalls, [{ face: 2, hairStyle: 1, hairColor: 0 }]);
  await h.manager.addPlayer({ ...message(), face: 1 });
  assert.equal(h.jobs[0].appearanceCalls.at(-1).face, 1, 'existing actors receive changes too');
  h.manager.remove(7);
  assert.equal(h.jobs[0].appearanceCancelled, 1, 'removal retires outstanding texture changes');
});

test('same-ID replacement cannot inherit retired appearance', async () => {
  const h = harness(), old = h.manager.addPlayer({ ...message(), face: 2 });
  h.manager.remove(7);
  const fresh = h.manager.addPlayer(message());
  h.jobs[0].work.resolve(); h.jobs[1].work.resolve(); await Promise.all([old, fresh]);
  assert.equal(h.jobs[0].appearanceCalls, undefined);
  assert.deepEqual(h.jobs[1].appearanceCalls, [{}]);
});

test('clear retires pending and admitted players without disposing shared NPC resources', async () => {
  const h = harness();
  const admitted = h.manager.addPlayer(message(1)); h.jobs[0].work.resolve(); await admitted;
  const a = h.manager.addPlayer(message(2)), b = h.manager.addPlayer(message(3));
  h.manager.setWaitType(2, 0); h.manager.setMoveMode(3, false);
  const npc = { kind: 'npc', group: { traverse() { assert.fail('NPC cache traversed for disposal'); } } };
  h.manager.entities.set(9, npc); h.children.add(npc.group);
  h.manager.clear();
  assert.equal(h.jobs[0].cancelled, 1); assert.equal(h.jobs[0].geometry.disposed, 0);
  assert.equal(h.manager._waitState.size, 0); assert.equal(h.manager._moveState.size, 0);
  assert.equal(h.manager.pending.size, 0); assert.equal(h.manager.entities.size, 0);
  h.jobs[1].work.resolve(); h.jobs[2].work.resolve(); await Promise.all([a, b]);
  assert.equal(h.children.size, 0); assert.equal(h.manager.entities.size, 0);
  assertDisposed(h.jobs[1]); assertDisposed(h.jobs[2]);
});

test('old completion cannot retire same-ID replacement or its newly deferred stance', async () => {
  const h = harness(), old = h.manager.addPlayer(message(7, 'Old'));
  h.manager.setWaitType(7, 0); h.manager.setMoveMode(7, false); h.manager.remove(7);
  const fresh = h.manager.addPlayer(message(7, 'New'));
  const token = h.manager.pending.get(7);
  h.manager.setWaitType(7, 1); h.manager.setMoveMode(7, true);
  h.jobs[0].work.resolve(); await old;
  assertDisposed(h.jobs[0]); assert.equal(h.manager.pending.get(7), token);
  assert.equal(h.manager._waitState.get(7), 1); assert.equal(h.manager._moveState.get(7), true);
  h.jobs[1].work.resolve(); await fresh;
  assert.equal(h.manager.entities.get(7), h.jobs[1]); assert.equal(h.jobs[1].name, 'New');
  assert.equal(h.jobs[1].sitting, false); assert.equal(h.jobs[1].forcedMoveAnim, 'run');
  assert.equal(h.manager.pending.size, 0); assert.deepEqual([...h.children], [h.jobs[1].group]);
  assert.equal(h.jobs[1].geometry.disposed, 0); assert.equal(h.jobs[1].equipment.length, 3);
});

test('late old completion cannot replace the already admitted same-ID actor', async () => {
  const h = harness(), old = h.manager.addPlayer(message(7, 'Old'));
  h.manager.remove(7); const fresh = h.manager.addPlayer(message(7, 'New'));
  h.jobs[1].work.resolve(); await fresh;
  h.jobs[0].work.resolve(); await old;
  assert.equal(h.manager.entities.get(7), h.jobs[1]); assert.equal(h.jobs[1].geometry.disposed, 0);
  assert.deepEqual([...h.children], [h.jobs[1].group]); assertDisposed(h.jobs[0]);
});

test('obsolete failures stay silent and cannot clear replacement state; current failure permits retry', async () => {
  const h = harness(), old = h.manager.addPlayer(message(7, 'Old'));
  h.manager.remove(7); const fresh = h.manager.addPlayer(message(7, 'New'));
  h.manager.setWaitType(7, 0);
  h.jobs[0].work.reject(new Error('stale load')); await old;
  assert.equal(h.errors.length, 0); assert.equal(h.manager.has(7), true);
  assert.equal(h.manager._waitState.get(7), 0); assertDisposed(h.jobs[0]);
  h.jobs[1].work.reject(new Error('current load')); await fresh;
  assert.equal(h.errors.length, 1); assert.equal(h.manager.has(7), false);
  assert.equal(h.manager._waitState.size, 0); assertDisposed(h.jobs[1]);
  const retry = h.manager.addPlayer(message(7)); h.jobs[2].work.resolve(); await retry;
  assert.equal(h.manager.entities.get(7), h.jobs[2]); assert.equal(h.jobs[2].geometry.disposed, 0);
});


test('initial remote sitting snapshot is preserved and a newer deferred change wins', async () => {
  const h=harness(), load=h.manager.addPlayer({...message(), waitType:0, sex:1});
  h.manager.setWaitType(7,1);
  h.jobs[0].work.resolve(); await load;
  assert.deepEqual(h.jobs[0].waitCalls,[{type:0,snapshot:true},{type:1,snapshot:false}]);
  assert.equal(h.jobs[0].sitting,false);
  await h.manager.addPlayer({...message(),waitType:0});
  assert.deepEqual(h.jobs[0].waitCalls.at(-1),{type:0,snapshot:true});
  h.manager.setWaitType(7,2);
  assert.equal(h.jobs[0].waitCalls.length,3,'special wait types cannot silently become standing');
});
