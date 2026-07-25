// M4 skills & items verification against the MOCK gateway (port 8085).
// Drives the real UI: skill bar populated from skillList (fallback names
// while metadata is absent), number-key cast -> casting bar -> skillLaunch
// + flash, inventory from itemList (toggle I), useItem via double-click
// (invUpdate applied), corpse loot -> loot toast, sysMsg lines in chat.
//
// Usage: node verify_skills.js     (mock gateway must be running on 8085)
// Output: verify_shots/m4_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085';
const OUT = path.join(__dirname, 'verify_shots');
const GREMLIN = 70001;
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
      `window.__world.net.log.some(m => m.op === 'skillList')
       && window.__world.net.log.some(m => m.op === 'itemList')`, { timeout: 20000 });
    await sleep(1200);

    // -- skill bar populated (fallback names/icons while no metadata) ------
    summary.skillBar = await page.evaluate(() => ({
      slots: document.querySelectorAll('.skill-slot').length,
      titles: [...document.querySelectorAll('.skill-slot')].map(e => e.title),
      fallbackIcons: document.querySelectorAll('.skill-slot .icon-fallback').length,
    }));

    // -- inventory panel: toggle I, grid contents ----------------------------
    await page.keyboard.press('KeyI');
    await sleep(400);
    summary.inventory = await page.evaluate(() => ({
      visible: document.getElementById('inventory-panel').classList.contains('visible'),
      slots: document.querySelectorAll('.inv-slot').length,
      equipped: document.querySelectorAll('.inv-slot.equipped').length,
      withCounts: document.querySelectorAll('.inv-slot .count').length,
      titles: [...document.querySelectorAll('.inv-slot')].slice(0, 4).map(e => e.title),
    }));
    await page.screenshot({ path: path.join(OUT, 'm4_01_bar_inventory.png') });

    // -- useItem: double-click the consumable (objectId 90002, count 5) -----
    await page.evaluate(() => {
      const slot = document.querySelector('.inv-slot[data-oid="90002"]');
      slot.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useItem')
       && window.__world.net.log.some(m => m.op === 'invUpdate')
       && window.__world.chat.lines.some(l => l.kind === 'sysmsg')`,
      { timeout: 8000 });
    summary.useItem = await page.evaluate(() => ({
      sysmsg: window.__world.chat.lines.filter(l => l.kind === 'sysmsg').slice(-1)[0],
      potionTitle: document.querySelector('.inv-slot[data-oid="90002"]')?.title || 'gone',
    }));

    // -- target the gremlin (screen-space pick), cast skill #1 via key ------
    await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      const c = w.character.group.position;
      w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z);
      w.followCam.pitch = 0.3;
      w.followCam.dist = Math.max(w.followCam.minDist, 4);
    }, GREMLIN);
    await sleep(1500);
    const gp = await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      const V = e.group.position.constructor;
      return w.project(new V(e.group.position.x, e.group.position.y + 0.3, e.group.position.z));
    }, GREMLIN);
    await page.mouse.click(gp.x, gp.y);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'target_ok' && m.id === ${GREMLIN})`,
      { timeout: 8000 });

    // M5: number keys drive the hotbar; the skill palette is click-to-cast
    await page.evaluate(() => document.querySelector('.skill-slot').click());
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'useSkill' && m.skillId === 3)
       && window.__world.net.log.some(m => m.op === 'skillCast' && m.skillId === 3)`,
      { timeout: 8000 });
    await sleep(600);   // mid-cast
    summary.cast = await page.evaluate(() => ({
      castBarVisible: document.getElementById('cast-bar').classList.contains('visible'),
      castName: document.getElementById('cast-name').textContent,
      castFillWidth: document.getElementById('cast-fill').style.width,
      slotCooling: document.querySelector('.skill-slot').classList.contains('cooling'),
    }));
    await page.screenshot({ path: path.join(OUT, 'm4_02_casting.png') });

    // skillLaunch -> flash + slot unlocks
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillLaunch' && m.skillId === 3)`,
      { timeout: 8000 });
    await sleep(150);
    summary.launch = await page.evaluate(() => ({
      slotCooling: document.querySelector('.skill-slot').classList.contains('cooling'),
      fx: window.__world.skillBar ? undefined : undefined,
    }));
    await page.screenshot({ path: path.join(OUT, 'm4_03_launch_flash.png') });

    // -- kill the gremlin, then loot the corpse ------------------------------
    await page.keyboard.press('F1');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'die' && m.id === ${GREMLIN})`, { timeout: 40000 });
    await sleep(800);
    await page.keyboard.press('KeyF');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'invUpdate'
         && m.updated && m.updated.some(u => u.change === 'add'))`,
      { timeout: 8000 });
    await sleep(400);
    summary.loot = await page.evaluate(() => ({
      toasts: [...document.querySelectorAll('.loot-toast')].map(e => e.textContent),
      slots: document.querySelectorAll('.inv-slot').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'm4_04_loot.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY SKILLS FAILED:', e.message); process.exit(1); });
