// WarehouseWnd verification (mock gateway on 8085). Flow:
//   talk Wilford (70008) -> real DepositP/WithdrawP links in the html
//   WithdrawP on an EMPTY warehouse -> sysMsg 282 only, NO window (aCis)
//   DepositP -> whDeposit opens deposit mode (inventory side; equipped
//   sword excluded; adena is a normal stack -> amount prompt)
//   stage adena x500 + potions x4 (prompts) + spiritshot x1 (no prompt)
//   fee line = 3 entries x 30 = 90 (WarehouseWnd.uc KEEPING_PRICE)
//   OK -> whDepositItems{items:[{objectId,count}]} exact; invUpdate is the
//   ONLY inventory truth: adena 1200-500-90 = 610
//   WithdrawP -> whWithdraw (deposit landed; stackable adena/potions under
//   NEW objectIds) -> withdraw everything back -> adena 1110 (fee lost),
//   items restored
// Output: verify_shots/wh_*.png + JSON summary.
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
      const input = document.querySelector('#l2-wh-amount input');
      input.value = String(val);
      const btns = [...document.querySelectorAll('#l2-wh-amount .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[0].click();   // OK
    }, n);
    const clickBtn = (id) => page.evaluate((bid) => {
      [...document.querySelectorAll('#l2-warehousewnd .l2-wh-btn')]
        .filter(b => b.dataset.id === bid)[0].click();
    }, id);
    // talk Wilford and follow one of the real bypass links from his html
    const followKeeperLink = async (kind) => {
      const link = await page.evaluate(async (k) => {
        const before = window.__world.net.log.filter(m => m.op === 'npcHtml').length;
        window.__world.net.sendOp('talk', { id: 70008 });
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          await new Promise(r => setTimeout(r, 200));
          const hs = window.__world.net.log.filter(m => m.op === 'npcHtml');
          if (hs.length > before) {
            const m = new RegExp('bypass -h (npc_\\d+_' + k + ')').exec(hs[hs.length - 1].html);
            if (m) return m[1];
            return null;
          }
        }
        return null;
      }, kind);
      if (!link) throw new Error('no ' + kind + ' link in Wilford html');
      await page.evaluate((cmd) => window.__world.net.sendOp('bypass', { command: cmd }), link);
      return link;
    };

    // -- empty warehouse: WithdrawP -> sysMsg 282, NO window (aCis) --------
    summary.emptyWithdraw = { link: await followKeeperLink('WithdrawP') };
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'sysMsg' && m.id === 282)`,
      { timeout: 8000 });
    await sleep(400);
    summary.emptyWithdraw.noWindow = await page.evaluate(
      () => !window.__world.warehouseWnd.visible);
    summary.emptyWithdraw.noWhWithdrawOp = await page.evaluate(
      () => !window.__world.net.log.some(m => m.op === 'whWithdraw'));

    // -- DepositP -> whDeposit opens deposit mode ---------------------------
    summary.depositLink = await followKeeperLink('DepositP');
    await page.waitForFunction(
      'window.__world.warehouseWnd.visible && window.__world.warehouseWnd.mode === "deposit"',
      { timeout: 10000 });
    await sleep(800);
    summary.depositOpen = await page.evaluate(() => ({
      mode: window.__world.warehouseWnd.mode,
      whType: window.__world.warehouseWnd.whType,
      topCells: document.querySelectorAll('.l2-wh-top .l2-wh-cell').length,
      // the equipped Squire's Sword (90003) must NOT be deposit-eligible
      swordExcluded: !document.querySelector('.l2-wh-top .l2-wh-cell[data-key="o90003"]'),
      adenaCell: !!document.querySelector('.l2-wh-top .l2-wh-cell[data-key="o90001"]'),
      iconsLoaded: [...document.querySelectorAll('.l2-wh-top .l2-wh-cell img')]
        .filter(i => i.complete && i.naturalWidth > 0).length,
      inventoryHidden: !window.__world.inventory.win.visible,
      registered: window.__world.wndMgr.names.includes('WarehouseWnd'),
      fee: (window.__world.warehouseWnd.priceEl.__l2text || '').split('|')[0],
    }));
    await page.screenshot({ path: path.join(OUT, 'wh_01_deposit.png') });

    // -- stage: adena x500 (prompt), potions x4 (prompt), spiritshot x1 -----
    await dbl('.l2-wh-top .l2-wh-cell[data-key="o90001"]');   // adena 1200 -> prompt
    await sleep(400);
    summary.prompt1 = await page.evaluate(() => window.__world.warehouseWnd.amountWin.visible);
    await amountOk(500);
    await sleep(400);
    await dbl('.l2-wh-top .l2-wh-cell[data-key="o90005"]');   // potions 12 -> prompt
    await sleep(400);
    await amountOk(4);
    await sleep(400);
    await dbl('.l2-wh-top .l2-wh-cell[data-key="o90004"]');   // spiritshot x1: no prompt
    await sleep(400);
    summary.cart = await page.evaluate(() => ({
      rows: document.querySelectorAll('.l2-wh-bottom .l2-wh-cell').length,
      promptStayedClosed: !window.__world.warehouseWnd.amountWin.visible,
      fee: (window.__world.warehouseWnd.priceEl.__l2text || '').split('|')[0],
      countText: (window.__world.warehouseWnd.counts.bottom.__l2text || '').split('|')[0],
      entries: [...window.__world.warehouseWnd.cart.values()]
        .map(e => ({ objectId: e.objectId, itemId: e.itemId, count: e.count })),
    }));
    await page.screenshot({ path: path.join(OUT, 'wh_02_staged.png') });

    // -- OK -> whDepositItems -> invUpdate is the only truth ----------------
    await clickBtn('OKButton');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'whDepositItems'
        && m.items && m.items.length === 3
        && m.items.some(i => i.objectId === 90001 && i.count === 500)
        && m.items.some(i => i.objectId === 90005 && i.count === 4)
        && m.items.some(i => i.objectId === 90004 && i.count === 1))`, { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'invUpdate'
        && (m.updated || []).some(u => u.itemId === 57 && u.count === 610))`,
      { timeout: 8000 });
    await sleep(600);
    summary.afterDeposit = await page.evaluate(() => ({
      hidden: !window.__world.warehouseWnd.visible,
      adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
      potions: [...window.__world.inventory.items.values()].find(i => i.itemId === 1060).count,
      spiritshots: [...window.__world.inventory.items.values()]
        .filter(i => i.itemId === 2509).length,
    }));
    await page.screenshot({ path: path.join(OUT, 'wh_03_deposited.png') });

    // -- WithdrawP -> whWithdraw: the deposit is there ----------------------
    summary.withdrawLink = await followKeeperLink('WithdrawP');
    await page.waitForFunction(
      'window.__world.warehouseWnd.visible && window.__world.warehouseWnd.mode === "withdraw"',
      { timeout: 10000 });
    await sleep(800);
    summary.withdrawOpen = await page.evaluate(() => {
      const w = window.__world.warehouseWnd;
      const adena = w.topItems.find(i => i.itemId === 57);
      const potions = w.topItems.find(i => i.itemId === 1060);
      const shot = w.topItems.find(i => i.itemId === 2509);
      return {
        mode: w.mode,
        topCells: document.querySelectorAll('.l2-wh-top .l2-wh-cell').length,
        emptyPlaceholder: !document.querySelector('.l2-wh-top .l2-wh-empty'),
        adena: adena && { objectId: adena.objectId, count: adena.count },
        potions: potions && { objectId: potions.objectId, count: potions.count },
        shot: shot && { objectId: shot.objectId, count: shot.count },
        // M16 quirk: stackables (adena, potions, the spiritshot) crossed
        // under NEW objectIds — objectIds always come from THIS list
        adenaNewOid: adena && adena.objectId !== 90001,
        potionsNewOid: potions && potions.objectId !== 90005,
        shotNewOid: shot && shot.objectId !== 90004,
        fee: (w.priceEl.__l2text || '').split('|')[0],     // withdraw mode: "0" (uc:57)
        countText: (w.counts.top.__l2text || '').split('|')[0],
      };
    });
    await page.screenshot({ path: path.join(OUT, 'wh_04_withdraw.png') });

    // -- stage everything back (objectIds from THIS list) --------------------
    const oids = await page.evaluate(() => {
      const w = window.__world.warehouseWnd;
      return {
        adena: w.topItems.find(i => i.itemId === 57).objectId,
        potions: w.topItems.find(i => i.itemId === 1060).objectId,
        shot: w.topItems.find(i => i.itemId === 2509).objectId,
      };
    });
    await dbl(`.l2-wh-top .l2-wh-cell[data-key="o${oids.adena}"]`);
    await sleep(400);
    await amountOk(500);
    await sleep(400);
    await dbl(`.l2-wh-top .l2-wh-cell[data-key="o${oids.potions}"]`);
    await sleep(400);
    await amountOk(4);
    await sleep(400);
    await dbl(`.l2-wh-top .l2-wh-cell[data-key="o${oids.shot}"]`);
    await sleep(400);
    summary.withdrawCart = await page.evaluate(() => ({
      rows: document.querySelectorAll('.l2-wh-bottom .l2-wh-cell').length,
      sourceEmpty: !!document.querySelector('.l2-wh-top .l2-wh-empty'),
    }));
    await page.screenshot({ path: path.join(OUT, 'wh_05_withdraw_staged.png') });
    await clickBtn('OKButton');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'whWithdrawItems'
        && m.items && m.items.length === 3)`, { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'invUpdate'
        && (m.updated || []).some(u => u.itemId === 57 && u.count === 1110))`,
      { timeout: 8000 });
    await sleep(600);
    summary.afterWithdraw = await page.evaluate(() => ({
      hidden: !window.__world.warehouseWnd.visible,
      adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
      potions: [...window.__world.inventory.items.values()].find(i => i.itemId === 1060).count,
      spiritshots: [...window.__world.inventory.items.values()]
        .filter(i => i.itemId === 2509).length,
    }));
    await page.screenshot({ path: path.join(OUT, 'wh_06_restored.png') });

    // -- the warehouse is empty again -> sysMsg 282 --------------------------
    await followKeeperLink('WithdrawP');
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'sysMsg' && m.id === 282).length === 2`,
      { timeout: 8000 });
    summary.emptyAgain = await page.evaluate(
      () => !window.__world.warehouseWnd.visible);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY WAREHOUSE FAILED:', e.message); process.exit(1); });
