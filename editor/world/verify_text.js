#!/usr/bin/env node
//
// verify_text.js -- glyph metrics and text colours for the retail UI font.
//
//   node verify_text.js            report
//   node verify_text.js --check    verify, exit nonzero on regression
//
// Everything here is read from client data. No metric, colour or channel in
// this file is authored; each check names the file it decoded.
//
// The four gates:
//
//   A  GLY METRICS      editor/world/ui/font.json must still agree, glyph for
//                       glyph, with assets/interlude/system/*.gly. Catches a
//                       stale manifest after a rebuild.
//
//   B  COVERAGE CHANNEL The sheets are paletted: SmallFont-e has 3 texel
//                       classes, LargeFont-e has 4. In BOTH, the glyph core is
//                       white/opaque and every other class is a DARK OUTLINE
//                       carried in ALPHA. Retail coverage is therefore the
//                       alpha channel and retail colour is the texel RGB.
//                       ui/font.js currently derives coverage from RGB
//                       luminance, which is 255 only on the core and 0 on
//                       every outline level -- so the outline is dropped.
//                       This gate measures the coverage mass actually kept.
//
//   C  TEXT COLOURS     Every colour literal handed to Font.set/Font.canvas
//                       must be attributable to a decoded client record:
//                       an Interface.xdat TextBox colour, a systemmsg-e.dat
//                       message colour, the NWindow.dll chat channel table, or
//                       assets/gamedata/native_colors.json (the colours
//                       NWindow.dll decides in code because no xdat record
//                       carries them -- button labels, item stack counts, and
//                       the TextBox default; see tools/ui/mine_native_colors.py).
//
//                       Anything else must carry an explicit AUTHORED
//                       admission attached to the value, and every file's
//                       AUTHORED count is budgeted so it can only shrink.
//                       The gate also enforces a FLOOR on the number of
//                       Layout.color/textColor/native lookups: a decode that
//                       nothing reads is not a fix, and a literal-counting
//                       gate would otherwise be satisfied by deleting text.
//
//   D  GLYPH RANGE      The -e sheets cover code points 32..126 only. A string
//                       containing anything else renders as a blank advance.
//
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = path.resolve(__dirname, '../..');
const SYSTEM = path.join(REPO, 'assets/interlude/system');
const GAMEDATA = path.join(REPO, 'assets/gamedata');
const STAGE = path.join(__dirname, 'ui/font');
const MANIFEST = path.join(__dirname, 'ui/font.json');
const JSROOT = path.join(__dirname, 'js');

const FONTS = {
  small: { gly: 'smallfont-e.gly', sheet: 'SmallFont-e.png' },
  large: { gly: 'largefont-e.gly', sheet: 'LargeFont-e.png' },
};

const failures = [];
const notes = [];
function fail(g, m) { failures.push(`${g}: ${m}`); }

// ---------------------------------------------------------------- PNG decode
// colorType 6 (RGBA), bitDepth 8, non-interlaced -- which is what both staged
// sheets are (asserted below). Kept dependency-free on purpose: this check has
// to run without the puppeteer/node_modules tree being present.
function decodePNG(file) {
  const d = fs.readFileSync(file);
  if (d.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  let o = 8, ihdr = null; const idat = [];
  while (o < d.length) {
    const len = d.readUInt32BE(o), typ = d.toString('ascii', o + 4, o + 8);
    if (typ === 'IHDR') {
      ihdr = {
        w: d.readUInt32BE(o + 8), h: d.readUInt32BE(o + 12),
        depth: d[o + 16], color: d[o + 17], interlace: d[o + 20],
      };
    } else if (typ === 'IDAT') idat.push(d.subarray(o + 8, o + 8 + len));
    o += 12 + len;
    if (typ === 'IEND') break;
  }
  if (!ihdr) throw new Error(`no IHDR: ${file}`);
  if (ihdr.depth !== 8 || ihdr.color !== 6 || ihdr.interlace !== 0) {
    throw new Error(`${path.basename(file)}: expected 8-bit RGBA non-interlaced, `
      + `got depth=${ihdr.depth} colorType=${ihdr.color} interlace=${ihdr.interlace}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { w, h } = ihdr, bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}

// The browser's canvas stores premultiplied RGBA, so getImageData returns RGB
// 0 wherever alpha is 0 -- SmallFont-e's grey field (RGB 51, alpha 0) reads
// back as black in the runtime but as grey via a plain file decode. Applying
// it here keeps this check measuring what ui/font.js actually sees.
function premultiplyClamp(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }
  }
  return img;
}

// ------------------------------------------------------------------ A: .gly
function parseGly(file) {
  const d = fs.readFileSync(file);
  const texWidth = d.readUInt32LE(0), texHeight = d.readUInt32LE(4);
  const pages = d.readUInt32LE(8), firstChar = d.readUInt32LE(12);
  const count = d.readUInt32LE(16);
  const need = 20 + count * 16;
  if (d.length < need) throw new Error(`${path.basename(file)}: truncated`);
  const glyphs = [];
  for (let i = 0; i < count; i++) {
    const o = 20 + i * 16;
    // record order is (x, width, y, height) -- note w and y are interleaved
    glyphs.push([d.readUInt32LE(o), d.readUInt32LE(o + 8),
      d.readUInt32LE(o + 4), d.readUInt32LE(o + 12)]);
  }
  return { texWidth, texHeight, pages, firstChar, count, glyphs };
}

function gateMetrics(manifest) {
  console.log('A  GLYPH METRICS   ui/font.json vs system/*.gly');
  for (const [name, spec] of Object.entries(FONTS)) {
    const g = parseGly(path.join(SYSTEM, spec.gly));
    const m = manifest[name];
    if (!m) { fail('A', `font.json has no "${name}"`); continue; }
    const png = decodePNG(path.join(STAGE, spec.sheet));

    const bad = [];
    if (m.texWidth !== g.texWidth || m.texHeight !== g.texHeight) {
      bad.push(`manifest ${m.texWidth}x${m.texHeight} vs gly ${g.texWidth}x${g.texHeight}`);
    }
    if (png.w !== g.texWidth || png.h !== g.texHeight) {
      bad.push(`sheet ${png.w}x${png.h} vs gly ${g.texWidth}x${g.texHeight}`);
    }
    if (m.firstChar !== g.firstChar) bad.push(`firstChar ${m.firstChar} vs ${g.firstChar}`);
    if (m.glyphs.length !== g.count) bad.push(`${m.glyphs.length} glyphs vs ${g.count}`);
    let mismatched = 0, oob = 0;
    for (let i = 0; i < Math.min(m.glyphs.length, g.count); i++) {
      const a = m.glyphs[i], b = g.glyphs[i];
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) mismatched++;
      if (b[0] + b[2] > g.texWidth || b[1] + b[3] > g.texHeight) oob++;
    }
    if (mismatched) bad.push(`${mismatched} glyph boxes differ from the .gly`);
    if (oob) bad.push(`${oob} glyph boxes fall outside the sheet`);
    const lh = Math.max(...g.glyphs.map(x => x[3]));
    if (m.lineHeight !== lh) bad.push(`lineHeight ${m.lineHeight} vs measured ${lh}`);

    console.log(`   ${name.padEnd(6)} ${String(g.texWidth) + 'x' + g.texHeight} `
      + `chars ${g.firstChar}..${g.firstChar + g.count - 1}  lineHeight ${lh}  `
      + (bad.length ? 'MISMATCH' : 'ok'));
    bad.forEach(b => fail('A', `${name}: ${b}`));
  }
}

// --------------------------------------------------- B: coverage channel
// Read back which channel ui/font.js turns into coverage. A safe failure: if
// the expression can no longer be recognised the gate reports that rather than
// assuming either answer.
// The per-texel loop inside tintedSheet() decides coverage. If it ASSIGNS the
// alpha lane (d[i + 3] = ...) it is substituting its own coverage -- from RGB
// luminance, which drops the outline. If it leaves alpha untouched, the
// sheet's own alpha survives and the outline is kept.
function coverageChannelInUse() {
  const src = fs.readFileSync(path.join(JSROOT, 'ui/font.js'), 'utf8');
  const loop = /for \(let i = 0; i < d\.length; i \+= 4\) \{([\s\S]*?)\n  \}/.exec(src);
  if (!loop) return { channel: 'unknown', expr: null };
  const body = loop[1];
  const assignsAlpha = /d\[i \+ 3\]\s*=/.test(body);
  const modulatesRGB = /d\[i\]\s*=\s*\(?\s*d\[i\]/.test(body);
  if (assignsAlpha) {
    const m = /d\[i \+ 3\]\s*=\s*([^;]+);/.exec(body);
    return {
      channel: 'luminance (alpha overwritten)',
      expr: m ? m[1].replace(/\s+/g, ' ').trim() : null,
      dropsOutline: true,
    };
  }
  if (modulatesRGB) {
    return { channel: 'alpha (sheet alpha preserved, RGB modulated)',
      expr: null, dropsOutline: false };
  }
  return { channel: 'unknown', expr: null };
}

function gateCoverage(manifest) {
  console.log('\nB  COVERAGE CHANNEL   glyph outline carried in alpha');
  const use = coverageChannelInUse();
  console.log(`   ui/font.js tint coverage = ${use.channel}`
    + (use.expr ? `   [${use.expr}]` : ''));
  if (use.channel === 'unknown') {
    fail('B', `cannot determine the coverage channel used by ui/font.js `
      + `-- the tintedSheet() texel loop did not match; re-check by hand`);
  }

  for (const [name, spec] of Object.entries(FONTS)) {
    const m = manifest[name];
    if (!m) continue;
    const img = premultiplyClamp(decodePNG(path.join(STAGE, spec.sheet)));
    const d = img.data;

    // texel classes inside the glyph band
    const classes = new Map();
    for (let y = 0; y < m.lineHeight; y++) {
      for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4;
        const lum = Math.max(d[i], d[i + 1], d[i + 2]);
        const key = `${lum}/${d[i + 3]}`;
        classes.set(key, (classes.get(key) || 0) + 1);
      }
    }
    // coverage mass inside the declared glyph boxes, both ways
    let byLum = 0, byAlpha = 0;
    for (const [gx, gy, gw, gh] of m.glyphs) {
      for (let y = gy; y < gy + gh; y++) {
        for (let x = gx; x < gx + gw; x++) {
          const i = (y * img.w + x) * 4;
          byLum += Math.max(d[i], d[i + 1], d[i + 2]);
          byAlpha += d[i + 3];
        }
      }
    }
    const kept = byAlpha ? (100 * byLum / byAlpha) : 100;
    const list = [...classes.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}(x${n})`).join(' ');
    console.log(`   ${name.padEnd(6)} texel classes lum/alpha: ${list}`);
    console.log(`          luminance-as-coverage keeps ${kept.toFixed(1)}% `
      + `of the alpha coverage mass`);

    // Retail's dark outline is exactly the set of texels with alpha > 0 and
    // luminance 0 (or well below alpha). If any such texel exists, coverage
    // taken from luminance necessarily drops it.
    let outlineTexels = 0;
    for (const [k, n] of classes) {
      const [lum, al] = k.split('/').map(Number);
      if (al > 0 && lum < al) outlineTexels += n;
    }
    if (outlineTexels && use.dropsOutline) {
      fail('B', `${name}: ${outlineTexels} outline texels (alpha > luminance) are `
        + `dropped because coverage comes from luminance; only ${kept.toFixed(1)}% `
        + `of retail coverage mass survives`);
    }
  }
}

// ------------------------------------------------------------ C: colours
function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
  if (node && typeof node === 'object') {
    fn(node);
    Object.values(node).forEach(v => walk(v, fn));
  }
}

function attributedColours() {
  const set = new Map(); // colour -> source
  const add = (c, src) => { if (c && !set.has(c.toUpperCase())) set.set(c.toUpperCase(), src); };

  // Colours NWindow.dll decides in code because no xdat record carries them:
  // a Button's label (352 Button records, none coloured), an item slot's
  // stack-count badge, and the fallback a TextBox uses when its own record
  // has no colour. Mined by tools/ui/mine_native_colors.py, which ships the
  // instruction site behind each value and re-reads the DLL under --check.
  const np = path.join(GAMEDATA, 'native_colors.json');
  if (fs.existsSync(np)) {
    const nat = JSON.parse(fs.readFileSync(np, 'utf8')).colors || {};
    for (const [k, v] of Object.entries(nat)) add(v.color, `NWindow.dll ${k}`);
  } else {
    notes.push('assets/gamedata/native_colors.json absent -- '
      + 'run python3 tools/ui/mine_native_colors.py --emit');
  }

  const ip = path.join(GAMEDATA, 'interface.json');
  if (fs.existsSync(ip)) {
    walk(JSON.parse(fs.readFileSync(ip, 'utf8')).windows, n => {
      if (n.type === 'TextBox' && n.color) add(n.color, 'Interface.xdat TextBox');
    });
  } else notes.push('assets/gamedata/interface.json absent -- run tools/xdat/parse_xdat.py');

  const sp = path.join(GAMEDATA, 'systemmsg.json');
  if (fs.existsSync(sp)) {
    const msgs = JSON.parse(fs.readFileSync(sp, 'utf8'));
    Object.values(msgs).forEach(m => add(m.color, 'systemmsg-e.dat'));
  } else notes.push('assets/gamedata/systemmsg.json absent');

  // chat.js carries the NWindow.dll say-type colour table with its address
  // cited in-file; treat those as attributed to the binary, not authored.
  const cp = path.join(JSROOT, 'chat.js');
  if (fs.existsSync(cp)) {
    const src = fs.readFileSync(cp, 'utf8');
    const block = /const CHANNELS = \{([\s\S]*?)\n\};/.exec(src);
    if (block) {
      for (const m of block[1].matchAll(/color:\s*'(#[0-9a-fA-F]{6})'/g)) {
        add(m[1], 'NWindow.dll chat table');
      }
    }
  }
  return set;
}

function jsFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// Colour literals that are ADMITTED inventions, per file. A literal counts as
// authored only when the word AUTHORED appears in its own trailing comment or
// in the contiguous // block directly above the Font call -- so the admission
// is attached to the value, not floating somewhere in the file.
//
// This budget may only SHRINK. It is not a licence: every entry below is a
// place where no Interface.xdat record and no NWindow.dll constant governs the
// control, and the comment at the site says which. Lower a number when a site
// is bound; never raise one.
const AUTHORED_BUDGET = {
  'js/ui/clanwnd.js': 2,          // ListCtrl column headers; per-row oust 'x'
  'js/ui/multisellwnd.js': 4,     // missing-icon '?' x2; shortfall/sufficiency tints
  'js/ui/partywnd.js': 3,         // member name, leader mark, per-row kick 'x'
  'js/ui/questwnd.js': 1,         // ListCtrl row text
  'js/ui/shopwnd.js': 1,          // missing-icon '?' placeholder
  'js/ui/skillwnd.js': 1,         // port-only footer
  'js/ui/statuswnd.js': 1,        // NameCtrl player name
  'js/ui/storewnd.js': 1,         // missing-icon '?' placeholder
  'js/ui/targetstatuswnd.js': 1,  // port-only close affordance
  'js/ui/tradewnd.js': 1,         // missing-icon '?' placeholder
  'js/ui/warehousewnd.js': 1,     // missing-icon '?' placeholder
  'js/ui/window.js': 1,           // the port's own title bar
};

// Wiring floor. The decode is useless if nothing reads it, and a gate that
// only counts literals can be satisfied by deleting text. This is the number
// of Layout.color/textColor/native call sites the client must not drop below.
const LAYOUT_COLOUR_CALLS_MIN = 40;

/** Colour literals that actually reach the bitmap font renderer -- i.e. that
 *  sit inside a Font.set(...) / Font.canvas(...) argument list, with the
 *  parens balanced so multi-line calls are covered.
 *
 *  The previous version of this gate accepted ANY line containing `color:`,
 *  which is not what its own header promises. That over-match reported three
 *  hits in main.js's character-select overlay -- an Object.assign(el.style,
 *  {...}) block on an element explicitly styled `system-ui, sans-serif`, which
 *  never touches Font at all. Those are CSS on a DOM node, not glyph tints. */
function fontColourSites(src) {
  const out = [];               // {colour, line, authored}
  const lines = src.split('\n');

  // A colour hoisted into a module constant is still a colour. Two real
  // escapes this closes, both found in the UI tree:
  //   const SUB_COLOR = '#b09b79';  ... Font.set(el, t, { color: SUB_COLOR })
  //   Font.set(el, t, { color: short ? SHORT_COLOR : '#9fb07a' })
  // The first hides the literal behind a name; the second hides it behind a
  // ternary, so it never sits directly after `color:`. Scanning the whole
  // argument list for quoted hex, plus resolving named constants, catches
  // both. Without this a file can "pass" by moving its literals up a scope.
  const consts = new Map();     // NAME -> {colour, line}
  const cre = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*'(#[0-9a-fA-F]{6})'\s*;/;
  lines.forEach((l, i) => {
    const c = cre.exec(l);
    if (c) consts.set(c[1], { colour: c[2].toUpperCase(), line: i + 1 });
  });

  const call = /Font\.(?:set|canvas)\s*\(/g;
  let m;
  while ((m = call.exec(src)) !== null) {
    // walk to the matching ')' so the whole argument list is in scope
    let i = m.index + m[0].length, depth = 1, q = null;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') q = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const body = src.slice(m.index, i);
    const startLine = src.slice(0, m.index).split('\n').length;

    // every quoted 6-digit hex anywhere in the argument list
    for (const c of body.matchAll(/'(#[0-9a-fA-F]{6})'/g)) {
      const line = startLine + body.slice(0, c.index).split('\n').length - 1;
      out.push({
        colour: c[1].toUpperCase(),
        line,
        authored: isAuthored(lines, startLine, line),
      });
    }

    // ...and every module constant that holds one and is named in the call
    for (const [name, k] of consts) {
      if (!new RegExp(`\\b${name}\\b`).test(body)) continue;
      out.push({
        colour: k.colour,
        line: k.line,
        via: name,
        // the admission may sit at the constant's declaration or at the use
        authored: isAuthored(lines, k.line, k.line)
          || isAuthored(lines, startLine, startLine),
      });
    }
    call.lastIndex = i;
  }
  return out;
}

/** The AUTHORED admission must be attached: on the literal's own line, on the
 *  Font call's first line, or in the unbroken // comment block above it. */
function isAuthored(lines, startLine, litLine) {
  const own = /\bAUTHORED\b/;
  if (own.test(lines[litLine - 1] || '')) return true;
  if (own.test(lines[startLine - 1] || '')) return true;
  for (let k = startLine - 2; k >= 0; k--) {
    const t = (lines[k] || '').trim();
    if (!t.startsWith('//')) break;
    if (own.test(t)) return true;
  }
  return false;
}

function gateColours() {
  console.log('\nC  TEXT COLOURS   Font.set/Font.canvas literals vs decoded records');
  const known = attributedColours();
  console.log(`   attributable palette: ${known.size} colours `
    + '(xdat + systemmsg + NWindow chat table + NWindow native colours)');

  const bad = new Map();        // colour -> [sites]     unmarked, unattributed
  const authored = new Map();   // file -> [{colour,line}]
  let attributedUses = 0;

  for (const f of jsFiles(JSROOT)) {
    const rel = path.relative(__dirname, f);
    const seen = new Set();
    for (const s of fontColourSites(fs.readFileSync(f, 'utf8'))) {
      if (s.via) {                       // a constant counts once per file
        if (seen.has(s.via)) continue;
        seen.add(s.via);
      }
      if (known.has(s.colour)) { attributedUses++; continue; }
      if (s.authored) {
        if (!authored.has(rel)) authored.set(rel, []);
        authored.get(rel).push(s);
        continue;
      }
      if (!bad.has(s.colour)) bad.set(s.colour, []);
      bad.get(s.colour).push(`${rel}:${s.line}`);
    }
  }

  const authoredTotal = [...authored.values()].reduce((n, a) => n + a.length, 0);
  console.log(`   remaining literals: ${attributedUses} match a decoded colour, `
    + `${authoredTotal} admitted AUTHORED, ${[...bad.values()]
      .reduce((n, a) => n + a.length, 0)} unsourced. `
    + '(A literal that merely MATCHES a decoded colour is still a literal -- '
    + 'the bound sites are the Layout lookups counted below.)');

  // -- unsourced: the hard failure ----------------------------------------
  for (const [c, sites] of [...bad.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     UNSOURCED ${c}  x${String(sites.length).padStart(2)}  `
      + sites.join(', '));
    fail('C', `${c} x${sites.length} matches no Interface.xdat / systemmsg / `
      + `NWindow record and carries no AUTHORED admission (${sites.join(', ')})`);
  }

  // -- authored: allowed, listed, and budgeted so it can only shrink ------
  for (const [rel, hits] of [...authored.entries()].sort()) {
    const budget = AUTHORED_BUDGET[rel];
    const mark = budget == null ? 'UNBUDGETED' : (hits.length > budget ? 'GREW' : 'ok');
    console.log(`     AUTHORED  ${rel}  ${hits.length}`
      + (budget == null ? '' : `/${budget}`) + `  ${mark}  `
      + hits.map(h => `${h.colour}@${h.line}`).join(' '));
    if (budget == null) {
      fail('C', `${rel} admits ${hits.length} AUTHORED colour literal(s) but has `
        + `no entry in AUTHORED_BUDGET -- add one, at this count, deliberately`);
    } else if (hits.length > budget) {
      fail('C', `${rel} AUTHORED colour literals grew ${budget} -> ${hits.length}; `
        + `this budget may only shrink`);
    }
  }
  for (const [rel, budget] of Object.entries(AUTHORED_BUDGET)) {
    const have = (authored.get(rel) || []).length;
    if (have < budget) {
      notes.push(`AUTHORED_BUDGET['${rel}'] is ${budget} but only ${have} remain `
        + `-- lower it to ${have} to lock the gain in`);
    }
  }

  // -- wiring: the decode has to be READ, not merely present --------------
  let calls = 0;
  const wire = /Layout\.(?:color|textColor|native)\s*\(/g;
  for (const f of jsFiles(JSROOT)) {
    calls += (fs.readFileSync(f, 'utf8').match(wire) || []).length;
  }
  console.log(`   Layout.color/textColor/native call sites: ${calls} `
    + `(floor ${LAYOUT_COLOUR_CALLS_MIN})`);
  if (calls < LAYOUT_COLOUR_CALLS_MIN) {
    fail('C', `only ${calls} Layout colour lookups remain, below the floor of `
      + `${LAYOUT_COLOUR_CALLS_MIN} -- text colours are being deleted or `
      + `re-hard-coded rather than bound`);
  }
}

// -------------------------------------------------------- D: glyph range
function gateRange(manifest) {
  console.log('\nD  GLYPH RANGE   literals must stay inside the sheet');
  const lo = Math.min(...Object.values(manifest).map(f => f.firstChar));
  const hi = Math.max(...Object.values(manifest)
    .map(f => f.firstChar + f.glyphs.length - 1));
  console.log(`   sheets cover code points ${lo}..${hi}`);
  const re = /Font\.(?:set|canvas)\([^,]+,\s*'([^']*)'/g;
  const bad = new Map();
  for (const f of jsFiles(JSROOT)) {
    const rel = path.relative(__dirname, f);
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      for (const m of l.matchAll(re)) {
        for (const ch of m[1]) {
          const cp = ch.codePointAt(0);
          if (cp < lo || cp > hi) {
            const k = `U+${cp.toString(16).toUpperCase().padStart(4, '0')} '${ch}'`;
            if (!bad.has(k)) bad.set(k, []);
            bad.get(k).push(`${rel}:${i + 1}`);
          }
        }
      }
    });
  }
  for (const [k, sites] of bad) {
    console.log(`     ${k}  x${sites.length}  ${sites[0]}`);
    fail('D', `${k} is outside the sheet and renders as a blank advance `
      + `(${sites.length} site(s), e.g. ${sites[0]})`);
  }
  if (!bad.size) console.log('     all literals inside range');
}

// ------------------------------------------------------------------- main
function main() {
  const check = process.argv.includes('--check');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  gateMetrics(manifest);
  gateCoverage(manifest);
  gateColours();
  gateRange(manifest);

  if (notes.length) {
    console.log('\nNOTES');
    notes.forEach(n => console.log('   ' + n));
  }
  console.log('');
  if (failures.length) {
    console.log(`CHECK FAIL (${failures.length})`);
    failures.forEach(f => console.log('   ' + f));
    return check ? 1 : 0;
  }
  console.log('CHECK PASS');
  return 0;
}

process.exit(main());
