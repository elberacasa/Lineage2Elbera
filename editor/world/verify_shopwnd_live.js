// Historical Elbera Tools live shop harness: Katerina Buy14, potion1060 x1,
// then use that actual inventory object through InventoryWnd. Ordinary server
// changes only. No SQL/funding, character creation, farming, route shortcuts,
// unrelated sales, or claims that a movement destination proves arrival.
//
// Prerequisites: explicitly set SHOP_DEVICE_ID and SHOP_CHARACTER to an existing
// test identity/character; no other session may use it. Position it near
// Katerina beforehand through normal gameplay and retain enough Adena for the
// received price. Missing prerequisites fail, never repair game state.
// Browser automation must not be run under the current CUA-only workflow.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const puppeteer = require(path.resolve(__dirname,
  '../../tools/src/char_pipeline/node_modules/puppeteer-core'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8090'; // cc stays enabled: noAutoCreate
const OUT = path.join(__dirname, 'verify_shots');
const DEVICE_ID = process.env.SHOP_DEVICE_ID;
const CHARACTER = process.env.SHOP_CHARACTER;
// Configured datapack location/menu, not original-client geometry evidence.
const KATERINA = { npcId: 30004, x: -84204, y: 240403 };
const ITEM_ID = 1060;
const summary = { mode: 'existing-character live shop purchase and use',
  unverified: ['Navigation and native entity picking: the named nearby NPC is requested through talk.',
    'Native UI pixel/keyboard/drag parity, weight preview and INT64 overflow.',
    'Healing amount, effect/audio fidelity, selling, limited-stock enforcement and reconnect persistence.'],
  pageErrors: [] };

(async () => {
  assert.ok(typeof DEVICE_ID === 'string' && DEVICE_ID.length > 0,
    'Set SHOP_DEVICE_ID to an existing test identity; no identity is generated.');
  assert.ok(typeof CHARACTER === 'string' && CHARACTER.length > 0,
    'Set SHOP_CHARACTER to its existing character; no character is created.');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(id => localStorage.setItem('l2vzla.deviceId', id), DEVICE_ID);
    page.on('pageerror', error => summary.pageErrors.push(error.message));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__world?.ready, { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(() => window.__world.net.log.some(m => m.op === 'auth_ok'), { timeout: 120000 });
    const chars = await page.evaluate(() => window.__world.net.log.find(m => m.op === 'auth_ok').chars);
    assert.ok(chars.some(char => char.name === CHARACTER), 'requested existing character must be listed');
    if (chars.length > 1) {
      await page.waitForSelector('#charsel-overlay .charsel-row', { visible: true });
      await page.evaluate(name => {
        const row = [...document.querySelectorAll('#charsel-overlay .charsel-row')]
          .find(element => element.children[0]?.textContent === name);
        if (!row) throw new Error('requested character row is unavailable');
        row.click();
      }, CHARACTER);
    }
    await page.waitForFunction(() => window.__world.net.log.some(m => m.op === 'enterWorld'), { timeout: 120000 });
    const entered = await page.evaluate(() => window.__world.net.log.find(m => m.op === 'enterWorld').char);
    assert.equal(entered.name, CHARACTER);
    // Operational scope gate only, not a claim about native interaction range.
    assert.ok(Math.hypot(entered.x - KATERINA.x, entered.y - KATERINA.y) <= 300,
      'Position the character near Katerina through ordinary gameplay before this test.');
    assert.equal(await page.evaluate(() => window.__world.net.url), 'ws://127.0.0.1:8090');
    await page.waitForFunction(npcId => window.__world.entities.snapshot().some(e => e.npcId === npcId)
      && window.__world.inventory?.meta && window.__world.inventory.items.size > 0,
    { timeout: 60000 }, KATERINA.npcId);
    const npcId = await page.evaluate(id => window.__world.entities.snapshot().find(e => e.npcId === id).id, KATERINA.npcId);
    await page.evaluate(id => window.__world.net.sendOp('talk', { id }), npcId);
    const buyLink = `#l2-npcdialog [data-bypass="npc_${npcId}_Buy 14"]`;
    await page.waitForSelector(buyLink, { visible: true, timeout: 15000 });
    await page.click(buyLink); // actual server HTML control, no fabricated option
    await page.waitForFunction(() => {
      const s = window.__world.shopWnd;
      return s?.visible && s.mode === 'buy' && s.meta
        && document.querySelector('.l2-shop-top .l2-shop-cell[data-item-id="1060"]');
    }, { timeout: 15000 });
    const offer = await page.evaluate(() => {
      const s = window.__world.shopWnd;
      return { row: s.topItems.find(i => i.itemId === 1060), money: s.money,
        consumeType: s.meta[1060]?.consumeType };
    });
    assert.equal(offer.consumeType, 2, 'original Lesser Healing Potion stackability');
    assert.ok(Number.isInteger(offer.row?.price) && offer.row.price >= 0, 'received price required');
    assert.ok(Number.isInteger(offer.money) && offer.money >= offer.row.price,
      'Insufficient received Adena; obtain funds through ordinary gameplay before the test.');
    const inventory = () => page.evaluate(() => {
      const rows = [...window.__world.inventory.items.values()];
      return { money: rows.find(i => i.itemId === 57)?.count ?? 0,
        potions: rows.filter(i => i.itemId === 1060).map(i => ({ objectId: i.objectId, count: i.count })) };
    });
    const before = await inventory();
    assert.equal(before.money, offer.money, 'shop and current inventory money agree before purchase');
    const potionCount = before.potions.reduce((sum, item) => sum + item.count, 0);
    await page.click('.l2-shop-top .l2-shop-cell[data-item-id="1060"]', { clickCount: 2 });
    await page.waitForSelector('.l2-dialogbox [data-control="DialogBoxEdit"]', { visible: true });
    assert.equal(await page.$eval('.l2-dialogbox [data-control="DialogBoxEdit"]', element => element.value), '');
    await page.click('.l2-dialogbox [data-control="num1"]');
    await page.click('.l2-dialogbox [data-control="OKButton"]');
    await page.waitForFunction(() => !window.__world.shopWnd.pending && !window.__world.shopWnd.dialog.inUse);
    assert.deepEqual(await page.evaluate(() => [...window.__world.shopWnd.cart.values()]
      .map(({ itemId, count }) => ({ itemId, count }))), [{ itemId: ITEM_ID, count: 1 }]);
    await page.screenshot({ path: path.join(OUT, 'shop_live_01_cart.png') });
    await page.click('#l2-shopwnd [data-id="OKButton"]');
    await page.waitForFunction((money, count) => {
      const rows = [...window.__world.inventory.items.values()];
      return rows.find(i => i.itemId === 57)?.count === money
        && rows.filter(i => i.itemId === 1060).reduce((sum, i) => sum + i.count, 0) === count;
    }, { timeout: 15000 }, before.money - offer.row.price, potionCount + 1);
    const buyOps = await page.evaluate(() => window.__world.net.log
      .filter(m => m.dir === 'out' && m.op === 'buy').map(m => m.items));
    assert.deepEqual(buyOps, [[{ itemId: ITEM_ID, count: 1 }]]);
    const bought = await inventory();
    const changed = bought.potions.filter(item => item.count ===
      (before.potions.find(old => old.objectId === item.objectId)?.count ?? 0) + 1);
    assert.equal(changed.length, 1, 'one server-described inventory object gained the purchased item');
    const objectId = changed[0].objectId;
    if (!await page.evaluate(() => window.__world.inventory.win.visible)) {
      await page.keyboard.down('Alt'); await page.keyboard.press('v'); await page.keyboard.up('Alt');
    }
    const potion = `#l2-inventorywnd .inv-cell[data-oid="${objectId}"]`;
    await page.waitForSelector(potion, { visible: true });
    await page.click(potion, { clickCount: 2 });
    await page.waitForFunction(count => [...window.__world.inventory.items.values()]
      .filter(i => i.itemId === 1060).reduce((sum, i) => sum + i.count, 0) === count,
    { timeout: 15000 }, potionCount);
    const used = await inventory();
    const uses = await page.evaluate(() => window.__world.net.log
      .filter(m => m.dir === 'out' && m.op === 'useItem').map(m => m.objectId));
    assert.deepEqual(uses, [objectId]); assert.equal(used.money, bought.money);
    Object.assign(summary, { character: entered.name, offer, before, bought, used,
      buyRequest: buyOps[0], useObjectId: objectId });
    await page.screenshot({ path: path.join(OUT, 'shop_live_02_used.png') });
    assert.deepEqual(summary.pageErrors, []);
  } finally { await browser.close(); }
  console.log(JSON.stringify(summary, null, 2));
})().catch(error => {
  console.error('VERIFY SHOP LIVE FAILED:', error.message);
  console.error('partial summary:', JSON.stringify(summary));
  process.exitCode = 1;
});
