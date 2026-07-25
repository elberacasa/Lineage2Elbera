// Prop inspection: teleport the character next to real prop clusters in
// 17_23 and screenshot from a few angles, to verify placement, scale,
// and orientation of the 440 StaticMeshActor placements.
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const report = {};
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto('http://127.0.0.1:8083/', { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.select('#scene-picker', '17_23');
    await page.waitForFunction(
      'document.getElementById("status").textContent.includes("scene: 17_23") && document.getElementById("loading").classList.contains("hidden")',
      { timeout: 120000 });
    await sleep(1000);

    report.propStats = await page.evaluate(() => {
      const w = window.__world;
      const ys = w.terrain.props.map(p => p.position.y);
      const onGround = w.terrain.props.filter(p => {
        const g = w.terrain.heightAtWorld(p.position.x, p.position.z);
        return Math.abs(p.position.y - g) < 3;   // within 3 m of surface
      }).length;
      return {
        count: w.terrain.props.length,
        nearSurface: onGround,
        yRange: [Math.min(...ys), Math.max(...ys)],
      };
    });

    // visit three prop clusters: pick props at 25%, 50%, 75% of the list
    const spots = await page.evaluate(() => {
      const ps = window.__world.terrain.props;
      return [0.1, 0.5, 0.9].map(f => {
        const p = ps[Math.floor(ps.length * f)].position;
        return [p.x, p.y, p.z];
      });
    });

    for (let i = 0; i < spots.length; i++) {
      await page.evaluate(([x, y, z]) => {
        const w = window.__world;
        w.character.group.position.set(x, w.terrain.heightAtWorld(x, z), z);
        w.character.clearTarget();
      }, spots[i]);
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, `props_${i}.png`) });
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
})();
