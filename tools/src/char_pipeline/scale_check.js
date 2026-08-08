// Human-scale oracle for `nativeHeight`.
//
// F5 asked whether the manifest's nativeHeight is the size the retail
// client actually renders a character at.  Two retail numbers disagree by
// 5-9%: the mesh measurement (glTF extent x ULodMesh.MeshScale) and twice
// the server/client collision half-height.  Neither can be checked against
// the other without a third, independent yardstick, so this harness puts
// the character next to retail geometry whose real-world size is not in
// dispute, at raw L2 world units, in an orthographic elevation view:
//
//   * a retail LONGBOW (LineageWeapons.ukx) - a longbow is by construction
//     about the height of its archer;
//   * a retail POLEARM - 1.2-1.4x the wielder's height;
//   * a retail WOOD FENCE staticmesh - about chest-to-head height;
//   * a retail STAIRCASE staticmesh - 8.0-unit risers (the L2 geodata Z
//     quantum), so the picture also shows how many steps tall a character
//     is.
//
// Everything is drawn at the size its own file says it is; the ruled lines
// are every 10 L2 units.  Read the PNG - that is the point of the tool.
//
// Usage:
//   node scale_check.js [outdir]              # writes scale_check.png
//   node scale_check.js --check [outdir]      # + asserts the rendered
//        character heights equal the manifest nativeHeight (that the
//        client's scaling rule really lands on the number we ship)
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '../../..');
const CHARS = path.join(ROOT, 'editor/characters');
const WORLD = path.join(ROOT, 'assets/world');
const PORT = 8127;
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
              '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png'};

// Retail props chosen for an unambiguous real-world size.  Each is
// <tile>/<mesh>; the converter leaves them in metres, the page x100s them.
const PROPS = {
  fence: '21_16/props/Elmo_LM_woodfence01_01.gltf',
  stair: '17_22/props/GL_Stair02.gltf',
};

function manifest() {
  const m = JSON.parse(fs.readFileSync(path.join(CHARS, 'manifest.json'), 'utf8'));
  return Object.fromEntries(m.models.map(e => [e.id, e]));
}

(async () => {
  const check = process.argv.includes('--check');
  const outdir = process.argv.slice(2).filter(a => a !== '--check')[0] || '/tmp';
  fs.mkdirSync(outdir, {recursive: true});
  const man = manifest();

  const spec = {
    width: 1600, height: 820, span: 215, rulerTo: 100, top: 90,
    marks: [{y: 45.96, colour: 0x2f8f4f}],
    objects: [
      // GL_Stair02 is 214 units wide and would swamp the frame, so its
      // contribution is the measured 8.0-unit riser (audit_native_height.py
      // --props), not a picture.
      {url: '/world/' + PROPS.fence, x: -78, rotY: Math.PI / 2,
       label: 'Elmo_LM_woodfence01_01'},
      {url: '/chars/models/human_fighter_m.gltf', x: -30, anim: 'idle', t: 0.3,
       nativeHeight: man.human_fighter_m.nativeHeight, label: 'human_fighter_m'},
      {url: '/chars/models/human_mystic_f.gltf', x: -4, anim: 'idle', t: 0.3,
       nativeHeight: man.human_mystic_f.nativeHeight, label: 'human_mystic_f'},
      {url: '/chars/models/orc_fighter_m.gltf', x: 24, anim: 'idle', t: 0.3,
       nativeHeight: man.orc_fighter_m.nativeHeight, label: 'orc_fighter_m'},
      // weapons stood on end (rotZ) and turned face-on (rotY)
      {url: '/chars/weapons/models/long_bow_m00_wp.gltf', x: 56,
       rotZ: Math.PI / 2, rotY: Math.PI / 2, label: 'long_bow'},
      {url: '/chars/weapons/models/long_spear_m00_wp.gltf', x: 74,
       rotZ: Math.PI / 2, rotY: Math.PI / 2, label: 'long_spear'},
      {url: '/chars/weapons/models/short_bow_m00_wp.gltf', x: 90,
       rotZ: Math.PI / 2, rotY: Math.PI / 2, label: 'short_bow'},
    ],
  };

  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/spec.json') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify(spec));
    }
    let file;
    if (p === '/') file = path.join(__dirname, 'scale_check.html');
    else if (p.startsWith('/chars/')) file = path.join(CHARS, p.slice(7));
    else if (p.startsWith('/world/')) file = path.join(WORLD, p.slice(7));
    else file = path.join(__dirname, p);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
      res.end(data);
    });
  }).listen(PORT, '127.0.0.1');

  const browser = await puppeteer.launch({executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader']});
  let fail = false;
  try {
    const page = await browser.newPage();
    await page.setViewport({width: spec.width, height: spec.height});
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction('window.__done === true', {timeout: 180000});
    const err = await page.evaluate('window.__err');
    if (err) { console.error('LOAD ERROR:', err); fail = true; }
    const measured = await page.evaluate('window.__measured');
    const out = path.join(outdir, 'scale_check.png');
    await page.screenshot({path: out});
    console.log('wrote ' + out);
    for (const [k, v] of Object.entries(measured)) console.log(`  ${k.padEnd(30)} ${v} L2 units`);
    if (check) {
      for (const o of spec.objects) {
        if (!o.nativeHeight) continue;
        const got = measured[o.label];
        if (Math.abs(got - o.nativeHeight) > 0.05) {
          console.log(`FAIL: ${o.label} rendered ${got}, manifest nativeHeight ${o.nativeHeight}`);
          fail = true;
        }
      }
      console.log(fail ? 'FAIL' : 'PASS');
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (fail) process.exitCode = 1;
})();
