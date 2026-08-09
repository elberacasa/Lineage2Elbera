// ElberaSkin runtime — the client's own HTML viewer (NCHtmlViewer/NCHtmlFrame).
//
// The server sends HTML; the client renders it with a parser that is NOT a web
// browser. This module reproduces that parser rather than borrowing the
// browser's, because the two disagree in ways a player can see:
//
//   * The element table is CLOSED and it is 51 names long (mined:
//     assets/gamedata/npchtml.json, NWindow.dll 0x1034e9a8). `DIV`, `SPAN`,
//     `STRONG`, `EM`, `TH`, `TBODY` and `THEAD` are NOT in it — the client
//     treats them as UNKNOWN, i.e. as nothing. `BR1`, `BAR`, `SPIN`, `EXTEND`,
//     `TEXTCODE`, `MULTIEDIT` and `COMBOBOX` are.
//   * DOMParser applies HTML5 tree construction. It invents a `<tbody>`, it
//     foster-parents text out of a `<table>`, it auto-closes `<p>`, and it
//     swallows everything after an unknown non-void tag like `<br1>` into that
//     tag's subtree. The client does none of that: it is a linear tag scan
//     with a stack. So the tokenizer here is linear too.
//   * `&nbsp;` and 66 other named entities decode; `&apos;` and `&copy;` do
//     not (mined: NWindow.dll 0x1034ec10, 67 names, and those two are absent).
//
// Text is composited from the retail glyph sheets through Font.canvas — the
// client has no TTF, and its font carries a built-in dark outline that a web
// font cannot reproduce. Words are laid out as inline-blocks separated by a
// spacer of the sheet's own space advance, with <wbr> for the break
// opportunity, so wrapping happens at the retail glyph widths.
//
// Everything with a number in it comes from one of two mined files:
//   /gamedata/npchtml.json   tools/ui/mine_npchtml.py  (NWindow.dll)
//   /ui/htmlart.json         tools/ui/mine_htmlart.py  (client packages)
// A lookup that misses returns null and the caller degrades; nothing here
// substitutes an invented value.

import { Skin } from './skin.js';
import { Font } from './font.js';

const SPEC_URL = '/gamedata/npchtml.json';
const ART_URL = '/ui/htmlart.json';
const ART_DIR = '/ui/htmlart/';

let _spec = null;
let _art = null;
let _artIndex = null;     // 'package|leaf' (lower) -> sprite record

// Elements that never have a closing form, so the parser must not stack them.
//
// MEASURED, not assumed: across the 15,322 pages the shipped datapack sends,
// exactly ELEVEN element names ever appear in closing form —
//   a 16488, html 15320, body 15316, font 9684, td 3736, tr 1444,
//   table 573, center 543, title 55, p 5, head 1
// and every control below appears only in opening form. Stacking one of them
// is not a cosmetic error: an unclosed <edit> swallowed the <button> that
// follows it on seven_signs/blkmrkt_2.htm, because an <input> cannot have
// children. AUTHORED — the client carries this as a per-tag flag that the
// mined table does not include; this list is what the server data proves.
const VOID = new Set([
  'BR', 'BR1', 'IMG', 'INPUT', 'BAR', 'BUTTON', 'EDIT', 'MULTIEDIT',
  'COMBOBOX', 'SPIN', 'VOLUMN', 'EXTEND', 'TEXTCODE', 'TEXTAREA', 'VAR',
  'LI', 'OPTION', 'COMMENT',
]);

// Tags whose CONTENT never reaches the flow. HEAD and COMMENT are exactly
// what their names say; TITLE is metadata that the frame draws in its own
// title bar. AUTHORED — the client's parser carries this as a per-tag flag
// the mined record does not include.
const SILENT = new Set(['HEAD', 'COMMENT', 'TITLE']);

function indexArt() {
  _artIndex = new Map();
  for (const [ref, rec] of Object.entries((_art && _art.sprites) || {})) {
    const p = ref.split('.');
    _artIndex.set(`${p[0]}|${p[p.length - 1]}`.toLowerCase(), rec);
  }
}

export const NpcHtml = {
  async load() {
    if (_spec) return NpcHtml;
    _spec = await fetch(SPEC_URL).then(r => (r.ok ? r.json() : null)).catch(() => null);
    _art = await fetch(ART_URL).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!_spec) _spec = null;
    indexArt();
    return NpcHtml;
  },

  get ready() { return _spec !== null; },

  /** Tags that never have a closing form. */
  isVoid(name) { return VOID.has(String(name).toUpperCase()); },
  /** Tags whose content never reaches the flow. */
  isSilent(name) { return SILENT.has(String(name).toUpperCase()); },
  get spec() { return _spec; },

  /** The mined window record, or null when the harvest is absent. */
  get window() { return (_spec && _spec.window) || null; },

  /** Is this element name one the client's parser knows? */
  known(name) {
    return !!(_spec && _spec.tags
      && Object.prototype.hasOwnProperty.call(_spec.tags, String(name).toUpperCase()));
  },

  /** Attributes the client reads on `name`, or [] when it reads none. */
  attrsOf(name) {
    return (_spec && _spec.tags && _spec.tags[String(name).toUpperCase()]) || [];
  },

  /** NCHtmlObject::GetMatchedColor, exactly (NWindow.dll 0x100825d0).
   *
   *  null/empty -> 0.  A case-SENSITIVE match against the one name in the
   *  table -> that name's colour.  Anything else -> wcstoul("0xff" + s, 16),
   *  which is why `color="white"` is 0x000000FF (the parse stops at 'w') and
   *  `color="00FFFF"` is 0xFF00FFFF.  Returns the raw 0xAARRGGBB word.
   */
  matchedColor(s) {
    if (!_spec || s == null || s === '') return 0;
    const rule = _spec.colorRule || {};
    // The table holds exactly one name (NWindow.dll 0x100825d0 compares
    // against one wide string and no other), and the mined record keys it by
    // its role: colorRule.namedColor is the name, colors.level is its value.
    if (String(s) === rule.namedColor) {
      const lv = (_spec.colors && _spec.colors.level) || null;
      return lv ? ((0xff000000 | parseInt(lv.slice(1), 16)) >>> 0) : 0;
    }
    // wcstoul(str, NULL, 16) over "0xff" + s: leading 0x is consumed, then
    // hex digits until the first character that is not one.
    const text = `${rule.hexPrefix || '0xff'}${s}`;
    const m = /^0[xX]([0-9a-fA-F]*)/.exec(text);
    if (!m || !m[1]) return 0;
    // wcstoul saturates at ULONG_MAX; L2 colours never reach it, but a long
    // run of digits must not become NaN.
    return (parseInt(m[1].slice(-8), 16) >>> 0);
  },

  /** matchedColor as a CSS colour, or null when the word is fully
   *  transparent (alpha 0) — which is what `color="white"` produces and what
   *  the client would draw: nothing. */
  cssColor(s) {
    const w = NpcHtml.matchedColor(s);
    if (!w) return null;
    const a = (w >>> 24) & 0xff;
    const rgb = `#${(w & 0xffffff).toString(16).padStart(6, '0')}`;
    return a === 0xff ? rgb : (a === 0 ? null : `${rgb}${a.toString(16).padStart(2, '0')}`);
  },

  /** A client texture ref -> {file,w,h,cx,cy,cw,ch} or null.
   *
   *  Group and case are ignored on purpose: the same button is written
   *  `L2UI_ch3.Btn1_normal`, `L2UI_CH3.Btn1_normal` and `l2ui_ch3.smallbutton2`
   *  across the shipped datapack, and `Package.Name` with no group at all is
   *  the commonest form. The client resolves all of those to one texture.
   */
  art(ref) {
    if (!ref || !_artIndex) return null;
    const p = String(ref).split('.');
    // A client texture ref is Package.Name at minimum (the form 303 of the
    // datapack's own buttons use); anything with fewer parts names nothing.
    // AUTHORED as a shape test, not a measurement.
    if (p.length < 2) return null;
    return _artIndex.get(`${p[0]}|${p[p.length - 1]}`.toLowerCase()) || null;
  },

  artUrl(ref) {
    const s = NpcHtml.art(ref);
    return s ? `url("${ART_DIR}${s.file}")` : null;
  },

  /** Paint `ref` onto `el`, stretched to el's box (which is what NCButton
   *  does with a button whose width= differs from its texture). Returns false
   *  and leaves the element unpainted when the ref resolves to nothing. */
  paint(el, ref) {
    const s = NpcHtml.art(ref);
    if (!s) return false;
    el.style.backgroundImage = `url("${ART_DIR}${s.file}")`;
    el.style.backgroundRepeat = 'no-repeat';
    // umodel pads to a power of two, so scale by the MEASURED content rect.
    const cw = s.cw != null ? s.cw : s.w;
    const ch = s.ch != null ? s.ch : s.h;
    el.style.backgroundPosition = '0 0';
    el.style.backgroundSize = `${(s.w / cw) * 100}% ${(s.h / ch) * 100}%`;
    el.style.imageRendering = 'pixelated';
    return true;
  },

  // ---- tokenizer -----------------------------------------------------------

  /** Decode the 67 named entities the client knows, and only those. */
  entities(text) {
    const names = (_spec && _spec.entities) || [];
    if (!names.length) return text;
    return String(text).replace(/&([A-Za-z]+);/g, (all, name) => {
      if (!names.includes(name)) return all;   // &apos; / &copy; stay literal
      if (name === 'amp') return '&';
      if (name === 'lt') return '<';
      if (name === 'gt') return '>';
      if (name === 'quot') return '"';
      if (name === 'nbsp') return ' ';
      // The rest are the Latin-1 letters; the browser's own decoder gives the
      // same character for exactly these names.
      const probe = document.createElement('textarea');
      probe.innerHTML = all;
      return probe.value;
    });
  },

  /** Linear scan, the way the client's parser reads a page.
   *  -> [{t:'text', text} | {t:'open'|'close', name, attrs}] */
  tokenize(src) {
    const out = [];
    const s = String(src == null ? '' : src);
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { if (i < s.length) out.push({ t: 'text', text: s.slice(i) }); break; }
      if (lt > i) out.push({ t: 'text', text: s.slice(i, lt) });
      const gt = s.indexOf('>', lt);
      if (gt < 0) { out.push({ t: 'text', text: s.slice(lt) }); break; }
      const raw = s.slice(lt + 1, gt);
      i = gt + 1;
      if (!raw) continue;
      if (raw[0] === '!') continue;                 // <!-- --> and doctypes
      const close = raw[0] === '/';
      const body = close ? raw.slice(1) : raw;
      const nm = /^\s*([A-Za-z][A-Za-z0-9_]*)/.exec(body);
      if (!nm) continue;
      const name = nm[1].toUpperCase();
      if (close) { out.push({ t: 'close', name }); continue; }
      const attrs = {};
      const rest = body.slice(nm[0].length);
      const AT = /([A-Za-z][A-Za-z0-9_-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
      let m;
      while ((m = AT.exec(rest))) {
        if (!m[1]) break;
        const v = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : ''));
        attrs[m[1].toUpperCase()] = v;
      }
      out.push({ t: 'open', name, attrs });
    }
    return out;
  },

  // ---- text --------------------------------------------------------------

  /** One word, drawn from the retail glyph sheet.
   *
   *  AUTHORED, and re-checked 2026-08-09 rather than assumed: WHICH sheet.
   *  `<body>` carries DEFFONT / DEFFIXEDFONT in the client's own tag table, so
   *  the frame plainly has a default — but no font NAME is an immediate at any
   *  site in NWindow.dll, and a scan of every wide string in the image
   *  containing "font" turns up the tag names, the XML accessors and four
   *  L2Font TEXTURES, and no `SmallFont` / `LargeFont` at all. So the sheet is
   *  ours. It is the small one because that is what the body text of a retail
   *  NPC page measures at; the value that would settle it was not found.
   */
  word(text, color) {
    const span = document.createElement('span');
    span.className = 'l2h-w';
    span.appendChild(Font.canvas(text, { font: 'small', color }));
    return span;
  },

  /** The sheet's own space advance, in retail pixels. */
  get spaceWidth() {
    const g = Font.glyph ? Font.glyph('small', ' ') : null;
    // +1 is Font.measure's inter-glyph advance, applied here for the same
    // reason: a space between two words costs its glyph plus that advance.
    return g ? g.w + 1 : Font.measure(' ', 'small') + 1;
  },

  get lineHeight() { return Font.lineHeight('small'); },

  /** Whitespace inside one text run, the way the pages are authored.
   *
   *  A source line break is FORMATTING, not a space. The evidence is in the
   *  datapack itself: pages that want a space next to a tag write one
   *  (`AutoLoot: activado <a ...>`) or force one with `&nbsp;`
   *  (mods/buffer/50002.htm writes `hear&nbsp;<font>my story</font>&nbsp;?`),
   *  and nearly every page in the set puts its text on the line AFTER a
   *  `<br>`. Rendering those line breaks as spaces indents the first word of
   *  almost every line of almost every NPC page by one space.
   *
   *  INFERENCE from that: a whitespace run that contains a line break and sits
   *  at the START or END of a text run contributes nothing, and one in the
   *  MIDDLE collapses to a single space so a sentence split across two source
   *  lines still has its word gap. The client's own rule was not decoded.
   */
  runWhitespace(raw) {
    return String(raw)
      .replace(/^[ \t]*[\r\n]+[ \t\r\n]*/, '')
      .replace(/[ \t]*[\r\n]+[ \t\r\n]*$/, '')
      .replace(/[\r\n\t]+/g, ' ');
  },
};
