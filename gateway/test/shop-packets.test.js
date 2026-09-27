'use strict';
// Elbera Tools: synthetic shop requests through the actual bridge/writers.
// No sockets, accounts, original assets or purchase/sale state changes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');
const { frame } = require('../src/l2io.js');

function fixture() {
  const ws = new EventEmitter(), packets = [], messages = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  bridge.game = game; bridge.entered = true; bridge._wireGame(game, {}, true);
  game.state = 'IN_GAME'; game._send = bytes => packets.push(bytes);
  const list = (id = 14) => game.emit('buyList', { listId: id, money: 1000, items: [] });
  const inventory = items => game.emit('itemList', items);
  return { bridge, game, packets, messages, list, inventory,
    send: message => bridge._onMessage(JSON.stringify(message)) };
}
function readRequest(bytes) {
  const sell = bytes[0] === 0x1e, count = bytes.readInt32LE(5), items = [];
  let offset = 9;
  for (let i = 0; i < count; i++) {
    const row = {};
    if (sell) { row.objectId = bytes.readInt32LE(offset); offset += 4; }
    row.itemId = bytes.readInt32LE(offset); row.count = bytes.readInt32LE(offset + 4);
    offset += 8; items.push(row);
  }
  assert.equal(offset, bytes.length, 'declared count consumes every request byte');
  return { opcode: bytes[0], listId: bytes.readInt32LE(1), items };
}

test('buy preserves source empty carts, repeated nonstack rows and exact DWORD limits', async () => {
  const f = fixture(); f.list();
  for (const items of [[], [{ itemId: 116, count: 1 }, { itemId: 116, count: 1 }],
    [{ itemId: 0x7fffffff, count: 0x7fffffff }]]) {
    await f.send({ op: 'buy', items });
    assert.deepEqual(readRequest(f.packets.at(-1)), { opcode: 0x1f, listId: 14, items });
  }
  assert.equal(f.packets.length, 3);
});

test('sell resolves exact object identity without trusting a browser template ID', async () => {
  const f = fixture(); f.inventory([{ objectId: 91, itemId: 116 }, { objectId: 92, itemId: 116 }]);
  await f.send({ op: 'sell', items: [{ objectId: 91, itemId: 999, count: 1 }, { objectId: 92, count: 1 }] });
  assert.deepEqual(readRequest(f.packets[0]), { opcode: 0x1e, listId: 0,
    items: [{ objectId: 91, itemId: 116, count: 1 }, { objectId: 92, itemId: 116, count: 1 }] });
  await f.send({ op: 'sell', items: [] });
  assert.deepEqual(readRequest(f.packets[1]), { opcode: 0x1e, listId: 0, items: [] });
});

test('a cart longer than the removed 50-row clamp is transmitted whole and in order', async () => {
  const f = fixture(); f.list();
  const items = Array.from({ length: 51 }, (_, i) => ({ itemId: 100 + i, count: 1 }));
  await f.send({ op: 'buy', items });
  assert.deepEqual(readRequest(f.packets[0]).items, items);
  const owned = items.map((it, i) => ({ ...it, objectId: 1000 + i }));
  f.inventory(owned); await f.send({ op: 'sell', items: owned });
  assert.deepEqual(readRequest(f.packets[1]).items, owned);
});

test('writers reject invalid values before emitting any partial or coerced request', () => {
  const f = fixture(), row = { objectId: 91, itemId: 116, count: 1 };
  const invalid = [undefined, null, false, '1', 0, -1, 1.5, NaN, Infinity, -Infinity,
    0x80000000, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER];
  for (const method of ['requestBuyItem', 'requestSellItem']) {
    for (const key of method === 'requestBuyItem' ? ['itemId', 'count'] : ['objectId', 'itemId', 'count']) {
      for (const value of invalid) f.game[method](14, [row, { ...row, [key]: value }]);
    }
    for (const items of [null, undefined, {}, 'items', [row, null], [row, false], [row, 'item'], new Array(1)])
      f.game[method](14, items);
    for (const id of [null, undefined, '14', -1, 1.5, NaN, Infinity, 0x80000000])
      f.game[method](id, [row]);
  }
  assert.deepEqual(f.packets, [], '4294967297 must not become a purchase of one');
});

test('invalid or unresolved bridge rows reject the entire selection instead of filtering', async () => {
  const f = fixture(); f.list(); f.inventory([{ objectId: 91, itemId: 116 }]);
  for (const row of [null, {}, { objectId: 92, count: 1 }, { objectId: '91', count: 1 },
    { objectId: 2 ** 32 + 91, count: 1 }, { objectId: 91, count: 2 ** 32 + 1 },
    { objectId: 91, count: 0 }]) {
    await f.send({ op: 'sell', items: [{ objectId: 91, count: 1 }, row] });
  }
  for (const row of [null, {}, { itemId: 116, count: '2' }, { itemId: 116, count: 2 ** 32 + 1 }])
    await f.send({ op: 'buy', items: [{ itemId: 116, count: 1 }, row] });
  assert.deepEqual(f.packets, []);
});

test('only the transport frame capacity bounds rows locally, with no partial oversized send', () => {
  const f = fixture(), row = { objectId: 91, itemId: 116, count: 1 };
  for (const [method, width] of [['requestBuyItem', 8], ['requestSellItem', 12]]) {
    const maximum = Math.floor((0xffff - 11) / width);
    const rows = Array.from({ length: maximum }, () => ({ ...row }));
    f.game[method](0, rows);
    const packet = f.packets.at(-1), framed = frame(packet);
    assert.equal(readRequest(packet).items.length, maximum);
    assert.equal(framed.length, 11 + maximum * width);
    assert.equal(framed.readUInt16LE(0), framed.length);
    const before = f.packets.length;
    f.game[method](0, [...rows, row]);
    assert.equal(f.packets.length, before, 'one oversized frame is rejected whole');
  }
});

test('shop requests require an entered active session and buying requires an observed list', async () => {
  const f = fixture(), buy = { op: 'buy', items: [{ itemId: 116, count: 1 }] };
  await f.send(buy); assert.deepEqual(f.packets, []);
  f.list(); f.inventory([{ objectId: 91, itemId: 116 }]);
  const sell = { op: 'sell', items: [{ objectId: 91, count: 1 }] };
  for (const [object, field, value] of [[f.bridge, 'entered', false], [f.game, 'state', 'AUTHED'],
    [f.game, 'closed', true], [f.bridge, 'closed', true]]) {
    const old = object[field]; object[field] = value;
    await f.send(buy); await f.send(sell); object[field] = old;
  }
  assert.deepEqual(f.packets, []);
});

test('replacement snapshots and retired sessions cannot supply stale shop identities', async () => {
  const f = fixture(); f.list(); f.inventory([{ objectId: 91, itemId: 116 }]);
  f.inventory([{ objectId: 92, itemId: 1060 }]);
  await f.send({ op: 'sell', items: [{ objectId: 91, count: 1 }] });
  assert.deepEqual(f.packets, []);
  const next = new GameSession(); next.state = 'IN_GAME'; next._send = bytes => f.packets.push(bytes);
  f.bridge.pendingItemList = [{ objectId: 91, itemId: 116 }];
  f.bridge.game = next; f.bridge._wireGame(next, {}, true);
  assert.equal(f.bridge.lastBuyListId, null); assert.equal(f.bridge.inventory.size, 0);
  assert.equal(f.bridge.pendingItemList, null);
  const messageCount = f.messages.length;
  f.list(); f.inventory([{ objectId: 91, itemId: 116 }]);
  f.game.emit('invUpdate', [{ objectId: 91, itemId: 116, change: 1 }]);
  f.game.emit('sellList', { money: 10, items: [] });
  assert.equal(f.messages.length, messageCount, 'retired list events never reach the browser');
  assert.equal(f.bridge.lastBuyListId, null); assert.equal(f.bridge.inventory.size, 0);
  await f.send({ op: 'buy', items: [{ itemId: 116, count: 1 }] });
  await f.send({ op: 'sell', items: [{ objectId: 92, count: 1 }] });
  assert.deepEqual(f.packets, []);
});
