// Headless verification for the enterWorld self-model fix (world client on
// 8083, mock gateway on 8087). The boot model is always human_fighter_m;
// after enterWorld the client must RELOAD the self model to match the
// entered char's race/class/sex (contract addition 2026-08-03).
//   1. multi fixture -> click Sylva (Elf female mystic, classId 25, sex 1)
//      -> self model reloads to the elf FEMALE manifest entry (elf_f), NOT
//      human_fighter_m; enterWorld.char carries sex/hairStyle/hairColor/face
//   2. multi fixture -> click Dorn (Dwarf male fighter, classId 53, sex 0)
//      -> self model is dwarf_m
//   3. offline/solo boot is untouched: model stays human_fighter_m until
//      an enterWorld actually arrives
// Usage: node verify_selfmodel.js   (mock: node mock_gateway.js 8087)
// Output: verify_shots/sm_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8087';
const OUT = path.join(__dirname, 'verify_shots');
const SHOT = (n) => path.join(OUT, `sm_${n}.png`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleLogs: [] };
  globalThis.__smSummary = summary;
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
  // avatar close-up: put the camera near the self model for the screenshot
  const closeup = async (page) => page.evaluate(() => {
    const w = window.__world;
    const p = w.character.group.position;
    w.camera.position.set(p.x + 1.5, p.y + 1.6, p.z + 2.5);
    w.camera.lookAt(p.x, p.y + 1.1, p.z);
  });
  try {
    // -- 1. Sylva: Elf FEMALE mystic -------------------------------------
    {
      summary.step = '1: Sylva (elf female mystic)';
      const page = await newPage('multiselfmoda');
      await boot(page, BASE);
      summary.bootModel = await page.evaluate(() => window.__world.selfModelId);
      await page.click('#online-toggle');
      await page.waitForFunction(
        'window.__world.charSelect && window.__world.charSelect.open', { timeout: 20000 });
      await page.evaluate(() =>
        document.querySelectorAll('#charsel-overlay .charsel-row')[0].click());
      await page.waitForFunction('window.__world.net.selfId', { timeout: 20000 });
      await page.waitForFunction(
        `window.__world.selfModelId !== 'human_fighter_m'`, { timeout: 20000 });
      await sleep(1500);   // model + scene settle
      summary.sylva = {
        enterWorldChar: await page.evaluate(() =>
          (window.__world.net.log.find(l => l.dir === 'in' && l.op === 'enterWorld') || {}).char),
        selfModelId: await page.evaluate(() => window.__world.selfModelId),
        status: await page.evaluate(() => document.getElementById('status').textContent),
      };
      await closeup(page);
      await sleep(300);
      await page.screenshot({ path: SHOT('01_sylva_elf_female') });
      await page.close();
    }

    // -- 2. Dorn: Dwarf MALE fighter --------------------------------------
    {
      summary.step = '2: Dorn (dwarf male fighter)';
      const page = await newPage('multiselfmodb');
      await boot(page, BASE);
      await page.click('#online-toggle');
      await page.waitForFunction(
        'window.__world.charSelect && window.__world.charSelect.open', { timeout: 20000 });
      await page.evaluate(() =>
        document.querySelectorAll('#charsel-overlay .charsel-row')[1].click());
      await page.waitForFunction('window.__world.net.selfId', { timeout: 20000 });
      await page.waitForFunction(
        `window.__world.selfModelId !== 'human_fighter_m'`, { timeout: 20000 });
      await sleep(1500);
      summary.dorn = {
        enterWorldChar: await page.evaluate(() =>
          (window.__world.net.log.find(l => l.dir === 'in' && l.op === 'enterWorld') || {}).char),
        selfModelId: await page.evaluate(() => window.__world.selfModelId),
      };
      await closeup(page);
      await sleep(300);
      await page.screenshot({ path: SHOT('02_dorn_dwarf_male') });
      await page.close();
    }

    // -- 3. solo/offline boot untouched -----------------------------------
    {
      summary.step = '3: offline boot keeps default model';
      const page = await newPage('soloselfmodc');
      await boot(page, BASE);
      await sleep(500);
      summary.offline = {
        selfModelId: await page.evaluate(() => window.__world.selfModelId),
        online: await page.evaluate(() => window.__world.net.online),
      };
      await page.close();
    }

    // -- verdict -----------------------------------------------------------
    summary.step = 'verdict';
    const sc = summary.sylva.enterWorldChar || {};
    const dc = summary.dorn.enterWorldChar || {};
    summary.checks = {
      bootIsHumanFighter: summary.bootModel === 'human_fighter_m',
      sylvaContractFields: sc.name === 'Sylva' && sc.sex === 1 &&
        sc.hairStyle === 1 && sc.hairColor === 0 && sc.face === 2,
      sylvaIsElfFemale: summary.sylva.selfModelId === 'elf_f',
      dornContractFields: dc.name === 'Dorn' && dc.sex === 0,
      dornIsDwarfMale: summary.dorn.selfModelId === 'dwarf_m',
      offlineBootUnchanged: summary.offline.selfModelId === 'human_fighter_m' &&
        summary.offline.online === false,
    };
    summary.ok = Object.values(summary.checks).every(Boolean);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) { console.error('VERIFY FAILED'); process.exit(1); }
})().catch(e => {
  console.error('VERIFY FAILED at step', JSON.stringify(globalThis.__smSummary && globalThis.__smSummary.step), '-', e.message);
  process.exit(1);
});
