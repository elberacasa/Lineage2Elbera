// ActionWnd LIVE pass: world client (8083) against the REAL stack
// (aCis :2106/:7777 + gateway :8090). Single headless client:
//   1. online -> enterWorld
//   2. Alt+C -> ActionWnd visible with 17/7/12 sections
//   3. click Sit/Stand (id 0) -> RequestActionUse(0) -> changeWait broadcast
//   4. click Victory (id 13) -> RequestSocialAction(13) -> socialAction echo
//      -> local 'dance' emote
//   5. sit/stand again to leave the character standing
// Output: verify_shots/act_live_*.png + JSON summary.
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
  const summary = { consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
      { timeout: 120000 });
    await sleep(2500);

    // -- Alt+C: window with live-populated sections -------------------------
    await page.keyboard.down('Alt'); await page.keyboard.press('c'); await page.keyboard.up('Alt');
    await sleep(600);
    summary.window = await page.evaluate(() => ({
      visible: window.__world.actionWnd.visible,
      counts: window.__world.actionWnd.counts(),
    }));

    // -- Sit/Stand (id 0) -> server broadcasts changeWait for us -------------
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="0"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'changeWait'
        && m.id === window.__world.net.selfId)`, { timeout: 15000 });
    summary.sit = await page.evaluate(() => ({
      changeWait: window.__world.net.log.find(m => m.op === 'changeWait'
        && m.id === window.__world.net.selfId),
    }));
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'act_live_01_sit.png') });

    // -- Victory (id 13) -> RequestSocialAction -> socialAction echo ---------
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="13"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'socialAction'
        && m.actionId === 13)`, { timeout: 15000 });
    await sleep(300);
    summary.social = await page.evaluate(() => ({
      echo: window.__world.net.log.find(m => m.op === 'socialAction'),
      clip: window.__world.character.current
        ? window.__world.character.current.getClip().name : null,
    }));
    await page.screenshot({ path: path.join(OUT, 'act_live_02_social.png') });

    // -- stand back up --------------------------------------------------------
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="0"]').click();
    });
    await sleep(800);
    summary.finalWait = await page.evaluate(() => (
      window.__world.net.log.filter(m => m.op === 'changeWait'
        && m.id === window.__world.net.selfId).map(m => m.waitType)));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY ACTION LIVE FAILED:', e.message); process.exit(1); });
