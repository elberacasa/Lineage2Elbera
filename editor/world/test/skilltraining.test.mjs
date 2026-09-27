import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillTraining } from '../js/skilltraining.js';

function fixture(type = 0) {
  const sent = [];
  const state = new SkillTraining({ send(op, data) { sent.push({ op, ...data }); return true; } });
  state.list({ type, skills: [{ id: 123, level: 2, maxLevel: 5, cost: 17, itemConsume: 1 }] });
  return { state, sent };
}
const details = type => ({ id: 123, level: 2, cost: 19, type,
  requirements: [{ type: 7, itemId: 456, count: 3, unknown: 9 }] });

test('list, details and learn preserve server values in all three original modes', () => {
  for (const type of [0, 1, 2]) {
    const { state, sent } = fixture(type);
    assert.equal(state.select(123, 2), true);
    assert.equal(state.view, null);
    assert.deepEqual(sent, [{ op: 'acquireSkillInfo', id: 123, level: 2, type }]);
    assert.equal(state.details(details(type)), true);
    assert.equal(state.info.cost, 19); // detail response, not old list price
    assert.deepEqual(state.info.requirements, details(type).requirements);
    assert.equal(state.learn(), true);
    assert.deepEqual(sent[1], { op: 'acquireSkill', id: 123, level: 2, type });
    assert.equal(state.view, 'info');
    assert.equal(state.info.cost, 19);
  }
});

test('List returns to the same server list; new list hides the previous details', () => {
  const { state, sent } = fixture();
  state.select(123, 2); state.details(details(0)); state.back();
  assert.equal(state.view, 'list'); assert.equal(state.skills[0].cost, 17);
  assert.equal(sent.length, 1);
  state.select(123, 2); state.details(details(0));
  state.list({ type: 1, skills: [] });
  assert.equal(state.view, 'list'); assert.deepEqual(state.skills, []);
  assert.equal(state.info, null); assert.equal(state.learn(), false);
});

test('done and session reset hide both windows and invalidate pending details', () => {
  for (const reset of ['reset', 'done', 'close']) {
    const { state, sent } = fixture();
    state.select(123, 2); state[reset]();
    assert.equal(state.details(details(0)), false);
    assert.equal(state.view, null); assert.equal(state.learn(), false);
    assert.equal(sent.length, 1);
  }
});

test('unrequested, mismatched and superseded details cannot reopen a dialog', () => {
  const { state } = fixture();
  assert.equal(state.details(details(0)), false);
  state.select(123, 2);
  for (const wrong of [{ type: 1 }, { id: 124 }, { level: 3 }])
    assert.equal(state.details({ ...details(0), ...wrong }), false);
  state.list({ type: 0, skills: [] });
  assert.equal(state.details(details(0)), false);
});

test('unavailable connection or absent skill cannot send or close the list', () => {
  const { state, sent } = fixture();
  assert.equal(state.select(123, 3), false); assert.equal(sent.length, 0);
  state.send = () => false;
  assert.equal(state.select(123, 2), false);
  assert.equal(state.view, 'list');
});

test('enchant uses another original protocol and cannot leak into acquisition', () => {
  const { state, sent } = fixture();
  assert.equal(state.list({ type: 3, skills: [{ id: 123, level: 101, cost: 17 }] }), false);
  assert.equal(state.type, 0); assert.equal(state.select(123, 101), false);
  assert.deepEqual(sent, []);
});
