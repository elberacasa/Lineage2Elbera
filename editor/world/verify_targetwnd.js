// TargetStatusWnd verification: con-color cases against TWO self-spawned
// mock gateways — level-1 char (ws :8085) vs seeded level-40 char
// (MOCK_LEVEL=40, ws :8086). Checks: name color per con table, HP bar
// tracks status ops, MP hidden for monsters, close button hides display
// only (server target stays), WndMgr movable.
// Output: verify_shots/tw_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'verify_shots');
const GREMLIN = 70001;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startMock(port, level) {
  const env = { ...process.env };
  if (level) env.MOCK_LEVEL = String(level);
  const proc = spawn('node', [path.join(__dirname, 'mock_gateway.js'), String(port)], {
    env, stdio: 'ignore',
  });
  return proc;
}

// The follow camera converges FRAME-RATE-dependently; under battery load
// it is still swinging when a stale projection would be used (>40px pick
// radius -> the click hits terrain). Wait until it stops moving, then
// always click a FRESH projection.
async function settleCam(page) {
  let last = null;
  for (let i = 0; i < 30; i++) {
    const p = await page.evaluate(() => {
      const c = window.__world.camera.position;
      return [c.x, c.y, c.z];
    });
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.005) return;
    last = p;
    await sleep(150);
  }
}

function projectEntity(page, id) {
  return page.evaluate((eid) => {
    const w = window.__world;
    const e = w.entities.getEntity(eid);
    const V = e.group.position.constructor;
    return w.project(new V(e.group.position.x, e.group.position.y + 0.3, e.group.position.z));
  }, id);
}

async function run(mode, port) {
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

    await page.goto(`http://127.0.0.1:8083/?ws=ws://127.0.0.1:${port}&cc=0`,
      { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.entities.snapshot().length >= 6', { timeout: 20000 });
    await sleep(1500);

    await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      const c = w.character.group.position;
      w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z);
      w.followCam.pitch = 0.3;
      w.followCam.dist = Math.max(w.followCam.minDist, 4);
    }, GREMLIN);
    await sleep(1500);
    await settleCam(page);
    const gp = await projectEntity(page, GREMLIN);
    await page.mouse.click(gp.x, gp.y);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'target_ok' && m.id === ${GREMLIN})`,
      { timeout: 10000 });
    await sleep(600);

    summary.window = await page.evaluate(() => {
      const tw = window.__world.targetWnd;
      return {
        visible: tw.root.style.display !== 'none',
        name: tw.target && tw.target.name,
        diff: tw.target && tw.target.color,
        color: tw.target && (function () {
          const d = tw.target.color;
          return d <= -9 ? '#FF0000' : d <= -6 ? '#FF9191' : d <= -3 ? '#FAFE91'
            : d <= 2 ? '#DCDCDC' : d <= 5 ? '#A2FFAB' : d <= 8 ? '#A2A8FC' : '#0000FF';
        })(),
        hpVisible: tw.bars.HP.el.style.display !== 'none',
        mpVisible: tw.bars.MP.el.style.display !== 'none',
        hpWidth: tw.bars.HP.fill.style.width,
        npcLevel: window.__world.entities.getEntity(70001).level,
        viewerLevel: window.__world.combat.self && window.__world.combat.self.level,
      };
    });
    await page.screenshot({ path: path.join(OUT, `tw_01_${mode}_target.png`) });

    // HP bar tracks status ops (attack -> hp drops); FRESH projection —
    // the camera may still have been converging for the first click
    const gp2 = await projectEntity(page, GREMLIN);
    await page.mouse.click(gp2.x, gp2.y);
    await page.waitForFunction(
      `window.__world.net.log.filter(m => m.op === 'attack').length >= 2`,
      { timeout: 10000 });
    await sleep(2500);
    summary.hpTrack = await page.evaluate(() => ({
      hp: window.__world.targetWnd.target.hp,
      maxHp: window.__world.targetWnd.target.maxHp,
      width: window.__world.targetWnd.bars.HP.fill.style.width,
    }));
    await page.screenshot({ path: path.join(OUT, `tw_02_${mode}_hptrack.png`) });

    // close button hides the display only (server target stays)
    await page.evaluate(() => {
      const btns = [...window.__world.targetWnd.root.children]
        .filter(e => e.style.cursor === 'pointer');
      btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(300);
    summary.close = await page.evaluate(() => ({
      display: window.__world.targetWnd.root.style.display,
      targetStill: window.__world.combat.targetId,
    }));

    // movable: re-target, then drag the window by its background
    await page.evaluate(() => window.__world.combat.setTarget(
      70001, 'Gremlin', { kind: 'npc', level: 1, color: 0 }));
    await sleep(300);
    const r0 = await page.evaluate(() =>
      window.__world.targetWnd.root.getBoundingClientRect().toJSON());
    await page.mouse.move(r0.x + 60, r0.y + 10);
    await page.mouse.down();
    await page.mouse.move(r0.x + 160, r0.y + 110, { steps: 10 });
    await page.mouse.up();
    await sleep(300);
    const r1 = await page.evaluate(() =>
      window.__world.targetWnd.root.getBoundingClientRect().toJSON());
    summary.movable = { moved: Math.abs(r1.x - r0.x) > 50, from: r0.x, to: r1.x };
    await page.screenshot({ path: path.join(OUT, `tw_03_${mode}_moved.png`) });
  } finally {
    await browser.close();
  }
  return summary;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mock1 = startMock(8085, null);
  await sleep(1000);
  const out = {};
  try {
    out.level1 = await run('level1', 8085);
  } finally {
    mock1.kill();
  }
  const mock40 = startMock(8086, 40);
  await sleep(1000);
  try {
    out.level40 = await run('level40', 8086);
  } finally {
    mock40.kill();
  }
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('VERIFY TARGET FAILED:', e.message); process.exit(1); });
