import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The existing asset pipeline supplies the same Three.js API. No DOM,
// renderer, private client assets, or browser automation is needed here.
const threeModule = new URL('../../../tools/src/char_pipeline/node_modules/three/build/three.module.js', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: threeModule.href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { FollowCamera, tutorialRotationInput } = await import('../js/camera.js');

function cameraInput() {
  const handlers = new Map(), reports = [];
  const dom = { addEventListener(name, fn) { handlers.set(name, fn); }, setPointerCapture() {} };
  const camera = new FollowCamera({}, dom, { onTutorialInput: bit => reports.push(bit) });
  const emit = (name, event = {}) => handlers.get(name)({ preventDefault() {}, ...event });
  return { camera, reports, emit };
}

test('rotation completion uses each command truncated to native angular units', () => {
  const rad = nativeUnits => nativeUnits * (Math.PI * 2) / 65536;
  for (const value of [0, 100, 100.99, -100, -100.99]) {
    assert.equal(tutorialRotationInput(rad(value), 0), false);
    assert.equal(tutorialRotationInput(0, rad(value)), false);
  }
  for (const value of [101.01, -101.01]) {
    assert.equal(tutorialRotationInput(rad(value), 0), true);
    assert.equal(tutorialRotationInput(0, rad(value)), true);
  }
  assert.equal(tutorialRotationInput(NaN, Infinity), false);
});

test('actual drag reports once per qualifying command without accumulating small moves', () => {
  const { camera, reports, emit } = cameraInput();
  const startYaw = camera.yaw;
  emit('pointermove', { clientX: 500, clientY: 500 });
  assert.deepEqual(reports, [], 'hover never reports rotation');
  emit('pointerdown', { button: 2, clientX: 0, clientY: 0, pointerId: 1 });
  for (let x = 1; x <= 5; x++) emit('pointermove', { clientX: x, clientY: 0 });
  assert.deepEqual(reports, [], 'five subthreshold commands must not accumulate');
  assert.equal(camera.yaw, startYaw - 5 * 0.005, 'existing sensitivity is unchanged');
  emit('pointermove', { clientX: 8, clientY: 0 });
  emit('pointermove', { clientX: 8, clientY: -3 });
  assert.deepEqual(reports, [2, 2]);
  emit('pointerup', { button: 2 });
  emit('pointermove', { clientX: 100, clientY: 100 });
  assert.deepEqual(reports, [2, 2]);
});

test('pitch input qualifies before the source pitch clamp, including at its limit', () => {
  const { camera, reports, emit } = cameraInput();
  emit('pointerdown', { button: 2, clientX: 0, clientY: 0, pointerId: 1 });
  emit('pointermove', { clientX: 0, clientY: 500 });
  const clamped = camera.pitch;
  emit('pointermove', { clientX: 0, clientY: 1000 });
  assert.equal(camera.pitch, clamped);
  assert.deepEqual(reports, [2, 2]);
});

test('zoom input reports original bit even at limit while programmatic changes stay silent', () => {
  const { camera, reports, emit } = cameraInput();
  camera.yaw = 2;
  camera.dist = camera.maxDist;
  camera.resetToDefaultView();
  assert.deepEqual(reports, [], 'entry resets, settings and render changes are not player actions');
  emit('wheel', { deltaY: 0 });
  assert.deepEqual(reports, []);
  emit('wheel', { deltaY: -1 });
  camera.dist = camera.maxDist;
  emit('wheel', { deltaY: 1 });
  assert.equal(camera.dist, camera.maxDist);
  assert.deepEqual(reports, [4, 4]);
});
