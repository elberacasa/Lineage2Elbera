// Elbera Tools: real marker controller, source-free metadata and DOM boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { search: '' };
globalThis.window ??= { addEventListener() {} };
const { Skin } = await import('../js/ui/skin.js');
const { QuestMark, QuestMarkEffect } = await import('../js/ui/questmark.js');
Skin.scale = 1;
Skin.sprite = ref => ref.startsWith('synthetic-') ? {} : null;
Skin.apply = (el, ref) => { el.painted = ref; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function metadata() {
  return { layout: { format: 'l2-questmark-v1', source: { status: 'verified' },
    button: { width: 32, height: 32, effectType: 1, texture: 'synthetic-original-art',
      sourceTextures: ['synthetic-original-art', 'synthetic-down', 'synthetic-hover', 'synthetic-glow1', 'synthetic-glow2'],
      position: { selfAnchor: 7, targetAnchor: 1, target: 'ChatWnd', offsetX: 42, offsetY: -5 } },
    behavior: { labelId: 118, effectClock: 'nwindow-effectbutton-v1' } }, strings: [{ id: 118, string: 'Synthetic quest label' }] };
}
function fixture(loader = async () => metadata()) {
  const observers = [], opened = [], listeners = new Map(), frames = new Map(); let frameId = 0;
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.events = new Map(); this.attrs = {}; }
    appendChild(el) { (this.children ??= []).push(el); }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.events.set(k, fn); }
    fire(k, props = {}) { this.events.get(k)?.({ stopPropagation() {}, ...props }); }
    remove() { this.removed = true; }
  }
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(value) { this.observed = value; }
    disconnect() { this.observed = null; }
  }
  globalThis.document = { createElement: () => new Element() };
  globalThis.window = { addEventListener: (k, fn) => listeners.set(k, fn),
    removeEventListener: (k, fn) => { if (listeners.get(k) === fn) listeners.delete(k); } };
  globalThis.MutationObserver = Observer; globalThis.ResizeObserver = Observer;
  const parent = { appendChild() {} }, rect = { left: 100, top: 500 };
  let anchor = { getBoundingClientRect: () => rect };
  const marker = new QuestMark(parent, { loadMetadata: loader, getAnchor: () => anchor,
    onOpen: id => opened.push(id), now: () => 0,
    requestFrame: cb => { frames.set(++frameId, cb); return frameId; },
    cancelFrame: id => frames.delete(id) });
  return { marker, opened, rect, observers, listeners, frames, setAnchor: value => { anchor = value; } };
}
test('original bottom-left anchor uses source dimensions and follows moved chat', async () => {
  const f = fixture(); await f.marker.show(77);
  assert.equal(f.marker.root.style.left, '142px');
  assert.equal(f.marker.root.style.top, '463px');
  assert.equal(f.marker.root.style.width, '32px');
  assert.equal(f.marker.root.painted, 'synthetic-original-art');
  assert.equal(f.marker.root.attrs['aria-label'], 'Synthetic quest label');
  f.rect.left = 300; f.rect.top = 400; f.observers[0].callback();
  assert.equal(f.marker.root.style.left, '342px'); assert.equal(f.marker.root.style.top, '363px');
  f.setAnchor(null); f.marker.position(); assert.equal(f.marker.root.style.display, 'none');
  f.marker.dispose();
});
test('successive packets replace the stored ID, and one click hides before journal focus', async () => {
  const f = fixture(); await f.marker.show(77); await f.marker.show(88);
  f.marker.root.fire('click'); f.marker.root.fire('click');
  assert.deepEqual(f.opened, [88]); assert.equal(f.marker.root.style.display, 'none');
  assert.equal(f.marker.questId, null); f.marker.dispose();
});
test('reset during source loading cannot resurrect an old session marker', async () => {
  const load = deferred(), f = fixture(() => load.promise);
  const first = f.marker.show(77); f.marker.reset();
  load.resolve(metadata()); assert.equal(await first, false);
  assert.equal(f.marker.root.style.display, 'none');
  f.marker.root.fire('click'); assert.deepEqual(f.opened, []);
  await f.marker.show(88); f.marker.root.fire('click'); assert.deepEqual(f.opened, [88]);
  f.marker.dispose();
});
test('latest ID wins while metadata loads; dispose retires callbacks and observers', async () => {
  const load = deferred(), f = fixture(() => load.promise);
  const first = f.marker.show(1), second = f.marker.show(2);
  load.resolve(metadata()); assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(f.marker.root.dataset.questId, '2');
  f.marker.dispose(); f.marker.root.fire('click');
  f.setAnchor({ getBoundingClientRect: () => f.rect });
  f.observers[0].callback(); // a queued observer callback cannot reattach after dispose
  assert.deepEqual(f.opened, []); assert.equal(f.listeners.size, 0);
  assert.ok(f.observers.every(o => o.observed === null));
  assert.equal(await f.marker.show(3), false);
});
test('missing original metadata/art fails closed and a later packet retries', async () => {
  let attempts = 0;
  const f = fixture(async () => { const m = metadata(); if (++attempts === 1) m.layout.button.texture = 'missing'; return m; });
  await flush(); assert.equal(f.marker.data, null);
  assert.equal(await f.marker.show(1), true); assert.equal(attempts, 2);
  f.marker.dispose();
});
test('wrong source anchor or unavailable labels cannot invent placement or captions', async () => {
  for (const change of [m => { m.layout.button.position.selfAnchor = 2; }, m => { m.strings = []; }]) {
    const m = metadata(); change(m); const f = fixture(async () => m);
    assert.equal(await f.marker.show(1), false); assert.equal(f.marker.data, null);
    assert.deepEqual(f.opened, []); f.marker.dispose();
  }
});


test('native strict timer boundary, one callback per frame, remainder and queue order', () => {
  const effect = new QuestMarkEffect(); effect.begin();
  assert.deepEqual(effect.advance(0.01), []);
  assert.deepEqual(effect.advance(0.001), [1]); assert.equal(effect.alpha, 15);
  const stalled = new QuestMarkEffect(); stalled.begin();
  assert.deepEqual(stalled.advance(1), [0, 1, 2]);
  assert.equal(stalled.alpha, 15); assert.equal(stalled.scale, 55);
  assert.deepEqual(stalled.advance(0), [1, 2]); // blink remainder equals .5: strict >
  assert.equal(stalled.alpha, 30); assert.equal(stalled.scale, 60);
});
test('native alpha strict endpoints and already queued size callback after kill', () => {
  const effect = new QuestMarkEffect(); effect.begin();
  // A stalled timer keeps a remainder; each frame still dispatches only once.
  effect.advance(10);
  for (let i = 1; i < 17; i++) effect.advance(0);
  assert.equal(effect.alpha, 255); assert.equal(effect.rising, true);
  effect.advance(0); assert.equal(effect.alpha, 255); assert.equal(effect.rising, false);
  for (let i = 0; i < 17; i++) effect.advance(0);
  assert.equal(effect.alpha, 0); assert.equal(effect.active, true);
  const before = effect.scale;
  assert.deepEqual(effect.advance(0), [1, 2]);
  assert.equal(effect.active, false); assert.equal(effect.scale, before + 5);
  assert.deepEqual(effect.advance(0), []);
});
test('repeat BeginEffect preserves blink and appends source timer records', () => {
  const effect = new QuestMarkEffect(); effect.begin(); effect.advance(1);
  assert.equal(effect.blink, true);
  effect.begin(); assert.equal(effect.blink, true); assert.equal(effect.timers.length, 6);
  assert.deepEqual(effect.advance(0.02), [0, 1, 2, 1]); assert.equal(effect.alpha, 30);
});
test('source paint geometry uses first glow twice, integer scale and later highlight', () => {
  const effect = new QuestMarkEffect(), refs = ['a', 'b', 'c', 'd', 'e']; effect.begin();
  assert.deepEqual(effect.layers(refs).map(p => [p.ref, p.x, p.y, p.size]),
    [['d', -48, -48, 128], ['d', -16, -16, 64]]);
  effect.scale = 55;
  assert.equal(effect.layers(refs)[1].size, 70); assert.equal(effect.layers(refs)[1].x, -19);
  effect.active = false; effect.blink = true;
  assert.deepEqual(effect.layers(refs), [{ ref: 'c', x: 0, y: 0, size: 32, alpha: 255, uv: 32 }]);
});
test('real marker pointer states, glow children and frame retirement', async () => {
  const f = fixture(); await f.marker.show(1);
  assert.equal(f.marker.layers[0].painted, 'synthetic-glow1');
  assert.equal(f.marker.layers[1].painted, 'synthetic-glow1');
  assert.equal(f.marker.layers[0].style.left, '-48px');
  f.marker.root.fire('pointerenter'); assert.equal(f.marker.root.painted, 'synthetic-hover');
  f.marker.root.fire('pointerdown', { buttons: 1 }); assert.equal(f.marker.root.painted, 'synthetic-down');
  f.marker.root.fire('pointerup'); assert.equal(f.marker.root.painted, 'synthetic-hover');
  f.marker.root.fire('pointerleave'); assert.equal(f.marker.root.painted, 'synthetic-original-art');
  const callback = [...f.frames.values()][0]; f.frames.clear(); callback(20);
  assert.equal(f.marker.effect.alpha, 15); assert.equal(f.frames.size, 1);
  f.marker.root.fire('click'); assert.equal(f.marker.root.style.display, 'none');
  assert.equal(f.marker.effect.timers.length, 3); // hide does not cancel native timers
  f.marker.reset(); assert.equal(f.frames.size, 0); assert.equal(f.marker.effect.timers.length, 0);
  await f.marker.show(2); const newFrame = f.marker.frameId;
  callback(40); assert.equal(f.marker.frameId, newFrame); assert.equal(f.marker.effect.alpha, 0);
  f.marker.dispose(); assert.equal(f.frames.size, 0);
});
