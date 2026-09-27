'use strict';
// Elbera Tools: independent configured-server wire fixtures; no accounts,
// sockets or original-client claims. Fields follow the installed Henna*.java.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

const d = (...values) => {
  const bytes = Buffer.alloc(4 * values.length);
  values.forEach((value, i) => bytes.writeInt32LE(value, i * 4));
  return bytes;
};
const c = (...values) => Buffer.from(values);
const packet = (op, ...parts) => Buffer.concat([c(op), ...parts]);
const statBytes = { INT: 255, STR: 4, CON: 253, MEN: 0, DEX: 5, WIT: 254 };
const state = (rows = [101, 101, 202, 0]) => packet(0xe4, c(...Object.values(statBytes)), d(3, rows.length / 2, ...rows));
const list = op => packet(op, d(98765, 2, 2, 101, 4101, 10, 5500, 7, 202, 4202, 5, 1200, 0));
const item = op => packet(op, d(202, 4202, 5, 1200, 7, 98765),
  d(30), c(31), d(40), c(38), d(50), c(50), d(60), c(62), d(70), c(69), d(80), c(255));
const expectedItems = [
  { symbolId: 101, dyeId: 4101, amount: 10, price: 5500, unknown: 7 },
  { symbolId: 202, dyeId: 4202, amount: 5, price: 1200, unknown: 0 },
];

function fixture(entered = true) {
  const ws = new EventEmitter(), messages = [], packets = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw)); ws.close = () => {};
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {}; game._send = bytes => packets.push(bytes);
  bridge.game = game; bridge.entered = entered; bridge._wireGame(game, {}, true);
  game.state = 'IN_GAME'; game.on('parseError', e => errors.push(e));
  return { bridge, game, messages, packets, errors,
    send: msg => bridge._onMessage(JSON.stringify(msg)),
    enter: (session = game) => session.emit('userInfo', { id: 42, name: 'Synthetic', hp: 50, maxHp: 50 }) };
}
const hennaMessages = f => f.messages.filter(m => m.op.startsWith('henna'));

test('HennaInfo preserves original bytes, slot header and usable symbol DWORDs', () => {
  const f = fixture(); f.game._onPacket(state());
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [{ op: 'hennaInfo', statBytes, maxSlots: 3,
    symbols: [{ symbolId: 101, usableSymbolId: 101 }, { symbolId: 202, usableSymbolId: 0 }] }]);
  assert.deepEqual(f.packets, []);
});

test('equip and removal lists retain their different slot meanings and all received rows', () => {
  const f = fixture(); f.game._onPacket(list(0xe2)); f.game._onPacket(list(0xe5));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [
    { op: 'hennaEquipList', adena: 98765, maxSlots: 2, items: expectedItems },
    { op: 'hennaUnequipList', adena: 98765, emptySlots: 2, items: expectedItems },
  ]);
  f.game._onPacket(packet(0xe2, d(0, 0, 0)));
  f.game._onPacket(packet(0xe5, d(0, 3, 0)));
  assert.deepEqual(f.messages.slice(2), [
    { op: 'hennaEquipList', adena: 0, maxSlots: 0, items: [] },
    { op: 'hennaUnequipList', adena: 0, emptySlots: 3, items: [] },
  ]);
});

test('both detail packets retain ordered D/C stat pairs without recomputing effects or costs', () => {
  const f = fixture(); f.game._onPacket(item(0xe3)); f.game._onPacket(item(0xe6));
  const detail = { ...expectedItems[1], unknown: 7, adena: 98765, stats: {
    INT: { current: 30, after: 31 }, STR: { current: 40, after: 38 },
    CON: { current: 50, after: 50 }, MEN: { current: 60, after: 62 },
    DEX: { current: 70, after: 69 }, WIT: { current: 80, after: 255 },
  } };
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [{ op: 'hennaItemInfo', ...detail }, { op: 'hennaUnequipInfo', ...detail }]);
});

test('every truncated prefix, trailing byte and malformed count rejects before any henna emission', () => {
  const malformed = [packet(0xe2, d(1, 3, -1)), packet(0xe5, d(1, 3, 0x7fffffff)),
    packet(0xe4, c(0, 0, 0, 0, 0, 0), d(3, -1)),
    packet(0xe4, c(0, 0, 0, 0, 0, 0), d(3, 0x7fffffff))];
  for (const valid of [state(), list(0xe2), list(0xe5), item(0xe3), item(0xe6)]) {
    for (let length = 1; length < valid.length; length++) malformed.push(valid.subarray(0, length));
    malformed.push(Buffer.concat([valid, c(0)]));
  }
  for (const bytes of malformed) {
    const f = fixture(); f.game._onPacket(bytes);
    assert.equal(f.errors.length, 1, bytes.toString('hex'));
    assert.deepEqual(f.messages, []); assert.deepEqual(f.packets, []);
  }
});

test('pre-entry henna snapshots replace earlier state, including empty, and flush after enterWorld once', () => {
  const f = fixture(false), other = fixture(false);
  f.game._onPacket(state()); f.game._onPacket(state([]));
  assert.deepEqual(f.messages, []); assert.equal(other.bridge.pendingHennaInfo, null);
  f.enter();
  assert.equal(f.messages[0].op, 'enterWorld');
  assert.deepEqual(hennaMessages(f), [{ op: 'hennaInfo', statBytes, maxSlots: 3, symbols: [] }]);
  assert.equal(f.bridge.pendingHennaInfo, null);
  f.messages.length = 0; f.enter(); assert.deepEqual(hennaMessages(f), []);
});

test('malformed replacements preserve the last complete queued henna snapshot', () => {
  const f = fixture(false); f.game._onPacket(state());
  const previous = f.bridge.pendingHennaInfo;
  f.game._onPacket(state([]).subarray(0, -1));
  assert.equal(f.errors.length, 1); assert.equal(f.bridge.pendingHennaInfo, previous);
  f.enter(); assert.equal(hennaMessages(f)[0].symbols.length, 2);
});

test('retired sessions cannot replace or flush a new session henna snapshot', () => {
  const f = fixture(false), old = f.game;
  old._onPacket(state());
  const next = new GameSession(); next.state = 'IN_GAME';
  next.crypt.decrypt = () => {};
  f.bridge.game = next; f.bridge._wireGame(next, {}, true);
  assert.equal(f.bridge.pendingHennaInfo, null);
  next._onPacket(state([])); const pending = f.bridge.pendingHennaInfo;
  old._onPacket(state()); old._onPacket(list(0xe2)); old._onPacket(item(0xe6));
  f.enter(old);
  assert.deepEqual(f.messages, []); assert.equal(f.bridge.entered, false);
  assert.equal(f.bridge.pendingHennaInfo, pending);
  f.enter(next); assert.deepEqual(hennaMessages(f), [{ op: 'hennaInfo', statBytes, maxSlots: 3, symbols: [] }]);
  f.bridge._shutdown(); assert.equal(f.bridge.pendingHennaInfo, null);
  const count = f.messages.length;
  next._onPacket(state()); next._onPacket(list(0xe5));
  assert.equal(f.messages.length, count); assert.equal(f.bridge.pendingHennaInfo, null);
});

test('all six requests use exact selected DWORDs and never fabricate equip or removal acknowledgments', async () => {
  const f = fixture();
  const requests = [
    ['hennaEquipList', 'unknown', -123, 0xba], ['hennaItemInfo', 'symbolId', 202, 0xbb],
    ['hennaEquip', 'symbolId', 202, 0xbc], ['hennaUnequipList', 'unknown', 456, 0xbd],
    ['hennaUnequipInfo', 'symbolId', 101, 0xbe], ['hennaUnequip', 'symbolId', 101, 0xbf],
  ];
  for (const [op, field, value] of requests) await f.send({ op, [field]: value });
  assert.deepEqual(f.packets, requests.map(([, , value, opcode]) => packet(opcode, d(value))));
  assert.deepEqual(f.messages, []);
  f.game._onPacket(state([]));
  assert.deepEqual(f.messages, [{ op: 'hennaInfo', statBytes, maxSlots: 3, symbols: [] }]);
});

test('invalid fields and missing unknown DWORD never become default or wrapped henna requests', async () => {
  const f = fixture();
  for (const op of ['hennaEquipList', 'hennaUnequipList']) {
    for (const unknown of [undefined, null, '0', 1.5, 0x80000000, -0x80000001])
      await f.send({ op, unknown });
  }
  for (const op of ['hennaItemInfo', 'hennaEquip', 'hennaUnequipInfo', 'hennaUnequip']) {
    for (const symbolId of [undefined, null, '101', 0, -1, 1.5, 0x80000000, 2 ** 32 + 101])
      await f.send({ op, symbolId });
  }
  assert.deepEqual(f.packets, []); assert.deepEqual(f.messages, []);
});

test('unentered, closed and non-game sessions cannot send henna mutations or list requests', async () => {
  const f = fixture(false);
  const sendAll = async () => {
    for (const op of ['hennaEquipList', 'hennaUnequipList', 'hennaItemInfo',
      'hennaEquip', 'hennaUnequipInfo', 'hennaUnequip']) await f.send({ op, unknown: 0, symbolId: 101 });
  };
  await sendAll(); f.bridge.entered = true; f.game.state = 'AUTHED'; await sendAll();
  f.game.state = 'IN_GAME'; f.game.closed = true; await sendAll();
  f.game.closed = false; f.bridge.closed = true; await sendAll();
  assert.deepEqual(f.packets, []); assert.deepEqual(f.messages, []);
});
