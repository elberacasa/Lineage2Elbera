// THE SKY IS THE DECODED SKY, NOT A CHOSEN GRADIENT.
//
// What this asserts, and why each one is here:
//
//  1. THE DECODE STILL REPRODUCES.  It shells out to
//     tools/audit/probe_skydome.py --json, which re-reads
//     assets/interlude/textures/l2_skies.utx and
//     assets/interlude/maps/skylevel.unr from scratch every run. Nothing here
//     is a copied number waiting to go stale: if the client and the client
//     files ever disagree, this is where it shows.
//
//  2. THE CLIENT USES IT.  Every sky constant in editor/world/js/main.js is
//     compared against that decode -- the background colour, the haze colour,
//     the band's two texture-v values, its height and radius, and all 128
//     bytes of the WhiteRing alpha ramp.
//
//  3. THE INVENTED PAIR IS GONE.  `SKY_ZENITH 0x33415e` / `SKY_HORIZON
//     0x93a5bd` had no source at all and filled the upper half of the screen
//     on every outdoor tile. A declaration of either fails this suite -- which
//     is also what makes it fail on the PRE-FIX tree rather than merely pass
//     on the post-fix one (proved: `git stash` the client, run --check, exit
//     1 on "the invented SKY_ZENITH/SKY_HORIZON pair is gone").
//
//  4. THE SHAPE IS THE RETAIL SHAPE.  The fragment shader is replayed in JS
//     and asserted against what the BSP says: flat background above the top
//     of the band, fully-opaque haze at and below the horizon, monotone in
//     between, and linear in TAN(elevation) -- a ray leaving the eye at
//     elevation t meets a cylinder wall of radius R at height R*tan(t), so a
//     shader that ramped in sin(elevation) or in y would be wrong even with
//     every colour right.
//
//  5. (--live) THE PIXEL ON THE SCREEN.  Renders the sky alone in the real
//     client and reads the framebuffer back at a column of elevations. This
//     is the check that caught the colour-space bug: three's ColorManagement
//     converts `new THREE.Color(hex)` into the LINEAR working space and a raw
//     ShaderMaterial gets no <colorspace_fragment>, so the old sky wrote
//     linear values into an sRGB framebuffer -- 0x33415e read back as
//     #080D1D. Asserting the constants alone would have missed that entirely.
//
// Usage:
//   node verify_sky.js                report the decode and the client's use
//   node verify_sky.js --check        assert, exit 1 on any drift
//   node verify_sky.js --live         also drive the client and read pixels
//   node verify_sky.js --live --shots=after   write verify_shots/sky_only_after.png
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(__dirname, 'js', 'main.js');
const PROBE = path.join(ROOT, 'tools', 'audit', 'probe_skydome.py');
const OUT = path.join(__dirname, 'verify_shots');

const CHECK = process.argv.includes('--check');
const LIVE = process.argv.includes('--live');
// --shots[=tag] writes verify_shots/sky_only_<tag>.png: the dome alone,
// nothing else in the scene, framed across the horizon. Run it once with
// the client stashed and once applied for the before/after pair.
const SHOTS = process.argv.find(a => a.startsWith('--shots'));
const SHOTS_TAG = SHOTS && SHOTS.includes('=') ? SHOTS.split('=')[1] : 'now';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const TILE = process.env.TILE || '19_24';

const summary = { checks: [], failed: false };
function check(name, ok, detail) {
  summary.checks.push({ name, ok: !!ok, detail });
  if (!ok) summary.failed = true;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------ the decode
function decode() {
  const raw = execFileSync('python3', [PROBE, '--json'],
    { maxBuffer: 1 << 26, cwd: ROOT }).toString();
  return JSON.parse(raw);
}

// --------------------------------------------------- what main.js declares
// Read as SOURCE TEXT rather than by importing the module: main.js is an ES
// module that builds a WebGL renderer at import time and cannot be required
// from node. The same reason verify_anim.js reads entities.js as text.
function clientConstants(src) {
  const num = name => {
    const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([-\\d.]+)\\s*;`));
    return m ? Number(m[1]) : null;
  };
  const rgbTriple = name => {
    // const NAME = [0x00 / 255, 0x96 / 255, 0xce / 255];
    const m = src.match(new RegExp(
      `const\\s+${name}\\s*=\\s*\\[\\s*(0x[0-9a-fA-F]{2})\\s*/\\s*255\\s*,` +
      `\\s*(0x[0-9a-fA-F]{2})\\s*/\\s*255\\s*,` +
      `\\s*(0x[0-9a-fA-F]{2})\\s*/\\s*255\\s*\\]`));
    if (!m) return null;
    return [1, 2, 3].map(i => parseInt(m[i], 16));
  };
  const ramp = (() => {
    const m = src.match(/const\s+HAZE_ALPHA\s*=\s*new\s+Uint8Array\(\[([\s\S]*?)\]\)/);
    if (!m) return null;
    return m[1].split(',').map(s => s.trim()).filter(s => s.length)
      .map(Number);
  })();
  return {
    background: rgbTriple('SKY_BACKGROUND'),
    haze: rgbTriple('SKY_HAZE'),
    vBottom: num('HAZE_V_BOTTOM'),
    vTop: num('HAZE_V_TOP'),
    height: num('HAZE_HEIGHT'),
    radius: num('HAZE_RADIUS'),
    ramp,
  };
}

// The fragment shader, replayed. Elevation in radians -> [r,g,b] bytes.
function skyModel(c) {
  const tanTop = c.height / c.radius;
  const sample = v => {
    // LinearFilter over a 128-tall 1-D texture: texel centres at (i+0.5)/128
    const x = v * c.ramp.length - 0.5;
    const i = Math.floor(x);
    const f = x - i;
    const a = c.ramp[Math.min(Math.max(i, 0), c.ramp.length - 1)];
    const b = c.ramp[Math.min(Math.max(i + 1, 0), c.ramp.length - 1)];
    return (a + (b - a) * f) / 255;
  };
  return (elevRad) => {
    const t = Math.min(Math.max(Math.tan(elevRad) / tanTop, 0), 1);
    const v = c.vBottom + (c.vTop - c.vBottom) * t;
    const a = sample(v);
    return c.background.map((bg, i) => Math.round(bg + (c.haze[i] - bg) * a));
  };
}

// ------------------------------------------------------------------ checks
function staticChecks(d, src, c) {
  const r = d.rendered;

  // 1. the decode itself
  check('probe_skydome reproduces the background as #0096CE',
    r.background_hex === '#0096CE', r.background_hex);
  check('the background box is 5 surfaces (4 walls + ceiling) and PF_UNLIT, '
    + 'so the material colour IS the rendered colour',
    d.skybox.layers.SkybackgroundColor.surfs.length === 5
      && d.skybox.layers.SkybackgroundColor.all_unlit,
    `${d.skybox.layers.SkybackgroundColor.surfs.length} surfs, unlit=`
      + d.skybox.layers.SkybackgroundColor.all_unlit);
  check('there is no SECOND background colour anywhere in skylevel.unr — '
    + 'a zenith/horizon two-stop ramp has nothing to come from',
    Object.keys(d.skybox.layers).filter(k => /background/i.test(k)).length === 1,
    Object.keys(d.skybox.layers).join(', '));
  check('WhiteChip is still 32x32 of one colour, pure white',
    d.materials.background.chip.distinct_rgb === 1
      && d.materials.background.chip.rgb.every(v => v === 255),
    JSON.stringify(d.materials.background.chip));
  check('WhiteRing is still one RGB with a monotone, purely vertical alpha ramp',
    d.materials.haze.texture.distinct_rgb === 1
      && d.materials.haze.texture.monotone_down
      && d.materials.haze.texture.alpha_row_spread <= 4,
    `rgb=${d.materials.haze.texture.distinct_rgb} monotone=`
      + `${d.materials.haze.texture.monotone_down} rowspread=`
      + d.materials.haze.texture.alpha_row_spread);
  check('the haze band is a separate PF_UNLIT layer standing on the eye plane',
    d.skybox.layers['HazeRing_Final/band']
      && d.skybox.layers['HazeRing_Final/band'].all_unlit
      && near(d.band.bottom.dz, 0, 1.0),
    `dz=${d.band && d.band.bottom.dz}`);

  // 2. the client uses it
  const hex = a => a ? '#' + a.map(v => v.toString(16).padStart(2, '0')).join('') : null;
  check('main.js SKY_BACKGROUND is the decoded background',
    c.background && hex(c.background).toUpperCase() === r.background_hex,
    `${hex(c.background)} vs ${r.background_hex}`);
  check('main.js SKY_HAZE is HazeRing_Final x WhiteRing.rgb',
    c.haze && hex(c.haze).toUpperCase() === r.haze_hex,
    `${hex(c.haze)} vs ${r.haze_hex}`);
  check('main.js HAZE_V_BOTTOM/_TOP are the band edges the BSP projects',
    c.vBottom != null && c.vTop != null
      && near(c.vBottom, r.band_v_bottom, 1e-4)
      && near(c.vTop, r.band_v_top, 1e-4),
    `${c.vBottom}/${c.vTop} vs ${r.band_v_bottom}/${r.band_v_top}`);
  check('main.js HAZE_HEIGHT / HAZE_RADIUS are the band geometry',
    c.height != null && c.radius != null
      && near(c.height, r.band_height, 0.01)
      && near(c.radius, r.band_radius_mean, 0.01),
    `${c.height}/${c.radius} vs ${r.band_height}/${r.band_radius_mean}`);
  check('main.js HAZE_ALPHA is WhiteRing\'s alpha channel, all 128 rows',
    c.ramp && c.ramp.length === r.haze_alpha_ramp.length
      && c.ramp.every((v, i) => v === r.haze_alpha_ramp[i]),
    c.ramp ? `${c.ramp.length} values, ${
      c.ramp.filter((v, i) => v !== r.haze_alpha_ramp[i]).length} differ`
      : 'not found');

  // 3. the invented pair is gone
  const invented = [/const\s+SKY_ZENITH\s*=/, /const\s+SKY_HORIZON\s*=/]
    .filter(re => re.test(src));
  check('the invented SKY_ZENITH/SKY_HORIZON pair is gone from main.js',
    invented.length === 0,
    invented.length ? 'still declared: ' + invented.map(String).join(', ')
      : 'neither is declared');

  // 4. the shader is the retail shape
  const guards = [
    'float tanElev = d.y / max(length(d.xz), 1e-6);',
    'float t = clamp(tanElev / uTanTop, 0.0, 1.0);',
    'float v = mix(uV.x, uV.y, t);',
    'gl_FragColor = vec4(mix(uBackground, uHaze, a), 1.0);',
  ];
  const missing = guards.filter(g => !src.includes(g));
  check('the sky shader still ramps in tan(elevation) between background '
    + 'and haze (this suite replays it)',
    missing.length === 0, missing.join(' | ') || 'all four lines present');

  if (!c.background || !c.haze || !c.ramp) return;
  const model = skyModel(c);
  const topRad = Math.atan(c.height / c.radius);
  const at = deg => model(deg * Math.PI / 180);
  const eq = (a, b) => a.every((v, i) => v === b[i]);
  check('above the band the sky is FLAT: same colour at 30, 45 and 89 degrees',
    eq(at(30), at(45)) && eq(at(45), at(89)) && eq(at(89), c.background),
    `${at(30)} / ${at(45)} / ${at(89)}`);
  check('at and below the horizon the haze is fully opaque',
    eq(at(0), c.haze) && eq(at(-10), c.haze), `${at(0)} / ${at(-10)}`);
  check('the band spans 0 to the top edge the BSP measured '
    + `(${(topRad * 180 / Math.PI).toFixed(2)} deg)`,
    near(topRad * 180 / Math.PI,
      Math.atan(r.band_height / r.band_radius_mean) * 180 / Math.PI, 0.05),
    `${(topRad * 180 / Math.PI).toFixed(2)} deg`);
  let mono = true;
  for (let deg = 0; deg < 40; deg += 0.5) {
    const a = at(deg)[2], b = at(deg + 0.5)[2];   // blue rises toward the sky
    if (b < a) mono = false;
  }
  check('the ramp is monotone from the horizon to the top of the band', mono);
}

// -------------------------------------------------------------- live pixels
async function livePixels(c) {
  const puppeteer = require(path.join(ROOT,
    'tools/src/char_pipeline/node_modules/puppeteer-core'));
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const browser = await puppeteer.launch({
    executablePath: CHROME, protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready',
      { timeout: 180000 });
    await page.select('#scene-picker', TILE);
    await sleep(3000);
    await page.waitForFunction(
      t => document.getElementById('loading').classList.contains('hidden')
        && window.__world.currentTile === t,
      { timeout: 600000, polling: 1000 }, TILE);
    await sleep(4000);

    const pitches = [1.3, 1.0, 0.7, 0.5, 0.4, 0.3, 0.22, 0.16, 0.1, 0.05, 0.0, -0.15];
    const got = await page.evaluate((pitches) => {
      const w = window.__world;
      const r = w.renderer, cam = w.camera, sc = w.scene;
      const sky = sc.children.find(o => o.isMesh && o.material
        && o.material.type === 'ShaderMaterial' && o.geometry
        && o.geometry.type === 'SphereGeometry');
      const vis = [];
      sc.traverse(o => {
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite) vis.push([o, o.visible]);
      });
      for (const [o] of vis) o.visible = (o === sky);
      const fog = sc.fog; sc.fog = null;
      const camPos = cam.position.clone(), camQuat = cam.quaternion.clone();
      const gl = r.getContext();
      const px = new Uint8Array(4);
      const W = r.domElement.width, H = r.domElement.height;
      const out = [];
      for (const p of pitches) {
        cam.rotation.set(p, 0, 0, 'YXZ');
        cam.updateMatrixWorld(true);
        if (sky) sky.position.copy(cam.position);
        r.render(sc, cam);
        gl.readPixels((W / 2) | 0, (H / 2) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push([px[0], px[1], px[2]]);
      }
      sc.fog = fog;
      cam.position.copy(camPos); cam.quaternion.copy(camQuat);
      cam.updateMatrixWorld(true);
      for (const [o, v] of vis) o.visible = v;
      return { out, skyFound: !!sky };
    }, pitches);

    check('the sky dome is in the scene', got.skyFound);
    check('no page errors while sampling', errors.length === 0, errors.join('; '));

    // On a tree that has no sky constants at all (the PRE-FIX client) there is
    // nothing to compare the pixels against — the static checks have already
    // failed loudly by this point. Sample and record anyway: those readbacks
    // are the before half of the evidence.
    if (!c.background || !c.haze || !c.ramp) {
      summary.live = pitches.map((p, i) => ({
        deg: +(p * 180 / Math.PI).toFixed(1), have: got.out[i] }));
      check('the client declares sky constants this suite can predict from',
        false, 'no SKY_BACKGROUND / SKY_HAZE / HAZE_ALPHA in main.js; sampled '
          + 'pixels recorded but not compared');
    } else {
    const model = skyModel(c);
    const worst = [];
    pitches.forEach((p, i) => {
      const want = model(p);
      const have = got.out[i];
      const err = Math.max(...want.map((v, k) => Math.abs(v - have[k])));
      worst.push({ deg: +(p * 180 / Math.PI).toFixed(1), want, have, err });
    });
    const bad = worst.filter(w => w.err > 2);
    // Tolerance 2/255: the readback is the framebuffer, so the only slack is
    // the GPU's own texture filtering of the ramp. A colour-space mistake
    // would be off by tens, not by two.
    check('every sampled elevation renders the colour the decode predicts '
      + '(<= 2/255)', bad.length === 0,
      bad.length ? JSON.stringify(bad) : JSON.stringify(worst.map(
        w => `${w.deg}deg #${w.have.map(v => v.toString(16).padStart(2, '0')).join('')}`)));
    summary.live = worst;
    }

    if (SHOTS) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.evaluate(() => {
        const w = window.__world;
        const sky = w.scene.children.find(o => o.isMesh && o.material
          && o.material.type === 'ShaderMaterial');
        window.__h = [];
        w.scene.traverse(o => {
          if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o !== sky) {
            window.__h.push([o, o.visible]); o.visible = false;
          }
        });
        window.__f = w.scene.fog; w.scene.fog = null;
        for (const el of document.querySelectorAll('body > *')) {
          if (el.tagName !== 'CANVAS') el.style.display = 'none';
        }
        w.followCam.pitch = -0.35;
      });
      await sleep(1200);
      const f = path.join(OUT, `sky_only_${SHOTS_TAG}.png`);
      await page.screenshot({ path: f });
      summary.shot = f;
    }
  } finally {
    await browser.close();
  }
}

// -------------------------------------------------------------------- main
(async () => {
  if (!fs.existsSync(PROBE)) {
    console.error(`missing ${PROBE}`);
    process.exit(2);
  }
  const d = decode();
  const src = fs.readFileSync(MAIN, 'utf8');
  const c = clientConstants(src);

  console.log('== the decode (tools/audit/probe_skydome.py) ==');
  console.log(`  background        ${d.rendered.background_hex}  flat, PF_UNLIT,`
    + ` ${d.skybox.layers.SkybackgroundColor.nodes} nodes`);
  console.log(`  haze band         ${d.rendered.haze_hex}  v ${d.rendered.band_v_bottom}`
    + ` -> ${d.rendered.band_v_top}, height ${d.rendered.band_height}`
    + ` over radius ${d.rendered.band_radius_mean}`);
  console.log(`  band top          ${(Math.atan(d.rendered.band_height
    / d.rendered.band_radius_mean) * 180 / Math.PI).toFixed(2)} deg`
    + `  (azimuth spread ${d.rendered.band_top_elev_deg[0]}..`
    + `${d.rendered.band_top_elev_deg[1]})`);
  console.log('\n== what editor/world/js/main.js declares ==');
  console.log(`  SKY_BACKGROUND    ${c.background}`);
  console.log(`  SKY_HAZE          ${c.haze}`);
  console.log(`  HAZE_V_BOTTOM/TOP ${c.vBottom} / ${c.vTop}`);
  console.log(`  HAZE_HEIGHT/RADIUS ${c.height} / ${c.radius}`);
  console.log(`  HAZE_ALPHA        ${c.ramp ? c.ramp.length : 0} values`);

  staticChecks(d, src, c);
  if (LIVE) await livePixels(c);

  console.log('');
  for (const c2 of summary.checks) {
    console.log(`  [${c2.ok ? 'ok' : 'FAIL'}] ${c2.name}`);
    if (!c2.ok && c2.detail) console.log(`         ${c2.detail}`);
  }
  if (summary.failed) {
    console.log('\nSKY VERIFICATION FAILED');
    process.exit(CHECK ? 1 : 0);
  }
  console.log('\nall sky checks passed');
})().catch(e => { console.error(e); process.exit(2); });
