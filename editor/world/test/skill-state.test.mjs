// Elbera Tools: actual skill/shortcut methods with controlled DOM and metadata.
// No private assets, browser, server, accounts or timers running in background.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { skillInfo } from '../js/gamedata.js';
import { mergeSkillText } from '../js/skilltext.js';
import { ordinaryPlayerVoiceMeshType } from '../js/skillsound-binding.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const barSource = read('../js/skills.js').split('// The skill CLASSIFICATION')[0].replace('export class', 'class');
const clean = text => text.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function element() {
  const e = { dataset: {}, style: {}, children: [], events: {}, innerHTML: '',
    classes: new Set(), appendChild(c) { this.children.push(c); },
    replaceChildren() { this.children = []; }, addEventListener(n, fn) { this.events[n] = fn; },
    querySelectorAll() { return []; } };
  e.classList = { add: c => e.classes.add(c), remove: c => e.classes.delete(c),
    toggle: (c, on) => on ? e.classes.add(c) : e.classes.delete(c) };
  return e;
}
function metadata() {
  const source = { sha256: 'a'.repeat(64), decodedSHA256: 'b'.repeat(64), records: 2 };
  const row = level => ({ name: `Exact ${level}`, desc: `Description ${level}`,
    enchantName: '', enchantDesc: '', icon: `icons/test${level}.png`, iconRef: `icon.test${level}`,
    hp: 0, mp: 0, range: 0, operateType: 0, isMagic: 0, hasText: true, hasIconRecord: true });
  return mergeSkillText({ 1001: { name: 'Wrong id-only text', icon: 'wrong.png' } },
    { format: 'l2-skilltext-v1', provenance: { sources: { 'skillgrp.dat': source, 'skillname-e.dat': source },
      nameRecordCount: 2, iconRecordCount: 2, recordCount: 2, skillCount: 1 },
    skills: { 1001: { 1: row(1), 2: row(2) } } });
}
function harness() {
  let now = 1000, metaPromise = Promise.resolve(metadata()), timer = 0;
  const saved = new Map(), writes = [], casts = [], sounds = [], messages = [], handlers = {}, timers = new Map();
  const navigationCancellations = [], npcWaitRetirements = [];
  const context = vm.createContext({ performance: { now: () => now },
    setTimeout: (fn, ms) => { timers.set(++timer, { fn, at: now + ms }); return timer; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: () => ++timer,
    cancelAnimationFrame() {}, document: { createElement: element },
    Skin: { px: v => v }, Font: { set() {} }, SkillClass: { get: () => null },
    skillMeta: () => metaPromise, itemMeta: async () => ({}), skillInfo,
    sysMsgMeta: async () => ({}), renderSysMsg: (_meta, id) => `Message ${id}`, sysMsgColor: () => null,
    chat: { addSysMsg: (...args) => messages.push(args), addSystem: text => messages.push([text]) },
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => { saved.set(key, value); writes.push(key); } },
    online: true, onlineGeneration: 1, selfId: 42,
    cancelFineNavigation: reason => navigationCancellations.push(reason),
    character: {modelId: 'human_fighter_m'}, ordinaryPlayerVoiceMeshType,
    entities: { skillFlash() {}, cancelCast() {}, getEntity() {},
      retireNpcWait: (id, reason) => npcWaitRetirements.push([id, reason]) },
    skillFx: { prepareCast: () => null, associate: () => false, handle: async () => {}, cancel() {} }, entityHeadPos: () => null, gameSound: { cast: (...args) => sounds.push(args), launch: (...args) => sounds.push(args) },
    net: { on: (op, fn) => { handlers[op] = fn; } },
  });
  vm.runInContext(barSource + '\nglobalThis.SkillBar = SkillBar;', context);
  vm.runInContext(clean(read('../js/ui/skillwnd.js'))
    + '\nglobalThis.SkillWnd = SkillWnd; globalThis.skillType = skillType; globalThis.setTypes = x => { _types = x; };', context);
  vm.runInContext(clean(read('../js/ui/shortcutwnd.js')) + '\nglobalThis.ShortcutWnd = ShortcutWnd;', context);
  const bar = new context.SkillBar(null, element(), element(), element(), { onCast: id => casts.push(id) });
  const shortcut = Object.assign(Object.create(context.ShortcutWnd.prototype), {
    _skills: new Map(), _activeToggles: new Set(), _weaponGate: null, data: {}, ready: false, _pendingSlots: new Map(),
    render() {}, onUseSkill: id => casts.push(id), onNote() {}, root: element(),
  });
  const panel = Object.assign(Object.create(context.SkillWnd.prototype), {
    skills: [], panes: { active: element(), passive: element() }, pitch: { x: 37, y: 35 },
    cell: 34, cellIcon: 32, cellArt: null, _weaponGate: null, _activeToggles: new Set(),
    root: element(), _renderFoot() {}, hide() {}, onCast: id => casts.push(id),
  });
  Object.assign(context, { skillBar: bar, skillWnd: panel, shortcutWnd: shortcut });
  const main = read('../js/main.js');
  const part = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));
  vm.runInContext(part("net.on('skillList'", "net.on('acquireSkillList'")
    + part("net.on('skillCast'", '// ExAutoSoulShot')
    + part('const ACTION_FEEDBACK_MS', '// L2 world tile name')
    + part("net.on('sysMsg'", '// --- M3 combat ops'), context);
  return { context, bar, shortcut, panel, casts, sounds, messages, handlers, saved, writes, timers, navigationCancellations, npcWaitRetirements,
    advance: ms => { now += ms; for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.delete(id)) timer.fn();
    } },
    pendingMeta() { const d = deferred(); metaPromise = d.promise; return d; } };
}
const skill = (level, extra = {}) => ({ id: 1001, level, passive: false, disabled: false, ...extra });

test('received snapshots drive exact panel/shortcut levels, removals and disabled/passive availability', async () => {
  const h = harness(); h.shortcut.setShortcuts([{ page: 0, slot: 0, type: 'skill', id: 1001, characterType: 1 }]);
  const binding = h.shortcut.data[0][0];
  h.handlers.skillList({ skills: [skill(1)] });
  await tick();
  const first = element(); await h.shortcut._slotContent(first, binding);
  assert.equal(first.title, 'Exact 1'); h.shortcut.trigger(0, 0);
  h.handlers.skillList({ skills: [skill(2)] });
  await tick();
  assert.match(h.panel.panes.active.children[0].title, /Exact 2/);
  const upgraded = element(); await h.shortcut._slotContent(upgraded, binding);
  assert.equal(upgraded.title, 'Exact 2'); assert.match(upgraded.innerHTML, /test2.png/);
  assert.equal(h.bar.skills.get(1001).level, 2); assert.equal(h.shortcut.data[0][0], binding);
  assert.deepEqual(JSON.parse(JSON.stringify(binding)), { page: 0, slot: 0, type: 'skill', id: 1001, characterType: 1 });
  for (const skills of [[skill(2, { disabled: true })], [skill(2, { passive: true })], []]) {
    h.handlers.skillList({ skills }); await tick(); h.shortcut.trigger(0, 0);
    assert.equal(h.bar.skills.size, 0);
  }
  assert.deepEqual(h.casts, [1001]);
  assert.equal(h.panel.panes.active.children.length, 0); assert.equal(h.panel.panes.passive.children.length, 0);
  h.handlers.skillList({ skills: [skill(2)] }); h.shortcut.trigger(0, 0);
  assert.deepEqual(h.casts, [1001, 1001]);
});

test('server passive flag overrides conflicting static categories without losing toggle classification', () => {
  const h = harness(); h.context.setTypes({ 1001: 'ACTIVE', 1002: 'PASSIVE', 1003: 'TOGGLE' });
  assert.equal(h.context.skillType(1001, true), 'PASSIVE');
  assert.equal(h.context.skillType(1002, false), 'ACTIVE');
  assert.equal(h.context.skillType(1003, false), 'TOGGLE');
  assert.equal(h.context.skillType(1002), 'PASSIVE');
});

test('session reset clears skill reuse while a level-up snapshot preserves ongoing server reuse', () => {
  const h = harness(); h.bar.register([skill(1)]); h.bar.setReuse(1001, 60000, 45000);
  h.advance(1000); h.bar.register([skill(2)]);
  assert.equal(h.bar.reuseLeft(1001).left, 44000);
  h.bar.startCastBar(1001, 2, 2000); assert.notEqual(h.bar.cast, null);
  h.bar.clear(); h.bar.register([skill(1)]);
  assert.equal(h.bar.cast, null); assert.equal(h.bar.reuseLeft(1001), null);
  assert.equal(h.bar.castBar.classes.has('visible'), false);
});

test('pending metadata cannot restore skills after reset or supply a retired level to a shortcut', async () => {
  const h = harness(), pending = h.pendingMeta();
  h.shortcut.setShortcuts([{ page: 0, slot: 0, type: 'skill', id: 1001, characterType: 1 }]);
  h.handlers.skillList({ skills: [skill(1)] });
  const retired = element(), content = h.shortcut._slotContent(retired, h.shortcut.data[0][0]);
  h.panel.clear(); h.shortcut.reset(); h.bar.clear();
  pending.resolve(metadata()); await content; await Promise.resolve();
  assert.equal(h.panel.panes.active.children.length, 0); assert.equal(h.panel.skills.length, 0);
  assert.equal(retired.title, 'Skill #1001'); assert.doesNotMatch(retired.innerHTML, /test1.png/);
  h.shortcut.setShortcuts([]); assert.deepEqual(Object.keys(h.shortcut.data), []);
  h.shortcut.setShortcuts([{ page: 0, slot: 0, type: 'skill', id: 1001, characterType: 1 }]);
  h.shortcut.trigger(0, 0); assert.deepEqual(h.casts, []);
  assert.equal(h.shortcut.data[0][0].id, 1001);
  const writes = h.writes.length; h.shortcut.reset(); h.shortcut.assign(0, 0, { type: 'action', id: 1 });
  assert.equal(h.writes.length, writes); assert.equal(h.shortcut.ready, false);
});

test('cast bar starts on packet time; delayed metadata cannot revive cancellation, completion or old sessions', async () => {
  const h = harness(), pending = h.pendingMeta();
  h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 1, hitTime: 2000, reuse: 5000 });
  assert.equal(h.bar.cast.t0, 1000);
  h.handlers.skillCancel({ casterId: 43 }); assert.notEqual(h.bar.cast, null);
  h.handlers.skillCancel({ casterId: 42 }); assert.equal(h.bar.cast, null);
  pending.resolve(metadata()); await Promise.resolve(); assert.equal(h.bar.cast, null);
  const next = h.pendingMeta();
  h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 1, hitTime: 2000 });
  h.advance(100); h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 2, hitTime: 3000 });
  next.resolve(metadata()); await Promise.resolve();
  assert.equal(h.bar.castName.textContent, 'Exact 2'); assert.equal(h.bar.cast.t0, 1100);
  const retired = h.pendingMeta();
  h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 1, hitTime: 2000 });
  h.bar.clear(); h.context.onlineGeneration++; retired.resolve(metadata()); await Promise.resolve();
  assert.equal(h.bar.cast, null); assert.equal(h.bar.reuse.size, 0);
  const completed = h.pendingMeta();
  h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 1, hitTime: 2000 });
  h.advance(2001); assert.equal(h.bar.cast, null);
  completed.resolve(metadata()); await Promise.resolve(); assert.equal(h.bar.cast, null);
});

test('received self cast cancels navigation before presentation; remote casts do not', () => {
  const h = harness(), presentation = [];
  h.context.skillFx.prepareCast = msg => {
    presentation.push({ casterId: msg.casterId, cancellations: [...h.navigationCancellations] });
    return null;
  };
  const cast = { skillId: 1001, level: 1, hitTime: 2000 };
  h.handlers.skillCast({ ...cast, casterId: 43 });
  assert.deepEqual(h.navigationCancellations, []);
  // No outgoing skill request: item-triggered/server-started casts also stop
  // automatic route probes before they can interrupt this cast with a move.
  h.handlers.skillCast({ ...cast, casterId: 42 });
  assert.deepEqual(h.navigationCancellations, ['server-cast']);
  assert.deepEqual(presentation, [
    { casterId: 43, cancellations: [] },
    { casterId: 42, cancellations: ['server-cast'] },
  ]);
  assert.notEqual(h.bar.cast, null);
});

test('ActionFailed cannot cancel a cast with no debug log or stale cancellation evidence', () => {
  const h = harness();
  h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 1, hitTime: 2000 });
  const cast = h.bar.cast;
  h.handlers.actionFailed();
  assert.equal(h.bar.cast, cast, 'bare denial has no cancellation meaning');
  for (const old of [{ op: 'skillCancel', casterId: 42 },
    { op: 'sysMsg', id: 27 }, { op: 'sysMsg', id: 748 }]) {
    h.context.window = { __world: { net: { selfId: 42, log: [{ dir: 'in', ...old }] } } };
    h.handlers.actionFailed();
    h.advance(50);
    assert.equal(h.bar.cast, cast, 'a historical log entry cannot become a new cancellation');
  }
  h.context.window.__world.net.log.push({ dir: 'in', op: 'skillCancel', casterId: 43 });
  h.handlers.skillCancel({ casterId: 43 });
  h.advance(50);
  assert.equal(h.bar.cast, cast, 'another caster cancellation is unrelated');
  h.handlers.skillCancel({ casterId: 42 });
  assert.equal(h.bar.cast, null, 'the current own cancellation arrives by direct dispatch');
});

test('explicit interruption messages cancel on receipt; delayed text cannot cancel or restore another cast', async () => {
  for (const id of [27, 748]) {
    const h = harness(), pending = h.pendingMeta();
    h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 1, hitTime: 2000 });
    h.handlers.sysMsg({ id });
    assert.equal(h.bar.cast, null, `system message ${id} acts before text loads`);
    assert.equal(h.messages.length, 0);
    h.handlers.skillCast({ casterId: 42, skillId: 1001, level: 2, hitTime: 3000 });
    const current = h.bar.cast;
    pending.resolve(metadata()); await tick();
    assert.equal(h.bar.cast, current);
    assert.equal(h.bar.castName.textContent, 'Exact 2');
    assert.equal(h.messages.length, 1);
    h.handlers.sysMsg({ id: 48 });
    assert.equal(h.bar.cast, current, 'reuse denial is not an interruption');
  }
});

test('expiration runs without animation frames and queued old callbacks cannot stop a newer cast', () => {
  const h = harness();
  h.bar.startCastBar(1001, 1, 1000);
  const oldTimer = h.timers.get(h.bar.cast.timer).fn;
  h.advance(500);
  h.bar.startCastBar(1001, 2, 2000);
  const current = h.bar.cast;
  oldTimer();
  assert.equal(h.bar.cast, current);
  h.advance(1999);
  assert.equal(h.bar.cast, current);
  h.advance(1);
  assert.equal(h.bar.cast, null);
  assert.equal(h.bar.castBar.classes.has('visible'), false);
  assert.equal(h.timers.size, 0);
});


test('launch sound receives exact gateway level and caster/target anchors', () => {
  const h = harness();
  h.context.entityHeadPos = id => ({ actorId: id });
  h.handlers.skillLaunch({ op: 'skillLaunch', casterId: 42, targetId: 77, skillId: 1001, level: 3 });
  assert.deepEqual(h.npcWaitRetirements, [[77, 'incoming-skill']]);
  assert.deepEqual(h.sounds, [[1001, { actorId: 77 }, { actorId: 42 }, 3, 0]]);
});

test('incoming skill retires its target before native association or absent-position early returns', () => {
  const h = harness(), associations = [];
  h.context.skillFx.associate = msg => {
    associations.push({ targetId: msg.targetId, retired: h.npcWaitRetirements.map(row => [...row]) });
    return msg.targetId === 77;
  };
  for (const targetId of [77, 88]) {
    h.handlers.skillLaunch({ op: 'skillLaunch', casterId: 42, targetId, skillId: 1001, level: 1 });
  }
  assert.deepEqual(associations, [
    { targetId: 77, retired: [[77, 'incoming-skill']] },
    { targetId: 88, retired: [[77, 'incoming-skill'], [88, 'incoming-skill']] },
  ]);
  assert.deepEqual(h.sounds, [], 'unavailable positions do not suppress target retirement');
});


test('skill audio uses the caster model voice index, including remote casts and target changes', () => {
  const h=harness();h.context.entityHeadPos=id=>({id});
  const event={casterId:42,targetId:99,skillId:1001,level:2,hitTime:0};
  h.handlers.skillCast(event);h.handlers.skillLaunch(event);
  assert.equal(h.sounds[0][3],0);assert.equal(h.sounds[1][4],0);
  h.context.entities.getEntity=id=>id===99?{kind:'player',modelId:'dwarf_f'}:null;
  h.handlers.skillCast({...event,casterId:99,targetId:42});
  assert.equal(h.sounds.at(-1)[3],5);
  h.context.entities.getEntity=()=>({kind:'npc',modelId:'dwarf_f'});
  h.handlers.skillCast({...event,casterId:99});assert.equal(h.sounds.at(-1)[3],null);
  h.context.character.modelId='unknown-transformation';
  h.handlers.skillCast(event);assert.equal(h.sounds.at(-1)[3],null);
});

test('native Agent reservation routes the cast hook and association bypasses packet presentation',async()=>{
  const h=harness(),hooks={},gestures=[],packets=[];
  h.context.skillFx.prepareCast=()=>hooks;
  h.context.skillFx.handle=async msg=>packets.push(msg);
  h.context.skillFx.associate=()=>true;
  h.context.entities.skillFlash=(...args)=>gestures.push(args);
  h.context.entityHeadPos=()=>({x:1,y:2,z:3});
  const msg={op:'skillCast',casterId:42,targetId:43,skillId:1001,level:2,hitTime:1000,reuseDelay:0};
  h.handlers.skillCast(msg);h.handlers.skillLaunch({...msg,op:'skillLaunch'});
  await tick();
  assert.equal(gestures[0][2],hooks);assert.deepEqual(packets,[]);assert.deepEqual(h.sounds,[]);
});
