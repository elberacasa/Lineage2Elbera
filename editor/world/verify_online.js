// Headless verification for M2 online mode (world client on 8083,
// mock gateway on 8085). Drives the REAL UI:
//   1. toggle Online on -> login -> enterWorld at tile 17_24 spawn
//   2. entities spawn (3 NPC placeholders + 3 players), labels visible
//   3. walker "Cora" interpolates between server move targets
//   4. click-walk sends moveTo and server echo reconciles local player
//   5. chat: Enter opens input, say is echoed by the mock, log renders
//   6. toggle Online off -> entities cleared, solo click-walk still works
//
// Usage: node verify_online.js
// Output: verify_shots/m2_*.png + JSON summary on stdout.
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

    // -- 1. go online via the real toggle --------------------------------
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.connected && window.__world.net.selfId', { timeout: 15000 });
    await page.waitForFunction(
      'window.__world.entities.snapshot().length >= 6', { timeout: 15000 });
    await sleep(2000); // models load, camera settles

    const entState = () => page.evaluate(() => ({
      selfId: window.__world.net.selfId,
      selfPos: window.__world.character.group.position.toArray(),
      tile: document.getElementById('scene-picker').value,
      status: document.getElementById('status').textContent,
      entities: window.__world.entities.snapshot(),
    }));
    summary.online = await entState();
    await page.screenshot({ path: path.join(OUT, 'm2_01_online_spawn.png') });

    // zoom out to frame the whole group for the labels shot
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(640, 450);
      await page.mouse.wheel({ deltaY: 240 });
    }
    await sleep(1000);
    await page.screenshot({ path: path.join(OUT, 'm2_02_entities_labels.png') });

    // -- 2. walker interpolation: sample Cora's position twice -----------
    const walkerPos = () => page.evaluate(() => {
      const w = window.__world.entities.snapshot().find(e => e.name === 'Cora');
      return w ? w.pos : null;
    });
    const w1 = await walkerPos();
    await sleep(3000);
    const w2 = await walkerPos();
    summary.walker = {
      from: w1, to: w2,
      moved: w1 && w2 ? Math.hypot(w2[0] - w1[0], w2[2] - w1[2]) : 0,
    };
    await page.screenshot({ path: path.join(OUT, 'm2_03_walker_moved.png') });

    // -- 3. click-walk -> moveTo -> server echo reconcile -----------------
    const before = await page.evaluate(
      () => window.__world.character.group.position.toArray());
    await page.mouse.click(500, 420);
    await sleep(700);
    const mid = await page.evaluate(() => ({
      pos: window.__world.character.group.position.toArray(),
      speed: window.__world.character.speed,
    }));
    summary.clickWalk = {
      before, mid,
      moving: mid.speed > 0,
      dist: Math.hypot(mid.pos[0] - before[0], mid.pos[2] - before[2]),
    };

    // -- 4. chat: Enter to type, mock echoes the say ----------------------
    await page.keyboard.press('Enter');
    await sleep(300);
    await page.type('#chat-input', 'hello from headless');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      `window.__world.chat.lines.some(l => l.kind === 'chat' && l.text === 'hello from headless')`,
      { timeout: 8000 });
    summary.chat = await page.evaluate(() => window.__world.chat.lines.slice(-6));
    await page.screenshot({ path: path.join(OUT, 'm2_04_chat.png') });

    // -- 5. back to solo: entities gone, click-walk still works -----------
    await page.click('#online-toggle');
    await sleep(500);
    summary.solo = await page.evaluate(() => ({
      online: window.__world.net.online,
      connected: window.__world.net.connected,
      entities: window.__world.entities.snapshot().length,
    }));
    const soloBefore = await page.evaluate(
      () => window.__world.character.group.position.toArray());
    await page.mouse.click(700, 500);
    await sleep(1200);
    const soloAfter = await page.evaluate(() => ({
      pos: window.__world.character.group.position.toArray(),
      speed: window.__world.character.speed,
    }));
    summary.soloClickWalk = {
      moved: Math.hypot(soloAfter.pos[0] - soloBefore[0], soloAfter.pos[2] - soloBefore[2]),
      speedSeen: soloAfter.speed,
    };
    await page.screenshot({ path: path.join(OUT, 'm2_05_solo_again.png') });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
