// repro_spots.js — same-spot before/after staging at the BEFORE run's worst
// measured float/sink points (fixed code), for pair comparison.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/?hd=0';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'after';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the BEFORE scan's worst measured spots (repro_before.json.log)
const SPOTS = [
  ['cliff_sink', -78336, 239616],
  ['hill_sink', -72704, 252416],
  ['wall_float', -83456, 243200],
  ['foundation_float', -81920, 242176],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = {};
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => { summary.pageError = e.message; });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 90000 });
    await page.evaluate(async () => {
      const mod = await import('./vendor/three.module.min.js');
      window.__world.__Raycaster = mod.Raycaster;
      window.__world.__Vector3 = mod.Vector3;
    });
    await page.select('#scene-picker', '17_25');
    await page.waitForFunction(
      t => document.getElementById('status').textContent.includes('scene: 17_25')
        && document.getElementById('loading').classList.contains('hidden'),
      { timeout: 240000 }, '17_25');
    await sleep(1500);

    for (const [name, l2x, l2y] of SPOTS) {
      await page.evaluate(({ l2x, l2y }) => {
        const w = window.__world;
        const p = w.character.group.position;
        p.set(l2x * 0.01, 0, -l2y * 0.01);
        p.y = w.heightAt(p.x, p.z, null);
        w.character.clearTarget();
        w.walkTo(p.clone());
        w.followCam.pitch = 0.14;
        w.followCam.dist = Math.max(w.followCam.minDist, 4.5);
      }, { l2x, l2y });
      await sleep(1200);
      summary[name] = await page.evaluate(() => {
        const w = window.__world;
        const p = w.character.group.position;
        const rc = new w.__Raycaster();
        const origin = p.clone(); origin.y += 80;
        rc.set(origin, new w.__Vector3(0, -1, 0));
        const hit = rc.intersectObjects([w.terrain.mesh], false)[0];
        const g = w.terrain.geodata;
        return {
          charY: +p.y.toFixed(3),
          meshY: hit ? +hit.point.y.toFixed(3) : null,
          d: hit ? +(p.y - hit.point.y).toFixed(3) : null,
          geoLayers: g._layersAt(Math.round(p.x * 100), Math.round(-p.z * 100))
            .map(l => l.height),
        };
      });
      await page.screenshot({ path: path.join(OUT, `spots_${TAG}_${name}.png`) });
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 1));
})().catch(e => { console.error('SPOTS FAILED:', e); process.exit(1); });
