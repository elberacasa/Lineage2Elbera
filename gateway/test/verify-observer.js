// M3 observer verification: client A fights a Gremlin; client B (nearby, no
// targeting) must receive the attack and die broadcasts for the combat.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, deviceId) {
  const c = { name, ws: new WebSocket(url), state: { npcs: [], attacks: [], dies: [], me: null } };
  c.queue = [];
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); else c.queue.push(o); };
  c.ws.on('open', () => { for (const o of c.queue.splice(0)) c.ws.send(JSON.stringify(o)); });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.op === 'enterWorld') c.state.me = m.char;
    else if (m.op === 'addNpc') c.state.npcs.push(m);
    else if (m.op === 'attack') c.state.attacks.push(m);
    else if (m.op === 'die') c.state.dies.push(m);
    else if (m.op === 'addPlayer') console.log(`[${name}] addPlayer:`, m.name);
  });
  return c;
}

(async () => {
  const A = makeClient('A', 'verify-obs-A-' + suffix);
  const B = makeClient('B', 'verify-obs-B-' + suffix);
  A.send({ op: 'login', deviceId: 'verify-obs-A-' + suffix });
  await sleep(600);
  B.send({ op: 'login', deviceId: 'verify-obs-B-' + suffix });
  await sleep(3500);
  A.send({ op: 'enterChar', slot: 0 });
  await sleep(500);
  B.send({ op: 'enterChar', slot: 0 });
  await sleep(5000);
  if (!A.state.me || !B.state.me) throw new Error('enterWorld missing');
  console.log('[A] in world:', A.state.me.name, 'id', A.state.me.id);
  console.log('[B] in world:', B.state.me.name, 'id', B.state.me.id);

  // A picks the nearest Gremlin and fights it.
  const g = A.state.npcs
    .filter((n) => n.name === 'Gremlin')
    .map((n) => ({ ...n, dist: Math.hypot(n.x - A.state.me.x, n.y - A.state.me.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (!g) throw new Error('no Gremlin near A');
  console.log(`[A] fights Gremlin id=${g.id} (dist ${g.dist | 0})`);
  A.send({ op: 'target', id: g.id });
  await sleep(800);
  A.send({ op: 'attack', id: g.id });

  const t0 = Date.now();
  const died = () => A.state.dies.some((d) => d.id === g.id);
  while (!died() && Date.now() - t0 < 150000) {
    await sleep(5000);
    if (!died()) A.send({ op: 'attack', id: g.id });
  }
  await sleep(3000); // let B's broadcasts arrive

  const aDealt = A.state.attacks.filter((a) => a.id === A.state.me.id && a.targetId === g.id && a.damage > 0);
  const bSawAAttacks = B.state.attacks.filter((a) => a.id === A.state.me.id && a.targetId === g.id);
  const bSawNpcAttacks = B.state.attacks.filter((a) => a.id === g.id);
  const bSawDie = B.state.dies.find((d) => d.id === g.id);

  console.log('---');
  console.log(`A dealt ${aDealt.length} hits (first: ${JSON.stringify(aDealt[0])})`);
  console.log(`B saw A's attacks: ${bSawAAttacks.length} (first: ${JSON.stringify(bSawAAttacks[0])})`);
  console.log(`B saw Gremlin's attacks: ${bSawNpcAttacks.length}`);
  console.log(`B saw die broadcast for Gremlin: ${!!bSawDie}`);
  const pass = aDealt.length > 0 && bSawAAttacks.length > 0 && !!bSawDie;
  console.log(pass ? 'VERIFY-OBSERVER: PASS' : 'VERIFY-OBSERVER: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-OBSERVER: FAIL', e.stack || e.message); process.exit(1); });
