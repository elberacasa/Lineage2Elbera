// A/B proof that triangle winding changes three.js SHADING, not visibility.
//
// Every material in this pipeline is doubleSided, so an inside-out mesh is
// still fully visible — which is why the defect survived so long.  What it
// does change is lighting: WebGL/three.js negate the interpolated shading
// normal on back-facing fragments, so a key light in front of an inverted
// surface illuminates it as if it were behind.  Under render_check.html's
// ambient-heavy rig that is invisible; under shading_check.html's
// key-light-only rig it is the difference between a lit model and a black
// silhouette, and the page reports the mean silhouette luminance so the
// difference is a measurement.
//
// The "before" side is reconstructed, not archived: --invert rewrites a
// copy of the model with every triangle's index order reversed and nothing
// else touched, which is exactly the state assemble.py used to emit.
//
// Usage:
//   node shading_check.js <model-id> [anim] [t] [outdir]
//        -> <outdir>/<id>_fixed.png and <id>_inverted.png + luminances
//   node shading_check.js --check <model-id> [...]   # exit 1 unless the
//        fixed render is at least 3x brighter than the inverted one
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHARS = path.resolve(__dirname, '../../../editor/characters');
const PORT = 8124;
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
              '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png'};

// Write <dir>/<name>_inverted.gltf/.bin: same file with every triangle's
// three indices emitted as (i0, i2, i1).  Index accessors only; positions,
// normals, UVs, skins and animations are byte-identical.
function writeInverted(gltfPath, outBase) {
  const g = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  const bin = Buffer.from(fs.readFileSync(path.join(path.dirname(gltfPath), g.buffers[0].uri)));
  const SZ = {5121: 1, 5123: 2, 5125: 4};
  for (const mesh of g.meshes || []) for (const prim of mesh.primitives) {
    if (prim.indices === undefined) continue;
    const acc = g.accessors[prim.indices];
    const bv = g.bufferViews[acc.bufferView];
    const sz = SZ[acc.componentType];
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    for (let t = 0; t + 2 < acc.count; t += 3) {
      const o1 = base + (t + 1) * sz, o2 = base + (t + 2) * sz;
      const a = bin.subarray(o1, o1 + sz), b = bin.subarray(o2, o2 + sz);
      const tmp = Buffer.from(a); a.set(b); b.set(tmp);
    }
  }
  g.buffers[0].uri = path.basename(outBase) + '.bin';
  fs.writeFileSync(outBase + '.gltf', JSON.stringify(g));
  fs.writeFileSync(outBase + '.bin', bin);
}

(async () => {
  const argv = process.argv.slice(2).filter(a => a !== '--check');
  const check = process.argv.includes('--check');
  const [id, anim = 'idle', t = '0.5', outdir = '/tmp'] = argv;
  if (!id) { console.error('usage: node shading_check.js <model-id> [anim] [t] [outdir]'); process.exit(1); }
  fs.mkdirSync(outdir, {recursive: true});

  // id may be a bare character id or a path under editor/characters/
  // (e.g. "monsters/models/wolf_m00") so monsters can be checked too
  const rel = (id.includes('/') ? id : 'models/' + id) + '.gltf';
  const src = path.join(CHARS, rel);
  const tmp = fs.mkdtempSync('/tmp/l2shade_');
  writeInverted(src, path.join(tmp, path.basename(id) + '_inverted'));

  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (p === '/') file = path.join(__dirname, 'shading_check.html');
    else if (p.startsWith('/chars/')) file = path.join(CHARS, p.slice(7));
    else if (p.startsWith('/tmp/')) file = path.join(tmp, p.slice(5));
    else file = path.join(__dirname, p);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
      res.end(data);
    });
  }).listen(PORT, '127.0.0.1');

  const browser = await puppeteer.launch({executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader']});
  const shot = async (url, out) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/?gltf=${encodeURIComponent(url)}&anim=${anim}&t=${t}`);
    await page.waitForFunction('window.__done === true', {timeout: 120000});
    const err = await page.evaluate('window.__err');
    if (err) { console.error('LOAD ERROR:', err); process.exit(1); }
    const lum = await page.evaluate('window.__lum');
    const px = await page.evaluate('window.__px');
    await page.screenshot({path: out});
    await page.close();
    return {lum, px};
  };
  try {
    const a = await shot('/chars/' + rel, path.join(outdir, path.basename(id) + '_fixed.png'));
    const b = await shot('/tmp/' + path.basename(id) + '_inverted.gltf', path.join(outdir, path.basename(id) + '_inverted.png'));
    const ratio = b.lum > 0 ? a.lum / b.lum : Infinity;
    console.log(`${id} ${anim}@${t}s  fixed lum ${a.lum.toFixed(2)} (${a.px}px)  ` +
                `inverted lum ${b.lum.toFixed(2)} (${b.px}px)  ratio ${ratio.toFixed(2)}x`);
    if (check && !(ratio >= 3)) { console.log('FAIL: fixed render is not >=3x brighter'); process.exitCode = 1; }
    else if (check) console.log('PASS');
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, {recursive: true, force: true});
  }
})();
