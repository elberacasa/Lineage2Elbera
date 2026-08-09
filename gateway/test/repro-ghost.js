#!/usr/bin/env node
// GHOST NPC repro. Measures, per DRAWN mob, whether the server ever answers an
// attack — and what it answers instead when it does not.
//
// This is deliberately at the GATEWAY level, not the browser: it applies the
// same add/remove stream the client applies, so the "drawn set" here IS the
// client's draw list minus any client-side bug. If ghosts reproduce here, the
// draw list is innocent.
//
//   node gateway/test/repro-ghost.js [--nowalk] [--n 8] [--json <file>]
//
// --nowalk reproduces exactly what outreach/shots/capture.js does: target,
// then attack, and rely on the server's own approach. The default walks into
// melee range first (what gateway/test/verify-combat.js does).
'use strict';

const fs = require('fs');
const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const argOf = (f, d) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : d;
};
const NOWALK = process.argv.includes('--nowalk');
const N = +argOf('--n', 8);
const JSONOUT = argOf('--json', null);
const DEVICE = argOf('--device', 'repro-ghost-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = {
  me: null,
  selfStatus: null,
  drawn: new Map(),        // id -> addNpc msg   (the client's draw list)
  addNpcTotal: 0,
  addNpcDupes: [],         // ids the server described twice while still drawn
  removed: new Set(),
  dead: new Set(),
  attacksIn: [],           // every inbound attack op
  statuses: new Map(),     // id -> last status
  sysMsgs: [],             // {t, id, params}
  actionFailed: [],        // {t}
  targetOk: [],            // {t, id, color}
  moves: new Map(),
  moveOps: [],
  timeline: [],
  undecoded: [],
  results: [],
  selfDead: false,
  selfDeaths: 0,
  hpTimeline: [],
};

const t0 = Date.now();
const now = () => Date.now() - t0;
const log = (...a) => console.log('[ghost]', ...a);

const ws = new WebSocket(url);
let send = (op, extra = {}) => {
  R.timeline.push({ t: now(), dir: 'out', op, id: extra.id });
  ws.send(JSON.stringify({ op, ...extra }));
};
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(2); });
ws.on('open', () => send('login', { deviceId: DEVICE }));

let entered = null;
ws.on('message', (data) => {
  const m = JSON.parse(data);
  // Everything except the ambient spawn/status noise, so a swing window can be
  // read as a sequence.
  if (!['addNpc', 'addPlayer', 'itemList', 'skillList', 'quest'].includes(m.op)) {
    R.timeline.push({ t: now(), dir: 'in',
      op: m.op === 'traceUndecoded' ? `undecoded(${m.packet})` : m.op, id: m.id });
  }
  if (m.op === 'traceUndecoded') R.undecoded.push({ t: now(), packet: m.packet });
  switch (m.op) {
    case 'auth_ok':
      setTimeout(() => send('enterChar', { slot: 0 }), 400);
      break;
    case 'enterWorld':
      R.me = m.char;
      log('enterWorld', JSON.stringify(m.char));
      if (entered) entered();
      break;
    case 'addNpc':
      R.addNpcTotal++;
      if (R.drawn.has(m.id)) R.addNpcDupes.push({ t: now(), id: m.id, name: m.name });
      R.drawn.set(m.id, m);
      break;
    case 'remove':
      R.drawn.delete(m.id);
      R.removed.add(m.id);
      break;
    case 'die':
      R.dead.add(m.id);
      if (R.me && m.id === R.me.id) {
        R.selfDead = true; R.selfDeaths++;
        log(`!! SELF DIED at t=${now()}ms (canRespawn=${m.canRespawn}) — every attack from`
          + ' here on is refused by Creature.denyAiAction()');
        setTimeout(() => send('respawn'), 1500);
      }
      break;
    case 'revive':
      R.dead.delete(m.id);
      if (R.me && m.id === R.me.id) { R.selfDead = false; log(`self revived at t=${now()}ms`); }
      break;
    case 'move':
      R.moves.set(m.id, { x: m.x, y: m.y, z: m.z, tx: m.tx, ty: m.ty, tz: m.tz });
      R.moveOps.push({ t: now(), id: m.id, x: m.x, y: m.y, tx: m.tx, ty: m.ty });
      break;
    case 'validate':
      R.moves.set(m.id, { x: m.x, y: m.y, z: m.z });
      break;
    case 'attack':
      R.attacksIn.push({ t: now(), ...m });
      break;
    case 'status':
      R.statuses.set(m.id, m);
      break;
    case 'selfStatus':
      R.selfStatus = m;
      R.hpTimeline.push({ t: now(), hp: m.hp, maxHp: m.maxHp });
      break;
    case 'target_ok':
      R.targetOk.push({ t: now(), id: m.id, color: m.color });
      break;
    case 'sysMsg':
      R.sysMsgs.push({ t: now(), id: m.id, params: m.params });
      break;
    case 'actionFailed':
      R.actionFailed.push({ t: now() });
      break;
  }
});

const selfPos = () => R.moves.get(R.me.id) || R.me;
const posOf = (e) => {
  const mv = R.moves.get(e.id);
  if (!mv) return e;
  // a `move` op states an ORIGIN (x,y,z) and a destination; the origin is the
  // last thing the server actually asserted about where the creature is.
  return { x: mv.x, y: mv.y, z: mv.z };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

async function run() {
  await new Promise((r) => { entered = r; });
  await sleep(5000);

  const me = R.me;
  const drawn = [...R.drawn.values()];
  log(`drawn set: ${drawn.length} NPCs (${R.addNpcTotal} addNpc, ${R.removed.size} removed,`
    + ` ${R.addNpcDupes.length} duplicate ids)`);

  // Candidates: the mobs the shot tool would pick — nearest attackable
  // monsters. Gremlin is THE starter-village attackable and is what the
  // reported measurement used.
  const cands = drawn
    .map((n) => ({ ...n, d: dist(posOf(n), selfPos()) }))
    .filter((n) => /Gremlin/i.test(n.name))
    .sort((a, b) => a.d - b.d)
    .slice(0, N);
  log(`candidates: ${cands.length} Gremlins`,
    JSON.stringify(cands.map((c) => ({ id: c.id, d: c.d | 0 }))));
  if (!cands.length) { log('NO GREMLINS DRAWN — cannot measure'); return finish(); }

  for (const c of cands) {
    const mark = {
      atk: R.attacksIn.length, sys: R.sysMsgs.length, af: R.actionFailed.length,
      mv: R.moveOps.length, tl: R.timeline.length,
    };
    const hp0 = R.statuses.get(c.id);
    // Death poisons the measurement: while dead every attack is refused by
    // Creature.denyAiAction(). Wait out the respawn so each mob is judged in
    // the same state as the first one.
    for (let i = 0; R.selfDead && i < 40; i++) await sleep(1000);
    const selfHpAtStart = R.selfStatus ? R.selfStatus.hp : null;
    log(`--- mob ${c.id} "${c.name}" d=${c.d | 0}u drawnStill=${R.drawn.has(c.id)}`
      + ` serverDead=${R.dead.has(c.id)} selfHp=${selfHpAtStart} selfDead=${R.selfDead}`);
    send('target', { id: c.id });
    await sleep(1200);
    const ok = R.targetOk.some((t) => t.id === c.id);

    const deadline = Date.now() + (NOWALK ? 20000 : 45000);
    let swings = 0;
    let minDist = dist(posOf(c), selfPos());
    while (Date.now() < deadline) {
      if (R.attacksIn.slice(mark.atk).some((a) => a.targetId === c.id || a.id === c.id)) break;
      if (R.dead.has(c.id) || !R.drawn.has(c.id)) break;
      if (!NOWALK) {
        const p = posOf(c);
        const s = selfPos();
        const d = dist(p, s);
        if (d > 80) {
          const leg = Math.min(d, 150);
          send('moveTo', {
            ox: s.x | 0, oy: s.y | 0, oz: s.z | 0,
            x: (leg >= d ? p.x + 20 : s.x + ((p.x - s.x) / d) * leg) | 0,
            y: (leg >= d ? p.y : s.y + ((p.y - s.y) / d) * leg) | 0,
            z: p.z | 0,
          });
          await sleep(Math.min(9000, (leg / 115) * 1000 + 2000));
          continue;
        }
      }
      send('attack', { id: c.id });
      swings++;
      minDist = Math.min(minDist, dist(posOf(c), selfPos()));
      await sleep(2200);
      minDist = Math.min(minDist, dist(posOf(c), selfPos()));
    }
    const inAtk = R.attacksIn.slice(mark.atk)
      .filter((a) => a.targetId === c.id || a.id === c.id);
    const hp1 = R.statuses.get(c.id);
    const res = {
      id: c.id, name: c.name, dist: c.d | 0,
      targetOk: ok,
      swingsOut: swings,
      attacksIn: inAtk.length,
      sysMsgs: R.sysMsgs.slice(mark.sys).map((s) => s.id),
      actionFailed: R.actionFailed.length - mark.af,
      hp: `${hp0 ? hp0.hp : '?'}/${hp0 ? hp0.maxHp : '?'} -> ${hp1 ? hp1.hp : '?'}/${hp1 ? hp1.maxHp : '?'}`,
      stillDrawn: R.drawn.has(c.id),
      serverDead: R.dead.has(c.id),
      selfHpAtStart, selfDeadDuring: R.selfDead,
      finalDist: dist(posOf(c), selfPos()) | 0,
      minDist: minDist | 0,
      timeline: R.timeline.slice(mark.tl)
        .map((e) => `${e.t}${e.dir === 'out' ? '>' : '<'}${e.op}${e.op === 'sysMsg' ? ':' + e.id : ''}`),
      // did the server start an offensive follow for us? MoveToLocation(0x01)
      // for our own objectId is the only in-protocol evidence of it.
      selfMoveOps: R.moveOps.slice(mark.mv).filter((o) => o.id === R.me.id).length,
      ghost: ok && swings > 0 && inAtk.length === 0,
    };
    R.results.push(res);
    log(`    ${res.ghost ? 'GHOST' : 'real '} targetOk=${ok} out=${swings} in=${inAtk.length}`
      + ` af=${res.actionFailed} sys=[${res.sysMsgs}] hp=${res.hp}`);
    // stop attacking; re-target self so the next mob starts clean
    send('target', { id: R.me.id });
    await sleep(600);
  }
  finish();
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const tried = R.results.filter((r) => r.swingsOut > 0);
  const ghosts = tried.filter((r) => r.ghost);
  const out = {
    mode: NOWALK ? 'nowalk (capture.js)' : 'walk (verify-combat.js)',
    drawn: R.drawn.size,
    addNpcTotal: R.addNpcTotal,
    addNpcDupes: R.addNpcDupes,
    removed: R.removed.size,
    tried: tried.length,
    ghosts: ghosts.length,
    ghostRate: tried.length ? +(ghosts.length / tried.length).toFixed(3) : null,
    results: R.results,
    selfDeaths: R.selfDeaths,
    selfStatus: R.selfStatus,
    sysMsgIds: [...new Set(R.sysMsgs.map((s) => s.id))],
    actionFailedTotal: R.actionFailed.length,
    // opcodes aCis sent that the gateway never decodes (GW_TRACE=1 only)
    undecodedCounts: R.undecoded.reduce((a, u) => (a[u.packet] = (a[u.packet] || 0) + 1, a), {}),
  };
  console.log('---');
  console.log(JSON.stringify(out, null, 2));
  if (JSONOUT) fs.writeFileSync(JSONOUT, JSON.stringify(out, null, 2));
  console.log(`GHOST RATE: ${ghosts.length}/${tried.length}`);
  process.exit(0);
}

setTimeout(finish, 420000);
run().catch((e) => { console.error(e); process.exit(2); });
