// Historical Elbera Tools shop browser harness: synthetic gateway on8085.
// Shared source DialogBox controls, original item ConsumeType metadata, exact
// outgoing requests and MOCK inventory deltas. The mock's prices, stock and
// transaction rules do not prove retail/server admission or visual parity.
// Browser automation must not be run under the current CUA-only workflow.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const puppeteer = require(path.resolve(__dirname,
  '../../tools/src/char_pipeline/node_modules/puppeteer-core'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'] });
  const summary = { mode: 'mock UI/request regression; not native or live transaction proof',
    unverified: ['Native drag/AllItemCount, keyboard/IME behavior and item tooltips.',
      'Native frame/font/button-state rendering, weight and INT64 overflow.',
      'Live merchant prices, taxes, stock enforcement, server buy/sell admission and session retirement.'],
    consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__world?.ready, { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(() => window.__world.inventory?.items.get(90005)?.count === 12,
      { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__world.net.url), 'ws://127.0.0.1:8085');

    const outgoing = op => page.evaluate(op => window.__world.net.log
      .filter(m => m.dir === 'out' && m.op === op).map(m => m.items), op);
    const waitIdle = () => page.waitForFunction(() => !window.__world.shopWnd.pending
      && !window.__world.shopWnd.dialog.inUse, { timeout: 10000 });
    const finish = async control => {
      await page.click(`.l2-dialogbox [data-control="${control}"]`); await waitIdle();
    };
    const number = async digits => {
      await page.waitForSelector('.l2-dialogbox [data-control="DialogBoxEdit"]', { visible: true });
      for (const digit of String(digits)) await page.click(`.l2-dialogbox [data-control="num${digit}"]`);
      await finish('OKButton');
    };
    const dbl = async (pane, itemId) => {
      const selector = `.l2-shop-${pane} .l2-shop-cell[data-item-id="${itemId}"]`;
      await page.waitForSelector(selector, { visible: true });
      await page.click(selector, { clickCount: 2 });
    };
    const open = async mode => {
      // The mock's actual HTML menu, not direct ShopWnd/open/callback calls.
      await page.evaluate(() => window.__world.net.sendOp('bypass', { command: 'npc_shop' }));
      const link = `#l2-npcdialog [data-bypass="npc_${mode}"]`;
      await page.waitForSelector(link, { visible: true }); await page.click(link);
      await page.waitForFunction(mode => {
        const s = window.__world.shopWnd;
        return s?.visible && s.mode === mode && s.meta
          && document.querySelectorAll('.l2-shop-top .l2-shop-cell').length === s.topItems.length;
      }, { timeout: 15000 }, mode);
      const received = await page.evaluate(mode => {
        const s = window.__world.shopWnd;
        const packet = [...window.__world.net.log].reverse().find(m => m.dir === 'in' && m.op === mode + 'List');
        return { money: s.money, wireMoney: packet?.money, rows: s.topItems.length };
      }, mode);
      assert.ok(Number.isInteger(received.wireMoney), 'mock lists must provide their own money snapshot');
      assert.equal(received.money, received.wireMoney);
      return received;
    };
    const cart = () => page.evaluate(() => [...window.__world.shopWnd.cart.values()]
      .map(({ itemId, count }) => ({ itemId, count })));
    const shopOK = () => page.click('#l2-shopwnd [data-id="OKButton"]');

    summary.buyList = await open('buy');
    const types = await page.evaluate(() => Object.fromEntries([1060, 734, 2509, 2369]
      .map(id => [id, window.__world.shopWnd.meta[id]?.consumeType])));
    assert.deepEqual(types, { 1060: 2, 734: 2, 2509: 2, 2369: 0 }, 'actual private original item metadata');
    assert.equal(summary.buyList.money, 1200);
    await page.screenshot({ path: path.join(OUT, 'shop_01_buylist.png') });

    await dbl('top', 1060);
    await page.waitForSelector('.l2-dialogbox [data-control="DialogBoxEdit"]', { visible: true });
    assert.equal(await page.$eval('.l2-dialogbox [data-control="DialogBoxEdit"]', e => e.value), '');
    await finish('CancelButton'); assert.deepEqual(await cart(), []);
    await dbl('top', 1060);
    await page.waitForSelector('.l2-dialogbox [data-control="numC"]', { visible: true });
    await page.click('.l2-dialogbox [data-control="numC"]');
    await finish('OKButton'); assert.deepEqual(await cart(), [], 'source zero quantity performs no transfer');
    await dbl('top', 1060); await number(2);
    await dbl('top', 2369); await dbl('top', 2369);
    assert.equal(await page.$('.l2-dialogbox'), null, 'nonstackable purchases do not open NumberPad');
    assert.deepEqual(await cart(), [{ itemId: 1060, count: 2 }, { itemId: 2369, count: 1 }, { itemId: 2369, count: 1 }]);
    const beforeStockWarning = await outgoing('buy');
    await shopOK();
    await page.waitForSelector('.l2-dialogbox [role="alertdialog"]', { visible: true });
    assert.equal(await page.$('.l2-dialogbox [data-control="DialogBoxEdit"]'), null);
    await finish('CancelButton'); assert.deepEqual(await outgoing('buy'), beforeStockWarning);
    await dbl('bottom', 2369); await dbl('bottom', 2369);
    assert.deepEqual(await cart(), [{ itemId: 1060, count: 2 }]);
    await page.screenshot({ path: path.join(OUT, 'shop_02_cart.png') });
    await shopOK();
    await page.waitForFunction(() => window.__world.inventory.items.get(90001)?.count === 700
      && window.__world.inventory.items.get(90005)?.count === 14, { timeout: 10000 });
    assert.deepEqual((await outgoing('buy')).at(-1), [{ itemId: 1060, count: 2 }]);
    summary.afterBuy = { mockAdena: 700, mockPotions: 14 };

    await open('buy'); await dbl('top', 2509); await number(2); await shopOK();
    await page.waitForFunction(() => window.__world.net.log.some(m => m.dir === 'in' && m.op === 'sysMsg' && m.id === 279));
    assert.deepEqual((await outgoing('buy')).at(-1), [{ itemId: 2509, count: 2 }]);
    assert.equal(await page.evaluate(() => window.__world.inventory.items.get(90001)?.count), 700);
    summary.failedBuy = { mockInsufficientAdena: true };

    summary.sellList = await open('sell');
    await page.click('.l2-shop-top .l2-shop-cell[data-key="o90005"]', { clickCount: 2 });
    await number(4); await shopOK();
    await page.waitForFunction(() => window.__world.inventory.items.get(90001)?.count === 1180
      && window.__world.inventory.items.get(90005)?.count === 10, { timeout: 10000 });
    assert.deepEqual((await outgoing('sell')).at(-1), [{ objectId: 90005, count: 4 }]);
    summary.afterSell = { mockAdena: 1180, mockPotions: 10 };
    await page.screenshot({ path: path.join(OUT, 'shop_03_after.png') });
    assert.ok(!summary.consoleLogs.some(line => line.startsWith('PAGEERROR:')), 'no page errors');
  } finally { await browser.close(); }
  console.log(JSON.stringify(summary, null, 2));
})().catch(error => { console.error('VERIFY SHOP FAILED:', error.stack || error.message); process.exitCode = 1; });
