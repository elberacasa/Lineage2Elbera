// Fire-prop torch verification (19_16 Pagan Temple): the static flame props
// (FX_E_S.Default_Flame01 x22) must carry warm point lights — clustered and
// capped — so the dungeon is navigable beyond the single player-torch.
// Stages the camera at the two flame halls. Output: verify_shots/torch_*.png.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// [l2x, l2y, pitch, dist, yaw, label] — brazier hall (N) + flame corridor (S)
const SPOTS = [
  ['19_16', -12247, -35896, 0.25, 8, 0.8, '19_16_brazier_hall'],
  ['19_16', -15991, -49732, 0.25, 16, -0.6, '19_16_flame_corridor'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { checks: {}, failures: [] };
  const fail = (m) => summary.failures.push(m);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => fail('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });

    for (const [tile, lx, ly, pitch, dist, yaw, label] of SPOTS) {
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 240000 }, tile);
      await sleep(2000);

      if (!summary.checks[tile]) {
        summary.checks[tile] = await page.evaluate(() => {
          const w = window.__world;
          return {
            interior: w.terrain.interior,
            fireLights: w.terrain.fireLights.length,
            positions: w.terrain.fireLights.map(l =>
              [+l.position.x.toFixed(1), +l.position.y.toFixed(1), +l.position.z.toFixed(1)]),
          };
        });
        const c = summary.checks[tile];
        if (!c.interior) fail(tile + ' must be interior');
        if (c.fireLights < 8) fail(tile + ' too few fire lights: ' + c.fireLights);
        if (c.fireLights > 16) fail(tile + ' fire-light cap broken: ' + c.fireLights);
      }

      await page.evaluate(({ lx, ly, pitch, dist, yaw }) => {
        const w = window.__world;
        const p = w.character.group.position;
        p.set(lx * 0.01, 0, -ly * 0.01);
        p.y = w.terrain.heightAtWorld(p.x, p.z);
        w.character.clearTarget();
        w.followCam.pitch = pitch;
        w.followCam.dist = dist;
        w.followCam.yaw = yaw;
      }, { lx, ly, pitch, dist, yaw });
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, `torch_${label}.png`) });
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 1));
  if (summary.failures.length) { console.error('VERIFY TORCH FAILED'); process.exit(1); }
})().catch(e => { console.error('VERIFY TORCH FAILED:', e.message); process.exit(1); });
