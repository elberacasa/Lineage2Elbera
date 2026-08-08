// InventoryWnd verification (mock gateway on 8085): retail layout from the
// mined table AND from ui/invslots.json (the slot wells measured out of
// Inventory_Back by tools/ui/mine_invslots.py), item grid, paperdoll with
// equipped items, adena count, drag to equip/unequip (useItem), reorder
// (client-side), dblclick use, trash/crystallize ops (aCis 0x59/0x72).
//
// Counts and the adena figure are drawn with the client's own bitmap font,
// so they are canvases: read Font's cache key (el.__l2text), never
// textContent, which is always ''.
// Output: verify_shots/inv_*.png + JSON summary.
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

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'itemList')
       && window.__world.net.log.some(m => m.op === 'charSheet')`, { timeout: 20000 });
    await sleep(1500);

    // Alt+V opens the retail inventory window
    await page.keyboard.down('Alt'); await page.keyboard.press('v'); await page.keyboard.up('Alt');
    await sleep(600);

    summary.layout = await page.evaluate(() => {
      const w = window.__world.inventory;
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const root = r(w.win.root);
      return {
        visible: w.win.root.style.display !== 'none',
        root,
        tabs: r(w.tabs), grid: r(w.grid),
        // mined checks: tabs (12,159)->body(12,139), grid (9,188)->body(9,168)
        tabsOk: (w.tabs.offsetLeft === 12 && w.tabs.offsetTop === 139),
        gridOk: (w.grid.offsetLeft === 9 && w.grid.offsetTop === 168),
        cells: document.querySelectorAll('.inv-cell').length,
        // InventoryWnd.uc HandleAddItem: equipped items go to the paperdoll
        // ONLY, so the grid lists items minus equipped
        serverItems: window.__world.inventory.items.size,
        serverEquipped: [...window.__world.inventory.items.values()]
          .filter(i => i.equipped).length,
        // mined well 34x34 on the mined 37x35 pitch (NOT the pitch-sized
        // cells the port used to draw, which stretched every 32px icon)
        cellRects: [...document.querySelectorAll('.inv-cell')].slice(0, 8)
          .map(c => { const b = c.getBoundingClientRect();
            return { w: Math.round(b.width), h: Math.round(b.height),
                     x: Math.round(b.x), y: Math.round(b.y) }; }),
        gridScroll: { sh: w.grid.scrollHeight, ch: w.grid.clientHeight },
        dollSlots: document.querySelectorAll('.doll-slot').length,
        dollFilled: [...document.querySelectorAll('.doll-slot.filled')]
          .map(e => e.dataset.slot),
        equippedTitles: [...document.querySelectorAll('.doll-slot.filled')]
          .map(e => e.title),
      };
    });
    await page.screenshot({ path: path.join(OUT, 'inv_01_window.png') });

    // dblclick use on the consumable (count 5 -> 4). The count is a Font
    // canvas; its text lives in the cache key.
    const readCount = () => page.evaluate(() =>
      document.querySelector('.inv-cell[data-oid="90002"] .count')
        ?.__l2text?.split('|')[0] ?? null);
    const before = await readCount();
    await page.evaluate(() => {
      document.querySelector('.inv-cell[data-oid="90002"]')
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useItem')`,
      { timeout: 8000 });
    await sleep(600);
    summary.useItem = { countBefore: before, countAfter: await readCount() };

    // drag an unequipped item onto a paperdoll slot -> useItem (equip path)
    await page.evaluate(() => {
      const src = document.querySelector('.inv-cell[data-oid="90004"]');
      const dst = document.querySelector('.doll-slot[data-slot="underwear"]');
      const dt = new DataTransfer();
      dt.setData('application/x-l2vzla', JSON.stringify({ type: 'item', id: 90004 }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    });
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'useItem').length >= 2`,
      { timeout: 8000 });

    // adena count + tab flip to quest pane
    summary.adena = await page.evaluate(() => ({
      itemCount: (window.__world.inventory.items.get(90001) || {}).count,
      adenaShown: window.__world.inventory.adenaEl.childElementCount > 0,
      adenaText: window.__world.inventory.adenaEl.__l2text?.split('|')[0] ?? null,
    }));
    await page.evaluate(() => {
      [...document.querySelectorAll('#l2-inventorywnd [class]')].length;
      window.__world.inventory.tab = 'quest';
      window.__world.inventory.render();
    });
    await sleep(300);
    summary.questTab = await page.evaluate(() => ({
      cells: document.querySelectorAll('.inv-cell').length,
    }));
    await page.evaluate(() => {
      window.__world.inventory.tab = 'inventory';
      window.__world.inventory.render();
    });
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'inv_02_detail.png') });

    // trash + crystallize buttons emit the new ops
    await page.evaluate(() => {
      window.__world.inventory.onDestroy(90005);
      window.__world.inventory.onCrystallize(90005);
    });
    await sleep(400);
    summary.destroyOps = await page.evaluate(() =>
      window.__world.net.log.filter(m => m.dir === 'out'
        && ['destroyItem', 'crystallizeItem'].includes(m.op))
        .map(m => m.op + ':' + m.objectId + ':' + m.count));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY INVENTORY FAILED:', e.message); process.exit(1); });
