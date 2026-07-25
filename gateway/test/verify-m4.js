// M4 verification (live): skills & items.
//  Phase 1: fresh device -> bridge auto-creates Human Fighter -> read char name.
//  Fixture: grant skills 1216 (Self Heal, TARGET_SELF) and 1177 (Wind Strike)
//           directly in DB (test fixture; protocol has no skill-learn shortcut).
//  Phase 2: relogin -> skillList + itemList after enterWorld -> cast Self Heal
//           -> nuke a Gremlin with Wind Strike -> loot the drop.
'use strict';

const WebSocket = require('ws');
const { execSync } = require('child_process');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-m4-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SELF_HEAL = 1216;
const WIND_STRIKE = 1177;

function sql(q) {
  return execSync(`mariadb -u l2j -pl2jpass l2jdb -N -e "${q}" 2>/dev/null`).toString().trim();
}

function connect(devId) {
  const ws = new WebSocket(url);
  ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId: devId })));
  return ws;
}

const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout waiting ' + label)); }
  }, 200);
});

const R = {
  me: null, skills: null, items: null, npcs: [], drops: [],
  casts: [], launches: [], sysMsgs: [], invUpdates: [],
  targetStatus: [], died: false, diedIds: new Set(), dropLooted: false,
};

async function phase1() {
  const ws = connect(deviceId);
  let auth = null;
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.op === 'auth_ok') auth = m;
  });
  await waitFor(() => auth, 30000, 'auth_ok (phase 1)');
  console.log('phase 1: char created:', JSON.stringify(auth.chars));
  ws.close();
  return auth.chars[0].name;
}

async function phase2() {
  const ws = connect(deviceId);
  ws.on('message', async (d) => {
    const m = JSON.parse(d);
    switch (m.op) {
      case 'auth_ok':
        await sleep(400);
        ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
        break;
      case 'enterWorld': R.me = m.char; console.log('enterWorld:', JSON.stringify(m.char)); break;
      case 'skillList': R.skills = m.skills; break;
      case 'itemList': R.items = m.items; break;
      case 'addNpc': R.npcs.push(m); break;
      case 'addDrop': R.drops.push(m); console.log('addDrop:', JSON.stringify(m)); break;
      case 'skillCast': R.casts.push(m); console.log('skillCast:', JSON.stringify(m)); break;
      case 'skillLaunch': R.launches.push(m); console.log('skillLaunch:', JSON.stringify(m)); break;
      case 'sysMsg': R.sysMsgs.push(m); break;
      case 'invUpdate': R.invUpdates.push(m); console.log('invUpdate:', JSON.stringify(m)); break;
      case 'status': R.targetStatus.push(m); break;
      case 'die':
        R.diedIds.add(m.id);
        if (R.gremlin && m.id === R.gremlin.id) { R.died = true; console.log('die (gremlin):', m.id); }
        if (R.gremlin2 && m.id === R.gremlin2.id) console.log('die (gremlin 2):', m.id);
        break;
      case 'remove':
        if (R.looting && m.id === R.looting.id) { R.dropLooted = true; console.log('remove (drop picked up):', m.id); }
        break;
    }
  });

  await waitFor(() => R.me, 40000, 'enterWorld');
  await waitFor(() => R.skills && R.items, 15000, 'skillList+itemList');
  console.log('skillList:', JSON.stringify(R.skills));
  console.log('itemList:', JSON.stringify(R.items.map((i) => `${i.objectId}:${i.itemId}x${i.count}${i.equipped ? '(eq)' : ''}`)));

  // --- cast self-buff (Self Heal, TARGET_SELF) ---
  console.log('casting Self Heal (1216) on self...');
  ws.send(JSON.stringify({ op: 'useSkill', skillId: SELF_HEAL }));
  await waitFor(() => R.casts.find((c) => c.skillId === SELF_HEAL && c.casterId === R.me.id), 10000, 'Self Heal cast');
  await sleep(5500); // hitTime 5000

  // --- nuke a Gremlin ---
  const g = R.npcs
    .filter((n) => n.name === 'Gremlin')
    .map((n) => ({ ...n, dist: Math.hypot(n.x - R.me.x, n.y - R.me.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (!g) throw new Error('no Gremlin nearby');
  R.gremlin = g;
  console.log(`nuking Gremlin id=${g.id} (dist ${g.dist | 0}) with Wind Strike (1177)...`);
  const t0 = Date.now();
  while (!R.died && Date.now() - t0 < 120000) {
    ws.send(JSON.stringify({ op: 'useSkill', skillId: WIND_STRIKE, targetId: g.id }));
    await sleep(8000); // hitTime + reuse
  }
  if (!R.died) throw new Error('gremlin not dead after 120s of nuking');

  // --- loot, phase A: global AutoLoot was ON for the first kill (adena went
  // straight to inventory -> invUpdate). Now toggle it OFF per-player via the
  // .autoloot voiced command (in-protocol) and kill again: the drop must
  // spawn on the ground (addDrop) and be looted manually via target{id}.
  console.log('toggling .autoloot OFF for manual-loot test...');
  ws.send(JSON.stringify({ op: 'say', channel: 0, text: '.autoloot' }));
  await sleep(1500);
  const g2 = R.npcs
    .filter((n) => n.name === 'Gremlin' && !R.diedIds.has(n.id))
    .map((n) => ({ ...n, dist: Math.hypot(n.x - R.me.x, n.y - R.me.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (!g2) throw new Error('no second Gremlin nearby');
  R.gremlin2 = g2;
  console.log(`nuking second Gremlin id=${g2.id} (dist ${g2.dist | 0})...`);
  const t1 = Date.now();
  while (!R.diedIds.has(g2.id) && Date.now() - t1 < 120000) {
    ws.send(JSON.stringify({ op: 'useSkill', skillId: WIND_STRIKE, targetId: g2.id }));
    await sleep(8000);
  }
  if (!R.diedIds.has(g2.id)) throw new Error('second gremlin not dead');

  await waitFor(() => R.drops.length > 0, 15000, 'addDrop after autoloot-off kill');
  const drop = R.drops[R.drops.length - 1];
  R.looting = drop;
  console.log(`looting drop id=${drop.id} itemId=${drop.itemId} x${drop.count} via target{id}...`);
  ws.send(JSON.stringify({ op: 'target', id: drop.id }));
  await waitFor(() => R.dropLooted, 25000, 'drop pickup');
  await sleep(2000);
  ws.close();
}

function finish() {
  const healCast = R.casts.find((c) => c.skillId === SELF_HEAL && c.casterId === R.me.id);
  const healLaunch = R.launches.find((l) => l.skillId === SELF_HEAL);
  const nukeCasts = R.casts.filter((c) => c.skillId === WIND_STRIKE && c.targetId === R.gremlin?.id);
  const nukeLaunches = R.launches.filter((l) => l.skillId === WIND_STRIKE);
  const gotSkillList = R.skills?.some((s) => s.id === SELF_HEAL) && R.skills?.some((s) => s.id === WIND_STRIKE);
  const expMsg = R.sysMsgs.find((m) => m.id === 95);
  const lootUpdate = R.invUpdates.find((u) => u.updated.some((it) => it.change === 'add' || it.change === 'modify'));
  console.log('---');
  console.log(`skillList ok=${!!gotSkillList} itemList count=${R.items?.length}`);
  console.log(`self-buff: cast=${!!healCast} launch=${!!healLaunch}`);
  console.log(`nuke: casts=${nukeCasts.length} launches=${nukeLaunches.length} gremlinDied=${R.died}`);
  console.log(`sysMsg events=${R.sysMsgs.length} (exp msg id=95: ${expMsg ? JSON.stringify(expMsg.params) : 'none'})`);
  console.log(`loot: drops=${R.drops.length} dropLooted=${R.dropLooted} invUpdate(add/modify)=${!!lootUpdate}`);
  const pass = gotSkillList && R.items?.length > 0 && healCast && healLaunch &&
    nukeCasts.length > 0 && nukeLaunches.length > 0 && R.died &&
    R.sysMsgs.length > 0 && R.dropLooted && !!lootUpdate;
  console.log(pass ? 'VERIFY-M4: PASS' : 'VERIFY-M4: FAIL');
  process.exit(pass ? 0 : 1);
}

(async () => {
  const name = await phase1();
  const objId = sql(`SELECT obj_Id FROM characters WHERE char_name='${name}'`);
  console.log(`phase 1.5: granting skills to char obj_id=${objId} via DB fixture`);
  sql(`INSERT IGNORE INTO character_skills (char_obj_id, skill_id, skill_level, class_index) VALUES (${objId}, ${SELF_HEAL}, 1, 0), (${objId}, ${WIND_STRIKE}, 1, 0)`);
  await sleep(1000);
  await phase2();
  finish();
})().catch((e) => { console.error('VERIFY-M4: FAIL', e.message); finish(); });

setTimeout(() => { console.error('VERIFY-M4: global timeout'); finish(); }, 220000);
