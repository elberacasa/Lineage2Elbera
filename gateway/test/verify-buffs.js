// Buffs (abnormal status) + skill cooldown verification.
// Fixture: fresh char, skills granted in DB (same approach as verify-m4):
//   1068 Might (BUFF, 1200s), 1216 Self Heal (HEAL, 10s reuse),
//   2280 Herb of Power (BUFF, 120s — proves expiry).
// Flow: login -> cast Might on self -> buffs has 1068@~1200s -> cast Self
// Heal -> skillCoolTime has 1216 reuse 10 -> cast Herb of Power -> buffs
// has 2280@~120s -> wait ~130s -> 2280 gone from the next full snapshot.
'use strict';

const WebSocket = require('ws');
const { execSync } = require('child_process');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-buffs-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIGHT = 1068, SELF_HEAL = 1216, HERB_POWER = 2280, BATTLE_ROAR = 121; // 600s reuse

function sql(q) {
  return execSync(`mariadb -u l2j -pl2jpass l2jdb -N -e "${q}" 2>/dev/null`).toString().trim();
}

const R = { me: null, me3: null, buffSnaps: [], coolTimes: [], casts: [] };
const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.stack || e.message); process.exit(1); });

const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout: ' + label)); }
  }, 300);
});

(async () => {
  // --- phase 1: create char ---
  let charName = null;
  ws.on('message', async (d) => {
    const m = JSON.parse(d);
    if (m.op === 'auth_ok' && !charName) {
      charName = m.chars[0].name;
      console.log('phase 1: char created:', charName);
      ws.close();
    }
  });
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
  await waitFor(() => charName, 40000, 'phase 1 char creation');
  const objId = sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}'`);
  console.log(`phase 1.5: granting skills to obj_id=${objId} via DB fixture`);
  sql(`INSERT IGNORE INTO character_skills (char_obj_id, skill_id, skill_level, class_index) VALUES (${objId}, ${MIGHT}, 1, 0), (${objId}, ${SELF_HEAL}, 1, 0), (${objId}, ${HERB_POWER}, 1, 0), (${objId}, ${BATTLE_ROAR}, 1, 0)`);
  await sleep(1500);

  // --- phase 2: real session ---
  const ws2 = new WebSocket(url);
  ws2.on('error', (e) => { console.error('ws2 error:', e.stack || e.message); process.exit(1); });
  ws2.on('open', () => ws2.send(JSON.stringify({ op: 'login', deviceId })));
  ws2.on('message', async (d) => {
    const m = JSON.parse(d);
    if (m.op === 'auth_ok') { await sleep(400); ws2.send(JSON.stringify({ op: 'enterChar', slot: 0 })); }
    else if (m.op === 'enterWorld') R.me = m.char;
    else if (m.op === 'buffs') { R.buffSnaps.push(m.effects); console.log('buffs:', JSON.stringify(m.effects)); }
    else if (m.op === 'skillCoolTime') { R.coolTimes.push(m.skills); console.log('skillCoolTime:', JSON.stringify(m.skills)); }
    else if (m.op === 'skillCast') R.casts.push(m);
  });
  const send = (o) => ws2.send(JSON.stringify(o));

  await waitFor(() => R.me, 60000, 'enterWorld');
  await sleep(2500);
  console.log('in world as', R.me.name, 'id', R.me.id);

  // --- cast Might on self ---
  console.log('casting Might (1068) on self...');
  send({ op: 'useSkill', skillId: MIGHT, targetId: R.me.id });
  const mightSnap = await waitFor(() => R.buffSnaps.find((b) => b.some((e) => e.skillId === MIGHT)), 15000, 'buffs with Might');
  const might = mightSnap.find((e) => e.skillId === MIGHT);
  console.log('   Might in buffs:', JSON.stringify(might), '(expect level 1, duration ~1200s)');

  // --- cast Self Heal -> cooldown via skillCast.reuse (ms) ---
  console.log('casting Self Heal (1216)...');
  send({ op: 'useSkill', skillId: SELF_HEAL });
  const healCast = await waitFor(() => R.casts.find((c) => c.skillId === SELF_HEAL), 15000, 'skillCast for 1216');
  console.log('   skillCast for 1216:', JSON.stringify(healCast), '(expect reuse 10000ms)');

  // --- login-time SkillCoolTime: cast Battle Roar (600s reuse, timestamped
  // only when reuse > 30s per PlayerCast) then relog ---
  console.log('casting Battle Roar (121, reuse 600s)...');
  send({ op: 'useSkill', skillId: BATTLE_ROAR });
  await waitFor(() => R.casts.find((c) => c.skillId === BATTLE_ROAR), 15000, 'skillCast for 121');
  await sleep(1000);
  console.log('relogging for login SkillCoolTime...');
  ws2.close();
  await sleep(1200);
  const ws3 = new WebSocket(url);
  ws3.on('error', () => {});
  const coolLogin = [];
  ws3.on('open', () => ws3.send(JSON.stringify({ op: 'login', deviceId })));
  ws3.on('message', async (d) => {
    const m = JSON.parse(d);
    if (m.op === 'auth_ok') { await sleep(300); ws3.send(JSON.stringify({ op: 'enterChar', slot: 0 })); }
    else if (m.op === 'skillCoolTime') { coolLogin.push(m.skills); console.log('skillCoolTime (login):', JSON.stringify(m.skills)); }
    else if (m.op === 'enterWorld') R.me3 = m.char;
    else if (m.op === 'buffs') R.buffSnaps.push(m.effects);
  });
  await waitFor(() => R.me3, 60000, 'relogin enterWorld');
  await sleep(2000);
  const healCt = coolLogin.flat().find((s) => s.id === BATTLE_ROAR);
  console.log('   login coolTime for 121:', JSON.stringify(healCt || null), '(expect reuse 600, remaining <600)');

  // --- cast Herb of Power (120s buff) on the relogged session ---
  console.log('casting Herb of Power (2280)...');
  ws3.send(JSON.stringify({ op: 'useSkill', skillId: HERB_POWER, targetId: R.me3.id }));
  const herbSnap = await waitFor(() => R.buffSnaps.find((b) => b.some((e) => e.skillId === HERB_POWER)), 15000, 'buffs with Herb of Power');
  const herb = herbSnap.find((e) => e.skillId === HERB_POWER);
  console.log('   Herb in buffs:', JSON.stringify(herb), '(expect duration ~120s)');

  // --- wait for expiry (120s + margin) ---
  console.log('waiting ~130s for Herb of Power to expire...');
  const expired = await waitFor(() => {
    const last = R.buffSnaps[R.buffSnaps.length - 1];
    return last && !last.some((e) => e.skillId === HERB_POWER) && R.buffSnaps.length > 0 ? last : null;
  }, 150000, 'Herb expiry snapshot');
  console.log('   buffs after expiry:', JSON.stringify(expired), '(Might still present, Herb gone)');

  console.log('---');
  const pass =
    might && might.level === 1 && might.duration > 1100 &&
    healCast && healCast.reuse >= 10000 && // server-applied reuse (max(skillReuse, hitTime*2)); 15633 for 1216
    healCt && healCt.reuse === 480 && healCt.remaining > 0 && healCt.remaining <= 480 && // 600000 * 333/416 pAtkSpd
    herb && herb.duration > 100 && herb.duration <= 120 &&
    expired && expired.some((e) => e.skillId === MIGHT) && !expired.some((e) => e.skillId === HERB_POWER);
  
  console.log(pass ? 'VERIFY-BUFFS: PASS' : 'VERIFY-BUFFS: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-BUFFS: FAIL', e.stack || e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-BUFFS: global timeout'); process.exit(1); }, 400000);
