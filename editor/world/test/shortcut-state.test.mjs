// Elbera Tools: real shortcut state/mutation methods, with a controlled wire
// and inventory. No private game data, accounts, browser or localStorage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const source = read('../js/ui/shortcutwnd.js').replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const json = value => JSON.parse(JSON.stringify(value));
const row = (type = 'skill', id = 1001, page = 0, slot = 0, extra = {}) =>
  ({ type, id, page, slot, characterType: 1, ...extra });
function harness() {
  let now = 100, connected = true, renders = 0;
  const requests = [], uses = [], handlers = {}, items = new Map([[9001, { itemId: 57 }]]);
  const recipes = new Map(), learnedRecipes = new Set();
  class Element {
    constructor(tag) { this.tagName = tag; this.style = {}; this.dataset = {}; this.children = []; this.events = new Map(); }
    appendChild(el) { this.children.push(el); }
    addEventListener(name, fn) { this.events.set(name, fn); }
  }
  const context = vm.createContext({ performance: { now: () => now },
    document: { createElement: tag => new Element(tag) }, Skin: { px: n => n },
    Layout: { size: () => null, pos: () => null, find: () => null, tex: () => [] },
    activeInventory: () => ({ items }), skillType: (id, passive) => passive === true ? 'PASSIVE'
      : passive === false ? 'ACTIVE' : id === 1001 ? 'PASSIVE' : 'ACTIVE',
    // A browser-only binding must never be read or written, even if present.
    localStorage: { getItem() { throw Error('must not read local shortcuts'); },
      setItem() { throw Error('must not persist local shortcuts'); } },
    net: { on: (op, fn) => { handlers[op] = fn; } },
  });
  vm.runInContext(source + '\nglobalThis.ShortcutWnd = ShortcutWnd;', context);
  const bar = Object.assign(Object.create(context.ShortcutWnd.prototype), {
    data: {}, ready: false, _pendingSlots: new Map(), _skills: new Map(),
    _activeToggles: new Set(), _weaponGate: null, page: 0, page2: 1, page3: 2,
    fArts: [], artH: { iconInset: 2, iconCell: 32, slotShort: 5,
      slotOrigins: Array.from({ length: 12 }, (_, i) => i * 36) },
    render() { renders++; }, onNote() {},
    onRegister: value => { if (!connected) return false; requests.push({ op: 'register', ...json(value) }); return true; },
    onDelete: value => { if (!connected) return false; requests.push({ op: 'delete', ...json(value) }); return true; },
    onUseSkill: id => uses.push(['skill', id]), onUseItem: id => uses.push(['item', id]),
    onUseAction: id => uses.push(['action', id]),
    getRecipe: id => recipes.get(id), canAssignRecipe: id => learnedRecipes.has(id),
    onUseRecipe: id => uses.push(['recipe', id]),
  });
  context.shortcutWnd = bar;
  const main = read('../js/main.js');
  vm.runInContext(main.slice(main.indexOf("net.on('shortcutInit'"), main.indexOf("net.on('skillList'")), context);
  return { bar, handlers, requests, uses, items, recipes, learnedRecipes, renders: () => renders,
    element: () => new Element('div'), disconnect: () => { connected = false; }, advance: ms => { now += ms; } };
}

test('full server snapshot replaces bindings; register and delete mutate only their received position', () => {
  const h = harness();
  h.handlers.shortcutInit({ shortcuts: [row('action', 0), row('item', 9001, 9, 11, { sharedReuseGroup: -1 })] });
  assert.equal(h.bar.ready, true); h.bar.triggerF(0);
  assert.deepEqual(h.uses, [['action', 0]]);
  h.handlers.shortcutRegister({ shortcut: row('skill', 1001, 9, 11, { level: 3, skillFlag: 0 }) });
  assert.equal(h.bar.data[9][11].level, 3); assert.equal(h.bar.data[0][0].id, 0);
  h.handlers.shortcutDelete({ page: 9, slot: 11, unknown: 0 });
  assert.equal(h.bar.data[9][11], undefined);
  h.handlers.shortcutInit({ shortcuts: [] });
  assert.deepEqual(json(h.bar.data), {}); assert.equal(h.bar.ready, true);
  assert.deepEqual(h.requests, []);
});

test('server-active skills override conflicting static categories; requests commit only on server echo', () => {
  const h = harness(); h.bar.setSkills([{ id: 1001, level: 3, passive: false }]);
  assert.equal(h.bar.assignFirstFree({ type: 'skill', id: 1001 }), -1);
  h.handlers.shortcutInit({ shortcuts: [] });
  assert.equal(h.bar.assignFirstFree({ type: 'skill', id: 1001 }), 0);
  assert.equal(h.bar.assignFirstFree({ type: 'item', id: 9001 }), 1);
  assert.deepEqual(json(h.bar.data), {});
  assert.deepEqual(h.requests, [
    { op: 'register', page: 0, slot: 0, type: 'skill', id: 1001, characterType: 1 },
    { op: 'register', page: 0, slot: 1, type: 'item', id: 9001, characterType: 1 },
  ]);
  h.handlers.shortcutRegister({ shortcut: row('skill', 1001, 0, 0, { level: 3 }) });
  h.bar.triggerF(0); assert.deepEqual(h.uses, [['skill', 1001]]);
  assert.equal(h.bar.assign(0, 0, null), true); assert.equal(h.bar.data[0][0].id, 1001);
  h.handlers.shortcutDelete({ page: 0, slot: 0 }); assert.equal(h.bar.data[0][0], undefined);
  assert.equal(h.bar.assign(0, 0, null), false); // no server echo for empty delete
});

test('failed sends, expiry and session replacement cannot create or carry bindings', () => {
  const h = harness(); h.bar.setShortcuts([]);
  assert.equal(h.bar.assign(0, 0, { type: 'action', id: 0 }), true);
  h.advance(10001); assert.equal(h.bar.assignFirstFree({ type: 'action', id: 2 }), 0);
  assert.deepEqual(json(h.bar.data), {});
  h.bar.reset(); assert.equal(h.bar.ready, false); assert.equal(h.bar._pendingSlots.size, 0);
  assert.equal(h.bar.assign(0, 0, { type: 'action', id: 0 }), false);
  h.bar.setShortcuts([row('action', 2, 1, 2)]); h.disconnect();
  assert.equal(h.bar.assign(0, 0, { type: 'action', id: 0 }), false);
  assert.equal(h.bar._pendingSlots.size, 0);
  assert.deepEqual(Object.keys(h.bar.data), ['1']);
});

test('malformed snapshots are atomic; all 120 native positions remain addressable', () => {
  const h = harness(); h.bar.setShortcuts([row('action', 0)]);
  for (const input of [null, [row(), row()], [row(), row('skill', 1001, 10)],
    [row('skill', 1001, 0, -1)], [row('unknown')], [row('item', 0)]]) {
    assert.equal(h.bar.setShortcuts(input), false);
    assert.equal(h.bar.data[0][0].type, 'action');
  }
  assert.equal(h.bar.setShortcuts(Array.from({ length: 120 }, (_, i) => row('action', 0, Math.floor(i / 12), i % 12))), true);
  assert.equal(h.bar.assignFirstFree({ type: 'action', id: 2 }), -1);
  assert.equal(h.bar.deleteShortcut(10, 0), false);
});

test('unavailable skills/items/recipes and preserved macro/pet records cannot dispatch as player actions', () => {
  const h = harness(); h.bar.setShortcuts([
    row('skill', 1001), row('item', 9001, 0, 1), row('macro', 1, 0, 2),
    row('recipe', 1, 0, 3), row('action', 0, 0, 4, { characterType: 2 }),
  ]);
  h.bar.setSkills([{ id: 1001, level: 3, disabled: true }]);
  h.items.clear();
  for (let i = 0; i < 5; i++) h.bar.triggerF(i);
  assert.deepEqual(h.uses, []);
  for (const slot of [{ type: 'skill', id: 1001 }, { type: 'skill', id: 2002 },
    { type: 'item', id: 9001 }, { type: 'macro', id: 1 }, { type: 'action', id: -1 }]) {
    assert.equal(h.bar.assign(2, 0, slot), false);
  }
  assert.deepEqual(h.requests, []); assert.equal(h.bar.data[0][2].type, 'macro');
});

test('recipe assignments need received book eligibility; restored server bindings can request details before opening books', async () => {
  const h = harness(); h.recipes.set(701, { name: 'Source recipe', icon: '/product.png' });
  h.bar.setShortcuts([row('recipe', 701, 0, 0), row('recipe', 701, 0, 1, { characterType: 2 })]);
  h.bar.triggerF(0); h.bar.triggerF(1); assert.deepEqual(h.uses, [['recipe', 701]]);
  assert.equal(h.bar.assign(0, 2, { type: 'recipe', id: 701 }), false);
  h.learnedRecipes.add(701);
  assert.equal(h.bar.assign(0, 2, { type: 'recipe', id: 701 }), true);
  assert.equal(h.bar.data[0][2], undefined, 'assignment waits for server echo');
  assert.deepEqual(h.requests, [{ op: 'register', page: 0, slot: 2, type: 'recipe', id: 701, characterType: 1 }]);
  h.handlers.shortcutRegister({ shortcut: row('recipe', 701, 0, 2) });
  h.learnedRecipes.clear(); h.bar.triggerF(2); assert.deepEqual(h.uses.at(-1), ['recipe', 701]);
  const el = { children: [], appendChild(child) { this.children.push(child); } };
  await h.bar._slotContent(el, h.bar.data[0][2]);
  assert.equal(el.title, 'Source recipe'); assert.equal(el.children[0].src, '/product.png');
  h.recipes.clear(); h.bar.triggerF(0); assert.equal(h.uses.length, 2);
  h.bar.reset(); h.bar.triggerF(0); assert.equal(h.uses.length, 2);
});
test('a fast recipe drag accepts copy on entry, without depending on another dragover before drop', () => {
  const h = harness(), host = h.element();
  h.bar.setShortcuts([]); h.recipes.set(701, { name: 'Source recipe', icon: '/product.png' });
  h.learnedRecipes.add(701); h.bar._renderRow(host, 0, false, 'ShortcutWndHorizontal');
  const slot = host.children[0]; let cancelled = 0;
  const event = { preventDefault() { cancelled++; }, dataTransfer: {
    dropEffect: 'none', getData: type => type === 'application/x-l2vzla' ? '{"type":"recipe","id":701}' : '',
  } };
  slot.events.get('dragenter')(event);
  assert.equal(cancelled, 1); assert.equal(event.dataTransfer.dropEffect, 'copy');
  slot.events.get('drop')(event);
  assert.deepEqual(h.requests, [{ op: 'register', page: 0, slot: 0, type: 'recipe', id: 701, characterType: 1 }]);
  assert.equal(h.bar.data[0], undefined, 'drop still waits for the server');
});
test('page buttons wrap at both ends and F-keys use the resulting received page', () => {
  const h = harness(); h.bar.setShortcuts([row('action', 0), row('action', 5, 9, 0)]);
  h.bar.flipPage(-1); assert.equal(h.bar.page, 9); h.bar.triggerF(0);
  h.bar.flipPage(1); assert.equal(h.bar.page, 0); h.bar.triggerF(0);
  assert.deepEqual(h.uses, [['action', 5], ['action', 0]]);
  assert.deepEqual(h.requests, []);
});
