// Elbera Tools: source-free selector regressions. The independent original-DLL
// proof is tools/ui/check_skillanim_native.py --check, not this fixture table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { nativeSkillSlots } from '../js/native-skillanim.js';
import { castPlan, castSchedule } from '../js/castanim.js';
import { skillAgentBinding } from '../js/skillvfx-binding.js';
import { skillAnimInfo } from '../js/gamedata.js';

function pawn() {
  const names = ['castShort', 'castMid', 'castLong', 'castEnd', 'magicNoTarget',
    'magicShot', 'magicThrow', 'picItem', 'shieldAtk', 'atk01', 'atk02', 'atk03',
    ...Array.from({ length: 28 }, (_, i) => `spAtk${String(i + 1).padStart(2, '0')}`)];
  const result = { format: 'l2-interlude-pawn-animation-v2', models: { synthetic: { slots: Object.fromEntries(names.map(slot => [slot, {
    hand: { clip: `${slot}_emptyHand` }, bow: { clip: `${slot}_archer` },
  }])) } }, clips: { synthetic: {
    spAtk04_archer: { notifies: [{ kind: 'AttackPreShot', u: .1 },
      { kind: 'AttackShot', u: 0 }, { kind: 'AttackShot', u: .7 }] },
    magicShot_archer: { notifies: [{ kind: 'AttackShot', u: .6 }] },
  } } };
  for (const slot of names) for (const stance of ['emptyHand', 'archer']) {
    const key = `${slot}_${stance}`, old = result.clips.synthetic[key];
    result.clips.synthetic[key] = { originalTiming: true, frames: 46, rate: 30,
      notifies: (old?.notifies || []).map(n => ({ ...n, t: n.u, isAttackShot: n.kind === 'AttackShot' })) };
  }
  return result;
}

test('native physical codes select distinct pawn slots, including dance versus song', () => {
  // Original success branches: S=0x1edd2f, T=0x1edd70, V=0x1eddf2,
  // N=0x1edcee and W=0x1ede33. These contradicted the previous single-slot rule.
  const expected = { S: 'spAtk01', t: 'spAtk02', U: 'spAtk03', V: 'spAtk04',
    W: 'spAtk05', X: 'spAtk06', N: 'spAtk27', Y: 'shieldAtk', Z: 'spAtk28', M: 'picItem' };
  for (const [anim, slot] of Object.entries(expected)) {
    const result = castPlan(pawn(), 'synthetic', 'bow', { anim, magic: 3 }, 7000);
    assert.equal(result.cast, `${slot}_archer`, anim);
    assert.deepEqual(result.phases.map(p => p.slot), [slot]);
  }
});

test('animation code selects magic phases regardless of cast duration, school or range', () => {
  for (const hitTime of [null, 0, 500, 1000, 4999, 5000, 12000]) {
    for (const magic of [0, 1, 2, 3]) {
      for (const range of [-1, 0, 40, 900]) {
        const result = castPlan(pawn(), 'synthetic', 'bow', { anim: 'E', magic, range }, hitTime);
        assert.equal(result.cast, 'castMid_archer');
        assert.deepEqual(result.phases.map(p => p.slot), ['castMid', 'castEnd', 'magicShot']);
        assert.equal(result.launch, 'magicShot_archer');
        assert.equal(result.launchShotU, .6);
      }
    }
  }
  assert.equal(castPlan(pawn(), 'synthetic', 'hand', { anim: 'A' }, 9000).cast, 'castShort_emptyHand');
  assert.equal(castPlan(pawn(), 'synthetic', 'hand', { anim: 'i' }, 1).cast, 'castLong_emptyHand');
});

test('two-phase and combo selectors preserve native order, including the intermediate castEnd', () => {
  const examples = {
    j: ['castEnd', 'magicNoTarget'],
    L: ['castEnd', 'magicThrow'],
    Mix01: ['spAtk09', 'spAtk17', 'spAtk24'],
    Mix04: ['spAtk07', 'spAtk12', 'spAtk21'],
    Mix07: ['spAtk10', 'spAtk11', 'spAtk19'],
    MS01: ['atk01', 'atk02', 'atk03'],
  };
  for (const [anim, slots] of Object.entries(examples)) {
    assert.deepEqual(nativeSkillSlots(anim), slots);
    const plan = castPlan(pawn(), 'synthetic', 'bow', { anim }, 400);
    assert.deepEqual(plan.phases.map(p => p.slot), slots);
    assert.equal(plan.cast, `${slots[0]}_archer`);
  }
});

test('missing exported first clip remains absent instead of promoting a later phase or substituting', () => {
  const table = pawn();
  delete table.models.synthetic.slots.castMid;
  const plan = castPlan(table, 'synthetic', 'bow', { anim: 'E', magic: 1 }, 9000);
  assert.equal(plan.cast, null);
  assert.equal(plan.castShotU, null);
  assert.deepEqual(plan.phases.map(p => p.clip), [null, 'castEnd_archer', 'magicShot_archer']);
  assert.equal(plan.launch, 'magicShot_archer');
  delete table.models.synthetic.slots.spAtk04.bow;
  assert.equal(castPlan(table, 'synthetic', 'bow', { anim: 'V', magic: 0 }, 400).cast, null);
  assert.equal(castPlan(table, 'unexported', 'bow', { anim: 'S' }, 400).cast, null);
});

test('native name matching is case insensitive but never converts unknown codes into generic magic', () => {
  assert.deepEqual(nativeSkillSlots('f'), ['castMid', 'castEnd', 'magicThrow']);
  assert.deepEqual(nativeSkillSlots('mIx09'), ['spAtk09', 'spAtk15', 'spAtk26']);
  for (const anim of ['', 'O', 'Mix10', ' E', '__proto__', null, undefined, 1]) {
    assert.equal(nativeSkillSlots(anim), null);
    assert.equal(castPlan(pawn(), 'synthetic', 'hand', { anim, magic: 1 }, 9000).cast, null);
  }
  assert.throws(() => nativeSkillSlots('E').push('fabricated'), TypeError);
});

test('phase notifies come from the exact selected pawn clip, preserving a zero-time notify', () => {
  const plan = castPlan(pawn(), 'synthetic', 'bow', { anim: 'V' }, 9999);
  assert.equal(plan.castShotU, 0);
  assert.deepEqual(plan.phases[0].shotU, [0, .7]);
});

// Execute the actual Entities method with controlled metadata dependencies.
// Keeping this at the caller catches the old `plan.cast || guessedClip` bug,
// which a correct unit test of castPlan alone could not catch.
const entitiesSource = fs.readFileSync(new URL('../js/entities.js', import.meta.url), 'utf8');
const methodStart = entitiesSource.indexOf('  _playerCastGesture(ch, msg, castHooks = null) {');
const methodEnd = entitiesSource.indexOf('\n  // Social emote', methodStart);
assert.ok(methodStart >= 0 && methodEnd > methodStart, 'actual cast method boundary');
const warmStart = entitiesSource.indexOf('let _playerCastMetadata =');
const warmEnd = entitiesSource.indexOf('\nconst FALLBACK_MODEL', warmStart);
assert.ok(warmStart >= 0 && warmEnd > warmStart, 'actual metadata warmup boundary');
const characterSource = fs.readFileSync(new URL('../js/character.js', import.meta.url), 'utf8');
const cancelStart = characterSource.indexOf('  cancelCast(');
const cancelEnd = characterSource.indexOf('\n  /** Play every verified', cancelStart);
assert.ok(cancelStart >= 0 && cancelEnd > cancelStart, 'actual cancellation method boundary');
function caller(table, entry, metadata) {
  if (entry) entry = { style: 3, ...entry };
  let now = 100, metadataCalls = 0;
  const fixtureMetadata = data => data && Object.fromEntries(Object.entries(data)
    .map(([id, row]) => [id, row ? { levels: [1], style: 3, ...row } : row]));
  const context = vm.createContext({
    skillAnimMeta: () => { metadataCalls++; return Promise.resolve(metadata ? metadata() : { 77: entry }).then(fixtureMetadata); },
    pawnAnim: async () => table,
    skillAnimInfo, castPlan, castSchedule, skillAgentBinding,
    vfxIndex: async () => ({ format: 'l2-interlude-skill-vfx-v2',
      bindings: { 77: { levels: [1, 2], path: '' }, 78: { levels: [1], path: '' } } }), performance: { now: () => now },
  });
  vm.runInContext(entitiesSource.slice(warmStart, warmEnd).replace('export ', ''), context);
  const entity = vm.runInContext(`({${entitiesSource.slice(methodStart, methodEnd)}})`, context);
  const played = [];
  const character = { modelId: 'synthetic', stance: 'bow', emoteUntil: 0, skillSpeedRate: 1,
    actions: { spAtk04_archer: {}, spAtk01: {}, castMid: {}, dance: {} },
    oneShot() { assert.fail('generic clip fallback must never run'); },
    oneShotExact() { assert.fail('whole-clip stretching must never run'); },
    startCastSchedule(schedule) { played.push(schedule); return { status: 'ready' }; },
  };
  character.cancelCast = vm.runInContext(`({${characterSource.slice(cancelStart, cancelEnd)}})`, context).cancelCast;
  return { entity, character, played, advance: ms => { now += ms; },
    warm: () => context.warmPlayerCastMetadata(), get metadataCalls() { return metadataCalls; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('actual player cast caller does not replace missing original slots or absent tables', async () => {
  const missing = pawn(); delete missing.models.synthetic.slots.spAtk04;
  for (const table of [missing, null]) {
    const h = caller(table, { anim: 'V', magic: 0 });
    h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillCast', hitTime: 9000 });
    await tick();
    assert.equal(h.entity.lastCastClip, null);
    assert.equal(h.played.length, 0);
  }
});

test('actual player cast caller uses the exact native-selected clip and its notify', async () => {
  const h = caller(pawn(), { anim: 'V', magic: 3 });
  h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillCast', hitTime: 9000 });
  await tick();
  assert.equal(h.played.length, 1);
  assert.equal(h.played[0].phases[0].clip, 'spAtk04_archer');
  assert.equal(h.played[0].shotNotify.t, Math.fround(.7));
  assert.equal(h.played[0].status, 'ready');
});

test('launch never replays the first phase, including after an expired or absent cast', async () => {
  const h = caller(pawn(), { anim: 'V', magic: 3 });
  for (const emoteUntil of [0, 99, 101]) {
    h.character.emoteUntil = emoteUntil;
    h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillLaunch' });
    await tick();
  }
  assert.equal(h.played.length, 0);
});

test('cancellation while source metadata loads prevents the old cast from starting', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = caller(pawn(), null, () => pending);
  h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillCast', hitTime: 9000 });
  h.character.cancelCast();
  resolve({ 77: { anim: 'V' } });
  await tick();
  assert.equal(h.played.length, 0);
  assert.equal(h.character.emoteUntil, 0);
});

test('casts sharing one pending metadata load apply only the latest receipt', async () => {
  let resolve;
  const h = caller(pawn(), null, () => new Promise(done => { resolve = done; }));
  h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillCast', hitTime: 9000 });
  h.entity._playerCastGesture(h.character, { skillId: 78, level: 1, op: 'skillCast', hitTime: 1000 });
  assert.equal(h.metadataCalls, 1);
  resolve({ 77: { anim: 'V' }, 78: { anim: 'V' } });
  await tick();
  assert.equal(h.played.length, 1);
  assert.equal(h.played[0].hitTime, 1);
});

test('warm metadata starts the exact-level schedule synchronously at receipt', async () => {
  const h = caller(pawn(), { anim: 'V', levels: [1, 2] }, async () => ({
    77: { anim: 'S', levels: [1, 2] }, '77_2': { anim: 'V' },
  }));
  await h.warm();
  assert.equal(h.metadataCalls, 1);
  h.entity._playerCastGesture(h.character, { skillId: 77, level: 2, op: 'skillCast', hitTime: 1400 });
  assert.equal(h.played.length, 1, 'no microtask or fetch wait after warming');
  assert.equal(h.played[0].phases[0].clip, 'spAtk04_archer');
  assert.equal(h.entity.lastCastMetadataDelayMs, 0);
  h.entity._playerCastGesture(h.character, { skillId: 77, level: 99, op: 'skillCast', hitTime: 1400 });
  assert.equal(h.played.length, 1, 'unknown source level cannot borrow a known one');
  assert.equal(h.metadataCalls, 1);
});

test('actual boot dependency wait includes complete cast metadata before world initialization', async () => {
  const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const bootStart = main.indexOf('(async function boot()');
  const start = main.indexOf('await Promise.all([', bootStart), end = main.indexOf(']);', start) + 3;
  assert.ok(bootStart >= 0 && start > bootStart && end > start, 'actual boot dependency boundary');
  let resolve, warmCalls = 0, finished = false;
  const pending = new Promise(done => { resolve = done; }), ready = async () => null;
  const context = {
    Skin: { load: ready }, Font: { load: ready }, Layout: { load: ready }, NpcHtml: { load: ready },
    loadExpTable: ready, loadSkillTypes: ready, weaponGate: { load: ready }, loadSkillClass: ready,
    warmPlayerCastMetadata: () => { warmCalls++; return pending; }, shotMeta: ready, loadEquipment: ready,
    audio: { init: ready }, gameSound: { load: ready },
  };
  const bootWait = vm.runInNewContext(`(async () => { ${main.slice(start, end)} })()`, context)
    .then(() => { finished = true; });
  await tick();
  assert.equal(warmCalls, 1);
  assert.equal(finished, false);
  resolve(); await bootWait;
  assert.equal(finished, true);
});

test('metadata older than the verified final deadline cannot start an expired cast', async () => {
  let resolve;
  const table = pawn(), entry = { anim: 'V', style: 3 };
  const schedule = castSchedule(table, 'synthetic', 'bow', entry,
    { hitTimeMs: 1400, speedRate: 1, agent: { status: 'source-none' } });
  assert.equal(schedule.status, 'ready');
  const finalDeadlineMs = schedule.phases.at(-1).due * 1000;
  const h = caller(table, null, () => new Promise(done => { resolve = done; }));
  h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillCast', hitTime: 1400 });
  h.advance(finalDeadlineMs + 1);
  resolve({ 77: entry }); await tick();
  assert.equal(h.played.length, 0);
  assert.equal(h.entity.lastCastPlayback.status, 'unsupported');
  assert.equal(h.entity.lastCastPlayback.reason, 'expired-before-metadata');
  assert.equal(h.entity.lastCastPlayback.finalDeadlineMs, finalDeadlineMs);
});

test('freshness uses final source deadline rather than packet hitTime and never invents a seek', async () => {
  const table = pawn(), entry = { anim: 'V', style: 3 };
  const schedule = castSchedule(table, 'synthetic', 'bow', entry,
    { hitTimeMs: 1400, speedRate: 1, agent: { status: 'source-none' } });
  const finalDeadlineMs = schedule.phases.at(-1).due * 1000;
  assert.ok(finalDeadlineMs > 1400);
  for (const age of [1500, finalDeadlineMs]) {
    let resolve;
    const h = caller(table, null, () => new Promise(done => { resolve = done; }));
    h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillCast', hitTime: 1400 });
    h.advance(age); resolve({ 77: entry }); await tick();
    assert.equal(h.played.length, 1);
    assert.equal(h.entity.lastCastMetadataDelayMs, age);
    assert.equal(h.played[0].phases[0].due, schedule.phases[0].due);
    assert.equal(h.played[0].tween, schedule.tween, 'no shortened or skipped tween');
  }
});

test('death or a replaced model prevents pending metadata from animating a different actor', async () => {
  for (const mutate of [ch => { ch.dead = true; }, ch => { ch.modelId = 'replacement'; },
    ch => { ch.actions = { ...ch.actions }; }]) {
    let resolve;
    const h = caller(pawn(), null, () => new Promise(done => { resolve = done; }));
    h.entity._playerCastGesture(h.character, { skillId: 77, level: 1, op: 'skillCast', hitTime: 9000 });
    mutate(h.character);
    resolve({ 77: { anim: 'V' } });
    await tick();
    assert.equal(h.played.length, 0);
  }
});
