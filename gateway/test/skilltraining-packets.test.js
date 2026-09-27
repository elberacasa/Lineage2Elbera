'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

// Elbera Tools: independent synthetic wire fixtures, no sockets or accounts.
function packet(op, ...values) {
  const bytes = Buffer.alloc(1 + 4 * values.length); bytes[0] = op;
  values.forEach((v, i) => bytes.writeInt32LE(v, 1 + i * 4));
  return bytes;
}
function fixture() {
  const ws = new EventEmitter(), messages = [], packets = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const game = new GameSession(), bridge = new Bridge(ws, {}, () => {});
  bridge.game = game; bridge._wireGame(game, {}, true); game.state = 'IN_GAME';
  game._send = bytes => packets.push(bytes);
  game.on('parseError', error => errors.push(error));
  return { game, messages, packets, errors, send: msg => bridge._onMessage(JSON.stringify(msg)) };
}

test('trainer lists preserve order, cost, type and uninterpreted fields through the bridge', () => {
  const f = fixture();
  f.game._onPacket(packet(0x8a, 2, 2, 1001, 2, 9, 3456, 7, 1002, 1, 3, 0, 1));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [{ op: 'acquireSkillList', type: 2, skills: [
    { id: 1001, level: 2, maxLevel: 9, cost: 3456, itemConsume: 7 },
    { id: 1002, level: 1, maxLevel: 3, cost: 0, itemConsume: 1 },
  ] }]);
  assert.deepEqual(f.packets, [], 'receiving a list never purchases a skill');
});

test('trainer info retains every item requirement without replacing server quantities', () => {
  const f = fixture();
  f.game._onPacket(packet(0x8b, 1001, 3, 1234, 1, 2, 99, 4001, 2, 50, 4, 4002, 123456, 0));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [{ op: 'acquireSkillInfo', id: 1001, level: 3, cost: 1234, type: 1,
    requirements: [{ type: 99, itemId: 4001, count: 2, unknown: 50 },
      { type: 4, itemId: 4002, count: 123456, unknown: 0 }] }]);
});

test('empty lists and done remain separate events, with no inferred SP or skill updates', () => {
  const f = fixture();
  f.game._onPacket(packet(0x8a, 0, 0)); f.game._onPacket(packet(0x8e));
  assert.deepEqual(f.messages, [{ op: 'acquireSkillList', type: 0, skills: [] }, { op: 'acquireSkillDone' }]);
  assert.deepEqual(f.packets, []);
});

test('malformed counts, incomplete rows and trailing bytes never expose partial trainer state', () => {
  const malformed = [packet(0x8a, 0, -1), packet(0x8a, 0, 0x7fffffff),
    packet(0x8a, 0, 1, 1, 2, 3, 4), packet(0x8a, 0, 0, 123),
    packet(0x8b, 1, 1, 1, 0, -1), packet(0x8b, 1, 1, 1, 0, 1, 2, 3, 4),
    packet(0x8e, 123), Buffer.from([0x8b])];
  for (const bytes of malformed) {
    const f = fixture(); f.game._onPacket(bytes);
    assert.equal(f.errors.length, 1); assert.deepEqual(f.messages, []);
  }
});

test('info and learn send distinct original requests with exact selected ID, level and type', async () => {
  for (const type of [0, 1, 2]) {
    const f = fixture();
    await f.send({ op: 'acquireSkillInfo', id: 1001, level: 3, type });
    await f.send({ op: 'acquireSkill', id: 1001, level: 3, type });
    assert.deepEqual(f.packets, [packet(0x6b, 1001, 3, type), packet(0x6c, 1001, 3, type)]);
  }
});

test('invalid requests do not wrap integers or masquerade as another acquisition type', async () => {
  const f = fixture(), valid = { id: 1001, level: 1, type: 0 };
  for (const op of ['acquireSkillInfo', 'acquireSkill']) {
    for (const invalid of [
      { id: 0 }, { id: -1 }, { id: 2 ** 32 + 1001 }, { id: '1001' },
      { level: 0 }, { level: 1.5 }, { type: 3 }, { type: -1 }, { type: '0' }, { type: null },
    ]) await f.send({ op, ...valid, ...invalid });
    f.game.state = 'AUTHED'; await f.send({ op, ...valid }); f.game.state = 'IN_GAME';
  }
  assert.deepEqual(f.packets, []);
});
