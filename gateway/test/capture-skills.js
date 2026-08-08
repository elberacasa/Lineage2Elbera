// capture-skills.js — fire real skills at the running aCis and RECORD what
// comes back. This is an ORACLE, not an assertion suite: it prints the full
// inbound timeline (ms relative to the useSkill send) for each skill so the
// client's behaviour can be compared against observed packets instead of
// against Java read second-hand.
//
// What it does:
//   1. logs in a fixture device, enters the world once so aCis writes the
//      character out, then leaves;
//   2. while OFFLINE, seeds character_skills with the skill set below and
//      sets accesslevel 8 (GM) — aCis loads both at enterWorld;
//   3. logs back in, GM-spawns a target mob next to the character
//      (bypass admin_spawn), targets it, and casts each skill in turn;
//   4. dumps every inbound gateway op with a millisecond offset, plus the
//      undecoded aCis opcodes (needs the gateway started with GW_TRACE=1).
//
// Usage:
//   GW_TRACE=1 GATEWAY_PORT=8095 node src/server.js &      # capture gateway
//   node test/capture-skills.js                            # -> JSON + table
//   node test/capture-skills.js --check                    # re-runnable: asserts
//                                                          # the invariants the
//                                                          # client depends on
'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const GATEWAY = process.env.GATEWAY_URL || 'ws://127.0.0.1:8095';
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];
const DEVICE_ID = process.env.CAPTURE_DEVICE || 'capture-skills-fixture-1';
const CHECK = process.argv.includes('--check');
const OUT = path.join(__dirname, 'capture-skills.json');

// The panel. levels are the real skill levels these ids ship at (aCis
// data/xml/skills). `kind` is only a label for the report.
const PANEL = [
  { id: 1177, level: 1, name: 'Wind Strike',   kind: 'nuke',      needTarget: true },
  { id: 1011, level: 1, name: 'Heal',          kind: 'heal',      needTarget: false },
  { id: 1216, level: 1, name: 'Self Heal',     kind: 'heal-self', needTarget: false },
  { id: 4,    level: 1, name: 'Dash',          kind: 'self-buff', needTarget: false },
  { id: 78,   level: 1, name: 'War Cry',       kind: 'self-buff', needTarget: false },
  { id: 3,    level: 1, name: 'Power Strike',  kind: 'physical',  needTarget: true },
  // Vicious Stance BEFORE Relax, deliberately: Relax force-SITS the caster
  // (observed: changeWait waitType 0 rides with its MagicSkillUse), and every
  // later cast then answers sysMsg 31 "You cannot move while sitting" +
  // ActionFailed. The first capture run had them the other way round and the
  // Vicious Stance line read as a broken toggle when it was a seated caster.
  { id: 312,  level: 1, name: 'Vicious Stance', kind: 'toggle',   needTarget: false },
  { id: 226,  level: 1, name: 'Relax',         kind: 'toggle',    needTarget: false },
];

// The toggle whose OFF path is captured (see above: NOT Relax — its own
// sit state poisons anything cast after it).
const TOGGLE_OFF_ID = 312;

// Squire's Sword is the newbie kit weapon (verify-paperdoll.js): Power Strike
// needs SWORD/BLUNT/BIGBLUNT/BIGSWORD, so the fixture equips one.
const SWORD = 2369;

const derive = (d) => {
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + d).digest('hex');
  return { account: 'w' + h1.slice(0, 12), charName: 'W' + h1.slice(12, 23) };
};
const sql = (q) => execFileSync('mariadb', [...DB, '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY);
    const seen = [];   // {t, ...msg}
    ws.on('message', (d) => {
      try { seen.push({ t: Date.now(), ...JSON.parse(d) }); } catch { /* non-JSON */ }
    });
    ws.on('open', () => resolve({ ws, seen }));
    ws.on('error', reject);
  });
}

const waitFor = (seen, pred, ms = 20000) => new Promise((resolve) => {
  const t0 = Date.now();
  const poll = setInterval(() => {
    const hit = seen.find(pred);
    if (hit) { clearInterval(poll); resolve(hit); }
    else if (Date.now() - t0 > ms) { clearInterval(poll); resolve(null); }
  }, 50);
});

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  const { charName } = derive(DEVICE_ID);

  // ---- pass 1: make sure the character exists, then get offline
  {
    const { ws, seen } = await connect();
    ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
    if (!await waitFor(seen, (m) => m.op === 'auth_ok', 30000)) {
      console.log('FATAL  could not log in — is the capture gateway up on ' + GATEWAY + '?');
      process.exit(1);
    }
    ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
    await waitFor(seen, (m) => m.op === 'enterWorld', 30000);
    await sleep(1500);
    ws.close();
  }
  await sleep(3500);   // aCis flushes the character to the DB on logout

  const owner = Number(sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}' LIMIT 1;`));
  if (!owner) { console.log('FATAL  fixture character not found: ' + charName); process.exit(1); }
  console.log(`fixture: ${charName} (${owner})`);

  // ---- seed skills + GM while offline
  sql(`UPDATE characters SET accesslevel=8 WHERE obj_Id=${owner};`);
  sql(`DELETE FROM character_skills WHERE char_obj_id=${owner};`);
  const rows = PANEL.map((s) => `(${owner},${s.id},${s.level},0)`).join(',');
  sql(`INSERT INTO character_skills (char_obj_id,skill_id,skill_level,class_index) VALUES ${rows};`);
  // enough MP/HP that nothing is denied for resource reasons, and hurt HP so
  // Heal/Self Heal actually have work to do (a full-HP heal still casts).
  sql(`UPDATE characters SET curMp=9999, curHp=10 WHERE obj_Id=${owner};`);
  const have = sql(`SELECT object_id FROM items WHERE owner_id=${owner} AND item_id=${SWORD} LIMIT 1;`);
  if (!have) {
    const oid = Number(sql('SELECT COALESCE(MAX(object_id),0) FROM items;')) + 1000;
    sql(`INSERT INTO items (owner_id,object_id,item_id,count,enchant_level,loc,loc_data,`
      + `custom_type1,custom_type2,mana_left,time) VALUES `
      + `(${owner},${oid},${SWORD},1,0,'INVENTORY',0,0,0,-1,0);`);
  }
  console.log(`seeded ${PANEL.length} skills + accesslevel 8`);

  // ---- pass 2: log back in and cast
  const { ws, seen } = await connect();
  ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
  if (!await waitFor(seen, (m) => m.op === 'auth_ok', 30000)) { console.log('FATAL relogin'); process.exit(1); }
  ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
  const ew = await waitFor(seen, (m) => m.op === 'enterWorld', 30000);
  if (!ew) { console.log('FATAL re-enter'); process.exit(1); }
  const selfId = ew.char.id;
  const skillList = await waitFor(seen, (m) => m.op === 'skillList', 10000);
  console.log('selfId', selfId, 'at', ew.char.x, ew.char.y, ew.char.z);
  console.log('skillList:', JSON.stringify((skillList && skillList.skills) || []));

  // equip the sword in-protocol so Power Strike's weapon condition passes
  const items = await waitFor(seen, (m) => m.op === 'itemList', 10000);
  const inv = (items && items.items) || [];
  const swordOid = (inv.find((i) => i.itemId === SWORD) || {}).objectId;
  const sheet0 = await waitFor(seen, (m) => m.op === 'charSheet', 10000);
  if (swordOid && sheet0 && sheet0.paperdoll && sheet0.paperdoll.rhand !== SWORD) {
    ws.send(JSON.stringify({ op: 'useItem', objectId: swordOid }));
    await sleep(1200);
  }

  // ---- GM: become invulnerable, then spawn a target next to us.
  // Both are needed. The first capture run used an aggressive Gremlin and no
  // invul: the mob killed the level-1 fixture during the SECOND cast and every
  // skill after it answered with a bare ActionFailed, which reads exactly like
  // "the skill is broken" and is not. 20002 Rabbit is passive; admin_invul
  // covers the rest (Formulas.calcAtkBreak can otherwise interrupt a cast).
  ws.send(JSON.stringify({ op: 'bypass', command: 'admin_invul' }));
  await sleep(600);
  seen.length = 0;
  ws.send(JSON.stringify({ op: 'bypass', command: 'admin_spawn 20002 1 0 0' }));
  await sleep(2500);
  const spawned = seen.filter((m) => m.op === 'addNpc');
  const target = spawned[spawned.length - 1] || null;
  console.log('spawn ->', spawned.length, 'addNpc;',
    target ? `target ${target.id} npcId=${target.npcId ?? target.templateId}` : 'NO TARGET');

  // Top the caster up: admin_heal acts on the CURRENT target, so self must be
  // selected first. A level-2 fixture has ~45 MP and the panel drains it — the
  // second capture run lost the whole tail of the suite to sysMsg 24 "Not
  // enough MP", which reads like a broken skill and is not.
  const topUp = async () => {
    ws.send(JSON.stringify({ op: 'target', id: selfId }));
    await sleep(300);
    ws.send(JSON.stringify({ op: 'bypass', command: 'admin_heal' }));
    await sleep(400);
  };

  const timelines = [];
  for (const s of PANEL) {
    await topUp();
    // fresh target selection before every cast (a dead/lost target silently
    // turns a targeted cast into "nothing happens", which is exactly the kind
    // of false negative that would poison this capture)
    if (s.needTarget && target) {
      ws.send(JSON.stringify({ op: 'target', id: target.id }));
      await sleep(700);
      // Stand ON the target. Power Strike has castRange 40 (~0.4 m): with the
      // mob wandering, one run answered MoveToPawn + sysMsg 748 "the distance
      // is too far and so the casting has been stopped" and never cast at all.
      ws.send(JSON.stringify({ op: 'bypass', command: 'admin_teleportto' }));
      await sleep(900);
      ws.send(JSON.stringify({ op: 'target', id: target.id }));
      await sleep(500);
    }
    seen.length = 0;
    const t0 = Date.now();
    ws.send(JSON.stringify({ op: 'useSkill', skillId: s.id }));
    await sleep(9000);   // longest hitTime in the panel is 5000 + launch tail
    const events = seen.map((m) => {
      const { t, ...rest } = m;
      return { dt: t - t0, ...rest };
    // movement/HP chatter from the mob would bury the signal
    }).filter((e) => !['move', 'stopMove', 'traceUndecoded'].includes(e.op)
                     || e.op === 'traceUndecoded');
    timelines.push({ skill: s, events });
    console.log(`\n=== ${s.name} (${s.id}, ${s.kind}) ============================`);
    for (const e of events) console.log(String(e.dt).padStart(6) + ' ms  ' + JSON.stringify(e).slice(0, 260));
    await sleep(1500);
  }

  // ---- stand back up (Relax sits us) before anything else is measured
  ws.send(JSON.stringify({ op: 'action', actionId: 0 }));   // Sit/Stand
  await sleep(1500);

  // ---- toggle ON then OFF back to back, with a full MP bar underneath.
  // Vicious Stance drains MP over time and aCis drops it the moment MP runs
  // short (sysMsg 140 "Your skill was removed due to a lack of MP"), so an
  // un-topped-up re-use turns the toggle back ON instead of off.
  // Three uses back to back, each recorded: the toggle's state before the
  // probe is not knowable (an earlier panel entry may have left it on, and
  // aCis silently drops it on low MP), so the ON/OFF pair is read off the
  // AbnormalStatusUpdate snapshots rather than assumed.
  const toggleUses = [];
  for (let i = 0; i < 3; i++) {
    await topUp();
    seen.length = 0;
    const t0 = Date.now();
    ws.send(JSON.stringify({ op: 'useSkill', skillId: TOGGLE_OFF_ID }));
    await sleep(2500);
    const evs = seen.map((m) => ({ dt: m.t - t0, ...m, t: undefined }))
      .filter((e) => e.op !== 'move');
    toggleUses.push(evs);
    const snap = evs.filter((e) => e.op === 'buffs').pop();
    const on = snap && (snap.effects || []).some((x) => x.skillId === TOGGLE_OFF_ID);
    console.log(`\n=== toggle ${TOGGLE_OFF_ID} USE #${i + 1} -> ${on ? 'ON' : 'OFF'} ===`);
    for (const e of evs) console.log(String(e.dt).padStart(6) + ' ms  ' + JSON.stringify(e).slice(0, 260));
  }
  const toggleOff = toggleUses;

  // ---- move-while-casting probe. PlayableAI.onIntentionMoveTo answers
  // clientActionFailed() whenever getCast().isCastingNow() — so a movement
  // click during a cast produces a bare ActionFailed AND the cast keeps
  // running to completion. Any client that treats ActionFailed as "the cast
  // died" desyncs here. Deterministic, unlike the damage probe below.
  let moveDuringCast = null;
  {
    await topUp();
    seen.length = 0;
    const t0 = Date.now();
    ws.send(JSON.stringify({ op: 'useSkill', skillId: 1011 }));   // Heal, ~7.8 s
    await sleep(1500);
    ws.send(JSON.stringify({ op: 'moveTo', x: ew.char.x + 250, y: ew.char.y + 250, z: ew.char.z }));
    await sleep(8000);
    moveDuringCast = seen.map((m) => ({ dt: m.t - t0, ...m, t: undefined }))
      .filter((e) => e.op !== 'move' || e.id === selfId);
    console.log('\n=== MOVE-WHILE-CASTING PROBE (cast Heal, moveTo at +1.5 s) ===');
    for (const e of moveDuringCast) console.log(String(e.dt).padStart(6) + ' ms  ' + JSON.stringify(e).slice(0, 260));
  }

  // ---- interrupt probe: take hits during a long magical cast.
  // CreatureCast.stop() broadcasts MagicSkillCanceled(0x49) — the ONLY signal
  // that an in-flight cast died. Nothing in the gateway decodes it, so it shows
  // up here as traceUndecoded 0x49 and never reaches the browser.
  //
  // Two routes were tried and rejected. Moving does NOT interrupt (PlayerAI
  // .onIntentionMoveTo answers ActionFailed while casting — observed). Killing
  // the target mid-cast does NOT interrupt either (observed: Wind Strike ran to
  // completion on a corpse). What does is damage: Formulas.calcCastBreak, which
  // returns early for invul targets — hence admin_invul off first — is chance
  // based, so this retries.
  let interrupt = null;
  {
    ws.send(JSON.stringify({ op: 'bypass', command: 'admin_invul' }));   // OFF
    await sleep(600);
    seen.length = 0;
    ws.send(JSON.stringify({ op: 'bypass', command: 'admin_spawn 20001 1 0 0' }));  // Gremlin
    await sleep(3000);
    const gremlin = seen.filter((m) => m.op === 'addNpc').pop();
    // a GM standing still is not attacked: the mob has to be provoked first
    if (gremlin) {
      ws.send(JSON.stringify({ op: 'attack', id: gremlin.id }));
      await sleep(4000);
    }
    for (let attempt = 1; attempt <= 6 && !interrupt; attempt++) {
      await topUp();
      // Re-spawn: attempts 3-6 of an earlier run all answered sysMsg 109
      // "Invalid target" because attempt 2 had killed the mob.
      seen.length = 0;
      ws.send(JSON.stringify({ op: 'bypass', command: 'admin_spawn 20001 1 0 0' }));
      await sleep(2500);
      const mob = seen.filter((m) => m.op === 'addNpc').pop() || gremlin;
      if (mob) { ws.send(JSON.stringify({ op: 'target', id: mob.id })); await sleep(500); }
      seen.length = 0;
      const t0 = Date.now();
      // Wind Strike (6.2 s cast, 9.4 s reuse) — Heal's 15.6 s reuse made every
      // second attempt answer sysMsg 48 instead of casting
      ws.send(JSON.stringify({ op: 'useSkill', skillId: 1177 }));
      // GM-teleport away mid-cast on the later attempts: onMagicLaunch's
      // escapeRange check then fails and calls stop() -> MagicSkillCanceled,
      // which is deterministic where waiting to be hit is not.
      if (attempt >= 3) {
        await sleep(1500);
        ws.send(JSON.stringify({ op: 'bypass',
          command: `admin_teleport ${ew.char.x + 4000} ${ew.char.y + 4000} ${ew.char.z}` }));
        await sleep(9500);
      } else await sleep(11000);
      const evs = seen.map((m) => ({ dt: m.t - t0, ...m, t: undefined }))
        .filter((e) => e.op !== 'move');
      const cancelled = evs.some((e) => e.op === "skillCancel");
      console.log(`\n=== INTERRUPT PROBE attempt ${attempt} -> `
        + `${cancelled ? 'CAST CANCELLED (0x49 seen)' : 'no cancel this time'} ===`);
      for (const e of evs) console.log(String(e.dt).padStart(6) + ' ms  ' + JSON.stringify(e).slice(0, 260));
      if (cancelled) interrupt = evs;
    }
    ws.send(JSON.stringify({ op: 'bypass', command: 'admin_invul' }));   // back ON
    await sleep(400);
  }

  ws.close();

  fs.writeFileSync(OUT, JSON.stringify({
    when: new Date().toISOString(), selfId, targetId: target && target.id,
    skillList: (skillList && skillList.skills) || [], timelines, toggleUses, moveDuringCast, interrupt,
  }, null, 1));
  console.log(`\nwrote ${OUT}`);

  // ---- invariants the CLIENT depends on (only asserted with --check)
  if (CHECK) {
    console.log('\n--- invariants ---');
    for (const tl of timelines) {
      const cast = tl.events.find((e) => e.op === 'skillCast');
      const launch = tl.events.find((e) => e.op === 'skillLaunch');
      const label = `${tl.skill.name}(${tl.skill.id})`;
      const gauge = tl.events.find((e) => e.op === 'gauge');
      if (tl.skill.kind === 'toggle') {
        // aCis DOES send MagicSkillUse for a toggle — with hitTime 0, reuse 0
        // (PlayerCast.doToggleCast). What it does NOT send is a gauge or a
        // launch. A client that draws a bar off `hitTime || 1000` invents one.
        check(`${label}: toggle MagicSkillUse carries hitTime 0 / reuse 0`,
          !!cast && cast.hitTime === 0 && cast.reuse === 0,
          cast ? `hitTime=${cast.hitTime} reuse=${cast.reuse}` : 'no skillCast at all');
        check(`${label}: toggle draws NO gauge`, !gauge,
          gauge ? JSON.stringify(gauge) : 'no SetupGauge, as expected');
        check(`${label}: toggle produces NO MagicSkillLaunched`, !launch,
          launch ? `dt=${launch.dt}` : 'none, as expected');
        const buffs = tl.events.filter((e) => e.op === 'buffs' || e.op === 'buffUpdate');
        check(`${label}: toggle reports an effect`, buffs.length > 0,
          buffs.length ? JSON.stringify(buffs[0]).slice(0, 160) : 'no buff op');
        continue;
      }
      check(`${label}: MagicSkillUse arrives`, !!cast,
        cast ? `hitTime=${cast.hitTime} reuse=${cast.reuse} dt=${cast.dt}` : 'never');
      if (!cast) continue;
      check(`${label}: MagicSkillLaunched arrives`, !!launch,
        launch ? `dt=${launch.dt}` : 'never');
      if (launch) {
        const gap = launch.dt - cast.dt;
        // the claim under test: aCis schedules onMagicLaunch at hitTime-400
        check(`${label}: launch lands ~400 ms BEFORE hitTime elapses`,
          gap < cast.hitTime && Math.abs((cast.hitTime - gap) - 400) < 60,
          `launch at +${gap} ms of a ${cast.hitTime} ms cast (delta ${cast.hitTime - gap})`);
      }
      // SetupGauge is the real cast bar, and its time IS the MagicSkillUse
      // hitTime — but only above the 410 ms floor CreatureCast.doCast applies.
      if (cast.hitTime > 410) {
        check(`${label}: SetupGauge arrives and matches hitTime`,
          !!gauge && gauge.time === cast.hitTime && gauge.color === 'blue',
          gauge ? JSON.stringify(gauge) : 'no gauge op (is the gateway current?)');
      } else {
        check(`${label}: no gauge below the 410 ms floor`, !gauge,
          gauge ? JSON.stringify(gauge) : 'none, as expected');
      }
      const sysAfterLaunch = tl.events.filter(
        (e) => e.op === 'sysMsg' && launch && e.dt >= launch.dt);
      if (launch) {
        console.log(`      after-launch sysMsgs for ${label}: `
          + JSON.stringify(sysAfterLaunch.map((e) => e.id)));
      }
    }

    // toggle ON vs OFF are the SAME packet apart from the system message and
    // the effect snapshot: 46 USE_S1 + effect present on, 335 ABORTED + effect
    // gone on off. Nothing else distinguishes them.
    const onUse = toggleUses.find((evs) => evs.some(
      (e) => e.op === 'buffs' && (e.effects || []).some((x) => x.skillId === TOGGLE_OFF_ID)));
    const offUse = toggleUses.find((evs) => evs.some((e) => e.op === 'buffs')
      && !evs.some((e) => e.op === 'buffs' && (e.effects || []).some((x) => x.skillId === TOGGLE_OFF_ID)));
    check('toggle ON is signalled by sysMsg 46 + the effect appearing',
      !!onUse && onUse.some((e) => e.op === 'sysMsg' && e.id === 46),
      onUse ? JSON.stringify(onUse.filter((e) => e.op === 'sysMsg').map((e) => e.id)) : 'no ON use captured');
    check('toggle OFF is signalled by sysMsg 335 + the effect disappearing',
      !!offUse && offUse.some((e) => e.op === 'sysMsg' && e.id === 335),
      offUse ? JSON.stringify(offUse.filter((e) => e.op === 'sysMsg').map((e) => e.id)) : 'no OFF use captured');

    // a movement click during a cast is answered with a bare ActionFailed and
    // the cast STILL completes — the client must not treat it as an abort
    if (moveDuringCast) {
      const mCast = moveDuringCast.find((e) => e.op === 'skillCast');
      const mFail = moveDuringCast.find((e) => e.op === 'actionFailed');
      const mLaunch = moveDuringCast.find((e) => e.op === 'skillLaunch');
      check('move during cast: bare ActionFailed, cast still completes',
        !!mCast && !!mFail && !!mLaunch && mFail.dt < mLaunch.dt
        && !moveDuringCast.some((e) => e.op === 'skillCancel'),
        mCast ? `cast +${mCast.dt}, actionFailed +${mFail && mFail.dt}, `
          + `launch +${mLaunch && mLaunch.dt}, skillCancel=${moveDuringCast.some((e) => e.op === 'skillCancel')}`
          : 'no cast');
    }

    // a real abort DOES arrive, as MagicSkillCanceled -> op skillCancel
    check('an aborted cast reports skillCancel (MagicSkillCanceled 0x49)',
      !!interrupt && interrupt.some((e) => e.op === 'skillCancel'),
      interrupt ? JSON.stringify(interrupt.filter(
        (e) => e.op === 'skillCancel' || e.op === 'traceUndecoded').slice(0, 4))
        : 'no interrupt captured (probe is chance/teleport based)');

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
  process.exit(0);
})().catch((err) => { console.error('CAPTURE ERROR', err); process.exit(1); });
