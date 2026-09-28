import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Elbera Tools: actual browser approach handler with synthetic server events.
// No renderer, original assets, network connection or gameplay is involved.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return {
    url: new URL('../vendor/three.module.min.js', import.meta.url).href,
    shortCircuit: true,
  };
  return nextResolve(specifier, context);
} });
const { Vector3 } = await import('three');
const { installCombatFeedback } = await import('../js/combat.js');

function fixture(t, { from = [0, 0, 0], to = [1, 0, 0] } = {}) {
  const handlers = new Map(), sent = [], calls = [], retired = [], lifecycle = [];
  const pawn = { group: { position: new Vector3(...to), rotation: { y: 0 } } };
  const other = { group: { position: new Vector3(2, 0, 1), rotation: { y: 0 } } };
  const ch = {
    group: { position: new Vector3(...from) },
    target: new Vector3(99, 0, 99),
    setTarget(p) { calls.push('target'); this.target = p.clone(); },
    clearTarget() { calls.push('clear'); this.target = null; },
  };
  const net = {
    on(op, fn) { assert.equal(handlers.has(op), false, `only one ${op} handler`); handlers.set(op, fn); },
    _emit(op, msg) { handlers.get(op)?.(msg); },
    send(op, fields) { sent.push({ op, ...fields }); return true; },
  };
  const state = installCombatFeedback(net, {
    combat: { clearTarget() {} },
    entities: {
      getEntity(id) { lifecycle.push(['lookup',id]); return id === 2 ? pawn : id === 3 ? other : null; },
      retireNpcWait(id,reason) { retired.push([id,reason]); lifecycle.push(['retire',id]); },
    },
    character: () => ch, selfId: () => 1,
    onSelfMoveToPawn(msg) { calls.push(['approach', msg]); },
    onSelfStopMove(msg) { calls.push(['stop', msg, ch.target]); },
  });
  t.after(() => clearInterval(state._sweepTimer));
  const approach = distance => net._emit('moveToPawn', {
    id: 1, targetId: 2, distance, x: -1000, y: 2000, z: 10,
  });
  return { ch, pawn, other, net, state, sent, calls, retired, lifecycle, approach };
}

test('inside the received distance retires an old visual walk without moving to the pawn', t => {
  const f = fixture(t, { from: [0.6, 7, 0], to: [1, 9, 0] });
  f.approach(50);
  assert.equal(f.ch.target, null);
  assert.deepEqual(f.ch.group.position.toArray(), [0.6, 7, 0]);
  assert.equal(f.state.approachingId, null);
  assert.equal(f.state.approachDistance, 50);
  assert.deepEqual(f.calls.map(c => Array.isArray(c) ? c[0] : c), ['approach', 'clear']);
  assert.deepEqual(f.sent, [], 'neither arrival nor a second movement command is fabricated');
});

test('exact received boundary also stops instead of choosing the pawn center', t => {
  const f = fixture(t, { from: [0.5, 0, 0] });
  f.approach(50);
  assert.equal(f.ch.target, null);
  assert.deepEqual(f.ch.group.position.toArray(), [0.5, 0, 0]);
});

test('coincident positions with zero distance do not divide by zero or retain old movement', t => {
  const f = fixture(t, { from: [1, 0, 0] });
  f.approach(0);
  assert.equal(f.ch.target, null);
  assert.deepEqual(f.sent, []);
});

test('outside the distance preserves the existing planar stop point and received height', t => {
  const f = fixture(t, { from: [0, 7, 0], to: [3, 9, 4] });
  f.approach(200);
  assert.ok(f.ch.target.distanceTo(new Vector3(1.8, 9, 2.4)) < 1e-12);
  assert.equal(f.state.approachingId, 2);
  assert.equal(f.state.approachDistance, 200);
  assert.deepEqual(f.ch.group.position.toArray(), [0, 7, 0], 'packet origin is not a guessed visual teleport');
  assert.deepEqual(f.pawn.group.position.toArray(), [3, 9, 4], 'target vector remains owned by the NPC');
  assert.deepEqual(f.sent, []);
});

test('a near-coincident positive separation does not need an authored movement epsilon', t => {
  const f = fixture(t, { to: [0.00005, 0, 0] });
  f.approach(0);
  assert.deepEqual(f.ch.target.toArray(), [0.00005, 0, 0]);
  assert.ok(f.ch.target.toArray().every(Number.isFinite));
});

test('remote approach only faces that mover and never changes the local target', t => {
  const f = fixture(t);
  const previous = f.ch.target;
  f.net._emit('moveToPawn', { id: 3, targetId: 2, distance: 100 });
  assert.equal(f.ch.target, previous);
  assert.equal(f.other.group.rotation.y, Math.atan2(-1, -1));
  assert.deepEqual(f.calls, []);
});

test('self stop observation retains its existing post-clear order and ignores remote stops', t => {
  const f = fixture(t);
  const msg = { id: 1, x: 12, y: 34, z: 56 };
  f.net._emit('stopMove', { id: 3 });
  assert.deepEqual(f.calls, []);
  f.net._emit('stopMove', msg);
  assert.deepEqual(f.calls, ['clear', ['stop', msg, null]]);
  assert.equal(f.ch.target, null);
  assert.deepEqual(f.sent, []);
});


test('remote approach retires the initial NPC loop before target lookup, including missing targets', t => {
  const f = fixture(t);
  for (const targetId of [2,999]) {
    f.lifecycle.length=0;
    f.net._emit('moveToPawn', {id:3,targetId,distance:100});
    assert.deepEqual(f.lifecycle[0], ['retire',3]);
    assert.ok(f.lifecycle.some(row=>row[0]==='lookup' && row[1]===targetId));
  }
  assert.deepEqual(f.retired, [[3,'move-to-pawn-transition'],[3,'move-to-pawn-transition']]);
  assert.deepEqual(f.sent, []);
});

test('both combat mode messages retire initial NPC playback without changing the existing combat set', t => {
  const f = fixture(t);
  f.net._emit('autoAttack', {id:3,on:true});
  assert.equal(f.state.inCombat.has(3),true);
  f.net._emit('autoAttack', {id:3,on:false});
  assert.equal(f.state.inCombat.has(3),false);
  assert.deepEqual(f.retired, [[3,'combat-mode-transition'],[3,'combat-mode-transition']]);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.sent, []);
});

test('remote stop retires initial NPC playback before the self-only handler returns', t => {
  const f = fixture(t);
  const target=f.ch.target;
  f.net._emit('stopMove', {id:3});
  f.net._emit('stopMove', {id:999});
  assert.deepEqual(f.retired, [[3,'stop-move-transition'],[999,'stop-move-transition']]);
  assert.equal(f.ch.target,target);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.sent, []);
});
