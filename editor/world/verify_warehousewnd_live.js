// WarehouseWnd LIVE pass: real stack (aCis :2106/:7777 + gateway :8090 with
// the landed M16 warehouse ops). Mirrors gateway/test/verify-warehouse.js
// through the WINDOW, not raw ops:
//   0. FRESH char farms 2 gremlins (creates the adena items-row), offline,
//      SQL seeds 5000 adena (offline UPDATE of the EXISTING row only;
//      skips farming when a persisted char already has the row).
//   1. Re-login, walk the proven road to Warehouse Keeper Wilford (30005,
//      TI town), talk -> real DepositP bypass -> whDeposit opens the window
//      (deposit mode): adena line 5000, inventory side, equipped excluded.
//   2. Stage 500 adena (NumberPad stand-in prompt) + the first regular
//      item x1 -> fee line 2x30 = 60 -> OK -> whDepositItems ->
//      invUpdate: adena 5000-500-60 = 4440 (the M16 pattern).
//      (DepositP temp-disables the inventory 1.5s server-side — 2.5s wait.)
//   3. WithdrawP -> whWithdraw (the item + adena, stackable adena under a
//      NEW objectId) -> stage both back -> OK -> whWithdrawItems ->
//      invUpdate: adena 4940 (the fee is NOT refunded), item restored.
// Output: verify_shots/wh_live_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const DEVICE_ID = 'verify-warehouse-agent-check';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// SOURCED from gateway/test/verify-warehouse.js (the proven M16 run)
const WILFORD = { npcId: 30005, x: -81512, y: 243424, z: -3720 };
const SEED_ADENA = 5000;
const DEPOSIT_ADENA = 500;
const FEE = 2 * 30;   // 30 adena per entry (WarehouseWnd.uc KEEPING_PRICE)
const TOWN_ROUTE = [[-83784, 240792, -3720], [-83592, 240792, -3720], [-83400, 240792, -3720],
  [-83208, 240792, -3720], [-83080, 240856, -3680], [-83080, 241048, -3720], [-83080, 241240, -3720],
  [-83080, 241432, -3728], [-83080, 241624, -3728], [-83016, 241752, -3728], [-82888, 241816, -3728],
  [-82776, 241896, -3728], [-82680, 241992, -3728], [-82584, 242088, -3728], [-82488, 242184, -3728],
  [-82392, 242280, -3728], [-82312, 242392, -3728], [-82200, 242472, -3728], [-82104, 242568, -3728],
  [-81992, 242648, -3728], [-81896, 242744, -3728], [-81800, 242840, -3728], [-81688, 242920, -3728],
  [-81608, 243032, -3728], [-81512, 243128, -3720], [-81512, 243320, -3720]];
const HOPS = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'gateway', 'test', 'road-to-town.json'), 'utf8'))
  .concat([[-84104, 244200, -3728], [-84100, 243600, -3728], [-84050, 243000, -3728],
    [-83950, 242400, -3728], [-83900, 241800, -3720], [-83850, 241300, -3720]], TOWN_ROUTE);

const db = (q) => execFileSync('mariadb',
  ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();

const summary = {};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((id) => {
    localStorage.setItem('l2vzla.deviceId', id);
  }, DEVICE_ID);
  page.on('pageerror', e => console.error('PAGEERROR:', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });

  const goOnline = async () => {
    const on = await page.evaluate(() => window.__world.net.connected);
    if (!on) await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
      { timeout: 120000 });
    await sleep(2500);
  };
  await goOnline();
  summary.charName = await page.evaluate(
    () => window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
  const charId = await page.evaluate(
    () => window.__world.net.log.find(m => m.op === 'enterWorld').char.id);
  summary.charId = charId;

  const l2pos = () => page.evaluate(() => {
    const p = window.__world.character.group.position;
    return { x: Math.round(p.x * 100), y: Math.round(-p.z * 100), z: Math.round(p.y * 100) };
  });
  const srvPos = () => page.evaluate(() => {
    const id = window.__world.net.selfId;
    const m = [...window.__world.net.log].reverse()
      .find(m => m.op === 'move' && m.id === id);
    return m ? { x: m.tx, y: m.ty, z: m.tz } : null;
  });
  const adenaNow = () => page.evaluate(() => {
    const a = [...window.__world.inventory.items.values()].find(i => i.itemId === 57);
    return a ? a.count : 0;
  });

  // -- 0. the adena row must exist before the offline seed -------------------
  const adenaRow = db(`SELECT count FROM items WHERE owner_id=${charId} AND item_id=57;`);
  summary.adenaRowBefore = adenaRow || null;
  if (!adenaRow) {
    // fresh char: farm 2 gremlins at spawn for the row (auto-loot server)
    summary.farm = { kills: 0 };
    for (let k = 0; k < 2; k++) {
      const g = await page.evaluate(() => {
        const w = window.__world;
        const p = w.character.group.position;
        const gs = w.entities.snapshot()
          .filter(e => e.name === 'Gremlin' && !e.dead)
          .map(e => ({ ...e, d: Math.hypot(e.pos[0] - p.x, e.pos[2] - p.z) }))
          .sort((a, b) => a.d - b.d);
        return gs[0] || null;
      });
      if (!g) throw new Error('no gremlin in range');
      await page.evaluate((h) => {
        const w = window.__world;
        const V = w.character.group.position.constructor;
        w.walkTo(new V(h[0] * 0.01, h[2] * 0.01, -h[1] * 0.01));
      }, [Math.round(g.pos[0] * 100), Math.round(-g.pos[2] * 100), Math.round(g.pos[1] * 100)]);
      await sleep(3000);
      const t0 = Date.now();
      for (;;) {
        const dead = await page.evaluate((id) => {
          const e = window.__world.entities.getEntity(id);
          return e && e.dead;
        }, g.id);
        if (dead) break;
        if (Date.now() - t0 > 120000) throw new Error('gremlin kill timeout');
        await page.evaluate((id) => window.__world.net.sendOp('attack', { id }), g.id);
        await sleep(4000);
      }
      summary.farm.kills++;
      await sleep(2500);   // auto-loot lands
    }
  }

  // -- offline -> seed 5000 adena (UPDATE of the EXISTING row only) ----------
  await page.click('#online-toggle');   // disconnect (the char saves)
  await sleep(1000);
  let offline = false;
  for (let i = 0; i < 30 && !offline; i++) {
    await sleep(2000);
    offline = db(`SELECT online FROM characters WHERE obj_Id=${charId};`) === '0';
  }
  if (!offline) throw new Error('char still online 60s after logout');
  db(`UPDATE items SET count=${SEED_ADENA} WHERE owner_id=${charId} AND item_id=57;`);
  summary.seeded = db(`SELECT count FROM items WHERE owner_id=${charId} AND item_id=57;`);

  // -- 1. re-login, walk to Wilford ------------------------------------------
  await goOnline();
  const distToWilford = await page.evaluate(() => {
    const ew = window.__world.net.log.find(m => m.op === 'enterWorld');
    return Math.hypot(ew.char.x - (-81512), ew.char.y - 243424);
  });
  summary.startDist = Math.round(distToWilford);
  if (distToWilford > 1000) {
    const pos = await l2pos();
    let wpIndex = 0, best = Infinity;
    for (let i = 0; i < HOPS.length; i++) {
      const d = Math.hypot(pos.x - HOPS[i][0], pos.y - HOPS[i][1]);
      if (d < best) { best = d; wpIndex = i; }
    }
    const chain = HOPS.slice(wpIndex);
    for (const hop of chain) {
      const hopStart = Date.now();
      let stalled = false, lastIssue = 0;
      for (;;) {
        const me = (await srvPos()) || await l2pos();
        const dist = Math.hypot(me.x - hop[0], me.y - hop[1]);
        if (dist < 260) break;
        if (Date.now() - hopStart > 60000) { stalled = true; break; }
        if (Date.now() - lastIssue > Math.max(4000, (dist / 115) * 1000 + 1500)) {
          await page.evaluate((h) => {
            window.__world.net.sendOp('moveTo', { x: h[0], y: h[1], z: h[2] });
          }, hop);
          lastIssue = Date.now();
        }
        await sleep(1000);
      }
      if (stalled) {
        const me0 = (await srvPos()) || await l2pos();
        let recovered = false;
        for (const [dx, dy] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]) {
          await page.evaluate((p) => {
            window.__world.net.sendOp('moveTo', { x: p[0], y: p[1], z: p[2] });
          }, [Math.round(me0.x + dx * 240), Math.round(me0.y + dy * 240), Math.round(me0.z)]);
          await sleep(5000);
          const me1 = (await srvPos()) || await l2pos();
          if (Math.hypot(me1.x - me0.x, me1.y - me0.y) > 80) { recovered = true; break; }
        }
        if (!recovered) throw new Error('ROAD-BLOCKED at ' + JSON.stringify(me0));
      }
      console.error(`hop ok (${chain.indexOf(hop) + 1}/${chain.length})`);
    }
  } else {
    summary.walked = 'skipped (persisted nearby)';
  }
  for (let i = 0; i < 15; i++) {
    const p = (await srvPos()) || await l2pos();
    if (Math.hypot(p.x - WILFORD.x, p.y - WILFORD.y) < 80) break;
    await page.evaluate((h) => {
      window.__world.net.sendOp('moveTo', { x: h[0], y: h[1], z: h[2] });
    }, [WILFORD.x, WILFORD.y, WILFORD.z]);
    await sleep(2500);
  }
  await page.waitForFunction(
    `window.__world.entities.snapshot().some(e => e.npcId === ${WILFORD.npcId})`,
    { timeout: 90000 });
  const wilfordId = await page.evaluate(
    (npcId) => window.__world.entities.snapshot().find(e => e.npcId === npcId).id,
    WILFORD.npcId);

  const followKeeperLink = async (kind) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const link = await page.evaluate(async (args) => {
        const before = window.__world.net.log.filter(m => m.op === 'npcHtml').length;
        window.__world.net.sendOp('talk', { id: args.id });
        const t0 = Date.now();
        while (Date.now() - t0 < 12000) {
          await new Promise(r => setTimeout(r, 250));
          const hs = window.__world.net.log.filter(m => m.op === 'npcHtml');
          if (hs.length > before) {
            const m = new RegExp('bypass -h (npc_\\d+_' + args.k + ')')
              .exec(hs[hs.length - 1].html);
            return m ? m[1] : null;
          }
        }
        return null;
      }, { id: wilfordId, k: kind });
      if (link) {
        await page.evaluate((cmd) => window.__world.net.sendOp('bypass', { command: cmd }), link);
        return link;
      }
    }
    throw new Error('no ' + kind + ' link in Wilford html');
  };

  const dbl = (sel) => page.evaluate((s) => {
    document.querySelector(s).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }, sel);
  const amountOk = (n) => page.evaluate((val) => {
    const input = document.querySelector('#l2-wh-amount input');
    input.value = String(val);
    [...document.querySelectorAll('#l2-wh-amount .l2wnd-body div')]
      .filter(d => d.style.cursor === 'pointer')[0].click();
  }, n);
  const clickOk = () => page.evaluate(() => {
    [...document.querySelectorAll('#l2-warehousewnd .l2-wh-btn')]
      .filter(b => b.dataset.id === 'OKButton')[0].click();
  });

  // -- 2. DepositP -> window -> stage guide x1 + 500 adena -> OK -------------
  summary.depositLink = await followKeeperLink('DepositP');
  await page.waitForFunction(
    'window.__world.warehouseWnd.visible && window.__world.warehouseWnd.mode === "deposit"',
    { timeout: 15000 });
  await sleep(1000);
  summary.depositOpen = await page.evaluate(() => {
    const w = window.__world.warehouseWnd;
    const adena = w.topItems.find(i => i.itemId === 57);
    const reg = w.topItems.find(i => i.itemId !== 57);
    return {
      whType: w.whType,
      adenaLine: (w.adenaEl.__l2text || '').split('|')[0],
      topCells: w.topItems.length,
      adenaEntry: adena && { objectId: adena.objectId, count: adena.count },
      regItem: reg && { objectId: reg.objectId, itemId: reg.itemId, count: reg.count },
    };
  });
  if (!summary.depositOpen.regItem) throw new Error('no regular item in whDeposit list');
  await page.screenshot({ path: path.join(OUT, 'wh_live_01_deposit.png') });

  // DepositP temp-disables the inventory 1.5s server-side (README M16) —
  // a deposit inside that window is silently dropped; wait it out
  await sleep(2500);
  const dep = summary.depositOpen;
  await dbl(`.l2-wh-top .l2-wh-cell[data-key="o${dep.adenaEntry.objectId}"]`);
  await sleep(500);
  summary.amountPrompt = await page.evaluate(
    () => window.__world.warehouseWnd.amountWin.visible);
  await amountOk(DEPOSIT_ADENA);
  await sleep(500);
  await dbl(`.l2-wh-top .l2-wh-cell[data-key="o${dep.regItem.objectId}"]`);
  await sleep(500);
  summary.depositCart = await page.evaluate(() => ({
    rows: document.querySelectorAll('.l2-wh-bottom .l2-wh-cell').length,
    fee: (window.__world.warehouseWnd.priceEl.__l2text || '').split('|')[0],
    entries: [...window.__world.warehouseWnd.cart.values()]
      .map(e => ({ objectId: e.objectId, itemId: e.itemId, count: e.count })),
  }));
  await page.screenshot({ path: path.join(OUT, 'wh_live_02_staged.png') });
  await clickOk();
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'whDepositItems'
      && m.items && m.items.length === 2)`, { timeout: 10000 });
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.op === 'invUpdate'
      && (m.updated || []).some(u => u.itemId === 57 && u.count === ${SEED_ADENA - DEPOSIT_ADENA - FEE}))`,
    { timeout: 15000 });
  await sleep(800);
  summary.afterDeposit = await page.evaluate(() => ({
    hidden: !window.__world.warehouseWnd.visible,
    adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
  }));
  summary.expectAfterDeposit = SEED_ADENA - DEPOSIT_ADENA - FEE;   // 4440
  await page.screenshot({ path: path.join(OUT, 'wh_live_03_deposited.png') });

  // -- 3. WithdrawP -> stage both back -> OK ---------------------------------
  summary.withdrawLink = await followKeeperLink('WithdrawP');
  await page.waitForFunction(
    'window.__world.warehouseWnd.visible && window.__world.warehouseWnd.mode === "withdraw"',
    { timeout: 15000 });
  await sleep(1000);
  const wit = await page.evaluate((regItemId) => {
    const w = window.__world.warehouseWnd;
    const adena = w.topItems.find(i => i.itemId === 57);
    const reg = w.topItems.find(i => i.itemId === regItemId);
    return {
      adenaLine: (w.adenaEl.__l2text || '').split('|')[0],
      fee: (w.priceEl.__l2text || '').split('|')[0],
      adena: adena && { objectId: adena.objectId, count: adena.count },
      reg: reg && { objectId: reg.objectId, itemId: reg.itemId, count: reg.count },
    };
  }, dep.regItem.itemId);
  summary.withdrawOpen = wit;
  // the M16 quirks, live: the guide kept its objectId, the adena stack did not
  summary.regKeptOid = wit.reg && wit.reg.objectId === dep.regItem.objectId;
  summary.adenaNewOid = wit.adena && wit.adena.objectId !== dep.adenaEntry.objectId;
  await page.screenshot({ path: path.join(OUT, 'wh_live_04_withdraw.png') });

  await dbl(`.l2-wh-top .l2-wh-cell[data-key="o${wit.adena.objectId}"]`);
  await sleep(500);
  await amountOk(DEPOSIT_ADENA);
  await sleep(500);
  await dbl(`.l2-wh-top .l2-wh-cell[data-key="o${wit.reg.objectId}"]`);
  await sleep(500);
  summary.withdrawCart = await page.evaluate(() => ({
    rows: document.querySelectorAll('.l2-wh-bottom .l2-wh-cell').length,
    sourceEmpty: !!document.querySelector('.l2-wh-top .l2-wh-empty'),
  }));
  await page.screenshot({ path: path.join(OUT, 'wh_live_05_withdraw_staged.png') });
  await clickOk();
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'whWithdrawItems'
      && m.items && m.items.length === 2)`, { timeout: 10000 });
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.op === 'invUpdate'
      && (m.updated || []).some(u => u.itemId === 57 && u.count === ${SEED_ADENA - FEE}))`,
    { timeout: 15000 });
  await sleep(800);
  summary.afterWithdraw = await page.evaluate((regItemId) => ({
    hidden: !window.__world.warehouseWnd.visible,
    adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
    regBack: [...window.__world.inventory.items.values()]
      .some(i => i.itemId === regItemId && !i.equipped),
  }), dep.regItem.itemId);
  summary.expectAfterWithdraw = SEED_ADENA - FEE;   // 4940 — fee not refunded
  await page.screenshot({ path: path.join(OUT, 'wh_live_06_restored.png') });

  await browser.close();
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => {
  console.error('VERIFY WAREHOUSE LIVE FAILED:', e.message);
  console.error('partial summary:', JSON.stringify(summary));
  process.exit(1);
});
