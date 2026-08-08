// LIVE evidence run for InventoryWnd + ChatWnd against the REAL stack
// (aCis :2106/:7777 + gateway :8090 + client :8083). No mock gateway.
//
// WHY LIVE: both windows were reported "broken" by the owner, who plays with
// a real inventory. The mock fixture has 5 items and no quest items, so the
// mock suite never exercised the cases that break. This script seeds a real
// inventory into MariaDB while the character is OFFLINE (aCis loads it at
// enterWorld — the verify-paperdoll.js pattern), then drives the real client.
//
// It MEASURES the rendered rects and compares them to assets/gamedata/
// interface.json (the mined xdat), so every assertion below has a source.
//
// Usage:
//   node verify_invchatwnd_live.js          # run, write shots + JSON
//   node verify_invchatwnd_live.js --check  # same, plus exit 1 on any FAIL
// Output: verify_shots/invchat_*.png + JSON summary on stdout.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const WebSocket = require('/Users/alejandroberacasa/l2vzla/gateway/node_modules/ws');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';        // default ws -> ws://127.0.0.1:8090
const GATEWAY = 'ws://127.0.0.1:8090';
const OUT = path.join(__dirname, 'verify_shots');
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];
const DEVICE_ID = 'verify-invchat-fixture-1';
const CHECK = process.argv.includes('--check');
const TAG = process.argv.includes('--after') ? 'after' : 'before';

// Fixture inventory. Item ids resolved against assets/gamedata/itemmeta.json
// (mined itemname/etcitemgrp), names quoted from it — nothing invented.
const SEED = [
  { id: 57, count: 128450, name: 'Adena' },
  { id: 69, count: 1, name: 'Bastard Sword' },
  { id: 20, count: 1, name: 'Buckler' },
  { id: 43, count: 1, name: 'Wooden Helmet' },
  { id: 1119, count: 1, name: 'Short Leather Gloves' },
  { id: 2386, count: 1, name: 'Wooden Gaiters' },
  { id: 906, count: 1, name: 'Necklace of Knowledge' },
  { id: 112, count: 2, name: "Apprentice's Earring" },
  { id: 1061, count: 25, name: 'Healing Potion' },
  { id: 1835, count: 3000, name: 'Soulshot: No Grade' },
  { id: 736, count: 12, name: 'Scroll of Escape' },
  { id: 17, count: 500, name: 'Wooden Arrow' },
  { id: 4412, count: 4, name: 'Echo Crystal - Theme of Battle' },
  { id: 5588, count: 1, name: 'Tutorial Guide' },
  { id: 1892, count: 7, name: "Blacksmith's Frame" },
];

const derive = (d) => {
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + d).digest('hex');
  return { charName: 'W' + h1.slice(12, 23) };
};
const sql = (q) => execFileSync('mariadb', [...DB, '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY);
    const seen = [];
    ws.on('message', (d) => { try { seen.push(JSON.parse(d)); } catch { /* non-JSON */ } });
    ws.on('open', () => resolve({ ws, seen }));
    ws.on('error', reject);
  });
}
const waitFor = (seen, pred, ms = 25000) => new Promise((resolve) => {
  const t0 = Date.now();
  const poll = setInterval(() => {
    const hit = seen.find(pred);
    if (hit) { clearInterval(poll); resolve(hit); }
    else if (Date.now() - t0 > ms) { clearInterval(poll); resolve(null); }
  }, 100);
});

// mined geometry, read from the same file the client reads
const MINED = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../assets/gamedata/interface.json'), 'utf8'));
const win = (n) => MINED.windows.find(w => w.name === n);
const ctrl = (wn, cn) => {
  const walk = (node) => {
    for (const c of node.children || []) {
      if (c.name === cn) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(win(wn));
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = { tag: TAG, consoleLogs: [] };
  const { charName } = derive(DEVICE_ID);

  // ---- phase 1: make sure the fixture character exists, then log out ------
  {
    const { ws, seen } = await connect();
    ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
    const auth = await waitFor(seen, m => m.op === 'auth_ok', 30000);
    if (!auth) { console.log('FAIL  gateway login (is the stack up?)'); process.exit(1); }
    ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
    await waitFor(seen, m => m.op === 'enterWorld', 30000);
    ws.close();
  }
  await sleep(3500);   // aCis writes the character out on logout

  const owner = sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}' LIMIT 1;`);
  check('fixture character exists', !!owner, `${charName} (${owner || 'not found'})`);
  if (!owner) process.exit(1);

  // ---- phase 2: seed the inventory (offline write) -------------------------
  let base = Number(sql('SELECT COALESCE(MAX(object_id),0) FROM items;')) + 5000;
  for (const s of SEED) {
    const have = sql(
      `SELECT object_id FROM items WHERE owner_id=${owner} AND item_id=${s.id} LIMIT 1;`);
    if (have) {
      sql(`UPDATE items SET count=${s.count}, loc='INVENTORY', loc_data=0 `
        + `WHERE object_id=${have};`);
    } else {
      base += 1;
      sql(`INSERT INTO items (owner_id,object_id,item_id,count,enchant_level,loc,loc_data,`
        + `custom_type1,custom_type2,mana_left,time) VALUES `
        + `(${owner},${base},${s.id},${s.count},0,'INVENTORY',0,0,0,-1,0);`);
    }
  }
  const nItems = Number(sql(
    `SELECT COUNT(*) FROM items WHERE owner_id=${owner} AND loc IN ('INVENTORY','PAPERDOLL');`));
  check('inventory seeded', nItems >= SEED.length, `${nItems} rows in DB`);

  // ---- phase 3: drive the real client --------------------------------------
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));
    // TrashButton/CrystallizeButton raise the retail confirmation (the same
    // systemmsg id the .uc passes to DialogShow); accept it
    page.on('dialog', async (d) => {
      summary.dialogs = summary.dialogs || [];
      summary.dialogs.push(d.message());
      await d.accept();
    });
    await page.evaluateOnNewDocument(
      (id) => localStorage.setItem('l2vzla.deviceId', id), DEVICE_ID);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'itemList')`, { timeout: 60000 });
    await sleep(2500);

    summary.serverItems = await page.evaluate(() =>
      (window.__world.net.log.filter(m => m.op === 'itemList').pop() || {}).items || []);
    check('server delivered the seeded items',
      summary.serverItems.length >= SEED.length,
      `${summary.serverItems.length} items in itemList`);
    summary.type2Forwarded = summary.serverItems.some(i => i.type2 != null);

    // equip a few things through the protocol so the paperdoll has content
    await page.evaluate((ids) => {
      const inv = window.__world.inventory;
      for (const id of ids) {
        const it = [...inv.items.values()].find(i => i.itemId === id && !i.equipped);
        if (it) window.__world.net.sendOp('useItem', { objectId: it.objectId });
      }
    }, [69, 43, 1119, 2386, 906, 112]);
    await sleep(3000);

    // ---- chat: send lines through the real server so the log has content ---
    await page.keyboard.press('Enter'); await sleep(300);
    await page.type('#chat-input', 'live inventory + chat evidence run');
    await page.keyboard.press('Enter'); await sleep(1200);
    await page.keyboard.press('Enter'); await sleep(300);
    await page.type('#chat-input', '/shout does the chat have a background');
    await page.keyboard.press('Enter'); await sleep(1200);

    await page.screenshot({ path: path.join(OUT, `invchat_${TAG}_01_chat.png`) });

    // Alt+V opens InventoryWnd (must come BEFORE the edit box is focused —
    // main.js routes keys to the chat input while it is)
    await page.keyboard.down('Alt'); await page.keyboard.press('v'); await page.keyboard.up('Alt');
    await sleep(1200);
    // then leave the edit box open so its rect is measurable (display:none
    // until Enter, and a hidden element has no box)
    await page.keyboard.press('Enter'); await sleep(400);
    await page.screenshot({ path: path.join(OUT, `invchat_${TAG}_02_full.png`) });

    // the client's live item map, AFTER the equips — the initial itemList
    // predates them, so equipped-count assertions must read this
    summary.liveItems = await page.evaluate(() =>
      [...window.__world.inventory.items.values()]);

    // ---- measure -----------------------------------------------------------
    summary.measured = await page.evaluate(() => {
      const R = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          x: Math.round(b.x), y: Math.round(b.y),
          w: Math.round(b.width), h: Math.round(b.height),
        };
      };
      const inv = window.__world.inventory;
      const chat = window.__world.chat;
      const invRoot = inv.win.root;
      const invBody = inv.win.body;
      const rel = (el, host) => {
        if (!el || !host) return null;
        const a = el.getBoundingClientRect(), b = host.getBoundingClientRect();
        return {
          x: Math.round(a.x - b.x), y: Math.round(a.y - b.y),
          w: Math.round(a.width), h: Math.round(a.height),
        };
      };
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const cells = [...document.querySelectorAll('.inv-cell')];
      return {
        inv: {
          visible: invRoot.style.display !== 'none',
          root: R(invRoot),
          bodyRel: rel(invBody, invRoot),
          tabs: rel(inv.tabs, invBody),
          grid: rel(inv.grid, invBody),
          gridScroll: { sh: inv.grid.scrollHeight, ch: inv.grid.clientHeight },
          adena: rel(inv.adenaEl, invBody),
          adenaGlyphs: inv.adenaEl.querySelectorAll('canvas').length,
          adenaRight: (() => {
            const c = inv.adenaEl.querySelector('canvas');
            if (!c) return null;
            const a = c.getBoundingClientRect(), b = invBody.getBoundingClientRect();
            return Math.round(a.right - b.x);
          })(),
          weightShown: getComputedStyle(inv.weightEl).display !== 'none',
          curLoad: (window.__world.charSheet || {}).curLoad ?? null,
          maxLoad: (window.__world.charSheet || {}).maxLoad ?? null,
          cellCount: cells.length,
          cellRects: cells.slice(0, 8).map(c => rel(c, invBody)),
          cellsWithIcon: cells.filter(c => c.querySelector('img')).length,
          cellsWithFallback: cells.filter(c => c.querySelector('.icon-fallback')).length,
          counts: cells.map(c => c.querySelector('.count')?.textContent).filter(Boolean),
          dollSlots: document.querySelectorAll('.doll-slot').length,
          dollFilled: [...document.querySelectorAll('.doll-slot.filled')]
            .map(e => ({ slot: e.dataset.slot, title: e.title })),
          dollRects: [...document.querySelectorAll('.doll-slot:not(.henna)')]
            .map(e => ({ slot: e.dataset.slot, r: rel(e, invBody) })),
          bottomButtons: [...document.querySelectorAll('.inv-bottom-btn')]
            .map(e => ({ ctrl: e.dataset.ctrl, r: rel(e, invBody),
                         display: getComputedStyle(e).display })),
          backdropBg: (() => {
            const b = invRoot.querySelector('[data-backdrop], .l2-backdrop');
            return b ? getComputedStyle(b).backgroundImage.slice(0, 90) : null;
          })(),
          questTabCells: null,
        },
        chat: {
          root: R(chat.root),
          rootCss: {
            background: cs(chat.root).backgroundImage,
            width: cs(chat.root).width, height: cs(chat.root).height,
          },
          childBgs: [...chat.root.children].map(c => ({
            id: c.id || c.className || c.tagName,
            r: rel(c, chat.root),
            bg: getComputedStyle(c).backgroundImage.slice(0, 80),
          })),
          log: rel(chat.log, chat.root),
          logCss: {
            background: cs(chat.log).backgroundImage,
            padding: cs(chat.log).padding,
            color: cs(chat.log).color,
            font: cs(chat.log).font,
          },
          lineCount: chat.log.children.length,
          lineRects: [...chat.log.children].slice(0, 4)
            .map(l => ({ t: l.textContent.slice(0, 40), r: rel(l, chat.root) })),
          tabs: rel(chat.tabs, chat.root),
          tabCount: chat.tabs.children.length,
          tabRects: [...chat.tabs.children].map(t => ({
            tab: t.dataset.tab, r: rel(t, chat.root),
            bg: getComputedStyle(t).backgroundImage.slice(0, 60),
          })),
          body: chat.bodyEl ? rel(chat.bodyEl, chat.root) : null,
          input: rel(chat.input, chat.root),
          inputCss: {
            background: cs(chat.input).backgroundColor,
            border: cs(chat.input).borderTopWidth,
          },
          hasBodyTex: [...chat.root.children].some(c =>
            getComputedStyle(c).backgroundImage.includes('Chatting_Back3')),
          hasHeadTex: [...chat.root.children].some(c =>
            getComputedStyle(c).backgroundImage.includes('Chatting_Back2')),
          hasBottomTex: [...chat.root.children].some(c =>
            getComputedStyle(c).backgroundImage.includes('Chatting_Back4')),
          hasBottomTex1: [...chat.root.children].some(c =>
            getComputedStyle(c).backgroundImage.includes('Chatting_Back1')),
        },
        uiScale: window.__world.skinScale ?? 1,
      };
    });

    // quest tab
    await page.evaluate(() => {
      window.__world.inventory.tab = 'quest';
      window.__world.inventory.render();
    });
    await sleep(400);
    summary.measured.inv.questTabCells = await page.evaluate(() =>
      document.querySelectorAll('.inv-cell').length);
    await page.screenshot({ path: path.join(OUT, `invchat_${TAG}_03_questtab.png`) });
    await page.evaluate(() => {
      window.__world.inventory.tab = 'inventory';
      window.__world.inventory.render();
    });
    await sleep(300);

    // ---- fire the drop-to-trash path at the real server -------------------
    // InventoryWnd.uc OnDropItem strTarget == "TrashButton": confirm, then
    // destroy. Prove it end to end: the item must disappear from the server's
    // own view, not just from ours.
    const doomed = await page.evaluate(() => {
      const inv = window.__world.inventory;
      const it = [...inv.items.values()].find(i => i.itemId === 1892);  // Blacksmith's Frame
      if (!it) return null;
      window.__doomedCount = it.count;
      const dst = document.querySelector('.inv-bottom-btn[data-ctrl="TrashButton"]');
      const dt = new DataTransfer();
      dt.setData('application/x-l2vzla', JSON.stringify({ type: 'item', id: it.objectId }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      return it.objectId;
    });
    await sleep(2500);
    // main.js sends destroyItem {objectId, count: 1}, so a stack loses one
    summary.trashDrop = await page.evaluate((oid) => ({
      oid,
      sentOp: window.__world.net.log.some(m => m.dir === 'out' && m.op === 'destroyItem'
        && m.objectId === oid),
      countBefore: window.__doomedCount,
      countAfter: (window.__world.inventory.items.get(oid) || {}).count ?? 0,
    }), doomed);

    // tight crops so the art is inspectable
    const crop = async (r, name) => {
      if (!r || r.w <= 0 || r.h <= 0) { console.log(`(no crop for ${name}: ${JSON.stringify(r)})`); return; }
      await page.screenshot({
        path: path.join(OUT, `invchat_${TAG}_${name}.png`),
        clip: { x: r.x, y: r.y, width: r.w, height: r.h },
      });
    };
    await crop(summary.measured.inv.root, '04_invcrop');
    await crop(summary.measured.chat.root, '05_chatcrop');
  } finally {
    for (const l of summary.consoleLogs) {
      if (/PAGEERROR|Uncaught|TypeError|ReferenceError/.test(l)) console.log('  JS  ' + l);
    }
    await browser.close();
  }

  // ---- assertions against the mined xdat -----------------------------------
  const m = summary.measured;
  const cw = win('ChatWnd'), iw = win('InventoryWnd');
  const back = ctrl('InventoryWnd', 'BackTexture');

  check('InventoryWnd root matches mined BackTexture 256x381',
    m.inv.root.w === back.width && m.inv.root.h === back.height + 20,
    `rendered ${m.inv.root.w}x${m.inv.root.h}, mined back ${back.width}x${back.height} + 20 titlebar`);

  const tabC = ctrl('InventoryWnd', 'InventoryTab');
  check('InventoryTab at mined (12,159)-20',
    m.inv.tabs.x === tabC.x && m.inv.tabs.y === tabC.y - 20,
    `rendered (${m.inv.tabs.x},${m.inv.tabs.y}) vs mined (${tabC.x},${tabC.y - 20})`);

  const gridC = ctrl('InventoryWnd', 'InventoryItem');
  check('InventoryItem pane at mined rect',
    m.inv.grid.x === gridC.x && m.inv.grid.y === gridC.y - 20
      && m.inv.grid.w === gridC.width && m.inv.grid.h === gridC.height,
    `rendered ${JSON.stringify(m.inv.grid)} vs mined `
    + `(${gridC.x},${gridC.y - 20}) ${gridC.width}x${gridC.height}`);

  const pitchX = gridC.grid.cellX + gridC.grid.gapX;
  const perRow = Math.floor(gridC.width / pitchX);
  check('grid fits the mined 6 columns (236 / 37)', perRow === 6, `perRow=${perRow}`);

  check('every inventory cell drew a real icon',
    m.inv.cellsWithIcon === m.inv.cellCount && m.inv.cellCount > 0,
    `${m.inv.cellsWithIcon}/${m.inv.cellCount} icons, ${m.inv.cellsWithFallback} fallbacks`);

  // mined slot art is 34x34 (mine_invslots) with a 32x32 icon (xdat grid
  // cellX); the port used to size every cell to the 37x35 PITCH and stretch
  // the icon over it
  const wells = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'ui/invslots.json'), 'utf8'));
  check('cells are the mined well size, on the mined pitch',
    m.inv.cellRects.every(r => r.w === wells.grid.well && r.h === wells.grid.well)
      && m.inv.cellRects.length > 1
      && m.inv.cellRects[1].x - m.inv.cellRects[0].x === wells.grid.pitchX,
    `first cells ${JSON.stringify(m.inv.cellRects.slice(0, 3))}, `
    + `mined well ${wells.grid.well} pitch ${wells.grid.pitchX}x${wells.grid.pitchY}`);

  check('the mined 4 rows fit the pane with no scrollbar',
    m.inv.gridScroll.sh <= m.inv.gridScroll.ch,
    `content ${m.inv.gridScroll.sh} vs pane ${m.inv.gridScroll.ch}`);

  // InventoryWnd.uc HandleAddItem: equipped items go to the paperdoll ONLY
  const equipped = summary.liveItems.filter(i => i.equipped).length;
  check('equipped items are NOT listed in the grid (uc HandleAddItem)',
    m.inv.cellCount === summary.liveItems.length - equipped,
    `${m.inv.cellCount} cells, ${summary.liveItems.length} items, ${equipped} equipped`);

  check('paperdoll filled from equipped items',
    m.inv.dollFilled.length >= 5, JSON.stringify(m.inv.dollFilled.map(d => d.slot)));

  check('paperdoll slots sit on the mined wells',
    m.inv.dollRects.every(d => {
      const w = wells.doll[d.slot];
      return w && d.r.x === w.x && d.r.y === w.y && d.r.w === w.w && d.r.h === w.h;
    }),
    JSON.stringify(m.inv.dollRects.filter(d => {
      const w = wells.doll[d.slot];
      return !(w && d.r.x === w.x && d.r.y === w.y);
    })));

  check('adena number rendered and right-aligned in its field',
    m.inv.adenaGlyphs > 0 && m.inv.adenaRight != null
      && Math.abs(m.inv.adenaRight - (110 + 90)) <= 1,
    `${m.inv.adenaGlyphs} glyph canvases, right edge ${m.inv.adenaRight} `
    + `(mined AdenaText right = 200)`);

  // the server's own answer: aCis RequestDestroyItem replies with an
  // InventoryUpdate, so the count our window shows afterwards IS the server's
  check('drop-to-trash: retail confirm -> destroyItem -> server decrements',
    summary.trashDrop && summary.trashDrop.sentOp
      && summary.trashDrop.countAfter === summary.trashDrop.countBefore - 1,
    `${JSON.stringify(summary.trashDrop)} dialog: `
    + `${JSON.stringify((summary.dialogs || [])[0])}`);

  check('bottom buttons are visible drop targets (uc OnDropItem)',
    m.inv.bottomButtons.length === 2
      && m.inv.bottomButtons.every(b => b.display !== 'none'),
    JSON.stringify(m.inv.bottomButtons));

  // KNOWN GAP, not a pass: the gauge needs curLoad, which the bridge does
  // not forward yet. Recorded so the report cannot claim it works.
  check('weight gauge drawn (needs charSheet.curLoad from the gateway)',
    m.inv.weightShown, `hidden because curLoad=${JSON.stringify(m.inv.curLoad)}`);
  check('quest tab populated (needs ItemList type2 from the gateway)',
    m.inv.questTabCells > 0,
    `${m.inv.questTabCells} cells; type2 present on server items: `
    + `${summary.liveItems.some(i => i.type2 != null)}`);

  check('ChatWnd root is the mined 348x187',
    m.chat.root.w === cw.width && m.chat.root.h === cw.height,
    `rendered ${m.chat.root.w}x${m.chat.root.h}`);
  check('ChatWnd draws ChatWndHeadTex (Chatting_Back2)', m.chat.hasHeadTex);
  check('ChatWnd draws ChatWndBodyTex (Chatting_Back3)', m.chat.hasBodyTex,
    'the log background — mined child ChatWndBodyTex');
  check('ChatWnd draws ChatWndBottomTex (Chatting_Back4)', m.chat.hasBottomTex);
  check('ChatWnd draws ChatWndBottomTex1 (Chatting_Back1)', m.chat.hasBottomTex1);

  // ChatWndBodyTex: hasSize==0, autosize [1,1], insets [0,-82] => 348x105
  const bodyC = ctrl('ChatWnd', 'ChatWndBodyTex');
  const bodyW = cw.width + bodyC.insets[0], bodyH = cw.height + bodyC.insets[1];
  check('ChatWndBodyTex at its mined autosize rect',
    m.chat.body && m.chat.body.x === bodyC.x && m.chat.body.y === bodyC.y
      && m.chat.body.w === bodyW && m.chat.body.h === bodyH,
    `rendered ${JSON.stringify(m.chat.body)} vs mined (${bodyC.x},${bodyC.y}) `
    + `${bodyW}x${bodyH}`);

  // MEASURED: Chatting_Back3's frame is 2px (cols 0-1 and 346-347)
  check('chat log is inset by the body sprite frame (padding)',
    m.chat.body && m.chat.log.x === m.chat.body.x + 2
      && m.chat.log.y === m.chat.body.y + 2
      && m.chat.log.w === m.chat.body.w - 4 && m.chat.log.h === m.chat.body.h - 4,
    `log ${JSON.stringify(m.chat.log)} body ${JSON.stringify(m.chat.body)}`);

  // ChatTabCtrl is 320 wide; Chatting_Tab1/2 are 64 => exactly 5 tabs,
  // which is ChatWnd.uc's CHAT_WINDOW_COUNT
  const chatTabC = ctrl('ChatWnd', 'ChatTabCtrl');
  check('five tabs, each one sprite wide, filling the mined strip',
    m.chat.tabCount === 5 && m.chat.tabRects.every(t => t.r.w === 64)
      && m.chat.tabCount * 64 === chatTabC.width,
    `${m.chat.tabCount} tabs of `
    + `${m.chat.tabRects.map(t => t.r.w).join('/')} in ${chatTabC.width}`);
  check('tabs painted with Chatting_Tab art (not browser buttons)',
    m.chat.tabRects.every(t => /Chatting_Tab/.test(t.bg)),
    m.chat.tabRects.map(t => `${t.tab}:${t.bg.slice(-24)}`).join(' '));

  const editC = ctrl('ChatWnd', 'ChatEditBox');
  check('ChatEditBox at its mined rect',
    m.chat.input.x === editC.x && m.chat.input.w === editC.width
      && m.chat.input.h === editC.height,
    `rendered ${JSON.stringify(m.chat.input)} vs mined `
    + `x=${editC.x} ${editC.width}x${editC.height}`);
  check('ChatEditBox has no chrome of its own (xdat gives it no texture)',
    m.chat.inputCss.background === 'rgba(0, 0, 0, 0)'
      && m.chat.inputCss.border === '0px',
    JSON.stringify(m.chat.inputCss));

  summary.results = results;
  fs.writeFileSync(path.join(OUT, `invchat_${TAG}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (CHECK && failed) process.exit(1);
})().catch(e => { console.error('VERIFY INVCHAT FAILED:', e.stack || e.message); process.exit(1); });
