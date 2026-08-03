// Phase C.1 verification — the retail StatusWnd inside the REAL game client.
//
// Loads the world client, waits for the scene, feeds it a selfStatus payload
// exactly as the bridge would, and screenshots the HUD over the 3D world.
// Also asserts the invented #self-status pill is gone and that the dev bar
// (which carries the Online toggle) is reachable and stays dismissed once
// dismissed.
//
// Usage: node verify_statuswnd.js     (needs editor/world/server.py on :8083)

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
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,860'],
  });
  const summary = { logs: [] };
  let failed = false;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 860 });
    page.on('console', m => summary.logs.push(m.text()));
    page.on('pageerror', e => { summary.logs.push('PAGEERROR: ' + e.message); failed = true; });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 45000 });
    await page.waitForFunction('window.__world.statusWnd', { timeout: 15000 });
    await sleep(600);

    // Feed a selfStatus exactly as the gateway sends it
    await page.evaluate(() => {
      window.__world.statusWnd.setName('Elbera');
      window.__world.statusWnd.update({
        hp: 342, maxHp: 620, mp: 118, maxMp: 380,
        cp: 210, maxCp: 240, level: 12, exp: 0.63, sp: 1450,
      });
    });
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'c1_statuswnd_live.png') });

    // Low HP swaps the warn texture in
    await page.evaluate(() => window.__world.statusWnd.update({
      hp: 74, maxHp: 620, mp: 40, maxMp: 380,
      cp: 0, maxCp: 240, level: 12, exp: 0.63,
    }));
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'c1_statuswnd_lowhp.png') });

    // Retail resize: width changes, height must not
    const resize = await page.evaluate(async () => {
      const { Skin } = await import('./js/ui/skin.js');
      const w = window.__world.statusWnd;
      const before = w.root.getBoundingClientRect();
      w.setWidth(320);
      const after = w.root.getBoundingClientRect();
      const gauge = w.rows.hp.el.getBoundingClientRect();
      w.setWidth(176);
      return {
        heightStable: Math.round(before.height) === Math.round(after.height),
        widthGrew: after.width > before.width,
        // data rule (has0 autosize block): gauge width = window width +
        // insetA, and insetA = -26 for all four StatusBars
        // (docs/xdat-tail-has0.md) -- so the expected delta is 26 * scale
        gaugeFollowed:
          Math.round(gauge.width) === Math.round(after.width) - 26 * Skin.scale,
      };
    });
    await page.evaluate(() => window.__world.statusWnd.setWidth(320));
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, 'c1_statuswnd_wide.png') });

    // The dev bar is not retail chrome, so it must be dismissible and the
    // dismissal must survive a reload. (It defaults to OPEN because it holds
    // the Online toggle -- hiding it by default locks the user out.)
    const devBar = await page.evaluate(() => {
      const hud = document.getElementById('hud');
      const shown = getComputedStyle(hud).display !== 'none';
      localStorage.setItem('l2vzla.devbar', '0');
      return { defaultOpen: shown };
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 45000 });
    devBar.hiddenAfterDismiss =
      await page.evaluate(() =>
        getComputedStyle(document.getElementById('hud')).display === 'none');
    await page.evaluate(() => localStorage.removeItem('l2vzla.devbar'));
    summary.devBar = devBar;

    // Window manager: movement, z-order and the Alt+Enter interface reset
    // (docs/ui-reverse-engineering.md §2-3)
    const mgr = await page.evaluate(() => {
      const w = window.__world.statusWnd;
      const el = w.root;
      const start = el.getBoundingClientRect();
      // simulate a drag by the window body
      const down = new PointerEvent('pointerdown',
        { bubbles: true, button: 0, clientX: start.left + 60, clientY: start.top + 6,
          pointerId: 1 });
      el.dispatchEvent(down);
      el.dispatchEvent(new PointerEvent('pointermove',
        { bubbles: true, clientX: start.left + 260, clientY: start.top + 180, pointerId: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      const moved = el.getBoundingClientRect();
      const persisted = !!JSON.parse(localStorage.getItem('l2vzla.wndpos') || '{}').StatusWnd;
      w.setWidth(300);
      const n = window.__world.wndMgr.resetAll();
      const afterReset = el.getBoundingClientRect();
      return {
        movedX: Math.round(moved.left - start.left),
        movedY: Math.round(moved.top - start.top),
        persisted,
        resetCount: n,
        backHome: Math.round(afterReset.left) === Math.round(start.left)
               && Math.round(afterReset.top) === Math.round(start.top),
        widthRestored: w.w === w.defaultW,
      };
    });
    summary.mgr = mgr;

    const dom = await page.evaluate(async () => ({
      uiScale: (await import('./js/ui/skin.js')).Skin.scale,
      oldPill: !!document.getElementById('self-status'),
      wnd: !!document.getElementById('l2-statuswnd'),
      devBarVisible: getComputedStyle(document.getElementById('hud')).display !== 'none',
      rect: (() => {
        const r = document.getElementById('l2-statuswnd').getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y),
                 w: Math.round(r.width), h: Math.round(r.height) };
      })(),
    }));
    summary.dom = dom;
    summary.resize = resize;

    const expect = {
      'StatusWnd present': dom.wnd,
      'invented #self-status pill removed': !dom.oldPill,
      'dev bar reachable (holds the Online toggle)': devBar.defaultOpen,
      'dev bar dismissal persists across reload': devBar.hiddenAfterDismiss,
      // DEVIATION (statuswnd.js place(), justified at statuswnd.js:259):
      // WindowsInfo.ini sources 444, but the sourced TargetStatusWnd dock
      // (337 + width 176) ends exactly at 513 — the sourced combination
      // overlaps by 69px, so this window butts against the target frame
      'StatusWnd dock (513,0; DEVIATION from sourced 444)':
        dom.rect.x === Math.round(513 * dom.uiScale) && dom.rect.y === 0,
      'height is the xdat 84 x uiScale': dom.rect.h === 84 * dom.uiScale,
      'resize keeps height fixed': resize.heightStable,
      'resize widens the window': resize.widthGrew,
      'gauges follow the width': resize.gaugeFollowed,
      'window is movable by drag': mgr.movedX > 150 && mgr.movedY > 100,
      'moved position persists': mgr.persisted,
      'Alt+Enter reset returns it home': mgr.backHome,
      'reset restores default width': mgr.widthRestored,
      'no page errors': !summary.logs.some(l => l.startsWith('PAGEERROR')),
    };
    summary.expect = expect;
    failed = failed || Object.values(expect).some(v => !v);
    for (const [k, v] of Object.entries(expect)) {
      console.log(`  ${v ? 'ok  ' : 'FAIL'}  ${k}`);
    }
  } catch (e) {
    summary.error = e.message;
    failed = true;
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(failed ? 'VERIFY C1: FAIL' : 'VERIFY C1: PASS');
  process.exit(failed ? 1 : 0);
})();
