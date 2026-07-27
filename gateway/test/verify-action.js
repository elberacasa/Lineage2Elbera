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

  // 3. socials via ACTIONNAME UI ids (must map to aCis social ids), and a
  // non-social actionname id in 2..13 (Attack=2) which must NOT produce a
  // SocialAction broadcast.
  const SOCIAL_CASES = [
    { ui: 12, server: 2, name: 'Greeting' },
    { ui: 13, server: 3, name: 'Victory' },
    { ui: 26, server: 7, name: 'Bow' },
  ];
  console.log('3. socials (uiId -> packet -> serverId -> name):');
  for (const c of SOCIAL_CASES) {
    A.send({ op: 'action', actionId: c.ui });
    await sleep(3200); // the server ignores socials while a previous emote plays
    const seen = B.state.socials.find((s) => s.id === aId && s.actionId === c.server);
    const wrong = B.state.socials.find((s) => s.id === aId && s.actionId === c.ui && c.ui !== c.server);
    console.log(`   uiId=${c.ui} -> RequestSocialAction -> serverId=${c.server} -> ${c.name}: ${seen ? 'OK' : 'MISSING'}${wrong ? ' (WRONG-ID-LEAK!)' : ''}`);
    c.ok = !!seen && !wrong;
  }

  // 4. Attack (actionname id 2) must hit RequestActionUse — never social.
  const socialMark = B.state.socials.length;
  console.log('4. non-social uiId=2 (Attack) -> RequestActionUse (expect no SocialAction)...');
  A.send({ op: 'action', actionId: 2 });
  await sleep(2500);
  const leaked = B.state.socials.slice(socialMark).find((s) => s.id === aId);
  console.log(`   SocialAction broadcast from uiId=2: ${leaked ? JSON.stringify(leaked) + ' (BUG)' : 'none (correct)'}`);

  const sitSeen = B.state.changeWaits.find((c) => c.id === aId && c.waitType === 0);
  const standSeen = B.state.changeWaits.find((c) => c.id === aId && c.waitType === 1);
  const walkSeen = B.state.changeMoves.find((c) => c.id === aId && c.running === 0);
  const runSeen = B.state.changeMoves.find((c) => c.id === aId && c.running === 1);

  console.log('---');
  console.log(`/sit via Say2 did nothing: ${!sitViaSay}`);
  console.log(`B saw A sit: ${!!sitSeen} | stand: ${!!standSeen}`);
  console.log(`B saw A walk: ${!!walkSeen} | run: ${!!runSeen}`);
  console.log(`socials mapped correctly: ${SOCIAL_CASES.every((c) => c.ok)}`);
  console.log(`non-social uiId=2 produced no social broadcast: ${!leaked}`);
  const pass = !sitViaSay && sitSeen && standSeen && walkSeen && runSeen &&
    SOCIAL_CASES.every((c) => c.ok) && !leaked;
  console.log(pass ? 'VERIFY-ACTION: PASS' : 'VERIFY-ACTION: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-ACTION: FAIL', e.message); process.exit(1); });
