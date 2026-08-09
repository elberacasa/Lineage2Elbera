// ActionWnd LIVE pass: world client (8083) against the REAL stack
// (aCis :2106/:7777 + gateway :8090). Single headless client:
//   1. online -> enterWorld
//   2. Alt+C -> ActionWnd visible with 17/7/12 sections
//   3. click Sit/Stand (id 0) -> RequestActionUse(0) -> changeWait broadcast
//   4. click Victory (UI id 13) -> RequestSocialAction(3) -> socialAction
//      echo carrying actionId 3 -> local emote. The two numbers are NOT the
//      same id space: 13 is actionname-e.dat, 3 is socialname-e.dat, and
//      gateway/src/bridge.js:21-24 maps between them.
//   5. sit/stand again to leave the character standing
// Output: verify_shots/act_live_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const fixture = require('./live_fixture');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
// STABLE — see live_fixture.js. A per-run id mints a new account, whose
// auth_ok is {chars: []}, and the 120 s enterWorld wait below can never be
// satisfied. That was this suite's ONLY failure mode on 2026-08-09.
const DEVICE_ID = 'verify-actionwnd-fixture-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await fixture.ensureChar(DEVICE_ID);
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

    await fixture.seed(page, DEVICE_ID);
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

    // aCis drops a social action unless the AI intention is IDLE
    // (RequestSocialAction.java: `getAI().getCurrentIntention().getType() !=
    // IntentionType.IDLE` -> silent return, NO reply packet of any kind).
    // Sitting sets IntentionType.SIT (PlayableAI.doSitIntention) and only
    // returns to IDLE from the SAT_DOWN callback that Player.sitDown()
    // schedules 2500 ms later (Player.java:1548-1556, PlayerAI.onEvtSatDown
    // -> doIdleIntention). No packet marks that transition, so the wait is
    // the server's own constant plus margin — 2500 is READ from sitDown(),
    // not chosen. Measured: with the original 400 ms the click lands inside
    // the window and is binned silently.
    await sleep(3200);

    // -- Victory (UI id 13) -> RequestSocialAction(3) -> socialAction echo ---
    // TWO ID SPACES, and this suite used to confuse them. `actionId` on the
    // outbound `action` op is an actionname-e.dat UI id; aCis's SocialAction
    // carries the socialname-e.dat ordinal, and the gateway translates
    // between them (bridge.js:21-24 SOCIAL_UI_TO_ACIS — UI 13 Victory -> 3).
    // Measured on the live server 2026-08-09: out action{actionId:13} ->
    // in socialAction{actionId:3}. The old assertion demanded 13 on the way
    // back, which the server has never sent and should never send. That
    // mapping table landed AFTER this suite was written, so the suite was
    // asserting pre-mapping behaviour: SUITE WRONG, product correct.
    await page.evaluate(() => {
      document.querySelector('#l2-actionwnd .l2-action-cell[data-action-id="13"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'socialAction'
        && m.id === window.__world.net.selfId
        && m.actionId === 3)`, { timeout: 15000 });
    await sleep(300);
    summary.social = await page.evaluate(() => ({
      sent: window.__world.net.log.filter(m => m.dir === 'out' && m.op === 'action'
        && m.actionId === 13).length,
      echo: window.__world.net.log.find(m => m.op === 'socialAction'
        && m.id === window.__world.net.selfId),
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
})().catch(e => { console.error('VERIFY ACTION LIVE FAILED:', e.stack || e.message); process.exit(1); });
