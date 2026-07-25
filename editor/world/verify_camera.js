// Camera scale verification (true-scale characters). For human_fighter_m
// (0.46 m) and dwarf_m (0.34 m): screenshots at min / default / max zoom
// + measured on-screen character height fraction. Min zoom must fill
// ~half the frame; framing must be consistent across races.
// Output: verify_shots/cam_<char>_{min,default,max}.png + JSON.
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = __dirname + '/verify_shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto('http://127.0.0.1:8083/', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await sleep(1000);

  const summary = {};
  const measure = () => page.evaluate(() => {
    const w = window.__world;
    const V = w.character.group.position.constructor;
    const feet = w.project(new V().copy(w.character.group.position));
    const head = w.project(new V().copy(w.character.group.position)
      .add(new V(0, w.character.heightM, 0)));
    return {
      heightM: +w.character.heightM.toFixed(3),
      dist: +w.followCam.dist.toFixed(3),
      minDist: +w.followCam.minDist.toFixed(3),
      maxDist: +w.followCam.maxDist.toFixed(3),
      frameFraction: +(((feet.y - head.y) / 900)).toFixed(3),
      feetInFrame: !feet.behind && feet.x > 0 && feet.x < 1280 && feet.y > 0 && feet.y < 900,
      headInFrame: !head.behind && head.x > 0 && head.x < 1280 && head.y > 0 && head.y < 900,
    };
  });

  for (const charId of ['human_fighter_m', 'dwarf_m']) {
    await page.select('#char-picker', charId);
    await page.waitForFunction(
      `document.getElementById('status').textContent.includes('${charId}')
       && document.getElementById('loading').classList.contains('hidden')`,
      { timeout: 60000 });
    await sleep(1500);
    summary[charId] = {};

    // default
    summary[charId].default = await measure();
    await page.screenshot({ path: `${OUT}/cam_${charId}_default.png` });

    // min zoom (close-up)
    for (let i = 0; i < 20; i++) { await page.mouse.move(640, 450); await page.mouse.wheel({ deltaY: -200 }); }
    await sleep(1500);
    summary[charId].min = await measure();
    await page.screenshot({ path: `${OUT}/cam_${charId}_min.png` });

    // max zoom
    for (let i = 0; i < 40; i++) { await page.mouse.move(640, 450); await page.mouse.wheel({ deltaY: 200 }); }
    await sleep(1500);
    summary[charId].max = await measure();
    await page.screenshot({ path: `${OUT}/cam_${charId}_max.png` });

    // back to default for the next character
    for (let i = 0; i < 40; i++) { await page.mouse.move(640, 450); await page.mouse.wheel({ deltaY: -200 }); }
    await page.mouse.move(640, 450);
    await sleep(500);
  }
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
