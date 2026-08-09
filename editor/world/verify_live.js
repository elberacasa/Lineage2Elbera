// LIVE end-to-end verification: world client (8083) against the REAL stack
// (aCis :2106/:7777 + gateway :8090). Two independent headless Chrome
// instances (separate profiles -> separate deviceIds -> separate accounts):
//
//   1. both go online via the real toggle -> enterWorld at TI village
//      (tile 17_25); NPC stream arrives with server-resolved names
//   2. each sees the other's addPlayer (name + nearby position)
//   3. A click-walks a long leg -> B watches A's model interpolate
//   4. chat both ways through the real UI (Enter -> type -> Enter)
//   5. near-simultaneous screenshots from BOTH browsers
//   6. heading probe: A's ACTUAL displacement vector (L2) vs the heading a
//      third fresh client C reads from A's addPlayer after A stops
//
// Note: headless swiftshader renders the NPC-dense village at low fps, so
// all movement waits are condition-based, not wall-clock-based.
//
// Usage: node verify_live.js
// Output: verify_shots/live_*.png + verify_shots/live_summary.json (+ stdout)
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(tag) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(tag + ': ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.net.connected && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  return { browser, page, errors, tag };
}

const ev = (c, fn, ...args) => c.page.evaluate(fn, ...args);
const phase = msg => console.error(`[phase ${new Date().toISOString()}] ${msg}`);
const enterChar = c => ev(c, () =>
  window.__world.net.log.find(m => m.op === 'enterWorld').char);
const netLog = c => ev(c, () => window.__world.net.log);
const entities = c => ev(c, () => window.__world.entities.snapshot());
const selfPosL2 = c => ev(c, () => {
  const p = window.__world.character.group.position;
  return { x: Math.round(p.x * 100), y: Math.round(-p.z * 100), z: Math.round(p.y * 100) };
});

async function sayViaUI(c, text) {
  await c.page.keyboard.press('Enter');
  await sleep(250);
  await c.page.type('#chat-input', text);
  await c.page.keyboard.press('Enter');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = {};
  const clients = [];
  try {
    // -- 1. both online ----------------------------------------------------
    phase('launching A');
    const A = await launch('A');
    clients.push(A);
    phase('launching B');
    const B = await launch('B');
    clients.push(B);

    summary.A = { char: await enterChar(A) };
    summary.B = { char: await enterChar(B) };
    summary.A.status = await ev(A, () => document.getElementById('status').textContent);
    summary.B.status = await ev(B, () => document.getElementById('status').textContent);

    phase('both entered; npc wait');
    await sleep(5000); // let the NpcInfo flood land
    const entsA0 = await entities(A);
    summary.A.npcCount = entsA0.filter(e => e.kind === 'npc').length;
    summary.A.npcNamesSample = entsA0.filter(e => e.kind === 'npc').slice(0, 12).map(e => e.name);
    summary.A.addPlayerOps = (await netLog(A)).filter(m => m.op === 'addPlayer')
      .map(m => ({ name: m.name, race: m.race, classId: m.classId, heading: m.heading }));
    await A.page.screenshot({ path: path.join(OUT, 'live_01_A_ti_village.png') });

    // -- 2. mutual addPlayer -------------------------------------------------
    await A.page.waitForFunction(
      `window.__world.entities.snapshot().some(e => e.kind === 'player')`, { timeout: 30000 });
    await B.page.waitForFunction(
      `window.__world.entities.snapshot().some(e => e.kind === 'player')`, { timeout: 30000 });
    const aSees = (await entities(A)).filter(e => e.kind === 'player');
    const bSees = (await entities(B)).filter(e => e.kind === 'player');
    summary.mutual = {
      aCharName: summary.A.char.name, bCharName: summary.B.char.name,
      aSees: aSees.map(e => ({ name: e.name, pos: e.pos })),
      bSees: bSees.map(e => ({ name: e.name, pos: e.pos })),
      nameMatchAB: aSees.some(e => e.name === summary.B.char.name),
      nameMatchBA: bSees.some(e => e.name === summary.A.char.name),
    };

    // -- 3. chat both ways (close range: aCis ChatAll radius = 1250) (retry-tolerant: live say relay flaked in some
    // runs after long server-stuck walks; each retry uses fresh text) ------
    phase('chat A->B');
    summary.chat = { attempts: [] };
    for (let attempt = 1; attempt <= 3 && !summary.chat.pingOk; attempt++) {
      const text = `ping from A #${attempt}`;
      await sayViaUI(A, text);
      try {
        await B.page.waitForFunction(
          `window.__world.chat.lines.some(l => l.kind === 'chat' && l.text === '${text}')`,
          { timeout: 15000 });
        summary.chat.pingOk = true;
      } catch { summary.chat.attempts.push(`ping #${attempt} not relayed in 15s`); }
    }
    phase('chat B->A');
    for (let attempt = 1; attempt <= 3 && !summary.chat.pongOk; attempt++) {
      const text = `pong from B #${attempt}`;
      await sayViaUI(B, text);
      try {
        await A.page.waitForFunction(
          `window.__world.chat.lines.some(l => l.kind === 'chat' && l.text === '${text}')`,
          { timeout: 15000 });
        summary.chat.pongOk = true;
      } catch { summary.chat.attempts.push(`pong #${attempt} not relayed in 15s`); }
    }
    summary.chat.aLines = await ev(A, () => window.__world.chat.lines.slice(-4));
    summary.chat.bLines = await ev(B, () => window.__world.chat.lines.slice(-4));
    summary.chat.bInOpsTail = (await netLog(B)).filter(m => m.dir === 'in').slice(-6);

    // -- 4. A walks a long leg; B watches A interpolate ----------------------
    const findAonB = async () => (await entities(B))
      .find(e => e.name === summary.A.char.name);
    const aL2Before = await selfPosL2(A);
    const bBefore = await findAonB();
    phase('A click-walk');
    await A.page.mouse.click(1000, 260);      // off-axis far point: diagonal walk leg
    await sleep(500);
    summary.walk = { moveToSent: (await netLog(A)).filter(m => m.op === 'moveTo').slice(-1)[0] };

    // condition-based: A's own model signals arrival (server-stuck walks
    // would otherwise stall the phase); B's samples are collected alongside
    const samples = [bBefore.pos];
    let aMoving = true;
    for (let i = 0; i < 90 && aMoving; i++) {
      await sleep(700);
      aMoving = await ev(A, () => window.__world.character.speed > 0);
      const e = await findAonB();
      if (e) samples.push(e.pos);
    }
    const aL2After = await selfPosL2(A);
    const last = samples[samples.length - 1];
    const distinct = new Set(samples.map(p => p.map(v => v.toFixed(1)).join(','))).size;
    summary.walk.aDisplacementL2 = {
      dx: aL2After.x - aL2Before.x, dy: aL2After.y - aL2Before.y,
      dz: aL2After.z - aL2Before.z,
    };
    summary.walk.bObserved = {
      from: bBefore.pos, to: last,
      distance: Math.hypot(last[0] - bBefore.pos[0], last[2] - bBefore.pos[2]),
      samples: samples.length, distinctPositions: distinct,
    };
    summary.walk.interpolated =
      summary.walk.bObserved.distance > 2 && distinct >= 5;

    // -- 5. staged near-simultaneous screenshots ----------------------------
    // B walks deterministically to 2 m short of A (walkTo = click path
    // minus the raycast), so both stand in the open; then shoot both.
    phase('staging: B walks to A');
    const aTrue = await selfPosL2(A);
    await ev(B, (a) => {
      const w = window.__world;
      const V = w.character.group.position.constructor;
      const from = w.character.group.position.clone();
      const target = new V(a.x * 0.01, from.y, -a.y * 0.01);
      const dir = from.clone().sub(target); dir.y = 0;
      target.add(dir.normalize().multiplyScalar(2));   // stop 2 m short of A
      w.walkTo(target);
    }, aTrue);
    // headless frame throttling can delay the first walking frame: first
    // wait for the walk to START, then for arrival
    await B.page.waitForFunction(
      'window.__world.character.speed > 0', { timeout: 60000 });
    await B.page.waitForFunction(
      'window.__world.character.speed === 0', { timeout: 180000 });
    // let A's view of B finish interpolating (headless fps is low)
    await sleep(4000);
    summary.staged = {
      aSeesB: (await entities(A)).find(e => e.name === summary.B.char.name),
      bSeesA: (await entities(B)).find(e => e.name === summary.A.char.name),
      aSelf: await selfPosL2(A), bSelf: await selfPosL2(B),
    };
    await B.page.screenshot({ path: path.join(OUT, 'live_02_B_view.png') });
    await sleep(300);
    await A.page.screenshot({ path: path.join(OUT, 'live_03_A_view.png') });

    // -- 6. heading probe: A walks a short straight diagonal in the open;
    // C (fresh client) reads A's settled heading from addPlayer ------------
    phase('heading probe: A diagonal walk');
    const hBefore = await selfPosL2(A);
    await ev(A, () => {
      const w = window.__world;
      const V = w.character.group.position.constructor;
      const p = w.character.group.position;
      // L2 (+600, +300) -> three (+6, -3): a clean diagonal in the open
      w.walkTo(new V(p.x + 6, p.y, p.z - 3));
    });
    await A.page.waitForFunction(
      'window.__world.character.speed > 0', { timeout: 60000 });
    await A.page.waitForFunction(
      'window.__world.character.speed === 0', { timeout: 120000 });
    const hAfter = await selfPosL2(A);
    await sleep(2500);
    phase('heading probe: launch C');
    const C = await launch('C');
    clients.push(C);
    await C.page.waitForFunction(
      `window.__world.entities.snapshot().some(e => e.kind === 'player')`, { timeout: 30000 });
    const addA = (await netLog(C))
      .find(m => m.op === 'addPlayer' && m.name === summary.A.char.name);
    if (addA) {
      const dx = hAfter.x - hBefore.x, dy = hAfter.y - hBefore.y;
      const K = 65536 / (2 * Math.PI);
      const norm = h => ((Math.round(h) % 65536) + 65536) % 65536;
      const obs = addA.heading;
      const cands = {
        'atan2(dx,dy)': norm(Math.atan2(dx, dy) * K),
        'atan2(dy,dx)': norm(Math.atan2(dy, dx) * K),
        'atan2(-dx,dy)': norm(Math.atan2(-dx, dy) * K),
        'atan2(dx,-dy)': norm(Math.atan2(dx, -dy) * K),
        'atan2(-dy,dx)': norm(Math.atan2(-dy, dx) * K),
        'atan2(dy,-dx)': norm(Math.atan2(dy, -dx) * K),
      };
      const diff = (a, b) => Math.min((a - b + 65536) % 65536, (b - a + 65536) % 65536);
      const ranked = Object.entries(cands).map(([k, v]) => [k, v, diff(v, obs)])
        .sort((x, y) => x[2] - y[2]);
      summary.heading = {
        displacement: { dx, dy }, observed: obs,
        candidates: cands, bestMatch: ranked[0], runnerUp: ranked[1],
      };
    }

    summary.A.errors = A.errors;
    summary.B.errors = B.errors;
    summary.C = { errors: C.errors };
  } catch (e) {
    summary.failure = e.message;
    // capture A's outgoing ops to distinguish client vs gateway failure
    try {
      summary.debugOutOps = (await netLog(clients[0]))
        .filter(m => m.dir === 'out');
    } catch {}
  } finally {
    for (const c of clients) await c.browser.close().catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, 'live_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failure) process.exit(1);
})().catch(e => { console.error('VERIFY LIVE FAILED:', e.stack || e.message); process.exit(1); });
