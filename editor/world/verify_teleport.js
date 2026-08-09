// verify_teleport.js — a teleport across a tile boundary must leave the
// character standing ON the ground of the tile it landed on, with that tile's
// textures resolved.
//
// THE DEFECT THIS EXISTS TO KILL, measured 2026-08-09 against the live stack
// (aCis :7777 / ElberaGate :8090 / ElberaClient :8083), owner report:
// "when teleporting it teleports below map to broken textures, i refresh and
// its fine in place."
//
// WHAT WAS MEASURED (repro: GM `admin_teleport 82000 148000` sent as a real
// RequestBypassToServer from the browser client, character starting on 17_25
// at the Talking Island spawn):
//
//   teleport op in           {id, x: 82000, y: 148000, z: -3464}
//                            (-3464 is aCis's OWN GeoEngine answer: the admin
//                             command omits Z and the server computes it)
//   +0.25 s  currentTile 17_25   character three.js y = -46.843
//   +37 s    currentTile 22_22   character three.js y = -46.843   <-- unchanged
//   correct value for that point on 22_22 ................ -34.96
//
//   The character ended 11.88 m — 1188 L2 units — under the drawn ground, on
//   a tile whose own mesh does not reach the point, which is the "below map to
//   broken textures" the owner sees.
//
// THE MECHANISM, in two halves, both measured (scratchpad repro3):
//
//   1. A height query for a point that is NOT on the queried tile does not
//      fail. Terrain._sampleBilinear clamps fx/fy into [0, gridSize-1] and
//      Geodata._layersAt clamps cx/cy into [0, cells-1], so both answer with
//      the tile's EDGE cell. Standing on 17_25, heightRouter.heightAtWorld
//      for the Giran plaza point answered -46.843 — with the server's z
//      (-34.64) passed as the layer hint, and identically with no hint. The
//      teleport handler applied the position and resolved its height BEFORE
//      any scene switch, so that lie became the character's y.
//
//   2. That lie is a FIXED POINT, so the scene switch could not undo it. The
//      crossing re-resolves with loadScene({keepCharPos}), which used the
//      character's own y as the layer hint. From 1188 units below, the
//      walking rule (MAX_STEP_UP = 48 L2 units, geodata.js) sees every layer
//      as a wall, heightAt returns z itself, and anchoredHeightAt maps that
//      back to exactly z. Feeding -46.843 into the router on 22_22 returns
//      -46.843, thirty iterations running.
//
//   A page reload fixes it because the load path is ordered the other way:
//   enterWorld awaits loadScene(destination tile) FIRST and only then resolves
//   the height, against the SERVER's z. Nothing about the teleport path did.
//
// THE FIX (js/main.js placeSelfAtServerPos): never ask a tile about a point it
// does not cover. When nothing loaded covers the point, stand on the server's
// own z and queue the scene switch WITH that z, so the post-load re-resolution
// starts from the server's value instead of a foreign tile's edge.
//
// A SECOND ordering defect, found by the --live gate below on the first run
// after that fix and NOT visible in the client-only cases: loadScene set
// `currentTile = tile` and then `await neighbors.setCenter(...)` — eight more
// tile loads — BEFORE re-grounding the character. Around Giran that window is
// tens of seconds, and for all of it the character stood at the raw server z
// (-34.640 m) instead of the anchored drawn surface (-34.960 m): 0.32 m, one
// geodata-over-drawn-surface band, hovering over the pavement. The character
// block now runs immediately after the center tile is bound, and the neighbour
// window follows it. This is why T1/L3 wait on the #loading overlay coming
// down and not on `currentTile` — see settledOn().
//
// MEASURED, this suite, same machine, same day:
//   pre-fix   6 passed, 6 failed  (T0/T1/T4 green, T2/T3/T5 red on both cases;
//                                  the character sat 43.893 m under 20_13)
//   post-fix  18 passed, 0 failed (client-only + --live)
//
// WHAT THIS SUITE ASSERTS, per (source tile -> destination) case:
//   T0 the case can TRAP: the source tile's clamped answer for the
//      destination point is more than one walker step (MAX_STEP_UP = 48 L2
//      units) BELOW the truth. A pair that agrees, or where the source answers
//      too high, would turn T2/T3/T5 green on a broken client
//   T1 the scene switched to the destination tile
//   T2 the teleport path put the character at the same height the LOAD path
//      does — i.e. what the owner gets after a refresh — within one geodata
//      quantum (GeoStructure.CELL_HEIGHT = 8 L2 units = 0.08 m)
//   T3 the character stands on the DRAWN surface: an independent downward
//      raycast onto the destination tile's terrain mesh and BSP floor, not a
//      second call to the router that placed it
//   T4 the destination tile's terrain textures are resolved (decoded images
//      with non-zero dimensions), not the source tile's or a blank
//   T5 the pre-fix signature is absent: the character's y is NOT the source
//      tile's clamped edge answer for that point
//
// T2/T3/T5 all go red on the pre-fix tree; T1 and T4 pass there (the switch
// did happen and the textures did resolve — the character was simply under
// them), and they are kept because they are what makes T2/T3 meaningful.
// L4 is what caught the second ordering defect described above.
//
// SECTIONS
//   default / --check   client-only. Drives the REAL inbound teleport handler
//                       through window.__world.net.inject (the documented
//                       hook for inbound ops the mock does not implement) with
//                       the z aCis itself reported for the destination.
//                       Needs only ElberaClient :8083.
//   --live              additionally drives a REAL aCis GM teleport end to end
//                       (login -> admin_teleport -> TeleportToLocation 0x28).
//                       Needs aCis + gateway + MariaDB.
//
// Usage:
//   node verify_teleport.js              # run, print the report
//   node verify_teleport.js --check      # exit 1 on any failed gate
//   node verify_teleport.js --check --live
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.CLIENT_URL || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const LIVE = args.includes('--live');
const SHOTS = args.includes('--shots') || LIVE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One geodata height quantum: GeoStructure.CELL_HEIGHT = 8 L2 units. The same
// tolerance verify_feet uses, and for the same reason — below it the source
// data does not resolve a difference.
const TOL_M = 0.08;
// The defect only TRAPS when the wrong height is BELOW the truth by more than
// one walker step: geodata.js MAX_STEP_UP = CELL_HEIGHT*6 = 48 L2 units. Above
// the ground the walking rule descends freely (falling is legitimate) and the
// old code recovered on its own; below it by more than a step, every layer
// reads as a wall, heightAt returns z, and the wrong value is permanent. A
// case whose source tile answers HIGH, or answers low by less than this, would
// pass on the broken client — so T0 requires a real trap, not merely a
// difference. (Measured: the first version of this suite used a pair whose
// source answered 0.273 m HIGH and it passed pre-fix.)
const TRAP_M = 0.48;
// How long one scene load may take.
//
// NOT a tuning knob for correctness — the gates below never depend on a
// timeout expiring. It is sized around a MEASURED and separately-filed
// problem: on this machine a cold tile fetches at ~78 requests/s, but the
// load AFTER a heavy tile collapses to ~1.9 requests/s with the heap pinned
// near 570 MB (measured 2026-08-09, 22_22 -> 17_25: 471 requests in 250 s,
// none failed, no request older than 1 s — it is grinding, not deadlocked;
// that is task #40 and it is NOT the defect this suite is about). The cases
// below were therefore chosen from the LIGHT end of the tile list so the
// suite measures the teleport path rather than the asset pipeline.
const SWITCH_TIMEOUT_MS = 240000;

// The cases. Each one crosses at least one tile boundary, and each one is
// gated on being able to DISCRIMINATE the defect (T0) before anything else is
// asserted about it.
//
// Every `serverZ` is aCis's OWN answer, in L2 units, MEASURED 2026-08-09
// through the real gateway: `admin_teleport X Y` with the Z omitted makes
// AdminTeleport call GeoEngine.getHeight(x, y, player.getZ()) and the
// TeleportToLocation that comes back carries the result.
//     17_24  -81920, 212992  ->  -4656
//     20_13   16384,-147456  ->   -264
//     21_17   49152, -16384  ->  -4600
//     22_22   82000, 148000  ->  -3464   (the Giran plaza; used by --live,
//                                         and the value js/heightfix.js
//                                         documents from the geodata side)
// Each point is the CENTRE sample of its tile — tile (a_b) spans
// x [(a-20)*32768, +32768), y [(b-18)*32768, +32768), which is tileNameFor's
// own arithmetic — except the Giran plaza, which is a named landmark.
//
// All four tiles are OUTDOOR. Interior tiles (19_16, 21_25, 25_21 — scene.json
// `interior`) are deliberately excluded: a dungeon has no heightfield at all,
// Terrain.heightAtWorld answers from the prop-derived floorY, and the drawn
// surface is the level BSP. That is a different contract, and 25_21 was in
// this list for one run and failed T3/T4 for exactly that reason, not because
// of anything the teleport path did.
const CASES = [
  { name: '17_24 -> 20_13',
    src: '17_24', srcL2: [-81920, 212992, -4656],
    dst: '20_13', dstL2: [16384, -147456], serverZ: -264 },
  { name: '21_17 -> 20_13',
    src: '21_17', srcL2: [49152, -16384, -4600],
    dst: '20_13', dstL2: [16384, -147456], serverZ: -264 },
];
const LIVE_CASE = {
  name: 'TI spawn 17_25 -> Giran plaza 22_22',
  src: '17_25', srcL2: [-71338, 258271, -3104],
  dst: '22_22', dstL2: [82000, 148000], serverZ: -3464,
};

let pass = 0; let fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ---------------------------------------------------------------------------
// In-page helpers. Installed once; every gate shares one definition of "the
// drawn surface" and one of "a resolved texture".
// ---------------------------------------------------------------------------
const INSTALL = async () => {
  const THREE = await import('/vendor/three.module.min.js');
  const w = window.__world;
  const H = {};
  H.THREE = THREE;

  // The DRAWN ground under a three.js (x, z): a ray fired straight down from
  // well above the tile onto the terrain mesh AND the level BSP (a town square
  // is a stone slab built over the natural ground — js/heightfix.js hazard 3 —
  // so a terrain-only ray reads the dirt under the pavement). Independent of
  // Terrain.heightAtWorld, which is the function under test.
  H.drawnY = (x, z) => {
    const t = w.terrain;
    if (!t) return null;
    const targets = [t.mesh].filter(Boolean);
    if (t.bsp && t.bsp.group) targets.push(t.bsp.group);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x, 5000, z), new THREE.Vector3(0, -1, 0), 0, 20000);
    const hits = ray.intersectObjects(targets, true);
    return hits.length ? hits[0].point.y : null;
  };

  // "The destination tile's textures are resolved" is two separate claims and
  // this reports both:
  //   baseUrl  the Terrain currently bound was built from THIS tile's assets
  //            (Terrain is rebuilt per tile, so a stale bind shows up here)
  //   n/resolved  its terrain textures carry decoded pixel data. The splat
  //            shader keeps them on the material's userData, not on `map`
  //            (terrain.js _buildMaterial: mat.userData.textures =
  //            [diffuseTex, splatTex], two DataArrayTextures) — reading
  //            `material.map` finds nothing and would pass vacuously.
  H.terrainTextures = () => {
    const t = w.terrain;
    if (!t || !t.mesh) return { baseUrl: null, n: 0, resolved: 0, sizes: [] };
    const mats = Array.isArray(t.mesh.material) ? t.mesh.material : [t.mesh.material];
    const sizes = [];
    let n = 0; let resolved = 0;
    for (const m of mats) {
      if (!m) continue;
      const texs = [
        ...((m.userData && m.userData.textures) || []),
        ...Object.keys(m).map((k) => m[k]).filter((v) => v && v.isTexture),
      ];
      for (const v of texs) {
        n++;
        const img = v.image;
        const wpx = img ? (img.width || 0) : 0;
        const hpx = img ? (img.height || 0) : 0;
        const bytes = img && img.data ? img.data.length : 0;
        if (wpx > 1 && hpx > 1 && bytes > 0) {
          resolved++; sizes.push(`${wpx}x${hpx}x${img.depth || 1}`);
        } else sizes.push(`UNRESOLVED(${wpx}x${hpx},${bytes}B)`);
      }
    }
    return { baseUrl: t.baseUrl || null, n, resolved, sizes };
  };

  window.__tp = H;
  return true;
};

// "The scene switch is finished" is NOT `currentTile === tile`. loadScene sets
// currentTile as soon as the center Terrain is bound and then keeps working;
// the #loading overlay is what it hides on the last line of the try block, so
// that is the completion signal. Reading between the two is how this suite
// first read a character that had not been re-grounded yet.
const settledOn = (tile) => `window.__world.currentTile === ${JSON.stringify(tile)}`
  + ` && document.getElementById('loading').classList.contains('hidden')`;

async function boot(page) {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE + '?dev=1', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready', { timeout: 90000 });
  await page.evaluate(INSTALL);
}

async function loadTile(page, tile) {
  // Fire and forget: loadScene returns a promise, and page.evaluate AWAITS a
  // returned promise inside the CDP call, so `return loadScene(t)` blocks the
  // protocol channel for the whole load and trips protocolTimeout on a heavy
  // tile. The waitForFunction below is the real wait.
  await page.evaluate((t) => { window.__world.loadScene(t); return true; }, tile);
  await page.waitForFunction(settledOn(tile),
    { timeout: SWITCH_TIMEOUT_MS, polling: 250 });
  await sleep(1500);
}

// ---------------------------------------------------------------------------
// The client-only section.
// ---------------------------------------------------------------------------
async function runCase(page, c) {
  const label = c.name;
  const [dx, dy] = c.dstL2;
  const three = { x: dx * 0.01, z: -dy * 0.01 };

  // --- reference: what the LOAD path produces at the destination -----------
  // This is exactly what the owner gets by refreshing: the destination tile is
  // the center tile and the height is resolved against the SERVER's z, which
  // is the enterWorld handler's own formula.
  await loadTile(page, c.dst);
  const ref = await page.evaluate((o) => {
    const w = window.__world;
    const serverY = o.serverZ * 0.01;
    return {
      serverZ: o.serverZ,
      serverY,
      loadPathY: w.heightAt(o.x, o.z, serverY),
      drawnY: window.__tp.drawnY(o.x, o.z),
      tex: window.__tp.terrainTextures(),
    };
  }, { x: three.x, z: three.z, serverZ: c.serverZ });

  if (ref.loadPathY == null || ref.drawnY == null) {
    check(`${label}: destination reference is measurable`, false,
      `loadPathY=${ref.loadPathY} drawnY=${ref.drawnY}`);
    return;
  }
  console.log(`  ${label}`);
  console.log(`    server z ${ref.serverZ} L2 -> ${ref.serverY.toFixed(3)} m; `
    + `load-path y ${ref.loadPathY.toFixed(3)} m; drawn surface ${ref.drawnY.toFixed(3)} m`);

  // --- stand on the SOURCE tile and record its lie about the destination ---
  await loadTile(page, c.src);
  const src = await page.evaluate((o) => {
    const w = window.__world;
    const p = w.character.group.position;
    p.set(o.sx * 0.01, o.sz * 0.01, -o.sy * 0.01);
    p.y = w.heightAt(p.x, p.z, o.sz * 0.01);
    return {
      tile: w.currentTile,
      standY: p.y,
      // what the source tile answers about a point 1.5 tiles away, WITH the
      // server's own z as the hint: the value the old teleport handler used
      edgeLieY: w.heightAt(o.x, o.z, o.serverY),
    };
  }, { sx: c.srcL2[0], sy: c.srcL2[1], sz: c.srcL2[2], x: three.x, z: three.z,
    serverY: ref.serverY });
  const lieErr = src.edgeLieY - ref.loadPathY;
  console.log(`    standing on ${src.tile} at y ${src.standY.toFixed(3)}; `
    + `it answers ${src.edgeLieY.toFixed(3)} m for the destination point `
    + `(off by ${lieErr.toFixed(3)} m)`);

  // T0 — is this case even capable of showing the defect? The old handler
  // resolved the destination height against the SOURCE tile, and that only
  // becomes permanent when the answer sits at least one walker step BELOW the
  // truth (see TRAP_M). Assert the discriminating power instead of assuming
  // it, or T2/T3/T5 could be green on a broken client.
  check(`${label} T0 the case traps (source tile answers >${TRAP_M} m too LOW)`,
    -lieErr > TRAP_M,
    `source answers ${src.edgeLieY.toFixed(3)} m, truth is ${ref.loadPathY.toFixed(3)} m `
    + `(${(-lieErr).toFixed(3)} m too low, needs > ${TRAP_M})`);

  // --- fire the REAL inbound teleport op ----------------------------------
  // net.inject pushes this through the SAME dispatch a websocket frame takes,
  // so js/main.js's `net.on('teleport')` handler runs unmodified. The id is
  // net.selfId, which is null offline; the handler's `msg.id === selfId` is
  // then null === null, so this exercises the SELF branch (the one the defect
  // lives in) and not entities.place. The gates below would go quiet, not
  // green, if that ever stopped being true: T1 needs a scene switch and only
  // the self branch can cause one.
  await page.evaluate((o) => {
    const w = window.__world;
    w.net.inject({ op: 'teleport', id: w.net.selfId, x: o.l2x, y: o.l2y, z: o.serverZ });
  }, { l2x: dx, l2y: dy, serverZ: ref.serverZ });

  // T1 — the scene switched
  let switched = true;
  try {
    await page.waitForFunction(settledOn(c.dst),
      { timeout: SWITCH_TIMEOUT_MS, polling: 250 });
  } catch { switched = false; }
  await sleep(1500);
  check(`${label} T1 scene switched to ${c.dst}`, switched,
    switched ? '' : `still on ${await page.evaluate(() => window.__world.currentTile)}`);
  if (!switched) return;

  const after = await page.evaluate((o) => {
    const w = window.__world;
    const p = w.character.group.position;
    return {
      tile: w.currentTile,
      y: p.y, x: p.x, z: p.z,
      drawnY: window.__tp.drawnY(p.x, p.z),
      tex: window.__tp.terrainTextures(),
    };
  }, {});

  const dLoad = after.y - ref.loadPathY;
  const dDrawn = after.drawnY == null ? null : after.y - after.drawnY;
  const dLie = after.y - src.edgeLieY;
  console.log(`    after teleport: tile ${after.tile} y ${after.y.toFixed(3)} m `
    + `(load-path ${dLoad >= 0 ? '+' : ''}${dLoad.toFixed(3)} m, `
    + `drawn ${dDrawn == null ? 'n/a' : (dDrawn >= 0 ? '+' : '') + dDrawn.toFixed(3) + ' m'})`);

  check(`${label} T2 teleport height == load-path height`, Math.abs(dLoad) <= TOL_M,
    `${after.y.toFixed(3)} vs ${ref.loadPathY.toFixed(3)} m (delta ${dLoad.toFixed(3)} m, `
    + `tol ${TOL_M})`);
  check(`${label} T3 standing on the drawn surface`,
    dDrawn != null && Math.abs(dDrawn) <= TOL_M,
    dDrawn == null ? 'no ray hit under the character'
      : `${after.y.toFixed(3)} vs drawn ${after.drawnY.toFixed(3)} m (delta ${dDrawn.toFixed(3)} m)`);
  check(`${label} T4 destination tile textures resolved`,
    after.tex.n > 0 && after.tex.resolved === after.tex.n
      && String(after.tex.baseUrl || '').includes(`/${c.dst}/`),
    `${after.tex.resolved}/${after.tex.n} [${after.tex.sizes.join(' ')}] `
    + `from ${after.tex.baseUrl}`);
  check(`${label} T5 not the source tile's clamped edge answer`,
    Math.abs(dLie) > TOL_M,
    `edge lie was ${src.edgeLieY.toFixed(3)} m, character is at ${after.y.toFixed(3)} m`);

  if (SHOTS) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({
      path: path.join(OUT, `teleport_${c.src}_to_${c.dst}.png`) });
  }
}

// ---------------------------------------------------------------------------
// The live section: a REAL aCis GM teleport, end to end.
// ---------------------------------------------------------------------------
async function runLive(browser) {
  const fixture = require('./live_fixture');
  const DEVICE_ID = 'verify-teleport-fixture-1';
  const c = LIVE_CASE;
  const { charName, charId } = await fixture.ensureChar(DEVICE_ID);
  const online = fixture.sql(`SELECT online FROM characters WHERE obj_Id=${charId}`);
  if (online !== '0') {
    check('live: fixture character is offline before the run', false, `online=${online}`);
    return;
  }
  // GM access is what makes admin_teleport a REAL server teleport instead of a
  // client-side simulation. Dropped back to 0 in the finally below — NOT to
  // "whatever it was", which is what this did first and which cheerfully
  // preserved a level 7 an earlier aborted run had left behind. This fixture
  // is created by live_fixture as an ordinary Human Fighter and nothing else
  // has any business making it a GM, so 0 is the correct resting state and
  // "restore what you found" would just launder a leak.
  fixture.sql(`UPDATE characters SET accesslevel=7 WHERE obj_Id=${charId}`);
  // Start from the source tile every run, so the teleport really crosses.
  fixture.sql(`UPDATE characters SET x=${c.srcL2[0]}, y=${c.srcL2[1]}, z=${c.srcL2[2]} `
    + `WHERE obj_Id=${charId}`);
  console.log(`  live fixture ${charName} (${charId}) reset to `
    + `${c.srcL2.join('/')} with accesslevel 7`);

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await fixture.seed(page, DEVICE_ID);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 90000 });
    await page.evaluate(INSTALL);
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.log.some(m => m.op === "enterWorld")', { timeout: 180000 });
    await page.waitForFunction(settledOn(c.src),
      { timeout: SWITCH_TIMEOUT_MS, polling: 250 });
    await sleep(2500);

    const before = await page.evaluate(() => ({
      tile: window.__world.currentTile,
      y: window.__world.character.group.position.y,
    }));
    check('live L0 logged in on the source tile', before.tile === c.src,
      `tile=${before.tile} y=${before.y.toFixed(3)}`);

    // RequestBypassToServer("admin_teleport X Y") — Z omitted on purpose, so
    // aCis AdminTeleport asks its OWN GeoEngine for the height and the z that
    // comes back on TeleportToLocation is the server's ground truth.
    await page.evaluate((o) => {
      window.__world.net.sendOp('bypass', { command: `admin_teleport ${o.x} ${o.y}` });
    }, { x: c.dstL2[0], y: c.dstL2[1] });

    let got = true;
    try {
      await page.waitForFunction(
        'window.__world.net.log.some(m => m.op === "teleport" && m.id === window.__world.net.selfId)',
        { timeout: 60000, polling: 200 });
    } catch { got = false; }
    check('live L1 aCis sent TeleportToLocation', got);
    if (!got) return;

    const op = await page.evaluate(() => window.__world.net.log
      .filter((m) => m.op === 'teleport' && m.id === window.__world.net.selfId).pop());
    console.log(`    server teleport op: x=${op.x} y=${op.y} z=${op.z}`);
    check('live L2 the server z is the documented GeoEngine answer', op.z === c.serverZ,
      `server sent z=${op.z}, this suite's recorded value is ${c.serverZ}`);

    let switched = true;
    try {
      await page.waitForFunction(settledOn(c.dst),
        { timeout: SWITCH_TIMEOUT_MS, polling: 250 });
    } catch { switched = false; }
    await sleep(2500);
    check(`live L3 scene switched to ${c.dst}`, switched);
    if (!switched) return;

    const after = await page.evaluate(() => {
      const w = window.__world;
      const p = w.character.group.position;
      return {
        y: p.y, x: p.x, z: p.z,
        drawnY: window.__tp.drawnY(p.x, p.z),
        loadPathY: w.heightAt(p.x, p.z, null),
        tex: window.__tp.terrainTextures(),
      };
    });
    const dDrawn = after.drawnY == null ? null : after.y - after.drawnY;
    console.log(`    after the real teleport: y ${after.y.toFixed(3)} m, `
      + `drawn ${after.drawnY == null ? 'n/a' : after.drawnY.toFixed(3)} m, `
      + `server z ${(op.z * 0.01).toFixed(3)} m`);
    check('live L4 standing on the drawn surface',
      dDrawn != null && Math.abs(dDrawn) <= TOL_M,
      dDrawn == null ? 'no ray hit' : `delta ${dDrawn.toFixed(3)} m (tol ${TOL_M})`);
    check('live L5 destination tile textures resolved',
      after.tex.n > 0 && after.tex.resolved === after.tex.n
        && String(after.tex.baseUrl || '').includes(`/${c.dst}/`),
      `${after.tex.resolved}/${after.tex.n} from ${after.tex.baseUrl}`);
    if (SHOTS) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, 'teleport_live.png') });
    }
  } finally {
    await page.close().catch(() => {});
    fixture.sql(`UPDATE characters SET accesslevel=0 WHERE obj_Id=${charId}`);
  }
}

// ---------------------------------------------------------------------------
const launch = () => puppeteer.launch({
  executablePath: CHROME,
  args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  // A cold tile load is minutes of asset fetching under swiftshader; the
  // default 180 s protocol timeout kills the CDP channel mid-run.
  protocolTimeout: 900000,
});

(async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await boot(page);
    for (const c of CASES) await runCase(page, c);
  } finally {
    await browser.close();
  }
  if (LIVE) {
    // A SECOND browser, deliberately: the client-only section leaves several
    // tiles' worth of decoded assets in the heap, and the load after a heavy
    // tile is the ~40x slowdown noted at SWITCH_TIMEOUT_MS. The live section
    // starts from a cold process so what it measures is the teleport path.
    const live = await launch();
    try { await runLive(live); } finally { await live.close(); }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  // A gate that evaluates zero assertions is a failure, not a pass.
  const expected = CASES.length * 6 + (LIVE ? 6 : 0);
  if (results.length < expected) {
    console.log(`FAIL  vacuity guard — ${results.length} assertions ran, expected ${expected}`);
    process.exit(1);
  }
  if (CHECK && fail) process.exit(1);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
