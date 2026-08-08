// UI geometry audit — what the client RENDERS vs what Interface.xdat DECLARES.
//
// The port's rule is that every pixel comes from the client's own data, so a
// window is correct only when the rectangle it paints on screen equals the
// rectangle the xdat records for it. This script measures the first and prints
// it beside the second, in retail pixels, with the delta.
//
// Method:
//   * getBoundingClientRect() every descendant of a window's root, expressed
//     RELATIVE TO THE ROOT and divided by Skin.scale, so the numbers are
//     directly comparable with interface.json (which is retail px).
//   * the mined side comes from /gamedata/interface.json, the same file the
//     client reads through Layout — no second transcription of the values.
//   * elements are matched to controls by an explicit map per window (the DOM
//     carries no control names), so a row is only printed when the pairing is
//     unambiguous.
//
// Usage: node verify_uigeom_wnd.js [outdir]     (needs server.py on :8083)

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:8083/';
const OUT = process.argv[2] || path.join(__dirname, 'ui_geom_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Alt+letter opens these; the client's handler switches on event.code.
const WINDOW_KEYS = [
  ['KeyV', 'inventory'],
  ['KeyK', 'skills'],
  ['KeyT', 'charsheet'],
  ['KeyC', 'actions'],
  ['KeyU', 'quests'],
  ['KeyP', 'party'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1600,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ERR ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__world && window.__world.ready === true,
                             { timeout: 120000 });
  await page.waitForFunction(() => window.__world.statusWnd, { timeout: 20000 });
  await sleep(1500);

  // A populated HUD: the empty one hides every text control and half the
  // geometry with it.
  await page.evaluate(() => {
    const w = window.__world.statusWnd;
    w.setName('Elbera');
    w.update({ hp: 342, maxHp: 620, mp: 118, maxMp: 380,
               cp: 210, maxCp: 240, level: 12, exp: 0.63, sp: 1450 });
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'hud.png') });

  // Per-window geometry report
  const report = await page.evaluate(async () => {
    const { Skin } = await import('./js/ui/skin.js');
    const iface = await fetch('/gamedata/interface.json').then(r => r.json());
    const byWin = {};
    for (const w of iface.windows) {
      const flat = {};
      const walk = (n) => { flat[n.name] = n; (n.children || []).forEach(walk); };
      (w.children || []).forEach(walk);
      byWin[w.name] = { win: w, ctrl: flat };
    }
    const S = Skin.scale;
    const rel = (el, root) => {
      const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
      return { x: +((a.left - b.left) / S).toFixed(1),
               y: +((a.top - b.top) / S).toFixed(1),
               w: +(a.width / S).toFixed(1), h: +(a.height / S).toFixed(1) };
    };
    const out = { scale: S, windows: {} };

    const add = (winName, rows, rootEl) => {
      const m = byWin[winName] || { win: {}, ctrl: {} };
      const rb = rootEl.getBoundingClientRect();
      out.windows[winName] = {
        rootScreen: { left: Math.round(rb.left), top: Math.round(rb.top),
                      w: +(rb.width / S).toFixed(1), h: +(rb.height / S).toFixed(1) },
        minedWindow: { w: m.win.width, h: m.win.height },
        rows: rows.filter(r => r.el).map(({ ctrl, el }) => {
          const r = rel(el, rootEl);
          const c = m.ctrl[ctrl] || {};
          return { ctrl, rendered: r,
                   mined: { x: c.x, y: c.y, w: c.width, h: c.height },
                   autosize: c.autosize || null, insets: c.insets || null };
        }),
      };
    };

    const W = window.__world;

    // --- StatusWnd ---
    const sw = W.statusWnd;
    if (sw) {
      add('StatusWnd', [
        { ctrl: 'StatusWndLeftTex', el: sw.bandL },
        { ctrl: 'StatusWndCenterTex', el: sw.bandC },
        { ctrl: 'StatusWndRightTex', el: sw.bandR },
        { ctrl: 'StatusWnd_LevelTextBox_back', el: sw.levelEl },
        { ctrl: 'UserName', el: sw.nameEl },
        { ctrl: 'CPBar', el: sw.rows.cp.el },
        { ctrl: 'HPBar', el: sw.rows.hp.el },
        { ctrl: 'MPBar', el: sw.rows.mp.el },
        { ctrl: 'EXPBar', el: sw.rows.exp.el },
      ], sw.root);
      out.windows.StatusWnd.gaugeLabels = Object.fromEntries(
        Object.entries(sw.labels || {}).map(([k, el]) => [k, !!el.firstChild]));
    }

    // --- MenuWnd ---
    const mw = W.menuWnd;
    if (mw) {
      const rows = [];
      mw.root.querySelectorAll('.menu-btn').forEach(el =>
        rows.push({ ctrl: el.dataset.id, el }));
      add('MenuWnd', rows, mw.root);
      out.windows.MenuWnd.bandCount =
        mw.root.querySelectorAll('div:not(.menu-btn)').length;
      out.windows.MenuWnd.buttonsAreText =
        [...mw.root.querySelectorAll('.menu-btn')]
          .every(e => !/url\(/.test(e.style.backgroundImage || ''));
    }

    // --- ShortcutWnd slot pitch ---
    const sc = W.shortcutWnd;
    if (sc && sc.root) {
      const cells = [...sc.root.querySelectorAll('.shortcut-slot')];
      out.shortcut = {
        rootScreen: (() => { const r = sc.root.getBoundingClientRect();
          return { left: Math.round(r.left), top: Math.round(r.top),
                   w: +(r.width / S).toFixed(1), h: +(r.height / S).toFixed(1) }; })(),
        slotX: cells.map(c => +((c.getBoundingClientRect().left
                 - sc.root.getBoundingClientRect().left) / S).toFixed(1)),
      };
    }

    // --- open-window docks (the cascade complaint) ---
    const docks = {};
    for (const [k, o] of Object.entries({
      InventoryWnd: W.inventory, MagicSkillWnd: W.skillWnd,
      ActionWnd: W.actionWnd, QuestListWnd: W.questWnd,
      MinimapWnd: W.minimapWnd, PartyWnd: W.partyWnd,
      ClanWnd: W.clanWnd, AbnormalStatusWnd: W.abnormalWnd,
    })) {
      const el = o && (o.root || (o.win && o.win.root));
      if (!el) continue;
      const r = el.getBoundingClientRect();
      docks[k] = { left: Math.round(r.left), top: Math.round(r.top),
                   w: Math.round(r.width / S), h: Math.round(r.height / S),
                   visible: el.style.display !== 'none' };
    }
    out.docks = docks;
    return out;
  });

  // One shot per window, opened ALONE: a window judged through a stack of
  // others tells you nothing about its own art.
  for (const [code, name] of WINDOW_KEYS) {
    await page.evaluate((c) => window.dispatchEvent(
      new KeyboardEvent('keydown', { code: c, altKey: true, bubbles: true })), code);
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, `wnd-${name}.png`) });
    await page.evaluate((c) => window.dispatchEvent(
      new KeyboardEvent('keydown', { code: c, altKey: true, bubbles: true })), code);
    await sleep(250);
  }

  // Open every window and record the screen rects, which is where the
  // cascade complaint lives.
  for (const [code] of WINDOW_KEYS) {
    await page.evaluate((c) => window.dispatchEvent(
      new KeyboardEvent('keydown', { code: c, altKey: true, bubbles: true })), code);
    await sleep(500);
  }
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'all-windows.png') });

  report.openDocks = await page.evaluate(() => {
    const S = 1;
    const o = {};
    for (const [k, w] of Object.entries({
      InventoryWnd: window.__world.inventory, MagicSkillWnd: window.__world.skillWnd,
      MainWnd: window.__world.charSheetWnd, ActionWnd: window.__world.actionWnd,
      QuestListWnd: window.__world.questWnd, PartyWnd: window.__world.partyWnd,
    })) {
      const el = w && (w.root || (w.win && w.win.root));
      if (!el || el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      o[k] = { left: Math.round(r.left), top: Math.round(r.top),
               w: Math.round(r.width / S), h: Math.round(r.height / S),
               z: +el.style.zIndex || 0 };
    }
    return o;
  });

  report.consoleErrors = errs;
  fs.writeFileSync(path.join(OUT, 'geom.json'), JSON.stringify(report, null, 1));

  // --- printed table ---
  const d = (r, m) => (m == null ? '—' : (r - m).toFixed(1));
  for (const [name, w] of Object.entries(report.windows)) {
    console.log(`\n${name}  root@(${w.rootScreen.left},${w.rootScreen.top}) `
      + `${w.rootScreen.w}x${w.rootScreen.h}  mined ${w.minedWindow.w}x${w.minedWindow.h}`);
    console.log('  control                       rendered x,y  w,h        '
      + 'mined x,y  w,h        delta');
    for (const r of w.rows) {
      const R = r.rendered, M = r.mined;
      console.log(`  ${r.ctrl.padEnd(28)} `
        + `${String(R.x).padStart(6)},${String(R.y).padStart(5)} `
        + `${String(R.w).padStart(6)},${String(R.h).padStart(5)}  `
        + `${String(M.x ?? '—').padStart(6)},${String(M.y ?? '—').padStart(5)} `
        + `${String(M.w ?? '—').padStart(6)},${String(M.h ?? '—').padStart(5)}   `
        + `dx=${d(R.x, M.x)} dy=${d(R.y, M.y)} dw=${d(R.w, M.w)} dh=${d(R.h, M.h)}`);
    }
  }
  console.log('\nopen-window screen rects (cascade check):');
  for (const [k, v] of Object.entries(report.openDocks)) {
    console.log(`  ${k.padEnd(16)} @(${v.left},${v.top}) ${v.w}x${v.h} z=${v.z}`);
  }
  if (report.shortcut) console.log('\nshortcut slots x:', report.shortcut.slotX.join(' '));
  console.log('\nconsole errors:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(`\nshots + geom.json -> ${OUT}`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
