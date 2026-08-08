// verify_movespeed.js — the CLIENT half of the movement fix, measured in the
// browser against the mock gateway (8085).
//
// gateway/test/verify-movement.js pins the server half: aCis moves a character
// at getMoveSpeed() = base speed x getMovementSpeedMultiplier(), and both
// numbers ride UserInfo as separate fields. This script asks the other
// question — does the browser actually DRAW that? — by sampling
// character.group.position while it walks a straight leg.
//
// It also pins the stance: aCis has one flag (Creature.isRunning) and no
// distance rule, so a 3 m click and a 30 m click must be drawn at the same
// speed. The client used to walk anything under 6 m.
//
// Usage: node verify_movespeed.js      (mock gateway must be running on 8085)
'use strict';

const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// Walk a leg of `metres` in +X and return the drawn speed in m/s, measured as
// the least-squares slope of distance against time over the samples where the
// character was actually moving. (Same estimator as the server-side script, and
// for the same reason: a single interval is at the mercy of frame timing.)
async function drawnSpeed(page, metres) {
  await page.evaluate((m) => {
    const w = window.__world;
    const p = w.character.group.position;
    const V = p.constructor;
    w.walkTo(new V(p.x + m, p.y, p.z));
  }, metres);
  const pts = [];
  for (let i = 0; i < 14; i++) {
    pts.push(await page.evaluate(() => {
      const p = window.__world.character.group.position;
      return { t: performance.now() / 1000, x: p.x, z: p.z };
    }));
    await sleep(120);
  }
  // longest stretch that moved
  let best = null, start = 0;
  for (let i = 1; i <= pts.length; i++) {
    const moved = i < pts.length
      && Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) > 1e-4;
    if (!moved) {
      if (i - start >= 4 && (!best || i - start > best.n)) best = { s: start, e: i - 1, n: i - start };
      start = i;
    }
  }
  if (!best) return null;
  let s = 0; const xs = [], ys = [];
  for (let i = best.s; i <= best.e; i++) {
    if (i > best.s) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    xs.push(pts[i].t); ys.push(s);
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 0 ? num / den : null;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.connected
       && window.__world.net.log.some(m => m.op === 'charSheet')`, { timeout: 20000 });
    await sleep(1500);

    const sheet = await page.evaluate(() => {
      const w = window.__world;
      const s = w.net.log.filter((m) => m.op === 'charSheet').pop();
      const c = w.character;
      return {
        opRun: s.runSpeed, opWalk: s.walkSpeed, opMul: s.speedMul, opRunning: s.running,
        run: c.runSpeed, walk: c.walkSpeed, mul: c.speedMul, mode: c.moveMode,
      };
    });

    // L2_TO_M is 0.01 (coords.js): 1 L2 unit = 1 cm.
    const expectRun = sheet.opRun * sheet.opMul * 0.01;
    check('the character\'s run speed is base x multiplier, not base',
      Math.abs(sheet.run - expectRun) < 1e-6,
      `charSheet ${sheet.opRun} x ${sheet.opMul} -> ${expectRun.toFixed(4)} m/s; ` +
      `character.runSpeed ${sheet.run.toFixed(4)} (base alone would be ` +
      `${(sheet.opRun * 0.01).toFixed(4)})`);
    check('the walk/run stance comes from the server\'s isRunning byte',
      sheet.mode === (sheet.opRunning ? 'run' : 'walk'),
      `charSheet.running=${sheet.opRunning} -> moveMode=${sheet.mode}`);

    const far = await drawnSpeed(page, 30);
    check('a 30 m leg is DRAWN at the server\'s speed',
      far != null && Math.abs(far - expectRun) / expectRun < 0.06,
      far != null ? `${far.toFixed(3)} m/s vs ${expectRun.toFixed(3)} expected `
        + `(${(100 * (far - expectRun) / expectRun).toFixed(1)}%)` : 'no samples');

    await sleep(800);
    const near = await drawnSpeed(page, 3);
    check('a 3 m leg is drawn at the SAME speed (no distance rule)',
      near != null && Math.abs(near - expectRun) / expectRun < 0.08,
      near != null ? `${near.toFixed(3)} m/s vs ${expectRun.toFixed(3)} expected; ` +
        `the old 6 m threshold would have walked it at ${sheet.walk.toFixed(3)}` : 'no samples');
  } catch (e) {
    console.error('verify_movespeed error:', (e && e.stack) || e);
    failures.push('exception');
  } finally {
    await browser.close();
  }
  console.log(`\nVERIFY-MOVESPEED: ${failures.length ? 'FAIL (' + failures.join('; ') + ')' : 'PASS'}` +
    `  [${pass} passed, ${failures.length} failed]`);
  process.exit(failures.length ? 1 : 0);
})();
