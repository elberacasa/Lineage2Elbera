// MinimapWnd verification.
//
// Part 1 (node, no browser): the georeference SELF-TEST — the manifest's
// 6 world->px anchors must project through the formula (constants read
// from minimap.json, never retyped) with residuals <= 15 px, the bound
// the research measured (docs/minimap-mapping.md §2). A bad formula fails
// here, not in front of the user.
//
// Part 2 (browser, mock gateway on 8085): MenuWnd's Map button opens the
// window; the current-tile 3x3 composition renders; the self marker
// follows a walk; moving the character across a tile boundary swaps the
// center crop (TI village 17_25, Giran 22_22); the expand overlay shows
// the assembled world map.
//
// Usage: node verify_minimap.js
// Output: verify_shots/mm_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const MANIFEST = path.join(__dirname, '..', '..', 'assets', 'gamedata', 'minimap.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = { consoleLogs: [] };

  // -- part 1: projection anchors ------------------------------------------
  const meta = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const g = meta.worldmap.georeference;
  const anchors = {};
  let maxResidual = 0;
  for (const [name, a] of Object.entries(meta.anchors)) {
    const px = (a.world[0] - g.X0) / g.S;
    const py = (a.world[1] - g.Y0) / g.S;
    const res = Math.hypot(px - a.px[0], py - a.px[1]);
    anchors[name] = +res.toFixed(2);
    maxResidual = Math.max(maxResidual, res);
  }
  summary.anchors = { residuals: anchors, max: +maxResidual.toFixed(2), tol: 15 };
  if (maxResidual > 15) {
    console.log(JSON.stringify(summary, null, 2));
    console.error('VERIFY MINIMAP FAILED: anchor residual over tolerance');
    process.exit(1);
  }

  // -- part 2: the window ----------------------------------------------------
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.connected && window.__world.net.selfId', { timeout: 15000 });
    await sleep(2000);

    // -- MenuWnd Map button opens the window ---------------------------------
    summary.mapButton = await page.evaluate(() => ({
      disabled: document.querySelector('.menu-btn[data-id="BtnMap"]')
        .classList.contains('disabled'),
    }));
    await page.click('.menu-btn[data-id="BtnMap"]');
    await page.waitForFunction(
      `window.__world.minimapWnd.visible
       && window.__world.minimapWnd.currentTile`, { timeout: 10000 });
    await sleep(800);   // tiles decode, markers tick
    summary.window = await page.evaluate(() => {
      const w = window.__world;
      const m = w.minimapWnd;
      const c = w.character.group.position;
      const p = m.projectTile(c.x / 0.01, -c.z / 0.01);
      return {
        visible: m.visible,
        tile: m.currentTile,
        tilesRendered: document.querySelectorAll('.l2-minimap-tile').length,
        dots: m._dots.length,
        registered: w.wndMgr.names.includes('MinimapWnd'),
        // the player stands INSIDE the current tile, so the projection must
        // land in the center tile's rect [crop, 2*crop] of the 3x3
        selfInCenterTile: p.x >= m.crop && p.x <= 2 * m.crop
          && p.y >= m.crop && p.y <= 2 * m.crop,
      };
    });
    await page.screenshot({ path: path.join(OUT, 'mm_01_window.png') });

    // -- marker follows a walk -------------------------------------------------
    const before = await page.evaluate(() => {
      const w = window.__world;
      const el = document.querySelector('.l2-minimap-self');
      return {
        px: parseFloat(el.style.left), py: parseFloat(el.style.top),
        pos: w.character.group.position.toArray(),
      };
    });
    await page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      // 25 m toward +x_three / -z_three (= +x_L2/+y_L2, map down-right)
      w.walkTo(new (p.constructor)(p.x + 17.7, p.y, p.z - 17.7));
    });
    await sleep(4500);
    const after = await page.evaluate(() => {
      const w = window.__world;
      const el = document.querySelector('.l2-minimap-self');
      return {
        px: parseFloat(el.style.left), py: parseFloat(el.style.top),
        pos: w.character.group.position.toArray(),
      };
    });
    summary.walk = {
      movedPx: +Math.hypot(after.px - before.px, after.py - before.py).toFixed(2),
      // L2 +x maps to image +x, L2 +y to image +y (docs §2): both grow here
      dirOk: after.px > before.px && after.py > before.py,
      movedWorld: +Math.hypot(after.pos[0] - before.pos[0],
                              after.pos[2] - before.pos[2]).toFixed(2),
    };
    await page.screenshot({ path: path.join(OUT, 'mm_02_walk.png') });

    // -- tile switch: TI village (17_25), then Giran (22_22) ------------------
    const setPos = (x, y) => page.evaluate(([wx, wy]) => {
      const c = window.__world.character;
      c.clearTarget();
      c.group.position.set(wx * 0.01, c.group.position.y, -wy * 0.01);
    }, [x, y]);

    await setPos(-84141, 244623);   // TI village teleport (manifest anchor)
    await sleep(1200);
    summary.tiVillage = await page.evaluate(() => ({
      tile: window.__world.minimapWnd.currentTile,
      center: document.querySelector('.l2-minimap-tile[data-tile="17_25"]')
        ? 'rendered' : 'missing',
    }));
    await page.screenshot({ path: path.join(OUT, 'mm_03_ti_village.png') });

    await setPos(83314, 148012);    // Town of Giran (manifest anchor)
    await sleep(1200);
    summary.giran = await page.evaluate(() => ({
      tile: window.__world.minimapWnd.currentTile,
      center: document.querySelector('.l2-minimap-tile[data-tile="22_22"]')
        ? 'rendered' : 'missing',
    }));
    await page.screenshot({ path: path.join(OUT, 'mm_04_giran.png') });

    // -- expand overlay --------------------------------------------------------
    await page.evaluate(() => {
      document.querySelector('.l2-minimap-btn[data-id="ExpandButton"]').click();
    });
    await sleep(800);
    summary.expand = await page.evaluate(() => {
      const ov = document.getElementById('l2-minimap-expand');
      const img = ov.querySelector('img');
      return {
        visible: ov.style.display === 'block',
        worldmap: img ? img.src.includes('worldmap.png') : false,
        loaded: img ? img.complete && img.naturalWidth > 0 : false,
      };
    });
    await page.screenshot({ path: path.join(OUT, 'mm_05_expand.png') });
    await page.evaluate(() => window.__world.minimapWnd.showExpand(false));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY MINIMAP FAILED:', e.message); process.exit(1); });
