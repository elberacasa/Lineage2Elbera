// verify_bsplight.js — the retail BAKED LIGHTMAPS, in the real client.
//
// WHY a dedicated suite. verify_bsp.js proves the BSP geometry lands in the
// right place. This one proves the thing that geometry was missing: the
// lighting the retail .unr bakes into it. The failure that would be easiest
// to miss is a lightmap that LOADS and BINDS but samples the wrong texels —
// a wrong UV set, a flipped V, the wrong atlas sheet — because that still
// produces a picture with light and dark in it. So this checks, in order:
//
//   1. the glTF actually carries a second UV set and names a sheet;
//   2. the client bound a lightMap on UV channel 1 to every primitive whose
//      material asks for one, and to no primitive that does not;
//   3. the ONE claim a screenshot cannot make on its own — that the pixels
//      changed, and changed DOWNWARD (a modulate can only darken), and by a
//      believable amount rather than 0% (not wired) or ~100% (all black).
//
// Before/after come from the same build: '?lm=off' makes bsp.js skip the
// lightmaps and render the BSP exactly as it did before they were decoded.
//
// Usage:  node verify_bsplight.js [tile ...]  (default 22_22 17_25 23_18)
// Output: verify_shots/bsplight_<tile>_<label>_{before,after}.png + PASS/FAIL

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.WORLD_BASE || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const LOAD_TIMEOUT = Number(process.env.LOAD_TIMEOUT_MS || 300000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [l2x, l2y, l2z, yawDeg, pitch, dist, label]. 22_22's are the stations
// verify_bsp.js already uses, so the two suites photograph the same places:
// one town EXTERIOR and two INTERIORS. 17_25 keeps only its exterior — its
// houses are STATIC MESHES, so at verify_bsp.js's other stations the BSP is
// 0.1% of the frame and a comparison over 0.1% of a picture cannot fail
// honestly.
const SPOTS = {
  '22_22': [
    [82500, 148500, -3450, 45, 0.18, 30, 'plaza'],
    [79715, 150530, -3547, 45, 0.05, 2.5, 'interior_A_floor03'],
    [85637, 148275, -3429, 110, 0.05, 3.0, 'interior_A_ch02'],
  ],
  // 17_25's second station is NOT verify_bsp.js's aerial one: from up there
  // the BSP is 0.1% of the frame, and a metric that reads 0.1% of a picture
  // cannot fail honestly. Gludin's houses are STATIC MESHES, so the tile
  // has little BSP to photograph at all — the second station is the centre
  // of the busiest BSP cluster the tile has (bsp_-18_50, 919 triangles,
  // read out of bsp.gltf), at its own floor level.
  '17_25': [
    [-71200, 258000, -2900, 45, 0.15, 26, 'village'],
  ],
  // 23_18 (Aden) is the most BSP-dominated tile in the world set: 5,633 of
  // its 5,735 drawn nodes carry a lightmap. Its busiest cluster, bsp_23_3
  // (5,949 triangles), is where a lightmap bug would be most obvious.
  '23_18': [
    [113445, 16419, -5000, 45, 0.15, 40, 'aden_bsp'],
  ],
};

const results = [];
const fail = (msg) => { results.push(['FAIL', msg]); };
const pass = (msg) => { results.push(['ok', msg]); };

async function openClient(browser, query) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => fail('pageerror: ' + e.message));
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded',
                                  timeout: LOAD_TIMEOUT });
  await page.waitForFunction('window.__world && window.__world.ready',
                             { timeout: LOAD_TIMEOUT });
  return page;
}

async function selectTile(page, tile) {
  await page.select('#scene-picker', tile);
  await page.waitForFunction(
    (t) => document.getElementById('status').textContent.includes('scene: ' + t)
      && document.getElementById('loading').classList.contains('hidden'),
    { timeout: LOAD_TIMEOUT }, tile);
  await sleep(3000);
}

async function shoot(page, tile, spot, suffix) {
  const [lx, ly, lz, yaw, pitch, dist, label] = spot;
  await page.evaluate(({ lx, ly, lz, yaw, pitch, dist }) => {
    const w = window.__world;
    w.character.group.position.set(lx * 0.01, lz * 0.01, -ly * 0.01);
    w.character.clearTarget();
    w.followCam.pitch = pitch;
    w.followCam.dist = dist;
    w.followCam.yaw = yaw * Math.PI / 180;
  }, { lx, ly, lz, yaw, pitch, dist });
  await sleep(1400);
  const file = `bsplight_${tile}_${label}_${suffix}.png`;
  // base64 here, written by hand: this build of puppeteer honours `path`
  // OR `encoding`, not both, and the luma comparison needs the bytes.
  const shot = await page.screenshot({ encoding: 'base64' });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(shot, 'base64'));
  return { file, shot };
}

// Compare two base64 PNGs inside the page (no image library on the node
// side). Only the pixels that CHANGED are measured: a frame is mostly sky,
// terrain and UI, and averaging those in would let a lightmap that touches
// nothing at all still report a plausible number.
async function compare(page, beforeB64, afterB64) {
  return page.evaluate(async (a, b) => {
    const load = async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    };
    const A = await load(a), B = await load(b);
    const luma = (p, i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    let changed = 0, sumA = 0, sumB = 0;
    const total = A.length / 4;
    for (let i = 0; i < A.length; i += 4) {
      if (A[i] === B[i] && A[i + 1] === B[i + 1] && A[i + 2] === B[i + 2]) {
        continue;
      }
      changed++;
      sumA += luma(A, i);
      sumB += luma(B, i);
    }
    return { changed, total,
             before: changed ? sumA / changed : 0,
             after: changed ? sumB / changed : 0 };
  }, beforeB64, afterB64);
}

// What the client actually bound, read off the live scene graph.
async function bindings(page) {
  return page.evaluate(() => {
    const bsp = window.__world.terrain.bsp;
    if (!bsp) return null;
    let wanted = 0, bound = 0, wrongChannel = 0, strayLightmap = 0;
    let lit = 0, unlit = 0, uv1 = 0, noUv1 = 0, basic = 0, other = 0;
    bsp.group.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.isMeshBasicMaterial) basic++; else other++;
        const sheet = m.userData?.lightmapSheet;
        if (Number.isInteger(sheet)) {
          wanted++; lit++;
          if (m.lightMap) {
            bound++;
            if (m.lightMap.channel !== 1) wrongChannel++;
          }
        } else {
          unlit++;
          if (m.lightMap) strayLightmap++;
        }
      }
      if (o.geometry.attributes.uv1) uv1++; else noUv1++;
    });
    return { wanted, bound, wrongChannel, strayLightmap, lit, unlit,
             uv1, noUv1, basic, other, sheets: bsp.lightmaps.size };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tiles = process.argv.slice(2).length ? process.argv.slice(2)
    : ['22_22', '17_25', '23_18'];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader',
           '--window-size=1280,900'],
  });
  const shots = [];
  try {
    for (const tile of tiles) {
      if (!SPOTS[tile]) continue;

      // ---- the converter's side of the contract -----------------------
      const gltf = await (await fetch(`${BASE}scenes/${tile}/bsp.gltf`))
        .json().catch(() => null);
      if (!gltf) { fail(`${tile}: bsp.gltf did not fetch`); continue; }
      const withSheet = gltf.materials.filter(
        (m) => Number.isInteger(m.extras?.lightmapSheet));
      const declaredUnlit = gltf.materials.filter((m) => m.extras?.unlit);
      const undecided = gltf.materials.length
        - withSheet.length - declaredUnlit.length;
      if (undecided === 0) {
        pass(`${tile}: all ${gltf.materials.length} BSP materials are `
          + `decided — ${withSheet.length} lightmapped, `
          + `${declaredUnlit.length} PF_UNLIT`);
      } else {
        fail(`${tile}: ${undecided} BSP materials carry neither a lightmap `
          + `sheet nor the PF_UNLIT flag`);
      }
      const prims = gltf.meshes.flatMap((m) => m.primitives);
      const missingUv1 = prims.filter((p) => !('TEXCOORD_1' in p.attributes));
      if (missingUv1.length === 0) {
        pass(`${tile}: all ${prims.length} primitives carry TEXCOORD_1`);
      } else {
        fail(`${tile}: ${missingUv1.length}/${prims.length} primitives have `
          + `no TEXCOORD_1 (the lightmap UV set)`);
      }

      // ---- before: same build, lightmaps disabled ----------------------
      const before = await openClient(browser, '?lm=off');
      await selectTile(before, tile);
      const offInfo = await bindings(before);
      if (offInfo && offInfo.bound === 0) {
        pass(`${tile}: ?lm=off binds no lightmap (the pre-decode client)`);
      } else {
        fail(`${tile}: ?lm=off still bound ${offInfo && offInfo.bound}`);
      }
      const beforeShots = [];
      for (const spot of SPOTS[tile]) {
        const s = await shoot(before, tile, spot, 'before');
        beforeShots.push([spot[6], s.shot]);
        shots.push(s.file);
      }
      await before.close();

      // ---- after ------------------------------------------------------
      const page = await openClient(browser, '');
      await selectTile(page, tile);
      const info = await bindings(page);
      if (!info) { fail(`${tile}: no BSP loaded`); await page.close(); continue; }
      if (info.wanted && info.bound === info.wanted) {
        pass(`${tile}: ${info.bound}/${info.wanted} lightmapped materials `
          + `bound, ${info.sheets} atlas sheet(s) loaded`);
      } else {
        fail(`${tile}: only ${info.bound}/${info.wanted} lightmapped `
          + `materials got a lightMap`);
      }
      if (info.wrongChannel === 0) pass(`${tile}: every lightMap samples UV1`);
      else fail(`${tile}: ${info.wrongChannel} lightMaps sample the wrong UV set`);
      if (info.strayLightmap === 0) {
        pass(`${tile}: no PF_UNLIT material got a lightmap`);
      } else {
        fail(`${tile}: ${info.strayLightmap} PF_UNLIT materials got one`);
      }
      if (info.noUv1 === 0) pass(`${tile}: every BSP geometry has uv1`);
      else fail(`${tile}: ${info.noUv1} BSP geometries have no uv1`);
      if (info.other === 0) {
        pass(`${tile}: all ${info.basic} BSP materials are unlit `
          + `(retail lights BSP only by lightmap / PF_UNLIT)`);
      } else {
        fail(`${tile}: ${info.other} BSP materials are still lit materials`);
      }

      for (const spot of SPOTS[tile]) {
        const s = await shoot(page, tile, spot, 'after');
        shots.push(s.file);
        const was = (beforeShots.find((b) => b[0] === spot[6]) || [])[1];
        if (was === undefined) continue;
        const d = await compare(page, was, s.shot);
        const frac = 100 * d.changed / d.total;
        const drop = d.changed ? 100 * (d.before - d.after) / d.before : 0;
        // Three ways a lightmap fails quietly, all caught here: it touches
        // nothing (frac ~ 0), it touches everything and blacks it out
        // (drop ~ 100), or it makes the surface BRIGHTER, which a modulate
        // of a <= 1.0 factor cannot do and which is what a wrong UV set or
        // a flipped V looks like on average.
        if (frac > 2 && drop > 1 && drop < 95) {
          pass(`${tile}/${spot[6]}: ${frac.toFixed(1)}% of the frame `
            + `changed, luma ${d.before.toFixed(1)} -> ${d.after.toFixed(1)} `
            + `(${drop.toFixed(1)}% darker)`);
        } else {
          fail(`${tile}/${spot[6]}: ${frac.toFixed(1)}% of the frame `
            + `changed, luma ${d.before.toFixed(1)} -> ${d.after.toFixed(1)} `
            + `(${drop.toFixed(1)}%) — a bound lightmap must darken a `
            + `visible part of the frame without blacking it out`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  for (const [tag, msg] of results) console.log(`${tag}: ${msg}`);
  console.log(`shots: ${shots.length} in ${OUT}`);
  const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `FAIL (${bad})` : 'PASS');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
