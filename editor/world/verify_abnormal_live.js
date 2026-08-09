// AbnormalStatusWnd LIVE pass: real stack (aCis :2106/:7777 + gateway
// :8090 with the landed M10 ops). Flow: log in once to learn the char
// name, seed it (tools/dev/seed_test_char.py --level 5 --apply, gives
// War Cry 78 at minLvl 5), relog, cast War Cry, and the strip must show
// the REAL AbnormalStatusUpdate. skillCoolTime must drive the slot sweep.
// Output: verify_shots/ab_live_01.png + JSON summary.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const fixture = require('./live_fixture');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const SEED = path.join(__dirname, '..', '..', 'tools', 'dev', 'seed_test_char.py');
// STABLE across RUNS, not merely across this run's two passes. The old
// `'verify-abnormal-' + Date.now()` pinned the id between pass 1 and pass 2
// — a correct fix scoped one level too small. Every RUN still minted a new
// deviceId, so every run got a brand-new account whose auth_ok is
// {chars: []}; the client opened character creation and the enterWorld wait
// in launch() below expired at 120 s. See live_fixture.js.
const DEVICE_ID = 'verify-abnormal-fixture-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  await fixture.ensureChar(DEVICE_ID);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  // pin the device id across both passes — each fresh headless profile
  // would otherwise be a NEW account with a NEW (unseeded) character
  await page.evaluateOnNewDocument((id) => {
    localStorage.setItem('l2vzla.deviceId', id);
  }, DEVICE_ID);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  return { browser, page };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = {};

  // -- pass 1: learn the character name, seed it, drop it --------------------
  const p1 = await launch();
  const charName = await p1.page.evaluate(
    () => window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
  summary.charName = charName;
  await p1.browser.close();
  execFileSync('python3', [SEED, charName, '--level', '20', '--apply'],
    { stdio: 'pipe' });   // War Cry (78) is minLvl 20 on humanFighter.xml
  summary.seeded = true;

  // -- pass 2: relog, War Cry is in the skill list, cast it -------------------
  const p2 = await launch();
  try {
    const page = p2.page;
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillList'
        && (m.skills || []).some(s => s.id === 78))`, { timeout: 30000 });
    await sleep(2000);
    await page.evaluate(() => {
      window.__world.shortcutWnd.assignFirstFree({ type: 'skill', id: 78 });
    });
    await sleep(300);
    await page.keyboard.press('F1');
    // the REAL AbnormalStatusUpdate must arrive with War Cry on it
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'buffs'
        && (m.effects || []).some(e => e.skillId === 78))`, { timeout: 30000 });
    await sleep(1200);
    summary.strip = await page.evaluate(() => ({
      effects: window.__world.abnormalWnd.effects.map(e => ({
        skillId: e.skillId, durationSec: e.durationSec,
      })),
      cells: document.querySelectorAll('.l2-buff-cell').length,
      iconsLoaded: [...document.querySelectorAll('.l2-buff-cell img')]
        .filter(i => i.complete && i.naturalWidth > 0).length,
    }));
    // reuse: aCis sends NO SkillCoolTime on cast — the 180s reuseDelay
    // (skill XML) rides inside MagicSkillUse itself, and the bridge
    // forwards it as skillCast.reuse (ms). The slot sweep follows THAT.
    summary.cooltime = await page.evaluate(() => ({
      castWithReuse: window.__world.net.log.some(m => m.op === 'skillCast'
        && m.skillId === 78 && m.reuse > 0),
      slotSweep: (() => {
        const ov = document.querySelector('.shortcut-slot[data-sid="78"] .l2-cool-overlay');
        return ov ? parseFloat(ov.style.height) : null;
      })(),
    }));
    await page.screenshot({ path: path.join(OUT, 'ab_live_01.png') });
  } finally {
    await p2.browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY ABNORMAL LIVE FAILED:', e.stack || e.message); process.exit(1); });
