// verify_markprojector.js — the move-destination marker, and the claim that
// there isn't one.
//
// WHAT THIS GUARDS. This repo drew a Gui021 decal at every click-to-move,
// documented as "SOURCED, not authored", sized by a constant picked to look
// right. The decode behind it was real; the premise was not. Engine.MarkProjector
// is never instantiated by the Interlude client, so the whole decal was an
// invention wearing decoded values. This suite exists so that finding cannot
// silently rot back:
//
//   A. the DECODE still says what we think it says — re-derived from the
//      shipped, encrypted packages on every run, never read from a comment;
//   B. the ACTIVATION evidence still holds (0 live spawns, 0 bAttachMark=true),
//      with non-vacuity tripwires so a broken decrypt cannot pass as "dead";
//   C. the RUNTIME does not draw an unsourced decal by default, and no
//      unsourced footprint constant has crept back into the default path;
//   D. live, in the real client: a real mouse click on the ground produces no
//      decal — and the same build with ?markprojector=authored produces one,
//      which is what proves the detector in (D) can see a decal at all.
//
// (D) needs the world server. It is not skipped when the server is down: a
// suite that quietly evaluates nothing is the failure this project refuses.
// Run it with --no-live to assert A-C only, and that is reported as such.
//
// Usage:  node verify_markprojector.js --check [--no-live]
// Output: verify_shots/markprojector_check_{retail,authored}.png + PASS/FAIL

'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// L2_REPO points the suite at a different checkout of this tree — that is how
// the "fails on the pre-fix tree" half of the proof is run, against a git
// worktree of the commit before this fix, with assets/ symlinked in.
const REPO = process.env.L2_REPO || '/Users/alejandroberacasa/l2vzla';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const EVIDENCE = path.join(REPO, 'assets/gamedata/markprojector/markprojector.json');
const MODULE = path.join(REPO, 'editor/world/js/markprojector.js');
const MAIN = path.join(REPO, 'editor/world/js/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
  return cond;
}

// --- A. the decode, re-derived from the encrypted client on every run -------
// Nothing here is read from a checked-in comment: export_markprojector.py
// decrypts assets/interlude/system/*.u and parses MarkProjector's own source
// text and class defaults. The expectations below are this suite's, so a
// change in either the client or the exporter shows up as a failure.
function sectionDecode() {
  console.log('A. decode (fresh from assets/interlude/system/*.u)');
  let doc;
  try {
    execFileSync('python3', [path.join(REPO, 'tools/dat/export_markprojector.py'),
                             '--check'], { encoding: 'utf8' });
  } catch (e) {
    ok(false, 'export_markprojector.py --check', (e.stdout || e.message).trim().split('\n').pop());
    return null;
  }
  ok(true, 'export_markprojector.py --check', 'evidence json regenerated and current');
  if (!ok(fs.existsSync(EVIDENCE), 'markprojector.json exists', EVIDENCE)) return null;
  doc = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));

  const t = doc.texture, d = doc.class_defaults.MarkProjector, s = doc.source_constants;
  ok(t.name === 'Gui021' && t.width === 256 && t.height === 256,
     'ProjTexture is the shipped 256x256 gui021.tga', `${t.name} ${t.width}x${t.height} ${t.format}`);
  ok(d.ProjTexture === 'Gui021', 'class default ProjTexture', String(d.ProjTexture));
  ok(d.MaterialBlendingOp === 2 && d.FrameBufferBlendingOp === 2,
     'both blending ops are PB_AlphaBlend (2), not additive',
     `${d.MaterialBlendingOp}/${d.FrameBufferBlendingOp}`);
  ok(d.bProjectBSP === false && d.bProjectStaticMesh === false
     && d.bProjectParticles === false && d.bProjectActor === false,
     'projects onto terrain only (BSP/StaticMesh/Particles/Actor all False)');
  ok(doc.class_defaults.Projector.bProjectTerrain === true
     && doc.class_defaults.Projector.MaxTraceDistance === 1000,
     'inherited bProjectTerrain=True, MaxTraceDistance=1000');
  ok(s.FOV === 1, 'UpdateMarkProjector sets FOV = 1', String(s.FOV));
  ok(s.DrawScale === 0.1, 'UpdateMarkProjector sets DrawScale = 0.10', String(s.DrawScale));
  ok(s.timer_s === 10 && s.timer_loop === false && s.on_timer === 'DetachProjector',
     'SetTimer(10, false) -> DetachProjector', `${s.timer_s}s loop=${s.timer_loop}`);
  // The gap, asserted as a gap. If someone ever recovers the frustum formula
  // this line is what tells them to come back and finish the job.
  ok(doc.footprint_world_units === null,
     'on-ground footprint is recorded as NOT RECOVERABLE (native UnProjector.cpp)');
  // The class never reads a mouse or a cursor — the thing that would make it
  // a click marker in the first place.
  ok(s.reads_mouse === false, 'MarkProjector source references no mouse/cursor/click');
  return doc;
}

// --- B. activation, with the tripwires that make a zero mean something ------
function sectionActivation(doc) {
  console.log('B. activation');
  if (!doc) { ok(false, 'activation evidence unavailable'); return; }
  const a = doc.activation;
  // Non-vacuity FIRST. Each zero below is only evidence if the same scan
  // found the things that are genuinely present.
  ok(a.packages_scanned >= 21, 'scanned every shipped script package',
     `${a.packages_scanned} packages`);
  ok(!!a.class_decl, 'found `class MarkProjector extends Projector`',
     a.class_decl && `${a.class_decl.package} extends ${a.class_decl.extends}`);
  ok(a.declarations.length >= 1, 'found `var MarkProjector Mark;`',
     a.declarations.map((d) => `${d.package}:${d.var}`).join(','));
  ok(a.spawn_sites.length >= 1, 'found the Spawn(class\'MarkProjector\') site',
     `${a.spawn_sites.length} site(s)`);
  ok(a.battachmark_writes.length >= 1, 'found a bAttachMark assignment to classify',
     a.battachmark_writes.map((w) => w.value).join(','));
  // Now the finding.
  ok(a.spawn_sites_active === 0, 'every MarkProjector spawn site is commented out',
     a.spawn_sites.map((s) => `${s.package}:${s.commented ? 'commented' : 'LIVE'}`).join(' '));
  ok(a.battachmark_true_writes === 0,
     'nothing in the client ever sets bAttachMark = true');
  ok(doc.instantiated_by_client === false,
     'therefore: the client never instantiates MarkProjector');
}

// --- C. the runtime does not draw an unsourced decal by default -------------
function sectionRuntime() {
  console.log('C. runtime source');
  // main.js first, and unconditionally: these are the substantive claims, and
  // they must be evaluated even when js/markprojector.js is missing entirely —
  // otherwise the pre-fix tree "fails" only by absence and this suite never
  // proves it can see the defect it exists for.
  const main = fs.readFileSync(MAIN, 'utf8');
  ok(!/new THREE\.PlaneGeometry\(\s*MARK_DIAMETER_M/.test(main)
     && !/const MARK_DIAMETER_M/.test(main),
     'main.js no longer builds the decal or owns its footprint constant');
  ok(!/function showClickMark\(/.test(main) && !/let clickMarkUntil/.test(main),
     'main.js no longer owns the decal\'s lifetime state');
  ok(/import \{ ClickMark \} from '\.\/markprojector\.js'/.test(main),
     'main.js takes the marker from js/markprojector.js');
  ok(/clickMark\.show\(/.test(main) && /clickMark\.update\(\)/.test(main),
     'main.js drives the marker through the module, not inline state');

  const mod = fs.existsSync(MODULE) ? fs.readFileSync(MODULE, 'utf8') : null;
  if (!ok(mod !== null, 'js/markprojector.js exists', MODULE)) return;

  // The module's default path must draw nothing. show() has to bail before it
  // ever builds geometry.
  ok(/show\([^)]*\)\s*\{\s*\n\s*if \(!this\.authored\) return;/.test(mod),
     'ClickMark.show() returns before drawing unless authored');
  ok(/authored\s*=\s*opts\.authored !== undefined \? opts\.authored : authoredEnabled\(\)/.test(mod),
     'authored mode defaults to the URL flag, not to on');
  ok(/instantiatedByClient:\s*false/.test(mod),
     'the module records the finding as data');

  // Every geometric constant that survives must be labelled AUTHORED at its
  // own site — the project rule for a value that could not be sourced.
  const consts = [...mod.matchAll(/^const (AUTHORED_\w+|MARK_\w+) = ([^;]+);(.*)$/gm)];
  ok(consts.length >= 3, 'the module still carries the authored constants to label',
     consts.map((c) => c[1]).join(','));
  const unlabelled = consts.filter((c) => !/AUTHORED/.test(c[1] + c[3]));
  ok(unlabelled.length === 0, 'every surviving geometric constant is marked AUTHORED',
     unlabelled.length ? unlabelled.map((c) => c[1]).join(',') : 'none unlabelled');
}

// --- D. live: a real click on the ground draws nothing ----------------------
async function sectionLive() {
  console.log('D. live client');
  const puppeteer = require(
    path.join(REPO, 'tools/src/char_pipeline/node_modules/puppeteer-core'));
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const STAND = [82000, 148000, -3496];
  const CAM = { yaw: 0, pitch: 0.30, dist: 13 };
  const CLICK = [640, 380];

  // Shape-based, so it finds the old inline main.js quad just as well as the
  // module's. If this returned null for the wrong reason the 'authored' leg
  // below would fail, which is exactly what that leg is for.
  const findDecal = () => {
    const w = window.__world;
    let m = null;
    w.scene.traverse((o) => {
      if (o.isMesh && o.material && o.material.map && o.frustumCulled === false
          && o.geometry && o.geometry.type === 'PlaneGeometry' && o.visible) m = o;
    });
    if (!m) return null;
    const g = m.geometry.parameters || {};
    return { w: g.width, h: g.height };
  };

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const seen = {};
  try {
    for (const mode of ['retail', 'authored']) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      page.on('pageerror', (e) => console.log('    PAGEERROR', e.message));
      const q = mode === 'authored' ? '?propDist=0&markprojector=authored' : '?propDist=0';
      await page.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 300000 });
      await page.waitForFunction('window.__world && window.__world.ready', { timeout: 300000 });
      await page.select('#scene-picker', '22_22');
      await page.waitForFunction(
        () => document.getElementById('status').textContent.includes('scene: 22_22')
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: 300000 });
      await sleep(4000);
      await page.evaluate(async ({ STAND, CAM }) => {
        const w = window.__world;
        w.character.group.position.set(STAND[0] * 0.01, STAND[2] * 0.01, -STAND[1] * 0.01);
        w.character.clearTarget();
        w.followCam.yaw = CAM.yaw; w.followCam.pitch = CAM.pitch; w.followCam.dist = CAM.dist;
        await new Promise((r) => setTimeout(r, 800));
      }, { STAND, CAM });

      const canvas = await page.$('canvas#view');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + CLICK[0], box.y + CLICK[1]);
      await sleep(500);
      seen[mode] = {
        decal: await page.evaluate(findDecal),
        mark: await page.evaluate(() => window.__world.clickMark || null),
        moving: await page.evaluate(() => window.__world.moveQueue.length > 0
                                          || !!window.__world.nav.pendingGoal),
      };
      await page.screenshot({ path: path.join(OUT, `markprojector_check_${mode}.png`) });
      await page.close();
    }
  } finally { await browser.close(); }

  // The control: the click must actually have been a move order. Without this
  // "no decal" could just mean "the click did nothing".
  ok(seen.retail.moving === true, 'the click issued a move order (control)',
     `moving=${seen.retail.moving}`);
  ok(seen.retail.decal === null, 'retail build: clicking the ground draws no decal',
     JSON.stringify(seen.retail.decal));
  ok(seen.retail.mark === null, '__world.clickMark is null on a retail build',
     JSON.stringify(seen.retail.mark));
  // And the detector is provably able to see one.
  ok(seen.authored.decal !== null,
     '?markprojector=authored still draws one, so the detector is not blind',
     JSON.stringify(seen.authored.decal));
  console.log(`  shots: ${path.join(OUT, 'markprojector_check_{retail,authored}.png')}`);
}

(async () => {
  const live = !process.argv.includes('--no-live');
  const doc = sectionDecode();
  sectionActivation(doc);
  sectionRuntime();
  if (live) {
    await sectionLive();
  } else {
    console.log('D. live client — SKIPPED by --no-live (A-C only)');
  }
  if (pass === 0) {
    console.log('FAIL  the suite evaluated zero assertions');
    process.exit(1);
  }
  console.log(`${fail ? 'FAIL' : 'PASS'}  markprojector: ${pass} passed, ${fail} failed`
    + (live ? '' : '  (live section skipped)'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
