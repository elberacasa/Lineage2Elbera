'use strict';
// Elbera Tools: synthetic packets through the real decoder and bridge.
// No socket, account, game-state mutation, or original asset is required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PacketWriter } = require('../src/l2io.js');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

function packet(values = {}) {
  const v = { soundType: 0, sound: 'SyntheticBank.Group.Feedback', objectFlag: 0,
    objectId: 0, x: 0, y: 0, z: 0, delay: 0, ...values };
  return new PacketWriter().writeC(0x98).writeD(v.soundType).writeS(v.sound)
    .writeD(v.objectFlag).writeD(v.objectId).writeLoc(v.x, v.y, v.z)
    .writeD(v.delay).build();
}
function fixture(entered = true) {
  const ws = new EventEmitter(), messages = [], errors = [], decoded = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {};
  bridge.game = game; bridge.entered = entered; bridge._wireGame(game, {}, true);
  game.state = 'IN_GAME';
  game.on('parseError', error => errors.push(error));
  game.on('playSound', data => decoded.push(data));
  return { game, bridge, messages, errors, decoded };
}

test('sound wire fields retain reference, mode, signed location and trailing delay', () => {
  const f = fixture(), values = { soundType: 2, sound: 'Synthetic.Voice_\u00f1',
    objectFlag: 1, objectId: 987654, x: -84436, y: 242793, z: -3729, delay: 2500 };
  f.game._onPacket(packet(values));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.decoded, [values]);
  assert.deepEqual(f.messages, [{ op: 'playSound', ...values }]);
});

test('valid modes and unknown fields remain uninterpreted; identical events are not deduplicated', () => {
  const f = fixture();
  for (const soundType of [0, 1, 2, 99]) f.game._onPacket(packet({ soundType, objectFlag: 7 }));
  f.game._onPacket(packet()); f.game._onPacket(packet());
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages.map(m => m.soundType), [0, 1, 2, 99, 0, 0]);
  assert.equal(f.messages[3].objectFlag, 7);
  assert.deepEqual(f.messages[4], f.messages[5]);
});

test('every truncated packet and surplus byte rejects before publishing an event', () => {
  const bytes = packet();
  for (let length = 1; length < bytes.length; length++) {
    const f = fixture(); f.game._onPacket(bytes.subarray(0, length));
    assert.equal(f.errors.length, 1, `truncation ${length}`);
    assert.deepEqual(f.decoded, []); assert.deepEqual(f.messages, []);
  }
  const f = fixture(); f.game._onPacket(Buffer.concat([bytes, Buffer.from([0])]));
  assert.equal(f.errors.length, 1); assert.deepEqual(f.messages, []);
});

test('empty references remain explicit and cannot consume the next packet', () => {
  const f = fixture(); f.game._onPacket(packet({ sound: '' }));
  f.game._onPacket(packet({ sound: 'Synthetic.Next' }));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages.map(m => m.sound), ['', 'Synthetic.Next']);
});

test('pre-entry sounds are dropped instead of replayed after a later world entry', () => {
  const f = fixture(false); f.game._onPacket(packet());
  assert.equal(f.decoded.length, 1); assert.deepEqual(f.messages, []);
  f.game.emit('userInfo', { id: 42, name: 'Synthetic', hp: 1, maxHp: 1 });
  assert.equal(f.messages.some(m => m.op === 'playSound'), false);
  f.game._onPacket(packet());
  assert.equal(f.messages.filter(m => m.op === 'playSound').length, 1);
});

test('a replaced or closed session cannot emit stale feedback', () => {
  const replaced = fixture(), closed = fixture();
  replaced.bridge.game = new GameSession();
  replaced.game._onPacket(packet());
  closed.bridge.closed = true; closed.game._onPacket(packet());
  assert.deepEqual(replaced.messages, []); assert.deepEqual(closed.messages, []);
});
