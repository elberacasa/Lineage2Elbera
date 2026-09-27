// Elbera Tools: actual ShortcutWnd creation/placement and WndMgr lifecycle.
// Synthetic metadata only; this does not execute the original client.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultWindowPosition, windowCornerInside } from '../js/ui/windowposition.js';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const source = read('../js/ui/wndmgr.js') + '\n' + read('../js/ui/shortcutwnd.js');

function harness({ width = 1280, height = 720, scale = 1,
  dock = { x: 347, y: 722 }, saved = null, defaultRule = true, drawers = true, controls = false } = {}) {
  const stored = new Map(), events = new Map(), defaultQueries = [];
  if (saved) stored.set('l2vzla.wndpos', JSON.stringify({ ShortcutWnd: saved }));
  class Element {
    constructor() { this.style = {}; this.children = []; this.dataset = {}; this.events = new Map(); }
    set innerHTML(value) { if (value === '') this.children = []; }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, handler) { this.events.set(name, handler); }
    setAttribute(name, value) { this[name] = value; }
    getBoundingClientRect() {
      return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
        width: parseFloat(this.style.width) || 0, height: parseFloat(this.style.height) || 0 };
    }
  }
  const window = { innerWidth: width, innerHeight: height,
    addEventListener: (name, callback) => events.set(name, callback) };
  const context = vm.createContext({ window, document: { body: new Element(), createElement: () => new Element() },
    localStorage: { getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    MutationObserver: class { observe() {} }, defaultWindowPosition, windowCornerInside,
    Font: { set: (el, text) => { el.textContent = text; } },
    Skin: { scale, px: value => value * scale, sprite: () => ({}), apply() {}, content: () => null },
    Layout: {
      sizeOf: (root, name) => name === 'ShortcutWndVertical' ? { w: 46, h: 504 } : { w: 504, h: 46 },
      dock: () => dock, shortcutArt: () => controls ? { iconInset: 2, iconCell: 32,
        slotShort: 5, slotOrigins: Array.from({ length: 12 }, (_, i) => 32 + i * 37) } : null,
      tex: (root, path) => path.endsWith('F1Tex') ? [] : ['synthetic-art'],
      size: (root, path) => path.endsWith('PageNumTextBox') ? { w: 20, h: 10 } : { w: 14, h: 14 },
      color: () => '#DCDCDC',
      find: (root, name) => {
        if (controls) {
          const [sub, child] = name.split('/'), vertical = sub.includes('Vertical');
          if (child) return { width: child === 'PageNumTextBox' ? 20 : 14,
            align: 'center',
            height: child === 'PageNumTextBox' ? 10 : 14,
            position: { selfAnchor: child === 'PageNumTextBox' ? vertical ? 2 : 4 : 1,
              targetAnchor: child === 'PageNumTextBox' ? vertical ? 2 : 4 : 1, target: '',
              offsetX: child === 'PageNumTextBox' ? vertical ? 0 : 10 : 1,
              offsetY: child === 'PageNumTextBox' ? vertical ? 16 : 0 : 1 } };
          if (!sub.endsWith('_1') && !sub.endsWith('_2')) return {
            width: vertical ? 46 : 504, height: vertical ? 504 : 46 };
        }
        if (!drawers) return null;
        const match = /^(ShortcutWnd(Vertical|Horizontal))_([12])$/.exec(name);
        if (!match) return null;
        const vertical = match[2] === 'Vertical';
        return { width: vertical ? 46 : 504, height: vertical ? 504 : 46,
          drawer: { direction: vertical ? 1 : 3, offset: 0, fixed: 1,
            owner: match[3] === '1' ? match[1] : `${match[1]}_1` } };
      },
      windowDefault: name => { defaultQueries.push(name); return defaultRule
        ? { anchor: 6, anchored: false, w: null, h: null, offsetX: 0, offsetY: 0 } : null; },
    },
  });
  vm.runInContext(source + `
    // Control art has separate tests. Keep actual render/container geometry,
    // constructor, placement and WndMgr restore/reset/resize code here.
    ${controls ? '' : `ShortcutWnd.prototype._renderBar = function (options) {
      const element = document.createElement('div');
      element.options = options;
      element.style.top = Skin.px(options.y || 0) + 'px';
      element.style.left = Skin.px(options.x || 0) + 'px';
      return element;
    };`}
    ShortcutWnd.prototype._applyToggleMarks = function () {};
    globalThis.bar = new ShortcutWnd();
    globalThis.manager = WndMgr;
  `, context);
  return { bar: context.bar, manager: context.manager, window, defaultQueries,
    resize: (w, h) => { window.innerWidth = w; window.innerHeight = h; events.get('resize')(); } };
}
const position = bar => [parseFloat(bar.root.style.left), parseFloat(bar.root.style.top)];

test('offscreen INI coordinates use qualified source reset, not a fabricated screen margin', () => {
  const h = harness();
  assert.deepEqual(h.defaultQueries, ['ShortcutWnd.ShortcutWndVertical']);
  assert.equal(h.bar.vertical, true);
  assert.deepEqual(position(h.bar), [1234, 108]);
});

test('a valid player restore wins over the old INI without changing orientation', () => {
  const h = harness({ saved: { left: 40, top: 75 } });
  assert.equal(h.bar.vertical, false);
  assert.deepEqual(position(h.bar), [40, 75]);
});

test('an invalid player restore is repaired after source placement', () => {
  const h = harness({ dock: { x: 100, y: 200 }, saved: { left: 1800, top: 1500 } });
  assert.equal(h.bar.vertical, true);
  assert.deepEqual(position(h.bar), [1234, 108]);
});

test('without a saved dock creation uses horizontal BottomRight at the vertical source anchor', () => {
  const h = harness({ dock: null });
  assert.equal(h.bar.vertical, false);
  assert.deepEqual(position(h.bar), [776, 566]);
});

test('full reset collapses and resets pages while preserving received bindings and readiness', () => {
  const h = harness({ saved: { left: 40, top: 75 } }), bar = h.bar;
  bar.expanded = 2; bar.page = 7; bar.page2 = 9; bar.page3 = 0; bar.ready = true;
  const data = { 7: { 0: { type: 'recipe', id: 123, characterType: 1 } } };
  bar.data = data;
  h.manager.resetAll();
  assert.equal(bar.expanded, 0); assert.equal(bar.vertical, true); assert.equal(bar.page, 0);
  assert.deepEqual([bar.page2, bar.page3], [1, 2]);
  assert.equal(bar.ready, true); assert.equal(bar.data, data);
  assert.deepEqual(position(bar), [1234, 108]);
});

test('rotate preserves the current main-bar BottomRight instead of restoring INI coordinates', () => {
  const { bar } = harness({ saved: { left: 400, top: 500 } });
  bar.page = 4; bar.ready = true;
  const data = bar.data;
  bar.toggleRotate();
  assert.equal(bar.vertical, true); assert.deepEqual(position(bar), [858, 42]);
  assert.equal(bar.page, 4); assert.equal(bar.ready, true); assert.equal(bar.data, data);
  bar.toggleRotate();
  assert.equal(bar.vertical, false); assert.deepEqual(position(bar), [400, 500]);
});

test('expand does not shift the actual main bar or its rotation anchor', () => {
  const { bar } = harness({ saved: { left: 400, top: 500 } });
  bar.toggleExpand();
  assert.deepEqual(position(bar), [400, 500]);
  assert.equal(bar.root.style.marginTop, '0');
  assert.equal(bar.root.style.height, '46px');
  assert.equal(bar.root.children[0].style.top, '0px');
  assert.deepEqual(bar.root.children.slice(1).map(row => row.style.top), ['-46px']);
  bar.toggleRotate();
  assert.equal(bar.expanded, 1); assert.deepEqual(position(bar), [858, 42]);
  assert.equal(bar.root.children[1].style.left, '-46px');
  assert.equal(bar.root.children[1].style.top, '0px');
  bar.toggleRotate();
  assert.equal(bar.expanded, 1); assert.deepEqual(position(bar), [400, 500]);
  assert.equal(bar.root.style.marginTop, '0');
  bar.toggleExpand();
  assert.equal(bar.expanded, 2);
  assert.deepEqual(bar.root.children.slice(1).map(row => row.style.top), ['-46px', '-92px']);
  bar.toggleExpand();
  assert.equal(bar.expanded, 0); assert.equal(bar.root.children.length, 1);
  assert.deepEqual(position(bar), [400, 500]);
});

test('extra pages retain independent choices through collapse and rotation, with duplicate views allowed', () => {
  const { bar } = harness({ saved: { left: 400, top: 500 } });
  bar.expanded = 2; bar.page = 9; bar.page2 = 0; bar.page3 = 9; bar.render();
  assert.deepEqual(bar.root.children.map(row => row.options.page), [9, 0, 9]);
  bar.flipPage(-1, 1);
  assert.deepEqual(bar.root.children.map(row => row.options.page), [9, 9, 9]);
  bar.flipPage(1, 2);
  assert.deepEqual(bar.root.children.map(row => row.options.page), [9, 9, 0]);
  bar.toggleRotate();
  assert.deepEqual(bar.root.children.map(row => [row.style.left, row.style.top]),
    [['0px', '0px'], ['-46px', '0px'], ['-92px', '0px']]);
  bar.toggleExpand(); bar.toggleExpand(); bar.toggleExpand();
  assert.deepEqual(bar.root.children.map(row => row.options.page), [9, 9, 0]);
});

test('missing source drawer records cannot generate guessed extra-bar placements', () => {
  const { bar } = harness({ saved: { left: 400, top: 500 }, drawers: false });
  bar.expanded = 2; bar.render();
  assert.equal(bar.root.children.length, 1);
});

test('real drawer controls select their own page; duplicate snapshots repaint all matching slots', () => {
  const { bar } = harness({ saved: { left: 400, top: 500 }, controls: true });
  const click = (row, name) => bar.root.children[row].children
    .find(el => el.dataset.control === name).events.get('click')({ stopPropagation() {} });
  const labels = () => bar.root.children.map(row => row.children.find(el => el.textContent));
  click(0, 'ExpandButton'); click(0, 'ExpandButton');
  assert.deepEqual(labels().map(el => el.textContent), ['1', '2', '3']);
  assert.ok(labels().every(el => el.style.cssText.includes('left:10px;top:18px;')));
  assert.ok(labels().every(el => el.style.textAlign === 'center'));
  click(1, 'PrevBtn2'); click(2, 'NextBtn3');
  assert.deepEqual(labels().map(el => el.textContent), ['1', '1', '4']);
  bar.setShortcuts([{ type: 'macro', id: 10, page: 0, slot: 0, characterType: 1 }]);
  const slots = row => bar.root.children[row].children.filter(el => el.className?.startsWith('shortcut-slot'));
  assert.equal(slots(0)[0].dataset.sid, 10); assert.equal(slots(1)[0].dataset.sid, 10);
  bar.registerShortcut({ type: 'macro', id: 11, page: 0, slot: 0, characterType: 1 });
  assert.equal(slots(0)[0].dataset.sid, 11); assert.equal(slots(1)[0].dataset.sid, 11);
  assert.equal(slots(2)[0].dataset.sid, undefined);
  const uses = [], drops = [];
  bar.trigger = (...args) => uses.push(args); bar.assign = (...args) => drops.push(args);
  slots(2)[5].events.get('click')();
  slots(1)[4].events.get('drop')({ preventDefault() {}, dataTransfer: {
    getData: () => '{"type":"action","id":0}' } });
  assert.deepEqual(uses, [[3, 5]]); assert.deepEqual(drops.map(a => a.slice(0, 2)), [[0, 4]]);
  click(0, 'RotateBtn');
  assert.deepEqual(labels().map(el => el.textContent), ['1', '1', '4']);
  assert.ok(labels().every(el => el.style.cssText.includes('left:13px;top:16px;')));
  click(1, 'PrevBtn2'); assert.equal(bar.page2, 9); assert.equal(bar.page, 0);
  click(0, 'UnlockBtn'); assert.equal(bar.locked, true);
  click(0, 'LockBtn'); assert.equal(bar.locked, false);
});

test('resize keeps the inclusive source corner rule, then invokes reset if all corners leave', () => {
  const h = harness({ height: 768 });
  assert.equal(h.bar.vertical, false); assert.deepEqual(position(h.bar), [347, 722]);
  h.resize(1280, 722); // Top corners on the boundary remain admitted.
  assert.equal(h.bar.vertical, false); assert.deepEqual(position(h.bar), [347, 722]);
  h.resize(1280, 720);
  assert.equal(h.bar.vertical, true); assert.deepEqual(position(h.bar), [1234, 108]);
});

test('partial offscreen overlap with an inside corner is preserved without full-window clamping', () => {
  const { bar } = harness({ saved: { left: 1200, top: 10 } });
  assert.equal(bar.vertical, false); assert.deepEqual(position(bar), [1200, 10]);
});

test('ordinary ArrangeWnd applies only its source negative-axis correction', () => {
  const horizontal = harness({ saved: { left: -400, top: -10 } }).bar;
  assert.equal(horizontal.vertical, false); assert.deepEqual(position(horizontal), [0, -10]);
  const vertical = harness({ height: 400 }).bar;
  assert.equal(vertical.vertical, true); assert.deepEqual(position(vertical), [1234, 0]);
});

test('optional browser magnification converts the viewport and final position consistently', () => {
  const { bar } = harness({ width: 1920, height: 1080, scale: 1.5 });
  assert.equal(bar.vertical, true); assert.deepEqual(position(bar), [1851, 162]);
});

test('missing source reset metadata never substitutes a numeric position', () => {
  const { bar } = harness({ defaultRule: false });
  assert.equal(bar.vertical, false); assert.deepEqual(position(bar), [347, 722]);
});
