// QuestWnd LIVE pass: world client (8083) against the REAL stack
// (aCis :2106/:7777 + gateway :8090). A fresh character has NO real
// quests (the Tutorial chain is quest id -1, filtered server-side via
// isRealQuest) — the journal must render the retail EMPTY window from
// the server's questList push. If the account happens to have quests,
// they are reported instead.
// Output: verify_shots/qw_live_01.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = {};
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => console.error('PAGEERROR:', e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.connected
       && window.__world.net.log.some(m => m.op === "enterWorld")
       && window.__world.net.log.some(m => m.op === "questList")`,
      { timeout: 120000 });
    await sleep(1500);

    summary.pushed = await page.evaluate(() => ({
      quests: window.__world.questWnd.quests.map(q => ({
        id: q.id, name: q.name,
        cond: window.__world.questCond(q.progress),
        started: window.__world.questStarted(q.progress),
      })),
    }));
    await page.keyboard.down('Alt'); await page.keyboard.press('u'); await page.keyboard.up('Alt');
    await sleep(500);
    summary.window = await page.evaluate(() => ({
      visible: window.__world.questWnd.visible,
      rows: document.querySelectorAll('.l2-quest-row').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'qw_live_01.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY QUESTWND LIVE FAILED:', e.stack || e.message); process.exit(1); });
