// NPC shop verification: walk to Trader Silvia (30003, TI town), follow the
// real Buy bypass -> buyList (cross-check price vs datapack buyLists.xml) ->
// buy 1 item -> invUpdate (item + adena delta) -> Sell -> sellList ->
// sell it back -> adena back at referencePrice/2. Documents tax/multisell.
'use strict';

const WebSocket = require('ws');
const { execSync } = require('child_process');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-shop-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SILVIA = { npcId: 30003, x: -83789, y: 240799, z: -3717 };
const BUY_ITEM_ID = 116; // cheapest accessory in list 13 (37a per buyLists.xml)
const WAYPOINTS = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'road-to-town.json'), 'utf8'))
  .concat([[-84104, 244200, -3728], [-84100, 243600, -3728], [-84050, 243000, -3728],
    [-83950, 242400, -3728], [-83900, 241800, -3720], [-83850, 241300, -3720]]);

const R = {
  me: null, level: 1, npcs: [], npcById: new Map(), htmls: [], moves: new Map(),
  diedIds: new Set(), buyList: null, sellList: null, invUpdates: [], itemLists: [], selfDead: false,
};
const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
ws.on('message', async (d) => {
  const m = JSON.parse(d);
  switch (m.op) {
    case 'auth_ok': await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); break;
    case 'enterWorld': R.me = m.char; break;
    case 'selfStatus': if (m.hp === 0) R.selfDead = true; break;
    case 'addNpc': R.npcs.push(m); R.npcById.set(m.npcId, m); break;
    case 'npcHtml': R.htmls.push(m.html); break;
    case 'buyList': R.buyList = m; console.log('buyList: listId', m.listId, 'money', m.money, 'items', m.items.length); break;
    case 'itemList': R.itemLists.push(m.items); console.log('itemList:', m.items.length, 'items; adena:', (m.items.find(i => i.itemId === 57) || {}).count); break;
    case 'sellList': R.sellList = m; console.log('sellList: money', m.money, 'items', m.items.length); break;
    case 'invUpdate': R.invUpdates.push(m); break;
    case 'move': R.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }); break;
    case 'sysMsg': console.log('sysMsg:', JSON.stringify(m)); break;
    case 'actionFailed': console.log('actionFailed'); break;
    case 'die': R.diedIds.add(m.id); if (m.id === R.me?.id) R.selfDead = true; break;
  }
});
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
      // Arrival = close AND no self move issued/broadcast in the last 2.5s.
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
  await waitFor(() => R.me, 60000, 'enterWorld');
  await sleep(3500);
  console.log('in world as', R.me.name);
  console.log('1. farming adena (2 gremlins)...');
  await killGremlins(2);
  const adenaStart = (R.invUpdates.flatMap((u) => u.updated).filter((i) => i.itemId === 57).pop() || {}).count || 0;
  console.log('   adena:', adenaStart);

  console.log('2. walking to Trader Silvia (TI town)...');
  await walkTo(SILVIA, 'Silvia');
  // Final approach into interact range (150u, Npc.INTERACTION_DISTANCE) —
  // arc through open cells (the straight NE line hits the shop wall '^').
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

  console.log('3. talk + follow Buy bypass...');
  let mark = R.htmls.length;
  let html = null;
  for (let attempt = 1; attempt <= 3 && !html; attempt++) {
    send({ op: 'talk', id: silvia.id });
    html = await waitFor(() => R.htmls[mark], 15000, `Silvia html (attempt ${attempt})`).catch(() => null);
  }
  if (!html) throw new Error('no Silvia html after 3 talks');
  const buyLink = /bypass -h (npc_\d+_Buy 13)/.exec(html);
  if (!buyLink) throw new Error('no Buy 13 link in Silvia html');
  console.log('   following:', buyLink[1]);
  send({ op: 'bypass', command: buyLink[1] });
  await waitFor(() => R.buyList, 15000, 'buyList');
  const shopItem = R.buyList.items.find((i) => i.itemId === BUY_ITEM_ID);
  console.log('   buyList item 116:', JSON.stringify(shopItem), '(datapack price 37)');
  console.log('   buyList money (=adena):', R.buyList.money);

  console.log('4. buying item 116 x1...');
  // RequestBuyItem requires the merchant as CURRENT target: re-target first.
  // NOTE: aCis answers a successful buy with a FULL ItemList (0x1b), NOT an
  // InventoryUpdate (RequestBuyItem line ~194; the update queue is cleared).
  send({ op: 'target', id: silvia.id });
  await sleep(1500);
  const adenaBefore = R.buyList.money;
  const ilMark = R.itemLists.length;
  send({ op: 'buy', items: [{ itemId: BUY_ITEM_ID, count: 1 }] });
  const bought = await waitFor(() => R.itemLists.slice(ilMark).find((l) => l.some((i) => i.itemId === BUY_ITEM_ID)), 15000, 'itemList with 116 after buy');
  const adenaAfterBuy = (bought.find((i) => i.itemId === 57) || {}).count;
  console.log(`   itemList has 116; adena ${adenaBefore} -> ${adenaAfterBuy} (delta ${adenaAfterBuy - adenaBefore}, expect -37)`);

  console.log('5. Sell -> sellList -> sell it back...');
  send({ op: 'target', id: silvia.id });
  await sleep(1000);
  send({ op: 'bypass', command: `npc_${silvia.id}_Sell` });
  await waitFor(() => R.sellList, 15000, 'sellList');
  const sellable = R.sellList.items.find((i) => i.itemId === BUY_ITEM_ID);
  console.log('   sellList entry for 116:', JSON.stringify(sellable));
  const invMark2 = R.invUpdates.length;
  const ilMark2 = R.itemLists.length;
  send({ op: 'sell', items: [{ objectId: sellable.objectId, count: 1 }] });
  await waitFor(() =>
    R.invUpdates.slice(invMark2).some((u) => u.updated.some((i) => i.itemId === BUY_ITEM_ID && i.change === 'remove')) ||
    R.itemLists.slice(ilMark2).some((l) => !l.some((i) => i.itemId === BUY_ITEM_ID)),
    15000, 'sell confirmation (invUpdate remove or itemList without 116)');
  const adenaAfterSell = ((R.invUpdates.slice(invMark2).flatMap((u) => u.updated).filter((i) => i.itemId === 57).pop() ||
    (R.itemLists[R.itemLists.length - 1] || []).find((i) => i.itemId === 57)) || {}).count;
  console.log(`   adena ${adenaAfterBuy} -> ${adenaAfterSell} (delta +${adenaAfterSell - adenaAfterBuy}, sell price ${sellable.price})`);

  console.log('---');
  const pass = shopItem && shopItem.price === 37 &&
    adenaAfterBuy === adenaBefore - 37 &&
    sellable && adenaAfterSell === adenaAfterBuy + sellable.price;
  console.log(pass ? 'VERIFY-SHOP: PASS' : 'VERIFY-SHOP: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-SHOP: FAIL', e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-SHOP: global timeout'); process.exit(1); }, 900000);
