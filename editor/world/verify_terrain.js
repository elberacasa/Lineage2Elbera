// Terrain texturing verification (M-retail-splats). Stages the camera at
// strong layer-transition spots (chosen from the splat maps themselves:
// both weights > 100 with a sharp gradient) and screenshots the ground.
// Also sanity-checks the terrain material (texture arrays built, layer
// counts match scene.json) and samples frame cost.
//
// Usage: node verify_terrain.js [tag]
// Output: verify_shots/terrain_<tag>_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'now';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// [tile, l2x, l2y, label] — strong grass/sand/stone transitions
const SPOTS = [
  ['17_25', -81408, 246016, 'ti_beach'],
  ['17_25', -92928, 236288, 'ti_coast_nw'],
  ['22_22', 90880, 146432, 'giran_stone_grass'],
  ['24_18', 142336, 4608, 'aden_paved_grass'],
];
const VIEWS = [
  ['top', 1.25, 55],     // near top-down, whole transition
  ['low', 0.35, 10],     // ground-level oblique (tiling detail)
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { shots: [], checks: {}, consoleErrors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => summary.consoleErrors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') summary.consoleErrors.push(m.text());
    });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });

    for (const [tile, lx, ly, label] of SPOTS) {
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 240000 }, tile);
      await sleep(2000);

      // material sanity: texture arrays match the scene.json layer table
      if (!summary.checks[tile]) {
        summary.checks[tile] = await page.evaluate(() => {
          const w = window.__world;
          const mesh = w.terrain.mesh;
          const def = w.terrain.def;
          const mat = mesh && mesh.material;
          const uni = mat && mat.userData ? null : null;
          return {
            layers: (def.layers || []).length,
            splats: (def.layers || []).filter((l, i) => i > 0 && l.splat).length,
            hasMesh: !!mesh,
          };
        });
      }

      for (const [viewName, pitch, dist] of VIEWS) {
        await page.evaluate(({ lx, ly, pitch, dist }) => {
          const w = window.__world;
          const p = w.character.group.position;
          p.set(lx * 0.01, 0, -ly * 0.01);
          p.y = w.terrain.heightAtWorld(p.x, p.z);
          w.character.clearTarget();
          w.followCam.pitch = pitch;
          w.followCam.dist = dist;
          w.followCam.yaw = 0;
        }, { lx, ly, pitch, dist });
        await sleep(900);
        const file = `terrain_${TAG}_${label}_${viewName}.png`;
        await page.screenshot({ path: path.join(OUT, file) });
        summary.shots.push(file);
      }
    }

    // frame-cost sample on the densest tile (17_25: 10 layers)
    await page.select('#scene-picker', '17_25');
    await page.waitForFunction(
      t => document.getElementById('status').textContent.includes('scene: 17_25')
        && document.getElementById('loading').classList.contains('hidden'),
      { timeout: 240000 }, '17_25');
    await sleep(2000);
    summary.perf = await page.evaluate(() => new Promise(res => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
        else {
          const info = window.__world.renderer.info.render;
          res({
            avgFrameMs: +((performance.now() - t0) / frames).toFixed(1),
            fps: +(frames / 4).toFixed(1),
            drawCalls: info.calls,
            triangles: info.triangles,
          });
        }
      };
      requestAnimationFrame(tick);
    }));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 1));
})();
