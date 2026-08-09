// shot_markprojector.js — before/after pictures for the move-destination
// marker, taken from ONE build.
//
// WHAT THE TWO SIDES ARE. "before" is the decal this repo used to draw on
// every click-to-move: a Gui021 quad, 0.55 m across, parked at the pick for
// 10 s. "after" is what the retail Interlude client draws there: nothing.
// Engine.MarkProjector — the class every one of those values came from — is
// never instantiated by the client (see editor/world/js/markprojector.js for
// the evidence and tools/dat/export_markprojector.py --evidence to regenerate
// it), so the decal was an invention wearing decoded values.
//
// Both sides come from the same build: '?markprojector=authored' re-enables
// the authored reconstruction, which is off by default.
//
// The click is a real mouse click on the canvas, so what is photographed is
// the client's own pointerup handler and its own destination.
//
// Usage:  node shot_markprojector.js
// Output: verify_shots/markprojector_{before,after}.png

'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Giran plaza slab — the same station shot_walksurface.js uses, so the two
// suites photograph the same pavement.
const STAND = [82000, 148000, -3496];
const CAM = { yaw: 0, pitch: 0.30, dist: 13 };
const CLICK = [640, 380];      // canvas px

// The decal, if one is drawn, is the only PlaneGeometry mesh in the scene
// with a map and frustumCulled off. Shape-based rather than name-based so it
// finds the old main.js quad and the new module's quad alike.
function findDecal() {
  const w = window.__world;
  let m = null;
  w.scene.traverse((o) => {
    if (o.isMesh && o.material && o.material.map && o.frustumCulled === false
        && o.geometry && o.geometry.type === 'PlaneGeometry' && o.visible) m = o;
  });
  if (!m) return null;
  const g = m.geometry.parameters || {};
  return { w: g.width, h: g.height,
           pos: [Math.round(m.position.x * 100), Math.round(-m.position.z * 100),
                 Math.round(m.position.y * 100)] };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const seen = {};
  try {
    for (const mode of ['before', 'after']) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
      const q = mode === 'before' ? '?propDist=0&markprojector=authored' : '?propDist=0';
      await page.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 300000 });
      await page.waitForFunction('window.__world && window.__world.ready', { timeout: 300000 });
      await page.select('#scene-picker', '22_22');
      await page.waitForFunction(
        () => document.getElementById('status').textContent.includes('scene: 22_22')
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 300000 });
      await sleep(4000);

      await page.evaluate(async ({ STAND, CAM }) => {
        const w = window.__world;
        w.character.group.position.set(STAND[0] * 0.01, STAND[2] * 0.01, -STAND[1] * 0.01);
        w.character.clearTarget();
        w.followCam.yaw = CAM.yaw; w.followCam.pitch = CAM.pitch; w.followCam.dist = CAM.dist;
        await new Promise((r) => setTimeout(r, 800));
      }, { STAND, CAM });

      const canvas = await page.$('canvas#view');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + CLICK[0], box.y + CLICK[1]);
      await sleep(500);

      const decal = await page.evaluate(findDecal);
      const mark = await page.evaluate(() => (window.__world.clickMark || null));
      const f = `markprojector_${mode}.png`;
      await page.screenshot({ path: path.join(OUT, f) });
      seen[mode] = { decal, mark };
      console.log(`${mode}: decal=${JSON.stringify(decal)} clickMark=${JSON.stringify(mark)}  ${f}`);
      await page.close();
    }
  } finally { await browser.close(); }

  // The captures are only worth keeping if they differ in the one way that
  // matters: a decal on the 'before' side and none on the 'after' side.
  const ok = seen.before && seen.before.decal && seen.after && !seen.after.decal;
  console.log(ok ? 'CAPTURES OK: decal before, none after'
                 : 'CAPTURES SUSPECT: before.decal=' + JSON.stringify(seen.before && seen.before.decal)
                   + ' after.decal=' + JSON.stringify(seen.after && seen.after.decal));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
