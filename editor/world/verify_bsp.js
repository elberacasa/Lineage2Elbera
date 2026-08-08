// verify_bsp.js — the decoded BSP buildings, in the real client.
//
// WHY a dedicated suite: the BSP is the first geometry the client draws
// that is NOT placed by an actor transform — it comes out of the level
// model already in world space. The failure that would be easiest to miss
// is a placement/scale bug that still looks like "some buildings", so this
// checks the numbers (chunk count, triangle count, world bounding box
// against the tile's own scene.json origin box) and only then photographs
// the town.
//
// Before/after come from the same build: '?bsp=off' makes bsp.js skip the
// load, which is exactly the pre-decode client.
//
// Usage:  node verify_bsp.js [tile ...]        (default 22_22 17_25)
// Output: verify_shots/bsp_<tile>_<label>_{before,after}.png + PASS/FAIL.

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 300000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// camera stations per tile: [l2x, l2y, l2z, yawDeg, pitch, dist, label]
// The interior spots are BSP floor centroids read straight out of bsp.gltf
// (largest horizontal triangle per interior_* material), i.e. the middle of
// a room that only exists because the BSP was decoded.
const SPOTS = {
  '22_22': [
    [82500, 148500, -3450, 45, 0.18, 30, 'plaza'],
    [80500, 147000, -3400, 300, 0.10, 18, 'clanhall'],
    [82000, 148000, -3400, 0, 1.20, 140, 'aerial'],
    [79715, 150530, -3547, 45, 0.05, 2.5, 'interior_A_floor03'],
    [85637, 148275, -3429, 110, 0.05, 3.0, 'interior_A_ch02'],
  ],
  '17_25': [
    [-71200, 258000, -2900, 45, 0.15, 26, 'village'],
    [-83000, 244600, -3700, 0, 1.10, 120, 'aerial'],
  ],
  // interior (dungeon) tile: the whole Elven Ruins IS BSP, so this is the
  // interior-mode path — terrain.js loads bsp.gltf for interiors too
  '21_25': [
    [45537, 246183, -6300, 30, 0.10, 20, 'ruins'],
    [45537, 246183, -6300, 0, 1.10, 90, 'aerial'],
  ],
};

const results = [];
const fail = (msg) => { results.push(['FAIL', msg]); };
const pass = (msg) => { results.push(['ok', msg]); };

async function openClient(browser, query) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => fail('pageerror: ' + e.message));
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded',
                                  timeout: LOAD_TIMEOUT });
  await page.waitForFunction('window.__world && window.__world.ready',
                             { timeout: LOAD_TIMEOUT });
  return page;
}

async function selectTile(page, tile) {
  await page.select('#scene-picker', tile);
  await page.waitForFunction(
    (t) => document.getElementById('status').textContent.includes('scene: ' + t)
      && document.getElementById('loading').classList.contains('hidden'),
    { timeout: LOAD_TIMEOUT }, tile);
  await sleep(3000);
}

async function shoot(page, tile, spot, suffix) {
  const [lx, ly, lz, yaw, pitch, dist, label] = spot;
  await page.evaluate(({ lx, ly, lz, yaw, pitch, dist }) => {
    const w = window.__world;
    w.character.group.position.set(lx * 0.01, lz * 0.01, -ly * 0.01);
    w.character.clearTarget();
    w.followCam.pitch = pitch;
    w.followCam.dist = dist;
    w.followCam.yaw = yaw * Math.PI / 180;
  }, { lx, ly, lz, yaw, pitch, dist });
  await sleep(1400);
  const file = `bsp_${tile}_${label}_${suffix}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  return file;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tiles = process.argv.slice(2).length ? process.argv.slice(2)
    : ['22_22', '17_25'];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader',
           '--window-size=1280,900'],
  });
  const shots = [];
  try {
    // ---- before: same build, BSP loading disabled -----------------------
    // ONE PAGE PER TILE, deliberately. This used to reuse a single page and
    // switch scenes in it, which hangs the software-GL renderer on the SECOND
    // switch — reproduced with a minimal script and A/B'd against the terrain
    // from git, where it hangs identically, so it is the harness and not the
    // code under test. A single switch (default tile -> target) is proven fine,
    // which is exactly what one page per tile costs. No assertion is dropped:
    // every tile still gets its own ?bsp=off check, BSP check and screenshots.
    for (const tile of tiles) {
      if (!SPOTS[tile]) continue;
      const before = await openClient(browser, '?bsp=off');
      await selectTile(before, tile);
      const off = await before.evaluate(() => !!window.__world.terrain.bsp);
      if (off) fail(`${tile}: ?bsp=off still loaded a BSP`);
      else pass(`${tile}: ?bsp=off renders the pre-decode client`);
      for (const spot of SPOTS[tile]) {
        shots.push(await shoot(before, tile, spot, 'before'));
      }
      await before.close();
    }

    // ---- after ----------------------------------------------------------
    for (const tile of tiles) {
      if (!SPOTS[tile]) continue;
      const page = await openClient(browser, '');
      await selectTile(page, tile);
      const info = await page.evaluate(() => {
        const t = window.__world.terrain;
        if (!t.bsp) return null;
        const b = t.bsp.boundsL2;   // raw L2 world units, no transform
        return {
          chunks: t.bsp.chunks.length,
          triangles: t.bsp.triangles,
          min: [b.min.x, b.min.y, b.min.z],
          max: [b.max.x, b.max.y, b.max.z],
          origin: t.origin,
          span: t.gridSize * t.spacing,
        };
      });
      if (!info) {
        fail(`${tile}: no BSP loaded (bsp.gltf missing or unparsable)`);
        await page.close();   // one page per tile now: do not leak it
        continue;
      }
      pass(`${tile}: ${info.chunks} chunks, ${info.triangles} triangles`);
      if (info.triangles < 500) fail(`${tile}: only ${info.triangles} triangles`);
      // placement: everything must sit in the tile it belongs to (one tile
      // of slack for brushes that legitimately straddle the seam)
      const [ox, oy] = info.origin;
      const s = info.span;
      const inside = info.min[0] >= ox - s && info.max[0] <= ox + 2 * s
        && info.min[1] >= oy - s && info.max[1] <= oy + 2 * s;
      if (inside) {
        pass(`${tile}: BSP bbox L2 x[${info.min[0].toFixed(0)},`
          + `${info.max[0].toFixed(0)}] y[${info.min[1].toFixed(0)},`
          + `${info.max[1].toFixed(0)}] z[${info.min[2].toFixed(0)},`
          + `${info.max[2].toFixed(0)}] is inside the tile`);
      } else {
        fail(`${tile}: BSP bbox ${JSON.stringify(info.min)}..`
          + `${JSON.stringify(info.max)} escapes the tile at `
          + `${JSON.stringify(info.origin)} (+${s})`);
      }
      // scale sanity: a town building is metres tall, not kilometres
      const height = info.max[2] - info.min[2];
      if (height > 20 && height < 20000) {
        pass(`${tile}: BSP spans ${(height / 100).toFixed(1)} m vertically`);
      } else {
        fail(`${tile}: BSP vertical span ${height} L2u is not a building scale`);
      }
      for (const spot of SPOTS[tile]) {
        shots.push(await shoot(page, tile, spot, 'after'));
      }
      // ...and the BSP on its own. Static meshes are the DECORATION bolted
      // onto these shells, so with props on, most of the BSP is behind
      // them; hiding props + terrain is the only view that photographs
      // what was actually decoded.
      await page.evaluate(() => {
        const t = window.__world.terrain;
        t.props.forEach((o) => { o.visible = false; });
        if (t.mesh) t.mesh.visible = false;
      });
      for (const spot of SPOTS[tile]) {
        shots.push(await shoot(page, tile, spot, 'bsponly'));
      }
      // ...and a roofless cutaway: same BSP with the ceiling/roof materials
      // hidden, which is the only way to photograph that the shells are
      // HOLLOW — rooms with floors and internal walls, not solid blocks.
      await page.evaluate(() => {
        window.__world.terrain.bsp.group.traverse((o) => {
          if (o.isMesh && /top0|ceiling|_roof/i.test(o.material.name || '')) {
            o.visible = false;
          }
        });
      });
      for (const spot of SPOTS[tile].filter((s) => s[6] === 'aerial')) {
        shots.push(await shoot(page, tile, spot, 'cutaway'));
      }
      await page.evaluate(() => {
        const t = window.__world.terrain;
        t.props.forEach((o) => { o.visible = true; });
        if (t.mesh) t.mesh.visible = true;
        t.bsp.group.traverse((o) => { if (o.isMesh) o.visible = true; });
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  for (const [status, msg] of results) console.log(`  [${status}] ${msg}`);
  console.log('shots: ' + shots.join(' '));
  const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `verify_bsp: FAIL (${bad})` : 'verify_bsp: PASS');
  process.exit(bad ? 1 : 0);
})();
