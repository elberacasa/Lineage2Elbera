// Interior (dungeon) rendering verification: 19_16 and 21_25 must render
// props with NO terrain plane occluding; dark ambience; player on the
// dungeon floor. 17_25 (outdoor) must be unaffected. Transition both
// ways must not leave stale state.
// Output: verify_shots/int_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    // puppeteer's default protocolTimeout is 180 s. This suite's own waits are
    // longer than that (a tile switch is given several minutes), so WITHOUT
    // this line the CDP call underneath waitForFunction times out first and the
    // wait fails with `Waiting failed / Runtime.callFunctionOn timed out`
    // BEFORE reaching its own deadline -- a suite failure that says nothing
    // about the world it was measuring. Observed 2026-08-08 in verify_feet
    // (line 169, timeout 300000) and verify_ground. Keep this >= the largest
    // timeout below.
    protocolTimeout: 900000,
    executablePath: CHROME,
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

    const loadTile = async (tile) => {
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        t => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 240000 }, tile);
      await sleep(2500);
    };
    const state = () => page.evaluate(() => {
      const w = window.__world;
      return {
        interior: w.terrain.interior,
        hasMesh: !!w.terrain.mesh,
        floorY: w.terrain.floorY,
        charY: +w.character.group.position.y.toFixed(2),
        props: w.terrain.props.length,
        fog: w.scene.fog ? [w.scene.fog.color.getHexString(), w.scene.fog.near, w.scene.fog.far] : null,
      };
    });

    // -- 19_16 dungeon -------------------------------------------------------
    await loadTile('19_16');
    summary['19_16'] = await state();
    await page.screenshot({ path: path.join(OUT, 'int_01_19_16.png') });
    // look around: orbit to see the architecture
    await page.mouse.move(640, 450);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(950, 400, { steps: 20 });
    await page.mouse.up({ button: 'right' });
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'int_02_19_16_orbit.png') });

    // -- 21_25 catacombs -------------------------------------------------------
    await loadTile('21_25');
    summary['21_25'] = await state();
    await page.screenshot({ path: path.join(OUT, 'int_03_21_25.png') });

    // -- transition back outdoors: no stale interior state ---------------------
    await loadTile('17_25');
    summary['17_25_after'] = await state();
    await page.screenshot({ path: path.join(OUT, 'int_04_17_25_outdoor.png') });

    // -- and back into the dungeon: no stale terrain ---------------------------
    await loadTile('19_16');
    summary['19_16_again'] = await state();
    await page.screenshot({ path: path.join(OUT, 'int_05_19_16_again.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY INTERIOR FAILED:', e.stack || e.message); process.exit(1); });
