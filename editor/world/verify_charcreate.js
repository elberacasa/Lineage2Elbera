// Headless verification for browser character creation (world client on
// 8083 serving /create/, gateway per mode). Drives the REAL UI:
//   mock (default): mock_gateway on 8086
//     1. toggle Online -> login{noAutoCreate} -> auth_ok{chars:[]}
//     2. fullscreen overlay with the /create/ iframe appears
//     3. fail path: name "Aria" (a fixture player) -> charCreateFail
//        name_already_exists -> inline "name taken" inside the iframe
//     4. pick Orc / Female / Orc Mystic -> the preview must actually load
//        that combo's gltf (asserted via the network fetch AND the scene,
//        not just app state), then set a name, Create
//        -> createChar op with protocol fields (race 3, sex 1, classId 49)
//        -> overlay closes -> enterChar -> enterWorld as the created char
//   live (--live): the real gateway on 8090, FRESH deviceId, one session
//     same flow with Elf / Female / Elven Mystic and a distinctive random
//     name; asserts enterWorld carries that char (real aCis account).
//
// Usage: node verify_charcreate.js [--live]
// Output: verify_shots/cc_*.png (mock) / ccl_*.png (live) + JSON summary.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const LIVE = process.argv.includes('--live');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = LIVE
  ? 'http://127.0.0.1:8083/'                       // default ws://127.0.0.1:8090
  : 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8086';
const OUT = path.join(__dirname, 'verify_shots');
const SHOT = (n) => path.join(OUT, `${LIVE ? 'ccl' : 'cc'}_${n}.png`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// letters only (the creator UI is stricter than the protocol regex)
const randName = (prefix) => prefix + Array.from({ length: 6 },
  () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');

const PICK = LIVE
  ? { race: 'Elf', gender: 'Female', cls: 'Elven Mystic', classId: 25, protoRace: 1, model: 'elf_f' }
  : { race: 'Orc', gender: 'Female', cls: 'Orc Mystic', classId: 49, protoRace: 3, model: 'orc_mystic_f' };
const NAME = LIVE ? randName('T') : randName('Vrk');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { mode: LIVE ? 'live' : 'mock', pick: { ...PICK, name: NAME }, consoleLogs: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));
    // preview-model evidence: which character gltfs were actually fetched
    const modelFetches = [];
    page.on('response', r => {
      if (r.url().includes('/characters/models/') && r.url().endsWith('.gltf'))
        modelFetches.push({ url: r.url(), status: r.status() });
    });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });

    // -- 1. go online -> empty auth_ok -> creation overlay + iframe -------
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.charCreate && window.__world.charCreate.open', { timeout: 20000 });
    await page.waitForFunction(
      () => !!document.querySelector('#charcreate-overlay iframe'), { timeout: 10000 });
    summary.overlayOpened = true;

    const frame = await page.waitForFunction(() => {
      const f = document.querySelector('#charcreate-overlay iframe');
      return f && f.src.includes('/create/') ? true : false;
    }, { timeout: 10000 }).then(() =>
      page.frames().find(f => f.url().includes('/create/')));
    if (!frame) throw new Error('create iframe frame not found');
    await frame.waitForFunction(
      'window.__cc && document.getElementById("loading").classList.contains("hidden")',
      { timeout: 60000 });
    await sleep(1500); // model settles
    summary.initialModel = await frame.evaluate(() => window.__cc.modelId);
    await page.screenshot({ path: SHOT('01_creator_embedded') });

    // -- 2. fail path: a taken name -> inline message in the iframe -------
    // (mock only: "Aria" is a fixture player there; nothing is guaranteed
    // to exist on the live server)
    if (!LIVE) {
      await frame.click('#name-input');
      await frame.type('#name-input', 'Aria'); // fixture player in the mock
      await sleep(200);
      await frame.click('#create-btn');
      await page.waitForFunction(
        `window.__world.net.log.some(l => l.dir === 'in' && l.op === 'charCreateFail')`,
        { timeout: 15000 });
      await frame.waitForFunction(
        `document.getElementById('name-hint').classList.contains('error')`,
        { timeout: 8000 });
      summary.failPath = {
        failOp: await page.evaluate(() =>
          window.__world.net.log.find(l => l.dir === 'in' && l.op === 'charCreateFail')),
        hint: await frame.evaluate(() => document.getElementById('name-hint').textContent),
        overlayStillOpen: await page.evaluate(() => window.__world.charCreate.open),
        btnReenabled: await frame.evaluate(() =>
          !document.getElementById('create-btn').textContent.includes('Creating')),
      };
      await page.screenshot({ path: SHOT('02_fail_inline') });
    }

    // -- 3. pick the combo, set a fresh name, Create -----------------------
    await frame.evaluate((pick) => {
      const click = (listId, pred) => {
        const b = [...document.querySelectorAll(`#${listId} button`)].find(pred);
        if (!b) throw new Error(`button not found in ${listId}`);
        b.click();
      };
      click('race-list', b => b.textContent.includes(pick.race));
      click('gender-list', b => b.textContent.trim() === pick.gender);
      click('class-list', b => b.textContent.includes(pick.cls));
    }, PICK);
    // The preview must actually swap models: state.modelEntry updates
    // synchronously on the click, so wait until the picked combo's gltf
    // is COMMITTED to the scene (model object present, not the placeholder
    // rig, exactly one model on the turntable).
    await frame.waitForFunction((m) =>
      window.__cc.modelId === m && window.__cc.model &&
      !window.__cc.state.usingPlaceholder &&
      window.__cc.turntable.children.length === 1,
      { timeout: 30000 }, PICK.model);
    summary.preview = await frame.evaluate(() => {
      let skinned = 0;
      window.__cc.turntable.traverse(o => { if (o.isSkinnedMesh) skinned++; });
      return {
        modelId: window.__cc.modelId,
        placeholder: window.__cc.state.usingPlaceholder,
        children: window.__cc.turntable.children.length,
        skinnedMeshes: skinned,   // glTF characters are skinned; the placeholder rig is not
        status: document.getElementById('model-status').textContent,
      };
    });
    summary.preview.gltfFetched = modelFetches.some(
      f => f.status === 200 && f.url.endsWith(`/characters/models/${PICK.model}.gltf`));
    await sleep(400); // a few settled frames
    await frame.evaluate(() => { const i = document.getElementById('name-input'); i.value = ''; });
    await frame.click('#name-input');
    await frame.type('#name-input', NAME);
    await sleep(200);
    await page.screenshot({ path: SHOT('03_combo_named') });
    await frame.click('#create-btn');

    // -- 4. assert the createChar op, overlay close, enterWorld ------------
    await page.waitForFunction(
      `window.__world.net.log.some(l => l.dir === 'out' && l.op === 'createChar' && l.name === '${NAME}')`,
      { timeout: 10000 });
    summary.createCharOp = await page.evaluate((n) =>
      window.__world.net.log.find(l => l.dir === 'out' && l.op === 'createChar' && l.name === n), NAME);
    await page.waitForFunction(
      '!window.__world.charCreate.open && window.__world.net.selfId', { timeout: 30000 });
    // live spawns in a real starting village: wait for that scene to load
    // (best-effort — the enterWorld assertions above are the real check)
    try {
      await page.waitForFunction(
        `document.getElementById('status').textContent.includes('${NAME}')`,
        { timeout: 60000 });
    } catch (e) { summary.consoleLogs.push('scene-load wait: ' + e.message); }
    await sleep(2500); // scene + models settle
    summary.enterWorld = await page.evaluate(() =>
      window.__world.net.log.find(l => l.dir === 'in' && l.op === 'enterWorld'));
    summary.status = await page.evaluate(() =>
      document.getElementById('status').textContent);
    await page.screenshot({ path: SHOT('04_entered_world') });

    // -- verdict ------------------------------------------------------------
    const op = summary.createCharOp || {};
    const ew = (summary.enterWorld && summary.enterWorld.char) || {};
    const pv = summary.preview || {};
    summary.checks = {
      previewSwitched: summary.initialModel !== PICK.model &&
        pv.modelId === PICK.model && pv.placeholder === false &&
        pv.children === 1 && pv.skinnedMeshes > 0 &&
        pv.gltfFetched === true && pv.status === PICK.model,
      createCharFields: op.name === NAME && op.race === PICK.protoRace &&
        op.sex === 1 && op.classId === PICK.classId,
      failWasTaken: LIVE || (summary.failPath.failOp &&
        summary.failPath.failOp.reason === 'name_already_exists'),
      failInline: LIVE || /taken/i.test(summary.failPath.hint || ''),
      overlayClosedOnOk: LIVE || summary.failPath.overlayStillOpen === true,
      enteredAsCreated: ew.name === NAME && ew.classId === PICK.classId,
    };
    summary.ok = Object.values(summary.checks).every(Boolean);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) { console.error('VERIFY FAILED'); process.exit(1); }
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
