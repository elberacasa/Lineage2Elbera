// StoreWnd LIVE pass: two headless clients on the REAL stack
// (aCis :2106/:7777 + gateway :8090), separate profiles -> separate
// deviceIds -> separate accounts/characters.
//   B funds the purchase first (fresh chars start at 0 adena — gremlin
//   kill, autoloot, same walk-first melee as gateway verify-store.js).
//   A opens the manage view through the REAL ActionWnd 'Private Store -
//   Sell' cell (bridge op storeManageSell, NOT action{10}), lists the
//   Tutorial Guide (5588, the one tradable starter item) @10 with the
//   title 'Venta guia 123' via the prompts, Starts (storeSetSell IS the
//   start — no storeStart op) -> A sits, storeState{open,sell}.
//   B walks over, targets + talks A -> playerStore -> the observer view
//   shows A's title and prices -> B buys the guide (no price sent — the
//   bridge resolves it from its playerStore cache) -> item + adena move
//   EXACT (B -10, A +10) -> A's store auto-closes on sell-out
//   (storeState{open:false}) and A stays SITTING (the quirk).
// Output: verify_shots/store_live_A_open.png, store_live_B_observer.png,
// store_live_B_bought.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const GUIDE_ID = 5588;
const ADENA_ID = 57;
const PRICE = 10;
const TITLE = 'Venta guia 123';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  return { browser, page };
}

const sendOp = (c, op, fields = {}) =>
  c.page.evaluate((o, f) => window.__world.net.sendOp(o, f), op, fields);
const adenaOf = (c) => c.page.evaluate(() => {
  const a = [...window.__world.inventory.items.values()].find(i => i.itemId === 57);
  return a ? a.count : 0;
});

// Walk-first melee kill (the ranged auto-approach stalls with geodata on)
// — same shape as gateway/test/verify-store.js, driven through the page's
// net. Positions ride the L2 coords of the addNpc/move/enterWorld msgs.
async function killGremlin(c, label) {
  const pick = await c.page.evaluate(() => {
    const w = window.__world;
    const me = w.net.log.find(m => m.op === 'enterWorld').char;
    const myMoves = [...w.net.log].reverse().find(m => m.op === 'move' && m.id === me.id);
    const self = myMoves ? { x: myMoves.tx, y: myMoves.ty } : me;
    const dead = new Set(w.net.log.filter(m => m.op === 'die').map(m => m.id));
    const seen = new Map();
    for (const m of w.net.log) {
      if (m.op === 'addNpc' && m.name === 'Gremlin' && !dead.has(m.id)) {
        seen.set(m.id, { id: m.id, x: m.x, y: m.y, z: m.z });
      }
      if (m.op === 'move' && seen.has(m.id)) {
        const g = seen.get(m.id);
        g.x = m.tx; g.y = m.ty; g.z = m.tz;
      }
    }
    const gs = [...seen.values()]
      .map(g => ({ ...g, dist: Math.hypot(g.x - self.x, g.y - self.y) }))
      .sort((a, b) => a.dist - b.dist);
    return gs[0] || null;
  });
  if (!pick) throw new Error('no live Gremlin for ' + label);
  console.log(`   killing Gremlin id=${pick.id} (${label})...`);
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    const died = await c.page.evaluate(
      (id) => window.__world.net.log.some(m => m.op === 'die' && m.id === id), pick.id);
    if (died) break;
    await sendOp(c, 'moveTo', { x: pick.x + 20, y: pick.y, z: pick.z });
    await sleep(4000);
    const t1 = Date.now();
    while (Date.now() - t1 < 15000) {
      const died = await c.page.evaluate(
        (id) => window.__world.net.log.some(m => m.op === 'die' && m.id === id), pick.id);
      if (died) break;
      await sendOp(c, 'attack', { id: pick.id });
      await sleep(4000);
    }
  }
  const died = await c.page.evaluate(
    (id) => window.__world.net.log.some(m => m.op === 'die' && m.id === id), pick.id);
  if (!died) throw new Error('kill timeout ' + label);
  await sleep(2500);   // let loot settle (autoloot is globally ON)
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = {};
  const A = await launch();
  const B = await launch();
  try {
    const nameA = await A.page.evaluate(
      () => window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
    const nameB = await B.page.evaluate(
      () => window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
    summary.names = { A: nameA, B: nameB };
    // let both sides fully settle (npc stream for B's hunt, addPlayer both ways)
    await sleep(4000);

    // -- 1. B funds the purchase (gremlin kill, autoloot) ----------------------
    summary.adenaB0 = await adenaOf(B);
    for (let i = 0; i < 4 && await adenaOf(B) < PRICE; i++) {
      await killGremlin(B, `adena ${await adenaOf(B)}/${PRICE}`);
    }
    summary.adenaBfunded = await adenaOf(B);
    if (summary.adenaBfunded < PRICE) throw new Error('B could not earn enough adena');

    // -- 2. A opens the manage view via the ActionWnd private-store action -----
    await A.page.evaluate(() => {
      document.querySelector('.l2-action-cell[data-action-id="10"]').click();
    });
    await A.page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeManageSell')
       && window.__world.net.log.some(m => m.op === 'storeMsgSell')
       && window.__world.storeWnd.visible`, { timeout: 15000 });
    summary.manage = await A.page.evaluate(() => ({
      bridgePath: window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeManageSell'),
      nativePathUnused: !window.__world.net.log.some(
        m => m.dir === 'out' && m.op === 'action' && m.actionId === 10),
      mode: window.__world.storeWnd.mode,
      sellables: window.__world.storeWnd.topItems.map(i => i.itemId),
    }));
    const guideOid = await A.page.evaluate((gid) => {
      const g = window.__world.storeWnd.topItems.find(i => i.itemId === gid);
      return g ? g.objectId : null;
    }, GUIDE_ID);
    if (guideOid == null) throw new Error('A has no Tutorial Guide among the sellables');

    // -- 3. title via MessageButton, list the guide @10, Start ------------------
    await A.page.evaluate(() => {
      [...document.querySelectorAll('#l2-storewnd .l2-store-btn')]
        .filter(b => b.dataset.id === 'MessageButton')[0].click();
    });
    await A.page.waitForFunction('window.__world.storeWnd.titleWin.visible', { timeout: 5000 });
    await A.page.evaluate((t) => {
      const input = document.querySelector('#l2-store-title input');
      input.value = t;
      [...document.querySelectorAll('#l2-store-title .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer')[0].click();
    }, TITLE);
    await A.page.waitForFunction(
      (t) => window.__world.storeWnd.title === t, { timeout: 5000 }, TITLE);

    // the guide is not stackable: the count row is disabled, only the price
    await A.page.evaluate((oid) => {
      document.querySelector(`.l2-store-top .l2-store-cell[data-key="o${oid}"]`)
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, guideOid);
    await A.page.waitForFunction('window.__world.storeWnd.priceWin.visible', { timeout: 5000 });
    summary.pricePrompt = await A.page.evaluate(() => ({
      countDisabledForSingle: window.__world.storeWnd.priceCountInput.disabled,
    }));
    await A.page.evaluate((p) => {
      const inputs = [...document.querySelectorAll('#l2-store-price input')];
      inputs[1].value = String(p);
      [...document.querySelectorAll('#l2-store-price .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer')[0].click();
    }, PRICE);
    await sleep(500);
    await A.page.screenshot({ path: path.join(OUT, 'store_live_A_manage.png') });

    await A.page.evaluate(() => {
      [...document.querySelectorAll('#l2-storewnd .l2-store-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    await A.page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeSetSell')
       && window.__world.net.log.some(m => m.op === 'storeState' && m.open)`,
      { timeout: 15000 });
    await sleep(800);
    summary.open = await A.page.evaluate(() => {
      const set = window.__world.net.log.find(m => m.dir === 'out' && m.op === 'storeSetSell');
      return {
        items: set && set.items, title: set && set.title,
        noStoreStartOp: !window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeStart'),
        sitting: window.__world.character.sitting === true,
        storeOpen: window.__world.storeWnd.storeOpen,
      };
    });
    await A.page.screenshot({ path: path.join(OUT, 'store_live_A_open.png') });

    // -- 4. B walks over and opens A's store (target + talk) --------------------
    const idA = await B.page.evaluate((n) => {
      const m = window.__world.net.log.find(x => x.op === 'addPlayer' && x.name === n);
      return m ? m.id : null;
    }, nameA);
    if (idA == null) throw new Error('A not visible to B (no addPlayer)');
    const posA = await B.page.evaluate((id) => {
      const add = window.__world.net.log.find(x => x.op === 'addPlayer' && x.id === id);
      const mv = [...window.__world.net.log].reverse().find(x => x.op === 'move' && x.id === id);
      return mv ? { x: mv.tx, y: mv.ty, z: mv.tz } : { x: add.x, y: add.y, z: add.z };
    }, idA);
    await sendOp(B, 'moveTo', posA);
    await sleep(3000);   // buyer must be within 150 of the store (M13)
    await sendOp(B, 'target', { id: idA });
    await sleep(600);
    await sendOp(B, 'talk', { id: idA });
    await B.page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'playerStore' && m.id === ${idA})
       && window.__world.storeWnd.visible`, { timeout: 15000 });
    await sleep(600);
    summary.observer = await B.page.evaluate((title) => ({
      mode: window.__world.storeWnd.mode,
      storeId: window.__world.storeWnd.storeId,
      titleInBar: window.__world.storeWnd.win.title.includes(title),
      stopHidden: document.querySelector('#l2-storewnd .l2-store-btn[data-id="StopButton"]')
        .style.display === 'none',
      items: window.__world.storeWnd.topItems.map(i => ({
        objectId: i.objectId, itemId: i.itemId, price: i.price,
      })),
    }), TITLE);
    await B.page.screenshot({ path: path.join(OUT, 'store_live_B_observer.png') });

    // -- 5. B buys the guide (count 1 -> no amount prompt; price bridge-side) ---
    const adenaA0 = await adenaOf(A);
    const adenaB0 = await adenaOf(B);
    await B.page.evaluate((oid) => {
      document.querySelector(`.l2-store-top .l2-store-cell[data-key="o${oid}"]`)
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, guideOid);
    await sleep(400);
    summary.buyPromptless = await B.page.evaluate(
      () => !window.__world.storeWnd.amountWin.visible
        && window.__world.storeWnd.cart.size === 1);
    await B.page.evaluate(() => {
      [...document.querySelectorAll('#l2-storewnd .l2-store-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    await B.page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'storeBuy')`,
      { timeout: 10000 });
    // the guide moves A -> B, the adena B -> A (exact amounts)
    await B.page.waitForFunction(
      `[...window.__world.inventory.items.values()].some(i => i.itemId === ${GUIDE_ID})`,
      { timeout: 15000 });
    await A.page.waitForFunction(
      `![...window.__world.inventory.items.values()].some(i => i.itemId === ${GUIDE_ID})`,
      { timeout: 15000 });
    await A.page.waitForFunction(
      (a0) => {
        const a = [...window.__world.inventory.items.values()].find(i => i.itemId === 57);
        return (a ? a.count : 0) === a0 + 10;
      }, { timeout: 15000 }, adenaA0);
    await sleep(500);
    summary.buy = {
      payload: await B.page.evaluate(() => {
        const b = window.__world.net.log.find(m => m.dir === 'out' && m.op === 'storeBuy');
        return b && { storeId: b.storeId, items: b.items };
      }),
      noPriceSent: await B.page.evaluate(() => {
        const b = window.__world.net.log.find(m => m.dir === 'out' && m.op === 'storeBuy');
        return b && !('price' in b.items[0]);
      }),
      adenaA: { before: adenaA0, after: await adenaOf(A) },
      adenaB: { before: adenaB0, after: await adenaOf(B) },
    };
    summary.buy.adenaExact = summary.buy.adenaA.after === adenaA0 + PRICE
      && summary.buy.adenaB.after === adenaB0 - PRICE;

    // sell-out: A's only item sold -> the store auto-closes, A STAYS SITTING
    await A.page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'storeState' && !m.open)`,
      { timeout: 15000 });
    await sleep(500);
    summary.sellOut = await A.page.evaluate(() => ({
      autoClosed: !window.__world.storeWnd.storeOpen,
      stillSitting: window.__world.character.sitting === true,   // the quirk
    }));
    await B.page.screenshot({ path: path.join(OUT, 'store_live_B_bought.png') });
  } catch (err) {
    summary.error = err.message;
    summary.debug = {};
    for (const [tag, c] of [['A', A], ['B', B]]) {
      try {
        summary.debug[tag] = await c.page.evaluate(() => ({
          ops: [...new Set(window.__world.net.log.map(m => m.op))],
          storeOps: window.__world.net.log.filter(m => m.op.startsWith('store')
            || m.op === 'playerStore'),
          outStore: window.__world.net.log.filter(m => m.dir === 'out'
            && (m.op.startsWith('store') || m.op === 'action')),
          sitting: window.__world.character.sitting,
          wndVisible: window.__world.storeWnd && window.__world.storeWnd.visible,
        }));
      } catch (e2) { summary.debug[tag] = String(e2); }
    }
    console.log(JSON.stringify(summary, null, 2));
    throw err;
  } finally {
    await A.browser.close();
    await B.browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(async (e) => {
  console.error('VERIFY STOREWND LIVE FAILED:', e.stack || e.message);
  process.exit(1);
});
