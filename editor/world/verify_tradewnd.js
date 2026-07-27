// TradeWnd verification (mock gateway on 8085). Flow:
//   target Aria + '/trade' -> tradeRequest -> tradeStart opens the window
//   dblclick adena -> amount prompt -> tradeAdd -> tradeOwn fills MY pane,
//   tradeOther fills THEIR pane (Aria's standing offer)
//   dblclick a non-stackable -> adds 1, no prompt
//   OK -> tradeDone + own-side latch (faded MyList, adds locked); the
//   mock's Aria confirms -> tradeEnd{done} -> inventory moves via
//   invUpdate ONLY (adena -100, potions +2, offered item gone)
//   cancel path: tradeEnd{cancel}, inventory untouched
//   refuse path: '/tradeask' -> prompt -> Refuse -> tradeAnswer{0},
//   nothing else happens (M12: refuse is only a sysMsg at the requestor)
//   accept path: '/tradeask' -> Accept -> tradeAnswer{1} -> tradeStart
// Output: verify_shots/trade_*.png + JSON summary.
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
      `window.__world.net.log.some(m => m.op === 'itemList')`, { timeout: 20000 });
    await sleep(1200);

    const dbl = (sel) => page.evaluate((s) => {
      document.querySelector(s).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, sel);
    const amountOk = (n) => page.evaluate((val) => {
      const input = document.querySelector('#l2-trade-amount input');
      input.value = String(val);
      const btns = [...document.querySelectorAll('#l2-trade-amount .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[0].click();   // OK
    }, n);
    const clickBtn = (id) => page.evaluate((i) => {
      [...document.querySelectorAll('#l2-tradewnd .l2-trade-btn')]
        .filter(b => b.dataset.id === i)[0].click();
    }, id);

    // -- invite: target Aria, then '/trade' through the real chat input -------
    await page.evaluate(() => window.__world.net.sendOp('target', { id: 80001 }));
    await sleep(400);
    await page.evaluate(() => {
      const input = document.getElementById('chat-input');
      input.value = '/trade';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'tradeRequest'
        && m.name === 'Aria')`, { timeout: 8000 });
    await page.waitForFunction('window.__world.tradeWnd.visible', { timeout: 10000 });
    await sleep(600);
    summary.started = await page.evaluate(() => ({
      partner: window.__world.tradeWnd.partner,
      tradable: window.__world.tradeWnd.tradable.length,
      invCells: document.querySelectorAll('.l2-trade-inventory .l2-trade-cell').length,
      equippedExcluded: !window.__world.tradeWnd.tradable.some(i => i.objectId === 90003),
      registered: window.__world.wndMgr.names.includes('TradeWnd'),
      iconsLoaded: [...document.querySelectorAll('.l2-trade-inventory .l2-trade-cell img')]
        .filter(i => i.complete && i.naturalWidth > 0).length,
    }));

    // -- adena (stackable): amount prompt -> tradeAdd --------------------------
    await dbl('.l2-trade-inventory .l2-trade-cell[data-key="o90001"]');
    await sleep(400);
    summary.prompt = await page.evaluate(() => ({
      visible: window.__world.tradeWnd.amountWin.visible,
    }));
    await amountOk(100);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'tradeAdd'
        && m.objectId === 90001 && m.count === 100)`, { timeout: 8000 });
    // own pane fills from tradeOwn ONLY; Aria's offer arrives via tradeOther
    await page.waitForFunction(
      `window.__world.tradeWnd.ownOffer.length === 1
       && window.__world.tradeWnd.otherOffer.length === 1`, { timeout: 8000 });
    await sleep(400);

    // -- non-stackable: no prompt, adds 1 ---------------------------------------
    await dbl('.l2-trade-inventory .l2-trade-cell[data-key="o90004"]');
    await page.waitForFunction(
      `window.__world.tradeWnd.ownOffer.length === 2`, { timeout: 8000 });
    await sleep(300);
    summary.panes = await page.evaluate(() => ({
      myCells: document.querySelectorAll('.l2-trade-my .l2-trade-cell').length,
      otherCells: document.querySelectorAll('.l2-trade-other .l2-trade-cell').length,
      myAdenaCount: window.__world.tradeWnd.ownOffer[0].count,
      otherName: document.querySelector('.l2-trade-other') ? true : false,
      promptStayedClosed: !window.__world.tradeWnd.amountWin.visible,
    }));
    await page.screenshot({ path: path.join(OUT, 'trade_01_panes.png') });

    // -- OK: two-phase latch (M12) ----------------------------------------------
    await clickBtn('OKButton');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'tradeDone')`,
      { timeout: 8000 });
    summary.latch = await page.evaluate(() => ({
      confirmed: window.__world.tradeWnd.ownConfirmed,
      myFaded: document.querySelector('.l2-trade-my').style.opacity === '0.45',
      okFaded: document.querySelector('#l2-tradewnd .l2-trade-btn[data-id="OKButton"]').style.opacity === '0.45',
      stillOpen: window.__world.tradeWnd.visible,   // waits for the partner
    }));
    await page.screenshot({ path: path.join(OUT, 'trade_02_latched.png') });
    // the latch locks adds: dblclick must NOT emit another tradeAdd
    const addsBefore = await page.evaluate(
      () => window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'tradeAdd').length);
    await dbl('.l2-trade-inventory .l2-trade-cell[data-key="o90006"]');
    await sleep(500);
    summary.latch.addsLocked = (await page.evaluate(
      () => window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'tradeAdd').length))
      === addsBefore;

    // -- Aria confirms -> tradeEnd{done} -> invUpdate is the ONLY truth ---------
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'tradeEnd' && m.reason === 'done')`,
      { timeout: 8000 });
    await sleep(500);
    summary.afterDone = await page.evaluate(() => {
      const inv = [...window.__world.inventory.items.values()];
      return {
        hidden: !window.__world.tradeWnd.visible,
        adena: inv.find(i => i.itemId === 57).count,          // 1200 - 100
        potions: inv.find(i => i.itemId === 1060).count,      // 12 + 2
        mace: inv.filter(i => i.itemId === 2509).length,      // offered, gone
        sysMsg123: window.__world.net.log.some(m => m.op === 'sysMsg' && m.id === 123),
      };
    });

    // -- cancel path: items never move -------------------------------------------
    await page.evaluate(() => window.__world.net.sendOp('tradeRequest', { name: 'Aria' }));
    await page.waitForFunction('window.__world.tradeWnd.visible', { timeout: 10000 });
    await clickBtn('CancelButton');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'tradeCancel')
       && window.__world.net.log.some(m => m.op === 'tradeEnd' && m.reason === 'cancel')`,
      { timeout: 8000 });
    await sleep(400);
    summary.afterCancel = await page.evaluate(() => ({
      hidden: !window.__world.tradeWnd.visible,
      adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
    }));

    // -- refuse path: prompt -> tradeAnswer{0} -> NOTHING else (M12) -------------
    const startsBefore = await page.evaluate(
      () => window.__world.net.log.filter(m => m.op === 'tradeStart').length);
    await page.evaluate(() => window.__world.net.sendOp('say', { channel: 0, text: '/tradeask' }));
    await page.waitForFunction('window.__world.tradeWnd.askWin.visible', { timeout: 8000 });
    summary.ask = await page.evaluate(() => ({
      from: window.__world.tradeWnd.askFrom,
    }));
    await page.screenshot({ path: path.join(OUT, 'trade_03_ask.png') });
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#l2-tradeask .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[1].click();   // Refuse
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'tradeAnswer'
        && m.accept === 0)`, { timeout: 8000 });
    await sleep(1500);
    summary.refuse = await page.evaluate((n) => ({
      noTradeStart: window.__world.net.log.filter(m => m.op === 'tradeStart').length === n,
      windowStayedClosed: !window.__world.tradeWnd.visible,
      askHidden: !window.__world.tradeWnd.askWin.visible,
    }), startsBefore);

    // -- accept path: tradeAnswer{1} -> tradeStart opens the window -------------
    await page.evaluate(() => window.__world.net.sendOp('say', { channel: 0, text: '/tradeask' }));
    await page.waitForFunction('window.__world.tradeWnd.askWin.visible', { timeout: 8000 });
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#l2-tradeask .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[0].click();   // Accept
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'tradeAnswer'
        && m.accept === 1) && window.__world.tradeWnd.visible`, { timeout: 8000 });
    summary.accept = await page.evaluate(() => ({
      partner: window.__world.tradeWnd.partner,
      visible: window.__world.tradeWnd.visible,
    }));
    await clickBtn('CancelButton');   // leave clean
    await page.waitForFunction(
      `!window.__world.tradeWnd.visible`, { timeout: 8000 });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY TRADE FAILED:', e.message); process.exit(1); });
