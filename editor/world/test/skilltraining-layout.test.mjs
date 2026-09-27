import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { search: '' };
globalThis.fetch = async () => ({ ok: false });
const { trainingRects, trainingRow } = await import('../js/ui/skilltrainwnd.js');

const pos = (target = '', selfAnchor = 1, targetAnchor = 1, offsetX = 0, offsetY = 0) =>
  ({ target, selfAnchor, targetAnchor, offsetX, offsetY });
const node = (name, width, height, position, extra = {}) =>
  ({ name, width, height, position, sizeMode: 'absolute', children: [], ...extra });

test('autosized label resizes its actual anchor extent, including the native extra pixel', () => {
  const root = node('Panel', 200, 100, pos(), { children: [
    node('Label', 190, 12, pos('', 1, 1, 10, 15), { type: 'TextBox', textLayout: { autoSize: 1 } }),
    node('Value', 20, 12, pos('Panel.Label', 1, 3, 3, 0)),
  ] });
  const rects = trainingRects(root, new Map([['Panel.Label', 'ABC']]), s => s.length * 7, 13);
  assert.deepEqual(rects.get('Panel.Label'), { x: 10, y: 15, width: 22, height: 13 });
  assert.deepEqual(rects.get('Panel.Value'), { x: 35, y: 15, width: 20, height: 12 });
});

test('named anchors, negative offsets and nested normal pane preserve source coordinates', () => {
  const root = node('Panel', 200, 100, pos(), { children: [
    node('Normal', 200, 100, pos(), { type: 'Window', children: [node('Label', 20, 12, pos('', 1, 1, 9, 7))] }),
    node('Value', 30, 12, pos('Panel.Label', 3, 1, -4, 0)),
  ] });
  const r = trainingRects(root, new Map(), () => 0, 12);
  assert.deepEqual(r.get('Panel.Value'), { x: -25, y: 7, width: 30, height: 12 });
});

test('native center points truncate independently; sentinel anchor is never top-left', () => {
  const root = node('Panel', 201, 101, pos(), { children: [node('Child', 100, 20, pos('', 5, 5, -2, 0))] });
  const r = trainingRects(root, new Map(), () => 0, 12);
  assert.deepEqual(r.get('Panel.Child'), { x: 48, y: 40, width: 100, height: 20 });
  root.children[0].position.selfAnchor = 0;
  assert.throws(() => trainingRects(root, new Map(), () => 0, 12), /unresolved native anchor/);
});

test('ambiguous aliases and cyclic dependencies fail visibly instead of attaching at random', () => {
  const root = node('Panel', 200, 100, pos(), { children: ['A', 'B'].map(name =>
    node(name, 100, 50, pos(), { children: [node('Label', 20, 12, pos())] })) });
  root.children.push(node('Value', 20, 12, pos('Panel.Label')));
  assert.throws(() => trainingRects(root, new Map(), () => 0, 12), /unresolved trainer anchor/);
  root.children = [node('A', 20, 12, pos('Panel.B')), node('B', 20, 12, pos('Panel.A'))];
  assert.throws(() => trainingRects(root, new Map(), () => 0, 12), /cyclic/);
});

test('native tree supports overlaid icons and negative-offset second line without fixed row height', () => {
  const items = [
    { x: 0, y: 4, width: 34, height: 34 },
    { x: -33, y: 4, width: 35, height: 35 },
    { x: -35, y: 5, width: 32, height: 32 },
    { x: 3, y: 10, width: 80, height: 12 },
    { x: 37, y: -14, break: true, width: 10, height: 12 },
    { x: 77, y: -14, break: true, width: 60, height: 12 },
  ];
  const measure = i => ({ width: i.width, height: i.height });
  const r = trainingRow(items, 7, measure);
  assert.deepEqual(r.placed.map(p => [p.x, p.y]), [[7, 4], [8, 4], [8, 5], [43, 10], [44, 25], [84, 25]]);
  assert.equal(r.height, 39);
  items.at(-1).height = 36;
  assert.equal(trainingRow(items, 7, measure).height, 61);
});
