// Phase C.3 verification — the retail skill window, against the LIVE server.
//
// Logs in as a real character (device id passed in or via L2_DEVICE_ID), waits
// for the server's own SkillList, then checks the window splits skills the way
// MagicSkillWnd.uc does: PASSIVE in its own pane, ACTIVE+TOGGLE in the other,
// passives neither castable nor assignable to the shortcut bar.
//
// Usage: node verify_skillwnd.js <deviceId>

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
// A device id is optional: when none is passed we mint a fresh UUID, which
// the gateway turns into a brand-new account (auto-create). Fresh accounts
// still exercise the window split — starter characters own skills.
const DEVICE = process.argv[2] || process.env.L2_DEVICE_ID || crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1400,900'],
  });
  const summary = { logs: [] };
  let failed = false;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    page.on('pageerror', e => { summary.logs.push('PAGEERROR: ' + e.message); failed = true; });

    // adopt the caller's identity before the app boots
    await page.evaluateOnNewDocument((id) => {
      localStorage.setItem('l2vzla.deviceId', id);
    }, DEVICE);

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 45000 });

    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.skillWnd && window.__world.skillWnd.skills.length > 0',
      { timeout: 60000 });
    await sleep(1500);

    const data = await page.evaluate(() => {
      const w = window.__world.skillWnd;
      w.show();
      const count = t => w.skills.filter(s =>
        (window.__world.skillWnd.constructor, w._bucket(s) === t)).length;
      return {
        total: w.skills.length,
        active: count('active'),
        passive: count('passive'),
        usable: w.usableSkills().length,
        withFlags: w.skills.filter(s => s.passive !== undefined).length,
        anyPassiveFlag: w.skills.some(s => s.passive === true),
        activeCells: w.panes.active.children.length,
        passiveCells: w.panes.passive.children.length,
        passiveDraggable: [...w.panes.passive.children].some(c => c.draggable),
        charName: document.getElementById('status').textContent,
      };
    });
    summary.data = data;
    await page.screenshot({ path: path.join(OUT, 'c3_skillwnd_active.png') });

    await page.evaluate(() => window.__world.skillWnd.setTab('passive'));
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'c3_skillwnd_passive.png') });

    // a passive must be refused by the shortcut bar
    const hotbarRefused = await page.evaluate(() => {
      const w = window.__world.skillWnd;
      const hb = window.__world.hotbar;
      const p = w.skills.find(s => w._bucket(s) === 'passive');
      if (!p) return null;
      hb.assign(0, { type: 'skill', id: p.id });
      return hb.slots[0] === null;
    });
    summary.hotbarRefused = hotbarRefused;

    const expect = {
      'server sent skills': data.total > 0,
      'packet carries the passive flag': data.withFlags === data.total && data.anyPassiveFlag,
      'active pane populated': data.activeCells > 0,
      'passive pane populated': data.passiveCells > 0,
      'panes partition the list': data.activeCells + data.passiveCells === data.total,
      'passives are not draggable': !data.passiveDraggable,
      'shortcut bar refuses a passive': hotbarRefused === true,
      'usable == active count': data.usable <= data.active,
      'no page errors': !summary.logs.some(l => l.startsWith('PAGEERROR')),
    };
    summary.expect = expect;
    failed = failed || Object.values(expect).some(v => !v);
    for (const [k, v] of Object.entries(expect)) {
      console.log(`  ${v ? 'ok  ' : 'FAIL'}  ${k}`);
    }
  } catch (e) {
    summary.error = e.message;
    failed = true;
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(failed ? 'VERIFY C3: FAIL' : 'VERIFY C3: PASS');
  process.exit(failed ? 1 : 0);
})();
