'use strict';
// Elbera Tools: synthetic protocol frames and real bridge handlers only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

function packet(op, ...words) {
  const bytes = Buffer.alloc(1 + words.length * 4); bytes[0] = op;
  words.forEach((word, i) => bytes.writeInt32LE(word, 1 + i * 4));
  return bytes;
}
function fixture() {
  const ws = new EventEmitter(), messages = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {}; game.state = 'IN_GAME';
  game.on('parseError', error => errors.push(error));
  bridge.game = game; bridge.entered = true; bridge.selfId = 42;
  bridge._wireGame(game, {}, true);
  return { bridge, game, messages, errors };
}

test('Die preserves the exact corpse DWORD and explicit nonzero interpretation', () => {
  const f = fixture();
  for (const raw of [0, 1, 2, -1, -0x80000000, 0x7fffffff]) {
    f.game._onPacket(packet(0x06, 7, 1, 0, 0, 0, raw, 0));
    assert.deepEqual(f.messages.at(-1), { op: 'die', id: 7, sweepableRaw: raw, sweepable: raw !== 0 });
  }
  assert.deepEqual(f.errors, []);
});

test('self respawn permission and corpse metadata are independent; revive remains authoritative', () => {
  const f = fixture();
  f.game._onPacket(packet(0x06, 42, 1, 0, 0, 0, 0, 0));
  assert.deepEqual(f.messages[0], { op: 'die', id: 42, sweepableRaw: 0, sweepable: false, canRespawn: true });
  assert.equal(f.bridge.dead, true);
  f.game._onPacket(packet(0x07, 42));
  assert.deepEqual(f.messages[1], { op: 'revive', id: 42 });
  assert.equal(f.bridge.dead, false);
});

test('truncated or trailing Die fields cannot publish a partial corpse event', () => {
  const full = packet(0x06, 7, 1, 0, 0, 0, 1, 0);
  for (const bytes of [full.subarray(0, -1), full.subarray(0, 21), Buffer.concat([full, Buffer.from([0])])]) {
    const f = fixture(); f.game._onPacket(bytes);
    assert.equal(f.errors.length, 1); assert.deepEqual(f.messages, []);
    assert.notEqual(f.bridge.dead, true);
  }
});

test('unknown injected flags stay absent; retired sessions cannot kill or revive the current actor', () => {
  const f = fixture();
  f.game.emit('die', { id: 7 });
  assert.deepEqual(f.messages.pop(), { op: 'die', id: 7 });
  f.bridge.game = new GameSession(); f.bridge.dead = false;
  f.game.emit('die', { id: 42, sweepableRaw: 1 });
  assert.equal(f.bridge.dead, false); assert.deepEqual(f.messages, []);
  f.bridge.dead = true; f.game.emit('revive', 42);
  assert.equal(f.bridge.dead, true); assert.deepEqual(f.messages, []);
  f.bridge.game = f.game; f.game.closed = true;
  f.game.emit('die', { id: 7, sweepableRaw: 1 }); f.game.emit('revive', 42);
  assert.equal(f.bridge.dead, true); assert.deepEqual(f.messages, []);
});
