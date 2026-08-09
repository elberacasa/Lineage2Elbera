// StoreWnd verification (mock gateway on 8085). Flow:
//   manage view: ActionWnd 'Private Store - Sell' cell -> storeManageSell
//     (NOT action{10} — the deterministic bridge path) -> storeMsgSell
//     opens the window -> title prompt (MessageButton) -> dblclick a
//     stackable -> count+price prompt -> dblclick a non-stackable -> price
//     only -> Start -> storeSetSell (title rides along, NO storeStart op)
//     -> storeState{open,sell} + changeWait sit
//   latch + quirk: re-manage while open -> locked panes; Stop -> storeStop
//     -> storeState{!open} but STILL SITTING; re-list sends action{0}
//     (stand) BEFORE storeManageSell
//   observer view: click Borg twice (real canvas clicks: target, then talk
//     — never attack for players) -> playerStore -> window with his title
//     and prices -> amount prompt -> storeBuy (no price field — the bridge
//     resolves it) -> item + adena move via invUpdate ONLY
//   sell-out: buying the rest auto-closes Borg's store -> next talk: NOTHING
//   offline fixture: '/storeoffline' -> Borg's store persists (playerStore
//     keeps arriving after buys)
// Output: verify_shots/store_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const BORG = 80002;
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
      `window.__world.net.connected && window.__world.entities.snapshot().length >= 6
       && window.__world.net.log.some(m => m.op === 'itemList')`, { timeout: 20000 });
    await sleep(1200);

    const dbl = (sel) => page.evaluate((s) => {
      document.querySelector(s).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, sel);
    const clickBtn = (id) => page.evaluate((i) => {
      [...document.querySelectorAll('#l2-storewnd .l2-store-btn')]
        .filter(b => b.dataset.id === i)[0].click();
    }, id);
    const promptOk = (winId, values) => page.evaluate((id, vals) => {
      const inputs = [...document.querySelectorAll(`#${id} input`)];
      vals.forEach((v, i) => { if (inputs[i]) inputs[i].value = String(v); });
      [...document.querySelectorAll(`#${id} .l2wnd-body div`)]
        .filter(d => d.style.cursor === 'pointer')[0].click();   // OK
    }, winId, values);
    const outOps = (op) => page.evaluate((o) =>
      window.__world.net.log.filter(m => m.dir === 'out' && m.op === o), op);

    // -- manage view via the ActionWnd private-store action -------------------
    await page.evaluate(() => {
      document.querySelector('.l2-action-cell[data-action-id="10"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeManageSell')
       && window.__world.storeWnd.visible`, { timeout: 10000 });
    summary.manage = await page.evaluate(() => ({
      bridgePath: window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeManageSell'),
      nativePathUnused: !window.__world.net.log.some(
        m => m.dir === 'out' && m.op === 'action' && m.actionId === 10),
      mode: window.__world.storeWnd.mode,
      topCells: document.querySelectorAll('.l2-store-top .l2-store-cell').length,
      sellables: window.__world.storeWnd.topItems.map(i => i.itemId),
      // Font renders text as bitmap canvases (font.js:161) — textContent is
      // empty for L2 labels; adenaEl.title is the ConvertNumToText stand-in
      adenaLine: window.__world.storeWnd.adenaEl.title === '1200',
      registered: window.__world.wndMgr.names.includes('PrivateShopWnd'),
    }));

    // -- title via the MessageButton prompt -------------------------------------
    await clickBtn('MessageButton');
    await page.waitForFunction('window.__world.storeWnd.titleWin.visible', { timeout: 5000 });
    await promptOk('l2-store-title', ['Mock venta']);
    summary.title = await page.evaluate(() => ({
      stored: window.__world.storeWnd.title,
      inWindowTitle: window.__world.storeWnd.win.title.includes('Mock venta'),
    }));

    // -- add a stackable (count+price prompt) and a non-stackable (price only) --
    await dbl('.l2-store-top .l2-store-cell[data-key="o90005"]');
    await page.waitForFunction('window.__world.storeWnd.priceWin.visible', { timeout: 5000 });
    summary.pricePrompt = await page.evaluate(() => ({
      countEnabled: !window.__world.storeWnd.priceCountInput.disabled,
    }));
    await promptOk('l2-store-price', [5, 120]);
    await sleep(300);
    await dbl('.l2-store-top .l2-store-cell[data-key="o90004"]');
    await page.waitForFunction('window.__world.storeWnd.priceWin.visible', { timeout: 5000 });
    summary.pricePrompt.countDisabledForSingle =
      await page.evaluate(() => window.__world.storeWnd.priceCountInput.disabled);
    await promptOk('l2-store-price', [1, 400]);
    await sleep(400);
    summary.listing = await page.evaluate(() => ({
      bottom: [...window.__world.storeWnd.cart.values()]
        .map(e => ({ objectId: e.objectId, count: e.count, price: e.price })),
      total: window.__world.storeWnd.priceEl.title === '1000',
      topLeft: window.__world.storeWnd.topItems.map(i => i.objectId),
    }));
    await page.screenshot({ path: path.join(OUT, 'store_01_manage.png') });

    // -- Start: storeSetSell IS the start (no storeStart op ever) ----------------
    await clickBtn('OKButton');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeSetSell')
       && window.__world.net.log.some(m => m.op === 'storeState' && m.open)`,
      { timeout: 10000 });
    await sleep(600);
    summary.start = await page.evaluate(() => {
      const set = window.__world.net.log.find(m => m.dir === 'out' && m.op === 'storeSetSell');
      return {
        items: set && set.items, title: set && set.title,
        noStoreStartOp: !window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeStart'),
        windowHidOnStart: !window.__world.storeWnd.visible,
        sitting: window.__world.character.sitting === true,
        storeOpen: window.__world.storeWnd.storeOpen,
        sysMsgBabbled: window.__world.net.log.some(m => m.op === 'sysMsg'),
      };
    });

    // -- re-manage while open: the list latches ----------------------------------
    await page.evaluate(() => {
      document.querySelector('.l2-action-cell[data-action-id="10"]').click();
    });
    await page.waitForFunction('window.__world.storeWnd.visible', { timeout: 10000 });
    await sleep(500);
    summary.latch = await page.evaluate(() => ({
      bottomPrefilled: window.__world.storeWnd.cart.size,
      panesFaded: document.querySelector('.l2-store-top').style.opacity === '0.45',
    }));
    await dbl('.l2-store-top .l2-store-cell');   // locked: no prompt
    await sleep(400);
    summary.latch.promptLocked = await page.evaluate(
      () => !window.__world.storeWnd.priceWin.visible);
    await page.screenshot({ path: path.join(OUT, 'store_02_latched.png') });

    // -- Stop: store closes but the player STAYS SITTING (the quirk) -------------
    await clickBtn('StopButton');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeStop')
       && !window.__world.net.log.slice(-8).some(m => m.op === 'storeState' && m.open)`,
      { timeout: 10000 });
    await sleep(600);
    summary.afterStop = await page.evaluate(() => ({
      closed: !window.__world.storeWnd.storeOpen,
      stillSitting: window.__world.character.sitting === true,   // the quirk
    }));

    // -- re-list: stand FIRST (action 0), then storeManageSell -------------------
    await page.evaluate(() => {
      document.querySelector('.l2-action-cell[data-action-id="10"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'action' && m.actionId === 0)`,
      { timeout: 8000 });
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'storeManageSell').length >= 2
       && window.__world.storeWnd.visible`, { timeout: 8000 });
    summary.standFirst = await page.evaluate(() => {
      const log = window.__world.net.log.filter(m => m.dir === 'out');
      const stand = log.findIndex(m => m.op === 'action' && m.actionId === 0);
      const manages = log.map((m, i) => [m, i]).filter(([m]) => m.op === 'storeManageSell');
      return {
        // the stand must precede the LAST manage (manages[1] is the re-manage
      // while open, which correctly precedes the stand)
      standBeforeManage: stand >= 0 && manages.length >= 2
        && manages[manages.length - 1][1] > stand,
        stoodUp: window.__world.character.sitting === false,
      };
    });
    // leave the manage view via the X: manage-mode close sends storeStop
    await page.evaluate(() => window.__world.storeWnd.win.closeBtn.click());
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'storeStop').length >= 2`,
      { timeout: 8000 });
    summary.closeIsQuit = { storeStopSent: true, hidden: true };

    // -- observer view: REAL canvas clicks on Borg (target, then talk) ----------
    // frame Borg and click him: the follow camera converges asynchronously,
    // so wait until Borg's projection STABILIZES on the canvas before
    // clicking (fixed sleeps proved flaky)
    const projectStable = async (id) => {
      let last = null;
      for (let i = 0; i < 20; i++) {
        const bp = await page.evaluate((eid) => {
          const w = window.__world;
          const e = w.entities.getEntity(eid);
          if (!e) return null;
          const V = e.group.position.constructor;
          // click the pick-center main.js:888 uses for PLAYERS (+1.0m) —
          // +0.3 was the feet: the raycast missed the sitting mesh and the
          // screen-space fallback (40px radius at +1.0) was 0.7m away, so
          // the click fell through to terrain (moveTo)
          const p = w.project(new V(e.group.position.x, e.group.position.y + 1.0, e.group.position.z));
          const at = document.elementFromPoint(p.x, p.y);
          return { ...p, onCanvas: !!(at && at.tagName === 'CANVAS') };
        }, id);
        if (bp && !bp.behind && bp.onCanvas
            && bp.x >= 20 && bp.x <= 1260 && bp.y >= 20 && bp.y <= 880
            && last && Math.hypot(bp.x - last.x, bp.y - last.y) < 8) return bp;
        last = bp;
        await sleep(500);
      }
      return null;
    };
    const clickDebugDump = () => page.evaluate(() => {
      const w = window.__world;
      const e = w.entities.getEntity(80002);
      const c = w.character.group.position;
      let proj = null, at = null;
      if (e) {
        const V = e.group.position.constructor;
        proj = w.project(new V(e.group.position.x, e.group.position.y + 1.0, e.group.position.z));
        const el = document.elementFromPoint(proj.x, proj.y);
        at = el && { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 80) };
      }
      return {
        hasBorg: !!e, ids: [...w.entities.entities.keys()],
        charPos: c.toArray(), borgPos: e && e.group.position.toArray(),
        proj, at,
        sitting: w.character.sitting,
        outOps: w.net.log.filter(m => m.dir === 'out').map(m => m.op),
        cam: { yaw: w.followCam.yaw, pitch: w.followCam.pitch, dist: w.followCam.dist },
      };
    });
    // yawOffset shifts the entity's projection off the top-center band: the
    // second (talk) click must clear the TargetStatusWnd that the first
    // (target) click docked right where Borg was projecting
    const clickEntity3d = async (id, outOp, yawOffset = 0) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await page.evaluate((eid, off) => {
          const w = window.__world;
          const e = w.entities.getEntity(eid);
          const c = w.character.group.position;
          w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z) + off;
          w.followCam.pitch = 0.3;
          w.followCam.dist = Math.max(w.followCam.minDist, 4);
        }, id, yawOffset);
        const bp = await projectStable(id);
        if (!bp) continue;
        await page.mouse.click(bp.x, bp.y);
        try {
          await page.waitForFunction(
            `window.__world.net.log.some(m => m.dir === 'out' && m.op === '${outOp}' && m.id === ${id})`,
            { timeout: 3000 });
          return true;
        } catch { /* miss — reframe and retry */ }
      }
      return false;
    };
    if (!await clickEntity3d(BORG, 'target')) {
      summary.clickDebug = await clickDebugDump();
      console.log(JSON.stringify(summary, null, 2));
      throw new Error('could not click-target Borg');
    }
    await sleep(500);
    if (!await clickEntity3d(BORG, 'talk', 0.35)) {
      summary.clickDebug = await clickDebugDump();
      console.log(JSON.stringify(summary, null, 2));
      throw new Error('could not click-talk Borg');
    }
    summary.clickPath = await page.evaluate(() => ({
      talkSent: true,
      neverAttacked: !window.__world.net.log.some(
        m => m.dir === 'out' && m.op === 'attack' && m.id === 80002),
    }));
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'playerStore' && m.id === ${BORG})
       && window.__world.storeWnd.visible`, { timeout: 10000 });
    await sleep(500);
    summary.observer = await page.evaluate(() => ({
      mode: window.__world.storeWnd.mode,
      storeId: window.__world.storeWnd.storeId,
      titleInBar: window.__world.storeWnd.win.title.includes("Borg's goods"),
      stopHidden: document.querySelector('#l2-storewnd .l2-store-btn[data-id="StopButton"]')
        .style.display === 'none',
      topCells: document.querySelectorAll('.l2-store-top .l2-store-cell').length,
      adenaLine: window.__world.storeWnd.adenaEl.title === '1200',
    }));
    await page.screenshot({ path: path.join(OUT, 'store_03_observer.png') });

    // -- buy 2 potions (amount prompt; price resolved bridge-side) ----------------
    await dbl('.l2-store-top .l2-store-cell[data-key="o95012"]');
    await page.waitForFunction('window.__world.storeWnd.amountWin.visible', { timeout: 5000 });
    await promptOk('l2-store-amount', [2]);
    await sleep(400);
    summary.cart = await page.evaluate(() => ({
      // 2 potions x 120 = 240 (priceEl.title — Font text is a bitmap)
      total: window.__world.storeWnd.priceEl.title,
    }));
    await clickBtn('OKButton');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeBuy')`,
      { timeout: 8000 });
    await page.waitForFunction(
      `[...window.__world.inventory.items.values()].find(i => i.itemId === 57).count === 960`,
      { timeout: 8000 });
    summary.buy = await page.evaluate(() => {
      const buy = window.__world.net.log.find(m => m.dir === 'out' && m.op === 'storeBuy');
      const inv = [...window.__world.inventory.items.values()];
      return {
        payload: buy && { storeId: buy.storeId, items: buy.items },
        noPriceSent: buy && !('price' in buy.items[0]),
        adena: inv.find(i => i.itemId === 57).count,          // 1200 - 240
        potions: inv.find(i => i.itemId === 1060).count,      // 12 + 2
        windowHidOnBuy: !window.__world.storeWnd.visible,
      };
    });

    // -- sell-out: buy the rest -> the store auto-closes ---------------------------
    await page.evaluate(() => window.__world.net.sendOp('talk', { id: 80002 }));
    await page.waitForFunction('window.__world.storeWnd.visible', { timeout: 8000 });
    await sleep(400);
    await dbl('.l2-store-top .l2-store-cell[data-key="o95011"]');   // mace x1: no prompt
    await dbl('.l2-store-top .l2-store-cell[data-key="o95012"]');   // last potion: no prompt
    await sleep(300);
    summary.sellOutPromptless = await page.evaluate(() => ({
      noAmountPrompt: !window.__world.storeWnd.amountWin.visible,
      cartSize: window.__world.storeWnd.cart.size,
    }));
    await clickBtn('OKButton');
    await page.waitForFunction(
      `[...window.__world.inventory.items.values()].find(i => i.itemId === 57).count === 440`,
      { timeout: 8000 });
    const psCount = await page.evaluate(
      () => window.__world.net.log.filter(m => m.op === 'playerStore').length);
    await page.evaluate(() => window.__world.net.sendOp('talk', { id: 80002 }));
    await sleep(2500);
    summary.sellOut = await page.evaluate((n) => ({
      adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
      storeAnswersNothing: window.__world.net.log.filter(m => m.op === 'playerStore').length === n,
    }), psCount);

    // -- offline fixture: the store persists ---------------------------------------
    await page.evaluate(
      () => window.__world.net.sendOp('say', { channel: 0, text: '/storeoffline' }));
    await sleep(400);
    await page.evaluate(() => window.__world.net.sendOp('talk', { id: 80002 }));
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'playerStore').length > ${psCount}
       && window.__world.storeWnd.visible`, { timeout: 8000 });
    await dbl('.l2-store-top .l2-store-cell[data-key="o95012"]');
    await page.waitForFunction('window.__world.storeWnd.amountWin.visible', { timeout: 5000 });
    await promptOk('l2-store-amount', [1]);
    await sleep(300);
    await clickBtn('OKButton');
    await page.waitForFunction(
      `[...window.__world.inventory.items.values()].find(i => i.itemId === 57).count === 320`,
      { timeout: 8000 });
    // the persistent store keeps serving views after the buy
    const psCount2 = await page.evaluate(
      () => window.__world.net.log.filter(m => m.op === 'playerStore').length);
    await page.evaluate(() => window.__world.net.sendOp('talk', { id: 80002 }));
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'playerStore').length > ${psCount2}`,
      { timeout: 8000 });
    summary.offline = {
      persistsAfterBuy: true,
      adena: await page.evaluate(
        () => [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count),
    };
    await page.screenshot({ path: path.join(OUT, 'store_04_offline.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY STORE FAILED:', e.stack || e.message); process.exit(1); });
