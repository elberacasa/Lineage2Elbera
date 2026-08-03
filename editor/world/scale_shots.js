// Scale-comparison + retail-feel screenshots (M3 task 1 & 2).
//   shot A: gremlin (monster model) standing next to the human char,
//           side-on camera, both projected in-frame before shooting
//   shot B: human next to a lighthouse door frame on 17_25 (props scale)
//   shot C: retail-feel framing at TI village gate (FOV 35 chase cam)
// Usage: node scale_shots.js   (mock gateway on 8085 for shot A)
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = __dirname + '/verify_shots';
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
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  return { browser, page };
}

(async () => {
  // -- shot A: gremlin vs human (mock gateway) ------------------------------
  {
    const { browser, page } = await launch('http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0');
    await page.click('#online-toggle');
    await page.waitForFunction('window.__world.entities.snapshot().length >= 6', { timeout: 20000 });
    await page.waitForFunction('!!window.__world.entities.getEntity(70001).mixer', { timeout: 30000 });
    // walk next to the gremlin
    await page.evaluate(() => {
      const w = window.__world;
      const g = w.entities.getEntity(70001);
      const V = w.character.group.position.constructor;
      const t = g.group.position.clone();
      const c = w.character.group.position;
      const dir = new V(c.x - t.x, 0, c.z - t.z).normalize();
      t.add(dir.multiplyScalar(1.3));
      w.walkTo(t);
    });
    await page.waitForFunction('window.__world.character.speed > 0', { timeout: 60000 });
    await page.waitForFunction('window.__world.character.speed === 0', { timeout: 120000 });
    await sleep(1000);
    await page.evaluate(() => {
      const w = window.__world;
      const g = w.entities.getEntity(70001);
      const c = w.character.group.position;
      const dx = g.group.position.x - c.x, dz = g.group.position.z - c.z;
      w.followCam.yaw = Math.atan2(dz, -dx);   // side-on
      w.followCam.pitch = 0.12;                // near eye level for scale reading
      w.followCam.dist = 8;
    });
    await sleep(3000);
    const framing = await page.evaluate(() => {
      const w = window.__world;
      const g = w.entities.getEntity(70001);
      const V = g.group.position.constructor;
      const p1 = w.project(new V(w.character.group.position.x,
        w.character.group.position.y + 0.9, w.character.group.position.z));
      const p2 = w.project(new V(g.group.position.x,
        g.group.position.y + 0.4, g.group.position.z));
      return { char: p1, gremlin: p2 };
    });
    console.log('A framing:', JSON.stringify(framing));
    await page.screenshot({ path: OUT + '/m3_scale_gremlin_human.png' });
    await browser.close();
  }

  // -- shot B + C: 17_25 door + retail framing (solo) ------------------------
  {
    const { browser, page } = await launch('http://127.0.0.1:8083/');
    await page.select('#scene-picker', '17_25');
    await page.waitForFunction(
      `document.getElementById('status').textContent.includes('scene: 17_25')
       && document.getElementById('loading').classList.contains('hidden')`, { timeout: 240000 });
    // walk to the lighthouse door area (spawn vicinity): the door frame
    // arch seen in earlier shots is ~10 m north of the tile spawn center
    const door = await page.evaluate(() => {
      const w = window.__world;
      const V = w.character.group.position.constructor;
      const c = w.character.group.position;
      // head north-ish toward the lighthouse gate structure
      w.walkTo(new V(c.x - 6, c.y, c.z + 6));
      return true;
    });
    await page.waitForFunction('window.__world.character.speed > 0', { timeout: 60000 });
    await page.waitForFunction('window.__world.character.speed === 0', { timeout: 120000 });
    await sleep(1000);
    // eye-level side camera for the door proportion read
    await page.evaluate(() => {
      const w = window.__world;
      w.followCam.pitch = 0.12;
      w.followCam.dist = 7;
    });
    await sleep(2500);
    await page.screenshot({ path: OUT + '/m3_scale_door.png' });

    // retail-feel framing: default chase cam, character lower-center
    await page.evaluate(() => {
      const w = window.__world;
      w.followCam.pitch = 0.35;
      w.followCam.dist = 14;
      w.followCam.yaw += 0.6;
    });
    await sleep(2500);
    await page.screenshot({ path: OUT + '/m3_retail_framing.png' });
    await browser.close();
  }
  console.log('shots done');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
