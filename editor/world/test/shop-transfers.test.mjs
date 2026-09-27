// Elbera Tools — actual ShopWnd with synthetic metadata and DOM only.
// Source provenance is checked separately; these fixtures are not game data.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { search: '' };
globalThis.window = { innerWidth: 1024, innerHeight: 768, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
class Element {
  constructor() { this.style = {}; this.dataset = {}; this.children = []; this.attributes = {}; this.classList = { add() {}, remove() {} }; }
  appendChild(el) { this.children.push(el); return el; }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 256, height: 401 }; }
}
globalThis.document = { createElement: () => new Element(), body: new Element() };
const { Layout } = await import('../js/ui/layout.js');
const { Font } = await import('../js/ui/font.js');
const { Skin } = await import('../js/ui/skin.js');
const { ShopWnd } = await import('../js/ui/shopwnd.js');
Layout.windowSize = () => ({ w: 256, h: 401 });
Layout.pos = () => ({ x: 0, y: 0 });
Layout.sizeOf = () => ({ w: 239, h: 139 });
Font.set = (el, value) => { el.textContent = value; };
Skin.px = value => value;
const metadata = [{ 101: { name: 'Synthetic ring', consumeType: 0 },
  102: { name: 'Synthetic potion', consumeType: 2 }, 103: { name: 'Unknown type' } },
  [134,136,137,138,139,140,141,142,143].map(id => ({ id, string: `Source string ${id}` })),
  { 72: { text: 'Quantity $s1' }, 1338: { text: 'Synthetic stock warning' } }];
const row = (itemId, count = 0, objectId = 42) => ({ itemId, count, objectId, price: 11 });
async function fixture(mode = 'buy', rows = [row(101), row(102)]) {
  const sent = [], requests = [], shop = new ShopWnd(document.body, {
    loadMetadata: async () => metadata,
    onBuy: items => sent.push({ mode: 'buy', items }), onSell: items => sent.push({ mode: 'sell', items }),
  });
  shop.dialog = { request: options => new Promise(resolve => requests.push({ options, resolve })), reset() {} };
  await shop._open(mode, rows, 1234);
  return { shop, sent, requests };
}
function confirm(h, pending, value) { h.requests.at(-1).resolve({ accepted: true, value }); return pending; }

test('unlimited nonstack equipment creates separate count1 rows, and exact packet rows survive', async () => {
  const h = await fixture(), entry = h.shop.topItems[0];
  await h.shop._offerMove(entry, 'top'); await h.shop._offerMove(entry, 'top');
  assert.equal(h.requests.length, 0); assert.equal(h.shop.cart.size, 2);
  await h.shop._ok();
  assert.deepEqual(h.sent, [{ mode: 'buy', items: [{ itemId: 101, count: 1 }, { itemId: 101, count: 1 }] }]);
  assert.equal(h.shop.visible, false); assert.equal(h.shop.cart.size, 0);
});

test('unlimited stack buy prompts with -1, merges quantities and does not decrement merchant stock', async () => {
  const h = await fixture(), entry = h.shop.topItems[1];
  let p = h.shop._offerMove(entry, 'top');
  assert.equal(h.requests[0].options.parameter, -1); assert.equal(h.requests[0].options.type, 'number');
  await confirm(h, p, '2'); p = h.shop._offerMove(entry, 'top'); await confirm(h, p, '3');
  assert.equal(h.shop.cart.size, 1); assert.equal([...h.shop.cart.values()][0].count, 5);
  assert.equal(entry.count, 0); assert.equal(h.shop.priceEl.textContent, '55');
});

test('single stack direct buy appends; bottom stack count1 still prompts and All parameter is1', async () => {
  const h = await fixture('buy', [row(102, 1)]), entry = h.shop.topItems[0];
  await h.shop._offerMove(entry, 'top'); await h.shop._offerMove(entry, 'top');
  assert.equal(h.requests.length, 0); assert.equal(h.shop.cart.size, 2);
  const bottom = [...h.shop.cart.values()][0], p = h.shop._offerMove(bottom, 'bottom');
  assert.equal(h.requests[0].options.parameter, 1); await confirm(h, p, '1');
  assert.equal(h.shop.cart.size, 1);
});

test('limited stock sums class counts across separate rows; Warning1338 never purchases', async () => {
  const h = await fixture('buy', [row(101, 1)]), entry = h.shop.topItems[0];
  await h.shop._offerMove(entry, 'top'); await h.shop._offerMove(entry, 'top');
  const p = h.shop._ok();
  assert.equal(h.requests[0].options.type, 'warning'); assert.equal(h.requests[0].options.message, 'Synthetic stock warning');
  await confirm(h, p); assert.deepEqual(h.sent, []); assert.equal(h.shop.visible, true);
});

test('zero, blank, negative, noninteger and uncertified signed-overflow quantities do not transfer', async () => {
  const h = await fixture();
  for (const input of ['0', '', '-1', '1.5', '2147483648', '4294967297', '1e2']) {
    const p = h.shop._offerMove(h.shop.topItems[1], 'top'); await confirm(h, p, input);
    assert.equal(h.shop.cart.size, 0, input);
  }
});

test('sell clamps top-to-bottom to stock and copies packet rows before mutations', async () => {
  const original = row(102, 5), h = await fixture('sell', [original]);
  const p = h.shop._offerMove(h.shop.topItems[0], 'top');
  assert.equal(h.requests[0].options.parameter, 5); await confirm(h, p, '12');
  assert.equal(h.shop.topItems.length, 0); assert.equal(original.count, 5);
  assert.equal([...h.shop.cart.values()][0].count, 5);
  await h.shop._ok(); assert.deepEqual(h.sent, [{ mode: 'sell', items: [{ objectId: 42, count: 5 }] }]);
});

test('sell return preserves source dialog overshoot behavior, while price cannot go negative', async () => {
  const h = await fixture('sell', [row(102, 1)]);
  await h.shop._offerMove(h.shop.topItems[0], 'top');
  const p = h.shop._offerMove([...h.shop.cart.values()][0], 'bottom'); await confirm(h, p, '3');
  assert.equal(h.shop.topItems[0].count, 3); assert.equal(h.shop.cart.size, 0); assert.equal(h.shop.priceEl.textContent, '0');
});

test('replacement list, close and session reset retire old quantity acceptance', async () => {
  for (const retire of [shop => shop.openSell([row(101, 1)], 9), shop => shop.hide(), shop => shop.resetSession()]) {
    const h = await fixture(), p = h.shop._offerMove(h.shop.topItems[1], 'top');
    await retire(h.shop); await confirm(h, p, '2');
    assert.equal(h.shop.cart.size, 0); assert.deepEqual(h.sent, []);
  }
});

test('late original metadata cannot append old rows or reopen a reset session', async () => {
  const releases = [], shop = new ShopWnd(document.body, { loadMetadata: () => new Promise(resolve => releases.push(resolve)) });
  const old = shop.openBuy([row(101)], 10), latest = shop.openBuy([row(102)], 20);
  releases[1](metadata); await latest; releases[0](metadata); await old;
  assert.deepEqual(shop.panes.top.el.children.map(el => el.dataset.itemId), [102]);
  assert.equal(shop.money, 20); assert.equal(shop.adenaEl.textContent, '20');
  const pending = shop.openSell([row(101, 1)], 30); shop.resetSession(); releases[2](metadata); await pending;
  assert.equal(shop.visible, false); assert.equal(shop.topItems.length, 0);
});

test('unknown ConsumeType never invents a transfer; empty OK still sends original zero-row request', async () => {
  const h = await fixture('buy', [row(103)]); await h.shop._offerMove(h.shop.topItems[0], 'top');
  assert.equal(h.shop.cart.size, 0); assert.equal(h.requests.length, 0);
  await h.shop._ok(); assert.deepEqual(h.sent, [{ mode: 'buy', items: [] }]);
});

test('labels come from mode-specific source strings and Adena remains the list snapshot', async () => {
  for (const mode of ['buy', 'sell']) {
    const h = await fixture(mode);
    assert.equal(h.shop.labels.top.textContent, `Source string ${mode === 'buy' ? 137 : 138}`);
    assert.equal(h.shop.labels.bottom.textContent, `Source string ${mode === 'buy' ? 139 : 137}`);
    assert.equal(h.shop.labels.PriceConstText.textContent, `Source string ${mode === 'buy' ? 142 : 143}`);
    h.shop.onInvUpdate(); assert.equal(h.shop.adenaEl.textContent, '1,234');
  }
});

test('dialog class reservation returns the first class row, even when the second was selected', async () => {
  const h = await fixture('buy', [row(102, 1)]), top = h.shop.topItems[0];
  await h.shop._offerMove(top, 'top'); await h.shop._offerMove(top, 'top');
  const [first, second] = [...h.shop.cart.values()];
  const p = h.shop._offerMove(second, 'bottom'); await confirm(h, p, '1');
  assert.equal(h.shop.cart.has(first.rowKey), false); assert.equal(h.shop.cart.has(second.rowKey), true);
});

test('source sell overshoot changes the accumulator differently for an absent versus existing top class', async () => {
  for (const sourceCount of [2, 4]) {
    const h = await fixture('sell', [{ ...row(102, sourceCount), price: 5 }, { ...row(101, 1, 43), price: 100 }]);
    const p = h.shop._offerMove(h.shop.topItems[0], 'top'); await confirm(h, p, '2');
    await h.shop._offerMove(h.shop.topItems.find(entry => entry.itemId === 101), 'top');
    assert.equal(h.shop.currentPrice, 110);
    const ret = h.shop._offerMove([...h.shop.cart.values()].find(entry => entry.itemId === 102), 'bottom');
    await confirm(h, ret, '3');
    assert.equal(h.shop.currentPrice, sourceCount === 2 ? 95 : 100);
    assert.equal(h.shop.priceEl.textContent, sourceCount === 2 ? '95' : '100');
  }
});

test('source window bounds, creation anchor and reset position remain distinct', async () => {
  const oldWindow = Layout.window, oldDefault = Layout.windowDefault;
  Layout.window = () => ({ position: { selfAnchor: 4, targetAnchor: 4, target: '', offsetX: 0, offsetY: 0 } });
  Layout.windowDefault = () => ({ anchor: 1, anchored: false, offsetX: 200, offsetY: 150, w: null, h: null });
  try {
    const h = await fixture();
    assert.equal(h.shop.root.style.height, '401px');
    assert.equal(h.shop.root.style.left, '0px'); assert.equal(h.shop.root.style.top, '184px');
    h.shop.onDefaultPosition(); assert.equal(h.shop.root.style.left, '200px'); assert.equal(h.shop.root.style.top, '150px');
  } finally { Layout.window = oldWindow; Layout.windowDefault = oldDefault; }
});
