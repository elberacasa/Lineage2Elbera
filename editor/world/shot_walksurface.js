// shot_walksurface.js — before/after pictures for the click-pick fix, taken
// from ONE build.
//
// "Before" is produced without touching the code under test: the BSP chunks are
// moved to three.js layer 1 and the CAMERA is told to render layer 1 as well,
// so the buildings and the pavement still draw while the Raycaster (whose own
// layer mask stays on layer 0) cannot see them — exactly the state main.js's
// click handler was in when its walkTargets held terrain meshes only.
//
// The click is a real mouse click on the canvas, so what is photographed is the
// client's own handler, its own MarkProjector quad and its own destination.
//
// Usage: node shot_walksurface.js
// Output: verify_shots/click_giran_{before,after}.png

'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Standing on the Giran plaza slab, camera low so the click lands on pavement
// a few metres ahead — the shot the owner described.
const STAND = [82000, 148000, -3496];
const CAM = { yaw: 0, pitch: 0.30, dist: 13 };
const CLICK = [640, 380];      // canvas px

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    for (const mode of ['before', 'after']) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
      await page.goto(BASE + '?propDist=0', { waitUntil: 'domcontentloaded', timeout: 300000 });
      await page.waitForFunction('window.__world && window.__world.ready', { timeout: 300000 });
      await page.select('#scene-picker', '22_22');
      await page.waitForFunction(
        () => document.getElementById('status').textContent.includes('scene: 22_22')
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 300000 });
      await sleep(4000);

      const info = await page.evaluate(async ({ mode, STAND, CAM }) => {
        const w = window.__world;
        if (mode === 'before' && w.terrain.bsp) {
          // draw it, but hide it from the Raycaster (see the header)
          w.terrain.bsp.group.traverse((o) => o.layers.set(1));
          w.camera.layers.enable(1);
        }
        w.character.group.position.set(STAND[0] * 0.01, STAND[2] * 0.01, -STAND[1] * 0.01);
        w.character.clearTarget();
        w.followCam.yaw = CAM.yaw; w.followCam.pitch = CAM.pitch; w.followCam.dist = CAM.dist;
        await new Promise((r) => setTimeout(r, 800));
        return { stand: STAND };
      }, { mode, STAND, CAM });

      const canvas = await page.$('canvas#view');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + CLICK[0], box.y + CLICK[1]);
      await sleep(400);

      const mark = await page.evaluate(() => {
        // the MarkProjector quad main.js parks at the pick
        const w = window.__world;
        let m = null;
        w.scene.traverse((o) => {
          if (o.isMesh && o.material && o.material.map
              && o.renderOrder === 2 && o.frustumCulled === false && o.geometry.type === 'PlaneGeometry') m = o;
        });
        if (!m || !m.visible) return null;
        return { x: Math.round(m.position.x * 100), y: Math.round(-m.position.z * 100),
                 z: Math.round(m.position.y * 100) };
      });
      const f = `click_giran_${mode}.png`;
      await page.screenshot({ path: path.join(OUT, f) });
      console.log(`${mode}: standing ${JSON.stringify(info.stand)} click(${CLICK}) `
        + `-> mark ${JSON.stringify(mark)}  ${f}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
