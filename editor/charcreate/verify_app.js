// Headless verification for the charcreate app (port 8082).
// Drives the REAL UI (button clicks) in headless Chrome, freezes the
// turntable with the camera at +Z front, and screenshots race/gender combos.
// Also runs the rapid-click torture test and the face/hair swap checks.
//
// Usage: node verify_app.js
// Output: verify_shots/*.png + a JSON summary printed to stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8082/';
const OUT = path.join(__dirname, 'verify_shots');

const COMBOS = [
  { race: 'Human',    gender: 'Male',   cls: 0, expect: 'human_fighter_m' },
  { race: 'Human',    gender: 'Female', cls: 0, expect: 'human_fighter_f' },
  { race: 'Human',    gender: 'Female', cls: 1, expect: 'human_mystic_f' },
  { race: 'Elf',      gender: 'Male',   cls: 0, expect: 'elf_m' },
  { race: 'Elf',      gender: 'Female', cls: 0, expect: 'elf_f' },
  { race: 'Dark Elf', gender: 'Male',   cls: 0, expect: 'darkelf_m' },
  { race: 'Dark Elf', gender: 'Female', cls: 0, expect: 'darkelf_f' },
  { race: 'Orc',      gender: 'Male',   cls: 0, expect: 'orc_fighter_m' },
  { race: 'Dwarf',    gender: 'Male',   cls: 0, expect: 'dwarf_m' },
  { race: 'Dwarf',    gender: 'Female', cls: 0, expect: 'dwarf_f' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { combos: [], torture: null, swaps: null, consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__cc && document.getElementById("loading").classList.contains("hidden")',
      { timeout: 30000 });

    async function selectCombo(c) {
      await page.evaluate(({ race, gender, cls }) => {
        const click = (listId, pred) => {
          const btns = [...document.querySelectorAll(`#${listId} button`)];
          const b = btns.find(pred);
          if (!b) throw new Error(`button not found in ${listId}`);
          b.click();
        };
        click('race-list', b => b.textContent.includes(race));
        click('gender-list', b => b.textContent.trim() === gender);
        const clsBtns = [...document.querySelectorAll('#class-list button')];
        if (clsBtns[cls]) clsBtns[cls].click();
      }, c);
      await page.waitForFunction(
        expected => window.__cc.modelId === expected,
        { timeout: 30000 }, c.expect);
      await sleep(400); // a few settled frames
    }

    // ---- 1) facing per combo ------------------------------------------------
    for (const c of COMBOS) {
      await selectCombo(c);
      const info = await page.evaluate(() => {
        window.__cc.poseFront();
        return {
          modelId: window.__cc.modelId,
          facingRy: window.__cc.facingRy,
          fwd: window.__cc.worldForward(),
          children: window.__cc.turntable.children.length,
        };
      });
      await sleep(250); // let poseFront render
      const shot = path.join(OUT, `face_${c.expect}.png`);
      await page.screenshot({ path: shot });
      const angle = info.fwd ? Math.abs(Math.atan2(info.fwd.x, info.fwd.z)) : null;
      summary.combos.push({
        ...c, ...info, shot: path.basename(shot),
        forwardAngleDeg: angle == null ? null : +(angle * 180 / Math.PI).toFixed(1),
        facingOk: angle != null && angle < 0.35, // ~20 deg
        singleModel: info.children === 1,
      });
    }

    // ---- 2) rapid-click torture test ---------------------------------------
    await page.evaluate(async () => {
      const races = [...document.querySelectorAll('#race-list button')];
      const genders = [...document.querySelectorAll('#gender-list button')];
      for (let i = 0; i < 20; i++) {
        races[i % races.length].click();
        if (i % 3 === 0 && genders.length) genders[i % genders.length].click();
        await new Promise(r => setTimeout(r, 55));
      }
    });
    await sleep(3000); // every in-flight load must resolve or be dropped
    summary.torture = await page.evaluate(() => ({
      children: window.__cc.turntable.children.length,
      modelId: window.__cc.modelId,
      placeholder: window.__cc.state.usingPlaceholder,
      skinnedMeshes: (() => {
        let n = 0;
        window.__cc.turntable.traverse(o => { if (o.isSkinnedMesh) n++; });
        return n;
      })(),
    }));
    await page.evaluate(() => window.__cc.poseFront());
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'torture_end.png') });

    // ---- 3) face / hair swaps (human fighter female has _f, _ah, _bh) ------
    await selectCombo({ race: 'Human', gender: 'Female', cls: 0, expect: 'human_fighter_f' });
    const swapState = () => page.evaluate(() => {
      const out = { faceTex: [], hairColor: [] };
      const base = n => String(n || '').split(':')[0]; // strip ":material_0" trailers
      window.__cc.model.traverse(o => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if (/_f$/i.test(base(m.name)) && m.map) out.faceTex.push(m.map.source.data && m.map.source.data.src);
          if (/_[a-z]h$/i.test(base(m.name))) out.hairColor.push(m.name + ':' + m.color.getHexString());
        });
      });
      return out;
    });
    const before = await swapState();
    // face B (chip index 1), then face C (index 2)
    await page.evaluate(() => document.querySelectorAll('#face-list button')[1].click());
    await sleep(700);
    const faceB = await swapState();
    await page.evaluate(() => window.__cc.poseFront());
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'swap_face_B.png') });
    await page.evaluate(() => document.querySelectorAll('#face-list button')[2].click());
    await sleep(700);
    const faceC = await swapState();
    await page.evaluate(() => window.__cc.poseFront());
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'swap_face_C.png') });
    // hair color: pick the LIGHTEST swatch for an unambiguous visual change
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#haircolor-list button')];
      const lum = b => {
        const m = /#(..)(..)(..)/.exec(b.style.background || '') ||
                  /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(b.style.background || '');
        if (!m) return 0;
        const c = m.slice(1).map(v => parseInt(v, v.length > 2 ? 10 : 16));
        return c[0] + c[1] + c[2];
      };
      btns.reduce((a, b) => (lum(b) > lum(a) ? b : a)).click();
    });
    await sleep(500);
    const hair = await swapState();
    await page.evaluate(() => window.__cc.poseFront());
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'swap_haircolor.png') });
    summary.swaps = { before, faceB, faceC, hair };

    // back to front view of final state
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('VERIFY FAILED:', e); process.exit(1); });
