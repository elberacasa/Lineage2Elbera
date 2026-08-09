#!/usr/bin/env node
// Paired ghost test. For the SAME mob, in the SAME session:
//   phase A — target, then attack from where we stand (what the client does
//             when a player clicks a mob across the room)
//   phase B — walk into melee range ourselves, then attack again
//
// If A is a ghost and B is real for the same objectId, the mob is not a ghost
// at all: the mob is out of range and the server's reply to an out-of-range
// attack is a packet the gateway throws away.
//
// Needs a gateway started with GW_TRACE=1 so undecoded opcodes are visible:
//   cd gateway && GW_TRACE=1 GATEWAY_PORT=8092 node src/server.js
//   GATEWAY_URL=ws://127.0.0.1:8092 node gateway/test/repro-ghost-pair.js
'use strict';

const fs = require('fs');
const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8092';
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const N = +argOf('--n', 4);
const JSONOUT = argOf('--json', null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const now = () => Date.now() - t0;
const log = (...a) => console.log('[pair]', ...a);

const S = {
  me: null, selfPos: null, selfDead: false,
  npcs: new Map(), npcPos: new Map(),
  ev: [],            // {t, dir, op, id}
  results: [],
};

const ws = new WebSocket(url);
const send = (op, extra = {}) => {
  S.ev.push({ t: now(), dir: 'out', op, id: extra.id });
  ws.send(JSON.stringify({ op, ...extra }));
};
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(2); });
ws.on('open', () => send('login', { deviceId: 'ghost-pair-' + Date.now() }));

let entered;
ws.on('message', (data) => {
  const m = JSON.parse(data);
  const op = m.op === 'traceUndecoded' ? `undecoded${m.packet}` : m.op;
  if (!['addNpc', 'addPlayer', 'itemList', 'skillList', 'quest', 'charSheet'].includes(m.op)) {
    S.ev.push({ t: now(), dir: 'in', op, id: m.id, targetId: m.targetId });
  }
  switch (m.op) {
    case 'auth_ok': setTimeout(() => send('enterChar', { slot: 0 }), 400); break;
    case 'enterWorld':
      S.me = m.char; S.selfPos = { x: m.char.x, y: m.char.y, z: m.char.z };
      if (entered) entered();
      break;
    case 'addNpc': S.npcs.set(m.id, m); S.npcPos.set(m.id, { x: m.x, y: m.y, z: m.z }); break;
    case 'remove': S.npcs.delete(m.id); break;
    case 'move':
      if (m.id === S.me?.id) S.selfPos = { x: m.x, y: m.y, z: m.z };
      else S.npcPos.set(m.id, { x: m.x, y: m.y, z: m.z });
      break;
    case 'validate':
      if (m.id === S.me?.id) S.selfPos = { x: m.x, y: m.y, z: m.z };
      else S.npcPos.set(m.id, { x: m.x, y: m.y, z: m.z });
      break;
    case 'die': if (m.id === S.me?.id) { S.selfDead = true; setTimeout(() => send('respawn'), 1200); } break;
    case 'revive': if (m.id === S.me?.id) S.selfDead = false; break;
  }
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// One attack window: N swings, no walking. Returns what came back.
async function swingWindow(id, swings, gap = 2200) {
  const mark = S.ev.length;
  for (let i = 0; i < swings; i++) {
    send('attack', { id });
    await sleep(gap);
    if (S.ev.slice(mark).some((e) => e.dir === 'in' && e.op === 'attack')) break;
  }
  const w = S.ev.slice(mark);
  return {
    swingsOut: w.filter((e) => e.dir === 'out' && e.op === 'attack').length,
    attacksIn: w.filter((e) => e.dir === 'in' && e.op === 'attack').length,
    actionFailed: w.filter((e) => e.op === 'actionFailed').length,
    // the only reply an out-of-range AttackRequest gets: MoveToPawn(0x60)
    moveToPawn: w.filter((e) => e.op === 'undecoded0x60').length,
    autoAttackStart: w.filter((e) => e.op === 'undecoded0x2b').length,
    undecoded: [...new Set(w.filter((e) => e.op.startsWith('undecoded')).map((e) => e.op))],
    seq: w.map((e) => `${e.dir === 'out' ? '>' : '<'}${e.op}`).join(' '),
  };
}

async function walkTo(id, timeoutMs = 40000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const p = S.npcPos.get(id); const s = S.selfPos;
    if (!p || !s) return false;
    const d = dist(p, s);
    if (d <= 55) return true;
    const leg = Math.min(d, 150);
    send('moveTo', {
      ox: s.x | 0, oy: s.y | 0, oz: s.z | 0,
      x: (s.x + ((p.x - s.x) / d) * leg) | 0,
      y: (s.y + ((p.y - s.y) / d) * leg) | 0,
      z: p.z | 0,
    });
    await sleep(Math.min(7000, (leg / 115) * 1000 + 1800));
  }
  return dist(S.npcPos.get(id), S.selfPos) <= 90;
}

async function run() {
  await new Promise((r) => { entered = r; });
  await sleep(5000);

  const cands = [...S.npcs.values()]
    .filter((n) => /Gremlin/i.test(n.name))
    .map((n) => ({ ...n, d: dist(S.npcPos.get(n.id), S.selfPos) }))
    // deliberately the FAR ones: this is the population the shot tool
    // classified as ghosts
    .sort((a, b) => b.d - a.d)
    .slice(0, N);
  log(`candidates (farthest first): ${cands.map((c) => `${c.id}@${c.d | 0}u`).join(' ')}`);

  for (const c of cands) {
    for (let i = 0; S.selfDead && i < 40; i++) await sleep(1000);
    const dA = dist(S.npcPos.get(c.id), S.selfPos) | 0;
    send('target', { id: c.id });
    await sleep(1200);
    log(`mob ${c.id}: phase A (no walk) from ${dA}u`);
    const A = await swingWindow(c.id, 5);
    log(`   A: out=${A.swingsOut} in=${A.attacksIn} af=${A.actionFailed}`
      + ` MoveToPawn=${A.moveToPawn} undecoded=${A.undecoded}`);

    for (let i = 0; S.selfDead && i < 40; i++) await sleep(1000);
    const walked = await walkTo(c.id);
    const dB = dist(S.npcPos.get(c.id), S.selfPos) | 0;
    send('target', { id: c.id });
    await sleep(900);
    log(`mob ${c.id}: phase B (walked=${walked}) from ${dB}u`);
    const B = await swingWindow(c.id, 5);
    log(`   B: out=${B.swingsOut} in=${B.attacksIn} af=${B.actionFailed}`
      + ` MoveToPawn=${B.moveToPawn} undecoded=${B.undecoded}`);

    S.results.push({
      id: c.id, distA: dA, distB: dB, walked,
      A: { ...A, ghost: A.attacksIn === 0 }, B: { ...B, ghost: B.attacksIn === 0 },
    });
    send('target', { id: S.me.id });
    await sleep(600);
  }

  const ghostsA = S.results.filter((r) => r.A.ghost).length;
  const ghostsB = S.results.filter((r) => r.B.ghost).length;
  const out = { results: S.results, ghostRateOutOfRange: `${ghostsA}/${S.results.length}`,
    ghostRateInRange: `${ghostsB}/${S.results.length}` };
  console.log('---');
  console.log(JSON.stringify(out, null, 2));
  if (JSONOUT) fs.writeFileSync(JSONOUT, JSON.stringify(out, null, 2));
  console.log(`GHOSTS out-of-range ${ghostsA}/${S.results.length}  in-range ${ghostsB}/${S.results.length}`);
  process.exit(0);
}

setTimeout(() => process.exit(3), 420000);
run().catch((e) => { console.error(e); process.exit(2); });
