// repro_heights.js — float/sink reproduction WITH measurements (offline solo).
// For each spot: rendered character y, rendered mesh height (raycast onto the
// actual drawn meshes), geodata walkable height at the cell. Screenshots at
// the worst measured spots for feet-vs-ground inspection.
// Usage: node repro_heights.js [tag]
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/?hd=0';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'before';
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 240000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleErrors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => summary.consoleErrors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') summary.consoleErrors.push(m.text());
    });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 90000 });

    // expose constructors for in-page raycasts / vectors
    await page.evaluate(async () => {
      const mod = await import('./vendor/three.module.min.js');
      window.__world.__Raycaster = mod.Raycaster;
      window.__world.__Vector3 = mod.Vector3;
    });

    const loadTile = async (tile) => {
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: LOAD_TIMEOUT }, tile);
      await sleep(1500);
    };

    // In-page: dense scan of walker-height vs rendered-mesh-height at exact
    // geodata cell-boundary coordinates (multiples of 512 L2u) — the FP
    // cell-flip stress test. walkY = the movement code's fixed point seeded
    // from the mesh height.
    const scan = async () => page.evaluate(() => {
      const w = window.__world;
      const t = w.terrain;
      const def = t.def;
      const L2 = 100;
      const geo = t.mesh.geometry.attributes.position;
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
      const N = 64;
      const hist = { d010: 0, d025: 0, d050: 0, d100: 0, total: 0 };
      const worst = [];
      for (let i = 1; i < N; i++) {
        for (let j = 1; j < N; j++) {
          const wx = def.origin[0] + (i / N) * 256 * def.spacing;
          const wy = def.origin[1] + (j / N) * 256 * def.spacing;
          const tx = wx / L2, tz = -wy / L2;
          const meshY = meshYAt(tx, tz);
          if (meshY == null) continue;
          let y = meshY;
          for (let k = 0; k < 3; k++) y = w.heightAt(tx, tz, y);
          const d = y - meshY;
          const ad = Math.abs(d);
          hist.total++;
          if (ad > 0.10) hist.d010++;
          if (ad > 0.25) hist.d025++;
          if (ad > 0.50) hist.d050++;
          if (ad > 1.00) hist.d100++;
          if (ad > 0.12) {
            worst.push({ wx: Math.round(wx), wy: Math.round(wy),
                         meshY: +meshY.toFixed(3), walkY: +y.toFixed(3),
                         d: +d.toFixed(3) });
            worst.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
            if (worst.length > 12) worst.pop();
          }
        }
      }
      return { hist, worst };
    });

    // measure at the character's current position: char y, RENDERED mesh y
    // (down-raycast onto center + neighbor meshes), geodata layers
    const measure = () => page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      const meshes = [];
      if (w.terrain && w.terrain.mesh) meshes.push(w.terrain.mesh);
      if (w.neighbors) meshes.push(...w.neighbors.meshes());
      let meshY = null;
      if (meshes.length) {
        const rc = new w.__Raycaster();
        const origin = p.clone(); origin.y += 80;
        rc.set(origin, new w.__Vector3(0, -1, 0));
        const hit = rc.intersectObjects(meshes, false)[0];
        meshY = hit ? +hit.point.y.toFixed(3) : null;
      }
      const l2x = Math.round(p.x * 100), l2y = Math.round(-p.z * 100);
      const g = w.terrain.geodata;
      const entry = w.neighbors && w.neighbors.entryAt(p.x, p.z);
      return {
        at: [l2x, l2y],
        charY: +p.y.toFixed(3), meshY,
        d: meshY == null ? null : +(p.y - meshY).toFixed(3),
        walkH: +w.heightAt(p.x, p.z, p.y).toFixed(3),
        geoLayers: g ? g._layersAt(l2x, l2y).map(l => l.height) : null,
        answers: entry ? entry.tile : w.currentTile,
      };
    });

    // stage the character at an L2 point (flushing any queued legs), settle,
    // screenshot + measure
    const stageAndShoot = async (name, l2x, l2y) => {
      await page.evaluate(({ l2x, l2y }) => {
        const w = window.__world;
        const p = w.character.group.position;
        p.set(l2x * 0.01, 0, -l2y * 0.01);
        p.y = w.heightAt(p.x, p.z, null);   // z-less spawn-style seed
        w.character.clearTarget();
        w.walkTo(p.clone());                // flush stale moveQueue legs
        w.followCam.pitch = 0.14;
        w.followCam.dist = Math.max(w.followCam.minDist, 4.5);
      }, { l2x, l2y });
      await sleep(1200);
      const m = await measure();
      await page.screenshot({ path: path.join(OUT, `repro_${TAG}_${name}.png`) });
      return m;
    };

    // walk a line, sampling the live character every 120ms; ends only after
    // `idlePatience` consecutive idle polls (SwiftShader can run <1fps with
    // the full neighborhood — inter-leg and pre-pump frames read speed 0)
    const walkSampled = async (p0, p1, startY, keepAll = false, idlePatience = 30) => {
      await page.evaluate(({ x, y, z }) => {
        const w = window.__world;
        w.character.group.position.set(x, y, z);
        w.character.clearTarget();
      }, { x: p0.x, y: startY, z: p0.z });
      await sleep(300);
      await page.evaluate(({ x, y, z }) => {
        const w = window.__world;
        w.walkTo(new w.__Vector3(x, y, z));
      }, { x: p1.x, y: startY, z: p1.z });
      const samples = [];
      let idle = 0;
      for (let k = 0; k < 2000; k++) {
        await sleep(120);
        const s = await page.evaluate(() => {
          const w = window.__world;
          const c = w.character;
          const p = c.group.position;
          const meshes = [];
          if (w.terrain && w.terrain.mesh) meshes.push(w.terrain.mesh);
          if (w.neighbors) meshes.push(...w.neighbors.meshes());
          let meshY = null;
          if (meshes.length) {
            const rc = new w.__Raycaster();
            const origin = p.clone(); origin.y += 80;
            rc.set(origin, new w.__Vector3(0, -1, 0));
            const hit = rc.intersectObjects(meshes, false)[0];
            meshY = hit ? +hit.point.y.toFixed(3) : null;
          }
          const entry = w.neighbors && w.neighbors.entryAt(p.x, p.z);
          return { x: +p.x.toFixed(2), y: +(-p.z).toFixed(2), charY: +p.y.toFixed(3),
                   meshY, d: meshY == null ? null : +(p.y - meshY).toFixed(3),
                   speed: +c.speed.toFixed(2),
                   answers: entry ? entry.tile : w.currentTile,
                   entryGeo: entry ? !!entry.geodata : null };
        });
        samples.push(s);
        idle = s.speed === 0 ? idle + 1 : 0;
        if (idle >= idlePatience && samples.length > 3) break;
      }
      const withMesh = samples.filter(s => s.d != null);
      return {
        n: samples.length,
        maxAbs: withMesh.length
          ? +Math.max(...withMesh.map(s => Math.abs(s.d))).toFixed(3) : null,
        worst: withMesh.slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5),
        crossings: samples.filter((s, i) => i && s.answers !== samples[i - 1].answers),
        trail: keepAll ? samples : undefined,
      };
    };

    // ---- (1) TI village tile 17_25: dense scan + worst spots ---------------
    await loadTile('17_25');
    summary.scan_17_25 = await scan();
    for (let i = 0; i < Math.min(3, summary.scan_17_25.worst.length); i++) {
      const s = summary.scan_17_25.worst[i];
      summary[`spot_17_25_${i}`] = await stageAndShoot(`17_25_worst${i}`, s.wx, s.wy);
    }
    if (summary.scan_17_25.worst.length) {
      const s = summary.scan_17_25.worst[0];
      const mk = (wx, wy) => ({ x: wx * 0.01, z: -wy * 0.01 });
      // seed the walk start at the LOCAL ground height, not the scan's
      // far-away meshY (the 5.78m "float" in the before run was a bad seed)
      const y0 = await page.evaluate(({ x, z }) => {
        const w = window.__world;
        return w.heightAt(x, z, null);
      }, mk(s.wx - 1500, s.wy - 1500));
      summary.walk_17_25 = await walkSampled(
        mk(s.wx - 1500, s.wy - 1500), mk(s.wx + 1500, s.wy + 1500), y0);
      await page.screenshot({ path: path.join(OUT, `repro_${TAG}_17_25_walk.png`) });
    }

    // ---- (2) Aden bridge 24_18 ----------------------------------------------
    await loadTile('24_18');
    const cell = (cx, cy) => ({ x: (131072 + cx * 16 + 8) * 0.01, z: -(cy * 16 + 8) * 0.01 });
    summary.bridge_deck = await walkSampled(cell(1388, 882), cell(1390, 883), -12.56);
    await page.screenshot({ path: path.join(OUT, `repro_${TAG}_bridge_deck.png`) });
    summary.bridge_under = await walkSampled(cell(1386, 880), cell(1390, 883), -40.08);
    await page.screenshot({ path: path.join(OUT, `repro_${TAG}_bridge_under.png`) });

    // ---- (3) dungeon interiors: spawn grounding + first-step pop ------------
    for (const tile of ['19_16', '21_25']) {
      await loadTile(tile);
      // camera where the character is visible, then measure the idle spawn
      await page.evaluate(() => {
        const w = window.__world;
        w.followCam.pitch = 0.30;
        w.followCam.dist = Math.max(w.followCam.minDist, 7);
        w.followCam.yaw += 0.9;
      });
      await sleep(1000);
      const atSpawn = await measure();
      await page.screenshot({ path: path.join(OUT, `repro_${TAG}_${tile}_spawn.png`) });
      // take a short walk: does y pop on the first step?
      const before = atSpawn.charY;
      const trail = await page.evaluate(() => {
        const w = window.__world;
        const p = w.character.group.position;
        w.walkTo(new w.__Vector3(p.x + 8, p.y, p.z + 8));
        return null;
      });
      const popTrail = [];
      let minY = before, maxY = before;
      for (let k = 0; k < 120; k++) {
        await sleep(100);
        const y = await page.evaluate(() =>
          +window.__world.character.group.position.y.toFixed(3));
        const sp = await page.evaluate(() => window.__world.character.speed);
        popTrail.push(y);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (sp === 0 && k > 10) break;
      }
      const after = await measure();
      await page.screenshot({ path: path.join(OUT, `repro_${TAG}_${tile}_walked.png`) });
      summary['interior_' + tile] = {
        spawn: atSpawn, afterWalk: after,
        popRange: [minY, maxY],
      };
    }

    // ---- (3b) deep-hall pop: lower dungeon floors >2.5m from floorY --------
    // 19_16 lower hall floor -11256 (floorY -107.0): walking rule must not
    // throw the walker back up to floorY. 21_25: -6656 vs -62.71.
    for (const [tile, l2x, l2y, floorL2] of [
      ['19_16', -18856, -54416, -11256],
      ['21_25', 46424, 245672, -6656],
    ]) {
      await loadTile(tile);
      summary['deephall_' + tile] = await page.evaluate(
        ({ l2x, l2y, floorL2 }) => {
          const w = window.__world;
          const p = w.character.group.position;
          p.set(l2x * 0.01, floorL2 * 0.01, -l2y * 0.01);
          w.character.clearTarget();
          w.walkTo(p.clone());   // flush queue
          const g = w.terrain.geodata;
          return {
            floorY: +w.terrain.floorY.toFixed(2),
            seededY: floorL2 * 0.01,
            // what the movement loop converges to from the real floor:
            walkH: +w.heightAt(p.x, p.z, p.y).toFixed(3),
            geoLayers: g ? g._layersAt(l2x, l2y).map(l => l.height) : null,
          };
        }, { l2x, l2y, floorL2 });
      await sleep(1500);
      summary['deephall_' + tile].charY = await page.evaluate(() =>
        +window.__world.character.group.position.y.toFixed(3));
      await page.screenshot({ path: path.join(OUT, `repro_${TAG}_${tile}_deephall.png`) });
    }

    // ---- (4) tile border: 17_25 -> 16_25 west at village latitude -----------
    await loadTile('17_25');
    summary.border_walk = await walkSampled(
      { x: -960.00, z: -2432.00 }, { x: -1005.00, z: -2432.00 }, 0, true, 40);
    await page.screenshot({ path: path.join(OUT, `repro_${TAG}_border.png`) });

    // ---- (4b) standing ON the neighbor tile (before any scene switch) ------
    // teleport onto 16_25; entryAt answers with the neighbor's data while
    // the neighbor MESH renders its raw (uncorrected) heightmap.
    await page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      p.set(-990.00, 0, -2432.00);
      p.y = w.heightAt(p.x, p.z, null);
      w.character.clearTarget();
      w.walkTo(p.clone());
      w.followCam.pitch = 0.14;
      w.followCam.dist = Math.max(w.followCam.minDist, 4.5);
    });
    await sleep(2500);   // let the lazy neighbor geodata land
    summary.neighbor_16_25 = await page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      const entry = w.neighbors && w.neighbors.entryAt(p.x, p.z);
      const meshes = [];
      if (w.terrain.mesh) meshes.push(w.terrain.mesh);
      if (w.neighbors) meshes.push(...w.neighbors.meshes());
      let meshY = null;
      const rc = new w.__Raycaster();
      const origin = p.clone(); origin.y += 80;
      rc.set(origin, new w.__Vector3(0, -1, 0));
      const hit = rc.intersectObjects(meshes, false)[0];
      meshY = hit ? +hit.point.y.toFixed(3) : null;
      return {
        charY: +p.y.toFixed(3), meshY,
        d: meshY == null ? null : +(p.y - meshY).toFixed(3),
        answers: entry ? entry.tile : w.currentTile,
        entryGeoLoaded: entry ? !!entry.geodata : null,
        walkH: +w.heightAt(p.x, p.z, p.y).toFixed(3),
        geoLayers: entry && entry.geodata
          ? entry.geodata._layersAt(Math.round(p.x * 100), Math.round(-p.z * 100))
              .map(l => l.height)
          : null,
      };
    });
    await page.screenshot({ path: path.join(OUT, `repro_${TAG}_neighbor.png`) });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 1));
})().catch(e => { console.error('REPRO FAILED:', e); process.exit(1); });
