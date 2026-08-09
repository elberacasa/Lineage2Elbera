// Two concurrent WS clients must see each other: addPlayer both ways,
// movement broadcast of A seen by B, chat from A relayed to B.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, deviceId) {
  const c = {
    name,
    ws: new WebSocket(url),
    state: { authOk: null, me: null, sawPlayer: null, sawMove: null, sawChat: null },
  };
  c.queue = [];
  c.send = (obj) => {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(obj));
    else c.queue.push(obj);
  };
  c.ws.on('open', () => {
    for (const obj of c.queue.splice(0)) c.ws.send(JSON.stringify(obj));
  });
  c.ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.op === 'auth_ok') c.state.authOk = msg;
    else if (msg.op === 'enterWorld') c.state.me = msg.char;
    else if (msg.op === 'addPlayer') {
      if (!c.state.sawPlayer) console.log(`[${name}] addPlayer:`, JSON.stringify(msg));
      c.state.sawPlayer = c.state.sawPlayer || msg;
      c.state['player_' + msg.name] = msg;
    } else if (msg.op === 'move') {
      c.state.sawMove = c.state.sawMove || msg;
      c.state['move_' + msg.id] = msg;
    } else if (msg.op === 'chat') {
      console.log(`[${name}] chat:`, JSON.stringify(msg));
      c.state.sawChat = c.state.sawChat || msg;
    }
  });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
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
  const A = makeClient('A', 'verify-two-A-' + suffix);
  const B = makeClient('B', 'verify-two-B-' + suffix);

  // Login both (staggered slightly to keep logs readable).
  A.send({ op: 'login', deviceId: 'verify-two-A-' + suffix });
  await sleep(500);
  B.send({ op: 'login', deviceId: 'verify-two-B-' + suffix });

  // Poll instead of fixed sleeps: first-login char creation can take ~3s
  // under load (flaked the 2026-07-28 battery twice in a row).
  await waitFor(() => A.state.authOk && B.state.authOk, 30000, 'auth_ok both');
  console.log('[A] chars:', JSON.stringify(A.state.authOk.chars));
  console.log('[B] chars:', JSON.stringify(B.state.authOk.chars));

  A.send({ op: 'enterChar', slot: 0 });
  await sleep(400);
  B.send({ op: 'enterChar', slot: 0 });

  await waitFor(() => A.state.me && B.state.me, 30000, 'enterWorld both');
  console.log('[A] in world as', A.state.me.name, 'at', A.state.me.x, A.state.me.y, A.state.me.z);
  console.log('[B] in world as', B.state.me.name, 'at', B.state.me.x, B.state.me.y, B.state.me.z);

  const aName = A.state.me.name;
  const bName = B.state.me.name;

  // A moves; B must receive the broadcast.
  const target = { x: A.state.me.x + 500, y: A.state.me.y + 200, z: A.state.me.z };
  console.log(`[A] moveTo ${target.x},${target.y},${target.z}`);
  A.send({ op: 'moveTo', ...target });
  await sleep(3000);

  // A says something; B must receive it.
  A.send({ op: 'say', channel: 0, text: 'hola B, soy A' });
  await sleep(2000);

  const bSeesA = B.state['player_' + aName];
  const aSeesB = A.state['player_' + bName];
  const bMoveFromA = bSeesA && B.state['move_' + bSeesA.id];
  console.log('move B received from A:', JSON.stringify(bMoveFromA), 'expected target:', JSON.stringify(target));
  const moveMatches = bMoveFromA &&
    Math.abs(bMoveFromA.tx - target.x) <= 30 && Math.abs(bMoveFromA.ty - target.y) <= 30;
  const bChatFromA = B.state.sawChat && B.state.sawChat.from === aName && B.state.sawChat.text === 'hola B, soy A';

  console.log('---');
  console.log(`B sees A (addPlayer): ${!!bSeesA}`);
  console.log(`A sees B (addPlayer): ${!!aSeesB}`);
  console.log(`B received move from A: ${!!bMoveFromA} matches target: ${!!moveMatches}`);
  console.log(`B received chat from A: ${!!bChatFromA}`);
  const pass = bSeesA && aSeesB && bMoveFromA && moveMatches && bChatFromA;
  console.log(pass ? 'VERIFY-TWO: PASS' : 'VERIFY-TWO: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-TWO: FAIL', e.stack || e.message); process.exit(1); });
