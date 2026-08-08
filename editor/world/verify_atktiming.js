// Attack/cast TIMING verification in the real client, against the mock gateway
// (8085). Everything asserted here is a number the SERVER supplies; the point
// of the test is that the client now animates and reports on those numbers
// instead of on the animation clip's authored length.
//
// Checks:
//  1. charSheet.running reaches the local character (forcedMoveAnim = 'run'),
//     so a SHORT click runs instead of walking — the old RUN_THRESHOLD guess.
//  2. Character.atkSpdMul / pAtkSpd come from charSheet, and attackInterval()
//     reproduces Formulas.calculateTimeBetweenAttacks.
//  3. A swing plays the attack clip at timeScale == atkSpdMul, so the swing
//     lasts clip/atkSpdMul ms and NOT the clip's authored length.
//  4. Monsters do the same from their own NpcInfo values.
//  5. A cast gesture is stretched/compressed to the MagicSkillUse hitTime.
//  6. A damage float appears hitDelay ms after the attack op, not instantly.
//
// Usage: node verify_atktiming.js   (mock gateway must be running on 8085)
// Output: verify_shots/atktiming_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const GREMLIN = 70001;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const summary = { checks: [], consoleLogs: [] };
const check = (ok, name, detail) => summary.checks.push({ ok: !!ok, name, detail });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', (m) => summary.consoleLogs.push(m.text()));
    page.on('pageerror', (e) => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.connected
       && window.__world.net.log.some(m => m.op === 'charSheet')`, { timeout: 20000 });
    await sleep(2000);

    // --- 1/2: the server's stance and cadence reached the character ---------
    const sheet = await page.evaluate(() => {
      const w = window.__world;
      const c = w.character;
      const s = w.net.log.filter((m) => m.op === 'charSheet').pop();
      return {
        opRunning: s && s.running, opPAtkSpd: s && s.pAtkSpd, opMul: s && s.atkSpdMul,
        forcedMoveAnim: c.forcedMoveAnim,
        pAtkSpd: c.pAtkSpd, atkSpdMul: c.atkSpdMul,
        interval: c.attackInterval(),
      };
    });
    summary.charSheet = sheet;
    check(sheet.forcedMoveAnim === 'run',
      'charSheet.running sets the character stance to run (no distance guess)',
      sheet.forcedMoveAnim);
    check(sheet.pAtkSpd === sheet.opPAtkSpd && sheet.atkSpdMul === sheet.opMul,
      'pAtkSpd/atkSpdMul reach Character from charSheet',
      `${sheet.pAtkSpd} / ${sheet.atkSpdMul}`);
    check(sheet.interval === Math.max(100, Math.floor(500000 / sheet.pAtkSpd)),
      'Character.attackInterval() == max(100, 500000/pAtkSpd)', sheet.interval);

    // a SHORT click must still run: the old code walked anything under 6 m
    const shortClick = await page.evaluate(() => {
      const w = window.__world;
      const c = w.character;
      const p = c.group.position;
      c.setTarget(new p.constructor(p.x + 1.5, p.y, p.z + 1.5));   // 2.1 m
      return { moveAnim: c.moveAnim };
    });
    check(shortClick.moveAnim === 'run',
      'a 2.1 m click still RUNS (retail stance, not the leg-distance guess)',
      shortClick.moveAnim);
    await page.evaluate(() => window.__world.character.clearTarget());

    // --- 3: the swing plays at the server's rate ---------------------------
    const swing = await page.evaluate(() => {
      const c = window.__world.character;
      c.attackSwing();
      const a = c.actions[c.lastOneShot.clip];
      return {
        ...c.lastOneShot,
        timeScale: a.timeScale,
        clipSec: a.getClip().duration,
        atkSpdMul: c.atkSpdMul,
        interval: c.attackInterval(),
      };
    });
    summary.swing = swing;
    check(Math.abs(swing.timeScale - swing.atkSpdMul) < 1e-6,
      'the attack clip plays at timeScale == atkSpdMul', `${swing.timeScale}`);
    check(Math.abs(swing.ms - (swing.clipSec * 1000) / swing.atkSpdMul) < 1,
      'the swing is held for clip/atkSpdMul ms, not the clip length',
      `${swing.ms.toFixed(0)} ms (clip ${(swing.clipSec * 1000).toFixed(0)} ms)`);
    check(swing.ms < swing.interval,
      'the swing fits inside the server attack cycle',
      `${swing.ms.toFixed(0)} ms < ${swing.interval} ms`);

    // --- 4: monsters, from their own NpcInfo values ------------------------
    const mob = await page.evaluate((id) => {
      const e = window.__world.entities.getEntity(id);
      if (!e || !e.actions) return null;
      e.attackFlash();
      const a = e.actions.attack;
      return {
        pAtkSpd: e.pAtkSpd, atkSpdMul: e.atkSpdMul,
        flash: e.lastFlash, timeScale: a.timeScale,
        clipSec: a.getClip().duration,
      };
    }, GREMLIN);
    summary.mob = mob;
    check(mob && mob.pAtkSpd > 0, 'monster carries pAtkSpd from addNpc', mob && mob.pAtkSpd);
    check(mob && Math.abs(mob.timeScale - mob.atkSpdMul) < 1e-6,
      'the monster swing plays at its own atkSpdMul', mob && mob.timeScale);
    check(mob && Math.abs(mob.flash.ms - (mob.clipSec * 1000) / mob.atkSpdMul) < 1,
      'the monster returns to idle when the scaled clip ends (no max(300, dur-100))',
      mob && `${mob.flash.ms.toFixed(0)} ms`);

    // --- 5: cast gesture length == MagicSkillUse hitTime --------------------
    const cast = await page.evaluate(async () => {
      const w = window.__world;
      const c = w.character;
      const ent = w.entities;
      const results = [];
      for (const hitTime of [400, 2600]) {
        // feed the same message shape skillFlash reads out of the net log
        w.net.log.push({ dir: 'in', op: 'skillCast', casterId: w.net.selfId,
          targetId: w.net.selfId, skillId: 1177, level: 1, hitTime });
        ent.skillFlash(w.net.selfId);
        await new Promise((r) => setTimeout(r, 250));
        results.push({ hitTime, ...c.lastOneShot });
      }
      return results;
    });
    summary.cast = cast;
    for (const c of cast) {
      check(Math.abs(c.ms - c.hitTime) < 1,
        `cast gesture lasts exactly hitTime (${c.hitTime} ms)`,
        `${c.clip} rate ${c.rate.toFixed(3)} -> ${c.ms.toFixed(0)} ms`);
    }

    // --- 6: the damage float waits for the server's hit moment -------------
    const float = await page.evaluate(async () => {
      const w = window.__world;
      const pos = w.character.group.position.clone();
      const before = document.querySelectorAll('.dmg-float').length;
      const t0 = performance.now();
      w.combat.damage(pos, { damage: 77, critical: false, miss: false, hitDelay: 600 });
      const immediate = document.querySelectorAll('.dmg-float').length - before;
      await new Promise((r) => setTimeout(r, 850));
      return { immediate, after: document.querySelectorAll('.dmg-float').length - before,
               elapsed: performance.now() - t0 };
    });
    summary.float = float;
    check(float.immediate === 0 && float.after === 1,
      'a damage number appears at the server hitDelay, not on packet arrival',
      JSON.stringify(float));

    await page.screenshot({ path: path.join(OUT, 'atktiming_world.png') });
  } catch (err) {
    summary.error = err.message;
    check(false, 'run completed', err.message);
  } finally {
    await browser.close();
  }
  const failed = summary.checks.filter((c) => !c.ok);
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n' + summary.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}` +
    (c.detail != null ? ` — ${c.detail}` : '')).join('\n'));
  console.log(failed.length
    ? `\nRESULT: FAIL (${failed.length}/${summary.checks.length})`
    : `\nRESULT: PASS (${summary.checks.length}/${summary.checks.length})`);
  process.exit(failed.length ? 1 : 0);
})();
