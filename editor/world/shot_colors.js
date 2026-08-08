// shot_colors.js -- screenshot the windows whose text colours were rebound.
//
//   node shot_colors.js <outdir> [base-url]
//
// Not a pass/fail suite: it produces evidence to look at. It drives the
// windows through window.__world's own handles with synthetic contract
// payloads, so the same script can be run against two versions of the tree and
// the images compared. It also dumps, per window, the computed colour of every
// text node it can find -- because a screenshot alone cannot tell you whether a
// tint came from the decode or from a leftover literal.
//
// Windows covered: ShopWnd, WarehouseWnd, ClanWnd, PartyWnd, MenuWnd.

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || path.join(__dirname, 'ui_color_shots');
const BASE = process.argv[3] || 'http://127.0.0.1:8083/';

// Item ids that exist in itemmeta, so the icons resolve and the count badge
// and price lines actually render.
const ITEMS = [
  { itemId: 57, count: 12345, price: 1 },       // adena
  { itemId: 1060, count: 5, price: 200 },       // lesser healing potion
  { itemId: 2, count: 1, price: 850 },
  { itemId: 5, count: 3, price: 120 },
];

const MEMBERS = [
  { id: 1, name: 'Elbera', level: 42, classId: 3, online: true, hp: 80, maxHp: 100, mp: 40, maxMp: 100 },
  { id: 2, name: 'Sirra', level: 38, classId: 11, online: true, hp: 55, maxHp: 90, mp: 70, maxMp: 90 },
  { id: 3, name: 'Kaelen', level: 45, classId: 19, online: false, hp: 100, maxHp: 120, mp: 20, maxMp: 60 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1600,1000',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') logs.push('ERR ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__world && window.__world.ready === true,
    { timeout: 120000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  // What the decode actually delivered to the page. If this is null the whole
  // run is meaningless, so say so loudly rather than shipping grey images.
  const native = await page.evaluate(async () => {
    const r = await fetch('/gamedata/native_colors.json').catch(() => null);
    return r && r.ok ? (await r.json()).colors : null;
  });
  console.log('native_colors.json in the page:',
    native ? Object.entries(native).map(([k, v]) => `${k}=${v.color}`).join(' ')
      : 'ABSENT -- every Layout.native() call will return null');

  const shots = [];

  async function shoot(name, selector, setup) {
    try {
      await page.evaluate(setup, { ITEMS, MEMBERS });
    } catch (e) {
      console.log(`  ${name}: setup threw ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 900));
    const el = await page.$(selector);
    if (!el) { console.log(`  ${name}: ${selector} not in the DOM`); return; }
    const box = await el.boundingBox();
    if (!box || box.width < 4 || box.height < 4) {
      console.log(`  ${name}: ${selector} has no box (hidden)`); return;
    }
    await page.screenshot({
      path: path.join(OUT, `${name}.png`),
      clip: {
        x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4),
        width: Math.min(box.width + 8, 1600), height: Math.min(box.height + 8, 1000),
      },
    });
    // Font.set paints into a canvas, so the tint is not readable from CSS.
    // ui/font.js records it on the element; fall back to CSS colour otherwise.
    // ui/font.js caches `${text}|${font}|${color}|${shadow}` on the element as
    // __l2text, so the tint HANDED TO the bitmap renderer is recoverable even
    // though the glyphs end up inside a canvas. A colour of '#fff' means the
    // caller passed nothing -- which is what a failed Layout.native() looks
    // like, and is exactly the case a screenshot would hide.
    const tints = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return [];
      const out = [];
      const visit = (n) => {
        if (n.__l2text) {
          const p = String(n.__l2text).split('|');
          out.push((p[p.length - 2] || '?').toUpperCase());
        }
        n.childNodes.forEach(c => { if (c.nodeType === 1) visit(c); });
      };
      visit(root);
      return out;
    }, selector);
    const tally = {};
    tints.forEach(c => { tally[c] = (tally[c] || 0) + 1; });
    shots.push({ name, tints: tally });
    console.log(`  ${name}: ${box.width | 0}x${box.height | 0}`
      + (Object.keys(tally).length
        ? '  tints ' + Object.entries(tally).map(([c, n]) => `${c}x${n}`).join(' ')
        : ''));
  }

  console.log('\nwindows:');
  await shoot('shopwnd', '#l2-shopwnd', ({ ITEMS }) => {
    window.__world.shopWnd.openBuy(ITEMS);
    window.__world.shopWnd.place({ left: 40, top: 40 });
  });
  await shoot('warehousewnd', '#l2-warehousewnd', ({ ITEMS }) => {
    const w = window.__world.warehouseWnd;
    w.openDeposit({ items: ITEMS, whType: 1 });
    w.place({ left: 340, top: 40 });
  });
  await shoot('clanwnd', '#l2-clanwnd', ({ MEMBERS }) => {
    const c = window.__world.clanWnd;
    c.setClan({ id: 7, name: 'Elberan Guard', leaderName: 'Elbera', level: 5 });
    c.setMembers(MEMBERS);
    c.show();
    c.place({ left: 640, top: 40 });
  });
  await shoot('partywnd', '#l2-partywnd', ({ MEMBERS }) => {
    const p = window.__world.partyWnd;
    p.setMembers(MEMBERS);          // a non-empty party shows the window itself
    p.place({ left: 940, top: 40 });
  });
  await shoot('menuwnd', '#l2-systemmenuwnd', () => {
    window.dispatchEvent(new KeyboardEvent('keydown',
      { code: 'KeyX', altKey: true, bubbles: true }));
  });

  await page.screenshot({ path: path.join(OUT, '99-all.png') });
  fs.writeFileSync(path.join(OUT, 'tints.json'),
    JSON.stringify({ native, shots }, null, 2) + '\n');

  if (logs.length) {
    console.log('\npage errors:');
    logs.slice(0, 10).forEach(l => console.log('   ' + l));
  }
  console.log(`\nwrote ${OUT}`);
  await browser.close();
})();
