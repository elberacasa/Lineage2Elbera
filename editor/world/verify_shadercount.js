// verify_shadercount.js — how many distinct WebGL programs does a tile
// compile, and how much geometry does it upload?
//
// WHY: verify_loadprofile.js measured a Giran load and found the time is NOT
// in fetching or parsing (glTF parse: 324 ms; js/terrain.js: 44 ms) and NOT in
// the network (cold 158 s vs warm 147 s — caching buys 7%). It is in the GL
// driver: getShaderInfoLog 42 s + getProgramInfoLog 27 s (both are the
// synchronous stalls that a shader COMPILE shows up as) and texSubImage2D
// 26 s. That points at "how many distinct programs and textures does the
// scene create", which is what this measures.
//
// The reason it matters for the +6,782-prop wave: more distinct prop MESHES
// means more distinct materials, and three.js compiles one program per
// distinct material configuration. Prop COUNT is nearly free (instancing);
// prop VARIETY is not. This suite separates the two so nobody has to guess.
//
// CAVEAT, and it is the whole story here: headless Chrome runs SwiftShader,
// a software rasterizer. Shader compilation there costs far more than on a
// real GPU, so the SECONDS are not the owner's seconds. The COUNTS below are
// hardware-independent and are the point of this suite.
//
// Usage:  node verify_shadercount.js [tile ...]     (default 22_22)
//         node verify_shadercount.js --check        PASS/FAIL vs the baseline
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASELINE = path.join(__dirname, 'verify_shadercount.baseline.json');
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const TILES = argv.filter(a => !a.startsWith('--'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const tiles = TILES.length ? TILES : ['22_22'];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
    protocolTimeout: 900000,
  });
  const out = {};
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('http://127.0.0.1:8083/?cc=0', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 600000 });
    for (const tile of tiles) {
      await page.evaluate(t => window.__world.loadScene(t), tile);
      await sleep(3000);
      out[tile] = await page.evaluate(() => {
        const w = window.__world;
        const info = w.renderer.info;
        const t = w.terrain;
        const placements = (t.def.props || []).filter(p => p.gltf);
        const distinctGltf = new Set(placements.map(p => p.gltf)).size;
        // distinct material objects actually bound in the scene graph
        const mats = new Set();
        let instancedMeshes = 0;
        w.scene.traverse((o) => {
          if (!o.isMesh) return;
          if (o.isInstancedMesh) instancedMeshes++;
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (m) mats.add(m.uuid);
          }
        });
        return {
          programs: info.programs ? info.programs.length : null,
          distinctMaterials: mats.size,
          instancedMeshes,
          placements: placements.length,
          distinctGltfFiles: distinctGltf,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
        };
      });
      console.log(`${tile}: ${JSON.stringify(out[tile])}`);
    }
  } finally {
    await browser.close();
  }

  // The ratio that matters: programs per distinct prop mesh. Prop COUNT is
  // almost free (one InstancedMesh draws thousands); prop VARIETY compiles.
  for (const [tile, r] of Object.entries(out)) {
    if (r.programs && r.distinctGltfFiles) {
      console.log(`${tile}: ${r.programs} programs for ${r.distinctGltfFiles} distinct prop `
        + `meshes across ${r.placements} placements `
        + `(${(r.programs / r.distinctGltfFiles).toFixed(2)} programs per distinct mesh; `
        + `${(r.placements / Math.max(1, r.instancedMeshes)).toFixed(1)} placements per InstancedMesh)`);
    }
  }

  if (!CHECK) {
    fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), tiles: out }, null, 2));
    console.log(`baseline written: ${BASELINE}`);
    return;
  }
  if (!fs.existsSync(BASELINE)) {
    fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), tiles: out }, null, 2));
    console.log('PASS  baseline created on first --check run');
    return;
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).tiles;
  const bad = [];
  for (const [tile, r] of Object.entries(out)) {
    const b = base[tile];
    if (!b) continue;
    // Counts, not milliseconds — hardware-independent, so a tight bound is
    // honest here. 15% absorbs load-order nondeterminism in program creation.
    for (const k of ['programs', 'distinctMaterials', 'geometries', 'textures']) {
      if (b[k] && r[k] > b[k] * 1.15) bad.push(`${tile}.${k}: ${b[k]} -> ${r[k]}`);
    }
  }
  for (const x of bad) console.log(`FAIL  ${x}`);
  if (!bad.length) { console.log('PASS  no count grew more than 15% over the baseline'); return; }
  console.error(`VERIFY SHADERCOUNT FAILED: ${bad.length} count(s) regressed`);
  process.exit(1);
})().catch(e => { console.error('VERIFY SHADERCOUNT FAILED:', e.stack || e.message); process.exit(1); });
