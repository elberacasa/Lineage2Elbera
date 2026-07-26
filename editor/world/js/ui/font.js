// ElberaSkin runtime — the client's own bitmap font, rendered in the browser.
//
// Interlude draws every UI string with SmallFont / LargeFont: a glyph sheet
// in the l2font packages plus per-glyph boxes in system/*.gly. Both are
// staged by tools/ui/build_font.py; this module blits from them.
//
// Text is composited into a canvas rather than set as DOM text, because
// there is no TTF to fall back on — the glyphs only exist as pixels. Colour
// comes from a 'source-in' tint pass over the alpha, which is how the client
// recolours the same white glyphs per chat channel.
//
//   await Font.load()
//   Font.measure('Talking Island', 'small')      -> retail px width
//   Font.canvas('Talking Island', {color})       -> HTMLCanvasElement
//   Font.canvas(name, {shadow:true})             -> with the 1px drop shadow
//                                                   the HUD uses over the 3D
//                                                   scene (off inside windows)
//   Font.set(el, 'Talking Island', {color})      -> replaces el's content

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
 *  Coverage comes from RGB LUMINANCE, not from the alpha channel. Both
 *  exported sheets are clean intensity maps -- black field, white glyphs --
 *  but their alpha carries a pedestal (LargeFont-e's background sits at
 *  alpha 34, not 0). Tinting through that alpha paints a visible box around
 *  every glyph cell. Same family of trap as the `_sp` textures in
 *  docs/HANDOFF.md: the channel is not what its name suggests.
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
    // luminance of the intensity map becomes coverage
    const a = Math.max(d[i], d[i + 1], d[i + 2]);
    d[i] = tr; d[i + 1] = tg; d[i + 2] = tb; d[i + 3] = a;
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
