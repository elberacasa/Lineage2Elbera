// Pathfinding verification (click-to-move A* over geodata, js/geodata.js
// NavGrid + main.js movement integration).
//
//   node verify_pathfinding.js [tag]
//
//   1. unit: synthetic stub geodata — A* detours around a wall, refuses an
//      enclosed target, honors the 48-unit step rule (48 climbs, 49 walls).
//      (skipped with a note when __world.nav is absent — pre-pathfinding
//      client, i.e. a "before" run)
//   2. route: training-hall area (-74400,254400) -> TI village (-84141,244623)
//      on 17_25. The planned legs are validated against the WALK RULE at
//      16u resolution (independent re-check: passable() + heightAt(maxUp)):
//      before, the straight legs cross the aqueduct wall near (-77800,251000);
//      after, the nav route detours through the open band (y ~ 245.5-248.3k).
//   3. e2e solo: the character really walks the click (offline, no server)
//      — start point, final position, walked trace, screenshots.
//
// Output: verify_shots/path_<tag>_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'now';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// training-hall side of the aqueduct -> TI village square (both nswe=0xf,
// verified against assets/world/17_25/geodata.bin)
const START = { x: -74400, y: 254400 };
const GOAL = { x: -84141, y: 244623 };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
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

    // load 17_25 (TI village) through the real picker
    await page.select('#scene-picker', '17_25');
    await page.waitForFunction(
      t => document.getElementById('status').textContent.includes('scene: ' + t)
        && document.getElementById('loading').classList.contains('hidden'),
      { timeout: 240000 }, '17_25');
    await sleep(1200);

    // -- 1. unit tests on synthetic stub geodata ----------------------------
    summary.unit = await page.evaluate(() => {
      const w = window.__world;
      if (!w.nav || !w.nav.NavGrid) return { skipped: 'no __world.nav (pre-pathfinding client)' };
      const C = 128;   // NAV_CELL (js/geodata.js)
      // Stub with the Geodata contract used by NavGrid: heightAt(x,y,z,maxUp)
      // (single layer per point) + passable() — SINGLE from-cell flag, the
      // real Geodata.passable() semantics (dx wins, then dy). `H(ix,iy)` is
      // the layer height per 128u cell; `walls` holds "ix,iy>E|W|S|N"
      // (from-cell exit closed).
      function stub(W, Ht, walls) {
        const H = (x, y) => Ht(Math.floor(x / C), Math.floor(y / C));
        return {
          heightAt(x, y, z = null, maxUp = null) {
            const h = H(x, y);
            if (h == null) return null;
            if (z == null) return h;
            if (maxUp != null) return h <= z + Math.min(maxUp, 48) ? h : z;
            return h;
          },
          passable(fx, fy, tx, ty) {
            const dx = Math.sign(Math.floor(tx / C) - Math.floor(fx / C));
            const dy = Math.sign(Math.floor(ty / C) - Math.floor(fy / C));
            const from = `${Math.floor(fx / C)},${Math.floor(fy / C)}`;
            if (dx > 0) return !walls.has(from + '>E');
            if (dx < 0) return !walls.has(from + '>W');
            if (dy > 0) return !walls.has(from + '>S');
            if (dy < 0) return !walls.has(from + '>N');
            return true;
          },
        };
      }
      const wall2 = (walls, ix, iy, dir) => {   // close the crossing both ways
        walls.add(`${ix},${iy}>${dir}`);
        const d = { E: [1, 0, 'W'], W: [-1, 0, 'E'], S: [0, 1, 'N'], N: [0, -1, 'S'] }[dir];
        walls.add(`${ix + d[0]},${iy + d[1]}>${d[2]}`);
      };
      const out = {};

      // (a) wall detour: vertical wall at ix=20, rows iy 4..35, grid 40x40
      {
        const walls = new Set();
        for (let iy = 4; iy <= 35; iy++) wall2(walls, 19, iy, 'E');
        const geo = stub(40, () => 0, walls);
        const nav = new w.nav.NavGrid(() => geo);
        const r = nav.findPath(2 * C + 64, 20 * C + 64, 0, 38 * C + 64, 20 * C + 64, 0);
        const straight = (38 - 2) * C;
        const len = r ? r.points.reduce((s, p, i, a) =>
          i ? s + Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) : 0, 0) : 0;
        const inWall = r ? r.points.some(p =>
          Math.abs(Math.floor(p.x / C) - 20) < 1
          && Math.floor(p.y / C) >= 4 && Math.floor(p.y / C) <= 35) : null;
        out.wallDetour = {
          complete: r ? r.complete : false, points: r ? r.points.length : 0,
          len: Math.round(len), straight, detours: len > straight * 1.2,
          avoidsWall: inWall === false, ms: r ? +r.ms.toFixed(1) : null,
        };
      }
      // (b) enclosed target: wall ring around the goal cell
      {
        const walls = new Set();
        const gx = 20, gy = 20;
        for (let i = -2; i <= 2; i++) {
          wall2(walls, gx + i, gy - 2, 'S');   // south side
          wall2(walls, gx + i, gy + 2, 'N');   // north side
          wall2(walls, gx - 2, gy + i, 'E');   // west side
          wall2(walls, gx + 2, gy + i, 'W');   // east side
        }
        const geo = stub(40, () => 0, walls);
        const nav = new w.nav.NavGrid(() => geo);
        const r = nav.findPath(2 * C + 64, 2 * C + 64, 0, gx * C + 64, gy * C + 64, 0);
        out.enclosed = { refused: !r || !r.complete, complete: r ? r.complete : null };
      }
      // (c) step rule: a full-width ramp at ix>=20, height +48 (climbs) ...
      {
        const geo48 = stub(40, (ix) => (ix >= 20 ? 48 : 0), new Set());
        const nav48 = new w.nav.NavGrid(() => geo48);
        const r48 = nav48.findPath(2 * C + 64, 20 * C + 64, 0, 38 * C + 64, 20 * C + 64, 48);
        // ... and +49 (a wall, no way around: spans every row)
        const geo49 = stub(40, (ix) => (ix >= 20 ? 49 : 0), new Set());
        const nav49 = new w.nav.NavGrid(() => geo49);
        const r49 = nav49.findPath(2 * C + 64, 20 * C + 64, 0, 38 * C + 64, 20 * C + 64, 49);
        out.stepRule = {
          climbs48: r48 ? r48.complete : false,
          blocks49: !r49 || !r49.complete,
        };
      }
      return out;
    });

    // -- 2. planned route vs the walk rule (independent 16u validation) -----
    // place the character at START so walkToServer plans from there
    await page.evaluate(({ sx, sy }) => {
      const w = window.__world;
      const y = w.heightAt(sx * 0.01, -sy * 0.01);
      w.character.group.position.set(sx * 0.01, y, -sy * 0.01);
      w.character.clearTarget();
    }, { sx: START.x, sy: START.y });
    await sleep(400);

    summary.route = await page.evaluate(({ gx, gy }) => {
      const w = window.__world;
      const g = w.terrain.geodata;
      const destY = w.heightAt(gx * 0.01, -gy * 0.01);
      const dest = new (w.character.group.position.constructor)(gx * 0.01, destY, -gy * 0.01);
      w.walkTo(dest);
      const p0 = w.character.group.position;
      // read the legs the click just queued (movement internals, read-only).
      // Pre-pathfinding client: moveQueue is not exposed — replicate its
      // straight-legs split (<=2000u along the clicked direction) instead.
      let legs;
      if (w.moveQueue) {
        legs = w.moveQueue.map(v => ({
          x: Math.round(v.x * 100), y: Math.round(-v.z * 100), z: Math.round(v.y * 100),
        }));
      } else {
        legs = [];
        const dx = dest.x - p0.x, dz = dest.z - p0.z;
        const steps = Math.ceil(Math.hypot(dx, dz) / 20);
        for (let i = 1; i <= steps; i++) {
          legs.push({
            x: Math.round((p0.x + dx * i / steps) * 100),
            y: Math.round(-(p0.z + dz * i / steps) * 100),
            z: Math.round(dest.y * 100),
          });
        }
      }
      const from = { x: Math.round(p0.x * 100), y: Math.round(p0.z * -100) };
      // independent walk-rule validation at 16u steps along the queued legs
      const STEP = 48;
      let z = Math.round(p0.y * 100);
      let violation = null;
      const pts = [{ x: from.x, y: from.y }, ...legs];
      outer:
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16));
        for (let k = 1; k <= n; k++) {
          const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
          const px = a.x + (b.x - a.x) * (k - 1) / n, py = a.y + (b.y - a.y) * (k - 1) / n;
          if (!g.passable(px, py, x, y)) {
            violation = { kind: 'nswe', x: Math.round(x), y: Math.round(y), z };
            break outer;
          }
          const h = g.heightAt(x, y, z, STEP);
          const lowest = g.heightAt(x, y);
          if (lowest == null || lowest > z + STEP) {
            violation = { kind: 'step', x: Math.round(x), y: Math.round(y), z, lowest };
            break outer;
          }
          z = h;
        }
      }
      return {
        legs: legs.length, navPending: !!(w.nav && w.nav.pendingGoal),
        firstLegs: legs.slice(0, 4), lastLeg: legs[legs.length - 1] || null,
        walkRuleViolation: violation,
      };
    }, { gx: GOAL.x, gy: GOAL.y });

    // -- 3. e2e solo walk ---------------------------------------------------
    // the click from step 2 is already walking; trace it to the end.
    // (headless SwiftShader runs at a few fps — the walk takes minutes;
    // "done" = speed 0 AND no walk target for 3 consecutive samples, so the
    // 1-frame gap between leg arrival and the next pump can't fool it)
    const t0 = Date.now();
    const trace = [];
    let arrived = false, zeroSamples = 0, crossingShot = false;
    while (Date.now() - t0 < 600000) {
      const s = await page.evaluate(() => {
        const w = window.__world;
        const p = w.character.group.position;
        return {
          x: Math.round(p.x * 100), y: Math.round(-p.z * 100), z: Math.round(p.y * 100),
          speed: w.character.speed, queue: (w.moveQueue || []).length,
          pending: !!(w.nav && w.nav.pendingGoal),
          targeted: !!w.character.target,
        };
      });
      trace.push(s);
      if (Math.hypot(s.x - GOAL.x, s.y - GOAL.y) < 300) arrived = true;
      // mid-route evidence: the character in the barrier/crossing area
      if (!crossingShot && s.x > -80000 && s.x < -76000 && s.y > 245000 && s.y < 250500) {
        crossingShot = true;
        await page.evaluate(() => {
          const w = window.__world;
          w.followCam.pitch = 0.9;
          w.followCam.dist = 30;
        });
        await sleep(1200);
        await page.screenshot({ path: path.join(OUT, `path_${TAG}_02_barrier_crossing.png`) });
      }
      zeroSamples = (s.speed === 0 && !s.targeted && s.queue === 0) ? zeroSamples + 1 : 0;
      if (zeroSamples >= 3 && trace.length > 2) break;
      await sleep(3000);
    }
    await sleep(500);
    const end = trace[trace.length - 1];
    summary.walk = {
      samples: trace.length,
      end,
      endDistToGoal: end ? Math.round(Math.hypot(end.x - GOAL.x, end.y - GOAL.y)) : null,
      arrived,
      trace: trace.filter((_, i) => i % 5 === 0 || i === trace.length - 1),
      // ground truth at the end point: character y vs the ground below
      // (z-less lookup — a stuck walker ends up meters UNDER the terrain)
      endGroundDelta: end ? await page.evaluate(({ x, y, z }) => {
        const w = window.__world;
        return Math.round(w.heightAt(x * 0.01, -y * 0.01) * 100 - z);
      }, end) : null,
    };

    // screenshot: end-of-route view (followCam owns the camera every frame,
    // so staged shots must go through it)
    await page.evaluate(() => {
      const w = window.__world;
      w.followCam.pitch = 0.35; w.followCam.dist = Math.max(w.followCam.minDist, 8);
    });
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, `path_${TAG}_01_route_end.png`) });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY PATHFINDING FAILED:', e.message); process.exit(1); });
