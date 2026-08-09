// verify_loadprofile.js — where does the client's startup time actually go?
//
// WHY: the owner reports the client "loads a bit slower now". Nobody had a
// number, so every explanation was a guess. This measures instead. It is a
// MEASUREMENT, not an optimisation: nothing under editor/world/js is changed.
//
// ---------------------------------------------------------------------------
// WHAT CHANGED IN THIS REVISION, and why the old numbers are void
// ---------------------------------------------------------------------------
//
// 1. THE GPU PATH. The previous revision hard-coded
//    `--use-angle=swiftshader`, i.e. it profiled software GL. Measured here
//    (tools/dev/gpuprobe, and re-measured every run and printed):
//        --headless=new --use-angle=swiftshader
//            ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...))
//        --headless=new   (no --use-angle)
//            ANGLE (Apple, ANGLE Metal Renderer: Apple M4)
//    So headless Chrome on this machine reaches the REAL GPU as long as
//    nothing forces ANGLE to SwiftShader. The default here is now the GPU
//    path; `--swiftshader` opts back into software and says so in the report.
//    Any number taken under SwiftShader is not comparable to one taken here.
//
// 2. BOOT PHASES, NOT JUST RELOAD PHASES. The previous revision could only
//    time a SECOND scene load, because it reached the Terrain prototype
//    through `window.__world.terrain` — and main.js assigns that only AFTER
//    `await t.load()` returns, so by the time the wrappers existed the load
//    being complained about was over. This revision installs the wrappers by
//    dynamically importing the very same ES modules main.js imports (module
//    instances are singletons, so `import('/js/terrain.js').Terrain` IS
//    main.js's Terrain), started as soon as the import map is parsed and
//    therefore long before boot() constructs a Terrain. Whether that race was
//    actually won is not assumed: every phase carries a call count, and
//    `wrappers.beforeFirstLoad` is reported. If it is ever false the boot
//    column is marked NOT CAPTURED rather than quietly reporting zeros.
//
// 3. ATTRIBUTION BY CONTROLLED VARIANT, not by arithmetic. "How much is the
//    walk raster" is answered by loading the same tile with the walk raster
//    absent, not by dividing a total. Variants (--variant, all measured, none
//    inferred):
//      full        the tree as it ships
//      walktrunc   bspfloor.bin truncated at its 'WALK' magic, served through
//                  CDP. That is EXACTLY the pre-walk-raster file: section 2 is
//                  documented as optional and appended, bspfloor.js's parser
//                  stops cleanly at section 1, and the commit that added it
//                  states section 1 is byte-identical. Measured on 22_22:
//                  section 1 = 77 818 B, section 2 = 1 333 933 B, total/s1 =
//                  18.14x — which is the "~18x growth" independently
//                  reproduced from the file itself.
//      bspfloor-off  ?bspfloor=off — the client's own switch; no raster at all
//      walkraster-off ?walkraster=off — section 2 is fetched AND parsed, then
//                  discarded. Differencing this against `full` prices what
//                  CONSUMING the raster costs (heightfix, drawnGroundL2),
//                  separately from what fetching and parsing it costs.
//      props<N>    scene.json's props array truncated to N placements, served
//                  through CDP. Marginal cost of placements; see the caveat
//                  printed with it.
//
// 4. THE HTTP/1.0 QUESTION (task #17) IS AN A/B, NOT A MODEL. `--port`
//    aims the whole profile at another server. tools/dev/keepalive_server.py
//    is editor/world/server.py with one class attribute changed
//    (protocol_version = "HTTP/1.1"), so pointing this suite at it and at
//    :8083 in turn measures the connection-per-asset cost end to end, with
//    the same client and the same bytes. tools/dev/measure_http.py prices one
//    connection in isolation; this prices the whole load.
//
// ---------------------------------------------------------------------------
// WHAT IS MEASURED
// ---------------------------------------------------------------------------
//   milestones   wall clock from navigationStart: Navigation/Paint Timing
//                plus a rAF stamp — domContentLoaded, firstPaint, FCP,
//                worldReady (window.__world.ready), firstFrameAfterReady,
//                interactive (#loading loses .hidden).
//   phases       performance.now() around the REAL method calls, captured for
//                the boot load and again for an instrumented reload.
//   network      per asset class from Resource Timing. transferSize 0 with a
//                nonzero decodedBodySize is a cache hit — that is how cold and
//                warm are told apart, rather than by assertion.
//   cpu          self-time per source file from the CDP sampling profiler.
//
// COLD vs WARM. Cold = a throwaway --user-data-dir, i.e. an EMPTY disk cache,
// with the cache ENABLED — what a first-time visitor actually pays. It is NOT
// `setCacheDisabled`; see the note on NOCACHE below for why that distinction
// changes the request count by thousands. Warm = the same browser, second
// load. `--nocache` measures the harsher disabled-cache arm on purpose.
//
// GIRAN. boot() loads availableScenes[0] (16_21). The /scenes reply is
// reordered in-page so the profiled tile boots. That is the ONLY behaviour
// this harness changes on the `full` variant.
//
// Usage:
//   node verify_loadprofile.js                    cold + warm profile
//   node verify_loadprofile.js --json
//   node verify_loadprofile.js --tile 20_22
//   node verify_loadprofile.js --variant walktrunc
//   node verify_loadprofile.js --nocache          cold with the cache DISABLED
//   node verify_loadprofile.js --port 8084        (keep-alive control server)
//   node verify_loadprofile.js --attribute        the variant matrix (task #25)
//   node verify_loadprofile.js --ab               HTTP/1.0 vs keep-alive (#17)
//   node verify_loadprofile.js --save             write/refresh the baseline
//   node verify_loadprofile.js --check            re-measure, fail on regression
//
// EVERY MEASURED RUN GETS ITS OWN FRESHLY-SPAWNED SERVER on its own port, and
// waits for the TIME_WAIT table to drain first. That is not fussiness: the
// first attribution matrix run against the shared :8083 process produced 36 s
// rows and ERR_CONNECTION_TIMED_OUT because the runs were poisoning each
// other. See the withServer/drain comments.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'verify_shots');
const BASELINE = path.join(__dirname, 'verify_loadprofile.baseline.json');

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const TILE = arg('--tile', '22_22');           // Giran
const PORT = Number(arg('--port', '8083'));
const VARIANT = arg('--variant', 'full');
const CHECK = has('--check');
const SAVE = has('--save');
const JSON_ONLY = has('--json');
const ATTRIBUTE = has('--attribute');
const AB = has('--ab');
const SWIFT = has('--swiftshader');
const SELFTEST = has('--selftest');

// A regression must clear BOTH bars to fail: relative and absolute. A 40%
// jump on a 20 ms phase is noise; on a 2 s phase it is the owner's complaint.
const TOLERANCE = { rel: 1.40, absMs: 400 };

// ---------------------------------------------------------------------------
// Asset variants, computed in Node from the files on disk and served through
// CDP Fetch. Nothing on disk is written; the real tree is untouched.
// ---------------------------------------------------------------------------
const WALK_MAGIC = 0x4b4c4157;

// Byte offset at which bspfloor.bin's optional section 2 begins, found by
// walking section 1's variable-length records exactly as bspfloor.js does.
// Returns null when the file has no section 2 (nothing to truncate).
function walkSectionOffset(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46505342) return null;
  const grid = buf.readUInt16LE(4);
  let p = 20;
  const n = grid * grid;
  for (let i = 0; i < n; i++) {
    if (p >= buf.length) return null;
    p += 1 + 2 * buf.readUInt8(p);
  }
  if (p + 4 > buf.length || buf.readUInt32LE(p) !== WALK_MAGIC) return null;
  return p;
}

function tileDir(tile) { return path.join(REPO, 'assets', 'world', tile); }

// URL -> {body: Buffer, mime} to serve instead, or null to let it through.
function variantBody(variant, url) {
  const m = /\/scenes(?:-hd)?\/([^/]+)\/(bspfloor\.bin|scene\.json|bsp\.gltf)$/.exec(url);
  if (!m) return null;
  const [, tile, file] = m;
  if (variant === 'walktrunc' && file === 'bspfloor.bin') {
    const p = path.join(tileDir(tile), 'bspfloor.bin');
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const off = walkSectionOffset(buf);
    if (off == null) return null;                      // already section-1 only
    return { body: buf.subarray(0, off), mime: 'application/octet-stream',
      note: `bspfloor.bin ${buf.length} -> ${off} B (section 2 removed)` };
  }
  // The pre-lightmap-wave BSP, reconstructed from the shipped one rather than
  // guessed: commit 053d0db/421d0f5 added exactly two things to bsp.gltf —
  // `materials[i].extras.lightmapSheet` (which is the ONLY thing that makes
  // Bsp._loadLightmaps fetch an atlas, and the only thing _prepMaterial keys
  // the lightMap path off) and a TEXCOORD_1 attribute per primitive (which is
  // the ONLY thing GLTFLoader turns into the `uv1` buffer the lightMap
  // sampler reads). Removing both yields a client that behaves exactly as it
  // did before the wave, off the SAME bytes on disk. Note what this does NOT
  // change, so the row is not over-read: bsp.bin is still transferred whole
  // (glTF buffers are fetched entire), so this prices lightmap FETCH, DECODE,
  // material rebuild and uv1 GPU upload — not the 72,208 B of TEXCOORD_1 in
  // bsp.bin, which is priced separately by arithmetic on the accessors.
  if (variant === 'lm-nosheet' && file === 'bsp.gltf') {
    const p = path.join(tileDir(tile), 'bsp.gltf');
    if (!fs.existsSync(p)) return null;
    const g = JSON.parse(fs.readFileSync(p, 'utf8'));
    let sheets = 0, uv1 = 0;
    for (const mat of g.materials || []) {
      if (mat.extras && 'lightmapSheet' in mat.extras) { delete mat.extras.lightmapSheet; sheets++; }
    }
    for (const mesh of g.meshes || []) {
      for (const prim of mesh.primitives || []) {
        if (prim.attributes && 'TEXCOORD_1' in prim.attributes) {
          delete prim.attributes.TEXCOORD_1; uv1++;
        }
      }
    }
    if (!sheets && !uv1) return null;          // already a pre-lightmap tile
    return { body: Buffer.from(JSON.stringify(g)), mime: 'model/gltf+json',
      note: `${tile}/bsp.gltf: ${sheets} lightmapSheet extras and ${uv1} TEXCOORD_1 removed` };
  }
  // Neighbour tiles only (never the profiled tile): drop the `splat` key from
  // every terrain layer. neighbors.js::_material calls _bakeSplatTexture only
  // when `layers.some((l,i) => i>0 && l.splat)`, so this is the client's own
  // no-bake path — it falls back to basecolor.png — and nothing else about the
  // neighbour changes: same mesh, same resolution, same request count for
  // scene.json and heightmap. Differencing it against `full` prices the
  // 1024x1024 JS splat bake alone, separately from everything else the
  // neighbour ring does. The CENTER tile is untouched, so the center terrain
  // material (a shader, not a bake) is identical in both arms.
  if (variant === 'nb-nosplat' && file === 'scene.json' && tile !== TILE) {
    const p = path.join(tileDir(tile), 'scene.json');
    if (!fs.existsSync(p)) return null;
    const def = JSON.parse(fs.readFileSync(p, 'utf8'));
    let n = 0;
    for (const l of def.layers || []) if (l.splat) { delete l.splat; n++; }
    if (!n) return null;
    return { body: Buffer.from(JSON.stringify(def)), mime: 'application/json',
      note: `neighbour ${tile}/scene.json: ${n} splat layer(s) removed (no JS bake)` };
  }
  // THE NULL INTERCEPT — the control for the controls.
  //
  // Every rewriting variant pays a cost the shipped client does not: each
  // intercepted request is paused, round-tripped to Node over CDP, and
  // fulfilled from there instead of being served by the socket. That is a
  // constant added to EVERY intercepting row, in the SLOW direction, and it is
  // invisible in the report — which is how `props1891` (removing 55 of 1,946
  // placements) came out 282 ms SLOWER than `props1237` (removing 709) came out
  // faster. Removing more work cannot cost more time, so the ordering was
  // measuring the harness.
  //
  // This variant intercepts exactly what the props* variants intercept — the
  // same 9 scene.json requests — and fulfils each with the file's OWN
  // unmodified bytes. Its delta against `full` is the interception tax, with
  // nothing else changed. Subtract it from any intercepting row before reading
  // that row as a property of the client.
  if (variant === 'null-intercept' && file === 'scene.json') {
    const p = path.join(tileDir(tile), 'scene.json');
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return { body: buf, mime: 'application/json',
      note: `${tile}/scene.json served BYTE-IDENTICAL through CDP (${buf.length} B)` };
  }
  const pm = /^props(\d+)$/.exec(variant);
  if (pm && file === 'scene.json') {
    const p = path.join(tileDir(tile), 'scene.json');
    if (!fs.existsSync(p)) return null;
    const def = JSON.parse(fs.readFileSync(p, 'utf8'));
    const before = (def.props || []).length;
    def.props = (def.props || []).slice(0, Number(pm[1]));
    return { body: Buffer.from(JSON.stringify(def)), mime: 'application/json',
      note: `${tile}/scene.json props ${before} -> ${def.props.length}` };
  }
  return null;
}

function variantQuery(variant) {
  if (variant === 'bspfloor-off') return '&bspfloor=off';
  if (variant === 'walkraster-off') return '&walkraster=off';
  // the client's OWN switch (bsp.js lightmapVariant): no atlas is fetched and
  // no lightMap is attached, but TEXCOORD_1 is still parsed and uploaded.
  if (variant === 'lm-off') return '&lm=off';
  // main.js NEIGHBORS_ENABLED — the 3x3 ring is skipped entirely. setCenter is
  // AWAITED inside loadScene (main.js:1652), so the ring is on the critical
  // path to worldReady and this difference is a wall-clock difference.
  if (variant === 'neighbors-off') return '&neighbors=0';
  return '';
}

function variantNeedsIntercept(v) {
  return v === 'walktrunc' || v === 'lm-nosheet' || v === 'nb-nosplat'
    || v === 'null-intercept' || /^props\d+$/.test(v);
}

// ---------------------------------------------------------------------------
// A PRIVATE DEV SERVER PER RUN.
//
// The first attribution matrix run against the long-lived :8083 process was
// worthless and said so out loud: rows 2-6 reported 14-36 s worldReady with
// `net::ERR_CONNECTION_TIMED_OUT` in the page console, and the FIRST row —
// the identical `full` variant that had measured 5.1 s minutes earlier —
// measured 11.1 s. The runs were poisoning each other, not measuring variants.
//
// The mechanism is not a guess: editor/world/server.py is a
// socketserver.ThreadingHTTPServer and inherits `request_queue_size = 5`, so
// the accept queue is FIVE deep. Under HTTP/1.0 the browser opens a fresh
// connection for every one of ~3 000 assets; overflowed SYNs are dropped and
// the client's retry backoff is what shows up as a timeout. Each cold load
// also leaves ~3 000 sockets in TIME_WAIT (macOS net.inet.tcp.msl = 15 s, so
// 30 s per socket) against an ephemeral range of 49152-65535.
//
// So every measured run gets its own freshly-spawned server on its own port,
// and is followed by a cooldown. Different destination ports also break the
// 4-tuple collisions that TIME_WAIT would otherwise cause between runs.
const { spawn } = require('child_process');
const KEEPALIVE_SERVER = path.join(REPO, 'tools', 'dev', 'keepalive_server.py');
let nextPort = 8700;

function waitForPort(port, timeoutMs = 15000) {
  const net = require('net');
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - t0 > timeoutMs) reject(new Error(`port ${port} never opened`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

async function withServer({ keepalive, backlog = 5 }, fn) {
  const port = nextPort++;
  const args = [KEEPALIVE_SERVER, '--port', String(port), '--backlog', String(backlog),
    '--quiet-log'];
  if (!keepalive) args.push('--http10');
  const proc = spawn('python3', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  try {
    await waitForPort(port);
    return await fn(port);
  } finally {
    proc.kill('SIGKILL');
    if (stderr.trim()) process.stderr.write(`  [server :${port}] ${stderr.trim().slice(0, 300)}\n`);
  }
}

// TIME_WAIT drain between runs. Measured, not assumed: the count of sockets
// in TIME_WAIT is read from netstat and reported, so a run that started with
// a loaded table is visible in the record instead of being a mystery.
function timeWaitCount() {
  try {
    const { execSync } = require('child_process');
    return execSync('netstat -an -p tcp | grep -c TIME_WAIT', { encoding: 'utf8' }).trim() | 0;
  } catch (_) { return -1; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Wait for the TIME_WAIT table to DRAIN, rather than for a fixed number of
// seconds. One cold Giran load over HTTP/1.0 leaves ~3 000 sockets in
// TIME_WAIT and macOS holds each for 2*MSL = 30 s (net.inet.tcp.msl = 15000),
// so a run started before the previous one has drained is measuring the
// previous run as much as its own — which is exactly how the first attribution
// matrix produced 36 s rows. Measured drain from ~3 000: about 100 s.
// The threshold and the wait are printed so a run that gave up waiting is
// visible in the record.
async function drain(maxMs = 240000, threshold = 60) {
  const t0 = Date.now();
  let n = timeWaitCount();
  while (n > threshold && Date.now() - t0 < maxMs) {
    await sleep(5000);
    n = timeWaitCount();
  }
  const waited = Math.round((Date.now() - t0) / 1000);
  process.stderr.write(`    drained to TIME_WAIT ${n} after ${waited}s`
    + (n > threshold ? '  *** GAVE UP — this run is not from rest ***' : '') + '\n');
  return { timeWaitAfterDrain: n, drainSeconds: waited, drained: n <= threshold };
}

// ---------------------------------------------------------------------------
// In-page instrumentation. Installed before any page script runs.
// ---------------------------------------------------------------------------
function bootstrap(tile) {
  window.__prof = {
    fetches: [], longtasks: [], readyAt: null, firstFrameAfterReady: null,
    interactiveAt: null, cur: {}, calls: {}, boot: null, bootCalls: null,
    wrappers: { installedAt: null, installed: [], failed: null, firstLoadAt: null },
  };
  // The Resource Timing buffer defaults to 250 entries and Giran alone pulls
  // 577 files out of props/ — without this the network table silently loses
  // most of the load and reads as if the tile were cheap.
  try { performance.setResourceTimingBufferSize(30000); } catch (_) { /* older engines */ }

  const origFetch = window.fetch;
  window.fetch = function (input) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const p = origFetch.apply(this, arguments);
    // Put the profiled tile first so boot()'s `loadScene(scenes[0])` loads it.
    // The array is otherwise untouched.
    if (/\/scenes(\?|$)/.test(url)) {
      return p.then(res => {
        const clone = res.clone();
        return clone.json().then((list) => {
          if (Array.isArray(list) && list.includes(tile)) {
            return new Response(JSON.stringify([tile, ...list.filter(t => t !== tile)]),
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

  // --- phase wrappers, installed BEFORE boot() ever constructs a Terrain ----
  //
  // A dynamic import of '/js/terrain.js' returns the SAME module instance
  // main.js gets — ES modules are keyed by resolved URL — so wrapping the
  // exported class's prototype here wraps the class main.js will use.
  //
  // The import cannot be fired at document-start: terrain.js does
  // `import * as THREE from 'three'`, a bare specifier that only resolves
  // once index.html's <script type="importmap"> has been parsed. So this
  // waits for that element to appear (it is line 8 of index.html; main.js is
  // line 63), which is both early enough to beat boot() and late enough to
  // resolve. Whether it actually won the race is recorded, not assumed.
  const acc = (label, ms) => {
    const c = window.__prof.cur;
    c[label] = +((c[label] || 0) + ms).toFixed(3);
    window.__prof.calls[label] = (window.__prof.calls[label] || 0) + 1;
  };
  const wrap = (obj, name, label) => {
    const fn = obj && obj[name];
    if (typeof fn !== 'function' || fn.__profWrapped) return false;
    const wrapped = function (...args) {
      const t0 = performance.now();
      if (label === 'terrain.total' && window.__prof.wrappers.firstLoadAt == null) {
        window.__prof.wrappers.firstLoadAt = t0;
      }
      const done = () => acc(label, performance.now() - t0);
      let r;
      try { r = fn.apply(this, args); } catch (e) { done(); throw e; }
      if (r && typeof r.then === 'function') {
        return r.then(v => { done(); return v; }, e => { done(); throw e; });
      }
      done();
      return r;
    };
    wrapped.__profWrapped = true;
    try { obj[name] = wrapped; } catch (_) { return false; }
    return true;
  };

  const install = async () => {
    const W = window.__prof.wrappers;
    try {
      const [terrain, bspfloor, geodata, bsp, neighbors, steps, skin, font, layout] =
        await Promise.all(['/js/terrain.js', '/js/bspfloor.js', '/js/geodata.js',
          '/js/bsp.js', '/js/neighbors.js', '/js/steps.js', '/js/ui/skin.js',
          '/js/ui/font.js', '/js/ui/layout.js'].map(u => import(u)));
      const pairs = [
        [terrain.Terrain.prototype, 'load', 'terrain.total'],
        [terrain.Terrain.prototype, '_correctHeights', 'heightfix'],
        [terrain.Terrain.prototype, '_buildMesh', 'terrainMesh'],
        [terrain.Terrain.prototype, '_buildMaterial', 'terrainMaterial'],
        [terrain.Terrain.prototype, '_buildWater', 'water'],
        [terrain.Terrain.prototype, '_loadProps', 'props'],
        [terrain.Terrain.prototype, '_loadPropsInstanced', 'propsInstanced'],
        [terrain.Terrain.prototype, '_loadBsp', 'bspLoad'],
        [bsp.Bsp, 'load', 'bsp.fetch+parse'],
        // Bsp.load awaits _loadLightmaps, so this is a leaf INSIDE
        // bsp.fetch+parse: atlas fetch + PNG decode + Texture construction.
        // The GPU upload is NOT here — that happens on first draw.
        [bsp.Bsp, '_loadLightmaps', 'bsp.lightmaps'],
        [geodata.Geodata, 'load', 'geodata'],
        [bspfloor.BspFloor, 'load', 'bspFloor'],
        [neighbors.NeighborTiles.prototype, 'setCenter', 'neighbors'],
        [steps.Footsteps.prototype, 'load', 'steps.notify'],
        [steps.Footsteps.prototype, 'setTile', 'steps.tile'],
        [skin.Skin, 'load', 'ui.skin'],
        [font.Font, 'load', 'ui.font'],
        [layout.Layout, 'load', 'ui.layout'],
      ];
      for (const [obj, name, label] of pairs) if (wrap(obj, name, label)) W.installed.push(label);
      W.installedAt = performance.now();
    } catch (err) {
      W.failed = String((err && err.message) || err);
    }
  };
  const waitForImportMap = () => {
    if (document.querySelector('script[type="importmap"]')) { install(); return; }
    setTimeout(waitForImportMap, 0);
  };
  waitForImportMap();

  // worldReady / first frame after it / interactive (#loading hidden)
  const poll = () => {
    const p = window.__prof;
    if (p.readyAt == null && window.__world && window.__world.ready) {
      p.readyAt = performance.now();
      // freeze the boot phase accumulator the instant the world is up
      p.boot = Object.assign({}, p.cur);
      p.bootCalls = Object.assign({}, p.calls);
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

async function timedLoad(page, tile) {
  await page.evaluate(() => { window.__prof.cur = {}; window.__prof.calls = {}; });
  const total = await page.evaluate(async (t) => {
    const t0 = performance.now();
    await window.__world.loadScene(t);
    return performance.now() - t0;
  }, tile);
  const [phases, calls] = await page.evaluate(
    () => [window.__prof.cur, window.__prof.calls]);
  return { totalMs: +total.toFixed(1), phases, calls };
}

// ---------------------------------------------------------------------------
function classify(url) {
  // Filenames verified against assets/world/22_22/ and editor/world/ui/.
  if (/\/scene\.json$/.test(url)) return 'scene.json';
  if (/heightmap\.(u16|png)$/i.test(url)) return 'heightmap';
  if (/geodata\.(json|bin)$/i.test(url)) return 'geodata';
  if (/bspfloor\.bin$/i.test(url)) return 'bspfloor (walk raster)';
  if (/steps\.json$/i.test(url)) return 'steps.json';
  // BEFORE the generic /\.png$/ texture rule, and before /\/bsp\./: the
  // lightmap atlases live at <tile>/lightmap/g<sheet>p<variant>.png and would
  // otherwise be invisible inside the 200-odd-request 'texture' bucket, which
  // is exactly how the previous profile came to have no lightmap row at all.
  if (/\/lightmap\/g\d+p\d+\.png$/i.test(url)) return 'bsp lightmap atlas';
  if (/\/bsp\.(gltf|bin)$/i.test(url)) return 'bsp gltf';
  if (/\/props\//i.test(url)) return 'prop gltf+bin';
  if (/\/ui\//i.test(url)) return 'ui skin/font';
  if (/\.(gltf|glb)$/i.test(url)) return 'other gltf';
  if (/\/characters\//i.test(url)) return 'character models';
  if (/\/gamedata\//i.test(url)) return 'gamedata json';
  if (/\.(png|jpg|jpeg|dds|webp|tga)$/i.test(url)) return 'texture';
  if (/\.js$/i.test(url)) return 'javascript';
  if (/\.(ogg|mp3|wav)$/i.test(url)) return 'audio';
  if (/\.bin$/i.test(url)) return 'other .bin';
  if (/\.json$/i.test(url)) return 'other json';
  return 'other';
}

async function resourceSummary(page) {
  const rows = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({
    name: r.name, dur: r.duration, transfer: r.transferSize, decoded: r.decodedBodySize,
    connect: r.connectEnd - r.connectStart, dns: r.domainLookupEnd - r.domainLookupStart,
    stall: r.requestStart ? r.requestStart - r.startTime : 0,
    ttfb: r.responseStart && r.requestStart ? r.responseStart - r.requestStart : 0,
    download: r.responseEnd && r.responseStart ? r.responseEnd - r.responseStart : 0,
    reusedConn: r.connectStart === r.connectEnd,
  })));
  const by = {};
  let conn = { total: 0, reused: 0, connectMs: 0, ttfbMs: 0, downloadMs: 0, stallMs: 0 };
  for (const r of rows) {
    const k = classify(r.name);
    const b = by[k] || (by[k] = { requests: 0, wallMs: 0, transferBytes: 0, decodedBytes: 0,
      cacheHits: 0, connectMs: 0 });
    b.requests++; b.wallMs += r.dur; b.transferBytes += r.transfer || 0;
    b.decodedBytes += r.decoded || 0; b.connectMs += r.connect || 0;
    if ((r.transfer || 0) === 0 && (r.decoded || 0) > 0) b.cacheHits++;
    conn.total++;
    if (r.reusedConn) conn.reused++;
    conn.connectMs += r.connect || 0; conn.ttfbMs += r.ttfb || 0;
    conn.downloadMs += r.download || 0; conn.stallMs += r.stall || 0;
  }
  for (const b of Object.values(by)) {
    b.wallMs = +b.wallMs.toFixed(1); b.connectMs = +b.connectMs.toFixed(1);
  }
  for (const k of Object.keys(conn)) conn[k] = +conn[k].toFixed(1);
  // How much of the request count is the SAME URL asked for again inside one
  // load? With the cache enabled those repeats cost ~0 bytes; with it disabled
  // they are full downloads. Printing distinct-vs-total is what makes the two
  // arms readable against each other instead of looking like different tiles.
  const seen = new Map();
  for (const r of rows) seen.set(r.name, (seen.get(r.name) || 0) + 1);
  const dupes = { requests: rows.length, distinctUrls: seen.size,
    repeatRequests: rows.length - seen.size,
    worst: [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([u, n]) => [u.replace(/^https?:\/\/[^/]+/, ''), n]) };
  return { by, conn, dupes };
}

function cpuByScript(profile) {
  // Chrome's sampling profiler: self-time per node = samples * interval.
  if (!profile || !profile.nodes || !profile.samples || !profile.samples.length) return {};
  const byId = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  const hits = new Map();
  const total = profile.samples.length;
  for (const s of profile.samples) hits.set(s, (hits.get(s) || 0) + 1);
  const perSample = total ? (profile.endTime - profile.startTime) / total / 1000 : 0;
  const out = {};
  for (const [id, count] of hits) {
    const n = byId.get(id);
    if (!n) continue;
    const cf = n.callFrame || {};
    let key = cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '') : (cf.functionName || '(engine)');
    out[key] = (out[key] || 0) + count * perSample;
  }
  const buckets = {};
  const add = (k, v) => { buckets[k] = +((buckets[k] || 0) + v).toFixed(1); };
  for (const [k, v] of Object.entries(out)) {
    if (/GLTFLoader/.test(k)) add('gltf parse (GLTFLoader.js)', v);
    else if (/\/js\/bspfloor\.js/.test(k)) add('walk raster (js/bspfloor.js)', v);
    else if (/\/js\/bsp\.js/.test(k)) add('bsp build (js/bsp.js)', v);
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

// ---------------------------------------------------------------------------
// COLD MEANS "EMPTY CACHE", NOT "NO CACHE". This distinction was got wrong in
// the first pass of this suite and it changes the numbers materially.
//
// The old cold run set `Network.setCacheDisabled: true`. That is not what a
// first-time visitor experiences: their cache is EMPTY but ENABLED, so the
// second reference to a shared asset is served locally. Giran's props are 288
// glTF + 288 .bin + 820 textures, and the textures are shared across
// templates — with the cache disabled every re-reference is a fresh network
// request, so the harness billed the load for downloads a real visitor never
// makes. Measured: cache-disabled cold issues 3 096 requests / 155.7 MB, and
// the same load with an empty-but-enabled cache issues far fewer (see the
// `dupes` line in the report — it is printed, not assumed).
//
// So `cold` is now a throwaway --user-data-dir with the cache ON: an empty
// disk cache, one navigation. `--nocache` restores the pathological arm, and
// the report says which was used.
const NOCACHE = has('--nocache');

async function profileRun({ cold, variant = VARIANT, port = PORT, reload = true }) {
  // Every puppeteer launch gets a throwaway profile, so a "warm" run in a
  // fresh browser would have had an EMPTY disk cache too. The warm run
  // therefore primes the cache with a full first load in the SAME browser and
  // profiles the second one.
  const userDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'elbera-prof-'));
  const args = ['--headless=new', '--window-size=1280,900',
    '--hide-scrollbars', '--mute-audio'];
  if (SWIFT) args.push('--use-angle=swiftshader');
  const browser = await puppeteer.launch({
    executablePath: CHROME, userDataDir, args,
    // A cache-disabled Giran boot over HTTP/1.0 has taken minutes. That is a
    // finding, not a flake; do not lower this to "make it fast", fix the load.
    protocolTimeout: 900000,
  });
  const run = { cold, variant, port, consoleErrors: [], interceptNotes: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => run.consoleErrors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') run.consoleErrors.push(`console: ${m.text()}`);
    });
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');
    // cold = empty disk cache (fresh --user-data-dir), cache ENABLED.
    // --nocache is the separate, harsher arm.
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: !!(cold && NOCACHE) });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });

    if (variantNeedsIntercept(variant)) {
      await cdp.send('Fetch.enable', { patterns: [
        { urlPattern: '*bspfloor.bin', requestStage: 'Request' },
        { urlPattern: '*scene.json', requestStage: 'Request' },
        { urlPattern: '*bsp.gltf', requestStage: 'Request' },
      ] });
      cdp.on('Fetch.requestPaused', async (ev) => {
        try {
          const sub = variantBody(variant, ev.request.url);
          if (!sub) { await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }); return; }
          if (!run.interceptNotes.includes(sub.note)) run.interceptNotes.push(sub.note);
          await cdp.send('Fetch.fulfillRequest', {
            requestId: ev.requestId, responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: sub.mime },
              { name: 'Cache-Control', value: 'public, max-age=3600' },
            ],
            body: sub.body.toString('base64'),
          });
        } catch (_) { /* the page can navigate out from under a paused request */ }
      });
    }

    await page.evaluateOnNewDocument(bootstrap, TILE);

    // The sampling profiler starts AFTER the navigation commits: CDP's
    // Profiler binds to the current execution context and a navigation
    // replaces it, so start-then-navigate can hand back an empty profile.
    const url = `http://127.0.0.1:${port}/?cc=0${variantQuery(variant)}`;
    const bootOnce = async (profiled) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (profiled) await cdp.send('Profiler.start');
      await page.waitForFunction('window.__world && window.__world.ready', { timeout: 300000 });
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

    run.gl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'no webgl';
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    run.tileBooted = await page.evaluate(() => window.__world.currentTile);
    run.propsCount = await page.evaluate(() =>
      ((window.__world.terrain || {}).def || {}).props ?
        window.__world.terrain.def.props.length : 0);
    run.walkRasterLoaded = await page.evaluate(() => {
      const t = window.__world.terrain;
      if (!t || !t.bspFloor) return 'no bspFloor';
      return t.bspFloor.fine ? 'section2 active' : 'section1 only';
    });
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
    const w = await page.evaluate(() => window.__prof.wrappers);
    run.wrappers = {
      installedAt: w.installedAt, installedCount: w.installed.length,
      installed: w.installed, failed: w.failed, firstLoadAt: w.firstLoadAt,
      // The only claim that matters: did the wrappers exist before the boot
      // load started? If not, the boot column is not a measurement.
      beforeFirstLoad: w.installedAt != null && w.firstLoadAt != null
        && w.installedAt <= w.firstLoadAt,
    };
    run.bootPhases = await page.evaluate(() => window.__prof.boot || {});
    run.bootCalls = await page.evaluate(() => window.__prof.bootCalls || {});
    run.cpuMs = cpuByScript(profile);
    const rs = await resourceSummary(page);
    run.network = rs.by; run.connections = rs.conn; run.dupes = rs.dupes;
    run.cacheMode = cold ? (NOCACHE ? 'cache DISABLED (pathological)' : 'empty disk cache (first visit)') : 'primed cache';
    run.longtasks = await page.evaluate(() => {
      const l = window.__prof.longtasks;
      return { count: l.length, totalMs: +l.reduce((a, b) => a + b.dur, 0).toFixed(1),
        worstMs: l.length ? +Math.max(...l.map(x => x.dur)).toFixed(1) : 0 };
    });

    // --- instrumented reload of the SAME tile, assets warm --------------------
    // Guarded: the boot profile above is the primary deliverable and must
    // survive a failure down here.
    run.reloadWarm = { totalMs: 0, phases: {}, calls: {} };
    if (reload) {
      try {
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
        await timedLoad(page, TILE);                    // prime
        run.reloadWarm = await timedLoad(page, TILE);
      } catch (err) {
        run.reloadError = err.message;
      }
    }
    await page.screenshot({
      path: path.join(OUT, `loadprofile_${cold ? 'cold' : 'warm'}_${variant}_${port}.png`) });
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  return run;
}

// ---------------------------------------------------------------------------
function fmt(ms) { return `${String(Math.round(ms)).padStart(6)} ms`; }
function kb(b) { return String(Math.round(b / 1024)).padStart(9); }

// The phases that CONTAIN other phases; excluded from the leaf sum so nothing
// is double-counted, and marked in the printout.
const NESTED = new Set(['terrain.total', 'terrainMaterial', 'propsInstanced', 'bspLoad']);

function phaseBlock(p, calls, indent, totalLabel) {
  const lines = [];
  const entries = Object.entries(p).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { lines.push(`${indent}(no phases captured)`); return lines; }
  for (const [k, v] of entries) {
    lines.push(`${indent}${k.padEnd(22)} ${fmt(v)}`
      + `  x${String((calls || {})[k] ?? '?').padEnd(4)}`
      + (NESTED.has(k) ? ' (contains others)' : ''));
  }
  const leaves = entries.filter(([k]) => !NESTED.has(k) && k !== 'bsp.fetch+parse');
  const sum = leaves.reduce((a, [, v]) => a + v, 0);
  if (p['terrain.total'] != null) {
    // everything inside Terrain.load that no wrapper names
    const inside = ['heightfix', 'terrainMesh', 'water', 'props', 'geodata',
      'bspFloor', 'bspLoad'].reduce((a, k) => a + (p[k] || 0), 0);
    lines.push(`${indent}${'  ^ unattributed'.padEnd(22)} `
      + `${fmt(p['terrain.total'] - inside)}  (heightmap fetch+decode, interior detect)`);
  }
  if (totalLabel != null) {
    lines.push(`${indent}${'sum of leaves'.padEnd(22)} ${fmt(sum)}`);
  }
  return lines;
}

function report(res) {
  const L = [];
  const p = s => L.push(s);
  const c = res.cold;
  p('');
  p(`LOAD PROFILE — tile ${res.tile} (booted: ${c.tileBooted}), `
    + `${c.propsCount} prop placements, variant "${c.variant}", server :${c.port}`);
  p(`renderer: ${c.gl}`);
  p(SWIFT
    ? '  *** SWIFTSHADER (software GL) — GPU-side numbers are NOT the owner\'s ***'
    : '  real GPU path (no --use-angle); CPU and network numbers representative');
  p(`walk raster in the booted client: ${c.walkRasterLoaded}`);
  if (c.interceptNotes.length) p(`intercepted: ${c.interceptNotes.join('; ')}`);
  p(`tree: ${res.treeBefore.head}, ${res.treeBefore.dirtyFiles} file(s) dirty`
    + (res.treeChangedDuringRun
      ? '  *** THE TREE CHANGED DURING THIS RUN — numbers are not comparable ***' : ''));
  p(`machine: loadavg ${JSON.stringify(res.machineBefore.loadavg)} -> `
    + `${JSON.stringify(res.machineAfter.loadavg)}, ${res.machineBefore.cpus} cpus`);
  p('');
  for (const [label, run] of [['COLD (empty disk cache)', res.cold],
    ['WARM (cache primed)', res.warm]]) {
    if (!run) continue;
    p(`== ${label} ==`);
    p('  milestones (ms from navigationStart)');
    for (const [k, v] of Object.entries(run.milestones)) {
      p(`    ${k.padEnd(24)} ${v == null ? '     n/a' : fmt(v)}`);
    }
    p(`    ${'(wall clock, harness)'.padEnd(24)} ${fmt(run.bootWallMs)}`);
    p('');
    p('  BOOT phases — the load the owner is complaining about');
    if (!run.wrappers.beforeFirstLoad) {
      p('    NOT CAPTURED: the phase wrappers did not install before the boot load'
        + ` (installedAt=${run.wrappers.installedAt}, firstLoadAt=${run.wrappers.firstLoadAt}`
        + `, failed=${run.wrappers.failed}). Do not read the numbers below.`);
    }
    for (const ln of phaseBlock(run.bootPhases, run.bootCalls, '    ', true)) p(ln);
    // A WRAPPER THAT WAS INSTALLED BUT NEVER FIRED IS A HOLE, NOT A ZERO.
    // Observed: on the COLD run `ui.skin` / `ui.font` / `ui.layout` are absent
    // from the phase list while the WARM run reports 27 / 27 / 34 ms for them.
    // The UI obviously still loaded on the cold run — 83 requests and 605 KB
    // of ui/ assets are in the network table below. What differs is the race:
    // the wrappers arrive via a dynamic import that must wait for the import
    // map, and on a cold cache that import is itself a network fetch, so
    // Skin.load has already been entered by the time the wrapper lands. Left
    // unsaid, the missing rows read as "the UI skin costs nothing to load",
    // which is the opposite of what was measured — it was not measured at all.
    const missed = (run.wrappers.installed || [])
      .filter(l => run.bootPhases[l] == null);
    if (missed.length) {
      p(`    NOT CAPTURED (wrapper installed at ${Math.round(run.wrappers.installedAt)} ms, `
        + 'but these were already running by then — a HOLE, not a zero):');
      p(`      ${missed.join(', ')}`);
      p('      Their cost is inside the milestones and the network table, but is not');
      p('      attributed to a phase here. Do not read their absence as 0 ms.');
    }
    p('');
    p('  network by asset class (requests / wall ms / transferred KB / decoded KB / '
      + 'cache hits / connect ms)');
    const rows = Object.entries(run.network).sort((a, b) => b[1].wallMs - a[1].wallMs);
    let tot = { requests: 0, wallMs: 0, transferBytes: 0, decodedBytes: 0, cacheHits: 0, connectMs: 0 };
    for (const [k, v] of rows) {
      p(`    ${k.padEnd(24)} ${String(v.requests).padStart(5)} ${String(Math.round(v.wallMs)).padStart(8)}`
        + ` ${kb(v.transferBytes)} ${kb(v.decodedBytes)} ${String(v.cacheHits).padStart(6)}`
        + ` ${String(Math.round(v.connectMs)).padStart(8)}`);
      for (const kk of Object.keys(tot)) tot[kk] += v[kk];
    }
    p(`    ${'TOTAL'.padEnd(24)} ${String(tot.requests).padStart(5)} ${String(Math.round(tot.wallMs)).padStart(8)}`
      + ` ${kb(tot.transferBytes)} ${kb(tot.decodedBytes)} ${String(tot.cacheHits).padStart(6)}`
      + ` ${String(Math.round(tot.connectMs)).padStart(8)}`);
    const du = run.dupes;
    p(`  cache mode: ${run.cacheMode}`);
    p(`  requests: ${du.requests} total, ${du.distinctUrls} distinct URLs, `
      + `${du.repeatRequests} repeats of a URL already asked for in this load`);
    for (const [u, n] of du.worst) if (n > 1) p(`      x${String(n).padStart(3)}  ${u}`);
    const cn = run.connections;
    p(`  connections: ${cn.total} requests, ${cn.reused} on a reused socket `
      + `(${(100 * cn.reused / (cn.total || 1)).toFixed(1)}%);`);
    p(`    summed connect ${Math.round(cn.connectMs)} ms, stalled/queued ${Math.round(cn.stallMs)} ms, `
      + `TTFB ${Math.round(cn.ttfbMs)} ms, download ${Math.round(cn.downloadMs)} ms`);
    p(`    (summed over requests, so > wall clock — Chrome runs up to 6 sockets per origin)`);
    p('');
    p(`  cpu self-time by source (sampling profiler, post-DCL; ${run.cpuSamples} samples)`);
    if (!run.cpuSamples) p('    (profiler returned no samples — treat this section as missing)');
    for (const [k, v] of Object.entries(run.cpuMs)) {
      if (v < 5) continue;
      p(`    ${k.padEnd(42)} ${fmt(v)}`);
    }
    p(`  long tasks: ${run.longtasks.count}, total ${run.longtasks.totalMs} ms, `
      + `worst ${run.longtasks.worstMs} ms`);
    if (run.reloadError) p(`  !! instrumented reload failed: ${run.reloadError}`);
    p(`  instrumented reload (assets already warm) total ${fmt(run.reloadWarm.totalMs)}`);
    for (const ln of phaseBlock(run.reloadWarm.phases, run.reloadWarm.calls, '    ', true)) p(ln);
    if (run.consoleErrors.length) {
      p(`  page errors: ${run.consoleErrors.length}`);
      for (const e of run.consoleErrors.slice(0, 5)) p(`    ${e.slice(0, 140)}`);
    }
    p('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// --attribute: the variant matrix. Each row is a MEASURED load, not a model.
// ---------------------------------------------------------------------------
// Each row is measured TWICE (interleaved A,B,C,...,A,B,C,...) and the MEDIAN
// -- with n=2, the min -- is reported. A single pass through a plan is a
// measurement of drift as much as of variants; the second pass is what shows
// whether the ordering mattered. Both passes are kept in the JSON.
const KEEPALIVE_AB = !has('--http10-attribution');   // fresh servers keep-alive

async function attribute() {
  const plan = [
    ['full', 'as shipped', { variant: 'full' }],
    ['walktrunc', 'bspfloor.bin section 2 removed = the pre-walk-raster file',
      { variant: 'walktrunc' }],
    ['walkraster-off', 'section 2 fetched AND parsed, then discarded',
      { variant: 'walkraster-off' }],
    ['bspfloor-off', 'no floor raster at all', { variant: 'bspfloor-off' }],
    // TWO prop waves reached Giran, and pricing only the later one understates
    // the growth by an order of magnitude. Both counts come from commit text,
    // not from a file this suite can read (scene.json is gitignored, so there
    // is nothing to diff) — provenance stated so the rows are not over-trusted:
    //   1237 -> 1891  8a5c205 (2026-08-03), the actor-parser fix, +654 (+53%)
    //   1891 -> 1946  398286c (2026-08-08), the extraction fix,   +55  (+2.9%)
    ['props1891', 'pre-398286c count (per that commit text) — prices the +55 wave',
      { variant: 'props1891' }],
    ['props1237', 'pre-8a5c205 count (per HANDOFF §"actor-parser fix") — prices the +654 wave',
      { variant: 'props1237' }],
    ['props0', 'no prop placements at all', { variant: 'props0' }],
    ['lm-off', '?lm=off — atlas never fetched, uv1 still parsed+uploaded',
      { variant: 'lm-off' }],
    ['lm-nosheet', 'bsp.gltf with lightmapSheet + TEXCOORD_1 stripped = pre-053d0db',
      { variant: 'lm-nosheet' }],
    ['null-intercept', 'CONTROL: same interception, byte-identical bytes = the harness tax',
      { variant: 'null-intercept' }],
    ['neighbors-off', '?neighbors=0 — the whole 3x3 background ring skipped',
      { variant: 'neighbors-off' }],
    ['nb-nosplat', 'neighbour scene.json with no splat = the 1024x1024 JS bake skipped',
      { variant: 'nb-nosplat' }],
  ];
  // `--only a,b,c` runs a subset of the plan. `full` is ALWAYS included: every
  // delta in the report is against it, and a `full` measured in a different
  // matrix, minutes earlier, on a differently-loaded machine is not the same
  // control. Subsetting is what makes a single suspect re-measurable in two
  // minutes instead of twenty.
  const only = arg('--only', null);
  if (only) {
    const want = new Set(only.split(',').map(s => s.trim()).filter(Boolean));
    want.add('full');
    const unknown = [...want].filter(k => !plan.some(([key]) => key === k));
    if (unknown.length) {
      console.error(`VERIFY LOADPROFILE FAILED: --only names no such variant: ${unknown.join(', ')}`);
      console.error(`  known: ${plan.map(([k]) => k).join(', ')}`);
      process.exit(2);
    }
    for (let i = plan.length - 1; i >= 0; i--) if (!want.has(plan[i][0])) plan.splice(i, 1);
  }
  const passes = Number(arg('--passes', '2'));
  const acc = new Map(plan.map(([k, why]) => [k, { why, runs: [] }]));
  for (let pass = 0; pass < passes; pass++) {
    for (const [key, why, opts] of plan) {
      const d = await drain();
      process.stderr.write(`  pass ${pass + 1}/${passes}  ${key}\n`);
      const run = await withServer({ keepalive: KEEPALIVE_AB }, (port) =>
        profileRun(Object.assign({ cold: true, reload: false, port }, opts)));
      Object.assign(run, d);
      acc.get(key).runs.push(run);
    }
  }
  return [...acc.entries()].map(([key, v]) => ({ key, why: v.why, runs: v.runs }));
}

// --- task #17: HTTP/1.0 vs HTTP/1.1 keep-alive, one attribute apart ---------
async function abProtocol() {
  const repeats = Number(arg('--repeats', '3'));
  const backlog = Number(arg('--backlog', '5'));
  const rows = [];
  for (let i = 0; i < repeats; i++) {
    // ABBA ordering: A,B on even repeats and B,A on odd, so a monotonic drift
    // in machine state cannot be read as a protocol effect.
    const order = i % 2 === 0 ? [false, true] : [true, false];
    for (const keepalive of order) {
      const d = await drain();
      process.stderr.write(`  repeat ${i + 1}/${repeats}  `
        + `${keepalive ? 'HTTP/1.1 keep-alive' : 'HTTP/1.0 (as shipped)'} `
        + `backlog ${backlog}\n`);
      const run = await withServer({ keepalive, backlog }, (port) =>
        profileRun({ cold: true, variant: 'full', port, reload: false }));
      Object.assign(run, d);
      rows.push({ keepalive, backlog, repeat: i, run, ...d });
    }
  }
  return rows;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function abReport(rows) {
  const L = [];
  const p = s => L.push(s);
  p('');
  p('TASK #17 — HTTP/1.0 (connection per asset) vs HTTP/1.1 keep-alive');
  p('  Same handler class, same routes, same listen backlog, same tree, same');
  p('  client. tools/dev/keepalive_server.py --http10 is the control arm, so');
  p('  the two differ in exactly one class attribute. Every run gets a FRESH');
  p('  server on a FRESH port, ABBA-ordered, with a cooldown between.');
  p('');
  p(`  ${'arm'.padEnd(22)} ${'worldReady'.padStart(11)} ${'reqs'.padStart(6)}`
    + ` ${'connect ms'.padStart(11)} ${'stalled ms'.padStart(11)} ${'TTFB ms'.padStart(9)}`
    + ` ${'reused%'.padStart(8)} ${'errors'.padStart(7)}`);
  for (const r of rows) {
    const c = r.run.connections;
    const reqs = Object.values(r.run.network).reduce((a, v) => a + v.requests, 0);
    p(`  ${(r.keepalive ? 'HTTP/1.1 keep-alive' : 'HTTP/1.0 as shipped')
      .padEnd(22)} ${String(Math.round(r.run.milestones.worldReady)).padStart(8)} ms`
      + ` ${String(reqs).padStart(6)} ${String(Math.round(c.connectMs)).padStart(11)}`
      + ` ${String(Math.round(c.stallMs)).padStart(11)} ${String(Math.round(c.ttfbMs)).padStart(9)}`
      + ` ${(100 * c.reused / (c.total || 1)).toFixed(1).padStart(8)}`
      + ` ${String(r.run.consoleErrors.length).padStart(7)}`);
  }
  const a = rows.filter(r => !r.keepalive).map(r => r.run.milestones.worldReady);
  const b = rows.filter(r => r.keepalive).map(r => r.run.milestones.worldReady);
  const ma = median(a), mb = median(b);
  p('');
  p(`  median worldReady   HTTP/1.0 ${Math.round(ma)} ms   keep-alive ${Math.round(mb)} ms`);
  p(`  keep-alive saves    ${Math.round(ma - mb)} ms  (${((1 - mb / ma) * 100).toFixed(1)}%)`);
  const ca = median(rows.filter(r => !r.keepalive).map(r => r.run.connections.connectMs));
  const cb = median(rows.filter(r => r.keepalive).map(r => r.run.connections.connectMs));
  p(`  summed TCP connect  HTTP/1.0 ${Math.round(ca)} ms   keep-alive ${Math.round(cb)} ms`);
  p('  (summed over requests; Chrome runs up to 6 sockets per origin, so the');
  p('   wall-clock share of connect is roughly this divided by 6.)');
  p('');
  return L.join('\n');
}

function attributeReport(groups) {
  const L = [];
  const p = s => L.push(s);
  const pick = (g, f) => median(g.runs.map(f));
  const base = groups.find(g => g.key === 'full');
  const baseReady = pick(base, r => r.milestones.worldReady);
  p('');
  p('ATTRIBUTION MATRIX — every row is a measured cold Giran load on its own');
  p(`fresh server; ${groups[0].runs.length} pass(es), median reported, spread shown.`);
  p('');
  // THE NOISE FLOOR IS PART OF THE RESULT. A run-to-run spread of 1.1 s on the
  // control makes a 351 ms delta unreportable, and printing it in a tidy
  // column invites exactly the reading it cannot support. So every delta is
  // compared against the larger of its own spread and the control's, and any
  // delta that does not clear it is struck out as UNRESOLVED rather than
  // quoted. Raising --passes is the only thing that shrinks this.
  const baseSpread = (() => {
    const a = base.runs.map(r => r.milestones.worldReady);
    return Math.max(...a) - Math.min(...a);
  })();
  p(`  ${'variant'.padEnd(16)} ${'worldReady'.padStart(11)} ${'Δ vs full'.padStart(10)}`
    + ` ${'spread'.padStart(8)} ${'reqs'.padStart(6)} ${'MB'.padStart(7)}`
    + ` ${'bspfloor KB'.padStart(12)} ${'errs'.padStart(5)}  verdict / raster`);
  for (const g of groups) {
    const ready = pick(g, r => r.milestones.worldReady);
    const all = g.runs.map(r => r.milestones.worldReady);
    const spread = Math.round(Math.max(...all) - Math.min(...all));
    const r0 = g.runs[0];
    const tot = pick(g, r => Object.values(r.network).reduce((a, v) => a + v.transferBytes, 0));
    const reqs = pick(g, r => Object.values(r.network).reduce((a, v) => a + v.requests, 0));
    const bf = (r0.network['bspfloor (walk raster)'] || {}).transferBytes || 0;
    const errs = g.runs.reduce((a, r) => a + r.consoleErrors.length, 0);
    p(`  ${g.key.padEnd(16)} ${String(Math.round(ready)).padStart(8)} ms `
      + `${String(Math.round(ready - baseReady)).padStart(9)} ${String(spread).padStart(8)}`
      + ` ${String(Math.round(reqs)).padStart(6)} ${(tot / 1048576).toFixed(1).padStart(7)}`
      + ` ${String(Math.round(bf / 1024)).padStart(12)} ${String(errs).padStart(5)}`
      + `  ${g.key === 'full' ? 'control'
        : (Math.abs(ready - baseReady) <= Math.max(spread, baseSpread)
          ? `UNRESOLVED (< noise ${Math.max(spread, baseSpread)} ms)`
          // EVERY variant REMOVES work from the load — fewer props, no walk
          // raster, no lightmaps, no neighbour ring. None of them can make the
          // client slower. A delta that clears the noise floor in the POSITIVE
          // direction is therefore not a finding about the client; it is proof
          // that something uncontrolled is in the row, and the harness's own
          // CDP interception tax is the first candidate (see `null-intercept`).
          // Reported as SUSPECT rather than RESOLVED, because `props1891` once
          // printed a clean +282 ms that no reading of the client can explain.
          : (ready > baseReady ? 'SUSPECT (+ve: removing work cannot cost time)'
            : 'RESOLVED'))}`
      + `  ${r0.walkRasterLoaded}`);
  }
  p('');
  for (const g of groups) p(`    ${g.key.padEnd(16)} ${g.why}`);
  p('');
  // AN INERT VARIANT IS THE WORST OUTCOME THIS REPORT CAN HAVE, because it
  // does not look like an error — it looks like a finding. It reads
  // "Δ vs full ≈ 0", i.e. "this change costs nothing", which is the exact
  // conclusion someone wants to draw. This suite has already produced one:
  // `lm-nosheet` was added before '*bsp.gltf' was in the Fetch.enable pattern
  // list, so the substitution never ran, the row measured plain `full`, and
  // the matrix reported a 351 ms delta that was pure noise. Every variant that
  // is supposed to rewrite a response must PROVE it rewrote one.
  const inert = groups.filter(g => variantNeedsIntercept(g.key)
    && g.runs.every(r => !(r.interceptNotes || []).length));
  if (inert.length) {
    p('  *** INERT VARIANT(S) — THESE ROWS ARE NOT MEASURING WHAT THEY CLAIM ***');
    for (const g of inert) {
      p(`    ${g.key.padEnd(16)} substituted NOTHING: no request was rewritten in any pass.`);
      p(`    ${''.padEnd(16)} Its row is a second copy of "full". Do not read its delta.`);
    }
    p('');
  }
  const acted = groups.filter(g => variantNeedsIntercept(g.key)
    && g.runs.some(r => (r.interceptNotes || []).length));
  if (acted.length) {
    p('  substitutions actually served (proof each intercepting row is live):');
    for (const g of acted) {
      const notes = [...new Set(g.runs.flatMap(r => r.interceptNotes || []))];
      p(`    ${g.key.padEnd(16)} ${notes.length} distinct: ${notes[0]}`);
      if (notes.length > 1) p(`    ${''.padEnd(16)} ...and ${notes.length - 1} more (one per tile)`);
    }
    p('');
  }
  p('  per-variant boot phases, median ms');
  const keys = ['ui.skin', 'ui.font', 'ui.layout', 'geodata', 'bspFloor', 'heightfix',
    'terrainMesh', 'props', 'bsp.lightmaps', 'bspLoad', 'terrain.total', 'neighbors'];
  p(`  ${'variant'.padEnd(16)}` + keys.map(k => k.slice(0, 11).padStart(12)).join(''));
  for (const g of groups) {
    p(`  ${g.key.padEnd(16)}`
      + keys.map(k => {
        const v = median(g.runs.map(r => r.bootPhases[k]).filter(x => x != null));
        return (Number.isFinite(v) ? String(Math.round(v)) : '-').padStart(12);
      }).join(''));
  }
  p('');
  const errRuns = groups.flatMap(g => g.runs.filter(r => r.consoleErrors.length)
    .map(r => [g.key, r]));
  if (errRuns.length) {
    p('  page errors (a run with these is NOT a clean measurement):');
    for (const [k, r] of errRuns) p(`    ${k.padEnd(16)} ${r.consoleErrors.length}x  `
      + r.consoleErrors[0].slice(0, 110));
    p('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// --selftest: prove the INSTRUMENT, in about a second, with no browser.
//
// Why this exists. Every defect this suite has actually shipped was a place
// where the harness reported a clean number for something it had not measured:
//   * the lightmap atlas was invisible because classify() had no rule for it,
//     so 42 KB of atlas sat inside a 204-request 'texture' bucket and the
//     profile that was used to clear the lightmap wave never showed a row;
//   * `lm-nosheet` substituted nothing for a whole matrix run, because
//     '*bsp.gltf' was missing from Fetch.enable's pattern list, and its row
//     read as a 351 ms finding instead of as a broken variant;
//   * the cold run's ui.skin/ui.font/ui.layout phases vanished into a wrapper
//     race and simply were not printed, which reads as "free".
// None of those would fail a timing check. They are all failures of the
// harness to know what it is looking at, so they need assertions on the
// harness, not on the numbers. Every case below FAILS on the tree before this
// revision: the rules, variants and guards it asserts did not exist.
function selftest() {
  const results = [];
  const ok = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail });
    return !!cond;
  };
  const tile = TILE;
  const dir = tileDir(tile);

  // 1. The lightmap atlas gets its OWN network class. Before this revision
  //    the generic .png rule swallowed it into 'texture'.
  const lmUrl = `http://127.0.0.1:8083/scenes/${tile}/lightmap/g0p0.png`;
  ok('classify: lightmap atlas is its own class, not "texture"',
    classify(lmUrl) === 'bsp lightmap atlas', `got "${classify(lmUrl)}"`);
  // ...and it must not steal the tile's other PNGs.
  ok('classify: bsp/*.png is still a texture, not a lightmap',
    classify(`http://x/scenes/${tile}/bsp/Giran_wall03.png`) === 'texture',
    `got "${classify(`http://x/scenes/${tile}/bsp/Giran_wall03.png`)}"`);
  ok('classify: bspfloor.bin is still the walk raster',
    classify(`http://x/scenes/${tile}/bspfloor.bin`) === 'bspfloor (walk raster)');

  // 2. The lm-nosheet substitution really strips both things the lightmap
  //    wave added, on the REAL file on disk.
  const gPath = path.join(dir, 'bsp.gltf');
  if (!fs.existsSync(gPath)) {
    ok(`lm-nosheet: ${tile}/bsp.gltf exists`, false, 'no bsp.gltf on disk');
  } else {
    const raw = JSON.parse(fs.readFileSync(gPath, 'utf8'));
    const rawSheets = (raw.materials || []).filter(m => m.extras && 'lightmapSheet' in m.extras).length;
    const rawUv1 = (raw.meshes || []).flatMap(m => m.primitives || [])
      .filter(pr => pr.attributes && 'TEXCOORD_1' in pr.attributes).length;
    ok('lm-nosheet: the shipped bsp.gltf actually HAS lightmaps to remove',
      rawSheets > 0 && rawUv1 > 0, `${rawSheets} sheets, ${rawUv1} TEXCOORD_1`);
    const sub = variantBody('lm-nosheet', `http://x/scenes/${tile}/bsp.gltf`);
    if (!ok('lm-nosheet: substitution produced a body', !!sub)) { /* reported */ }
    else {
      const g = JSON.parse(sub.body.toString('utf8'));
      const sheets = (g.materials || []).filter(m => m.extras && 'lightmapSheet' in m.extras).length;
      const uv1 = (g.meshes || []).flatMap(m => m.primitives || [])
        .filter(pr => pr.attributes && 'TEXCOORD_1' in pr.attributes).length;
      ok('lm-nosheet: every lightmapSheet extra removed', sheets === 0, `${sheets} left`);
      ok('lm-nosheet: every TEXCOORD_1 attribute removed', uv1 === 0, `${uv1} left`);
      ok('lm-nosheet: TEXCOORD_0 is NOT touched (the base map must still work)',
        (g.meshes || []).flatMap(m => m.primitives || [])
          .every(pr => 'TEXCOORD_0' in pr.attributes));
      ok('lm-nosheet: mesh/material counts unchanged (only attributes removed)',
        (g.materials || []).length === (raw.materials || []).length
        && (g.meshes || []).length === (raw.meshes || []).length);
    }
  }

  // 3. Fetch.enable must actually pause every URL a variant wants to rewrite.
  //    This is the exact bug that made lm-nosheet inert for a whole matrix.
  const PATTERNS = ['*bspfloor.bin', '*scene.json', '*bsp.gltf'];
  const matches = (pat, url) => new RegExp('^' + pat.split('*').map(s =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(url);
  for (const [v, url] of [
    ['walktrunc', `http://x/scenes/${tile}/bspfloor.bin`],
    ['props0', `http://x/scenes/${tile}/scene.json`],
    ['nb-nosplat', 'http://x/scenes/21_21/scene.json'],
    ['lm-nosheet', `http://x/scenes/${tile}/bsp.gltf`],
  ]) {
    ok(`Fetch.enable pattern covers ${v}'s URL (${url.split('/').pop()})`,
      variantNeedsIntercept(v) && PATTERNS.some(p => matches(p, url)));
  }

  // 4. nb-nosplat must hit NEIGHBOURS and must never touch the profiled tile —
  //    rewriting the centre tile would change the terrain material under test
  //    and quietly turn a neighbour experiment into a centre-tile one.
  const nbTile = ['21_21', '21_22', '22_21', '23_23']
    .find(t => fs.existsSync(path.join(tileDir(t), 'scene.json')));
  if (!nbTile) ok('nb-nosplat: a neighbour scene.json exists to test with', false);
  else {
    const sub = variantBody('nb-nosplat', `http://x/scenes/${nbTile}/scene.json`);
    if (!ok(`nb-nosplat: rewrote neighbour ${nbTile}`, !!sub)) { /* reported */ }
    else {
      const d = JSON.parse(sub.body.toString('utf8'));
      const raw = JSON.parse(fs.readFileSync(path.join(tileDir(nbTile), 'scene.json'), 'utf8'));
      ok('nb-nosplat: no layer keeps a splat', (d.layers || []).every(l => !l.splat));
      ok('nb-nosplat: the layer COUNT is unchanged (only splat keys dropped)',
        (d.layers || []).length === (raw.layers || []).length);
      ok('nb-nosplat: props/heightmap untouched',
        JSON.stringify(d.props || []) === JSON.stringify(raw.props || [])
        && d.heightmap === raw.heightmap);
    }
  }
  ok('nb-nosplat: the PROFILED tile is never rewritten',
    variantBody('nb-nosplat', `http://x/scenes/${tile}/scene.json`) === null);

  // 4b. The null-intercept control must serve the file BYTE-IDENTICALLY. If it
  //     differed by even a byte it would stop being a measurement of the
  //     harness tax and become another variant.
  const scPath = path.join(dir, 'scene.json');
  if (fs.existsSync(scPath)) {
    const sub = variantBody('null-intercept', `http://x/scenes/${tile}/scene.json`);
    ok('null-intercept: serves scene.json byte-for-byte',
      !!sub && sub.body.equals(fs.readFileSync(scPath)),
      sub ? `${sub.body.length} B` : 'no body');
    ok('null-intercept: intercepts the same file the props* variants do',
      variantNeedsIntercept('null-intercept'));
  }

  // 4c. The impossible-sign guard. Every variant removes work, so a positive
  //     delta past the noise floor is a harness problem, not a client finding.
  const dose = (ms) => ({ milestones: { worldReady: ms }, network: {},
    consoleErrors: [], bootPhases: {}, interceptNotes: ['x'] });
  const signTxt = attributeReport([
    { key: 'full', why: 'c', runs: [dose(4000), dose(4000), dose(4000)] },
    { key: 'props1891', why: 'x', runs: [dose(5000), dose(5000), dose(5000)] },
    { key: 'props0', why: 'x', runs: [dose(2000), dose(2000), dose(2000)] },
  ]);
  ok('sign guard: a variant that got SLOWER is SUSPECT, not RESOLVED',
    /props1891.*SUSPECT/.test(signTxt));
  ok('sign guard: a variant that got faster is still RESOLVED',
    /props0\s.*RESOLVED/.test(signTxt));

  // 5. The inert-variant detector. A variant that rewrote nothing must be
  //    called out, not silently reported as "delta ~ 0".
  const fakeRun = (notes) => ({ milestones: { worldReady: 1000 }, network: {},
    consoleErrors: [], bootPhases: {}, interceptNotes: notes });
  const inertGroups = [
    { key: 'full', why: 'control', runs: [fakeRun([])] },
    { key: 'lm-nosheet', why: 'x', runs: [fakeRun([])] },
  ];
  const liveGroups = [
    { key: 'full', why: 'control', runs: [fakeRun([])] },
    { key: 'lm-nosheet', why: 'x', runs: [fakeRun(['rewrote something'])] },
  ];
  const inertTxt = attributeReport(inertGroups);
  const liveTxt = attributeReport(liveGroups);
  ok('inert detector: fires when a variant rewrote nothing',
    /INERT VARIANT/.test(inertTxt));
  ok('inert detector: silent when the variant did rewrite',
    !/INERT VARIANT/.test(liveTxt) && /substitutions actually served/.test(liveTxt));
  ok('inert detector: does NOT accuse `full`, which intercepts nothing by design',
    !/^\s+full\s+substituted NOTHING/m.test(inertTxt));

  // 6. Baseline refusal. Each of these shapes has actually been on disk in
  //    this repo and each would have made --check meaningless.
  const goodProv = { head: 'abc', treeChangedDuringRun: false,
    machineBefore: { loadavg: [1, 1, 1], cpus: 10 }, machineAfter: { loadavg: [1, 1, 1] },
    bootPhasesCaptured: 15, swiftshader: SWIFT, variant: VARIANT, tile: TILE,
    // must mirror how THIS invocation would be run, or the private-vs-supplied
    // server rule fires and the "clean baseline" fixture is not clean
    privateServer: !argv.includes('--port') };
  const withProv = (over) => ({ format: BASELINE_FORMAT, tile: TILE, at: 'now',
    metrics: {}, provenance: Object.assign({}, goodProv, over) });
  ok('baseline: a clean format-3 baseline is ACCEPTED',
    baselineComplaint(withProv({})) === null,
    String(baselineComplaint(withProv({}))));
  ok('baseline: format 2 refused',
    /format 2/.test(baselineComplaint({ format: 2, provenance: goodProv }) || ''));
  ok('baseline: captured on a busy machine refused',
    /BUSY/.test(baselineComplaint(withProv({ machineBefore: { loadavg: [9, 9, 9], cpus: 10 } })) || ''));
  ok('baseline: captured over a changing tree refused',
    /CHANGING/.test(baselineComplaint(withProv({ treeChangedDuringRun: true })) || ''));
  ok('baseline: captured with no boot phases refused',
    /no BOOT phase/.test(baselineComplaint(withProv({ bootPhasesCaptured: 0 })) || ''));
  ok('baseline: renderer/swiftshader mismatch refused',
    /swiftshader/.test(baselineComplaint(withProv({ swiftshader: !SWIFT })) || ''));

  // 7. The baseline ON DISK must carry the lightmap phase. A baseline from
  //    before the lightmap wave cannot catch a lightmap regression, and
  //    nothing in a timing comparison would say so.
  if (fs.existsSync(BASELINE)) {
    const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const keys = Object.keys(b.metrics || {});
    ok('baseline on disk: carries cold.boot.bsp.lightmaps',
      keys.includes('cold.boot.bsp.lightmaps'),
      `baseline ${b.at} head ${(b.provenance || {}).head} has ${keys.length} metrics`);
    ok('baseline on disk: carries warm.boot.bsp.lightmaps',
      keys.includes('warm.boot.bsp.lightmaps'));
  } else {
    ok('baseline on disk: exists', false, `${BASELINE} missing`);
  }

  // 8. walkSectionOffset still finds the real section 2 (walktrunc is a lie
  //    without it, and would silently degrade to "serve the file unchanged").
  const bfPath = path.join(dir, 'bspfloor.bin');
  if (fs.existsSync(bfPath)) {
    const buf = fs.readFileSync(bfPath);
    const off = walkSectionOffset(buf);
    ok('walktrunc: section 2 located in the real bspfloor.bin',
      off != null && off > 0 && off < buf.length,
      `offset ${off} of ${buf.length} B`);
    if (off != null) {
      ok('walktrunc: truncating actually shrinks the file',
        variantBody('walktrunc', `http://x/scenes/${tile}/bspfloor.bin`).body.length === off);
    }
  }

  const failed = results.filter(r => !r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
  }
  console.log('');
  if (failed.length) {
    console.error(`VERIFY LOADPROFILE SELFTEST FAILED: ${failed.length}/${results.length}`);
    return false;
  }
  console.log(`SELFTEST PASS  ${results.length}/${results.length}`);
  return true;
}

// ---------------------------------------------------------------------------
function flatten(res) {
  const out = {};
  for (const [tag, run] of [['cold', res.cold], ['warm', res.warm]]) {
    if (!run) continue;
    for (const [k, v] of Object.entries(run.milestones)) if (v != null) out[`${tag}.${k}`] = v;
    out[`${tag}.reloadWarmTotal`] = run.reloadWarm.totalMs;
    for (const [k, v] of Object.entries(run.bootPhases)) out[`${tag}.boot.${k}`] = v;
    const net = Object.values(run.network);
    out[`${tag}.net.requests`] = net.reduce((a, v) => a + v.requests, 0);
    out[`${tag}.net.transferKB`] = Math.round(net.reduce((a, v) => a + v.transferBytes, 0) / 1024);
  }
  return out;
}

// Two agents edit this repo concurrently. A profile taken over a tree that was
// being written mid-run is not comparable to one taken over a clean tree, and
// nothing in the numbers themselves would reveal it. Record it.
function treeState() {
  const { execSync } = require('child_process');
  const sh = (c) => { try { return execSync(c, { cwd: __dirname, encoding: 'utf8' }).trim(); }
    catch (_) { return '?'; } };
  const dirty = sh('git status --porcelain').split('\n').filter(Boolean);
  return { head: sh('git rev-parse --short HEAD'), dirtyFiles: dirty.length,
    dirty: dirty.slice(0, 40).map(s => s.trim()) };
}

function machineState() {
  const os = require('os');
  return { cpus: os.cpus().length, loadavg: os.loadavg().map(v => +v.toFixed(2)),
    freeMemMB: Math.round(os.freemem() / 1048576), platform: `${os.platform()} ${os.release()}` };
}

// BASELINE FORMAT 3. Format 2 is REFUSED, for two independent reasons that
// were both true of the format-2 baseline that shipped
// (verify_loadprofile.baseline.json @ 2026-08-09T03:22Z, head 3dc180e):
//
//   a) it was taken under `--use-angle=swiftshader`, i.e. software GL, and
//      carries no record of the renderer, so nothing in the file reveals it;
//   b) `provenance.phasesCaptured: 0` — the phase breakdown, the only part
//      anyone would act on, was lost to a protocolTimeout, so a --check
//      against it compared milestones only.
//
// It was ALSO captured at head 3dc180e, which is downstream of BOTH 4a323f0
// (the walk raster) and 398286c (the prop wave), so it could never have served
// as a before-picture for either.
const BASELINE_FORMAT = 3;
function baselineComplaint(base) {
  if ((base.format || 1) < BASELINE_FORMAT) {
    return `the baseline at ${BASELINE} is format ${base.format || 1} (captured `
      + `${base.at}, head ${(base.provenance || {}).head}). Format < 3 was taken under `
      + 'SwiftShader and/or without boot phases, and records neither the renderer nor '
      + 'the variant. It is refused rather than trusted. Re-baseline on an idle machine '
      + 'with a clean tree: node verify_loadprofile.js --save';
  }
  const p = base.provenance || {};
  // A BASELINE TAKEN ON A BUSY MACHINE IS PERMANENTLY USELESS, and this repo
  // has already shipped one: the format-2 file was captured with loadavg 4.07
  // rising to 12.08 on 10 cores while another job rewrote the very tile being
  // profiled, and it recorded cold worldReady 15 371 ms — 3.6x the 4 313 ms
  // the same tile measures on an idle machine and the real GPU. Checking
  // against a number like that is checking "is the machine as busy today", and
  // it will pass every real regression. Refuse it.
  //
  // The bar is loadavg1 > 60% of the core count at capture, on EITHER sample.
  // A run that is itself busy can only produce false FAILs, which are visible;
  // a BASELINE that was busy hides real ones, which is not. So this refuses
  // the baseline and merely warns about the current run.
  const lb = (p.machineBefore || {}).loadavg || [0];
  const la = (p.machineAfter || {}).loadavg || [0];
  const cores = (p.machineBefore || {}).cpus || 1;
  if (Math.max(lb[0], la[0]) > cores * 0.6) {
    return `the baseline at ${BASELINE} was captured on a BUSY machine `
      + `(loadavg ${lb[0]} -> ${la[0]} on ${cores} cores; the bar is ${(cores * 0.6).toFixed(1)}). `
      + 'Its numbers are a measurement of the machine, not of the client, and a check '
      + 'against them would pass every real regression. Re-baseline when idle: '
      + 'node verify_loadprofile.js --save';
  }
  if (p.treeChangedDuringRun) {
    return `the baseline at ${BASELINE} was captured while the working tree was `
      + 'CHANGING under it. Re-baseline.';
  }
  if (!p.bootPhasesCaptured) {
    return `the baseline at ${BASELINE} has no BOOT phase timings (wrappers `
      + `beforeFirstLoad=${p.wrappersBeforeFirstLoad}). Milestones alone cannot tell a `
      + 'slow walk-raster fetch from a slow prop parse. Re-baseline.';
  }
  if (p.swiftshader !== SWIFT) {
    return `the baseline at ${BASELINE} was taken with swiftshader=${p.swiftshader} `
      + `and this run has swiftshader=${SWIFT}. Software GL is ~an order of magnitude `
      + 'slower on HD tiles; the two are not comparable. Re-baseline or match the flag.';
  }
  if (p.variant !== VARIANT || p.tile !== TILE) {
    return `the baseline at ${BASELINE} is for tile ${p.tile} variant ${p.variant}; `
      + `this run is tile ${TILE} variant ${VARIANT}. Not comparable.`;
  }
  // A baseline taken against a private freshly-spawned server cannot be
  // checked against the shared long-lived :8083 process, or the reverse: the
  // shared one has a 5-deep accept queue that has been serving other suites
  // for days, and that difference is worth seconds, not milliseconds.
  if (!!p.privateServer !== !argv.includes('--port')) {
    return `the baseline at ${BASELINE} was taken against a `
      + `${p.privateServer ? 'private freshly-spawned' : 'caller-supplied'} server and this `
      + `run uses a ${argv.includes('--port') ? 'caller-supplied' : 'private freshly-spawned'} `
      + 'one. Not comparable — match the invocation or re-baseline.';
  }
  if (p.cacheMode && p.cacheMode !== (NOCACHE ? 'cache DISABLED (pathological)'
    : 'empty disk cache (first visit)')) {
    return `the baseline at ${BASELINE} was taken with cold = "${p.cacheMode}" and this `
      + `run uses --nocache=${NOCACHE}. Not comparable.`;
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Validate the baseline BEFORE spending the measurement time against it.
  if (CHECK && !SAVE && fs.existsSync(BASELINE)) {
    const why = baselineComplaint(JSON.parse(fs.readFileSync(BASELINE, 'utf8')));
    if (why) { console.error(`VERIFY LOADPROFILE FAILED: ${why}`); process.exit(2); }
  }
  const res = { tile: TILE, variant: VARIANT, port: PORT, swiftshader: SWIFT,
    at: new Date().toISOString(), treeBefore: treeState(), machineBefore: machineState() };

  const slim = r => ({ variant: r.variant, port: r.port, gl: r.gl,
    milestones: r.milestones, bootPhases: r.bootPhases, bootCalls: r.bootCalls,
    network: r.network, connections: r.connections,
    walkRasterLoaded: r.walkRasterLoaded, propsCount: r.propsCount,
    consoleErrors: r.consoleErrors, wrappers: r.wrappers,
    interceptNotes: r.interceptNotes, timeWaitBefore: r.timeWaitBefore,
    longtasks: r.longtasks, cpuMs: r.cpuMs, bootWallMs: r.bootWallMs });

  if (SELFTEST) { process.exit(selftest() ? 0 : 1); }

  if (ATTRIBUTE) {
    const groups = await attribute();
    res.attribution = groups.map(g => ({ key: g.key, why: g.why, runs: g.runs.map(slim) }));
    res.machineAfter = machineState();
    res.treeAfter = treeState();
    if (JSON_ONLY) console.log(JSON.stringify(res, null, 2));
    else console.log(attributeReport(groups));
    return;
  }

  if (AB) {
    const rows = await abProtocol();
    res.ab = rows.map(r => ({ keepalive: r.keepalive, backlog: r.backlog,
      repeat: r.repeat, timeWaitBefore: r.timeWaitBefore, run: slim(r.run) }));
    res.machineAfter = machineState();
    res.treeAfter = treeState();
    if (JSON_ONLY) console.log(JSON.stringify(res, null, 2));
    else console.log(abReport(rows));
    return;
  }

  // A PRIVATE SERVER FOR THE PROFILE TOO, unless --port names one. Measuring
  // against the shared long-lived :8083 process is what produced the 12.7 s
  // cold run in this suite's own history: it had been serving other agents'
  // suites for days and its accept queue is 5 deep. Pass --port 8083
  // explicitly to profile the real process on purpose.
  const explicitPort = argv.includes('--port');
  const runPair = async (port) => {
    res.serverPort = port;
    res.cold = await profileRun({ cold: true, port });
    await drain();
    res.warm = await profileRun({ cold: false, port });
  };
  if (explicitPort) await runPair(PORT);
  else await withServer({ keepalive: false }, runPair);   // HTTP/1.0, as shipped
  res.treeAfter = treeState();
  res.machineAfter = machineState();
  res.treeChangedDuringRun = JSON.stringify(res.treeBefore) !== JSON.stringify(res.treeAfter);

  if (JSON_ONLY) console.log(JSON.stringify(res, null, 2));
  else console.log(report(res));

  const flat = flatten(res);
  if (SAVE || (CHECK && !fs.existsSync(BASELINE))) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      format: BASELINE_FORMAT, tile: TILE, at: res.at, metrics: flat,
      provenance: {
        head: res.treeBefore.head, dirtyFiles: res.treeBefore.dirtyFiles,
        treeChangedDuringRun: res.treeChangedDuringRun,
        machineBefore: res.machineBefore, machineAfter: res.machineAfter,
        propsCount: res.cold.propsCount, tile: TILE, variant: VARIANT,
        // the port ACTUALLY served from, not the --port default: an
        // unqualified run spawns its own server and :8083 was never touched.
        port: res.serverPort, privateServer: !argv.includes('--port'),
        cacheMode: res.cold.cacheMode,
        swiftshader: SWIFT, renderer: res.cold.gl,
        walkRasterLoaded: res.cold.walkRasterLoaded,
        wrappersBeforeFirstLoad: res.cold.wrappers.beforeFirstLoad,
        bootPhasesCaptured: Object.keys(res.cold.bootPhases).length,
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
  console.log(`baseline ${base.at}  head ${prov.head}  renderer ${prov.renderer}`);
  console.log(`  loadavg at capture ${JSON.stringify(prov.machineBefore.loadavg)}  `
    + `now ${JSON.stringify(res.machineBefore.loadavg)}`);
  if (res.machineBefore.loadavg[0] > res.machineBefore.cpus * 0.6) {
    console.log(`  WARNING: THIS run was taken on a busy machine `
      + `(loadavg ${res.machineBefore.loadavg[0]} on ${res.machineBefore.cpus} cores). `
      + 'A FAIL below may be the machine, not the client. Re-run when idle before acting.');
  }
  if (res.cold.gl !== prov.renderer) {
    console.error(`VERIFY LOADPROFILE FAILED: renderer is now ${res.cold.gl}, baseline was `
      + `${prov.renderer}. Not comparable.`);
    process.exit(2);
  }
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
