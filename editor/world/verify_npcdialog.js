// NPC dialog (NpcHtmlMessage) verification.
//
//   node editor/world/verify_npcdialog.js            report + screenshots
//   node editor/world/verify_npcdialog.js --check    assert, exit 1 on failure
//   node editor/world/verify_npcdialog.js --prove    --check, and then run the
//                                                    SAME gates against the
//                                                    pre-fix tree and require
//                                                    them to go red
//
// WHAT IT ASSERTS, AND WHY EACH GATE EXISTS
// -----------------------------------------
// Every number below is read from assets/gamedata/npchtml.json, which
// tools/ui/mine_npchtml.py decodes out of NWindow.dll and re-verifies with
// --check. This suite does not carry a single geometry or colour literal of
// its own: if the DLL says something different tomorrow, the miner's --check
// fails first and this suite follows.
//
//   A geometry   the window is the mined rect, and the html frame sits at the
//                mined inset inside it.
//   B sprite     the background is not merely "styled" — the ref resolves to
//                a staged file AND that file decodes to a non-zero bitmap.
//                This gate exists because of js/ui/shortcutwnd.js: its slot
//                positions were perfect while Skin.apply had silently set
//                `background: none`, and nothing noticed. A gate that only
//                reads backgroundImage !== 'none' would not have caught it
//                either, since a broken URL still leaves a url() there.
//   C font       the dialog draws through the retail glyph sheet. Asserted as
//                "every visible text is a <canvas> and the content subtree has
//                no DOM text at all" — a web font cannot pass that.
//   D colour     the four cases of NCHtmlObject::GetMatchedColor, sampled off
//                the rendered pixels, plus a negative: none of the three
//                invented colours the pre-fix tree used may appear anywhere.
//   E parser     the closed tag table. DIV/SPAN/STRONG contribute nothing,
//                BR1 breaks, TABLE/TR/TD build a real table.
//   F buttons    a <button>'s art is a client texture that loads, and its
//                label is the mined NCButton colour.
//   G bypass     a click sends the exact command, and `$var` is substituted
//                from the page's own <edit>.
//   H safety     a <script> in server HTML does not execute, and an external
//                <img src="http://..."> never becomes a request.
//
// It runs against editor/world/npchtml-preview.html, which mounts the module
// on the six real datapack pages with no gateway, no login and no 3D world.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = path.join(__dirname, '..', '..');
const BASE = 'http://127.0.0.1:8083/npchtml-preview.html';
const OUT = path.join(__dirname, 'verify_shots');
const SPEC = path.join(REPO, 'assets/gamedata/npchtml.json');

// The pre-fix tree, pinned by commit so --prove keeps working after this wave
// is committed. dd4d3b4 is the last commit whose npcdialog.js still authored
// its own 360x420 box, its own #c9a959 title and its own web font.
const PREFIX_REV = 'dd4d3b4';
const PREFIX_MODULE = path.join(__dirname, 'js/ui/npcdialog.prefix.js');

const CHECK = process.argv.includes('--check');
const PROVE = process.argv.includes('--prove');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));

/** The NPC-dialog block of the pre-fix stylesheet, out of the pinned commit. */
function prefixCss() {
  const css = execFileSync('git', ['-C', REPO, 'show',
    `${PREFIX_REV}:editor/world/style.css`], { encoding: 'utf8' });
  const at = css.indexOf('/* NPC dialog');
  if (at < 0) throw new Error(`no NPC dialog block in ${PREFIX_REV}:style.css`);
  return css.slice(at);
}

// ---------------------------------------------------------------------------

/** Collect everything the gates need, in one page evaluation. */
async function probe(page) {
  return page.evaluate(() => {
    const H = window.__npcHarness;
    const out = { error: H.error || null, fx: {} };
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: Math.round(r.width), h: Math.round(r.height) };
    };
    // The dominant non-transparent colour of a canvas, as #rrggbb. The retail
    // glyph sheet carries a dark outline, so the CORE (the most opaque,
    // brightest texel class) is what the text colour actually is.
    const canvasColor = (c) => {
      try {
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let best = null, bestA = -1;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a < 250) continue;
          const lum = d[i] + d[i + 1] + d[i + 2];
          if (lum > bestA) { bestA = lum; best = [d[i], d[i + 1], d[i + 2]]; }
        }
        if (!best) return null;
        return '#' + best.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      } catch (e) { return null; }
    };
    const wordColor = (root, text) => {
      const w = [...root.querySelectorAll('.l2h-w')].find(e => e.dataset.t === text);
      if (!w) return null;
      const c = w.querySelector('canvas');
      return c ? canvasColor(c) : null;
    };

    for (const [name, entry] of Object.entries(H.dialogs)) {
      const d = entry.dialog;
      const root = d.root;
      const body = root.querySelector('.l2wnd-body');
      const back = root.querySelector('.l2wnd-back');
      const frame = root.querySelector('.npc-html-frame');
      const content = root.querySelector('.npc-dialog-content');
      const rr = rect(root);
      const bs = back ? getComputedStyle(back) : null;
      const rec = {
        window: { w: rr.w, h: rr.h },
        body: body ? rect(body) : null,
        // frame position relative to the WINDOW's top-left, in CSS px
        frame: frame ? (() => {
          const f = rect(frame);
          return { x: Math.round(f.x - rr.x), y: Math.round(f.y - rr.y), w: f.w, h: f.h };
        })() : null,
        backImage: bs ? bs.backgroundImage : null,
        // all inline styles + computed colours inside the dialog, for the
        // "no invented colour anywhere" negative gate
        colorSoup: (() => {
          const seen = new Set();
          for (const el of root.querySelectorAll('*')) {
            const cs = getComputedStyle(el);
            seen.add(cs.color);
            seen.add(cs.backgroundColor);
            seen.add(cs.borderBottomColor);
          }
          return [...seen];
        })(),
        // C: is there ANY DOM text in the content subtree?
        domText: content ? (() => {
          let t = '';
          const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
          while (walk.nextNode()) t += walk.currentNode.nodeValue;
          return t.replace(/\s+/g, '');
        })() : null,
        canvases: content ? content.querySelectorAll('canvas').length : 0,
        words: content ? [...content.querySelectorAll('.l2h-w')].map(e => e.dataset.t) : [],
        links: content ? [...content.querySelectorAll('.l2h-w.npc-link')].map(e => e.dataset.bypass || null) : [],
        tables: content ? content.querySelectorAll('table').length : 0,
        rows: content ? content.querySelectorAll('tr').length : 0,
        cells: content ? content.querySelectorAll('td').length : 0,
        brs: content ? content.querySelectorAll('br').length : 0,
        imgs: content ? [...content.querySelectorAll('.npc-html-img')].map(e => ({
          bg: getComputedStyle(e).backgroundImage,
          w: Math.round(e.getBoundingClientRect().width),
          h: Math.round(e.getBoundingClientRect().height),
        })) : [],
        buttons: content ? [...content.querySelectorAll('.npc-btn')].map(e => ({
          bg: getComputedStyle(e).backgroundImage,
          bypass: e.dataset.bypass || null,
          label: e.querySelector('canvas') ? canvasColor(e.querySelector('canvas')) : null,
          w: Math.round(e.getBoundingClientRect().width),
        })) : [],
        // any <img>/<script>/<iframe> element at all (the client has no such
        // controls; if one exists the renderer is a browser, not the client)
        rawTags: content ? ['img', 'script', 'iframe', 'a', 'div', 'span', 'strong']
          .reduce((o, t) => { o[t] = content.querySelectorAll(t).length; return o; }, {}) : null,
        colors: content ? {
          plain: wordColor(content, 'stranger!') || wordColor(content, 'Roxxy:')
            || wordColor(content, 'Penalty') || wordColor(content, 'Marketeer'),
          level: wordColor(content, 'LEVEL'),
          hex: wordColor(content, '00FFFF'),
          link: wordColor(content, 'Teleport') || wordColor(content, 'support'),
          white: wordColor(content, 'white'),
        } : null,
        title: (() => {
          const c = root.querySelector('.l2wnd-bar canvas');
          return c ? c.width : 0;
        })(),
        bypassLog: entry.bypass,
      };
      out.fx[name] = rec;
    }
    out.pwned = typeof window.__pwned !== 'undefined';
    // resolve the background bitmap for gate B
    out.backProbe = null;
    return out;
  });
}

/** Gate B's second half: the sprite the CSS names must decode to real pixels. */
async function spriteLoads(page, cssUrl) {
  const m = /url\("?([^")]+)"?\)/.exec(cssUrl || '');
  if (!m) return { url: null, w: 0, h: 0 };
  return page.evaluate((u) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ url: u, w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => res({ url: u, w: 0, h: 0 });
    i.src = u;
  }), m[1]);
}

// Sampled glyph pixels are the mined colour MODULATED by the sheet's own core
// texel, which is not pure white: js/ui/font.js multiplies texel*tint/255, and
// SmallFont-e's core measures ~251, so #DCDCDC renders #DCD9DC and #FFCC00
// renders #FFC900 — a uniform 0.985. That is the client's own modulate, not
// drift, so the gate compares within a small per-channel tolerance. It is far
// tighter than the distance to any of the colours this wave removed (#c9a959
// is 0x60 away from #DCDCDC on the blue channel alone).
function near(got, want, tol = 8) {
  if (!got || !want) return false;
  const g = got.replace('#', ''), w = want.replace('#', '');
  if (g.length !== 6 || w.length !== 6) return false;
  for (let i = 0; i < 6; i += 2) {
    if (Math.abs(parseInt(g.substr(i, 2), 16) - parseInt(w.substr(i, 2), 16)) > tol) {
      return false;
    }
  }
  return true;
}

function gates(p, sprite, extra) {
  const W = spec.window;
  const F = W.frame;
  const C = spec.colors;
  const g = {};
  const fx = p.fx;
  const any = fx.gatekeeper || Object.values(fx)[0] || {};

  // A — geometry, straight off the mined record
  g['A1 window is the mined rect'] =
    !!any.window && any.window.w === W.width && any.window.h === W.height;
  g['A2 body is the window minus the mined title bar'] =
    !!any.body && any.body.h === W.height - W.titleBarHeight;
  g['A3 html frame is at the mined inset'] =
    !!any.frame && any.frame.x === F.x && any.frame.y === F.y
    && any.frame.w === F.width && any.frame.h === F.height;

  // B — the sprite RESOLVES (a silent `background: none` cannot pass, and
  //     neither can a url() pointing at a 404)
  g['B1 background names the mined texture'] =
    !!any.backImage && any.backImage !== 'none'
    && new RegExp(W.background.split('.').pop(), 'i').test(any.backImage);
  g['B2 background bitmap actually decodes'] =
    !!sprite && sprite.w > 0 && sprite.h > 0;

  // C — the retail glyph sheet, not a web font
  g['C1 content carries no DOM text'] = fx.gatekeeper
    ? fx.gatekeeper.domText === '' : false;
  g['C2 every word is a glyph canvas'] = !!fx.gatekeeper
    && fx.gatekeeper.canvases > 0
    && fx.gatekeeper.canvases >= fx.gatekeeper.words.length;

  // D — NCHtmlObject::GetMatchedColor, sampled off the pixels
  const ed = fx.edges || {};
  g['D1 plain text is the mined default'] =
    !!fx.buffer && near(fx.buffer.colors.plain, C.text);
  g['D2 a link is the mined link colour'] =
    !!fx.buffer && near(fx.buffer.colors.link, C.link);
  g['D3 LEVEL resolves to the one named colour'] =
    !!ed.colors && near(ed.colors.level, C.level);
  g['D4 a bare hex value is taken as written'] =
    !!ed.colors && near(ed.colors.hex, '#00FFFF');
  g['D5 an unparsable name draws nothing (alpha 0)'] =
    !!ed.words && !ed.words.includes('white');
  const soup = new Set([].concat(...Object.values(fx).map(f => f.colorSoup || [])));
  const banned = ['rgb(201, 169, 89)', 'rgb(127, 179, 255)', 'rgb(207, 212, 222)'];
  g['D6 none of the three invented colours survives'] =
    !banned.some(b => soup.has(b));

  // E — the closed tag table
  // Unknown tags contribute NOTHING — not a box, not a break, not even a
  // space. The proof is the word sequence: `table</div><span>nor` must render
  // as two adjacent words. (Counting <span> elements would prove nothing here:
  // the renderer's own word boxes are spans.)
  const ew = ed.words || [];
  const at = ew.indexOf('table');
  g['E1 DIV/SPAN/STRONG produce no element'] = at >= 0
    && ew.slice(at, at + 5).join(' ') === 'table nor SPAN nor STRONG'
    && !!ed.rawTags && ed.rawTags.div === 0 && ed.rawTags.strong === 0;
  g['E2 BR1 is a break'] = !!fx.menu && fx.menu.brs >= 10;
  g['E3 TABLE/TR/TD build a real table'] = !!fx.table
    && fx.table.tables === 2 && fx.table.rows === 3 && fx.table.cells === 6;
  g['E4 IMG resolves to a client texture'] = !!fx.menu
    && fx.menu.imgs.length >= 6
    && fx.menu.imgs.every(i => /SquareWhite/i.test(i.bg) && i.w === 270 && i.h === 1);

  // F — button art
  const btn = (fx.blkmrkt && fx.blkmrkt.buttons[0]) || null;
  g['F1 button paints a client texture'] = !!btn
    && /DefaultButton/i.test(btn.bg) && btn.bg !== 'none';
  g['F2 button art decodes'] = !!extra.buttonSprite && extra.buttonSprite.w > 0;
  g['F3 button label is the mined NCButton colour'] = !!btn
    && near(btn.label, extra.buttonLabelColor);

  // G — bypass
  g['G1 a link click sends the exact command'] =
    !!extra.clicked && extra.clicked === 'npc_1234_teleport_request';
  g['G2 $var is substituted from the page edit'] =
    extra.editBypass === 'npc_9012_SevenSigns 7 4242';

  // H — safety
  g['H1 server <script> does not execute'] = p.pwned === false;
  g['H2 no <img> element and no external request'] = !!ed.rawTags
    && ed.rawTags.img === 0 && ed.rawTags.script === 0 && ed.rawTags.iframe === 0
    && (extra.externalRequests || 0) === 0;

  return g;
}

async function run(mode) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1400,1300'],
  });
  const logs = [];
  let external = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1300 });
    page.on('console', m => logs.push(m.text()));
    page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
    page.on('request', (r) => {
      if (!r.url().startsWith('http://127.0.0.1:8083')
        && !r.url().startsWith('data:')) external++;
    });
    const url = mode === 'prefix' ? `${BASE}?mode=prefix` : BASE;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction('window.__npcHarness && window.__npcHarness.ready',
      { timeout: 30000 });
    if (mode === 'prefix') {
      // The pre-fix tree is its module AND its stylesheet: the web font, the
      // #c9a959 title and the #7fb3ff link lived in style.css, and the live
      // sheet no longer carries them. Replaying only the module would show a
      // 'before' that never existed. The old block is appended last so its
      // same-specificity rules win.
      await page.addStyleTag({ content: prefixCss() });
    }
    await sleep(600);

    const p = await probe(page);

    // gate B second half + F2
    const backCss = (p.fx.gatekeeper || Object.values(p.fx)[0] || {}).backImage;
    const sprite = await spriteLoads(page, backCss);
    const btnCss = ((p.fx.blkmrkt || {}).buttons || [])[0];
    const buttonSprite = btnCss ? await spriteLoads(page, btnCss.bg) : null;

    // the mined NCButton label colour, read the way the module reads it
    const buttonLabelColor = await page.evaluate(async () => {
      const { Layout } = await import('./js/ui/layout.js');
      return Layout.native('buttonLabel');
    });

    // G1 — click the gatekeeper's Teleport link
    const clicked = await page.evaluate(() => {
      const H = window.__npcHarness.dialogs.gatekeeper;
      if (!H) return null;
      const w = [...H.dialog.root.querySelectorAll('.l2h-w')]
        .find(e => e.dataset.t === 'Teleport');
      if (!w) return null;
      w.click();
      return H.bypass[H.bypass.length - 1] || null;
    });
    // G2 — type into the page's own <edit> and press its button
    const editBypass = await page.evaluate(() => {
      const H = window.__npcHarness.dialogs.blkmrkt;
      if (!H) return null;
      const inp = H.dialog.root.querySelector('.npc-edit');
      const btn = H.dialog.root.querySelector('.npc-btn');
      if (!inp || !btn) return null;
      inp.value = '4242';
      btn.click();
      return H.bypass[H.bypass.length - 1] || null;
    });

    fs.mkdirSync(OUT, { recursive: true });
    const shot = mode === 'prefix' ? 'npcdialog_before.png' : 'npcdialog_after.png';
    await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
    for (const name of ['gatekeeper', 'menu', 'blkmrkt']) {
      const el = await page.$(`.fx[data-fx="${name}"]`);
      if (el) {
        await el.screenshot({
          path: path.join(OUT, `npcdialog_${mode === 'prefix' ? 'before' : 'after'}_${name}.png`),
        });
      }
    }

    return {
      probe: p, logs,
      gates: gates(p, sprite, {
        buttonSprite, buttonLabelColor, clicked, editBypass,
        externalRequests: external,
      }),
      sprite, buttonSprite,
    };
  } finally {
    await browser.close();
  }
}

function report(title, g) {
  const fail = Object.entries(g).filter(([, v]) => !v).map(([k]) => k);
  console.log(`\n${title}`);
  for (const [k, v] of Object.entries(g)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
  return fail;
}

(async () => {
  const live = await run('live');
  const failed = report('=== live tree ===', live.gates);
  if (live.probe.error) console.log('harness error:', live.probe.error);

  let proveOk = true;
  if (PROVE) {
    // Materialize the pre-fix module beside the live one so the harness can
    // import it, run the identical gates, and require them to break.
    const src = execFileSync('git', ['-C', REPO, 'show',
      `${PREFIX_REV}:editor/world/js/ui/npcdialog.js`], { encoding: 'utf8' });
    fs.writeFileSync(PREFIX_MODULE, src);
    let before;
    try {
      before = await run('prefix');
    } finally {
      fs.unlinkSync(PREFIX_MODULE);
    }
    const stillPassing = Object.entries(before.gates)
      .filter(([k, v]) => v && live.gates[k]).map(([k]) => k);
    report(`=== pre-fix tree (${PREFIX_REV}) ===`, before.gates);
    // The proof: the gates that matter must be RED before and GREEN after.
    // Not every gate can flip — H1/H2 were already right — so the requirement
    // is named explicitly rather than "all of them".
    const mustBreak = [
      'A1 window is the mined rect',
      'A3 html frame is at the mined inset',
      'B2 background bitmap actually decodes',
      'C1 content carries no DOM text',
      'C2 every word is a glyph canvas',
      'D1 plain text is the mined default',
      'D2 a link is the mined link colour',
      'D3 LEVEL resolves to the one named colour',
      'D6 none of the three invented colours survives',
      'E1 DIV/SPAN/STRONG produce no element',
      'F1 button paints a client texture',
      'G2 $var is substituted from the page edit',
    ];
    const notBroken = mustBreak.filter(k => before.gates[k]);
    console.log('\n=== proof ===');
    console.log(`  ${notBroken.length === 0 ? 'PASS' : 'FAIL'}  every named gate is red`
      + ` on ${PREFIX_REV} and green now`
      + (notBroken.length ? `; still green before: ${notBroken.join(', ')}` : ''));
    console.log(`  (gates green in both trees: ${stillPassing.length} — `
      + `${stillPassing.join(', ') || 'none'})`);
    proveOk = notBroken.length === 0;
  }

  const ok = failed.length === 0 && proveOk;
  console.log(`\nCHECK ${ok ? 'PASS' : 'FAIL'}`
    + (failed.length ? ` (${failed.length} gate(s) red: ${failed.join(', ')})` : ''));
  console.log(`shots  ${OUT}`);
  process.stdout.write('', () => process.exit((CHECK || PROVE) && !ok ? 1 : 0));
})().catch((e) => {
  console.error('VERIFY NPCDIALOG FAILED:', e.stack || e.message);
  process.exit(1);
});
