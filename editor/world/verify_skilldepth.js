// Skill-depth verification against the MOCK gateway (port 8085):
//   * weapon condition (aCis weaponsAllowed): Power Strike (3, SWORD/BLUNT/
//     BIGBLUNT/BIGSWORD) is grayed + click-blocked with a Dagger equipped,
//     re-enabled after /equipsword swaps the sword back in (invUpdate)
//   * shortcut bar mirrors the gray-out and swallows the trigger too
//   * self-buff routing: Self Heal (1216, aCis target SELF) sends useSkill
//     WITHOUT targetId even while the gremlin is targeted; the mock routes
//     it to the caster (skillCast targetId === selfId)
//   * cast abort: /interrupt (sysMsg 27 + actionFailed, the aCis
//     CreatureCast.interrupt pair) cancels the casting bar
//   * MP cost: selfStatus mp drops on skillLaunch
//
// Usage: node verify_skilldepth.js     (mock gateway must be running on 8085)
// Output: verify_shots/skilldepth_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const GREMLIN = 70001;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fails = [];
function check(summary, name, cond, detail) {
  summary[name] = { pass: !!cond, detail };
  if (!cond) fails.push(`${name}: ${detail}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillList')
       && window.__world.net.log.some(m => m.op === 'itemList')
       && window.__world.weaponGate.loaded`, { timeout: 20000 });
    await sleep(800);

    // baseline: Squire's Sword (SWORD) equipped from the starter itemList
    check(summary, 'baseline_sword', await page.evaluate(
      () => window.__world.weaponGate.weapon === 'SWORD'),
      await page.evaluate(() => String(window.__world.weaponGate.weapon)));

    // skill window up (Alt+K)
    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    await sleep(500);

    // -- fixture: skill list [3, 1216, 226] + Dagger in the right hand ------
    await page.evaluate(() => window.__world.net.sendOp('say', { channel: 0, text: '/skilldepth' }));
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillList' && (m.skills || []).some(s => s.id === 1216))
       && window.__world.weaponGate.weapon === 'DAGGER'`, { timeout: 8000 });
    await sleep(600);   // skill window re-rendered with the gate applied

    const cell3 = () => page.evaluate(() => {
      const el = document.querySelector('#l2-skillwnd .l2-skill-cell[data-skill-id="3"]');
      return el ? {
        mismatch: el.classList.contains('l2-weapon-mismatch'),
        opacity: el.style.opacity, cursor: el.style.cursor,
        draggable: el.draggable, title: el.title,
      } : null;
    });
    const cell1216 = () => page.evaluate(() => {
      const el = document.querySelector('#l2-skillwnd .l2-skill-cell[data-skill-id="1216"]');
      return el ? {
        mismatch: el.classList.contains('l2-weapon-mismatch'),
        opacity: el.style.opacity, draggable: el.draggable,
      } : null;
    });

    let c = await cell3();
    check(summary, 'dagger_grays_powerstrike',
      c && c.mismatch && c.opacity === '0.4' && !c.draggable, JSON.stringify(c));
    c = await cell1216();
    check(summary, 'selfheal_not_grayed', c && !c.mismatch && c.draggable, JSON.stringify(c));

    // shortcut bar mirrors the gray-out
    await page.evaluate(() => window.__world.shortcutWnd.assign(0, 0, { type: 'skill', id: 3 }));
    await sleep(300);
    const slotState = () => page.evaluate(() => {
      const el = document.querySelector('#l2-shortcutwnd .shortcut-slot[data-stype="skill"][data-sid="3"]');
      return el ? {
        mismatch: el.classList.contains('l2-weapon-mismatch'),
        opacity: el.style.opacity,
      } : null;
    });
    let sl = await slotState();
    check(summary, 'shortcut_grayed', sl && sl.mismatch && sl.opacity === '0.4', JSON.stringify(sl));
    await page.screenshot({ path: path.join(OUT, 'skilldepth_01_dagger_grayed.png') });

    // clicks are swallowed: neither the cell nor the slot sends useSkill
    let sent3 = await page.evaluate(() => {
      window.__mark = window.__world.net.log.length;
      document.querySelector('#l2-skillwnd .l2-skill-cell[data-skill-id="3"]').click();
      window.__world.shortcutWnd.trigger(0, 0);
      return true;
    });
    await sleep(800);
    check(summary, 'click_blocked_dagger', await page.evaluate(() =>
      !window.__world.net.log.slice(window.__mark)
        .some(m => m.dir === 'out' && m.op === 'useSkill' && m.skillId === 3)), sent3);

    // -- weapon swap re-enables instantly ------------------------------------
    await page.evaluate(() => window.__world.net.sendOp('say', { channel: 0, text: '/equipsword' }));
    await page.waitForFunction(`window.__world.weaponGate.weapon === 'SWORD'`, { timeout: 8000 });
    await sleep(600);
    c = await cell3();
    check(summary, 'sword_enables_powerstrike',
      c && !c.mismatch && c.opacity !== '0.4' && c.draggable, JSON.stringify(c));
    sl = await slotState();
    check(summary, 'shortcut_enabled', sl && !sl.mismatch && sl.opacity !== '0.4', JSON.stringify(sl));
    await page.screenshot({ path: path.join(OUT, 'skilldepth_02_sword_enabled.png') });

    // and now the slot DOES cast (no target -> no targetId field)
    await page.evaluate(() => {
      window.__mark = window.__world.net.log.length;
      window.__world.shortcutWnd.trigger(0, 0);
    });
    await page.waitForFunction(
      `window.__world.net.log.slice(window.__mark)
        .some(m => m.dir === 'out' && m.op === 'useSkill' && m.skillId === 3)`, { timeout: 5000 });
    check(summary, 'cast_after_swap', true, 'useSkill 3 sent');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillLaunch' && m.skillId === 3)`, { timeout: 8000 });

    // MP cost landed (200 - 10 from the mock's useSkill handler)
    const mp = await page.evaluate(() => window.__world.combat.self && window.__world.combat.self.mp);
    check(summary, 'mp_spent', mp === 190, `mp=${mp}`);

    // -- self-buff routing: target the gremlin, cast Self Heal ---------------
    await page.evaluate((id) => window.__world.combat.setTarget(id, 'Gremlin',
      { kind: 'npc', level: 1, color: 0 }), GREMLIN);
    await page.evaluate(() => {
      window.__mark = window.__world.net.log.length;
      document.querySelector('#l2-skillwnd .l2-skill-cell[data-skill-id="1216"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.slice(window.__mark)
        .some(m => m.dir === 'out' && m.op === 'useSkill' && m.skillId === 1216)`, { timeout: 5000 });
    const sent1216 = await page.evaluate(() =>
      window.__world.net.log.slice(window.__mark)
        .find(m => m.dir === 'out' && m.op === 'useSkill' && m.skillId === 1216));
    check(summary, 'selfbuff_no_targetid', sent1216 && !('targetId' in sent1216),
      JSON.stringify(sent1216));
    // the mock routes it to the caster (aCis SELF routing)
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillCast' && m.skillId === 1216
        && m.targetId === window.__world.net.selfId)`, { timeout: 5000 });
    check(summary, 'selfbuff_cast_on_self', true, 'skillCast targetId === selfId');

    // cast bar is up mid-cast (mock hitTime 1500) — then the server aborts
    await page.waitForFunction(
      `document.getElementById('cast-bar').classList.contains('visible')`, { timeout: 5000 });
    await page.evaluate(() => window.__world.net.sendOp('say', { channel: 0, text: '/interrupt' }));
    await page.waitForFunction(
      `!document.getElementById('cast-bar').classList.contains('visible')`, { timeout: 5000 });
    check(summary, 'interrupt_cancels_bar', true, 'bar hidden after sysMsg 27 + actionFailed');
    // no skillLaunch for the aborted cast, and the chat shows the interrupt
    const sysLine = await page.evaluate(() =>
      window.__world.chat.lines.filter(l => l.kind === 'sysmsg').slice(-1)[0]);
    check(summary, 'interrupt_sysmsg', sysLine && sysLine.id === 27, JSON.stringify(sysLine));
    await page.screenshot({ path: path.join(OUT, 'skilldepth_03_interrupted.png') });

    summary.checks = Object.keys(summary).filter(k => summary[k] && summary[k].pass !== undefined).length;
    summary.result = fails.length ? 'FAIL' : 'PASS';
    summary.failures = fails;
  } catch (e) {
    summary.result = 'ERROR';
    summary.error = String(e && e.stack || e);
    summary.failures = fails;
  } finally {
    console.log(JSON.stringify(summary, null, 2));
    await browser.close();
  }
  process.exit(fails.length || summary.result !== 'PASS' ? 1 : 0);
})();
