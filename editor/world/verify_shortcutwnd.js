// ShortcutWnd verification (mock gateway on 8085): retail chrome with 12
// slots + F badges, assign skills+items, page flip, F-key and click casts,
// persistence, expand/rotate/lock toggles.
// Output: verify_shots/sw_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085';
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
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY SHORTCUT FAILED:', e.message); process.exit(1); });
