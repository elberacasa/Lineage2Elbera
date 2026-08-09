// Nameplate verification — the retail draw model, asserted.
//
// What this proves, and why each gate is the right assertion:
//
//   A  FIXED SCREEN SIZE.  Two entities carrying the SAME name at two
//      different distances must produce two plates of the IDENTICAL pixel
//      size.  This is the whole defect: the old labels.js built a
//      world-space THREE.Sprite scaled by `0.0055 * worldScale`, so the near
//      plate was several times the far one.  Engine.dll draws names through
//      ?DrawTargetName@UCanvas@@ — a UCanvas (screen-space) method whose only
//      size argument is an L2FontType selector — so retail cannot scale with
//      distance.  See js/nameplates.js for the full evidence chain.
//
//   B  NO WORLD-SPACE LABEL SPRITE survives in the scene graph.  This is the
//      tripwire that fails loudly on the pre-fix tree even if someone kept
//      the DOM layer working alongside the sprites.
//
//   C  THE ALT GATE.  Ground-drop names appear only while Alt is held; NPC
//      names are unaffected by Alt.  AUTHORED behaviour — see the note in
//      nameplates.js: it is NOT recoverable from this client (Engine.dll is
//      Themida-packed and the string is in no .u/.ini/.xdat/.dat).
//
//   D  THE DRAW DISTANCE.  l2.ini [CharacterDisplay] Dist=1000 L2 units.  An
//      entity past that distance from the player draws no name; one inside it
//      does.  SOURCED.
//
//   E  THE GLYPHS.  A plate is the client's own bitmap font (a <canvas> blit
//      out of SmallFont-e), not browser text.
//
//   F  THE UNSOURCED BUDGET.  tools/audit/unsourced.py must report no more
//      client-ui UNSOURCED literals than the recorded ceiling.
//
// Usage:
//   node editor/world/verify_nameplates.js            report + screenshots
//   node editor/world/verify_nameplates.js --check    exit 1 on any failure
//
// Needs the dev server on 8083 and the mock gateway on 8085 (the same pair
// every other mock-section suite in tools/battery.sh uses).

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

// The ceiling gate F holds the line at. The client-ui domain stood at 24
// before this wave (chat.js 15 + labels.js 9) and is now empty; the number may
// only go DOWN, so the ratchet is set at zero.
const CLIENT_UI_UNSOURCED_MAX = 0;

const results = [];
function gate(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.log.some(m => m.op === "enterWorld")', { timeout: 30000 });
    await sleep(2500);

    // ---------------------------------------------------------------- stage
    // A crowded scene, laid out ALONG THE CAMERA'S OWN FORWARD AXIS so every
    // plate is on screen and the distances are exactly what we asked for.
    // Distances are in metres = L2 units x coords.js L2_TO_M.
    // The camera basis comes straight out of its matrixWorld, so the page
    // needs no THREE import to point the stage down the view axis.
    const stage = await page.evaluate((distances) => {
      const w = window.__world;
      const m = w.camera.matrixWorld.elements;
      // -Z column of the camera basis is the view direction, flattened to the
      // ground plane so an entity lands at the requested horizontal range.
      let fx = -m[8], fz = -m[10];
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      const p = w.character.group.position;
      const L2 = 0.01;                          // coords.js L2_TO_M
      const toL2 = (x, y, z) => ({
        x: Math.round(x / L2), y: Math.round(-z / L2), z: Math.round(y / L2),
      });
      const spawn = (op, id, dist, extra) => {
        const c = toL2(p.x + fx * dist, p.y, p.z + fz * dist);
        w.net.inject(Object.assign({ op, id, x: c.x, y: c.y, z: c.z, heading: 0 }, extra));
        return { id, dist };
      };
      const out = { npcs: [], drops: [] };
      // Three NPCs carrying the SAME name — a name the mock never uses, so
      // the plates can be told apart from the fixture's own gremlins. Two are
      // inside the draw distance (gate A compares their pixel size), one is
      // past it (gate D).
      out.npcs.push(spawn('addNpc', 900101, distances.near,
        { npcId: 20001, name: 'Probe', level: 1 }));
      out.npcs.push(spawn('addNpc', 900102, distances.far,
        { npcId: 20001, name: 'Probe', level: 1 }));
      out.npcs.push(spawn('addNpc', 900103, distances.beyond,
        { npcId: 20001, name: 'Probe', level: 1 }));
      // Ground drops, well inside the cut.
      out.drops.push(spawn('addDrop', 900201, distances.dropA,
        { itemId: 57, count: 46 }));
      out.drops.push(spawn('addDrop', 900202, distances.dropB,
        { itemId: 57, count: 3 }));
      return out;
    }, { near: 3, far: 8, beyond: 16, dropA: 2.2, dropB: 4 });

    await sleep(1800);

    const read = () => page.evaluate(() => {
      const w = window.__world;
      // No screen-space layer at all is the PRE-FIX state, and it must be
      // reported as failing gates rather than as a crashed suite.
      const np = window.__nameplates || {
        tick() {}, altHeld: false, distL2: null, distM: null, font: null,
        count: 0, shown: 0, missing: true,
      };
      np.tick();
      const plates = [...document.querySelectorAll('#nameplates .nameplate')]
        .map(el => {
          const r = el.getBoundingClientRect();
          const cv = el.querySelector('canvas');
          return {
            text: el.__l2text || null,
            display: el.style.display,
            w: Math.round(r.width * 100) / 100,
            h: Math.round(r.height * 100) / 100,
            canvas: !!cv,
            cssW: cv ? cv.style.width : null,
          };
        });
      // A world-space label sprite is a THREE.Sprite whose material map is a
      // canvas texture — exactly what the old makeLabel built.
      let spriteLabels = 0;
      w.scene.traverse(o => {
        if (o.isSprite && o.material && o.material.map
            && o.material.map.image instanceof HTMLCanvasElement) spriteLabels++;
      });
      // Prove the staging itself: how far each probe actually ended up from
      // the player, so gate A cannot pass on two entities at the same range.
      const p = w.character.group.position;
      const probes = {};
      for (const id of [900101, 900102, 900103]) {
        const e = w.entities.entities.get(id);
        if (!e) continue;
        const q = e.group.position;
        probes[id] = Math.round(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) * 100) / 100;
      }
      return {
        plates, spriteLabels, probes,
        alt: np.altHeld, distL2: np.distL2, distM: np.distM, font: np.font,
        anchors: np.count, shown: np.shown,
      };
    });

    // ------------------------------------------------------------- gate B
    let s = await read();
    gate('B world-space label sprites removed', s.spriteLabels === 0,
      `sprites with a canvas map in the scene: ${s.spriteLabels} (want 0)`);

    // ------------------------------------------------------------- gate A
    const probes = s.plates.filter(p => p.text && p.text.startsWith('Probe|')
      && p.display !== 'none');
    const sizes = [...new Set(probes.map(p => `${p.w}x${p.h}`))];
    const d = s.probes || {};
    const spread = d['900101'] != null && d['900102'] != null
      && Math.abs(d['900102'] - d['900101']) > 3;
    gate('A fixed screen size', probes.length === 2 && sizes.length === 1 && spread,
      `probe ranges (m) ${JSON.stringify(d)}; ${probes.length} plates drawn, `
      + `distinct sizes ${JSON.stringify(sizes)} (want 2 plates, 1 size, `
      + `>3 m apart)`);

    // ------------------------------------------------------------- gate D
    // The third probe sits past Dist=1000 L2 units (10 m), so exactly two of
    // the three identical NPCs may draw a name.
    gate('D draw distance l2.ini [CharacterDisplay] Dist',
      probes.length === 2 && s.distL2 === 1000
      && d['900103'] > s.distM && d['900102'] < s.distM,
      `Dist=${s.distL2} L2 units = ${s.distM} m; probe ranges `
      + `${JSON.stringify(d)}; plates drawn: ${probes.length} (want 2)`);

    // ------------------------------------------------------------- gate C
    const dropsOff = s.plates.filter(p => p.text && /^Adena/.test(p.text)
      && p.display !== 'none').length;
    await page.screenshot({ path: path.join(OUT, 'nameplates_alt_up.png') });

    await page.keyboard.down('Alt');
    await sleep(250);
    const sAlt = await read();
    const dropsOn = sAlt.plates.filter(p => p.text && /^Adena/.test(p.text)
      && p.display !== 'none').length;
    const npcsOn = sAlt.plates.filter(p => p.text && p.text.startsWith('Probe|')
      && p.display !== 'none').length;
    await page.screenshot({ path: path.join(OUT, 'nameplates_alt_held.png') });
    await page.keyboard.up('Alt');

    gate('C Alt gate on ground-drop names',
      dropsOff === 0 && dropsOn === 2 && npcsOn === probes.length,
      `drop plates: ${dropsOff} with Alt up, ${dropsOn} with Alt held; `
      + `NPC plates unchanged at ${npcsOn}`);

    // ------------------------------------------------------------- gate E
    // Only DRAWN plates carry glyphs: a hidden one is never composited, which
    // is the point of doing the blit lazily.
    const drawn = sAlt.plates.filter(p => p.display !== 'none');
    const withCanvas = drawn.filter(p => p.canvas).length;
    gate('E plates use the client bitmap font',
      drawn.length > 0 && withCanvas === drawn.length && sAlt.font === 'small',
      `${withCanvas}/${drawn.length} drawn plates are a Font.canvas blit `
      + `(font "${sAlt.font}"), ${sAlt.plates.length} plates total`);

    // ------------------------------------------------------------- gate G
    // INVERTED 2026-08-09. This gate used to require the OPPOSITE: that two
    // NPCs at the same range but 40 levels apart take two DIFFERENT rungs of
    // native_colors.json ladders.conColor. It passed, and it was asserting a
    // defect — the owner's "names on top of npcs in retail arent red".
    //
    // The ladder is decoded correctly but belongs to the TARGET WINDOW, not to
    // a floating plate. ?execGetTargetNameColor@UUIDATA_TARGET@@ has exactly
    // ONE call site in all 229 decompiled uscript files —
    // Interface/TargetStatusWnd.uc:193, consumed at :266 by
    // SetNameWithColor("TargetStatusWnd.UserName", ...). See
    // verify_nameplate_color.js gate A, which re-runs that search, and the
    // header of js/nameplates.js.
    //
    // So the assertion is now: level difference must NOT change a nameplate's
    // colour. Same staging, opposite expectation.
    const con = await page.evaluate(() => {
      const w = window.__world;
      const m = w.camera.matrixWorld.elements;
      let fx = -m[8], fz = -m[10];
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const p = w.character.group.position;
      const L2 = 0.01;
      const mine = (w.combat && w.combat.self && w.combat.self.level) ?? null;
      const put = (id, side, level) => {
        const x = p.x + fx * 4 - fz * side, z = p.z + fz * 4 + fx * side;
        w.net.inject({
          op: 'addNpc', id, npcId: 999999, name: `Con${id}`, level,
          x: Math.round(x / L2), y: Math.round(-z / L2), z: Math.round(p.y / L2),
          heading: 0,
        });
      };
      put(900301, -1.2, (mine || 1) + 20);   // far above -> first rung
      put(900302, 1.2, Math.max(1, (mine || 1) - 20));   // far below
      return { mine };
    });
    await sleep(1500);
    const sCon = await read();
    const colOf = (t) => {
      const p = sCon.plates.find(x => x.text && x.text.startsWith(t + '|'));
      return p ? p.text.split('|')[2] : null;
    };
    const above = colOf('Con900301'), below = colOf('Con900302');
    const rungs = await page.evaluate(async () => {
      const r = await fetch('/gamedata/native_colors.json').then(x => x.json());
      return r.ladders.conColor.rungs.map(x => x.color.toLowerCase());
    });
    // #DCDCDC is BOTH the decoded name colour and the ladder's centre rung, so
    // "is it in the ladder" cannot separate the two rules. What separates them
    // is whether the level difference MOVES the colour.
    const nameColor = await page.evaluate(
      () => (window.__nameplates && window.__nameplates.nameColor) || null);
    const same = above && below && String(above).toLowerCase() === String(below).toLowerCase();
    const isDefault = nameColor
      && String(above).toLowerCase() === String(nameColor).toLowerCase();
    gate('G conColor ladder is NOT applied to NPC names',
      con.mine != null && same && isDefault,
      `viewer level ${con.mine}; +20 -> ${above}, -20 -> ${below}; `
      + `equal: ${!!same}; both at the decoded name colour ${nameColor}: ${!!isDefault}`);
    summary.conColor = { viewer: con.mine, above, below, rungs, nameColor,
      rule: 'ladder is TargetStatusWnd-only; nameplates take the decoded default' };

    summary.stage = stage;
    summary.altUp = s;
    summary.altHeld = sAlt;

    // ------------------------------------------------- the crowded scene
    // Gates are done; this only produces the before/after picture. A fan of
    // NPCs and drops laid across the camera's view is the case the old
    // world-space sprites destroyed: every near name overwrote the frame.
    await page.evaluate(() => {
      const w = window.__world;
      const m = w.camera.matrixWorld.elements;
      let fx = -m[8], fz = -m[10];
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const rx = -fz, rz = fx;                    // right-hand perpendicular
      const p = w.character.group.position;
      const L2 = 0.01;
      let id = 910000;
      const put = (op, dist, side, extra) => {
        const x = p.x + fx * dist + rx * side;
        const z = p.z + fz * dist + rz * side;
        w.net.inject(Object.assign({
          op, id: id++, x: Math.round(x / L2), y: Math.round(-z / L2),
          z: Math.round(p.y / L2), heading: 0,
        }, extra));
      };
      const names = ['Gremlin', 'Goblin Raider', 'Kaboo Orc', 'Wolf',
        'Orc Archer', 'Skeleton Hunter'];
      for (let i = 0; i < 12; i++) {
        put('addNpc', 2.5 + (i % 4) * 2.2, ((i % 5) - 2) * 1.6,
          { npcId: 20001, name: names[i % names.length], level: 1 + (i % 9) });
      }
      for (let i = 0; i < 8; i++) {
        put('addDrop', 1.6 + (i % 3) * 1.9, ((i % 4) - 1.5) * 1.1,
          { itemId: 57, count: 3 + i * 11 });
      }
    });
    await sleep(1800);
    await page.screenshot({ path: path.join(OUT, 'nameplates_crowd.png') });
    await page.keyboard.down('Alt');
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'nameplates_crowd_alt.png') });
    await page.keyboard.up('Alt');
  } finally {
    await browser.close();
  }

  // --------------------------------------------------------------- gate F
  let ui = null;
  try {
    const out = execFileSync('python3',
      [path.join(REPO, 'tools/audit/unsourced.py'), '--json', '/tmp/np_unsourced.json'],
      { cwd: REPO, encoding: 'utf8' });
    const rows = JSON.parse(fs.readFileSync('/tmp/np_unsourced.json', 'utf8'));
    const byFile = {};
    for (const r of rows) {
      if (r.bucket !== 'UNSOURCED' || r.domain !== 'client-ui') continue;
      byFile[r.file] = (byFile[r.file] || 0) + 1;
    }
    ui = { total: Object.values(byFile).reduce((a, b) => a + b, 0), byFile };
    void out;
  } catch (e) {
    ui = { error: String(e.message).slice(0, 200) };
  }
  gate('F client-ui UNSOURCED budget', ui && ui.total != null
    && ui.total <= CLIENT_UI_UNSOURCED_MAX,
    `client-ui UNSOURCED = ${ui && ui.total} (ceiling ${CLIENT_UI_UNSOURCED_MAX}) `
    + JSON.stringify(ui && ui.byFile));
  summary.unsourced = ui;

  summary.gates = results;
  fs.writeFileSync(path.join(OUT, 'nameplates.json'), JSON.stringify(summary, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
  console.log(`shots + summary -> ${OUT}`);
  if (CHECK) {
    console.log('CHECK', failed.length ? 'FAIL' : 'PASS');
    process.exit(failed.length ? 1 : 0);
  }
})();
