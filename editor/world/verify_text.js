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
//                       message colour, or the NWindow.dll chat channel table.
//                       Anything else is authored.
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

function gateColours() {
  console.log('\nC  TEXT COLOURS   Font.set/Font.canvas literals vs decoded records');
  const known = attributedColours();
  console.log(`   attributable palette: ${known.size} colours `
    + `(xdat + systemmsg + NWindow chat table)`);

  const used = new Map(); // colour -> [sites]
  const re = /color:\s*'(#[0-9a-fA-F]{6})'/g;
  for (const f of jsFiles(JSROOT)) {
    const rel = path.relative(__dirname, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      // only colours that reach the bitmap font renderer
      if (!/Font\.(set|canvas)\(/.test(l) && !/color:/.test(l)) return;
      for (const m of l.matchAll(re)) {
        const c = m[1].toUpperCase();
        if (!used.has(c)) used.set(c, []);
        used.get(c).push(`${rel}:${i + 1}`);
      }
    });
  }

  const unattributed = [...used.entries()].filter(([c]) => !known.has(c))
    .sort((a, b) => b[1].length - a[1].length);
  const attributed = [...used.entries()].filter(([c]) => known.has(c));

  console.log(`   ${used.size} distinct literals: `
    + `${attributed.length} attributable, ${unattributed.length} NOT`);
  for (const [c, sites] of unattributed) {
    console.log(`     ${c}  x${String(sites.length).padStart(2)}  ${sites[0]}`
      + (sites.length > 1 ? ` (+${sites.length - 1} more)` : ''));
  }
  if (unattributed.length) {
    const total = unattributed.reduce((n, [, s]) => n + s.length, 0);
    fail('C', `${total} text-colour literals across ${unattributed.length} colours `
      + `match no Interface.xdat / systemmsg / NWindow record`);
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
