// Live verification of the ATTACK-TIMING data the bridge now forwards.
//
// Every field asserted here is one the server already sent and the gateway used
// to read and throw away:
//   charSheet.pAtkSpd / .mAtkSpd / .atkSpdMul / .running  <- UserInfo
//   addNpc.pAtkSpd    / .mAtkSpd / .atkSpdMul / .rhand    <- AbstractNpcInfo
//   addPlayer.pAtkSpd / .atkSpdMul / .running             <- CharInfo
//   attack.hitIndex / .hitCount                           <- Attack hit array
//
// The offsets are proved against aCis's own arithmetic, not against a guess:
//   CreatureStatus.getAttackSpeedMultiplier() = 1.1 * pAtkSpd / basePAtkSpd
//   => 1.1 * pAtkSpd / atkSpdMul must reproduce the TEMPLATE's atkSpd, which
//      for a player is CreatureTemplate's default 300 and for an NPC is the
//      `atkSpd` set in server/aCis_datapack/data/xml/npcs/*.xml. That file is
//      read here and compared, so a wrong offset cannot pass.
//
// It then swings at a monster and times the Attack broadcasts against
//   Formulas.calculateTimeBetweenAttacks = max(100, 500000 / pAtkSpd).
//
// Usage: node test/verify-atkspeed.js [deviceId]
'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-atkspeed-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NPC_XML_DIR = path.join(__dirname,
  '../../server/aCis_datapack/data/xml/npcs');

// npcId -> template atkSpd, straight out of the datapack the server loaded.
function loadTemplateAtkSpd() {
  const map = new Map();
  let files = [];
  try { files = fs.readdirSync(NPC_XML_DIR).filter((f) => f.endsWith('.xml')); }
  catch { return map; }
  for (const f of files) {
    const text = fs.readFileSync(path.join(NPC_XML_DIR, f), 'utf8');
    const re = /<npc id="(\d+)"[\s\S]*?(?=<npc id="|<\/list>)/g;
    let m;
    while ((m = re.exec(text))) {
      const atk = /<set name="atkSpd" val="([\d.]+)"\s*\/>/.exec(m[0]);
      if (atk) map.set(Number(m[1]), Number(atk[1]));
    }
  }
  return map;
}

const R = { sheet: null, npcs: [], players: [], attacks: [], moves: new Map(), me: null };
const fail = [];
const pass = [];
const check = (ok, msg) => (ok ? pass : fail).push(msg);

const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.stack || e.message); process.exit(1); });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));

ws.on('message', async (data) => {
  const msg = JSON.parse(data);
  switch (msg.op) {
    case 'auth_ok':
      await sleep(400);
      ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
      break;
    case 'enterWorld':
      R.me = msg.char;
      await sleep(4000);
      run();
      break;
    case 'charSheet': if (!R.sheet) R.sheet = msg; break;
    case 'addNpc': R.npcs.push(msg); break;
    case 'addPlayer': R.players.push(msg); break;
    case 'move': R.moves.set(msg.id, { x: msg.tx, y: msg.ty, z: msg.tz }); break;
    case 'attack': R.attacks.push({ ...msg, t: Date.now() }); break;
    default: break;
  }
});

// basePAtkSpd implied by the pair, per CreatureStatus.getAttackSpeedMultiplier
const impliedBase = (pAtkSpd, mul) => (mul > 0 ? (1.1 * pAtkSpd) / mul : null);
const timeAtk = (pAtkSpd) => Math.max(100, Math.floor(500000 / pAtkSpd));

async function run() {
  const templates = loadTemplateAtkSpd();
  const s = R.sheet;
  console.log('charSheet:', JSON.stringify({
    pAtkSpd: s && s.pAtkSpd, mAtkSpd: s && s.mAtkSpd,
    atkSpdMul: s && s.atkSpdMul, running: s && s.running,
  }));

  check(!!s, 'charSheet received');
  if (s) {
    check(s.pAtkSpd > 0, `charSheet.pAtkSpd > 0 (${s.pAtkSpd})`);
    check(typeof s.atkSpdMul === 'number' && s.atkSpdMul > 0,
      `charSheet.atkSpdMul > 0 (${s.atkSpdMul})`);
    const base = impliedBase(s.pAtkSpd, s.atkSpdMul);
    // CreatureTemplate.java:58 — set.getDouble("atkSpd", 300.); no class XML
    // overrides it, so every player template resolves to exactly 300.
    check(base != null && Math.abs(base - 300) < 0.01,
      `self implied basePAtkSpd == 300 (CreatureTemplate default) — got ${base && base.toFixed(4)}`);
    check(s.running === true,
      `charSheet.running === true (Player.setRunning(true) at world entry) — got ${s.running}`);
    console.log(`  -> attack interval = max(100, 500000/${s.pAtkSpd}) = ${timeAtk(s.pAtkSpd)} ms`);
  }

  const npcs = R.npcs.filter((n) => n.pAtkSpd > 0);
  console.log(`addNpc: ${R.npcs.length} seen, ${npcs.length} carry pAtkSpd, ` +
    `${templates.size} npc templates read from the datapack`);
  const seen = new Set();
  let checkedNpcs = 0, badNpcs = [];
  for (const n of npcs) {
    if (seen.has(n.npcId)) continue;
    seen.add(n.npcId);
    const base = impliedBase(n.pAtkSpd, n.atkSpdMul);
    const tmpl = templates.get(n.npcId);
    console.log(`  npc ${n.npcId} ${JSON.stringify(n.name)}: pAtkSpd=${n.pAtkSpd} ` +
      `mAtkSpd=${n.mAtkSpd} atkSpdMul=${n.atkSpdMul.toFixed(6)} rhand=${n.rhand} ` +
      `-> implied base ${base.toFixed(3)} vs template atkSpd ${tmpl} ` +
      `| interval ${timeAtk(n.pAtkSpd)}ms`);
    if (tmpl != null) {
      checkedNpcs++;
      // float32 round-trip of the multiplier: allow a small relative slack
      if (Math.abs(base - tmpl) / tmpl > 1e-4) badNpcs.push(`${n.npcId}:${base.toFixed(3)}!=${tmpl}`);
    }
  }
  check(npcs.length > 0, `addNpc carries pAtkSpd (${npcs.length} of ${R.npcs.length})`);
  check(checkedNpcs > 0 && badNpcs.length === 0,
    `every NPC's implied basePAtkSpd matches its datapack atkSpd (${checkedNpcs} checked${badNpcs.length ? ', bad: ' + badNpcs.join(',') : ''})`);

  if (R.players.length) {
    for (const p of R.players.slice(0, 3)) {
      console.log(`  player ${p.name}: pAtkSpd=${p.pAtkSpd} atkSpdMul=${p.atkSpdMul} running=${p.running}`);
    }
    check(R.players.every((p) => p.pAtkSpd > 0
      && Math.abs(impliedBase(p.pAtkSpd, p.atkSpdMul) - 300) < 0.01),
      'every addPlayer implied basePAtkSpd == 300 (CharInfo offset proof)');
  } else {
    console.log('  (no other player visible — addPlayer fields not exercised this run)');
  }

  await swingAtSomething();

  console.log(`\nattack ops: ${R.attacks.length}`);
  for (const a of R.attacks.slice(0, 6)) {
    console.log(`  attack id=${a.id} target=${a.targetId} dmg=${a.damage} ` +
      `hit ${a.hitIndex}/${a.hitCount} type=${a.attackType} hitDelay=${a.hitDelay}ms ` +
      `crit=${a.critical} miss=${a.miss} shield=${a.shield} ss=${a.soulshot}`);
  }
  const own = R.attacks.filter((a) => a.id === R.me.id && a.hitIndex === 0);
  check(R.attacks.length > 0, `attack ops observed (${R.attacks.length})`);
  check(R.attacks.every((a) => typeof a.hitIndex === 'number'
    && typeof a.hitCount === 'number' && a.hitIndex < a.hitCount),
    'every attack op carries a consistent hitIndex/hitCount');

  // hitDelay must reproduce CreatureAttack's own schedule for the attacker's
  // weapon class. Recomputed here from the attacker's pAtkSpd as seen on the
  // charSheet / addNpc stream, independently of the bridge.
  const spdOf = (id) => (id === R.me.id ? (s && s.pAtkSpd)
    : (R.npcs.find((n) => n.id === id) || {}).pAtkSpd);
  const bad = [];
  for (const a of R.attacks) {
    const spd = spdOf(a.id);
    if (!(spd > 0)) continue;
    const t = Math.max(100, Math.floor(500000 / spd));
    const expect = a.attackType === 'BOW' ? t
      : (a.attackType === 'DUAL' || a.attackType === 'DUALFIST')
        ? Math.floor(Math.floor(t / 2) / 2) * (a.hitIndex + 1)
        : Math.floor(t / 2);
    if (a.hitDelay !== expect) bad.push(`${a.id}/${a.attackType}: ${a.hitDelay} != ${expect}`);
  }
  check(R.attacks.some((a) => a.hitDelay > 0) && bad.length === 0,
    `every attack.hitDelay reproduces CreatureAttack's schedule${bad.length ? ' — ' + bad.join('; ') : ''}`);
  check(R.attacks.every((a) => typeof a.attackType === 'string'),
    'every attack op carries the attacker\'s aCis WeaponType');

  // Observed swing cadence vs Formulas.calculateTimeBetweenAttacks.
  if (own.length >= 3 && s) {
    const gaps = [];
    for (let i = 1; i < own.length; i++) gaps.push(own[i].t - own[i - 1].t);
    // Only consecutive swings of one uninterrupted chain are meaningful; drop
    // gaps longer than 3 intervals (re-target / walk / AI pause).
    const expect = timeAtk(s.pAtkSpd);
    const chain = gaps.filter((g) => g < expect * 3).sort((a, b) => a - b);
    const median = chain.length ? chain[chain.length >> 1] : null;
    console.log(`\nown swings: ${own.length}, gaps ${JSON.stringify(gaps)}`);
    console.log(`  expected interval (500000/${s.pAtkSpd}) = ${expect} ms, median observed = ${median} ms`);
    check(median != null && Math.abs(median - expect) <= Math.max(150, expect * 0.2),
      `observed swing cadence matches max(100, 500000/pAtkSpd) within 20% (${median} vs ${expect})`);
  } else {
    console.log('\n(not enough consecutive own swings to time the cadence)');
  }

  console.log('\n--- PASS ---');
  for (const p of pass) console.log('  PASS', p);
  if (fail.length) {
    console.log('--- FAIL ---');
    for (const f of fail) console.log('  FAIL', f);
  }
  console.log(fail.length ? `\nRESULT: FAIL (${fail.length})` : `\nRESULT: PASS (${pass.length})`);
  ws.close();
  process.exit(fail.length ? 1 : 0);
}

// Walk to the nearest attackable monster and hold an attack chain long enough
// to time it. Same approach pattern as verify-combat.js (straight-line legs).
async function swingAtSomething() {
  const me = R.me;
  const selfPos = () => R.moves.get(me.id) || me;
  const npcPos = (g) => R.moves.get(g.id) || g;
  const mobs = R.npcs
    .filter((n) => n.name === 'Gremlin')
    .map((n) => ({ ...n, dist: Math.hypot(n.x - me.x, n.y - me.y) }))
    .sort((a, b) => a.dist - b.dist);
  if (!mobs.length) { console.log('no Gremlin in the addNpc stream'); return; }

  for (const g of mobs.slice(0, 3)) {
    console.log(`\napproaching Gremlin ${g.id} (dist ${g.dist | 0})`);
    ws.send(JSON.stringify({ op: 'target', id: g.id }));
    await sleep(800);
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      const p = npcPos(g), m = selfPos();
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d > 80) {
        const leg = Math.min(d, 150);
        ws.send(JSON.stringify({
          op: 'moveTo',
          x: (leg >= d ? p.x + 20 : m.x + ((p.x - m.x) / d) * leg) | 0,
          y: (leg >= d ? p.y : m.y + ((p.y - m.y) / d) * leg) | 0,
          z: p.z | 0,
        }));
        await sleep(Math.min(12000, (leg / 115) * 1000 + 2500));
        continue;
      }
      ws.send(JSON.stringify({ op: 'attack', id: g.id }));
      await sleep(6000);      // let the auto-attack chain run untouched
      if (R.attacks.filter((a) => a.id === me.id).length >= 5) return;
    }
    if (R.attacks.filter((a) => a.id === me.id).length >= 3) return;
  }
}
