// verify_feet.js — does the character stand ON the ground that is drawn?
//
// The client stacks four different surfaces on top of each other and only
// one of them is what the player sees. This script measures all four at the
// same world points and reports the signed distance between the character's
// FEET and the terrain the renderer actually draws:
//
//   1. heightmapZ  — the G16 terrain surface decoded from T_<tile>.utx
//                    (scene.json origin[2] + (h-32768)*heightScale), read
//                    straight from /scenes/<tile>/heightmap.u16 so the
//                    client's in-memory stale-rectangle correction cannot
//                    contaminate it;
//   2. meshZ       — the Y the terrain BufferGeometry is actually built at
//                    (heightmapZ plus that correction). This is the ground
//                    the player looks at;
//   3. geodataZ    — the L2OFF walkable surface (geodata.bin), 8-unit
//                    quantised, and what the SERVER reports as the
//                    character's z (verified: 996 live aCis positions sit
//                    on it exactly, median delta 0);
//   4. routerZ     — what Terrain.heightAtWorld / the neighbour-aware
//                    router in main.js answers, i.e. where the client puts
//                    the character group's origin.
//
// and separately the model's own foot anchor:
//
//   footAnchor = (lowest SKINNED vertex, world space, in the pose that is
//                 rendered right now) - character.group.position.y
//
// computed with SkinnedMesh.getVertexPosition() so it reflects the posed
// skeleton, not the cached bind-pose Box3 that Character.load() measured.
// A model rebuild that moved the feet shows up here and nowhere else.
//
// The float the player sees is  footAnchor + routerZ - meshZ.  A constant
// offset, a scale error and a per-slope error have different signatures:
// the report prints the distribution plus a least-squares fit against the
// raw height value, so a proportional error would show as a non-zero slope.
//
// Usage:
//   node verify_feet.js [--check] [--shots] [--fix] [tile ...]
//     --check  exit 1 when |median float| exceeds TOL_L2 on any tile
//     --shots  write verify_shots/feet_<tile>_{before,after}.png
//     --fix    also measure the proposed router rule (geodata selects the
//              LEVEL, the heightfield supplies the ground Z — see the
//              report) applied in-page, so before/after are one run
// Default tiles: a flat/slope/town/coast spread.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?dev=1';
const OUT = path.join(__dirname, 'verify_shots');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const SHOTS = args.includes('--shots');
const FIX = args.includes('--fix') || SHOTS;
const TILES = args.filter(a => !a.startsWith('--'));
const AUDIT = TILES.length ? TILES
  : ['16_21', '16_24', '17_25', '19_22', '17_22', '22_22'];

// Tolerance: one geodata height quantum (GeoStructure.CELL_HEIGHT = 8 L2
// units). Anything at or under that is inside the source data's own
// resolution; anything over it is a real disagreement between the surface
// the character stands on and the surface that is drawn.
const TOL_L2 = 8;
const SAMPLES = 20;            // SAMPLES^2 points per tile
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stat = (a) => {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  const q = p => s[Math.min(n - 1, Math.floor(p * n))];
  return {
    n, mean: +(a.reduce((x, y) => x + y, 0) / n).toFixed(2), med: +q(0.5).toFixed(2),
    p05: +q(0.05).toFixed(2), p25: +q(0.25).toFixed(2),
    p75: +q(0.75).toFixed(2), p95: +q(0.95).toFixed(2),
    min: +s[0].toFixed(2), max: +s[n - 1].toFixed(2),
  };
};
// least-squares slope of y against x (a proportional error shows up here)
const slope = (xs, ys) => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxx ? sxy / sxx : 0;
};

// Stage the character at the tile centre and frame it from near ground
// level — a gap between the soles and the terrain is only readable with the
// camera low and side-on. Uses whatever heightAtWorld is installed, so the
// same call serves the before and the after shot.
async function shoot(page, tile, phase) {
  await page.evaluate(() => {
    const w = window.__world, t = w.terrain;
    const c = t.center();
    c.y = t.heightAtWorld(c.x, c.z, c.y);
    w.character.group.position.copy(c);
    w.character.clearTarget();
    // FROZEN camera, anchored to the TERRAIN (not to the character): the
    // before and after shots must share one viewpoint or the follow cam
    // hides the very displacement being measured. Aimed at ankle height,
    // side-on and slightly above, so the sole and the ground it should
    // touch are both mid-frame.
    const H = w.followCam.charH;
    const ground = t._sampleBilinear(
      (c.x * 100 - t.origin[0]) / t.spacing, (-c.z * 100 - t.origin[1]) / t.spacing);
    w.followCam.update = () => {};
    w.camera.position.set(c.x + 2.6 * H, ground + 1.35 * H, c.z + 1.0 * H);
    w.camera.lookAt(c.x, ground + 0.55 * H, c.z);
  });
  await sleep(900);
  const f = path.join(OUT, `feet_${tile}_${phase}.png`);
  await page.screenshot({ path: f });
  console.log(`   shot ${f}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,800'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 120000 });
  await sleep(1500);

  // --- the model's own foot anchor (measured on the POSED skeleton) ------
  const anchor = await page.evaluate(() => {
    const w = window.__world, ch = w.character;
    ch.group.updateMatrixWorld(true);
    const meshes = [];
    ch.model.traverse(o => { if (o.isMesh) meshes.push(o); });
    const v = ch.group.position.clone();
    let lo = Infinity, hi = -Infinity, verts = 0;
    for (const m of meshes) {
      const n = m.geometry.attributes.position.count;
      verts += n;
      for (let i = 0; i < n; i++) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        if (v.y < lo) lo = v.y;
        if (v.y > hi) hi = v.y;
      }
    }
    return {
      model: w.selfModelId, clip: ch.current && ch.current.getClip().name,
      verts, groupY: ch.group.position.y,
      footAnchorL2: (lo - ch.group.position.y) * 100,
      posedHeightL2: (hi - lo) * 100,
      loadHeightL2: (ch.heightM || 0) * 100,
    };
  });
  console.log('model foot anchor (posed skeleton vs group origin)');
  console.log(`  ${anchor.model} clip=${anchor.clip} verts=${anchor.verts}`);
  console.log(`  footAnchor = ${anchor.footAnchorL2.toFixed(2)} L2u   `
    + `posed height = ${anchor.posedHeightL2.toFixed(2)} L2u   `
    + `Character.load() height = ${anchor.loadHeightL2.toFixed(2)} L2u`);

  const report = {};
  let worst = 0, worstTile = null;
  for (const tile of AUDIT) {
    await page.select('#scene-picker', tile);
    await page.waitForFunction(
      t => window.__world.terrain && window.__world.terrain.def
        && window.__world.terrain.def.tile === t
        && (window.__world.terrain.interior || window.__world.terrain.mesh),
      { timeout: 300000 }, tile);
    await sleep(1200);
    const interior = await page.evaluate(() => !!window.__world.terrain.interior);
    if (interior) { console.log(`SKIP ${tile} (interior: no terrain mesh by design)`); continue; }

    const res = await page.evaluate(async (tile, N, footAnchorL2) => {
      const w = window.__world, t = w.terrain, g = t.gridSize;
      const or = t.origin, hs = t.heightScale, sp = t.spacing;
      // raw (uncorrected) heightmap straight off the wire
      const raw = new Uint16Array(
        await (await fetch(`/scenes/${tile}/heightmap.u16`)).arrayBuffer());
      const bil = (a, fx, fy) => {
        const cx = Math.min(Math.max(fx, 0), g - 1.001), cy = Math.min(Math.max(fy, 0), g - 1.001);
        const x0 = Math.floor(cx), y0 = Math.floor(cy), tx = cx - x0, ty = cy - y0;
        const h = (i, j) => a[Math.min(j, g - 1) * g + Math.min(i, g - 1)];
        return (h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx) * (1 - ty)
             + (h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx) * ty;
      };
      // rendered terrain mesh Y, bilinear over the built geometry
      const pos = t.mesh.geometry.attributes.position;
      const sx = pos.getX(0), sz = pos.getZ(0);
      const stepX = pos.getX(1) - sx, rowZ = pos.getZ(g) - sz;
      const meshY = (tx, tz) => {
        const gx = (tx - sx) / stepX, gz = (tz - sz) / rowZ;
        const x0 = Math.floor(gx), z0 = Math.floor(gz);
        if (x0 < 0 || z0 < 0 || x0 >= g - 1 || z0 >= g - 1) return null;
        const fx = gx - x0, fz = gz - z0, y = (i, j) => pos.getY(j * g + i);
        return y(x0, z0) * (1 - fx) * (1 - fz) + y(x0 + 1, z0) * fx * (1 - fz)
             + y(x0, z0 + 1) * (1 - fx) * fz + y(x0 + 1, z0 + 1) * fx * fz;
      };
      const rows = [];
      for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= N; j++) {
          const fx = i / (N + 1) * g, fy = j / (N + 1) * g;
          const wx = or[0] + fx * sp, wy = or[1] + fy * sp;
          const tx = wx / 100, tz = -wy / 100;
          const hRaw = bil(raw, fx, fy);
          const hmZ = or[2] + (hRaw - 32768) * hs;
          const my = meshY(tx, tz);
          if (my == null) continue;
          const meshZ = my * 100;
          const layers = t.geodata ? t.geodata._layersAt(wx, wy) : null;
          const geoZ = t.geodata ? t.geodata.heightAt(wx, wy, hmZ) : null;
          // the real router, with the walker's own z hint = the mesh it stands on
          const routerZ = w.heightAt(tx, tz, meshZ / 100) * 100;
          rows.push({
            wx, wy, hRaw, hmZ, meshZ, geoZ, routerZ,
            nl: layers ? layers.length : 0,
            floatL2: routerZ + footAnchorL2 - meshZ,
          });
        }
      }
      return { rows, geoFixed: t.geoFixedCells, geoDeferred: t.geoDeferredCells };
    }, tile, SAMPLES, anchor.footAnchorL2);

    const R = res.rows;
    const fl = R.map(r => r.floatL2);
    const s = stat(fl);
    const sl = slope(R.map(r => r.hRaw - 32768), fl);
    report[tile] = {
      float: s,
      slopeVsHeight: +sl.toFixed(6),
      geoMinusHeightmap: stat(R.map(r => r.geoZ - r.hmZ)),
      meshMinusHeightmap: stat(R.map(r => r.meshZ - r.hmZ)),
      routerMinusGeo: stat(R.map(r => r.routerZ - r.geoZ)),
      multilayer: R.filter(r => r.nl > 1).length,
      geoFixed: res.geoFixed, geoDeferred: res.geoDeferred,
    };
    if (Math.abs(s.med) > worst) { worst = Math.abs(s.med); worstTile = tile; }
    console.log(`\n== ${tile}  n=${s.n}  (mesh cells rewritten by the geodata `
      + `correction: ${res.geoFixed}, deferred ${res.geoDeferred})`);
    console.log(`   FLOAT feet-above-drawn-ground (L2u): ${JSON.stringify(s)}`);
    console.log(`     = ${(s.med / anchor.posedHeightL2).toFixed(2)} character heights (median)`);
    console.log(`   slope of float vs (h-32768): ${sl.toExponential(2)} `
      + `-> implied heightScale error ${(sl).toExponential(2)} of ${0.296875}`);
    console.log(`   geodataZ - heightmapZ: ${JSON.stringify(report[tile].geoMinusHeightmap)}`);
    console.log(`   meshZ    - heightmapZ: ${JSON.stringify(report[tile].meshMinusHeightmap)}`);
    console.log(`   routerZ  - geodataZ  : ${JSON.stringify(report[tile].routerMinusGeo)}`);

    // BEFORE shot: the live router, untouched (the patch below replaces it)
    if (SHOTS) await shoot(page, tile, 'before');

    if (FIX) {
      const after = await page.evaluate((tile, N, footAnchorL2) => {
        const w = window.__world, t = w.terrain, g = t.gridSize;
        const or = t.origin, sp = t.spacing;
        // PROPOSED RULE, applied in-page so before/after come from one run.
        // This is exactly the terrain.js edit specified in the report, and
        // it calls the SHIPPED Geodata.anchoredHeightAt (js/geodata.js), so
        // the numbers below verify the real implementation, not a copy.
        const MAX_STEP_UP_L2 = 48;                  // as in terrain.js
        const ANCHOR_MAX_L2 = 64;                   // Geodata GEO_ANCHOR_MAX
        const orig = t.heightAtWorld.bind(t);
        t.heightAtWorld = (x, z, currentZ = null) => {
          if (t.interior || !t.geodata) return orig(x, z, currentZ);
          const fx = (x * 100 - or[0]) / sp, fy = (-z * 100 - or[1]) / sp;
          const terrainY = t._sampleBilinear(fx, fy);
          const h = t.geodata.anchoredHeightAt(
            x * 100, -z * 100,
            currentZ == null ? null : currentZ * 100,
            currentZ == null ? null : MAX_STEP_UP_L2,
            terrainY * 100, ANCHOR_MAX_L2);
          return h == null ? terrainY : h / 100;
        };
        const pos = t.mesh.geometry.attributes.position;
        const sx = pos.getX(0), sz = pos.getZ(0);
        const stepX = pos.getX(1) - sx, rowZ = pos.getZ(g) - sz;
        const meshY = (tx, tz) => {
          const gx = (tx - sx) / stepX, gz = (tz - sz) / rowZ;
          const x0 = Math.floor(gx), z0 = Math.floor(gz);
          if (x0 < 0 || z0 < 0 || x0 >= g - 1 || z0 >= g - 1) return null;
          const fx = gx - x0, fz = gz - z0, y = (i, j) => pos.getY(j * g + i);
          return y(x0, z0) * (1 - fx) * (1 - fz) + y(x0 + 1, z0) * fx * (1 - fz)
               + y(x0, z0 + 1) * (1 - fx) * fz + y(x0 + 1, z0 + 1) * fx * fz;
        };
        const out = [], gaps = [];
        for (let i = 1; i <= N; i++) {
          for (let j = 1; j <= N; j++) {
            const fx = i / (N + 1) * g, fy = j / (N + 1) * g;
            const wx = or[0] + fx * sp, wy = or[1] + fy * sp;
            const tx = wx / 100, tz = -wy / 100;
            const my = meshY(tx, tz);
            if (my == null) continue;
            out.push(t.heightAtWorld(tx, tz, my) * 100 + footAnchorL2 - my * 100);
            // |nearest geodata layer - drawn terrain|: the quantity
            // ANCHOR_MAX_L2 has to cover, measured rather than assumed
            const layers = t.geodata._layersAt(wx, wy);
            let best = Infinity;
            for (const l of layers || []) best = Math.min(best, Math.abs(l.height - my * 100));
            if (best < Infinity) gaps.push(best);
          }
        }
        return { out, gaps, anchorMax: ANCHOR_MAX_L2 };
      }, tile, SAMPLES, anchor.footAnchorL2);
      report[tile].floatAfterFix = stat(after.out);
      report[tile].anchorGap = stat(after.gaps);
      report[tile].anchorFallbackPct = +(100 * after.gaps.filter(
        v => v > after.anchorMax).length / after.gaps.length).toFixed(1);
      console.log(`   AFTER proposed rule (L2u): ${JSON.stringify(stat(after.out))}`);
      console.log(`   |nearest geodata layer - drawn terrain| (sizes ANCHOR_MAX): `
        + `${JSON.stringify(stat(after.gaps))}  `
        + `-> ${report[tile].anchorFallbackPct}% of points fall back `
        + `(gap > ${after.anchorMax})`);
    }

    // AFTER shot: same viewpoint, with the patched router in place
    if (SHOTS) await shoot(page, tile, 'after');
  }

  console.log('\n--- summary -------------------------------------------------');
  for (const [t, r] of Object.entries(report)) {
    const a = r.floatAfterFix ? ` -> after fix med ${r.floatAfterFix.med}` : '';
    console.log(`  ${t}: median float ${r.float.med} L2u `
      + `(IQR ${r.float.p25}..${r.float.p75})${a}`);
  }
  fs.writeFileSync(path.join(OUT, 'feet_report.json'),
    JSON.stringify({ anchor, tolerance: TOL_L2, report }, null, 1));
  if (errors.length) console.log('page errors:', errors.slice(0, 5));

  await browser.close();
  if (CHECK) {
    const bad = Object.entries(report).filter(([, r]) => Math.abs(r.float.med) > TOL_L2);
    if (bad.length) {
      console.log(`\nFAIL: ${bad.length} tile(s) over the ${TOL_L2} L2u tolerance `
        + `(worst ${worstTile} ${worst.toFixed(2)})`);
      process.exit(1);
    }
    console.log(`\nPASS: every tile within ${TOL_L2} L2u`);
  }
})();
