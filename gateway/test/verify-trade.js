// Player-to-player trade verification (two sessions):
//  1. REFUSE: A requests trade with B -> B gets tradeAsk{from:A} -> B
//     refuses -> A gets sysMsg 119 (S1_DENIED_TRADE_REQUEST), no tradeStart.
//  2. CANCEL: A requests -> B accepts -> tradeStart on both -> A adds its
//     starter Dagger -> A sees tradeOwn, B sees tradeOther -> A cancels ->
//     both get tradeEnd{reason:'cancel'} -> nothing moves.
//  3. DONE: request -> accept -> A adds the item -> BOTH confirm
//     (two-phase TradeDone) -> both get tradeEnd{reason:'done'} -> the
//     item actually moves: A invUpdate-remove, B invUpdate-add.
// Item used: whatever the TradeStart snapshot offers (aCis getAvailableItems
// — starter equipment is is_tradable=false; the Tutorial Guide 5588 is the
// one tradable starter item on a fresh Human Fighter).
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, deviceId) {
  const c = {
    name,
    ws: new WebSocket(url),
    state: {
      me: null, players: [], items: [], asks: [], starts: [],
      ownAdds: [], otherAdds: [], ends: [], sys: [], invUpdates: [],
    },
  };
  c.queue = [];
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); else c.queue.push(o); };
  c.ws.on('open', () => { for (const o of c.queue.splice(0)) c.ws.send(JSON.stringify(o)); });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.op === 'enterWorld') c.state.me = m.char;
    else if (m.op === 'addPlayer') c.state.players.push(m);
    else if (m.op === 'itemList') c.state.items = m.items;
    else if (m.op === 'tradeAsk') { c.state.asks.push(m); console.log(`[${name}] tradeAsk:`, JSON.stringify(m)); }
    else if (m.op === 'tradeStart') { c.state.starts.push(m); console.log(`[${name}] tradeStart: partner=${m.partner} items=${m.items.length}`); }
    else if (m.op === 'tradeOwn') { c.state.ownAdds.push(m); console.log(`[${name}] tradeOwn:`, JSON.stringify(m.items)); }
    else if (m.op === 'tradeOther') { c.state.otherAdds.push(m); console.log(`[${name}] tradeOther:`, JSON.stringify(m.items)); }
    else if (m.op === 'tradeEnd') { c.state.ends.push(m); console.log(`[${name}] tradeEnd:`, JSON.stringify(m)); }
    else if (m.op === 'sysMsg') c.state.sys.push(m);
    else if (m.op === 'invUpdate') c.state.invUpdates.push(m);
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

(async () => {
  const A = makeClient('A', 'verify-trade-A-' + suffix);
  const B = makeClient('B', 'verify-trade-B-' + suffix);
  A.send({ op: 'login', deviceId: 'verify-trade-A-' + suffix });
  await sleep(600);
  B.send({ op: 'login', deviceId: 'verify-trade-B-' + suffix });
  await sleep(3500);
  A.send({ op: 'enterChar', slot: 0 });
  await sleep(500);
  B.send({ op: 'enterChar', slot: 0 });
  await waitFor(() => A.state.me && B.state.me, 60000, 'enterWorld both');
  console.log('[A]', A.state.me.name, '| [B]', B.state.me.name);

  // aCis TradeRequest requires player.knows(target): A must SEE B.
  await waitFor(
    () => A.state.players.find((p) => p.name === B.state.me.name),
    30000, 'A sees B (addPlayer)'
  );
  console.log('   A sees B (knows-check prerequisite): ok');
  await waitFor(() => A.state.items.length > 0 && B.state.items.length > 0, 15000, 'itemList both');

  // The tradable test item comes from the TradeStart snapshot itself: aCis
  // TradeStart = getAvailableItems(allowAdena, !allowNonTradeable,
  // !allowStoreBuy) — the server-authoritative list of what can be offered.
  // (Starter equipment — Dagger 10, Squire's set — is is_tradable=false in
  // the datapack; the only tradable starter item is the Tutorial Guide 5588.)
  const offered = (st) => st.items[0];

  // --- 1. request + REFUSE ---
  console.log('1. A requests trade with B, B refuses...');
  A.send({ op: 'tradeRequest', name: B.state.me.name });
  const ask1 = await waitFor(() => B.state.asks[0], 10000, 'tradeAsk at B');
  const askOk = ask1.from === A.state.me.name;
  console.log('   tradeAsk.from === A name:', askOk);
  B.send({ op: 'tradeAnswer', accept: 0 });
  const denied = await waitFor(() => A.state.sys.find((s) => s.id === 119), 10000, 'sysMsg 119 (denied) at A');
  console.log('   A got sysMsg 119 S1_DENIED_TRADE_REQUEST:', !!denied);
  await sleep(2000);
  const noStart = A.state.starts.length === 0 && B.state.starts.length === 0;
  console.log('   no tradeStart after refuse:', noStart);

  // --- 2. accept + CANCEL ---
  console.log('2. A requests, B accepts, A adds an item, A cancels...');
  A.send({ op: 'tradeRequest', name: B.state.me.name });
  await waitFor(() => B.state.asks.length > 1, 10000, 'second tradeAsk');
  B.send({ op: 'tradeAnswer', accept: 1 });
  const stA = await waitFor(() => A.state.starts[0], 10000, 'tradeStart at A');
  const stB = await waitFor(() => B.state.starts[0], 10000, 'tradeStart at B');
  const startOk =
    stA.partner === B.state.me.name && stB.partner === A.state.me.name &&
    stA.items.length > 0;
  console.log('   tradeStart partner names + own inventory snapshot ok:', startOk);
  if (!startOk) throw new Error('tradeStart contents wrong');

  const it = offered(stA);
  console.log(`   offering itemId ${it.itemId} (objectId ${it.objectId})`);
  const addCount = 1; // one unit of the item
  A.send({ op: 'tradeAdd', objectId: it.objectId, count: addCount });
  const ownA = await waitFor(
    () => A.state.ownAdds.flatMap((o) => o.items).find((i) => i.objectId === it.objectId),
    10000, 'tradeOwn at A'
  );
  const otherB = await waitFor(
    () => B.state.otherAdds.flatMap((o) => o.items).find((i) => i.objectId === it.objectId),
    10000, 'tradeOther at B'
  );
  const addOk = ownA.itemId === it.itemId && ownA.count === addCount &&
    otherB.itemId === it.itemId && otherB.count === addCount;
  console.log(`   A tradeOwn + B tradeOther for ${it.itemId} x${addCount}: ok=${addOk}`);

  const invMarkA = A.state.invUpdates.length;
  const invMarkB = B.state.invUpdates.length;
  A.send({ op: 'tradeCancel' });
  const endA1 = await waitFor(() => A.state.ends[0], 10000, 'tradeEnd at A');
  const endB1 = await waitFor(() => B.state.ends[0], 10000, 'tradeEnd at B');
  const cancelOk = endA1.reason === 'cancel' && endB1.reason === 'cancel';
  console.log('   both tradeEnd reason=cancel:', cancelOk);
  await sleep(2000);
  const nothingMoved =
    !A.state.invUpdates.slice(invMarkA).flatMap((u) => u.updated).some((i) => i.objectId === it.objectId && i.change === 'remove') &&
    !B.state.invUpdates.slice(invMarkB).flatMap((u) => u.updated).some((i) => i.itemId === it.itemId && i.change === 'add');
  console.log('   nothing moved after cancel:', nothingMoved);

  // --- 3. accept + BOTH CONFIRM -> exchange ---
  console.log('3. A requests, B accepts, A adds the item, BOTH confirm...');
  A.send({ op: 'tradeRequest', name: B.state.me.name });
  await waitFor(() => B.state.asks.length > 2, 10000, 'third tradeAsk');
  B.send({ op: 'tradeAnswer', accept: 1 });
  await waitFor(() => A.state.starts.length > 1 && B.state.starts.length > 1, 10000, 'tradeStart both (2nd session)');
  const it2 = offered(A.state.starts[1]); // same item, still in A's inventory
  console.log(`   re-offering itemId ${it2.itemId} (objectId ${it2.objectId})`);
  A.send({ op: 'tradeAdd', objectId: it2.objectId, count: 1 });
  await waitFor(
    () => B.state.otherAdds.flatMap((o) => o.items).filter((i) => i.objectId === it2.objectId).length > 1,
    10000, 'tradeOther at B (2nd session)'
  );

  const invMarkA2 = A.state.invUpdates.length;
  const invMarkB2 = B.state.invUpdates.length;
  const endMarkA = A.state.ends.length;
  const endMarkB = B.state.ends.length;
  A.send({ op: 'tradeDone' });
  await sleep(1500); // two-phase: first confirm alone must NOT close the trade
  const noPrematureEnd = A.state.ends.length === endMarkA && B.state.ends.length === endMarkB;
  console.log('   no tradeEnd after only one confirm (two-phase):', noPrematureEnd);
  B.send({ op: 'tradeDone' });
  const endA2 = await waitFor(() => A.state.ends[endMarkA], 10000, 'tradeEnd done at A');
  const endB2 = await waitFor(() => B.state.ends[endMarkB], 10000, 'tradeEnd done at B');
  const doneOk = endA2.reason === 'done' && endB2.reason === 'done';
  console.log('   both tradeEnd reason=done:', doneOk);

  // Item actually moved: A loses it (invUpdate remove/modify), B gains it (add).
  const aLost = await waitFor(() => A.state.invUpdates.slice(invMarkA2).flatMap((u) => u.updated)
    .find((i) => i.objectId === it2.objectId && (i.change === 'remove' || (i.change === 'modify' && i.count === it2.count - 1))),
    10000, 'A loses the item (invUpdate)');
  const bGained = await waitFor(() => B.state.invUpdates.slice(invMarkB2).flatMap((u) => u.updated)
    .find((i) => i.itemId === it2.itemId && i.change === 'add'),
    10000, 'B gains the item (invUpdate)');
  console.log(`   A invUpdate: ${aLost.change} ${it2.itemId} (count now ${aLost.count}); B invUpdate: add ${bGained.itemId} x${bGained.count}`);
  const movedOk = !!aLost && !!bGained;

  console.log('---');
  const pass = askOk && !!denied && noStart && startOk && addOk && cancelOk && nothingMoved &&
    noPrematureEnd && doneOk && movedOk;
  console.log(pass ? 'VERIFY-TRADE: PASS' : 'VERIFY-TRADE: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-TRADE: FAIL', e.stack || e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-TRADE: global timeout'); process.exit(1); }, 300000);
