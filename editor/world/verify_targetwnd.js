// TargetStatusWnd verification: con-color cases against TWO self-spawned
// mock gateways — level-1 char (ws :8085) vs seeded level-40 char
// (MOCK_LEVEL=40, ws :8086). Checks: name color per con table, HP bar
// tracks status ops, MP hidden for monsters, close button hides display
// only (server target stays), WndMgr movable.
// Output: verify_shots/tw_*.png + JSON summary.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'verify_shots');
const GREMLIN = 70001;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// This suite used to hard-code 8085 and 8086 — the SAME ports tools/battery.sh
// starts its shared mocks on. Under the battery, both spawns died with a
// silent EADDRINUSE (stdio was 'ignore', and mock_gateway has no 'error'
// listener so the process just exits), the browser then connected to the
// battery's level-1 mock, and the level40 phase measured a level-1 viewer.
// Ports are now leased from the OS, so the suite is runnable standalone at
// any time and never collides with anything.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

// Spawn the mock and PROVE it is listening before handing the port to the
// browser; a mock that failed to bind used to be indistinguishable from one
// that bound, which is exactly how the level40 phase went silently wrong.
async function startMock(port, level) {
  const env = { ...process.env };
  if (level) env.MOCK_LEVEL = String(level);
  const proc = spawn('node', [path.join(__dirname, 'mock_gateway.js'), String(port)], {
    env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });
  let dead = false;
  proc.on('exit', (code) => { dead = true; proc.exitCode_ = code; });
  for (let i = 0; i < 60; i++) {
    if (dead) {
      throw new Error(`mock_gateway on :${port} exited (${proc.exitCode_}): `
        + stderr.trim().split('\n').slice(0, 3).join(' / '));
    }
    if (await canConnect(port)) return proc;
    await sleep(100);
  }
  proc.kill();
  throw new Error(`mock_gateway on :${port} never started listening`);
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

// Point the follow camera at the entity, let it stop, and hand back a
// projection that is actually ON SCREEN. The old code aimed once, settled
// once, and then reused that aim for the SECOND click: by then the follow
// camera had converged back toward the character's own heading and the
// gremlin had drifted off the right edge (measured: x=640 for the first
// click, x=1369 on a 1280-wide viewport for the second). The click landed
// nowhere, the target was dropped, and the wait for 'attack' timed out.
async function aimAt(page, id, viewport) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate((eid) => {
      const w = window.__world;
      const e = w.entities.getEntity(eid);
      const c = w.character.group.position;
      w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z);
      w.followCam.pitch = 0.3;
      w.followCam.dist = Math.max(w.followCam.minDist, 4);
    }, id);
    await sleep(600);
    await settleCam(page);
    const p = await projectEntity(page, id);
    const margin = 24;
    if (!p.behind && p.x > margin && p.x < viewport.width - margin
        && p.y > margin && p.y < viewport.height - margin) return p;
  }
  throw new Error(`aimAt(${id}): entity never projected on screen`);
}

// Labelled wait: an unlabelled "Waiting failed: 10000ms exceeded" gives the
// next reader nothing to work with.
async function waitFor(page, expr, label, timeout = 10000) {
  try {
    await page.waitForFunction(expr, { timeout });
  } catch (err) {
    const ops = await page.evaluate(() =>
      window.__world.net.log.slice(-15).map(m => `${m.dir || ''}:${m.op}${m.id ? '#' + m.id : ''}`))
      .catch(() => []);
    throw new Error(`${label} (${err.message}); last ops: ${ops.join(' ')}`);
  }
}

async function run(mode, port) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { consoleLogs: [] };
  const viewport = { width: 1280, height: 900 };
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(`http://127.0.0.1:8083/?ws=ws://127.0.0.1:${port}&cc=0`,
      { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await waitFor(page, 'window.__world.entities.snapshot().length >= 6',
      `${mode}: the mock never spawned 6 entities`, 20000);
    await sleep(1500);

    const gp = await aimAt(page, GREMLIN, viewport);
    await page.mouse.click(gp.x, gp.y);
    await waitFor(page,
      `window.__world.net.log.some(m => m.op === 'target_ok' && m.id === ${GREMLIN})`,
      `${mode}: first click did not target the gremlin`);
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

    // HP bar tracks status ops. A second click on an ALREADY-targeted monster
    // is the attack (main.js clickEntity, the `combat.targetId === id` branch),
    // so re-aim from scratch: the follow camera has been converging back to
    // the character's heading since the first click.
    const gp2 = await aimAt(page, GREMLIN, viewport);
    await page.mouse.click(gp2.x, gp2.y);
    await waitFor(page,
      `window.__world.net.log.filter(m => m.op === 'attack').length >= 2`,
      `${mode}: second click on the targeted gremlin produced no attack`);
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// conColor, transcribed from js/ui/targetstatuswnd.js:42-51 (which cites
// ui-port-handoff.md §4). diff = viewerLevel - targetLevel, the sign the
// gateway sends in target_ok.color.
const conColor = (d) => d == null ? '#DCDCDC'
  : d <= -9 ? '#FF0000' : d <= -6 ? '#FF9191' : d <= -3 ? '#FAFE91'
  : d <= 2 ? '#DCDCDC' : d <= 5 ? '#A2FFAB' : d <= 8 ? '#A2A8FC' : '#0000FF';

function assertPhase(mode, s) {
  const w = s.window;
  check(`${mode}: target window visible`, w.visible);
  check(`${mode}: name is the clicked NPC`, w.name === 'Gremlin', String(w.name));
  check(`${mode}: diff = viewerLevel - targetLevel`,
    w.diff === w.viewerLevel - w.npcLevel,
    `diff=${w.diff} viewer=${w.viewerLevel} npc=${w.npcLevel}`);
  check(`${mode}: name color is the con-table color for that diff`,
    w.color === conColor(w.diff), `${w.color} vs ${conColor(w.diff)} (diff ${w.diff})`);
  check(`${mode}: HP bar shown, MP hidden for a monster`, w.hpVisible && !w.mpVisible,
    `hp=${w.hpVisible} mp=${w.mpVisible}`);
  check(`${mode}: HP bar tracks status ops`,
    s.hpTrack.hp < s.hpTrack.maxHp && /%$/.test(s.hpTrack.width),
    `${s.hpTrack.hp}/${s.hpTrack.maxHp} width=${s.hpTrack.width}`);
  check(`${mode}: close hides the window but keeps the server target`,
    s.close.display === 'none' && s.close.targetStill === GREMLIN,
    JSON.stringify(s.close));
  check(`${mode}: window is movable (WndMgr)`, s.movable.moved,
    `${s.movable.from} -> ${s.movable.to}`);
  const errs = s.consoleLogs.filter(l => l.startsWith('PAGEERROR:'));
  check(`${mode}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const out = { ports: {} };
  const p1 = await freePort();
  out.ports.level1 = p1;
  const mock1 = await startMock(p1, null);
  try {
    out.level1 = await run('level1', p1);
  } finally {
    mock1.kill();
  }
  const p40 = await freePort();
  out.ports.level40 = p40;
  const mock40 = await startMock(p40, 40);
  try {
    out.level40 = await run('level40', p40);
  } finally {
    mock40.kill();
  }

  assertPhase('level1', out.level1);
  assertPhase('level40', out.level40);
  // The whole point of the two phases: MOCK_LEVEL must actually reach the
  // client, and the higher-level viewer must recolor the same Gremlin.
  check('level40 mock seeded a level-40 viewer',
    out.level40.window.viewerLevel === 40, String(out.level40.window.viewerLevel));
  check('the two phases disagree on the con color',
    out.level1.window.color !== out.level40.window.color,
    `${out.level1.window.color} vs ${out.level40.window.color}`);

  out.results = results;
  const failed = results.filter(r => !r.ok);
  console.log(JSON.stringify(out, null, 2));
  console.log(`verify_targetwnd: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error('VERIFY TARGET FAILED: ' + failed.map(f => f.name).join('; '));
    process.exit(1);
  }
})().catch(e => { console.error('VERIFY TARGET FAILED:', e.stack || e.message); process.exit(1); });
