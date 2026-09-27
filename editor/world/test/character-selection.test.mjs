// Exercise the actual main.js character-selection/creation bridge. Synthetic
// DOM and transport only: no account, browser, gateway or original assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const begin = main.indexOf('let ccOverlay = null;');
const end = main.indexOf("\nnet.on('enterWorld'", begin);
assert.ok(begin >= 0 && end > begin);
const source = main.slice(begin, end);
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ legacy = false, delayedNames = false } = {}) {
  const handlers = {}, messages = {}, sends = [], notices = [], roots = [];
  let resolveNames;
  const names = delayedNames ? new Promise(resolve => { resolveNames = resolve; })
    : Promise.resolve({ races: [{ classes: [{ classId: 53, name: 'Dwarven Fighter' }] }] });
  class Element {
    constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.events = {}; }
    set innerHTML(value) { this.html = value; this.children = [new Element('span'), new Element('span')]; }
    appendChild(child) { child.parent = this; this.children.push(child); }
    addEventListener(name, fn) { this.events[name] = fn; }
    click() { this.events.click?.(); }
    remove() { const index = roots.indexOf(this); if (index >= 0) roots.splice(index, 1); }
    querySelector(selector) { return this.children.find(child => child.tag === selector); }
  }
  const context = {
    online: true, onlineGeneration: 1, CC_ENABLED: !legacy,
    location: { origin: 'http://test.invalid' },
    document: { createElement: tag => new Element(tag), body: { appendChild: el => roots.push(el) } },
    window: { addEventListener: (name, fn) => { messages[name] = fn; } },
    fetch: async () => ({ ok: true, json: () => names }),
    net: { on: (op, fn) => { handlers[op] = fn; }, send: (op, fields) => sends.push({ op, ...fields }) },
    setStatus: text => notices.push(text), chat: { addSystem: text => notices.push(text) },
    onlineToggle: { checked: true },
  };
  vm.runInNewContext(source, context);
  context.setOnline = on => {
    context.online = on; context.onlineGeneration++;
    context.closeCharCreate(); context.closeCharSelect();
  };
  const find = id => {
    const visit = el => el.id === id ? el : el.children.map(visit).find(Boolean);
    return roots.map(visit).find(Boolean);
  };
  const rows = () => find('charsel-overlay')?.children[0].children.filter(el => el.className === 'charsel-row') || [];
  return { context, handlers, messages, sends, notices, roots, find, rows, resolveNames };
}
const human = { slot: 0, name: 'Existing', race: 'Human', classId: 0, level: 6 };
const dwarf = { slot: 1, name: 'NewDwarf', race: 'Dwarf', classId: 53, level: 1 };

test('one-character account can select its existing slot or open creation without auto-entry', async () => {
  const h = harness(); h.handlers.auth_ok({ chars: [human] }); await tick();
  assert.equal(h.rows().length, 1); assert.deepEqual(h.sends, []);
  h.rows()[0].click();
  assert.deepEqual(h.sends, [{ op: 'enterChar', slot: 0 }]);
  assert.equal(h.find('charsel-overlay'), undefined);

  h.handlers.auth_ok({ chars: [human] }); await tick();
  h.find('charsel-create').click();
  assert.equal(h.find('charsel-overlay'), undefined);
  assert.equal(h.find('charcreate-overlay').children[0].src, '/create/?embed=1');
  assert.equal(h.sends.length, 1, 'opening creator does not create or select a character');
});

test('embedded Dwarf creation preserves protocol fields and refreshed list requires selection', async () => {
  const h = harness(); h.handlers.auth_ok({ chars: [human] }); await tick();
  h.find('charsel-create').click();
  const data = { type: 'cc:create', name: 'NewDwarf', race: 4, sex: 1, classId: 53,
    hairStyle: 0, hairColor: 0, face: 0 };
  h.messages.message({ origin: 'http://test.invalid', data });
  assert.deepEqual(h.sends, [{ op: 'createChar', name: 'NewDwarf', race: 4, sex: 1,
    classId: 53, hairStyle: 0, hairColor: 0, face: 0 }]);
  h.handlers.charCreateOk();
  assert.equal(h.find('charcreate-overlay'), undefined);
  h.handlers.auth_ok({ chars: [human, dwarf] }); await tick();
  assert.equal(h.rows().length, 2);
  assert.equal(h.sends.length, 1, 'creation acknowledgement does not auto-enter a slot');
  h.rows()[1].click();
  assert.deepEqual(h.sends[1], { op: 'enterChar', slot: 1 });
});

test('empty account opens creation; explicit legacy mode retains first-slot auto-entry', async () => {
  const fresh = harness(); fresh.handlers.auth_ok({ chars: [] });
  assert.ok(fresh.find('charcreate-overlay')); assert.deepEqual(fresh.sends, []);
  const old = harness({ legacy: true }); old.handlers.auth_ok({ chars: [human, dwarf] });
  assert.deepEqual(old.sends, [{ op: 'enterChar', slot: 0 }]);
  assert.equal(old.find('charsel-overlay'), undefined);
});

test('latest character list wins while class-name metadata is pending', async () => {
  const h = harness({ delayedNames: true });
  h.handlers.auth_ok({ chars: [human] });
  h.handlers.auth_ok({ chars: [human, dwarf] });
  h.resolveNames({ races: [] }); await tick();
  assert.deepEqual(h.rows().map(row => row.children[0].textContent), ['Existing', 'NewDwarf']);
});

test('retired selection work cannot reopen during a replacement session', async () => {
  const h = harness({ delayedNames: true });
  h.handlers.auth_ok({ chars: [human] });
  h.context.closeCharSelect(); h.context.onlineGeneration++;
  h.resolveNames({ races: [] }); await tick();
  assert.equal(h.roots.length, 0); assert.deepEqual(h.sends, []);
  h.context.online = false; h.handlers.auth_ok({ chars: [] });
  assert.equal(h.roots.length, 0, 'offline authentication cannot open creation');
});

test('Back retires selector and both selection overlays are retired by actual session reset', async () => {
  const h = harness(); h.handlers.auth_ok({ chars: [human] }); await tick();
  h.find('charsel-dismiss').click();
  assert.equal(h.context.online, false); assert.equal(h.roots.length, 0);
  // Execute the overlay-retirement prefix of the actual shared reset, which
  // is also covered in full by online-session.test.mjs.
  const a = main.indexOf('function resetOnlineSession() {');
  const b = main.indexOf('  selfServerPosition = null;', a);
  assert.ok(a >= 0 && b > a);
  h.context.online = true; h.handlers.auth_ok({ chars: [] });
  h.context.cancelFineNavigation = () => {};
  vm.runInNewContext(`${main.slice(a, b)}\n}\nresetOnlineSession();`, h.context);
  assert.equal(h.roots.length, 0);
});
