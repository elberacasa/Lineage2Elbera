import test from 'node:test';
import assert from 'node:assert/strict';

// Import the real module without constructing a DOM. Only its pure state and
// link methods are exercised here; the owning task verifies the actual window.
globalThis.location ??= { search: '' };
globalThis.window ??= { addEventListener() {} };
const { TutorialEvents, TutorialWnd, tutorialWindowHeight } =
  await import('../js/ui/tutorialwnd.js');

test('arming a tutorial mask neither reports nor completes any event', () => {
  const sent = [], events = new TutorialEvents(value => sent.push(value));
  events.arm(0b1010);
  assert.equal(events.mask, 0b1010);
  assert.deepEqual(sent, []);
  assert.equal(events.occurred(0b0100), false);
  assert.equal(events.mask, 0b1010);
  assert.deepEqual(sent, []);
});

test('each enabled action reports once and a new mask replaces the old mask', () => {
  const sent = [], events = new TutorialEvents(value => sent.push(value));
  events.arm(0b1010);
  assert.equal(events.occurred(0b0010), true);
  assert.equal(events.mask, 0b1000);
  assert.equal(events.occurred(0b0010), false);
  events.arm(0b0010);
  assert.equal(events.occurred(0b1000), false);
  assert.equal(events.occurred(0b0010), true);
  assert.equal(events.mask, 0);
  assert.deepEqual(sent, [2, 2]);
});

test('reset clears pending tutorial events and uint32 high bits survive', () => {
  const sent = [], events = new TutorialEvents(value => sent.push(value));
  events.arm(0x80000001);
  assert.equal(events.occurred(0x80000000), true);
  assert.equal(events.mask, 1);
  events.reset();
  assert.equal(events.occurred(1), false);
  assert.deepEqual(sent, [0x80000000]);
});

test('an event report cannot consume a whole armed mask or a zero action', () => {
  const sent = [], events = new TutorialEvents(value => sent.push(value));
  events.arm(3);
  assert.equal(events.occurred(3), false);
  assert.equal(events.occurred(0), false);
  assert.equal(events.mask, 3);
  assert.deepEqual(sent, []);
});

test('tutorial links preserve their original target and never become NPC bypasses', () => {
  const target = TutorialWnd.prototype._bypass;
  assert.equal(target({ ACTION: 'link TE02' }), 'TE02');
  assert.equal(target({ ACTION: 'link TE00' }), 'TE00');
  assert.equal(target({ ACTION: 'link Quest/OriginalPage.htm' }), 'Quest/OriginalPage.htm');
  assert.equal(target({ ACTION: 'bypass -h npc_123_Chat 1' }), null);
  assert.equal(target({ ACTION: 'https://example.test' }), null);
  assert.equal(target({}), null);
});

test('tutorial height follows original script minimum, natural content and maximum', () => {
  assert.equal(tutorialWindowHeight(100), 296);
  assert.equal(tutorialWindowHeight(256), 296);
  assert.equal(tutorialWindowHeight(401), 441);
  assert.equal(tutorialWindowHeight(672), 712);
  assert.equal(tutorialWindowHeight(900), 712);
});

test('tutorial source desktop position stays accessible in a smaller browser', () => {
  window.innerWidth = 789;
  window.innerHeight = 600;
  let placed;
  const viewer = { open: true,
    root: { getBoundingClientRect: () => ({ left: 714, top: 0, width: 310, height: 296 }) },
    place: value => { placed = value; },
  };
  TutorialWnd.prototype.clampToViewport.call(viewer);
  assert.deepEqual(placed, { left: 479, top: 0 });
  viewer.root.getBoundingClientRect = () => ({ left: -12, top: 500, width: 310, height: 712 });
  TutorialWnd.prototype.clampToViewport.call(viewer);
  assert.deepEqual(placed, { left: 0, top: 0 });
});
