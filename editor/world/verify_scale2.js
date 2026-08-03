// Deterministic scale-comparison shots (before/after nativeHeight fix).
// The chase cam is DISABLED and the three.js camera placed manually with
// updateMatrixWorld(true), so projections are fresh in the same JS tick
// and before/after runs get pixel-identical framing with both subjects at
// the same depth (pixel ratio == true size ratio).
//   shot A (mock gateway 8085, cc=0): player vs Elias (npcId 30050 ->
//           a_common_peopleA_MHuman_m00, nativeHeight 43 -> 0.43 m)
//   shot B (solo, 17_25): player vs an H_Door_MV_01 instance standing on
//           walkable ground (door gltf Y extent 0.824 -> 0.82 m in-world)
// Usage: node verify_scale2.js <tag>
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'verify_shots');
const TAG = process.argv[2] || 'run';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(url) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready',
    { timeout: 60000 });
  return { browser, page };
}

// Wait for two real rendered frames (rAF can be slow under SwiftShader).
async function frames(page, n = 2) {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = { tag: TAG };

  // -- shot A: player vs Elias (mock gateway) --------------------------------
  {
    const { browser, page } = await launch(
      'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0');
    await page.click('#online-toggle');
    // entities spawn into a staging limbo before the tile lands; wait for
    // the actual scene so the shot shows the real world
    await page.waitForFunction(
      `/scene:|@ /.test(document.getElementById('status').textContent)
       && document.getElementById('loading').classList.contains('hidden')`,
      { timeout: 240000 });
    await page.waitForFunction(
      '!!window.__world.entities.getEntity(70004) '
      + '&& window.__world.entities.getEntity(70004).mixer', { timeout: 40000 });
    summary.mock = await page.evaluate(() => {
      const w = window.__world;
      const e = w.entities.getEntity(70004);
      const c = w.character.group.position;
      const t = e.group.position;
      const V = c.constructor;
      // park the player 1.2 m to Elias's side, on Elias's ground plane
      const dir = new V(c.x - t.x, 0, c.z - t.z).normalize();
      c.set(t.x + dir.x * 1.2, t.y, t.z + dir.z * 1.2);
      w.character.clearTarget();
      // freeze chase cam, place the raw camera side-on at the midpoint
      w.followCam.update = () => {};
      const mx = (c.x + t.x) / 2, mz = (c.z + t.z) / 2;
      const dx = t.x - c.x, dz = t.z - c.z, L = Math.hypot(dx, dz) || 1;
      w.camera.position.set(mx - dz / L * 4, c.y + 0.9, mz + dx / L * 4);
      w.camera.lookAt(mx, c.y + 0.7, mz);
      w.camera.updateMatrixWorld(true);
      return {
        charHeightM: w.character.heightM, eliasHeightM: e.heightM,
        charFeet: w.project(c.clone()),
        charHead: w.project(c.clone().add(new V(0, w.character.heightM, 0))),
        eliasFeet: w.project(t.clone()),
        eliasHead: w.project(t.clone().add(new V(0, e.heightM, 0))),
      };
    });
    await frames(page);
    await page.screenshot({ path: `${OUT}/scale2_${TAG}_npc.png` });
    await browser.close();
  }

  // -- shot B: player vs H_Door_MV_01 on walkable ground (solo 17_25) ---------
  {
    const { browser, page } = await launch('http://127.0.0.1:8083/');
    await page.select('#scene-picker', '17_25');
    await page.waitForFunction(
      `document.getElementById('status').textContent.includes('scene: 17_25')
       && document.getElementById('loading').classList.contains('hidden')`,
      { timeout: 240000 });
    summary.solo = await page.evaluate(async () => {
      const THREE = await import('three');
      const w = window.__world;
      const c = w.character.group.position;
      // H_Door_MV_01 instances whose base (pivot y - 0.412, the measured
      // gltf Y min) sits near walkable ground; closest to spawn first
      const doors = [];
      for (const p of w.terrain.def.props) {
        if (!p.gltf || !/H_Door_MV_01/.test(p.gltf)) continue;
        const wx = p.position[0] * 0.01, wy = p.position[2] * 0.01,
              wz = -p.position[1] * 0.01;
        const g = w.heightAt(wx, wz);
        if (Math.abs(g - (wy - 0.412)) > 0.35) continue;   // roof/deco door
        doors.push({ w: [wx, wy, wz],
                     d: (wx - c.x) ** 2 + (wz - c.z) ** 2 });
      }
      doors.sort((a, b) => a.d - b.d);
      const V = c.constructor;
      const clearShot = (camPos, mx, my, mz) => {
        // anything solid between camera and subject midpoint?
        const dir = new THREE.Vector3(mx, my, mz).sub(camPos);
        const far = dir.length() - 0.6;
        dir.normalize();
        const ray = new THREE.Raycaster(camPos, dir, 0.1, far);
        const hits = ray.intersectObjects(w.scene.children, true)
          .filter(h => {
            let o = h.object, skip = false;
            while (o) {
              if (o === w.character.group) skip = true;
              o = o.parent;
            }
            return !skip && h.object.name !== 'pick-proxy';
          });
        return hits.length === 0;
      };
      for (const door of doors) {
        const [dx, dy, dz] = door.w;
        const by = dy - 0.412;                   // door base world y
        const side = new V(c.x - dx, 0, c.z - dz).normalize();
        const px = dx + side.x * 1.5, pz = dz + side.z * 1.5;
        const mx = (px + dx) / 2, mz = (pz + dz) / 2;
        const ox = dx - px, oz = dz - pz, L = Math.hypot(ox, oz) || 1;
        for (const [ux, uz] of [[-oz / L, ox / L], [oz / L, -ox / L]]) {
          const camPos = new THREE.Vector3(mx + ux * 4, by + 0.6, mz + uz * 4);
          if (!clearShot(camPos, mx, by + 0.5, mz)) continue;
          // stage: player on the doorstep plane, frozen side-on camera
          c.set(px, by, pz);
          w.character.clearTarget();
          w.followCam.update = () => {};
          w.camera.position.copy(camPos);
          w.camera.lookAt(mx, by + 0.5, mz);
          w.camera.updateMatrixWorld(true);
          return {
            charHeightM: w.character.heightM,
            door: { world: door.w, baseY: by,
                    distFromSpawn: +Math.sqrt(door.d).toFixed(1) },
            charFeet: w.project(c.clone()),
            charHead: w.project(c.clone().add(new V(0, w.character.heightM, 0))),
            doorBase: w.project(new V(dx, by, dz)),
            doorTop: w.project(new V(dx, by + 0.824, dz)),
          };
        }
      }
      return { error: 'no door with a clear camera side found' };
    });
    if (summary.solo.error) throw new Error(summary.solo.error);
    await frames(page);
    await page.screenshot({ path: `${OUT}/scale2_${TAG}_door.png` });
    await browser.close();
  }

  fs.writeFileSync(`${OUT}/scale2_${TAG}.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error('VERIFY SCALE2 FAILED:', e.message); process.exit(1); });
