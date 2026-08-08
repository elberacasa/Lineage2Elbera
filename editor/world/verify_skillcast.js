// verify_skillcast.js — the casting pipeline against the REAL stack.
//
// Every assertion here is anchored to a packet timeline recorded from the
// running aCis by gateway/test/capture-skills.js (its JSON sits next to it).
// What that capture established, and what this suite holds the browser to:
//
//   * MagicSkillUse carries hitTime and reuseDelay in ms. Wind Strike level 1
//     on a mAtkSpd-213 caster: hitTime 6253, reuse 9380.
//   * SetupGauge(BLUE, hitTime) is the cast bar, and aCis sends it ONLY when
//     hitTime > 410. Toggles arrive as MagicSkillUse hitTime 0 / reuse 0 with
//     no gauge and no launch at all — so a toggle must draw NO bar and take
//     NO cooldown.
//   * MagicSkillLaunched lands at hitTime-400; the effects land at hitTime.
//   * A movement click during a cast is answered with a BARE ActionFailed
//     while the server casts on to completion. ActionFailed is therefore not
//     an abort signal.
//   * A real abort is MagicSkillCanceled (0x49, gateway op `skillCancel`).
//
// Needs a gateway running the current gateway/src (the ops `gauge` and
// `skillCancel` did not exist before this pass). Default ws://127.0.0.1:8096:
//   GATEWAY_PORT=8096 node gateway/src/server.js &
//
// Usage: node verify_skillcast.js [--ws ws://127.0.0.1:8096]
// Output: verify_shots/skillcast_*.png + a JSON summary on stdout.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wsArg = process.argv.indexOf('--ws');
const WS = wsArg > 0 ? process.argv[wsArg + 1] : 'ws://127.0.0.1:8096';
// cc=0 opts into the gateway's legacy first-login auto-create. Without it the
// client sends login{noAutoCreate:true}, gets auth_ok{chars:[]} and sits on the
// character-creation overlay forever — which is what a first run here did.
const BASE = `http://127.0.0.1:8083/?ws=${encodeURIComponent(WS)}&cc=0`;
const OUT = path.join(__dirname, 'verify_shots');
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];
const DEVICE_ID = 'verify-skillcast-fixture-1';

const NUKE = 1177;      // Wind Strike  — magic, castRange 600, hitTime 4000
const HEAL = 1011;      // Heal         — magic, hitTime 5000
const PHYS = 3;         // Power Strike — physical, SWORD, hitTime 1080
const TOGGLE = 312;     // Vicious Stance — operateType TOGGLE, anim ''
const SEEDED = [NUKE, HEAL, PHYS, TOGGLE, 226];

const sql = (q) => execFileSync('mariadb', [...DB, '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fails = [];
const summary = { ws: WS, checks: {} };
function check(name, cond, detail) {
  summary.checks[name] = { pass: !!cond, detail };
  if (!cond) fails.push(`${name}: ${detail}`);
}

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
  // pin the device id: every fresh headless profile is otherwise a new
  // account with a new, unseeded character
  await page.evaluateOnNewDocument((id) => {
    localStorage.setItem('l2vzla.deviceId', id);
  }, DEVICE_ID);
  // domcontentloaded, not networkidle0: the world streams tiles/textures for
  // a long time after the app is usable and networkidle0 times out on it
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  return { browser, page };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // -- pass 1: create the character, then get out so the DB is writable -----
  const p1 = await launch();
  const charName = await p1.page.evaluate(
    () => window.__world.net.log.find((m) => m.op === 'enterWorld').char.name);
  summary.charName = charName;
  await p1.browser.close();
  await sleep(3500);   // aCis writes the character out on logout

  const owner = Number(sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}' LIMIT 1;`));
  if (!owner) { console.log(JSON.stringify({ result: 'ERROR', error: 'no fixture char' })); process.exit(1); }
  sql(`UPDATE characters SET accesslevel=8, curMp=9999 WHERE obj_Id=${owner};`);
  sql(`DELETE FROM character_skills WHERE char_obj_id=${owner};`);
  sql('INSERT INTO character_skills (char_obj_id,skill_id,skill_level,class_index) VALUES '
    + SEEDED.map((id) => `(${owner},${id},1,0)`).join(','));
  summary.seeded = SEEDED;


  // -- pass 2: relog and drive the real casts ------------------------------
  //
  // Everything timing-sensitive runs INSIDE the page. Two reasons, both
  // learned the hard way here:
  //   * a page.evaluate round trip on headless swiftshader costs ~1 s and a
  //     screenshot ~12 s, while the window between MagicSkillLaunched
  //     (hitTime-400) and the end of the cast is 400 ms. Measured across the
  //     CDP boundary the bar read as already gone.
  //   * net.log is a 200-entry RING. Marking a position by log.length and
  //     slicing from it silently returns nothing once the world stream has
  //     rotated past the mark — one run reported "no packets at all" for a
  //     cast that had gone out perfectly. Marks are sets of message objects.
  const p2 = await launch();
  const page = p2.page;
  try {
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillList'
         && (m.skills || []).some(s => s.id === ${NUKE}))`, { timeout: 30000 });
    await page.waitForFunction('window.__world.weaponGate.loaded', { timeout: 30000 });

    await page.evaluate(() => {
      window.__mark = () => { window.__seen = new WeakSet(window.__world.net.log); };
      window.__since = () => window.__world.net.log.filter((m) => !window.__seen.has(m));
      window.__waitFor = (pred, ms = 20000) => new Promise((resolve) => {
        const t0 = performance.now();
        const poll = setInterval(() => {
          const hit = window.__since().find(pred);
          if (hit) { clearInterval(poll); resolve(hit); }
          else if (performance.now() - t0 > ms) { clearInterval(poll); resolve(null); }
        }, 25);
      });
      window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__barUp = () => document.getElementById('cast-bar').classList.contains('visible');
      // enterWorld rotates out of the 200-entry ring within a minute of world
      // traffic — stash the spawn point now instead of looking it up later
      window.__home = window.__world.net.log.find((m) => m.op === 'enterWorld').char;
    });

    const weapon = await page.evaluate(() => String(window.__world.weaponGate.weapon));
    // the newbie kit's Squire's Sword — the stance the physical clip resolves in
    check('starter sword equipped (stance source)', weapon === 'SWORD', weapon);
    const stance = await page.evaluate(() => window.__world.character.stance);
    check('character stance follows the weapon', stance === '1hs', String(stance));

    // ---- 1. TOGGLE: no bar, no cooldown, no gesture ----------------------
    const tog = await page.evaluate(async (id) => {
      const w = window.__world;
      window.__mark();
      w.entities.lastCastClip = '__unset__';
      w.net.sendOp('useSkill', { skillId: id });
      const cast = await window.__waitFor((m) => m.op === 'skillCast' && m.skillId === id, 15000);
      await window.__sleep(600);
      return {
        cast: cast && { hitTime: cast.hitTime, reuse: cast.reuse },
        barVisible: window.__barUp(),
        gauge: window.__since().some((m) => m.op === 'gauge'),
        reuseLeft: w.skillBar.reuseLeft(id),
        castClip: w.entities.lastCastClip,
      };
    }, TOGGLE);
    summary.toggle = tog;
    check('toggle MagicSkillUse is hitTime 0 / reuse 0',
      !!tog.cast && tog.cast.hitTime === 0 && tog.cast.reuse === 0, JSON.stringify(tog.cast));
    check('toggle gets NO SetupGauge', tog.gauge === false, String(tog.gauge));
    check('toggle draws NO cast bar', tog.barVisible === false, String(tog.barVisible));
    check('toggle takes NO cooldown sweep', tog.reuseLeft === null, JSON.stringify(tog.reuseLeft));
    check('toggle plays NO cast gesture (skillgrp anim is empty)',
      tog.castClip === null, String(tog.castClip));
    await page.screenshot({ path: path.join(OUT, 'skillcast_01_toggle.png') });

    // ---- 2. NUKE ---------------------------------------------------------
    // Wind Strike is target ONE: with nothing selected aCis answers sysMsg 109
    // "Invalid target" and never casts. GM-spawn a passive Rabbit, stand on it
    // (admin_teleportto) so nothing here depends on pathing, and select it.
    const mobId = await page.evaluate(async () => {
      const w = window.__world;
      const me = window.__home;
      // top up before anything else: a cast denied for MP answers sysMsg 24
      // and never produces a MagicSkillUse
      w.net.sendOp('target', { id: w.net.selfId });
      await window.__sleep(400);
      w.net.sendOp('bypass', { command: 'admin_heal' });
      await window.__sleep(800);
      window.__mark();
      w.net.sendOp('bypass', { command: 'admin_spawn 20002 1 0 0' });
      await window.__waitFor((m) => m.op === 'addNpc' && m.npcId === 20002, 20000);
      await window.__sleep(600);
      // the NEAREST fresh Rabbit: earlier GM spawns keep wandering back into
      // knownlist, so "the last addNpc" is not necessarily the one just made
      const cands = window.__since().filter((m) => m.op === 'addNpc' && m.npcId === 20002);
      if (!cands.length) return null;
      cands.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
      const id = cands[0].id;
      w.net.sendOp('target', { id });
      await window.__sleep(600);
      w.net.sendOp('bypass', { command: 'admin_teleportto' });
      await window.__sleep(1200);
      w.net.sendOp('target', { id });
      await window.__sleep(700);
      return id;
    });
    summary.mobId = mobId;
    await page.evaluate((id) => { window.__mobId = id; }, mobId);

    const nuke = await page.evaluate(async (id) => {
      const w = window.__world;
      // Re-select the mob and cast IMMEDIATELY. Anything slipped between the
      // two (an admin_heal with self selected, say) leaves the caster targeting
      // itself and aCis answers sysMsg 109 "Invalid target" with no cast at
      // all — which is how one run of this suite read as a broken nuke.
      w.net.sendOp('target', { id: window.__mobId });
      await window.__sleep(700);
      window.__mark();
      let barSeen = false, barHitTime = null;
      const timer = setInterval(() => {
        if (window.__barUp()) barSeen = true;
        if (w.skillBar.cast) barHitTime = w.skillBar.cast.hitTime;
      }, 20);
      w.net.sendOp('useSkill', { skillId: id });
      const cast = await window.__waitFor((m) => m.op === 'skillCast' && m.skillId === id, 20000);
      if (!cast) {
        clearInterval(timer);
        return { cast: null,
          since: window.__since().map((m) => m.op + (m.op === 'sysMsg' ? '#' + m.id : '')) };
      }
      await window.__sleep(700);
      // the RAW entry, not reuseLeft(): reuseLeft self-deletes once the sweep
      // has drained, and this box has starved the page for >10 s in a single
      // frame gap, which made a correct 9380 ms reuse read as "no cooldown"
      const raw = w.skillBar.reuse.get(id);
      const reuse = raw ? { total: raw.total } : null;
      const launch = await window.__waitFor((m) => m.op === 'skillLaunch' && m.skillId === id, 20000);
      await window.__sleep(1500);
      clearInterval(timer);
      return {
        cast: { hitTime: cast.hitTime, reuse: cast.reuse },
        gauge: window.__since().find((m) => m.op === 'gauge') || null,
        launched: !!launch, reuse, barSeen, barHitTime,
        barAtEnd: window.__barUp(),
        after: window.__since().map((m) => m.op + (m.op === 'sysMsg' ? '#' + m.id : '')),
      };
    }, NUKE);
    summary.nuke = nuke;
    check('nuke MagicSkillUse carries a real hitTime and reuse',
      !!nuke.cast && nuke.cast.hitTime > 410 && nuke.cast.reuse > 0, JSON.stringify(nuke.cast));
    check('nuke raises the cast bar', nuke.barSeen === true, String(nuke.barSeen));
    check('the bar length IS the server hitTime',
      !!nuke.cast && nuke.barHitTime === nuke.cast.hitTime,
      `${nuke.barHitTime} vs ${nuke.cast && nuke.cast.hitTime}`);
    check('SetupGauge reached the client and agrees with hitTime',
      !!nuke.gauge && !!nuke.cast && nuke.gauge.time === nuke.cast.hitTime
      && nuke.gauge.color === 'blue', JSON.stringify(nuke.gauge));
    check('the cooldown sweep is the SERVER reuse (not the cast length)',
      !!nuke.reuse && nuke.reuse.total === nuke.cast.reuse,
      `${nuke.reuse && nuke.reuse.total} vs MagicSkillUse reuse ${nuke.cast && nuke.cast.reuse} `
      + `(cast length was ${nuke.cast && nuke.cast.hitTime})`);
    check('MagicSkillLaunched arrives for the live cast', nuke.launched === true,
      JSON.stringify((nuke.after || []).filter((o) => !/^move|^selfStatus|^status/.test(o))));
    check('the bar is gone once the cast is over', nuke.barAtEnd === false, String(nuke.barAtEnd));

    // ---- 2b. the cast LIFECYCLE, replayed deterministically ---------------
    // The 400 ms window between MagicSkillLaunched (hitTime-400) and the end
    // of the cast is not measurable across the CDP boundary on this box — a
    // page.evaluate costs ~1 s and one run saw the page starve the sampler for
    // 11 s straight. The PACKETS are already proven live (this suite above,
    // and gateway/test/capture-skills.js --check pins the 400 ms gap itself).
    // What is under test here is the CLIENT's reaction to them, so the exact
    // observed messages are replayed into the running client instead.
    const life = await page.evaluate(async (id) => {
      const w = window.__world;
      const self = w.net.selfId;
      const inject = (m) => w.net.inject(m);
      const out = {};
      // MagicSkillUse, Wind Strike level 1, mAtkSpd 213 (captured values)
      inject({ op: 'skillCast', casterId: self, targetId: self, skillId: id,
        level: 1, hitTime: 6253, reuse: 9380 });
      await window.__sleep(400);
      out.afterCast = window.__barUp();
      // a bare ActionFailed — what aCis answers a movement click with while
      // casting (PlayableAI.onIntentionMoveTo); the cast keeps running
      inject({ op: 'actionFailed' });
      await window.__sleep(200);
      out.afterActionFailed = window.__barUp();
      out.abortEvidence = w.skillBar._serverAbortEvidence();
      // MagicSkillLaunched lands 400 ms BEFORE the cast ends: not the end
      inject({ op: 'skillLaunch', casterId: self, targetId: self, skillId: id, level: 1 });
      await window.__sleep(200);
      out.afterLaunch = window.__barUp();
      out.reuseAfterLaunch = w.skillBar.reuseLeft(id);
      // MagicSkillCanceled IS the end
      inject({ op: 'skillCancel', casterId: self });
      await window.__sleep(200);
      out.afterCancel = window.__barUp();
      // and a toggle's MagicSkillUse (hitTime 0 / reuse 0) raises nothing
      inject({ op: 'skillCast', casterId: self, targetId: self, skillId: 312,
        level: 1, hitTime: 0, reuse: 0 });
      await window.__sleep(300);
      out.afterToggleShape = window.__barUp();
      out.toggleReuse = w.skillBar.reuseLeft(312);
      return out;
    }, NUKE);
    summary.lifecycle = life;
    check('replay: MagicSkillUse raises the bar', life.afterCast === true, String(life.afterCast));
    check('replay: a bare ActionFailed does NOT cancel it',
      life.afterActionFailed === true && life.abortEvidence === false, JSON.stringify(life));
    check('replay: MagicSkillLaunched does NOT end the bar (it is 400 ms early)',
      life.afterLaunch === true, String(life.afterLaunch));
    check('replay: the reuse sweep survives the launch',
      !!life.reuseAfterLaunch && life.reuseAfterLaunch.left > 1000,
      JSON.stringify(life.reuseAfterLaunch));
    check('replay: MagicSkillCanceled DOES end the bar',
      life.afterCancel === false, String(life.afterCancel));
    check('replay: a toggle-shaped MagicSkillUse raises no bar and no cooldown',
      life.afterToggleShape === false && life.toggleReuse === null,
      JSON.stringify({ bar: life.afterToggleShape, reuse: life.toggleReuse }));

    await page.screenshot({ path: path.join(OUT, 'skillcast_02_after_cast.png') });

    // ---- 3. a REAL abort: MagicSkillCanceled ------------------------------
    // GM-teleport away mid-cast; onMagicLaunch's escapeRange check then calls
    // CreatureCast.stop(), which broadcasts MagicSkillCanceled.
    const abort = await page.evaluate(async (id) => {
      const w = window.__world;
      const home = window.__home;
      w.net.sendOp('target', { id: w.net.selfId });
      await window.__sleep(500);
      // top up first: a cast denied for MP answers sysMsg 24 and never starts
      w.net.sendOp('bypass', { command: 'admin_heal' });
      await window.__sleep(900);
      window.__mark();
      w.net.sendOp('useSkill', { skillId: id });
      const cast = await window.__waitFor((m) => m.op === 'skillCast' && m.skillId === id, 20000);
      if (!cast) return { cast: null, since: window.__since().map((m) => m.op) };
      await window.__sleep(400);
      const barBefore = window.__barUp();
      w.net.sendOp('bypass',
        { command: `admin_teleport ${home.x + 4000} ${home.y + 4000} ${home.z}` });
      const cancel = await window.__waitFor((m) => m.op === 'skillCancel', 15000);
      await window.__sleep(300);
      return {
        cast: { hitTime: cast.hitTime }, barBefore,
        cancel: cancel || null, barAfter: window.__barUp(),
        launched: window.__since().some((m) => m.op === 'skillLaunch' && m.skillId === id),
      };
    }, HEAL);
    summary.abort = abort;
    check('the abort probe got its cast off', !!abort.cast, JSON.stringify(abort.since || 'ok'));
    check('the bar was up before the abort', abort.barBefore === true, String(abort.barBefore));
    check('the gateway forwards MagicSkillCanceled as skillCancel', !!abort.cancel,
      JSON.stringify(abort.cancel));
    check('skillCancel hides the cast bar', abort.barAfter === false, String(abort.barAfter));
    check('an aborted cast never launches', abort.launched === false, String(abort.launched));
    await page.screenshot({ path: path.join(OUT, 'skillcast_03_cancelled.png') });

    // ---- 4. the physical cast gesture resolves in the weapon stance -------
    // Shape taken verbatim from the live capture (Power Strike level 1 on a
    // pAtkSpd-416 caster: hitTime 864, reuse 10406). Injected because Power
    // Strike has castRange 40 and mob logistics are not what is under test.
    const phys = await page.evaluate(async (id) => {
      const w = window.__world;
      const cast = () => w.net.inject({ op: 'skillCast', casterId: w.net.selfId,
        targetId: w.net.selfId, skillId: id, level: 1, hitTime: 864, reuse: 10406 });
      w.entities.lastCastClip = '__unset__';
      cast();
      await window.__sleep(400);
      const first = { castClip: w.entities.lastCastClip, oneShot: w.character.lastOneShot };
      cast();
      await window.__sleep(400);
      return {
        first, secondClip: w.entities.lastCastClip,
        hasStanced: !!(w.character.actions && w.character.actions.spatk01_1hs),
        hasLegacy: !!(w.character.actions && w.character.actions.spAtk01),
      };
    }, PHYS);
    summary.physical = phys;
    check('the model ships the stanced physical clip', phys.hasStanced === true,
      JSON.stringify({ stanced: phys.hasStanced, legacy: phys.hasLegacy }));
    check('a physical skill picks one deterministic clip (no alternation)',
      phys.first.castClip === 'spAtk01', String(phys.first.castClip));
    check('the gesture resolves into the WEAPON STANCE (spatk01_1hs)',
      phys.first.oneShot && phys.first.oneShot.clip === 'spatk01_1hs',
      JSON.stringify(phys.first.oneShot));
    check('the gesture lasts exactly hitTime',
      phys.first.oneShot && Math.abs(phys.first.oneShot.ms - 864) < 1,
      phys.first.oneShot && `${phys.first.oneShot.ms.toFixed(1)} ms`);
    check('the SAME skill plays the SAME clip on the next cast',
      phys.secondClip === phys.first.castClip,
      `${phys.first.castClip} -> ${phys.secondClip}`);
    await page.screenshot({ path: path.join(OUT, 'skillcast_04_physical.png') });

    // ---- 5. a look at the bar itself --------------------------------------
    // Purely for the screenshot: a headless swiftshader capture costs ~12 s
    // here, longer than any real cast, so the bar is held open with a long
    // hitTime for the picture and cancelled straight after. Nothing is
    // asserted off this — the timings are asserted above and in
    // gateway/test/capture-skills.js.
    await page.evaluate((id) => window.__world.net.inject({
      op: 'skillCast', casterId: window.__world.net.selfId,
      targetId: window.__world.net.selfId, skillId: id, level: 1,
      hitTime: 60000, reuse: 9380 }), NUKE);
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'skillcast_05_castbar.png') });
    await page.evaluate(() => window.__world.net.inject(
      { op: 'skillCancel', casterId: window.__world.net.selfId }));

    summary.result = fails.length ? 'FAIL' : 'PASS';
    summary.failures = fails;
  } catch (e) {
    summary.result = 'ERROR';
    summary.error = String((e && e.stack) || e);
    summary.failures = fails;
  } finally {
    console.log(JSON.stringify(summary, null, 2));
    await p2.browser.close();
  }
  process.exit(summary.result === 'PASS' ? 0 : 1);
})();
