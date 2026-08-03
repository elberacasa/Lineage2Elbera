// ShopWnd verification (mock gateway on 8085). Flow:
//   bypass npc_buy -> buyList opens buy mode (icons, prices, adena line)
//   dblclick a stackable -> amount prompt (NumberPad stand-in) -> cart
//   dblclick a non-stackable -> moves 1, no prompt; dblclick back
//   OK -> buy{items} exact op; invUpdate is the ONLY inventory truth
//   over-adena buy -> sysMsg failure, inventory untouched
//   bypass npc_sell -> sellList (inventory + server prices) -> sell flow
// Output: verify_shots/shop_*.png + JSON summary.
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
    const amountOk = (n) => page.evaluate((val) => {
      const input = document.querySelector('#l2-shop-amount input');
      input.value = String(val);
      const btns = [...document.querySelectorAll('#l2-shop-amount .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[0].click();   // OK
    }, n);

    // -- open buy mode ---------------------------------------------------------
    await page.evaluate(() => window.__world.net.sendOp('bypass', { command: 'npc_buy' }));
    await page.waitForFunction(
      'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "buy"',
      { timeout: 10000 });
    await sleep(600);
    summary.buyList = await page.evaluate(() => ({
      mode: window.__world.shopWnd.mode,
      topCells: document.querySelectorAll('.l2-shop-top .l2-shop-cell').length,
      iconsLoaded: [...document.querySelectorAll('.l2-shop-top .l2-shop-cell img')]
        .filter(i => i.complete && i.naturalWidth > 0).length,
      registered: window.__world.wndMgr.names.includes('ShopWnd'),
    }));
    await page.screenshot({ path: path.join(OUT, 'shop_01_buylist.png') });

    // -- stackable: amount prompt; non-stackable: direct; move one back -------
    await dbl('.l2-shop-top .l2-shop-cell[data-key="i1060"]');
    await sleep(400);
    summary.prompt = await page.evaluate(() => ({
      visible: window.__world.shopWnd.amountWin.visible,
    }));
    await amountOk(2);
    await sleep(400);
    await dbl('.l2-shop-top .l2-shop-cell[data-key="i2369"]');   // count 1: no prompt
    await sleep(300);
    summary.cart = await page.evaluate(() => ({
      rows: document.querySelectorAll('.l2-shop-bottom .l2-shop-cell').length,
      promptStayedClosed: !window.__world.shopWnd.amountWin.visible,
    }));
    await page.screenshot({ path: path.join(OUT, 'shop_02_cart.png') });
    await dbl('.l2-shop-bottom .l2-shop-cell[data-key="i2369"]');  // move it back
    await sleep(300);

    // -- OK -> buy op -> invUpdate is the only inventory truth -----------------
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#l2-shopwnd .l2-shop-btn')]
        .filter(b => b.dataset.id === 'OKButton');
      btns[0].click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'buy'
        && m.items && m.items.length === 1 && m.items[0].itemId === 1060
        && m.items[0].count === 2)`, { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'invUpdate'
        && (m.updated || []).some(u => u.itemId === 57 && u.count === 700))`,
      { timeout: 8000 });
    summary.afterBuy = await page.evaluate(() => ({
      hidden: !window.__world.shopWnd.visible,
      adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
      potions: [...window.__world.inventory.items.values()].find(i => i.itemId === 1060).count,
    }));

    // -- over-adena buy -> sysMsg failure, inventory untouched -----------------
    await page.evaluate(() => window.__world.net.sendOp('bypass', { command: 'npc_buy' }));
    await page.waitForFunction('window.__world.shopWnd.visible', { timeout: 8000 });
    await sleep(400);
    await dbl('.l2-shop-top .l2-shop-cell[data-key="i2509"]');
    await sleep(300);
    await amountOk(2);   // 2 x 1000 = 2000 > 700 adena
    await sleep(300);
    await page.evaluate(() => {
      [...document.querySelectorAll('#l2-shopwnd .l2-shop-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'sysMsg' && m.id === 279)`,
      { timeout: 8000 });
    summary.failedBuy = await page.evaluate(() => ({
      adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
      spiritshots: [...window.__world.inventory.items.values()]
        .filter(i => i.itemId === 2509).length,
    }));

    // -- sell mode ---------------------------------------------------------------
    await page.evaluate(() => window.__world.net.sendOp('bypass', { command: 'npc_sell' }));
    await page.waitForFunction(
      'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "sell"',
      { timeout: 8000 });
    await sleep(600);
    summary.sellList = await page.evaluate(() => ({
      mode: window.__world.shopWnd.mode,
      topCells: document.querySelectorAll('.l2-shop-top .l2-shop-cell').length,
      noAdena: !document.querySelector('.l2-shop-top .l2-shop-cell[data-key^="o90001"]'),
    }));
    await page.screenshot({ path: path.join(OUT, 'shop_03_selllist.png') });
    await dbl('.l2-shop-top .l2-shop-cell[data-key="o90005"]');   // 1060 x14 -> prompt
    await sleep(300);
    await amountOk(4);
    await sleep(300);
    await page.evaluate(() => {
      [...document.querySelectorAll('#l2-shopwnd .l2-shop-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'sell'
        && m.items && m.items.length === 1 && m.items[0].objectId === 90005
        && m.items[0].count === 4)`, { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'invUpdate'
        && (m.updated || []).some(u => u.itemId === 57 && u.count === 1180))`,
      { timeout: 8000 });
    summary.afterSell = await page.evaluate(() => ({
      adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
      potions: [...window.__world.inventory.items.values()].find(i => i.itemId === 1060).count,
    }));
    await page.screenshot({ path: path.join(OUT, 'shop_04_after.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY SHOP FAILED:', e.message); process.exit(1); });
