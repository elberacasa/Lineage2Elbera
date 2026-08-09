// Ground-drop mesh verification.
//
// The claim under test: a ground drop draws the mesh the CLIENT names for that
// item, and where it cannot, it says why on the entity rather than silently
// showing a placeholder.
//
//   A  the binding table is the client's own.  Adena (57) must resolve to
//      DropItems.coin_m00 / DropItemsTex.coin_t00 — the exact row in
//      etcitemgrp.dat — and a Small Sword (1) to
//      LineageWeapons.small_sword_m00_wp from weapongrp.dat.
//   B  a weapon drop renders a REAL mesh and retires the placeholder.  All
//      180 of those glTFs were already on disk for the equip path; this proves
//      the join, not a new extraction.
//   C  NO SILENT PLACEHOLDER.  Every drop that did not get a mesh carries a
//      `dropMeshGap` string naming the package and the reason.
//   D  tools/dat/export_dropmesh.py --check passes (the table is not stale and
//      coverage has not shrunk).
//
// Usage:
//   node editor/world/verify_dropmesh.js
//   node editor/world/verify_dropmesh.js --check
//
// Needs the dev server on 8083 and a mock gateway on 8085.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = path.join(__dirname, '..', '..');
// MOCK_WS lets a manual run use a private mock while tools/battery.sh
// holds 8085 for its own sweep.
const WS = process.env.MOCK_WS || 'ws://127.0.0.1:8085';
const BASE = `http://127.0.0.1:8083/?ws=${WS}&cc=0`;
const OUT = path.join(__dirname, 'verify_shots');
const CHECK = process.argv.includes('--check');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function gate(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = { consoleLogs: [] };
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.log.some(m => m.op === "enterWorld")', { timeout: 30000 });
    await sleep(2000);

    // -------------------------------------------------------------- gate A
    const rows = await page.evaluate(async () => {
      const d = window.__drops;
      const doc = await d.table();
      return {
        loaded: !!doc,
        adena: d.dropRecord(doc, 57),
        sword: d.dropRecord(doc, 1),
        items: doc ? Object.keys(doc.items).length : 0,
      };
    });
    gate('A binding table is the client\'s own',
      rows.loaded
      && rows.adena && rows.adena.pkg === 'dropitems'
      && rows.adena.obj === 'coin_m00'
      && rows.adena.textures[0] === 'dropitemstex.coin_t00'
      && rows.sword && rows.sword.pkg === 'lineageweapons'
      && rows.sword.obj === 'small_sword_m00_wp',
      `${rows.items} item ids; 57 -> ${rows.adena && rows.adena.pkg}.`
      + `${rows.adena && rows.adena.obj}, 1 -> ${rows.sword && rows.sword.pkg}.`
      + `${rows.sword && rows.sword.obj}`);

    // -------------------------------------------------------------- stage
    // Drops laid in front of the camera: three weapons whose meshes ARE built
    // and one Adena, whose DropItems prop is not.
    await page.evaluate(() => {
      const w = window.__world;
      const m = w.camera.matrixWorld.elements;
      let fx = -m[8], fz = -m[10];
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const rx = -fz, rz = fx;
      const p = w.character.group.position;
      const L2 = 0.01;
      let id = 920000;
      const put = (itemId, dist, side, count) => {
        const x = p.x + fx * dist + rx * side, z = p.z + fz * dist + rz * side;
        w.net.inject({
          op: 'addDrop', id: id++, itemId, count,
          x: Math.round(x / L2), y: Math.round(-z / L2), z: Math.round(p.y / L2),
        });
      };
      put(1, 1.6, -0.9, 1);      // Small Sword
      put(2, 1.9, 0.0, 1);       // Long Sword
      put(4, 1.6, 0.9, 1);       // Club
      put(57, 2.6, 0.0, 46);     // Adena
    });
    await sleep(3000);
    await page.evaluate(() => window.__drops.tick());
    await sleep(1500);

    const report = await page.evaluate(() => window.__drops.report());
    summary.report = report;

    // -------------------------------------------------------------- gate B
    const weapons = report.filter(r => [1, 2, 4].includes(r.itemId));
    const meshed = weapons.filter(r => r.mesh && !r.placeholderVisible);
    gate('B weapon drops render their own mesh',
      weapons.length === 3 && meshed.length === 3,
      `${meshed.length}/${weapons.length} weapon drops swapped the placeholder `
      + `for the item's LineageWeapons glTF`);

    // -------------------------------------------------------------- gate C
    const fallbacks = report.filter(r => !r.mesh);
    const silent = fallbacks.filter(r => !r.gap);
    gate('C no silent placeholder',
      fallbacks.length > 0 && silent.length === 0,
      `${fallbacks.length} drops fell back, ${silent.length} without a reason; `
      + `e.g. ${JSON.stringify((fallbacks[0] || {}).gap)}`);

    await page.screenshot({ path: path.join(OUT, 'dropmesh.png') });
  } finally {
    await browser.close();
  }

  // ---------------------------------------------------------------- gate D
  let tool = '';
  let toolOk = false;
  try {
    tool = execFileSync('python3', [path.join(REPO, 'tools/dat/export_dropmesh.py'),
      '--check'], { cwd: REPO, encoding: 'utf8' });
    toolOk = /CHECK PASS/.test(tool);
  } catch (e) {
    tool = String((e.stdout || '') + (e.message || '')).slice(-400);
  }
  gate('D export_dropmesh.py --check', toolOk,
    tool.trim().split('\n').slice(-2).join(' | '));

  summary.gates = results;
  fs.writeFileSync(path.join(OUT, 'dropmesh.json'), JSON.stringify(summary, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
  if (CHECK) {
    console.log('CHECK', failed.length ? 'FAIL' : 'PASS');
    process.exit(failed.length ? 1 : 0);
  }
})();
