// AbnormalStatusWnd + cooldown overlay verification (mock gateway on 8085).
// Mock sends at enterChar: buffs{3 timed effects + Relax 226 toggle}
// (Shield 120s, Mental Shield 20s, Entangle 12s, Relax -1), buffUpdate
// {remove 102} at +12s, and skillCast reuse ms on every useSkill; casting
// Relax toggles its buff off/on (aCis PlayerCast.doToggleCast).
// Asserts: strip visible with 4 cells + real icons, tooltip countdown
// ticks down, the short effect disappears (delta OR local expiry — both
// are legitimate), the toggle never expires, a shortcut slot + a SkillWnd
// cell sweep mid-reuse, and the active-toggle marker on/off in both the
// SkillWnd and the shortcut bar.
// Output: verify_shots/ab_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      `window.__world.net.log.some(m => m.op === 'buffs')`, { timeout: 20000 });
    await sleep(1500);

    // -- the strip: 4 cells (3 timed + 1 toggle), real icons, sourced dock ----
    summary.strip = await page.evaluate(() => {
      const w = window.__world;
      const cells = [...document.querySelectorAll('.l2-buff-cell')];
      return {
        visible: document.getElementById('l2-abnormalwnd').style.display === 'block',
        effects: w.abnormalWnd.effects.map(e => e.skillId),
        cells: cells.length,
        iconsLoaded: cells.filter(c => c.querySelector('img')
          && c.querySelector('img').complete
          && c.querySelector('img').naturalWidth > 0).length,
        toggleTooltip: cells[3] && cells[3].title,   // no countdown on -1
        dock: { left: w.abnormalWnd.root.style.left, top: w.abnormalWnd.root.style.top },
        registered: w.wndMgr.names.includes('AbnormalStatusWnd'),
      };
    });
    await page.screenshot({ path: path.join(OUT, 'ab_01_strip.png') });

    // -- tooltip countdown ticks down ------------------------------------------
    const r1 = await page.evaluate(() => Math.round(
      window.__world.abnormalWnd.remaining(window.__world.abnormalWnd.effects[0])));
    await sleep(2100);
    const r2 = await page.evaluate(() => Math.round(
      window.__world.abnormalWnd.remaining(window.__world.abnormalWnd.effects[0])));
    summary.countdown = { before: r1, after: r2, ticking: r2 < r1 };

    // -- expiry: Entangle (12s) leaves the strip; the toggle never does -------
    await page.waitForFunction(
      'window.__world.abnormalWnd.effects.length === 3'
      + ' && document.querySelectorAll(".l2-buff-cell").length === 3',
      { timeout: 20000 });
    summary.expiry = await page.evaluate(() => ({
      remaining: window.__world.abnormalWnd.effects.map(e => e.skillId),
      toggleAlive: window.__world.abnormalWnd.effects.some(e => e.skillId === 226),
      sawBuffUpdate: window.__world.net.log.some(m => m.op === 'buffUpdate'),
    }));
    await page.screenshot({ path: path.join(OUT, 'ab_02_after_expiry.png') });

    // -- cooldown sweep, two paths --------------------------------------------
    // (a) login restore: the enterChar skillCoolTime seeded skill 3 at
    //     5s left of 10s — the slot must sweep at ~50% BEFORE any cast
    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    await sleep(600);
    await page.evaluate(() => {
      document.querySelector('#l2-skillwnd [draggable="true"]')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(600);
    summary.loginRestore = await page.evaluate(() => {
      const ov = document.querySelector('.shortcut-slot[data-sid="3"] .l2-cool-overlay');
      return { sweep: ov ? parseFloat(ov.style.height) : null };
    });
    // (b) per-cast reuse: skillCast carries reuse ms (aCis sends no
    //     SkillCoolTime on cast) — the sweep must restart near full
    await page.keyboard.press('F1');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillCast'
        && m.skillId === 3 && m.reuse === 8000)`, { timeout: 10000 });
    await sleep(400);
    summary.cooldown = await page.evaluate(() => {
      const pct = (el) => (el ? parseFloat(el.style.height) : null);
      return {
        slotSweep: pct(document.querySelector('.shortcut-slot[data-sid="3"] .l2-cool-overlay')),
        skillCellSweep: pct(document.querySelector('.l2-skill-cell[data-skill-id="3"] .l2-cool-overlay')),
      };
    });
    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'ab_03_cooldown.png') });

    // -- active toggle marker: Relax (226) is TOGGLE in skilltypes.json;
    //    its -1 buff is the active signal (gateway M10). Both windows mark.
    summary.toggleMark = await page.evaluate(() => {
      const w = window.__world;
      w.shortcutWnd.assign(0, 5, { type: 'skill', id: 226 });
      return {
        skillCell: !!document.querySelector(
          '.l2-skill-cell[data-skill-id="226"].l2-toggle-active'),
        slot: !!document.querySelector(
          '.shortcut-slot[data-sid="226"].l2-toggle-active'),
      };
    });
    await page.screenshot({ path: path.join(OUT, 'ab_04_toggle_active.png') });

    // -- deactivate: casting the active toggle re-sends useSkill; the mock
    //    (like aCis PlayerCast.doToggleCast) stops the effect -------------
    await page.evaluate(() => window.__world.shortcutWnd.trigger(0, 5));
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'buffUpdate'
        && (m.remove || []).includes(226))`, { timeout: 10000 });
    await sleep(400);
    summary.toggleOff = await page.evaluate(() => ({
      buffGone: !window.__world.abnormalWnd.effects.some(e => e.skillId === 226),
      skillMarkGone: !document.querySelector(
        '.l2-skill-cell[data-skill-id="226"].l2-toggle-active'),
      slotMarkGone: !document.querySelector(
        '.shortcut-slot[data-sid="226"].l2-toggle-active'),
    }));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY ABNORMAL FAILED:', e.message); process.exit(1); });
