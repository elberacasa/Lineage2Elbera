'use strict';
// Elbera Tools: synthetic shortcut packets only; no sockets/accounts/database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

const d = (...values) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeInt32LE(value | 0, i * 4));
  return bytes;
};
const packet = (op, ...payload) => Buffer.concat([Buffer.from([op]), ...payload]);
const action = (index = 0, id = 0, owner = 1) => d(3, index, id, owner);
const skill = (index = 1, id = 1001, level = 3, owner = 1) =>
  Buffer.concat([d(2, index, id, level), Buffer.from([7]), d(owner)]);
const item = (index = 119) => d(1, index, 999, 1, -1, 17, 30, 0x89abcdef);
function fixture(entered = true) {
  const ws = new EventEmitter(), messages = [], packets = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {}; game._send = bytes => packets.push(bytes);
  bridge.game = game; bridge.entered = entered; bridge._wireGame(game, {}, true);
  game.state = 'IN_GAME'; game.on('parseError', error => errors.push(error));
  return { game, bridge, messages, packets, errors,
    send: m => bridge._onMessage(JSON.stringify(m)),
    enter: () => game.emit('userInfo', { id: 42, name: 'Synthetic', hp: 50, maxHp: 50 }) };
}
const shortcutMessages = f => f.messages.filter(m => m.op.startsWith('shortcut'));

test('complete mixed snapshot retains exact types, slot positions and native row extras', () => {
  const f = fixture();
  f.game._onPacket(packet(0x45, d(5), action(), skill(), item(), d(4, 2, 55, 1), d(5, 3, 66, 2)));
  assert.deepEqual(f.errors, []); assert.deepEqual(f.packets, []);
  assert.deepEqual(f.messages, [{ op: 'shortcutInit', shortcuts: [
    { page: 0, slot: 0, type: 'action', id: 0, characterType: 1 },
    { page: 0, slot: 1, type: 'skill', id: 1001, level: 3, skillFlag: 7, characterType: 1 },
    { page: 9, slot: 11, type: 'item', id: 999, characterType: 1, sharedReuseGroup: -1,
      remainingReuseSeconds: 17, totalReuseSeconds: 30, augmentationId: 0x89abcdef },
    { page: 0, slot: 2, type: 'macro', id: 55, characterType: 1 },
    { page: 0, slot: 3, type: 'recipe', id: 66, characterType: 2 },
  ] }]);
});

test('single skill updates and delete echoes preserve received fields without inferred changes', () => {
  const f = fixture();
  f.game._onPacket(packet(0x44, skill(13, 1001, 4, 2)));
  f.game._onPacket(packet(0x46, d(13, 9)));
  assert.deepEqual(f.messages, [
    { op: 'shortcutRegister', shortcut: { page: 1, slot: 1, type: 'skill', id: 1001,
      level: 4, skillFlag: 7, characterType: 2 } },
    { op: 'shortcutDelete', page: 1, slot: 1, unknown: 9 },
  ]);
  assert.deepEqual(f.packets, []);
});

test('latest pre-entry full replacement overrides earlier changes, then replays subsequent changes', () => {
  const f = fixture(false), other = fixture(false);
  f.game._onPacket(packet(0x44, action(5, 2)));
  f.game._onPacket(packet(0x45, d(1), action(0, 0)));
  f.game._onPacket(packet(0x44, skill(1)));
  f.game._onPacket(packet(0x46, d(1, 0)));
  f.game._onPacket(packet(0x44, action(2, 5)));
  assert.deepEqual(f.messages, []); assert.equal(other.bridge.pendingShortcutInit, null);
  f.enter();
  assert.equal(f.messages[0].op, 'enterWorld');
  assert.deepEqual(shortcutMessages(f), [
    { op: 'shortcutInit', shortcuts: [{ page: 0, slot: 0, type: 'action', id: 0, characterType: 1 }] },
    { op: 'shortcutDelete', page: 0, slot: 1, unknown: 0 },
    { op: 'shortcutRegister', shortcut: { page: 0, slot: 2, type: 'action', id: 5, characterType: 1 } },
  ]);
  assert.equal(f.bridge.pendingShortcutInit, null); assert.equal(f.bridge.pendingShortcutChanges.size, 0);
  f.messages.length = 0; f.enter(); assert.deepEqual(shortcutMessages(f), []);
});

test('empty full snapshots remain authoritative and discard older pending rows', () => {
  const f = fixture(false);
  f.game._onPacket(packet(0x45, d(1), item()));
  f.game._onPacket(packet(0x44, action(0, 0)));
  f.game._onPacket(packet(0x45, d(0)));
  f.enter(); assert.deepEqual(shortcutMessages(f), [{ op: 'shortcutInit', shortcuts: [] }]);
  f.game._onPacket(packet(0x45, d(0)));
  assert.deepEqual(shortcutMessages(f).at(-1), { op: 'shortcutInit', shortcuts: [] });
});

test('malformed rows, counts, duplicate positions and trailing bytes cannot publish partial state', () => {
  const invalid = [packet(0x45, d(-1)), packet(0x45, d(121)), packet(0x45, d(1)),
    packet(0x45, d(2), action(), action()), packet(0x45, d(0), Buffer.from([0])),
    packet(0x44, skill().subarray(0, -1)), packet(0x44, item().subarray(0, -1)),
    packet(0x44, d(6, 0, 1, 1)), packet(0x44, d(1, 120, 1, 1)),
    packet(0x44, action(-1)), packet(0x44, d(2, 0, 0, 1, 1)),
    packet(0x46, d(0)), packet(0x46, d(0, 0, 0)), packet(0x46, d(-1, 0))];
  for (const bytes of invalid) {
    const f = fixture(false); f.game._onPacket(packet(0x45, d(1), action()));
    const prior = f.bridge.pendingShortcutInit;
    f.game._onPacket(bytes);
    assert.equal(f.errors.length, 1, bytes.toString('hex'));
    assert.equal(f.bridge.pendingShortcutInit, prior);
    assert.deepEqual(f.messages, []);
  }
});

test('registration uses original 0x33 and deletion 0x35; requests never fabricate server echoes', async () => {
  const f = fixture();
  for (const [type, kind, id] of [['action', 3, 0], ['skill', 2, 1001], ['item', 1, 999], ['recipe', 5, 701]]) {
    await f.send({ op: 'shortcutRegister', page: 9, slot: 11, type, id, characterType: 1, level: 99 });
    assert.deepEqual(f.packets.at(-1), packet(0x33, d(kind, 119, id, 1)));
  }
  await f.send({ op: 'shortcutDelete', page: 0, slot: 0 });
  assert.deepEqual(f.packets.at(-1), packet(0x35, d(0)));
  assert.deepEqual(f.messages, []); // Empty-slot deletion may never get a server echo.
  assert.ok(!f.packets.some(p => p[0] === 0x34));
});

test('invalid positions, IDs, unsupported registrations and unentered sessions send no packets', async () => {
  const f = fixture(), valid = { op: 'shortcutRegister', page: 0, slot: 0, type: 'skill', id: 1001, characterType: 1 };
  for (const change of [{ page: -1 }, { page: 10 }, { page: '0' }, { slot: -1 }, { slot: 12 },
    { slot: 1.5 }, { id: 0 }, { id: -1 }, { id: 2 ** 32 + 1001 }, { id: '1001' },
    { characterType: 2 }, { characterType: null }, { type: 'macro' }, { type: 2 }])
    await f.send({ ...valid, ...change });
  for (const position of [{ page: -1, slot: 0 }, { page: 10, slot: 0 }, { page: 0, slot: 12 }, { page: 0, slot: '0' }])
    await f.send({ op: 'shortcutDelete', ...position });
  f.game.state = 'AUTHED'; await f.send(valid);
  f.game.state = 'IN_GAME'; f.bridge.entered = false; await f.send(valid);
  await f.send({ op: 'shortcutDelete', page: 0, slot: 0 });
  assert.deepEqual(f.packets, []); assert.deepEqual(f.messages, []);
});

test('replaced or closed bridge sessions cannot receive old shortcut mutations', () => {
  const f = fixture(false), old = f.game;
  old._onPacket(packet(0x45, d(1), item()));
  const next = new GameSession(); f.bridge.game = next; f.bridge._wireGame(next, {}, true);
  assert.equal(f.bridge.pendingShortcutInit, null);
  old._onPacket(packet(0x44, action())); assert.equal(f.bridge.pendingShortcutChanges.size, 0);
  f.bridge.closed = true;
  next.emit('shortcutInit', { shortcuts: [] }); assert.equal(f.bridge.pendingShortcutInit, null);
});
