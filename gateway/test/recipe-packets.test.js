'use strict';
// Elbera Tools: independent installed-server packet fixtures, no sockets,
// accounts or original-client execution. Values intentionally distinguish
// recipe identity, book row ordinal, resource state and result status.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

const words = (...values) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeInt32LE(value, i * 4));
  return bytes;
};
const packet = (opcode, ...values) => Buffer.concat([Buffer.from([opcode]), words(...values)]);
const book = (type = 1, rows = [701, 1, 29, 2]) => packet(0xd6, type, 345, rows.length / 2, ...rows);
const info = (status = -1) => packet(0xd7, 701, 1, 123, 345, status);
const storage = (...values) => Buffer.concat([Buffer.from([0xfe, 0x2e, 0]), words(...values)]);
const limits = [80, 121, 9, 4, 5, 50, 99];
const expectedLimits = { inventory: 80, warehouse: 121, freight: 9,
  privateSell: 4, privateBuy: 5, dwarvenRecipe: 50, recipe: 99 };

function fixture(entered = true) {
  const ws = new EventEmitter(), messages = [], packets = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw)); ws.close = () => {};
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {}; game._send = bytes => packets.push(bytes);
  bridge.game = game; bridge.entered = entered; bridge._wireGame(game, {}, true);
  game.state = 'IN_GAME'; game.on('parseError', error => errors.push(error));
  return { bridge, game, messages, packets, errors,
    send: message => bridge._onMessage(JSON.stringify(message)),
    enter: (session = game) => session.emit('userInfo', { id: 42, name: 'Synthetic', hp: 50, maxHp: 50 }) };
}

test('book list preserves identity, wire ordinal, book type and max MP, including empty replacement', () => {
  const f = fixture(); f.game._onPacket(book()); f.game._onPacket(book(0, []));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [
    { op: 'recipeBook', bookType: 1, maxMp: 345,
      recipes: [{ recipeId: 701, index: 1 }, { recipeId: 29, index: 2 }] },
    { op: 'recipeBook', bookType: 0, maxMp: 345, recipes: [] },
  ]);
  assert.deepEqual(f.packets, []);
});

test('make info preserves MP and each received result without calculating success or counts', () => {
  const f = fixture();
  for (const status of [-1, 0, 1, 17]) f.game._onPacket(info(status));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [-1, 0, 1, 17].map(status => ({ op: 'recipeMakeInfo',
    recipeId: 701, bookType: 1, mp: 123, maxMp: 345, status })));
  assert.deepEqual(f.packets, []);
});

test('capacity snapshot retains all seven independent fields and forwards subsequent zero values', () => {
  const f = fixture(); f.game._onPacket(storage(...limits));
  f.game._onPacket(storage(0, 0, 0, 0, 0, 0, 0));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [{ op: 'storageMaxCount', ...expectedLimits },
    { op: 'storageMaxCount', inventory: 0, warehouse: 0, freight: 0,
      privateSell: 0, privateBuy: 0, dwarvenRecipe: 0, recipe: 0 }]);
});

test('all truncated prefixes, trailing bytes and inconsistent counts reject before emission', () => {
  const malformed = [packet(0xd6, 1, 100, -1), packet(0xd6, 1, 100, 0x7fffffff),
    packet(0xd6, 1, 100, 1), packet(0xd6, 1, 100, 0, 701, 1)];
  for (const valid of [book(), info(), storage(...limits)]) {
    for (let size = 1; size < valid.length; size++) malformed.push(valid.subarray(0, size));
    malformed.push(Buffer.concat([valid, Buffer.from([0])]));
  }
  for (const bytes of malformed) {
    const f = fixture(); f.game._onPacket(bytes);
    assert.equal(f.errors.length, 1, bytes.toString('hex'));
    assert.deepEqual(f.messages, []); assert.deepEqual(f.packets, []);
    assert.equal(f.bridge.pendingStorageMaxCount, null);
  }
});

test('latest complete pre-entry capacities flush after enterWorld once, malformed replacement cannot erase them', () => {
  const f = fixture(false), independent = fixture(false);
  f.game._onPacket(storage(1, 2, 3, 4, 5, 6, 7)); f.game._onPacket(storage(...limits));
  const pending = f.bridge.pendingStorageMaxCount;
  f.game._onPacket(storage(...limits).subarray(0, -1));
  assert.equal(f.errors.length, 1); assert.equal(f.bridge.pendingStorageMaxCount, pending);
  assert.equal(independent.bridge.pendingStorageMaxCount, null);
  f.game._onPacket(book()); f.game._onPacket(info()); // UI responses do not reopen before entry.
  assert.deepEqual(f.messages, []);
  f.enter();
  assert.equal(f.messages[0].op, 'enterWorld');
  assert.deepEqual(f.messages.filter(m => m.op === 'storageMaxCount'),
    [{ op: 'storageMaxCount', ...expectedLimits }]);
  assert.equal(f.bridge.pendingStorageMaxCount, null);
  assert.equal(f.messages.some(m => m.op === 'recipeBook' || m.op === 'recipeMakeInfo'), false);
  f.messages.length = 0; f.enter();
  assert.equal(f.messages.some(m => m.op === 'storageMaxCount'), false);
});

test('retired and closed sessions cannot replace capacities or reopen recipe views', () => {
  const f = fixture(false), old = f.game;
  old._onPacket(storage(...limits));
  const next = new GameSession(); next.state = 'IN_GAME'; next.crypt.decrypt = () => {};
  f.bridge.game = next; f.bridge._wireGame(next, {}, true);
  assert.equal(f.bridge.pendingStorageMaxCount, null);
  next._onPacket(storage(1, 2, 3, 4, 5, 6, 7));
  const pending = f.bridge.pendingStorageMaxCount;
  old._onPacket(storage(...limits)); old._onPacket(book()); old._onPacket(info(1)); f.enter(old);
  assert.deepEqual(f.messages, []); assert.equal(f.bridge.pendingStorageMaxCount, pending);
  f.enter(next); const count = f.messages.length;
  old._onPacket(book()); old._onPacket(info(1));
  assert.equal(f.messages.length, count);
  f.bridge._shutdown(); assert.equal(f.bridge.pendingStorageMaxCount, null);
  next._onPacket(storage(...limits)); next._onPacket(book()); next._onPacket(info(1));
  assert.equal(f.messages.length, count);
});

test('four requests forward exactly the selected book or recipe ID without local state mutation or acknowledgment', async () => {
  const f = fixture();
  f.game._onPacket(book()); f.messages.length = 0;
  await f.send({ op: 'recipeBookOpen', bookType: 0 });
  await f.send({ op: 'recipeBookOpen', bookType: 1 });
  await f.send({ op: 'recipeBookDestroy', recipeId: 701, index: 1 });
  await f.send({ op: 'recipeMakeInfo', recipeId: 701 });
  await f.send({ op: 'recipeMakeSelf', recipeId: 701 });
  assert.deepEqual(f.packets, [packet(0xac, 0), packet(0xac, 1), packet(0xad, 701),
    packet(0xae, 701), packet(0xaf, 701)]);
  assert.deepEqual(f.messages, []);
  f.game._onPacket(info(0));
  assert.deepEqual(f.messages, [{ op: 'recipeMakeInfo', recipeId: 701,
    bookType: 1, mp: 123, maxMp: 345, status: 0 }]);
});

test('missing, coerced, nonintegral and wrapped request fields cannot select recipes or books', async () => {
  const f = fixture();
  for (const bookType of [undefined, null, false, true, '0', '1', -1, 2, 0.5, 2 ** 32])
    await f.send({ op: 'recipeBookOpen', bookType });
  for (const op of ['recipeBookDestroy', 'recipeMakeInfo', 'recipeMakeSelf']) {
    for (const recipeId of [undefined, null, true, '701', 0, -1, 1.5, 0x80000000, 2 ** 32 + 701])
      await f.send({ op, recipeId, index: 1 });
  }
  assert.deepEqual(f.packets, []); assert.deepEqual(f.messages, []);
});

test('unentered, non-game and closed sessions send no recipe requests', async () => {
  const f = fixture(false);
  const sendAll = async () => {
    await f.send({ op: 'recipeBookOpen', bookType: 1 });
    for (const op of ['recipeBookDestroy', 'recipeMakeInfo', 'recipeMakeSelf'])
      await f.send({ op, recipeId: 701 });
  };
  await sendAll(); f.bridge.entered = true; f.game.state = 'AUTHED'; await sendAll();
  f.game.state = 'IN_GAME'; f.game.closed = true; await sendAll();
  f.game.closed = false; f.bridge.closed = true; await sendAll();
  assert.deepEqual(f.packets, []); assert.deepEqual(f.messages, []);
});
