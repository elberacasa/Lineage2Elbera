// ElberaSkin runtime — the client's own bitmap font, rendered in the browser.
//
// Interlude draws every UI string with SmallFont / LargeFont: a glyph sheet
// in the l2font packages plus per-glyph boxes in system/*.gly. Both are
// staged by tools/ui/build_font.py; this module blits from them.
//
// Text is composited into a canvas rather than set as DOM text, because
// there is no TTF to fall back on — the glyphs only exist as pixels. Colour
// comes from modulating each texel by the text colour and compositing through
// the sheet's own alpha, which keeps the font's built-in dark outline dark
// while the glyph core takes the colour (see tintedSheet below).
//
//   await Font.load()
//   Font.measure('Talking Island', 'small')      -> retail px width
//   Font.canvas('Talking Island', {color})       -> HTMLCanvasElement
//   Font.set(el, 'Talking Island', {color})      -> replaces el's content
//
// `shadow:true` additionally stamps a 1px black offset copy. It has NO
// callers, and the sheets carry their own outline, so it would now double up;
// left in place only so the option keeps working if something calls it.

import { Skin } from './skin.js';

const MANIFEST = '/ui/font.json';
const SHEET_DIR = '/ui/font/';

let _fonts = null;
const _sheets = new Map();      // font name -> HTMLImageElement
const _tinted = new Map();      // `${font}|${color}` -> tinted sheet canvas

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cannot load ' + src));
    img.src = src;
  });
}

/** Pre-tint the whole sheet once; per-glyph blits are then plain copies.
 *
 *  These sheets are PALETTED, and the palette is tiny -- verified by counting
 *  distinct (luminance, alpha) texel classes inside the glyph band
 *  (editor/world/verify_text.js, gate B):
 *
 *    SmallFont-e   0/0        49/119     255/255                (3 classes)
 *    LargeFont-e   0/34       0/102      0/238      255/255     (4 classes)
 *
 *  Read that table: the glyph CORE is white and opaque (255/255); every other
 *  class is DARK (luminance 0, or 49) at a PARTIAL alpha. Those are the
 *  retail font's built-in dark OUTLINE, stepped over two or three levels.
 *  So coverage is the ALPHA channel and colour is the texel's own RGB
 *  modulated by the text colour -- core takes the full colour, outline stays
 *  dark. That is a plain UE2 DrawTile modulate, not an invented model.
 *
 *  This replaces coverage = max(R,G,B). Luminance is 255 only on the core and
 *  0 on every outline level, so it dropped the outline entirely: measured at
 *  78.1% of retail coverage mass surviving for SmallFont and just 26.8% for
 *  LargeFont. The old comment justified luminance with a real measurement --
 *  LargeFont-e's alpha field really does sit at 34, not 0 -- but inferred from
 *  it that alpha could not be coverage anywhere, which was never tested.
 *
 *  DOCUMENTED GAP: that 34 is both the outermost outline step and the
 *  palette's clear colour, so drawing a glyph box faithfully lays down a
 *  ~13%-black tint at the box edge. Whether retail shows that is UNVERIFIED --
 *  it needs a screenshot of LargeFont text over a light background. The value
 *  is used exactly as the texture ships it rather than rescaled, because
 *  rescaling would be inventing a number.
 */
function tintedSheet(name, color) {
  const key = `${name}|${color}`;
  if (_tinted.has(key)) return _tinted.get(key);
  const f = _fonts[name];
  const img = _sheets.get(name);
  const c = document.createElement('canvas');
  c.width = f.texWidth;
  c.height = f.texHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  const tint = document.createElement('canvas').getContext('2d');
  tint.fillStyle = color;
  tint.fillRect(0, 0, 1, 1);
  const [tr, tg, tb] = tint.getImageData(0, 0, 1, 1).data;

  for (let i = 0; i < d.length; i += 4) {
    // modulate the texel by the text colour; alpha carries the coverage,
    // outline included
    d[i] = (d[i] * tr) / 255;
    d[i + 1] = (d[i + 1] * tg) / 255;
    d[i + 2] = (d[i + 2] * tb) / 255;
  }
  ctx.putImageData(px, 0, 0);

  _tinted.set(key, c);
  return c;
}

export const Font = {
  async load() {
    if (_fonts) return Font;
    _fonts = await fetch(MANIFEST).then(r => r.json());
    await Promise.all(Object.entries(_fonts).map(async ([name, f]) => {
      _sheets.set(name, await loadImage(SHEET_DIR + f.sheet));
    }));
    return Font;
  },

  get ready() { return _fonts !== null; },

  has(name) { return !!(_fonts && _fonts[name]); },

  lineHeight(name = 'small') {
    return _fonts && _fonts[name] ? _fonts[name].lineHeight : 0;
  },

  glyph(name, ch) {
    const f = _fonts && _fonts[name];
    if (!f) return null;
    const i = ch.charCodeAt(0) - f.firstChar;
    const g = f.glyphs[i];
    return g ? { x: g[0], y: g[1], w: g[2], h: g[3] } : null;
  },

  /** Width in retail pixels. Unknown glyphs fall back to the space advance,
   *  which is what the client does with anything outside the sheet. */
  measure(text, name = 'small') {
    const f = _fonts && _fonts[name];
    if (!f) return 0;
    const space = Font.glyph(name, ' ');
    let w = 0;
    for (const ch of String(text)) {
      const g = Font.glyph(name, ch);
      w += (g ? g.w : (space ? space.w : 0)) + 1;   // 1px inter-glyph advance
    }
    return Math.max(0, w - 1);
  },

  /** Render to a canvas already scaled by Skin.scale, ready to drop in the
   *  DOM. `shadow` draws the 1px black offset the retail HUD uses over the
   *  3D scene. */
  canvas(text, { font = 'small', color = '#ffffff', shadow = false } = {}) {
    const f = _fonts && _fonts[font];
    const c = document.createElement('canvas');
    if (!f) return c;

    const s = Skin.scale;
    const w = Font.measure(text, font);
    const pad = shadow ? 1 : 0;
    c.width = Math.max(1, (w + pad) * s);
    c.height = (f.lineHeight + pad) * s;
    c.style.width = `${(w + pad)}px`;
    c.style.height = `${(f.lineHeight + pad)}px`;

    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.scale(s, s);

    const draw = (sheet, dx, dy) => {
      let x = dx;
      for (const ch of String(text)) {
        const g = Font.glyph(font, ch);
        if (g && g.w > 0) {
          ctx.drawImage(sheet, g.x, g.y, g.w, g.h, x, dy, g.w, g.h);
          x += g.w + 1;
        } else {
          const sp = Font.glyph(font, ' ');
          x += (sp ? sp.w : 3) + 1;
        }
      }
    };

    if (shadow) draw(tintedSheet(font, '#000000'), 1, 1);
    draw(tintedSheet(font, color), 0, 0);
    return c;
  },

  /** Replace el's contents with rendered text. Cheap no-op when unchanged. */
  set(el, text, opts = {}) {
    const key = `${text}|${opts.font || 'small'}|${opts.color || '#fff'}`
      + `|${opts.shadow ? 's' : ''}`;
    if (el.__l2text === key) return;
    el.__l2text = key;
    el.replaceChildren(Font.canvas(text, opts));
  },
};
