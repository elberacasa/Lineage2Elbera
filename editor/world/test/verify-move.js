// Movement ground truth, measured against the live aCis gameserver.
//
// This script bypasses the JSON bridge and speaks the L2 protocol directly
// (gateway/src/loginclient.js + gameclient.js, both READ-ONLY here) for one
// reason: the bridge's `move` op forwards only MoveToLocation's DESTINATION
// (tx,ty,tz) and throws away the packet's other three fields — the creature's
// CURRENT server position (cx,cy,cz). Those three are the only window the
// protocol gives onto where the server actually thinks the character is, and
// every question below needs them.
//
// What it measures (no assumptions; every number comes off the wire):
//
//   A. Does a move order BEHIND the character get accepted?  (the reported
//      symptom: "click behind reads as a click forward")
//   B. Does aCis answer an ACCEPTED move with ActionFailed?  (the client
//      currently prints "Can't reach that." on any ActionFailed within
//      1500 ms of a move order)
//   C. What Z does the server put in the broadcast, given the floor Z we
//      send?  (MoveBackwardToLocation.java: `_targetZ += getCollisionHeight()`)
//   D. The server's real ground speed, sampled from consecutive cx,cy,cz.
//   E. Arrival: where does the character stop relative to the order?
//
// Usage:  node editor/world/test/verify-move.js [deviceId]
// Exit 0 = every assertion held.

'use strict';

const path = require('path');
const crypto = require('crypto');

const GW = path.join(__dirname, '..', '..', '..', 'gateway', 'src');
const { login } = require(path.join(GW, 'loginclient.js'));
const { GameSession } = require(path.join(GW, 'gameclient.js'));

const LOGIN_HOST = process.env.L2_LOGIN_HOST || '127.0.0.1';
const LOGIN_PORT = Number(process.env.L2_LOGIN_PORT || 2106);
const SERVER_ID = Number(process.env.L2_SERVER_ID || 1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same derivation the bridge uses (bridge.js deriveCredentials) so this script
// reuses the browser account model instead of inventing a second one.
function deriveCredentials(deviceId) {
  const id = String(deviceId || 'anonymous');
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + id).digest('hex');
  const h2 = crypto.createHash('sha256').update('l2vzla-pass:' + id).digest('hex');
  return {
    account: 'w' + h1.slice(0, 12),
    password: h2.slice(0, 16),
    charName: 'W' + h1.slice(12, 23),
  };
}

const deviceId = process.argv[2] || 'elbera-verify-move';
const creds = deriveCredentials(deviceId);

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (p) => `(${p.x},${p.y},${p.z})`;

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

(async () => {
  const { sessionKey, server } = await login(
    LOGIN_HOST, LOGIN_PORT, creds.account, creds.password, SERVER_ID);
  console.log(`login ok -> ${server.host}:${server.port}  account=${creds.account}`);

  const g = new GameSession();
  const t0 = Date.now();
  const log = [];                 // every wire event, timestamped
  let self = null;                // userInfo
  let selfId = null;

  const record = (op, o) => log.push({ t: Date.now() - t0, op, ...o });

  g.on('actionFailed', () => record('actionFailed', {}));
  g.on('move', (m) => {
    if (selfId != null && m.id !== selfId) return;
    record('move', { tx: m.tx, ty: m.ty, tz: m.tz, x: m.x, y: m.y, z: m.z });
  });
  g.on('userInfo', (u) => {
    self = u; selfId = u.id;
    record('userInfo', { x: u.x, y: u.y, z: u.z, run: u.runSpeed, walk: u.walkSpeed, running: u.running });
  });

  const chars = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no charList in 15s')), 15000);
    g.once('charList', (list) => { clearTimeout(timer); resolve(list); });
    g.once('error', (e) => { clearTimeout(timer); reject(e); });
    g.connect(server.host, server.port, creds.account, sessionKey);
  });
  console.log(`charList: ${Array.isArray(chars) ? chars.length : '?'} character(s)`);

  // Character 0, creating one on the very first run of a fresh deviceId.
  if (Array.isArray(chars) && chars.length === 0) {
    console.log(`creating character ${creds.charName}`);
    g.createCharacter(creds.charName);
    await new Promise((r) => { g.once('charCreateOk', r); setTimeout(r, 6000); });
    await sleep(1200);
  }
  g.selectChar(0);
  await sleep(800);
  g.enterWorld();

  // Let the world stream settle and the first UserInfo land.
  await sleep(4000);
  if (!self) { console.error('no UserInfo after enterWorld'); process.exit(1); }
  console.log(`in world: id=${selfId} at ${fmt(self)} run=${self.runSpeed} walk=${self.walkSpeed} running=${self.running}`);

  // Everything below sends the ORIGIN correctly (the character's last known
  // server position), which is what the retail client does.
  const origin = { x: self.x, y: self.y, z: self.z };
  g.pos = { ...origin, heading: self.heading || 0 };

  const order = (x, y, z) => { g.pos = { ...g.pos }; g.moveTo(x, y, z); };
  const lastMove = () => [...log].reverse().find((e) => e.op === 'move');

  // aCis does NOT broadcast the destination it was given: moveToLocation()
  // runs calculatePath() and then `destination.set(loc)` — the broadcast
  // MoveToLocation carries the FIRST NODE of the server's own geopath, and
  // the remaining nodes arrive one MoveToLocation at a time from
  // moveToNextRoutePoint(). So "was the order obeyed?" is answered by the
  // SIGN of the broadcast leg against the ordered direction, never by
  // equality with the ordered point.
  const towards = (from, leg, goal) => {
    const a = { x: leg.x - from.x, y: leg.y - from.y };
    const b = { x: goal.x - from.x, y: goal.y - from.y };
    const na = Math.hypot(a.x, a.y), nb = Math.hypot(b.x, b.y);
    return (na && nb) ? (a.x * b.x + a.y * b.y) / (na * nb) : 0;   // cosine
  };

  // ---------------------------------------------------------------- A / B / C
  // ONE order, from a full standstill: 900 units NORTH (+Y). The Z we send is
  // a FLOOR z (24 below the head-level Z the server reports for us) so the
  // `_targetZ += getCollisionHeight()` correction is directly observable.
  await sleep(3000);                                // make sure we are idle
  const collision = 24;
  const mark = log.length;
  const gA = { x: origin.x, y: origin.y + 2400, z: origin.z - collision };
  order(gA.x, gA.y, gA.z);
  await sleep(900);
  const evA = log.slice(mark);
  const mvA = evA.find((e) => e.op === 'move');
  const afA = evA.filter((e) => e.op === 'actionFailed').length;

  check('A. a move order from a standstill is accepted (MoveToLocation broadcast)',
    !!mvA && towards({ x: mvA.x, y: mvA.y }, { x: mvA.tx, y: mvA.ty }, gA) > 0.9,
    mvA ? `leg ${fmt({ x: mvA.tx, y: mvA.ty, z: mvA.tz })} from ${fmt({ x: mvA.x, y: mvA.y, z: mvA.z })} ` +
      `cos=${towards({ x: mvA.x, y: mvA.y }, { x: mvA.tx, y: mvA.ty }, gA).toFixed(3)}` : 'no broadcast');
  check('B. an ACCEPTED move order is nonetheless answered with ActionFailed',
    afA > 0, `${afA} ActionFailed in the 900 ms after one accepted order`);
  if (mvA) {
    // Only meaningful when the server did NOT swap our destination for a
    // geopath node — the node brings its own Z and the delta stops being the
    // collision height. `getCollisionHeight()` is a double and `_targetZ` an
    // int, so the += truncates toward zero: 23.5 on a negative Z lands on 24.
    const sameXY = mvA.tx === gA.x && mvA.ty === gA.y;
    const delta = mvA.tz - gA.z;
    check('C. the server raises the ordered floor Z by the collision height',
      !sameXY || delta === 23 || delta === 24,
      `Z sent ${gA.z} -> Z broadcast ${mvA.tz} (delta ${delta}` +
      (sameXY ? '' : ', destination replaced by a geopath node — delta not comparable') +
      '); MoveBackwardToLocation.java: `_targetZ += player.getCollisionHeight()`');
  }

  // ---------------------------------------------------------------- D
  // Sample the server's own position by re-issuing the same order every
  // 500 ms: each MoveToLocation carries cx,cy,cz at the moment it was built.
  // Re-aim 2400 units ahead of the LAST reported server position on every
  // sample: aCis answers with the first node of its own geopath, which can be
  // only a hundred units away, and a fixed far goal then leaves the character
  // standing still for most of the window with nothing to measure.
  const samples = [];
  let aim = { ...gA };
  for (let i = 0; i < 10; i++) {
    const before = log.length;
    order(aim.x, aim.y, aim.z);
    await sleep(450);
    const m = log.slice(before).find((e) => e.op === 'move');
    if (m) {
      samples.push({ t: m.t, x: m.x, y: m.y, z: m.z });
      aim = { x: m.x, y: m.y + 2400, z: m.z - collision };
      g.pos = { x: m.x, y: m.y, z: m.z, heading: g.pos.heading };
    }
  }
  // Median of the per-interval speeds, over the intervals where the position
  // actually changed. A plain first-to-last average is wrong the moment the
  // character reaches the leg and stands still for the rest of the window —
  // aCis replaces the ordered destination with the first node of its own
  // geopath, so "still moving" is not something the order length guarantees.
  let measured = null;
  if (samples.length >= 3) {
    console.log('     server position samples: ' +
      samples.map((s) => `${s.t}ms ${fmt(s)}`).join('  '));
    const speeds = [];
    for (let i = 1; i < samples.length; i++) {
      const d = dist2(samples[i - 1], samples[i]);
      const dtS = (samples[i].t - samples[i - 1].t) / 1000;
      if (d > 1 && dtS > 0) speeds.push(d / dtS);
    }
    if (speeds.length >= 3) {
      speeds.sort((a, b) => a - b);
      measured = speeds[Math.floor(speeds.length / 2)];
    }
  }
  // The server does NOT move at UserInfo's runSpeed. UserInfo.java writes
  // `getStatus().getBaseRunSpeed()` and, four fields later, a separate
  // `getMovementSpeedMultiplier()` float — while CreatureMove.updatePosition
  // covers `getMoveSpeed()/10` per 100 ms tick, and getMoveSpeed() is
  // calcStat(Stats.RUN_SPEED, base) = base * that multiplier. The gateway
  // reads the multiplier and drops it on the floor
  // (gameclient.js: `r.readF(); // movement speed multiplier`), so the
  // browser animates at the BASE speed and trails the server for good. This
  // check pins the ratio down so the number is on record.
  const ratio = measured != null ? measured / self.runSpeed : null;
  check('D. server ground speed is a fixed multiple of UserInfo runSpeed',
    ratio != null && ratio > 0.9 && ratio < 1.6,
    ratio != null
      ? `measured ${measured.toFixed(1)} u/s vs base runSpeed ${self.runSpeed} ` +
        `-> implied getMovementSpeedMultiplier ~= ${ratio.toFixed(3)} ` +
        `(${ratio > 1.02 ? 'NOT 1: the client must be told this multiplier' : 'no buff active'})`
      : 'not enough samples');

  // ---------------------------------------------------------------- A2 / A3
  // THE REPORTED SYMPTOM. Order a destination straight BEHIND the character
  // while it is still walking forward, and ask two things: did the server
  // take the order on the spot, and did it actually reverse?
  const here = lastMove() || { x: origin.x, y: origin.y, z: origin.z };
  g.pos = { x: here.x, y: here.y, z: here.z, heading: g.pos.heading };
  const gB = { x: here.x, y: here.y - 900, z: here.z - collision };  // straight back
  const markB = log.length;
  order(gB.x, gB.y, gB.z);
  await sleep(1200);
  const evB = log.slice(markB);
  const mvB = evB.find((e) => e.op === 'move');
  const afB = evB.filter((e) => e.op === 'actionFailed').length;
  const cosB = mvB ? towards({ x: mvB.x, y: mvB.y }, { x: mvB.tx, y: mvB.ty }, gB) : 0;

  check('A2. a move order BEHIND the character, issued mid-walk, is obeyed at once',
    !!mvB && cosB > 0.9,
    mvB ? `ordered ${fmt(gB)}; next broadcast leg ${fmt({ x: mvB.tx, y: mvB.ty, z: mvB.tz })} ` +
      `from ${fmt({ x: mvB.x, y: mvB.y, z: mvB.z })} cos=${cosB.toFixed(3)}` : 'no broadcast');
  console.log(`     ActionFailed alongside the reversing order: ${afB}`);

  // 3 s later, one probe order samples the position again.
  await sleep(3000);
  const beforeC = log.length;
  order(gB.x, gB.y, gB.z);
  await sleep(700);
  const mC = log.slice(beforeC).find((e) => e.op === 'move');
  if (mvB && mC) {
    check('A3. the server position really travels BACKWARD after that order',
      dist2(mC, gB) < dist2({ x: mvB.x, y: mvB.y }, gB) - 100,
      `distance to the ordered point ${dist2({ x: mvB.x, y: mvB.y }, gB).toFixed(0)} -> ${dist2(mC, gB).toFixed(0)} units`);
  }

  console.log('\n--- wire log ---');
  for (const e of log) {
    if (e.op === 'move') console.log(`${String(e.t).padStart(6)}ms move   dest ${fmt({ x: e.tx, y: e.ty, z: e.tz })} at ${fmt(e)}`);
    else if (e.op === 'actionFailed') console.log(`${String(e.t).padStart(6)}ms actionFailed`);
    else if (e.op === 'userInfo') console.log(`${String(e.t).padStart(6)}ms userInfo ${fmt(e)} run=${e.run} walk=${e.walk} running=${e.running}`);
  }

  g.close();
  console.log(`\nVERIFY-MOVE: ${failures.length ? 'FAIL (' + failures.join(', ') + ')' : 'PASS'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('verify-move error:', e && e.stack || e);
  process.exit(1);
});
