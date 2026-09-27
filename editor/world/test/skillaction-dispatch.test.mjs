// Elbera Tools: portable native action order/stage/target selection fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSkillActions } from '../js/skillaction-dispatch.js';

const action = (sourceIndex, stage = 0, changes = {}) => ({ sourceIndex, actionRef: sourceIndex + 1,
  actionPath: `Fixture.Action${sourceIndex}`, actionStatus: 'resolved-locate-effect',
  stage, stageSerialized: true, ...changes });
const sourceNull = sourceIndex => action(sourceIndex, 0,
  { actionRef: 0, actionPath: null, actionStatus: 'source-null', stageSerialized: false });
const entry = actions => ({ actionFormat: 'l2-skill-action-records-v1', c: actions, h: actions,
  p: actions, s: actions, x: [] });
const input = (actions, changes = {}) => ({ entry: entry(actions), phase: 's', caster: 'caster',
  mainTarget: 'main', associatedActors: [], stageShot: 1, pending: 1, ...changes });

test('casting and channeling ignore SpecificStage and preserve null/unrenderable source slots', () => {
  const records = [action(0, -9, { g: 2 }), sourceNull(1), action(2, 80, { f: 0 })];
  for (const phase of ['c', 'h']) {
    const plan = selectSkillActions(input(records, { phase, stageShot: undefined, pending: undefined,
      mainTarget: null, associatedActors: ['ignored'] }));
    assert.equal(plan.status, 'ready');
    assert.deepEqual(plan.actions.map(a => [a.sourceIndex, a.selected, a.reason]),
      [[0, true, null], [1, false, 'source-null'], [2, true, null]]);
    assert.deepEqual(plan.calls.map(c => [c.sourceIndex, c.caster, c.target]), [[0, 'caster', null], [2, 'caster', null]]);
    assert.equal(plan.calls[0].action, records[0], 'missing renderer index never drops a source action');
  }
});

test('preshot is a native no-op even with retained non-null and unsupported source records', () => {
  const records = [action(0), action(1, 2, { actionRef: -7, actionPath: null,
    actionStatus: 'unsupported-action-reference' }), sourceNull(2)];
  const plan = selectSkillActions({ entry: entry(records), phase: 'p' });
  assert.equal(plan.status, 'native-no-op'); assert.deepEqual(plan.calls, []);
  assert.equal(plan.actions.length, 3);
  assert.ok(plan.actions.every(a => !a.selected && a.reason === 'native-preshot-no-op'));
});

test('shot uses the supplied incremented stage; source stage zero joins only pending two', () => {
  const records = [action(0, 0), action(1, 1), action(2, 2), action(3, -1), sourceNull(4)];
  assert.deepEqual(selectSkillActions(input(records)).calls.map(c => c.sourceIndex), [1]);
  assert.deepEqual(selectSkillActions(input(records, { stageShot: 2, pending: 2 })).calls.map(c => c.sourceIndex), [0, 2]);
  const plan = selectSkillActions(input(records, { pending: 2 }));
  assert.deepEqual(plan.calls.map(c => c.sourceIndex), [0, 1]);
  assert.equal(plan.actions[4].reason, 'source-null');
  const intermediate = selectSkillActions(input(records));
  assert.equal(intermediate.actions[4].reason, 'source-null', 'native rejects null Action before the unmatched stage');
  assert.equal(intermediate.actions[4].selected, false);
});

test('multi-target dispatch preserves action order, association order, duplicates and null entries', () => {
  const records = [action(0, 1, { g: 2 }), action(1, 1), action(2, 1, { g: 3 })];
  const plan = selectSkillActions(input(records, { associatedActors: ['second', null, 'second'] }));
  assert.deepEqual(plan.calls.map(c => [c.sourceIndex, c.target, c.associatedIndex]), [
    [0, 'second', 0], [0, null, 1], [0, 'second', 2], [1, 'main', null],
    [2, 'second', 0], [2, null, 1], [2, 'second', 2],
  ]);
  assert.deepEqual(plan.actions.map(a => a.callCount), [3, 1, 3]);
});

test('empty multi-target list falls back to main; absent main uses associated even without multi flag', () => {
  assert.deepEqual(selectSkillActions(input([action(0, 1, { g: 2 })])).calls.map(c => c.target), ['main']);
  const plan = selectSkillActions(input([action(0, 1)], { mainTarget: null, associatedActors: ['a', 'b'] }));
  assert.deepEqual(plan.calls.map(c => c.target), ['a', 'b']);
  const empty = selectSkillActions(input([action(0, 1)], { mainTarget: null }));
  assert.deepEqual(empty.calls, []); assert.equal(empty.actions[0].selected, true);
  assert.equal(empty.actions[0].reason, 'no-target');
});

test('unsupported references remain diagnostic and do not become guessed calls', () => {
  const records = [action(0, 1), action(1, 1, { actionRef: -7, actionPath: null,
    actionStatus: 'unsupported-action-reference' }), action(2, 2)];
  const plan = selectSkillActions(input(records));
  assert.equal(plan.status, 'unsupported-action-reference');
  assert.deepEqual(plan.calls.map(c => c.sourceIndex), [0]);
  assert.equal(plan.actions[1].selected, true); assert.equal(plan.actions[1].reason, 'unsupported-action-reference');
  assert.equal(selectSkillActions(input(records, { stageShot: 2 })).status, 'ready', 'unselected unsupported refs do not dispatch');
});

test('invalid metadata or shot inputs fail before returning any calls; no stage defaults', () => {
  const valid = input([action(0, 1), action(1, 1)]);
  const changes = [i => { delete i.stageShot; }, i => { i.stageShot = 0; }, i => { i.pending = 0; },
    i => { delete i.pending; }, i => { delete i.mainTarget; }, i => { delete i.associatedActors; },
    i => { i.associatedActors = Array(1); }, i => { i.entry.actionFormat = 'old'; },
    i => { delete i.entry.s; }, i => { i.phase = 'x'; }, i => { delete i.entry.s[1].stage; },
    i => { i.entry.s[1].stageSerialized = false; }, i => { i.entry.s[1].sourceIndex = 9; },
    i => { i.entry.s[1].g = NaN; }, i => { i.entry.s[1].f = -1; },
    i => { i.entry.s[1].actionRef = 0; }, i => { i.entry.s[1].actionStatus = 'guessed'; }];
  for (const change of changes) {
    const bad = structuredClone(valid); change(bad);
    const plan = selectSkillActions(bad); assert.equal(plan.status, 'unsupported'); assert.deepEqual(plan.calls, []);
  }
});

test('selection does not mutate source records or caller actor arrays', () => {
  const actors = Object.freeze(['a', 'a']);
  const record = Object.freeze(action(0, 1, { g: 2 }));
  const params = Object.freeze(input(Object.freeze([record]), { associatedActors: actors }));
  const plan = selectSkillActions(params);
  assert.deepEqual(plan.calls.map(c => c.target), ['a', 'a']);
  assert.equal(plan.calls[0].action, record);
});
