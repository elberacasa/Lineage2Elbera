// Close-up A/B for the HD texture pilot: same spots as verify_terrain.js
// (TI beach, Giran stone grass) but at followCam dist 3.5 — close enough
// that the LQ texel density is exceeded and a 4x diffuse must show.
// Usage: WORLD_BASE='http://127.0.0.1:8083/?hd=1' node verify_hd_closeup.js hd
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'now';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SPOTS = [
  ['17_25', -81408, 246016, 'ti_beach'],
  ['22_22', 90880, 146432, 'giran_stone_grass'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { hd: null, shots: [], consoleErrors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => summary.consoleErrors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') summary.consoleErrors.push(m.text());
    });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    summary.hd = await page.evaluate(() => window.__world.hd);

    for (const [tile, lx, ly, label] of SPOTS) {
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 600000 }, tile);
      await sleep(2000);

      await page.evaluate(({ lx, ly }) => {
        const w = window.__world;
        const p = w.character.group.position;
        p.set(lx * 0.01, 0, -ly * 0.01);
        p.y = w.terrain.heightAtWorld(p.x, p.z);
        w.character.clearTarget();
        w.followCam.pitch = 0.30;
        w.followCam.dist = 3.5;
        w.followCam.yaw = 0;
      }, { lx, ly });
      await sleep(900);
      const file = `closeup_${TAG}_${label}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      summary.shots.push(file);
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 1));
})();
