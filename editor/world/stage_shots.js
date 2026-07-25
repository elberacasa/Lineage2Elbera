// Final staged screenshots v3: meet in the open gremlin field SE of the
// lighthouse, then aim each follow-camera sideways at the pair so both
// characters are framed in both browsers. Cameras are set analytically
// (followCam.yaw) and verified by projecting both chars to screen coords.
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = __dirname + '/verify_shots';
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
const ev = (c, fn, ...a) => c.page.evaluate(fn, ...a);
const posL2 = c => ev(c, () => {
  const p = window.__world.character.group.position;
  return { x: Math.round(p.x * 100), y: Math.round(-p.z * 100) };
});
const walkToL2 = (c, x, y) => ev(c, ({ x, y }) => {
  const w = window.__world;
  const V = w.character.group.position.constructor;
  const p = w.character.group.position;
  w.walkTo(new V(x * 0.01, p.y, -y * 0.01));
}, { x, y });
const waitArrived = async (c) => {
  await c.page.waitForFunction('window.__world.character.speed > 0', { timeout: 60000 });
  await c.page.waitForFunction('window.__world.character.speed === 0', { timeout: 240000 });
};

// aim this client's camera so own char + other char are side by side:
// camera sits perpendicular to the line between them, looking at own char
const aimSideways = (c, otherName) => ev(c, (other) => {
  const w = window.__world;
  const e = w.entities.snapshot().find(x => x.name === other);
  if (!e) return 'no-entity';
  const own = w.character.group.position;
  // midpoint, and the perpendicular of (other - own) in three-space XZ
  const dx = e.pos[0] - own.x, dz = e.pos[2] - own.z;
  // camera direction (from camera to own char) = perpendicular
  w.followCam.yaw = Math.atan2(dz, -dx);   // rotate 90 deg from the A-B axis
  w.followCam.pitch = 0.28;
  w.followCam.dist = 6;
  return 'ok';
}, otherName);

(async () => {
  const A = await launch('A');
  const B = await launch('B');
  const aName = await ev(A, () =>
    window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
  const bName = await ev(B, () =>
    window.__world.net.log.find(m => m.op === 'enterWorld').char.name);
  await sleep(3000);

  // open field SE of spawn (gremlin area, no structures)
  const a0 = await posL2(A);
  const meet = { x: a0.x + 300, y: a0.y + 900 };
  await walkToL2(A, meet.x, meet.y);
  await waitArrived(A);
  await walkToL2(B, meet.x - 250, meet.y);      // B stands 2.5 m west of A
  await waitArrived(B);
  const a1 = await posL2(A), b1 = await posL2(B);
  console.log('A at', a1, ' B at', b1,
    ' dist', (Math.hypot(a1.x - b1.x, a1.y - b1.y) / 100).toFixed(2), 'm');

  await sleep(4000);   // let remote views settle
  console.log('aim A:', await aimSideways(A, bName));
  console.log('aim B:', await aimSideways(B, aName));
  await sleep(5000);   // let cameras lerp into place (throttled frames)

  // verify framing: both characters project inside the viewport. B's view
  // of A can lag, so search yaw candidates and keep the one that frames
  // both characters (wider dist for margin).
  const framed = async (c, other) => ev(c, (o) => {
    const w = window.__world;
    const V = w.character.group.position.constructor;
    const e = w.entities.snapshot().find(x => x.name === o);
    const own = w.character.group.position.clone(); own.y += 1.2;
    const p1 = w.project(own);
    const p2 = e && w.project(new V(e.pos[0], e.pos[1] + 1.2, e.pos[2]));
    const inside = p => p && !p.behind && p.x > 0 && p.x < 1280 && p.y > 0 && p.y < 900;
    // reject collinear framing (remote char hidden behind own char)
    const ok = inside(p1) && inside(p2) && Math.abs(p2.x - p1.x) > 60;
    return { own: p1, other: p2, ok };
  }, other);
  for (const [c, other] of [[A, bName], [B, aName]]) {
    await ev(c, () => {
      const f = window.__world.followCam;
      f.dist = 22;
      f.pitch = 1.1;       // near top-down: no wall can occlude the pair
    });
    const base = await ev(c, () => window.__world.followCam.yaw);
    let f;
    for (const off of [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, 0, Math.PI]) {
      await ev(c, ({ b, o }) => { window.__world.followCam.yaw = b + o; },
        { b: base, o: off });
      await sleep(3000);
      f = await framed(c, other);
      if (f.ok) break;
    }
    console.log(c.tag, 'framing:', JSON.stringify(f));
  }

  await B.page.screenshot({ path: OUT + '/live_04_B_final.png' });
  await sleep(300);
  await A.page.screenshot({ path: OUT + '/live_05_A_final.png' });
  await A.browser.close(); await B.browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
