// TradeWnd LIVE pass: two headless clients on the REAL stack
// (aCis :2106/:7777 + gateway :8090), separate profiles -> separate
// deviceIds -> separate accounts/characters.
//   A targets B, invites via the chat '/trade' wiring (tradeRequest is
//   name-based, M12) -> B gets tradeAsk -> B accepts -> BOTH tradeStart
//   (fresh chars can only offer the Tutorial Guide, 5588 — aCis starter
//   gear is is_tradable=false) -> A offers the guide -> A sees tradeOwn,
//   B sees tradeOther -> A confirms alone (NO tradeEnd yet — two-phase)
//   -> B confirms -> tradeEnd{done} both sides; the guide moves via
//   invUpdate. Screenshots from both sides.
// Output: verify_shots/tw_live_A.png, tw_live_B.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
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
    // both sides must fully settle: the bridge resolves tradeRequest's
    // name through ITS visible-players map (CharInfo) — too early and
    // the request silently goes nowhere
    await sleep(4000);

    // A targets B (CharInfo must be known — same spawn area) and invites
    // through the real chat wiring: bare '/trade' with a player targeted
    const idB = await A.page.evaluate((n) => {
      const m = window.__world.net.log.find(x => x.op === 'addPlayer' && x.name === n);
      return m ? m.id : null;
    }, nameB);
    summary.bVisibleToA = idB != null;
    if (idB == null) throw new Error('B not visible to A (no addPlayer)');
    await A.page.evaluate((id) => window.__world.net.sendOp('target', { id }), idB);
    await sleep(600);
    await A.page.evaluate(() => {
      const input = document.getElementById('chat-input');
      input.value = '/trade';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await A.page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'tradeRequest')`,
      { timeout: 15000 });

    // B gets the ask prompt and accepts
    await B.page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'tradeAsk')
       && window.__world.tradeWnd.askWin.visible`, { timeout: 30000 });
    summary.bAsk = await B.page.evaluate(() => ({ from: window.__world.tradeWnd.askFrom }));
    await B.page.evaluate(() => {
      const btns = [...document.querySelectorAll('#l2-tradeask .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer');
      btns[0].click();   // Accept
    });

    // both sides open; fresh chars offer only the Tutorial Guide (5588)
    for (const c of [A, B]) {
      await c.page.waitForFunction('window.__world.tradeWnd.visible', { timeout: 30000 });
    }
    await sleep(800);
    summary.aStart = await A.page.evaluate(() => ({
      partner: window.__world.tradeWnd.partner,
      tradable: window.__world.tradeWnd.tradable.map(i => i.itemId),
    }));
    summary.bStart = await B.page.evaluate(() => ({
      partner: window.__world.tradeWnd.partner,
      tradable: window.__world.tradeWnd.tradable.map(i => i.itemId),
    }));
    const guideOid = await A.page.evaluate(() => {
      const g = window.__world.tradeWnd.tradable.find(i => i.itemId === 5588);
      return g ? g.objectId : null;
    });
    if (guideOid == null) throw new Error('A has no Tutorial Guide (5588) in tradeStart items');

    // A offers the guide (count 1 -> no amount prompt)
    await A.page.evaluate((oid) => {
      document.querySelector(`.l2-trade-inventory .l2-trade-cell[data-key="o${oid}"]`)
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, guideOid);
    await A.page.waitForFunction('window.__world.tradeWnd.ownOffer.length === 1',
      { timeout: 15000 });
    await B.page.waitForFunction('window.__world.tradeWnd.otherOffer.length === 1',
      { timeout: 15000 });
    await sleep(500);
    summary.offers = {
      aOwn: await A.page.evaluate(() => window.__world.tradeWnd.ownOffer.map(i => i.itemId)),
      bOther: await B.page.evaluate(() => window.__world.tradeWnd.otherOffer.map(i => i.itemId)),
    };

    // A confirms ALONE: own-side latch, and NO tradeEnd anywhere (two-phase)
    await A.page.evaluate(() => {
      [...document.querySelectorAll('#l2-tradewnd .l2-trade-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    await A.page.waitForFunction('window.__world.tradeWnd.ownConfirmed', { timeout: 8000 });
    await sleep(2500);
    summary.twoPhase = {
      aLatched: await A.page.evaluate(() => window.__world.tradeWnd.ownConfirmed),
      aStillOpen: await A.page.evaluate(() => window.__world.tradeWnd.visible),
      noTradeEndYet: await A.page.evaluate(
        () => !window.__world.net.log.some(m => m.op === 'tradeEnd'))
        && await B.page.evaluate(
          () => !window.__world.net.log.some(m => m.op === 'tradeEnd')),
    };
    await A.page.screenshot({ path: path.join(OUT, 'tw_live_A.png') });

    // B confirms -> the exchange runs
    await B.page.evaluate(() => {
      [...document.querySelectorAll('#l2-tradewnd .l2-trade-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    for (const c of [A, B]) {
      await c.page.waitForFunction(
        `window.__world.net.log.some(m => m.op === 'tradeEnd' && m.reason === 'done')`,
        { timeout: 30000 });
    }
    await sleep(1000);
    summary.after = {
      a: await A.page.evaluate(() => ({
        hidden: !window.__world.tradeWnd.visible,
        hasGuide: [...window.__world.inventory.items.values()].some(i => i.itemId === 5588),
      })),
      b: await B.page.evaluate(() => ({
        hidden: !window.__world.tradeWnd.visible,
        hasGuide: [...window.__world.inventory.items.values()].some(i => i.itemId === 5588),
      })),
    };
    await B.page.screenshot({ path: path.join(OUT, 'tw_live_B.png') });
  } catch (err) {
    summary.error = err.message;
    summary.debug = {};
    for (const [tag, c] of [['A', A], ['B', B]]) {
      try {
        summary.debug[tag] = await c.page.evaluate(() => ({
          ops: [...new Set(window.__world.net.log.map(m => m.op))],
          tradeOps: window.__world.net.log.filter(m => m.op.startsWith('trade')),
          outTrade: window.__world.net.log.filter(m => m.dir === 'out' && m.op.startsWith('trade')),
          target: window.__world.combat.target,
          askVisible: window.__world.tradeWnd && window.__world.tradeWnd.askWin.visible,
          wndVisible: window.__world.tradeWnd && window.__world.tradeWnd.visible,
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
  console.error('VERIFY TRADEWND LIVE FAILED:', e.message);
  process.exit(1);
});
