// Elbera Tools: actual InventoryWnd/WndMgr startup with synthetic layout data.
// Tests browser persistence ordering, not the original client's storage format.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
globalThis.window = { innerWidth: 1024, innerHeight: 768, addEventListener() {} };
globalThis.MutationObserver = class { observe() {} };
const stored = new Map();
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: key => stored.delete(key),
};
class Element {
  constructor() {
    this.style = {}; this.dataset = {}; this.children = []; this.listeners = new Map();
    this.classList = { add() {}, remove() {} };
  }
  appendChild(el) { this.children.push(el); return el; }
  setAttribute(key, value) { (this.attributes ||= {})[key] = String(value); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.listeners.set(type, [...this.listeners.get(type) || [], fn]); }
  dispatch(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
  getBoundingClientRect() {
    return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
      width: 256, height: 401 };
  }
}
globalThis.document = { createElement: () => new Element(), body: new Element() };
const { Layout } = await import('../js/ui/layout.js');
const { InventoryWnd, inventoryEquipSlots } = await import('../js/ui/inventorywnd.js');
const { WndMgr } = await import('../js/ui/wndmgr.js');
// Deliberately synthetic default; no private assets are loaded in this suite.
Layout.dock = () => ({ x: 700, y: 100 });
Layout.windowSize = () => ({ w: 256, h: 401 });

test('saved player placement survives a new inventory instance', () => {
  stored.set('l2vzla.wndpos', JSON.stringify({ InventoryWnd: { left: 40, top: 75 } }));
  const inventory = new InventoryWnd();
  assert.equal(inventory.root.style.left, '40px');
  assert.equal(inventory.root.style.top, '75px');
  assert.deepEqual(inventory.defaultPlace, { left: 700, top: 100 });
});

test('first inventory placement keeps the supplied source default', () => {
  stored.clear();
  const inventory = new InventoryWnd();
  assert.equal(inventory.root.style.left, '700px');
  assert.equal(inventory.root.style.top, '100px');
});

test('tattoo inventory follows the active class and clears old snapshot icons', () => {
  // Synthetic identities and grid dimensions exercise actual rendering only.
  let classId = 901, snapshot = { symbols: [{symbolId: 700, usableSymbolId: 0},
    {symbolId: 701, usableSymbolId: 701}] };
  const data = { native: {classSteps: {901: 2, 902: 1}},
    inventorySlot: {grid: {cellX: 23, cellY: 25, gapY: 4}},
    records: [700,701].map(symbolId => ({symbolId, name: 'Synthetic symbol', text1: 'Source description', icon: 'fixture'})),
    icons: {fixture: {file: 'icons/synthetic.png'}} };
  const inventory = new InventoryWnd(document.body, {getCharSheet: () => ({classId}),
    getHenna: () => snapshot, getHennaData: () => data});
  inventory.hennaSlots = new Element();
  inventory.renderHenna();
  assert.equal(inventory.hennaSlots.children.length, 2);
  assert.equal(inventory.hennaSlots.children[1].style.top, '29px');
  assert.equal(inventory.hennaSlots.children[0].attributes['aria-disabled'], 'true');
  classId = 902; inventory.renderHenna();
  assert.equal(inventory.hennaSlots.children.length, 1);
  snapshot = null; inventory.renderHenna();
  assert.equal(inventory.hennaSlots.children.length, 0);
});

test('explicit layout reset discards saved placement and reapplies the default', () => {
  stored.set('l2vzla.wndpos', JSON.stringify({ InventoryWnd: { left: 40, top: 75 } }));
  const inventory = new InventoryWnd();
  WndMgr.resetAll();
  assert.equal(stored.has('l2vzla.wndpos'), false);
  assert.equal(inventory.root.style.left, '700px');
  assert.equal(inventory.root.style.top, '100px');
});

test('right-click and double-click use the grid item; right-click suppresses the browser menu', () => {
  const used = [], inventory = new InventoryWnd(document.body, { onUse: id => used.push(id) });
  inventory.meta = { 101: { name: 'synthetic ordinary item', type: 'armor', isRecipe: false, popMsgNum: 0 } };
  inventory.pitch = { x: 35, y: 35 }; inventory.well = 34; inventory.icon = 32; inventory.cols = 6;
  inventory.items.set(42, { objectId: 42, itemId: 101, count: 1, equipped: 0, type2: 1 });
  inventory.order = [42];
  inventory.render();
  const item = inventory.gridInner.children[0];
  let prevented = false;
  item.dispatch('contextmenu', { preventDefault() { prevented = true; } });
  item.dispatch('dblclick');
  assert.equal(prevented, true);
  assert.deepEqual(used, [42, 42]);
});

test('equipped-slot right-click uses the current occupant and empty slots do nothing', () => {
  const used = [], inventory = new InventoryWnd(document.body, { onUse: id => used.push(id) });
  inventory.meta = { 101: { isRecipe: false, popMsgNum: 0 } };
  for (const objectId of [42, 43]) inventory.items.set(objectId, { objectId, itemId: 101, equipped: 1 });
  const slot = inventory._dollSlot('neck', { x: 0, y: 0, w: 34, h: 34 });
  const e = { preventDefault() {} };
  slot.dispatch('contextmenu', e);
  slot.dataset.oid = '42'; slot.dispatch('contextmenu', e);
  slot.dataset.oid = '43'; slot.dispatch('dblclick');
  delete slot.dataset.oid; slot.dispatch('contextmenu', e);
  assert.deepEqual(used, [42, 43]);
});

function warningFixture(meta = { isRecipe: true, popMsgNum: 999 }) {
  const used = [], requests = [];
  const inventory = new InventoryWnd(document.body, { onUse: id => used.push(id) });
  inventory.meta = { 101: meta };
  inventory.items.set(42, { objectId: 42, itemId: 101, count: 1 });
  inventory.sysMsg = { 798: { text: 'Synthetic recipe warning' }, 999: { text: 'Synthetic item warning' } };
  inventory.useDialog = {
    request(options) { return new Promise(resolve => requests.push({ options, resolve })); },
    reset() { for (const r of requests) r.resolve({ accepted: false }); },
  };
  return { inventory, used, requests };
}

test('recipe warning has precedence; only OK sends the captured item object', async () => {
  const h = warningFixture(), pending = h.inventory.useItem(42);
  assert.deepEqual(h.used, []);
  assert.equal(h.requests[0].options.message, 'Synthetic recipe warning');
  assert.equal(h.requests[0].options.type, 'warning');
  h.requests[0].resolve({ accepted: true }); await pending;
  assert.deepEqual(h.used, [42]);
});

test('positive popup uses its exact message; Cancel sends no request', async () => {
  const h = warningFixture({ isRecipe: false, popMsgNum: 999 });
  const pending = h.inventory.useItem(42);
  assert.equal(h.requests[0].options.message, 'Synthetic item warning');
  h.requests[0].resolve({ accepted: false }); await pending;
  assert.deepEqual(h.used, []);
});

test('session reset and item removal invalidate pending item-use confirmations', async () => {
  for (const reset of [true, false]) {
    const h = warningFixture(), pending = h.inventory.useItem(42);
    if (reset) h.inventory.resetSession();
    else await h.inventory.applyUpdate([{ objectId: 42, change: 'remove' }]);
    h.requests[0].resolve({ accepted: true }); await pending;
    assert.deepEqual(h.used, []);
    assert.equal(h.inventory.pendingUse, null);
  }
});

test('missing original warning text never silently uses the item', async () => {
  const h = warningFixture(); h.inventory.sysMsg = {};
  await h.inventory.useItem(42);
  assert.deepEqual(h.used, []); assert.equal(h.requests.length, 0);
});

test('a second warned item cannot replace the original confirmation target', async () => {
  const h = warningFixture();
  h.inventory.items.set(43, { objectId: 43, itemId: 101, count: 1 });
  const pending = h.inventory.useItem(42);
  await h.inventory.useItem(43);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ accepted: true }); await pending;
  assert.deepEqual(h.used, [42]);
});

test('paired accessories resolve by worn object identity, including identical item templates', () => {
  const objects = { lear: 41, rear: 42, lfinger: 43, rfinger: 44 };
  const item = (objectId, slot) => ({ itemId: 101, objectId, slot, equipped: 1 });
  assert.deepEqual(inventoryEquipSlots(item(41, 6), objects), ['lear']);
  assert.deepEqual(inventoryEquipSlots(item(42, 6), objects), ['rear']);
  assert.deepEqual(inventoryEquipSlots(item(43, 48), objects), ['lfinger']);
  assert.deepEqual(inventoryEquipSlots(item(44, 48), objects), ['rfinger']);
  assert.deepEqual(inventoryEquipSlots(item(41, 6), null), []);
  assert.deepEqual(inventoryEquipSlots(item(45, 6), objects), []);
  assert.deepEqual(inventoryEquipSlots({ ...item(41, 6), equipped: 0 }, objects), []);
  assert.deepEqual(inventoryEquipSlots(item(41, 6), { lear: 41, rear: 41 }), ['lear'],
    'original script checks left first');
});

test('a later inventory update survives an older snapshot waiting for warning text', async () => {
  const originalFetch = globalThis.fetch;
  let releaseMessages;
  const messages = new Promise(resolve => { releaseMessages = resolve; });
  globalThis.fetch = async path => ({ ok: true, json: async () => {
    if (path === '/gamedata/systemmsg.json') return messages;
    if (path === '/gamedata/itemmeta.json') return { 101: { name: 'Synthetic item' } };
    return [];
  } });
  const inventory = new InventoryWnd();
  inventory.render = () => {};
  try {
    const snapshot = inventory.setItems([{ objectId: 42, itemId: 101, count: 1 }]);
    const update = inventory.applyUpdate([{ objectId: 42, itemId: 101, count: 2, change: 2 }]);
    await update;
    releaseMessages({});
    await snapshot;
    assert.equal(inventory.items.get(42).count, 2, 'server arrival order survives metadata latency');
  } finally {
    releaseMessages({});
    globalThis.fetch = originalFetch;
  }
});

function actionFixture({ count = 7, consumeType = 1, crystallizable = 1, ability = 1 } = {}) {
  const destroyed = [], crystallized = [];
  const h = warningFixture({ name: 'Synthetic item', consumeType, crystallizable });
  h.inventory.items.get(42).count = count;
  h.inventory.getCharSheet = () => ({ crystallizeAbility: ability });
  h.inventory.onDestroy = (...args) => destroyed.push(args);
  h.inventory.onCrystallize = (...args) => crystallized.push(args);
  Object.assign(h.inventory.sysMsg, {
    73: { text: 'Synthetic quantity $s1' }, 74: { text: 'Synthetic destroy $s1' },
    336: { text: 'Synthetic crystallize $s1' },
  });
  return { ...h, destroyed, crystallized };
}

test('native stackable consume types ask quantity without changing empty, zero or excessive input', async () => {
  for (const consumeType of [1, 2, 3]) for (const value of ['', '0', '2', '99']) {
    const h = actionFixture({ consumeType });
    const pending = h.inventory.requestItemAction('destroy', 42, { source: 'inventory' });
    assert.equal(h.requests[0].options.type, 'number');
    assert.equal(h.requests[0].options.parameter, 7);
    assert.equal(h.requests[0].options.message, 'Synthetic quantity Synthetic item');
    h.requests[0].resolve({ accepted: true, value }); await pending;
    assert.deepEqual(h.destroyed, [[42, Number(value)]]);
  }
});

test('single/nonstackable destroy warns for one; positive all-item drag metadata preserves its count', async () => {
  for (const input of [{ count: 1, consumeType: 1 }, { count: 7, consumeType: 0 }]) {
    const h = actionFixture(input), pending = h.inventory.requestItemAction('destroy', 42, { source: 'inventory' });
    assert.equal(h.requests[0].options.type, 'warning');
    h.requests[0].resolve({ accepted: true }); await pending;
    assert.deepEqual(h.destroyed, [[42, 1]]);
  }
  const h = actionFixture(), pending = h.inventory.requestItemAction('destroy', 42, { source: 'inventory', allItemCount: 5 });
  assert.equal(h.requests[0].options.type, 'warning');
  h.requests[0].resolve({ accepted: true }); await pending;
  assert.deepEqual(h.destroyed, [[42, 5]], 'reserved all count is not substituted with current stack size');
});

test('quantity Cancel, unsupported conversion, removal and reset never destroy a stale item', async () => {
  for (const scenario of ['cancel', 'overflow', 'malformed', 'remove', 'reset']) {
    const h = actionFixture(), pending = h.inventory.requestItemAction('destroy', 42, { source: 'inventory' });
    if (scenario === 'remove') await h.inventory.applyUpdate([{ objectId: 42, change: 'remove' }]);
    if (scenario === 'reset') h.inventory.resetSession();
    h.requests[0].resolve({ accepted: scenario !== 'cancel',
      value: scenario === 'overflow' ? '2147483648' : scenario === 'malformed' ? '2oops' : '2' });
    await pending; assert.deepEqual(h.destroyed, []);
  }
});

test('crystallize requires the actual server capability, source item flag and inventory/equip origin', async () => {
  for (const option of [{ ability: 0 }, { crystallizable: 0 }, { crystallizable: null }, {}]) {
    const h = actionFixture(option);
    await h.inventory.requestItemAction('crystallize', 42, { source: Object.keys(option).length ? 'inventory' : 'quest' });
    assert.equal(h.requests.length, 0); assert.deepEqual(h.crystallized, []);
  }
  for (const source of ['inventory', 'equip']) {
    const h = actionFixture({ count: 7 }), pending = h.inventory.requestItemAction('crystallize', 42, { source });
    assert.equal(h.requests[0].options.type, 'warning');
    assert.equal(h.requests[0].options.message, 'Synthetic crystallize Synthetic item');
    h.requests[0].resolve({ accepted: true }); await pending;
    assert.deepEqual(h.crystallized, [[42, 1]]);
  }
});

test('missing consume data cannot turn a stack into a one-item destroy warning', async () => {
  const h = actionFixture({ consumeType: null });
  await h.inventory.requestItemAction('destroy', 42, { source: 'inventory' });
  assert.equal(h.requests.length, 0); assert.deepEqual(h.destroyed, []);
});

test('crystallize control visibility follows the server byte, including clearing unknown session state', () => {
  const h = actionFixture(); h.inventory.CrystallizeButtonEl = new Element();
  for (const [ability, visible] of [[undefined, false], [0, false], [1, true], [7, true]]) {
    h.inventory.getCharSheet = () => ({ crystallizeAbility: ability }); h.inventory.render();
    assert.equal(h.inventory.CrystallizeButtonEl.style.display, visible ? '' : 'none');
  }
});

test('destroy rejects unknown drag origins without reserving a dialog; admitted origins retain the item', async () => {
  for (const source of [undefined, null, '', 'shortcut', 'InventoryItem', 1]) {
    const h = actionFixture({ count: 1 });
    await h.inventory.requestItemAction('destroy', 42, { source });
    assert.equal(h.requests.length, 0);
    assert.equal(h.inventory.pendingUse, null);
    assert.deepEqual(h.destroyed, []);
  }
  for (const source of ['inventory', 'quest', 'equip', 'pet']) {
    const h = actionFixture({ count: 1 });
    const pending = h.inventory.requestItemAction('destroy', 42, { source });
    assert.equal(h.requests.length, 1);
    h.requests[0].resolve({ accepted: true });
    await pending;
    assert.deepEqual(h.destroyed, [[42, 1]]);
  }
});

async function replayPageFixture() {
  const [{ readFileSync }, vm] = await Promise.all([import('node:fs'), import('node:vm')]);
  const page = readFileSync(new URL('./inventory-dialogs.html', import.meta.url), 'utf8');
  const start = page.indexOf('async function load() {');
  const end = page.indexOf('const dragEvents = []', start);
  assert.ok(start >= 0 && end > start, 'execute the actual replay load and Reset handlers');
  const fields = Object.fromEntries(['item', 'count', 'receipt', 'show', 'capability',
    'source', 'destroy', 'crystallize', 'use', 'reset'].map(name => [name, new Element()]));
  fields.item.value = '101'; fields.count.value = '7'; fields.source.value = 'inventory';
  fields.receipt.textContent = 'Synthetic initial receipt';
  const meta = {
    101: { name: 'Synthetic first item', consumeType: 1, crystallizable: 0 },
    102: { name: 'Synthetic second item', consumeType: 0, crystallizable: 1 },
  };
  const inventory = new InventoryWnd();
  inventory.meta = meta; inventory.sysMsg = {}; inventory.render = () => {};
  const pending = [], placements = [], applyItems = inventory.setItems.bind(inventory);
  // Real inventory state/reset methods; delay only completion at the page's
  // async metadata boundary, independently for each load.
  inventory.setItems = items => {
    const applied = applyItems(items);
    return new Promise((resolve, reject) => pending.push(() => applied.then(resolve, reject)));
  };
  inventory.place = position => placements.push(position);
  const status = { textContent: 'Synthetic initial status' };
  const load = vm.runInNewContext(page.slice(start, end) + '\nload;', {
    inventory, meta, status, field: id => fields[id],
  }, { filename: 'inventory-dialogs.html' });
  return { fields, inventory, pending, placements, status, load };
}

test('actual replay Reset retires an item load still awaiting completion', async () => {
  const h = await replayPageFixture();
  const loading = h.load();
  assert.equal(h.inventory.items.get(1).itemId, 101);
  h.fields.reset.dispatch('click');
  const resetStatus = h.status.textContent;
  await h.pending[0](); await loading;
  assert.equal(h.inventory.items.size, 0);
  assert.equal(h.inventory.root.style.display, 'none');
  assert.equal(h.placements.length, 0, 'retired load must not place or show the window');
  assert.equal(h.status.textContent, resetStatus);
  assert.equal(h.fields.receipt.textContent, 'Synthetic initial receipt');
});

test('actual replay keeps the latest Load when an older completion arrives last', async () => {
  const h = await replayPageFixture();
  const first = h.load();
  h.fields.item.value = '102'; h.fields.count.value = '3';
  const second = h.load();
  await h.pending[1](); await second;
  const latestStatus = h.status.textContent;
  assert.match(latestStatus, /Synthetic second item/);
  h.fields.receipt.textContent = 'Synthetic newer action receipt';
  await h.pending[0](); await first;
  assert.equal(h.inventory.items.get(1).itemId, 102);
  assert.equal(h.inventory.items.get(1).count, 3);
  assert.notEqual(h.inventory.root.style.display, 'none');
  assert.equal(h.placements.length, 1, 'older completion cannot reposition the active replay');
  assert.equal(h.status.textContent, latestStatus);
  assert.equal(h.fields.receipt.textContent, 'Synthetic newer action receipt');
});
