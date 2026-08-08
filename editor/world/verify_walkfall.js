// verify_walkfall.js — the walker must not fall through the world.
//
// Guards the defect that made the player's screen go blue: the ground-height
// router is a FEEDBACK loop (this frame's height is next frame's query z), so
// any frame in which it disagrees with itself compounds. Before the fix in
// Geodata.anchoredHeightAt, the walking rule was applied to a z that had been
// re-anchored onto the drawn terrain while the layer heights were still on the
// geodata surface; wherever those two surfaces differ by more than MAX_STEP_UP
// the rule reported "blocked", returned z, and the anchoring then subtracted
// the difference again — once per frame. The character sank ~0.5 m per frame,
// the camera followed it under the (front-side-only) terrain, which then drew
// nothing, and the sky dome filled the viewport.
//
// Three metrics, all measured against the client's own routers — no tuned
// tolerances beyond float epsilon and the tile's own height range:
//
//   A  IDEMPOTENCE. Standing still must be a fixed point: h = router(x,z,h).
//      Iterating the router 64x at one spot must not move the answer. This is
//      the runaway in its purest form and needs no walking at all.
//   B  WALK. Straight-line walks at run speed from a grid of starts, in four
//      directions, must never put the walker BELOW the lowest drawn terrain
//      vertex of the tile it is walking on. No invented tolerance: the bound
//      is the tile's own heightmap minimum.
//   C  FOG BAND. scene.fog.near < scene.fog.far on every tile. A tile whose
//      DistanceFogEnd is small and whose DistanceFogStart is absent would
//      otherwise invert the band, which fully fogs EVERY pixel in the fog
//      colour — a second, independent way to paint the whole screen one
//      colour. (No tile does this today; the check keeps it that way.)
//
// Usage: node verify_walkfall.js [tile ...]     (default: the audit set)
// Exit 0 only if every metric passes on every tile.
//
// Needs the client on 127.0.0.1:8083. Read-only: it drives the exposed
// routers, it does not move the real character.

const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ARGS = process.argv.slice(2);
const TILES = ARGS.length ? ARGS
  // open ground, coast, town, hills and a dungeon — the shapes that differ
  : ['17_23', '17_22', '16_21', '22_22', '17_25', '20_18', '24_18', '19_16'];

const ITERS = 64;            // metric A: router applications at one spot
const IDEM_TOL_M = 1e-4;     // float noise only
const STEP_M = 1.15 / 60;    // metric B: run speed (character.js) at 60 fps
const STEPS = 2600;          // ~50 m of travel, several geodata blocks

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=640,480'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:8083/?dev=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 120000 });

  let allOk = true;
  for (const tile of TILES) {
    await page.select('#scene-picker', tile);
    await page.waitForFunction(
      t => window.__world.terrain && window.__world.terrain.def
           && window.__world.terrain.def.tile === t
           && (window.__world.terrain.interior || window.__world.terrain.mesh),
      { timeout: 300000 }, tile);
    await new Promise(r => setTimeout(r, 1200));

    const r = await page.evaluate(async (cfg) => {
      const w = window.__world, t = w.terrain;
      const S = 0.01;
      const interior = !!t.interior;
      const fog = w.scene.fog
        ? { near: w.scene.fog.near, far: w.scene.fog.far } : null;

      // Interiors have no heightmap surface to bound against (the walk level
      // is the prop-derived floor), so metric B does not apply there; A and C
      // still do.
      const def = t.def;
      const n = def.gridSize * def.spacing;                 // L2 units per edge
      const x0 = def.origin[0], y0 = def.origin[1];
      // three-space extent of THIS tile, so walks never leave it
      const tx0 = x0 * S, tx1 = (x0 + n) * S;
      const tz1 = -y0 * S, tz0 = -(y0 + n) * S;

      let meshMin = null;
      if (!interior && t.mesh) {
        t.mesh.geometry.computeBoundingBox();
        meshMin = t.mesh.geometry.boundingBox.min.y;
      }

      const N = 12;                                          // 12x12 starts
      const pts = [];
      for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= N; j++) {
          pts.push([tx0 + (tx1 - tx0) * i / (N + 1), tz0 + (tz1 - tz0) * j / (N + 1)]);
        }
      }

      // --- A: idempotence of the ground query -----------------------------
      let idemWorst = 0, idemBad = 0, idemAt = null;
      for (const [x, z] of pts) {
        let h = w.heightAt(x, z, null);                      // spawn lookup
        const h1 = w.heightAt(x, z, h);                      // first walk step
        let hk = h1;
        for (let k = 0; k < cfg.iters; k++) hk = w.heightAt(x, z, hk);
        const d = Math.abs(hk - h1);
        if (d > idemWorst) { idemWorst = d; idemAt = [+x.toFixed(1), +z.toFixed(1), +h1.toFixed(2), +hk.toFixed(2)]; }
        if (d > cfg.idemTol) idemBad++;
      }

      // --- B: straight-line walks -----------------------------------------
      let walkBad = 0, walkWorst = 0, walkAt = null, walkRuns = 0;
      if (!interior && meshMin != null) {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [sx, sz] of pts) {
          for (const [dx, dz] of dirs) {
            let x = sx, z = sz;
            let y = w.heightAt(x, z, null);
            walkRuns++;
            for (let k = 0; k < cfg.steps; k++) {
              x += dx * cfg.step; z += dz * cfg.step;
              if (x < tx0 || x > tx1 || z < tz0 || z > tz1) break;   // left the tile
              y = w.heightAt(x, z, y);
              const under = meshMin - y;                     // >0 = below the tile
              if (under > walkWorst) {
                walkWorst = under;
                walkAt = { x: +x.toFixed(1), z: +z.toFixed(1), y: +y.toFixed(2), meshMin: +meshMin.toFixed(2), step: k };
              }
              if (under > 0.5) { walkBad++; break; }
            }
          }
        }
      }

      return {
        interior, fog, meshMin: meshMin == null ? null : +meshMin.toFixed(2),
        idem: { points: pts.length, bad: idemBad, worst: +idemWorst.toFixed(4), at: idemAt },
        walk: { runs: walkRuns, bad: walkBad, worstUnder: +walkWorst.toFixed(2), at: walkAt },
      };
    }, { iters: ITERS, idemTol: IDEM_TOL_M, step: STEP_M, steps: STEPS });

    const aOk = r.idem.bad === 0;
    const bOk = r.walk.bad === 0;
    const cOk = !r.fog || r.fog.near < r.fog.far;
    const ok = aOk && bOk && cOk;
    if (!ok) allOk = false;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${tile}${r.interior ? ' (interior)' : ''}` +
      `  A idempotence ${r.idem.points - r.idem.bad}/${r.idem.points} worst ${r.idem.worst} m` +
      `  B walks ${r.walk.runs - r.walk.bad}/${r.walk.runs} worst ${r.walk.worstUnder} m below tile min` +
      `  C fog ${r.fog ? `${r.fog.near}/${r.fog.far}` : 'none'}`);
    if (!aOk) console.log(`     A worst at [x,z,h1,h${ITERS}] = ${JSON.stringify(r.idem.at)}`);
    if (!bOk) console.log(`     B first fall: ${JSON.stringify(r.walk.at)}`);
    if (!cOk) console.log(`     C fog band inverted: near ${r.fog.near} >= far ${r.fog.far}`);
  }

  if (pageErrors.length) {
    allOk = false;
    console.log(`FAIL page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
  }
  console.log(allOk ? 'verify_walkfall: PASS' : 'verify_walkfall: FAIL');
  await browser.close();
  process.exit(allOk ? 0 : 1);
})();
