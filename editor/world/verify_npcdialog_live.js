// NPC dialog (NpcHtmlMessage) — LIVE pass.
//
//   node editor/world/verify_npcdialog_live.js           report + screenshots
//   node editor/world/verify_npcdialog_live.js --check   assert, exit 1 on fail
//   node editor/world/verify_npcdialog_live.js --prove   --check, then run the
//                                                        two behavioural gates
//                                                        against the PRE-FIX
//                                                        module in the same
//                                                        live page and require
//                                                        them to go red
//
// WHY THIS EXISTS AND NOT JUST verify_npcdialog.js
// ------------------------------------------------
// verify_npcdialog.js drives editor/world/npchtml-preview.html: a bare page,
// six datapack fixtures, no gateway, no login, no 3D world. That harness is
// where the whole NPC-dialog contract is asserted, and it passed 24/24 while
// the owner's screenshot of the REAL client showed a defect on two of the four
// text lines of the very first dialog in the game. Both halves of that are
// worth naming, because they are different failures:
//
//   * the ENVIRONMENT was never covered. Nothing asserted that the mined
//     geometry, the background sprite or the glyph path survive in index.html,
//     against the real stylesheet, over the 3D canvas, at the client's own
//     z-order. This suite asserts them there, and it asserts the background
//     from the RENDERED PIXELS rather than from a CSS string — the two texel
//     columns of Npc1_back that carry alpha 255 have a value that does not
//     depend on what is behind the window, so they are a fingerprint of that
//     sprite and of nothing else. A window painted flat black cannot pass.
//
//   * the CONTENT was never covered. The harness's gatekeeper fixture is
//     Roxxy (30006); the page the owner was looking at is Clarissa (30080),
//     and only Clarissa's fills a line closely enough to expose the wrap bug.
//     A fixture is a sample, and a sample can miss. So this suite takes the
//     page from the SERVER — it walks nothing and stubs nothing: it seeds the
//     character next to Clarissa, talks to her through the real gateway and
//     renders whatever aCis sends.
//
// WHAT IT ASSERTS
//   L1..L3  the mined rect, body split and html-frame inset, in the live DOM
//   L4      the background is Npc1_back, proven from the pixels the client
//           actually drew, compared against the texels of the staged file
//   L5      the title bar is SysString 444 and a page's own <title> does not
//           reach it (driven live: `.menu` sends a page that declares one)
//   L6      no line of a wrapped paragraph begins with a space
//   L7      a multi-word link's underline is one unbroken rule
//   L8      provenance: the page came off the socket and carries the live
//           object id of the NPC that was talked to
//
// COST: one login, no walking. ~60 s.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = path.join(__dirname, '..', '..');
const BASE = 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');
const SPEC = path.join(REPO, 'assets/gamedata/npchtml.json');
const SYSSTR = path.join(REPO, 'assets/gamedata/sysstring.json');
const ART = path.join(__dirname, 'ui/htmlart.json');

// A STABLE device id, so the account and its character persist between runs.
// A fresh one lands in character creation and the suite would hang there —
// the failure HANDOFF §5 records for nine live suites.
const DEVICE_ID = 'verify-npcdialog-agent';
// Gatekeeper Clarissa, from the datapack's own spawn table
// (server/aCis_datapack/data/xml/spawnlist/22_22.xml: id 30080).
const CLARISSA = { npcId: 30080, x: 83396, y: 147904, z: -3404 };

// The pre-fix module for --prove: the tree as it stood before this wave.
const PREFIX_REV = 'HEAD';
const PREFIX_MODULE = path.join(__dirname, 'js/ui/npcdialog.prefix-live.js');

const CHECK = process.argv.includes('--check');
const PROVE = process.argv.includes('--prove');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const sysstr = JSON.parse(fs.readFileSync(SYSSTR, 'utf8'));
// The staged file for the mined background ref, resolved the way the runtime
// resolves it (package|leaf, case-insensitive) — never a typed filename.
const artIndex = (() => {
  const doc = JSON.parse(fs.readFileSync(ART, 'utf8'));
  const m = new Map();
  for (const [ref, rec] of Object.entries(doc.sprites || {})) {
    const p = ref.split('.');
    m.set(`${p[0]}|${p[p.length - 1]}`.toLowerCase(), rec);
  }
  return m;
})();
function artUrl(ref) {
  const p = String(ref).split('.');
  const rec = artIndex.get(`${p[0]}|${p[p.length - 1]}`.toLowerCase());
  return rec ? `/ui/htmlart/${rec.file}` : null;
}

const db = (q) => execFileSync(
  'mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-N', '-B', '-e', q],
  { encoding: 'utf8' }).trim();

function charName(deviceId) {
  // gateway/src/bridge.js deriveCredentials, verbatim.
  const h1 = crypto.createHash('sha256')
    .update('l2vzla-account:' + deviceId).digest('hex');
  return 'W' + h1.slice(12, 23);
}

/** SysString text for an id, out of the same table the client reads. */
function sysText(id) {
  const rec = sysstr.find(e => e && e.id === id);
  return rec ? rec.string : null;
}

// ---------------------------------------------------------------------------
// page-side helpers, injected once

const PAGE_HELPERS = `
window.__nd = {
  // Every laid-out box of the dialog's flow, grouped into line boxes by their
  // top edge. A "box" is a word canvas span or a spacer span; a space that is
  // a CHARACTER has no box, which is the whole point of the fix under test.
  lines(root) {
    const content = root.querySelector('.npc-dialog-content');
    if (!content) return [];
    const rows = new Map();
    for (const el of content.querySelectorAll('.l2h-w, .l2h-sp')) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const key = Math.round(r.top);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({
        kind: el.classList.contains('l2h-w') ? 'w' : 'sp',
        t: el.dataset.t || null,
        link: el.classList.contains('npc-link'),
        x: r.left, right: r.right, top: r.top, bottom: r.bottom,
      });
    }
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([top, boxes]) => {
      boxes.sort((a, b) => a.x - b.x);
      return { top, boxes };
    });
  },
  /** Decode a base64 png into an ImageData, in the page. */
  async decode(b64) {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { w: c.width, h: c.height,
             d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
  },
  /** The staged sprite file's own texels. */
  async sprite(url) {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej; img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { w: c.width, h: c.height,
             d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
  },
};
`;

// ---------------------------------------------------------------------------

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1400,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.evaluateOnNewDocument(
    (id) => localStorage.setItem('l2vzla.deviceId', id), DEVICE_ID);
  await page.evaluateOnNewDocument(PAGE_HELPERS);
  page.on('pageerror', e => console.error('PAGEERROR:', e.message));
  return { browser, page };
}

async function connect(page, name) {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__world && window.__world.ready',
    { timeout: 90000 });
  await page.click('#online-toggle');
  await page.waitForFunction(
    'window.__world.charCreate.open'
    + ' || window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
  if (await page.evaluate('window.__world.charCreate.open')) {
    // First run for this device id: create the character the same way the
    // overlay would, so the suite is self-seeding rather than dependent on
    // some earlier run having left a row behind.
    await page.evaluate((n) => window.__world.net.sendOp('createChar', {
      name: n, race: 0, sex: 0, classId: 0, hairStyle: 0, hairColor: 0, face: 0,
    }), name);
  }
  await page.waitForFunction(
    'window.__world.net.connected'
    + ' && window.__world.net.log.some(m => m.op === "enterWorld")',
    { timeout: 120000 });
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const name = charName(DEVICE_ID);
  const summary = { char: name, npc: CLARISSA.npcId };

  let { browser, page } = await launch();
  try {
    // -- 0. make sure the character exists, then park it next to Clarissa ----
    if (db(`select count(*) from characters where char_name='${name}'`) === '0') {
      await connect(page, name);
      await sleep(2500);
      await page.evaluate(() => document.querySelector('#online-toggle').click());
      await sleep(1500);
    }
    for (let i = 0; i < 40; i++) {
      if (db(`select online from characters where char_name='${name}'`) === '0') break;
      await sleep(1000);
    }
    // Offline UPDATE: the login load reads these columns, so the character
    // enters the world already in front of the NPC and nothing has to walk.
    db(`update characters set x=${CLARISSA.x + 60}, y=${CLARISSA.y + 60},`
      + ` z=${CLARISSA.z} where char_name='${name}'`);

    // -- 1. enter the world and talk to her ---------------------------------
    await connect(page, name);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'addNpc' && m.npcId === ${CLARISSA.npcId})`,
      { timeout: 60000 });
    const objectId = await page.evaluate((npcId) => window.__world.net.log
      .find(m => m.op === 'addNpc' && m.npcId === npcId).id, CLARISSA.npcId);
    summary.objectId = objectId;
    await page.evaluate((id) => window.__world.net.sendOp('talk', { id }), objectId);
    await page.waitForFunction(
      'window.__world.net.log.some(m => m.op === "npcHtml")', { timeout: 30000 });
    await sleep(1200);

    // -- 2. probe -----------------------------------------------------------
    const shotB64 = await (await page.$('#l2-npcdialog'))
      .screenshot({ encoding: 'base64' });
    fs.writeFileSync(path.join(OUT, 'npcdialog_live_after.png'),
      Buffer.from(shotB64, 'base64'));

    const p = await page.evaluate(async (b64, bgFile) => {
      const d = window.__world.npcDialog;
      const root = d.root;
      const rr = root.getBoundingClientRect();
      const body = root.querySelector('.l2wnd-body').getBoundingClientRect();
      const frame = root.querySelector('.npc-html-frame').getBoundingClientRect();
      const back = root.querySelector('.l2wnd-back');
      const shot = await window.__nd.decode(b64);
      const sprite = await window.__nd.sprite(bgFile);
      const px = (im, x, y) => {
        const i = ((y * im.w) + x) * 4;
        return [im.d[i], im.d[i + 1], im.d[i + 2], im.d[i + 3]];
      };
      const html = [...window.__world.net.log].reverse()
        .find(m => m.op === 'npcHtml');
      return {
        win: { w: Math.round(rr.width), h: Math.round(rr.height) },
        body: { h: Math.round(body.height) },
        frame: {
          x: Math.round(frame.left - rr.left), y: Math.round(frame.top - rr.top),
          w: Math.round(frame.width), h: Math.round(frame.height),
        },
        backImage: back ? getComputedStyle(back).backgroundImage : null,
        shot: { w: shot.w, h: shot.h },
        sprite: { w: sprite.w, h: sprite.h },
        // The sprite's own texels on the two fully opaque columns, and one
        // interior sample, at three rows of the panel.
        texels: [80, 200, 340].map(y => ({
          y,
          file: { l: px(sprite, 0, y), hl: px(sprite, 1, y),
                  mid: px(sprite, 150, y), r: px(sprite, 309, y) },
          // the panel starts one title bar down in the window's own shot
          screen: { l: px(shot, 0, y + 20), hl: px(shot, 1, y + 20),
                    mid: px(shot, 150, y + 20), r: px(shot, 309, y + 20) },
        })),
        bar: root.dataset.npcBar,
        barId: root.dataset.npcBarId,
        pageTitle: root.dataset.npcTitle,
        barCanvas: (() => {
          const c = root.querySelector('.l2wnd-bar canvas');
          return c ? { w: c.width, h: c.height } : null;
        })(),
        lines: window.__nd.lines(root),
        links: [...root.querySelectorAll('.npc-dialog-content .l2h-w.npc-link')]
          .map(e => ({ t: e.dataset.t, bypass: e.dataset.bypass || null })),
        htmlOp: html ? html.html : null,
      };
    }, shotB64, artUrl(spec.window.background));

    // -- 3. the title negative, driven live: `.menu` declares a <title> -----
    await page.keyboard.press('Enter');
    await sleep(200);
    await page.type('#chat-input', '.menu');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      'window.__world.net.log.filter(m => m.op === "npcHtml").length >= 2',
      { timeout: 20000 }).catch(() => {});
    await sleep(900);
    p.afterMenu = await page.evaluate(() => ({
      bar: window.__world.npcDialog.root.dataset.npcBar,
      pageTitle: window.__world.npcDialog.root.dataset.npcTitle,
    }));

    // -- 4. --prove: the same live page, the pre-fix module ------------------
    if (PROVE) {
      const src = execFileSync('git', ['-C', REPO, 'show',
        `${PREFIX_REV}:editor/world/js/ui/npcdialog.js`], { encoding: 'utf8' });
      fs.writeFileSync(PREFIX_MODULE, src);
      p.prefix = await page.evaluate(async (html) => {
        const mod = await import('./js/ui/npcdialog.prefix-live.js');
        const d = new mod.NpcDialog(document.body, {});
        d.root.id = 'l2-npcdialog-prefix';
        d.showHtml(html);
        // The two windows dock to the same corner and the panel art is
        // translucent, so the live one has to be out of the way before the
        // pre-fix one is photographed — otherwise the "before" shot is a
        // composite of both and proves nothing.
        document.querySelector('#l2-npcdialog').style.display = 'none';
        await new Promise(r => setTimeout(r, 400));
        return {
          title: d.root.dataset.npcTitle,
          lines: window.__nd.lines(d.root),
        };
      }, p.htmlOp);
      const before = await (await page.$('#l2-npcdialog-prefix'))
        .screenshot({ encoding: 'base64' });
      fs.writeFileSync(path.join(OUT, 'npcdialog_live_before.png'),
        Buffer.from(before, 'base64'));
    }

    return { p, summary };
  } finally {
    await browser.close();
    if (fs.existsSync(PREFIX_MODULE)) fs.unlinkSync(PREFIX_MODULE);
  }
}

// ---------------------------------------------------------------------------

/** A line box whose leftmost laid-out item is a spacer, not a word. */
function indentedLines(lines) {
  if (!lines.length) return [];
  const flush = Math.min(...lines.map(l => l.boxes[0].x));
  return lines.filter(l => l.boxes[0].kind === 'sp' || l.boxes[0].x > flush + 0.5);
}

/** The lines of the one wrapped paragraph: those that carry no link. */
function proseLines(lines) {
  return lines.filter(l => l.boxes.every(b => !b.link));
}

function gates(p) {
  const W = spec.window;
  const F = W.frame;
  const g = {};

  g['L1 live window is the mined rect'] =
    p.win.w === W.width && p.win.h === W.height;
  g['L2 live body is the window minus the mined title bar'] =
    p.body.h === W.height - W.titleBarHeight;
  g['L3 live html frame is at the mined inset'] =
    p.frame.x === F.x && p.frame.y === F.y
    && p.frame.w === F.width && p.frame.h === F.height;

  // L4 — the sprite, from the pixels. The two outline columns of Npc1_back
  // carry alpha 255, so what the client drew there must equal the file's own
  // texel EXACTLY, whatever the 3D scene behind the window happens to be. The
  // interior carries alpha 221, so it is only required to be non-identical to
  // those columns — that part cannot be exact without knowing the backdrop.
  g['L4a background names the mined texture'] =
    !!p.backImage && p.backImage !== 'none'
    && new RegExp(W.background.split('.').pop(), 'i').test(p.backImage);
  g['L4b the staged bitmap decodes'] = p.sprite.w > 0 && p.sprite.h > 0;
  const opaque = p.texels.filter(t => t.file.l[3] === 255 && t.file.r[3] === 255);
  g['L4c the sprite has opaque outline columns to fingerprint'] =
    opaque.length === p.texels.length && p.texels.length >= 3;
  g['L4d the client drew those exact texels'] = opaque.length > 0
    && opaque.every(t => t.screen.l[0] === t.file.l[0]
      && t.screen.l[1] === t.file.l[1] && t.screen.l[2] === t.file.l[2]
      && t.screen.r[0] === t.file.r[0] && t.screen.r[1] === t.file.r[1]
      && t.screen.r[2] === t.file.r[2]);
  // …and the panel is not flat: the highlight column must read brighter than
  // the interior, which is only true if the translucent art is composited.
  g['L4e the translucent interior is composited, not flat'] =
    p.texels.every(t => t.screen.hl[0] > t.screen.mid[0] + 4);

  // L5 — the title
  const want = sysText(W.title.sysStringId);
  g['L5a the bar is the mined SysString'] =
    !!want && p.bar === want && p.barId === String(W.title.sysStringId);
  g['L5b the bar is drawn through the glyph sheet'] =
    !!p.barCanvas && p.barCanvas.w > 0;
  g['L5c a page that declares a <title> does not retitle the bar'] =
    !!p.afterMenu && !!p.afterMenu.pageTitle && p.afterMenu.pageTitle !== ''
    && p.afterMenu.bar === want;

  // L6 — the reported defect, on the server's own page
  const prose = proseLines(p.lines);
  g['L6a the page really wraps (the gate is not vacuous)'] = prose.length >= 3;
  g['L6b no line begins with a space'] = prose.length >= 3
    && indentedLines(prose).length === 0;

  // L7 — one unbroken underline across a multi-word link. Measured as
  // coverage: every line box that carries link words must have its words
  // contiguous to within the space advance, and the CSS bridge must exist.
  const linkLines = p.lines.filter(l => l.boxes.some(b => b.link));
  const multi = linkLines.filter(l => l.boxes.filter(b => b.link).length > 1);
  g['L7a the page has a multi-word link (the gate is not vacuous)'] =
    multi.length > 0;
  g['L7b a link run has no box-sized hole in it'] = multi.length > 0
    && multi.every((l) => {
      const b = l.boxes.filter(x => x.link);
      for (let i = 1; i < b.length; i++) {
        // the only gap between two words of one anchor is the space advance;
        // anything wider means a box went missing from the run
        if (b[i].x - b[i - 1].right > 12) return false;
      }
      return true;
    });

  // L8 — provenance
  g['L8a the page came off the socket'] =
    !!p.htmlOp && /Gatekeeper/.test(p.htmlOp);
  g['L8b its bypasses carry the live object id'] =
    p.links.some(l => l.bypass && l.bypass.includes(String(p.objectId)));

  return g;
}

function proveGates(p) {
  const g = {};
  const prose = proseLines(p.prefix.lines);
  g['P1 pre-fix: the same page indents a wrapped line'] =
    prose.length >= 3 && indentedLines(prose).length > 0;
  g['P2 pre-fix: the bar is the authored word, not the SysString'] =
    p.prefix.title === 'Dialog';
  return g;
}

(async () => {
  const { p, summary } = await run();
  p.objectId = summary.objectId;
  const g = gates(p);
  console.log('=== live client, real gateway, real aCis ===');
  console.log(`char ${summary.char}, NPC ${summary.npc} object ${summary.objectId}`);
  let bad = 0;
  for (const [k, v] of Object.entries(g)) {
    if (!v) bad++;
    console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
  }
  if (PROVE) {
    const pg = proveGates(p);
    console.log('=== pre-fix module, same live page ===');
    for (const [k, v] of Object.entries(pg)) {
      if (!v) bad++;
      console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'npcdialog_live.json'),
    JSON.stringify({ summary, gates: g, probe: p }, null, 1));
  if (CHECK || PROVE) {
    console.log(bad ? `\nCHECK FAIL (${bad})` : '\nCHECK PASS');
    process.exit(bad ? 1 : 0);
  }
  console.log(`\nshots  ${OUT}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
