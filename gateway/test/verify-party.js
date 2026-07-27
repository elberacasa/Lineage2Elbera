// Party protocol verification (two sessions):
//  1. A invites B -> B gets partyAsk{from:A} -> B REFUSES -> no party.
//  2. A invites again -> B ACCEPTS -> both get party{2 members, leader=A}.
//  3. B takes damage from a Gremlin -> A sees partyMemberStatus for B (hp drop).
//  4. A kicks B -> both get empty party.
//  5. A invites + B accepts + B leaves -> both get empty party.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, deviceId) {
  const c = {
    name,
    ws: new WebSocket(url),
    state: { me: null, npcs: [], moves: new Map(), diedIds: new Set(), asks: [], parties: [], statuses: [] },
  };
  c.queue = [];
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); else c.queue.push(o); };
  c.ws.on('open', () => { for (const o of c.queue.splice(0)) c.ws.send(JSON.stringify(o)); });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.op === 'enterWorld') c.state.me = m.char;
    else if (m.op === 'addNpc') c.state.npcs.push(m);
    else if (m.op === 'move') c.state.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz });
    else if (m.op === 'die') c.state.diedIds.add(m.id);
    else if (m.op === 'partyAsk') { c.state.asks.push(m); console.log(`[${name}] partyAsk:`, JSON.stringify(m)); }
    else if (m.op === 'party') { c.state.parties.push(m); console.log(`[${name}] party:`, JSON.stringify(m)); }
    else if (m.op === 'partyMemberStatus') { c.state.statuses.push(m); console.log(`[${name}] partyMemberStatus:`, JSON.stringify(m)); }
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
  const A = makeClient('A', 'verify-party-A-' + suffix);
  const B = makeClient('B', 'verify-party-B-' + suffix);
  A.send({ op: 'login', deviceId: 'verify-party-A-' + suffix });
  await sleep(600);
  B.send({ op: 'login', deviceId: 'verify-party-B-' + suffix });
  await sleep(3500);
  A.send({ op: 'enterChar', slot: 0 });
  await sleep(500);
  B.send({ op: 'enterChar', slot: 0 });
  await waitFor(() => A.state.me && B.state.me, 60000, 'enterWorld both');
  await sleep(3000);
  console.log('[A]', A.state.me.name, '| [B]', B.state.me.name);

  // --- 1. invite + REFUSE ---
  console.log('1. A invites B, B refuses...');
  A.send({ op: 'partyInvite', name: B.state.me.name });
  await waitFor(() => B.state.asks.length > 0, 10000, 'partyAsk at B');
  const askOk = B.state.asks[0].from === A.state.me.name;
  console.log('   partyAsk.from === A name:', askOk);
  B.send({ op: 'partyAnswer', accept: 0 });
  await sleep(3000);
  const noParty = A.state.parties.length === 0 && B.state.parties.length === 0;
  console.log('   no party after refuse:', noParty);

  // --- 2. invite + ACCEPT ---
  console.log('2. A invites again, B accepts...');
  A.send({ op: 'partyInvite', name: B.state.me.name });
  await waitFor(() => B.state.asks.length > 1, 10000, 'second partyAsk');
  B.send({ op: 'partyAnswer', accept: 1 });
  const pa = await waitFor(() => A.state.parties.find((p) => p.members.length === 2), 10000, 'party snapshot at A');
  const pb = await waitFor(() => B.state.parties.find((p) => p.members.length === 2), 10000, 'party snapshot at B');
  const leaderA = pa.members.find((m) => m.leader);
  const compOk =
    pa.members.some((m) => m.name === A.state.me.name) && pa.members.some((m) => m.name === B.state.me.name) &&
    leaderA && leaderA.name === A.state.me.name;
  console.log('   A snapshot:', JSON.stringify(pa.members.map((m) => `${m.name}${m.leader ? '(L)' : ''} lvl${m.level} cls${m.classId} ${m.hp}/${m.maxHp}`)));
  console.log('   B snapshot:', JSON.stringify(pb.members.map((m) => `${m.name}${m.leader ? '(L)' : ''}`)));
  console.log('   composition + leader flag ok:', compOk);

  // --- 3. B takes damage -> A sees partyMemberStatus for B ---
  console.log('3. B fights a Gremlin (takes hits)...');
  const g = B.state.npcs
    .filter((n) => n.name === 'Gremlin' && !B.state.diedIds.has(n.id))
    .map((n) => ({ ...n, dist: Math.hypot(n.x - B.state.me.x, n.y - B.state.me.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  const bPos = () => B.state.moves.get(B.state.me.id) || B.state.me;
  const t0 = Date.now();
  let hpDrop = null;
  while (!hpDrop && Date.now() - t0 < 120000 && !B.state.diedIds.has(B.state.me.id)) {
    const pos = B.state.moves.get(g.id) || g;
    const me = bPos();
    B.send({ op: 'moveTo', x: pos.x + 20, y: pos.y, z: pos.z });
    await sleep(Math.min(10000, (Math.hypot(pos.x - me.x, pos.y - me.y) / 115) * 1000 + 2000));
    const t1 = Date.now();
    while (!hpDrop && Date.now() - t1 < 12000) {
      B.send({ op: 'attack', id: g.id });
      await sleep(3500);
      hpDrop = A.state.statuses.find((s) => s.id === B.state.me.id && s.hp < s.maxHp);
    }
  }
  if (!hpDrop) throw new Error('partyMemberStatus hp drop at A');
  console.log('   A sees B hp drop:', hpDrop.hp, '/', hpDrop.maxHp);

  // --- 4. A kicks B ---
  console.log('4. A kicks B...');
  const markA = A.state.parties.length;
  const markB = B.state.parties.length;
  A.send({ op: 'partyKick', name: B.state.me.name });
  const emptyA = await waitFor(() => A.state.parties.slice(markA).find((p) => p.members.length === 0), 10000, 'empty party at A');
  const emptyB = await waitFor(() => B.state.parties.slice(markB).find((p) => p.members.length === 0), 10000, 'empty party at B');
  console.log('   both got empty party:', !!emptyA && !!emptyB);

  // --- 5. invite + accept + B LEAVES ---
  console.log('5. re-invite, accept, B leaves...');
  A.send({ op: 'partyInvite', name: B.state.me.name });
  await waitFor(() => B.state.asks.length > 2, 10000, 'third partyAsk');
  B.send({ op: 'partyAnswer', accept: 1 });
  await waitFor(() => B.state.parties[B.state.parties.length - 1]?.members.length === 2, 10000, 'party reformed');
  const markB2 = B.state.parties.length;
  B.send({ op: 'partyLeave' });
  const emptyB2 = await waitFor(() => B.state.parties.slice(markB2).find((p) => p.members.length === 0), 10000, 'empty after leave');
  console.log('   B empty after leaving:', !!emptyB2);

  console.log('---');
  const pass = askOk && noParty && compOk && !!hpDrop && !!emptyA && !!emptyB && !!emptyB2;
  console.log(pass ? 'VERIFY-PARTY: PASS' : 'VERIFY-PARTY: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-PARTY: FAIL', e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-PARTY: global timeout'); process.exit(1); }, 300000);
