// Elbera Tools: actual recipe windows/controller with synthetic metadata.
// These fixtures exercise field and lifecycle wiring, not native pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { search: '' };
globalThis.window = { innerWidth: 1024, innerHeight: 768 };
globalThis.fetch = async () => ({ ok: false });
class Element {
  constructor(tag) { this.tagName = tag; this.style = {}; this.dataset = {}; this.children = []; this.attributes = {}; this.events = new Map(); }
  appendChild(el) { this.children.push(el); return el; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, fn) { this.events.set(name, [...this.events.get(name) || [], fn]); }
  dispatch(name, event = {}) { for (const fn of this.events.get(name) || []) fn({ stopPropagation() {}, ...event }); }
}
globalThis.document = { createElement: tag => new Element(tag), body: new Element('body') };
const { RecipeWnd } = await import('../js/ui/recipewnd.js');
const { Skin } = await import('../js/ui/skin.js');
const { Font } = await import('../js/ui/font.js');
const { Layout } = await import('../js/ui/layout.js');
Skin.sprite = () => ({ w: 16, h: 20 }); Skin.apply = (el, ref) => { el.texture = ref; };
Skin.hstrip = () => {}; Skin.scale = 1;
Font.set = (el, text, options) => { el.textContent = text; el.fontOptions = options; };
Font.measure = text => text.length * 7; Font.lineHeight = () => 12;
Layout.native = () => '#112233';

const position = (x = 0, y = 0) => ({ selfAnchor: 1, targetAnchor: 1, target: '', offsetX: x, offsetY: y });
const node = (name, type = 'TextBox', extra = {}) => ({ name, type, width: 90, height: 12,
  sizeMode: 'absolute', position: position(), color: '#AABBCC', textures: [], children: [], ...extra });
const button = name => node(name, 'Button', { textId: 1, textures: ['synthetic.button'] });
const grid = name => node(name, 'ItemWindow', { width: 100, height: 70,
  grid: { cellX: 32, cellY: 32, gapX: 5, gapY: 3, rows: 2, capacity: 160 } });
function metadata() {
  const makeRoot = (name, children) => node(name, 'Window', { width: 256, height: 401,
    textures: ['synthetic.background'], position: { ...position(), selfAnchor: 5, targetAnchor: 5 }, children });
  const common = ['txtName', 'txtMPConsume', 'txtSuccessRate'].map(name => node(name));
  return { data: { format: 'l2-interlude-recipes-v1', nativeLayoutProof: { status: 'verified' },
    nativeTreeFlow: { status: 'verified-static-original' }, native: {
      recipeShortcut: { status: 'verified-ordinary-RecipeItem-path', type: 5, id: 'index',
        characterType: 1, use: 'makeInfo', name: 'recipeItemId', icon: 'productId' },
      fullItemName: { additionalNameSentinel: 'NAME_None' },
      windowTitles: { RecipeManufactureWnd: 663, RecipeTreeWnd: 662 }, tree: {
      status: 'verified-fresh-node-flow', freshRootExpanded: true, freshChildExpanded: false,
      lineBreakOrigin: 'node-origin-before-button', blank: 'flush-line-then-add-height',
    } }, itemNames: { 900: { name: 'Product source name', additionalName: '' } },
    strings: { 1: 'Button', 662: 'Tree source title', 663: 'Make source title', 1214: 'Common source book', 1215: 'Dwarven source book' },
    records: [{ index: 701, recipeItemId: 800, level: 2, productId: 900, productCount: 3,
      mpConsume: 12, successRate: 60, materials: [{ itemId: 901, count: 4 }] }],
    windows: {
      RecipeBookWnd: makeRoot('RecipeBookWnd', [node('txtCount'), grid('RecipeItem'), button('btnTrash')]),
      RecipeManufactureWnd: makeRoot('RecipeManufactureWnd', [...common,
        ...['txtResultValue', 'txtCountValue', 'txtMsg'].map(name => node(name)),
        node('txtMP', 'TextBox', { position: position(2, 10) }), node('txtMP', 'TextBox', { position: position(4, 80) }),
        node('txtResult', 'TextBox', { position: position(6, 30) }), node('txtResult', 'TextBox', { position: position(8, 90) }),
        node('texItem', 'Texture'), node('texMPBar', 'Texture', { textures: ['source.mp'] }), grid('ItemWnd'),
        ...['btnManufacture', 'btnPrev', 'btnClose', 'btnRecipeTree'].map(button)]),
      RecipeTreeWnd: makeRoot('RecipeTreeWnd', [...common, node('txtLevel'), node('texIcon', 'Texture'),
        node('MainTree', 'TreeCtrl'), button('btnClose')]),
    } },
    items: { 800: { name: 'Recipe source name', icon: 'icons/recipe.png' },
      900: { name: 'Product source name', icon: 'icons/product.png' },
      901: { name: 'Material source name', icon: 'icons/material.png' } },
    messages: { 74: { text: 'Delete $s1?' }, 959: { text: 'Made $s2 $s1' }, 960: { text: 'Failed $s1' } },
  };
}
const book = { bookType: 1, maxMp: 400, recipes: [{ recipeId: 701, index: 1 }] };
const info = status => ({ recipeId: 701, bookType: 1, mp: 30, maxMp: 100, status });
const descendants = el => [el, ...el.children.flatMap(descendants)];
const control = (wnd, name, window = 'RecipeManufactureWnd') => descendants(wnd.windows[window].body).find(el => el.dataset.control === name);
const cell = wnd => descendants(wnd.windows.RecipeBookWnd.body).find(el => el.dataset.recipeId === 701);
async function fixture(options = {}) {
  const sent = [], inventory = [{ itemId: 900, count: 2 }, { itemId: 901, count: 1 }];
  const wnd = new RecipeWnd(new Element('body'), { send: (op, data) => { sent.push({ op, ...data }); return true; },
    getItems: () => inventory, getPlayer: () => ({ id: 42 }), loadMetadata: async () => metadata(), ...options });
  await wnd.ready; assert.equal(wnd.lastError, null);
  return { wnd, sent, inventory };
}
function openMake(wnd) { wnd.book(book); cell(wnd).dispatch('dblclick'); assert.equal(wnd.info(info(-1)), true); }

test('book uses original recipe name and product icon; detail/craft use recipe identity instead of row ordinal', async () => {
  const { wnd, sent } = await fixture(); wnd.capacities({ recipe: 77, dwarvenRecipe: 88 }); wnd.book(book);
  assert.equal(cell(wnd).attributes['aria-label'], 'Recipe source name');
  assert.match(cell(wnd).style.backgroundImage, /product\.png/);
  assert.equal(control(wnd, 'txtCount', 'RecipeBookWnd').textContent, '(1/77)');
  const selected = cell(wnd); selected.dispatch('click'); selected.dispatch('click');
  assert.equal(cell(wnd), selected, 'both clicks retain the target needed for native browser dblclick');
  selected.dispatch('dblclick'); assert.deepEqual(sent, [{ op: 'recipeMakeInfo', recipeId: 701 }]);
  assert.equal(wnd.windows.RecipeBookWnd.visible, true);
  wnd.info(info(-1)); assert.equal(wnd.windows.RecipeBookWnd.visible, false);
  assert.equal(control(wnd, 'txtMsg').textContent, '');
  assert.equal(control(wnd, 'txtMPConsume').textContent, '12');
  assert.equal(control(wnd, 'txtResultValue').textContent, '3');
  control(wnd, 'btnManufacture').dispatch('click');
  assert.deepEqual(sent.at(-1), { op: 'recipeMakeSelf', recipeId: 701 });
  assert.equal(control(wnd, 'txtMsg').textContent, '', 'request does not pretend crafting succeeded');
  wnd.info(info(1)); assert.equal(control(wnd, 'txtMsg').textContent, 'Made 3 Product source name');
});
test('book drag preserves recipe index and stale/closed books cannot provide assignment payloads', async () => {
  const { wnd } = await fixture(); const payloads = []; let cancelled = 0;
  const event = { preventDefault() { cancelled++; }, dataTransfer: { setData: (...args) => payloads.push(args) } };
  assert.equal(wnd.canAssignShortcut(701), false); wnd.book(book);
  const current = cell(wnd); assert.equal(current.draggable, true);
  current.dispatch('dragstart', event);
  assert.deepEqual(payloads, [['application/x-l2vzla', '{"type":"recipe","id":701}']]);
  assert.equal(event.dataTransfer.effectAllowed, 'copy');
  wnd.state.closeBook(); current.dispatch('dragstart', event);
  wnd.book(book); current.dispatch('dragstart', event);
  const newer = cell(wnd); wnd.reset(); newer.dispatch('dragstart', event);
  assert.equal(cancelled, 3); assert.equal(payloads.length, 1);
});
test('restored recipe shortcuts use recipe names/product icons and request details with no learned-book substitution', async () => {
  const { wnd, sent } = await fixture();
  assert.deepEqual(wnd.shortcutInfo(701), { name: 'Recipe source name', icon: '/gamedata/icons/product.png' });
  assert.equal(wnd.shortcutInfo(800), null); assert.equal(wnd.shortcutInfo(900), null);
  assert.equal(wnd.useShortcut(701), true); assert.equal(wnd.state.bookData, null);
  assert.deepEqual(sent, [{ op: 'recipeMakeInfo', recipeId: 701 }]);
  wnd.info(info(-1)); assert.equal(wnd.windows.RecipeManufactureWnd.visible, true);
  assert.equal(wnd.canAssignShortcut(701), false, 'detail is not evidence of a learned recipe');
  delete wnd.data.native.recipeShortcut.icon;
  assert.equal(wnd.useShortcut(701), false); assert.equal(wnd.shortcutInfo(701), null);
  assert.equal(sent.length, 1, 'unproved metadata cannot generate a shortcut action');
});

test('independent book/make windows copy source position only on received window events; duplicate labels survive', async () => {
  const { wnd, sent } = await fixture(); wnd.windows.RecipeManufactureWnd.place({ left: 71, top: 82 });
  wnd.windows.RecipeManufactureWnd.root.getBoundingClientRect = () => ({ left: 0, top: 0 });
  openMake(wnd);
  assert.equal(wnd.windows.RecipeBookWnd.root.style.left, '71px');
  const craft = control(wnd, 'btnManufacture'), bar = control(wnd, 'texMPBar');
  wnd.windows.RecipeManufactureWnd.place({ left: 91, top: 92 }); wnd.updateMp({ mp: 45 });
  assert.equal(wnd.windows.RecipeManufactureWnd.root.style.left, '91px', 'MP event cannot reset a dragged window');
  assert.equal(control(wnd, 'btnManufacture'), craft, 'MP cannot replace controls under a pointer');
  assert.equal(control(wnd, 'texMPBar'), bar);
  craft.dispatch('click'); assert.deepEqual(sent.at(-1), { op: 'recipeMakeSelf', recipeId: 701 });
  assert.equal(control(wnd, 'texMPBar').style.width, '74px');
  assert.equal(wnd.updateMp({ id: 99, mp: 100 }), false);
  wnd.book({ ...book, bookType: 0 });
  assert.equal(wnd.windows.RecipeManufactureWnd.visible, true, 'D6 has no hide-manufacture instruction');
  assert.equal(wnd.windows.RecipeBookWnd.root.style.left, '91px');
  assert.equal(wnd.windows.RecipeBookWnd.title, 'Dwarven source book');
  const mp = descendants(wnd.windows.RecipeManufactureWnd.body).filter(el => el.dataset.control === 'txtMP');
  assert.deepEqual(mp.map(el => el.style.top), ['10px', '80px']);
  assert.equal(new Set(mp.map(el => el.dataset.sourcePath)).size, 2);
  assert.equal(wnd.windows.RecipeManufactureWnd.root.style.height, '401px');
  assert.equal(wnd.windows.RecipeManufactureWnd.body.style.inset, '0');
});

test('inventory updates alter materials without optimistic product totals; Back waits for actual book response', async () => {
  const { wnd, sent, inventory } = await fixture(); openMake(wnd);
  let material = descendants(control(wnd, 'ItemWnd')).find(el => el.dataset.itemId === 901);
  assert.equal(material.attributes['aria-disabled'], 'true'); assert.equal(material.dataset.owned, 1);
  const craft = control(wnd, 'btnManufacture');
  inventory[1].count = 4; inventory[0].count = 99; wnd.onInvUpdate();
  assert.equal(control(wnd, 'btnManufacture'), craft, 'inventory refresh cannot replace unrelated controls');
  material = descendants(control(wnd, 'ItemWnd')).find(el => el.dataset.itemId === 901);
  assert.equal(material.attributes['aria-disabled'], 'false'); assert.equal(material.dataset.owned, 4);
  assert.equal(control(wnd, 'txtCountValue').textContent, '2', 'source refreshes this total on make-info, not InventoryUpdate');
  const stale = control(wnd, 'btnManufacture'); control(wnd, 'btnPrev').dispatch('click');
  assert.deepEqual(sent.at(-1), { op: 'recipeBookOpen', bookType: 1 });
  assert.equal(wnd.windows.RecipeManufactureWnd.visible, false); assert.equal(wnd.windows.RecipeBookWnd.visible, false);
  const n = sent.length; stale.dispatch('click'); assert.equal(sent.length, n);
});

test('fresh tree starts collapsed, uses product names and source cursor flow, and remains independent of manufacture', async () => {
  const { wnd, inventory } = await fixture(); openMake(wnd);
  control(wnd, 'btnRecipeTree').dispatch('click');
  assert.equal(wnd.lastError, null); assert.equal(wnd.windows.RecipeTreeWnd.visible, true);
  const tree = () => control(wnd, 'MainTree', 'RecipeTreeWnd');
  let expand = descendants(tree()).find(el => el.dataset.treeNode === 'root/0');
  assert.equal(expand.attributes['aria-expanded'], 'false');
  assert.equal(expand.attributes['aria-label'], 'Product source name');
  assert.equal(expand.style.left, '1px'); assert.equal(expand.style.top, '15px');
  assert.ok(descendants(tree()).some(el => el.textContent === 'Product source name'));
  assert.ok(!descendants(tree()).some(el => el.textContent === 'Recipe source name'));
  assert.ok(!descendants(tree()).some(el => el.textContent === 'Material source name'));
  expand.dispatch('click');
  const leaf = descendants(tree()).find(el => el.textContent === 'Material source name');
  assert.equal(leaf.style.left, '68px'); assert.equal(leaf.style.top, '46px');
  assert.ok(descendants(tree()).some(el => el.textContent === '(1/4)'));
  inventory[1].count = 100; wnd.onInvUpdate();
  assert.ok(descendants(tree()).some(el => el.textContent === '(1/4)'), 'original tree is a show-time inventory snapshot');
  control(wnd, 'btnClose').dispatch('click');
  assert.equal(wnd.windows.RecipeManufactureWnd.visible, false); assert.equal(wnd.windows.RecipeTreeWnd.visible, true);
  control(wnd, 'btnClose', 'RecipeTreeWnd').dispatch('click');
  assert.equal(wnd.windows.RecipeTreeWnd.visible, false);
  const state = wnd.state.tree; expand.dispatch('click'); assert.equal(wnd.state.tree, state);
});

test('full source item names and pinned native titles appear without guessed grade letters', async () => {
  const source = metadata(); source.data.itemNames[900].additionalName = 'Source suffix';
  const { wnd } = await fixture({ loadMetadata: async () => source }); openMake(wnd); wnd.info(info(1));
  assert.equal(wnd.windows.RecipeManufactureWnd.title, 'Make source title');
  assert.equal(control(wnd, 'txtName').textContent, 'Product source name-Source suffix');
  assert.equal(control(wnd, 'txtMsg').textContent, 'Made 3 Product source name-Source suffix');
  source.data.itemNames[900].additionalName = 'None';
  assert.equal(wnd.fullName(900), 'Product source name-None');
  source.data.itemNames[900].additionalName = 'NAME_None';
  assert.equal(wnd.fullName(900), 'Product source name');
});

test('missing skin artwork uses only explicit source texture files at native pixel size', async () => {
  const source = metadata();
  source.data.sourceTextures = { 'L2UI.RecipeWnd.TreePlus': {
    file: 'icons/recipes/source-plus.png', width: 16, height: 16, sourceObject: 'source.RecipeWnd.TreePlus',
  } };
  const { wnd } = await fixture({ loadMetadata: async () => source }); openMake(wnd);
  const original = Skin.sprite;
  Skin.sprite = name => name === 'L2UI.RecipeWnd.TreePlus' ? null : original(name);
  try {
    control(wnd, 'btnRecipeTree').dispatch('click');
    assert.equal(wnd.lastError, null);
    const plus = descendants(control(wnd, 'MainTree', 'RecipeTreeWnd')).find(el => el.dataset.treeNode);
    assert.equal(plus.style.backgroundImage, 'url("/gamedata/icons/recipes/source-plus.png")');
    assert.equal(plus.style.backgroundSize, '16px 16px'); assert.equal(plus.style.width, '12px');
  } finally { Skin.sprite = original; }
});

test('warning 74 captures source ID and book token, rejects replacement/reset, and never removes rows locally', async () => {
  const { wnd, sent } = await fixture(); let pending, resolve;
  wnd.dialog = { reset() {}, request: request => { pending = request; return new Promise(done => { resolve = done; }); } };
  wnd.book(book); cell(wnd).dispatch('click'); const first = wnd.deleteSelected();
  assert.equal(pending.message, 'Delete Recipe source name?'); assert.equal(pending.type, 'warning');
  wnd.book(book); resolve({ accepted: true }); await first; assert.deepEqual(sent, []);
  cell(wnd).dispatch('click'); const second = wnd.deleteSelected(); resolve({ accepted: true }); await second;
  assert.deepEqual(sent, [{ op: 'recipeBookDestroy', recipeId: 701 }]); assert.ok(cell(wnd));
  const third = wnd.deleteSelected(701); wnd.reset(); resolve({ accepted: true }); await third;
  assert.equal(sent.length, 1);
});

test('metadata completed after reset uses current empty state and stale book cells cannot send requests', async () => {
  let resolve;
  const wnd = new RecipeWnd(new Element('body'), { loadMetadata: () => new Promise(done => { resolve = done; }) });
  await Promise.resolve(); wnd.book(book); wnd.reset(); resolve(metadata()); await wnd.ready;
  assert.ok(Object.values(wnd.windows).every(win => !win.visible));
  const { wnd: ready, sent } = await fixture(); ready.book(book); const old = cell(ready);
  ready.book({ ...book, recipes: [] }); old.dispatch('click'); old.dispatch('dblclick');
  assert.deepEqual(sent, []); assert.equal(cell(ready), undefined);
});

test('missing source items fail visibly without generic name substitution or local craft actions', async () => {
  const data = metadata(); delete data.items[900];
  const { wnd, sent } = await fixture({ loadMetadata: async () => data });
  const original = console.error; console.error = () => {};
  try { wnd.book(book); } finally { console.error = original; }
  assert.match(wnd.lastError.message, /Original recipe item 900 unavailable/);
  assert.equal(wnd.windows.RecipeBookWnd.visible, false); assert.deepEqual(sent, []);
});
