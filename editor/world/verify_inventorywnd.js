// Historical InventoryWnd browser harness (synthetic mock gateway on 8085).
// This file is not a live gameplay test. Source layout comes from the
// mined table AND from ui/invslots.json (the slot wells measured out of
// Inventory_Back by tools/ui/mine_invslots.py), item grid, paperdoll with
// equipped items, adena count, item-use routing, client-side reorder, source
// use warnings and actual destroy/crystallize dialog controls. The mock's
// useItem handler decrements arbitrary items; it does NOT model equipping,
// healing, recipe learning, destruction, crystallization or server admission.
// Additional original-metadata items/capability are explicitly injected through
// the normal inbound dispatch only for isolated UI/request checks.
//
// Counts and the adena figure are drawn with the client's own bitmap font,
// so they are canvases: read Font's cache key (el.__l2text), never
// textContent, which is always ''.
// Output: verify_shots/inv_*.png + JSON summary.
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
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = {
    mode: 'synthetic mock UI and outbound-request checks; not server outcomes',
    unverified: [
      'Native pointer drag recognition: dragstart/drop events are synthetic.',
      'Actual equip/unequip, healing, recipe learning and popup item outcomes.',
      'Destroy/crystallize server acceptance, inventory changes and crystal rewards: mock has no handlers.',
      'Alt AllItemCount drag producer, ground dropping and pet transfers.',
      'Dialog keyboard/IME/selection parity, native font/frame rendering and trash feedback audio.',
      'Session retirement and shared quest-dialog contention are not exercised here.',
    ],
    consoleLogs: [],
  };
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
    await page.waitForFunction(() => window.__world.inventory?.meta
      && window.__world.inventory?.sysMsg, { timeout: 20000 });
    // Do not allow synthetic destructive confirmations onto the real gateway.
    assert.equal(await page.evaluate(() => window.__world.net.url), 'ws://127.0.0.1:8085');

    const outgoing = (op, objectId) => page.evaluate((op, objectId) =>
      window.__world.net.log.filter(m => m.dir === 'out' && m.op === op
        && (objectId === null || m.objectId === objectId))
        .map(({ op, objectId, count }) => ({ op, objectId, ...(count === undefined ? {} : { count }) })),
    op, objectId ?? null);
    const expectRequest = async (op, objectId, before, count) => {
      await page.waitForFunction((op, objectId, before) =>
        window.__world.net.log.filter(m => m.dir === 'out' && m.op === op
          && m.objectId === objectId).length > before,
      { timeout: 8000 }, op, objectId, before);
      const rows = await outgoing(op, objectId);
      assert.equal(rows.length, before + 1, 'one accepted dialog produces exactly one request');
      const expected = { op, objectId, ...(count === undefined ? {} : { count }) };
      assert.deepEqual(rows.at(-1), expected);
      return expected;
    };
    const waitIdle = () => page.waitForFunction(() => !window.__world.inventory.pendingUse
      && !window.__world.inventory.useDialog.inUse, { timeout: 8000 });
    const dialog = async (type) => {
      await page.waitForSelector('.l2-dialogbox [role="alertdialog"]', { visible: true, timeout: 8000 });
      assert.equal(await page.$('.l2-dialogbox [data-control="DialogBoxEdit"]') !== null,
        type === 'number', 'source action selects warning versus NumberPad');
    };
    const finish = async control => {
      await page.click(`.l2-dialogbox [data-control="${control}"]`);
      await waitIdle();
    };
    const drop = (objectId, target) => page.evaluate((objectId, target) => {
      const src = document.querySelector(`#l2-inventorywnd .inv-cell[data-oid="${objectId}"]`)
        || document.querySelector(`#l2-inventorywnd .doll-slot[data-oid="${objectId}"]`);
      const dst = document.querySelector(target);
      if (!src || !dst || !dst.getClientRects().length || getComputedStyle(dst).display === 'none') {
        throw new Error('missing or hidden source/drop target');
      }
      const dataTransfer = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      const payload = JSON.parse(dataTransfer.getData('application/x-l2vzla'));
      if (payload.id !== objectId || !['inventory', 'equip', 'quest'].includes(payload.from)) {
        throw new Error('actual inventory drag handler did not provide the source identity');
      }
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      return payload;
    }, objectId, target);

    // Alt+V opens the retail inventory window
    await page.keyboard.down('Alt'); await page.keyboard.press('v'); await page.keyboard.up('Alt');
    await page.waitForSelector('#l2-inventorywnd', { visible: true, timeout: 8000 });

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

    // Lesser Healing Potion, not the old Squire's Pants fixture. The mock
    // decrements once per use; this checks updates/routing, not healing rules.
    const potion = 90005;
    const readCount = () => page.evaluate(() =>
      document.querySelector('.inv-cell[data-oid="90005"] .count')
        ?.__l2text?.split('|')[0] ?? null);
    const before = await readCount();
    assert.equal(before, '12', 'fresh mock potion count');
    await page.click(`.inv-cell[data-oid="${potion}"]`, { clickCount: 2 });
    await expectRequest('useItem', potion, 0);
    await page.waitForFunction(() => window.__world.inventory.items.get(90005)?.count === 11);
    const doubleClickCount = await readCount();
    assert.equal(doubleClickCount, '11');
    await page.click(`.inv-cell[data-oid="${potion}"]`, { button: 'right' });
    await expectRequest('useItem', potion, 1);
    await page.waitForFunction(() => window.__world.inventory.items.get(90005)?.count === 10);
    assert.equal(await readCount(), '10');
    summary.useItem = { countBefore: before, doubleClickCount, rightClickCount: await readCount(),
      outcome: 'mock decrement only' };

    // Actual armor drag emits useItem. The mock decrements this intentionally
    // synthetic armor stack; it cannot prove that the paperdoll was equipped.
    await drop(90002, '.doll-slot[data-slot="legs"]');
    summary.equipRequest = await expectRequest('useItem', 90002, 0);

    const orderBefore = await page.evaluate(() => [...window.__world.inventory.order]);
    const useBeforeReorder = (await outgoing('useItem')).length;
    await drop(90006, '.inv-cell[data-oid="90007"]');
    summary.reorder = await page.evaluate(() => [...window.__world.inventory.order]);
    assert.notDeepEqual(summary.reorder, orderBefore);
    assert.equal((await outgoing('useItem')).length, useBeforeReorder, 'reorder sends no use request');

    // adena count + tab flip to quest pane
    summary.adena = await page.evaluate(() => ({
      itemCount: (window.__world.inventory.items.get(90001) || {}).count,
      adenaShown: window.__world.inventory.adenaEl.childElementCount > 0,
      adenaText: window.__world.inventory.adenaEl.__l2text?.split('|')[0] ?? null,
    }));
    await page.click('#l2-inventorywnd [data-tab="quest"]');
    summary.questTab = await page.evaluate(() => ({
      cells: document.querySelectorAll('.inv-cell').length,
    }));
    assert.equal(summary.questTab.cells, 1, 'mock quest item occupies its separate pane');
    await page.click('#l2-inventorywnd [data-tab="inventory"]');
    await page.screenshot({ path: path.join(OUT, 'inv_02_detail.png') });

    const trash = '.inv-bottom-btn[data-ctrl="TrashButton"]';
    const crystal = '.inv-bottom-btn[data-ctrl="CrystallizeButton"]';
    const quantity = '.l2-dialogbox [data-control="DialogBoxEdit"]';
    await drop(potion, trash); await dialog('number');
    assert.equal((await outgoing('destroyItem', potion)).length, 0, 'drop alone cannot destroy');
    await finish('CancelButton');
    assert.equal((await outgoing('destroyItem', potion)).length, 0, 'Cancel cannot destroy');
    summary.destroyRequests = [];
    for (const [control, count] of [['numC', 0], ['num3', 3], ['numAll', 10]]) {
      await drop(potion, trash); await dialog('number');
      await page.click(`.l2-dialogbox [data-control="${control}"]`);
      assert.equal(await page.$eval(quantity, input => input.value), String(count));
      const sent = (await outgoing('destroyItem', potion)).length;
      await finish('OKButton');
      summary.destroyRequests.push(await expectRequest('destroyItem', potion, sent, count));
    }
    // Destroy's zero is preserved, and NumberPad All uses current ItemNum.
    // This is NOT the separate Alt/AllItemCount drag branch.
    assert.equal(await page.evaluate(() => window.__world.inventory.items.get(90005).count), 10,
      'mock has no destroy response; outbound requests cannot count as inventory updates');
    await drop(90003, trash); await dialog('warning');
    await finish('CancelButton');
    assert.equal((await outgoing('destroyItem', 90003)).length, 0);
    await drop(90003, trash); await dialog('warning'); await finish('OKButton');
    summary.destroyRequests.push(await expectRequest('destroyItem', 90003, 0, 1));

    // Existing mock has neither a crystallize ability byte nor an eligible
    // item. Inject clearly synthetic inbound fixtures using actual original
    // metadata, rather than bypassing the eligibility/dialog code.
    assert.equal(await page.$eval(crystal, el => getComputedStyle(el).display), 'none');
    summary.injectedFixtures = await page.evaluate(() => {
      const world = window.__world, entries = Object.entries(world.inventory.meta);
      const choose = predicate => {
        const found = entries.find(([, row]) => predicate(row));
        if (!found) throw new Error('required original item metadata fixture is unavailable');
        return Number(found[0]);
      };
      const fixtures = [
        { role: 'crystallize', objectId: 99001,
          itemId: choose(row => Number.isInteger(row.crystallizable) && row.crystallizable !== 0) },
        { role: 'recipe warning', objectId: 99002, itemId: choose(row => row.isRecipe === true) },
        { role: 'popup warning', objectId: 99003,
          itemId: choose(row => row.isRecipe === false && row.popMsgNum > 0) },
      ];
      if (fixtures.some(row => world.inventory.items.has(row.objectId))) throw new Error('fixture object-ID collision');
      world.net.inject({ ...world.charSheet, op: 'charSheet', crystallizeAbility: 1 });
      world.net.inject({ op: 'invUpdate', updated: fixtures.map(({ objectId, itemId }) => ({
        change: 'add', objectId, itemId, count: 1, equipped: 0, slot: 0, type2: 5, enchant: 0,
      })) });
      return fixtures;
    });
    await page.waitForSelector('.inv-cell[data-oid="99001"]', { visible: true });
    assert.notEqual(await page.$eval(crystal, el => getComputedStyle(el).display), 'none');
    await drop(potion, crystal);
    await waitIdle();
    assert.equal(await page.$('.l2-dialogbox'), null, 'source non-crystallizable item has no confirmation');
    assert.equal((await outgoing('crystallizeItem')).length, 0);
    await drop(99001, crystal); await dialog('warning'); await finish('CancelButton');
    assert.equal((await outgoing('crystallizeItem', 99001)).length, 0);
    await drop(99001, crystal); await dialog('warning'); await finish('OKButton');
    summary.crystallizeRequest = await expectRequest('crystallizeItem', 99001, 0, 1);

    summary.warningUseRequests = [];
    for (const objectId of [99002, 99003]) {
      await page.click(`.inv-cell[data-oid="${objectId}"]`, { button: 'right' });
      await dialog('warning');
      assert.equal((await outgoing('useItem', objectId)).length, 0);
      await finish('CancelButton');
      assert.equal((await outgoing('useItem', objectId)).length, 0);
      await page.click(`.inv-cell[data-oid="${objectId}"]`, { clickCount: 2 });
      await dialog('warning'); await finish('OKButton');
      summary.warningUseRequests.push(await expectRequest('useItem', objectId, 0));
    }
    await page.screenshot({ path: path.join(OUT, 'inv_03_after_dialogs.png') });
    assert.equal(summary.consoleLogs.some(line => line.startsWith('PAGEERROR:')), false,
      'page errors invalidate this mock flow');
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY INVENTORY FAILED:', e.stack || e.message); process.exit(1); });
