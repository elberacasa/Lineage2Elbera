'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Bridge } = require('../src/bridge.js');
const { GameSession } = require('../src/gameclient.js');

function fixture() {
  const ws = new EventEmitter(), messages = [], errors = [], packets = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  bridge.game = game; bridge.entered = true; bridge._wireGame(game, {}, true);
  game.state = 'IN_GAME'; game.crypt.decrypt = () => {};
  game.on('parseError', e => errors.push(e)); game._send = p => packets.push(p);
  return { bridge, game, messages, errors, packets };
}
function packet(id) {
  const bytes = Buffer.alloc(7); bytes[0] = 0xfe; bytes.writeUInt16LE(0x1a, 1);
  bytes.writeInt32LE(id, 3); return bytes;
}
test('original FE/1A preserves the signed ID through packet and bridge without a reply', () => {
  const f = fixture();
  for (const id of [1, 342, 0, -1]) f.game._onPacket(packet(id));
  assert.deepEqual(f.messages, [1, 342, 0, -1].map(questId => ({ op: 'questMark', questId })));
  assert.deepEqual(f.errors, []); assert.deepEqual(f.packets, []);
});
test('truncated or trailing quest marker data cannot produce UI events', () => {
  const f = fixture();
  for (const data of [packet(1).subarray(0, 6), Buffer.concat([packet(1), Buffer.from([0])])])
    f.game._onPacket(data);
  assert.equal(f.errors.length, 2); assert.deepEqual(f.messages, []);
});
test('pre-entry, retired-session and closed markers are dropped without later replay', () => {
  const f = fixture();
  f.bridge.entered = false; f.game._onPacket(packet(1));
  f.bridge.entered = true;
  f.bridge.game = new GameSession(); f.game._onPacket(packet(2));
  f.bridge.game = f.game; f.bridge.closed = true; f.game._onPacket(packet(3));
  f.bridge.closed = false; f.game._onPacket(packet(4));
  assert.deepEqual(f.messages, [{ op: 'questMark', questId: 4 }]);
  assert.deepEqual(f.errors, []);
});
