// Headless verification for the character-SELECT overlay (world client on
// 8083, mock gateway on 8087 — 8085/8086 are reserved by other suites).
// Drives the REAL UI with the mock's multi-char fixture (deviceId 'multi*'):
//   1. multi account -> auth_ok{chars:[Sylva,Dorn]} -> select overlay lists
//      BOTH chars (names / levels / race+class from charcreate-data.json);
//      NO enterChar is sent before a click
//   2. click the SECOND char -> enterChar{slot:1} -> enterWorld as Dorn
//   3. "＋ Create new character" -> char-create overlay; a createChar on the
//      live session -> refreshed auth_ok -> select overlay re-opens with the
//      UPDATED 3-char list; "Back (offline)" dismisses to solo mode
//   4. 1-char account -> auto-enter, NO select overlay (legacy path intact)
//   5. ?cc=0 + multi account -> first-char auto-enter, NO overlay (legacy)
//
// Usage: node verify_charsel.js
// Output: verify_shots/cs_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8087';
const OUT = path.join(__dirname, 'verify_shots');
const SHOT = (n) => path.join(OUT, `cs_${n}.png`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleLogs: [] };
  globalThis.__csSummary = summary;
  const newPage = async (deviceId) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));
    if (deviceId) {
      await page.evaluateOnNewDocument((id) =>
        localStorage.setItem('l2vzla.deviceId', id), deviceId);
    }
    return page;
  };
  const boot = async (page, url) => {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
  };
  const outOps = (page, op) => page.evaluate((o) =>
    window.__world.net.log.filter(l => l.dir === 'out' && l.op === o), op);
  try {
    // -- 1+2. multi account: overlay with both chars, click the SECOND ----
    {
      summary.step = '1: multi login -> select overlay';
      const page = await newPage('multiverifya');
      await boot(page, BASE);
      await page.click('#online-toggle');
      await page.waitForFunction(
        'window.__world.charSelect && window.__world.charSelect.open', { timeout: 20000 });
      await page.waitForFunction(
        `document.querySelectorAll('#charsel-overlay .charsel-row').length === 2`,
        { timeout: 10000 });
      summary.overlay = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('#charsel-overlay .charsel-row')]
          .map(r => r.textContent.trim()),
        createBtn: !!document.getElementById('charsel-create'),
        dismissBtn: !!document.getElementById('charsel-dismiss'),
        enterCharSentBeforeClick:
          window.__world.net.log.some(l => l.dir === 'out' && l.op === 'enterChar'),
      }));
      await sleep(300);
      await page.screenshot({ path: SHOT('01_select_overlay') });

      await page.evaluate(() =>
        document.querySelectorAll('#charsel-overlay .charsel-row')[1].click());
      await page.waitForFunction(
        `window.__world.net.log.some(l => l.dir === 'out' && l.op === 'enterChar')`,
        { timeout: 10000 });
      summary.enterCharOp = (await outOps(page, 'enterChar'))[0];
      await page.waitForFunction('window.__world.net.selfId', { timeout: 20000 });
      await sleep(2500);   // scene + models settle
      summary.enterWorld = await page.evaluate(() =>
        window.__world.net.log.find(l => l.dir === 'in' && l.op === 'enterWorld'));
      summary.status = await page.evaluate(() =>
        document.getElementById('status').textContent);
      summary.selectClosedOnEnter = await page.evaluate(() =>
        !window.__world.charSelect.open);
      await page.screenshot({ path: SHOT('02_entered_as_second') });
      await page.close();
    }

    // -- 3. "＋ Create" path + refreshed auth_ok updates the list + dismiss --
    {
      summary.step = '3: create path + refreshed list + dismiss';
      const page = await newPage('multiverifyb');
      await boot(page, BASE);
      await page.click('#online-toggle');
      await page.waitForFunction(
        'window.__world.charSelect && window.__world.charSelect.open', { timeout: 20000 });
      await page.click('#charsel-create');
      await page.waitForFunction(
        'window.__world.charCreate.open && !window.__world.charSelect.open',
        { timeout: 10000 });
      await page.waitForFunction(
        () => !!document.querySelector('#charcreate-overlay iframe'), { timeout: 10000 });
      summary.createPath = { createOverlayOpened: true };

      // create char #3 at the PROTOCOL level (the 3D creator UI itself is
      // covered by verify_charcreate.js) -> refreshed auth_ok must re-open
      // the select overlay with the UPDATED list
      await page.evaluate(() => window.__world.net.sendOp('createChar', {
        name: 'Kael', race: 0, sex: 0, classId: 0,
        hairStyle: 0, hairColor: 0, face: 0,
      }));
      await page.waitForFunction(
        `window.__world.net.log.some(l => l.dir === 'in' && l.op === 'charCreateOk')`,
        { timeout: 10000 });
      await page.waitForFunction(
        `window.__world.charSelect.open && !window.__world.charCreate.open &&
         document.querySelectorAll('#charsel-overlay .charsel-row').length === 3`,
        { timeout: 15000 });
      summary.refreshedList = await page.evaluate(() =>
        [...document.querySelectorAll('#charsel-overlay .charsel-row')]
          .map(r => r.textContent.trim()));
      await sleep(300);
      await page.screenshot({ path: SHOT('03_updated_list_after_create') });

      await page.click('#charsel-dismiss');
      await page.waitForFunction(
        `!window.__world.net.online && !window.__world.charSelect.open`,
        { timeout: 10000 });
      summary.dismiss = await page.evaluate(() => ({
        offline: !window.__world.net.online,
        status: document.getElementById('status').textContent,
        toggleUnchecked: !document.getElementById('online-toggle').checked,
      }));
      await page.close();
    }

    // -- 4. 1-char account: auto-enter, NO select overlay ------------------
    // (a fresh non-multi account is EMPTY under cc — inject the refreshed
    // 1-char auth_ok through the real dispatch, as after a first createChar.
    // Explicit non-multi deviceId: origin localStorage is SHARED across the
    // browser's pages, so a null here would inherit the multi id above)
    {
      summary.step = '4: 1-char auto-enter';
      const page = await newPage('soloverifyc');
      await boot(page, BASE);
      await page.click('#online-toggle');
      await page.waitForFunction('window.__world.charCreate.open', { timeout: 20000 });
      await page.evaluate(() => window.__world.net.inject({
        op: 'auth_ok',
        chars: [{ slot: 0, name: 'Solo', race: 'Human', classId: 0, level: 1 }],
      }));
      await page.waitForFunction(
        `window.__world.net.log.some(l => l.dir === 'out' && l.op === 'enterChar')`,
        { timeout: 10000 });
      summary.singleChar = {
        enterCharOp: (await outOps(page, 'enterChar'))[0],
        selectNeverOpened: await page.evaluate(() =>
          !window.__world.charSelect.open && !document.getElementById('charsel-overlay')),
        createClosed: await page.evaluate(() => !window.__world.charCreate.open),
      };
      await page.waitForFunction('window.__world.net.selfId', { timeout: 20000 });
      summary.singleChar.enteredWorld = true;
      await page.close();
    }

    // -- 5. ?cc=0 legacy: multi account still auto-enters the FIRST char ---
    {
      summary.step = '5: ?cc=0 legacy';
      const page = await newPage('multiverifyd');
      await boot(page, BASE + '&cc=0');
      await page.click('#online-toggle');
      await page.waitForFunction(
        `window.__world.net.log.some(l => l.dir === 'out' && l.op === 'enterChar')`,
        { timeout: 20000 });
      summary.legacyCc0 = {
        enterCharOp: (await outOps(page, 'enterChar'))[0],
        selectNeverOpened: await page.evaluate(() =>
          !window.__world.charSelect.open && !document.getElementById('charsel-overlay')),
      };
      await page.waitForFunction('window.__world.net.selfId', { timeout: 20000 });
      summary.legacyCc0.enteredAs = await page.evaluate(() =>
        (window.__world.net.log.find(l => l.dir === 'in' && l.op === 'enterWorld') || {})
          .char?.name);
      await page.close();
    }

    summary.step = 'verdict';
    // -- verdict ------------------------------------------------------------
    const rows = summary.overlay.rows || [];
    const ewChar = (summary.enterWorld && summary.enterWorld.char) || {};
    summary.checks = {
      bothCharsListed: rows.length === 2 &&
        /Sylva/.test(rows[0] || '') && /Lv 20/.test(rows[0] || '') &&
        /Elf/.test(rows[0] || '') && /Elven Mystic/.test(rows[0] || '') &&
        /Dorn/.test(rows[1] || '') && /Lv 12/.test(rows[1] || '') &&
        /Dwarf/.test(rows[1] || '') && /Dwarven Fighter/.test(rows[1] || ''),
      overlayButtons: summary.overlay.createBtn && summary.overlay.dismissBtn,
      noAutoEnterOnMulti: summary.overlay.enterCharSentBeforeClick === false,
      clickedSlotSent: summary.enterCharOp && summary.enterCharOp.slot === 1,
      enteredAsClicked: ewChar.name === 'Dorn' && ewChar.classId === 53 &&
        summary.selectClosedOnEnter === true,
      createPathOpensCreator: summary.createPath.createOverlayOpened === true,
      refreshedListHasNewChar: (summary.refreshedList || []).length === 3 &&
        (summary.refreshedList || []).some(r => /Kael/.test(r) && /Lv 1/.test(r)),
      dismissGoesOffline: summary.dismiss.offline === true &&
        summary.dismiss.toggleUnchecked === true && /solo/.test(summary.dismiss.status),
      singleCharAutoEnters: summary.singleChar.enterCharOp &&
        summary.singleChar.enterCharOp.slot === 0 &&
        summary.singleChar.selectNeverOpened === true &&
        summary.singleChar.createClosed === true &&
        summary.singleChar.enteredWorld === true,
      cc0LegacyAutoEnters: summary.legacyCc0.enterCharOp &&
        summary.legacyCc0.enterCharOp.slot === 0 &&
        summary.legacyCc0.selectNeverOpened === true &&
        summary.legacyCc0.enteredAs === 'Sylva',
    };
    summary.ok = Object.values(summary.checks).every(Boolean);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) { console.error('VERIFY FAILED'); process.exit(1); }
})().catch(e => {
  console.error('VERIFY FAILED at step', JSON.stringify(globalThis.__csSummary && globalThis.__csSummary.step), '-', e.message);
  process.exit(1);
});
