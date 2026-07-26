// NPC dialog verification (mock gateway on 8085): talk flow to a
// non-attackable NPC, npcHtml window chrome + sanitized rendering, link
// navigation via bypass, .menu showcase, sanitize test (script tag +
// javascript: href + external img must be stripped).
// Output: verify_shots/dlg_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085';
const OUT = path.join(__dirname, 'verify_shots');
const ELIAS = 70004;   // civilian (Folk) — non-attackable
const GREMLIN = 70001; // monster — stays on the combat path
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
      'window.__world.entities.snapshot().length >= 10', { timeout: 20000 });
    await sleep(2000);

    // -- talk flow: single click targets, second click TALKS to Elias -------
    const aimClick = async (id) => {
      await page.evaluate((eid) => {
        const w = window.__world;
        const e = w.entities.getEntity(eid);
        const c = w.character.group.position;
        w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z);
        w.followCam.pitch = 0.3;
        w.followCam.dist = Math.max(w.followCam.minDist, 4);
      }, id);
      await sleep(1200);
      const gp = await page.evaluate((eid) => {
        const w = window.__world;
        const e = w.entities.getEntity(eid);
        const V = e.group.position.constructor;
        return w.project(new V(e.group.position.x, e.group.position.y + 0.3, e.group.position.z));
      }, id);
      await page.mouse.click(gp.x, gp.y);
      return gp;
    };

    await aimClick(ELIAS);                    // first click: target
    await sleep(600);
    summary.firstClick = await page.evaluate(() => ({
      talkSent: window.__world.net.log.some(m => m.dir === 'out' && m.op === 'talk'),
      targetSent: window.__world.net.log.some(m => m.dir === 'out' && m.op === 'target' && m.id === 70004),
    }));
    const gp2 = await aimClick(ELIAS);        // second click: talk
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'talk' && m.id === ${ELIAS})
       && window.__world.net.log.some(m => m.op === 'npcHtml')`,
      { timeout: 10000 });
    await sleep(700);
    summary.dialog = await page.evaluate(() => ({
      open: window.__world.npcDialog.open,
      title: document.querySelector('.npc-dialog-title')?.textContent,
      links: [...document.querySelectorAll('.npc-link')].map(e => e.dataset.bypass),
      buttons: [...document.querySelectorAll('.npc-btn')].map(e => e.dataset.bypass),
      table: !!document.querySelector('.npc-table'),
      fonts: [...document.querySelectorAll('.npc-dialog-content span')]
        .filter(e => e.style.color).map(e => e.style.color),
      scripts: document.querySelectorAll('.npc-dialog-content script').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'dlg_01_villager.png') });

    // -- attackable NPC stays on the combat path (no talk op) ----------------
    await page.evaluate(() => window.__world.npcDialog.close());
    await aimClick(GREMLIN);
    await sleep(400);
    await aimClick(GREMLIN);                  // second click on gremlin
    await sleep(800);
    summary.gremlinPath = await page.evaluate(() => ({
      talkSent: window.__world.net.log.some(m => m.dir === 'out' && m.op === 'talk' && m.id === 70001),
      attackSent: window.__world.net.log.some(m => m.dir === 'out' && m.op === 'attack' && m.id === 70001),
    }));

    // -- link click navigates via bypass --------------------------------------
    await page.evaluate(() => window.__world.combat.setTarget(
      70004, 'Elias', { kind: 'npc', level: null, color: null }));
    await page.evaluate(() => window.__world.net.sendOp('talk', { id: 70004 }));
    await page.waitForFunction(
      'window.__world.npcDialog.open', { timeout: 10000 });
    await sleep(500);
    await page.evaluate(() => {
      [...document.querySelectorAll('.npc-link')]
        .find(e => e.dataset.bypass === 'npc_services')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'bypass'
        && m.command === 'npc_services')
       && document.querySelector('.npc-dialog-title')
       && document.querySelector('.npc-dialog-title').textContent === 'Services'`,
      { timeout: 10000 });
    summary.nav1 = await page.evaluate(() => ({
      title: document.querySelector('.npc-dialog-title')?.textContent,
    }));
    await page.screenshot({ path: path.join(OUT, 'dlg_02_services.png') });

    // -- .menu showcase ---------------------------------------------------------
    await page.keyboard.press('Enter');
    await sleep(250);
    await page.type('#chat-input', '.menu');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      `document.querySelector('.npc-dialog-title')
       && document.querySelector('.npc-dialog-title').textContent.includes('menu')`,
      { timeout: 10000 });
    await sleep(500);
    summary.menu = await page.evaluate(() => ({
      title: document.querySelector('.npc-dialog-title')?.textContent,
      buttons: [...document.querySelectorAll('.npc-btn')].map(e => e.textContent || e.dataset.bypass),
    }));
    await page.screenshot({ path: path.join(OUT, 'dlg_03_menu.png') });

    // -- sanitize test: Sanitize test button -> evil page -----------------------
    await page.evaluate(() => {
      [...document.querySelectorAll('.npc-btn')]
        .find(e => e.dataset.bypass === 'evil')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForFunction(
      `document.querySelector('.npc-dialog-title')
       && document.querySelector('.npc-dialog-title').textContent === 'Evil'`,
      { timeout: 10000 });
    await sleep(500);
    summary.sanitize = await page.evaluate(() => ({
      pwned: window.__pwned === true,
      pwned2: window.__pwned2 === true,
      scriptTags: document.querySelectorAll('.npc-dialog-content script').length,
      badLinks: [...document.querySelectorAll('.npc-dialog-content a')].length,
      safeLinks: document.querySelectorAll('.npc-link').length,
      externalImgs: [...document.querySelectorAll('.npc-dialog-content img')]
        .filter(i => /evil\.example/.test(i.src)).length,
    }));
    await page.screenshot({ path: path.join(OUT, 'dlg_04_sanitize.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY DIALOG FAILED:', e.message); process.exit(1); });
