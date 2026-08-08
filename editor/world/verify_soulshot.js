// verify_soulshot.js — soulshots in the browser client, LIVE against the real
// stack (aCis :2106/:7777 + ElberaGate :8090 + ElberaClient :8083).
//
// Covers the two defects reported on 2026-08-08 ("soulshots animation is not
// there and is not working as a toggle in the skill bar"). Everything asserted
// here was first MEASURED against the running client; the before/after numbers
// are in the report.
//
// WHAT IS BEING PROVED, and where each expected value comes from
// --------------------------------------------------------------
// A. THE TOGGLE
//   A1 an item dropped on the bar draws its REAL icon and name. An item
//      shortcut stores the inventory OBJECT id (inventorywnd.js drag payload;
//      aCis stores the same thing — ShortcutList.addShortcut resolves it with
//      getItemByObjectId), so the icon has to be resolved objectId -> itemId
//      through the inventory. It used to look the objectId up in the ITEM
//      table and always miss ("?" / "Item #268530204").
//   A2 clicking the slot sends autoShot and aCis answers ExAutoSoulShot, which
//      the gateway forwards as autoShotState. aCis answers ONLY on success
//      (RequestAutoSoulShot returns silently otherwise), so this is the truth.
//   A3 the mark survives a full itemList refresh — the objectId map is rebuilt
//      from scratch by InventoryWnd.setItems on every one.
//   A4 the mark survives a page flip away and back (the bar re-renders).
//   A5 the SHORTCUT survives a relog. This is the defect the owner hit: the
//      bar persisted page 0 in a flat form that its own loader read as a PAGE,
//      so load() — which runs at the end of the enterWorld handler — dropped
//      every page-0 slot and the shot was not on the bar at all after relog.
//   A6 after relog the mark is OFF and clicking re-arms it. That is the
//      server's behaviour, not a client compromise: aCis keeps the auto-shot
//      set in Player._activeSoulShots, a plain in-memory Set that nothing
//      persists, so a fresh session starts with automatic use disabled.
//
// B. THE EFFECT
//   B1 a shot-charged attack draws NO invented glint. skillFx used to pop an
//      additive sprite tinted 0xfff2a8 — a literal that appears in no client
//      table — off the Attack packet's HITFLAG_SS.
//   B2 the retail trigger arrives instead: aCis SoulShots.useItem broadcasts
//      MagicSkillUse(player, player, <the item's item_skill>, 1, 0, 0), which
//      reaches the client as skillCast. Soulshot: No Grade (1835) carries
//      item_skill 2039-1 in the datapack, so skillCast.skillId must be 2039.
//   B3 that skill plays NO cast gesture: skillgrp.dat gives 2039 animation ""
//      (assets/gamedata/skillgrp.json), and clipForSkill() returns null for an
//      empty animation code. entities.lastCastClip is the hook.
//   B4 its sound is the retail one. skillsoundgrp.dat binds 2039 to
//      SkillSound.soul_shot_cast / soul_shot_shot and assets/audio/bindings.json
//      already carries exactly those two under skill 2039.
//
// FIXTURE. The character needs shots AND a weapon whose grade matches them:
// SoulShots.useItem refuses on a crystal-type mismatch, and the starter
// Squire's Sword (2369) has no crystal_type, so NO-GRADE shots (1835) are the
// only ones that can ever charge on a fresh character. Seeded straight into
// the DB while the character is offline — aCis loads the inventory at
// enterWorld — reusing gateway/test/verify-shots.js's fixture character.
//
// Usage:
//   node verify_soulshot.js            # run, write screenshots + JSON
//   node verify_soulshot.js --check    # same, exit 1 on any failure
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.CLIENT_URL || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];

const DEVICE_ID = 'verify-shots-fixture-1';   // same fixture as gateway/test/verify-shots.js
const SS_NOGRADE = 1835;      // Soulshot: No Grade — item_skill 2039-1
const SS_SKILL = 2039;        // the skill aCis broadcasts when it charges
const SEED_COUNT = 5000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function derive(deviceId) {
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + deviceId).digest('hex');
  return { account: 'w' + h1.slice(0, 12), charName: 'W' + h1.slice(12, 23) };
}
function sql(query) {
  return execFileSync('mariadb', [...DB, '-N', '-B', '-e', query], { encoding: 'utf8' }).trim();
}

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// --- page helpers -----------------------------------------------------------

async function boot(page) {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected'
    + ' && window.__world.net.log.some(m => m.op === "itemList")', { timeout: 180000 });
  // The bar restores its persisted slots at the END of the enterWorld handler,
  // which awaits the scene load — waiting on the packet is not enough.
  await page.waitForFunction(
    'window.__world.shortcutWnd && window.__world.shortcutWnd.charName !== "default"',
    { timeout: 180000 });
  await sleep(2500);
}

const slotState = () => {
  const el = document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="item"]');
  if (!el) return { present: false };
  return {
    present: true,
    sid: +el.dataset.sid,
    title: el.title,
    hasIcon: !!el.querySelector('img'),
    marked: el.classList.contains('l2-toggle-active'),
  };
};

// --- main -------------------------------------------------------------------

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = { console: [] };
  const { charName } = derive(DEVICE_ID);

  // ---- fixture: no-grade shots in the inventory, seeded while offline ------
  const charId = sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}'`);
  if (!charId) {
    console.log(`FAIL  fixture character ${charName} does not exist`);
    console.log('      run: cd gateway && node test/verify-shots.js   (it creates it)');
    process.exit(1);
  }
  const online = sql(`SELECT online FROM characters WHERE obj_Id=${charId}`);
  check('fixture character is offline before seeding', online === '0', `online=${online}`);
  const existing = sql(
    `SELECT object_id FROM items WHERE owner_id=${charId} AND item_id=${SS_NOGRADE}`);
  if (existing) {
    sql(`UPDATE items SET count=${SEED_COUNT} WHERE object_id=${existing}`);
  } else {
    // same allocation rule as gateway/test/verify-shots.js: well above the
    // current maximum so it cannot collide with a live object id
    const oid = 1000 + Number(sql('SELECT COALESCE(MAX(object_id),0) FROM items'));
    sql(`INSERT INTO items (owner_id,object_id,item_id,count,enchant_level,loc,loc_data,`
      + `custom_type1,custom_type2,mana_left,time) VALUES `
      + `(${charId},${oid},${SS_NOGRADE},${SEED_COUNT},0,'INVENTORY',0,0,0,-1,0)`);
  }
  const seeded = sql(
    `SELECT count FROM items WHERE owner_id=${charId} AND item_id=${SS_NOGRADE}`);
  check('no-grade soulshots seeded', Number(seeded) === SEED_COUNT, `count=${seeded}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.console.push(m.text()));
    page.on('pageerror', e => summary.console.push('PAGEERROR: ' + e.message));
    await page.evaluateOnNewDocument(
      (id) => { localStorage.setItem('l2vzla.deviceId', id); }, DEVICE_ID);
    // start from a clean bar so A5 proves persistence, not leftovers
    // Start from a clean bar so A5 proves persistence rather than leftovers —
    // but ONCE. evaluateOnNewDocument runs on every navigation, and the relog
    // in A5 IS a navigation, so an unguarded wipe deletes the very thing the
    // test is about (it did, on the first run of this suite).
    await page.evaluateOnNewDocument(() => {
      if (sessionStorage.getItem('l2vzla.verify.barCleared')) return;
      sessionStorage.setItem('l2vzla.verify.barCleared', '1');
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('l2vzla.hotbar.')) localStorage.removeItem(k);
      }
    });

    await boot(page);

    const shot = await page.evaluate((itemId) => {
      const it = [...window.__world.inventory.items.values()]
        .find(x => x.itemId === itemId);
      return it ? { objectId: it.objectId, itemId: it.itemId, count: it.count } : null;
    }, SS_NOGRADE);
    check('the client sees the shots in its inventory', !!shot,
      shot ? `objectId=${shot.objectId} count=${shot.count}` : 'not in itemList');
    if (!shot) throw new Error('no shots in the client inventory');

    // ---- A1: the slot draws the real item -----------------------------------
    await page.evaluate((oid) => {
      // exactly what InventoryWnd's right-click assign sends
      window.__world.shortcutWnd.assign(0, 0, { type: 'item', id: oid });
    }, shot.objectId);
    await sleep(1200);
    const assigned = await page.evaluate(slotState);
    check('A1 item shortcut resolves its icon and name', assigned.hasIcon
      && /Soulshot/i.test(assigned.title), JSON.stringify(assigned));
    await page.screenshot({ path: path.join(OUT, 'soulshot_01_assigned.png') });

    // ---- instrumentation, installed BEFORE the toggle ------------------------
    // aCis charges the weapon the moment automatic use is switched on, not on
    // the first swing: RequestAutoSoulShot calls player.rechargeShots(true,true)
    // as soon as the shot's crystal type matches the equipped weapon's (it does
    // here — Soulshot: No Grade and the Squire's Sword both carry no
    // crystal_type). So the whole B section is observable at the toggle, with
    // no combat and no walk out of the starter town's peace zone.
    //
    // Two spies, both needed because the things they watch are transient:
    //   glintPeak  a popped SkillFx sprite lives 450 ms, so one sample after
    //              the fact would miss it and pass for the wrong reason.
    //   sounds     every ref that reaches Audio.play2D/playAt, so "the UI
    //              sound no longer plays" is an observation, not an assumption.
    await page.evaluate(() => {
      const w = window.__world;
      // Only AUTHORED sprites count. SkillVfx tags the objects it builds from
      // the decoded tables 'skillvfx.json' / 'skillmesh.json'; a scene-wide
      // count of everything tagged skillFx picked up 23 of those from another
      // player's Wind Strike on the first run.
      window.__popPeak = 0;
      window.__popTimer = setInterval(() => {
        let n = 0;
        w.scene.traverse(o => {
          const u = o.userData && o.userData.skillFx;
          if (u && u.source === 'authored-pop') n++;
        });
        if (n > window.__popPeak) window.__popPeak = n;
      }, 40);
      window.__sounds = [];
      const a = w.audio;
      const p2 = a.play2D.bind(a), pa = a.playAt.bind(a);
      a.play2D = (ref, ...rest) => { window.__sounds.push(ref); return p2(ref, ...rest); };
      a.playAt = (ref, ...rest) => { window.__sounds.push(ref); return pa(ref, ...rest); };
      // The character's own gesture, spied directly. entities.lastCastClip is
      // a shared last-writer hook and came back "castLong" from a bystander's
      // cast on the first run — it cannot answer "did OUR shot animate".
      window.__gestures = [];
      const ch = w.character;
      const one = ch.oneShot.bind(ch);
      ch.oneShot = (clip, ...rest) => { window.__gestures.push(clip); return one(clip, ...rest); };
      window.__logFrom = w.net.log.length;
    });

    // ---- A2: click -> autoShot -> ExAutoSoulShot -> mark ---------------------
    await page.evaluate(() => {
      document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="item"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'autoShotState' && m.enabled)`,
      { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const toggled = await page.evaluate(() => ({
      sent: window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'autoShot'),
      got: window.__world.net.log.filter(m => m.op === 'autoShotState'),
      slot: (() => {
        const el = document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="item"]');
        return el ? el.classList.contains('l2-toggle-active') : null;
      })(),
    }));
    check('A2 the click sends autoShot and the server confirms it',
      toggled.sent.length === 1 && toggled.sent[0].itemId === SS_NOGRADE
      && toggled.got.some(m => m.itemId === SS_NOGRADE && m.enabled),
      JSON.stringify({ sent: toggled.sent, got: toggled.got }));
    check('A2 the slot is marked active', toggled.slot === true);
    await page.screenshot({ path: path.join(OUT, 'soulshot_02_toggled.png') });

    // ---- collect the B window NOW, while it is still the toggle's ------------
    // aCis charges the weapon at ACTIVATION (RequestAutoSoulShot ->
    // player.rechargeShots(true,true) when the crystal types match), and
    // SoulShots.useItem then returns early for as long as the weapon stays
    // charged (`if (player.isChargedShot(SOULSHOT)) return`). So there is
    // exactly ONE charge per activation and re-toggling proves nothing —
    // measured: a second off/on produced no MagicSkillUse at all.
    await sleep(2500);
    const charge = await page.evaluate((sid) => {
      const w = window.__world;
      clearInterval(window.__popTimer);
      const tail = w.net.log.slice(window.__logFrom);
      return {
        cast: tail.find(m => m.op === 'skillCast' && m.skillId === sid) || null,
        castsSeen: tail.filter(m => m.op === 'skillCast')
          .map(m => ({ skillId: m.skillId, caster: m.casterId })),
        selfId: w.net.selfId,
        gestures: window.__gestures.slice(),
        popPeak: window.__popPeak,
        sounds: window.__sounds.slice(),
      };
    }, SS_SKILL);
    await page.screenshot({ path: path.join(OUT, 'soulshot_03_charged.png') });

    // ---- A3: the mark survives a full itemList refresh -----------------------
    const afterRefresh = await page.evaluate(async () => {
      const w = window.__world;
      const il = [...w.net.log].reverse().find(m => m.op === 'itemList');
      w.net.inject(JSON.parse(JSON.stringify(il)));   // the real payload, real dispatch
      await new Promise(r => setTimeout(r, 1200));
      const el = document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="item"]');
      return el ? { marked: el.classList.contains('l2-toggle-active'),
                    hasIcon: !!el.querySelector('img') } : null;
    });
    check('A3 the mark survives an itemList refresh',
      !!afterRefresh && afterRefresh.marked && afterRefresh.hasIcon,
      JSON.stringify(afterRefresh));

    // ---- A4: the mark survives a page flip ----------------------------------
    const afterPage = await page.evaluate(async () => {
      const w = window.__world;
      w.shortcutWnd.flipPage(1);
      await new Promise(r => setTimeout(r, 400));
      const away = !!document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="item"]');
      w.shortcutWnd.flipPage(-1);
      await new Promise(r => setTimeout(r, 900));
      const el = document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="item"]');
      return { awayHasSlot: away,
               back: el ? el.classList.contains('l2-toggle-active') : null };
    });
    check('A4 the mark survives a page flip away and back',
      afterPage.awayHasSlot === false && afterPage.back === true,
      JSON.stringify(afterPage));

    // ---- B: the shot charge --------------------------------------------------
    check('B2 the shot charge arrives as the retail MagicSkillUse',
      !!(charge.cast && charge.cast.skillId === SS_SKILL
         && charge.cast.casterId === charge.selfId),
      JSON.stringify(charge.cast || charge.castsSeen));
    // skillgrp.dat gives 2039 animation "" -> clipForSkill() returns null, so
    // the character must play NO clip for it. The old `|| 'attack'` fallback is
    // what made a shot swing a weapon at nothing.
    const CAST_CLIPS = /^(castShort|castMid|castLong|spAtk|dance|attack|magicThrow)/i;
    check('B3 the shot plays no cast gesture (skillgrp animation is empty)',
      !charge.gestures.some(c => CAST_CLIPS.test(String(c))),
      `gestures=${JSON.stringify(charge.gestures)}`);
    check('B4 the charge plays the retail shot sound',
      charge.sounds.some(s => /skillsound\.(soul_shot|spirits_shot)/.test(s)),
      JSON.stringify(charge.sounds));
    check('B4 the charge does not play the invented UI sound',
      !charge.sounds.some(s => /sc_shot/.test(s)),
      JSON.stringify(charge.sounds.filter(s => /sc_shot/.test(s))));
    check('B1 the shot charge draws no authored sprite',
      charge.popPeak === 0, `authored sprites peak=${charge.popPeak}`);
    await page.screenshot({ path: path.join(OUT, 'soulshot_03_charged.png') });

    // B1: the HITFLAG_SS branch of main.js's attack handler must draw nothing
    // and play nothing. Exercised by injecting an Attack op carrying the SS
    // flag through net.inject — the client's own verification path for
    // inbound ops, which runs the REAL handler (main.js:1325) and the real
    // log. Reaching that branch from live combat needs a monster, and the
    // starter town is a peace zone; the packet is the same either way, and any
    // SS-flagged Attack that DID arrive is reported alongside.
    const ssHit = await page.evaluate(async () => {
      const w = window.__world;
      const before = window.__sounds.length;
      let popPeak = 0;
      const timer = setInterval(() => {
        let n = 0;
        w.scene.traverse(o => {
          const u = o.userData && o.userData.skillFx;
          if (u && u.source === 'authored-pop') n++;
        });
        if (n > popPeak) popPeak = n;
      }, 30);
      w.net.inject({ op: 'attack', id: w.net.selfId, targetId: w.net.selfId,
                     damage: 1, critical: false, miss: false, soulshot: true });
      await new Promise(r => setTimeout(r, 1500));
      clearInterval(timer);
      clearInterval(window.__glintTimer);
      return { popPeak, newSounds: window.__sounds.slice(before) };
    });
    check('B1 a shot-charged hit draws no invented glint and plays no UI sound',
      ssHit.popPeak === 0 && !ssHit.newSounds.some(s => /sc_shot/.test(s)),
      JSON.stringify(ssHit));

    // ---- A5/A6: relog --------------------------------------------------------
    await page.reload({ waitUntil: 'networkidle0' });
    await boot(page);
    const relog = await page.evaluate(slotState);
    const liveOid = await page.evaluate((itemId) => {
      const it = [...window.__world.inventory.items.values()].find(x => x.itemId === itemId);
      return it ? it.objectId : null;
    }, SS_NOGRADE);
    check('A5 the shortcut survives a relog', relog.present && relog.hasIcon
      && relog.sid === liveOid,
      JSON.stringify({ ...relog, liveObjectId: liveOid }));
    check('A6 the toggle starts OFF after relog (aCis does not persist it)',
      relog.present && relog.marked === false, `marked=${relog.marked}`);
    await page.screenshot({ path: path.join(OUT, 'soulshot_04_relog.png') });

    // and it re-arms
    if (relog.present) {
      await page.evaluate(() => {
        document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="item"]').click();
      });
      await page.waitForFunction(
        `window.__world.net.log.some(m => m.op === 'autoShotState' && m.enabled)`,
        { timeout: 20000 }).catch(() => {});
      await sleep(1000);
      const rearmed = await page.evaluate(slotState);
      check('A6 clicking after relog re-arms the toggle', rearmed.marked === true,
        JSON.stringify(rearmed));
      await page.screenshot({ path: path.join(OUT, 'soulshot_05_rearmed.png') });
    }
  } catch (e) {
    check('suite ran to completion', false, e.message);
  } finally {
    summary.results = results;
    summary.pass = pass; summary.fail = fail;
    fs.writeFileSync(path.join(OUT, 'verify_soulshot.json'),
      JSON.stringify(summary, null, 1));
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (process.argv.includes('--check') && fail) process.exit(1);
  process.exit(fail ? 1 : 0);
})();
