import test from 'node:test';
import assert from 'node:assert/strict';
import { indexQuests, questStages } from '../js/questdata.js';

test('native quest encoding distinguishes stage counts and sparse bitmaps', () => {
  assert.deepEqual(questStages(3), [
    { level: 1, completed: true }, { level: 2, completed: true }, { level: 3, completed: false },
  ]);
  assert.deepEqual(questStages(0x80000005), [
    { level: 1, completed: true }, { level: 3, completed: false },
  ]);
  assert.deepEqual(questStages(0xc0000001), [{ level: 1, completed: false }]);
  assert.deepEqual(questStages(0), []);
  assert.deepEqual(questStages(0x80000000), []);
  assert.equal(questStages(30).at(-1).level, 30);
  assert.equal(questStages(0xffffffff).length, 30);
});

function table() {
  return { format: 'l2-interlude-quests-v1',
    provenance: { edition: 'Interlude', recordCount: 2, questCount: 1 },
    records: [1, 4].map(level => ({ id: 7001, level, title: 'Synthetic quest',
      journal: `Synthetic stage ${level}`, description: 'Synthetic description',
      itemIds: [42], itemCounts: [-3] })) };
}

test('journal lookup is exact and never fabricates missing stages', () => {
  const data = table(), journal = indexQuests(data);
  assert.equal(journal.stage(7001, 4), data.records[1]);
  assert.equal(journal.stage(7001, 2), null);
  assert.equal(journal.stage(99, 1), null);
  assert.equal(journal.title(7001), data.records[0].title);
  assert.equal(journal.title(99), null);
  assert.deepEqual(journal.stage(7001, 4).itemCounts, [-3]);
});

test('duplicate, malformed and mismatched quest tables fail visibly', () => {
  for (const alter of [
    d => { d.format = 'another edition'; },
    d => { d.records[1] = d.records[0]; },
    d => { d.provenance.recordCount++; },
    d => { d.provenance.questCount++; },
    d => { d.records[0].itemCounts = []; },
    d => { delete d.records[0].description; },
  ]) {
    const data = table(); alter(data);
    assert.throws(() => indexQuests(data));
  }
});
