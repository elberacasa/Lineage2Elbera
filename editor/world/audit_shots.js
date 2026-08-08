// Foundation audit: stage the camera at named L2 world spots and screenshot.
//
// WHY a separate script from the verify_* suite: those stage at spots chosen
// for the feature they were written for. This one takes an arbitrary
// [tile, l2x, l2y, l2z, yawDeg, pitch, dist, label] list on the command line
// (or from AUDIT_SPOTS) so a finding can be photographed exactly where the
// decoded data says the defect is, and re-photographed after a fix.
//
// It can also toggle a client behaviour before the shot via --eval=<file>,
// which is evaluated in the page after the scene loads. That is how an
// A/B of a suspected material bug is produced without editing client code.
//
// Usage:
//   node audit_shots.js <tag> [--eval=patch.js]
//   AUDIT_SPOTS='[["22_22",81489,143715,-3355,0,0.35,25,"giran_gate"]]' \
//     node audit_shots.js gate
// Output: audit_shots/<tag>_<label>.png  + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'audit_shots');
const TAG = process.argv[2] || 'now';
const EVAL_ARG = process.argv.find(a => a.startsWith('--eval='));
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 240000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SPOTS = JSON.parse(process.env.AUDIT_SPOTS || '[]');

(async () => {
  if (!SPOTS.length) { console.error('no AUDIT_SPOTS'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const patch = EVAL_ARG ? fs.readFileSync(EVAL_ARG.slice(7), 'utf8') : null;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { shots: [], errors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => summary.errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') summary.errors.push(m.text()); });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 120000 });

    let loaded = null;
    for (const [tile, lx, ly, lz, yaw, pitch, dist, label] of SPOTS) {
      if (tile !== loaded) {
        await page.select('#scene-picker', tile);
        await page.waitForFunction(
          t => document.getElementById('status').textContent.includes('scene: ' + t)
            && document.getElementById('loading').classList.contains('hidden'),
          { timeout: LOAD_TIMEOUT }, tile);
        await sleep(3000);
        loaded = tile;
        if (patch) await page.evaluate(patch);
      }
      await page.evaluate(({ lx, ly, lz, yaw, pitch, dist }) => {
        const w = window.__world;
        const p = w.character.group.position;
        p.set(lx * 0.01, lz * 0.01, -ly * 0.01);
        w.character.clearTarget();
        w.followCam.pitch = pitch;
        w.followCam.dist = dist;
        w.followCam.yaw = yaw * Math.PI / 180;
      }, { lx, ly, lz, yaw, pitch, dist });
      await sleep(1200);
      const file = `${TAG}_${label}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      summary.shots.push(file);
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 1));
})();
