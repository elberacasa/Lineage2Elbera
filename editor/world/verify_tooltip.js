// Item-tooltip verification.
//
//   node verify_tooltip.js            run + screenshots + JSON summary
//   node verify_tooltip.js --check    same, but exit 1 on any failed gate
//   node verify_tooltip.js --selftest prove the gates can go RED
//
// WHAT IS BEING VERIFIED, AND AGAINST WHAT
// ----------------------------------------
// Not "does a panel appear". The gates compare what the running client draws
// against `assets/gamedata/itemtooltip.json`, which tools/ui/mine_itemtooltip.py
// EXTRACTS from the client's own `Tooltip.uc` and decodes out of NWindow.dll.
// The expected field order is therefore never typed into this file: it is
// read out of the table, and if Tooltip.uc says something else, both the
// table and this suite move together.
//
// The guard map (GUARDS below) is the one place the .uc's condition TEXT is
// named. That is deliberate: if NCSoft's guard text ever differs from what
// was decoded, the suite fails with "unknown guard" instead of silently
// dropping a field from the expectation.
//
// --selftest is what makes the pass meaningful. It re-runs gate ORDER with
// the page's own draw-list builder monkey-patched to (a) swap two stat rows
// and (b) drop the grade symbol, and REQUIRES the gate to fail. A suite that
// cannot go red proves nothing; verify_m5 and verify_targetwnd shipped for
// months asserting nothing at all (docs/HANDOFF.md §5).
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'verify_shots');
const CHECK = process.argv.includes('--check');
const SELFTEST = process.argv.includes('--selftest');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SPEC = JSON.parse(fs.readFileSync(
  path.join(REPO, 'assets/gamedata/itemtooltip.json'), 'utf8'));
const TIP = JSON.parse(fs.readFileSync(
  path.join(REPO, 'assets/gamedata/itemtip.json'), 'utf8'));
const SYS = new Map(JSON.parse(fs.readFileSync(
  path.join(REPO, 'assets/gamedata/sysstring.json'), 'utf8')).map(e => [e.id, e.string]));

// The mock's own inventory fixture (mock_gateway.js:599-610). objectId ->
// what it is, so one item of each EItemType is covered.
const FIXTURE = {
  weapon: { oid: 90003, itemId: 2369, type2: 0, slot: 128, enchant: 3, count: 1 },
  armor: { oid: 90002, itemId: 1147, type2: 1, slot: 0, enchant: 0, count: 5 },
  quest: { oid: 90008, itemId: 1001, type2: 3, slot: 0, enchant: 0, count: 1 },
  money: { oid: 90001, itemId: 57, type2: 4, slot: 0, enchant: 0, count: 1200 },
  etc: { oid: 90005, itemId: 1060, type2: 5, slot: 0, enchant: 0, count: 12 },
  // Injected by this suite (see INJECTED below), not by the mock.
  //
  // WHY: every mock fixture is crystal_type 0, and the decoded bonus table's
  // index 0 is 0.0 -- so with the mock alone BOTH the grade symbol and the
  // whole enchant formula were dead code that no gate could see. A +7 D-grade
  // sword makes patk = 51 + (2*7-3)*2 = 73 and forces the `graded` symbol.
  gradedWeapon: { oid: 99001, itemId: 7826, type2: 0, slot: 128, enchant: 7, count: 1 },
  magicArmor: { oid: 99002, itemId: 2396, type2: 1, slot: 1024, enchant: 4, count: 1 },
};
const INJECTED = ['gradedWeapon', 'magicArmor'];

// EItemType (itemtooltip.json.itemTypeEnum) -> the fieldOrder `case` name.
const CASE_OF = SPEC.itemTypeEnum;

// -------------------------------------------------------------------------
// Derive the expected label sequence per category FROM the extracted table.
//
// Each guard is answered by a predicate keyed on the exact .uc text. An
// unlisted guard is a hard error, not a skip.
const GUARDS = {
  'if (eSourceType == NTST_ITEM)': () => true,
  'if (TooltipType != "InventoryPrice1HideEnchant"': () => true,
  'if (TooltipType != "InventoryPrice1HideEnchantStackable")': () => true,
  // we only build TooltipType "Inventory", so every price branch is off
  'if (TooltipType == "InventoryPrice1"': () => false,
  'if (TooltipType == "InventoryPrice2"': () => false,
  'if (TooltipType == "InventoryPrice2PrivateShop")': () => false,
  'if (Item.Price>0)': () => false,
  'if (IsStackableItem(Item.ConsumeType) && Item.Reserved > 0)': () => false,
  'if (Item.ClassID==57)': () => false,      // the adena read-out needs ConvertNumToText
  'if (Len(strTmp)>0)': (c) => c.weaponTypeString.length > 0,
  'if (Len(SlotString)>0)': (c) => c.slotString.length > 0,
  'if (Item.SoulshotCount>0)': (c) => (c.t.ss | 0) > 0,
  'if (Item.SpiritShotCount>0)': (c) => (c.t.sps | 0) > 0,
  'if (Item.MpConsume != 0)': (c) => (c.t.mp | 0) !== 0,
  'if (Item.RefineryOp1 != 0 || Item.RefineryOp2 != 0)': () => false,   // NOT BRIDGED
  'if (Item.RefineryOp1 != 0)': () => false,
  'if (Item.RefineryOp2 != 0)': () => false,
  "if (class'UIDATA_REFINERYOPTION'.static.GetOptionDescription( Item.RefineryOp1, strDesc1, strDesc2, strDesc3 ))": () => false,
  "if (class'UIDATA_REFINERYOPTION'.static.GetOptionDescription( Item.RefineryOp2, strDesc1, strDesc2, strDesc3 ))": () => false,
  'if (Len(strDesc1)>0)': () => false,
  'if (Len(strDesc2)>0)': () => false,
  'if (Len(strDesc3)>0)': () => false,
  'if (Item.SlotBitType == 256 || Item.SlotBitType == 128)\t//SBT_LHAND or SBT_RHAND':
    (c) => SPEC.shieldSlotBits.includes(c.slot),
  'else if (IsMagicalArmor(Item.ClassID))':
    (c) => !SPEC.shieldSlotBits.includes(c.slot) && (c.t.at | 0) === 3,
  'else': (c) => !SPEC.shieldSlotBits.includes(c.slot) && (c.t.at | 0) !== 3,
  'if (eEtcItemType == ITEME_PET_COLLAR)': (c) => (c.t.st | 0) === 7,
  'else if (eEtcItemType == ITEME_TICKET_OF_LORD)': (c) => (c.t.st | 0) === 15,
  'else if (eEtcItemType == ITEME_LOTTO)': (c) => (c.t.st | 0) === 13,
  'else if (eEtcItemType == ITEME_RACE_TICKET)': (c) => (c.t.st | 0) === 14,
  'if (Item.CurrentDurability >= 0 && Item.Durability > 0)': () => false,  // NOT BRIDGED
  'if (Len(Item.Description)>0)': (c) => !!c.t.d,
  'if (Item.ClassID>0)': () => true,
  'if (Item.ClassID != ClassID)': (c) => !!(c.t.sid && c.t.sid.some(i => i !== c.itemId)),
};

const errors = [];

function expectedLabels(kind) {
  const f = FIXTURE[kind];
  const t = TIP[String(f.itemId)] || {};
  const wtId = SPEC.natives.weaponType.sysstringByType[String(t.wt | 0)];
  const ctx = {
    t, slot: f.slot, itemId: f.itemId,
    weaponTypeString: wtId == null ? '' : (SYS.get(wtId) || ''),
    slotString: slotTypeString(f.type2, f.slot, t.at | 0),
  };
  const wanted = new Set(['header', CASE_OF[f.type2], 'tail']);
  const out = [];
  for (const e of SPEC.fieldOrder) {
    if (!wanted.has(e.case)) continue;
    if (e.fn === 'SetTooltipItemColor') continue;
    let ok = true;
    for (const g of e.guards) {
      if (!(g in GUARDS)) {
        errors.push(`unknown .uc guard, expectation cannot be derived: ${g}`);
        ok = false;
        break;
      }
      if (!GUARDS[g](ctx)) { ok = false; break; }
    }
    if (!ok) continue;
    if (e.labelSysstring != null && e.labelSysstring > 0) {
      out.push({ id: e.labelSysstring, text: SYS.get(e.labelSysstring), line: e.line });
    }
  }
  return { labels: out, ctx };
}

// The same GetSlotTypeString the client runs, from the decoded table.
function slotTypeString(itemType, slotBit, armorType) {
  const n = SPEC.natives.slotType;
  const tbl = n.byItemTypeAndSlotBit[String(itemType)];
  if (!tbl) return '';
  const id = ('*' in tbl) ? tbl['*'] : tbl[String(slotBit)];
  if (id == null) return '';
  let out = SYS.get(id) || '';
  if (n.armorClassSuffixSlots.includes(String(slotBit))) {
    const k = n.armorClassBySysstring[String(armorType)];
    if (k != null) out += n.separator + (SYS.get(k) || '');
  }
  return out;
}

// The decoded enchant maths, recomputed here independently of the browser.
function step(kind, e) { return e <= 3 ? e : (kind === 'w' ? 2 * e - 3 : 3 * e - 6); }
function patk(t, slot, e) {
  const en = SPEC.natives.enchant;
  const which = en.pAtkTableByWeaponType[String(t.wt | 0)];
  if (!which) return t.pat | 0;
  const tbl = which === 'byHandedness'
    ? (slot === en.twoHandedSlotBit ? en.pAtkTables.twoHanded : en.pAtkTables.oneHanded)
    : en.pAtkTables[which];
  return Math.trunc(step('w', e) * (tbl[t.ct | 0] || 0) + (t.pat | 0));
}
function matk(t, slot, e) {
  const en = SPEC.natives.enchant;
  const which = en.mAtkTableByWeaponType[String(t.wt | 0)];
  if (!which) return t.mat | 0;
  const tbl = which === 'byHandedness'
    ? (slot === en.twoHandedSlotBit ? en.mAtkTables.twoHanded : en.mAtkTables.oneHanded)
    : en.mAtkTables[which];
  return Math.trunc(step('w', e) * (tbl[t.ct | 0] || 0) + (t.mat | 0));
}
function atkSpdWord(spd) {
  for (const s of SPEC.natives.attackSpeed.ladder) {
    if (s.below == null || spd < s.below) return SYS.get(s.sysstring);
  }
  return '';
}

// -------------------------------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

async function startMock(port) {
  const proc = spawn('node', [path.join(__dirname, 'mock_gateway.js'), String(port)],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });
  let dead = false;
  proc.on('exit', (c) => { dead = true; proc.exitCode_ = c; });
  for (let i = 0; i < 60; i++) {
    if (dead) {
      throw new Error(`mock_gateway on :${port} exited (${proc.exitCode_}): ${stderr.trim()}`);
    }
    if (await canConnect(port)) return proc;
    await sleep(100);
  }
  proc.kill();
  throw new Error(`mock_gateway on :${port} never started listening`);
}

/** Read the tooltip the page is currently showing as a flat run list. */
const READ_TOOLTIP = `(() => {
  const root = document.querySelector('.l2-tooltip');
  if (!root || root.style.display === 'none') return null;
  const slices = [...root.querySelectorAll('[data-slice]')].map(d => ({
    slice: d.dataset.slice,
    bg: d.style.backgroundImage,
    w: Math.round(parseFloat(d.style.width)),
    h: Math.round(parseFloat(d.style.height)),
    x: Math.round(parseFloat(d.style.left)),
    y: Math.round(parseFloat(d.style.top)),
  }));
  const content = root.children[9];
  const runs = [...content.children].map(e => {
    const key = e.__l2text || '';
    const [text, , color] = key.split('|');
    return {
      text: e.__l2text ? text : null,
      color: e.__l2text ? color : null,
      sprite: e.__l2text ? null : e.style.backgroundImage,
      x: Math.round(parseFloat(e.style.left)),
      y: Math.round(parseFloat(e.style.top)),
      w: Math.round(parseFloat(e.style.width || '0')),
      h: Math.round(parseFloat(e.style.height || '0')),
    };
  });
  return {
    runs, slices,
    box: { w: Math.round(parseFloat(root.style.width)),
           h: Math.round(parseFloat(root.style.height)) },
    contentOffset: { x: Math.round(parseFloat(content.style.left)),
                     y: Math.round(parseFloat(content.style.top)) },
    rect: (() => { const b = root.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y) }; })(),
  };
})()`;

async function hover(page, oid) {
  const box = await page.evaluate((o) => {
    const el = document.querySelector(`.inv-cell[data-oid="${o}"]`)
      || document.querySelector(`.doll-slot[data-oid="${o}"]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, oid);
  if (!box) throw new Error(`no inventory cell for objectId ${oid}`);
  await page.mouse.move(box.x, box.y);
  await sleep(120);
  return page.evaluate(READ_TOOLTIP);
}

/** The label runs the page drew, in order.
 *
 *  An AddTooltipItemOption title sets bLineBreak (Tooltip.uc:1710/1763), so a
 *  label always starts its line -> x === 0. Two colours qualify: the helper's
 *  own #A3A3A3, and #FFFFFF for the three section headers that
 *  SetTooltipItemColor(255,255,255) retints (uc:419/459/665). y > 0 drops the
 *  first line, which is the (also-white, also-x-0) item name. */
function pageLabels(tt) {
  return tt.runs
    .filter(r => r.text !== null && r.x === 0 && r.y > 0
      && (r.color === '#A3A3A3' || r.color === '#FFFFFF'))
    .map(r => r.text);
}

function fail(gate, msg) { errors.push(`${gate}: ${msg}`); }

// How many assertions each gate actually evaluated.
//
// This counter is not bookkeeping, it is a gate of its own. Run against the
// pre-fix tree, SHOW went red (no tooltip anywhere) and FRAME / ORDER / NAME /
// GRADE / FORMAT / COLOUR all printed "ok" — because their loops iterate over
// the tooltips that were captured, and nothing was. That is exactly the shape
// docs/HANDOFF.md §5 records for verify_m5 and verify_targetwnd: a green row
// that asserted nothing. A gate that evaluated zero assertions is now a
// FAILURE, so the pre-fix tree fails on every gate rather than one.
const ran = {};
function check(gate, cond, msg) {
  ran[gate] = (ran[gate] || 0) + 1;
  if (!cond) fail(gate, msg);
  return cond;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await freePort();
  const mock = await startMock(port);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { gates: {}, consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(`http://127.0.0.1:8083/?ws=ws://127.0.0.1:${port}&cc=0`,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'itemList')`, { timeout: 20000 });
    await sleep(1200);
    await page.keyboard.down('Alt'); await page.keyboard.press('v'); await page.keyboard.up('Alt');
    await sleep(800);
    // the tooltip tables are fetched lazily by InventoryWnd.setItems
    await page.waitForFunction(
      `!!document.querySelector('.inv-cell')`, { timeout: 10000 });
    await sleep(800);

    // ---- gate SHOW / HIDE ------------------------------------------------
    const before = await page.evaluate(READ_TOOLTIP);
    check('SHOW', before === null, 'a tooltip was visible before any hover');
    const shots = {};
    const seen = {};
    // Push the two synthetic rows in over the client's own InventoryUpdate
    // path (change code 1 = ADDED, aCis InventoryUpdate), so they take the
    // same route a server item takes.
    await page.evaluate((rows) => window.__world.inventory.applyUpdate(rows),
      INJECTED.map(k => ({
        change: 1, objectId: FIXTURE[k].oid, itemId: FIXTURE[k].itemId,
        count: FIXTURE[k].count, type2: FIXTURE[k].type2,
        slot: FIXTURE[k].slot, equipped: 0, enchant: FIXTURE[k].enchant,
      })));
    await sleep(300);

    for (const [kind, f] of Object.entries(FIXTURE)) {
      // The quest fixture lives in the QuestItem pane (InventoryWnd.uc
      // HandleAddItem routes ITEM_QUESTITEM there), and the weapon fixture is
      // equipped, so it is a paperdoll well.
      await page.evaluate((t) => {
        window.__world.inventory.tab = t;
        window.__world.inventory.render();
      }, kind === 'quest' ? 'quest' : 'inventory');
      await sleep(200);
      const tt = await hover(page, f.oid);
      // Shoot unconditionally: on a tree with no tooltip this IS the "before"
      // frame, and a suite that only photographs its successes is useless for
      // the before/after pair.
      shots[kind] = `tooltip_${kind}.png`;
      await page.screenshot({ path: path.join(OUT, shots[kind]) });
      if (!check('SHOW', tt !== null, `no tooltip on hover over ${kind} (oid ${f.oid})`)) continue;
      seen[kind] = tt;
    }
    await page.mouse.move(5, 5);
    await sleep(150);
    check('HIDE', (await page.evaluate(READ_TOOLTIP)) === null,
      'the tooltip stayed up after the cursor left the cell');

    // ---- gate FRAME: the nine-slice actually paints ----------------------
    // shortcutwnd.js shipped with a control reference mistaken for a texture,
    // so its slots were right and its background was blank. Same shape here.
    const w = seen.weapon;
    if (w) {
      const refs = SPEC.window.textureRefs;
      check('FRAME', w.slices.length === 9,
        `expected 9 frame slices, found ${w.slices.length}`);
      w.slices.forEach((s, i) => {
        const leaf = refs[i].split('.').pop();
        check('FRAME', s.bg && s.bg.includes(leaf),
          `slice ${s.slice} paints ${s.bg || 'nothing'}, expected ${leaf}`);
      });
      const c = SPEC.window.sliceCorner;
      check('FRAME', w.slices[0].w === c && w.slices[0].h === c,
        `top-left corner is ${w.slices[0].w}x${w.slices[0].h}, decoded ${c}x${c}`);
      check('FRAME', w.slices[4].w === w.box.w - 2 * c,
        `centre width ${w.slices[4].w}, expected W-2*${c} = ${w.box.w - 2 * c}`);
      check('FRAME',
        w.contentOffset.x === SPEC.window.contentInset
        && w.contentOffset.y === SPEC.window.contentInset,
        `content inset ${w.contentOffset.x},${w.contentOffset.y}, `
        + `decoded ${SPEC.window.contentInset}`);
    }

    // ---- gate ORDER: field set AND order, per category -------------------
    summary.order = {};
    for (const [kind, tt] of Object.entries(seen)) {
      const { labels } = expectedLabels(kind);
      const gotLabels = pageLabels(tt);
      const wantLabels = labels.map(l => l.text);
      summary.order[kind] = { want: wantLabels, got: gotLabels };
      check('ORDER', JSON.stringify(gotLabels) === JSON.stringify(wantLabels),
        `${kind}: labels\n      want ${JSON.stringify(wantLabels)}`
        + `\n      got  ${JSON.stringify(gotLabels)}`);
    }

    // ---- gate NAME: white, uncoloured, first, no grade tint --------------
    for (const [kind, tt] of Object.entries(seen)) {
      const first = tt.runs.find(r => r.text !== null);
      const f = FIXTURE[kind];
      const wantFirst = f.enchant > 0 && f.type2 <= 3 ? `+${f.enchant} ` : null;
      if (wantFirst) {
        check('NAME', first && first.text === wantFirst,
          `${kind}: expected the enchant prefix ${JSON.stringify(wantFirst)} first, `
          + `got ${JSON.stringify(first && first.text)}`);
      }
      const nameRun = tt.runs.filter(r => r.text !== null)[wantFirst ? 1 : 0];
      check('NAME', nameRun && nameRun.color === SPEC.window.defaultTextColor,
        `${kind}: item name is ${nameRun && nameRun.color}, decoded default `
        + `${SPEC.window.defaultTextColor} (FDrawItemInfo's ctor)`);
    }

    // ---- gate GRADE: the 12x12 symbol, not a tinted name -----------------
    // Both directions: a graded item MUST draw it, a no-grade item MUST NOT.
    for (const [kind, tt] of Object.entries(seen)) {
      const ct = TIP[String(FIXTURE[kind].itemId)].ct | 0;
      const sym = tt.runs.find(r => r.sprite);
      if (ct > 0) {
        if (!check('GRADE', !!sym, `${kind} (crystalType ${ct}) drew no grade symbol`)) continue;
        const size = SPEC.window.gradeSymbolSize;
        check('GRADE', sym.w === size && sym.h === size,
          `${kind} grade symbol is ${sym.w}x${sym.h}, decoded ${size}x${size}`);
        const want = SPEC.natives.gradeSymbol.byCrystalType[String(ct)]
          .replace(/^grade/, '');
        check('GRADE', sym.sprite && sym.sprite.includes(`grade_${want}`),
          `${kind} grade symbol paints ${sym.sprite}, expected grade_${want}`);
      } else {
        check('GRADE', !sym, `${kind} (no grade) drew a grade symbol anyway`);
      }
    }

    // ---- gate FORMAT: the numbers, recomputed from the decoded tables ----
    summary.format = {};
    for (const wk of ['weapon', 'gradedWeapon']) {
      if (!seen[wk]) continue;
      const f = FIXTURE[wk];
      const t = TIP[String(f.itemId)];
      const runs = seen[wk].runs.filter(r => r.text !== null);
      const valueAfter = (label) => {
        const i = runs.findIndex(r => r.text === label && r.color === '#A3A3A3');
        return i >= 0 && runs[i + 2] ? runs[i + 2] : null;
      };
      const wantPatk = String(patk(t, f.slot, f.enchant));
      const wantMatk = String(matk(t, f.slot, f.enchant));
      const wantSpd = atkSpdWord(t.spd | 0);
      const cases = [
        ['P. Atk.', wantPatk], ['M. Atk.', wantMatk],
        ['Atk. Spd.', wantSpd], ['Weight', String(t.w | 0)],
        ['Soulshot Used', `X ${t.ss}`],
      ];
      for (const [label, want] of cases) {
        const v = valueAfter(label);
        summary.format[`${wk}.${label}`] = { want, got: v && v.text };
        check('FORMAT', v && v.text === want,
          `${wk} ${label}: want ${JSON.stringify(want)}, got ${JSON.stringify(v && v.text)}`);
        check('FORMAT', !v || v.color === '#B09B79',
          `${wk} ${label} value colour ${v && v.color}, decoded #B09B79 `
          + '(Tooltip.uc:1744)');
      }
      // Weight is String(Item.Weight) at uc:443 — NOT MakeCostString. A
      // thousands separator here would be an invention.
      const wv = valueAfter('Weight');
      check('FORMAT', wv && !wv.text.includes(','),
        `${wk} Weight ${JSON.stringify(wv && wv.text)} carries a separator; `
        + 'Tooltip.uc:443 uses String(), not MakeCostString');
      // ... whereas the stack count at uc:1900 DOES.
    }
    if (seen.etc) {
      const f = FIXTURE.etc;
      const runs = seen.etc.runs.filter(r => r.text !== null);
      const cnt = runs.find(r => /^ \(\d[\d,]*\)$/.test(r.text || ''));
      check('FORMAT', !!cnt, 'a stackable etc item drew no " (count)" run');
      if (cnt) {
        check('FORMAT', cnt.text === ` (${f.count})`,
          `stack count ${JSON.stringify(cnt.text)}, expected " (${f.count})"`);
      }
    }
    if (seen.money) {
      const runs = seen.money.runs.filter(r => r.text !== null);
      const cnt = runs.find(r => /^ \(\d[\d,]*\)$/.test(r.text || ''));
      check('FORMAT', cnt && cnt.text === ' (1,200)',
        `adena stack count ${JSON.stringify(cnt && cnt.text)}, `
        + 'expected " (1,200)" (MakeCostString, NWindow.dll 0x10062590)');
    }

    // ---- gate COLOUR: only literals that are in the decoded set ----------
    const allowed = new Set(SPEC.colors.map(c => c.hex.toUpperCase()));
    allowed.add(SPEC.window.defaultTextColor.toUpperCase());
    const used = new Set();
    for (const tt of Object.values(seen)) {
      for (const r of tt.runs) if (r.color) used.add(r.color.toUpperCase());
    }
    summary.colorsUsed = [...used].sort();
    check('COLOUR', used.size > 0, 'no text was painted at all — nothing to check');
    for (const c of used) {
      check('COLOUR', allowed.has(c),
        `${c} is painted but is not a Tooltip.uc literal (decoded set: `
        + `${[...allowed].join(' ')})`);
    }
    check('COLOUR', !used.has('#C9A959'),
      '#c9a959 is a gold retail never uses (see the task brief)');

    // ---- gate SELFTEST: prove ORDER can go red --------------------------
    if (SELFTEST) {
      const red = await page.evaluate(async () => {
        const m = await import('/js/ui/tooltip.js');
        const orig = m.layout;
        // Reorder the draw list: swap the last two label rows.
        const w = m.tooltipWindow();
        const realShow = w.show.bind(w);
        w.show = function (item, x, y) {
          realShow(item, x, y);
          const c = this.content;
          // Defect 1 — the stat rows come out in a different order. The runs
          // are absolutely positioned, so a DOM reshuffle would be invisible;
          // swap what two label rows SAY, which is what a reordered builder
          // would actually produce on screen.
          const labels = [...c.children].filter(
            k => k.__l2text && k.__l2text.split('|')[2] === '#A3A3A3'
              && Math.round(parseFloat(k.style.left)) === 0);
          if (labels.length >= 2) {
            const a = labels[0].__l2text, b = labels[1].__l2text;
            labels[0].__l2text = b; labels[1].__l2text = a;
          }
          // Defect 2 — the grade symbol never gets drawn (a sprite element
          // with no font cache key is the symbol).
          for (const k of [...c.children]) if (!k.__l2text) k.remove();
        };
        return true;
      });
      if (!red) fail('SELFTEST', 'could not install the defect');
      const before2 = errors.length;
      const tt = await hover(page, FIXTURE.gradedWeapon.oid);
      const { labels } = expectedLabels('gradedWeapon');
      const got = tt ? pageLabels(tt) : [];
      const same = JSON.stringify(got) === JSON.stringify(labels.map(l => l.text));
      const symGone = !(tt && tt.runs.some(r => r.sprite));
      errors.length = before2;   // the injected defect's own noise is the POINT
      summary.selftest = { detectedReorder: !same, detectedMissingSymbol: symGone };
      check('SELFTEST', !same, 'ORDER did not go red on a reordered tooltip');
      check('SELFTEST', symGone, 'the grade-symbol defect was not observable');
    }

    summary.shots = shots;
    summary.tooltips = seen;
  } catch (e) {
    fail('RUN', e.stack || String(e));
  } finally {
    await browser.close().catch(() => {});
    mock.kill();
  }

  const gates = ['SHOW', 'HIDE', 'FRAME', 'ORDER', 'NAME', 'GRADE', 'FORMAT', 'COLOUR']
    .concat(SELFTEST ? ['SELFTEST'] : []);
  for (const g of gates) {
    if (!ran[g]) errors.push(`${g}: evaluated 0 assertions — vacuous, not passing`);
  }
  summary.assertions = ran;
  summary.errors = errors;
  summary.pass = errors.length === 0;
  fs.writeFileSync(path.join(OUT, 'tooltip_summary.json'),
    JSON.stringify(summary, null, 1));
  for (const g of gates) {
    const bad = errors.filter(e => e.startsWith(g + ':'));
    console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${g}`);
    for (const b of bad) console.log(`        ${b}`);
  }
  for (const e of errors.filter(x => x.startsWith('RUN:') || x.startsWith('unknown'))) {
    console.log(`FAIL  ${e}`);
  }
  console.log(summary.pass ? '\nverify_tooltip PASS' : `\nverify_tooltip FAIL (${errors.length})`);
  if (CHECK || SELFTEST) process.exit(summary.pass ? 0 : 1);
  process.exit(0);
})();
