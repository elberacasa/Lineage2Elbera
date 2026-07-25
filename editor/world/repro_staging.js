// Minimal repro: two live clients; B walkTo A; trace B's local movement
// state + incoming ops each second to find what stops the local model.
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(tag) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => console.log(tag, 'PAGEERROR:', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  return { browser, page, tag };
}

const state = (c, n) => c.page.evaluate((nOps) => {
  const w = window.__world;
  const p = w.character.group.position;
  return {
    pos: [p.x, p.z].map(v => +v.toFixed(2)),
    speed: w.character.speed,
    target: w.character.target ? [w.character.target.x, w.character.target.z]
      .map(v => +v.toFixed(2)) : null,
    selfId: w.net.selfId,
    inOps: w.net.log.filter(m => m.dir === 'in').slice(-nOps)
      .map(m => m.op + (m.id ? ':' + m.id : '')),
  };
}, n);

(async () => {
  const A = await launch('A');
  const B = await launch('B');
  await sleep(4000);
  const aPos = await A.page.evaluate(() => {
    const p = window.__world.character.group.position;
    return { x: Math.round(p.x * 100), y: Math.round(-p.z * 100) };
  });
  console.log('A at L2', aPos);

  await B.page.evaluate((a) => {
    const w = window.__world;
    const V = w.character.group.position.constructor;
    const from = w.character.group.position.clone();
    const target = new V(a.x * 0.01, from.y, -a.y * 0.01);
    const dir = from.clone().sub(target); dir.y = 0;
    target.add(dir.normalize().multiplyScalar(2));
    w.walkTo(target);
  }, aPos);

  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    console.log('B', i, JSON.stringify(await state(B, 3)));
  }
  await A.browser.close();
  await B.browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
