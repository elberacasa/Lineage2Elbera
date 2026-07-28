// MultiSellWnd LIVE pass: real stack (aCis :2106/:7777 + gateway :8090 with
// the landed M15 ops). Mirrors gateway/test/verify-multisell.js's seeded
// pattern, driving the WEB CLIENT the whole way:
//   0. connect (fixed deviceId -> persistent char); farm 2 gremlins only
//      when no adena row exists yet; disconnect
//   1. OFFLINE seed via SQL (waits characters.online=0 — the logout save
//      is delayed 15s in combat): level 6 (Player.isNewbie(true) needs
//      6..25 for Newbie_Exc_Multisell) + 20000 adena
//   2. re-login, walk the proven road to Trader Silvia (30003), talk,
//      buy Magic Ring (116, 37a) + Necklace of Magic (118, 75a) through
//      the SHOP WINDOW (her own Buy 13 list)
//   3. follow the REAL bypass npc_<id>_Newbie_Exc_Multisell 003 ->
//      multisellList opens the window: exactly 2 entries, cross-checked
//      against the live-verified numbers (875 <- [116x1, 57x557],
//      906 <- [118x1, 57x1115]); choose the 116 entry (amount 1 -> NO
//      prompt, equipment is non-stackable) -> invUpdate: 875 added,
//      116 removed, adena -557 exactly
// Output: verify_shots/multisell_live_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const DEVICE_ID = 'verify-multisell-agent-check';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// SOURCED from gateway/test/verify-multisell.js (the M15 live-verified run)
const SILVIA = { npcId: 30003, x: -83789, y: 240799, z: -3717 };
const RING = 116;       // Magic Ring, 37a -> 003 entry: 875 <- [116x1, 57x557]
const NECKLACE = 118;   // Necklace of Magic, 75a -> 003 entry: 906 <- [118x1, 57x1115]
const SEED_ADENA = 20000;
const HOPS = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'gateway', 'test', 'road-to-town.json'), 'utf8'))
  .concat([[-84104, 244200, -3728], [-84100, 243600, -3728], [-84050, 243000, -3728],
    [-83950, 242400, -3728], [-83900, 241800, -3720], [-83850, 241300, -3720]]);
const ARC = [[-83900, 241000], [-83900, 240850], [-83830, 240805], [SILVIA.x, SILVIA.y]];

const db = (q) => execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-N', '-B', '-e', q],
  { encoding: 'utf8' }).trim();

const summary = {};
let browser;
let page;

async function launch() {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  page = await browser.newPage();
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
  await page.waitForFunction(
    'window.__world.net.log.some(m => m.op === "itemList")', { timeout: 30000 });
  await sleep(2500);
}

const l2pos = () => page.evaluate(() => {
  const p = window.__world.character.group.position;
  return { x: Math.round(p.x * 100), y: Math.round(-p.z * 100), z: Math.round(p.y * 100) };
});
const srvPos = () => page.evaluate(() => {
  const id = window.__world.net.selfId;
  const m = [...window.__world.net.log].reverse().find(m => m.op === 'move' && m.id === id);
  return m ? { x: m.tx, y: m.ty, z: m.tz } : null;
});
const invCount = (itemId) => page.evaluate((iid) => (
  [...window.__world.inventory.items.values()]
    .filter(i => i.itemId === iid && !i.equipped).reduce((s, i) => s + i.count, 0)), itemId);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // -- 0. ensure the char exists and owns an adena row (offline UPDATEs
  //       hit EXISTING rows only), then disconnect ------------------------
  console.log('0. connect + adena-row check...');
  await launch();
  summary.char = await page.evaluate(() => {
    const ew = window.__world.net.log.find(m => m.op === 'enterWorld');
    return { id: ew.char.id, name: ew.char.name };
  });
  console.log('   char:', JSON.stringify(summary.char));
  let adena = await invCount(57);
  let kills = 0;
  while (adena === 0 && kills < 3) {
    const g = await page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      const gs = w.entities.snapshot()
        .filter(e => e.name === 'Gremlin' && !e.dead)
        .map(e => ({ ...e, d: Math.hypot(e.pos[0] - p.x, e.pos[2] - p.z) }))
        .sort((a, b) => a.d - b.d);
      return gs[0] || null;
    });
    if (!g) break;
    await page.evaluate((pos) => {
      const w = window.__world;
      const V = w.character.group.position.constructor;
      w.walkTo(new V(pos[0], pos[1], pos[2]));
    }, g.pos);
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
    kills++;
    await sleep(2500);   // auto-loot lands
    adena = await invCount(57);
  }
  summary.farmed = { kills, adena };
  await browser.close();

  // -- 1. offline seed: level 6 + 20000 adena (waits for the logout save) --
  console.log('1. offline seed...');
  let offline = false;
  for (let i = 0; i < 40 && !offline; i++) {
    await sleep(2000);
    offline = db(`SELECT online FROM characters WHERE obj_Id=${summary.char.id};`) === '0';
  }
  if (!offline) throw new Error('char still online 80s after logout');
  await sleep(1000);
  const levelsXml = fs.readFileSync(path.join(__dirname, '..', '..', 'server',
    'aCis_gameserver', 'build', 'dist', 'gameserver', 'data', 'xml', 'playerLevels.xml'), 'utf8');
  const exp6 = Number(/<playerLevel level="6"[^>]*requiredExpToLevelUp="(\d+)"/.exec(levelsXml)[1]);
  execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-e',
    `UPDATE characters SET level=6, exp=${exp6} WHERE obj_Id=${summary.char.id} AND online=0;`]);
  execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-e',
    `UPDATE items SET count=${SEED_ADENA} WHERE owner_id=${summary.char.id} AND item_id=57;`]);
  const adenaRow = db(`SELECT count FROM items WHERE owner_id=${summary.char.id} AND item_id=57;`);
  if (adenaRow !== String(SEED_ADENA)) throw new Error('adena seed failed (row: ' + adenaRow + ')');
  console.log(`   seeded: level 6 (exp ${exp6}), adena ${adenaRow}`);

  // -- 2. re-login, road to Silvia -----------------------------------------
  console.log('2. re-login + walk to Silvia...');
  await launch();
  summary.afterSeed = { adena: await invCount(57) };
  const distToSilvia = await page.evaluate((s) => {
    const ew = window.__world.net.log.find(m => m.op === 'enterWorld');
    if (ew) return Math.hypot(ew.char.x - s.x, ew.char.y - s.y);
    const p = window.__world.character.group.position;
    return Math.hypot(p.x * 100 - s.x, -p.z * 100 - s.y);
  }, SILVIA);
  summary.startDist = Math.round(distToSilvia);
  if (distToSilvia > 1000) {
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

  // -- 3. talk -> real html links -------------------------------------------
  console.log('3. talk + links...');
  let html = null;
  for (let attempt = 0; attempt < 4 && !html; attempt++) {
    html = await page.evaluate(async (id) => {
      const before = window.__world.net.log.filter(m => m.op === 'npcHtml').length;
      window.__world.net.sendOp('talk', { id });
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        await new Promise(r => setTimeout(r, 250));
        const hs = window.__world.net.log.filter(m => m.op === 'npcHtml');
        if (hs.length > before) return hs[hs.length - 1].html;
      }
      return null;
    }, silviaId);
  }
  const buyLink = /bypass -h (npc_\d+_Buy 13)/.exec(html || '');
  const msLink = /bypass -h (npc_\d+_Newbie_Exc_Multisell 003)/.exec(html || '');
  summary.links = { buy: buyLink && buyLink[1], multisell: msLink && msLink[1] };
  if (!buyLink || !msLink) throw new Error('missing links in Silvia html: ' + JSON.stringify(summary.links));

  // -- 4. buy the two ingredients through the SHOP WINDOW --------------------
  console.log('4. buy 116 + 118 via the shop window...');
  await page.evaluate((cmd) => {
    window.__world.net.sendOp('bypass', { command: cmd });
  }, buyLink[1]);
  await page.waitForFunction(
    'window.__world.shopWnd.visible && window.__world.shopWnd.mode === "buy"',
    { timeout: 15000 });
  await sleep(800);
  for (const iid of [RING, NECKLACE]) {
    await page.evaluate((sel) => {
      document.querySelector(sel).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, `.l2-shop-top .l2-shop-cell[data-key="i${iid}"]`);
    await sleep(400);
    // real stock counts are != 1 -> the amount prompt opens; take exactly 1
    const promptUp = await page.evaluate(() => window.__world.shopWnd.amountWin.visible);
    if (promptUp) {
      await page.evaluate(() => {
        const input = document.querySelector('#l2-shop-amount input');
        input.value = '1';
        [...document.querySelectorAll('#l2-shop-amount .l2wnd-body div')]
          .filter(d => d.style.cursor === 'pointer')[0].click();
      });
      await sleep(300);
    }
  }
  await page.evaluate(() => {
    [...document.querySelectorAll('#l2-shopwnd .l2-shop-btn')]
      .filter(b => b.dataset.id === 'OKButton')[0].click();
  });
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'buy'
      && m.items && m.items.length === 2)`, { timeout: 10000 });
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.op === 'itemList'
      && (m.items || []).some(i => i.itemId === ${RING})
      && (m.items || []).some(i => i.itemId === ${NECKLACE}))`, { timeout: 15000 });
  await sleep(1200);
  summary.afterBuy = { adena: await invCount(57), ring: await invCount(RING), necklace: await invCount(NECKLACE) };
  console.log('   afterBuy:', JSON.stringify(summary.afterBuy));

  // -- 5. Newbie_Exc_Multisell bypass -> the window opens --------------------
  console.log('5. multisellList -> window...');
  await page.evaluate((cmd) => {
    window.__world.net.sendOp('bypass', { command: cmd });
  }, msLink[1]);
  await page.waitForFunction(
    'window.__world.multiSellWnd.visible && window.__world.multiSellWnd.items.length === 2',
    { timeout: 15000 });
  await sleep(1000);
  summary.list = await page.evaluate(() => ({
    listId: window.__world.multiSellWnd.listId,
    items: window.__world.multiSellWnd.items.map(e => ({
      entryId: e.entryId,
      products: e.products, ingredients: e.ingredients,
    })),
    cells: document.querySelectorAll('.l2-multisell-cell').length,
    grayed: [...document.querySelectorAll('.l2-multisell-cell')].map(c => c.style.opacity),
    inventoryHidden: !window.__world.inventory.win.visible,
  }));
  console.log('   list:', JSON.stringify(summary.list));
  await page.screenshot({ path: path.join(OUT, 'multisell_live_01_list.png') });

  // cross-check against the M15 live-verified 003.xml numbers
  const e116 = await page.evaluate((iid) => window.__world.multiSellWnd.items
    .find(e => e.ingredients.some(i => i.itemId === iid)), RING);
  const e118 = await page.evaluate((iid) => window.__world.multiSellWnd.items
    .find(e => e.ingredients.some(i => i.itemId === iid)), NECKLACE);
  summary.crossCheck = {
    e116: !!e116 && e116.products.length === 1 && e116.products[0].itemId === 875
      && e116.products[0].count === 1 && e116.ingredients.length === 2
      && e116.ingredients.find(i => i.itemId === 57).count === 557,
    e118: !!e118 && e118.products.length === 1 && e118.products[0].itemId === 906
      && e118.ingredients.find(i => i.itemId === 57).count === 1115,
  };

  // -- 6. select the 116 entry, choose (amount 1 -> NO prompt) --------------
  console.log('6. choose the 116 entry...');
  await page.evaluate((eid) => {
    document.querySelector(`.l2-multisell-cell[data-entry-id="${eid}"]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, e116.entryId);
  await sleep(500);
  summary.detail = await page.evaluate(() => ({
    productRows: document.querySelectorAll('.l2-multisell-products > div').length,
    ingredientRows: document.querySelectorAll('.l2-multisell-needed > div').length,
  }));
  await page.screenshot({ path: path.join(OUT, 'multisell_live_02_selected.png') });
  await page.evaluate(() => {
    [...document.querySelectorAll('#l2-multisellwnd .l2-multisell-btn')]
      .filter(b => b.dataset.id === 'OKButton')[0].click();
  });
  await sleep(400);
  summary.noPrompt = await page.evaluate(() => !window.__world.multiSellWnd.amountWin.visible);
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'multisellChoose'
      && m.listId === ${summary.list.listId} && m.entryId === ${e116.entryId} && m.count === 1)`,
    { timeout: 10000 });
  await page.waitForFunction(
    `window.__world.net.log.some(m => m.op === 'invUpdate'
      && (m.updated || []).some(u => u.itemId === 875 && u.change === 'add'))`,
    { timeout: 15000 });
  await sleep(1000);
  summary.afterExchange = {
    adena: await invCount(57),          // afterBuy.adena - 557
    ring116: await invCount(RING),      // 0 (consumed)
    ring875: await invCount(875),       // 1 (the product)
    sysMsgs: await page.evaluate(() => window.__world.net.log
      .filter(m => m.op === 'sysMsg').slice(-3).map(m => m.id)),
  };
  console.log('   afterExchange:', JSON.stringify(summary.afterExchange));
  await page.screenshot({ path: path.join(OUT, 'multisell_live_03_after.png') });

  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY MULTISELL LIVE FAILED:', e.message); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); });
