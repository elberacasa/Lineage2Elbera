// Skill-depth LIVE spot-check: real stack (aCis :2106/:7777 + gateway :8090).
// Flow (mirrors verify_abnormal_live.js): log in once to auto-create/learn
// the char, seed it to level 5 (Power Strike is minLvl 3 on humanFighter,
// starter Squire's Sword stays equipped), relog, and Power Strike must be
// ENABLED (weaponGate reads SWORD off the real ItemList) and clickable —
// the useSkill op goes out to the real server.
// Output: verify_shots/skilldepth_live_01.png + JSON summary.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const SEED = path.join(__dirname, '..', '..', 'tools', 'dev', 'seed_test_char.py');
const DEVICE_ID = 'verify-skilldepth-' + Date.now().toString(36);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => console.error('PAGEERROR:', e.message));
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
  await sleep(3000);   // let the server fully log the char out before seeding
  summary.seed = execFileSync('python3', [SEED, charName, '--level', '5', '--apply'],
    { stdio: 'pipe', encoding: 'utf8' }).split('\n').filter(l => /level|skills/.test(l));

  // -- pass 2: relog — Power Strike enabled with the starter sword ------------
  const p2 = await launch();
  try {
    const page = p2.page;
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillList'
        && (m.skills || []).some(s => s.id === 3))
       && window.__world.weaponGate.loaded`, { timeout: 30000 });
    await page.waitForFunction(
      `window.__world.weaponGate.weapon === 'SWORD'`, { timeout: 30000 });
    summary.weapon = 'SWORD (starter Squire\'s Sword, real ItemList)';
    await sleep(2000);

    await page.keyboard.down('Alt'); await page.keyboard.press('k'); await page.keyboard.up('Alt');
    await sleep(600);
    summary.powerStrike = await page.evaluate(() => {
      const el = document.querySelector('#l2-skillwnd .l2-skill-cell[data-skill-id="3"]');
      return el ? {
        enabled: !el.classList.contains('l2-weapon-mismatch') && el.draggable,
        opacity: el.style.opacity, title: el.title,
      } : null;
    });

    // click it: the useSkill op must actually leave for the real server
    await page.evaluate(() => {
      window.__mark = window.__world.net.log.length;
      document.querySelector('#l2-skillwnd .l2-skill-cell[data-skill-id="3"]').click();
    });
    await page.waitForFunction(
      `window.__world.net.log.slice(window.__mark)
        .some(m => m.dir === 'out' && m.op === 'useSkill' && m.skillId === 3)`, { timeout: 8000 });
    summary.useSkillSent = true;
    await page.screenshot({ path: path.join(OUT, 'skilldepth_live_01.png') });
    summary.result = summary.powerStrike && summary.powerStrike.enabled ? 'PASS' : 'FAIL';
  } finally {
    await p2.browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.result !== 'PASS') process.exit(1);
})().catch(e => { console.error('VERIFY SKILLDEPTH LIVE FAILED:', e.message); process.exit(1); });
