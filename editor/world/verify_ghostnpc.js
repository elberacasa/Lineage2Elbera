#!/usr/bin/env node
//
// GHOST NPCs — regression gate.
//
// THE DEFECT (measured, not inferred; gateway/test/repro-ghost-pair.js):
// a large share of the mobs the client drew answered target_ok and then
// swallowed every attack — 7 attack ops out, 0 in, target HP unchanged, no
// system message, no ActionFailed. The mobs were real, alive, not duplicated
// and not stale. They were simply OUT OF PHYSICAL ATTACK RANGE, and aCis
// answers that case with exactly one packet:
//
//   PlayerAI.thinkAttack:
//     if (_actor.getMove().maybeMoveToPawn(target, physicalAttackRange, shift))
//     { if (shift) { doIdleIntention(); clientActionFailed(); } return; }
//
//   PlayerMove.moveToPawn -> broadcastPacket(new MoveToPawn(...))   // 0x60
//
// With shift = 0 that branch sends NO ActionFailed and NO SystemMessage. The
// gateway did not decode 0x60 (it fell through to GameSession.packetLog), so
// the browser was told nothing at all: no swing, no refusal, and no character
// running to the mob. Four more combat packets rode the same hole:
// TargetUnselected(0x2a), AutoAttackStart(0x2b), AutoAttackStop(0x2c),
// StopMove(0x47).
//
// WHAT THIS ASSERTS
//   LIVE  (real aCis through the real gateway, no browser)
//     L1 every drawn Gremlin answers target_ok             (they are real)
//     L2 EVERY swing gets a server answer of some kind — an Attack, an
//        ActionFailed, a SystemMessage or a MoveToPawn. A swing that gets
//        nothing is the ghost, and the ghost rate must be 0.
//     L3 at least one mob returns a real inbound attack once in range
//        (proves the combat path itself still works)
//   MOCK  (deterministic, drives the real browser client)
//     M1 attacking the out-of-range fixture yields a moveToPawn op
//     M2 the client REACTS: the character is given a walk target toward the
//        mob (retail behaviour for MoveToPawn) — i.e. not silence
//     M3 the silent-swing counter (js/combat.js installCombatFeedback) is 0
//     M4 in range, the same mob returns real attack ops + autoAttack
//     M5 target_lost clears the target frame instead of leaving a stale one
//
// USAGE
//   node editor/world/verify_ghostnpc.js            # run + print JSON
//   node editor/world/verify_ghostnpc.js --check    # exit nonzero on failure
//   ... --mock-only | --live-only
//
// The gateway on GATEWAY_URL must be running the CURRENT gateway/src.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
// `ws` lives in the gateway's node_modules; editor/world has none of its own.
const WebSocket = require('/Users/alejandroberacasa/l2vzla/gateway/node_modules/ws');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname);
const CHECK = process.argv.includes('--check');
const MOCK_ONLY = process.argv.includes('--mock-only');
const LIVE_ONLY = process.argv.includes('--live-only');
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const CLIENT = process.env.CLIENT_URL || 'http://127.0.0.1:8083';
const MOCK_PORT = Number(process.env.GHOST_MOCK_PORT || 8087);
const GHOST_MOB = 70020;   // mock_gateway ghost fixture (out of range)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = { live: null, mock: null, failures: [] };
const fail = (msg) => { R.failures.push(msg); };

// ---------------------------------------------------------------- live half
//
// Deliberately protocol-level. The root cause is a dropped packet, so the
// assertion belongs where packets are: a browser in the loop would only add
// ways for the test to be flaky about something it is not testing.
async function liveHalf() {
  const out = {
    url: GATEWAY_URL, drawnGremlins: 0, tried: 0,
    swingsOut: 0, swingsAnswered: 0, silentSwings: 0,
    moveToPawn: 0, realAttacks: 0, targetOkAll: true, mobs: [],
  };
  const ws = new WebSocket(GATEWAY_URL);
  const ev = [];
  const S = { me: null, npcs: new Map(), pos: new Map(), dead: false };
  let entered;
  const send = (op, extra = {}) => ws.send(JSON.stringify({ op, ...extra }));

  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('open', () => send('login', { deviceId: 'verify-ghostnpc-' + Date.now() }));
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      ev.push({ t: Date.now(), ...m });
      switch (m.op) {
        case 'auth_ok': setTimeout(() => send('enterChar', { slot: 0 }), 400); break;
        case 'enterWorld':
          S.me = m.char; S.pos.set(m.char.id, m.char); resolve();
          break;
        case 'addNpc': S.npcs.set(m.id, m); S.pos.set(m.id, m); break;
        case 'remove': S.npcs.delete(m.id); break;
        case 'move': case 'validate': S.pos.set(m.id, m); break;
        case 'die':
          if (S.me && m.id === S.me.id) { S.dead = true; setTimeout(() => send('respawn'), 1200); }
          break;
        case 'revive': if (S.me && m.id === S.me.id) S.dead = false; break;
      }
    });
    entered = resolve;
  });
  await sleep(5000);

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const gremlins = [...S.npcs.values()].filter((n) => /Gremlin/i.test(n.name))
    .map((n) => ({ ...n, d: dist(S.pos.get(n.id), S.pos.get(S.me.id)) }))
    .sort((a, b) => b.d - a.d);            // FARTHEST first: the ghost population
  out.drawnGremlins = gremlins.length;

  // A swing is "answered" when any of these arrives after it. This is the
  // exhaustive list of aCis outcomes for an AttackRequest on a live target.
  // `status`/`die` are excluded on purpose: they stream from every creature in
  // range, so including them would let ambient traffic mask a silent swing.
  const ANSWERS = new Set(['attack', 'actionFailed', 'sysMsg', 'moveToPawn',
    'target_lost', 'autoAttack']);

  for (const g of gremlins.slice(0, 4)) {
    for (let i = 0; S.dead && i < 40; i++) await sleep(1000);
    send('target', { id: g.id });
    await sleep(1300);
    const okAt = ev.length;
    const targetOk = ev.some((e) => e.op === 'target_ok' && e.id === g.id);
    if (!targetOk) out.targetOkAll = false;

    const mob = { id: g.id, dist: g.d | 0, targetOk, swings: 0, answered: 0, silent: 0,
      moveToPawn: 0, realAttacks: 0 };
    for (let s = 0; s < 4; s++) {
      const mark = ev.length;
      send('attack', { id: g.id });
      mob.swings++; out.swingsOut++;
      await sleep(2500);
      const w = ev.slice(mark);
      const answered = w.some((e) => ANSWERS.has(e.op));
      if (answered) { mob.answered++; out.swingsAnswered++; }
      else { mob.silent++; out.silentSwings++; }
      mob.moveToPawn += w.filter((e) => e.op === 'moveToPawn').length;
      mob.realAttacks += w.filter((e) => e.op === 'attack').length;
      if (mob.realAttacks) break;
    }
    out.moveToPawn += mob.moveToPawn;
    out.realAttacks += mob.realAttacks;
    out.tried++;
    out.mobs.push(mob);
    send('target', { id: S.me.id });
    await sleep(600);
  }

  // L3: walk to the nearest one and prove a real swing still lands.
  const near = gremlins[gremlins.length - 1];
  if (near) {
    for (let i = 0; S.dead && i < 40; i++) await sleep(1000);
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      const p = S.pos.get(near.id); const s = S.pos.get(S.me.id);
      const d = dist(p, s);
      if (d <= 55) break;
      const leg = Math.min(d, 150);
      send('moveTo', { ox: s.x | 0, oy: s.y | 0, oz: s.z | 0,
        x: (s.x + (p.x - s.x) / d * leg) | 0, y: (s.y + (p.y - s.y) / d * leg) | 0, z: p.z | 0 });
      await sleep(Math.min(7000, leg / 115 * 1000 + 1800));
    }
    send('target', { id: near.id });
    await sleep(1000);
    const mark = ev.length;
    for (let s = 0; s < 4; s++) {
      send('attack', { id: near.id });
      out.swingsOut++;
      await sleep(2500);
      if (ev.slice(mark).some((e) => e.op === 'attack')) break;
    }
    out.inRangeAttacks = ev.slice(mark).filter((e) => e.op === 'attack').length;
    out.realAttacks += out.inRangeAttacks;
  }

  out.ghostRate = out.swingsOut ? +(out.silentSwings / out.swingsOut).toFixed(3) : null;
  ws.close();

  if (!out.drawnGremlins) fail('LIVE: no Gremlin was drawn at all — cannot measure');
  if (!out.targetOkAll) fail('LIVE L1: a drawn Gremlin did not answer target_ok');
  if (out.silentSwings > 0) {
    fail(`LIVE L2: ${out.silentSwings}/${out.swingsOut} swings got NO server answer of any`
      + ' kind (the ghost defect: MoveToPawn/ActionFailed never reached the client)');
  }
  if (!(out.realAttacks > 0)) {
    fail('LIVE L3: no inbound attack op came back from ANY mob — the combat path itself'
      + ' is broken, not just the approach');
  }
  return out;
}

// ---------------------------------------------------------------- mock half
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function mockHalf() {
  const out = { port: MOCK_PORT };
  if (!(await portFree(MOCK_PORT))) {
    fail(`MOCK: port ${MOCK_PORT} is busy — refusing to talk to someone else's mock`);
    return out;
  }
  const mock = spawn('node', [path.join(ROOT, 'mock_gateway.js'), String(MOCK_PORT)],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const mockLog = [];
  mock.stdout.on('data', (d) => mockLog.push(String(d)));
  mock.stderr.on('data', (d) => mockLog.push(String(d)));
  await sleep(1200);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    await page.goto(`${CLIENT}/?ws=ws://127.0.0.1:${MOCK_PORT}&cc=0`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 40000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.connected && window.__world.net.log.some(m => m.op === "selfStatus")',
      { timeout: 25000 });
    await sleep(1500);

    out.feedbackInstalled = await page.evaluate(() => !!window.__world.combatFeedback);
    if (!out.feedbackInstalled) {
      fail('MOCK: window.__world.combatFeedback is missing — js/combat.js'
        + ' installCombatFeedback is not wired, so the new ops are dropped on the floor');
    }
    out.ghostDrawn = await page.evaluate((id) => !!window.__world.entities.getEntity(id), GHOST_MOB);
    if (!out.ghostDrawn) fail(`MOCK: fixture mob ${GHOST_MOB} was not drawn`);

    // --- M1/M2/M3: attack the out-of-range fixture -----------------------
    await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      w.combat.setTarget(id, e.name, { kind: e.kind, level: e.level ?? null });
      w.net.sendOp('target', { id });
    }, GHOST_MOB);
    await sleep(800);
    const beforeTarget = await page.evaluate(() =>
      window.__world.character ? !!window.__world.character.target : null);
    await page.evaluate((id) => window.__world.net.sendOp('attack', { id }), GHOST_MOB);
    await sleep(1500);

    out.moveToPawn = await page.evaluate(() =>
      window.__world.net.log.filter((m) => m.op === 'moveToPawn').length);
    if (!out.moveToPawn) {
      fail('MOCK M1: attacking an out-of-range mob produced no moveToPawn op —'
        + ' the gateway/mock is not forwarding MoveToPawn(0x60)');
    }
    out.approach = await page.evaluate((id) => {
      const w = window.__world;
      const ch = w.character;
      const e = w.entities.getEntity(id);
      if (!ch || !ch.target || !e) return null;
      const a = ch.group.position, t = ch.target, m = e.group.position;
      // does the walk target lie between us and the mob (same direction)?
      const dot = (t.x - a.x) * (m.x - a.x) + (t.z - a.z) * (m.z - a.z);
      return { dot, movedTowardMob: dot > 0,
        distToMob: Math.hypot(m.x - a.x, m.z - a.z),
        distTargetToMob: Math.hypot(m.x - t.x, m.z - t.z) };
    }, GHOST_MOB);
    out.characterTargetBefore = beforeTarget;
    if (!out.approach || !out.approach.movedTowardMob) {
      fail('MOCK M2: the client did NOT react to moveToPawn — the character was given no'
        + ' walk order toward the mob, so the player still sees absolutely nothing');
    }
    out.silentSwings = await page.evaluate(() => {
      const f = window.__world.combatFeedback;
      return f && f.sweepSilence ? f.sweepSilence() : null;
    });
    // the sweep needs its window to elapse before it can be trusted
    await sleep(4500);
    out.silentSwings = await page.evaluate(() => {
      const f = window.__world.combatFeedback;
      return f && f.sweepSilence ? f.sweepSilence() : null;
    });
    if (out.silentSwings === null) fail('MOCK M3: no silent-swing counter available');
    else if (out.silentSwings > 0) {
      fail(`MOCK M3: ${out.silentSwings} swing(s) got zero feedback of any kind`);
    }

    // --- M4: walk into range, same mob, must fight -----------------------
    // Stand next to it. A real click-to-move would take ~40 s of walking for a
    // fixture placed this far out, so the move order goes straight out with
    // the mob's own server coordinates (from its addNpc); the mock's range
    // check reads the moveTo destination, exactly as it reads a walk.
    await page.evaluate((id) => {
      const w = window.__world;
      const spawn = w.net.log.find((m) => m.op === 'addNpc' && m.id === id);
      if (!spawn) return;
      w.net.sendOp('moveTo', { x: spawn.x, y: spawn.y, z: spawn.z,
        ox: spawn.x, oy: spawn.y, oz: spawn.z });
    }, GHOST_MOB);
    await sleep(1500);
    await page.evaluate((id) => window.__world.net.sendOp('attack', { id }), GHOST_MOB);
    await sleep(3000);
    out.inRange = await page.evaluate(() => ({
      attacks: window.__world.net.log.filter((m) => m.op === 'attack' && m.dir !== 'out').length,
      autoAttack: window.__world.net.log.filter((m) => m.op === 'autoAttack').length,
    }));
    if (!(out.inRange.attacks > 0)) {
      fail('MOCK M4: in range, the same mob still returned no attack op');
    }

    // --- M5: target_lost must clear the frame ----------------------------
    out.targetBeforeLost = await page.evaluate(() => window.__world.combat.targetId);
    await page.evaluate(() => {
      const w = window.__world;
      w.net.inject({ op: 'target_lost', id: w.net.selfId, x: 0, y: 0, z: 0 });
    });
    await sleep(300);
    out.targetAfterLost = await page.evaluate(() => window.__world.combat.targetId);
    if (out.targetAfterLost !== null) {
      fail('MOCK M5: target_lost did not clear the target — the client keeps showing a'
        + ' target the server no longer holds, and the next swing is eaten as a re-target');
    }
    out.consoleErrors = logs.filter((l) => l.startsWith('PAGEERROR')
      || l.includes('unhandled op')).slice(0, 10);
  } finally {
    await browser.close();
    mock.kill();
  }
  return out;
}

(async () => {
  try {
    if (!MOCK_ONLY) R.live = await liveHalf();
  } catch (e) { fail('LIVE: harness error — ' + (e.message || e)); }
  try {
    if (!LIVE_ONLY) R.mock = await mockHalf();
  } catch (e) { fail('MOCK: harness error — ' + (e.message || e)); }

  const summary = {
    live: R.live, mock: R.mock,
    ghostRateLive: R.live ? R.live.ghostRate : null,
    failures: R.failures,
    pass: R.failures.length === 0,
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ROOT, 'verify_ghostnpc.json'), JSON.stringify(summary, null, 2));
  console.log(summary.pass ? 'VERIFY-GHOSTNPC: PASS' : 'VERIFY-GHOSTNPC: FAIL');
  for (const f of R.failures) console.log('  - ' + f);
  process.exit(CHECK && !summary.pass ? 1 : 0);
})();
