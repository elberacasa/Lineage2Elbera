// Elbera Tools: source-free native schedule domain/scan regressions.
// Synthetic expected timing values below were evaluated from pinned original
// instructions by tools/ui/check_castschedule_runtime.py, not this module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSkillSlots } from '../js/native-skillanim.js';
import { nativeCastFlexIndex, planNativeCastSchedule } from '../js/native-castschedule.js';

const f32 = Math.fround;
const shot = t => ({ t, isAttackShot: true });
const phase = (frames, notifies = []) => ({ clip: `synthetic-${frames}`, frames, rate: 30, notifies });
function input(overrides = {}) {
  return { animation: 'E', style: 1, hitTimeMs: 4000, speedRate: 1,
    agent: { status: 'source-none' }, phases: [phase(24), phase(3), phase(45, [shot(1 / 3)])], ...overrides };
}
function ready(overrides) {
  const plan = planNativeCastSchedule(input(overrides));
  assert.equal(plan.status, 'ready', JSON.stringify(plan));
  return plan;
}

test('32 original selectors retain flexible phase indices and reject unknown codes', () => {
  const groups = [
    [1, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'MS01']],
    [0, ['J', 'K', 'L']],
    [-1, ['M', 'N', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
      'MIX01', 'MIX02', 'MIX03', 'MIX04', 'MIX05', 'MIX06', 'MIX07', 'MIX08', 'MIX09']],
  ];
  assert.equal(groups.flatMap(([, codes]) => codes).length, 32);
  for (const [flex, codes] of groups) for (const code of codes) {
    assert.equal(nativeCastFlexIndex(code.toLowerCase()), flex);
    const plan = ready({ animation: code, phases: nativeSkillSlots(code).map(() => phase(30)) });
    assert.equal(plan.flexIndex, flex);
    assert.deepEqual(plan.phases.map(p => p.loop), plan.phases.map((_, i) => i === flex));
  }
  for (const code of [null, '', 'O', 'P', 'MS02', ' E ', '__proto__']) assert.equal(nativeCastFlexIndex(code), null);
});

test('ordinary flexible phases reproduce Float32 deadlines and retain their own source length', () => {
  const plan = ready();
  assert.equal(plan.rate, 1);
  assert.equal(plan.tween, f32(.2));
  assert.equal(plan.sourceAttackTime, 1.2999999523162842);
  assert.equal(plan.shotTime, 3.8110389709472656);
  assert.deepEqual(plan.phases.map(p => p.due), [0.9610389471054077, 3.3110389709472656, 4.811038970947266]);
  assert.equal(plan.phases[1].sourceDuration, f32(3 / 30));
  assert.equal(plan.phases[1].scanDuration, 0);
  assert.equal(plan.phases[1].sourceEndpoint, 2 / 30);
  assert.equal(plan.shotFallback, false);
  assert.deepEqual(plan.shotNotify, { phase: 2, index: 0, t: f32(1 / 3) });
});

test('flexible collapse changes rate without borrowing or stretching a source sequence', () => {
  const plan = ready({ hitTimeMs: 1000 });
  assert.equal(plan.rate, 2);
  assert.equal(plan.flexibleDuration, 0);
  assert.equal(plan.phases[0].due, 0.4941176474094391);
  assert.equal(plan.phases[1].due, plan.phases[0].due);
  assert.equal(plan.phases[2].due, 1.2441176176071167);
  assert.equal(plan.shotTime, 0.7441176176071167);
  assert.equal(plan.phases[2].sourceDuration, 1.5);
});

test('nonflexible physical shot budget does not compress the entire clip to hitTime', () => {
  const plan = ready({ animation: 'S', style: 3, hitTimeMs: 1400, phases: [phase(45, [shot(1 / 3)])] });
  assert.equal(plan.flexIndex, -1);
  assert.equal(plan.lead, 0);
  assert.equal(plan.rate, 0.4166666865348816);
  assert.equal(plan.shotTime, 1.399999976158142);
  assert.equal(plan.phases[0].due, 3.799999713897705);
  assert.equal(plan.phases[0].sourceEndpoint, 44 / 30);
  assert.equal(ready({ animation: 'S', style: 3, hitTimeMs: 1400, speedRate: 2,
    phases: [phase(45, [shot(1 / 3)])] }).rate, plan.rate, 'nonflexible rate is budget-derived');
});

test('a first flexible phase receives tween and its own deadline without first-phase correction', () => {
  const plan = ready({ animation: 'K', phases: [phase(3), phase(45, [shot(1 / 3)])] });
  assert.equal(plan.flexIndex, 0);
  assert.deepEqual(plan.phases.map(p => p.due), [3.3500001430511475, 4.850000381469727]);
  assert.equal(plan.shotTime, 3.8500001430511475);
});

test('Agent absence and resolved zero have different native style leads; unresolved cannot choose either', () => {
  for (const [style, lead] of [[1, f32(.15)], [2, f32(.4)], [5, f32(.4)], [8, f32(.4)],
    [10, f32(.4)], [3, 0], [12, 0], [14, 2]]) assert.equal(ready({ style }).lead, lead);
  const resolved = f => ({ status: 'resolved-source-object', entry: { f } });
  assert.equal(ready({ style: 2, agent: resolved(0) }).lead, f32(.15));
  assert.equal(ready({ style: 12, agent: resolved(0) }).lead, f32(.15));
  assert.equal(ready({ style: 3, agent: resolved(0) }).lead, 0);
  assert.equal(ready({ style: 3, agent: resolved(f32(.15)) }).lead, f32(.15));
  assert.equal(ready({ style: 3, agent: resolved(0.14999999105930328) }).lead, 0);
  assert.equal(ready({ agent: resolved(f32(.4)) }).lead, f32(.4));
  for (const agent of [null, {}, { status: 'missing-exact-metadata' }, { status: 'unresolved-source-path' }]) {
    assert.equal(planNativeCastSchedule(input({ agent })).reason, 'unresolved-agent');
  }
  for (const f of [undefined, null, NaN, Infinity, -1]) {
    assert.equal(planNativeCastSchedule(input({ agent: resolved(f) })).reason, 'invalid-agent-flight-time');
  }
});

test('reverse notify lookup follows serialized class identity order, not latest time or display kind', () => {
  const notes = [shot(.8), { t: .95, kind: 'AttackShot', isAttackShot: false }, shot(.25)];
  const plan = ready({ phases: [phase(24), phase(3), phase(45, notes)] });
  assert.equal(plan.shotOffset, .375);
  assert.equal(plan.shotPhase, 2);
  assert.equal(plan.shotNotify.index, 2);
  assert.deepEqual(notes.map(n => n.t), [.8, .95, .25], 'planner never sorts or changes source input');
});

test('non-shot records never constrain the AttackShot timing scan', () => {
  // Original null-object notify records can lie outside [0,1]. The native
  // reverse helper checks class identity before reading the matching time.
  const plan = ready({ phases: [phase(24), phase(3), phase(45, [
    shot(.25), { t: 1.860465168952942, isAttackShot: false },
    { t: null, isAttackShot: false },
  ])] });
  assert.equal(plan.shotOffset, .375);
  assert.equal(plan.shotNotify.index, 0);
});

test('trailing zero notify skips earlier positive notify in that phase and flexible phase never supplies a shot', () => {
  const plan = ready({ phases: [phase(24, [shot(.5)]), phase(3, [shot(.9)]), phase(45, [shot(.8), shot(0)])] });
  assert.equal(plan.shotPhase, 0);
  assert.equal(plan.shotOffset, f32(f32(.5) * f32(.8)));
  assert.equal(plan.shotNotify.index, 0);
  assert.equal(plan.sourceAttackTime, plan.shotOffset);
});

test('known empty or zero-only notifies use source fallback; missing notifies remain unsupported', () => {
  for (const notes of [[], [shot(0)]]) {
    const plan = ready({ phases: [phase(24, notes), phase(3, [shot(.8)]), phase(45, notes)] });
    assert.equal(plan.shotFallback, true);
    assert.equal(plan.shotPhase, 2);
    assert.equal(plan.shotOffset, 1.5);
    assert.equal(plan.sourceAttackTime, f32(f32(.8) + 1.5));
    assert.equal(plan.shotNotify, null);
  }
  const phases = [phase(24), phase(3), phase(45)]; delete phases[2].notifies;
  assert.equal(planNativeCastSchedule(input({ phases })).reason, 'missing-source-notifies');
});

test('missing original sequence and missing rendered clip are distinct, with no fallback phase promotion', () => {
  const absent = [null, phase(3), phase(45)];
  assert.deepEqual(planNativeCastSchedule(input({ phases: absent })),
    { status: 'unsupported', reason: 'missing-source-sequence', phase: 0 });
  const unshipped = [phase(24), { ...phase(3), clip: null }, phase(45)];
  assert.deepEqual(planNativeCastSchedule(input({ phases: unshipped })),
    { status: 'unsupported', reason: 'missing-rendered-clip', phase: 1 });
  assert.equal(planNativeCastSchedule(input({ phases: [phase(24)] })).reason, 'phase-count');
  assert.equal(planNativeCastSchedule(input({ phases: [{ ...phase(24), slot: 'spAtk01' }, phase(3), phase(45)] })).reason, 'phase-slot');
});

test('type 13, invalid values and degenerate native budgets are unsupported without guessed minima', () => {
  for (const [patch, reason] of [
    [{ animation: 'unknown' }, 'unknown-animation'], [{ style: 13 }, 'style-13'], [{ style: 0 }, 'invalid-style'],
    [{ style: undefined }, 'invalid-style'], [{ hitTimeMs: 0 }, 'invalid-hit-time'], [{ hitTimeMs: 1.5 }, 'invalid-hit-time'],
    [{ hitTimeMs: Infinity }, 'invalid-hit-time'], [{ speedRate: 0 }, 'invalid-speed-rate'],
    [{ speedRate: -1 }, 'invalid-speed-rate'], [{ speedRate: 1e-60 }, 'invalid-speed-rate'],
    [{ speedRate: 1e50 }, 'invalid-speed-rate'], [{ speedRate: NaN }, 'invalid-speed-rate'],
    [{ hitTimeMs: 100 }, 'negative-flexible-budget'],
    [{ animation: 'S', phases: [phase(45)], hitTimeMs: 100 }, 'nonpositive-playback-budget'],
  ]) assert.equal(planNativeCastSchedule(input(patch)).reason, reason);
  for (const change of [{ frames: 0 }, { rate: 0 }, { rate: Infinity }, { frames: 1.5 }]) {
    const phases = [phase(24), { ...phase(3), ...change }, phase(45)];
    assert.equal(planNativeCastSchedule(input({ phases })).reason, 'invalid-source-sequence');
  }
  for (const note of [{ t: .5, kind: 'AttackShot' }, { t: null, isAttackShot: true }, shot(-.1), shot(1.1)]) {
    assert.equal(planNativeCastSchedule(input({ phases: [phase(24), phase(3), phase(45, [note])] })).reason,
      'invalid-source-notify');
  }
});
