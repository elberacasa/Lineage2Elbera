// Elbera Tools: real window classes; source-free DOM pointer propagation.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
globalThis.window = { innerWidth: 1000, innerHeight: 800, addEventListener() {} };
globalThis.MutationObserver = class { observe() {} };
const positions = new Map();
globalThis.localStorage = {
  getItem: key => positions.get(key) ?? null,
  setItem: (key, value) => positions.set(key, value),
};
const { L2Window } = await import('../js/ui/window.js');
const { WndMgr } = await import('../js/ui/wndmgr.js');

function fixture(managed = false) {
  const captured = new Map();
  let captures = 0, closed = 0, raised = 0;
  class Element {
    constructor() { this.style = {}; this.listeners = new Map(); this.children = []; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    addEventListener(type, fn, options) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push({ fn, capture: options === true || !!options?.capture });
      this.listeners.set(type, listeners);
    }
    setPointerCapture(id) { captured.set(id, this); captures++; }
    getBoundingClientRect() {
      return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
        width: parseFloat(this.style.width) || 0, height: 100 };
    }
  }
  globalThis.document = { createElement: () => new Element() };
  const win = new L2Window({ back: 'none' }).place({ left: 20, top: 30 }).show();
  win.onClose = () => closed++;
  win.root.addEventListener('pointerdown', () => raised++, true);
  if (managed) WndMgr.register('pointer-regression', win, { handle: win.bar });

  // A captured pointer's up (and consequent click) is targeted at its owner.
  // This is the failure mode a direct closeBtn.click() test would miss.
  function dispatch(type, hit, props = {}) {
    const pointerId = props.pointerId ?? 1;
    const target = type === 'pointerdown' ? hit : captured.get(pointerId) ?? hit;
    const path = []; for (let el = target; el; el = el.parent) path.push(el);
    const event = { target, pointerId, button: 0, clientX: 50, clientY: 40,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; }, ...props };
    const invoke = (el, capture) => {
      event.currentTarget = el;
      for (const entry of el.listeners.get(type) ?? []) if (entry.capture === capture) entry.fn(event);
    };
    for (const el of [...path].reverse()) { invoke(el, true); if (event.stopped) return target; }
    for (const el of path) { invoke(el, false); if (event.stopped) break; }
    return target;
  }
  function click(hit) {
    dispatch('pointerdown', hit);
    const upTarget = dispatch('pointerup', hit);
    captured.delete(1); // implicit release after up; click retains its target
    dispatch('click', upTarget);
  }
  return { win, click, dispatch, captured, Element,
    stats: () => ({ captures, closed, raised }) };
}

for (const managed of [false, true]) {
  test(`close pointer sequence is not stolen by ${managed ? 'registered' : 'standalone'} drag`, () => {
    positions.clear();
    const f = fixture(managed);
    // A child in the control still bubbles through the control itself.
    const icon = f.win.closeBtn.appendChild(new f.Element());
    f.click(icon);
    assert.equal(f.win.visible, false);
    assert.deepEqual(f.stats(), { captures: 0, closed: 1, raised: 1 });
    assert.equal(f.win.root.style.left, '20px');
    assert.equal(positions.size, 0, 'closing must not persist a spurious drag');
  });

  test(`${managed ? 'registered' : 'standalone'} titlebar still captures and drags`, () => {
    positions.clear();
    const f = fixture(managed);
    f.dispatch('pointerdown', f.win.bar);
    assert.equal(f.captured.get(1), f.win.bar);
    f.dispatch('pointermove', f.win.body, { clientX: 80, clientY: 65 });
    f.dispatch('pointerup', f.win.body, { clientX: 80, clientY: 65 });
    f.captured.delete(1);
    assert.equal(f.win.root.style.left, '50px');
    assert.equal(f.win.root.style.top, '55px');
    assert.equal(f.win.visible, true);
    f.dispatch('pointermove', f.win.bar, { clientX: 200, clientY: 200 });
    assert.equal(f.win.root.style.left, '50px', 'released drag must stop moving');
    if (managed) assert.deepEqual(JSON.parse(positions.get('l2vzla.wndpos'))['pointer-regression'],
      { left: 50, top: 55 });
  });
}

test('a titlebar child that prevents pointerdown claims the gesture', () => {
  const f = fixture();
  const child = f.win.bar.appendChild(new f.Element());
  child.addEventListener('pointerdown', e => e.preventDefault());
  f.dispatch('pointerdown', child);
  f.dispatch('pointermove', f.win.bar, { clientX: 90 });
  assert.equal(f.stats().captures, 0);
  assert.equal(f.win.root.style.left, '20px');
});


for (const managed of [false, true]) {
  for (const event of ['pointercancel', 'lostpointercapture']) {
    test(`${event} retires ${managed ? 'registered' : 'standalone'} drag before later pointer movement`, () => {
      positions.clear();
      const f = fixture(managed);
      f.dispatch('pointerdown', f.win.bar);
      f.dispatch('pointermove', f.win.body, { clientX: 80, clientY: 65 });
      assert.equal(f.win.root.style.left, '50px');
      assert.equal(f.win.root.style.top, '55px');
      f.dispatch(event, f.win.bar);
      f.captured.delete(1); // the browser released capture; no pointerup is required
      f.dispatch('pointermove', f.win.bar, { clientX: 200, clientY: 200 });
      assert.equal(f.win.root.style.left, '50px');
      assert.equal(f.win.root.style.top, '55px');
      if (managed) assert.deepEqual(JSON.parse(positions.get('l2vzla.wndpos'))['pointer-regression'],
        { left: 50, top: 55 });
      // A genuinely new gesture must still work after cancellation.
      f.dispatch('pointerdown', f.win.bar, { clientX: 60, clientY: 60 });
      f.dispatch('pointermove', f.win.body, { clientX: 90, clientY: 80 });
      f.dispatch('pointerup', f.win.body);
      assert.equal(f.win.root.style.left, '80px');
      assert.equal(f.win.root.style.top, '75px');
      assert.equal(f.win.visible, true);
      assert.equal(f.stats().closed, 0);
    });
  }
}
