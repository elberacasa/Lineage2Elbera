// MinimapWnd LIVE pass: world client (8083) against the REAL stack
// (aCis :2106/:7777 + gateway :8090). The character spawns in TI village
// (tile 17_25): open the map via the MenuWnd Map button and screenshot —
// the marker must stand in the village on the 17_25 crop. Also checks
// live entity dots (village NPCs) render.
// Output: verify_shots/mm_live_01_ti.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = {};
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => console.error('PAGEERROR:', e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
      { timeout: 120000 });
    await sleep(3000);   // NPC stream settles

    await page.click('.menu-btn[data-id="BtnMap"]');
    await page.waitForFunction(
      `window.__world.minimapWnd.visible
       && window.__world.minimapWnd.currentTile`, { timeout: 15000 });
    await sleep(1000);
    summary.window = await page.evaluate(() => {
      const w = window.__world;
      const m = w.minimapWnd;
      const c = w.character.group.position;
      const p = m.projectTile(c.x / 0.01, -c.z / 0.01);
      return {
        tile: m.currentTile,
        tilesRendered: document.querySelectorAll('.l2-minimap-tile').length,
        dots: m._dots.length,
        playerDots: m._dots.filter(d => d.style.background.includes('255, 210, 74')).length,
        selfInCenterTile: p.x >= m.crop && p.x <= 2 * m.crop
          && p.y >= m.crop && p.y <= 2 * m.crop,
        l2pos: [Math.round(c.x / 0.01), Math.round(-c.z / 0.01)],
      };
    });
    await page.screenshot({ path: path.join(OUT, 'mm_live_01_ti.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY MINIMAP LIVE FAILED:', e.stack || e.message); process.exit(1); });
