// Remote-player animation verification (mock gateway on 8085).
// The mock broadcasts, at enterChar: changeWait{Borg 80002, waitType 0}
// (sit) and changeMove{Cora 80003, running} (run instead of walk on her
// patrol square); a client social action (ids 2..13) echoes socialAction
// for self AND Aria (80001).
// Asserts: Borg holds the 'sit' clip, Cora plays 'run' while moving and
// 'idle' at corners, a social action dances Aria (and self), and the
// monster degrade (setWaitType on an npc) is a silent no-op.
// Output: verify_shots/ra_*.png + JSON summary.
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
      'window.__world.net.connected && window.__world.net.selfId', { timeout: 15000 });
    // player models load async (glTF) — wait until all three carry clips
    await page.waitForFunction(
      `[80001, 80002, 80003].every(id => {
         const e = window.__world.entities.getEntity(id);
         return e && e.current;
       })`, { timeout: 30000 });
    await sleep(1500);

    const clipOf = (id) => page.evaluate((eid) => {
      const e = window.__world.entities.getEntity(eid);
      return e && e.current ? e.current.getClip().name : null;
    }, id);

    // -- Borg sits (changeWait 0 at enterChar) --------------------------------
    summary.borg = {
      clip: await clipOf(80002),
      sitting: await page.evaluate(
        () => !!window.__world.entities.getEntity(80002).sitting),
    };
    // -- Cora runs her square (changeMove running) ----------------------------
    // sample over two patrol sides: 'run' while moving, 'idle' at corners
    const coraSamples = [];
    for (let i = 0; i < 14; i++) {
      coraSamples.push(await page.evaluate(() => {
        const e = window.__world.entities.getEntity(80003);
        return {
          moving: !!e.target,
          clip: e.current ? e.current.getClip().name : null,
          forced: e.forcedMoveAnim || null,
        };
      }));
      await sleep(700);
    }
    summary.cora = {
      forced: coraSamples[0] && coraSamples[0].forced,
      ranWhileMoving: coraSamples.some(s => s.moving && s.clip === 'run'),
      neverWalked: !coraSamples.some(s => s.clip === 'walk'),
    };

    // -- social action dances Aria (and self) ---------------------------------
    await page.keyboard.down('Alt'); await page.keyboard.press('c'); await page.keyboard.up('Alt');
    await sleep(500);
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="13"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'socialAction').length >= 2`,
      { timeout: 8000 });
    await sleep(500);
    summary.social = {
      ariaClip: await clipOf(80001),
      selfClip: await page.evaluate(() => (
        window.__world.character.current
          ? window.__world.character.current.getClip().name : null)),
    };
    // frame the evidence: stand next to Borg (sitting), then re-trigger
    // the social and stand next to Aria (dancing). Self goes on the
    // CAMERA side (the follow cam sits at -z of the character, FOV 35):
    // the subject ends up beyond self, inside the narrow frustum.
    const standNear = (id) => page.evaluate((eid) => {
      const w = window.__world;
      const e = w.entities.getEntity(eid);
      const c = w.character;
      c.clearTarget();
      c.group.position.set(e.group.position.x - 2.5, e.group.position.y,
                           e.group.position.z - 2.5);
    }, id);
    await standNear(80002);
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, 'ra_01_borg_sit.png') });
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="13"]').click();
    });
    await sleep(300);
    await standNear(80001);
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, 'ra_02_aria_dance.png') });

    // -- monster degrade: setWaitType on an npc is a silent no-op -------------
    summary.monsterDegrade = await page.evaluate(() => {
      const e = window.__world.entities.getEntity(70001);
      const before = e.current ? e.current.getClip().name : null;
      let threw = false;
      try { window.__world.entities.setWaitType(70001, 0); } catch { threw = true; }
      const after = e.current ? e.current.getClip().name : null;
      return { before, after, threw, ok: !threw && before === after };
    });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY REMOTEANIM FAILED:', e.message); process.exit(1); });
