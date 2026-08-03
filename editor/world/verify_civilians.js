// Civilian NPC rendering verification (mock gateway on 8085).
//   - Elias (npcId 30050 -> a_common_peopleA_MHuman_m00, nativeHeight 43)
//     must render as a REAL MODEL at 0.43 m, label above head, clickable
//   - Mystery Man (npcId 99999, unmapped) must stay a CAPSULE
// Output: verify_shots/npc_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const ELIAS = 70004, MYSTERY = 70005;
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
      'window.__world.entities.snapshot().length >= 8', { timeout: 20000 });

    // Elias upgrades to a model; Mystery Man never does (grace window)
    await page.waitForFunction(
      `!!window.__world.entities.getEntity(${ELIAS}).mixer`, { timeout: 30000 });
    await sleep(4000);
    summary.entities = await page.evaluate(
      (a, b) => window.__world.entities.snapshot().filter(e => e.id === a || e.id === b),
      ELIAS, MYSTERY);

    // aim at Elias from spawn (no walk needed; proven staging)
    await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      const c = w.character.group.position;
      w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z);
      w.followCam.pitch = 0.18;
      w.followCam.dist = Math.max(w.followCam.minDist, 4);
    }, ELIAS);
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, 'npc_01_elias_model.png') });

    // click Elias -> targeting works on the model
    const gp = await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      const V = e.group.position.constructor;
      return w.project(new V(e.group.position.x,
        e.group.position.y + e.heightM * 0.5, e.group.position.z));
    }, ELIAS);
    await page.mouse.click(gp.x, gp.y);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'target_ok' && m.id === ${ELIAS})
       && window.__world.targetWnd && window.__world.targetWnd.root.style.display !== 'none'`,
      { timeout: 8000 });
    summary.clickTarget = await page.evaluate(() => ({
      name: window.__world.targetWnd.target.name,
      hpText: `${window.__world.targetWnd.target.hp} / ${window.__world.targetWnd.target.maxHp}`,
    }));
    await page.screenshot({ path: path.join(OUT, 'npc_02_elias_targeted.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY NPC FAILED:', e.message); process.exit(1); });
