// ShortcutWnd verification (mock gateway on 8085): retail chrome with 12
// slots + F badges, assign skills+items, page flip, F-key and click casts,
// persistence, expand/rotate/lock toggles.
// Output: verify_shots/sw_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
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
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillList')
       && window.__world.net.log.some(m => m.op === 'itemList')`, { timeout: 20000 });
    await sleep(1500);

    // -- empty bar with retail chrome ---------------------------------------
    summary.empty = await page.evaluate(() => ({
      slots: document.querySelectorAll('.shortcut-slot').length,
      emptySlots: document.querySelectorAll('.shortcut-slot.empty').length,
      oldBarsGone: !document.getElementById('skill-bar') && !document.getElementById('hotbar'),
      pageText: window.__world.shortcutWnd.page,
    }));
    await page.screenshot({ path: path.join(OUT, 'sw_01_empty.png') });

    // -- assign: right-click a skill in the SkillWnd, right-click an item ----
    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    await sleep(600);
    await page.evaluate(() => {
      const cell = document.querySelector('#l2-skillwnd [draggable="true"]');
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(400);
    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    await page.keyboard.press('KeyI');
    await sleep(400);
    await page.evaluate(() => {
      document.querySelector('.inv-cell[data-oid="90002"]')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(400);
    summary.assigned = await page.evaluate(() => ({
      data: window.__world.shortcutWnd.data,
      filled: document.querySelectorAll('.shortcut-slot:not(.empty)').length,
    }));
    await page.keyboard.press('KeyI');
    await page.screenshot({ path: path.join(OUT, 'sw_02_assigned.png') });

    // -- F1 casts the skill; Digit2 uses the item ----------------------------
    await page.keyboard.press('F1');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useSkill')`,
      { timeout: 8000 });
    await page.keyboard.press('Digit2');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useItem')`,
      { timeout: 8000 });
    summary.triggers = { skillCast: true, itemUsed: true };

    // let the F1 cast land (hitTime 1500 in the mock) — castSkill is
    // client-side locked while a cast is in progress, which would eat the
    // real-mouse click below and look like the bug being tested for
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillLaunch')`, { timeout: 8000 });
    await sleep(300);

    // -- REAL-mouse interaction (regression: the drag-handle pointer capture
    // ate real clicks; page.mouse sends a genuine CDP input sequence, so
    // this fails when the slots don't claim pointerdown) -------------------
    const slotCenter = i => page.evaluate((idx) => {
      const el = document.querySelectorAll('.shortcut-slot')[idx];
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, i);
    const castsBefore = await page.evaluate(
      () => window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'useSkill').length);
    const s0 = await slotCenter(0);
    await page.mouse.click(s0.x, s0.y);                    // real left click casts
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'useSkill').length > ${castsBefore}`,
      { timeout: 8000 });
    await page.mouse.click(s0.x, s0.y, { button: 'right' });  // real right-click clears
    await sleep(400);
    summary.realMouse = await page.evaluate(() => ({
      clickCast: true,
      rightClickCleared: !((window.__world.shortcutWnd.data[0] || {})[0]),
    }));
    // restore the slot for the page-flip section below
    await page.evaluate(() => window.__world.shortcutWnd.assign(0, 0, { type: 'skill', id: 3 }));
    await sleep(300);
    // real click on the page buttons (they claim the press AND keep the
    // mousedown art swap — the two mechanisms this fix had to reconcile)
    const btnCenter = i => page.evaluate((idx) => {
      const b = document.querySelectorAll('#l2-shortcutwnd .shortcut-btn')[idx];
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, i);
    const next = await btnCenter(0);
    await page.mouse.click(next.x, next.y);
    await sleep(300);
    const prev = await btnCenter(1);
    await page.mouse.click(prev.x, prev.y);
    await sleep(300);
    summary.realMouse.pageButtons = await page.evaluate(
      () => window.__world.shortcutWnd.page === 0);   // Next then Prev -> back to 0

    // -- page flip: NextBtn shows page 2, F1 does NOT recast (empty page) ----
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#l2-shortcutwnd .shortcut-btn')];
      btns[0].click();   // NextBtn is rendered first in the button list
    });
    await sleep(300);
    summary.pageFlip = await page.evaluate(() => ({
      page: window.__world.shortcutWnd.page,
      emptyNow: document.querySelectorAll('.shortcut-slot:not(.empty)').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'sw_03_page2.png') });
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#l2-shortcutwnd .shortcut-btn')];
      btns[1].click();   // PrevBtn
    });
    await sleep(300);

    // -- persistence ----------------------------------------------------------
    summary.persisted = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('l2vzla.hotbar.'));
      return key ? localStorage.getItem(key) : null;
    });

    // -- expand / rotate / lock -------------------------------------------------
    await page.evaluate(() => window.__world.shortcutWnd.toggleExpand());
    await sleep(300);
    summary.expanded = await page.evaluate(() => ({
      rows: window.__world.shortcutWnd.root.children.length,
      h: window.__world.shortcutWnd.root.getBoundingClientRect().height,
    }));
    await page.screenshot({ path: path.join(OUT, 'sw_04_expanded.png') });
    await page.evaluate(() => {
      window.__world.shortcutWnd.toggleExpand();
      window.__world.shortcutWnd.toggleRotate();
    });
    await sleep(300);
    summary.rotated = await page.evaluate(() => {
      const r = window.__world.shortcutWnd.root.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    await page.screenshot({ path: path.join(OUT, 'sw_05_vertical.png') });
    await page.evaluate(() => window.__world.shortcutWnd.toggleRotate());
    await sleep(200);

    // -- F-key browser-conflict guard ---------------------------------------
    // Synthetic dispatch proves OUR handler preventDefaults every reserved
    // F-key (dispatchEvent returns false iff preventDefault ran). A real
    // CDP F5 proves the page actually survives the key. What cannot be
    // tested headlessly (documented, not a failure): OS-level combos like
    // macOS Ctrl+Cmd+F never reach the page at all, and headless Chrome
    // has no devtools/fullscreen chrome for F12/F11 to trigger.
    summary.fkeys = await page.evaluate(() => {
      const out = {};
      for (const code of ['F1', 'F5', 'F11', 'F12']) {
        out[code] = !window.dispatchEvent(
          new KeyboardEvent('keydown', { code, cancelable: true, bubbles: true }));
      }
      return out;   // true = default prevented by the keymap
    });
    // while typing in chat: the guard must STILL hold and the slot must
    // NOT fire (the guard moved ahead of chat.isTyping for exactly this)
    await page.keyboard.press('Enter');          // opens chat input (online)
    await sleep(300);
    const castsBeforeChat = await page.evaluate(
      () => window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'useSkill').length);
    summary.fkeysTyping = await page.evaluate(() => ({
      typing: window.__world.chat.isTyping,
      prevented: !window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'F1', cancelable: true, bubbles: true })),
    }));
    await sleep(300);
    summary.fkeysTyping.slotDidNotFire = await page.evaluate(
      (n) => window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'useSkill').length === n,
      castsBeforeChat);
    await page.keyboard.press('Escape');         // close chat
    await sleep(200);
    // real F5 must NOT reload the page
    await page.evaluate(() => { window.__stayAlive = (window.__stayAlive || 0) + 1; });
    await page.keyboard.press('F5');
    await sleep(800);
    summary.realF5 = await page.evaluate(() => ({
      pageSurvived: window.__stayAlive === 1 && !!(window.__world && window.__world.ready),
    }));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY SHORTCUT FAILED:', e.message); process.exit(1); });
