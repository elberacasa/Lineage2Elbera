// Portable synthetic tests: no private files, network, account or database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaySession, readIdentity, htmlBypasses } from './session.mjs';

function fixture(options = {}) {
  const sent = [], emitted = []; let clock = 0, closes = 0;
  const session = new PlaySession({ character: 'ExistingHero', send: m => sent.push(m),
    emit: (type, data) => emitted.push({ type, data }), close: () => closes++,
    actionIds: new Set([0, 1, 12]), nav: {}, now: () => clock,
    sleep: async ms => { clock += ms; }, ...options });
  return { session, sent, emitted, closes: () => closes };
}
function enter(f) {
  f.session.begin({ deviceId: 'synthetic-existing-identity' });
  f.session.accept({ op: 'auth_ok', chars: [{ name: 'OtherHero', slot: 0 }, { name: 'ExistingHero', slot: 2 }] });
  f.session.accept({ op: 'enterWorld', char: { id: 1, name: 'ExistingHero', x: 0, y: 0, z: 0 } });
  f.session.accept({ op: 'addNpc', id: 7, npcId: 100, x: 100, y: 0, z: 0 });
  f.session.accept({ op: 'charSheet', running: true, runSpeed: 100, walkSpeed: 50, speedMul: 1 });
  return f;
}

test('explicit identity and exact character selection never generate an identity or request creation', () => {
  assert.throws(() => readIdentity({}), /existing deviceId/);
  const f = enter(fixture());
  assert.deepEqual(f.sent.slice(0, 2), [
    { op: 'login', deviceId: 'synthetic-existing-identity', noAutoCreate: true }, { op: 'enterChar', slot: 2 },
  ]);
  assert.ok(!JSON.stringify(f.emitted).includes('synthetic-existing-identity'));
  const absent = fixture(); absent.session.begin({ deviceId: 'synthetic' });
  absent.session.accept({ op: 'auth_ok', chars: [] });
  assert.equal(absent.closes(), 1);
  assert.deepEqual(absent.sent.map(m => m.op), ['login']);
});

test('unexpected world identity closes; move destinations never become observed positions', () => {
  const f = enter(fixture());
  f.session.accept({ op: 'move', id: 1, x: 3, y: 4, z: 5, tx: 1000, ty: 2000, tz: 3000 });
  assert.deepEqual(f.session.state.pos, { x: 3, y: 4, z: 5 });
  f.session.accept({ op: 'enterWorld', char: { id: 2, name: 'OtherHero', x: 0, y: 0, z: 0 } });
  assert.equal(f.session.closed, true);
});

test('move-to-pawn keeps the actual origin and records pursuit without claiming arrival', () => {
  const f = enter(fixture());
  const m = { op: 'moveToPawn', id: 1, targetId: 7, distance: 30, x: 3, y: 4, z: 5 };
  f.session.accept(m);
  assert.deepEqual(f.session.state.pos, { x: 3, y: 4, z: 5 });
  assert.equal(f.session.state.positionUpdates, 1);
  assert.deepEqual(f.emitted.at(-1), { type: 'server', data: m });
  f.session.accept({ ...m, id: 7, targetId: 1, x: 90 });
  assert.equal(f.session.state.npcs.get(7).x, 90);
  assert.equal(f.session.state.pos.x, 3);
});

test('quest feedback is recorded only in the entered session and never replayed from entry', () => {
  const f = fixture();
  f.session.begin({ deviceId: 'synthetic' });
  f.session.accept({ op: 'auth_ok', chars: [{ name: 'ExistingHero', slot: 2 }] });
  const sound = { op: 'playSound', soundType: 0, sound: 'ItemSound.quest_finish', objectFlag: 0,
    objectId: 0, x: 0, y: 0, z: 0, delay: 0 };
  const mark = { op: 'questMark', questId: 1 };
  f.session.accept(sound); f.session.accept(mark);
  assert.equal(f.session.entryEvents.length, 0);
  f.session.accept({ op: 'enterWorld', char: { id: 1, name: 'ExistingHero', x: 0, y: 0, z: 0 } });
  f.session.accept(sound); f.session.accept(mark);
  assert.deepEqual(f.emitted.slice(-2), [{ type: 'server', data: sound }, { type: 'server', data: mark }]);
  f.session.stop();
  const count = f.emitted.length;
  f.session.accept(sound); f.session.accept(mark);
  assert.equal(f.emitted.length, count);
});

test('actual entry events are applied in order only after the exact requested character enters', () => {
  const f = fixture();
  f.session.begin({ deviceId: 'synthetic' });
  f.session.accept({ op: 'addNpc', id: 99 }); // Unselected account: never retained.
  f.session.accept({ op: 'auth_ok', chars: [{ name: 'ExistingHero', slot: 2 }] });
  f.session.accept({ op: 'addNpc', id: 7, x: 10, y: 20, z: 30 });
  f.session.accept({ op: 'move', id: 7, x: 40, y: 50, z: 60, tx: 100, ty: 100, tz: 100 });
  f.session.accept({ op: 'addNpc', id: 8, x: 1, y: 2, z: 3 });
  f.session.accept({ op: 'remove', id: 8 });
  assert.equal(f.session.state.npcs.size, 0);
  f.session.accept({ op: 'enterWorld', char: { id: 1, name: 'ExistingHero', x: 0, y: 0, z: 0 } });
  assert.deepEqual([...f.session.state.npcs.keys()], [7]);
  assert.deepEqual(f.session.state.npcs.get(7), { op: 'addNpc', id: 7, x: 40, y: 50, z: 60 });
  assert.equal(f.session.entryEvents.length, 0);
});

test('entry event queue is discarded on identity mismatch and stops instead of silently overflowing', () => {
  for (const mode of ['mismatch', 'overflow']) {
    const f = fixture();
    f.session.begin({ deviceId: 'synthetic' });
    f.session.accept({ op: 'auth_ok', chars: [{ name: 'ExistingHero', slot: 0 }] });
    f.session.accept({ op: 'addNpc', id: 7, x: 10, y: 20, z: 30 });
    if (mode === 'mismatch') f.session.accept({ op: 'enterWorld', char: { id: 1, name: 'OtherHero', x: 0, y: 0, z: 0 } });
    else for (let i = 0; i < 2048; i++) f.session.accept({ op: 'addNpc', id: i + 1 });
    assert.equal(f.session.closed, true);
    assert.equal(f.session.entryEvents.length, 0);
    assert.equal(f.session.state.npcs.size, 0);
  }
});

test('targets must be visible; removed/dead NPCs cannot be attacked and commands drop arbitrary fields', async () => {
  const f = enter(fixture());
  await assert.rejects(f.session.command({ op: 'attack', id: 999 }), /not currently visible/);
  await f.session.command({ op: 'attack', id: 7, arbitrary: 'never-forward-this' });
  assert.deepEqual(f.sent.at(-1), { op: 'attack', id: 7 });
  f.session.accept({ op: 'die', id: 7 });
  await assert.rejects(f.session.command({ op: 'attack', id: 7 }), /dead/);
  f.session.accept({ op: 'addNpc', id: 7, npcId: 100, x: 100, y: 0, z: 0, dead: true });
  await assert.rejects(f.session.command({ op: 'talk', id: 7 }), /live NPC/);
  f.session.accept({ op: 'revive', id: 7 });
  await f.session.command({ op: 'attack', id: 7 });
  f.session.accept({ op: 'remove', id: 7 });
  await assert.rejects(f.session.command({ op: 'target', id: 7 }), /not currently visible/);
  await assert.rejects(f.session.command({ op: 'createChar' }), /Unsupported/);
});

test('only current server-granted enabled active skills are sent', async () => {
  const f = enter(fixture());
  await assert.rejects(f.session.command({ op: 'useSkill', skillId: 3 }), /not currently granted/);
  f.session.accept({ op: 'skillList', skills: [{ id: 3, level: 3, passive: false, disabled: false },
    { id: 141, level: 1, passive: true }, { id: 16, level: 1, passive: false, disabled: true }] });
  await f.session.command({ op: 'useSkill', skillId: 3, targetId: 7 });
  assert.deepEqual(f.sent.at(-1), { op: 'useSkill', skillId: 3, targetId: 7 });
  f.session.accept({ op: 'addNpc', id: 7, npcId: 100, x: 100, y: 0, z: 0, dead: true });
  await assert.rejects(f.session.command({ op: 'useSkill', skillId: 3, targetId: 7 }), /live object/);
  for (const id of [141, 16]) await assert.rejects(f.session.command({ op: 'useSkill', skillId: id }));
  f.session.accept({ op: 'skillList', skills: [] });
  await assert.rejects(f.session.command({ op: 'useSkill', skillId: 3 }));
});

test('bypass uses an index from the actual latest HTML, and talk requires a unique visible NPC', async () => {
  const f = enter(fixture());
  assert.deepEqual(htmlBypasses('<a action="bypass -h npc_7_Test?a=1&amp;b=2">Go</a><a action="link x.htm">Next</a>'),
    ['npc_7_Test?a=1&b=2']);
  f.session.accept({ op: 'npcHtml', html: '<a action="bypass -h npc_7_SkillList">Learn</a>' });
  await f.session.command({ op: 'bypass', index: 0, command: 'invented' });
  assert.deepEqual(f.sent.at(-1), { op: 'bypass', command: 'npc_7_SkillList' });
  await assert.rejects(f.session.command({ op: 'bypass', index: 1 }));
  f.session.accept({ op: 'npcHtml', html: 'No links' });
  await assert.rejects(f.session.command({ op: 'bypass', index: 0 }));
  await f.session.command({ op: 'talk', npcId: 100 });
  f.session.accept({ op: 'addNpc', id: 8, npcId: 100, x: 5, y: 0, z: 0 });
  await assert.rejects(f.session.command({ op: 'talk', npcId: 100 }), /one currently visible/);
});

test('actions are restricted to IDs from the supplied source catalog', async () => {
  const f = enter(fixture());
  await f.session.command({ op: 'action', actionId: 0 });
  assert.deepEqual(f.sent.at(-1), { op: 'action', actionId: 0 });
  await assert.rejects(f.session.command({ op: 'action', actionId: 999 }));
});

// Synthetic catalog values exercise dispatch, not original-client evidence.
const hennaCatalog = () => ({ format: 'l2-interlude-henna-v1', records: [{ symbolId: 2 }, { symbolId: 9 }],
  native: { listRequestExtraDword: { status: 'verified-caller-return-address', byMode: { equip: 101, unequip: 202 } } } });

const recipeCatalog = () => ({ format: 'l2-interlude-recipes-v1',
  records: [{ index: 7, recipeItemId: 444, productId: 99 }] });

test('recipe queries distinguish catalog index from item/product IDs and received book ordinal', async () => {
  const catalog = recipeCatalog(), f = enter(fixture({ recipeCatalog: catalog })), start = f.sent.length;
  catalog.records.push({ index: 8 }); // The original admission set was captured at construction.
  for (const bookType of [0, 1]) await f.session.command({ op: 'recipeBook', bookType, arbitrary: 'ignored' });
  await f.session.command({ op: 'recipeInfo', index: 7, recipeId: 999, recipeItemId: 444 });
  assert.deepEqual(f.sent.slice(start), [{ op: 'recipeBookOpen', bookType: 0 },
    { op: 'recipeBookOpen', bookType: 1 }, { op: 'recipeMakeInfo', recipeId: 7 }]);
  f.session.accept({ op: 'recipeBook', bookType: 0, maxMp: 100, recipes: [{ recipeId: 555, index: 3 }] });
  for (const index of [undefined, null, 0, -1, 1.5, '7', 3, 8, 444, 99, 555, 0x80000000])
    await assert.rejects(f.session.command({ op: 'recipeInfo', index }), /Recipe index/);
  for (const bookType of [undefined, null, false, true, '0', '1', -1, 2, .5])
    await assert.rejects(f.session.command({ op: 'recipeBook', bookType }), /bookType/);
  for (const op of ['recipeBookDestroy', 'recipeMakeSelf', 'recipeBookOpen', 'recipeMakeInfo'])
    await assert.rejects(f.session.command({ op, recipeId: 7, bookType: 0 }), /Unsupported/);
  assert.equal(f.sent.length, start + 3);
});

test('recipe catalog is optional and malformed/duplicate indices cannot authorize detail requests', async () => {
  for (const catalog of [null, {}, { ...recipeCatalog(), format: 'other' },
    { ...recipeCatalog(), records: [{ index: 7 }, { index: 7 }] },
    { ...recipeCatalog(), records: [{ index: '7' }] },
    { ...recipeCatalog(), records: [{ recipeItemId: 7 }] }]) {
    const f = enter(fixture({ recipeCatalog: catalog })), start = f.sent.length;
    await assert.rejects(f.session.command({ op: 'recipeInfo', index: 7 }), /catalog/);
    assert.equal(f.sent.length, start);
    await f.session.command({ op: 'recipeBook', bookType: 0 });
    assert.deepEqual(f.sent.at(-1), { op: 'recipeBookOpen', bookType: 0 });
    await f.session.command({ op: 'status' });
    await f.session.command({ op: 'action', actionId: 0 });
    assert.deepEqual(f.sent.at(-1), { op: 'action', actionId: 0 });
  }
});

test('recipe capture retains entry capacity only and refuses queries before entry or after closure', async () => {
  const f = fixture({ recipeCatalog: recipeCatalog() });
  const capacities = { op: 'storageMaxCount', inventory: 80, warehouse: 100, freight: 20,
    privateSell: 4, privateBuy: 4, dwarvenRecipe: 50, recipe: 50 };
  const book = { op: 'recipeBook', bookType: 0, maxMp: 100, recipes: [] };
  const info = { op: 'recipeMakeInfo', recipeId: 7, bookType: 0, mp: 30, maxMp: 100, status: -1 };
  const queries = [{ op: 'recipeBook', bookType: 0 }, { op: 'recipeInfo', index: 7 }];
  for (const query of queries) await assert.rejects(f.session.command(query), /not entered/);
  f.session.begin({ deviceId: 'synthetic' });
  f.session.accept(capacities);
  f.session.accept({ op: 'auth_ok', chars: [{ name: 'ExistingHero', slot: 2 }] });
  for (const m of [capacities, book, info]) f.session.accept(m);
  assert.deepEqual(f.session.entryEvents, [capacities]);
  assert.ok(!f.emitted.some(e => e.type === 'server'));
  f.session.accept({ op: 'enterWorld', char: { id: 1, name: 'ExistingHero', x: 0, y: 0, z: 0 } });
  assert.deepEqual(f.emitted.at(-1), { type: 'server', data: capacities });
  for (const m of [book, info, capacities]) f.session.accept(m);
  assert.deepEqual(f.emitted.slice(-3), [book, info, capacities].map(data => ({ type: 'server', data })));
  f.session.stop();
  const count = f.emitted.length, sent = f.sent.length;
  for (const m of [capacities, book, info]) f.session.accept(m);
  for (const query of queries) await assert.rejects(f.session.command(query), /not entered/);
  assert.equal(f.emitted.length, count); assert.equal(f.sent.length, sent);
});

test('henna queries use exact catalog symbols and verified per-mode words without mutation commands', async () => {
  const catalog = hennaCatalog(), f = enter(fixture({ hennaCatalog: catalog }));
  // Admission snapshots the catalog, rather than trusting later caller mutations.
  catalog.records.push({ symbolId: 99 }); catalog.native.listRequestExtraDword.byMode.equip = 999;
  const start = f.sent.length;
  for (const mode of ['equip', 'unequip']) {
    await f.session.command({ op: 'hennaList', mode, unknown: 123456, symbolId: 99 });
    await f.session.command({ op: 'hennaInfo', mode, symbolId: 9, arbitrary: 'ignored' });
  }
  assert.deepEqual(f.sent.slice(start), [
    { op: 'hennaEquipList', unknown: 101 }, { op: 'hennaItemInfo', symbolId: 9 },
    { op: 'hennaUnequipList', unknown: 202 }, { op: 'hennaUnequipInfo', symbolId: 9 },
  ]);
  for (const op of ['hennaEquip', 'hennaUnequip', 'hennaEquipList', 'hennaItemInfo', 'hennaUnequipList', 'hennaUnequipInfo'])
    await assert.rejects(f.session.command({ op, symbolId: 9, unknown: 0 }), /Unsupported/);
  for (const mode of [undefined, null, 'remove', 'Equip'])
    await assert.rejects(f.session.command({ op: 'hennaList', mode }), /mode/);
  // A received list does not expand the original catalog admission gate.
  f.session.accept({ op: 'hennaEquipList', items: [{ symbolId: 99 }] });
  for (const symbolId of [0, -1, 1.5, '9', null, 99, 0x80000000])
    await assert.rejects(f.session.command({ op: 'hennaInfo', mode: 'equip', symbolId }), /Symbol id/);
  assert.equal(f.sent.length, start + 4);
});

test('optional malformed henna metadata refuses only queries and never invents list padding', async () => {
  for (const catalog of [null, {}, { ...hennaCatalog(), format: 'other' },
    { ...hennaCatalog(), records: [{ symbolId: 2 }, { symbolId: 2 }] },
    { ...hennaCatalog(), records: [{ symbolId: '2' }] }]) {
    const f = enter(fixture({ hennaCatalog: catalog })), start = f.sent.length;
    await assert.rejects(f.session.command({ op: 'hennaList', mode: 'equip' }), /catalog/);
    await assert.rejects(f.session.command({ op: 'hennaInfo', mode: 'equip', symbolId: 2 }), /catalog/);
    assert.equal(f.sent.length, start);
    await f.session.command({ op: 'status' });
    await f.session.command({ op: 'action', actionId: 0 });
    assert.deepEqual(f.sent.at(-1), { op: 'action', actionId: 0 });
  }
  for (const extra of [null, { status: 'unresolved-caller-stack', byMode: { equip: 101 } },
    { status: 'verified-caller-return-address', byMode: { equip: null } },
    { status: 'verified-caller-return-address', byMode: { equip: '101' } },
    { status: 'verified-caller-return-address', byMode: { equip: 0x80000000 } }]) {
    const catalog = hennaCatalog(); catalog.native.listRequestExtraDword = extra;
    const f = enter(fixture({ hennaCatalog: catalog })), start = f.sent.length;
    await assert.rejects(f.session.command({ op: 'hennaList', mode: 'equip', unknown: 0 }), /source henna list request word/);
    assert.equal(f.sent.length, start);
    await f.session.command({ op: 'hennaInfo', mode: 'equip', symbolId: 2 });
    assert.deepEqual(f.sent.at(-1), { op: 'hennaItemInfo', symbolId: 2 });
  }
});

test('henna capture retains entry snapshots and records list/detail replies only in the entered session', async () => {
  const f = fixture({ hennaCatalog: hennaCatalog() });
  const snapshot = { op: 'hennaInfo', statBytes: { INT: 255 }, maxSlots: 3, symbols: [] };
  const replies = ['hennaEquipList', 'hennaItemInfo', 'hennaUnequipList', 'hennaUnequipInfo']
    .map(op => ({ op, symbolId: 2, items: [], adena: 0 }));
  const query = { op: 'hennaInfo', mode: 'equip', symbolId: 2 };
  await assert.rejects(f.session.command(query), /not entered/);
  f.session.begin({ deviceId: 'synthetic' });
  f.session.accept(snapshot); // Account not selected yet.
  f.session.accept({ op: 'auth_ok', chars: [{ name: 'ExistingHero', slot: 2 }] });
  f.session.accept(snapshot);
  for (const reply of replies) f.session.accept(reply);
  assert.deepEqual(f.session.entryEvents, [snapshot]);
  assert.ok(!f.emitted.some(e => e.type === 'server'));
  f.session.accept({ op: 'enterWorld', char: { id: 1, name: 'ExistingHero', x: 0, y: 0, z: 0 } });
  assert.deepEqual(f.emitted.filter(e => e.data.op === 'hennaInfo'), [{ type: 'server', data: snapshot }]);
  for (const reply of replies) f.session.accept(reply);
  assert.deepEqual(f.emitted.slice(-4), replies.map(data => ({ type: 'server', data })));
  f.session.stop();
  const count = f.emitted.length, sent = f.sent.length;
  f.session.accept(snapshot);
  for (const reply of replies) f.session.accept(reply);
  await assert.rejects(f.session.command(query), /not entered/);
  assert.equal(f.emitted.length, count); assert.equal(f.sent.length, sent);
});

test('movement stance updates use the latest actual ChangeMoveType for this character', () => {
  const f = enter(fixture());
  f.session.accept({ op: 'changeMove', id: 7, running: false });
  assert.equal(f.session.state.sheet.running, true);
  f.session.accept({ op: 'changeMove', id: 1, running: false });
  assert.equal(f.session.state.sheet.running, false);
});

function routeNav(complete = true) {
  const calls = [];
  return { calls, findPath: () => ({ complete, points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }] }),
    _lineOk: (a, b) => { calls.push([{ ...a }, { ...b }]); return 0; } };
}
test('partial routes send nothing; valid walk confirms an origin sample and rechecks each move/probe', async () => {
  const nav = routeNav(false), f = enter(fixture({ nav }));
  await assert.rejects(f.session.command({ op: 'walk', goal: { x: 100, y: 0, z: 0 } }), /No complete/);
  assert.equal(f.sent.filter(m => m.op === 'moveTo').length, 0);
  nav.findPath = routeNav().findPath;
  let moves = 0;
  f.session.send = m => {
    f.sent.push(m);
    if (m.op === 'moveTo') f.session.accept({ op: 'move', id: 1, x: ++moves === 1 ? 0 : 100, y: 0, z: 0, tx: 100, ty: 0, tz: 0 });
  };
  await f.session.command({ op: 'walk', goal: { x: 100, y: 0, z: 0 } });
  assert.equal(moves, 2);
  assert.deepEqual(f.session.state.pos, { x: 100, y: 0, z: 0 });
  assert.equal(nav.calls.length, 3); // initial segment, arrival probe, nearby goal floor
  assert.ok(f.emitted.some(e => e.type === 'walk-ended'));
});

test('a stalled walk never releases a queued target/attack: overlapping mutations are discarded', async () => {
  const f = enter(fixture({ nav: routeNav() }));
  f.session.send = m => { f.sent.push(m); if (m.op === 'moveTo')
    f.session.accept({ op: 'move', id: 1, x: 0, y: 0, z: 0, tx: 100, ty: 0, tz: 0 }); };
  const pending = f.session.command({ op: 'walk', goal: { x: 100, y: 0, z: 0 } });
  await assert.rejects(f.session.command({ op: 'attack', id: 7 }), /discarded, not queued/);
  await assert.rejects(pending, /No actual server movement progress/);
  assert.ok(!f.sent.some(m => m.op === 'attack'));
  assert.ok(!f.emitted.some(e => e.type === 'walk-ended'));
  await f.session.command({ op: 'attack', id: 7 }); // A new deliberate command, after the failure.
  assert.equal(f.sent.at(-1).op, 'attack');
});

test('quit interrupts an in-flight walk before any further movement probe', async () => {
  const f = enter(fixture({ nav: routeNav() }));
  f.session.send = m => { f.sent.push(m); if (m.op === 'moveTo')
    f.session.accept({ op: 'move', id: 1, x: 0, y: 0, z: 0, tx: 100, ty: 0, tz: 0 }); };
  const pending = f.session.command({ op: 'walk', goal: { x: 100, y: 0, z: 0 } });
  await f.session.command({ op: 'quit' });
  await assert.rejects(pending, /closed/);
  assert.equal(f.sent.filter(m => m.op === 'moveTo').length, 1);
  assert.equal(f.closes(), 1);
});

// Short turns are necessary geodata edges, even when shorter than the old
// harness acceptance radius. The move reply's origin is the only position.
test('walk preserves 16-unit turns and a final sub-ten-unit leg', async () => {
  const points = [{ x: 0, y: 0, z: 0 }, { x: 16, y: 0, z: 0 },
    { x: 16, y: 16, z: 16 }, { x: 21, y: 16, z: 16 }];
  const nav = { findPath: () => ({ complete: true, points }), _lineOk: (a, b) => b.z ?? a.z };
  const f = enter(fixture({ nav })); let pending = null;
  f.session.send = m => {
    f.sent.push(m);
    if (m.op !== 'moveTo') return;
    const origin = pending || f.session.state.pos;
    f.session.accept({ op: 'move', id: 1, ...origin, tx: m.x, ty: m.y, tz: m.z });
    pending = { x: m.x, y: m.y, z: m.z };
  };
  await f.session.command({ op: 'walk', goal: points.at(-1) });
  assert.deepEqual(f.sent.filter(m => m.op === 'moveTo').map(({ x, y, z }) => ({ x, y, z })),
    points.slice(1).flatMap(p => [p, p]));
  assert.deepEqual(f.session.state.pos, points.at(-1));
  assert.equal(f.emitted.find(e => e.type === 'walk-ended').data.operationalToleranceXY, 0);
});

test('a planner-snapped endpoint does not count as a complete requested walk', async () => {
  const f = enter(fixture({ nav: routeNav() }));
  await assert.rejects(f.session.command({ op: 'walk', goal: { x: 200, y: 0, z: 0 } }), /requested XY/);
  assert.ok(!f.sent.some(m => m.op === 'moveTo'));
});
