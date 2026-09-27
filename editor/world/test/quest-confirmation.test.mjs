// The actual journal controller with controlled metadata/dialog boundaries.
// No original text, browser account, database, or server request is needed.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location ??= { search: '' };
globalThis.fetch = async () => ({ ok: false });
const { QuestWnd } = await import('../js/ui/questwnd.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function fixture() {
  const requests = [], aborted = [], ready = deferred();
  const wnd = Object.assign(Object.create(QuestWnd.prototype), {
    selected: 1, resetRevision: 0, quests: [{ id: 1, progress: 1 }, { id: 2, progress: 1 }],
    expandedStages: new Set(['1:1']),
    systemMessages: { 182: { text: 'Synthetic confirmation' }, 1201: { text: 'Synthetic notice' } },
    _loadData: () => ready.promise, onAbort: id => aborted.push(id),
    _render() {}, hide() {},
    dialog: {
      request(options) { const job = deferred(); requests.push({ options, ...job }); return job.promise; },
      reset() { for (const r of requests) r.resolve({ accepted: false }); },
    },
  });
  return { wnd, requests, aborted, ready };
}

test('an unchanged selected quest can be cancelled only after confirmation', async () => {
  const h = fixture(), pending = h.wnd.abortSelected();
  h.ready.resolve(); await tick();
  assert.deepEqual(h.aborted, []);
  assert.equal(h.requests[0].options.type, 'warning');
  assert.equal(h.requests[0].options.message, 'Synthetic confirmation');
  h.requests[0].resolve({ accepted: true }); await pending;
  assert.deepEqual(h.aborted, [1]);
});

test('collapsed journal uses the source Notice path and cannot abort any quest', async () => {
  const h = fixture(); h.wnd.selected = null;
  const pending = h.wnd.abortSelected(); h.ready.resolve(); await tick();
  assert.equal(h.requests[0].options.type, 'notice');
  assert.equal(h.requests[0].options.message, 'Synthetic notice');
  h.requests[0].resolve({ accepted: true }); await pending;
  assert.deepEqual(h.aborted, []);
});

test('Cancel leaves the active quest alone', async () => {
  const h = fixture(), pending = h.wnd.abortSelected();
  h.ready.resolve(); await tick(); h.requests[0].resolve({ accepted: false });
  await pending; assert.deepEqual(h.aborted, []);
});

test('reset while loading cannot open a dialog in the replacement session', async () => {
  const h = fixture(), pending = h.wnd.abortSelected();
  h.wnd.reset(); h.wnd.selected = 1; h.wnd.quests = [{ id: 1 }];
  h.ready.resolve(); await pending;
  assert.equal(h.requests.length, 0); assert.deepEqual(h.aborted, []);
});

test('selection or membership change while loading cannot target another quest', async () => {
  for (const change of [w => { w.selected = 2; }, w => { w.quests = []; }]) {
    const h = fixture(), pending = h.wnd.abortSelected();
    change(h.wnd); h.ready.resolve(); await pending;
    assert.equal(h.requests.length, 0); assert.deepEqual(h.aborted, []);
  }
});

test('accepted stale confirmations cannot mutate a new session or selection', async () => {
  for (const change of [
    w => { w.selected = 2; }, w => { w.quests = []; },
    w => { w.resetRevision++; },
    w => { w.reset(); w.selected = 1; w.quests = [{ id: 1 }]; },
  ]) {
    const h = fixture(), pending = h.wnd.abortSelected();
    h.ready.resolve(); await tick(); change(h.wnd);
    h.requests[0].resolve({ accepted: true }); await pending;
    assert.deepEqual(h.aborted, []);
  }
});

test('missing original message fails closed, without generic replacement prose', async () => {
  const h = fixture(); h.wnd.systemMessages = {};
  const pending = h.wnd.abortSelected(); h.ready.resolve(); await pending;
  assert.equal(h.requests.length, 0); assert.deepEqual(h.aborted, []);
});

test('completed server rows have no native journal events and leave neither entry nor selection', () => {
  const { wnd } = fixture();
  wnd.expandedStages = new Set(['1:1', '1:4', '2:1']);
  // aCis keeps non-repeatable completed quests in QuestList but clears their
  // condition/flags. Original AddQuestID emits no EV_QuestList for flags0.
  const rows = [{ id: 1, progress: 0 }, { id: 2, progress: 1 }];
  assert.equal(wnd.setQuests(rows), wnd);
  assert.deepEqual(wnd.quests, [rows[1]]); // also the journal count's input
  assert.equal(wnd.selected, null);
  assert.deepEqual([...wnd.expandedStages], ['2:1']);
  assert.equal(rows.length, 2, 'journal filtering must not mutate the server snapshot');
});

test('only native emitted stages admit journal rows, including signed sparse bitmaps', () => {
  const { wnd } = fixture();
  wnd.selected = 12;
  wnd.expandedStages = new Set(['12:1', '12:2', '12:3']);
  wnd.setQuests([
    { id: 10, progress: 0x80000000 | 0 },
    { id: 11, progress: 0xc0000000 | 0 }, // reserved bit30 is not a stage
    { id: 12, progress: 0x80000005 | 0 },
    { id: 13, progress: 2 }, // native sequential count, not a bitmap
  ]);
  assert.deepEqual(wnd.quests.map(q => q.id), [12, 13]);
  assert.equal(wnd.selected, 12);
  assert.deepEqual([...wnd.expandedStages], ['12:1', '12:3']);
});

test('completion closes a pending abort confirmation and cannot send an abort', async () => {
  const h = fixture(), pending = h.wnd.abortSelected();
  h.ready.resolve(); await tick();
  assert.equal(h.requests.length, 1);
  h.wnd.setQuests([{ id: 1, progress: 0 }, { id: 2, progress: 1 }]);
  // The dialog promise must be cancelled by retirement, without waiting for
  // an input against a quest the server has already completed.
  assert.equal(await Promise.race([pending.then(() => 'retired'), tick().then(() => 'pending')]), 'retired');
  assert.deepEqual(h.aborted, []);
});

test('completion while loading retires the request even if the same ID later returns', async () => {
  const h = fixture(), pending = h.wnd.abortSelected();
  h.wnd.setQuests([{ id: 1, progress: 0 }]);
  h.wnd.setQuests([{ id: 1, progress: 1 }]);
  h.wnd.selected = 1;
  h.ready.resolve(); await tick();
  const requestCount = h.requests.length;
  h.wnd.dialog.reset(); await pending;
  assert.equal(requestCount, 0);
  assert.deepEqual(h.aborted, []);
});

test('another quest completing preserves the current active confirmation', async () => {
  const h = fixture(), pending = h.wnd.abortSelected();
  h.ready.resolve(); await tick();
  h.wnd.setQuests([{ id: 1, progress: 1 }, { id: 2, progress: 0 }]);
  assert.equal(h.wnd.selected, 1);
  h.requests[0].resolve({ accepted: true }); await pending;
  assert.deepEqual(h.aborted, [1]);
});

test('quest marker focuses the requested quest and final sparse journal chapter', () => {
  const { wnd } = fixture();
  wnd.show = function () { this.shown = true; return this; };
  wnd.setQuests([{ id: 1, progress: 0x80000009 | 0 }, { id: 2, progress: 2 }]);
  assert.equal(wnd.focusQuest(1), true);
  assert.equal(wnd.selected, 1); assert.equal(wnd.shown, true);
  assert.ok(wnd.expandedStages.has('1:4'));
  assert.equal(wnd.focusQuest(99), false);
  assert.equal(wnd.selected, 1, 'an absent native tree node cannot select a different quest');
});
