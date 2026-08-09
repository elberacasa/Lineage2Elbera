// Private store protocol verification (two sessions, WS bridge):
//  1. B earns adena (gremlin kill, autoloot) to fund the purchase.
//  2. A: storeManageSell -> storeMsgSell (sellables incl. Tutorial Guide).
//  3. A: storeSetSell{guide @ PRICE, title} -> storeState{open:true,'sell'}
//     (SetPrivateStoreListSell IS the store start in aCis — no separate op).
//  4. B clicks A (talk) -> playerStore{type:'sell', title, guide @ PRICE}.
//  5. B: storeBuy -> item moves A->B, adena moves B->A (invUpdate both
//     sides, exact amounts) -> store auto-closes (storeState{open:false}).
//  6. A re-lists (adena), storeStop{} -> storeState{open:false} -> B clicks
//     A: no playerStore; storeBuy attempt: nothing moves.
//  7. .offline tie-in: A re-lists + .offline -> A disconnects; observer B
//     still sees A and can still open the persisting store (playerStore).
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GUIDE_ID = 5588; // Tutorial Guide — the one tradable starter item
const ADENA_ID = 57;
const PRICE = 10;
const TITLE = 'Venta guia 123';
const TITLE2 = 'Offline vendo';

function makeClient(name, deviceId) {
  const c = {
    name,
    ws: new WebSocket(url),
    state: {
      me: null, players: [], items: [], npcs: [], moves: new Map(),
      diedIds: new Set(), removedIds: new Set(), invUpdates: [],
      adena: 0, storeMsgSell: [], storeStates: [], playerStores: [],
      sys: [], closed: false,
    },
  };
  c.queue = [];
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); else c.queue.push(o); };
  c.ws.on('open', () => { for (const o of c.queue.splice(0)) c.ws.send(JSON.stringify(o)); });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
  c.ws.on('close', () => { c.state.closed = true; });
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    const st = c.state;
    switch (m.op) {
      case 'enterWorld': st.me = m.char; break;
      case 'addPlayer': st.players.push(m); break;
      case 'addNpc': st.npcs.push(m); break;
      case 'itemList': {
        st.items = m.items;
        const ad = m.items.find((i) => i.itemId === ADENA_ID);
        st.adena = ad ? ad.count : 0;
        break;
      }
      case 'invUpdate': {
        st.invUpdates.push(m);
        for (const u of m.updated) {
          if (u.itemId !== ADENA_ID) continue;
          if (u.change === 'modify') st.adena = u.count;
          else if (u.change === 'add') st.adena = (st.adena || 0) + u.count;
          else if (u.change === 'remove') st.adena = 0;
        }
        break;
      }
      case 'move': if (m.id) st.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }); break;
      case 'die': st.diedIds.add(m.id); break;
      case 'remove': st.removedIds.add(m.id); break;
      case 'storeMsgSell': st.storeMsgSell.push(m); console.log(`[${name}] storeMsgSell: items=${m.items.length} sellables=${(m.sellables || []).length}`); break;
      case 'storeState': st.storeStates.push(m); console.log(`[${name}] storeState:`, JSON.stringify(m)); break;
      case 'playerStore': st.playerStores.push(m); console.log(`[${name}] playerStore:`, JSON.stringify(m)); break;
      case 'sysMsg': st.sys.push(m); break;
    }
  });
  return c;
}

const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout: ' + label)); }
  }, 250);
});

// Walk-first melee kill (the ranged auto-approach stalls with geodata on).
async function killGremlin(c, label) {
  const selfPos = () => c.state.moves.get(c.state.me.id) || c.state.me;
  const g0 = c.state.npcs
    .filter((n) => n.name === 'Gremlin' && !c.state.diedIds.has(n.id))
    .map((n) => ({ ...n, ...(c.state.moves.get(n.id) || n) }))
    .map((n) => ({ ...n, dist: Math.hypot(n.x - selfPos().x, n.y - selfPos().y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (!g0) throw new Error('no live Gremlin for ' + label);
  console.log(`   [${c.name}] killing Gremlin id=${g0.id} (${label})...`);
  const t0 = Date.now();
  while (!c.state.diedIds.has(g0.id) && Date.now() - t0 < 150000) {
    const pos = c.state.moves.get(g0.id) || g0;
    const me = selfPos();
    c.send({ op: 'moveTo', x: pos.x + 20, y: pos.y, z: pos.z });
    await sleep(Math.min(12000, (Math.hypot(pos.x - me.x, pos.y - me.y) / 115) * 1000 + 2500));
    const t1 = Date.now();
    while (!c.state.diedIds.has(g0.id) && Date.now() - t1 < 15000) {
      c.send({ op: 'attack', id: g0.id });
      await sleep(4000);
    }
  }
  if (!c.state.diedIds.has(g0.id)) throw new Error('kill timeout ' + label);
  await sleep(2500); // let loot settle (autoloot is globally ON)
}

(async () => {
  const A = makeClient('A', 'verify-store-A-' + suffix);
  const B = makeClient('B', 'verify-store-B-' + suffix);
  A.send({ op: 'login', deviceId: 'verify-store-A-' + suffix });
  await sleep(600);
  B.send({ op: 'login', deviceId: 'verify-store-B-' + suffix });
  await sleep(3500);
  A.send({ op: 'enterChar', slot: 0 });
  await sleep(500);
  B.send({ op: 'enterChar', slot: 0 });
  await waitFor(() => A.state.me && B.state.me, 60000, 'enterWorld both');
  console.log('[A]', A.state.me.name, '| [B]', B.state.me.name);
  await waitFor(
    () => B.state.players.find((p) => p.name === A.state.me.name) && A.state.players.find((p) => p.name === B.state.me.name),
    30000, 'A and B see each other'
  );
  const aAsSeenByB = () => B.state.players.find((p) => p.name === A.state.me.name);
  await waitFor(() => A.state.items.length > 0 && B.state.items.length > 0, 15000, 'itemList both');
  await sleep(3000); // npc stream for B's hunt

  // --- 1. B earns adena for the purchase ---
  console.log(`1. B earns adena (needs ${PRICE})...`);
  for (let i = 0; i < 4 && B.state.adena < PRICE; i++) await killGremlin(B, `adena ${B.state.adena}/${PRICE}`);
  console.log(`   B adena: ${B.state.adena}`);
  if (B.state.adena < PRICE) throw new Error('B could not earn enough adena');

  // --- 2. A opens the sell manage view ---
  console.log('2. A: storeManageSell...');
  const guide = A.state.items.find((i) => i.itemId === GUIDE_ID);
  if (!guide) throw new Error('A has no Tutorial Guide');
  A.send({ op: 'storeManageSell' });
  const msg = await waitFor(() => A.state.storeMsgSell[0], 10000, 'storeMsgSell at A');
  const sellableOk = (msg.sellables || []).some((i) => i.itemId === GUIDE_ID);
  console.log(`   storeMsgSell sellables include Tutorial Guide: ${sellableOk}`);

  // --- 3. A sets the list + title (this OPENS the store) ---
  console.log(`3. A: storeSetSell guide x1 @ ${PRICE}, title "${TITLE}"...`);
  A.send({ op: 'storeSetSell', items: [{ objectId: guide.objectId, count: 1, price: PRICE }], title: TITLE });
  const open1 = await waitFor(() => A.state.storeStates.find((s) => s.open), 10000, 'storeState open at A');
  const openOk = open1.type === 'sell';
  console.log(`   A storeState{open:true,type:'sell'}: ${openOk}`);

  // --- 4. B clicks A's store ---
  console.log('4. B walks to A and clicks the store (talk)...');
  const aPosB = aAsSeenByB();
  B.send({ op: 'moveTo', x: aPosB.x, y: aPosB.y, z: aPosB.z });
  await sleep(3000);
  B.send({ op: 'talk', id: aPosB.id });
  const ps = await waitFor(() => B.state.playerStores[0], 15000, 'playerStore at B');
  const psOk = ps.id === aPosB.id && ps.type === 'sell' && ps.title === TITLE &&
    ps.items.some((i) => i.objectId === guide.objectId && i.itemId === GUIDE_ID && i.price === PRICE);
  console.log(`   playerStore id/type/title/item+price ok: ${psOk}`);

  // --- 5. B buys the guide ---
  console.log('5. B: storeBuy the guide...');
  const adenaA0 = A.state.adena;
  const adenaB0 = B.state.adena;
  const invMarkA = A.state.invUpdates.length;
  const invMarkB = B.state.invUpdates.length;
  B.send({ op: 'storeBuy', storeId: aPosB.id, items: [{ objectId: guide.objectId, count: 1 }] });
  const bGot = await waitFor(() => B.state.invUpdates.slice(invMarkB).flatMap((u) => u.updated)
    .find((i) => i.itemId === GUIDE_ID && i.change === 'add'), 15000, 'B invUpdate add guide');
  const aLost = await waitFor(() => A.state.invUpdates.slice(invMarkA).flatMap((u) => u.updated)
    .find((i) => i.objectId === guide.objectId && i.change === 'remove'), 15000, 'A invUpdate remove guide');
  await waitFor(() => B.state.adena === adenaB0 - PRICE && A.state.adena === adenaA0 + PRICE, 15000, 'adena exact movement');
  const moneyOk = B.state.adena === adenaB0 - PRICE && A.state.adena === adenaA0 + PRICE;
  console.log(`   guide A->B (remove at A, add at B): ok; adena B ${adenaB0}->${B.state.adena}, A ${adenaA0}->${A.state.adena} (exact ${PRICE}: ${moneyOk})`);
  // The store held only the guide: it auto-closes on sell-out.
  const autoClose = await waitFor(() => A.state.storeStates.filter((s) => !s.open)[0], 15000, 'storeState auto-close at A');
  console.log('   store auto-closed after sell-out (storeState{open:false}):', !!autoClose);

  // --- 6. re-list + storeStop -> B can no longer buy ---
  // aCis quirk (Player.canOpenPrivateStore): after a store closes the player
  // stays SITTING, and opening a store while sitting-and-not-in-store-mode
  // is SILENTLY refused. Stand up first (RequestActionUse 0 toggles).
  console.log('6. A stands up, re-lists (adena), then storeStop...');
  A.send({ op: 'action', actionId: 0 });
  await sleep(2000);
  const adenaA = A.state.items.find((i) => i.itemId === ADENA_ID) ||
    A.state.invUpdates.flatMap((u) => u.updated).filter((i) => i.itemId === ADENA_ID).slice(-1)[0];
  A.send({ op: 'storeManageSell' });
  await sleep(1500);
  A.send({ op: 'storeSetSell', items: [{ objectId: adenaA.objectId, count: 2, price: 1 }], title: 'Adena barata' });
  await waitFor(() => A.state.storeStates.filter((s) => s.open).length > 1, 10000, 'storeState open (2nd)');
  A.send({ op: 'storeStop' });
  await waitFor(() => A.state.storeStates.filter((s) => !s.open).length > 1, 10000, 'storeState close via storeStop');
  console.log('   storeState{open:false} after storeStop: ok');
  const psMark = B.state.playerStores.length;
  const invMarkB2 = B.state.invUpdates.length;
  B.send({ op: 'talk', id: aPosB.id });
  await sleep(5000);
  const noListAfterStop = B.state.playerStores.length === psMark;
  B.send({ op: 'storeBuy', storeId: aPosB.id, items: [{ objectId: guide.objectId, count: 1 }] });
  await sleep(4000);
  const nothingMoved = !B.state.invUpdates.slice(invMarkB2).flatMap((u) => u.updated)
    .some((i) => i.itemId === GUIDE_ID && i.change === 'add');
  console.log(`   after stop: no playerStore on click (${noListAfterStop}), storeBuy moves nothing (${nothingMoved})`);

  // --- 7. .offline tie-in: store persists for observers ---
  console.log('7. A stands up, re-lists and goes .offline; B checks persistence...');
  A.send({ op: 'action', actionId: 0 });
  await sleep(2000);
  A.send({ op: 'storeManageSell' });
  await sleep(1500);
  A.send({ op: 'storeSetSell', items: [{ objectId: adenaA.objectId, count: 2, price: 1 }], title: TITLE2 });
  await waitFor(() => A.state.storeStates.filter((s) => s.open).length > 2, 10000, 'storeState open (3rd)');
  A.send({ op: 'say', channel: 0, text: '.offline' });
  await waitFor(() => A.state.closed, 30000, 'A disconnected by .offline');
  console.log('   A disconnected (.offline accepted the sell-store)');
  await sleep(5000);
  const stillVisible = !B.state.removedIds.has(aPosB.id);
  B.send({ op: 'talk', id: aPosB.id });
  const psOffline = await waitFor(() => B.state.playerStores.slice(psMark)[0], 15000, 'playerStore of offline trader');
  const persistOk = stillVisible && psOffline.type === 'sell' && psOffline.title === TITLE2 &&
    psOffline.items.some((i) => i.itemId === ADENA_ID && i.price === 1);
  console.log(`   B still sees A: ${stillVisible}; offline store opens with title "${psOffline.title}": ${persistOk}`);

  console.log('---');
  const pass = sellableOk && openOk && psOk && !!bGot && !!aLost && moneyOk && !!autoClose &&
    noListAfterStop && nothingMoved && persistOk;
  console.log(pass ? 'VERIFY-STORE: PASS' : 'VERIFY-STORE: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-STORE: FAIL', e.stack || e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-STORE: global timeout'); process.exit(1); }, 420000);
