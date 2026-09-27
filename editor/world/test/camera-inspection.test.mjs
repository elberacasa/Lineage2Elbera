// Elbera Tools observations must not replace authoritative movement callbacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { registerHooks } from 'node:module';

const threeUrl = new URL('../vendor/three.module.min.js', import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'three' ? { url: threeUrl.href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
const THREE = await import(threeUrl.href);
const { FollowCamera } = await import('../js/camera.js');
const { installCameraInspection } = await import('../js/camera-inspection.js');

function inspectorFixture(t) {
  class Element {
    constructor() { this.style = {}; this.children = []; this.events = new Map(); this.textContent = ''; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    addEventListener(name, callback) { this.events.set(name, callback); }
    fire(name) { this.events.get(name)?.(); }
    remove() { this.removed = true; }
  }
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => new Element(), body: new Element() };
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  let refresh;
  t.mock.method(globalThis, 'setInterval', callback => { refresh = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const state = { followCameraActive: true, tile: 'synthetic', online: true };
  const inspector = installCameraInspection('?dev=1', () => state);
  t.after(() => inspector.destroy());
  const panel = document.body.children[0], [, output, measure, bodies] = panel.children;
  const sample = { position: [1, 2, 3], target: [4, 5, 6], requestedBoom: 2,
    actualBoom: 2, yaw: 0, pitch: 0, obstruction: null };
  return { inspector, panel, output, measure, bodies, sample, state, refresh: () => refresh() };
}

test('main approach and stop observations preserve server-position bookkeeping', () => {
  const source = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('const combatFeedback = installCombatFeedback(net, {');
  const end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  for (const enabled of [false, true]) {
    const calls = [], receipt = { id: 7, targetId: 8, distance: 150, x: 1, y: 2, z: 3 };
    let callbacks;
    vm.runInNewContext(source.slice(start, end + 4), {
      net: {}, combat: {}, entities: {}, character: {}, selfId: 7,
      installCombatFeedback: (_net, ctx) => { callbacks = ctx; return {}; },
      cameraInspection: enabled ? { record: kind => calls.push(kind) } : null,
      cancelFineNavigation: reason => calls.push(reason),
      rememberServerPosition: value => { assert.equal(value, receipt); calls.push('remember'); },
    });
    callbacks.onSelfMoveToPawn(receipt);
    assert.deepEqual(calls, enabled ? ['moveToPawn', 'server-pursuit', 'remember']
      : ['server-pursuit', 'remember']);
    calls.length = 0;
    callbacks.onSelfStopMove(receipt);
    assert.deepEqual(calls, enabled ? ['stopMove', 'remember'] : ['remember']);
  }
});

test('camera observer measures the compatibility collapse without changing the camera', () => {
  const frames = [];
  const make = onFrame => new FollowCamera(new THREE.PerspectiveCamera(), {
    addEventListener() {}, setPointerCapture() {},
  }, { onFrame });
  const plain = make(null), observed = make(frame => frames.push(frame));
  // Synthetic floor selection deliberately reproduces the diagnosed defect.
  // It is not an assertion that this is an original-client collision result.
  const floor = { heightAtWorld: () => 5 }, focus = new THREE.Vector3();
  plain.update(1 / 60, focus, floor);
  observed.update(1 / 60, focus, floor);
  assert.deepEqual(observed.camera.position.toArray(), plain.camera.position.toArray());
  assert.deepEqual(observed.camera.quaternion.toArray(), plain.camera.quaternion.toArray());
  assert.equal(frames.length, 1);
  assert.ok(frames[0].requestedBoom > 0);
  assert.equal(frames[0].actualBoom, 0);
  assert.equal(frames[0].obstruction.kind, 'walking-height');
  assert.equal(frames[0].obstruction.floorY, 5);
  assert.deepEqual(frames[0].position, frames[0].target);
});

test('inactive inspector discards the old camera before display or body measurement', t => {
  const f = inspectorFixture(t);
  f.panel.open = true;
  f.inspector.capture(f.sample);
  f.measure.fire('click');
  assert.deepEqual(JSON.parse(f.bodies.textContent).camera.position, f.sample.position);
  // A mode switch may occur between the last animation frame and the click.
  f.state.followCameraActive = false;
  f.measure.fire('click');
  assert.match(f.bodies.textContent, /Follow camera inactive/);
  f.refresh();
  assert.match(f.output.textContent, /Follow camera: inactive/);
  assert.match(f.output.textContent, /Camera L2: unknown/);
  f.inspector.capture(f.sample); // inactive modes cannot accept stale callbacks
  f.state.followCameraActive = true;
  f.measure.fire('click');
  assert.equal(f.bodies.textContent, 'No follow-camera frame available.');
  const next = { ...f.sample, position: [7, 8, 9] };
  f.inspector.capture(next);
  f.measure.fire('click');
  assert.deepEqual(JSON.parse(f.bodies.textContent).camera.position, next.position);
});

test('animation-loop invalidation clears a cached sample even while inspector is closed', t => {
  const f = inspectorFixture(t);
  f.inspector.capture(f.sample);
  f.measure.fire('click');
  assert.ok(f.bodies.textContent);
  f.inspector.capture(null);
  assert.equal(f.bodies.textContent, '');
  f.panel.open = true;
  f.panel.fire('toggle');
  assert.match(f.output.textContent, /Camera L2: unknown/);
  f.measure.fire('click');
  assert.equal(f.bodies.textContent, 'No follow-camera frame available.');
});

test('main inspection hooks match the actual follow-camera branch and invalidate its alternatives', () => {
  const source = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('const cameraInspection = installCameraInspection(');
  const end = source.indexOf('\nif (cameraInspection)', start);
  const invalidation = source.match(/^  if \(!character \|\| !terrain[^\n]+cameraInspection\?\.capture\(null\);$/m)?.[0];
  assert.ok(start >= 0 && end > start && invalidation);
  for (const [character, terrain, inspectionCameraPose, online, active] of [
    [{}, {}, null, true, true], [{}, {}, {}, true, true],
    [{}, {}, {}, false, false], [null, {}, null, true, false],
    [{}, null, null, true, false],
  ]) {
    let readState, invalidated = 0;
    const context = vm.createContext({ character, terrain, inspectionCameraPose, online,
      location: { search: '?dev=1' }, currentTile: 'synthetic', combat: {},
      entities: { getEntity() {} },
      installCameraInspection: (_search, read) => {
        readState = read;
        return { capture: sample => { assert.equal(sample, null); invalidated++; } };
      },
    });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(readState().followCameraActive, active);
    vm.runInContext(invalidation, context);
    assert.equal(invalidated, active ? 0 : 1);
  }
});
