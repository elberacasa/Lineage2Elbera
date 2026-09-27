'use strict';
// Elbera Tools: source-format synthetic packets; no sockets, accounts or assets.
// Original field positions are checked by check_appearance_native.py. The
// compatibility suffix is zeroed; these cases concern the required prefix.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');
const FORMATS = {
  user: 'dddddSddddQddddddddddddddddddddddddddddddddddddddddddddddddhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhddddddddddddddddddddffffddddSdddddcccddh',
  char: 'dddddSdddddddddddddddhhhhhhhhhhhhhhhhhhhhhhhhddddddddddddddffffdddSdddddccccccch',
};
const WIDTHS = { d: 4, h: 2, c: 1, Q: 8, f: 8 };
const keys = ['sex', 'hairStyle', 'hairColor', 'face'];
const appearance = row => Object.fromEntries(keys.map(key => [key, row[key]]));
function packet(kind, values, id = 42) {
  const format = FORMATS[kind], hair = kind === 'user' ? 117 : 63;
  const fields = { 4: id, 5: 'Synthetic 雪', 6: 0, 7: values.sex, 8: 0,
    [hair]: values.hairStyle, [hair + 1]: values.hairColor, [hair + 2]: values.face };
  fields[kind === 'user' ? 121 : 66] = 'Following title';
  const parts = [Buffer.from([kind === 'user' ? 4 : 3])], offsets = [];
  let double = 0, position = 1;
  [...format].forEach((type, index) => {
    offsets[index] = position;
    const bytes = type === 'S' ? Buffer.from((fields[index] || '') + '\0', 'utf16le') : Buffer.alloc(WIDTHS[type]);
    if (type === 'd' && fields[index] !== undefined) bytes.writeInt32LE(fields[index]);
    if (type === 'f') bytes.writeDoubleLE([1.125, 1.375, 9.75, 23.125][double++]);
    parts.push(bytes); position += bytes.length;
  });
  parts.push(Buffer.alloc(128));
  return { bytes: Buffer.concat(parts), appearanceEnd: offsets[hair + 2] + 4 };
}
function fixture() {
  const ws = new EventEmitter(), messages = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw)); ws.close = () => {};
  const bridge = new Bridge(ws, {}, () => {});
  function wire() {
    const game = new GameSession(); game.state = 'IN_GAME'; game.crypt.decrypt = () => {};
    bridge.game = game; bridge._wireGame(game, {}, true);
    game.on('parseError', error => errors.push(error));
    return game;
  }
  return { bridge, game: wire(), wire, messages, errors };
}

test('UserInfo current appearance overrides selection and every update preserves explicit zero', () => {
  const f = fixture(), selected = { charId: 42, name: 'Synthetic 雪', sex: 0, hairStyle: 4, hairColor: 3, face: 2 };
  f.bridge.chars = [selected];
  const snapshots = [
    { sex: 1, hairStyle: 6, hairColor: 2, face: 1 },
    { sex: 0, hairStyle: 0, hairColor: 0, face: 0 },
    { sex: 1, hairStyle: 3, hairColor: 1, face: 2 },
  ];
  const decoded = []; f.game.on('userInfo', row => decoded.push(row));
  snapshots.forEach(values => f.game._onPacket(packet('user', values).bytes));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(decoded.map(appearance), snapshots);
  assert.deepEqual(f.messages.filter(m => m.op === 'charSheet').map(appearance), snapshots);
  const entries = f.messages.filter(m => m.op === 'enterWorld');
  assert.equal(entries.length, 1); assert.deepEqual(appearance(entries[0].char), snapshots[0]);
  assert.equal(entries[0].char.name, 'Synthetic 雪');
  assert.deepEqual(f.bridge.chars, [selected], 'selection snapshot is not rewritten as current state');
  assert.equal(decoded[2].collisionHeight, 23.125);
  assert.equal(decoded[2].operateType, 0, 'following title and flags remain aligned');
});

test('CharInfo repeated snapshots carry all appearance fields without creation-range coercion', () => {
  const f = fixture(), snapshots = [
    { sex: 1, hairStyle: 6, hairColor: 3, face: 2 },
    { sex: 0, hairStyle: 0, hairColor: 0, face: 0 },
    // Transport preserves raw values; visual support is a separate browser decision.
    { sex: 9, hairStyle: -1, hairColor: 0x7fffffff, face: -2147483648 },
  ];
  const decoded = []; f.game.on('charInfo', row => decoded.push(row));
  snapshots.forEach(values => f.game._onPacket(packet('char', values, 91).bytes));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(decoded.map(appearance), snapshots);
  assert.deepEqual(f.messages.filter(m => m.op === 'addPlayer').map(appearance), snapshots);
  assert.ok(decoded.every(row => row.name === 'Synthetic 雪' && row.collisionRadius === 9.75 && row.waitType === 0));
});

test('truncated appearance prefixes never publish a partial player or synthesize missing fields', () => {
  for (const kind of ['user', 'char']) {
    const f = fixture(), data = packet(kind, { sex: 1, hairStyle: 6, hairColor: 3, face: 2 });
    for (let length = 1; length < data.appearanceEnd; length++) f.game._onPacket(data.bytes.subarray(0, length));
    assert.equal(f.errors.length, data.appearanceEnd - 1);
    assert.deepEqual(f.messages, []);
    assert.equal(f.bridge.entered, false);
  }
});

test('retired and closed games cannot replace current self or remote appearance', () => {
  const f = fixture(), old = f.game, current = f.wire();
  const first = { sex: 1, hairStyle: 2, hairColor: 3, face: 1 };
  current._onPacket(packet('user', first).bytes);
  current._onPacket(packet('char', first, 91).bytes);
  const count = f.messages.length, selfInfo = f.bridge.selfInfo;
  const stale = { sex: 0, hairStyle: 4, hairColor: 0, face: 2 };
  old._onPacket(packet('user', stale).bytes); old._onPacket(packet('char', stale, 92).bytes);
  assert.equal(f.messages.length, count); assert.equal(f.bridge.selfInfo, selfInfo);
  assert.equal(f.bridge.playersByName.has(92), false);
  f.bridge._shutdown();
  const closedCount = f.messages.length;
  current._onPacket(packet('user', stale).bytes); current._onPacket(packet('char', stale, 93).bytes);
  assert.equal(f.messages.length, closedCount); assert.equal(f.bridge.playersByName.has(93), false);
  assert.deepEqual(f.errors, []);
});

test('bridge alone does not mask absent appearance with a selection snapshot or zeros', () => {
  const f = fixture();
  f.bridge.chars = [{ charId: 42, name: 'Synthetic', sex: 1, hairStyle: 6, hairColor: 3, face: 2 }];
  f.game.emit('userInfo', { id: 42, name: 'Synthetic' });
  const entry = f.messages.find(m => m.op === 'enterWorld').char;
  const sheet = f.messages.find(m => m.op === 'charSheet');
  for (const key of keys) {
    assert.equal(Object.hasOwn(entry, key), false);
    assert.equal(Object.hasOwn(sheet, key), false);
  }
});
