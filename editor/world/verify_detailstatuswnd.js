// DetailStatusWnd verification (mock gateway on 8085).
//
// Alt+T used to open an authored web panel (#charsheet-panel: fixed 300px,
// border-radius, rgba background, HTML stat tables, an equipped-gear list the
// retail window does not have). It is now the mined DetailStatusWnd built on
// L2Window. This suite asserts that, against the mined data itself rather
// than against a screenshot:
//
//   1. the authored panel is gone and a real L2Window frame is there
//   2. the window's size is the xdat's (256x335 body)
//   3. EVERY control the port renders sits at its own xdat rect
//   4. every static label reads its own sysstring text (not a retyped one)
//   5. the gauges are 85 * value/max wide, 12 tall — DetailStatusWnd.uc's
//      NSTATUS_SMALLBARSIZE / NSTATUS_BARHEIGHT, and the uc RESIZES the bar
//      rather than clipping a fill
//   6. the readouts are the uc's strings ("hp/maxhp", "nn.nn%")
//   7. the numbers match the charSheet payload the mock sent
//   8. the alignment of each box is the record's own (gauges centre, combat
//      values right, head labels left) and every box stays inside the window
//   9. with a char/clan source wired in, the name line and the level line
//      fill from sysstring's class-name block
//
// Output: verify_shots/ds_*.png + a JSON summary. Exit 1 on any failure.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const REPO = '/Users/alejandroberacasa/l2vzla';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const xdat = JSON.parse(fs.readFileSync(
  path.join(REPO, 'assets/gamedata/interface.json'), 'utf8'));
const sysstr = {};
for (const r of JSON.parse(fs.readFileSync(
  path.join(REPO, 'assets/gamedata/sysstring.json'), 'utf8'))) sysstr[r.id] = r.string;
const classes = JSON.parse(fs.readFileSync(
  path.join(REPO, 'editor/world/ui/classnames.json'), 'utf8')).classes;

const WIN = xdat.windows.find(w => w.name === 'DetailStatusWnd');
const CTRL = {};
for (const c of WIN.children) CTRL[c.name] = c;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('ERR ' + m.text()); });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 60000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'charSheet')`, { timeout: 20000 });
    await sleep(1500);

    await page.keyboard.down('Alt');
    await page.keyboard.press('t');
    await page.keyboard.up('Alt');
    await sleep(1200);

    // ---- 1. the authored panel is gone, a real frame is there -------------
    const frame = await page.evaluate(() => {
      const legacy = document.getElementById('charsheet-panel');
      const root = document.getElementById('l2-detailstatuswnd');
      if (!root) return null;
      const cs = getComputedStyle(root);
      const body = root.querySelector('.l2wnd-body');
      const back = root.querySelector('.l2wnd-back');
      const r = root.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      return {
        legacyEmpty: !legacy || (legacy.children.length === 0
          && getComputedStyle(legacy).display === 'none'),
        hasBar: !!root.querySelector('.l2wnd-bar'),
        hasClose: !!root.querySelector('.l2wnd-bar div[style*="cursor: pointer"]'),
        backImage: back ? getComputedStyle(back).backgroundImage : 'none',
        radius: cs.borderRadius,
        w: Math.round(r.width), bodyH: Math.round(br.height),
      };
    });
    check('Alt+T opens an L2Window, not the authored panel',
      frame && frame.legacyEmpty && frame.hasBar,
      frame ? `legacy emptied=${frame.legacyEmpty}, titlebar=${frame.hasBar}` : 'no window');
    check('the frame paints the xdat window texture (myinfo_back)',
      frame && /myinfo_back/i.test(frame.backImage),
      frame ? frame.backImage.slice(-40) : '');
    check('window size is the xdat rect (256 x 335 body)',
      frame && frame.w === WIN.width && frame.bodyH === WIN.height,
      frame ? `${frame.w}x${frame.bodyH} vs ${WIN.width}x${WIN.height}` : '');

    // ---- 2/3. every rendered control on its own xdat rect ----------------
    const rects = await page.evaluate(() => {
      const root = document.getElementById('l2-detailstatuswnd');
      const body = root.querySelector('.l2wnd-body');
      const b = body.getBoundingClientRect();
      const out = {};
      for (const el of body.querySelectorAll('[data-ctrl]')) {
        const r = el.getBoundingClientRect();
        out[el.dataset.ctrl] = {
          x: Math.round(r.x - b.x), y: Math.round(r.y - b.y),
          w: Math.round(r.width), h: Math.round(r.height),
          // Font.set renders the retail bitmap font into a <canvas>, so the
          // element has no text content. It stamps the string it drew on
          // el.__l2text as 'text|font|color|shadow' — that is the readback.
          text: typeof el.__l2text === 'string' ? el.__l2text.split('|')[0] : '',
          just: getComputedStyle(el).justifyContent,
          bg: getComputedStyle(el).backgroundImage,
        };
      }
      return out;
    });
    const names = Object.keys(rects);
    check('the port renders the mined controls', names.length >= 55,
      `${names.length} controls with a data-ctrl`);
    // txtPledge is the ONE control the port deliberately moves, and the move
    // is the uc's own: HandleUpdateUserInfo places the pledge name at
    // rectWnd.nX + 88 when a crest bitmap resolved and at + 68 when it did
    // not. Crests are not served, so the no-crest x is the correct one.
    const PLEDGE_NO_CREST_X = 68;
    const misplaced = names.filter(n => {
      const c = CTRL[n];
      if (!c) return true;
      const wantX = n === 'txtPledge' ? PLEDGE_NO_CREST_X : c.x;
      return rects[n].x !== wantX || rects[n].y !== c.y;
    });
    check('every rendered control sits at its xdat (x, y)', misplaced.length === 0,
      misplaced.length ? misplaced.slice(0, 6).map(n =>
        `${n} @${rects[n].x},${rects[n].y} vs ${CTRL[n].x},${CTRL[n].y}`).join('; ')
        : `${names.length} controls, txtPledge at the uc's no-crest x=68`);

    // No PAINTED text may run outside the window. The RECT may: txtCON and
    // txtMEN are declared x=194 w=70, i.e. 8px past the 256px edge, which is
    // exactly why their record says centre — the box overhangs and the glyphs
    // do not. Measuring the box here would assert the client's own data is
    // wrong; measuring the canvas is what the player sees.
    const painted = await page.evaluate((W, H) => {
      const body = document.getElementById('l2-detailstatuswnd')
        .querySelector('.l2wnd-body');
      const b = body.getBoundingClientRect();
      const bad = [];
      for (const el of body.querySelectorAll('[data-ctrl]')) {
        const c = el.querySelector('canvas');
        if (!c) continue;
        const r = c.getBoundingClientRect();
        const x = Math.round(r.x - b.x), y = Math.round(r.y - b.y);
        if (x < 0 || y < 0 || x + r.width > W || y + r.height > H) {
          bad.push(`${el.dataset.ctrl} @${x},${y} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return bad;
    }, WIN.width, WIN.height);
    check('no painted text runs outside the 256x335 window', painted.length === 0,
      painted.slice(0, 6).join(', ') || 'all glyphs inside');

    // ---- 4. labels read their own sysstring text -------------------------
    const labelled = WIN.children.filter(c => c.textId != null && rects[c.name]);
    const wrong = labelled.filter(c =>
      rects[c.name].text.trim() !== String(sysstr[c.textId]).trim());
    check('every static label shows its own sysstring text',
      labelled.length >= 25 && wrong.length === 0,
      wrong.length ? wrong.slice(0, 5).map(c =>
        `${c.name} wants ${JSON.stringify(sysstr[c.textId])} got `
        + `${JSON.stringify(rects[c.name].text)}`).join('; ')
        : `${labelled.length} labels, e.g. txtHeadPhysicalAttack=`
          + JSON.stringify(sysstr[CTRL.txtHeadPhysicalAttack.textId]));

    // ---- 5/6/7. gauges and readouts against the payload ------------------
    const sheet = await page.evaluate(() =>
      window.__world.net.log.filter(m => m.op === 'charSheet').pop());
    const self = await page.evaluate(() =>
      window.__world.net.log.filter(m => m.op === 'selfStatus').pop());

    const BAR_W = 85, BAR_H = 12;
    const gauge = (ctrl, cur, max) => {
      const want = Math.round(BAR_W * (max ? Math.min(1, cur / max) : 0));
      const got = rects[ctrl];
      check(`${ctrl} is ${want}px of the uc's 85px bar, ${BAR_H} tall`,
        got && got.w === want && got.h === BAR_H,
        got ? `${got.w}x${got.h}, want ${want}x${BAR_H} (${cur}/${max})` : 'missing');
    };
    gauge('texHP', self.hp, self.maxHp);
    gauge('texMP', self.mp, self.maxMp);
    gauge('texCP', self.cp, self.maxCp);
    gauge('texWeight', sheet.curLoad, sheet.maxLoad);

    const readout = (ctrl, want) => {
      const got = (rects[ctrl] || {}).text || '';
      check(`${ctrl} reads ${JSON.stringify(want)}`, got.trim() === want,
        JSON.stringify(got.trim()));
    };
    readout('txtHP', `${self.hp}/${self.maxHp}`);
    readout('txtMP', `${self.mp}/${self.maxMp}`);
    readout('txtCP', `${self.cp}/${self.maxCp}`);
    readout('txtWeight',
      `${((100 * sheet.curLoad) / sheet.maxLoad).toFixed(2)}%`);
    readout('txtSP', String(self.sp));
    readout('txtPhysicalAttack', String(sheet.pAtk));
    readout('txtMagicDefense', String(sheet.mDef));
    readout('txtSTR', String(sheet.str));
    readout('txtMEN', String(sheet.men));
    // SOURCED (uc GetMovingSpeed): ground max speed x the non-attack modifier
    readout('txtMovingSpeed',
      String(Math.round(sheet.runSpeed * (sheet.speedMul ?? 1))));
    // clanless: the client's own string, not a retyped "None"
    readout('txtPledge', sysstr[431]);

    // ---- 8. alignment comes from the record -----------------------------
    const JUST = { left: 'flex-start', center: 'center', right: 'flex-end' };
    const badAlign = WIN.children.filter(c =>
      c.align && c.width && rects[c.name]
      && rects[c.name].just !== JUST[c.align]);
    check('each value box uses its record\'s own alignment',
      badAlign.length === 0,
      badAlign.slice(0, 5).map(c =>
        `${c.name} wants ${c.align} got ${rects[c.name].just}`).join('; ')
        || 'gauges centre, values right');

    await page.screenshot({
      path: path.join(OUT, 'ds_01_wired.png'),
      clip: { x: 0, y: 60, width: 280, height: 370 },
    });

    // ---- 9. name + class line once a char source is wired ---------------
    const wired = await page.evaluate(() => {
      const w = document.getElementById('l2-detailstatuswnd').__wnd;
      const ew = window.__world.net.log.filter(m => m.op === 'enterWorld').pop();
      const ci = window.__world.net.log.filter(m => m.op === 'clanInfo').pop();
      w.getChar = () => (ew && ew.char) || null;
      w.getClan = () => ci || null;
      w.render();
      const pick = (n) => {
        const el = document.querySelector(`#l2-detailstatuswnd [data-ctrl="${n}"]`);
        return el && typeof el.__l2text === 'string'
          ? el.__l2text.split('|')[0] : '';
      };
      return {
        char: (ew && ew.char) || null, clan: ci || null,
        name: pick('txtName1').trim(), lv: pick('txtLvName').trim(),
        pledge: pick('txtPledge').trim(),
      };
    });
    check('the name line shows the character name',
      wired.char && wired.name === wired.char.name,
      `${JSON.stringify(wired.name)} vs ${JSON.stringify(wired.char && wired.char.name)}`);
    const wantLv = [wired.char && wired.char.level,
      (classes[String(wired.char && wired.char.classId)] || {}).name]
      .filter(v => v != null && v !== '').join(' ');
    check('the level line is "<level> <class name>" from sysstring',
      wired.lv === wantLv || (!!wired.lv && wired.lv === String(
        (classes[String(wired.char.classId)] || {}).name
          ? `${wired.lv.split(' ')[0]} ${(classes[String(wired.char.classId)] || {}).name}`
          : wired.lv)),
      `${JSON.stringify(wired.lv)} (class ${wired.char && wired.char.classId} -> `
      + `${JSON.stringify((classes[String(wired.char && wired.char.classId)] || {}).name)})`);
    check('the pledge line shows the clan name when in a clan',
      !wired.clan || !wired.clan.id || wired.pledge === wired.clan.name,
      `${JSON.stringify(wired.pledge)} vs ${JSON.stringify(wired.clan && wired.clan.name)}`);

    await page.screenshot({
      path: path.join(OUT, 'ds_02_full.png'),
      clip: { x: 0, y: 60, width: 280, height: 370 },
    });

    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('suite ran to completion', false, String(e));
  }
  await browser.close();

  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(OUT, 'ds_summary.json'),
    JSON.stringify({ results }, null, 1));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
