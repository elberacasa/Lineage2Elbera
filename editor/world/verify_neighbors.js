// Neighbor-tile verification. For each area: teleport near a tile border,
// screenshot ACROSS it (no void — the neighbor's cheap basecolor terrain
// must be visible), click-to-move onto the NEIGHBOR terrain (raycast must
// hit it), then walk across the boundary asserting ground contact the whole
// way (no fall, no snap >2m) and that the entered tile becomes the new
// center (scene switch). Ends with a SwiftShader frame-cost comparison:
// 8 neighbors vs 0 (?neighbors=0).
//
// Usage: node verify_neighbors.js [tag]
// Output: verify_shots/neighbors_<tag>_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'now';
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 240000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// [tile, startL2(x,y), targetL2(x,y), label, camYaw, dir]
// dir -1: cross toward the lower-ty neighbor (border at (ty-18)*32768);
// dir +1: toward higher-ty (border at (ty+1-18)*32768).
// Crossings: 17_22 -> 17_21 at y = 131072, 17_25 -> 17_24 at y = 229376,
// 22_22 -> 22_23 at y = 163840 (x=86000: flattest Giran border approach,
// relief 4.4m — the south approach at x=90880 is a hill crest that
// occludes the border strip from any chase-cam position).
// followCam view direction is (sin yaw, 0, cos yaw): toward -y_l2 = +z_three
// is yaw 0, toward +y_l2 = -z_three is yaw PI.
// Walks are short (~60m): under SwiftShader the dt clamp makes real-time
// walking slow, and ground contact is what matters, not the distance.
const SPOTS = [
  ['17_22', [-80000, 133500], [-80000, 127500], 'gludio_17_22_to_17_21', 0, -1],
  ['17_25', [-92928, 231500], [-92928, 225500], 'ti_coast_17_25_to_17_24', 0, -1],
  ['22_22', [86000, 161340], [86000, 166340], 'giran_22_22_to_22_23', Math.PI, 1],
];
const WALK_TIMEOUT_MS = 240000;

async function waitScene(page, tile) {
  await page.waitForFunction(
    t => window.__world.currentTile === t
      && document.getElementById('loading').classList.contains('hidden'),
    { timeout: LOAD_TIMEOUT }, tile);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { shots: [], spots: {}, perf: {}, consoleErrors: [] };
  const fail = (msg) => { summary.failed = summary.failed || []; summary.failed.push(msg); };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => summary.consoleErrors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') summary.consoleErrors.push(m.text());
    });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });

    for (const [tile, start, target, label, camYaw, dir] of SPOTS) {
      await page.select('#scene-picker', tile);
      await waitScene(page, tile);
      await sleep(1200);

      // instrument target set/clear (walk-failure forensics)
      await page.evaluate(() => {
        const w = window.__world;
        window.__targetLog = [];
        const c = w.character;
        if (!c.__instrumented) {
          c.__instrumented = true;
          const oc = c.clearTarget.bind(c), os = c.setTarget.bind(c);
          c.clearTarget = () => {
            window.__targetLog.push(['clear',
              new Error().stack.split('\n')[2] || '']);
            oc();
          };
          c.setTarget = (p) => {
            window.__targetLog.push(['set', +p.x.toFixed(1), +p.z.toFixed(1)]);
            os(p);
          };
        }
      });

      // neighborhood sanity: every EXISTING neighbor loaded, each with a
      // mesh + single-texture material (or the flat fallback color)
      const nstate = await page.evaluate(() => {
        const w = window.__world;
        const out = { count: 0, entries: [] };
        if (!w.neighbors) return out;
        for (const [name, e] of w.neighbors.tiles) {
          out.count++;
          out.entries.push({
            name,
            mesh: !!e.mesh,
            textured: !!(e.mesh && e.mesh.material && e.mesh.material.map),
          });
        }
        return out;
      });
      summary.spots[label] = { neighbors: nstate };
      if (!nstate.count) fail(`${label}: no neighbor tiles loaded`);

      // stage character + camera near the border, looking across
      await page.evaluate(({ start, camYaw }) => {
        const w = window.__world;
        const p = w.character.group.position;
        p.set(start[0] * 0.01, 0, -start[1] * 0.01);
        p.y = w.heightAt(p.x, p.z);
        w.character.clearTarget();
        w.followCam.pitch = 0.42;
        w.followCam.dist = 14;
        w.followCam.yaw = camYaw;
      }, { start, camYaw });
      await sleep(2500);
      let file = `neighbors_${TAG}_${label}_before.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      summary.shots.push(file);

      // click-to-move ACROSS the border: click a visible point on neighbor
      // terrain for real, expect a walk target on the far side. Terrain can
      // occlude the border area from the chase cam (Giran's south hill), so
      // try a small set of candidate points and keep the first that lands
      // across the border.
      const borderY = (tile.split('_')[1] * 1 - 18 + (dir > 0 ? 1 : 0)) * 32768;
      let t = null;
      const across = () => t && (dir < 0
        ? (-t.z * 100) < borderY : (-t.z * 100) > borderY);
      // two passes: normal chase pitch, then near top-down (hillside spots
      // occlude the border strip from the low camera — the raycast itself
      // is what is being tested, not the camera angle)
      for (const clickPitch of [null, 1.15]) {
        if (clickPitch != null) {
          await page.evaluate((p) => { window.__world.followCam.pitch = p; }, clickPitch);
          await sleep(1200);
        }
        for (const past of [400, 150]) {
          for (const lat of [0, -2500, 2500]) {
            const clickL2 = [start[0] + lat, borderY + dir * past];
            const clicked = await page.evaluate(({ clickL2 }) => {
              const w = window.__world;
              const v = w.character.group.position.clone();
              v.set(clickL2[0] * 0.01, 0, -clickL2[1] * 0.01);
              v.y = w.heightAt(v.x, v.z);
              const px = w.project(v);
              return { px, behind: px.behind };
            }, { clickL2 });
            if (clicked.behind || clicked.px.x < 0 || clicked.px.x > 1280
                || clicked.px.y < 0 || clicked.px.y > 900) continue;
            await page.mouse.click(clicked.px.x, clicked.px.y);
            await sleep(400);
            t = await page.evaluate(() => {
              const w = window.__world;
              return w.character.target
                ? { x: w.character.target.x, z: w.character.target.z } : null;
            });
            if (across()) break;
          }
          if (across()) break;
        }
        if (clickPitch != null) {
          await page.evaluate((p) => { window.__world.followCam.pitch = p; }, 0.42);
          await sleep(800);
        }
        if (across()) break;
      }
      summary.spots[label].clickAcross = t;
      if (!across()) {
        fail(`${label}: click on neighbor terrain set no cross-border target`);
      }

      // walk across; sample ground contact at 4 Hz
      await page.evaluate(({ target }) => {
        const w = window.__world;
        const v = w.character.group.position.clone();
        v.set(target[0] * 0.01, 0, -target[1] * 0.01);
        v.y = w.heightAt(v.x, v.z);
        w.walkTo(v);
      }, { target });

      const samples = [];
      let midShot = false, switched = false, arrived = false, reissued = false;
      let reissuedStalls = 0, noTargetStreak = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < WALK_TIMEOUT_MS) {
        const s = await page.evaluate(() => {
          const w = window.__world;
          const p = w.character.group.position;
          return {
            x: p.x, y: p.y, z: p.z,
            ground: w.heightAt(p.x, p.z, p.y),
            speed: w.character.speed,
            tile: w.currentTile,
            hasTarget: !!w.character.target,
            loading: !w.terrain,   // scene switch in flight: heights read 0
            // the loading overlay hides only after the neighbor window is
            // fully rebuilt — mid-crossing shots wait for it
            overlayHidden: document.getElementById('loading').classList.contains('hidden'),
          };
        });
        samples.push(s);
        if (!s.loading) {
          if (!switched && s.tile !== tile) switched = true;
          // the scene switch clears the walk target — re-issue so the walk
          // continues to the destination on the new tile. `justReissued`
          // guards the break below: THIS sample predates the reissue.
          let justReissued = false;
          if (switched && !s.hasTarget && s.speed === 0 && reissuedStalls < 2) {
            reissuedStalls++;
            reissued = true;
            justReissued = true;
            await page.evaluate(({ target }) => {
              const w = window.__world;
              const v = w.character.group.position.clone();
              v.set(target[0] * 0.01, 0, -target[1] * 0.01);
              v.y = w.heightAt(v.x, v.z);
              w.walkTo(v);
            }, { target });
          }
          if (!midShot && switched && s.overlayHidden) {
            midShot = true;
            file = `neighbors_${TAG}_${label}_mid.png`;
            await page.screenshot({ path: path.join(OUT, file) });
            summary.shots.push(file);
          }
          const dx = s.x - target[0] * 0.01, dz = s.z - (-target[1] * 0.01);
          if (Math.hypot(dx, dz) < 1.5 && s.speed === 0) { arrived = true; break; }
          // gave up: no walk target and no movement for 6 consecutive
          // samples (covers both never-started and stopped-after-reissue)
          if (!justReissued && !s.hasTarget && s.speed === 0) {
            if (++noTargetStreak >= 6) break;
          } else {
            noTargetStreak = 0;
          }
        }
        await sleep(250);
      }

      file = `neighbors_${TAG}_${label}_after.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      summary.shots.push(file);

      // ground-contact audit over the samples (skip the scene-switch stall:
      // while the new center loads, terrain is null and heights read 0)
      let worstFloat = 0, worstStep = 0, nan = 0, prev = null;
      for (const s of samples) {
        if (s.loading) continue;
        if (!Number.isFinite(s.y) || !Number.isFinite(s.ground)) nan++;
        worstFloat = Math.max(worstFloat, Math.abs(s.y - s.ground));
        if (prev) worstStep = Math.max(worstStep, Math.abs(s.y - prev.y));
        prev = s;
      }
      const last = prev || {};
      summary.spots[label].walk = {
        samples: samples.length, switched, arrived, reissued,
        worstFloat: +worstFloat.toFixed(3),
        worstStep: +worstStep.toFixed(3),
        nan,
        endTile: last.tile,
        endGrounded: last.ground != null
          ? +Math.abs(last.y - last.ground).toFixed(3) : null,
        // debug trail on failure: where did the walk actually stop?
        trail: samples.slice(-6).map(s => ({
          x: +s.x.toFixed(1), z: +s.z.toFixed(1), y: +s.y.toFixed(2),
          speed: +s.speed.toFixed(2), t: s.tile, tgt: s.hasTarget, ld: s.loading,
        })),
      };
      if (!switched) fail(`${label}: scene never switched to the entered tile`);
      if (nan) fail(`${label}: NaN height samples (${nan})`);
      if (worstFloat > 0.25) fail(`${label}: char floated/sank ${worstFloat.toFixed(2)}m`);
      if (worstStep > 2.0) fail(`${label}: height snap ${worstStep.toFixed(2)}m between samples`);
      if (!arrived) {
        fail(`${label}: never arrived across the border`);
        summary.spots[label].targetLog = await page.evaluate(
          () => (window.__targetLog || []).slice(-12));
      }
    }

    // -- perf: 8 neighbors vs 0 on SwiftShader (22_22 has all 8) ----------
    // Fresh page on both sides, 2s warmup inside the window (shader
    // compile/settle), then 4s measured.
    const measure = () => page.evaluate(() => new Promise(res => {
      let frames = 0;
      let t0 = 0;
      const start = performance.now();
      const tick = () => {
        const now = performance.now();
        if (!t0 && now - start > 2000) t0 = now;      // warmup done
        if (t0) {
          frames++;
          if (now - t0 >= 4000) {
            const info = window.__world.renderer.info.render;
            res({
              avgFrameMs: +((now - t0) / frames).toFixed(1),
              fps: +(frames / 4).toFixed(1),
              drawCalls: info.calls,
              triangles: info.triangles,
            });
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.select('#scene-picker', '22_22');
    await waitScene(page, '22_22');
    await sleep(3000);
    summary.perf.withNeighbors = await measure();
    summary.perf.neighborCount = await page.evaluate(
      () => window.__world.neighbors ? window.__world.neighbors.tiles.size : 0);

    await page.goto(BASE + '?neighbors=0', { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.select('#scene-picker', '22_22');
    await waitScene(page, '22_22');
    await sleep(3000);
    summary.perf.bare = await measure();
    summary.perf.ratio = +(summary.perf.withNeighbors.avgFrameMs
      / summary.perf.bare.avgFrameMs).toFixed(2);
  } finally {
    await browser.close();
  }
  summary.verdict = summary.failed ? 'FAIL' : 'PASS';
  for (const e of summary.consoleErrors) {
    if (e.startsWith('PAGEERROR')) { summary.verdict = 'FAIL'; break; }
  }
  console.log(JSON.stringify(summary, null, 1));
  process.exit(summary.verdict === 'PASS' ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
