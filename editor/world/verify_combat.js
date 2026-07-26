// M3 combat verification against the MOCK gateway (port 8085).
// Drives the real UI: toggle Online (?ws=ws://127.0.0.1:8085), click the
// gremlin (raycast entity picking), target frame appears, F1 attacks,
// damage floats / HP bars tick, gremlin dies (die anim + fade), self
// status bar updates, '/die' shows the death overlay, '/revive' clears.
//
// Usage: node verify_combat.js     (mock gateway must be running on 8085)
// Output: verify_shots/m3_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085';
const OUT = path.join(__dirname, 'verify_shots');
const GREMLIN = 70001;
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
      `window.__world.net.connected && window.__world.entities.snapshot().length >= 6
       && window.__world.net.log.some(m => m.op === 'selfStatus')`, { timeout: 20000 });
    await sleep(1500);

    // StatusWnd (retail window) present and its gauges fill on selfStatus
    summary.selfBarInitial = await page.evaluate(() => {
      const w = window.__world.statusWnd;
      return {
        // offsetParent is null for position:fixed; use the rendered rect
        visible: !!w && !!w.root && w.root.getBoundingClientRect().width > 0,
        level: w ? w.set && w.rows && 'hp' in w.rows : false,
        hpFrac: w ? w.rows.hp.frac : null,
      };
    });

    // frame the gremlin: zoom in, then aim the follow camera straight at it
    await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      const c = w.character.group.position;
      w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z);
      w.followCam.pitch = 0.3;
      w.followCam.dist = Math.max(w.followCam.minDist, 4);
    }, GREMLIN);
    await sleep(1500);
    const gp = await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      if (!e) return null;
      const V = e.group.position.constructor;
      return w.project(new V(e.group.position.x, e.group.position.y + 0.3, e.group.position.z));
    }, GREMLIN);
    summary.gremlinScreen = gp;

    // -- click the gremlin -> target ---------------------------------------
    await page.mouse.click(gp.x, gp.y);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'target' && m.id === ${GREMLIN})
       && window.__world.net.log.some(m => m.op === 'target_ok' && m.id === ${GREMLIN})
       && document.getElementById('target-frame').classList.contains('visible')`,
      { timeout: 10000 });
    await sleep(400);
    summary.target = await page.evaluate(() => ({
      name: document.getElementById('target-name').textContent,
      hpText: document.getElementById('target-hp-text').textContent,
    }));
    await page.screenshot({ path: path.join(OUT, 'm3_01_targeting.png') });

    // -- F1 -> attack; combat ticks ----------------------------------------
    await page.keyboard.press('F1');
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'attack').length >= 2`, { timeout: 10000 });
    // catch a damage float mid-flight + shrunken HP bars
    await page.waitForFunction(
      'document.querySelectorAll(".dmg-float").length > 0', { timeout: 8000 });
    summary.midCombat = await page.evaluate(() => ({
      floats: [...document.querySelectorAll('.dmg-float')].map(e => ({
        text: e.textContent, cls: e.className })),
      hpBars: document.querySelectorAll('.hp-bar').length,
      targetHpFillWidth: document.getElementById('target-hp-fill').style.width,
      selfHpFrac: window.__world.statusWnd.rows.hp.frac,
    }));
    await page.screenshot({ path: path.join(OUT, 'm3_02_combat.png') });

    // -- gremlin dies --------------------------------------------------------
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'die' && m.id === ${GREMLIN})`, { timeout: 30000 });
    await sleep(1200);   // die animation starts, corpse begins to fade
    summary.death = await page.evaluate(() => ({
      targetDead: document.getElementById('target-frame').classList.contains('dead'),
      targetHpText: document.getElementById('target-hp-text').textContent,
      exp: window.__world.combat.self.exp,
      selfHp: window.__world.statusWnd.rows.hp.frac,
    }));
    await page.screenshot({ path: path.join(OUT, 'm3_03_death.png') });

    // -- revive ---------------------------------------------------------------
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'revive' && m.id === ${GREMLIN})`, { timeout: 15000 });
    summary.revived = await page.evaluate(
      id => !window.__world.entities.getEntity(id).dead, GREMLIN);

    // -- own death overlay via /die -------------------------------------------
    await page.keyboard.press('Enter');
    await sleep(250);
    await page.type('#chat-input', '/die');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      'document.getElementById("death-overlay").classList.contains("visible")',
      { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, 'm3_04_death_overlay.png') });
    await page.keyboard.press('Enter');
    await sleep(250);
    await page.type('#chat-input', '/revive');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      '!document.getElementById("death-overlay").classList.contains("visible")',
      { timeout: 8000 });
    summary.deathOverlayWorks = true;
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY COMBAT FAILED:', e.message); process.exit(1); });
