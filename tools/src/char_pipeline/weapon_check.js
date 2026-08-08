// Attach-point verification for the weapon pipeline: loads a character glTF,
// poses it, then parents a weapon glTF to Weapon_R_Bone / Weapon_L_Bone with an
// IDENTITY transform (no position/rotation/scale is ever set) and screenshots.
// This is the check that proves editor/characters/weapons models need no offset.
//
// Setup:  cd tools/src/char_pipeline && npm install three puppeteer-core
// Usage:  node weapon_check.js <charId> <weaponId>:<R|L>[,...] [anim] [t] [out.png] [view] [ry]
//         node weapon_check.js human_fighter_m small_sword_m00_wp:R,tower_shield_m00_sh:L idle 0.5 /tmp/w.png
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CP = __dirname;
const CHARS = path.resolve(__dirname, '../../../editor/characters');
const PORT = 8131;
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
              '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png'};

const HTML = `<!doctype html><html><body style="margin:0">
<script type="importmap">
{"imports": {"three": "/node_modules/three/build/three.module.js",
             "three/addons/": "/node_modules/three/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(700, 900);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x223344);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dl = new THREE.DirectionalLight(0xffffff, 2.0); dl.position.set(1, 2, 3); scene.add(dl);
const camera = new THREE.PerspectiveCamera(35, 700 / 900, 0.01, 100);
window.__done = false; window.__err = null; window.__log = [];
const loader = new GLTFLoader();
const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
(async () => {
  const g = await load('/chars/models/' + q.get('char') + '.gltf');
  scene.add(g.scene);
  if (g.animations.length) {
    const mixer = new THREE.AnimationMixer(g.scene);
    const clip = g.animations.find(a => a.name === q.get('anim')) || g.animations[0];
    mixer.clipAction(clip).play();
    mixer.update(parseFloat(q.get('t') || '0.5'));
  }
  g.scene.updateMatrixWorld(true);
  const sockets = {};
  g.scene.traverse(o => { if (o.name === 'Weapon_R_Bone' || o.name === 'Weapon_L_Bone') sockets[o.name] = o; });
  window.__log.push('sockets: ' + Object.keys(sockets).join(','));
  for (const spec of (q.get('weapons') || '').split(',').filter(Boolean)) {
    const [wid, hand] = spec.split(':');
    const sock = sockets[hand === 'L' ? 'Weapon_L_Bone' : 'Weapon_R_Bone'];
    if (!sock) { window.__log.push('NO SOCKET for ' + wid); continue; }
    const w = await load('/chars/weapons/models/' + wid + '.gltf');
    // IDENTITY parenting: no position/rotation/scale is ever set here.
    sock.add(w.scene);
    window.__log.push('attached ' + wid + ' -> ' + sock.name);
  }
  g.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g.scene);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  g.scene.rotation.y = parseFloat(q.get('ry') || '0');
  g.scene.updateMatrixWorld(true);
  const view = q.get('view') || 'full';
  if (view === 'hand') {
    const sock = sockets['Weapon_R_Bone'];
    const p = new THREE.Vector3().setFromMatrixPosition(sock.matrixWorld);
    camera.position.set(p.x, p.y + s.y * 0.05, p.z + s.y * 0.45);
    camera.lookAt(p);
  } else {
    camera.position.set(c.x, c.y, box.max.z + s.y * 1.3);
    camera.lookAt(c);
  }
  renderer.render(scene, camera);
  window.__done = true;
})().catch(e => { window.__err = String(e && e.stack || e); window.__done = true; });
</script></body></html>`;

(async () => {
  const [char, weapons, anim = 'idle', t = '0.5', out = '/tmp/w.png', view = 'full', ry = '0'] = process.argv.slice(2);
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') { res.writeHead(200, {'Content-Type': 'text/html'}); return res.end(HTML); }
    const file = p.startsWith('/chars/') ? path.join(CHARS, p.slice(7)) : path.join(CP, p);
    fs.readFile(file, (err, data) => {
      if (err) { console.error('404', p); res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
      res.end(data);
    });
  }).listen(PORT, '127.0.0.1');
  const browser = await puppeteer.launch({executablePath: CHROME, args: ['--headless=new', '--use-angle=swiftshader']});
  try {
    const page = await browser.newPage();
    page.on('console', m => console.error('[page]', m.text()));
    const u = `http://127.0.0.1:${PORT}/?char=${char}&weapons=${encodeURIComponent(weapons)}&anim=${anim}&t=${t}&view=${view}&ry=${ry}`;
    await page.goto(u);
    await page.waitForFunction('window.__done === true', {timeout: 90000});
    const err = await page.evaluate('window.__err');
    console.log((await page.evaluate('window.__log')).join(' | '));
    if (err) { console.error('LOAD ERROR:', err); process.exit(1); }
    await page.screenshot({path: out});
    console.log('rendered', out);
  } finally { await browser.close(); server.close(); }
})();
