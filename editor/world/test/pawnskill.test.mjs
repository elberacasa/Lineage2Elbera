// Elbera Tools: source-free checks of the recovered ordinary Pawn lifecycle.
// Fixtures exercise actual runtime code; native branch evidence lives in
// docs/native-pawn-notify-evidence.md. No rendering/native completion claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastShotObject, createPawnSkill, associatePawnSkill, cancelPawnSkill,
  consumePawnSkillTick,
} from '../js/pawnskill.js';

const SHOT = 'Engine.AnimNotify_AttackShot';
const modelSource = { package: 'Fixture.ukx', packageSHA256: 'a'.repeat(64) };
const note = (name, t = .5, extra = {}) => ({
  classPath: SHOT, objectPath: `Fixture.${name}`, objectRef: 1,
  isAttackShot: true, t, ...extra,
});
const last = note('Last');
const other = note('Other', .25, { objectRef: 2 });
const channel = { classPath: 'Engine.AnimNotify_Channeling' };
const preshot = { classPath: 'Engine.AnimNotify_AttackPreShot' };
const event = notify => ({ dispatch: 'object', notify });
const action = (index, stage = 0, extra = {}) => ({
  sourceIndex: index, actionRef: index + 1, actionPath: `Fixture.Action${index}`,
  actionStatus: 'resolved-locate-effect', stage, stageSerialized: true, ...extra,
});
const entry = () => ({ actionFormat: 'l2-skill-action-records-v1',
  c: [action(0, 99)], h: [action(0, -9)], p: [action(0)],
  s: [action(0), action(1, 1), action(2, 2)], x: [] });
const schedule = (extra = {}) => ({ status: 'ready', style: 8, flexIndex: -1,
  phases: [{ notifies: [other, last], scanDuration: 1 }], ...extra });
function make(extra = {}) {
  const source = { schedule: schedule(), modelSource,
    agent: { status: 'resolved-source-object', entry: entry() },
    caster: { id: 'caster' }, mainTarget: { id: 'main' }, skillId: 77, level: 3, ...extra };
  return { state: createPawnSkill(source), source };
}
const tick = (state, notes = [], extra = {}) => consumePawnSkillTick(state,
  { events: notes.map(event), activeTime: 1, ...extra });

test('initial MagicProcess clears shot/preshot but retains channel until a subsequent tick', () => {
  const { state } = make();
  const initial = tick(state, [channel, preshot, last], { activeTime: 0 });
  assert.equal(initial.status, 'ready');
  assert.deepEqual(initial.dispatches.map(d => [d.phase, d.soundType]), [['c', 1]]);
  assert.equal(state.pending, 0); assert.equal(state.preshot, 0);
  assert.equal(state.channeling, 1);
  assert.equal(state.stageShot, 0); assert.equal(state.stagePreshot, 0);
  assert.deepEqual(tick(state).dispatches.map(d => d.phase), ['h']);
  assert.equal(state.channeling, 0);
});

test('subsequent pending consumption is channel, preshot, then incremented shot stage', () => {
  const { state } = make();
  const result = tick(state, [last, preshot, channel]);
  assert.deepEqual(result.dispatches.map(d => [d.phase, d.stageShot, d.stagePreshot, d.soundType]),
    [['h', 0, 0, null], ['p', 0, 1, null], ['s', 1, 1, 2]]);
  assert.equal(result.dispatches[1].plan.status, 'native-no-op');
  assert.deepEqual(result.dispatches[1].plan.calls, []);
  assert.deepEqual(result.dispatches[2].plan.calls.map(c => c.sourceIndex), [0, 1]);
  assert.equal(state.pending, 0); assert.equal(state.preshot, 0); assert.equal(state.channeling, 0);
});

test('pending assignments overwrite in delivery order for precisely source types 8, 9 and 10', () => {
  for (const style of [8, 9, 10]) {
    const { state } = make({ schedule: schedule({ style }) });
    const main = state.mainTarget;
    const first = tick(state, [last, other, other]);
    assert.deepEqual(first.dispatches.map(d => [d.phase, d.pending]), [['s', 1]]);
    assert.deepEqual(first.dispatches[0].plan.calls.map(c => c.sourceIndex), [1]);
    assert.equal(state.mainTarget, main, 'intermediate finalization preserves targets');
    const final = tick(state, [other, last]);
    assert.deepEqual(final.dispatches.map(d => [d.stageShot, d.pending]), [[2, 2]]);
    assert.deepEqual(final.dispatches[0].plan.calls.map(c => c.sourceIndex), [0, 2]);
    assert.equal(state.mainTarget, null);
  }
  for (const style of [0, 1, 7, 11, 14]) {
    const { state } = make({ schedule: schedule({ style }) });
    assert.deepEqual(tick(state, [other]).dispatches, []);
    assert.equal(tick(state, [last, other]).dispatches[0].pending, 2,
      'non-multishot event cannot replace an already selected last shot');
  }
});

test('repeated last-shot deliveries are assignments, not a queued number of shots', () => {
  const { state } = make();
  const result = tick(state, [last, last, last]);
  assert.equal(result.dispatches.length, 1); assert.equal(state.stageShot, 1);
  assert.deepEqual(tick(state).dispatches, []);
});

test('Clear(0) clears main target but retains current-action target and later notify eligibility', () => {
  const { state } = make();
  const actionTarget = state.actionTarget;
  associatePawnSkill(state, { skillId: 77, target: { id: 'additional' } });
  tick(state, [last]);
  assert.equal(state.mainTarget, null); assert.deepEqual(state.associatedActors, []);
  assert.equal(state.actionTarget, actionTarget); assert.equal(state.active, true);
  assert.equal(state.skillId, 77); assert.equal(state.level, 3); assert.equal(state.lastShot, last.objectPath);
  assert.equal(associatePawnSkill(state, { skillId: 77, target: actionTarget }), false);
  const later = tick(state, [last]);
  assert.equal(later.dispatches[0].stageShot, 2);
  assert.deepEqual(later.dispatches[0].plan.calls, []);
  assert.equal(later.dispatches[0].soundType, 2, 'targetless Agent shot still reaches its sound tail');
});

test('association appends original order and duplicates, ignores incoming level, and never triggers a shot', () => {
  const { state } = make();
  state.entry.s = [action(0, 0, { g: 2 })];
  const a = { id: 'a' }, b = { id: 'b' };
  assert.equal(associatePawnSkill(state, { skillId: 78, level: 3, target: a }), false);
  for (const [target, level] of [[b, 999], [a, 1], [b, -1]])
    assert.equal(associatePawnSkill(state, { skillId: 77, level, target }), true);
  assert.deepEqual(state.associatedActors, [b, a, b]);
  assert.equal(state.pending, 0); assert.equal(state.stageShot, 0);
  assert.deepEqual(tick(state, [], { activeTime: 999999 }).dispatches, [],
    'neither packet receipt nor elapsed deadline may manufacture native AttackShot');
  const shot = tick(state, [last]);
  assert.deepEqual(shot.dispatches[0].plan.calls.map(c => c.target), [b, a, b]);
});

test('skill object notifies require an existing current-action target; script functions cannot set flags', () => {
  for (const extra of [{ actionTargetPresent: false }, {}]) {
    const { state } = make();
    if (!Object.hasOwn(extra, 'actionTargetPresent')) state.actionTarget = null;
    assert.deepEqual(tick(state, [last, preshot, channel], extra).dispatches, []);
  }
  const { state } = make();
  const result = consumePawnSkillTick(state, { activeTime: 1,
    events: [{ dispatch: 'function', notify: last }, { dispatch: 'none', notify: channel }] });
  assert.deepEqual(result.dispatches, []);
});

test('completion consumes outgoing events first, then retires without guessing the erased fallback branch', () => {
  const { state } = make();
  const result = tick(state, [last], { complete: true });
  assert.deepEqual(result.dispatches.map(d => [d.phase, d.pending]), [['s', 2]]);
  assert.equal(result.completion, 'unresolved-completion-shot-comparison');
  assert.equal(state.active, false); assert.equal(state.actionTarget, null);
  assert.equal(associatePawnSkill(state, { skillId: 77, target: {} }), false);
  assert.deepEqual(tick(state, [last]), { status: 'inactive', dispatches: [] });
  const empty = make().state;
  assert.deepEqual(tick(empty, [], { complete: true }).dispatches, [], 'no authored completion shot');
});

test('cancellation retires associations, pending flags and later event/packet work', () => {
  const { state } = make();
  associatePawnSkill(state, { skillId: 77, target: {} });
  tick(state, [channel], { activeTime: 0 });
  cancelPawnSkill(state);
  assert.equal(state.active, false); assert.equal(state.mainTarget, null); assert.equal(state.actionTarget, null);
  assert.deepEqual(state.associatedActors, []);
  assert.equal(state.pending | state.preshot | state.channeling, 0);
  assert.equal(associatePawnSkill(state, { skillId: 77, target: {} }), false);
  assert.deepEqual(tick(state, [last]).dispatches, []);
});

test('zero-time scan retains original object identity even when numeric scheduler timing falls back', () => {
  const zero = note('Zero', 0, { objectRef: 3 });
  const plan = schedule({ shotFallback: true, phases: [
    { notifies: [], scanDuration: 2 }, { notifies: [zero], scanDuration: 1 },
  ] });
  assert.equal(lastShotObject(plan, modelSource).objectPath, zero.objectPath);
  const { state } = make({ schedule: plan });
  assert.equal(tick(state, [zero]).dispatches[0].pending, 2);
  assert.equal(lastShotObject(schedule({ phases: [{ notifies: [], scanDuration: 1 }] }), modelSource).objectPath, null);
});

test('identity scan uses source order backwards, ignores flexible phase, and permits a reused source object', () => {
  const zero = note('Zero', 0, { objectRef: 3 });
  const flex = note('Flexible', .9, { objectRef: 4 });
  const plan = schedule({ flexIndex: 1, phases: [
    { notifies: [last, zero], scanDuration: 1 },
    { notifies: [flex], scanDuration: 9 },
    { notifies: [last, zero], scanDuration: 1 },
  ] });
  assert.equal(lastShotObject(plan, modelSource).objectPath, zero.objectPath,
    'last source-array match wins within each phase, even after an earlier positive notify');
  plan.phases[0].notifies = [zero, last];
  assert.equal(lastShotObject(plan, modelSource).objectPath, last.objectPath);
});

test('unverified source identity and special MagicType 12 remain unsupported', () => {
  for (const change of [n => { n.classPath = 'Fixture.AttackShotSubclass'; },
    n => { n.objectPath = 'OtherPackage.Last'; }, n => { n.objectRef = 0; },
    n => { n.objectPath = 'Fixture.\u00e9'; }]) {
    const n = { ...last }; change(n);
    assert.equal(lastShotObject(schedule({ phases: [{ notifies: [n], scanDuration: 1 }] }), modelSource).status, 'unsupported');
  }
  assert.equal(lastShotObject(schedule(), { ...modelSource, packageSHA256: '' }).status, 'unsupported');
  assert.equal(make({ schedule: schedule({ style: 12 }) }).state.status, 'unsupported');
  for (const mainTarget of [null, undefined])
    assert.equal(make({ mainTarget }).state.status, 'unsupported', 'ordinary initialization requires a target actor');
});

test('admission cannot certify an unsupported reference hidden behind a later shot stage', () => {
  const actions = entry();
  actions.s = [action(0, 2, { actionRef: -9, actionPath: null,
    actionStatus: 'unsupported-action-reference' })];
  const { state } = make({ agent: { status: 'resolved-source-object', entry: actions } });
  assert.equal(state.status, 'unsupported');
  assert.equal(state.reason, 'unverified-agent-actions');
});
