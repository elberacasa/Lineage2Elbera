// MultiSellWnd verification (mock gateway on 8085). Flow:
//   bypass npc_multisell -> multisellList opens the window (2 entries,
//   one affordable, one grayed + unclickable); inventory HIDES (the .uc)
//   click the affordable entry -> products + ingredients (owned/required)
//   dblclick -> amount prompt (NumberPad stand-in) -> multisellChoose op
//   invUpdate is the ONLY inventory truth; the list re-send is a REFRESH
//   (selection kept by entryId, ingredient counts re-tinted)
//   over-ingredient choose -> sysMsg 351, inventory untouched
// Output: verify_shots/multisell_*.png + JSON summary.
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
      `window.__world.net.log.some(m => m.op === 'itemList')`, { timeout: 20000 });
    await sleep(1200);

    const dbl = (sel) => page.evaluate((s) => {
      document.querySelector(s).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, sel);
    const clk = (sel) => page.evaluate((s) => {
      document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, sel);

    // -- open: multisellList IS the opener (the merchant bypass drives it) ---
    await page.evaluate(() => window.__world.inventory.toggle(true));
    await page.evaluate(() => window.__world.net.sendOp('bypass', { command: 'npc_multisell' }));
    await page.waitForFunction(
      'window.__world.multiSellWnd.visible && window.__world.multiSellWnd.items.length === 2',
      { timeout: 10000 });
    await sleep(800);
    summary.list = await page.evaluate(() => ({
      visible: window.__world.multiSellWnd.visible,
      listId: window.__world.multiSellWnd.listId,
      cells: document.querySelectorAll('.l2-multisell-cell').length,
      grayed: [...document.querySelectorAll('.l2-multisell-cell')]
        .map(c => c.style.opacity),
      iconsLoaded: [...document.querySelectorAll('.l2-multisell-cell img')]
        .filter(i => i.complete && i.naturalWidth > 0).length,
      // the .uc hides the inventory when the list lands (uc:289-303)
      inventoryHidden: !window.__world.inventory.win.visible,
      registered: window.__world.wndMgr.names.includes('MultiSellWnd'),
    }));
    await page.screenshot({ path: path.join(OUT, 'multisell_01_list.png') });

    // -- grayed entry is a dead end (defensive; aCis pre-filters live) ----
    await clk('.l2-multisell-cell[data-entry-id="2"]');
    await sleep(300);
    await dbl('.l2-multisell-cell[data-entry-id="2"]');
    await sleep(300);
    summary.grayedDeadEnd = await page.evaluate(() => ({
      selected: window.__world.multiSellWnd.selected,   // stays -1
      promptShown: window.__world.multiSellWnd.amountWin.visible,
      chooseOps: window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'multisellChoose').length,
    }));

    // -- select the affordable entry -> detail panes fill ------------------
    await clk('.l2-multisell-cell[data-entry-id="1"]');
    await sleep(400);
    summary.detail = await page.evaluate(() => ({
      selected: window.__world.multiSellWnd.selected,
      productRows: document.querySelectorAll('.l2-multisell-products > div').length,
      ingredientRows: document.querySelectorAll('.l2-multisell-needed > div').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'multisell_02_selected.png') });

    // -- dblclick -> amount prompt (max 5 affordable) -> choose x2 ---------
    await dbl('.l2-multisell-cell[data-entry-id="1"]');
    await sleep(400);
    summary.prompt = await page.evaluate(() => ({
      visible: window.__world.multiSellWnd.amountWin.visible,
      max: window.__world.multiSellWnd.amountMax,
    }));
    await page.screenshot({ path: path.join(OUT, 'multisell_03_amount.png') });
    await page.evaluate(() => {
      const input = document.querySelector('#l2-multisell-amount input');
      input.value = '2';
      [...document.querySelectorAll('#l2-multisell-amount .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer')[0].click();   // OK
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'multisellChoose'
        && m.listId === 47667 && m.entryId === 1 && m.count === 2)`, { timeout: 8000 });

    // -- invUpdate is the only truth; the re-sent list is a refresh --------
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'invUpdate'
        && (m.updated || []).some(u => u.itemId === 875 && u.change === 'add' && u.count === 2))`,
      { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'multisellList').length >= 2`,
      { timeout: 8000 });
    await sleep(600);
    summary.afterExchange = await page.evaluate(() => {
      const inv = id => [...window.__world.inventory.items.values()]
        .filter(i => i.itemId === id).reduce((s, i) => s + i.count, 0);
      return {
        adena: inv(57),          // 1200 - 400
        pants: inv(1147),        // 5 - 2
        rings: inv(875),         // +2
        stillVisible: window.__world.multiSellWnd.visible,
        selectionKept: window.__world.multiSellWnd.selected === 0
          && window.__world.multiSellWnd.items[0].entryId === 1,
        sysMsgs: window.__world.net.log.filter(m => m.op === 'sysMsg').slice(-3)
          .map(m => m.id),
      };
    });
    await page.screenshot({ path: path.join(OUT, 'multisell_04_after.png') });

    // -- over-ingredient choose -> sysMsg 351, inventory untouched ---------
    await page.evaluate(() => window.__world.net.sendOp('multisellChoose',
      { listId: 47667, entryId: 1, count: 99 }));
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'sysMsg' && m.id === 351)`,
      { timeout: 8000 });
    summary.failedExchange = await page.evaluate(() => {
      const inv = id => [...window.__world.inventory.items.values()]
        .filter(i => i.itemId === id).reduce((s, i) => s + i.count, 0);
      return { adena: inv(57), pants: inv(1147), rings: inv(875) };
    });

    // -- close sends nothing ------------------------------------------------
    const outBefore = await page.evaluate(
      () => window.__world.net.log.filter(m => m.dir === 'out').length);
    await page.evaluate(() => { window.__world.multiSellWnd.hide(); });
    await sleep(400);
    summary.closeSilent = await page.evaluate((n) => (
      window.__world.net.log.filter(m => m.dir === 'out').length === n), outBefore);

    summary.pageErrors = summary.consoleLogs.filter(l => l.startsWith('PAGEERROR'));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY MULTISELL FAILED:', e.message); process.exit(1); });
