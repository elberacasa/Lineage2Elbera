// ElberaSkin runtime — paints DOM with the retail L2 UI art.
//
// Every sprite here comes out of the client's own l2ui / L2UI_CH3 packages,
// staged by tools/ui/build_uiskin.py from the texture references decoded out
// of Interface.xdat. Nothing is drawn that the retail UI does not draw.
//
// Geometry is always expressed in RETAIL PIXELS. The skin multiplies by
// Skin.scale on the way to CSS, so the layout stays byte-identical to the
// xdat while the client renders larger than 2004's 1024x768.
//
//   Skin.px(n)                    retail px -> css px
//   Skin.apply(el, ref)           paint one sprite, sized to its true pixels
//   Skin.hstrip(el, l, m, r)      3-part horizontal frame (the retail idiom)
//   Skin.nine(el, ref, insets)    9-slice via border-image
//   Skin.gauge(el, fill, back)    a StatusBar: back plate + clipped fill

const MANIFEST = '/ui/skin.json';
const SPRITE_DIR = '/ui/skin/';

let _sprites = null;
let _srcScale = 1;      // 1 when staged 1x, 4 after `build_uiskin.py --hd`

export const Skin = {
  // UI magnification. DEFAULT 1 = pixel-perfect retail.
  //
  // The retail UI does not scale with resolution: a window is the same
  // PHYSICAL pixel size at 800x600 as at 1600x1200. Verified in the client --
  // of 142 window classes only 2 use SetWindowSizeRel (both full-screen
  // overlays), while 28 position absolutely. So any scale above 1 makes the
  // HUD proportionally larger than retail ever was.
  //
  // ?uiScale=N overrides it for readability on high-DPI displays; that is a
  // deliberate deviation, not the reference.
  scale: Number(new URLSearchParams(location.search).get('uiScale')) || 1,

  async load() {
    if (_sprites) return Skin;
    const doc = await fetch(MANIFEST).then(r => r.json());
    _sprites = doc.sprites || {};
    _srcScale = doc.scale || 1;
    return Skin;
  },

  get ready() { return _sprites !== null; },

  /** Sprite record {file, w, h} in retail pixels, or null if the xdat never
   *  referenced it / the library never exported it. */
  sprite(ref) {
    return (_sprites && _sprites[ref]) || null;
  },

  px(n) { return n * Skin.scale; },

  /** The sprite's MEASURED art rect inside its padded export, {x,y,w,h}.
   *  build_uiskin.py records this because umodel pads every export to a
   *  power of two, so the file size is not the art size. Falls back to the
   *  full file when the measurement is unavailable. */
  content(ref) {
    const s = Skin.sprite(ref);
    if (!s) return null;
    return (s.cw != null)
      ? { x: s.cx, y: s.cy, w: s.cw, h: s.ch }
      : { x: 0, y: 0, w: s.w, h: s.h };
  },

  url(ref) {
    const s = Skin.sprite(ref);
    return s ? `url("${SPRITE_DIR}${s.file}")` : 'none';
  },

  /** Paint `ref` as el's background.
   *
   *  `content` is the sprite's TRUE content rect in retail pixels, as given
   *  by the xdat. It matters because umodel pads every export to a power of
   *  two: StatusWndLeftTex is 16x84 of art inside a 16x128 PNG. Stretching
   *  the padded file puts 44 rows of empty padding inside the window. Across
   *  the decoded tree 533 of 583 textured controls are padded this way, so
   *  callers should pass `content` whenever the xdat gives a size.
   */
  apply(el, ref, { stretch = false, content = null } = {}) {
    const s = Skin.sprite(ref);
    if (!s) { el.style.background = 'none'; return false; }
    el.style.backgroundImage = Skin.url(ref);
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = '0 0';
    // Default to the MEASURED content rect so a padded export never leaks
    // its empty margin into the element. Callers may still override.
    const c = content || (s.cw != null
      ? { w: s.cw, h: s.ch } : null);
    if (c && c.w && c.h) {
      // scale so the content rect — not the padded file — fills the element
      el.style.backgroundSize =
        `${(s.w / c.w) * 100}% ${(s.h / c.h) * 100}%`;
    } else {
      el.style.backgroundSize = stretch
        ? '100% 100%'
        : `${Skin.px(s.w)}px ${Skin.px(s.h)}px`;
    }
    // 1x art blown up must stay crisp; 4x HD art should filter smoothly
    el.style.imageRendering = _srcScale > 1 ? 'auto' : 'pixelated';
    return true;
  },

  /** The retail window idiom: fixed-width left and right caps with a middle
   *  that stretches. StatusWnd, MenuWnd and the chat frame are all built
   *  this way (see Interface.xdat). */
  hstrip(el, leftRef, midRef, rightRef) {
    const l = Skin.sprite(leftRef), m = Skin.sprite(midRef), r = Skin.sprite(rightRef);
    if (!l || !m || !r) return false;
    el.style.backgroundImage = [Skin.url(leftRef), Skin.url(midRef), Skin.url(rightRef)].join(', ');
    el.style.backgroundRepeat = 'no-repeat, repeat-x, no-repeat';
    el.style.backgroundPosition = 'left top, ' +
      `${Skin.px(l.w)}px top, right top`;
    el.style.backgroundSize =
      `${Skin.px(l.w)}px ${Skin.px(l.h)}px, ` +
      `${Skin.px(m.w)}px ${Skin.px(m.h)}px, ` +
      `${Skin.px(r.w)}px ${Skin.px(r.h)}px`;
    el.style.imageRendering = _srcScale > 1 ? 'auto' : 'pixelated';
    return true;
  },

  /** 9-slice through border-image. `insets` are retail pixels. */
  nine(el, ref, insets) {
    const s = Skin.sprite(ref);
    if (!s) return false;
    const [t, r, b, l] = Array.isArray(insets)
      ? insets : [insets, insets, insets, insets];
    el.style.borderStyle = 'solid';
    el.style.borderWidth =
      `${Skin.px(t)}px ${Skin.px(r)}px ${Skin.px(b)}px ${Skin.px(l)}px`;
    el.style.borderImageSource = Skin.url(ref);
    el.style.borderImageSlice = `${t} ${r} ${b} ${l} fill`;
    el.style.borderImageRepeat = 'stretch';
    return true;
  },

  /** A retail StatusBar.
   *
   *  The gauge art is a narrow vertical tile -- every ps_*bar sprite is 8x16
   *  -- that the client stretches across the bar's width. So the width comes
   *  from the caller (the owning window's geometry), never from the sprite;
   *  only the height is the sprite's own. Returns a setter taking 0..1.
   */
  gauge(el, fillRef, backRef, { width, height } = {}) {
    const back = Skin.sprite(backRef), fillS = Skin.sprite(fillRef);
    const h = height ?? (fillS || back || { h: 16 }).h;
    if (width == null) {
      throw new Error('Skin.gauge: width is required (the sprite is a tile)');
    }

    // The fill child is absolutely positioned, so el must be a containing
    // block -- but do NOT clobber a caller that already placed this element.
    // Overwriting an author's `absolute` with `relative` drops the element
    // back into normal flow and makes its `top` a relative offset, which
    // stacks a column of gauges with a cumulative one-row drift.
    if (!el.style.position) el.style.position = 'relative';
    el.style.overflow = 'hidden';
    el.style.width = `${Skin.px(width)}px`;
    el.style.height = `${Skin.px(h)}px`;
    if (back) Skin.apply(el, backRef, { stretch: true });

    const fill = document.createElement('div');
    fill.style.position = 'absolute';
    fill.style.inset = '0';
    if (fillS) Skin.apply(fill, fillRef, { stretch: true });
    el.appendChild(fill);

    return (frac) => {
      const f = Math.max(0, Math.min(1, frac || 0));
      // clip rather than scale: the retail gauge reveals its texture, it
      // does not squash it
      fill.style.clipPath = `inset(0 ${(1 - f) * 100}% 0 0)`;
    };
  },
};
