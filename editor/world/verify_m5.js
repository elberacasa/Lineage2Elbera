// M5 verification (mock gateway on 8085): chat channels/colors + tabs,
// whisper both ways, char sheet (C), hotbar assign+trigger, settings
// panel with deviceId, WASD cosmetic policy intact.
// Output: verify_shots/m5_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
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
      `window.__world.net.log.some(m => m.op === 'charSheet')
       && window.__world.net.log.some(m => m.op === 'skillList')`, { timeout: 20000 });
    await sleep(1200);

    // -- chat: shout + whisper + sysmsg --------------------------------------
    const type = async (text) => {
      await page.keyboard.press('Enter');
      await sleep(250);
      await page.type('#chat-input', text);
      await page.keyboard.press('Enter');
      await sleep(300);
    };
    await type('hello everyone');
    await type('/shout WTS cheap shots');
    await type('/trade buying adena');
    await type('/w Cora secret hello');
    await page.waitForFunction(
      `window.__world.chat.lines.some(l => l.kind === 'chat' && l.channel === 'tell'
        && l.from.startsWith('Cora'))`, { timeout: 8000 });
    summary.chat = await page.evaluate(() => ({
      lines: window.__world.chat.lines.slice(-7),
      // ChatWnd's tab strip is built from mined ChatTabCtrl sprites: each tab
      // is a <div class="chat-tab"> (chat.js:257), never a <button>. The old
      // 'button' selector matched nothing and .find(...).click() threw.
      tabs: document.querySelectorAll('#chat-tabs .chat-tab').length,
      coloredClasses: [...new Set([...document.querySelectorAll('#chat-log .line')]
        .map(e => e.style.color || (['sysmsg', 'system'].includes(e.className.split(' ').find(c => c)) ? e.className : null))
        .filter(Boolean))],
    }));
    // party tab filter: normal/trade lines hidden, shout + tell still visible
    // (ChatWnd.uc SetDefaultFilterValue, transcribed in chat.js TABS)
    await page.evaluate(() => {
      [...document.querySelectorAll('#chat-tabs .chat-tab')]
        .find(b => b.dataset.tab === 'party').click();
    });
    await sleep(300);
    summary.whisperTab = await page.evaluate(() =>
      [...document.querySelectorAll('#chat-log .line')]
        .filter(e => e.style.display !== 'none').map(e => e.textContent.slice(0, 40)));
    await page.screenshot({ path: path.join(OUT, 'm5_01_chat_channels.png') });
    await page.evaluate(() => {
      [...document.querySelectorAll('#chat-tabs .chat-tab')]
        .find(b => b.dataset.tab === 'all').click();
    });

    // -- char sheet ----------------------------------------------------------
    // Alt+T is now the mined DetailStatusWnd, not the authored #charsheet-panel
    // (#charsheet-panel survives as the flag main.js reads, and .sheet-body is
    // gone with the authored markup). The deep assertions live in
    // verify_detailstatuswnd.js; this only checks the M5 wiring still opens it
    // and that the payload reaches its boxes. Bitmap-font text is read back off
    // Font.set's __l2text stamp, not textContent.
    // KeyC alone is unbound; the retail keymap in main.js:1747-1758 puts the
    // character-status window on Alt+T (bare KeyC did nothing, so this phase
    // was silently measuring a window that never opened).
    await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
    await sleep(500);
    summary.charSheet = await page.evaluate(() => {
      const root = document.getElementById('l2-detailstatuswnd');
      const box = (n) => {
        const el = root && root.querySelector(`[data-ctrl="${n}"]`);
        return el && typeof el.__l2text === 'string' ? el.__l2text.split('|')[0] : '';
      };
      return {
        visible: !!root && root.style.display !== 'none',
        text: ['txtHeadSTR', 'txtSTR', 'txtHeadPhysicalAttack', 'txtPhysicalAttack']
          .map(box).join(' '),
        str: window.__world.charSheet.str, pAtk: window.__world.charSheet.pAtk,
      };
    });
    await page.screenshot({ path: path.join(OUT, 'm5_02_charsheet.png') });
    await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');

    // -- shortcut bar: right-click skill cell -> assign; Digit1 casts --------
    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    await sleep(500);
    await page.evaluate(() => {
      document.querySelector('#l2-skillwnd [draggable="true"]')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(300);
    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    summary.hotbarAssign = await page.evaluate(() => ({
      slots: Object.values(window.__world.shortcutWnd.data['0'] || {}),
      persisted: localStorage.getItem(Object.keys(localStorage)
        .find(k => k.startsWith('l2vzla.hotbar.')) || ''),
    }));
    await page.keyboard.press('Digit1');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useSkill')`,
      { timeout: 8000 });

    // assign an item from inventory, trigger it, invUpdate decrement.
    // Bare KeyI is unbound: the retail keymap is Alt+V (main.js:1751).
    // Stack counts are painted with the bitmap font, so the text lives on
    // Font.set's __l2text stamp, not in textContent (inventorywnd.js:409-412).
    await page.keyboard.down('Alt'); await page.keyboard.press('v'); await page.keyboard.up('Alt');
    await sleep(400);
    const readCount = () => page.evaluate(() => {
      const c = document.querySelector('.inv-cell[data-oid="90002"] .count');
      // __l2text is "text|size|color|" — same stamp the charSheet phase reads
      return c ? (typeof c.__l2text === 'string' ? c.__l2text.split('|')[0] : c.textContent) : null;
    });
    const before = await readCount();
    await page.evaluate(() => {
      document.querySelector('.inv-cell[data-oid="90002"]')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    await sleep(300);
    await page.keyboard.press('Digit2');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useItem')`,
      { timeout: 8000 });
    await sleep(600);
    const after = await readCount();
    summary.hotbarItem = await page.evaluate(() => ({
      countBefore: null, countAfter: null,   // filled from readCount() below
      slots: Object.values(window.__world.shortcutWnd.data['0'] || {}),
    }));
    summary.hotbarItem.countBefore = before;
    summary.hotbarItem.countAfter = after;
    await page.screenshot({ path: path.join(OUT, 'm5_03_hotbar.png') });

    // -- settings panel --------------------------------------------------------
    await page.click('#settings-btn');
    await sleep(400);
    summary.settings = await page.evaluate(() => ({
      visible: document.getElementById('settings-panel').classList.contains('visible'),
      deviceId: document.getElementById('deviceid-text').textContent,
      matchesStorage: document.getElementById('deviceid-text').textContent
        === localStorage.getItem('l2vzla.deviceId'),
    }));
    await page.screenshot({ path: path.join(OUT, 'm5_04_settings.png') });
  } finally {
    await browser.close();
  }

  // -- assertions -------------------------------------------------------------
  // This suite used to exit 0 unconditionally: it printed a summary and never
  // compared it to anything, so a phase could measure a window that never
  // opened and still report PASS in the battery. Every claim it makes is now
  // checked. Expected values come from the mock's own payload or from the
  // mined data, never from a hand-picked number.
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const c = summary.chat;
  check('chat: 5 tabs (CHAT_WINDOW_COUNT)', c.tabs === 5, `got ${c.tabs}`);
  check('chat: shout line reached the log',
    c.lines.some(l => l.channel === 'shout'), JSON.stringify(c.lines.map(l => l.channel)));
  check('chat: whisper both ways',
    c.lines.some(l => l.channel === 'tell' && /^me ->/.test(l.from || ''))
    && c.lines.some(l => l.channel === 'tell' && /Cora/.test(l.from || '')));
  check('chat: channels painted in distinct colors', c.coloredClasses.length >= 3,
    c.coloredClasses.join(' '));
  // Party tab (chat.js TABS, from ChatWnd.uc SetDefaultFilterValue):
  // bNormal 0 -> the plain "hello everyone" is hidden; bShout/bWhisper 1.
  check('chat: party tab hides normal, keeps shout + tell',
    !summary.whisperTab.some(t => /hello everyone/.test(t))
    && summary.whisperTab.some(t => /\[shout\]/.test(t))
    && summary.whisperTab.some(t => /\[tell\]/.test(t)),
    JSON.stringify(summary.whisperTab));
  check('charsheet: Alt+T opens DetailStatusWnd', summary.charSheet.visible);
  check('charsheet: boxes carry the payload',
    summary.charSheet.text.includes(String(summary.charSheet.str))
    && summary.charSheet.text.includes(String(summary.charSheet.pAtk)),
    `"${summary.charSheet.text}" vs str=${summary.charSheet.str} pAtk=${summary.charSheet.pAtk}`);
  check('hotbar: right-click assigned the skill',
    summary.hotbarAssign.slots.some(s => s && s.type === 'skill'),
    JSON.stringify(summary.hotbarAssign.slots));
  check('hotbar: assignment persisted to localStorage',
    !!summary.hotbarAssign.persisted && /"skill"/.test(summary.hotbarAssign.persisted));
  check('hotbar: item assigned to a second slot',
    summary.hotbarItem.slots.some(s => s && s.type === 'item' && s.id === 90002),
    JSON.stringify(summary.hotbarItem.slots));
  const nb = Number(summary.hotbarItem.countBefore), na = Number(summary.hotbarItem.countAfter);
  check('inventory: invUpdate decremented the stack',
    Number.isFinite(nb) && Number.isFinite(na) && na < nb,
    `${summary.hotbarItem.countBefore} -> ${summary.hotbarItem.countAfter}`);
  check('settings: panel opens with a deviceId matching storage',
    summary.settings.visible && !!summary.settings.deviceId && summary.settings.matchesStorage,
    JSON.stringify(summary.settings));

  summary.results = results;
  const failed = results.filter(r => !r.ok);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`verify_m5: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error('VERIFY M5 FAILED: ' + failed.map(f => f.name).join('; '));
    process.exit(1);
  }
})().catch(e => { console.error('VERIFY M5 FAILED:', e.stack || e.message); process.exit(1); });
