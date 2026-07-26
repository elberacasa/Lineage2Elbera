// Action op verification: A sits/stands, toggles walk/run, does a social
// (Bow); observer B must see changeWait/changeMove/socialAction broadcasts.
// Also proves "/sit" via Say2 does NOTHING in aCis (canonical = packet).
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, deviceId) {
  const c = { name, ws: new WebSocket(url), state: { me: null, changeWaits: [], changeMoves: [], socials: [], sysMark: [] } };
  c.queue = [];
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); else c.queue.push(o); };
  c.ws.on('open', () => { for (const o of c.queue.splice(0)) c.ws.send(JSON.stringify(o)); });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.op === 'enterWorld') c.state.me = m.char;
    else if (m.op === 'changeWait') { c.state.changeWaits.push(m); console.log(`[${name}] changeWait:`, JSON.stringify(m)); }
    else if (m.op === 'changeMove') { c.state.changeMoves.push(m); console.log(`[${name}] changeMove:`, JSON.stringify(m)); }
    else if (m.op === 'socialAction') { c.state.socials.push(m); console.log(`[${name}] socialAction:`, JSON.stringify(m)); }
  });
  return c;
}

(async () => {
  const A = makeClient('A', 'verify-action-A-' + suffix);
  const B = makeClient('B', 'verify-action-B-' + suffix);
  A.send({ op: 'login', deviceId: 'verify-action-A-' + suffix });
  await sleep(600);
  B.send({ op: 'login', deviceId: 'verify-action-B-' + suffix });
  await sleep(3500);
  A.send({ op: 'enterChar', slot: 0 });
  await sleep(500);
  B.send({ op: 'enterChar', slot: 0 });
  await sleep(5000);
  if (!A.state.me || !B.state.me) throw new Error('enterWorld missing');
  console.log('[A]', A.state.me.name, 'id', A.state.me.id, '| [B]', B.state.me.name);
  const aId = A.state.me.id;

  // 0. "/sit" via Say2 must do NOTHING (no voiced command for it in aCis).
  console.log('0. say "/sit" (expect no changeWait)...');
  A.send({ op: 'say', channel: 0, text: '/sit' });
  await sleep(2500);
  const sitViaSay = B.state.changeWaits.some((c) => c.id === aId);
  console.log('   changeWait from /sit:', sitViaSay);

  // 1. sit (action 0) -> waitType 0 (WT_SITTING); stand -> waitType 1.
  console.log('1. action 0 (sit)...');
  A.send({ op: 'action', actionId: 0 });
  await sleep(2500);
  console.log('   action 0 (stand)...');
  A.send({ op: 'action', actionId: 0 });
  await sleep(2500);

  // 2. walk (action 1) -> running 0; run -> running 1.
  console.log('2. action 1 (walk)...');
  A.send({ op: 'action', actionId: 1 });
  await sleep(2500);
  console.log('   action 1 (run)...');
  A.send({ op: 'action', actionId: 1 });
  await sleep(2500);

  // 3. social Bow (social id 7) -> socialAction actionId 7.
  console.log('3. action 7 (social Bow)...');
  A.send({ op: 'action', actionId: 7 });
  await sleep(2500);

  const sitSeen = B.state.changeWaits.find((c) => c.id === aId && c.waitType === 0);
  const standSeen = B.state.changeWaits.find((c) => c.id === aId && c.waitType === 1);
  const walkSeen = B.state.changeMoves.find((c) => c.id === aId && c.running === 0);
  const runSeen = B.state.changeMoves.find((c) => c.id === aId && c.running === 1);
  const bowSeen = B.state.socials.find((s) => s.id === aId && s.actionId === 7);

  console.log('---');
  console.log(`/sit via Say2 did nothing: ${!sitViaSay}`);
  console.log(`B saw A sit: ${!!sitSeen} | stand: ${!!standSeen}`);
  console.log(`B saw A walk: ${!!walkSeen} | run: ${!!runSeen}`);
  console.log(`B saw A social Bow (7): ${!!bowSeen}`);
  const pass = !sitViaSay && sitSeen && standSeen && walkSeen && runSeen && bowSeen;
  console.log(pass ? 'VERIFY-ACTION: PASS' : 'VERIFY-ACTION: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-ACTION: FAIL', e.message); process.exit(1); });
