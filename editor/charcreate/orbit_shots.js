// Orbit-view diagnostic + verification for the charcreate app.
// For each combo: screenshots at front/back/left/right (camera orbit, fixed
// distance). In --diagnose mode, additionally toggles each light off in turn
// on the back view to identify the wash-out source.
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DIAGNOSE = process.argv.includes('--diagnose');
const COMBOS = [
  { race: 'Dark Elf', gender: 'Female', cls: 0, expect: 'darkelf_f' },
  { race: 'Human', gender: 'Male', cls: 0, expect: 'human_fighter_m' },
  { race: 'Elf', gender: 'Female', cls: 0, expect: 'elf_f' },
];
const VIEWS = { front: 0, left: 90, back: 180, right: 270 };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto('http://127.0.0.1:8082/', { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__cc && document.getElementById("loading").classList.contains("hidden")',
      { timeout: 30000 });

    const orbit = az => page.evaluate(az => {
      const cc = window.__cc;
      cc.freeze();
      cc.turntable.rotation.y = 0;
      const a = az * Math.PI / 180, r = 3.6;
      cc.camera.position.set(Math.sin(a) * r, 1.35, Math.cos(a) * r);
      cc.controls.target.set(0, 1.0, 0);
      cc.controls.update();
    }, az);

    for (const c of COMBOS) {
      await page.evaluate(({ race, gender, cls }) => {
        const click = (listId, pred) =>
          [...document.querySelectorAll(`#${listId} button`)].find(pred).click();
        click('race-list', b => b.textContent.includes(race));
        click('gender-list', b => b.textContent.trim() === gender);
        [...document.querySelectorAll('#class-list button')][cls].click();
      }, c);
      await page.waitForFunction(e => window.__cc.modelId === e, { timeout: 30000 }, c.expect);
      await sleep(500);

      for (const [name, az] of Object.entries(VIEWS)) {
        await orbit(az);
        await sleep(250);
        await page.screenshot({ path: path.join(OUT, `orbit_${c.expect}_${name}.png`) });
      }

      if (DIAGNOSE) {
        // material.side report for hair + all parts
        console.log(c.expect, 'materials:', await page.evaluate(() => {
          const out = [];
          window.__cc.model.traverse(o => {
            if (!o.isMesh) return;
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
              out.push(`${m.name} side=${m.side} transp=${m.transparent} alphaTest=${m.alphaTest}`);
            });
          });
          return out;
        }));
        // toggle each light off individually on the back view
        await orbit(180);
        const lights = await page.evaluate(() => {
          const scene = window.__cc.turntable.parent;
          const L = [];
          scene.traverse(o => { if (o.isLight) L.push({ i: L.length, type: o.type, color: o.color.getHexString(), intensity: o.intensity }); });
          return L;
        });
        console.log(c.expect, 'lights:', JSON.stringify(lights));
        for (const l of lights) {
          await page.evaluate(i => {
            const scene = window.__cc.turntable.parent;
            let k = 0;
            scene.traverse(o => { if (o.isLight) { o.visible = (k !== i); k++; } });
          }, l.i);
          await sleep(200);
          await page.screenshot({ path: path.join(OUT, `diag_${c.expect}_no${l.type}${l.i}.png`) });
        }
        await page.evaluate(() => {
          const scene = window.__cc.turntable.parent;
          scene.traverse(o => { if (o.isLight) o.visible = true; });
        });
      }
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
