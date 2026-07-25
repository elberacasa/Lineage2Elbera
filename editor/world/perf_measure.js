// Prop-rendering perf harness (M3). Measures average frame time + draw
// calls on prop-heavy tiles with the legacy raw path (?props=raw) vs the
// instanced path (default). Headless SwiftShader — numbers are relative,
// not representative of real GPUs.
//
// Usage: node perf_measure.js
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TILES = ['22_22', '20_22'];   // Giran (1237 props), Dion (1647)
const MODES = [
  ['raw', '?props=raw&propDist=0'],
  ['instanced', '?propDist=300'],
  ['instanced+cull60', '?propDist=60'],
];

async function measure(tile, modeName, query) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:8083/${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.select('#scene-picker', tile);
    await page.waitForFunction(
      t => document.getElementById('status').textContent.includes('scene: ' + t)
        && document.getElementById('loading').classList.contains('hidden'),
      { timeout: 240000 }, tile);
    await sleep(2500);   // textures settle, camera settles
    return await page.evaluate(() => new Promise(res => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 5000) requestAnimationFrame(tick);
        else {
          const info = window.__world.renderer.info.render;
          res({
            avgFrameMs: +((performance.now() - t0) / frames).toFixed(1),
            fps: +(frames / 5).toFixed(1),
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
}

(async () => {
  const out = {};
  for (const tile of TILES) {
    out[tile] = {};
    for (const [mode, query] of MODES) {
      process.stderr.write(`measuring ${tile} ${mode}…\n`);
      out[tile][mode] = await measure(tile, mode, query);
    }
  }
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('PERF FAILED:', e.message); process.exit(1); });
