'use strict';
// Elbera Tools: actual browser bridge to packet writer, synthetic session only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

test('inventory count reaches the configured protocol unchanged, including destroy zero', () => {
  const ws = new EventEmitter(), packets = [];
  ws.readyState = 1; ws.send = () => {};
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  bridge.game = game; bridge.entered = true; game._send = bytes => packets.push(bytes);
  for (const [op, opcode] of [['destroyItem', 0x59], ['crystallizeItem', 0x72]]) {
    for (const count of [0, 1, 17, 0x7fffffff]) {
      bridge._onMessage(JSON.stringify({ op, objectId: 42, count }));
      const packet = packets.at(-1);
      assert.equal(packet.length, 9); assert.equal(packet[0], opcode);
      assert.equal(packet.readInt32LE(1), 42); assert.equal(packet.readInt32LE(5), count);
    }
    const sent = packets.length;
    for (const count of [undefined, null, -1, 1.5, '2', 0x80000000]) {
      bridge._onMessage(JSON.stringify({ op, objectId: 42, count }));
    }
    assert.equal(packets.length, sent, 'unknown/unsupported quantities cannot become one item');
  }
});
