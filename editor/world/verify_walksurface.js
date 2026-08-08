// verify_walksurface.js — does the surface the character STANDS ON agree with
// the surface the player SEES, and does a click land on the surface it hit?
//
// The owner's two reports were one question:
//   "now when i walk in giran i dont go up the stairs i go trough them"
//   "when clicking inside giran u dont see the new animation in floor ...
//    i think its clicking below ground?"
//
// FOUR THINGS ARE MEASURED, in this order (each is a separate gate):
//
//  A. GEODATA CELL INDEX vs the live server. The client's per-tile geodata is
//     re-encoded from the server's own *_conv.dat, so the server is the oracle
//     for every cell in it: teleport a GM fixture to (x, y, wrong z), then send
//     ValidatePosition and read the ValidateLocation the server answers with —
//     that packet carries the server's OWN x, y, z and changes no state.
//     `--server` re-runs those probes and rewrites verify_walksurface.json;
//     without it the recorded scans are replayed against the client.
//     This gate found the defect: the cell index INSIDE a geodata block is
//     X-outer/Y-inner (aCis BlockComplex.java:53, BlockMultilayer.java:113 —
//     `(geoX % BLOCK_CELLS_X) * BLOCK_CELLS_Y + (geoY % BLOCK_CELLS_Y)`), and
//     editor/world/js/geodata.js computed the TRANSPOSE, so every query inside
//     a COMPLEX or MULTILAYER block read a neighbouring cell. FLAT blocks (one
//     height for all 64 cells) are immune, which is exactly why open ground
//     always looked right and towns did not.
//
//  B. THE STAIRCASE. Walk the client's own ground query east across
//     Giran_V_Plaza_Stair01 feeding the walker's z forward the way movement
//     does, and compare it with the DRAWN surface (see the raycast note below).
//     Reports the profile and the worst |walk - drawn| on the ramp.
//
//  C. THE CLICK. Build the ray exactly as main.js's click handler does, from a
//     real camera over the Giran plaza, and check the pick lands on the
//     pavement instead of on the dirt 105 L2u under it.
//
//  D. THE COUNT. Over a grid of sample points per tile: how often, and by how
//     much, does the walk surface disagree with the drawn one, bucketed by
//     which surface the drawn hit came from (terrain mesh / BSP floor / prop).
//     Measured TWICE out of one build — with bspfloor.bin's walk raster and
//     with it dropped ('?walkraster=off') — so the before column is the client
//     as it behaved before the raster existed rather than a remembered number.
//     The last two columns are the regression guard that matters here: a roof,
//     a canopy or a wall top has no geodata layer over it, and putting props
//     into the raster must not turn one into the surface the walker stands on.
//     That would REMOVE a disagreement (and flatter every other column) while
//     being strictly worse, so it is counted separately.
//       onNW   the walker stands on a structure with no layer in the narrow
//              +24..40 band. INFORMATIONAL, because the band is narrower than
//              the rule the client applies: MEASURED on 22_22, the points this
//              column gains are 23 prop surfaces whose own geodata layer is
//              +41..+48 over them (bins 16:2 24:1 40:13 48:7, every one a
//              prop) — supported surfaces sitting a quantum past the band, not
//              roofs, and the walker standing on them is CLOSER to the geodata
//              walk plane than the terrain it stood on before.
//       onROOF the walker stands on a structure with NO geodata layer above it
//              within GEO_ANCHOR_MAX. That is the roof/canopy/crate-top
//              signature and it is what this gate fails on. On 22_22 those are
//              3 points with the layer 176 / 208 / 416 units away, and they
//              are the SAME 3 points before and after.
//
// RAYCASTING THE DRAWN SURFACE — read this before trusting any prop number.
// A down-ray against terrain.props returns NOTHING over the Giran staircase
// with the shipped materials, and the full ramp once every prop material is
// forced to DoubleSide for the duration of the measurement.
//
// This used to be recorded here as an unexplained correlation with the 1,849
// negative-determinant DrawScale3D placements. It is now MEASURED end to end
// and it is not a rendering bug — it is a CPU-vs-GPU asymmetry in how the
// side test is applied:
//   * the InstancedMesh that carries Giran_V_Plaza_Stair01 has instance
//     determinant -1 and material.side === THREE.BackSide (read out of the
//     live page, not inferred: terrain.js _flipSide gives every mirrored
//     instance a back-face copy of the material);
//   * three r160's checkIntersection runs in the mesh's LOCAL space, where the
//     mirror has not been applied, and for BackSide it calls
//     ray.intersectTriangle(pC, pB, pA, /* backfaceCulling */ true) — reversed
//     winding WITH culling. The tread's local winding normal points up, the
//     reversed one points down, the ray points down, so it is culled: a MISS;
//   * the GPU rasterises the same triangle through the instance matrix, so the
//     winding it sees IS mirrored, and BackSide culling then keeps exactly the
//     face the CPU threw away. The stairs draw correctly and raycast empty.
// So DoubleSide is the right thing to force for a measurement, and the offline
// raster (tools/world/bspfloor.py) must NOT read the normal off the winding —
// it multiplies by sign(det), which is what the GPU effectively does.
//
// Usage:
//   node verify_walksurface.js                 # A-D on the default tiles
//   node verify_walksurface.js --check         # same, exit 1 on regression
//   node verify_walksurface.js --server        # re-measure A off the live aCis
//   node verify_walksurface.js --tiles 22_22,17_22
// Output: verify_shots/walksurface_*.png + PASS/FAIL lines.

'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const FIXTURE = path.join(__dirname, 'verify_walksurface.json');
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 300000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const SERVER = argv.includes('--server');
const tilesArg = argv.indexOf('--tiles');
// Default set: the three towns whose plazas are BSP slabs, one dungeon and one
// wilderness control (no BSP at all — its numbers must not move).
const TILES = tilesArg >= 0 ? argv[tilesArg + 1].split(',')
  : ['22_22', '17_22', '20_22', '19_16', '16_21'];

const results = [];
const check = (name, ok, detail) => {
  results.push([ok, name]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
};

// --- tolerances -------------------------------------------------------------
//
// GEO_EXACT: gate A is an equality, not a tolerance — the client re-encodes the
// server's own file, so any difference at all is a decode bug. The only slack
// is the geodata-over-drawn-surface band, which does not enter here because
// both sides of the comparison are raw geodata heights.
//
// CELL_HEIGHT (8) is the quantum the packed cell word resolves; DRAWN_TOL is
// one of them, i.e. "the same surface as far as the source data can tell".
const CELL_HEIGHT = 8;
const DRAWN_TOL = CELL_HEIGHT;
// The measured geodata-over-drawn-surface band: +26.9..+34.2 on flat ground
// (tools/world/verify_terrain_z.py section B), one CELL_HEIGHT wide around +32.
// Gate D calls a point AGREEING when the walk height is within DRAWN_TOL of the
// drawn surface, and separately reports how many sit in this band instead —
// those are the cells with no drawn counterpart, a different failure.
const GEO_BAND = [24, 40];
// geodata.js GEO_ANCHOR_MAX, repeated because this is a CommonJS script and
// cannot import the ES module. It is the guard the client applies before it
// will stand on anything: a surface with NO geodata layer within this distance
// above it is a roof, a canopy or a crate top, and the walker must not be on
// it. That is what gate D's onROOF column counts.
const GEO_ANCHOR_MAX = 64;

// ---------------------------------------------------------------------------
// A. live-server probes (only with --server)
// ---------------------------------------------------------------------------
async function remeasureFromServer() {
  const crypto = require('crypto');
  const { execFileSync } = require('child_process');
  const GW = path.join(__dirname, '..', '..', 'gateway', 'src');
  const { login } = require(path.join(GW, 'loginclient.js'));
  const { GameSession } = require(path.join(GW, 'gameclient.js'));
  const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];
  const sql = (q) => execFileSync('mariadb', [...DB, '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
  const dev = 'verify-walksurface-fixture-1';
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + dev).digest('hex');
  const h2 = crypto.createHash('sha256').update('l2vzla-pass:' + dev).digest('hex');
  const C = { account: 'w' + h1.slice(0, 12), password: h2.slice(0, 16), charName: 'W' + h1.slice(12, 23) };

  async function session() {
    const { sessionKey, server } = await login('127.0.0.1', 2106, C.account, C.password, 1);
    const g = new GameSession();
    const st = { g, self: null, selfId: null, log: [] };
    g.on('userInfo', (u) => { st.self = u; st.selfId = u.id; });
    g.on('validate', (v) => { if (st.selfId == null || v.id === st.selfId) st.log.push({ op: 'validate', ...v }); });
    const chars = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no charList in 20s')), 20000);
      g.once('charList', (l) => { clearTimeout(t); res(l); });
      g.once('error', (e) => { clearTimeout(t); rej(e); });
      g.connect(server.host, server.port, C.account, sessionKey);
    });
    if (Array.isArray(chars) && chars.length === 0) {
      g.createCharacter(C.charName);
      await new Promise((r) => { g.once('charCreateOk', r); setTimeout(r, 8000); });
      await sleep(1200);
    }
    g.selectChar(0); await sleep(900);
    g.enterWorld(); await sleep(4500);
    return st;
  }

  { const s = await session(); if (!s.self) throw new Error('no UserInfo (pass 1)'); s.g.close(); }
  await sleep(4000);
  const owner = Number(sql(`SELECT obj_Id FROM characters WHERE char_name='${C.charName}' LIMIT 1;`));
  if (!owner) throw new Error('fixture character not found');
  sql(`UPDATE characters SET accesslevel=8 WHERE obj_Id=${owner};`);
  const S = await session();
  if (!S.self) throw new Error('no UserInfo (pass 2)');
  S.g.bypass('admin_invul'); await sleep(400);

  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  for (const scan of fixture.scans) {
    for (const pt of scan.points) {
      const [coord] = pt;
      const x = scan.axis === 'x' ? coord : scan.x;
      const y = scan.axis === 'x' ? scan.y : coord;
      S.g.bypass(`admin_teleport ${x} ${y} ${scan.sendZ}`);
      await sleep(900);
      S.g.appearing();
      await sleep(900);
      const mark = S.log.length;
      S.g.pos = { x: x + 3000, y: y + 3000, z: scan.sendZ, heading: 0 };
      S.g.validatePosition();
      await sleep(400);
      const v = S.log.slice(mark).reverse().find((e) => e.op === 'validate');
      if (!v) throw new Error(`no ValidateLocation at ${x},${y}`);
      pt[1] = v.z;
      console.log(`  server ${scan.id} ${x},${y} -> ${v.z}`);
    }
  }
  fixture.measured = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + '\n');
  S.g.close();
  console.log(`rewrote ${FIXTURE}`);
}

// ---------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------
async function openClient(browser, query = '?propDist=0') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => check('pageerror', false, e.message));
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: LOAD_TIMEOUT });
  return page;
}

async function selectTile(page, tile) {
  await page.select('#scene-picker', tile);
  await page.waitForFunction(
    (t) => document.getElementById('status').textContent.includes('scene: ' + t)
      && document.getElementById('loading').classList.contains('hidden'),
    { timeout: LOAD_TIMEOUT }, tile);
  await sleep(3500);
}

// Everything below runs INSIDE the page and is installed once per page, so the
// four gates share one definition of "the drawn surface".
const INSTALL = async () => {
  const THREE = await import('/vendor/three.module.min.js');
  const w = window.__world;
  const H = {};
  H.THREE = THREE;
  H.ray = new THREE.Raycaster();
  H.down = new THREE.Vector3(0, -1, 0);
  // force/restore DoubleSide on every prop material (see the header note)
  H.forceDouble = () => {
    const t = w.terrain;
    H._saved = [];
    for (const im of t.props || []) {
      for (const m of (Array.isArray(im.material) ? im.material : [im.material])) {
        if (m && m.side !== THREE.DoubleSide) { H._saved.push([m, m.side]); m.side = THREE.DoubleSide; }
      }
    }
  };
  H.restore = () => { for (const [m, s] of H._saved || []) m.side = s; H._saved = []; };
  // topmost drawn surface at L2 (x, y) and WHICH surface it was
  H.drawn = (lx, ly) => {
    const t = w.terrain;
    const sets = [['terrain', [t.mesh, ...(w.neighbors ? w.neighbors.meshes() : [])].filter(Boolean)],
                  ['bsp', t.bsp ? [t.bsp.group] : []],
                  ['prop', t.props || []]];
    let best = null;
    for (const [kind, objs] of sets) {
      if (!objs.length) continue;
      H.ray.set(new THREE.Vector3(lx * 0.01, 500, -ly * 0.01), H.down);
      const hs = H.ray.intersectObjects(objs, true);
      if (!hs.length) continue;
      const z = hs[0].point.y * 100;
      if (!best || z > best.z) best = { kind, z };
    }
    return best;
  };
  window.__ws = H;
};

// ---------------------------------------------------------------------------
(async () => {
  if (SERVER) { await remeasureFromServer(); }
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const shots = [];
  try {
    // ---------------- A + B + C on 22_22 ----------------
    const page = await openClient(browser);
    await selectTile(page, '22_22');
    await page.evaluate(INSTALL);

    // A. client geodata vs the recorded server scans
    for (const scan of fixture.scans.filter((s) => s.tile === '22_22')) {
      const got = await page.evaluate((sc) => sc.points.map(([coord]) => {
        const x = sc.axis === 'x' ? coord : sc.x;
        const y = sc.axis === 'x' ? sc.y : coord;
        const g = window.__world.terrain.geodata;
        const layers = g._layersAt(x, y).map((l) => l.height);
        // The server answers ONE z for a position; the comparable client value
        // is the layer it would pick for the same z, i.e. nearest to the z the
        // probe was teleported with.
        return [coord, g.heightAt(x, y, sc.sendZ), layers];
      }), scan);
      const bad = [];
      for (let i = 0; i < scan.points.length; i++) {
        if (got[i][1] !== scan.points[i][1]) {
          bad.push(`${scan.axis}=${scan.points[i][0]} server ${scan.points[i][1]} client ${got[i][1]}`);
        }
      }
      check(`A geodata == live aCis on ${scan.id} (${scan.points.length} probes)`,
        bad.length === 0, bad.slice(0, 6).join('; ') + (bad.length > 6 ? ` (+${bad.length - 6})` : ''));
    }

    // B. the staircase, walked BOTH ways and measured twice out of the same
    // build: `withWalkRaster: false` drops bspfloor.bin's section 2, which is
    // exactly what '?walkraster=off' does, i.e. the client as it behaved
    // before the walk raster existed. The before column is the bug.
    const stair = fixture.scans.find((s) => s.id === 'giran_plaza_stair_x');
    const walkRuns = await page.evaluate(async (sc) => {
      const w = window.__world, H = window.__ws, t = w.terrain;
      H.forceDouble();
      const x0 = sc.points[0][0], x1 = sc.points[sc.points.length - 1][0];
      const scan = (east) => {
        const rows = [];
        let z = (east ? sc.sendZ : sc.points[sc.points.length - 1][1] - 32) * 0.01;
        for (let i = 0; i * 8 <= x1 - x0; i++) {
          const lx = east ? x0 + i * 8 : x1 - i * 8;
          z = w.heightAt(lx * 0.01, -sc.y * 0.01, z);
          const d = H.drawn(lx, sc.y);
          rows.push({ x: lx, walk: +(z * 100).toFixed(1),
                      drawn: d ? +d.z.toFixed(1) : null, kind: d ? d.kind : null });
        }
        return east ? rows : rows.reverse();
      };
      const after = { east: scan(true), west: scan(false) };
      const saved = t.bspFloor ? t.bspFloor.fine : null;
      if (t.bspFloor) t.bspFloor.fine = null;
      const before = { east: scan(true), west: scan(false) };
      if (t.bspFloor) t.bspFloor.fine = saved;
      H.restore();
      return { before, after };
    }, stair);
    const expectedClimb = stair.points[stair.points.length - 1][1] - stair.points[0][1];
    const summarise = (rows) => {
      const onRamp = rows.filter((r) => r.kind === 'prop');
      return {
        worst: onRamp.reduce((m, r) => Math.max(m, Math.abs(r.walk - r.drawn)), 0),
        ramp: onRamp.length,
        climbed: rows[rows.length - 1].walk - rows[0].walk,
      };
    };
    const bEast = summarise(walkRuns.after.east);
    const bWest = summarise(walkRuns.after.west);
    const b0 = summarise(walkRuns.before.east);
    console.log('    x     walk(before) walk(after)    drawn   from');
    for (let i = 0; i < walkRuns.after.east.length; i += 4) {
      const a = walkRuns.after.east[i], p0 = walkRuns.before.east[i];
      console.log(`  ${String(a.x).padStart(6)} ${String(p0.walk).padStart(11)}`
        + ` ${String(a.walk).padStart(11)} ${String(a.drawn).padStart(9)}   ${a.kind}`);
    }
    check(`B walker climbs the Giran plaza stair (${bEast.climbed} of the server's ${expectedClimb} L2u)`,
      Math.abs(bEast.climbed - expectedClimb) <= CELL_HEIGHT,
      `walk ${walkRuns.after.east[0].walk} -> ${walkRuns.after.east[walkRuns.after.east.length - 1].walk}`
      + ` (before the walk raster: ${b0.climbed} L2u, worst |walk-drawn| ${b0.worst.toFixed(1)});`
      + ` worst now ${bEast.worst.toFixed(1)} L2u over ${bEast.ramp} ramp samples`);
    check('B walker tracks the drawn ramp within one CELL_HEIGHT',
      bEast.worst <= DRAWN_TOL, `worst ${bEast.worst.toFixed(1)} L2u (was ${b0.worst.toFixed(1)})`);
    check('B walker tracks the drawn ramp walking back DOWN it',
      bWest.worst <= DRAWN_TOL, `worst ${bWest.worst.toFixed(1)} L2u over ${bWest.ramp} ramp samples`);

    // C. the click, built exactly like main.js's handler
    const clickRes = await page.evaluate(async () => {
      const THREE = window.__ws.THREE, w = window.__world, t = w.terrain;
      w.character.group.position.set(82000 * 0.01, -3496 * 0.01, -148000 * 0.01);
      w.followCam.pitch = 0.35; w.followCam.dist = 12; w.followCam.yaw = 0;
      await new Promise((r) => setTimeout(r, 600));
      w.camera.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const targets = [t.mesh, ...(w.neighbors ? w.neighbors.meshes() : [])].filter(Boolean);
      if (t.bsp) targets.push(t.bsp.group);        // <- the fix under test
      const legacy = [t.mesh, ...(w.neighbors ? w.neighbors.meshes() : [])].filter(Boolean);
      const out = [];
      for (const [nx, ny] of [[0, 0], [0, -0.2], [0, -0.4], [0.2, -0.2], [-0.2, -0.3], [0, 0.2], [0.3, 0]]) {
        ray.setFromCamera(new THREE.Vector2(nx, ny), w.camera);
        const a = ray.intersectObjects(legacy, true)[0];
        const b = ray.intersectObjects(targets, true)[0];
        const l2 = (h) => h ? [Math.round(h.point.x * 100), Math.round(-h.point.z * 100), Math.round(h.point.y * 100)] : null;
        const B = l2(b);
        // the BSP slab top directly under the NEW pick
        const gx = Math.round((B[0] - t.origin[0]) / t.spacing);
        const gy = Math.round((B[1] - t.origin[1]) / t.spacing);
        const slab = t.bspFloor ? t.bspFloor.nearest(gx, gy, B[2], 1e9) : null;
        out.push({ ndc: [nx, ny], legacy: l2(a), fixed: B, slab });
      }
      return out;
    });
    let clickBad = 0, maxShift = 0;
    for (const c of clickRes) {
      if (c.slab == null || Math.abs(c.fixed[2] - c.slab) > DRAWN_TOL) clickBad++;
      if (c.legacy) maxShift = Math.max(maxShift, Math.hypot(c.legacy[0] - c.fixed[0], c.legacy[1] - c.fixed[1]));
    }
    check(`C click pick lands on the Giran pavement (${clickRes.length} screen points)`,
      clickBad === 0,
      `off-slab picks ${clickBad}; terrain-only pick was displaced up to ${Math.round(maxShift)} L2u and `
      + `${Math.round(clickRes[0].legacy[2] - clickRes[0].fixed[2])} L2u below the slab`);

    // SHOTS. The character's z is the CLIENT'S OWN answer (w.heightAt walked
    // in from the foot of the stair), not a hardcoded number — otherwise the
    // before/after pair is two pictures of the same posed model and proves
    // nothing. `_before` drops the walk raster, which is what the client did
    // before it existed: the model stays on the lower slab and the treads run
    // through it.
    for (const [lx, ly, yaw, pitch, dist, label] of [
      [83160, 148618, 0, 0.10, 9, 'stair_mid'],
      [83000, 148618, 0, 0.18, 14, 'stair_foot'],
      [83300, 148618, 180, 0.18, 14, 'stair_top'],
      [82000, 148000, 45, 0.30, 22, 'plaza'],
    ]) {
      for (const withRaster of [true, false]) {
        const z = await page.evaluate(({ lx, ly, yaw, pitch, dist, withRaster }) => {
          const w = window.__world, t = w.terrain;
          if (!withRaster && t.bspFloor) { t._savedFine = t.bspFloor.fine; t.bspFloor.fine = null; }
          // walk in from the plaza so the multi-layer hint is the real one
          let z = -3496 * 0.01;
          for (let x = 82800; x <= lx; x += 8) z = w.heightAt(x * 0.01, -ly * 0.01, z);
          w.character.group.position.set(lx * 0.01, z, -ly * 0.01);
          w.followCam.pitch = pitch; w.followCam.dist = dist;
          w.followCam.yaw = yaw * Math.PI / 180;
          if (!withRaster && t.bspFloor) t.bspFloor.fine = t._savedFine;
          return Math.round(z * 100);
        }, { lx, ly, yaw, pitch, dist, withRaster });
        await sleep(1500);
        const f = `walksurface_22_22_${label}${withRaster ? '' : '_before'}.png`;
        await page.screenshot({ path: path.join(OUT, f) });
        shots.push(`${f} (z ${z})`);
      }
    }
    await page.close();

    // ---------------- D. the count, per tile ----------------
    console.log('\n== D. walk surface vs drawn surface ==');
    console.log('   A disagreement only counts as a DEFECT where geodata says the drawn');
    console.log('   surface is walkable — i.e. some geodata layer stands over it inside the');
    console.log('   measured +' + GEO_BAND[0] + '..' + GEO_BAND[1] + ' geodata-over-surface band. A roof, a tree canopy or a');
    console.log('   wall top is the topmost DRAWN thing at its (x,y) and carries no such');
    console.log('   layer; the walker is right to ignore it and it is counted separately.');
    console.log('   Each tile is scanned TWICE out of the same build: "before" is the client');
    console.log('   with bspfloor.bin\'s walk raster dropped (= \'?walkraster=off\', the coarse');
    console.log('   128-unit BSP-only raster it used before), "after" is the shipped client.');
    console.log('');
    console.log('tile           samples  agree  defects  by drawn source        not-walkable  onNW onROOF  median  p95   max');
    const totals = {
      before: { n: 0, bad: 0, terrain: 0, bsp: 0, prop: 0, nonwalk: 0, onNonWalk: 0, onRoof: 0 },
      after: { n: 0, bad: 0, terrain: 0, bsp: 0, prop: 0, nonwalk: 0, onNonWalk: 0, onRoof: 0 },
    };
    for (const tile of TILES) {
      const p = await openClient(browser);
      await selectTile(p, tile);
      await p.evaluate(INSTALL);
      const both = await p.evaluate(async ({ tol, band, anchorMax }) => {
        const w = window.__world, H = window.__ws, t = w.terrain;
        if (t.interior) return { interior: true };
        H.forceDouble();
        const o = t.origin, span = t.gridSize * t.spacing;
        const N = 96;                       // 96x96 = 9 216 points per tile
        // The drawn surface is a property of the SCENE, and the walk raster is
        // not in the scene — dropping it below cannot move a raycast. So the
        // raycasts (three sets x 9 216 points, the whole cost of this gate)
        // are done once and both scans read the same hits.
        const hits = [];
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const lx = o[0] + (i + 0.5) * span / N;
            const ly = o[1] + (j + 0.5) * span / N;
            const d = H.drawn(lx, ly);
            if (d) hits.push({ lx, ly, d });
          }
        }
        const scan = () => {
          const out = { n: 0, bad: 0, byKind: { terrain: 0, bsp: 0, prop: 0 },
                        nonwalk: 0, onNonWalk: 0, onRoof: 0, d: [] };
          {
            for (const hit of hits) {
              const lx = hit.lx, ly = hit.ly, d = hit.d;
              // Ask the ground query the way movement does: hint = the drawn
              // surface, so this measures "standing where the player sees me",
              // not a cold z-less lookup.
              const z = w.heightAt(lx * 0.01, -ly * 0.01, d.z * 0.01) * 100;
              const diff = z - d.z;
              out.n++;
              // Is the drawn surface WALKABLE? geodata answers: a walking layer
              // stands the measured band above the surface it describes, so a
              // layer inside [z+band0, z+band1] means "you can stand here".
              // Nothing above a roof or a canopy has one.
              const layers = t.geodata ? t.geodata._layersAt(lx, ly) : null;
              const walkable = !!(layers && layers.some(
                (l) => l.height - d.z >= band[0] && l.height - d.z <= band[1]));
              if (Math.abs(diff) <= tol) {
                // THE REGRESSION THESE COLUMNS EXIST FOR: a roof, a canopy or
                // a wall top is the topmost drawn thing at its (x, y) and
                // geodata stands over none of them. Putting props into the
                // raster must not turn one into the surface the walker STANDS
                // ON — that would look like an improvement here (the
                // disagreement disappears) while being strictly worse.
                //
                // Two tests, because the band is not the client's rule. onNW
                // is band-strict and informational; onROOF is the one that
                // names a roof: NOTHING above this surface within one
                // GEO_ANCHOR_MAX, which is the guard the client itself applies
                // before it will stand on anything. See the header note for
                // the 22_22 measurement that separated the two populations.
                if (!walkable && d.kind !== 'terrain') {
                  out.onNonWalk++;
                  const held = !!(layers && layers.some(
                    (l) => l.height - d.z >= 0 && l.height - d.z <= anchorMax));
                  if (!held) out.onRoof++;
                }
                continue;
              }
              if (!walkable) { out.nonwalk++; continue; }
              out.bad++;
              out.byKind[d.kind]++;
              out.d.push(Math.abs(diff));
            }
          }
          out.d.sort((a, b) => a - b);
          return out;
        };
        const after = scan();
        const saved = t.bspFloor ? t.bspFloor.fine : null;
        if (t.bspFloor) t.bspFloor.fine = null;
        const before = scan();
        if (t.bspFloor) t.bspFloor.fine = saved;
        H.restore();
        return { before, after };
      }, { tol: DRAWN_TOL, band: GEO_BAND, anchorMax: GEO_ANCHOR_MAX });
      await p.close();
      if (both.interior) { console.log(`${tile.padEnd(8)} (interior tile: no heightfield, skipped)`); continue; }
      for (const which of ['before', 'after']) {
        const r = both[which];
        const med = r.d.length ? r.d[r.d.length >> 1] : 0;
        const p95 = r.d.length ? r.d[Math.floor(r.d.length * 0.95)] : 0;
        const max = r.d.length ? r.d[r.d.length - 1] : 0;
        console.log(`${(tile + ' ' + which).padEnd(14)} ${String(r.n).padStart(7)} `
          + `${String(r.n - r.bad - r.nonwalk).padStart(6)} `
          + `${String(r.bad).padStart(8)}   mesh ${String(r.byKind.terrain).padStart(5)} `
          + `bsp ${String(r.byKind.bsp).padStart(4)} prop ${String(r.byKind.prop).padStart(5)} `
          + `${String(r.nonwalk).padStart(12)} ${String(r.onNonWalk).padStart(5)} `
          + `${String(r.onRoof).padStart(6)} `
          + `${med.toFixed(0).padStart(6)} ${p95.toFixed(0).padStart(5)} ${max.toFixed(0).padStart(5)}`);
        const T = totals[which];
        T.n += r.n; T.bad += r.bad; T.nonwalk += r.nonwalk; T.onNonWalk += r.onNonWalk;
        T.onRoof += r.onRoof;
        T.terrain += r.byKind.terrain; T.bsp += r.byKind.bsp; T.prop += r.byKind.prop;
      }
      if (tile === '16_21') {
        // the wilderness control: no BSP, no slab, the walk surface IS the mesh
        const r = both.after;
        const agree = r.n - r.bad - r.nonwalk;
        check('D wilderness control 16_21 agrees on >=98% of walkable points',
          r.n && agree / (r.n - r.nonwalk) >= 0.98,
          `${agree}/${r.n - r.nonwalk} within ${DRAWN_TOL} L2u`);
      }
    }
    for (const which of ['before', 'after']) {
      const T = totals[which];
      console.log(`TOTAL ${which.padEnd(8)} ${String(T.n).padStart(7)} `
        + `${String(T.n - T.bad - T.nonwalk).padStart(6)} ${String(T.bad).padStart(8)}   `
        + `mesh ${T.terrain} bsp ${T.bsp} prop ${T.prop} `
        + `${String(T.nonwalk).padStart(12)} ${String(T.onNonWalk).padStart(5)} `
        + `${String(T.onRoof).padStart(6)}`);
    }
    check('D the walk-surface defect count drops',
      totals.after.bad < totals.before.bad,
      `${totals.before.bad} -> ${totals.after.bad} defects `
      + `(props ${totals.before.prop} -> ${totals.after.prop}, `
      + `bsp ${totals.before.bsp} -> ${totals.after.bsp}, `
      + `mesh ${totals.before.terrain} -> ${totals.after.terrain})`);
    check('D roofs and canopies do not become the surface the walker stands on',
      totals.after.onRoof <= totals.before.onRoof,
      `standing on a structure with NO geodata layer within ${GEO_ANCHOR_MAX} of it: `
      + `${totals.before.onRoof} -> ${totals.after.onRoof}`
      + `; band-strict onNW ${totals.before.onNonWalk} -> ${totals.after.onNonWalk} `
      + `(see the header: the gain there is supported prop surfaces at +41..+48, not roofs)`
      + `; roof/canopy disagreements still ignored: ${totals.before.nonwalk} -> ${totals.after.nonwalk}`);
    console.log(`\nshots: ${shots.join(' ')}`);
  } finally {
    await browser.close();
  }

  const failed = results.filter(([ok]) => !ok);
  console.log(`\nverify_walksurface: ${failed.length ? 'FAIL' : 'PASS'} `
    + `(${results.length - failed.length}/${results.length})`);
  if (CHECK && failed.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
