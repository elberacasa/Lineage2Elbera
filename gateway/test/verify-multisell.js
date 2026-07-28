// Multisell protocol verification: the newbie equipment-exchange path.
//  0. Char logs in (auto-created), farms 2 gremlins so an adena items-row
//     exists, logs out; SQL seeds level 6 (Player.isNewbie(true) requires
//     level 6..25 for Newbie_Exc_Multisell) + 20000 adena — offline updates
//     of EXISTING rows only, so no gameserver restart is needed. The seed
//     waits for characters.online=0: the logout save (GameClient.CleanupTask)
//     is delayed 15s when the char is in combat and would overwrite it.
//  1. Re-login, walk to Trader Silvia (30003, TI town), buy Magic Ring (116,
//     37a) and Necklace of Magic (118, 75a): both are ingredients in
//     data/xml/multisell/003.xml AND sold in her buyList 13, so the prepared
//     (inventoryOnly) multisell list gets exactly 2 entries.
//  2. Follow the REAL html bypass `npc_<obj>_Newbie_Exc_Multisell 003` ->
//     multisellList{listId,items[]} (MultiSellList 0xd0, pages merged).
//     Cross-check both entries against datapack 003.xml:
//       875 <- [116 x1, 57 x557]   906 <- [118 x1, 57 x1115]
//  3. multisellChoose{listId,entryId,count:1} (MultiSellChoose 0xa7) ->
//     invUpdate: 875 added, 116 removed, adena -557 exactly.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-multisell-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SILVIA = { npcId: 30003, x: -83789, y: 240799, z: -3717 };
const RING = 116;   // Magic Ring, 37a in buyList 13 -> 003 entry: 875 <- [116, 557a]
const NECKLACE = 118; // Necklace of Magic, 75a in buyList 13 -> 003 entry: 906 <- [118, 1115a]
const SEED_ADENA = 20000;
const WAYPOINTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'road-to-town.json'), 'utf8'))
  .concat([[-84104, 244200, -3728], [-84100, 243600, -3728], [-84050, 243000, -3728],
    [-83950, 242400, -3728], [-83900, 241800, -3720], [-83850, 241300, -3720]]);

// --- datapack cross-check data (003.xml, parsed once) ---
const xml = fs.readFileSync(path.join(__dirname, '../../server/aCis_datapack/data/xml/multisell/003.xml'), 'utf8');
const xmlEntries = [];
for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
  const body = m[1];
  const prod = [...body.matchAll(/<production id="(\d+)" count="(\d+)"\/>/g)].map((x) => ({ itemId: +x[1], count: +x[2] }));
  const ing = [...body.matchAll(/<ingredient id="(\d+)" count="(\d+)"\/>/g)].map((x) => ({ itemId: +x[1], count: +x[2] }));
  xmlEntries.push({ products: prod, ingredients: ing });
}
const sig = (l) => l.map((i) => `${i.itemId}:${i.count}`).sort().join(',');
const findXmlEntry = (products, ingredients) =>
  xmlEntries.find((e) => sig(e.products) === sig(products) && sig(e.ingredients) === sig(ingredients));

// --- client state ---
const R = {
  me: null, npcs: [], npcById: new Map(), htmls: [], moves: new Map(), diedIds: new Set(),
  buyList: null, multisell: null, invUpdates: [], itemLists: [], selfDead: false, authed: false,
};
let ws;
function connect() {
  ws = new WebSocket(url);
  ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
  ws.on('message', async (d) => {
    const m = JSON.parse(d);
    switch (m.op) {
      case 'auth_ok': R.authed = true; await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); break;
      case 'enterWorld': R.me = m.char; break;
      case 'selfStatus': if (m.hp === 0) R.selfDead = true; break;
      case 'addNpc': R.npcs.push(m); R.npcById.set(m.npcId, m); break;
      case 'npcHtml': R.htmls.push(m.html); break;
      case 'buyList': R.buyList = m; console.log('buyList: listId', m.listId, 'money', m.money, 'items', m.items.length); break;
      case 'multisellList': R.multisell = m; console.log('multisellList: listId', m.listId, 'entries', m.items.length, JSON.stringify(m.items)); break;
      case 'itemList': R.itemLists.push(m.items); console.log('itemList:', m.items.length, 'items; adena:', (m.items.find(i => i.itemId === 57) || {}).count); break;
      case 'invUpdate': R.invUpdates.push(m); break;
      case 'move': R.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }); break;
      case 'sysMsg': console.log('sysMsg:', JSON.stringify(m)); break;
      case 'die': R.diedIds.add(m.id); if (m.id === R.me?.id) R.selfDead = true; break;
    }
  });
}
const send = (o) => ws.send(JSON.stringify(o));
const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout: ' + label)); }
  }, 300);
});
const selfPos = () => R.moves.get(R.me?.id) || R.me;

async function killGremlins(count) {
  let killed = 0;
  while (killed < count) {
    const g = R.npcs
      .filter((n) => n.name === 'Gremlin' && !R.diedIds.has(n.id))
      .map((n) => ({ ...n, ...(R.moves.get(n.id) || n) }))
      .map((n) => ({ ...n, dist: Math.hypot(n.x - selfPos().x, n.y - selfPos().y) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (!g) throw new Error('no gremlin');
    console.log(`  killing Gremlin ${g.id} (${killed + 1}/${count})...`);
    const t0 = Date.now();
    while (!R.diedIds.has(g.id) && Date.now() - t0 < 150000) {
      const pos = R.moves.get(g.id) || g;
      const me = selfPos();
      send({ op: 'moveTo', x: pos.x + 20, y: pos.y, z: pos.z });
      await sleep(Math.min(12000, (Math.hypot(pos.x - me.x, pos.y - me.y) / 115) * 1000 + 2500));
      const t1 = Date.now();
      while (!R.diedIds.has(g.id) && Date.now() - t1 < 15000) {
        send({ op: 'attack', id: g.id });
        await sleep(4000);
      }
    }
    killed++;
    await sleep(2000);
  }
}

async function walkTo(target, label) {
  console.log(`  walking to ${label}...`);
  let wpIndex = 0;
  let best = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const d = Math.hypot(selfPos().x - WAYPOINTS[i][0], selfPos().y - WAYPOINTS[i][1]);
    if (d < best) { best = d; wpIndex = i; }
  }
  const chain = WAYPOINTS.slice(wpIndex).concat([[target.x, target.y, target.z]]);
  const t0 = Date.now();
  let moveStamp = 0;
  const send2 = (o) => { if (o.op === 'moveTo') moveStamp = Date.now(); send(o); };
  for (let hi = 0; hi < chain.length; hi++) {
    if (R.selfDead) throw new Error('SELF DIED at ' + JSON.stringify(selfPos()));
    const hop = chain[hi];
    const hopStart = Date.now();
    let stalled = false;
    let lastIssue = 0;
    for (;;) {
      const me = selfPos();
      const dist = Math.hypot(me.x - hop[0], me.y - hop[1]);
      if (dist < 260 && Date.now() - moveStamp > 2500) break;
      if (Date.now() - hopStart > 60000) { stalled = true; break; }
      if (Date.now() - t0 > 560000) throw new Error('walk timeout ' + label);
      if (Date.now() - lastIssue > Math.max(4000, (dist / 115) * 1000 + 1500)) {
        send2({ op: 'moveTo', x: hop[0], y: hop[1], z: hop[2] });
        lastIssue = Date.now();
      }
      await sleep(1000);
    }
    if (stalled) {
      const me0 = selfPos();
      console.log(`  stall at ${me0.x | 0},${me0.y | 0} -> probing...`);
      let recovered = false;
      for (const [dx, dy] of [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]]) {
        send2({ op: 'moveTo', x: me0.x + dx * 240, y: me0.y + dy * 240, z: me0.z });
        await sleep(5000);
        const me1 = selfPos();
        if (Math.hypot(me1.x - me0.x, me1.y - me0.y) > 80) { recovered = true; break; }
      }
      if (!recovered) throw new Error('ROAD-BLOCKED at ' + JSON.stringify(me0));
      hi--;
    }
  }
  console.log(`  arrived at ${label} (${selfPos().x | 0},${selfPos().y | 0})`);
}

(async () => {
  // --- 0. create char, farm 2 gremlins (adena row), logout, seed offline ---
  console.log('0. creating char + farming 2 gremlins (creates the adena row)...');
  connect();
  await waitFor(() => R.me, 60000, 'enterWorld');
  await sleep(3500);
  console.log('   in world as', R.me.name, 'objId', R.me.id);
  await killGremlins(2);
  const farmed = (R.invUpdates.flatMap((u) => u.updated).filter((i) => i.itemId === 57).pop() || {}).count || 0;
  console.log('   farmed adena:', farmed);
  const charId = R.me.id;
  const charName = R.me.name;
  ws.close();
  // aCis saves on logout via GameClient.CleanupTask — 100ms normally but
  // 15s when the char is IN COMBAT (we just fought gremlins). Poll the
  // online flag instead of sleeping a fixed time; seeding earlier is
  // silently overwritten by the delayed save (in-memory state wins).
  const db = (q) => execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
  let offline = false;
  for (let i = 0; i < 30 && !offline; i++) {
    await sleep(2000);
    offline = db(`SELECT online FROM characters WHERE obj_Id=${charId};`) === '0';
  }
  if (!offline) throw new Error('char still online 60s after logout');
  await sleep(1000);
  console.log('   char offline (logout save done) — seeding');

  const levelsXml = fs.readFileSync(path.join(__dirname, '../../server/aCis_gameserver/build/dist/gameserver/data/xml/playerLevels.xml'), 'utf8');
  const exp6 = Number(/<playerLevel level="6"[^>]*requiredExpToLevelUp="(\d+)"/.exec(levelsXml)[1]);
  execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-e',
    `UPDATE characters SET level=6, exp=${exp6} WHERE obj_Id=${charId} AND online=0;`]);
  execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-e',
    `UPDATE items SET count=${SEED_ADENA} WHERE owner_id=${charId} AND item_id=57;`]);
  const adenaRow = db(`SELECT count FROM items WHERE owner_id=${charId} AND item_id=57;`);
  if (adenaRow !== String(SEED_ADENA)) throw new Error('adena seed failed (row: ' + adenaRow + ')');
  console.log(`   seeded ${charName}: level 6 (exp ${exp6}), adena ${adenaRow} — Newbie_Exc_Multisell needs level 6..25 (Player.isNewbie)`);

  // --- 1. re-login, walk to Silvia, buy the two ingredient rings ---
  console.log('1. re-login + walk to Trader Silvia (TI town)...');
  R.me = null;
  connect();
  await waitFor(() => R.me, 60000, 'enterWorld (re-login)');
  if (R.me.name !== charName) throw new Error('char name mismatch after re-login');
  await waitFor(() => R.itemLists.length > 0, 20000, 'itemList after re-login');
  const adenaLogin = (R.itemLists[R.itemLists.length - 1].find((i) => i.itemId === 57) || {}).count;
  console.log('   adena after seed + re-login:', adenaLogin);
  await sleep(3000);

  await walkTo(SILVIA, 'Silvia');
  for (const [ax, ay] of [[-83900, 241000], [-83900, 240850], [-83830, 240805], [SILVIA.x, SILVIA.y]]) {
    for (let i = 0; i < 15; i++) {
      const p = selfPos();
      if (Math.hypot(p.x - ax, p.y - ay) < 80) break;
      send({ op: 'moveTo', x: ax, y: ay, z: SILVIA.z });
      await sleep(2500);
    }
  }
  console.log('   final dist to Silvia:', Math.hypot(selfPos().x - SILVIA.x, selfPos().y - SILVIA.y) | 0);
  const silvia = await waitFor(() => R.npcById.get(SILVIA.npcId), 20000, 'Silvia addNpc');

  console.log('2. talk + Buy 13 -> buy 116 (Magic Ring) + 118 ...');
  let mark = R.htmls.length;
  let html = null;
  for (let attempt = 1; attempt <= 3 && !html; attempt++) {
    send({ op: 'talk', id: silvia.id });
    html = await waitFor(() => R.htmls[mark], 15000, `Silvia html (attempt ${attempt})`).catch(() => null);
  }
  if (!html) throw new Error('no Silvia html after 3 talks');
  const buyLink = /bypass -h (npc_\d+_Buy 13)/.exec(html);
  if (!buyLink) throw new Error('no Buy 13 link in Silvia html');
  send({ op: 'bypass', command: buyLink[1] });
  await waitFor(() => R.buyList, 15000, 'buyList');
  send({ op: 'target', id: silvia.id });
  await sleep(1500);
  const ilMark = R.itemLists.length;
  send({ op: 'buy', items: [{ itemId: RING, count: 1 }, { itemId: NECKLACE, count: 1 }] });
  const bought = await waitFor(() => R.itemLists.slice(ilMark).find((l) => l.some((i) => i.itemId === RING) && l.some((i) => i.itemId === NECKLACE)), 15000, 'itemList with 116+118 after buy');
  const adenaAfterBuy = (bought.find((i) => i.itemId === 57) || {}).count;
  console.log(`   bought 116+118; adena ${adenaLogin} -> ${adenaAfterBuy} (delta ${adenaAfterBuy - adenaLogin}, expect -112)`);

  // --- 3. the multisell path: real Newbie_Exc_Multisell bypass -> list ---
  console.log('3. Newbie_Exc_Multisell 003 bypass -> multisellList...');
  const msLink = /bypass -h (npc_\d+_Newbie_Exc_Multisell 003)/.exec(html);
  if (!msLink) throw new Error('no Newbie_Exc_Multisell 003 link in Silvia html');
  console.log('   following:', msLink[1]);
  send({ op: 'bypass', command: msLink[1] });
  const list = await waitFor(() => R.multisell, 15000, 'multisellList');
  if (!list.listId || !Array.isArray(list.items) || list.items.length === 0)
    throw new Error('empty multisellList');
  // Prepared list (inventoryOnly=true) holds one entry per owned ingredient:
  // exactly the 116 and 118 exchanges.
  const e116 = list.items.find((e) => e.ingredients.some((i) => i.itemId === RING));
  const e118 = list.items.find((e) => e.ingredients.some((i) => i.itemId === NECKLACE));
  if (!e116 || !e118) throw new Error('expected 116/118 entries in multisellList');
  const x116 = findXmlEntry(e116.products, e116.ingredients);
  const x118 = findXmlEntry(e118.products, e118.ingredients);
  console.log('   entry(116):', JSON.stringify(e116), '-> matches 003.xml:', !!x116, '(expect 875 <- [116x1, 57x557])');
  console.log('   entry(118):', JSON.stringify(e118), '-> matches 003.xml:', !!x118, '(expect 906 <- [118x1, 57x1115a])');
  const xmlOk = !!x116 && !!x118 &&
    e116.products.length === 1 && e116.products[0].itemId === 875 && e116.products[0].count === 1 &&
    e116.ingredients.length === 2 && e116.ingredients.find((i) => i.itemId === 57).count === 557 &&
    e118.products.length === 1 && e118.products[0].itemId === 906 &&
    e118.ingredients.find((i) => i.itemId === 57).count === 1115;

  // --- 4. choose the 116 entry: 875 in, 116 + 557a out ---
  console.log(`4. multisellChoose listId=${list.listId} entryId=${e116.entryId} count=1...`);
  const invMark = R.invUpdates.length;
  send({ op: 'multisellChoose', listId: list.listId, entryId: e116.entryId, count: 1 });
  const ups = await waitFor(() => {
    const u = R.invUpdates.slice(invMark).flatMap((x) => x.updated);
    return u.some((i) => i.itemId === 875 && i.change === 'add') ? u : null;
  }, 15000, 'invUpdate adding 875');
  const removed116 = ups.some((i) => i.itemId === RING && i.change === 'remove');
  const adenaAfter = (ups.filter((i) => i.itemId === 57).pop() || {}).count;
  console.log(`   invUpdate: ${JSON.stringify(ups.map((i) => ({ change: i.change, itemId: i.itemId, count: i.count })))}`);
  console.log(`   875 added; 116 removed: ${removed116}; adena ${adenaAfterBuy} -> ${adenaAfter} (delta ${adenaAfter - adenaAfterBuy}, expect -557)`);

  console.log('---');
  const pass = xmlOk && removed116 && adenaAfter === adenaAfterBuy - 557;
  console.log(pass ? 'VERIFY-MULTISELL: PASS' : 'VERIFY-MULTISELL: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-MULTISELL: FAIL', e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-MULTISELL: global timeout'); process.exit(1); }, 900000);
