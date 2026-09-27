'use strict';
// Elbera Tools: synthetic Interlude clan packets; no sockets/accounts/database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

function wire(op, values) {
  return Buffer.concat([Buffer.from([op]), ...values.map(value => {
    if (typeof value === 'string') return Buffer.from(`${value}\0`, 'utf16le');
    const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes;
  })]);
}
function full(reputation, clanId = 101, pledgeType = 0, members = [
  ['First', 41, 2, 1, 3, 12345, 1], ['Second', 42, 3, 0, 4, 0, 0],
], count = members.length) {
  return wire(0x53, [pledgeType ? 1 : 0, clanId, pledgeType, 'Source Clan', 'Leader',
    202, 5, 303, 404, 505, reputation, 606, 707, 808, 'Source Ally', 909, 1, count,
    ...members.flat()]);
}
function update(reputation, clanId = 101) {
  return wire(0x88, [clanId, 212, 6, 313, 414, 515, reputation, 616, 717,
    818, 'Changed Ally', 919, 0]);
}
function fixture(entered = true) {
  const ws = new EventEmitter(), messages = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  game.crypt.decrypt = () => {}; // fixtures are already decrypted wire bodies
  bridge.game = game; bridge.entered = entered;
  bridge._wireGame(game, {}, true); game.state = 'IN_GAME';
  game.on('parseError', error => errors.push(error));
  return { game, bridge, messages, errors };
}

test('full clan packet preserves signed reputation and following alliance/member fields', () => {
  const f = fixture();
  f.game._onPacket(full(-123456));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.messages, [
    { op: 'clanInfo', id: 101, name: 'Source Clan', leaderName: 'Leader', level: 5,
      reputation: -123456, crestId: 202, allyId: 808, allyName: 'Source Ally' },
    { op: 'clanMembers', members: [
      { id: 12345, name: 'First', level: 41, classId: 2, online: true },
      { id: 0, name: 'Second', level: 42, classId: 3, online: false },
    ] },
  ]);
});

test('info update replaces reputation without losing clan identity or member snapshot', () => {
  const f = fixture(); f.game._onPacket(full(500));
  const members = [...f.bridge.clanMembers.values()]; f.messages.length = 0;
  f.game._onPacket(update(0));
  assert.deepEqual(f.messages, [{ op: 'clanInfo', id: 101, name: 'Source Clan', leaderName: 'Leader',
    level: 6, reputation: 0, crestId: 212, allyId: 818, allyName: 'Changed Ally' }]);
  assert.deepEqual([...f.bridge.clanMembers.values()], members);
  assert.deepEqual(f.errors, []);
});

test('foreign updates and subpledges cannot overwrite the main clan reputation', () => {
  const f = fixture(); f.game._onPacket(full(99)); f.messages.length = 0;
  f.game._onPacket(update(999, 777)); f.game._onPacket(full(888, 101, 100));
  assert.equal(f.bridge.clan.reputation, 99); assert.deepEqual(f.messages, []);
});

test('login queue retains latest reputation; independent sessions and leave clear it', () => {
  const a = fixture(false), b = fixture();
  a.game._onPacket(full(123)); a.game._onPacket(update(-4));
  assert.deepEqual(a.messages, []); assert.equal(a.bridge.pendingClanInfo.reputation, -4);
  assert.equal(b.bridge.clan, null); assert.equal(b.bridge.pendingClanInfo, null);
  b.game._onPacket(update(777)); assert.deepEqual(b.messages, []);
  a.game._onPacket(wire(0x82, []));
  assert.equal(a.bridge.clan, null); assert.deepEqual(a.bridge.pendingClanInfo, { op: 'clanInfo', id: 0 });
  a.game._onPacket(update(456));
  assert.deepEqual(a.bridge.pendingClanInfo, { op: 'clanInfo', id: 0 });
});

test('truncated clan packets never replace an existing reputation with partial data', () => {
  const f = fixture(); f.game._onPacket(full(123)); f.messages.length = 0;
  f.game._onPacket(full(456).subarray(0, -4)); f.game._onPacket(update(789).subarray(0, -4));
  assert.equal(f.errors.length, 2); assert.equal(f.bridge.clan.reputation, 123);
  assert.deepEqual(f.messages, []);
});

test('invalid member counts and trailing bytes cannot publish partial clan snapshots', () => {
  const malformed = [
    full(999, 101, 0, [], -1), full(999, 101, 0, [], 0x7fffffff),
    full(999, 101, 0, [], 1),
    full(999, 101, 0, [['Ignored', 41, 2, 1, 3, 12345, 1]], 0),
    Buffer.concat([full(999), Buffer.from([0])]),
    Buffer.concat([update(999), Buffer.from([0])]),
  ];
  for (const bytes of malformed) {
    const f = fixture(); f.game._onPacket(full(123)); f.messages.length = 0;
    const prior = f.bridge.clan, members = f.bridge.clanMembers;
    f.game._onPacket(bytes);
    assert.equal(f.errors.length, 1); assert.deepEqual(f.messages, []);
    assert.equal(f.bridge.clan, prior); assert.equal(f.bridge.clanMembers, members);
  }
});

test('an empty full member list is valid and still carries its reputation', () => {
  const f = fixture(); f.game._onPacket(full(0, 101, 0, []));
  assert.deepEqual(f.errors, []); assert.equal(f.bridge.clan.reputation, 0);
  assert.deepEqual(f.messages.at(-1), { op: 'clanMembers', members: [] });
});
