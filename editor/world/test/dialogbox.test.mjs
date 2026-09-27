import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location ??= { search: '' };
const { Skin } = await import('../js/ui/skin.js');
const { Font } = await import('../js/ui/font.js');
const { DialogBox, sharedDialogBox, groupDialogDigits, readDialogDigits, dialogDigitColor } = await import('../js/ui/dialogbox.js');

// Test the real state/DOM construction. Stub only bitmap painting and the DOM
// boundary; the original binary/record decoder has separate source tests.
class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.style = {}; this.dataset = {};
    this.attrs = {}; this.children = []; this.events = new Map(); this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(e) { this.children.push(e); e.parentNode = this; return e; }
  replaceChildren(...children) { this.children = []; children.forEach(c => this.appendChild(c)); }
  addEventListener(k, fn) { (this.events.get(k) ?? this.events.set(k, []).get(k)).push(fn); }
  fire(k, props = {}) {
    const event = { stopPropagation() {}, preventDefault() {}, ...props };
    for (const fn of this.events.get(k) || []) fn(event);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
}
function documentFixture() {
  const doc = { activeElement: null, createElement(tag) { return new Element(tag, this); } };
  doc.body = doc.createElement('body'); doc.activeElement = doc.body;
  globalThis.document = doc;
  return doc;
}
Skin.scale = 1;
Skin.sprite = ref => ref && ref !== 'missing' ? { w: 1, h: 1 } : null;
Skin.apply = (el, ref) => { el.painted = ref; };
Object.defineProperty(Font, 'ready', { get: () => true });
Font.lineHeight = () => 12;
Font.measure = text => text.length * 6;
Font.set = (el, text, options) => { el.bitmapText = text; el.bitmapOptions = options; };

function metadata() {
  const button = x => ({ x, y: 100, width: 76, height: 23, texture: 'button', labelId: 1337 });
  return {
    layout: { format: 'l2-dialogbox-v1', source: { native: { status: 'verified', buttonLabelColor: '#E6DCBE' } },
      body: { width: 306, height: 128, texture: 'background' },
      controls: { DialogText: { x: 41, y: 9, width: 258, height: 50, color: '#DCDCDC' },
        OKButton: button(75), CancelButton: { ...button(155), labelId: 1342 },
        CenterOKButton: button(115) } },
    strings: [{ id: 1337, string: 'Confirm' }, { id: 1342, string: 'Cancel' }],
  };
}
function numberMetadata() {
  const m = metadata();
  m.layout.controls.DialogBoxEdit = { x: 75, y: 73, width: 156, height: 17,
    color: '#E6DCBE', textInsetX: 2, textInsetY: 1, texture: 'synthetic-edit',
    numberColor: { minimumDigits: 5, indexSubtract: 2,
      colors: ['#112233', '#445566', '#778899', '#AABBCC'] } };
  m.layout.controls.DialogReadingText = { x: 0, y: 57, width: 306, height: 12, color: '#E4CA7F', align: 'center' };
  const names = [...Array.from({ length: 10 }, (_, i) => `num${i}`), 'numAll', 'numBS', 'numC'];
  m.layout.numberPad = { x: 306, y: 0, width: 128, height: 128, texture: 'synthetic-pad',
    dialogWidth: 434, dialogHeight: 128,
    buttons: Object.fromEntries(names.map((name, i) => [name,
      { x: i % 4 * 29, y: Math.floor(i / 4) * 29, width: 28, height: 28, texture: name }])),
    native: { reading: { status: 'verified-english', languageType: 1, groupSize: 3,
      maximumMagnitudeDigits: 12, labels: ['small', ' large', ' grand'] } } };
  return m;
}
function fixture(loadMetadata = async () => metadata()) {
  const doc = documentFixture();
  return { doc, dialog: new DialogBox({ loadMetadata }) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function find(element, control) {
  if (element?.dataset.control === control) return element;
  for (const child of element?.children || []) { const hit = find(child, control); if (hit) return hit; }
  return null;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

test('Warning uses source rectangles/labels and preserves the exact request context', async () => {
  const { dialog, doc } = fixture(), context = { questId: 1, session: {} };
  const pending = dialog.request({ message: 'Abort this quest?', context });
  await flush();
  assert.equal(dialog.open, true);
  const panel = dialog.root.children[0];
  assert.equal(panel.style.width, '306px');
  assert.equal(panel.style.height, '128px');
  assert.equal(panel.style.transform, 'translate(-50%, -50%)');
  assert.equal(panel.attrs.role, 'alertdialog');
  assert.equal(find(dialog.root, 'DialogText').style.left, '41px');
  const ok = find(dialog.root, 'OKButton'), cancel = find(dialog.root, 'CancelButton');
  assert.equal(ok.style.left, '75px');
  assert.equal(cancel.style.left, '155px');
  assert.equal(ok.style.top, '100px');
  assert.equal(ok.style.width, '76px');
  assert.equal(ok.style.height, '23px');
  assert.equal(ok.bitmapText, 'Confirm');
  assert.equal(cancel.bitmapText, 'Cancel');
  assert.equal(find(dialog.root, 'CenterOKButton'), null);
  assert.equal(doc.activeElement, panel);
  ok.fire('click');
  const result = await pending;
  assert.equal(result.accepted, true);
  assert.equal(result.context, context);
  assert.equal(dialog.open, false);
  assert.equal(doc.activeElement, doc.body);
});

test('Cancel declines and Notice exposes only its original centered Confirm', async () => {
  const { dialog } = fixture();
  const warning = dialog.request({ message: 'Warning' });
  await flush(); find(dialog.root, 'CancelButton').fire('click');
  assert.equal((await warning).accepted, false);
  const notice = dialog.request({ type: 'notice', message: 'Notice' });
  await flush();
  assert.equal(find(dialog.root, 'OKButton'), null);
  assert.equal(find(dialog.root, 'CancelButton'), null);
  const ok = find(dialog.root, 'CenterOKButton');
  assert.equal(ok.style.left, '115px');
  ok.fire('click');
  assert.equal((await notice).accepted, true);
});

test('a second request cannot replace the original selected-quest context', async () => {
  const { dialog } = fixture();
  const original = dialog.request({ message: 'first', context: 1 });
  assert.deepEqual(await dialog.request({ message: 'second', context: 2 }),
    { accepted: false, context: 2, reason: 'busy' });
  await flush(); find(dialog.root, 'OKButton').fire('click');
  assert.equal((await original).context, 1);
});

test('one dialog per UI root arbitrates owners without cross-window cancellation', async () => {
  const doc = documentFixture(), inventory = {}, quest = {};
  const dialog = sharedDialogBox(doc.body);
  dialog._loadMetadata = async () => metadata();
  assert.equal(sharedDialogBox(doc.body), dialog);
  assert.notEqual(sharedDialogBox(doc.createElement('div')), dialog);
  const first = dialog.request({ message: 'inventory', owner: inventory });
  assert.equal((await dialog.request({ message: 'quest', owner: quest })).reason, 'busy');
  dialog.reset(quest);
  await flush();
  assert.equal(dialog.open, true, 'another window may not retire the active owner');
  dialog.reset(inventory);
  assert.equal((await first).reason, 'reset');
  const second = dialog.request({ message: 'quest', owner: quest });
  await flush(); find(dialog.root, 'OKButton').fire('click');
  assert.equal((await second).accepted, true);
});

test('session reset during metadata loading cancels immediately and cannot resurrect the dialog', async () => {
  const loading = deferred();
  const { dialog, doc } = fixture(() => loading.promise);
  const first = dialog.request({ message: 'old session', context: 1 });
  dialog.reset();
  assert.deepEqual(await first, { accepted: false, context: 1, reason: 'reset' });
  loading.resolve(metadata()); await flush();
  assert.equal(dialog.open, false);
  assert.equal(doc.body.children.length, 0);
});

test('reset then new request during one load adopts only the new selection', async () => {
  const loading = deferred();
  const { dialog, doc } = fixture(() => loading.promise);
  const first = dialog.request({ message: 'old', context: 1 });
  dialog.reset();
  const second = dialog.request({ message: 'new', context: 2 });
  loading.resolve(metadata()); await flush();
  assert.equal(doc.body.children.length, 1);
  assert.equal(dialog.root.children[0].attrs['aria-label'], 'new');
  find(dialog.root, 'OKButton').fire('click');
  assert.equal((await first).accepted, false);
  assert.deepEqual(await second, { accepted: true, context: 2, reason: 'button' });
});

test('retired button callbacks cannot approve a replacement request', async () => {
  const { dialog } = fixture();
  const first = dialog.request({ message: 'old' }); await flush();
  const retired = find(dialog.root, 'OKButton');
  dialog.reset();
  const second = dialog.request({ message: 'new' }); await flush();
  retired.fire('click');
  assert.equal(dialog.open, true);
  find(dialog.root, 'CancelButton').fire('click');
  assert.equal((await first).accepted, false);
  assert.equal((await second).accepted, false);
});

test('the source default None action cancels and callbacks can open another dialog', async () => {
  const { dialog } = fixture();
  const first = dialog.request({ message: 'first' }); await flush();
  const next = first.then(result => {
    assert.equal(result.accepted, false);
    return dialog.request({ type: 'notice', message: 'next' });
  });
  dialog.defaultAction(); await flush();
  assert.equal(dialog.root.children[0].attrs['aria-label'], 'next');
  find(dialog.root, 'CenterOKButton').fire('click');
  assert.equal((await next).accepted, true);
});

test('source failures never accept and subsequent requests retry', async () => {
  let calls = 0;
  const { dialog } = fixture(async () => {
    calls++; if (calls === 1) throw new Error('missing original input'); return metadata();
  });
  assert.equal((await dialog.request({ message: 'first' })).reason, 'unavailable');
  assert.equal(dialog.open, false);
  const second = dialog.request({ message: 'second' }); await flush();
  assert.equal(calls, 2);
  find(dialog.root, 'CancelButton').fire('click'); await second;
});

test('unverified geometry and missing original labels/artwork fail closed', async () => {
  for (const alter of [
    m => { m.layout.source.native.status = 'unverified'; },
    m => { m.layout.controls.OKButton.x = null; },
    m => { m.strings = m.strings.filter(s => s.id !== 1337); },
    m => { m.layout.body.texture = 'missing'; },
  ]) {
    const m = metadata(); alter(m);
    const { dialog } = fixture(async () => m);
    const result = await dialog.request({ message: 'requires source' });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'unavailable');
    assert.equal(dialog.open, false);
  }
});

test('unsupported styles do not acquire the dialog and focus stays within source buttons', async () => {
  const { dialog, doc } = fixture();
  await assert.rejects(dialog.request({ type: 'progress', message: 'unsupported' }), /supported source/);
  assert.equal(dialog.inUse, false);
  const pending = dialog.request({ message: 'warning' }); await flush();
  const root = dialog.root, ok = find(root, 'OKButton'), cancel = find(root, 'CancelButton');
  root.fire('keydown', { key: 'Tab' }); assert.equal(doc.activeElement, ok);
  root.fire('keydown', { key: 'Tab' }); assert.equal(doc.activeElement, cancel);
  root.fire('keydown', { key: 'Tab' }); assert.equal(doc.activeElement, ok);
  root.fire('keydown', { key: 'Tab', shiftKey: true }); assert.equal(doc.activeElement, cancel);
  dialog.dispose(); assert.equal((await pending).accepted, false);
});

test('quantity reading retains source label whitespace, units space and the original long-input branch', () => {
  const labels = ['small', ' large', ' grand'];
  for (const [input, shown, reading] of [
    ['', '', ''], ['000', '000', ''], ['0001', '0,001', '1 '],
    ['1001', '1,001', '1 small,1 '], ['1000000', '1,000,000', '1  large'],
    ['1000000001', '1,000,000,001', '1  grand,1 '],
    ['0000000000001', '0,000,000,000,001', '0,000,000,000,001'],
  ]) {
    assert.equal(groupDialogDigits(input), shown); assert.equal(readDialogDigits(input, labels), reading);
  }
  assert.equal(groupDialogDigits('1x'), null);
  const edit = numberMetadata().layout.controls.DialogBoxEdit;
  assert.equal(dialogDigitColor('9999', edit), edit.color);
  for (const [length, index] of [[5, 3], [6, 0], [7, 1], [8, 2], [9, 3]]) {
    assert.equal(dialogDigitColor('1'.repeat(length), edit), edit.numberColor.colors[index]);
  }
});

test('NumberPad starts empty, uses original body/pad dimensions, and returns ungrouped digits', async () => {
  const { dialog, doc } = fixture(async () => numberMetadata());
  const request = dialog.request({ type: 'number', message: 'Synthetic quantity', parameter: 7 });
  await flush();
  assert.equal(dialog.root.children[0].style.width, '434px');
  assert.equal(find(dialog.root, 'NumberPad').style.left, '306px');
  const input = find(dialog.root, 'DialogBoxEdit');
  assert.equal(input.value, ''); assert.equal(doc.activeElement, input);
  assert.equal(input.maxLength, undefined, 'no invented numeric length cap');
  for (const n of [1, 2, 3, 4]) find(dialog.root, `num${n}`).fire('click');
  assert.equal(input.value, '1,234');
  assert.equal(find(dialog.root, 'DialogReadingText').bitmapText, '1 small,234 ');
  find(dialog.root, 'OKButton').fire('click');
  assert.equal((await request).value, '1234', 'parameter is All-button input, not a maximum');
});

test('NumberPad All, literal-zero Clear, insertion and Backspace share the current edit', async () => {
  const { dialog } = fixture(async () => numberMetadata());
  const request = dialog.request({ type: 'number', message: 'Synthetic', parameter: 1234 });
  await flush(); const input = find(dialog.root, 'DialogBoxEdit');
  find(dialog.root, 'numAll').fire('click'); assert.equal(input.value, '1,234');
  input.setSelectionRange(2, 4); find(dialog.root, 'num9').fire('click');
  assert.equal(input.value, '12,394', 'pad AddString preserves text selected behind the caret');
  find(dialog.root, 'numBS').fire('click'); assert.equal(input.value, '1,234');
  find(dialog.root, 'numC').fire('click'); assert.equal(input.value, '0');
  find(dialog.root, 'numBS').fire('click'); assert.equal(input.value, '');
  input.value = '1234567890123'; input.selectionStart = input.value.length; input.fire('input');
  assert.equal(input.value, '1,234,567,890,123');
  input.value = 'invalid'; input.fire('input'); assert.equal(input.value, '1,234,567,890,123');
  find(dialog.root, 'CancelButton').fire('click'); assert.equal((await request).accepted, false);
});

test('negative All parameter does nothing and reset retires a number dialog', async () => {
  const { dialog } = fixture(async () => numberMetadata());
  const request = dialog.request({ type: 'number', message: 'Synthetic', parameter: -1 });
  await flush(); const input = find(dialog.root, 'DialogBoxEdit');
  find(dialog.root, 'num2').fire('click'); find(dialog.root, 'numAll').fire('click');
  assert.equal(input.value, '2'); dialog.reset();
  assert.equal((await request).accepted, false);
});

test('number dialog rejects missing input geometry/artwork rather than replacing it with browser defaults', async () => {
  for (const alter of [m => { m.layout.controls.DialogBoxEdit.color = null; },
    m => { m.layout.numberPad.buttons.num1.texture = 'missing'; },
    m => { m.layout.numberPad.native.reading.status = 'unresolved'; }]) {
    const m = numberMetadata(); alter(m);
    const { dialog } = fixture(async () => m);
    assert.equal((await dialog.request({ type: 'number', message: 'Synthetic' })).reason, 'unavailable');
  }
});

test('the real metadata loader rejects HTTP failures and retries both source resources', async () => {
  const previousFetch = globalThis.fetch, requests = [];
  const doc = documentFixture(), source = metadata();
  let available = false;
  globalThis.fetch = async url => {
    requests.push(url);
    return { ok: available, json: async () => url.endsWith('/dialogbox.json')
      ? source.layout : source.strings };
  };
  try {
    const dialog = new DialogBox({ parent: doc.body });
    assert.equal((await dialog.request({ message: 'missing' })).reason, 'unavailable');
    available = true;
    const request = dialog.request({ message: 'restored' }); await flush();
    assert.deepEqual(requests, ['/gamedata/dialogbox.json', '/gamedata/sysstring.json',
      '/gamedata/dialogbox.json', '/gamedata/sysstring.json']);
    find(dialog.root, 'CancelButton').fire('click');
    assert.equal((await request).accepted, false);
  } finally { globalThis.fetch = previousFetch; }
});
