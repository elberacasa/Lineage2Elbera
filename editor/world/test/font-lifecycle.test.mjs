// Elbera Tools: browser bitmap-label ownership, with no private glyph assets.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
const { Font } = await import('../js/ui/font.js');
const { StatusWnd } = await import('../js/ui/statuswnd.js');

class Element {
  style = {};
  childNodes = [];
  get firstChild() { return this.childNodes[0] ?? null; }
  replaceChildren(...children) { this.childNodes = children; }
}

function renderer(t) {
  const calls = [];
  t.mock.method(Font, 'canvas', (text, options) => {
    const canvas = { text: String(text), options };
    calls.push(canvas);
    return canvas;
  });
  return calls;
}

test('unchanged labels reuse their canvas only while it still owns the contents', t => {
  const calls = renderer(t), el = new Element();
  Font.set(el, '120/120');
  const original = el.firstChild;
  Font.set(el, '120/120');
  assert.equal(el.firstChild, original);
  assert.equal(calls.length, 1);

  el.replaceChildren();
  Font.set(el, '120/120');
  assert.equal(el.firstChild.text, '120/120');
  assert.notEqual(el.firstChild, original);

  el.replaceChildren({ text: 'unrelated contents' });
  Font.set(el, '120/120');
  assert.equal(el.firstChild, calls.at(-1));
  assert.equal(el.firstChild.text, '120/120');
});

test('a changed value or appearance repaints without borrowing another label canvas', t => {
  const calls = renderer(t), a = new Element(), b = new Element();
  Font.set(a, '10');
  Font.set(b, '10');
  assert.notEqual(a.firstChild, b.firstChild);
  Font.set(a, '11');
  Font.set(a, '11', { color: '#123456' });
  assert.equal(calls.length, 4);
  assert.equal(a.firstChild.text, '11');
  assert.equal(a.firstChild.options.color, '#123456');
  assert.equal(b.firstChild.text, '10');
});

test('real status clear and same-value reconnect restore every gauge label', t => {
  renderer(t);
  // Supply only the DOM/gauge boundaries. Use real clear/update/label methods.
  const wnd = Object.create(StatusWnd.prototype);
  wnd.root = new Element();
  wnd.levelEl = new Element();
  wnd.nameEl = new Element();
  wnd.rows = {};
  wnd.set = {};
  wnd.labels = {};
  for (const key of ['cp', 'hp', 'mp', 'exp']) {
    wnd.rows[key] = { frac: 0 };
    wnd.set[key] = () => {};
    wnd.labels[key] = new Element();
  }
  const status = { name: 'Synthetic player', level: 2, cp: 50, maxCp: 50,
    hp: 120, maxHp: 120, mp: 40, maxMp: 40, exp: 0 };
  wnd.update(status);
  const labels = () => Object.values(wnd.labels).map(el => el.firstChild?.text);
  assert.deepEqual(labels(), ['50/50', '120/120', '40/40', '0.00%']);
  wnd.clear();
  assert.equal(wnd.root.style.display, 'none');
  assert.ok(Object.values(wnd.labels).every(el => el.childNodes.length === 0));
  wnd.update({ ...status });
  assert.equal(wnd.root.style.display, 'block');
  assert.deepEqual(labels(), ['50/50', '120/120', '40/40', '0.00%']);
});
