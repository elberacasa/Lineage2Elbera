// LIVE verification for the enterWorld self-model fix against the REAL
// stack (aCis :2106/:7777 + gateway :8090 with the 2026-08-03 contract
// addition). ONE governor-paced session: fresh deviceId -> login
// (noAutoCreate) -> createChar a DARK ELF (race 2, sex 1 female, classId
// 31 Dark Fighter) -> refreshed auth_ok -> auto enterChar -> enterWorld.
// The self model must reload from human_fighter_m to the darkelf FEMALE
// manifest entry (darkelf_f) — the owner-reproduced bug had Dark Elves
// render as the human fighter. Screenshot: verify_shots/sm_live_01.png.
// Usage: node verify_selfmodel_live.js
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';   // default ws -> ws://127.0.0.1:8090
const OUT = path.join(__dirname, 'verify_shots');
// LIVE-FIXTURE-EXEMPT: this suite's SUBJECT is the empty-account path —
// auth_ok{chars:[]} -> charCreate.open -> createChar a dark elf -> the self
// model must reload from human_fighter_m to darkelf_f. It therefore requires
// a fresh account by construction; a stable one would hit
// name_already_exists (or eventually too_many_characters) on the second run.
// The nine suites live_fixture.js exists to fix were the ones that got a
// fresh account by ACCIDENT and then waited for an enterWorld that could
// never come. This one asks for it and handles it.
// COST, measured 2026-08-09: one account + one character per run, never
// reclaimed (1,214 accounts / 1,168 characters in l2jdb at the time). Not a
// correctness problem; noted so it is not mistaken for one later.
const DEVICE_ID = 'verify-selfmodel-' + Date.now().toString(36);
const CHAR_NAME = 'Sm' + Date.now().toString(36).slice(-8);   // unique, [a-z0-9]i
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleLogs: [] };
  globalThis.__smLiveSummary = summary;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));
    await page.evaluateOnNewDocument((id) =>
      localStorage.setItem('l2vzla.deviceId', id), DEVICE_ID);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    summary.bootModel = await page.evaluate(() => window.__world.selfModelId);

    summary.step = 'login (fresh account -> empty auth_ok -> create overlay)';
    await page.click('#online-toggle');
    await page.waitForFunction('window.__world.charCreate.open', { timeout: 60000 });

    summary.step = 'createChar dark elf female fighter';
    await page.evaluate((name) => window.__world.net.sendOp('createChar', {
      name, race: 2, sex: 1, classId: 31, hairStyle: 1, hairColor: 0, face: 1,
    }), CHAR_NAME);
    await page.waitForFunction(
      `window.__world.net.log.some(l => l.dir === 'in' && l.op === 'charCreateOk')`,
      { timeout: 30000 });

    summary.step = 'enterWorld (auto enterChar after refreshed auth_ok)';
    await page.waitForFunction(
      `window.__world.net.log.some(l => l.dir === 'in' && l.op === 'enterWorld')`,
      { timeout: 120000 });
    await page.waitForFunction(
      `window.__world.selfModelId !== 'human_fighter_m'`, { timeout: 30000 });
    await sleep(2500);   // model + scene settle

    summary.enterWorldChar = await page.evaluate(() =>
      (window.__world.net.log.find(l => l.dir === 'in' && l.op === 'enterWorld') || {}).char);
    summary.selfModelId = await page.evaluate(() => window.__world.selfModelId);
    summary.status = await page.evaluate(() =>
      document.getElementById('status').textContent);

    // avatar close-up for visual inspection
    await page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      w.camera.position.set(p.x + 1.5, p.y + 1.6, p.z + 2.5);
      w.camera.lookAt(p.x, p.y + 1.1, p.z);
    });
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'sm_live_01_darkelf_female.png') });

    summary.step = 'verdict';
    const c = summary.enterWorldChar || {};
    summary.checks = {
      bootIsHumanFighter: summary.bootModel === 'human_fighter_m',
      charIsCreatedDarkElf: c.name === CHAR_NAME && c.race === 2 && c.classId === 31,
      contractHasAppearance: c.sex === 1 && typeof c.hairStyle === 'number' &&
        typeof c.hairColor === 'number' && typeof c.face === 'number',
      selfIsDarkElfFemale: summary.selfModelId === 'darkelf_f',
      notHumanFighter: summary.selfModelId !== 'human_fighter_m',
    };
    summary.ok = Object.values(summary.checks).every(Boolean);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) { console.error('VERIFY FAILED'); process.exit(1); }
})().catch(e => {
  console.error('VERIFY FAILED at step',
    JSON.stringify(globalThis.__smLiveSummary && globalThis.__smLiveSummary.step), '-', e.message);
  process.exit(1);
});
