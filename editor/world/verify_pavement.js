// verify_pavement.js — does the player SEE the decoded BSP floor where one
// exists, instead of terrain drawn over it?
//
// The bug: the stale-rectangle correction (js/heightfix.js) read the gap
// between the .unr heightmap and geodata at a town square as a stale
// heightmap and lifted the dirt terrain onto the geodata height — which at
// a square is the STONE SLAB's walking layer, ~32 L2u above the slab top.
// Measured at the Giran square (22_22, L2 82000/148000): heightmap -3600.8,
// Giran_floor03/04 top -3496.0, geodata -3464. The plaza rendered as dirt.
//
// Before/after come from the SAME build: '?bspfloor=off' keeps the BSP
// buildings and drops only the floor raster, i.e. the client exactly as it
// shipped before the fix.
//
// Checks, then photographs:
//   * the mesh vertex under a known plaza point is BELOW the slab top;
//   * heightAtWorld there lands ON the slab (within one CELL_HEIGHT), not
//     the geodata offset above it;
//   * a WILDERNESS tile with no BSP is bit-identical before and after —
//     this must not touch terrain that is terrain.
//
// Usage:  node verify_pavement.js [tile ...]     (default 22_22 25_18 16_21)
// Output: verify_shots/pave_<tile>_<label>_{before,after}.png + PASS/FAIL.

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 300000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// camera stations: [l2x, l2y, l2z, yawDeg, pitch, dist, label]
const SPOTS = {
  // Giran. The plaza slab (Giran_floor03/04) tops out at -3496.
  '22_22': [
    [82000, 148000, -3496, 45, 0.16, 24, 'plaza'],
    [82000, 148000, -3496, 0, 0.75, 90, 'plaza_high'],
    // centroid of the tile's 1 633-grid-point buried cluster (floor -3432)
    [84480, 147840, -3432, 200, 0.85, 100, 'east'],
  ],
  // the second-worst tile: 3 988 buried grid points, and the biggest single
  // cluster drops 10 m when the fix lands — worth eyeballing
  '25_18': [
    [171264, 9344, -2756, 45, 0.15, 26, 'court'],
    [171264, 9344, -2756, 0, 0.80, 110, 'court_high'],
  ],
  // the tile the owner's dirt screenshot was taken on (the town whose
  // cathedral floor the terrain was swallowing)
  '20_22': [
    [22656, 156544, -3030, 45, 0.16, 26, 'town'],
    [22656, 156544, -3030, 0, 0.85, 110, 'town_high'],
  ],
  // open ground, no bsp.gltf at all: the control
  '16_21': [
    [-95000, 120000, -3000, 45, 0.15, 30, 'wilderness'],
    [-95000, 120000, -3000, 0, 0.80, 120, 'wilderness_high'],
  ],
};

// (tile, L2 x, y): points that must end up standing on a BSP floor
const PROBES = {
  '22_22': [[82000, 148000], [82048, 147968], [84480, 147840]],
  '25_18': [[171264, 9344]],
  // centroid of 20_22's biggest buried cluster (floor -3030, raw -3112,
  // lifted to -3015 by the old correction)
  '20_22': [[22656, 156544]],
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
  const file = `pave_${tile}_${label}_${suffix}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  return file;
}

// the numbers behind the picture, read out of the live client
async function probe(page, tile) {
  return page.evaluate((pts) => {
    const t = window.__world.terrain;
    const out = { hasFloor: !!(t.bspFloor && t.bspFloor.coveredCells()),
                  bspCells: t.geoBspCells ?? null,
                  fixed: t.geoFixedCells ?? null, rows: [] };
    // FNV-1a over the corrected heightmap: a wilderness tile must hash the
    // same before and after
    let hsh = 0x811c9dc5;
    for (let i = 0; i < t.heights.length; i++) {
      hsh ^= t.heights[i] & 0xff; hsh = Math.imul(hsh, 0x01000193);
      hsh ^= t.heights[i] >> 8;   hsh = Math.imul(hsh, 0x01000193);
    }
    out.hash = (hsh >>> 0).toString(16);
    for (const [lx, ly] of pts || []) {
      const gx = Math.round((lx - t.origin[0]) / t.spacing);
      const gy = Math.round((ly - t.origin[1]) / t.spacing);
      const mesh = t.origin[2]
        + (t.heights[gy * t.gridSize + gx] - 32768) * t.heightScale;
      const walk = t.heightAtWorld(lx * 0.01, -ly * 0.01) * 100;
      const geo = t.geodata ? t.geodata.heightAt(lx, ly, mesh) : null;
      out.rows.push({ lx, ly, mesh, walk, geo });
    }
    return out;
  }, PROBES[tile] || []);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tiles = process.argv.slice(2).length ? process.argv.slice(2)
    : ['22_22', '25_18', '16_21'];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader',
           '--window-size=1280,900'],
  });
  const shots = [];
  const before = {};
  try {
    // one page per tile: reusing a page across scene switches hangs the
    // software-GL renderer (documented in verify_bsp.js)
    for (const tile of tiles) {
      if (!SPOTS[tile]) continue;
      const page = await openClient(browser, '?bspfloor=off');
      await selectTile(page, tile);
      const p = await probe(page, tile);
      if (p.hasFloor) fail(`${tile}: ?bspfloor=off still loaded the raster`);
      before[tile] = p;
      for (const spot of SPOTS[tile]) {
        shots.push(await shoot(page, tile, spot, 'before'));
      }
      await page.close();
    }

    for (const tile of tiles) {
      if (!SPOTS[tile]) continue;
      const page = await openClient(browser, '');
      await selectTile(page, tile);
      const p = await probe(page, tile);
      const b = before[tile];
      // slab-top reference straight from the raster the client loaded
      const floors = await page.evaluate((pts) => {
        const t = window.__world.terrain;
        // every converted tile ships a raster; a countryside tile's is all
        // zeroes, and that is the control case
        if (!t.bspFloor || !t.bspFloor.coveredCells()) return null;
        return (pts || []).map(([lx, ly]) => {
          const gx = Math.round((lx - t.origin[0]) / t.spacing);
          const gy = Math.round((ly - t.origin[1]) / t.spacing);
          const layers = t.bspFloor.layersAt(gx, gy);
          return {
            z: t.bspFloor.nearestAtWorld(
              lx, ly, t.heightAtWorld(lx * 0.01, -ly * 0.01) * 100, 1e9),
            // The walk assertion only applies where the slab IS walkable
            // ground: several BSP floors over one grid point is a
            // multi-storey building (no z-less "the ground"), and a slab
            // with no geodata layer within GEO_ANCHOR_MAX is not a walking
            // surface at all (a roof, a ledge). Both leave the mesh
            // assertion — the rendering one — untouched.
            single: layers.length === 1 && (() => {
              const b = t.bspFloor.nearestAtWorld(lx, ly,
                t.heightAtWorld(lx * 0.01, -ly * 0.01) * 100, 1e9);
              const g = t.geodata ? t.geodata.heightAt(lx, ly, b) : null;
              return g != null && Math.abs(g - b) <= 64;
            })(),
          };
        });
      }, PROBES[tile] || []);

      if (floors) {
        pass(`${tile}: bspfloor.bin loaded, ${p.bspCells} grid points`
          + ` classified BSP-floored`);
        p.rows.forEach((r, i) => {
          const slab = floors[i].z;
          const bm = b.rows[i].mesh;
          if (slab == null) return;
          if (r.mesh < slab) {
            pass(`${tile} (${r.lx},${r.ly}): mesh ${r.mesh.toFixed(1)} is`
              + ` under the BSP floor ${slab} (was ${bm.toFixed(1)},`
              + ` ${(bm - slab).toFixed(1)} OVER it)`);
          } else {
            fail(`${tile} (${r.lx},${r.ly}): mesh ${r.mesh.toFixed(1)} still`
              + ` at/over the BSP floor ${slab}`);
          }
          // the walker must stand ON the pavement, not the geodata offset
          // above it (one CELL_HEIGHT of slack — the raster is quantised)
          if (!floors[i].single) {
            pass(`${tile} (${r.lx},${r.ly}): the BSP floor ${slab} is not`
              + ` walkable geodata ground here — heightAtWorld not asserted`);
          } else if (Math.abs(r.walk - slab) <= 8) {
            pass(`${tile} (${r.lx},${r.ly}): heightAtWorld ${r.walk.toFixed(1)}`
              + ` is on the slab ${slab} (was ${b.rows[i].walk.toFixed(1)})`);
          } else {
            fail(`${tile} (${r.lx},${r.ly}): heightAtWorld ${r.walk.toFixed(1)}`
              + ` is ${(r.walk - slab).toFixed(1)} off the slab ${slab}`);
          }
        });
      } else {
        // control tile: no BSP floors -> the corrected heightmap must be
        // bit-identical to the pre-fix build
        if (p.hash === b.hash) {
          pass(`${tile}: no BSP floor over any grid point, corrected`
            + ` heightmap unchanged`
            + ` (hash ${p.hash}, ${p.fixed} cells corrected either way)`);
        } else {
          fail(`${tile}: no BSP floors but the heightmap changed`
            + ` (${b.hash} -> ${p.hash})`);
        }
      }
      for (const spot of SPOTS[tile]) {
        shots.push(await shoot(page, tile, spot, 'after'));
      }
      await page.close();
    }
  } catch (err) {
    fail('harness: ' + err.message);
  } finally {
    await browser.close();
  }

  for (const [tag, msg] of results) console.log(`${tag}: ${msg}`);
  console.log(`shots: ${shots.length} in ${OUT}`);
  const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `verify_pavement: FAIL (${bad})` : 'verify_pavement: PASS');
  process.exit(bad ? 1 : 0);
})();
