// Headless verification for the walkable-world demo (port 8083).
// Drives the REAL UI: loads the _test scene, screenshots the spawn,
// left-clicks on the terrain (real raycast path), waits for the walk,
// screenshots again. Also checks the character stands ON the surface,
// WASD movement, and zoom/orbit camera sanity.
//
// Usage: node verify_app.js
// Output: verify_shots/*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const TILE = process.argv[2] || null;   // optional: pick this scene first
const TAG = TILE ? TILE.replace(/\W+/g, '_') + '_' : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });

    if (TILE) {
      await page.select('#scene-picker', TILE);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 120000 }, TILE);
    }
    await sleep(1500); // let camera settle

    const state = () => page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      return {
        pos: [p.x, p.y, p.z],
        ground: w.terrain.heightAtWorld(p.x, p.z),
        speed: w.character.speed,
        camY: w.camera.position.y,
        scenes: [...document.querySelectorAll('#scene-picker option')].map(o => o.value),
        chars: document.querySelectorAll('#char-picker option').length,
      };
    });

    summary.spawn = await state();
    summary.spawn.onGround = Math.abs(summary.spawn.pos[1] - summary.spawn.ground) < 0.01;
    await page.screenshot({ path: path.join(OUT, TAG + '01_spawn.png') });

    // zoomed-in close-up of the character
    await page.evaluate(() => {
      const w = window.__world;
      // shrink follow distance via synthetic wheel events
    });
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(640, 450);
      await page.mouse.wheel({ deltaY: -120 });
    }
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, TAG + '02_closeup.png') });
    // zoom back out
    for (let i = 0; i < 12; i++) await page.mouse.wheel({ deltaY: 120 });
    await sleep(800);

    // click-walk: click on terrain left-of-center (real raycast path)
    await page.mouse.click(400, 550);
    await sleep(1000);
    summary.midWalk = await state();
    await page.screenshot({ path: path.join(OUT, TAG + '02b_mid_walk.png') });
    await sleep(1);
    summary.afterClick = await state();
    // wait for arrival (speed back to 0)
    await page.waitForFunction('window.__world.character.speed === 0', { timeout: 25000 });
    await sleep(600);
    summary.afterWalk = await state();
    summary.afterWalk.onGround =
      Math.abs(summary.afterWalk.pos[1] - summary.afterWalk.ground) < 0.01;
    const dxz = Math.hypot(
      summary.afterWalk.pos[0] - summary.spawn.pos[0],
      summary.afterWalk.pos[2] - summary.spawn.pos[2]);
    summary.walkDistance = dxz;
    await page.screenshot({ path: path.join(OUT, TAG + '03_after_walk.png') });

    // WASD: hold W for 2s
    const before = await state();
    await page.keyboard.down('KeyW');
    await sleep(2000);
    await page.keyboard.up('KeyW');
    await sleep(400);
    const after = await state();
    summary.wasdDistance = Math.hypot(
      after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]);
    summary.wasdOnGround = Math.abs(after.pos[1] - after.ground) < 0.01;
    await page.screenshot({ path: path.join(OUT, TAG + '04_after_wasd.png') });

    // orbit view from another angle
    await page.mouse.move(640, 450);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(900, 380, { steps: 20 });
    await page.mouse.up({ button: 'right' });
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, TAG + '05_orbit.png') });
    summary.finalCam = (await state()).camY;

    // character picker: switch to darkelf_f via the real select element
    await page.select('#char-picker', 'darkelf_f');
    await page.waitForFunction(
      'window.__world.character && window.__world.character.actions.idle && document.getElementById("status").textContent.includes("darkelf_f")',
      { timeout: 15000 });
    await sleep(800);
    summary.switchedChar = await page.evaluate(() => ({
      pos: window.__world.character.group.position.toArray(),
      ground: window.__world.terrain.heightAtWorld(
        window.__world.character.group.position.x,
        window.__world.character.group.position.z),
    }));
    await page.screenshot({ path: path.join(OUT, TAG + '06_char_switch.png') });
  } finally {
    await browser.close();
  }
  // EXIT EXPLICITLY. MEASURED 2026-08-09: this suite finished all its work,
  // printed the complete summary below, and then sat at 0.0% CPU until the
  // battery's watchdog killed it at 300 s — a full run's worth of wall clock
  // burned AFTER the last useful line. `browser.close()` had already returned
  // (the summary prints after the finally block, and it printed), so the leak
  // is a handle that outlives the browser, not a hung teardown.
  //
  // This does NOT weaken the suite: a throw never reaches this line, and an
  // unhandled rejection still exits nonzero on its own. The callback form is
  // deliberate — process.exit() can truncate a pending stdout write when
  // stdout is a pipe, which is exactly how the battery runs it.
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n',
    () => process.exit(0));
})();
