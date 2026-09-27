// Elbera Tools: actual henna UI/controller with synthetic source metadata.
// These records exercise lifecycle/field wiring, not source or pixel parity.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { search: '' };
globalThis.window = { innerWidth: 1024, innerHeight: 768 };
globalThis.fetch = async () => ({ ok: false });
class Element {
  constructor(tag) {
    this.tagName = tag; this.style = {}; this.dataset = {}; this.children = [];
    this.attributes = {}; this.events = new Map();
  }
  appendChild(el) { this.children.push(el); return el; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, fn) { this.events.set(name, [...this.events.get(name) || [], fn]); }
  dispatch(name) { for (const fn of this.events.get(name) || []) fn({ stopPropagation() {} }); }
}
globalThis.document = { createElement: tag => new Element(tag), body: new Element('body') };
const { HennaWnd, hennaControls } = await import('../js/ui/hennawnd.js');
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
function metadata() {
  const strings = Object.fromEntries([140, 469, 543, 637, 638, 639, 651, 652, 659, 660].map(id => [id, `label${id}`]));
  const panel = suffix => node(suffix ? 'HennaInfoWndUnEquip' : 'HennaInfoWndEquip', 'Window', { children: [
    ...['txtDyeInfo', 'txtDyeName', 'txtTattooInfo', 'txtTattooName', 'txtTattooAddName',
      'txtFee', 'txtAdena', 'txtAdenaString'].map(name => node(name + suffix)),
    ...['textureDyeIconName', 'textureTattooIconName'].map(name => node(name + suffix, 'Texture')),
  ] });
  const makeRoot = (name, children) => node(name, 'Window', { width: 300, height: 420,
    textures: ['synthetic.background'], position: { ...position(), selfAnchor: 6, targetAnchor: 6 }, children });
  return {
    data: { format: 'l2-interlude-henna-v1', nativeLayoutProof: { status: 'verified' },
      native: { numericText: { status: 'verified-english-wrapper', suffixSysStringId: 469,
        suffixSeparator: ' ', maximumMagnitudeDigits: 12 } },
      nativeTreeFlow: { status: 'verified-static-original' }, strings,
      records: [{ symbolId: 101, name: 'Synthetic symbol', text1: 'inventory text', text2: 'add-name text', icon: 'symbol.icon' }],
      icons: { 'symbol.icon': { file: 'icons/synthetic-symbol.png' } },
      windows: {
        HennaListWnd: makeRoot('HennaListWnd', [node('txtList'), node('txtAdena'), node('HennaListTree', 'TreeCtrl')]),
        HennaInfoWnd: makeRoot('HennaInfoWnd', [panel(''), panel('UnEquip'),
          ...['INT', 'STR', 'CON', 'MEN', 'DEX', 'WIT'].flatMap((stat, index) => [
            node(`txt${stat}Before`), node('txtArrow', 'TextBox', { position: position(10, index * 17), textLayout: { defaultText: '>' } }),
            node(`txt${stat}After`),
          ]), node('txtHaveAdena'),
          node('btnPrev', 'Button', { textId: 543, textures: ['synthetic.button'] }),
          node('btnOK', 'Button', { textId: 140, textures: ['synthetic.button'] }),
        ]),
      },
    },
    items: { 202: { name: 'Synthetic dye', icon: 'icons/synthetic-dye.png' } },
    dialog: { numberPad: { native: { reading: { status: 'verified-english', labels: ['thousand', 'million', 'billion'] } } },
      controls: { DialogBoxEdit: { color: '#445566', numberColor: {
      minimumDigits: 5, indexSubtract: 2, colors: ['#111111', '#222222', '#333333', '#444444'],
    } } } },
  };
}
const row = { symbolId: 101, dyeId: 202, amount: 10, price: 12345, unknown: 7 };
const details = () => ({ ...row, adena: 98765, stats: Object.fromEntries(
  ['INT', 'STR', 'CON', 'MEN', 'DEX', 'WIT'].map((stat, i) => [stat, { current: i + 10, after: 255 - i }])) });
const descendants = element => [element, ...element.children.flatMap(descendants)];
const control = (wnd, name) => descendants(wnd.windows.HennaInfoWnd.body).find(el => el.dataset.control === name);
const rowButton = wnd => descendants(wnd.windows.HennaListWnd.body).find(el => el.dataset.symbolId === 101);
async function fixture(options = {}) {
  const sent = [], parent = new Element('body');
  const wnd = new HennaWnd(parent, { send: (op, data) => { sent.push({ op, ...data }); return true; },
    loadMetadata: async () => metadata(), ...options });
  await wnd.ready; assert.equal(wnd.lastError, null);
  return { wnd, sent, parent };
}

test('equip list selects dye identity, details use exact packet stats and confirmation waits for server state', async () => {
  const { wnd, sent } = await fixture();
  wnd.list('equip', { adena: 321, maxSlots: 3, items: [row] });
  const selected = rowButton(wnd);
  assert.equal(selected.attributes['aria-label'], 'Synthetic dye');
  assert.equal(wnd.windows.HennaListWnd.title, 'label651');
  selected.dispatch('click');
  assert.deepEqual(sent, [{ op: 'hennaItemInfo', symbolId: 101 }]);
  assert.equal(wnd.windows.HennaListWnd.visible, true, 'list remains until matching detail packet');
  assert.equal(wnd.details('equip', details()), true);
  assert.equal(wnd.windows.HennaListWnd.visible, false);
  assert.equal(control(wnd, 'txtDyeName').textContent, 'Synthetic dye');
  assert.equal(control(wnd, 'txtTattooAddName').textContent, 'add-name text');
  assert.equal(control(wnd, 'txtINTAfter').textContent, '255', 'detail byte is an unsigned total, not a signed delta');
  assert.equal(control(wnd, 'txtAdena').textContent, '12,345');
  assert.equal(control(wnd, 'txtAdena').fontOptions.color, '#444444');
  assert.equal(control(wnd, 'txtHaveAdena').fontOptions.color, '#AABBCC', 'source computes but never applies money color here');
  control(wnd, 'btnOK').dispatch('click');
  assert.deepEqual(sent.at(-1), { op: 'hennaEquip', symbolId: 101 });
  assert.equal(wnd.state.snapshot, null); assert.equal(wnd.windows.HennaInfoWnd.visible, false);
});

test('removal uses symbol identity/text2 and only the removal panel and request', async () => {
  const { wnd, sent } = await fixture();
  wnd.list('unequip', { adena: 321, emptySlots: 1, items: [row] });
  const selected = rowButton(wnd);
  assert.equal(selected.attributes['aria-label'], 'Synthetic symbol');
  assert.ok(descendants(selected).some(el => el.textContent === 'add-name text'));
  selected.dispatch('click'); wnd.details('unequip', details());
  assert.equal(control(wnd, 'txtDyeName'), undefined);
  assert.equal(control(wnd, 'txtTattooNameUnEquip').textContent, 'label652:Synthetic symbol');
  control(wnd, 'btnOK').dispatch('click');
  assert.deepEqual(sent, [{ op: 'hennaUnequipInfo', symbolId: 101 }, { op: 'hennaUnequip', symbolId: 101 }]);
});

test('all six duplicate source arrows remain at their own positions and native total bounds are retained', async () => {
  const { wnd } = await fixture();
  wnd.list('equip', { adena: 0, items: [row] }); rowButton(wnd).dispatch('click'); wnd.details('equip', details());
  const arrows = descendants(wnd.windows.HennaInfoWnd.body).filter(el => el.dataset.control === 'txtArrow');
  assert.equal(arrows.length, 6);
  assert.deepEqual(arrows.map(el => el.style.top), ['0px', '17px', '34px', '51px', '68px', '85px']);
  assert.equal(new Set(arrows.map(el => el.dataset.sourcePath)).size, 6);
  assert.equal(wnd.windows.HennaInfoWnd.root.style.height, '420px');
  assert.equal(wnd.windows.HennaInfoWnd.body.style.inset, '0');
  assert.equal(wnd.windows.HennaInfoWnd.root.style.left, '724px');
});

test('Back hides details but only sends a supplied list DWORD, and retired buttons cannot act on replacement data', async () => {
  for (const unknown of [null, 17]) {
    const { wnd, sent } = await fixture({ listArgument: () => unknown });
    wnd.list('equip', { adena: 0, items: [row] }); const oldRow = rowButton(wnd);
    oldRow.dispatch('click'); wnd.details('equip', details()); const oldOK = control(wnd, 'btnOK');
    control(wnd, 'btnPrev').dispatch('click');
    assert.equal(wnd.windows.HennaInfoWnd.visible, false);
    assert.equal(sent.length, unknown === null ? 1 : 2);
    if (unknown !== null) assert.deepEqual(sent.at(-1), { op: 'hennaEquipList', unknown });
    wnd.list('unequip', { adena: 0, items: [row] }); oldRow.dispatch('click'); oldOK.dispatch('click');
    assert.equal(sent.length, unknown === null ? 1 : 2);
  }
});

test('late metadata renders only current session/view and cannot revive a reset window', async () => {
  let resolve;
  const parent = new Element('body'), wnd = new HennaWnd(parent, {
    loadMetadata: () => new Promise(done => { resolve = done; }),
  });
  await Promise.resolve();
  wnd.list('equip', { adena: 0, items: [row] }); wnd.reset(); resolve(metadata()); await wnd.ready;
  assert.ok(Object.values(wnd.windows).every(win => !win.visible));
  assert.equal(wnd.state.items.length, 0);
  wnd.list('unequip', { adena: 999, items: [] });
  assert.equal(wnd.windows.HennaListWnd.title, 'label652');
  assert.equal(rowButton(wnd), undefined, 'empty authoritative lists do not reuse prior rows');
});

test('unknown source identity fails visibly instead of rendering a fabricated item label or accepting a row', async () => {
  const { wnd, sent } = await fixture();
  const original = console.error; console.error = () => {};
  try { wnd.list('equip', { adena: 0, items: [{ ...row, dyeId: 999 }] }); }
  finally { console.error = original; }
  assert.match(wnd.lastError.message, /Original dye metadata unavailable/);
  assert.equal(wnd.windows.HennaListWnd.visible, false); assert.deepEqual(sent, []);
  const copied = hennaControls(metadata().data.windows.HennaInfoWnd, 'unequip');
  assert.ok(copied.entries.every(e => !e.path.includes('.HennaInfoWndEquip.')));
});

test('only source money-tooltip controls receive exact magnitude text with preserved terminal spaces', async () => {
  const { wnd } = await fixture();
  wnd.list('equip', { adena: 321, items: [row] });
  const owned = descendants(wnd.windows.HennaListWnd.body).find(el => el.dataset.control === 'txtAdena');
  assert.equal(owned.title, '321  label469');
  rowButton(wnd).dispatch('click'); wnd.details('equip', details());
  assert.equal(control(wnd, 'txtHaveAdena').title, '98 thousand,765  label469');
  assert.equal(control(wnd, 'txtAdena').title, undefined, 'original fee control has no SetTooltipString');
  assert.equal(wnd.moneyTooltip(0), '');
  assert.equal(wnd.moneyTooltip(1000), '1 thousand label469');
  assert.equal(wnd.moneyTooltip(1000000000000), '1,000,000,000,000', 'early long-input return has no currency suffix');
  delete wnd.data.native.numericText;
  assert.equal(wnd.moneyTooltip(1000), null, 'missing native wrapper proof cannot invent tooltip text');
});
