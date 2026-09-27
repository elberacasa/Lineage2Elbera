// Elbera Tools: actual dispatch/legacy-fallback code with synthetic data.
// This proves binding exclusion, not original particle rendering or timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { skillAgentBinding, skillAgentFlyingTime } from '../js/skillvfx-binding.js';
import { skillAnimInfo } from '../js/gamedata.js';
import { selectSkillActions } from '../js/skillaction-dispatch.js';

const vfxSource = fs.readFileSync(new URL('../js/skillvfx.js', import.meta.url), 'utf8');
const skillsSource = fs.readFileSync(new URL('../js/skills.js', import.meta.url), 'utf8');
function slice(source, start, end) {
  const a = source.indexOf(start), b = end ? source.indexOf(end, a) : source.length;
  assert.ok(a >= 0 && b > a, `production boundary ${start}`);
  return source.slice(a, b);
}
function runtime(index) {
  const made = [], clock = { now: 1000 };
  class Instance {
    constructor(fx, _index, scene, anchor, action, attachment) {
      made.push({ fx, anchor, action, attachment });
      this.disposed = false;
    }
    dispose() { this.disposed = true; }
    update() { return true; }
  }
  const context = vm.createContext({ _index: index, Instance, vfxIndex() {}, skillAgentBinding, skillAgentFlyingTime,
    performance: { now: () => clock.now } });
  const source = slice(vfxSource, 'const EAM_NONE', 'let _index')
    + slice(vfxSource, 'function anchorNode(', 'export function vfxIndex')
    + slice(vfxSource, 'function resolveActionAttachment(', 'class Instance')
    + slice(vfxSource, 'function explicitSkill(', '/** The Object3D')
    + slice(vfxSource, 'export class SkillVfx');
  const exports = vm.runInContext(source.replaceAll('export ', '')
    + '\n({ SkillVfx, flyingTime });', context);
  return { ...exports, player: new exports.SkillVfx({}), made, clock };
}
const anchors = { caster: { pos: () => ({ x: 1, y: 2, z: 3 }) },
  target: { pos: () => ({ x: 4, y: 5, z: 6 }) } };
function binding(b) {
  return { b, f: 3, c: [{ f: 0 }], h: [{ f: 0 }],
    s: [{ f: 0, g: 1 }], x: [{ f: 0, g: 1 }] };
}

test('heuristic, unknown and malformed bindings cannot report availability, timing or spawn', () => {
  const index = { skill: { 7: binding(2), 8: binding(undefined), 9: binding('1') },
    fx: [{ e: [{}] }] };
  const h = runtime(index);
  for (const id of [7, 8, 9, 999]) {
    assert.equal(h.player.has(id), false);
    assert.equal(h.flyingTime(id, 1), null);
    assert.equal(h.player.cast(id, anchors), false);
    assert.equal(h.player.launch(id, anchors), false);
  }
  assert.equal(h.made.length, 0);
  assert.equal(h.player.live.length, 0);
  assert.equal(h.player.pending.length, 0);
  assert.equal(index.skill[7].b, 2, 'diagnostic record remains intact');
});

test('absent metadata fails closed for every public binding entry point', () => {
  for (const index of [null, {}, { skill: {} }]) {
    const h = runtime(index);
    assert.equal(h.player.has(7), false);
    assert.equal(h.flyingTime(7, 1), null);
    assert.equal(h.player.cast(7, anchors), false);
    assert.equal(h.player.launch(7, anchors), false);
  }
});

function sourceIndex(entry = binding(1)) {
  entry.path = 'Skill.wh.shared';
  return { format: 'l2-interlude-skill-vfx-v2',
    objects: { 'skill.wh.shared': entry }, fx: [{ e: [{}] }],
    bindings: { 7: { levels: [1, 2, 4], path: 'Skill.wh.shared',
      overrides: { 2: '', 4: 'Skill.wh.missing' } } } };
}

test('exact skill-level source paths dispatch the actual selected object and flight value', () => {
  const entry = binding(1);
  const h = runtime(sourceIndex(entry));
  assert.equal(h.player.has(7, 1), true);
  assert.equal(h.flyingTime(7, 1), 3);
  assert.equal(h.player.cast(7, anchors, 1), true);
  assert.equal(h.player.launch(7, anchors, 1), true);
  assert.equal(h.made.length, 2); // c, target-bound s; x waits for FlyingTime
  assert.equal(h.made[0].action, entry.c[0]);
  assert.equal(h.made[1].action, entry.s[0]);
  assert.equal(h.made[1].anchor, anchors.target);
  assert.equal(h.player.pending.length, 1);
  h.player.pending[0].fn();
  assert.equal(h.made[2].action, entry.x[0]);
  assert.ok(h.made.every(made => !entry.h.includes(made.action)));
});

test('packet cast creates only casting actions and never schedules packed channeling actions', () => {
  const entry = { f: 0, c: [{ f: 0 }, { f: 0, d: .5 }],
    h: [{ f: 0 }, { f: 0, d: .1 }] };
  const h = runtime(sourceIndex(entry));
  assert.equal(h.player.cast(7, anchors, 1), true);
  assert.deepEqual(h.made.map(made => made.action), [entry.c[0]]);
  assert.equal(h.player.pending.length, 1, 'only the casting SpawnDelay is scheduled');
  h.player.pending[0].fn();
  assert.deepEqual(h.made.map(made => made.action), entry.c);
  assert.equal(entry.h.length, 2, 'original channeling metadata is retained');

  const channelingOnly = runtime(sourceIndex({ f: 0, h: entry.h }));
  assert.equal(channelingOnly.player.has(7, 1), true, 'the source Agent remains present');
  assert.equal(channelingOnly.player.cast(7, anchors, 1), true);
  assert.equal(channelingOnly.made.length, 0);
  assert.equal(channelingOnly.player.pending.length, 0);
});

test('empty override, unresolved reference and unknown level remain separate without fallback', () => {
  const index = sourceIndex(), h = runtime(index);
  assert.equal(skillAgentBinding(index, 7, 2).status, 'source-none');
  assert.equal(h.flyingTime(7, 2), null, 'no Agent cannot authorize instant legacy impact');
  assert.equal(skillAgentBinding(index, 7, 4).status, 'unresolved-source-path');
  assert.equal(h.flyingTime(7, 4), null);
  for (const level of [undefined, 0, 3, 99, '1']) {
    assert.equal(skillAgentBinding(index, 7, level).status, 'missing-exact-metadata');
    assert.equal(h.flyingTime(7, level), null);
  }
  for (const level of [undefined, 2, 3, 4, 99]) {
    assert.equal(h.player.has(7, level), false);
    assert.equal(h.player.cast(7, anchors, level), false);
    assert.equal(h.player.launch(7, anchors, level), false);
  }
  assert.equal(h.made.length, 0);
});

test('Agent remains present with exact Float32 FlyingTime even without a drawable action', () => {
  const flight = Math.fround(.4);
  const index = sourceIndex({ f: flight }), h = runtime(index);
  assert.equal(h.player.has(7, 1), true);
  assert.equal(h.flyingTime(7, 1), flight);
  assert.equal(h.player.cast(7, anchors, 1), true);
  assert.equal(h.player.launch(7, anchors, 1), true);
  assert.equal(h.made.length, 0);
});

test('launch sound never treats an absent Agent as a zero-flight impact', () => {
  const index = sourceIndex({ f: 0 }), timers = [], played = [];
  const soundSource = fs.readFileSync(new URL('../js/gamesound.js', import.meta.url), 'utf8');
  const GameSound = vm.runInNewContext(soundSource.replace(/^import .*;$/gm, '').replaceAll('export ', '')
    + '\nGameSound;', { flyingTime: (id, level) => skillAgentFlyingTime(index, id, level),
    setTimeout: (fn, ms) => timers.push({ fn, ms }) });
  const sound = new GameSound(); sound.ready = true;
  sound._play = (phase, id, position) => played.push({ phase, id, position });
  const target = { role: 'target' }, caster = { role: 'caster' };
  for (const level of [2, 4, 99]) sound.launch(7, target, caster, level);
  assert.deepEqual(played.map(p => p.phase), ['s', 's', 's']);
  assert.equal(timers.length, 0);
  played.length = 0;
  sound.launch(7, target, caster, 1);
  assert.deepEqual(played, [{ phase: 's', id: 7, position: caster }, { phase: 'x', id: 7, position: target }]);
  index.objects['skill.wh.shared'].f = Math.fround(.4);
  played.length = 0; sound.launch(7, target, caster, 1);
  assert.equal(timers.length, 1); assert.equal(timers[0].ms, Math.fround(.4) * 1000);
  assert.deepEqual(played.map(p => p.phase), ['s']);
  timers[0].fn(); assert.equal(played[1].phase, 'x');
});

test('animation metadata requires original level membership and preserves empty exact overrides', () => {
  const base = { levels: [1, 2, 4], animation: 'A', vfx: 'Skill.wh.shared' };
  const empty = { animation: '', vfx: '' };
  const changed = { animation: 'B', vfx: 'Skill.wh.other' };
  const meta = { 7: base, '7_2': empty, '7_4': changed };
  assert.equal(skillAnimInfo(meta, 7), base, 'ID-only compatibility requests source level 1');
  assert.equal(skillAnimInfo(meta, 7, 1), base);
  assert.equal(skillAnimInfo(meta, 7, 2), empty);
  assert.equal(skillAnimInfo(meta, 7, 4), changed);
  for (const level of [0, 3, 99, '1', null]) assert.equal(skillAnimInfo(meta, 7, level), null);
  assert.equal(skillAnimInfo({ 7: { animation: 'A' } }, 7, 1), null, 'legacy ID-only table is unproven');
  assert.equal(skillAnimInfo({ 7: { levels: [2], animation: 'A' } }, 7), null, 'level 2 cannot stand in for level 1');
  assert.equal(skillAnimInfo(meta, 999, 1), null);
});

test('legacy SkillFx.flash never manufactures a sprite, even without skill metadata', () => {
  let updates = 0, clears = 0;
  const scene = { add() { assert.fail('unbound flash added a visual'); } };
  const context = vm.createContext({ _activeFx: null, vfxIndex: async () => ({}), SkillVfx: class {
    update() { updates++; }
    clear() { clears++; }
  } });
  const SkillFx = vm.runInContext(slice(skillsSource, 'export class SkillFx', "\nimport { SkillVfx")
    .replace('export ', '') + '\nSkillFx;', context);
  // There is intentionally no document/canvas/THREE in this context.
  const fx = new SkillFx(scene);
  fx.flash({ x: 0, y: 0, z: 0 });
  fx.flash({ x: 0, y: 0, z: 0 }, 0xfff2a8);
  assert.equal(fx.fx.length, 0);
  fx.update(); fx.clear();
  assert.equal(updates, 1);
  assert.equal(clears, 1);
});


function dispatchHarness(pending = Promise.resolve({})) {
  const received = [], actors = new Map();
  const actor = id => ({ heightM: 2, group: { position: { id }, rotation: { y: 0 }, getObjectByName: () => null } });
  actors.set(11, actor(11)); actors.set(12, actor(12));
  const context = vm.createContext({ _activeFx: null, vfxIndex: () => pending,
    SkillVfx: class {
      cast(id, anchors, level) { received.push(['cast', id, level, anchors]); return true; }
      launch(id, anchors, level) { received.push(['launch', id, level, anchors]); return true; }
      clear() {} update() {}
    } });
  const SkillFx = vm.runInContext(slice(skillsSource, 'export class SkillFx', "\nimport { SkillVfx")
    .replace('export ', '') + '\nSkillFx;', context);
  const fx = new SkillFx({}, { getEntity: id => actors.get(id) });
  return { fx, received, actors, actor };
}

test('gateway events preserve exact levels through packet bursts without a debug log or replay', async () => {
  const h = dispatchHarness();
  for (let i = 0; i < 80; i++) {
    await h.fx.handle({ op: i % 2 ? 'skillLaunch' : 'skillCast', casterId: 11, targetId: 12, skillId: 7, level: i + 1 });
  }
  assert.equal(h.received.length, 80);
  assert.deepEqual(h.received.map(r => r[2]), Array.from({ length: 80 }, (_, i) => i + 1));
  h.fx.update(); h.fx.update(); assert.equal(h.received.length, 80);
  assert.equal(await h.fx.handle({ op: 'unrelated' }), false);
  assert.deepEqual(h.received[0][3].caster.pos(), { id: 11 });
});

test('session reset or actor replacement retires deferred metadata and old attachment anchors', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const h = dispatchHarness(pending);
  const event = { op: 'skillCast', casterId: 11, targetId: 12, skillId: 7, level: 4 };
  const retired = h.fx.handle(event); h.fx.clear(); resolve({});
  assert.equal(await retired, false); assert.equal(h.received.length, 0);
  await h.fx.handle(event);
  const anchors = h.received[0][3];
  h.actors.set(12, h.actor(12)); assert.equal(anchors.target.pos(), null);
  h.actors.delete(11); assert.equal(anchors.caster.pos(), null);
  assert.equal(await h.fx.handle(event), false);
});


test('cancel or superseding cast retires pending metadata without affecting another actor', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; }), h = dispatchHarness(pending);
  const event = { op: 'skillCast', casterId: 11, targetId: 12, skillId: 7, level: 4 };
  const cancelled = h.fx.handle(event); h.fx.cancel(11);
  const older = h.fx.handle({ ...event, level: 1 });
  const latest = h.fx.handle({ ...event, level: 2 });
  const other = h.fx.handle({ ...event, casterId: 12, targetId: 11 });
  resolve({});
  assert.equal(await cancelled, false); assert.equal(await older, false);
  assert.equal(await latest, true); assert.equal(await other, true);
  assert.deepEqual(h.received.map(r => r.slice(0, 3)), [['cast', 7, 2], ['cast', 7, 4]]);
});

test('delayed phases do not create particles at the origin after their actor disappears', () => {
  const entry = { ...binding(1), c: [{ f: 0, d: 1 }], h: [], s: [{ f: 0, g: 1, d: 1 }] };
  const h = runtime(sourceIndex(entry)); let alive = true;
  const actor = { pos: () => alive ? {} : null };
  h.player.cast(7, { caster: actor, target: actor }, 1);
  h.player.launch(7, { caster: actor, target: actor }, 1);
  assert.equal(h.player.pending.length, 3); assert.equal(h.made.length, 0);
  alive = false;
  for (const work of h.player.pending) work.fn();
  assert.equal(h.made.length, 0);
});

const sourceAction = (sourceIndex, extra = {}) => ({ sourceIndex, actionRef: sourceIndex + 1,
  actionPath: `Fixture.Action${sourceIndex}`, actionStatus: 'resolved-locate-effect',
  stage: 0, stageSerialized: true, f: 0, ...extra });
const sourceActions = (phase, actions) => ({ actionFormat: 'l2-skill-action-records-v1', f: 0,
  c: [], h: [], p: [], s: [], x: [], [phase]: actions });

test('native dispatch uses actual ordered selector calls, including duplicate associations and explicit source anchors', () => {
  const caster = {}, main = {}, first = {}, second = {};
  const actorAnchors = new Map([caster, main, first, second].map(actor => [actor, { pos: () => actor }]));
  const actions = [sourceAction(0), sourceAction(1, { g: 3 }), sourceAction(2, { g: 1 })];
  const entry = sourceActions('s', actions);
  const plan = selectSkillActions({ entry, phase: 's', caster, mainTarget: main,
    associatedActors: [second, first, second], stageShot: 1, pending: 2 });
  const h = runtime(sourceIndex(entry));
  assert.equal(h.player.dispatchActions(plan, actor => actorAnchors.get(actor), () => true), true);
  assert.deepEqual(h.made.map(made => made.action), [actions[0], actions[1], actions[1], actions[1], actions[2]]);
  assert.deepEqual(h.made.map(made => made.anchor),
    [caster, second, first, second, main].map(actor => actorAnchors.get(actor)));
  assert.equal(h.player.pending.length, 0, 'native dispatch never invents a flight or explosion deadline');
});

test('native no-op, unsupported plans and actions without drawable source produce no replacement effects', () => {
  const caster = {}, entry = sourceActions('p', [sourceAction(0)]);
  const h = runtime(sourceIndex(entry));
  const preshot = selectSkillActions({ entry, phase: 'p' });
  assert.equal(h.player.dispatchActions(preshot, () => assert.fail('preshot requested an anchor'), () => true), true);
  assert.equal(h.player.dispatchActions({ status: 'unsupported-action-reference', calls: [
    { action: sourceAction(0), caster, target: caster },
  ] }, () => assert.fail('unsupported plan requested an anchor'), () => true), false);
  const withoutEffect = sourceAction(0); delete withoutEffect.f;
  const nondrawable = sourceActions('c', [withoutEffect, sourceAction(1, { f: 99 })]);
  const plan = selectSkillActions({ entry: nondrawable, phase: 'c', caster, mainTarget: caster });
  assert.equal(plan.calls.length, 2, 'source callbacks remain present independently of drawable effects');
  assert.equal(h.player.dispatchActions(plan, () => assert.fail('missing effect requested an anchor'), () => true), true);
  assert.equal(h.made.length, 0); assert.equal(h.player.pending.length, 0);
});

test('native delayed action guards owner retirement and actor identity without deleting already spawned effects', () => {
  const caster = {}, target = {}; let current = true, targetPresent = true;
  const targetAnchor = { pos: () => targetPresent ? target : null };
  const actions = [sourceAction(0), sourceAction(1, { d: .5 }), sourceAction(2, { d: .5, g: 1 })];
  const entry = sourceActions('c', actions), h = runtime(sourceIndex(entry));
  const plan = selectSkillActions({ entry, phase: 'c', caster, mainTarget: target });
  const anchorFor = actor => actor === target ? targetAnchor : { pos: () => caster };
  h.player.dispatchActions(plan, anchorFor, () => current);
  assert.equal(h.made.length, 1); assert.equal(h.player.pending.length, 2);
  targetPresent = false; h.clock.now = 1500; h.player.update();
  assert.deepEqual(h.made.map(made => made.action), [actions[0], actions[1]], 'missing target cannot spawn at origin');
  assert.equal(h.player.pending.length, 0);
  h.player.dispatchActions(plan, anchorFor, () => current);
  const spawned = h.player.live.slice();
  current = false; h.clock.now = 2000; h.player.update();
  assert.equal(h.made.length, 3, 'retired owner prevents later construction');
  assert.equal(h.player.live.length, spawned.length);
  assert.ok(spawned.every(instance => !instance.disposed), 'already spawned independent effects stay alive');
});

test('actual pending queue retains source insertion order at equal deadlines and processes each action once', () => {
  const caster = {}, entry = sourceActions('c', [
    sourceAction(0, { d: 1 }), sourceAction(1, { d: .5 }),
    sourceAction(2, { d: .5 }), sourceAction(3, { d: 1 }),
  ]);
  const h = runtime(sourceIndex(entry)), anchor = { pos: () => caster };
  const plan = selectSkillActions({ entry, phase: 'c', caster, mainTarget: caster });
  h.player.dispatchActions(plan, () => anchor, () => true);
  assert.equal(h.player.pending.length, 4); assert.equal(h.made.length, 0);
  h.clock.now = 1499; h.player.update(); assert.equal(h.made.length, 0);
  h.clock.now = 2000; h.player.update();
  assert.deepEqual(h.made.map(made => made.action.sourceIndex), [1, 2, 0, 3]);
  assert.equal(h.player.pending.length, 0);
  h.player.update(); assert.equal(h.made.length, 4);
});

test('missing explicit source hand/bone attachments cannot construct an emitter or fall back to actor centre', () => {
  for (const [at,b,expectedName] of [[1,undefined,'Weapon_R_Bone'],[2,undefined,'Weapon_L_Bone'],[3,'OriginalBone','OriginalBone']]) {
    for (const node of [null, { isBone:false }]) {
      const requested=[], action=sourceAction(0,{at,...(b?{b}:{})});
      const entry=sourceActions('c',[action]), h=runtime(sourceIndex(entry));
      const anchor={pos:()=>({x:1,y:2,z:3}),node:name=>{requested.push(name);return node;}};
      h.player.cast(7,{caster:anchor,target:anchor},1);
      assert.deepEqual(requested,[expectedName]);
      assert.equal(h.made.length,0,'Instance construction (and its scene/emitter allocations) is never entered');
      assert.equal(h.player.live.length,0);
      assert.equal(h.player.lastAttachmentStatus.status,'unsupported');
      assert.equal(h.player.lastAttachmentStatus.reason,'missing-exported-attachment-bone');
    }
  }
});

test('aliases and unsupported attachment ordinals never masquerade as literal bone nodes', () => {
  for (const at of [4,6,7,8,-1,1.5,null,'3']) {
    const caster={}, action=sourceAction(0,{at,b:'AliasThatAlsoNamesANode'});
    const entry=sourceActions('c',[action]),h=runtime(sourceIndex(entry));
    const plan=selectSkillActions({entry,phase:'c',caster,mainTarget:caster});
    const anchor={pos:()=>caster,node:()=>assert.fail('unsupported attachment performed direct node lookup')};
    h.player.dispatchActions(plan,()=>anchor,()=>true);
    assert.equal(h.made.length,0);assert.equal(h.player.live.length,0);
    assert.equal(h.player.lastAttachmentStatus.status,'unsupported');
    assert.equal(h.player.lastAttachmentStatus.reason,at===4?'missing-original-alias-coordinates':'unimplemented-attachment-method');
  }
});

test('resolved exact hand/bone and None/Trail admission remain distinct and preserve source node identity', () => {
  const bone={isBone:true};
  for (const at of [0,1,2,3,5]) {
    const names=[],action=sourceAction(0,{at,b:'OriginalBone'}),entry=sourceActions('c',[action]);
    const h=runtime(sourceIndex(entry));
    const anchor={pos:()=>({}),node:name=>{names.push(name);return bone;}};
    h.player.cast(7,{caster:anchor,target:anchor},1);
    assert.equal(h.made.length,1);
    assert.equal(h.made[0].attachment.method,at);
    assert.equal(h.made[0].attachment.bone,[1,2,3].includes(at)?bone:null);
    assert.deepEqual(names,at===1?['Weapon_R_Bone']:at===2?['Weapon_L_Bone']:at===3?['OriginalBone']:[]);
    assert.equal(h.player.lastAttachmentStatus.status,'ready');
  }
});

test('delayed source attachment checks the current exported bone before allocating any instance', () => {
  let bone={isBone:true};
  const entry=sourceActions('c',[sourceAction(0,{at:3,b:'OriginalBone',d:.5})]);
  const h=runtime(sourceIndex(entry)),anchor={pos:()=>({}),node:()=>bone};
  h.player.cast(7,{caster:anchor,target:anchor},1);
  assert.equal(h.player.pending.length,1);assert.equal(h.made.length,0);
  bone=null;h.clock.now=1500;h.player.update();
  assert.equal(h.made.length,0);assert.equal(h.player.pending.length,0);
  assert.equal(h.player.lastAttachmentStatus.reason,'missing-exported-attachment-bone');
});
