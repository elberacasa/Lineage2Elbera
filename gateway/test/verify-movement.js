// verify-movement.js — what the LIVE aCis actually does when a character
// moves, measured off the wire. Re-runnable; `--check` is the same run with a
// PASS/FAIL exit code (there is no cheaper mode: every number here comes from
// a real session).
//
// It speaks the L2 protocol directly (gateway/src/loginclient.js +
// gameclient.js) rather than through the JSON bridge, for one reason: the
// questions below need the server's OWN position, which only rides in
// MoveToLocation's cx,cy,cz and in ValidateLocation.
//
// THE SAMPLER. Position is sampled with ValidatePosition (0x48) carrying a
// deliberately wrong x,y: aCis's ValidatePosition.runImpl answers
// `if (dist > actualSpeed) sendPacket(new ValidateLocation(player))`, and
// ValidateLocation carries the server's real x,y,z,heading. That probe changes
// NO server state (the packet only setXYZ's in CAMERA_MODE), so unlike
// re-issuing move orders it samples the walk without perturbing it. The z we
// send is always the last one the server told us, because
// `Player.isFalling(z)` applies real fall damage when the delta exceeds the
// template's safe fall height.
//
// What it measures:
//   1. the movement-speed multiplier (UserInfo) and whether the server's real
//      ground speed is runSpeed or runSpeed x multiplier;
//   2. whether a SHORT leg (under the client's old 6 m "walk" threshold) is
//      covered at run speed or at walk speed;
//   3. the walk/run stance: what RequestChangeMoveType produces, and what the
//      server's speed becomes;
//   4. a teleport arriving mid-walk (GM admin_teleport): which packet carries
//      it, and where the character is immediately afterwards.
//
// Usage:  node gateway/test/verify-movement.js [--check] [deviceId]
'use strict';

const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const GW = path.join(__dirname, '..', 'src');
const { login } = require(path.join(GW, 'loginclient.js'));
const { GameSession } = require(path.join(GW, 'gameclient.js'));

const LOGIN_HOST = process.env.L2_LOGIN_HOST || '127.0.0.1';
const LOGIN_PORT = Number(process.env.L2_LOGIN_PORT || 2106);
const SERVER_ID = Number(process.env.L2_SERVER_ID || 1);
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];

const args = process.argv.slice(2).filter((a) => a !== '--check');
const DEVICE_ID = args[0] || 'verify-movement-fixture-1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync('mariadb', [...DB, '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();

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

const creds = deriveCredentials(DEVICE_ID);
const GATEWAY = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const QUEST_ITEM = 1001;   // "Book of Aklantoth - Part 4", etcitem_type QUEST
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (p) => `(${p.x},${p.y},${p.z})`;

let passN = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) passN++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
}

// One live session, already in the world.
async function session() {
  const { sessionKey, server } = await login(
    LOGIN_HOST, LOGIN_PORT, creds.account, creds.password, SERVER_ID);
  const g = new GameSession();
  const t0 = Date.now();
  const state = { g, t0, self: null, selfId: null, log: [] };
  const record = (op, o) => state.log.push({ t: Date.now() - t0, op, ...o });

  g.on('userInfo', (u) => {
    state.self = u; state.selfId = u.id;
    record('userInfo', { x: u.x, y: u.y, z: u.z, run: u.runSpeed, walk: u.walkSpeed,
      mul: u.speedMul, running: u.running });
  });
  g.on('move', (m) => {
    if (state.selfId != null && m.id !== state.selfId) return;
    record('move', { tx: m.tx, ty: m.ty, tz: m.tz, x: m.x, y: m.y, z: m.z });
  });
  g.on('validate', (v) => {
    if (state.selfId != null && v.id !== state.selfId) return;
    record('validate', { x: v.x, y: v.y, z: v.z, heading: v.heading });
  });
  g.on('teleport', (t) => {
    if (state.selfId != null && t.id !== state.selfId) return;
    record('teleport', { x: t.x, y: t.y, z: t.z });
  });
  g.on('changeMove', (c) => {
    if (state.selfId != null && c.id !== state.selfId) return;
    record('changeMove', { running: c.running });
  });
  g.on('actionFailed', () => record('actionFailed', {}));
  // Spawned NPCs are the anchor this script teleports to before measuring:
  // a datapack spawn point is walkable dry ground by construction, which
  // nothing else here can assert about wherever the fixture was left standing.
  state.npcs = [];
  g.on('npcInfo', (n) => { if (state.npcs.length < 40) state.npcs.push(n); });

  const chars = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no charList in 20s')), 20000);
    g.once('charList', (l) => { clearTimeout(timer); resolve(l); });
    g.once('error', (e) => { clearTimeout(timer); reject(e); });
    g.connect(server.host, server.port, creds.account, sessionKey);
  });
  if (Array.isArray(chars) && chars.length === 0) {
    g.createCharacter(creds.charName);
    await new Promise((r) => { g.once('charCreateOk', r); setTimeout(r, 8000); });
    await sleep(1200);
  }
  g.selectChar(0);
  await sleep(900);
  g.enterWorld();
  await sleep(4500);
  return state;
}

(async () => {
  // ---- pass 1: make sure the character exists, then get offline so the GM
  // access level can be written while aCis is not holding the row.
  {
    const s = await session();
    if (!s.self) { console.log('FATAL  no UserInfo after enterWorld (pass 1)'); process.exit(1); }
    s.g.close();
  }
  await sleep(4000);   // aCis flushes the character on logout

  const owner = Number(sql(`SELECT obj_Id FROM characters WHERE char_name='${creds.charName}' LIMIT 1;`));
  if (!owner) { console.log('FATAL  fixture character not found: ' + creds.charName); process.exit(1); }
  sql(`UPDATE characters SET accesslevel=8 WHERE obj_Id=${owner};`);
  // A real QUEST item, so the type2 hook can be checked against the wire
  // rather than against the datapack: 1001 "Book of Aklantoth - Part 4" is
  // `etcitem_type QUEST` (data/xml/items/1000-1099.xml), which EtcItem.java
  // turns into Item.TYPE2_QUEST == 3.
  if (!sql(`SELECT object_id FROM items WHERE owner_id=${owner} AND item_id=${QUEST_ITEM} LIMIT 1;`)) {
    const oid = Number(sql('SELECT COALESCE(MAX(object_id),0) FROM items;')) + 1000;
    sql(`INSERT INTO items (owner_id,object_id,item_id,count,enchant_level,loc,loc_data,`
      + `custom_type1,custom_type2,mana_left,time) VALUES `
      + `(${owner},${oid},${QUEST_ITEM},1,0,'INVENTORY',0,0,0,-1,0);`);
  }
  console.log(`fixture ${creds.charName} (${owner}), accesslevel 8, quest item ${QUEST_ITEM}`);

  // ---- pass 2: measure
  const S = await session();
  const { g } = S;
  if (!S.self) { console.log('FATAL  no UserInfo after enterWorld (pass 2)'); process.exit(1); }
  console.log(`in world: id=${S.selfId} at ${fmt(S.self)} runSpeed=${S.self.runSpeed} ` +
    `walkSpeed=${S.self.walkSpeed} speedMul=${S.self.speedMul} running=${S.self.running}`);

  // ANCHOR. Where the fixture happens to be standing is not a controlled
  // condition, and the run that found this out is worth recording: a previous
  // run had left the character in the sea, and PlayerStatus.getMoveSpeed then
  // takes getBaseSwimSpeed() (50) as its base, so the multiplier came back as
  // 50 x 1.10 / 115 = 0.478 running and 55 / 80 = 0.6875 walking — correct, and
  // nothing like the dry-land 1.10. So the script parks the character on a
  // datapack SPAWN POINT first: an NPC's own coordinates, which are walkable
  // dry ground by construction and need no constant written down here. invul
  // goes on first because the anchor may be a monster's spawn.
  // First choice is a spawned NPC in our own knownlist; when there is none
  // (the fixture was left somewhere empty — the sea, in the run that found
  // this), ask the SERVER for a town: `admin_link tele/town_castle.htm` returns
  // the datapack's own teleport menu, and every entry in it is a real town
  // centre. Either way the coordinates come from the server, not from here.
  let anchor = S.npcs.find((n) => n.x && n.y);
  if (!anchor) {
    const html = await new Promise((resolve) => {
      const done = (h) => resolve(h && h.html);
      g.once('html', done);
      g.bypass('admin_link tele/town_castle.htm');
      setTimeout(() => resolve(null), 4000);
    });
    const m = html && /admin_teleport (-?\d+) (-?\d+) (-?\d+)/.exec(html);
    if (m) {
      anchor = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]), name: 'town (admin teleport menu)' };
    }
  }
  if (anchor) {
    g.bypass('admin_invul');
    await sleep(400);
    g.bypass(`admin_teleport ${anchor.x} ${anchor.y} ${anchor.z}`);
    await sleep(1200);
    g.appearing();
    await sleep(1500);
    console.log(`anchored on the spawn point of ${anchor.name || anchor.npcId} ` +
      `at (${anchor.x},${anchor.y},${anchor.z})`);
  } else {
    console.log('NOTE  no NpcInfo to anchor on — measuring wherever the fixture stood');
  }
  const u0 = S.self;   // the UserInfo the server re-broadcast after the teleport
  console.log(`measuring at ${fmt(u0)} runSpeed=${u0.runSpeed} walkSpeed=${u0.walkSpeed} ` +
    `speedMul=${u0.speedMul} running=${u0.running}`);

  // The position the sampler believes in — updated by every ValidateLocation,
  // MoveToLocation (cx,cy,cz) and TeleportToLocation.
  let known = { x: u0.x, y: u0.y, z: u0.z };
  const noteKnown = (p) => { known = { x: p.x, y: p.y, z: p.z }; };
  g.pos = { ...known, heading: u0.heading || 0 };

  // The probe: a ValidatePosition whose x,y is 3000 units off (always past
  // `dist > actualSpeed`), with the server's own z so isFalling() cannot fire.
  // Returns the ValidateLocation the server answers with, or null.
  async function probe(waitMs = 220) {
    const mark = S.log.length;
    g.pos = { x: known.x + 3000, y: known.y + 3000, z: known.z, heading: g.pos.heading };
    const sent = Date.now() - S.t0;
    g.validatePosition();
    await sleep(waitMs);
    const v = S.log.slice(mark).find((e) => e.op === 'validate');
    if (v) noteKnown(v);
    return v ? { ...v, sent } : null;
  }

  // Order a move. The origin sent is the last known SERVER position, which is
  // what the retail client sends (MoveBackwardToLocation checks
  // `targetLoc.isIn3DRadius(_originX,_originY,_originZ, 9900)`).
  const order = (x, y, z) => { g.pos = { ...known, heading: g.pos.heading }; g.moveTo(x, y, z); };

  // Ground speed, measured over a continuous stretch of walking.
  //
  // THE ESTIMATOR MATTERS, and the obvious one is wrong. The server advances
  // the position in discrete 100 ms ticks of getMoveSpeed()/10 units and
  // reports an INT, so sampling every 250 ms sees 2 ticks, then 3, then 2...
  // — at 126.5 u/s that reads as an alternating 25 and 38 units, i.e.
  // per-interval speeds of 101 and 152 u/s. A median (or any single interval)
  // just picks one alias. What is unbiased is the SLOPE of arclength against
  // time over many samples, so this does a least-squares fit, and only inside
  // the longest run of consecutive samples that all moved — an arrival, or a
  // geopath node the server stopped at, ends the stretch rather than dragging
  // the average down.
  //
  // `direction` is a unit vector; the goal is re-aimed 2500 units ahead of the
  // last known position every `reorderMs` so the character never runs out of
  // leg. Re-ordering does not restart the movement task
  // (CreatureMove.registerMoveTask returns early while _task != null).
  async function measureSpeed(direction, { samples = 24, everyMs = 250, reorderMs = 1500, legUnits = 2500 } = {}) {
    const pts = [];
    // A town is full of walls, and a leg that ends against one produces no
    // samples at all. When three consecutive probes show no movement the
    // direction is rotated 90 degrees and re-aimed, so the measurement finds
    // open ground instead of failing on the geometry.
    let dir = { ...direction };
    const aim = () => order(
      Math.round(known.x + dir.x * legUnits),
      Math.round(known.y + dir.y * legUnits),
      known.z - COLLISION);
    aim();
    let lastOrder = Date.now();
    let stuck = 0;
    for (let i = 0; i < samples; i++) {
      const p = await probe(everyMs);
      if (p) {
        const moved = pts.length === 0 || dist2(pts[pts.length - 1], p) > 0.5;
        pts.push(p);
        stuck = moved ? 0 : stuck + 1;
      }
      if (stuck >= 3 && reorderMs) {
        dir = { x: dir.y, y: -dir.x };     // 90 degrees
        aim(); lastOrder = Date.now(); stuck = 0;
      } else if (reorderMs && Date.now() - lastOrder > reorderMs) {
        aim(); lastOrder = Date.now();
      }
    }
    // longest run of consecutive intervals that all moved
    let best = null, start = 0;
    for (let i = 1; i <= pts.length; i++) {
      const moved = i < pts.length && dist2(pts[i - 1], pts[i]) > 0.5;
      if (!moved) {
        if (i - start >= 3 && (!best || i - start > best.n)) best = { s: start, e: i - 1, n: i - start };
        start = i;
      }
    }
    if (!best) return { pts, speed: null, n: 0 };
    // cumulative arclength vs t, least squares
    let s = 0; const xs = [], ys = [];
    for (let i = best.s; i <= best.e; i++) {
      if (i > best.s) s += dist2(pts[i - 1], pts[i]);
      xs.push(pts[i].t / 1000); ys.push(s);
    }
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return { pts, speed: den > 0 ? num / den : null, n, span: xs[n - 1] - xs[0], dist: s };
  }

  const COLLISION = 24;   // floor Z -> the head-level Z the server keeps
  const NORTH = { x: 0, y: 1 };
  const EAST = { x: 1, y: 0 };
  const report = (m) => m.speed != null
    ? `${m.speed.toFixed(1)} u/s (least-squares over ${m.n} samples, ${m.span.toFixed(1)} s, ${m.dist.toFixed(0)} units)`
    : 'no continuous stretch sampled';

  // ------------------------------------------------------------------ A
  await probe();
  const runRun = await measureSpeed(NORTH, { samples: 26, everyMs: 250 });
  const mul = u0.speedMul;
  const predicted = u0.runSpeed * mul;
  console.log(`     run samples: ${runRun.pts.map((p) => `${p.t}ms${fmt(p)}`).join(' ')}`);

  // NOT "> 1": the multiplier is getMoveSpeed() / getBaseMoveSpeed(), and every
  // term in PlayerStatus.getMoveSpeed can push it either way — DEX_BONUS up
  // (1.10 at DEX 30), swim/swamp/weight-penalty/armour-grade down (measured
  // 0.478 in water). What matters is only that it is not 1, i.e. that the base
  // speeds alone are the wrong number to draw with.
  check('A1. UserInfo carries a movement-speed multiplier and it is NOT 1',
    typeof mul === 'number' && isFinite(mul) && Math.abs(mul - 1) > 1e-4,
    `speedMul=${mul} (UserInfo.java writeF(getStatus().getMovementSpeedMultiplier()), ` +
    `four fields after the base speeds)`);

  check('A2. the server MOVES at runSpeed x multiplier, not at runSpeed',
    runRun.speed != null && Math.abs(runRun.speed - predicted) / predicted < 0.03,
    runRun.speed != null
      ? `measured ${report(runRun)}; runSpeed x mul = ${u0.runSpeed} x ${mul.toFixed(4)} = ` +
        `${predicted.toFixed(1)} (off by ${(100 * (runRun.speed - predicted) / predicted).toFixed(1)}%); ` +
        `base runSpeed alone = ${u0.runSpeed} (off by ` +
        `${(100 * (runRun.speed - u0.runSpeed) / u0.runSpeed).toFixed(1)}%)`
      : 'no usable samples');

  // ------------------------------------------------------------------ B1
  // A SHORT leg — 500 units = 5 m, under the client's old 6 m RUN_THRESHOLD,
  // which walked it at walkSpeed. Measure what the server does with it: one
  // order, no re-aiming, so nothing but that single short leg is in flight.
  await sleep(1500);
  await probe();
  const shortRun = await measureSpeed(EAST, { samples: 14, everyMs: 220, reorderMs: 0, legUnits: 500 });
  const walkPredicted = u0.walkSpeed * mul;
  check('B1. a 5 m leg is covered at RUN speed, not walk speed (no distance rule)',
    shortRun.speed != null &&
      Math.abs(shortRun.speed - predicted) < Math.abs(shortRun.speed - walkPredicted),
    shortRun.speed != null
      ? `measured ${report(shortRun)} over a 500-unit (5 m) leg; run ${predicted.toFixed(1)}, ` +
        `walk ${walkPredicted.toFixed(1)}`
      : 'no usable samples');

  // ------------------------------------------------------------------ B2
  // The stance is a flag, and RequestChangeMoveType is the only request that
  // moves it. Toggle to WALK and re-measure.
  await sleep(1200);
  const markW = S.log.length;
  g.changeMoveType(false);
  await sleep(900);
  const evW = S.log.slice(markW);
  const cmW = evW.find((e) => e.op === 'changeMove');
  const uiW = evW.find((e) => e.op === 'userInfo');
  check('B2. RequestChangeMoveType(walk) broadcasts ChangeMoveType running=0',
    !!cmW && cmW.running === 0,
    cmW ? `ChangeMoveType running=${cmW.running} at ${cmW.t}ms` : 'no ChangeMoveType');
  check('B3. ...and a fresh UserInfo whose isRunning byte is false',
    !!uiW && uiW.running === false,
    uiW ? `UserInfo running=${uiW.running} mul=${uiW.mul} run=${uiW.run} walk=${uiW.walk}` : 'no UserInfo');

  await probe();
  const walkRun = await measureSpeed(NORTH, { samples: 26, everyMs: 250 });
  const mulW = (uiW && uiW.mul) || mul;
  const walkPred2 = u0.walkSpeed * mulW;
  check('B4. while walking the server moves at walkSpeed x multiplier',
    walkRun.speed != null && Math.abs(walkRun.speed - walkPred2) / walkPred2 < 0.04,
    walkRun.speed != null
      ? `measured ${report(walkRun)}; walkSpeed x mul = ${u0.walkSpeed} x ${mulW.toFixed(4)} = ` +
        `${walkPred2.toFixed(1)} (off by ${(100 * (walkRun.speed - walkPred2) / walkPred2).toFixed(1)}%)`
      : 'no usable samples');

  // back to running
  const markR = S.log.length;
  g.changeMoveType(true);
  await sleep(900);
  const cmR = S.log.slice(markR).find((e) => e.op === 'changeMove');
  check('B5. RequestChangeMoveType(run) brings the stance back',
    !!cmR && cmR.running === 1,
    cmR ? `ChangeMoveType running=${cmR.running}` : 'no ChangeMoveType');

  // ------------------------------------------------------------------ C
  // A teleport arriving MID-WALK. Order a long walk, and 600 ms in, GM-teleport
  // the character sideways. Which packet carries it, and where is the character
  // right after?
  await sleep(800);
  await probe();
  const before = { ...known };
  const tpGoal = { x: known.x + 1500, y: known.y - 1500, z: known.z };
  order(known.x, known.y + 2500, known.z - COLLISION);   // long walk north
  await sleep(600);
  const markT = S.log.length;
  g.bypass(`admin_teleport ${tpGoal.x} ${tpGoal.y} ${tpGoal.z}`);
  await sleep(1200);
  const evT = S.log.slice(markT);
  const tp = evT.find((e) => e.op === 'teleport');
  const mvAfterTp = evT.find((e) => e.op === 'move');
  check('C1. a teleport mid-walk arrives as TeleportToLocation (0x28), NOT MoveToLocation',
    !!tp && !mvAfterTp,
    tp ? `TeleportToLocation ${fmt(tp)} at ${tp.t}ms, ordered ${fmt(tpGoal)}; ` +
      `MoveToLocation in the same window: ${mvAfterTp ? 'YES' : 'none'}`
      : 'no TeleportToLocation');
  if (tp) {
    // aCis clears _isTeleporting only when the client answers Appearing(0x30).
    g.appearing();
    await sleep(500);
    noteKnown(tp);
    const p = await probe(400);
    check('C2. the character IS at the teleport point immediately (it did not walk there)',
      !!p && dist2(p, tpGoal) < 200 && dist2(p, before) > 1000,
      p ? `server position after the teleport ${fmt(p)}; ordered ${fmt(tpGoal)} ` +
        `(${dist2(p, tpGoal).toFixed(0)} u away), walk origin ${fmt(before)} ` +
        `(${dist2(p, before).toFixed(0)} u away)`
        : 'no ValidateLocation after the teleport');
  }

  // ------------------------------------------------------------------ D
  // The 9900-unit guard: MoveBackwardToLocation refuses a destination further
  // than 9900 from the ORIGIN THE CLIENT SENDS. With origin == target (what
  // bridge.js used to send) the distance is 0 and the guard can never fire.
  await sleep(800);
  await probe();
  const farGoal = { x: known.x + 12000, y: known.y, z: known.z - COLLISION };
  const markG = S.log.length;
  order(farGoal.x, farGoal.y, farGoal.z);          // honest origin
  await sleep(900);
  const evG = S.log.slice(markG);
  check('D1. with the REAL origin, a >9900-unit destination is refused (no MoveToLocation)',
    !evG.some((e) => e.op === 'move'),
    `ordered ${dist2(known, farGoal).toFixed(0)} units away from ${fmt(known)}; ` +
    `MoveToLocation: ${evG.filter((e) => e.op === 'move').length}, ` +
    `ActionFailed: ${evG.filter((e) => e.op === 'actionFailed').length}`);

  const markG2 = S.log.length;
  g.pos = { ...farGoal, heading: g.pos.heading };   // origin == target, the old bug
  g.moveTo(farGoal.x, farGoal.y, farGoal.z);
  await sleep(900);
  const evG2 = S.log.slice(markG2);
  check('D2. with origin == target the SAME order is accepted — the guard is defeated',
    evG2.some((e) => e.op === 'move'),
    `MoveToLocation: ${evG2.filter((e) => e.op === 'move').length} ` +
    `(isIn3DRadius(origin, 9900) with origin == target measures 0)`);

  if (anchor) { g.bypass('admin_invul'); await sleep(400); }   // back off
  g.close();
  await sleep(4000);

  // ------------------------------------------------------------------ E
  // THE BRIDGE. Everything above is the raw protocol; these are the JSON ops
  // the browser actually receives, because a field decoded in gameclient.js and
  // dropped in bridge.js is still a field the client never sees — which is
  // exactly what all four of these were.
  const WebSocket = require('ws');
  const seen = [];
  const ws = new WebSocket(GATEWAY);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  ws.on('message', (d) => { try { seen.push({ t: Date.now(), ...JSON.parse(d) }); } catch { /* ignore */ } });
  const waitFor = (pred, ms = 20000) => new Promise((resolve) => {
    const t0 = Date.now();
    const poll = setInterval(() => {
      const hit = seen.find(pred);
      if (hit) { clearInterval(poll); resolve(hit); }
      else if (Date.now() - t0 > ms) { clearInterval(poll); resolve(null); }
    }, 50);
  });
  ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
  if (!await waitFor((m) => m.op === 'auth_ok', 30000)) { console.log('FATAL  bridge login'); process.exit(1); }
  ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
  const ew = await waitFor((m) => m.op === 'enterWorld', 30000);
  if (!ew) { console.log('FATAL  bridge enterWorld'); process.exit(1); }
  const wsSelf = ew.char.id;
  const sheet = await waitFor((m) => m.op === 'charSheet', 15000);
  const invList = await waitFor((m) => m.op === 'itemList', 15000);

  check('E1. charSheet carries the movement multiplier',
    !!sheet && isFinite(sheet.speedMul) && Math.abs(sheet.speedMul - 1) > 1e-4,
    sheet ? `speedMul=${sheet.speedMul} runSpeed=${sheet.runSpeed} walkSpeed=${sheet.walkSpeed} ` +
      `-> drawn speed ${(sheet.runSpeed * sheet.speedMul).toFixed(1)} u/s` : 'no charSheet');
  check('E2. charSheet carries BOTH halves of the weight gauge',
    !!sheet && sheet.curLoad != null && sheet.maxLoad != null,
    sheet ? `curLoad=${sheet.curLoad} maxLoad=${sheet.maxLoad}` : 'no charSheet');
  const quest = invList && (invList.items || []).find((i) => i.itemId === QUEST_ITEM);
  check('E3. itemList entries carry type2, and the quest item reads TYPE2_QUEST (3)',
    !!quest && quest.type2 === 3,
    quest ? `item ${quest.itemId} type2=${quest.type2}; ` +
      `${(invList.items || []).filter((i) => i.type2 != null).length}/${(invList.items || []).length} entries carry it`
      : 'quest item not in itemList');

  ws.send(JSON.stringify({ op: 'moveTo', x: ew.char.x, y: ew.char.y + 600, z: ew.char.z,
    ox: ew.char.x, oy: ew.char.y, oz: ew.char.z }));
  const mv = await waitFor((m) => m.op === 'move' && m.id === wsSelf, 6000);
  check('E4. the move op carries the mover\'s position as well as the destination',
    !!mv && mv.x != null && mv.y != null,
    mv ? `move dest (${mv.tx},${mv.ty},${mv.tz}) at (${mv.x},${mv.y},${mv.z})` : 'no move op');

  // Deliberately fired while the E4 walk is still in flight — that is the case
  // that used to make the client walk to the teleport point. The assertion is
  // not "no move ops at all" (the server can still be feeding geopath nodes for
  // the walk): it is that the teleport DESTINATION never arrives dressed as a
  // walk order.
  const markT2 = seen.length;
  const tpDest = { x: ew.char.x + 1200, y: ew.char.y - 1200, z: ew.char.z };
  ws.send(JSON.stringify({ op: 'bypass',
    command: `admin_teleport ${tpDest.x} ${tpDest.y} ${tpDest.z}` }));
  const tpOp = await waitFor((m) => m.op === 'teleport' && m.id === wsSelf, 8000);
  const walkedThere = seen.slice(markT2).find((m) => m.op === 'move' && m.id === wsSelf
    && Math.hypot(m.tx - tpDest.x, m.ty - tpDest.y) < 100);
  check('E5. a teleport reaches the browser as its own op, not as a walk order',
    !!tpOp && !walkedThere,
    tpOp ? `teleport (${tpOp.x},${tpOp.y},${tpOp.z}); move ops in the same window: ` +
      `${seen.slice(markT2).filter((m) => m.op === 'move' && m.id === wsSelf).length}, ` +
      `of which aimed at the teleport point: ${walkedThere ? 1 : 0}` : 'no teleport op');
  ws.close();

  console.log('\n--- wire log ---');
  for (const e of S.log) {
    if (e.op === 'move') console.log(`${String(e.t).padStart(6)}ms move      dest ${fmt({ x: e.tx, y: e.ty, z: e.tz })} at ${fmt(e)}`);
    else if (e.op === 'validate') console.log(`${String(e.t).padStart(6)}ms validate  ${fmt(e)} h=${e.heading}`);
    else if (e.op === 'teleport') console.log(`${String(e.t).padStart(6)}ms teleport  ${fmt(e)}`);
    else if (e.op === 'changeMove') console.log(`${String(e.t).padStart(6)}ms changeMove running=${e.running}`);
    else if (e.op === 'userInfo') console.log(`${String(e.t).padStart(6)}ms userInfo  ${fmt(e)} run=${e.run} walk=${e.walk} mul=${e.mul} running=${e.running}`);
    else if (e.op === 'actionFailed') console.log(`${String(e.t).padStart(6)}ms actionFailed`);
  }

  console.log(`\nVERIFY-MOVEMENT: ${failures.length ? 'FAIL (' + failures.join('; ') + ')' : 'PASS'}  ` +
    `[${passN} passed, ${failures.length} failed]`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('verify-movement error:', (e && e.stack) || e);
  process.exit(1);
});
