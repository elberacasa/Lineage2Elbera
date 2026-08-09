// Nameplate COLOUR verification — which colour applies to which entity class.
//
// The owner's report: "names on top of npcs in retail arent red."
//
// THE DEFECT
// ----------
// nameplates.js ran EVERY floating npc plate through the conColor ladder —
// the seven-rung level-difference tint decoded out of
// ?execGetTargetNameColor@UUIDATA_TARGET@@ — whose first rung is #FF0000 for a
// target 9+ levels above the viewer. In a starter town that paints most mobs
// red. The ladder is real and the decode is correct; it simply belongs to a
// different widget. That is the recurring failure mode in this repo: a correct
// measurement welded to an unexamined inference.
//
// THE RULE, and what each gate proves
// -----------------------------------
//   A  THE LADDER IS TARGET-WINDOW-ONLY.  Static evidence, and the load-
//      bearing claim under every other gate here: GetTargetNameColor has
//      exactly ONE call site in all 229 decompiled uscript files, and it
//      feeds TargetStatusWnd.UserName. If anyone adds a second call site this
//      goes red.
//
//   B  THE NAME COLOUR IS DECODED, NOT AUTHORED.  Re-read straight out of
//      NWindow.dll: both ?execSetName@UNameCtrlHandle@@ (0x130058) and
//      ?execSetName@UUIAPI_NAMECTRL@@ (0x118eb3) push 0xffdcdcdc as the
//      colour argument when script supplies none. Asserted against the bytes
//      on disk AND against the constant nameplates.js exports, so source and
//      binary cannot drift apart.
//
//   C  NO LIVE PLATE IS CON-TINTED.  Against the LIVE client on :8083 talking
//      to the real gateway :8090 and real aCis: not one nameplate may resolve
//      to any of the six non-default ladder rungs. #FF0000 is called out
//      separately because it is the owner's actual complaint.
//
//   D  EVERY CLASS DRAWS THE DECODED NAME COLOUR.  Per entity class present
//      in the live scene, every plate's RESOLVED colour must equal
//      Nameplates.nameColor. Reads what the layer resolved, not what the
//      caller passed, so a ladder creeping back into colourFor() is caught
//      even if entities.js still looks right. FAILS if no npc plates exist —
//      a gate that evaluates zero assertions is a failure, not a pass.
//
//   E  THE TITLE LINE IS SEPARATE, AND CARRIES THE nickcolor.  npcname.dat's
//      `nickcolor` is the TITLE colour, not the name colour (the three values
//      partition the `nick` STRINGS: #3F8BFE = Raid Boss/Raid Fighter,
//      #0080FF = Quest Monster, #9CE8A9 = everything else). So no plate's
//      NAME may equal a nickcolor, and a titled NPC must draw its title in
//      its own row's colour.
//
//   F  THE DETECTOR HAS TEETH.  Injects a synthetic red plate into the live
//      scene and requires gate C's own predicate to reject it, then removes
//      it. Without this, C and D pass trivially on any tree where nameplates
//      fail to render at all.
//
// WHAT THIS DELIBERATELY DOES NOT ASSERT
// --------------------------------------
// Per-class tints for PK / flagged / clan / party / GM players. The engine
// does distinguish them, but the selection lives in the caller of
// ?DrawTargetName@UCanvas@@ inside engine.dll, which is Themida-packed (all
// four sections DATA, a section named `Themida`, zero instructions from
// objdump over 30 MB). ?GetNameColor@User@@ and ?GetNickColor@User@@ are
// equally unreadable and NWindow.dll imports neither. Those classes are
// UNSOURCED and are drawn at the decoded default; no gate here may invent a
// colour for them.
//
// Usage:
//   node editor/world/verify_nameplate_color.js           report + screenshots
//   node editor/world/verify_nameplate_color.js --check   exit 1 on any failure
//   node editor/world/verify_nameplate_color.js --static  gates A+B only (no browser)
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const fixture = require('./live_fixture');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = path.join(__dirname, '..', '..');
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const CHECK = process.argv.includes('--check');
const STATIC_ONLY = process.argv.includes('--static');
// STABLE across runs — see live_fixture.js. No Date.now().
const DEVICE_ID = 'verify-nameplate-color-fixture-1';
// --shot lets the before/after pair be captured under distinct names without
// editing the file between runs.
const shotArg = process.argv.find(a => a.startsWith('--shot='));
const SHOT = shotArg ? shotArg.slice(7) : 'nameplate_color_after.png';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NWINDOW = path.join(REPO, 'assets/interlude/system/NWindow.dll');
const USCRIPT = path.join(REPO, 'assets/uscript');
const NAMEPLATES_JS = path.join(__dirname, 'js', 'nameplates.js');
const ENTITIES_JS = path.join(__dirname, 'js', 'entities.js');

// The decoded default, as an expectation this file states independently of
// the module under test — otherwise gate B would be comparing the source to
// itself.
const EXPECT_NAME_COLOR = '#dcdcdc';

// The two instruction sites, at file offsets (NWindow.dll is plain PE32 and
// its file offset equals its RVA — asserted in gate B before either read).
const SETNAME_SITES = [
  { rva: 0x130058, sym: '?execSetName@UNameCtrlHandle@@' },
  { rva: 0x118eb3, sym: '?execSetName@UUIAPI_NAMECTRL@@' },
];
// push imm32 0xffdcdcdc, little-endian.
const PUSH_DCDCDC = Buffer.from([0x68, 0xdc, 0xdc, 0xdc, 0xff]);

// native_colors.json ladders.conColor — the rungs that must never reach a
// floating plate. #DCDCDC is the ladder's own centre rung AND the decoded
// name default, so it is excluded: seeing it proves nothing either way.
const CON_RUNGS = ['#ff0000', '#ff9191', '#fafe91', '#a2ffab', '#a2a8fc', '#0000ff'];
// npcname.dat's three nickcolor values, lowercased — TITLE colours.
const NICK_COLORS = ['#9ce8a9', '#3f8bfe', '#0080ff'];

const results = [];
function gate(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const norm = c => String(c || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// A — the ladder belongs to the target window, and only to it.
// ---------------------------------------------------------------------------
function gateA() {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.uc')) continue;
      const lines = fs.readFileSync(p, 'latin1').split('\n');
      lines.forEach((ln, i) => {
        if (ln.includes('GetTargetNameColor')) {
          hits.push({ file: path.relative(REPO, p), line: i + 1, text: ln.trim() });
        }
      });
    }
  };
  if (!fs.existsSync(USCRIPT)) {
    gate('A ladder is target-window-only', false, `${USCRIPT} missing`);
    return;
  }
  walk(USCRIPT);
  // Expected: the declaration in NWindow/UIDATA_TARGET.uc and the single
  // consumer in Interface/TargetStatusWnd.uc. Anything else is a new call
  // site and this claim would no longer hold.
  const consumers = hits.filter(h => !h.file.endsWith('UIDATA_TARGET.uc'));
  const ok = consumers.length === 1
    && consumers[0].file.endsWith('Interface/TargetStatusWnd.uc');
  gate('A ladder is target-window-only', ok,
    ok ? `1 consumer: ${consumers[0].file}:${consumers[0].line} (+ the native decl)`
       : `expected exactly 1 consumer in TargetStatusWnd.uc, found ${consumers.length}: `
         + JSON.stringify(consumers));

  // and it must reach a NameCtrl in that window, not a nameplate
  const tsw = path.join(USCRIPT, 'Interface', 'TargetStatusWnd.uc');
  const src = fs.existsSync(tsw) ? fs.readFileSync(tsw, 'latin1') : '';
  const usesIt = /SetNameWithColor\(\s*"TargetStatusWnd\.UserName"[\s\S]{0,120}?TargetNameColor/
    .test(src);
  gate('A2 ladder feeds TargetStatusWnd.UserName', usesIt,
    usesIt ? 'SetNameWithColor("TargetStatusWnd.UserName", ..., TargetNameColor)'
           : 'the single consumer no longer feeds the target window name control');
}

// ---------------------------------------------------------------------------
// B — the name colour is decoded from the binary, and the source agrees.
// ---------------------------------------------------------------------------
function gateB() {
  if (!fs.existsSync(NWINDOW)) {
    gate('B name colour decoded from NWindow.dll', false, `${NWINDOW} missing`);
    return;
  }
  const dll = fs.readFileSync(NWINDOW);

  // file offset == RVA, the precondition both reads rest on. PE header:
  // e_lfanew at 0x3c; the first section's VirtualAddress must equal its
  // PointerToRawData for the identity to hold.
  const pe = dll.readUInt32LE(0x3c);
  const nsec = dll.readUInt16LE(pe + 6);
  const optsize = dll.readUInt16LE(pe + 20);
  const sec0 = pe + 24 + optsize;
  const va0 = dll.readUInt32LE(sec0 + 12);
  const raw0 = dll.readUInt32LE(sec0 + 20);
  const flat = nsec > 0 && va0 === raw0;
  gate('B0 NWindow.dll file offset == RVA', flat,
    `section[0] VirtualAddress=0x${va0.toString(16)} PointerToRawData=0x${raw0.toString(16)}`);

  let allOk = flat;
  const seen = [];
  for (const s of SETNAME_SITES) {
    const got = dll.subarray(s.rva, s.rva + 5);
    const ok = got.equals(PUSH_DCDCDC);
    allOk = allOk && ok;
    seen.push(`${s.sym}@0x${s.rva.toString(16)}=${got.toString('hex')}`);
  }
  gate('B1 both execSetName sites push 0xffdcdcdc', allOk, seen.join('  '));

  // the constant the runtime actually exports must be that same colour
  const js = fs.readFileSync(NAMEPLATES_JS, 'utf8');
  const m = js.match(/export\s+const\s+NAME_COLOR\s*=\s*'([^']+)'/);
  const srcColor = m ? norm(m[1]) : null;
  gate('B2 nameplates.js NAME_COLOR matches the binary', srcColor === EXPECT_NAME_COLOR,
    `NAME_COLOR=${srcColor} expected=${EXPECT_NAME_COLOR} (0xFFDCDCDC -> #DCDCDC)`);

  // the two literals this wave removed must not come back as name colours
  const ents = fs.readFileSync(ENTITIES_JS, 'utf8');
  const revived = ['#c9a959', '#9ce8a9', '#d9c68f']
    .filter(h => new RegExp(`makeLabel\\([^)]*${h}`, 'i').test(ents));
  gate('B3 no authored name literal in entities.js makeLabel calls',
    revived.length === 0,
    revived.length ? `revived: ${revived.join(', ')}` : 'none of #c9a959 / #9ce8a9 / #d9c68f');

  // and colourFor() must not consult a ladder again
  const cf = js.slice(js.indexOf('function colourFor'), js.indexOf('function plateFor'));
  const clean = cf.length > 0 && !/ladder|conColor/i.test(cf);
  gate('B4 colourFor() consults no ladder', clean,
    clean ? 'no ladder/conColor reference in colourFor()' : 'colourFor() references a ladder again');
}

// ---------------------------------------------------------------------------
// live gates
// ---------------------------------------------------------------------------
async function live() {
  fs.mkdirSync(OUT, { recursive: true });
  await fixture.ensureChar(DEVICE_ID);
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
    await fixture.seed(page, DEVICE_ID);

    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.net.connected'
      + ' && window.__world.net.log.some(m => m.op === "enterWorld")',
      { timeout: 120000 });

    // wait for a CROWDED scene: real npcs spawned and their plates registered
    await page.waitForFunction(
      'window.__nameplates && window.__nameplates.count >= 5', { timeout: 60000 });
    // titles arrive with the async npcname.json fetch
    await sleep(6000);
    // A boundary crossing re-centres the 3x3 tile window and raises the
    // #loading overlay, which dims the whole frame — the before/after pair is
    // worthless if either shot lands mid-reload. Wait it out, then settle.
    await page.waitForFunction(() => {
      const el = document.getElementById('loading');
      if (!el) return true;
      const s = getComputedStyle(el);
      return s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0;
    }, { timeout: 90000 }).catch(() => { /* no overlay in this build */ });
    await sleep(3000);
    await page.evaluate(() => window.__nameplates.tick());

    // -- screenshot the crowded scene FIRST, so it exists even if a gate
    //    below throws on a tree that lacks the probe surface.
    await page.screenshot({ path: path.join(OUT, SHOT) });

    // PIXELS ON SCREEN. Independent of any probe surface the module exposes,
    // so it judges the pre-fix tree and the fixed tree the same way: read each
    // plate's glyph canvas and take the modal fully-opaque texel. ui/font.js
    // tints the sheet so the glyph CORE carries the full text colour at
    // alpha 255 and only the built-in outline is partial, so the modal opaque
    // texel IS the text colour.
    const pixels = await page.evaluate(() => {
      const hex = (r, g, b) =>
        '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      const readCanvas = (cv) => {
        if (!cv || !cv.width || !cv.height) return null;
        const ctx = cv.getContext('2d');
        let d;
        try { d = ctx.getImageData(0, 0, cv.width, cv.height).data; }
        catch { return null; }
        const tally = new Map();
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] !== 255) continue;              // outline / empty
          const k = hex(d[i], d[i + 1], d[i + 2]);
          tally.set(k, (tally.get(k) || 0) + 1);
        }
        let best = null, n = 0;
        for (const [k, v] of tally) if (v > n) { n = v; best = k; }
        return best ? { color: best, texels: n } : null;
      };
      const out = [];
      for (const el of document.querySelectorAll('.nameplate')) {
        if (el.style.display === 'none') continue;
        // fixed tree: .nameplate-name / .nameplate-title rows.
        // pre-fix tree: a single canvas straight under .nameplate.
        const nameCv = el.querySelector('.nameplate-name canvas')
          || el.querySelector(':scope > canvas');
        const titleRow = el.querySelector('.nameplate-title');
        const titleCv = titleRow && titleRow.style.display !== 'none'
          ? titleRow.querySelector('canvas') : null;
        const nm = readCanvas(nameCv);
        if (!nm) continue;
        out.push({ name: nm.color, texels: nm.texels,
                   title: titleCv ? (readCanvas(titleCv) || {}).color || null : null });
      }
      return out;
    });
    summary.pixels = { count: pixels.length, sample: pixels.slice(0, 20) };
    const pxTally = pixels.reduce((a, p) => {
      a[p.name] = (a[p.name] || 0) + 1; return a;
    }, {});
    summary.pixelHistogram = pxTally;

    const pxRed = pixels.filter(p => norm(p.name) === '#ff0000');
    const pxTinted = pixels.filter(p => CON_RUNGS.includes(norm(p.name)));
    gate('C0 rendered pixels: no plate is red', pixels.length > 0 && pxRed.length === 0,
      `${pixels.length} plates measured on screen, ${pxRed.length} red; `
      + `histogram=${JSON.stringify(pxTally)}`);
    gate('C0b rendered pixels: no plate on a conColor rung',
      pixels.length > 0 && pxTinted.length === 0,
      `${pxTinted.length} of ${pixels.length} on ${CON_RUNGS.join(' ')}`);
    // The on-screen value is NOT the raw #DCDCDC, and that is correct.
    // ui/font.js tintedSheet() modulates each texel by the text colour
    // (d[i] * tr / 255) and deliberately uses the shipped sheet as-is. The
    // opaque glyph core of SmallFont-e is (255, 251, 255) — measured over the
    // sheet: exactly one opaque texel class, 1363 texels — not pure white.
    // So the core renders as
    //     R round(255*220/255)=220=0xdc
    //     G round(251*220/255)=217=0xd9
    //     B round(255*220/255)=220=0xdc
    // i.e. #dcd9dc. Asserting that exact value keeps the gate tight; a
    // tolerance band here would hide a real colour change of the same size.
    const EXPECT_RENDERED = '#dcd9dc';
    const onColor = pixels.filter(p => norm(p.name) === EXPECT_RENDERED).length;
    gate('C0c rendered pixels: every name is the decoded colour',
      pixels.length > 0 && onColor === pixels.length,
      `${onColor}/${pixels.length} at ${EXPECT_RENDERED}`
      + ` (= decoded ${EXPECT_NAME_COLOR} through SmallFont-e's (255,251,255) core)`);
    // one colour for every plate on screen: a per-class rule creeping back in
    // would split this histogram even if each colour stayed plausible.
    gate('C0d rendered pixels: exactly one name colour across all plates',
      Object.keys(pxTally).length === 1,
      `distinct rendered name colours = ${Object.keys(pxTally).length}: `
      + JSON.stringify(pxTally));

    const hasProbe = await page.evaluate(
      () => typeof window.__nameplates.probe === 'function');
    if (!hasProbe) {
      gate('D probe surface present', false,
        'window.__nameplates.probe() missing — pre-fix tree; per-class gates cannot run');
      return summary;
    }
    const plates = await page.evaluate(() => window.__nameplates.probe());
    const nameColor = await page.evaluate(() => window.__nameplates.nameColor);
    summary.nameColor = nameColor;
    summary.plateCount = plates.length;
    summary.byKind = plates.reduce((a, p) => {
      a[p.kind || 'null'] = (a[p.kind || 'null'] || 0) + 1; return a;
    }, {});
    summary.sample = plates.slice(0, 25);

    // -- C: no plate is con-tinted ------------------------------------------
    const tinted = plates.filter(p => CON_RUNGS.includes(norm(p.color)));
    const red = plates.filter(p => norm(p.color) === '#ff0000');
    gate('C1 no live plate is red', red.length === 0 && plates.length > 0,
      `${plates.length} plates, ${red.length} red`);
    gate('C2 no live plate takes any conColor rung', tinted.length === 0 && plates.length > 0,
      tinted.length ? JSON.stringify(tinted.slice(0, 6))
                    : `${plates.length} plates, 0 on any of ${CON_RUNGS.join(' ')}`);

    // -- D: every class draws the decoded colour ----------------------------
    const kinds = [...new Set(plates.map(p => p.kind || 'null'))];
    const npcPlates = plates.filter(p => p.kind === 'npc');
    // vacuous-pass guard: this suite exists to judge npc names
    gate('D0 the live scene actually has npc plates to judge', npcPlates.length > 0,
      `npc plates=${npcPlates.length} kinds=${JSON.stringify(summary.byKind)}`);

    for (const k of kinds) {
      const set = plates.filter(p => (p.kind || 'null') === k);
      const bad = set.filter(p => norm(p.color) !== norm(nameColor));
      gate(`D ${k} names draw the decoded colour`, bad.length === 0 && set.length > 0,
        bad.length ? `${bad.length}/${set.length} off-colour: `
                     + JSON.stringify(bad.slice(0, 4))
                   : `${set.length}/${set.length} at ${nameColor}`);
    }

    // -- E: title is a separate line, and carries the nickcolor -------------
    const nameIsNick = plates.filter(p => NICK_COLORS.includes(norm(p.color)));
    gate('E1 no plate NAME uses a nickcolor', nameIsNick.length === 0 && plates.length > 0,
      nameIsNick.length ? JSON.stringify(nameIsNick.slice(0, 6))
                        : `0/${plates.length} names on ${NICK_COLORS.join(' ')}`);

    const titled = plates.filter(p => p.title);
    summary.titled = titled.slice(0, 15);
    const titleOk = titled.filter(p => NICK_COLORS.includes(norm(p.titleColor)));
    gate('E2 titled NPCs draw their title in a nickcolor', titled.length > 0
      && titleOk.length === titled.length,
      titled.length === 0
        ? 'NO TITLED NPC IN VIEW — gate cannot judge (not a pass)'
        : `${titleOk.length}/${titled.length} titles on a nickcolor; `
          + JSON.stringify(titled.slice(0, 4).map(t => [t.name, t.title, t.titleColor])));

    // the title must be a SECOND DOM row, not merged into the name
    const rows = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.nameplate')) {
        if (el.style.display === 'none') continue;
        out.push({
          name: !!el.querySelector('.nameplate-name canvas'),
          title: !!(el.querySelector('.nameplate-title')
            && el.querySelector('.nameplate-title').style.display !== 'none'),
        });
      }
      return out;
    });
    summary.domRows = { total: rows.length, withTitle: rows.filter(r => r.title).length };
    gate('E3 plates render name and title as separate rows',
      rows.length > 0 && rows.every(r => r.name),
      `${rows.length} visible plates, ${rows.filter(r => r.title).length} with a title row`);

    // -- F: the detector has teeth -----------------------------------------
    // Inject a synthetic plate carrying the ladder's red and require gate C's
    // predicate to reject it. Proves C/D are not passing on an empty set or a
    // broken probe.
    const teeth = await page.evaluate((rungs) => {
      const w = window.__world;
      const THREE = w.character.group.constructor;      // THREE.Object3D ctor
      const anchor = new THREE(); // eslint-disable-line new-cap
      anchor.userData.entityId = -999;
      anchor.userData.nameplate = { text: 'TEETH', color: '#FF0000', kind: 'npc' };
      w.scene.add(anchor);
      window.__nameplates.register(anchor);
      window.__nameplates.tick();
      const probe = window.__nameplates.probe();
      const caught = probe.filter(
        p => rungs.includes(String(p.color).toLowerCase())).length;
      window.__nameplates.unregister(anchor);
      w.scene.remove(anchor);
      window.__nameplates.tick();
      const after = window.__nameplates.probe().filter(
        p => rungs.includes(String(p.color).toLowerCase())).length;
      return { caught, after };
    }, CON_RUNGS);
    summary.teeth = teeth;
    gate('F detector rejects an injected red plate',
      teeth.caught === 1 && teeth.after === 0,
      `injected red detected=${teeth.caught} (want 1), residue after removal=${teeth.after} (want 0)`);
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'nameplate_color.json'),
    JSON.stringify(summary, null, 2));
  return summary;
}

(async () => {
  gateA();
  gateB();
  let summary = null;
  if (!STATIC_ONLY) summary = await live();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
  if (summary) {
    console.log(JSON.stringify({
      nameColor: summary.nameColor, plateCount: summary.plateCount,
      byKind: summary.byKind, titled: summary.titled, teeth: summary.teeth,
    }, null, 2));
  }
  if (CHECK && failed.length) {
    console.error('FAILED: ' + failed.map(f => f.name).join(', '));
    process.exit(1);
  }
})().catch(e => {
  console.error('VERIFY NAMEPLATE COLOR FAILED:', e.stack || e.message);
  process.exit(1);
});
