// Geodata verification: decode sanity (cross-checked against the python
// reference decode + tools/world/geodata.py --check), the Aden 24_18
// bridge (upper vs lower floor while WALKING), interior floor
// preservation, outdoor regression, decode perf.
// Output: verify_shots/geo_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cross-check anchors (python reference decode, int16(w&0xFFF0)>>1 with
// sign-extension — see tools/world/README.md blockstream-v1):
// 24_18 cell (153280, 14112): raw words -2497/-8001 -> layers [-1256, -4008]
// 19_16 cell (-23771, -39531): layers [-4672, -10904]
const BRIDGE = { l2x: 153280, l2y: 14112, upper: -1256, lower: -4008 };
const ALTAR = { l2x: -23771, l2y: -39531, plane: -4672, floor: -10904 };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,   // HD texture sets can block the page for minutes
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });

    // -- (a) decode sanity on 24_18 + 19_16 ----------------------------------
    const loadTile = async (tile) => {
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 240000 }, tile);
      await sleep(1200);
    };

    await loadTile('24_18');
    summary.decode = await page.evaluate(({ l2x, l2y, upper, lower }) => {
      const g = window.__world.terrain.geodata;
      if (!g) return { present: false };
      return {
        present: true,
        nearestUpper: g.heightAt(l2x, l2y, upper),   // expect upper (-1256)
        nearestLower: g.heightAt(l2x, l2y, lower),   // expect lower (-4008)
        nearestZero: g.heightAt(l2x, l2y, 0),        // expect upper (-1256)
        zless: g.heightAt(l2x, l2y),                 // lowest layer (-4008)
      };
    }, BRIDGE);

    await loadTile('19_16');
    summary.decodeAltar = await page.evaluate(({ l2x, l2y, plane, floor }) => {
      const g = window.__world.terrain.geodata;
      if (!g) return { present: false };
      return {
        present: true,
        nearestPlane: g.heightAt(l2x, l2y, plane),   // expect plane (-4672)
        nearestFloor: g.heightAt(l2x, l2y, floor),   // expect floor (-10904)
      };
    }, ALTAR);

    // -- (b) WALK on the Aden bridge, upper then lower -------------------------
    await loadTile('24_18');
    const bx = BRIDGE.l2x * 0.01, bz = -BRIDGE.l2y * 0.01;

    // walk from (x0,z0) to (x1,z1) at a given start height — moving
    // re-clamps y every frame with the CURRENT z (the multi-layer rule)
    const walkLine = async (p0, p1, startY) => {
      await page.evaluate(({ x, y, z }) => {
        const w = window.__world;
        w.character.group.position.set(x, y, z);
        w.character.clearTarget();
      }, { x: p0.x, y: startY, z: p0.z });
      await sleep(300);
      await page.evaluate(({ x, y, z }) => {
        const w = window.__world;
        w.walkTo(new (w.character.group.position.constructor)(x, y, z));
      }, { x: p1.x, y: startY, z: p1.z });
      await page.waitForFunction('window.__world.character.speed > 0', { timeout: 30000 });
      await page.waitForFunction('window.__world.character.speed === 0', { timeout: 60000 });
      await sleep(300);
      return page.evaluate(() => +window.__world.character.group.position.y.toFixed(2));
    };

    // The "bridge" cell maps to a diagonal elevated walkway (cells probed:
    // (1386-1392, 880-884) all carry [-1256, -4008] with ground -4032 past
    // the edge). Walk the deck along the diagonal, then the same line below.
    const cell = (cx, cy) => ({ x: (131072 + cx * 16 + 8) * 0.01, z: -(cy * 16 + 8) * 0.01 });
    const d0 = cell(1388, 882), d1 = cell(1390, 883);
    summary.deckWalkY = await walkLine(d0, d1, BRIDGE.upper * 0.01);
    await page.evaluate(() => {
      const w = window.__world;
      w.followCam.yaw += 1.2; w.followCam.pitch = 0.22; w.followCam.dist = Math.max(w.followCam.minDist, 7);
    });
    await sleep(1000);
    await page.screenshot({ path: path.join(OUT, 'geo_01_bridge_upper.png') });

    summary.underWalkY = await walkLine(cell(1386, 880), d1, BRIDGE.lower * 0.01);
    await page.screenshot({ path: path.join(OUT, 'geo_02_bridge_lower.png') });

    // -- (c) interior floors preserved -----------------------------------------
    for (const tile of ['19_16', '21_25']) {
      await loadTile(tile);
      const s = await page.evaluate(() => ({
        interior: window.__world.terrain.interior,
        floorY: +window.__world.terrain.floorY.toFixed(2),
        charY: +window.__world.character.group.position.y.toFixed(2),
        geodata: !!window.__world.terrain.geodata,
      }));
      summary['interior_' + tile] = s;
      await page.screenshot({ path: path.join(OUT, `geo_03_${tile}.png`) });
    }

    // -- (c2) 17_25 outdoor regression ------------------------------------------
    await loadTile('17_25');
    summary.outdoor_17_25 = await page.evaluate(() => {
      const w = window.__world;
      const c = w.character.group.position;
      return {
        geodata: !!w.terrain.geodata,
        charY: +c.y.toFixed(2),
        onGround: Math.abs(c.y - w.terrain.heightAtWorld(c.x, c.z, c.y)) < 0.01,
      };
    });

    // -- (d) perf --------------------------------------------------------------
    await loadTile('24_18');
    summary.perf = await page.evaluate(() => {
      const g = window.__world.terrain.geodata;
      if (!g) return null;
      g.offsets = null; g.blockCache.clear();
      let t0 = performance.now();
      g._index();
      const indexMs = performance.now() - t0;
      t0 = performance.now();
      for (let i = 0; i < 10000; i++) {
        g.heightAt(131072 + (i % 2048) * 16, (i % 2048) * 16, 0);
      }
      const queryMs = (performance.now() - t0) / 10000;
      return { indexMs: +indexMs.toFixed(2), queryMs: +queryMs.toFixed(4), ...g.stats() };
    });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY GEODATA FAILED:', e.message); process.exit(1); });
