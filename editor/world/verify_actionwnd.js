// ActionWnd verification (mock gateway on 8085): Alt+C opens the retail
// actions window with three sections (17 basic / 7 party / 12 social from
// actionname.json categories 1/2/3), a cell click sends the 'action' op,
// right-click assigns an ACTION slot on the shortcut bar, F-key retriggers
// it, and a social action (id 2..13) echoes socialAction -> dance emote.
// Output: verify_shots/act_*.png + JSON summary.
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

    // -- Alt+C opens the window with all three sections populated ------------
    await page.keyboard.down('Alt'); await page.keyboard.press('c'); await page.keyboard.up('Alt');
    await sleep(600);
    summary.window = await page.evaluate(() => ({
      visible: window.__world.actionWnd.visible,
      counts: window.__world.actionWnd.counts(),
      cells: document.querySelectorAll('#l2-actionwnd .l2-action-cell').length,
      registered: window.__world.wndMgr.names.includes('ActionWnd'),
    }));
    await page.screenshot({ path: path.join(OUT, 'act_01_window.png') });

    // -- click Sit/Stand (id 0, first basic cell) -> action op out ------------
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="0"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'action'
        && m.actionId === 0)`, { timeout: 8000 });
    summary.clicked = { actionOpSent: true };

    // -- right-click Victory (id 13, social) -> ACTION slot on the bar --------
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="13"]')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(500);
    summary.assigned = await page.evaluate(() => ({
      data: window.__world.shortcutWnd.data,
      filled: document.querySelectorAll('.shortcut-slot:not(.empty)').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'act_02_assign.png') });

    // -- F1 triggers the action slot -> second action op + socialAction echo --
    const clipBefore = await page.evaluate(() => (
      window.__world.character.current
        ? window.__world.character.current.getClip().name : null));
    await page.keyboard.press('F1');
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'action'
        && m.actionId === 13).length >= 1`, { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'socialAction'
        && m.actionId === 13)`, { timeout: 8000 });
    await sleep(300);
    summary.social = await page.evaluate(() => ({
      echo: true,
      clip: window.__world.character.current
        ? window.__world.character.current.getClip().name : null,
    }));
    summary.social.clipBefore = clipBefore;
    await page.screenshot({ path: path.join(OUT, 'act_03_social.png') });

    // -- Alt+C again closes ---------------------------------------------------
    await page.keyboard.down('Alt'); await page.keyboard.press('c'); await page.keyboard.up('Alt');
    await sleep(400);
    summary.closed = await page.evaluate(() => !window.__world.actionWnd.visible);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY ACTION FAILED:', e.message); process.exit(1); });
