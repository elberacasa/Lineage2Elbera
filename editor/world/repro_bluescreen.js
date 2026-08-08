// repro_bluescreen.js — walk a straight line across a tile boundary and
// measure what the screen actually shows, frame by frame.
//
// The player reports "the whole screen suddenly goes blue while walking".
// This reproduces it without reasoning from source: it drives the real
// offline WASD walk, and at every sample it reads the REAL framebuffer with
// gl.readPixels (not a screenshot heuristic) plus the scene state that could
// explain it — fog near/far/colour, camera vs ground height, current tile.
//
// Usage:
//   node repro_bluescreen.js [startTile] [dirDeg] [seconds] [outDir]
//     dirDeg  camera yaw in degrees; the walk goes "forward" from there.
//             yaw 0 walks +Z(three) = -Y(L2) = tile row -1.
// Writes <outDir>/frame_NNN.png plus a JSON trace on stdout.
//
// Owned by the terrain/lighting agent. Re-runnable; no writes outside outDir.

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TILE = process.argv[2] || '20_21';
const YAW_DEG = Number(process.argv[3] ?? 0);
const SECONDS = Number(process.argv[4] ?? 40);
const OUT = process.argv[5] || '/tmp/bluescreen';
const START_M = Number(process.argv[6] ?? 25);   // metres before the boundary to start
// optional explicit start, three.js world "x,z" (overrides START_M placement)
const AT = process.argv[7] ? process.argv[7].split(',').map(Number) : null;

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=960,640'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8083/?dev=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 120000 });

  await page.select('#scene-picker', TILE);
  await page.waitForFunction(
    t => window.__world.terrain && window.__world.terrain.def
         && window.__world.terrain.def.tile === t && window.__world.terrain.mesh,
    { timeout: 300000 }, TILE);
  await new Promise(r => setTimeout(r, 1500));

  // Install the sampler: re-render into the same framebuffer and read it back.
  // (renderer has no preserveDrawingBuffer, so this must happen in one task.)
  await page.evaluate(() => {
    window.__sample = () => {
      const w = window.__world;
      w.renderer.render(w.scene, w.camera);
      const gl = w.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // mean colour + the fraction of pixels that are within 12/255 of the
      // single most common colour (a flat wash reads ~1.0)
      let r = 0, g = 0, b = 0;
      const bins = new Map();
      const n = W * H;
      for (let i = 0; i < n; i++) {
        const R = px[i * 4], G = px[i * 4 + 1], B = px[i * 4 + 2];
        r += R; g += G; b += B;
        const k = (R >> 3) * 1024 + (G >> 3) * 32 + (B >> 3);
        bins.set(k, (bins.get(k) || 0) + 1);
      }
      let best = 0, bestK = 0;
      for (const [k, v] of bins) if (v > best) { best = v; bestK = k; }
      const mode = [((bestK >> 10) & 31) << 3, ((bestK >> 5) & 31) << 3, (bestK & 31) << 3];
      let near = 0;
      for (let i = 0; i < n; i++) {
        if (Math.abs(px[i * 4] - mode[0]) < 12 && Math.abs(px[i * 4 + 1] - mode[1]) < 12
            && Math.abs(px[i * 4 + 2] - mode[2]) < 12) near++;
      }
      const ch = w.character.group.position;
      const cam = w.camera.position;
      const fog = w.scene.fog;
      return {
        mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
        mode, flat: +(near / n).toFixed(3),
        tile: w.currentTile,
        char: [+ch.x.toFixed(2), +ch.y.toFixed(2), +ch.z.toFixed(2)],
        cam: [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2)],
        groundAtChar: +w.heightAt(ch.x, ch.z, ch.y).toFixed(2),
        groundAtCam: +w.heightAt(cam.x, cam.z, cam.y).toFixed(2),
        fog: fog ? {
          near: +fog.near.toFixed(1), far: +fog.far.toFixed(1),
          color: '#' + fog.color.getHexString(),
        } : null,
        light: w.worldLight ? w.worldLight.summary : null,
      };
    };
  });

  // aim the camera, then teleport to a point START_M metres before the tile
  // boundary the walk direction will hit, so a real walk crosses it in the
  // sample window (retail run speed is ~1.2 m/s and a tile edge is 327 m).
  const placed = await page.evaluate((yaw, startM, at) => {
    const w = window.__world;
    w.followCam.yaw = yaw;
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const def = w.terrain.def;
    const n = def.gridSize * def.spacing;               // L2 units per edge
    const x0 = def.origin[0] * 0.01, x1 = (def.origin[0] + n) * 0.01;
    const z1 = -def.origin[1] * 0.01, z0 = -(def.origin[1] + n) * 0.01;
    const p = w.character.group.position.clone();
    // distance along fwd to each bounding plane; take the nearest positive
    let tmin = Infinity;
    const cand = [];
    if (fwd.x > 1e-6) cand.push((x1 - p.x) / fwd.x);
    if (fwd.x < -1e-6) cand.push((x0 - p.x) / fwd.x);
    if (fwd.z > 1e-6) cand.push((z1 - p.z) / fwd.z);
    if (fwd.z < -1e-6) cand.push((z0 - p.z) / fwd.z);
    for (const t of cand) if (t > 0 && t < tmin) tmin = t;
    if (!isFinite(tmin)) return null;
    const d = Math.max(0, tmin - startM);
    if (at) { p.x = at[0]; p.z = at[1]; } else { p.x += fwd.x * d; p.z += fwd.z * d; }
    // spawn/teleport lookup (currentZ = null -> nearest-layer semantics), NOT
    // the walking rule: a teleport has no previous step to be blocked by, and
    // feeding the old tile-centre z in plants the character under the ground.
    p.y = w.heightAt(p.x, p.z, null);
    w.character.group.position.copy(p);
    w.character.clearTarget();
    return { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), toEdge: +tmin.toFixed(1) };
  }, YAW_DEG * Math.PI / 180, START_M, AT);
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })));

  const trace = [];
  const t0 = Date.now();
  let i = 0;
  while ((Date.now() - t0) / 1000 < SECONDS) {
    const s = await page.evaluate('window.__sample()');
    s.t = +((Date.now() - t0) / 1000).toFixed(1);
    s.i = i;
    trace.push(s);
    await page.screenshot({ path: path.join(OUT, `frame_${String(i).padStart(3, '0')}.png`) });
    i++;
    await new Promise(r => setTimeout(r, 1000));
  }
  await page.evaluate(() => window.dispatchEvent(
    new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true })));

  console.log(JSON.stringify({ tile: TILE, yawDeg: YAW_DEG, at: AT, placed, errors, trace }, null, 1));
  await browser.close();
})();
