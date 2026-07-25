// Heading-convention probe with server-side truth:
//   O = B's view of A (server position, from addPlayer/move ops)
//   T = A's requested moveTo target (A's own out-log)
//   expected heading = atan2(T.y-O.y, T.x-O.x) per aCis MathUtil
//   observed = heading C reads from A's addPlayer after A settles
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
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  return { browser, page, tag };
}
const ev = (c, fn, ...a) => c.page.evaluate(fn, ...a);
const netLog = c => ev(c, () => window.__world.net.log);

(async () => {
  const A = await launch('A');
  const B = await launch('B');
  const aName = (await netLog(A)).find(m => m.op === 'enterWorld').char.name;
  await B.page.waitForFunction(
    `window.__world.entities.snapshot().some(e => e.kind === 'player')`, { timeout: 30000 });

  // walk A a short diagonal in the open; move away from the spawn first so
  // server/client positions agree (both fresh from enterWorld)
  const O3 = await ev(B, (name) => {
    const e = window.__world.entities.snapshot().find(x => x.name === name);
    return e && e.pos;
  }, aName);
  const O = { x: Math.round(O3[0] * 100), y: Math.round(-O3[2] * 100) };

  await ev(A, () => {
    const w = window.__world;
    const V = w.character.group.position.constructor;
    const p = w.character.group.position;
    w.walkTo(new V(p.x + 6, p.y, p.z - 3));   // L2 (+600, +300)
  });
  await A.page.waitForFunction('window.__world.character.speed > 0', { timeout: 60000 });
  await A.page.waitForFunction('window.__world.character.speed === 0', { timeout: 120000 });
  const T = (await netLog(A)).filter(m => m.op === 'moveTo').slice(-1)[0];
  await sleep(3000);

  const C = await launch('C');
  await C.page.waitForFunction(
    `window.__world.entities.snapshot().some(e => e.kind === 'player')`, { timeout: 30000 });
  const addA = (await netLog(C)).find(m => m.op === 'addPlayer' && m.name === aName);

  const dx = T.x - O.x, dy = T.y - O.y;
  const K = 65536 / (2 * Math.PI);
  const norm = h => ((Math.round(h) % 65536) + 65536) % 65536;
  const diff = (a, b) => Math.min((a - b + 65536) % 65536, (b - a + 65536) % 65536);
  const obs = addA.heading;
  console.log(JSON.stringify({
    serverOrigin: O, requestedTarget: { x: T.x, y: T.y }, vector: { dx, dy },
    observedHeading: obs,
    atan2_dy_dx: norm(Math.atan2(dy, dx) * K), diff1: diff(norm(Math.atan2(dy, dx) * K), obs),
    atan2_negdy_dx: norm(Math.atan2(-dy, dx) * K), diff2: diff(norm(Math.atan2(-dy, dx) * K), obs),
  }, null, 1));
  await A.browser.close(); await B.browser.close(); await C.browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
