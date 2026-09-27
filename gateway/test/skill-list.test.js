'use strict';
// Elbera Tools: plaintext synthetic skill snapshots, no sockets or accounts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

function list(rows, count = rows.length) {
  const bytes = Buffer.alloc(5 + rows.length * 13);
  bytes[0] = 0x58; bytes.writeInt32LE(count, 1);
  rows.forEach(([passive, level, id, disabled], index) => {
    const p = 5 + index * 13;
    bytes.writeInt32LE(passive, p); bytes.writeInt32LE(level, p + 4);
    bytes.writeInt32LE(id, p + 8); bytes[p + 12] = disabled;
  });
  return bytes;
}
function fixture(entered = true) {
  const ws = new EventEmitter(), messages = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {};
  bridge.game = game; bridge.entered = entered;
  bridge._wireGame(game, {}, true); game.state = 'IN_GAME';
  game.on('parseError', error => errors.push(error));
  return { game, bridge, messages, errors };
}

test('level-up snapshot replaces levels, removed skills and packet availability through bridge', () => {
  const f = fixture();
  f.game._onPacket(list([[0, 1, 1001, 0], [1, 1, 1002, 0]]));
  f.game._onPacket(list([[0, 2, 1001, 1], [0, 1, 1003, 0]]));
  f.game._onPacket(list([]));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [
    { op: 'skillList', skills: [{ id: 1001, level: 1, passive: false, disabled: false },
      { id: 1002, level: 1, passive: true, disabled: false }] },
    { op: 'skillList', skills: [{ id: 1001, level: 2, passive: false, disabled: true },
      { id: 1003, level: 1, passive: false, disabled: false }] },
    { op: 'skillList', skills: [] },
  ]);
});

test('pre-entry snapshots retain only latest, including empty, and sessions stay independent', () => {
  const a = fixture(false), b = fixture(false);
  a.game._onPacket(list([[0, 1, 1001, 0]])); a.game._onPacket(list([]));
  assert.deepEqual(a.messages, []); assert.equal(b.bridge.pendingSkillList, null);
  a.game.emit('userInfo', { id: 42, name: 'Synthetic', hp: 50, maxHp: 50 });
  assert.equal(a.messages[0].op, 'enterWorld');
  assert.deepEqual(a.messages[1], { op: 'skillList', skills: [] });
  assert.equal(a.bridge.pendingSkillList, null); assert.deepEqual(b.messages, []);
  a.messages.length = 0;
  a.game.emit('userInfo', { id: 42, name: 'Synthetic', level: 2 });
  assert.equal(a.messages.some(m => m.op === 'enterWorld' || m.op === 'skillList'), false);
});

test('invalid counts, partial rows and trailing bytes cannot clear a queued skill snapshot', () => {
  for (const malformed of [list([], -1), list([], 0x7fffffff), list([], 1),
    list([[0, 1, 1001, 0]], 0), list([[0, 1, 1001, 0]]).subarray(0, -1),
    Buffer.concat([list([]), Buffer.from([0])]), Buffer.from([0x58])]) {
    const f = fixture(false); f.game._onPacket(list([[0, 3, 1001, 0]]));
    const prior = f.bridge.pendingSkillList;
    f.game._onPacket(malformed);
    assert.equal(f.errors.length, 1); assert.equal(f.bridge.pendingSkillList, prior);
    assert.deepEqual(f.messages, []);
  }
});

test('target level differences preserve signed native word for harder and easier targets', () => {
  const f = fixture();
  for (const color of [-32768, -9, -1, 0, 9, 32767]) {
    const packet = Buffer.alloc(7); packet[0] = 0xa6;
    packet.writeInt32LE(101, 1); packet.writeInt16LE(color, 5);
    f.game._onPacket(packet);
    assert.deepEqual(f.messages.at(-1), { op: 'target_ok', id: 101, color });
  }
  assert.deepEqual(f.errors, []);
});
