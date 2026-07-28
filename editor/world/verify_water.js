// Water-plane verification (scene.json "water" contract):
//  - 17_24 (ocean NE of TI): the WaterVolume plane must exist at the sourced
//    height (-3780) and the sea must meet the terrain rise at the tile's
//    north corner.
//  - 17_25 (TI village coast): sea against the west beach.
//  - 23_17 (inland, no WaterVolume): NO water mesh may exist —
//    the phantom-water negative.
// Output: verify_shots/water_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 240000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// [tile, l2x, l2y, pitch, dist, yaw, label]
const SPOTS = [
  ['17_24', -97312, 229120, 0.30, 26, Math.PI, '17_24_shore'],   // rise + sea to the south
  ['17_25', -81408, 246016, 0.35, 30, Math.PI / 2, '17_25_beach'], // west-coast beach
  ['23_17', 114560, -16512, 0.55, 45, 0, '23_17_inland_negative'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { checks: {}, consoleErrors: [], failures: [] };
  const fail = (m) => summary.failures.push(m);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => summary.consoleErrors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') summary.consoleErrors.push(m.text());
    });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });

    for (const [tile, lx, ly, pitch, dist, yaw, label] of SPOTS) {
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: LOAD_TIMEOUT }, tile);
      await sleep(2000);

      const info = await page.evaluate(() => {
        const w = window.__world;
        const meshes = w.terrain.group.children.filter(o => o.name === 'water');
        return {
          defWater: w.terrain.def.water,
          meshCount: meshes.length,
          meshY: meshes.map(m => +m.position.y.toFixed(2)),
          texLoaded: !!w.terrain.waterTex,
        };
      });
      summary.checks[tile] = info;

      if (tile === '23_17') {
        if (info.defWater !== null) fail('23_17 def.water must be null');
        if (info.meshCount !== 0) fail('23_17 must have no water meshes');
      } else {
        if (!Array.isArray(info.defWater) || !info.defWater.length)
          fail(tile + ' def.water must be a non-empty list');
        if (info.meshCount !== info.defWater.length)
          fail(tile + ' water mesh count != contract entries');
        if (!info.texLoaded) fail(tile + ' water texture not loaded');
        for (let i = 0; i < info.defWater.length; i++) {
          const want = +(info.defWater[i].height * 0.01).toFixed(2);
          if (Math.abs(info.meshY[i] - want) > 0.01)
            fail(`${tile} water[${i}] y=${info.meshY[i]} != sourced ${want}`);
        }
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
      await sleep(1200);
      const file = `water_${label}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 1));
  // consoleErrors are advisory only (pre-existing UI action-icon 404s);
  // water texture health is covered by the texLoaded check
  if (summary.failures.length) {
    console.error('VERIFY WATER FAILED');
    process.exit(1);
  }
})().catch(e => { console.error('VERIFY WATER FAILED:', e.message); process.exit(1); });
