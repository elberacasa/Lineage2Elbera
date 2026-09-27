'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSession } = require('../src/gameclient.js');
const { Bridge } = require('../src/bridge.js');

// Original Engine.dll's packet-reader format strings, independently checked
// by tools/ui/check_picking_native.py. Synthetic fields, no captured accounts
// or proprietary asset data. `f` is the original eight-byte wire double.
const formats = {
  npc: 'ddddddddddddddddddffffdddcccccSSddd',
  char: 'dddddSdddddddddddddddhhhhhhhhhhhhhhhhhhhhhhhhddddddddddddddffffdddSdddddccccccch',
  user: 'dddddSddddQddddddddddddddddddddddddddddddddddddddddddddddddhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhddddddddddddddddddddffffddddSdddddcccddh',
};

test('UserInfo preserves the native crystallize capability byte without inferring a class', () => {
  const width = { d: 4, h: 2, c: 1, Q: 8, f: 8, S: 2 };
  assert.equal(formats.user[129], 'c');
  const offset = 1 + [...formats.user.slice(0, 129)].reduce((n, type) => n + width[type], 0);
  for (const ability of [0, 1, 7]) {
    const ws = new EventEmitter(), messages = [];
    ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
    const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
    bridge.game = game; bridge.selfId = -1; bridge._wireGame(game, {}, true);
    game.state = 'IN_GAME';
    let decoded; game.on('userInfo', record => { decoded = record; });
    const bytes = packet(0x04, formats.user);
    bytes[offset - 1] = 2; bytes[offset] = ability;
    game._onPacket(bytes);
    const sheet = messages.find(m => m.op === 'charSheet');
    assert.ok(sheet);
    assert.equal(sheet.crystallizeAbility, ability);
    assert.equal(decoded.operateType, 2);
  }
});
function packet(op, format, dead = false) {
  const parts = [Buffer.from([op])];
  let double = 0, byte = 0;
  for (const type of format) {
    const size = { d: 4, h: 2, c: 1, Q: 8, f: 8, S: 2 }[type];
    const bytes = Buffer.alloc(size);
    if (type === 'f') bytes.writeDoubleLE([1.125, 1.375, 9.75, 23.125][double++]);
    if (type === 'c' && ++byte === 4 && dead) bytes[0] = 1;
    parts.push(bytes);
  }
  // Formats end at the parsed prefix, and this zeroed synthetic suffix
  // includes additional fields consumed by the bridge's current protocol.
  parts.push(Buffer.alloc(128));
  return Buffer.concat(parts);
}

for (const [kind, op, event, browserOp] of [
  ['npc', 0x16, 'npcInfo', 'addNpc'], ['char', 0x03, 'charInfo', 'addPlayer'],
  ['user', 0x04, 'userInfo', 'charSheet'],
]) {
  test(`${kind} preserves distinct original collision doubles through decode and bridge`, () => {
    const ws = new EventEmitter(), messages = [];
    ws.readyState = 1;
    ws.send = raw => messages.push(JSON.parse(raw));
    const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
    bridge.game = game;
    bridge.selfId = -1;
    bridge._wireGame(game, {}, true);
    game.state = 'IN_GAME';
    const errors = [], decoded = [];
    game.on('parseError', error => errors.push(error));
    game.on(event, record => decoded.push(record));
    game._onPacket(packet(op, formats[kind], kind !== 'user'));
    assert.deepEqual(errors, []);
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].collisionRadius, 9.75);
    assert.equal(decoded[0].collisionHeight, 23.125);
    assert.equal(decoded[0].speedMul, 1.125);
    assert.equal(decoded[0].atkSpdMul, 1.375);
    const msg = messages.find(record => record.op === browserOp);
    assert.ok(msg);
    assert.equal(msg.collisionRadius, 9.75);
    assert.equal(msg.collisionHeight, 23.125);
    if (kind !== 'user') {
      assert.equal(decoded[0].dead, true);
      assert.equal(msg.dead, true, 'initial corpse eligibility survives the bridge');
    }
  });
}

test('CharInfo preserves sex and the original wait-state byte through the bridge',()=>{
  for(const sex of [0,1])for(const waitType of [0,1]){
    const ws=new EventEmitter(),messages=[];ws.readyState=1;ws.send=raw=>messages.push(JSON.parse(raw));
    const bridge=new Bridge(ws,{},()=>{}),game=new GameSession();
    bridge.game=game;bridge.selfId=-1;bridge._wireGame(game,{},true);game.state='IN_GAME';
    const data=packet(0x03,formats.char),errors=[];
    game.on('parseError',error=>errors.push(error));
    // Five initial D fields, empty UTF-16 name, then race and sex.
    data.writeInt32LE(sex,1+5*4+2+4);
    let offset=1;
    for(const kind of formats.char){
      if(kind==='c'){data[offset]=waitType;break;}
      offset+={d:4,h:2,c:1,Q:8,f:8,S:2}[kind];
    }
    game._onPacket(data);
    assert.deepEqual(errors,[]);
    const message=messages.find(m=>m.op==='addPlayer');assert.ok(message);
    assert.equal(message.sex,sex);assert.equal(message.waitType,waitType);
  }
});

test('NpcInfo preserves original wait/combat bytes and all three equipment fields, including explicit zero', () => {
  const widths = { d: 4, h: 2, c: 1, Q: 8, f: 8, S: 2 };
  const offset = field => 1 + [...formats.npc.slice(0, field)].reduce((n, type) => n + widths[type], 0);
  assert.equal(formats.npc[27], 'c'); // nameAbove, running, combat
  for (const combat of [0, 1, 7]) for (const waitType of [0, 1, 4]) {
    const ws = new EventEmitter(), messages = [];
    ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
    const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
    bridge.game = game; bridge._wireGame(game, {}, true); game.state = 'IN_GAME';
    game.crypt.decrypt = () => {}; // Already-decrypted synthetic wire bodies.
    const errors = []; game.on('parseError', error => errors.push(error));
    let decoded; game.on('npcInfo', record => { decoded = record; });
    for (const equipment of [[101, 202, 303], [0, 0, 0]]) {
      const bytes = packet(0x16, formats.npc);
      equipment.forEach((item, index) => bytes.writeInt32LE(item, offset(22 + index)));
      bytes[offset(25)] = waitType;
      bytes[offset(27)] = combat;
      game._onPacket(bytes);
      const message = messages.filter(row => row.op === 'addNpc').at(-1);
      assert.ok(message);
      for (const row of [decoded, message]) {
        assert.equal(row.combat, combat, 'raw byte, not an inferred stance');
        assert.equal(row.waitType, waitType, 'original first byte remains independent of combat');
        assert.deepEqual([row.rhand, row.chest, row.lhand], equipment);
        assert.equal(row.speedMul, 1.125, 'source rate input remains separate');
      }
    }
    assert.deepEqual(errors, []);
  }
});

// Independent field-by-field fixture for the original NpcInfo prefix and
// second dddddccffdd reader. Nonempty strings exercise the tail boundary.
function npcRawFixture(summonAnimationRaw, tail) {
  const chunks = [Buffer.from([0x16])];
  const d = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); chunks.push(b); };
  const f = value => { const b = Buffer.alloc(8); b.writeDoubleLE(value); chunks.push(b); };
  [17, 1000009, 1, -7, 8, -9, 10, 0, 11, 12,
    13, 14, 15, 16, 17, 18, 19, 20].forEach(d);
  [1.25, 1.5, 12.75, 28.125].forEach(f);
  [21, 22, 23].forEach(d);
  chunks.push(Buffer.from([1, 0, 7, 0, summonAnimationRaw]));
  chunks.push(Buffer.from('Source NPC\0Title\0', 'utf16le'));
  const prefix = Buffer.concat(chunks);
  chunks.length = 0;
  tail.prefix.forEach(d);
  tail.extension.dwords.forEach(d);
  chunks.push(Buffer.from(tail.extension.bytes));
  tail.extension.doubles.forEach(f);
  tail.extension.finalDwords.forEach(d);
  return { prefix, tail: Buffer.concat(chunks) };
}

function npcWireHarness() {
  const ws = new EventEmitter(), messages = [], decoded = [], errors = [];
  ws.readyState = 1; ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  bridge.game = game; bridge._wireGame(game, {}, true); game.state = 'IN_GAME';
  game.crypt.decrypt = () => {};
  game.on('npcInfo', row => decoded.push(row));
  game.on('parseError', error => errors.push(error));
  return { bridge, game, decoded, messages, errors };
}

test('NpcInfo retains the creation byte and complete raw extension without guessing neutral effect values', () => {
  const values = [
    { prefix: [1, -2, 3], extension: { dwords: [-2147483648, 2147483647, -1, 7, 0],
      bytes: [128, 255], doubles: [-3.5, 28.125], finalDwords: [-2147483648, 1] } },
    { prefix: [0, 0, 0], extension: { dwords: [0, 0, 0, 0, 0],
      bytes: [0, 0], doubles: [0, 0], finalDwords: [0, 0] } },
  ];
  for (const summon of [0, 2, 255]) for (const expected of values) {
    const h = npcWireHarness(), fixture = npcRawFixture(summon, expected);
    assert.equal(fixture.tail.length, 58);
    h.game._onPacket(Buffer.concat([fixture.prefix, fixture.tail]));
    assert.deepEqual(h.errors, []); assert.equal(h.decoded.length, 1);
    for (const row of [h.decoded[0], h.messages.find(message => message.op === 'addNpc')]) {
      assert.equal(row.summonAnimationRaw, summon);
      assert.deepEqual(row.npcInfoTail, expected);
      assert.equal(row.name, 'Source NPC');
      assert.equal(row.npcId, 9);
    }
  }
});

test('every incomplete NpcInfo tail remains absent, including a complete three-word prefix', () => {
  const expected = { prefix: [1, 2, 3], extension: { dwords: [4, 5, 6, 7, 8],
    bytes: [9, 10], doubles: [11.25, 12.5], finalDwords: [13, 14] } };
  const fixture = npcRawFixture(2, expected), h = npcWireHarness();
  for (let length = 0; length < fixture.tail.length; length++) {
    h.game._onPacket(Buffer.concat([fixture.prefix, fixture.tail.subarray(0, length)]));
    for (const row of [h.decoded.at(-1), h.messages.filter(message => message.op === 'addNpc').at(-1)]) {
      assert.equal(row.summonAnimationRaw, 2);
      assert.equal(Object.hasOwn(row, 'npcInfoTail'), false, `tail length ${length}`);
    }
  }
  assert.deepEqual(h.errors, []); assert.equal(h.decoded.length, 58);
});

test('complete NpcInfo tails cannot silently convert non-finite wire doubles to JSON null', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const h = npcWireHarness(), fixture = npcRawFixture(2, { prefix: [0, 0, 0],
      extension: { dwords: [0, 0, 0, 0, 0], bytes: [0, 0], doubles: [value, 1], finalDwords: [0, 0] } });
    h.game._onPacket(Buffer.concat([fixture.prefix, fixture.tail]));
    assert.equal(h.errors.length, 1); assert.match(h.errors[0].error.message, /non-finite wire double/);
    assert.equal(h.decoded.length, 0); assert.equal(h.messages.some(row => row.op === 'addNpc'), false);
  }
});

test('NpcInfo from replaced or closed game sessions cannot publish actors or alter attack state', () => {
  const h = npcWireHarness(), tail = { prefix: [0, 0, 0],
    extension: { dwords: [0, 0, 0, 0, 0], bytes: [0, 0], doubles: [12, 28], finalDwords: [0, 0] } };
  const fixture = npcRawFixture(2, tail), body = Buffer.concat([fixture.prefix, fixture.tail]);
  h.game._onPacket(body);
  assert.equal(h.messages.filter(row => row.op === 'addNpc').length, 1);
  assert.deepEqual(h.bridge.atkById.get(17), { pAtkSpd: 12, rhand: 21 });
  const replacement = new GameSession(); replacement.state = 'IN_GAME'; replacement.crypt.decrypt = () => {};
  h.bridge.game = replacement; h.bridge._wireGame(replacement, {}, true);
  const stale = Buffer.from(body); stale.writeInt32LE(999, 1 + 9 * 4);
  h.game._onPacket(stale);
  assert.equal(h.decoded.length, 2, 'late old packet was actually decoded and emitted');
  assert.equal(h.messages.filter(row => row.op === 'addNpc').length, 1);
  assert.deepEqual(h.bridge.atkById.get(17), { pAtkSpd: 12, rhand: 21 });
  const active = Buffer.from(body); active.writeInt32LE(600, 1 + 9 * 4);
  replacement._onPacket(active);
  assert.equal(h.messages.filter(row => row.op === 'addNpc').length, 2);
  assert.equal(h.messages.at(-1).pAtkSpd, 600);
  assert.deepEqual(h.bridge.atkById.get(17), { pAtkSpd: 600, rhand: 21 });
  h.bridge.closed = true;
  replacement._onPacket(stale);
  const differentId = Buffer.from(stale); differentId.writeInt32LE(18, 1);
  replacement._onPacket(differentId);
  assert.equal(h.messages.filter(row => row.op === 'addNpc').length, 2);
  assert.deepEqual(h.bridge.atkById.get(17), { pAtkSpd: 600, rhand: 21 });
  assert.equal(h.bridge.atkById.has(18), false);
  assert.deepEqual(h.errors, []);
});

test('ChangeWaitType keeps original signed coordinates, including repeated state updates',()=>{
  const ws=new EventEmitter(),messages=[];ws.readyState=1;ws.send=raw=>messages.push(JSON.parse(raw));
  const bridge=new Bridge(ws,{},()=>{}),game=new GameSession();
  bridge.game=game;bridge.selfId=-1;bridge._wireGame(game,{},true);game.state='IN_GAME';
  game.crypt.decrypt=()=>{}; // This fixture supplies already-decrypted wire bodies.
  const errors=[];game.on('parseError',error=>errors.push(error));
  for(const z of [-1234,-1250]) {
    const data=Buffer.alloc(21);data[0]=0x2f;
    [123,0,-4567,8901,z].forEach((value,i)=>data.writeInt32LE(value,1+i*4));game._onPacket(data);
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(messages.filter(m=>m.op==='changeWait'),[-1234,-1250].map(z=>({
    op:'changeWait',id:123,waitType:0,x:-4567,y:8901,z})));
});

test('UserInfo preserves all equipped object identities independently of template item IDs', () => {
  const ws = new EventEmitter(), messages = []; ws.readyState = 1;
  ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  bridge.game = game; bridge.selfId = -1; bridge._wireGame(game, {}, true); game.state = 'IN_GAME';
  const data = packet(0x04, formats.user), errors = [];
  game.on('parseError', e => errors.push(e));
  // UserInfo prefix: 5D, empty S, 4D, Q, 14D, then 17 object IDs + 17 template IDs.
  const start = 1 + 5 * 4 + 2 + 4 * 4 + 8 + 14 * 4;
  for (let i = 0; i < 17; i++) {
    data.writeInt32LE(1001 + i, start + i * 4);
    data.writeInt32LE(2001 + i, start + (17 + i) * 4);
  }
  game._onPacket(data);
  assert.deepEqual(errors, []);
  const sheet = messages.find(m => m.op === 'charSheet');
  assert.deepEqual(sheet.paperdollObjectIds, {
    hairall: 1001, rear: 1002, lear: 1003, neck: 1004, rfinger: 1005, lfinger: 1006,
    head: 1007, rhand: 1008, lhand: 1009, gloves: 1010, chest: 1011, legs: 1012,
    feet: 1013, cloak: 1014, rhand2: 1015, hair: 1016, face: 1017,
  });
  assert.equal(sheet.paperdoll.rhand, 2008, 'render mesh identity remains a template item ID');
  assert.equal(sheet.collisionRadius, 9.75, 'later fields remain aligned');
});

test('charSheet uses current UserInfo class rather than its base-class appearance header', () => {
  const ws = new EventEmitter(), messages = []; ws.readyState = 1;
  ws.send = raw => messages.push(JSON.parse(raw));
  const bridge = new Bridge(ws, {}, () => {}), game = new GameSession();
  bridge.game = game; bridge._wireGame(game, {}, true); game.state = 'IN_GAME';
  game.crypt.decrypt = () => {}; // Already-decrypted synthetic snapshots.
  const errors = [], decoded = [];
  game.on('parseError', e => errors.push(e)); game.on('userInfo', row => decoded.push(row));
  const widths = { d: 4, h: 2, c: 1, Q: 8, f: 8, S: 2 };
  const prefixBytes = 1 + [...formats.user].reduce((total, kind) => total + widths[kind], 0);
  // Original-format prefix ends at cubic count H (zero in this fixture).
  // Installed UserInfo.java then writes c,d,c,d,h,h,d,h before current class D.
  const currentOffset = prefixBytes + 1 + 4 + 1 + 4 + 2 + 2 + 4 + 2;
  for (const currentClass of [88, 0]) {
    const bytes = packet(0x04, formats.user);
    bytes.writeInt32LE(94, 1 + 5 * 4 + 2 + 2 * 4); // base-class appearance
    bytes.writeInt32LE(currentClass, currentOffset);
    bytes.writeInt32LE(1234, currentOffset + 8); bytes.writeInt32LE(567, currentOffset + 12);
    game._onPacket(bytes);
    assert.equal(decoded.at(-1).classId, 94);
    assert.equal(decoded.at(-1).currentClassId, currentClass);
    assert.equal(messages.filter(row => row.op === 'charSheet').at(-1).classId, currentClass);
    assert.equal(decoded.at(-1).maxCp, 1234); assert.equal(decoded.at(-1).cp, 567);
  }
  assert.deepEqual(errors, []);
  assert.equal(messages.filter(row => row.op === 'enterWorld').length, 1);
});
