// Elbera Tools: actual SkillFx lifecycle with a recording scene/audio boundary.
// No original assets, browser, particles or packet-driven timing oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { skillAgentBinding } from '../js/skillvfx-binding.js';
import { createPawnSkill, associatePawnSkill, cancelPawnSkill, consumePawnSkillTick } from '../js/pawnskill.js';

const source = fs.readFileSync(new URL('../js/skills.js', import.meta.url), 'utf8');
const begin = source.indexOf('export class SkillFx'), end = source.indexOf('\nimport { SkillVfx', begin);
assert.ok(begin >= 0 && end > begin, 'actual SkillFx module boundary');
const originalClass = source.slice(begin, end).replace('export ', '') + '\nSkillFx;';
const modelSource = { package: 'Fixture.ukx', packageSHA256: 'b'.repeat(64) };
const last = { classPath: 'Engine.AnimNotify_AttackShot', objectPath: 'Fixture.Last',
  objectRef: 1, isAttackShot: true, t: .5 };
const schedule = { status: 'ready', style: 8, flexIndex: -1,
  phases: [{ notifies: [last], scanDuration: 1 }] };
const action = (sourceIndex, extra = {}) => ({ sourceIndex, actionRef: sourceIndex + 1,
  actionPath: `Fixture.Action${sourceIndex}`, actionStatus: 'resolved-locate-effect',
  stage: 0, stageSerialized: true, ...extra });
function sourceIndex() {
  return { format: 'l2-interlude-skill-vfx-v2',
    objects: { 'fixture.agent': { path: 'Fixture.Agent', f: 0, actionFormat: 'l2-skill-action-records-v1',
      c: [action(0)], h: [action(0)], p: [], s: [action(0, { g: 2 })], x: [] } },
    bindings: { 77: { levels: [3], path: 'Fixture.Agent' } } };
}
const msg = { op: 'skillCast', casterId: 11, targetId: 12, skillId: 77, level: 3, hitTime: 1000 };
const launch = (extra = {}) => ({ ...msg, op: 'skillLaunch', ...extra });
const tick = (hooks, notes = [], extra = {}) => hooks.tick({ activeTime: 1,
  events: notes.map(notify => ({ dispatch: 'object', notify })), ...extra });

function harness(pending = Promise.resolve(sourceIndex())) {
  const dispatched = [], sounds = [], packets = [], actors = new Map();
  const actor = id => ({ castGeneration: 1, startCastSchedule() {}, heightM: 2,
    group: { position: { id }, rotation: { y: .25 }, getObjectByName: name => ({ id, name }) } });
  for (const id of [11, 12, 13, 14]) actors.set(id, actor(id));
  let clears = 0;
  const context = vm.createContext({ _activeFx: null, vfxIndex: () => pending,
    skillAgentBinding, createPawnSkill, associatePawnSkill, cancelPawnSkill, consumePawnSkillTick,
    SkillVfx: class {
      dispatchActions(plan, anchorFor, isCurrent) {
        assert.ok(['ready', 'native-no-op'].includes(plan.status));
        dispatched.push({ plan, anchorFor, isCurrent }); return true;
      }
      cast(...args) { packets.push(['cast', ...args]); return true; }
      launch(...args) { packets.push(['launch', ...args]); return true; }
      update() {} clear() { clears++; }
    } });
  const SkillFx = vm.runInContext(originalClass, context);
  const fx = new SkillFx({}, { getEntity: id => actors.get(id), onNativeSound: event => sounds.push(event) });
  const start = (message = msg) => {
    const hooks = fx.prepareCast(message); assert.ok(hooks);
    hooks.configure({ schedule, modelSource }); hooks.start(actors.get(message.casterId).castGeneration);
    return hooks;
  };
  return { fx, actors, actor, dispatched, sounds, packets, start, get clears() { return clears; } };
}

test('prepare/configure/start only reserve the cast; the first native tick produces casting actions and sound', async () => {
  const h = harness(); await h.fx.ready;
  const hooks = h.start();
  assert.equal(h.dispatched.length, 0); assert.equal(h.sounds.length, 0); assert.equal(h.packets.length, 0);
  tick(hooks, [], { activeTime: 0 });
  assert.deepEqual(h.dispatched.map(d => d.plan.phase), ['c']);
  assert.deepEqual(h.sounds.map(s => [s.type, s.skillId, s.level]), [[1, 77, 3]]);
  assert.equal(h.sounds[0].caster, h.actors.get(11));
  assert.equal(h.sounds[0].isCurrent(), true);
  tick(hooks);
  assert.equal(h.dispatched.length, 1, 'no channel action is manufactured on every tick');
});

test('launches received before animation metadata preserve duplicate order and never release a packet shot', async () => {
  const h = harness(); await h.fx.ready;
  const hooks = h.fx.prepareCast(msg);
  for (const [targetId, level] of [[14, 999], [13, 1], [14, 3]])
    assert.equal(h.fx.associate(launch({ targetId, level })), true);
  assert.equal(h.dispatched.length, 0); assert.equal(h.sounds.length, 0);
  hooks.configure({ schedule, modelSource }); hooks.start(1);
  tick(hooks, [], { activeTime: 0 });
  tick(hooks, [], { activeTime: 100 });
  assert.deepEqual(h.dispatched.map(d => d.plan.phase), ['c']);
  tick(hooks, [last]);
  assert.deepEqual(h.dispatched.at(-1).plan.calls.map(c => c.target),
    [h.actors.get(14), h.actors.get(13), h.actors.get(14)]);
  assert.deepEqual(h.sounds.map(s => s.type), [1, 2]);
  assert.equal(h.packets.length, 0);
});

test('normal completion keeps dispatched sound guards but consumes late launches through a tombstone', async () => {
  const h = harness(); await h.fx.ready;
  const hooks = h.start(); tick(hooks, [], { activeTime: 0 });
  tick(hooks, [last], { complete: true });
  assert.equal(h.fx.nativeContexts.get(11).state.active, false);
  assert.ok(h.sounds.every(s => s.isCurrent()));
  assert.equal(h.fx.associate(launch({ targetId: 13 })), true);
  tick(hooks, [last]);
  assert.deepEqual(h.sounds.map(s => s.type), [1, 2]);
  assert.ok(h.sounds.every(s => s.isCurrent()), 'extra retired ticks cannot cancel already emitted completion sounds');
  assert.equal(h.packets.length, 0);
});

test('cancel and session clear retire pending metadata, saved associations and deferred native sound', async () => {
  for (const clear of [false, true]) {
    const h = harness(); await h.fx.ready;
    const hooks = h.start(); tick(hooks, [], { activeTime: 0 });
    h.fx.associate(launch({ targetId: 13 }));
    if (clear) h.fx.clear(); else h.fx.cancel(11);
    assert.equal(h.sounds[0].isCurrent(), false);
    hooks.configure({ schedule, modelSource }); hooks.start(1); tick(hooks, [last]);
    assert.equal(h.dispatched.length, 1); assert.equal(h.sounds.length, 1);
    assert.equal(h.fx.associate(launch()), !clear, 'cancel retains a tombstone until a replacement cast; session clear drops all');
    assert.equal(h.clears, clear ? 1 : 0);
  }
});

test('a replacement cast prevents old hooks or late metadata from controlling the new cast', async () => {
  const h = harness(); await h.fx.ready;
  const older = h.start(); tick(older, [], { activeTime: 0 });
  const previousSound = h.sounds[0];
  h.actors.get(11).castGeneration++;
  const latest = h.start();
  older.configure({ schedule, modelSource }); older.start(2); tick(older, [last]);
  assert.equal(previousSound.isCurrent(), false);
  assert.equal(h.dispatched.length, 1);
  tick(latest, [], { activeTime: 0 }); tick(latest, [last]);
  assert.deepEqual(h.dispatched.map(d => d.plan.phase), ['c', 'c', 's']);
  assert.ok(h.sounds.slice(1).every(s => s.isCurrent()));
});

test('caster identity replacement retires old work even if object ID and cast generation repeat', async () => {
  const h = harness(); await h.fx.ready;
  const hooks = h.start(); tick(hooks, [], { activeTime: 0 });
  const original = h.actors.get(11), anchor = h.dispatched[0].anchorFor(original);
  h.actors.set(11, h.actor(11));
  assert.equal(h.sounds[0].isCurrent(), false); assert.equal(anchor.pos(), null);
  tick(hooks, [last]); assert.equal(h.dispatched.length, 1);
});

test('associated actors cannot rebind attachment anchors to a replacement with the same object ID', async () => {
  const h = harness(); await h.fx.ready;
  const hooks = h.start(), original = h.actors.get(13);
  h.fx.associate(launch({ targetId: 13 }));
  h.actors.set(13, h.actor(13));
  tick(hooks, [last]);
  const shot = h.dispatched[0];
  assert.equal(shot.plan.calls[0].target, original);
  assert.equal(shot.anchorFor(original).pos(), null);
  assert.equal(shot.anchorFor(original).node('root'), null);
});

test('missing or replaced action targets never deliver native skill notifies', async () => {
  const h = harness(); await h.fx.ready;
  const hooks = h.start();
  h.actors.set(12, h.actor(12));
  tick(hooks, [last]);
  assert.equal(h.dispatched.length, 0); assert.equal(h.sounds.length, 0);
  h.actors.delete(12);
  const rejected = h.fx.prepareCast(msg); assert.ok(rejected);
  rejected.configure({ schedule, modelSource }); rejected.start(1);
  tick(rejected, [], { activeTime: 0 });
  assert.equal(h.fx.nativeContexts.get(11).retired, true);
  assert.equal(h.fx.associate(launch({ targetId: 13 })), true);
  assert.equal(h.dispatched.length, 0);
});

test('a cast begun with a cold effect index remains entirely on the provisional packet path', async () => {
  let resolve;
  const h = harness(new Promise(r => { resolve = r; }));
  assert.equal(h.fx.prepareCast(msg), null);
  const pendingCast = h.fx.handle(msg);
  resolve(sourceIndex()); assert.equal(await pendingCast, true);
  assert.equal(h.fx.associate(launch()), false, 'warming the index does not adopt an already-started cast');
  assert.equal(await h.fx.handle(launch()), true);
  assert.deepEqual(h.packets.map(p => p[0]), ['cast', 'launch']);
  assert.equal(h.dispatched.length, 0); assert.equal(h.sounds.length, 0);
});

test('mismatched launches are consumed without changing the reserved cast and dead casters cannot reserve one', async () => {
  const h = harness(); await h.fx.ready;
  const hooks = h.start();
  assert.equal(h.fx.associate(launch({ skillId: 78, targetId: 13 })), true);
  tick(hooks, [last]);
  assert.deepEqual(h.dispatched[0].plan.calls.map(c => c.target), [h.actors.get(12)]);
  h.actors.get(11).dead = true;
  assert.equal(h.fx.prepareCast(msg), null);
});

test('retired and completed tombstones release actor graphs and ignore delayed reconfiguration',async()=>{
 for(const completed of [false,true]){
   const h=harness();await h.fx.ready;
   const hooks=h.start();tick(hooks,[],{activeTime:0});h.fx.associate(launch({targetId:13}));
   if(completed)tick(hooks,[last],{complete:true});else h.fx.cancel(11);
   const context=h.fx.nativeContexts.get(11);
   assert.equal(context.actorIds.size,0);assert.equal(context.associations.length,0);
   assert.equal(context.state.caster,undefined);assert.equal(context.state.entry,undefined);
   const state=context.state;hooks.configure({schedule,modelSource});
   assert.equal(context.state,state,'late metadata cannot refill a tombstone');
   assert.equal(h.fx.associate(launch({targetId:13})),true);assert.equal(context.actorIds.size,0);
   assert.ok((h.fx.lastNativeTick?.dispatches||[]).every(d=>d.plan.calls.every(c=>c.caster===undefined&&c.target===undefined)));
 }
});
