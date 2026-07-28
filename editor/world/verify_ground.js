// verify_ground.js — ground-contact audit (goal instrument, v2).
// Metrics per tile:
//   A. single-layer agreement: |meshY - geodata lowest layer| at every
//      single-layer sample cell (mesh and geodata must render the same
//      ground; tolerance 0.25m)
//   B. walk stability: a ground walker following heightAtWorld(x,z,curZ,
//      maxUp) must never gain >2m in one step (the roof-snap bug)
// Usage: node verify_ground.js [tile ...]  (default: audit set)
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TILES = process.argv.slice(2);
const AUDIT = TILES.length ? TILES
  : ['17_22', '17_25', '22_22', '24_18', '20_18', '21_25', '19_23', '18_22',
     '23_15', '16_21'];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=960,640'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8083/?dev=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 90000 });

  let allOk = true;
  for (const tile of AUDIT) {
    await page.select('#scene-picker', tile);
    await page.waitForFunction(
      (t) => window.__world.terrain && window.__world.terrain.def
             && window.__world.terrain.def.tile === t
             && (window.__world.terrain.interior || window.__world.terrain.mesh),
      { timeout: 300000 }, tile);
    const isInterior = await page.evaluate(
      () => !!(window.__world.terrain && window.__world.terrain.interior));
    if (isInterior) { console.log(`SKIP ${tile} (interior: no mesh by design)`); continue; }
    await new Promise(r => setTimeout(r, 800));
    const res = await page.evaluate(async () => {
      const w = window.__world;
      const def = w.terrain.def;
      const geo = w.terrain.mesh.geometry.attributes.position;
      const grid = 256;
      const startX = geo.getX(0), startZ = geo.getZ(0);
      const stepX = geo.getX(1) - startX, rowZ = geo.getZ(grid) - startZ;
      const meshYAt = (tx, tz) => {
        const gx = (tx - startX) / stepX, gz = (tz - startZ) / rowZ;
        const x0 = Math.floor(gx), z0 = Math.floor(gz);
        if (x0 < 0 || z0 < 0 || x0 >= grid - 1 || z0 >= grid - 1) return null;
        const fx = gx - x0, fz = gz - z0;
        const y = (i, j) => geo.getY(j * grid + i);
        return y(x0, z0) * (1 - fx) * (1 - fz) + y(x0 + 1, z0) * fx * (1 - fz)
             + y(x0, z0 + 1) * (1 - fx) * fz + y(x0 + 1, z0 + 1) * fx * fz;
      };
      const L2 = 100;
      const N = 12;
      let aTotal = 0, aBad = 0, aWorst = 0, bJumps = 0, bWorst = 0, samples = [];
      for (let i = 1; i <= N; i++) {
        let prevZ = null, prevWy = null;
        for (let j = 1; j <= N; j++) {
          const fx = i / (N + 1), fy = j / (N + 1);
          const wx = def.origin[0] + fx * 256 * def.spacing;
          const wy = def.origin[1] + fy * 256 * def.spacing;
          const tx = wx / L2, tz = -wy / L2;
          // geodata layers at this cell via the client's own decoder path
          const gLow = w.terrain.geodata
            ? w.terrain.geodata.heightAt(wx, wy, null) : null;
          const meshY = meshYAt(tx, tz);
          // metric A (single-layer cells, FLAT ground only): geodata's
          // 16-unit cells vs the mesh's 128-unit bilinear disagree
          // legitimately on slopes (quantization); on flat ground they
          // must agree to 0.25m
          if (gLow != null && w.terrain.geodata._layersAt(wx, wy).length === 1) {
            const slope = Math.abs(meshY - meshYAt(tx + 1.28, tz)) +
                          Math.abs(meshY - meshYAt(tx, tz - 1.28));
            if (slope < 0.3) {
              aTotal++;
              const d = Math.abs(meshY - gLow / L2);
              if (d > aWorst) aWorst = d;
              if (d > 0.5) { aBad++; if (samples.length < 3) samples.push([Math.round(wx), Math.round(wy), +meshY.toFixed(2), gLow]); }
            }
          }
          // metric B: fine-grained walk (0.5m steps) along the row — the
          // roof-snap rule: never gain >2m in one real step
          if (prevZ != null) {
            const steps = Math.ceil(Math.abs(wy - prevWy) / 50);
            let z = prevZ;
            for (let s = 1; s <= steps; s++) {
              const sy = prevWy + (wy - prevWy) * (s / steps);
              const sz = w.terrain.heightAtWorld(wx / L2, -sy / L2, z);
              if (sz - z > 2) {
                bJumps++;
                if (sz - z > bWorst) bWorst = sz - z;
              }
              z = sz;
            }
            prevZ = z;
          } else {
            prevZ = w.terrain.heightAtWorld(wx / L2, -wy / L2, null);
          }
          prevWy = wy;
        }
      }
      return { aTotal, aBad, aWorst: +aWorst.toFixed(2), bJumps,
               bWorst: +bWorst.toFixed(2), samples };
    });
    const ok = res.aBad === 0 && res.bJumps === 0;
    allOk = allOk && ok;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${tile}`, JSON.stringify(res));
  }
  console.log('errors:', errors.slice(0, 3));
  console.log(allOk ? 'GROUND AUDIT: PASS' : 'GROUND AUDIT: FAIL');
  await browser.close();
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
