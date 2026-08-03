// Character/NPC world-scale verification (before/after nativeHeight fix).
//   shot A (mock gateway 8085, cc=0): player next to Elias (civilian model,
//           nativeHeight 43 -> 0.43 m) — reports heightM for player + NPCs
//   shot B (solo, 17_25): player next to the lighthouse door frame
//           (H_Door_* = 0.82 m in-world) — eye-level camera for the read
// Expected after fix: player heightM = 0.46 (human_fighter_m native 46.0).
// Usage: node verify_scale.js <tag>   -> verify_shots/scale_<tag>_*.png+json
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'run';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(url) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready',
    { timeout: 60000 });
  return { browser, page };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = { tag: TAG };

  // -- shot A: player vs Elias the civilian (mock gateway) -------------------
  {
    const { browser, page } = await launch(
      'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0');
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.entities.snapshot().length >= 8', { timeout: 20000 });
    await page.waitForFunction(
      '!!window.__world.entities.getEntity(70004).mixer', { timeout: 30000 });
    // walk next to Elias
    await page.evaluate(() => {
      const w = window.__world;
      const e = w.entities.getEntity(70004);
      const V = w.character.group.position.constructor;
      const t = e.group.position.clone();
      const c = w.character.group.position;
      const dir = new V(c.x - t.x, 0, c.z - t.z).normalize();
      t.add(dir.multiplyScalar(0.6));
      w.walkTo(t);
    });
    await page.waitForFunction('window.__world.character.speed > 0',
      { timeout: 60000 });
    await page.waitForFunction('window.__world.character.speed === 0',
      { timeout: 120000 });
    await sleep(1000);
    // side-on, eye-level camera for the proportion read
    await page.evaluate(() => {
      const w = window.__world;
      const e = w.entities.getEntity(70004);
      const c = w.character.group.position;
      const dx = e.group.position.x - c.x, dz = e.group.position.z - c.z;
      w.followCam.yaw = Math.atan2(dz, -dx);   // side-on
      w.followCam.pitch = 0.12;
      w.followCam.dist = Math.max(w.followCam.minDist, 3.5 * w.character.heightM);
    });
    await sleep(2500);
    summary.mock = await page.evaluate(() => ({
      charHeightM: window.__world.character.heightM,
      entities: window.__world.entities.snapshot()
        .map(e => ({ id: e.id, npcId: e.npcId, name: e.name,
                     hasModel: e.hasModel, heightM: e.heightM })),
    }));
    await page.screenshot({ path: `${OUT}/scale_${TAG}_npc.png` });
    await browser.close();
  }

  // -- shot B: player vs 17_25 lighthouse door (solo) -------------------------
  {
    const { browser, page } = await launch('http://127.0.0.1:8083/');
    await page.select('#scene-picker', '17_25');
    await page.waitForFunction(
      `document.getElementById('status').textContent.includes('scene: 17_25')
       && document.getElementById('loading').classList.contains('hidden')`,
      { timeout: 240000 });
    await page.evaluate(() => {
      const w = window.__world;
      const V = w.character.group.position.constructor;
      const c = w.character.group.position;
      w.walkTo(new V(c.x - 6, c.y, c.z + 6));   // toward the lighthouse gate
    });
    await page.waitForFunction('window.__world.character.speed > 0',
      { timeout: 60000 });
    await page.waitForFunction('window.__world.character.speed === 0',
      { timeout: 120000 });
    await sleep(1000);
    await page.evaluate(() => {
      const w = window.__world;
      w.followCam.pitch = 0.12;
      w.followCam.dist = Math.max(w.followCam.minDist, 15 * w.character.heightM * 0.47);
    });
    await sleep(2500);
    summary.solo = await page.evaluate(() => ({
      charHeightM: window.__world.character.heightM,
    }));
    await page.screenshot({ path: `${OUT}/scale_${TAG}_door.png` });
    await browser.close();
  }

  fs.writeFileSync(`${OUT}/scale_${TAG}.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY SCALE FAILED:', e.message); process.exit(1); });
