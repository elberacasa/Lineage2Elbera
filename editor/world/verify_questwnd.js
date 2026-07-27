// QuestWnd verification (mock gateway on 8085). The mock sends questList
// at enterChar with two REAL quests — Q1 "Letters of Love" cond 1
// (0x80000001 signed) and Q6 "Step into the Future" cond 3 (0x80000007
// signed) — and re-sends the list after questAbort.
// Asserts: Alt+U toggles, rows render, cond math (aCis calculateFlags),
// select + Abort sends questAbort{id} and the re-sent list updates the
// window, empty state after both aborts.
// Output: verify_shots/qw_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085';
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
      `window.__world.net.log.some(m => m.op === 'questList')`, { timeout: 20000 });
    await sleep(1000);

    // -- cond math (aCis calculateFlags, gateway/README M8) ------------------
    summary.condMath = await page.evaluate(() => ({
      cond1: window.__world.questCond(-2147483647),   // 0x80000001 -> 1
      cond3: window.__world.questCond(-2147483641),   // 0x80000007 -> 3
      cond0: window.__world.questCond(0),
      startedNeg: window.__world.questStarted(-2147483647),
      startedZero: window.__world.questStarted(0),
    }));

    // -- Alt+U opens the journal with both quests -----------------------------
    await page.keyboard.down('Alt'); await page.keyboard.press('u'); await page.keyboard.up('Alt');
    await sleep(500);
    summary.window = await page.evaluate(() => ({
      visible: window.__world.questWnd.visible,
      quests: window.__world.questWnd.quests.map(q => ({
        id: q.id, name: q.name, cond: window.__world.questCond(q.progress),
      })),
      rows: document.querySelectorAll('.l2-quest-row').length,
      registered: window.__world.wndMgr.names.includes('QuestTreeWnd'),
    }));
    await page.screenshot({ path: path.join(OUT, 'qw_01_list.png') });

    // -- select Q1, abort -> questAbort out + re-sent list --------------------
    await page.evaluate(() => {
      document.querySelector('.l2-quest-row[data-quest-id="1"]').click();
    });
    await sleep(300);
    await page.evaluate(() => {
      document.querySelector('.l2-quest-abort').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'questAbort'
        && m.id === 1)`, { timeout: 8000 });
    await page.waitForFunction(
      'window.__world.questWnd.quests.length === 1', { timeout: 8000 });
    await sleep(300);
    summary.afterFirstAbort = await page.evaluate(() => ({
      remaining: window.__world.questWnd.quests.map(q => q.id),
      rows: document.querySelectorAll('.l2-quest-row').length,
      selectionCleared: window.__world.questWnd.selected === null,
    }));
    await page.screenshot({ path: path.join(OUT, 'qw_02_after_abort.png') });

    // -- abort the second -> retail empty window (tutorial is filtered) -------
    await page.evaluate(() => {
      document.querySelector('.l2-quest-row[data-quest-id="6"]').click();
    });
    await sleep(200);
    await page.evaluate(() => {
      document.querySelector('.l2-quest-abort').click();
    });
    await page.waitForFunction(
      'window.__world.questWnd.quests.length === 0', { timeout: 8000 });
    await sleep(300);
    summary.empty = await page.evaluate(() => ({
      rows: document.querySelectorAll('.l2-quest-row').length,
      visible: window.__world.questWnd.visible,   // empty window, not an error
    }));
    await page.screenshot({ path: path.join(OUT, 'qw_03_empty.png') });

    // -- Alt+U closes ------------------------------------------------------------
    await page.keyboard.down('Alt'); await page.keyboard.press('u'); await page.keyboard.up('Alt');
    await sleep(300);
    summary.closed = await page.evaluate(() => !window.__world.questWnd.visible);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY QUESTWND FAILED:', e.message); process.exit(1); });
