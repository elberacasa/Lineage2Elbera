// Creature + player ANIMATION BINDING verification.
//
// Asserts three things that have each been wrong in this repo before:
//
//  1. THE BINDING TABLE.  For all 495 spawnable creatures: the clips the glTF
//     actually carries, the clips the retail .ukx actually contains (umodel
//     is the oracle, via tools/anim/export_psa.sh + audit_bindings.py), and
//     what entities.js:mapAnimations() resolves them to at runtime.
//
//  2. THE BUCKETED COUNTS.  fully bound / partially bound / static, plus the
//     per-slot split between an honest retail GAP and a clip the pipeline
//     DROPPED.  Frozen in tools/anim/baseline.json; any drift fails.
//
//  3. THE SOURCE GUARD.  The audit replays mapAnimations()' keyword lists and
//     its `first` fallback in Python.  A replay is only valid while the thing
//     it replays is unchanged, so the exact keyword literals are asserted
//     against editor/world/js/entities.js.  If that function is edited, this
//     fails loudly instead of silently reporting stale numbers.
//
// Player stances are checked from the manifest directly: every model must
// carry idle/walk/run/atk01/atkwait for all six stances, so a 1HS swing can
// never fall back to the unarmed clip.  The known-empty cells (no Atk02_Bow,
// no Atk03_Dual, ShieldAtk only for 1HS) are asserted as gaps, because that
// is what retail ships -- see the MFighter_anim.psa listing.
//
// Usage:
//   node verify_anim.js            report
//   node verify_anim.js --check    assert everything, exit 1 on drift
//   node verify_anim.js --shots    also render the before/after comparison
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const ANIMDIR = path.join(ROOT, 'tools', 'anim');
const OUT = path.join(__dirname, 'verify_shots');

const CHECK = process.argv.includes('--check');
const SHOTS = process.argv.includes('--shots');

const summary = { checks: [], failed: false };
function check(name, ok, detail) {
  summary.checks.push({ name, ok: !!ok, detail });
  if (!ok) summary.failed = true;
}

// ---------------------------------------------------------------- 3. guard
// The literal keyword lists audit_bindings.py replays. Kept as source text so
// a change to mapAnimations() cannot pass unnoticed.
const MAPANIM_GUARD = [
  "find('idle', 'wait', 'stand') || first",
  "find('walk') || first",
  "find('run') || find('walk') || first",
  "find('attack', 'atk', 'hit') || first",
  "find('special') || find('attack') || first",
  "find('die', 'death', 'dead') || first",
];

function sourceGuard() {
  const src = fs.readFileSync(
    path.join(__dirname, 'js', 'entities.js'), 'utf8');
  const missing = MAPANIM_GUARD.filter(s => !src.includes(s));
  check('entities.js mapAnimations() unchanged since the audit replayed it',
    missing.length === 0,
    missing.length ? `these lines no longer appear: ${JSON.stringify(missing)}`
      + ' -- re-run tools/anim/audit_bindings.py and refresh the baseline'
      : 'all 6 state mappings match');
}

// Key-ORDER-INDEPENDENT serialisation for the baseline diff.
//
// FIXED 2026-08-09. The drift check used JSON.stringify directly, which is
// order-sensitive for objects, and the baseline has TWO writers that disagree
// about order: audit_bindings.py --check writes it with sort_keys=True
// (alphabetical), this file writes it with JSON.stringify (Python insertion
// order: idle, walk, run, attack, die). So regenerating the baseline from the
// Python side made every nested count "drift" -- {"attack":0,"die":2,...} vs
// {"idle":4,"walk":0,...} -- with identical NUMBERS on both sides. A diff that
// reports a failure when nothing changed is how a red suite gets ignored.
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map(
    k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

// --------------------------------------------------- 1+2. audit + buckets
function runAudit() {
  const raw = execFileSync('python3',
    [path.join(ANIMDIR, 'audit_bindings.py'), '--json'],
    { maxBuffer: 1 << 28, cwd: ROOT }).toString();
  return JSON.parse(raw);
}

function auditChecks(audit) {
  const s = audit.summary;
  const basePath = path.join(ANIMDIR, 'baseline.json');
  check('every manifest creature was audited', s.creatures === 495,
    `${s.creatures} creatures`);
  check('every bound MeshAnimation exported a .psa', s.psa_missing === 0,
    `${s.psa_missing} missing -- re-run tools/anim/export_psa.sh`);

  const b = s.buckets;
  check('bucket totals cover every creature',
    b.full + b.partial + b.none === s.creatures,
    `full ${b.full} / partial ${b.partial} / static ${b.none}`);

  // The skill-cast slot, against the client's own MagicShotAnimName rather
  // than a name convention. Zero is the whole point: a creature that "casts"
  // by standing in a wait pose is the bug commit 3dc180e closed, and the
  // metric that was supposed to hold it shut could not see it (see the
  // rename note below and audit_bindings.py --selftest).
  check('no creature plays a WAIT pose where retail names a real cast clip',
    s.special_serves_wait_not_cast === 0,
    `${s.special_serves_wait_not_cast} creatures serve a wait pose`);

  // A creature that ships NO clips must be one that genuinely has nothing to
  // bind. Nine do not: they carry a real MeshAnimation with real sequences and
  // still shipped static. That is a pipeline defect, not a retail gap, and it
  // is held at its known value so it cannot grow unnoticed.
  const silent = Object.entries(audit.creatures).filter(
    ([, r]) => !r.shipped.length && r.anim && r.retail.length);
  check('no NEW creature ships static despite having a retail animation set',
    silent.length <= 9,
    `${silent.length}: ${silent.map(([m]) => m).join(', ')}`);

  if (!fs.existsSync(basePath)) {
    fs.writeFileSync(basePath, JSON.stringify(s, null, 1));
    check('baseline written (first run)', true, basePath);
    return;
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const drift = Object.keys({ ...base, ...s }).filter(
    k => stable(base[k]) !== stable(s[k]));
  check('binding table + bucketed counts match the frozen baseline',
    drift.length === 0,
    drift.length ? drift.map(k =>
      `${k}: ${stable(base[k])} -> ${stable(s[k])}`).join('; ')
      : 'no drift');
}

// ------------------------------------------------------------- player set
const STANCES = ['hand', '1hs', '2hs', 'dual', 'bow', 'pole'];
// Per-model retail sequence lists, exported from each model's OWN animation
// set (tools/anim/player_animsets.json; the model -> prefix mapping is
// build_characters.py:COMBOS, the sequences are umodel's).
//
// Derived per model on purpose. Reading one race's set and applying it to all
// of them is wrong: MOrc/FOrc/MShaman/FShaman ship Atk02_Hand and Atk03_Hand
// -- unarmed combo strikes the other five races genuinely do not have -- so a
// table taken from MFighter alone reports the orc models as carrying clips
// "retail does not have", when retail does.
const PLAYER_SETS = JSON.parse(fs.readFileSync(
  path.join(ANIMDIR, 'player_animsets.json'), 'utf8'));
const STANCED_ACTIONS = ['idle', 'walk', 'run', 'atk01', 'atk02', 'atk03',
  'atkwait', 'shieldatk'];
// build_characters.py renames exactly these on the way into the glTF; every
// other sequence keeps its retail spelling, lowercased.
const RENAMED = { wait: 'idle', death: 'die', sitwait: 'sit' };

function playerChecks() {
  const models = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'editor/characters/manifest.json'), 'utf8')).models;
  check('all 14 player models present', models.length === 14,
    `${models.length}`);

  // The trap this exists for: a one-hand-sword swing must not play the fists
  // clip. character.js:_clip() falls back to the unstanced name when the
  // stanced clip is absent, so absence IS the bug.
  const core = ['idle', 'walk', 'run', 'atk01', 'atkwait'];
  const holes = [];
  for (const m of models) {
    const have = new Set(m.animations.map(x => x.toLowerCase()));
    for (const st of STANCES) {
      for (const ac of core) {
        if (!have.has(`${ac}_${st}`)) holes.push(`${m.id}:${ac}_${st}`);
      }
    }
  }
  check('every player model carries idle/walk/run/atk01/atkwait in all 6 '
    + 'stances (no stanced action can fall back to the unarmed clip)',
    holes.length === 0, holes.length ? holes.join(', ') : '14 x 6 x 5 = 420 clips');

  // Every stanced sequence the model's OWN retail set contains must have
  // shipped, and nothing may have shipped that its retail set lacks. The 1:1
  // assertion: no invented clips, no silently dropped ones.
  const extra = [];
  const dropped = [];
  for (const m of models) {
    const set = PLAYER_SETS[m.id];
    if (!set) { extra.push(`${m.id}: no retail set recorded`); continue; }
    const retail = new Set(set.retail.map(s => {
      const l = s.toLowerCase();
      const head = l.split('_')[0];
      return RENAMED[head] ? l.replace(head, RENAMED[head]) : l;
    }));
    const have = new Set(m.animations.map(x => x.toLowerCase()));
    for (const ac of STANCED_ACTIONS) {
      for (const st of STANCES) {
        const k = `${ac}_${st}`;
        if (retail.has(k) && !have.has(k)) dropped.push(`${m.id}:${k}`);
        if (!retail.has(k) && have.has(k)) extra.push(`${m.id}:${k}`);
      }
    }
  }
  check('every stanced clip in each model\'s own retail set shipped',
    dropped.length === 0, dropped.slice(0, 10).join(', ') || 'none dropped');
  check('no player model carries a stanced clip retail does not have',
    extra.length === 0, extra.slice(0, 10).join(', ') || 'none invented');

  const need = ['die', 'damage', 'sit', 'dance', 'castshort', 'castmid',
    'castlong', 'magicthrow'];
  const nonStance = [];
  for (const m of models) {
    const have = new Set(m.animations.map(x => x.toLowerCase()));
    for (const k of need) if (!have.has(k)) nonStance.push(`${m.id}:${k}`);
  }
  check('death / damage / sit / cast / dance present on every player model',
    nonStance.length === 0, nonStance.join(', ') || need.join(', '));

  // The social actions. actionname.dat defines 12 emotes (actionIds 2..13).
  //
  // THIS CHECK WAS INVERTED ON 2026-08-09. It used to assert `socials === 0`
  // as a KNOWN GAP -- "the pipeline extracted only Social_dance, so all 12
  // ids play dance" -- with a note that it would fire the day someone fixed
  // it. Commit 3dc180e fixed it, the tripwire fired exactly as designed, and
  // then it sat red for two waves because a FIRED tripwire and a BROKEN suite
  // look identical in a results table. A tripwire that has served its purpose
  // has to be converted into the positive assertion it was guarding for,
  // otherwise the battery reports a success as a failure forever.
  //
  // Measured now: 14 models x 12 ids = 168 resolutions, 168 land on a clip
  // the model actually ships (11 social_* clips + `dance` for id 12).
  const emoteHoles = [];
  for (const m of models) {
    const have = new Set(m.animations.map(x => x.toLowerCase()));
    const t = m.socialActions || {};
    for (let id = 2; id <= 13; id++) {
      const clip = t[String(id)];
      if (!clip) emoteHoles.push(`${m.id}:${id} unmapped`);
      else if (!have.has(clip.toLowerCase())) {
        emoteHoles.push(`${m.id}:${id} -> ${clip} (not shipped)`);
      }
    }
  }
  check('every player model resolves all 12 SocialAction ids to a clip it '
    + 'actually ships (no emote falls back to "dance")',
    emoteHoles.length === 0,
    emoteHoles.length ? emoteHoles.slice(0, 12).join(', ')
      : `${models.length} models x 12 ids = ${models.length * 12} resolutions`);

  // The distinctness that the old gap was really about: if the pipeline ever
  // regresses to extracting one clip, every id would map to the same name and
  // the resolution check above would still pass.
  const distinct = new Set();
  for (const m of models) {
    for (let id = 2; id <= 13; id++) {
      const c = (m.socialActions || {})[String(id)];
      if (c) distinct.add(`${m.id}:${c.toLowerCase()}`);
    }
  }
  check('the 12 emotes are 12 DISTINCT clips per model, not one clip reused',
    distinct.size === models.length * 12,
    `${distinct.size} distinct model/clip pairs, expected ${models.length * 12}`);
}

// ------------------------------------------------------------------ shots
async function shots(audit) {
  const puppeteer = require(path.join(ROOT,
    'tools/src/char_pipeline/node_modules/puppeteer-core'));
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const before = path.join(ROOT, 'editor/characters/monsters/models/skeleton_m00.gltf');
  const after = path.join(ANIMDIR, 'rebuilt/skeleton_m00.gltf');
  if (!fs.existsSync(after)) {
    check('rebuilt comparison model exists', false,
      'run: python3 tools/anim/rebuild_one.py skeleton_m00');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });

  // A throwaway static server rooted at the repo, so the page can reach both
  // the SHIPPED model under editor/characters/ and the REBUILT one under
  // tools/anim/rebuilt/ with plain absolute URLs. ES modules will not load
  // over file://, and nothing is copied into the served tree.
  const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream', '.png': 'image/png',
  };
  const srv = require('http').createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(8099, '127.0.0.1', r));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,560'],
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 900, height: 560 });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8099/tools/anim/compare.html',
    { waitUntil: 'load' });
  await p.waitForFunction('window.__ready === true', { timeout: 60000 });
  const clips = await p.evaluate('window.__clips');
  const shot = path.join(OUT, 'anim_special_before_after.png');
  await p.screenshot({ path: shot });
  await browser.close();
  srv.close();

  check('both comparison models exposed their clip',
    Array.isArray(clips) && clips.every(Boolean),
    `before/after clip found: ${JSON.stringify(clips)}`
    + (errs.length ? ` console: ${errs.slice(0, 2).join(' | ')}` : ''));
  check('before/after shot rendered', fs.existsSync(shot), shot);
  void before; void after; void audit;
}

(async () => {
  sourceGuard();
  const audit = runAudit();
  auditChecks(audit);
  playerChecks();
  if (SHOTS) await shots(audit);

  const s = audit.summary;
  console.log('=== creature animation binding ===');
  console.log(`  creatures                : ${s.creatures}`);
  console.log(`  fully bound              : ${s.buckets.full}`);
  console.log(`  partially bound          : ${s.buckets.partial}`);
  console.log(`  static (no clips at all) : ${s.buckets.none}`);
  console.log(`  no Animation reference   : ${s.no_anim_binding}`);
  console.log('  per-slot dropped/gap     : '
    + Object.keys(s.dropped_by_slot).map(k =>
      `${k} ${s.dropped_by_slot[k]}/${s.gap_by_slot[k]}`).join('  '));
  // RENAMED 2026-08-09 with the audit's metric. The old line printed
  // `special_is_wait_not_spatk`, a number that COUNTED CORRECT CREATURES:
  // audit_bindings.py --selftest shows it reads 196 both before and after a
  // seeded regression to wait poses, i.e. it never inspected the clip at all.
  console.log('  special slot vs the client\'s own MagicShotAnimName: '
    + `${s.special_serves_retail_cast} correct, `
    + `${s.special_serves_wait_not_cast} serving a wait pose, `
    + `${s.special_serves_other_mismatch} other mismatch`);
  console.log('');
  for (const c of summary.checks) {
    console.log(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name}`);
    if (!c.ok || !CHECK) console.log(`         ${c.detail}`);
  }
  if (summary.failed) {
    console.error('\nANIMATION VERIFICATION FAILED');
    process.exit(1);
  }
  console.log('\nall animation checks passed');
})().catch(e => { console.error(e); process.exit(1); });
