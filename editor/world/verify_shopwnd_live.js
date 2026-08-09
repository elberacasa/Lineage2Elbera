// ShopWnd LIVE pass: real stack (aCis :2106/:7777 + gateway :8090 with
// the landed shop ops). A FRESH char (no seed — seeded items fight
// aCis's World-object checks and the kit overloads past the weight
// limit, sysMsg 422): farm 2 gremlins for adena (auto-loot server,
// same as gateway/test/verify-shop.js), walk the road to Trader Silvia
// (npcId 30003) over gateway/test/road-to-town.json, final approach on
// their proven ARC through open cells (the straight NE line hits the
// shop wall), talk -> real "Buy 13" bypass -> window opens with REAL
// prices (item 116 = 37a per datapack buyLists.xml), buy one, sell back.
// Output: verify_shots/shop_live_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const DEVICE_ID = 'verify-shop-agent-check';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// SOURCED from gateway/test/verify-shop.js (the gateway agent's proven run)
const SILVIA = { npcId: 30003, x: -83789, y: 240799, z: -3717 };
const BUY_ITEM_ID = 116;   // cheapest accessory in list 13 (37a)
const HOPS = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'gateway', 'test', 'road-to-town.json'), 'utf8'))
  .concat([[-84104, 244200, -3728], [-84100, 243600, -3728], [-84050, 243000, -3728],
    [-83950, 242400, -3728], [-83900, 241800, -3720], [-83850, 241300, -3720]]);
// final approach: arc through open cells (verify-shop.js:144 comment)
const ARC = [[-83900, 241000], [-83900, 240850], [-83830, 240805],
  [SILVIA.x, SILVIA.y]];

// FUND THE PURCHASE OFF THE CLOCK, rather than depending on where the
// character happens to be standing.
//
// The suite used to farm gremlins for the 37 adena it needs. That works
// exactly once: gremlins live at the VILLAGE spawn, and this suite's whole
// job is to walk to Trader Silvia in TI TOWN and buy something — so it ends
// every run parked in town, ~19,000 L2 units from the nearest gremlin.
// The next run then finds `adena < 37 && owned116 === 0`, enters the farm
// loop, finds nothing within range and throws "no gremlin in range".
// Measured 2026-08-09: the fixture character sat at (-83841, 240812, -3720)
// — TI town — with 22 adena and no 116s. The guard above the farm loop was
// already written for the "poor char in town" case but only covers the
// half of it where the char still owns a 116 to sell.
//
// Adena is the ONE thing safe to seed here. The header's warning is about
// seeded ITEMS (weight limit, sysMsg 422, World-object checks); this is an
// UPDATE of the character's existing adena row while it is OFFLINE, which
// is exactly what verify_warehousewnd_live.js:144 does. It does not change
// what this suite verifies — the buy/sell deltas below are all relative.
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];
const db = (q) => execFileSync('mariadb', [...DB, '-N', '-B', '-e', q],
  { encoding: 'utf8' }).trim();
const MIN_ADENA = 500;

function fundOffline() {
  const h1 = crypto.createHash('sha256')
    .update('l2vzla-account:' + DEVICE_ID).digest('hex');
  const charName = 'W' + h1.slice(12, 23);
  const charId = db(`SELECT obj_Id FROM characters WHERE char_name='${charName}'`);
  if (!charId) return { charName, seeded: false, why: 'character does not exist yet' };
  const online = db(`SELECT online FROM characters WHERE obj_Id=${charId}`);
  if (online !== '0') return { charName, seeded: false, why: `online=${online}` };
  const have = Number(db(
    `SELECT COALESCE(SUM(count),0) FROM items WHERE owner_id=${charId} AND item_id=57`) || 0);
  if (have >= MIN_ADENA) return { charName, seeded: false, adena: have, why: 'already funded' };
  const row = db(`SELECT object_id FROM items WHERE owner_id=${charId} AND item_id=57 LIMIT 1`);
  if (!row) return { charName, seeded: false, adena: have, why: 'no adena row to update' };
  db(`UPDATE items SET count=${MIN_ADENA} WHERE object_id=${row}`);
  return { charName, seeded: true, from: have, to: MIN_ADENA };
}

const summary = {};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  summary.funding = fundOffline();
  console.log('funding:', JSON.stringify(summary.funding));
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
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  summary.charName = await page.evaluate(
    () => window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
  await sleep(2500);

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
  const walkTo = (hop) => page.evaluate((h) => {
    const w = window.__world;
    const V = w.character.group.position.constructor;
    // walkTo (NOT a raw moveTo op): the client must own a move target or
    // the self-reconcile drops the server's walk orders
    w.walkTo(new V(h[0] * 0.01, h[2] * 0.01, -h[1] * 0.01));
  }, hop);

  // -- 1. fund the purchase: farm gremlins (spawn area only), or sell the
  // 116s a previous run already bought (auto-loot; drops vary) -----------
  summary.adena = await page.evaluate(() => {
    const a = [...window.__world.inventory.items.values()].find(i => i.itemId === 57);
    return a ? a.count : 0;
  });
  summary.owned116 = await page.evaluate(() => (
    [...window.__world.inventory.items.values()]
      .filter(i => i.itemId === 116).reduce((s, i) => s + i.count, 0)));
  // farm only when the buy is actually unaffordable — a persisted char
  // sitting in TI town with 37+ adena has no gremlins in range to farm
  if (summary.adena < 37 && summary.owned116 === 0) {
    summary.farm = { kills: 0 };
    while (summary.adena < 45 && summary.farm.kills < 5) {
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
    await walkTo([Math.round(g.pos[0] * 100), Math.round(-g.pos[2] * 100), Math.round(g.pos[1] * 100)]);
    await sleep(3000);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const dead = await page.evaluate((id) => {
        const e = window.__world.entities.getEntity(id);
        return e && e.dead;
      }, g.id);
      if (dead) break;
      await page.evaluate((id) => window.__world.net.sendOp('attack', { id }), g.id);
      await sleep(4000);
    }
    summary.farm.kills++;
    await sleep(2500);   // auto-loot lands
    summary.adena = await page.evaluate(() => {
      const a = [...window.__world.inventory.items.values()].find(i => i.itemId === 57);
      return a ? a.count : 0;
    });
  }
  if (summary.adena < 37) throw new Error('farm failed: adena ' + summary.adena);
  }

  // -- 2. road to town (skip when the char persisted nearby) --------------
  const distToSilvia = await page.evaluate(() => {
    // enterWorld is the server truth (the client char may not be placed
    // yet); it can fall out of the 200-entry log ring on busy sessions
    const ew = window.__world.net.log.find(m => m.op === 'enterWorld');
    if (ew) return Math.hypot(ew.char.x - (-83789), ew.char.y - 240799);
    const p = window.__world.character.group.position;
    return Math.hypot(p.x * 100 - (-83789), -p.z * 100 - 240799);
  });
  summary.startDist = Math.round(distToSilvia);
  // -- 2. road to town: gateway/test/verify-shop.js's PROVEN pattern —
  // nearest-waypoint resume, moveTo re-issue scaled by distance, arrival
  // when within 260, 60s stall -> 8-direction probe (passed twice live)
  if (distToSilvia > 1000) {
    const pos = await l2pos();
    let wpIndex = 0, best = Infinity;
    for (let i = 0; i < HOPS.length; i++) {
      const d = Math.hypot(pos.x - HOPS[i][0], pos.y - HOPS[i][1]);
      if (d < best) { best = d; wpIndex = i; }
    }
    // the ARC after the road handles the last meters — no need to walk
    // onto her (unwalkable) cell
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
        for (const [dx, dy] of [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]]) {
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

  // -- 3. final approach arc + talk ------------------------------------------------
  for (const [ax, ay] of ARC) {
    for (let i = 0; i < 15; i++) {
      const p = await srvPos() || await l2pos();
      if (Math.hypot(p.x - ax, p.y - ay) < 80) break;
      await page.evaluate((h) => {
        window.__world.net.sendOp('moveTo', { x: h[0], y: h[1], z: h[2] });
      }, [ax, ay, SILVIA.z]);
      await sleep(2500);
    }
  }
  await page.waitForFunction(
    `window.__world.entities.snapshot().some(e => e.npcId === ${SILVIA.npcId})`,
    { timeout: 90000 });
  const silviaId = await page.evaluate(
    (npcId) => window.__world.entities.snapshot().find(e => e.npcId === npcId).id,
    SILVIA.npcId);
  let html = null;
  for (let attempt = 0; attempt < 4 && !html; attempt++) {
    html = await page.evaluate(async (id) => {
      const before = window.__world.net.log.filter(m => m.op === 'npcHtml').length;
      window.__world.net.sendOp('talk', { id });
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        await new Promise(r => setTimeout(r, 250));
        const hs = window.__world.net.log.filter(m => m.op === 'npcHtml');
        if (hs.length > before) return hs[hs.length - 1].html;   // ring-safe
      }
      return null;
    }, silviaId);
  }
  const buyLink = /bypass -h (npc_\d+_Buy 13)/.exec(html || '');
  summary.buyLink = buyLink && buyLink[1];
  if (!buyLink) throw new Error('no Buy 13 link in Silvia html');

  // -- 4. buyList -> window with real prices --------------------------------------
  await page.evaluate((cmd) => {
    window.__world.net.sendOp('bypass', { command: cmd });
  }, buyLink[1]);
  await page.waitForFunction(
    'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "buy"',
    { timeout: 15000 });
  await sleep(800);
  summary.buyList = await page.evaluate(() => ({
    mode: window.__world.shopWnd.mode,
    cells: document.querySelectorAll('.l2-shop-top .l2-shop-cell').length,
    item116: window.__world.shopWnd.topItems.find(i => i.itemId === 116),
  }));
  await page.screenshot({ path: path.join(OUT, 'shop_live_01_buy.png') });

  // helper: sell `count` of one itemId from the sell list (default: the
  // whole stack — the seeded kit overloads past the buy limit, sysMsg 422).
  // Per M11 a BUY answers with a FULL ItemList, but a SELL is flushed as
  // invUpdate (remove + adena modify) — accept either.
  const sellAllOf = async (itemId, count = null) => {
    // skip WITHOUT touching the shop window when the char doesn't carry
    // the item (opening sell mode would clobber the open buy list)
    const carried = await page.evaluate((iid) => (
      [...window.__world.inventory.items.values()]
        .filter(i => i.itemId === iid).reduce((s, i) => s + i.count, 0)), itemId);
    if (!carried) return false;
    const before = await page.evaluate(
      () => window.__world.net.log.filter(m => m.op === 'itemList').length);
    const beforeInv = await page.evaluate(
      () => window.__world.net.log.filter(m => m.op === 'invUpdate').length);
    await page.evaluate((id) => {
      window.__world.net.sendOp('bypass', { command: `npc_${id}_Sell` });
    }, silviaId);
    await page.waitForFunction(
      'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "sell"',
      { timeout: 15000 });
    await sleep(600);
    const row = await page.evaluate((iid) => {
      const r = window.__world.shopWnd.topItems.find(i => i.itemId === iid);
      return r ? { objectId: r.objectId, count: r.count } : null;
    }, itemId);
    if (!row) return false;
    await page.evaluate((key) => {
      document.querySelector(`.l2-shop-top .l2-shop-cell[data-key="${key}"]`)
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, `o${row.objectId}`);
    await sleep(400);
    await page.evaluate((n) => {
      const input = document.querySelector('#l2-shop-amount input');
      if (window.__world.shopWnd.amountWin.visible) {
        input.value = String(n);
        [...document.querySelectorAll('#l2-shop-amount .l2wnd-body div')]
          .filter(d => d.style.cursor === 'pointer')[0].click();
      }
    }, count || row.count);
    await sleep(300);
    await page.evaluate(() => {
      [...document.querySelectorAll('#l2-shopwnd .l2-shop-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    await sleep(1500);
    summary.lastSellWire = await page.evaluate(() => ({
      sellOps: window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'sell')
        .map(m => m.items),
      sysmsgs: window.__world.net.log.filter(m => m.op === 'sysMsg').slice(-2)
        .map(m => [m.id, m.params]),
    }));
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'itemList').length > ${before}
        || window.__world.net.log.filter(m => m.op === 'invUpdate').length > ${beforeInv}`,
      { timeout: 15000 });
    return true;
  };
  const sellOne116 = async () => {
    const before = await page.evaluate(
      () => window.__world.net.log.filter(m => m.op === 'itemList').length);
    const beforeInv = await page.evaluate(
      () => window.__world.net.log.filter(m => m.op === 'invUpdate').length);
    await page.evaluate((id) => {
      window.__world.net.sendOp('bypass', { command: `npc_${id}_Sell` });
    }, silviaId);
    await page.waitForFunction(
      'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "sell"',
      { timeout: 15000 });
    await sleep(600);
    const oid = await page.evaluate(() => {
      const row = window.__world.shopWnd.topItems.find(i => i.itemId === 116);
      return row ? row.objectId : null;
    });
    summary.lastSellOid = oid;
    if (!oid) throw new Error('no 116 in the sell list');
    await page.evaluate((key) => {
      document.querySelector(`.l2-shop-top .l2-shop-cell[data-key="${key}"]`)
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, `o${oid}`);
    await sleep(300);
    await page.evaluate(() => {
      [...document.querySelectorAll('#l2-shopwnd .l2-shop-btn')]
        .filter(b => b.dataset.id === 'OKButton')[0].click();
    });
    await sleep(1500);
    summary.lastSellWire = await page.evaluate(() => ({
      sellOps: window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'sell')
        .map(m => m.items),
      sysmsgs: window.__world.net.log.filter(m => m.op === 'sysMsg').slice(-2)
        .map(m => [m.id, m.params]),
    }));
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'itemList').length > ${before}
        || window.__world.net.log.filter(m => m.op === 'invUpdate').length > ${beforeInv}`,
      { timeout: 15000 });
  };

  // -- 5. weight cleanup + funding: dump the seeded soulshot stack (the
  // overload blocks buys with sysMsg 422), sell 116s if still short, then
  // buy 1x item 116. NO re-target: the talk already targeted her, and a
  // second Action re-opens the dialog and drops the buy (mined live) -----
  const d1 = await sellAllOf(1835);
  const d2 = await sellAllOf(727);
  const d3 = await sellAllOf(736);
  summary.shotDump = d1 || d2 || d3;
  if (summary.shotDump) {
    // the Sell bypass closed the buy list — reopen it (retry: the server
    // occasionally swallows the first bypass after a transaction)
    let reopened = false;
    for (let a = 0; a < 3 && !reopened; a++) {
      await page.evaluate((cmd) => {
        window.__world.net.sendOp('bypass', { command: cmd });
      }, buyLink[1]);
      try {
        await page.waitForFunction(
          'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "buy"',
          { timeout: 12000 });
        reopened = true;
      } catch { /* retry */ }
    }
    if (!reopened) throw new Error('buy list did not reopen after the shot dump');
    await sleep(600);
    summary.adena = await page.evaluate(() => (
      [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count));
  }
  while (summary.adena < 37 && summary.owned116 > 0) {
    summary.preSell = (summary.preSell || 0) + 1;
    await sellOne116();
    summary.adena = await page.evaluate(() => (
      [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count));
    summary.owned116 = await page.evaluate(() => (
      [...window.__world.inventory.items.values()]
        .filter(i => i.itemId === 116).reduce((s, i) => s + i.count, 0)));
  }
  if (summary.preSell) {
    // the Sell bypass closed the buy list — reopen it
    await page.evaluate((cmd) => {
      window.__world.net.sendOp('bypass', { command: cmd });
    }, buyLink[1]);
    await page.waitForFunction(
      'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "buy"',
      { timeout: 15000 });
    await sleep(600);
  }
  if (summary.adena < 37) {
    throw new Error('cannot fund the buy: adena ' + summary.adena);
  }
  await page.evaluate(() => {
    document.querySelector('.l2-shop-top .l2-shop-cell[data-key="i116"]')
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await sleep(400);
  const promptUp = await page.evaluate(() => window.__world.shopWnd.amountWin.visible);
  if (promptUp) {
    await page.evaluate(() => {
      const input = document.querySelector('#l2-shop-amount input');
      input.value = '1';
      [...document.querySelectorAll('#l2-shop-amount .l2wnd-body div')]
        .filter(d => d.style.cursor === 'pointer')[0].click();
    });
  }
  await sleep(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('#l2-shopwnd .l2-shop-btn')]
      .filter(b => b.dataset.id === 'OKButton')[0].click();
  });
  await sleep(2000);
  summary.buyWire = await page.evaluate(() => ({
    buyOps: window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'buy'),
    sysmsgs: window.__world.net.log.filter(m => m.op === 'sysMsg').slice(-3)
      .map(m => [m.id, m.params]),
  }));
  // aCis answers the buy with a FULL ItemList (no InventoryUpdate)
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.op === 'itemList'
      && (m.items || []).some(i => i.itemId === 116))`,
    { timeout: 15000 });
  summary.afterBuy = await page.evaluate(() => ({
    adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
    has116: [...window.__world.inventory.items.values()].some(i => i.itemId === 116),
  }));
  await page.screenshot({ path: path.join(OUT, 'shop_live_02_bought.png') });

  // -- 6. sell it back --------------------------------------------------------------
  await page.screenshot({ path: path.join(OUT, 'shop_live_03_sell.png') });
  await sellOne116();
  summary.afterSell = await page.evaluate(() => ({
    adena: [...window.__world.inventory.items.values()].find(i => i.itemId === 57).count,
    has116: [...window.__world.inventory.items.values()].some(i => i.itemId === 116),
  }));
  await browser.close();
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => {
  console.error('VERIFY SHOP LIVE FAILED:', e.message);
  console.error('partial summary:', JSON.stringify(summary, (k, v) => k === 'row' ? '[row]' : v));
  process.exit(1);
});
