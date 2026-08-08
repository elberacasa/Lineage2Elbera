// CharInfo attack-timing fields, live: two clients enter the world, the second
// walks to the first, and the resulting addPlayer op is checked for the fields
// the gateway now reads out of CharInfo (pAtkSpd, mAtkSpd, atkSpdMul, running).
//
// Offset proof, same as verify-atkspeed.js: 1.1 * pAtkSpd / atkSpdMul must come
// out as the player template's basePAtkSpd, which CreatureTemplate defaults to
// exactly 300 and no class XML overrides.
//
// Usage: node test/verify-charinfo-atk.js
'use strict';

const WebSocket = require('ws');
const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();

function client(name) {
  const st = { name, me: null, players: [], ws: null, entered: null };
  const ws = new WebSocket(url);
  st.ws = ws;
  ws.on('error', (e) => { console.error(`${name} ws error:`, e.message); process.exit(1); });
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId: `charinfo-${name}-${stamp}` })));
  st.entered = new Promise((resolve) => {
    ws.on('message', async (data) => {
      const msg = JSON.parse(data);
      if (msg.op === 'auth_ok') { await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); }
      else if (msg.op === 'enterWorld') { st.me = msg.char; resolve(msg.char); }
      else if (msg.op === 'addPlayer') st.players.push(msg);
    });
  });
  return st;
}

(async () => {
  const fail = [], pass = [];
  const check = (ok, m) => (ok ? pass : fail).push(m);

  const A = client('A');
  await A.entered;
  await sleep(2000);
  // The 400 ms outbound governor plus the IPv4Filter make back-to-back logins
  // risky; give the second client its own window.
  const B = client('B');
  await B.entered;
  await sleep(2000);

  console.log(`A at ${A.me.x},${A.me.y}  B at ${B.me.x},${B.me.y}`);

  // Walk B onto A in straight legs until A shows up in B's addPlayer stream.
  let bx = B.me.x, by = B.me.y;
  for (let i = 0; i < 12 && !B.players.some((p) => p.id === A.me.id); i++) {
    const dx = A.me.x - bx, dy = A.me.y - by;
    const d = Math.hypot(dx, dy) || 1;
    const leg = Math.min(d, 400);
    bx += (dx / d) * leg; by += (dy / d) * leg;
    B.ws.send(JSON.stringify({ op: 'moveTo', x: bx | 0, y: by | 0, z: A.me.z | 0 }));
    await sleep((leg / 115) * 1000 + 1200);
  }

  const seen = B.players.filter((p) => p.id === A.me.id);
  const p = seen[seen.length - 1];
  console.log('addPlayer(A) as seen by B:', JSON.stringify(p));
  check(!!p, 'B received an addPlayer for A');
  if (p) {
    check(p.pAtkSpd > 0, `addPlayer.pAtkSpd > 0 (${p.pAtkSpd})`);
    check(p.mAtkSpd > 0, `addPlayer.mAtkSpd > 0 (${p.mAtkSpd})`);
    const base = (1.1 * p.pAtkSpd) / p.atkSpdMul;
    check(Math.abs(base - 300) < 0.01,
      `implied basePAtkSpd == 300 -> CharInfo atkSpdMul read at the right offset (${base.toFixed(4)})`);
    check(p.running === true,
      `addPlayer.running === true (CharInfo isRunning; setRunning(true) at entry) (${p.running})`);
    console.log(`  -> A's attack cycle = ${Math.max(100, Math.floor(500000 / p.pAtkSpd))} ms, swing rate ${p.atkSpdMul}`);
  }

  for (const m of pass) console.log('  PASS', m);
  for (const m of fail) console.log('  FAIL', m);
  console.log(fail.length ? `\nRESULT: FAIL (${fail.length})` : `\nRESULT: PASS (${pass.length})`);
  A.ws.close(); B.ws.close();
  process.exit(fail.length ? 1 : 0);
})();
