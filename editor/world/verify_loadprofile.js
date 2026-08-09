// verify_loadprofile.js — where does the client's startup time actually go?
//
// WHY: the owner reports the client "loads a bit slower now". Nobody had a
// number, so every explanation was a guess. This measures instead.
//
// WHAT IT MEASURES, and how (each number's provenance is printed with it):
//
//   milestones   wall clock from navigationStart, taken from the browser's own
//                Navigation/Paint Timing entries and from a rAF stamp:
//                  domContentLoaded, firstPaint, firstContentfulPaint,
//                  worldReady (window.__world.ready flips true),
//                  firstFrameAfterReady (the first rAF callback after that),
//                  interactive (#loading loses .hidden => the scene is up)
//
//   phases       wall clock per engine phase, taken by WRAPPING the real
//                methods on Terrain.prototype (and on the Geodata / BspFloor
//                classes reached through a live instance) and timing them.
//                These are not estimates: each is `performance.now()` around
//                the actual call the client makes.
//                  heightmapFetch+geo   load() start -> _correctHeights start
//                  heightfix            _correctHeights
//                  terrainMesh          _buildMesh (incl. _buildMaterial)
//                  terrainMaterial      _buildMaterial (a subset of the above)
//                  water                _buildWater
//                  props                _loadProps / _loadPropsInstanced
//                  bsp                  _loadBsp (Bsp.load: fetch + gltf parse)
//                  neighbors            NeighborTiles.setCenter
//
//   cpu          self-time per source file from Chrome's sampling profiler
//                (CDP Profiler, 100us). Attributed by script URL, so "gltf
//                parse" is GLTFLoader.js's own self-time, not a guess about
//                which phase was slow.
//
//   network      per asset class from Resource Timing: request count, wall
//                time, transferSize and decodedBodySize. transferSize 0 with
//                a nonzero decodedBodySize is a cache hit — that is how the
//                cold and warm runs are told apart, rather than by assertion.
//
// COLD vs WARM. Cold = a throwaway --user-data-dir (empty disk cache) with
// Network.setCacheDisabled, i.e. what a first-time visitor pays. Warm = the
// same browser, cache on, loading the same tile again. Both are reported.
//
// GIRAN. boot() loads availableScenes[0], which is 16_21. So that the cold
// boot is the tile the owner is complaining about, the /scenes response is
// reordered in-page to put the Giran tile first. That is the ONLY behaviour
// this harness changes; nothing else is patched before the measurement.
//
// DELIBERATELY NOT AN OPTIMISATION. This suite reports; it changes nothing.
//
// CAVEAT, stated once so it is not forgotten: headless Chrome renders through
// SwiftShader (software GL) here, exactly like every other suite in the
// battery. GPU-bound work — texture upload, shader compile, the first draw —
// is therefore SLOWER and differently proportioned than on the owner's real
// GPU. CPU-side work (fetch, parse, mesh build, instancing) is representative;
// anything attributed to the renderer is not. Numbers are for comparing runs
// against each other, which is what --check does.
//
// Usage:
//   node verify_loadprofile.js                 measure and print the profile
//   node verify_loadprofile.js --json          the same, as JSON
//   node verify_loadprofile.js --tile 20_22    profile a different tile
//   node verify_loadprofile.js --save          write/refresh the baseline
//   node verify_loadprofile.js --check         re-measure, fail on regression
//
// --check compares against verify_loadprofile.baseline.json, which holds a
// MEASURED run, never a hand-picked target. The tolerance is a policy choice
// and is stated in TOLERANCE below.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'verify_shots');
const BASELINE = path.join(__dirname, 'verify_loadprofile.baseline.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const TILE = arg('--tile', '22_22');           // Giran
const CHECK = has('--check');
const SAVE = has('--save');
const JSON_ONLY = has('--json');

// A regression must clear BOTH bars to fail: relative and absolute. A 40%
// jump on a 20 ms phase is noise; on a 2 s phase it is the owner's complaint.
// SwiftShader under a loaded machine is genuinely noisy, hence the width.
const TOLERANCE = { rel: 1.40, absMs: 400 };

// ---------------------------------------------------------------------------
// In-page instrumentation. Installed before any page script runs.
// ---------------------------------------------------------------------------
function bootstrap(tile) {
  window.__prof = { fetches: [], longtasks: [], readyAt: null, firstFrameAfterReady: null,
    interactiveAt: null, phases: [] };
  // The Resource Timing buffer defaults to 250 entries and Giran alone pulls
  // 577 files out of props/ — without this the network table silently loses
  // most of the load and reads as if the tile were cheap.
  try { performance.setResourceTimingBufferSize(20000); } catch (_) { /* older engines */ }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const t0 = performance.now();
    const rec = { url, t0, t1: null };
    window.__prof.fetches.push(rec);
    const p = origFetch.apply(this, arguments);
    p.then(() => { rec.t1 = performance.now(); }, () => { rec.t1 = performance.now(); rec.failed = true; });
    // Put the profiled tile first so boot()'s `loadScene(scenes[0])` loads it.
    // The array is otherwise untouched.
    if (/\/scenes(\?|$)/.test(url)) {
      return p.then(res => {
        const clone = res.clone();
        return clone.json().then((list) => {
          if (Array.isArray(list) && list.includes(tile)) {
            const re = [tile, ...list.filter(t => t !== tile)];
            return new Response(JSON.stringify(re),
              { status: 200, headers: { 'content-type': 'application/json' } });
          }
          return res;
        }).catch(() => res);
      });
    }
    return p;
  };

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__prof.longtasks.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) { /* longtask unsupported: the section is simply reported empty */ }

  // worldReady / first frame after it / interactive (#loading hidden)
  const poll = () => {
    const p = window.__prof;
    if (p.readyAt == null && window.__world && window.__world.ready) {
      p.readyAt = performance.now();
      requestAnimationFrame(() => { p.firstFrameAfterReady = performance.now(); });
    }
    const el = document.getElementById('loading');
    if (p.interactiveAt == null && el && el.classList.contains('hidden')) {
      p.interactiveAt = performance.now();
    }
    if (p.readyAt == null || p.interactiveAt == null) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

// ---------------------------------------------------------------------------
// Phase wrappers, installed in-page against the REAL classes (reached through
// a live Terrain instance), so each phase number is a timing of the actual
// call rather than a share-out of a total.
// ---------------------------------------------------------------------------
function installPhaseWrappers() {
  const w = window.__world;
  const t = w.terrain;
  if (!t) return { ok: false, why: 'no terrain instance yet' };
  const proto = Object.getPrototypeOf(t);
  window.__prof.cur = {};
  const wrap = (obj, name, label) => {
    const fn = obj && obj[name];
    if (typeof fn !== 'function' || fn.__profWrapped) return false;
    const wrapped = function (...args) {
      const t0 = performance.now();
      // Read __prof.cur at CALL time, not at install time: the harness swaps
      // in a fresh accumulator before each timed load, and a captured
      // reference would keep filling the old one (every run read as empty).
      const done = () => {
        const c = window.__prof.cur;
        c[label] = (c[label] || 0) + (performance.now() - t0);
      };
      let r;
      try { r = fn.apply(this, args); } catch (e) { done(); throw e; }
      if (r && typeof r.then === 'function') return r.then(v => { done(); return v; },
        e => { done(); throw e; });
      done();
      return r;
    };
    wrapped.__profWrapped = true;
    obj[name] = wrapped;
    return true;
  };
  const installed = [];
  for (const [name, label] of [
    ['load', 'terrainLoadTotal'],
    ['_correctHeights', 'heightfix'],
    ['_buildMesh', 'terrainMesh'],
    ['_buildMaterial', 'terrainMaterial'],
    ['_buildWater', 'water'],
    ['_loadProps', 'props'],
    ['_loadPropsInstanced', 'propsInstanced'],
    ['_loadBsp', 'bsp'],
  ]) if (wrap(proto, name, label)) installed.push(name);

  // Geodata / BspFloor are loaded by static methods on their own classes,
  // reachable only through a live instance. Absent on tiles that have none.
  if (t.geodata && t.geodata.constructor
      && wrap(t.geodata.constructor, 'load', 'geodata')) installed.push('Geodata.load');
  if (t.bspFloor && t.bspFloor.constructor
      && wrap(t.bspFloor.constructor, 'load', 'bspFloor')) installed.push('BspFloor.load');
  if (w.neighbors && wrap(Object.getPrototypeOf(w.neighbors), 'setCenter', 'neighbors')) {
    installed.push('NeighborTiles.setCenter');
  }
  return { ok: true, installed };
}

async function timedLoad(page, tile) {
  await page.evaluate(() => { window.__prof.cur = {}; });
  const total = await page.evaluate(async (t) => {
    const t0 = performance.now();
    await window.__world.loadScene(t);
    return performance.now() - t0;
  }, tile);
  const phases = await page.evaluate(() => window.__prof.cur);
  return { totalMs: +total.toFixed(1),
    phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, +v.toFixed(1)])) };
}

// ---------------------------------------------------------------------------
function classify(url) {
  // Filenames verified against assets/world/22_22/: heightmap.u16,
  // geodata.json/.bin, bspfloor.bin, bsp.gltf/.bin, props/*.gltf, basecolor.png
  if (/\/scene\.json$/.test(url)) return 'scene.json';
  if (/heightmap\.(u16|png)$/i.test(url)) return 'heightmap';
  if (/geodata\.(json|bin)$/i.test(url)) return 'geodata';
  if (/bspfloor\.bin$/i.test(url)) return 'bspfloor';
  if (/\/bsp\.(gltf|bin)$/i.test(url)) return 'bsp gltf';
  if (/\/props\//i.test(url)) return 'prop gltf+bin';
  if (/\.(gltf|glb)$/i.test(url)) return 'gltf';
  if (/\.bin$/i.test(url)) return 'other .bin';
  if (/\/ui\/|interface\.json|sysstring|\/skin|font/i.test(url)) return 'ui skin/font';
  if (/\/gamedata\//i.test(url)) return 'gamedata json';
  if (/\.(png|jpg|jpeg|dds|webp|tga)$/i.test(url)) return 'texture';
  if (/\.js$/i.test(url)) return 'javascript';
  if (/\.(ogg|mp3|wav)$/i.test(url)) return 'audio';
  if (/\.json$/i.test(url)) return 'other json';
  return 'other';
}

async function resourceSummary(page) {
  const rows = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({
    name: r.name, dur: r.duration, transfer: r.transferSize, decoded: r.decodedBodySize,
  })));
  const by = {};
  for (const r of rows) {
    const k = classify(r.name);
    const b = by[k] || (by[k] = { requests: 0, wallMs: 0, transferBytes: 0, decodedBytes: 0, cacheHits: 0 });
    b.requests++; b.wallMs += r.dur; b.transferBytes += r.transfer || 0;
    b.decodedBytes += r.decoded || 0;
    if ((r.transfer || 0) === 0 && (r.decoded || 0) > 0) b.cacheHits++;
  }
  for (const b of Object.values(by)) b.wallMs = +b.wallMs.toFixed(1);
  return by;
}

function cpuByScript(profile) {
  // Chrome's sampling profiler: self-time per node = samples * interval.
  if (!profile || !profile.nodes || !profile.samples || !profile.samples.length) return {};
  const byId = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  const hits = new Map();
  const total = profile.samples.length;
  for (const s of profile.samples) hits.set(s, (hits.get(s) || 0) + 1);
  const durUs = (profile.endTime - profile.startTime);
  const perSample = total ? durUs / total / 1000 : 0;   // ms per sample
  const out = {};
  for (const [id, count] of hits) {
    const n = byId.get(id);
    if (!n) continue;
    const cf = n.callFrame || {};
    let key = cf.url || '(engine)';
    if (!cf.url) key = cf.functionName || '(engine)';
    else key = key.replace(/^https?:\/\/[^/]+/, '');
    out[key] = (out[key] || 0) + count * perSample;
  }
  // Fold to the buckets the owner cares about; anything unmatched keeps its
  // own file name so nothing is silently pooled into "other".
  const buckets = {};
  const add = (k, v) => { buckets[k] = +((buckets[k] || 0) + v).toFixed(1); };
  for (const [k, v] of Object.entries(out)) {
    if (/GLTFLoader/.test(k)) add('gltf parse (GLTFLoader.js)', v);
    else if (/\/js\/bsp/.test(k)) add('bsp build (js/bsp*.js)', v);
    else if (/\/js\/terrain\.js/.test(k)) add('terrain + prop instancing (js/terrain.js)', v);
    else if (/\/js\/geodata\.js/.test(k)) add('geodata (js/geodata.js)', v);
    else if (/\/js\/heightfix\.js/.test(k)) add('heightfix (js/heightfix.js)', v);
    else if (/\/js\/neighbors\.js/.test(k)) add('neighbor tiles (js/neighbors.js)', v);
    else if (/\/js\/ui\//.test(k)) add('UI windows (js/ui/*)', v);
    else if (/three\.module|\/vendor\/three/.test(k)) add('three.js core', v);
    else if (/\/js\//.test(k)) add('other client js', v);
    else add(k, v);
  }
  return Object.fromEntries(Object.entries(buckets).sort((a, b) => b[1] - a[1]));
}

async function profileRun({ cold }) {
  // Every puppeteer launch gets a throwaway profile, so a "warm" run in a
  // fresh browser would have had an EMPTY disk cache too — it would have
  // measured a cold load and called it warm. The warm run therefore primes
  // the cache with a full first load in the SAME browser and profiles the
  // second one.
  const userDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'elbera-prof-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    userDataDir,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
    // puppeteer's default protocolTimeout is 180 s and the FIRST run of this
    // suite blew straight through it: one cache-disabled Giran reload —
    // 58 MB of prop glTF over ~600 HTTP/1.0 connections, decoded under
    // SwiftShader — takes longer than three minutes inside a single
    // page.evaluate. That is a finding, not a flake; do not lower this to
    // "make it fast", fix the load.
    protocolTimeout: 900000,
  });
  const run = { cold, consoleErrors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => run.consoleErrors.push(e.message));
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: !!cold });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });

    await page.evaluateOnNewDocument(bootstrap, TILE);

    // The sampling profiler is started AFTER the navigation commits, not
    // before: CDP's Profiler binds to the current execution context, and a
    // navigation replaces it — start-then-navigate can hand back an empty
    // profile. Everything the client does at startup (the async boot(), the
    // whole scene load) happens after DOMContentLoaded, so this loses only
    // the pre-DCL HTML/module parse, which the milestones already report.
    const bootOnce = async (profiled) => {
      await page.goto('http://127.0.0.1:8083/?cc=0', { waitUntil: 'domcontentloaded' });
      if (profiled) await cdp.send('Profiler.start');
      await page.waitForFunction('window.__world && window.__world.ready', { timeout: 180000 });
      await page.waitForFunction(
        () => window.__prof.interactiveAt != null && window.__prof.firstFrameAfterReady != null,
        { timeout: 60000 });
    };
    if (!cold) await bootOnce(false);     // prime the disk cache, discard

    const wall0 = Date.now();
    await bootOnce(true);
    run.bootWallMs = Date.now() - wall0;
    const { profile } = await cdp.send('Profiler.stop');
    run.cpuSamples = (profile && profile.samples && profile.samples.length) || 0;

    run.tileBooted = await page.evaluate(() => window.__world.currentTile);
    run.milestones = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paint = {};
      for (const p of performance.getEntriesByType('paint')) paint[p.name] = +p.startTime.toFixed(1);
      const pr = window.__prof;
      return {
        domContentLoaded: +(nav.domContentLoadedEventEnd || 0).toFixed(1),
        loadEvent: +(nav.loadEventEnd || 0).toFixed(1),
        firstPaint: paint['first-paint'] ?? null,
        firstContentfulPaint: paint['first-contentful-paint'] ?? null,
        worldReady: pr.readyAt == null ? null : +pr.readyAt.toFixed(1),
        firstFrameAfterReady: pr.firstFrameAfterReady == null ? null
          : +pr.firstFrameAfterReady.toFixed(1),
        interactive: pr.interactiveAt == null ? null : +pr.interactiveAt.toFixed(1),
      };
    });
    run.cpuMs = cpuByScript(profile);
    run.network = await resourceSummary(page);
    run.longtasks = await page.evaluate(() => {
      const l = window.__prof.longtasks;
      return { count: l.length, totalMs: +l.reduce((a, b) => a + b.dur, 0).toFixed(1),
        worstMs: l.length ? +Math.max(...l.map(x => x.dur)).toFixed(1) : 0 };
    });

    // --- instrumented reloads of the SAME tile ------------------------------
    // Guarded: the boot profile above is the primary deliverable and must
    // survive a failure down here. The first version of this suite lost the
    // ENTIRE run to a protocolTimeout in this section and printed nothing.
    run.reloadColdAssets = { totalMs: 0, phases: {} };
    run.reloadWarm = { totalMs: 0, phases: {} };
    try {
      run.wrappers = await page.evaluate(installPhaseWrappers);
      // warm reload first: everything served from cache. This is the cheap,
      // reliable one, so it is taken before anything that can hang.
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      await timedLoad(page, TILE);                    // prime
      run.reloadWarm = await timedLoad(page, TILE);
      // Cache-disabled reload is OPT-IN (--cold-reload). It refetches the
      // centre tile AND the 3x3 neighbourhood — hundreds of megabytes over
      // HTTP/1.0 connections that close after every file — and blew through
      // a 15-minute protocolTimeout on this machine. That duration is itself
      // reported below; it is not a harness flake.
      if (has('--cold-reload')) {
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        run.reloadColdAssets = await timedLoad(page, TILE);
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      }
    } catch (err) {
      run.reloadError = err.message;
    }

    run.propsCount = await page.evaluate(() =>
      (window.__world.terrain.def.props || []).length);
    await page.screenshot({ path: path.join(OUT, `loadprofile_${cold ? 'cold' : 'warm'}.png`) });
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  return run;
}

// NOTE — there is deliberately NO "props disabled" comparison run here.
// `?propDist=0` looks like it would give one, but it does not: Terrain
// ._loadProps always fetches, parses and instances every placement, and
// setPropDrawDistance treats 0 as "no culling" (`const v = !dist || ...`),
// so propDist=0 loads MORE visible geometry, not less. A run against it
// would have looked like a control and measured nothing. The prop pipeline
// is priced instead from the `props` phase, which wraps the real
// _loadProps call.

function fmt(ms) { return `${String(Math.round(ms)).padStart(6)} ms`; }

function report(res) {
  const lines = [];
  const p = s => lines.push(s);
  p('');
  p(`LOAD PROFILE — tile ${res.tile} (booted: ${res.cold.tileBooted}), `
    + `${res.cold.propsCount} prop placements`);
  p(`headless Chrome + SwiftShader; GPU-side numbers are NOT representative`);
  p(`tree: ${res.treeBefore.head}, ${res.treeBefore.dirtyFiles} file(s) dirty`
    + (res.treeChangedDuringRun
      ? '  *** THE TREE CHANGED DURING THIS RUN — numbers are not comparable ***'
      : ''));
  p('');
  for (const [label, run] of [['COLD (empty disk cache)', res.cold], ['WARM (cache primed)', res.warm]]) {
    p(`== ${label} ==`);
    p('  milestones (ms from navigationStart)');
    for (const [k, v] of Object.entries(run.milestones)) {
      p(`    ${k.padEnd(24)} ${v == null ? '     n/a' : fmt(v)}`);
    }
    p(`    ${'(wall clock, harness)'.padEnd(24)} ${fmt(run.bootWallMs)}`);
    p('  network by asset class (requests / wall ms / transferred KB / decoded KB / cache hits)');
    for (const [k, v] of Object.entries(run.network).sort((a, b) => b[1].wallMs - a[1].wallMs)) {
      p(`    ${k.padEnd(18)} ${String(v.requests).padStart(5)} ${String(Math.round(v.wallMs)).padStart(8)}`
        + ` ${String(Math.round(v.transferBytes / 1024)).padStart(9)} `
        + `${String(Math.round(v.decodedBytes / 1024)).padStart(9)} ${String(v.cacheHits).padStart(6)}`);
    }
    p(`  cpu self-time by source (sampling profiler, post-DCL; ${run.cpuSamples} samples)`);
    if (!run.cpuSamples) p('    (profiler returned no samples — treat this section as missing)');
    for (const [k, v] of Object.entries(run.cpuMs)) {
      if (v < 1) continue;
      p(`    ${k.padEnd(42)} ${fmt(v)}`);
    }
    p(`  long tasks: ${run.longtasks.count}, total ${run.longtasks.totalMs} ms, `
      + `worst ${run.longtasks.worstMs} ms`);
    p('  scene reload, per phase (wrapped real methods; nesting noted)');
    p('    terrainMesh contains terrainMaterial; props contains propsInstanced;');
    p('    terrainLoadTotal contains every phase below it. "unattributed" is the');
    p('    remainder of Terrain.load() — heightmap fetch + decode, interior');
    p('    detection, fire lights — nothing is silently dropped.');
    if (run.reloadError) p(`    !! reload phase failed: ${run.reloadError}`);
    const NESTED = new Set(['terrainMaterial', 'propsInstanced', 'terrainLoadTotal']);
    const reloads = [['assets warm', run.reloadWarm]];
    if (run.reloadColdAssets && run.reloadColdAssets.totalMs) {
      reloads.unshift(['assets cold', run.reloadColdAssets]);
    }
    for (const [tag, r] of reloads) {
      p(`    [${tag}] loadScene total ${fmt(r.totalMs)}`);
      const leaves = Object.entries(r.phases).filter(([k]) => !NESTED.has(k));
      const sum = leaves.reduce((a, [, v]) => a + v, 0);
      for (const [k, v] of Object.entries(r.phases).sort((a, b) => b[1] - a[1])) {
        p(`       ${k.padEnd(22)} ${fmt(v)}${NESTED.has(k) ? '   (contains others)' : ''}`);
      }
      if (r.phases.terrainLoadTotal != null) {
        p(`       ${'unattributed'.padEnd(22)} ${fmt(r.phases.terrainLoadTotal - sum)}`);
      }
      p(`       ${'outside Terrain.load'.padEnd(22)} `
        + `${fmt(r.totalMs - (r.phases.terrainLoadTotal || 0) - (r.phases.neighbors || 0))}`);
    }
    p('');
  }
  p('== is the +6,782 prop wave (commit 398286c) the slowdown? ==');
  const propsWarm = (res.cold.reloadWarm.phases || {}).props;
  const n = res.cold.propsCount;
  p(`    Giran placements now                  ${n}   (measured from scene.json)`);
  p(`    props phase, assets warm              ${fmt(propsWarm || 0)}`);
  if (propsWarm && n) {
    p(`    per placement, assets warm            ${(propsWarm / n).toFixed(3)} ms`);
    p('');
    p('    Commit 398286c\'s own text reports 1891 placements for 22_22 measured');
    p('    BEFORE its extraction fix landed. Against the ' + n + ' measured now that is');
    p(`    +${n - 1891} placements (+${((n - 1891) / 1891 * 100).toFixed(1)}%), i.e. about `
      + `${((propsWarm / n) * (n - 1891)).toFixed(0)} ms warm.`);
    p('    Caveat, stated rather than hidden: scene.json is gitignored, so the 1891');
    p('    baseline comes from that commit message, not from a file this run read.');
  }
  p('');
  return lines.join('\n');
}

function flatten(res) {
  const out = {};
  for (const [tag, run] of [['cold', res.cold], ['warm', res.warm]]) {
    for (const [k, v] of Object.entries(run.milestones)) if (v != null) out[`${tag}.${k}`] = v;
    out[`${tag}.reloadWarmTotal`] = run.reloadWarm.totalMs;
    out[`${tag}.reloadColdTotal`] = run.reloadColdAssets.totalMs;
    for (const [k, v] of Object.entries(run.reloadWarm.phases)) out[`${tag}.phase.${k}`] = v;
  }
  return out;
}

// Two agents edit this repo concurrently. A profile taken over a tree that
// was being written mid-run is not comparable to one taken over a clean tree,
// and nothing in the numbers themselves would ever reveal that. Record it.
function treeState() {
  const { execSync } = require('child_process');
  const sh = (c) => { try { return execSync(c, { cwd: __dirname, encoding: 'utf8' }).trim(); }
    catch (_) { return '?'; } };
  const dirty = sh('git status --porcelain').split('\n').filter(Boolean);
  return { head: sh('git rev-parse --short HEAD'), dirtyFiles: dirty.length,
    dirty: dirty.slice(0, 40).map(s => s.trim()) };
}

// MACHINE STATE, recorded for the same reason as treeState: a profile taken on
// a machine that was already busy is not comparable to one taken on an idle
// one, and nothing in the numbers reveals it.
//
// This is not hypothetical. The baseline that was on disk
// (verify_loadprofile.baseline.json, at 2026-08-08T21:06Z) was captured while
// `tools/world/bspfloor.py --all` was still rewriting the very tile being
// profiled — assets/world/22_22/bspfloor.bin has mtime 17:14 local, EIGHT
// MINUTES AFTER the profile run started at 17:06, and the extraction job ran
// until 17:21. It reported cold worldReady 158,153 ms and warm 147,188 ms, and
// its reloadWarmTotal was 0, i.e. the phase breakdown — the only part anyone
// would act on — never got captured at all. A --check against that baseline
// was measuring "is the machine as busy today as it was then".
// BASELINE_FORMAT 2 adds provenance. A format-1 baseline is REFUSED rather
// than silently trusted: it carries no record of the tree or the machine it
// was taken on, and the one that shipped was taken over a tree being
// rewritten. Returns null when the baseline is usable, else why not.
const BASELINE_FORMAT = 2;
function baselineComplaint(base) {
  if ((base.format || 1) < BASELINE_FORMAT) {
    return `the baseline at ${BASELINE} is format ${base.format || 1} (captured `
      + `${base.at}) and carries no record of the tree or the machine it was taken `
      + 'on. It is refused rather than trusted. Re-baseline on an idle machine '
      + 'with a clean tree: node verify_loadprofile.js --save';
  }
  const p = base.provenance || {};
  if (p.treeChangedDuringRun) {
    return `the baseline at ${BASELINE} was captured while the working tree was `
      + 'CHANGING under it. Re-baseline.';
  }
  if (!p.phasesCaptured) {
    return `the baseline at ${BASELINE} has no phase timings (reloadError: `
      + `${p.reloadError || 'none recorded'}). Milestones alone cannot tell a slow `
      + 'BSP build from a slow prop fetch; a check against them is mostly a check '
      + 'on how busy the machine was. Re-baseline.';
  }
  return null;
}

function machineState() {
  const os = require('os');
  return {
    cpus: os.cpus().length,
    loadavg: os.loadavg().map(v => +v.toFixed(2)),
    freeMemMB: Math.round(os.freemem() / 1048576),
    platform: `${os.platform()} ${os.release()}`,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Validate the baseline BEFORE spending ~40 minutes measuring against it.
  // The first version of this guard sat at the bottom of the script, which
  // meant a run could complete and only then announce that its yardstick was
  // unusable.
  if (CHECK && !SAVE && fs.existsSync(BASELINE)) {
    const why = baselineComplaint(JSON.parse(fs.readFileSync(BASELINE, 'utf8')));
    if (why) {
      console.error(`VERIFY LOADPROFILE FAILED: ${why}`);
      process.exit(2);
    }
  }
  const res = { tile: TILE, at: new Date().toISOString(),
    treeBefore: treeState(), machineBefore: machineState() };
  res.cold = await profileRun({ cold: true });
  res.warm = await profileRun({ cold: false });
  res.treeAfter = treeState();
  res.machineAfter = machineState();
  res.treeChangedDuringRun =
    JSON.stringify(res.treeBefore) !== JSON.stringify(res.treeAfter);

  if (JSON_ONLY) console.log(JSON.stringify(res, null, 2));
  else console.log(report(res));

  const flat = flatten(res);
  if (SAVE || (CHECK && !fs.existsSync(BASELINE))) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      format: BASELINE_FORMAT, tile: TILE, at: res.at, metrics: flat,
      provenance: {
        head: res.treeBefore.head,
        dirtyFiles: res.treeBefore.dirtyFiles,
        treeChangedDuringRun: res.treeChangedDuringRun,
        machineBefore: res.machineBefore, machineAfter: res.machineAfter,
        propsCount: res.cold.propsCount,
        phasesCaptured: Object.keys(res.warm.reloadWarm.phases).length,
        reloadError: res.warm.reloadError || res.cold.reloadError || null,
      },
    }, null, 2));
    console.log(`baseline written: ${BASELINE}`);
    if (!CHECK) return;
  }
  if (!CHECK) return;

  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const complaint = baselineComplaint(base);
  if (complaint) { console.error(`VERIFY LOADPROFILE FAILED: ${complaint}`); process.exit(2); }
  const prov = base.provenance || {};
  console.log(`baseline ${base.at}  head ${prov.head}  `
    + `loadavg at capture ${JSON.stringify(prov.machineBefore && prov.machineBefore.loadavg)}  `
    + `loadavg now ${JSON.stringify(res.machineBefore.loadavg)}`);
  const regressions = [];
  for (const [k, v] of Object.entries(flat)) {
    const b = base.metrics[k];
    if (b == null) continue;
    if (v > b * TOLERANCE.rel && v - b > TOLERANCE.absMs) {
      regressions.push(`${k}: ${Math.round(b)} -> ${Math.round(v)} ms`);
    }
  }
  for (const r of regressions) console.log(`FAIL  ${r}`);
  if (!regressions.length) {
    console.log(`PASS  no phase regressed past ${TOLERANCE.rel}x + ${TOLERANCE.absMs} ms `
      + `vs the baseline of ${base.at}`);
    return;
  }
  console.error(`VERIFY LOADPROFILE FAILED: ${regressions.length} phase(s) regressed`);
  process.exit(1);
})().catch(e => { console.error('VERIFY LOADPROFILE FAILED:', e.stack || e.message); process.exit(1); });
