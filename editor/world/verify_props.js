// verify_props.js — does every scene.json prop placement become a rendered
// object in the real client, and if not, why?
//
// WHY this suite exists: props drop out of the client silently.  The loader
// (js/terrain.js `_loadPropsInstanced`) skips a placement whose scene.json
// entry has `"gltf": null` without a word, and swallows a failed template
// load into a `console.warn`.  Neither shows up as an error, so a missing
// building reads exactly like a terrain bug.  This counts, per tile:
//
//   placements            scene.json entries under "props"
//   noGltf                entries with "gltf": null (never even attempted)
//   templatesFailed       glTF fetch/parse rejections (the swallowed ones)
//   placementsRendered    placements with >=1 InstancedMesh instance carrying
//                         non-empty geometry at the placement's world position
//   placementsMissing     the rest — the number that matters
//   emptySections         InstancedMeshes built on a 0-vertex primitive
//                         (retail UE2 static meshes really do carry empty
//                         sections; umodel exports them too, so these are
//                         faithful, not lost geometry — counted, not failed)
//
// The static half of the same question — which packages on disk *could*
// never draw — is tools/world/prop_census.py, which runs over all 100 tiles
// in ~3 s without a browser.  This suite is the live confirmation for a
// sample of tiles.  The SOURCE half — retail placements that never reach
// scene.json at all — is `prop_census.py --maps`; that is where the real
// losses were (5,593 world-wide, see docs/map-format.md 3.1).
//
// DO NOT probe for a prop with a raycast at its scene.json position.  An
// L2 actor's origin is not inside its mesh: Giran_V_Plaza_Elevation's
// geometry spans 0.54..3.09 m from its own origin along local Z, so a
// downward ray fired at the placement coordinate passes beside the prop
// and reports only BSP and terrain.  That measurement is what produced the
// "props never reach the screen" diagnosis this suite was written to test —
// the prop was in the scene, visible, with a finite bounding sphere, the
// whole time.  Match instance transforms (as below) or ray-cast at the
// InstancedMesh bounding-sphere centre instead.
//
// Usage:  node verify_props.js [tile ...]      (default 22_22 20_18)
//         node verify_props.js --check         (PASS/FAIL exit code)
// Output: JSON report + PASS/FAIL lines.

const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 300000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const TILES = args.filter((a) => !a.startsWith('--'));
const tiles = TILES.length ? TILES : ['22_22', '20_18'];

const results = [];
const fail = (m) => results.push(['FAIL', m]);
const pass = (m) => results.push(['ok', m]);

// Runs inside the page: match every placement against the instances the
// loader actually produced.  A placement counts as rendered when some
// InstancedMesh with non-empty geometry holds an instance whose translation
// equals the placement's own world translation.  The loader composes
// placement-matrix * template-node-matrix; convert.py's gltf_to_proper_basis
// refuses any umodel template whose node carries a local transform, so that
// second factor is the identity — and if it ever stops being one, every
// placement of that template reports missing here rather than passing
// silently.
const census = async () => {
  const w = window.__world;
  const t = w.terrain;
  const THREE = await import('/vendor/three.module.min.js');
  const Terrain = t.constructor;

  const placements = (t.def.props || []);
  const withGltf = placements.filter((p) => p.gltf);

  // Bucket every instance translation on a 0.25 m grid and match with a
  // 1 cm tolerance.  Exact string keys do NOT work: InstancedMesh stores
  // its matrices in a Float32Array, so a translation read back with
  // getMatrixAt differs from the double-precision placement matrix by up
  // to ~1e-4 at town-scale coordinates.  (Matching on exact keys reported
  // 77 phantom "missing" placements in 22_22 — every one of them present.)
  const CELL = 0.25, TOL = 0.01;
  const key = (x, y, z) => `${Math.round(x / CELL)},${Math.round(y / CELL)},`
    + `${Math.round(z / CELL)}`;
  const drawn = new Map();   // cell key -> [ [x,y,z], ... ]
  const put = (x, y, z) => {
    const k = key(x, y, z);
    let a = drawn.get(k);
    if (!a) drawn.set(k, a = []);
    a.push([x, y, z]);
  };
  const has = (x, y, z) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const a = drawn.get(key(x + dx * CELL, y + dy * CELL, z + dz * CELL));
          if (!a) continue;
          for (const q of a) {
            if (Math.abs(q[0] - x) < TOL && Math.abs(q[1] - y) < TOL
                && Math.abs(q[2] - z) < TOL) return true;
          }
        }
      }
    }
    return false;
  };
  let instances = 0, emptySections = 0, meshes = 0;
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const im of t.props) {
    meshes++;
    const pos = im.geometry?.attributes?.position;
    const nonEmpty = !!pos && pos.count > 0;
    if (!nonEmpty) emptySections++;
    const n = im.isInstancedMesh ? im.count : 1;
    instances += n;
    if (!nonEmpty) continue;
    for (let i = 0; i < n; i++) {
      if (im.isInstancedMesh) im.getMatrixAt(i, m); else m.copy(im.matrix);
      v.setFromMatrixPosition(m);
      put(v.x, v.y, v.z);
    }
  }

  const missing = [];
  for (const p of withGltf) {
    const mm = Terrain._propMatrix(p, new THREE.Matrix4());
    v.setFromMatrixPosition(mm);
    if (!has(v.x, v.y, v.z)) {
      missing.push({ mesh: p.mesh, gltf: p.gltf, position: p.position });
    }
  }

  return {
    tile: t.def.tile,
    placements: placements.length,
    noGltf: placements.length - withGltf.length,
    propMeshes: meshes,
    instances,
    emptySections,
    placementsRendered: withGltf.length - missing.length,
    placementsMissing: missing.length,
    missing: missing.slice(0, 40),
    clusters: (t.propClusters || []).length,
  };
};

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
    // a 4,000-prop tile takes well over the 180 s CDP default to build
    protocolTimeout: LOAD_TIMEOUT,
  });
  const report = {};
  try {
    // ONE PAGE PER TILE, deliberately — the same harness constraint
    // verify_bsp.js documents: switching scenes twice inside one page hangs
    // the software-GL renderer on the second switch.
    for (const tile of tiles) {
     let page = null;
     try {
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      page.on('pageerror', (e) => fail('pageerror: ' + e.message));
      const warns = [];
      page.on('console', (msg) => {
        const s = msg.text();
        if (/^props:/.test(s)) warns.push(s);
      });
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
      await page.waitForFunction('window.__world && window.__world.ready',
                                 { timeout: LOAD_TIMEOUT });
      await page.select('#scene-picker', tile);
      await page.waitForFunction(
        (t) => document.getElementById('status').textContent.includes('scene: ' + t)
          && document.getElementById('loading').classList.contains('hidden'),
        { timeout: LOAD_TIMEOUT }, tile);
      await sleep(1500);
      const r = await page.evaluate(census);
      r.loaderWarnings = warns.slice();
      report[tile] = r;

      if (r.placementsMissing === 0) {
        pass(`${tile}: ${r.placementsRendered}/${r.placements - r.noGltf} `
             + `placements rendered (${r.instances} instances, `
             + `${r.emptySections} empty retail sections)`);
      } else {
        fail(`${tile}: ${r.placementsMissing} placements never became a `
             + `rendered object`);
      }
      if (r.noGltf) fail(`${tile}: ${r.noGltf} placements have no gltf in scene.json`);
      if (r.loaderWarnings.length) {
        fail(`${tile}: loader warnings: ${r.loaderWarnings.join(' | ')}`);
      }
     } catch (e) {
      fail(`${tile}: ${e.message.split('\n')[0]}`);
      report[tile] = { error: e.message.split('\n')[0] };
     } finally {
      if (page) await page.close().catch(() => {});
     }
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 1));
  for (const [k, m] of results) console.log(`${k.toUpperCase()}: ${m}`);
  const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `FAIL (${bad})` : 'PASS');
  if (CHECK && bad) process.exitCode = 1;
}

run();
