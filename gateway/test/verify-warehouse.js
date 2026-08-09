// Warehouse protocol verification (M16): Warehouse Keeper Wilford (30005,
// TI town "Iron Gate" warehouse).
//  0. Char logs in (auto-created), farms 2 gremlins so an adena items-row
//     exists (Gremlin 18342 drops 7-13 adena), logs out; SQL seeds 5000
//     adena — offline updates of EXISTING rows only, no gameserver restart.
//     The seed waits for characters.online=0: the logout save
//     (GameClient.CleanupTask) is delayed 15s when in combat and would
//     overwrite it.
//  1. Re-login, walk to Wilford, talk -> html offers DepositP/WithdrawP
//     (private) + DepositC/WithdrawC (clan). Follow the REAL
//     `npc_<obj>_DepositP` bypass -> whDeposit (WarehouseDepositList 0x41:
//     own inventory items eligible to deposit + current adena).
//  2. whDepositItems (SendWarehouseDepositList 0x31): deposit ONE regular
//     item (first non-adena entry of the list) + 500 adena -> invUpdate.
//     Fee: 30 adena PER ENTRY (2 entries -> 60). Adena rides as a normal
//     item (itemId 57) — there is NO special adena packet in this rev.
//     NOTE: DepositP temp-disables the inventory for 1.5s server-side
//     (Player.tempInventoryDisable) — wait 2s before sending the deposit.
//  3. Follow `npc_<obj>_WithdrawP` -> whWithdraw (WarehouseWithdrawList
//     0x42: warehouse contents) -> the item + adena are there, exact counts.
//  4. whWithdrawItems (SendWarehouseWithdrawList 0x32) everything back ->
//     invUpdate -> inventory restored exactly (adena = start - 60 fee).
//  5. Re-open DepositP -> fresh whDeposit: adena and item counts confirm.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-warehouse-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WILFORD = { npcId: 30005, x: -81512, y: 243424, z: -3720 };
const SEED_ADENA = 5000;
const DEPOSIT_ADENA = 500;
const FEE = 2 * 30; // 30 adena per packet entry (SendWarehouseDepositList)
// Town route Silvia -> Wilford, BFS over the real 17_25 geodata cells
// (server/geodata-staging/geodata/17_25_conv.dat, NSWE-gated) — hand-picked
// straight lines stall on buildings and time the walk out.
const TOWN_ROUTE = [[-83784, 240792, -3720], [-83592, 240792, -3720], [-83400, 240792, -3720],
  [-83208, 240792, -3720], [-83080, 240856, -3680], [-83080, 241048, -3720], [-83080, 241240, -3720],
  [-83080, 241432, -3728], [-83080, 241624, -3728], [-83016, 241752, -3728], [-82888, 241816, -3728],
  [-82776, 241896, -3728], [-82680, 241992, -3728], [-82584, 242088, -3728], [-82488, 242184, -3728],
  [-82392, 242280, -3728], [-82312, 242392, -3728], [-82200, 242472, -3728], [-82104, 242568, -3728],
  [-81992, 242648, -3728], [-81896, 242744, -3728], [-81800, 242840, -3728], [-81688, 242920, -3728],
  [-81608, 243032, -3728], [-81512, 243128, -3720], [-81512, 243320, -3720]];
const WAYPOINTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'road-to-town.json'), 'utf8'))
  .concat([[-84104, 244200, -3728], [-84100, 243600, -3728], [-84050, 243000, -3728],
    [-83950, 242400, -3728], [-83900, 241800, -3720], [-83850, 241300, -3720]], TOWN_ROUTE);

const R = {
  me: null, npcs: [], npcById: new Map(), htmls: [], moves: new Map(), diedIds: new Set(),
  whDeposit: null, whWithdraw: null, invUpdates: [], itemLists: [], selfDead: false, authed: false,
};
let ws;
function connect() {
  ws = new WebSocket(url);
  ws.on('error', (e) => { console.error('ws error:', e.stack || e.message); process.exit(1); });
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
  ws.on('message', async (d) => {
    const m = JSON.parse(d);
    switch (m.op) {
      case 'auth_ok': R.authed = true; await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); break;
      case 'enterWorld': R.me = m.char; break;
      case 'selfStatus': if (m.hp === 0) R.selfDead = true; break;
      case 'addNpc': R.npcs.push(m); R.npcById.set(m.npcId, m); break;
      case 'npcHtml': R.htmls.push(m.html); break;
      case 'whDeposit': R.whDeposit = m; console.log('whDeposit: whType', m.whType, 'adena', m.adena, 'items', m.items.length); break;
      case 'whWithdraw': R.whWithdraw = m; console.log('whWithdraw: whType', m.whType, 'adena', m.adena, 'items', m.items.length); break;
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
      if (Date.now() - hopStart > 20000) { stalled = true; break; }
      if (Date.now() - t0 > 900000) throw new Error('walk timeout ' + label);
      if (Date.now() - lastIssue > Math.max(4000, (dist / 115) * 1000 + 1500)) {
        send2({ op: 'moveTo', x: hop[0], y: hop[1], z: hop[2] });
        lastIssue = Date.now();
      }
      await sleep(1000);
    }
    if (stalled) {
      const me0 = selfPos();
      console.log(`  stall at ${me0.x | 0},${me0.y | 0} -> probing...`);
      // Probe compass directions ordered by closeness to the hop direction —
      // a fixed order (east-first) pushes the char off-route and compounds.
      const angle = Math.atan2(hop[1] - me0.y, hop[0] - me0.x);
      const compass = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      compass.sort((a, b) =>
        Math.abs(Math.atan2(a[1], a[0]) - angle) - Math.abs(Math.atan2(b[1], b[0]) - angle));
      let recovered = false;
      for (const [dx, dy] of compass) {
        send2({ op: 'moveTo', x: me0.x + dx * 240, y: me0.y + dy * 240, z: me0.z });
        await sleep(5000);
        const me1 = selfPos();
        if (Math.hypot(me1.x - me0.x, me1.y - me0.y) > 80) { recovered = true; break; }
      }
      if (!recovered) throw new Error('ROAD-BLOCKED at ' + JSON.stringify(me0));
      // Rejoin at the NEAREST remaining waypoint (the probe may have pushed
      // us backward off-route) instead of blindly retrying the failed hop.
      let nearest = hi, bestD = Infinity;
      for (let i = Math.max(0, hi - 4); i < chain.length; i++) {
        const d = Math.hypot(selfPos().x - chain[i][0], selfPos().y - chain[i][1]);
        if (d < bestD) { bestD = d; nearest = i; }
      }
      hi = nearest - 1;
    }
  }
  console.log(`  arrived at ${label} (${selfPos().x | 0},${selfPos().y | 0})`);
}

// Talk + extract a link from the warehouse keeper's html.
async function talkAndGetLink(id, regex, label) {
  const mark = R.htmls.length;
  let html = null;
  for (let attempt = 1; attempt <= 3 && !html; attempt++) {
    send({ op: 'talk', id });
    html = await waitFor(() => R.htmls[mark], 15000, `Wilford html (attempt ${attempt})`).catch(() => null);
  }
  if (!html) throw new Error('no Wilford html after 3 talks');
  const link = regex.exec(html);
  if (!link) throw new Error(`no ${label} link in Wilford html`);
  return { html, command: link[1] };
}

(async () => {
  // --- 0. create char, farm 2 gremlins (adena row), logout, seed offline ---
  console.log('0. creating char + farming 2 gremlins (creates the adena row)...');
  connect();
  await waitFor(() => R.me, 60000, 'enterWorld');
  await sleep(3500);
  console.log('   in world as', R.me.name, 'objId', R.me.id);
  await killGremlins(2);
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
  execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-e',
    `UPDATE items SET count=${SEED_ADENA} WHERE owner_id=${charId} AND item_id=57;`]);
  const adenaRow = db(`SELECT count FROM items WHERE owner_id=${charId} AND item_id=57;`);
  if (adenaRow !== String(SEED_ADENA)) throw new Error('adena seed failed (row: ' + adenaRow + ')');
  console.log(`   seeded ${charName}: adena ${adenaRow}`);

  // --- 1. re-login, walk to Wilford, talk, DepositP -> whDeposit ---
  console.log('1. re-login + walk to Warehouse Keeper Wilford (TI town)...');
  R.me = null;
  connect();
  await waitFor(() => R.me, 60000, 'enterWorld (re-login)');
  if (R.me.name !== charName) throw new Error('char name mismatch after re-login');
  await sleep(3000);

  await walkTo(WILFORD, 'Wilford');
  for (let i = 0; i < 15; i++) {
    const p = selfPos();
    if (Math.hypot(p.x - WILFORD.x, p.y - WILFORD.y) < 80) break;
    send({ op: 'moveTo', x: WILFORD.x, y: WILFORD.y, z: WILFORD.z });
    await sleep(2500);
  }
  console.log('   final dist to Wilford:', Math.hypot(selfPos().x - WILFORD.x, selfPos().y - WILFORD.y) | 0);
  const wilford = await waitFor(() => R.npcById.get(WILFORD.npcId), 20000, 'Wilford addNpc');

  console.log('2. talk + follow the real DepositP bypass -> whDeposit...');
  const dep = await talkAndGetLink(wilford.id, /bypass -h (npc_\d+_DepositP)/, 'DepositP');
  console.log('   html offers: DepositP:', /DepositP/.test(dep.html), 'WithdrawP:', /WithdrawP/.test(dep.html),
    'DepositC:', /DepositC/.test(dep.html), 'WithdrawC:', /WithdrawC/.test(dep.html));
  console.log('   following:', dep.command);
  send({ op: 'bypass', command: dep.command });
  const depList = await waitFor(() => R.whDeposit, 15000, 'whDeposit');
  if (depList.whType !== 1) throw new Error('whDeposit whType != 1 (private)');
  if (depList.adena !== SEED_ADENA) throw new Error(`whDeposit adena ${depList.adena} != seeded ${SEED_ADENA}`);
  const adenaItem = depList.items.find((i) => i.itemId === 57);
  const regItem = depList.items.find((i) => i.itemId !== 57);
  if (!adenaItem || !regItem) throw new Error('whDeposit list missing adena or a regular item');
  console.log('   adena entry:', JSON.stringify(adenaItem), '; chosen item:', JSON.stringify(regItem));

  // --- 3. deposit 1 regular item + 500 adena (fee 2x30 = 60) ---
  // DepositP temp-disables the inventory for 1.5s (Player.tempInventoryDisable)
  // — wait it out or the deposit is silently dropped.
  await sleep(2000);
  console.log(`3. whDepositItems: ${regItem.itemId} x1 + adena x${DEPOSIT_ADENA} (fee ${FEE})...`);
  const invMark = R.invUpdates.length;
  send({ op: 'whDepositItems', items: [
    { objectId: regItem.objectId, count: 1 },
    { objectId: adenaItem.objectId, count: DEPOSIT_ADENA },
  ] });
  const depUps = await waitFor(() => {
    const u = R.invUpdates.slice(invMark).flatMap((x) => x.updated);
    return u.some((i) => i.itemId === 57) && u.some((i) => i.itemId === regItem.itemId) ? u : null;
  }, 15000, 'invUpdate after deposit');
  const adenaAfterDep = (depUps.filter((i) => i.itemId === 57).pop() || {}).count;
  const itemUp = depUps.find((i) => i.itemId === regItem.itemId);
  console.log(`   invUpdate: ${JSON.stringify(depUps.map((i) => ({ change: i.change, itemId: i.itemId, count: i.count })))}`);
  console.log(`   adena ${SEED_ADENA} -> ${adenaAfterDep} (expect ${SEED_ADENA - DEPOSIT_ADENA - FEE})`);

  // --- 4. WithdrawP -> whWithdraw: warehouse contents reflect the deposit ---
  console.log('4. follow WithdrawP bypass -> whWithdraw...');
  const wit = await talkAndGetLink(wilford.id, /bypass -h (npc_\d+_WithdrawP)/, 'WithdrawP');
  send({ op: 'bypass', command: wit.command });
  const witList = await waitFor(() => R.whWithdraw, 15000, 'whWithdraw');
  if (witList.whType !== 1) throw new Error('whWithdraw whType != 1 (private)');
  const whItem = witList.items.find((i) => i.itemId === regItem.itemId);
  const whAdena = witList.items.find((i) => i.itemId === 57);
  console.log(`   warehouse: item ${regItem.itemId} ->`, JSON.stringify(whItem), '; adena ->', JSON.stringify(whAdena));
  if (!whItem || whItem.count !== 1) throw new Error('warehouse item missing or count != 1');
  if (!whAdena || whAdena.count !== DEPOSIT_ADENA) throw new Error(`warehouse adena ${whAdena && whAdena.count} != ${DEPOSIT_ADENA}`);

  // --- 5. withdraw everything back -> inventory restored exactly ---
  console.log('5. whWithdrawItems everything back...');
  const invMark2 = R.invUpdates.length;
  send({ op: 'whWithdrawItems', items: [
    { objectId: whItem.objectId, count: 1 },
    { objectId: whAdena.objectId, count: DEPOSIT_ADENA },
  ] });
  const witUps = await waitFor(() => {
    const u = R.invUpdates.slice(invMark2).flatMap((x) => x.updated);
    return u.some((i) => i.itemId === 57) && u.some((i) => i.itemId === regItem.itemId) ? u : null;
  }, 15000, 'invUpdate after withdraw');
  const adenaFinal = (witUps.filter((i) => i.itemId === 57).pop() || {}).count;
  const itemBack = witUps.find((i) => i.itemId === regItem.itemId);
  console.log(`   invUpdate: ${JSON.stringify(witUps.map((i) => ({ change: i.change, itemId: i.itemId, count: i.count })))}`);
  console.log(`   adena ${adenaAfterDep} -> ${adenaFinal} (expect ${SEED_ADENA - FEE}: fee is not refunded)`);

  // --- 6. fresh DepositP list confirms the final state ---
  console.log('6. re-open DepositP -> fresh whDeposit confirms final state...');
  R.whDeposit = null;
  const dep2 = await talkAndGetLink(wilford.id, /bypass -h (npc_\d+_DepositP)/, 'DepositP');
  send({ op: 'bypass', command: dep2.command });
  const finalList = await waitFor(() => R.whDeposit, 15000, 'whDeposit (final)');
  const finalAdena = (finalList.items.find((i) => i.itemId === 57) || {}).count;
  const finalItem = finalList.items.find((i) => i.itemId === regItem.itemId);
  console.log(`   final whDeposit: adena ${finalAdena} (expect ${SEED_ADENA - FEE}), item ${regItem.itemId} count ${finalItem && finalItem.count} (expect ${regItem.count})`);

  console.log('---');
  const pass =
    depList.whType === 1 && depList.adena === SEED_ADENA &&
    adenaAfterDep === SEED_ADENA - DEPOSIT_ADENA - FEE &&
    itemUp && (itemUp.change === 'modify' || itemUp.change === 'remove') &&
    whItem && whItem.count === 1 && whAdena && whAdena.count === DEPOSIT_ADENA &&
    adenaFinal === SEED_ADENA - FEE &&
    itemBack && (itemBack.change === 'add' || itemBack.change === 'modify') &&
    finalAdena === SEED_ADENA - FEE && finalItem && finalItem.count === regItem.count;
  console.log(pass ? 'VERIFY-WAREHOUSE: PASS' : 'VERIFY-WAREHOUSE: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-WAREHOUSE: FAIL', e.stack || e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-WAREHOUSE: global timeout'); process.exit(1); }, 1500000);
