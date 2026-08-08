// verify_steps.js — footsteps: the right sound, on the right frame.
//
// The game played no footsteps at all. This suite asserts the two halves of
// the retail rule separately, because they fail in different ways:
//
//   BANK SELECTION   the surface under the feet picks one of the four banks
//                    the AnimNotify_Sound objects carry, and a StaticMeshActor
//                    with its own StepSound_1..3 overrides. Checked by driving
//                    steps.js's surfaceAt() at coordinates taken from the
//                    TILE'S OWN scene.json/steps.json, not from constants here.
//
//   PHASE ALIGNMENT  a step lands on the frame retail authored it on. Checked
//                    by running the real AnimationMixer at a fine fixed step
//                    over whole cycles and recording the clip phase at every
//                    footfall — a timer-driven implementation drifts and fails
//                    this within one cycle, which is exactly the failure mode
//                    that made a timer unacceptable.
//
// It also re-runs the extractor's own --check, so a drifted stepnotify.json
// fails here too rather than only in the tool.
//
// Headless Chrome emits no sound, so "audible" is asserted to the last step
// before the speaker: the ref chosen for a real footfall resolves in the audio
// manifest and decodes to a real AudioBuffer.
//
// Usage:
//   node verify_steps.js [base-url]           report  (default :8083)
//   node verify_steps.js --check [base-url]   same, exit 1 on any failure

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..', '..');
const BASE = (process.argv.slice(2).find(a => a.startsWith('http')))
  || 'http://127.0.0.1:8083';
const CHECK = process.argv.includes('--check');
const TILE = '20_20';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- A. data
function dataChecks() {
  const notifyPath = path.join(ROOT, 'assets', 'audio', 'stepnotify.json');
  const doc = readJSON(notifyPath);
  check('stepnotify.json present', !!doc, notifyPath);
  if (!doc) return null;

  // The extractor's own oracle-backed re-derivation.
  let extractorOk = false, extractorOut = '';
  try {
    extractorOut = execFileSync('python3',
      [path.join(ROOT, 'tools', 'audio', 'build_stepnotify.py'), '--check'],
      { cwd: ROOT, encoding: 'utf8' });
    extractorOk = true;
  } catch (e) { extractorOut = (e.stdout || '') + (e.stderr || ''); }
  const located = /sequences located:\s+(\d+) \((\d+) not located\)/.exec(extractorOut);
  check('build_stepnotify.py --check passes', extractorOk,
        located ? `${located[1]} sequences, ${located[2]} unlocated` : '');

  // Banks: four surfaces, walk and run, three alternates each, all resolving.
  const manifest = readJSON(path.join(ROOT, 'assets', 'audio', 'manifest.json'));
  const surfaces = ['land', 'grass', 'water', 'actor'];
  let bankRefs = 0, unresolved = [], missingFiles = [];
  for (const s of surfaces) {
    for (const g of ['walk', 'run']) {
      const refs = doc.banks[s] && doc.banks[s][g];
      if (!Array.isArray(refs) || refs.length !== 3) { unresolved.push(`${s}.${g}`); continue; }
      for (const r of refs) {
        bankRefs++;
        const rel = manifest && manifest.sfx[r];
        if (!rel) { unresolved.push(r); continue; }
        if (!fs.existsSync(path.join(ROOT, 'assets', 'audio', 'sfx', rel))) missingFiles.push(rel);
      }
    }
  }
  check('all four banks are 3-deep for walk and run', unresolved.length === 0,
        `${bankRefs} refs`);
  check('every bank ref has a staged .ogg', missingFiles.length === 0,
        missingFiles.slice(0, 3).join(' '));

  // Retail's own oddities, asserted so a "fix" that silently normalises them
  // has to argue with this file first.
  check('water run bank == water walk bank (retail)',
        JSON.stringify(doc.banks.water.run) === JSON.stringify(doc.banks.water.walk));
  check('grass run slot 3 repeats slot 2 (retail)',
        doc.banks.grass.run[2] === doc.banks.grass.run[1],
        doc.banks.grass.run.join(' '));
  check('water bank is shalow, not deep',
        doc.banks.water.walk.every(r => /water_shalow_/.test(r)));

  // Per-pawn clip tables.
  const pawnIds = Object.keys(doc.pawns);
  check('all 14 playable pawns carry step tables', pawnIds.length === 14,
        `${pawnIds.length}`);
  let clips = 0, badSteps = [], badU = [], gltfBad = [], gltfChecked = 0;
  for (const id of pawnIds) {
    const pawn = doc.pawns[id];
    const names = Object.keys(pawn.clips);
    if (names.length !== 14) badSteps.push(`${id}:${names.length} clips`);
    const gltf = readJSON(path.join(ROOT, 'editor', 'characters', 'models', `${id}.gltf`));
    const anims = {};
    for (const a of (gltf && gltf.animations) || []) anims[a.name] = a;
    for (const name of names) {
      clips++;
      const c = pawn.clips[name];
      if (c.steps.length !== 2) { badSteps.push(`${id}.${name}:${c.steps.length}`); continue; }
      const [a, b] = c.steps;
      if (!(a.u > 0 && a.u < b.u && b.u < 1)) badU.push(`${id}.${name} ${a.u} ${b.u}`);
      // the relation `u` rests on: the glTF holds frames 0..N-1 at i/Rate
      const anim = gltf && anims[name];
      if (!anim) { gltfBad.push(`${id}.${name} absent`); continue; }
      const want = (c.frames - 1) / c.rate;
      const ok = anim.samplers.some(s => {
        const acc = gltf.accessors[s.input];
        return acc.count === c.frames && Math.abs((acc.max || [NaN])[0] - want) < 1e-4;
      });
      gltfChecked++;
      if (!ok) gltfBad.push(`${id}.${name}`);
    }
  }
  check('every clip carries exactly two footfalls', badSteps.length === 0,
        `${clips} clips; ${badSteps.slice(0, 3).join(' ')}`);
  check('footfalls are ordered and inside the clip', badU.length === 0,
        badU.slice(0, 3).join(' '));
  check('shipped glTF timeline matches the retail sequence', gltfBad.length === 0,
        `${gltfChecked} clips; ${gltfBad.slice(0, 3).join(' ')}`);

  // Source guards: steps.js needs the pawn id off the Character, and it must
  // not have quietly grown a cadence timer.
  const charSrc = fs.readFileSync(
    path.join(ROOT, 'editor', 'world', 'js', 'character.js'), 'utf8');
  check('character.js records the pawn id (steps.js needs it)',
        /this\.modelId\s*=/.test(charSrc));
  const stepsSrc = fs.readFileSync(
    path.join(ROOT, 'editor', 'world', 'js', 'steps.js'), 'utf8');
  check('steps.js drives off clip time, not a timer',
        /action\.time/.test(stepsSrc)
        && !/setInterval|STEP_INTERVAL|stepEvery/.test(stepsSrc));

  return doc;
}

// ------------------------------------------------------------- B. browser
async function browserChecks(doc) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader',
           '--autoplay-policy=no-user-gesture-required',
           '--window-size=1200,900'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__world && window.__world.ready === true,
                             { timeout: 60000 }).catch(() => {});

  // Fixtures come from the tile's own data, fetched here so the expectations
  // are the shipped data rather than numbers typed into this file.
  const scene = readJSON(path.join(ROOT, 'assets', 'world', TILE, 'scene.json'));
  const steps = readJSON(path.join(ROOT, 'assets', 'world', TILE, 'steps.json'));
  // Distinct position keys, because retail authors several meshes at one
  // point (20_20 stacks three fortress pieces) and a position can only name
  // one surface. Measured on the shipped data, not assumed.
  const keyOf = (p) => [Math.round(p[0] * 10), Math.round(p[2] * 10),
                        Math.round(-p[1] * 10)].join(',');
  const keys = new Map();
  let keyConflicts = 0;
  for (const [i, bank] of Object.entries(steps.props)) {
    const p = scene.props[Number(i)];
    const refs = bank.map(k => steps.names[k]).join(' ');
    const k = keyOf(p.position);
    if (keys.has(k)) { if (keys.get(k).refs !== refs) keyConflicts++; }
    else keys.set(k, { i: Number(i), pos: p.position, mesh: p.mesh, refs });
  }
  // probe every banked actor, so this cannot pass on one lucky prop
  const fixture = {
    tile: TILE,
    banked: [...keys.values()].map(v => ({ pos: v.pos, mesh: v.mesh,
                                           refs: v.refs.split(' ') })),
    bankedCount: Object.keys(steps.props).length,
    keyCount: keys.size,
    keyConflicts,
    water: scene.water[0],
    // a point far from every banked prop, for the land case
    open: null,
  };
  // the tile centre nudged to a spot with no banked prop within 20 m
  {
    const pts = Object.keys(steps.props).map(i => scene.props[Number(i)].position);
    const g = scene.gridSize * scene.spacing;
    outer:
    for (let k = 0; k < 4000; k++) {
      const x = scene.origin[0] + (k * 977 % g);
      const y = scene.origin[1] + (k * 1597 % g);
      for (const p of pts) if (Math.hypot(p[0] - x, p[1] - y) < 2000) continue outer;
      for (const w of scene.water) {
        if (x >= Math.min(w.rect[0], w.rect[2]) && x <= Math.max(w.rect[0], w.rect[2])
            && y >= Math.min(w.rect[1], w.rect[3]) && y <= Math.max(w.rect[1], w.rect[3])) {
          continue outer;
        }
      }
      fixture.open = [x, y];
      break;
    }
  }

  const out = await page.evaluate(async (fx) => {
    const r = { errors: [] };
    const w = window.__world;
    if (!w) { r.noWorld = true; return r; }
    try {
      const mod = await import('/js/steps.js');
      const fs = mod.footsteps;
      r.loaded = await fs.load();
      if (!r.loaded) return r;

      await w.loadScene(fx.tile, { keepCharPos: false });
      const terrain = w.terrain;
      await fs.setTile(fx.tile, terrain);
      r.tileStats = fs.tileStats;

      const L2 = 0.01;
      const toThree = (x, y, z) => ({ x: x * L2, y: z * L2, z: -y * L2 });

      // --- bank selection, one probe per surface -------------------------
      const land = toThree(fx.open[0], fx.open[1],
                           w.heightAt(fx.open[0] * L2, -fx.open[1] * L2) / L2);
      r.land = {
        walk: fs.surfaceAt(land, 'walk', terrain),
        run: fs.surfaceAt(land, 'run', terrain),
      };

      const wr = fx.water.rect;
      const wx = (wr[0] + wr[2]) / 2, wy = (wr[1] + wr[3]) / 2;
      const wet = toThree(wx, wy, fx.water.height - 50);   // feet under the plane
      r.water = fs.surfaceAt(wet, 'walk', terrain);
      const dry = toThree(wx, wy, fx.water.height + 50);   // and above it
      r.aboveWater = fs.surfaceAt(dry, 'walk', terrain);

      // Every banked actor of the tile, probed at the CENTRE of the box
      // steps.js built for it. Probing the placement origin would be the
      // raycast-at-an-origin-outside-its-own-mesh mistake all over again:
      // 20_20's Fort01_tower_stair sits 0.95 m above its own origin.
      let claimed = 0, wrong = 0, missed = 0;
      const c = new (await import('three')).Vector3();
      for (const e of fs.actorBoxes || []) {
        e.box.getCenter(c);
        const got = fs.surfaceAt(c, 'walk', terrain);
        if (got.kind !== 'actor') { missed++; continue; }
        claimed++;
        // a smaller banked box nested inside this one legitimately wins, so
        // a different bank is not a failure; not being an actor at all is
        if (got.refs.join(' ') !== e.refs.join(' ')) wrong++;
      }
      r.actorProbe = { total: (fs.actorBoxes || []).length, claimed, missed, wrong };

      // and one named actor spelled out, end to end from steps.json
      r.named = null;
      for (const bk of fx.banked) {
        const p = toThree(bk.pos[0], bk.pos[1], bk.pos[2]);
        const box = (fs.actorBoxes || []).find(
          e => Math.abs(e.pos.x - p.x) < 0.01 && Math.abs(e.pos.y - p.y) < 0.01
            && Math.abs(e.pos.z - p.z) < 0.01);
        if (!box) continue;
        box.box.getCenter(c);
        const got = fs.surfaceAt(c, 'walk', terrain);
        r.named = { mesh: bk.mesh, expect: bk.refs, got: got.refs, kind: got.kind };
        break;
      }

      // --- phase alignment ----------------------------------------------
      // Drive the real mixer at a fixed fine step over whole cycles and
      // record the clip phase at every footfall.
      const ch = w.character;
      r.modelId = ch && ch.modelId;
      const probes = [];
      for (const clipName of ['walk', 'run']) {
        ch.stance = 'hand';
        ch.play(clipName, 0);
        ch.mixer.update(0);
        const action = ch.current;
        const dur = action.getClip().duration;
        const table = fs.stepsFor(ch.modelId, action.getClip().name);
        if (!table) { probes.push({ clip: clipName, missing: true }); continue; }
        // arm on the current phase
        fs.tick(ch, terrain);
        const dt = 1 / 480;
        const cycles = 3;
        const at = [];
        let seen = fs.fired;
        for (let t = 0; t < dur * cycles; t += dt) {
          ch.mixer.update(dt);
          fs.tick(ch, terrain);
          if (fs.fired !== seen) {
            seen = fs.fired;
            at.push(((action.time % dur) + dur) % dur / dur);
          }
        }
        probes.push({
          clip: action.getClip().name, dur, cycles,
          expect: table.steps.map(s => s.u),
          at, tol: dt / dur,
        });
      }
      r.probes = probes;
      r.lastStep = fs.lastStep;

      // --- audible: the chosen ref decodes -------------------------------
      const a = w.audio;
      a.resume();
      const ref = (fs.lastStep && fs.lastStep.refs || [])[0];
      r.ref = ref;
      if (ref && a && a.ready) {
        const buf = await a._buffer(ref);
        r.decoded = buf ? { ch: buf.numberOfChannels, dur: buf.duration } : null;
      }
    } catch (e) {
      r.errors.push(String(e && e.stack || e));
    }
    return r;
  }, fixture);

  await browser.close();

  if (out.noWorld) { check('client exposes window.__world', false); return; }
  if (out.errors.length) console.log('    page errors: ' + out.errors.join(' | '));

  check('steps.js loads stepnotify.json in the client', out.loaded === true);
  const ts = out.tileStats || {};
  check(`tile ${TILE}: every banked actor joins a placement`,
        ts.banked === fixture.bankedCount,
        `${ts.banked} of ${fixture.bankedCount}`);
  check(`tile ${TILE}: distinct actor positions`,
        ts.positions === fixture.keyCount,
        `${ts.positions} of ${fixture.keyCount}`);
  check(`tile ${TILE}: every actor position joins drawn geometry`,
        ts.boxes === fixture.keyCount,
        `${ts.boxes} world boxes for ${fixture.keyCount} positions `
        + `(${fixture.bankedCount} actors)`);
  check(`tile ${TILE}: shared positions carry the same bank`,
        ts.conflicts === fixture.keyConflicts && fixture.keyConflicts === 0,
        `${ts.conflicts}`);

  const landRefs = doc.banks.land;
  check('open terrain selects the LAND bank',
        out.land && out.land.walk.kind === 'land'
        && JSON.stringify(out.land.walk.refs) === JSON.stringify(landRefs.walk)
        && JSON.stringify(out.land.run.refs) === JSON.stringify(landRefs.run),
        out.land && out.land.walk.kind);
  check('under a WaterVolume selects the WATER bank',
        out.water && out.water.kind === 'water'
        && JSON.stringify(out.water.refs) === JSON.stringify(doc.banks.water.walk),
        out.water && out.water.kind);
  check('above the same WaterVolume does not',
        out.aboveWater && out.aboveWater.kind !== 'water',
        out.aboveWater && out.aboveWater.kind);
  const ap = out.actorProbe || {};
  check('every banked StaticMeshActor claims the surface inside its own box',
        ap.total > 0 && ap.missed === 0,
        `${ap.claimed}/${ap.total} claimed, ${ap.missed} fell through to terrain`);
  check("that actor's own StepSound_1..3 is what plays",
        out.named && out.named.kind === 'actor'
        && JSON.stringify(out.named.got) === JSON.stringify(out.named.expect),
        out.named ? `${out.named.mesh} -> ${(out.named.got || []).join(' ')}` : '');

  check('the self character reports a pawn id', !!out.modelId, out.modelId || '');
  for (const p of out.probes || []) {
    if (p.missing) { check(`phase: ${p.clip} has a step table`, false); continue; }
    const expected = p.expect.length * p.cycles;
    check(`phase: ${p.clip} fires ${expected} steps over ${p.cycles} cycles`,
          Math.abs(p.at.length - expected) <= 1,
          `${p.at.length} fired`);
    // every footfall must land on one of the authored notify times
    const tol = p.tol * 2 + 1e-6;
    const off = p.at.map(x => Math.min(...p.expect.map(u => Math.abs(x - u))));
    const worst = off.length ? Math.max(...off) : Infinity;
    check(`phase: ${p.clip} lands on the authored frames`, worst <= tol,
          `worst offset ${worst.toFixed(5)} of a cycle (tolerance ${tol.toFixed(5)}, `
          + `= ${(worst * p.dur * 1000).toFixed(1)} ms)`);
  }
  check('a real footstep chose a resolvable sound', !!out.ref, out.ref || '');
  check('that sound decodes to audio', !!out.decoded,
        out.decoded ? `${out.decoded.ch}ch ${out.decoded.dur.toFixed(2)}s` : '');
}

(async () => {
  const doc = dataChecks();
  if (doc) await browserChecks(doc);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(CHECK && fail ? 1 : 0);
})();
