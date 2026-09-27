'use strict';
// Elbera Tools: synthetic plaintext packets; no sockets, originals or accounts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

const dwords = (...values) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeInt32LE(value, i * 4));
  return bytes;
};
const message = (id, count, ...params) => Buffer.concat([Buffer.from([0x64]), dwords(id, count), ...params]);
function fixture() {
  const ws = new EventEmitter(), messages = [], decoded = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {};
  bridge.game = game; bridge.entered = true; bridge._wireGame(game, {}, true);
  game.state = 'IN_GAME';
  game.on('systemMessage', m => decoded.push(m));
  game.on('parseError', error => errors.push(error));
  return { game, messages, decoded, errors };
}

test('skill names preserve exact ID and level while legacy consumers retain the flat ID', () => {
  const f = fixture();
  f.game._onPacket(message(48, 2, dwords(4, 226, 3), dwords(1, 17)));
  const typedParams = [{ type: 4, value: { id: 226, level: 3 } }, { type: 1, value: 17 }];
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.decoded, [{ id: 48, params: typedParams }]);
  assert.deepEqual(f.messages, [{ op: 'sysMsg', id: 48, params: [226, 17], typedParams }]);
});

test('text, numbers, NPCs, items, castles, configured-server item counts and locations keep their types and order', () => {
  const f = fixture();
  f.game._onPacket(message(9000, 8,
    Buffer.concat([dwords(0), Buffer.from('Synthetic Ω\0', 'utf16le')]),
    dwords(1, -5), dwords(2, 1000101), dwords(3, 57), dwords(4, 3, 2),
    dwords(5, 1), dwords(6, 123456), dwords(7, -100, 200, -300)));
  const typedParams = [
    { type: 0, value: 'Synthetic Ω' }, { type: 1, value: -5 }, { type: 2, value: 1000101 },
    { type: 3, value: 57 }, { type: 4, value: { id: 3, level: 2 } }, { type: 5, value: 1 },
    { type: 6, value: 123456 }, { type: 7, value: [-100, 200, -300] },
  ];
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [{ op: 'sysMsg', id: 9000,
    params: ['Synthetic Ω', -5, 1000101, 57, 3, 1, 123456, [-100, 200, -300]], typedParams }]);
});

test('empty messages remain empty rather than gaining inferred types or values', () => {
  const f = fixture(); f.game._onPacket(message(24, 0));
  assert.deepEqual(f.messages, [{ op: 'sysMsg', id: 24, params: [], typedParams: [] }]);
});

test('truncated skills, invalid counts, unknown types and trailing bytes never emit a partial typed message', () => {
  const invalid = [message(1, -1), message(1, 0x7fffffff), message(1, 1, dwords(4, 226)),
    message(1, 2, dwords(1, 10), dwords(4, 226)), message(1, 1, dwords(8, 10)),
    message(1, 0, Buffer.from([0])), Buffer.from([0x64]),
    message(1, 1, dwords(0), Buffer.from('Unterminated', 'utf16le'))];
  for (const bytes of invalid) {
    const f = fixture(); f.game._onPacket(bytes);
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.messages, []); assert.deepEqual(f.decoded, []);
  }
});
