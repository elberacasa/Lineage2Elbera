// Actual Layout lookup code with synthetic source trees; no original data or
// browser. Nested declared Window parents must not make their children vanish.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/ui/layout.js', import.meta.url), 'utf8')
  .replace('export function sourceControls', 'function sourceControls')
  .replace('export const Layout =', 'const Layout =');
async function load(windows) {
  const context = { console, fetch: async url => ({
    ok: url === '/gamedata/interface.json', json: async () => ({ windows }),
  }) };
  vm.runInNewContext(`${source}\nglobalThis.layout = Layout;`, context);
  await context.layout.load();
  return context.layout;
}
const node = (name, type = 'Window', children = [], fields = {}) => ({ name, type, children, ...fields });

test('overlapping loads adopt one parsed tree instead of marking equivalent roots ambiguous', async () => {
  const document = { windows: [node('Root', 'Window', [node('Nested', 'Window', [node('OK', 'Button')])])] };
  let documentReads = 0;
  const context = { console, fetch: async url => ({
    ok: url === '/gamedata/interface.json',
    json: async () => {
      documentReads++;
      // Real Response.json() produces a distinct tree for each response.
      return JSON.parse(JSON.stringify(document));
    },
  }) };
  vm.runInNewContext(`${source}\nglobalThis.layout = Layout;`, context);
  const [first, second] = await Promise.all([context.layout.load(), context.layout.load()]);
  assert.equal(first, second);
  assert.equal(documentReads, 1, 'concurrent callers share one load');
  assert.equal(first.window('Root')?.name, 'Root');
  assert.equal(first.window('Nested')?.name, 'Nested');
  assert.equal(first.find('Root', 'Nested/OK')?.name, 'OK');
  await first.load();
  assert.equal(documentReads, 1, 'completed metadata remains cached');
});

test('unique nested Window resolves its own bounds and controls, including full root paths', async () => {
  const button = node('btnClose', 'Button', [], { x: 7, y: 8, width: 9, height: 10, textures: ['original.ref'] });
  const quest = node('QuestTreeWnd', 'Window', [button], { x: 1, y: 2, width: 30, height: 40 });
  const layout = await load([node('MainWnd', 'Window', [quest])]);
  assert.equal(layout.window('QuestTreeWnd'), quest);
  assert.equal(layout.window('MainWnd/QuestTreeWnd'), quest);
  assert.deepEqual({ ...layout.pos('QuestTreeWnd') }, { x: 1, y: 2 });
  assert.deepEqual({ ...layout.windowSize('QuestTreeWnd') }, { w: 30, h: 40 });
  assert.equal(layout.find('QuestTreeWnd', 'btnClose'), button);
  assert.equal(layout.find('MainWnd/QuestTreeWnd', 'btnClose'), button);
  assert.equal(layout.find('MainWnd', 'QuestTreeWnd/btnClose'), button);
  assert.equal(layout.tex0('QuestTreeWnd', 'btnClose'), 'original.ref');
});

test('ambiguous nested window names stay unresolved while explicit paths stay separate', async () => {
  const leftButton = node('OK', 'Button'), rightButton = node('OK', 'Button');
  const left = node('Dialog', 'Window', [leftButton]);
  const right = node('Dialog', 'Window', [rightButton]);
  const layout = await load([node('Left', 'Window', [left]), node('Right', 'Window', [right])]);
  assert.equal(layout.window('Dialog'), null);
  assert.equal(layout.find('Dialog', 'OK'), null);
  assert.equal(layout.window('Left/Dialog'), left);
  assert.equal(layout.window('Right/Dialog'), right);
  assert.equal(layout.find('Left/Dialog', 'OK'), leftButton);
  assert.equal(layout.find('Right', 'Dialog/OK'), rightButton);
});

test('a nested alias cannot replace an existing top-level full root path', async () => {
  const top = node('Dialog'), nested = node('Dialog');
  const layout = await load([top, node('Other', 'Window', [nested])]);
  assert.equal(layout.window('Dialog'), top);
  assert.equal(layout.window('Other/Dialog'), nested);
});

test('controls are not promoted to windows, and nested roots work beneath non-window containers', async () => {
  const button = node('Button', 'Button');
  const child = node('Nested', 'Window', [button]);
  const layout = await load([node('Root', 'Window', [node('Pane', 'Container', [child])])]);
  assert.equal(layout.window('Pane'), null);
  assert.equal(layout.window('Button'), null);
  assert.equal(layout.window('Nested'), child);
  assert.equal(layout.window('Root/Pane/Nested'), child);
  assert.equal(layout.find('Nested', 'Button'), button);
});

test('duplicate exact Window and control paths cannot silently choose a record', async () => {
  const a = node('Same', 'Window'), b = node('Same', 'Window');
  const duplicateButtons = node('Panel', 'Window', [node('OK', 'Button'), node('OK', 'Button')]);
  const layout = await load([node('Root', 'Window', [a, b, duplicateButtons])]);
  assert.equal(layout.window('Same'), null);
  assert.equal(layout.window('Root/Same'), null);
  assert.equal(layout.find('Root', 'Panel/OK'), null);
});

test('existing bare-control last-wins behavior is scoped to the selected root', async () => {
  const a = node('OK', 'Button'), b = node('OK', 'Button');
  const first = node('First', 'Window', [a]), second = node('Second', 'Window', [b]);
  const layout = await load([node('Root', 'Window', [first, second])]);
  assert.equal(layout.find('Root', 'OK'), b);
  assert.equal(layout.find('First', 'OK'), a);
  assert.equal(layout.find('Second', 'OK'), b);
  assert.equal(layout.find('Root', 'First/OK'), a);
  assert.equal(layout.window('Missing'), null);
  assert.equal(layout.find('Missing', 'OK'), null);
});
