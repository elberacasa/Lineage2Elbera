// Phase C.1 — StatusWnd, the player status window.
//
// Replaces the invented `#self-status` pill (a centered rounded rectangle
// with CSS-gradient bars) with the retail window: three-part background
// strip, level box, character name, and the CP / HP / MP / EXP gauges
// painted with the client's own ps_*bar art.
//
// RESIZING. In retail this window is width-adjustable with a FIXED height,
// dragged by the grip on its right edge. The xdat corroborates that on two
// counts: StatusWndRightTex is a 4px-wide strip whose texture is literally
// `ps_sizecontrol1`, and every StatusBar child carries hasSize == 0 — their
// width is not stored because the client derives it from the window width at
// runtime, while their height is constant. So width here is state (persisted
// per browser) and height is always the xdat's 84.
//
// Geometry comes from Interface.xdat via Layout, or from a sprite's true
// pixel size. Deviations are marked inline.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';

const WND = 'StatusWnd';
const STORE = 'l2vzla.statuswnd.width';

// Gauge stack in the order the retail window draws them; each StatusBar
// names its own back plate and fill in the xdat.
const BARS = [
  { key: 'cp', ctrl: 'CPBar' },
  { key: 'hp', ctrl: 'HPBar' },
  { key: 'mp', ctrl: 'MPBar' },
  { key: 'exp', ctrl: 'EXPBar' },
];

// Gauge row height: MEASURED from the bar art (ps_hpbar_back is 8x12 of art
// inside an 8x16 export), not eyeballed.
const ROW_REF = 'L2UI_CH3.PlayerStatusWnd.ps_hpbar_back';
// INSET is only a fallback now: every control in this window (bands, level
// box, name and the four gauges) decodes its own x/y out of the xdat
// (docs/ui-mined-values.md §3, docs/xdat-tail-has0.md §4).
const INSET = 4;

// The gauge label, SOURCED from the native control that draws it:
// NWindow.dll NCStatusBarCtrl render (RTTI .?AVNCStatusBarCtrl@@ at
// 0x1034c8d0 -> vtable 0x102412a4, slot 99 -> 0x1004c7c0).
//
//   0x1004c9f8  mov 0x35c(esi),eax / test / jne 0x1004cb5f   <- mode switch
//   mode 0  draws  current, "/", max        (three FString::Format calls,
//           formats "%d" @0x10233718 and "/" @0x1023d810)
//   mode 1  draws  (cur-base)/(max-base)*100 with "%.2f%s" @0x1024128c and
//           the suffix "%" @0x1024129c   (x100 double @0x10234778)
//   both    push colour 0xFFDCDCDC (#DCDCDC) at 0x1004ca18 / 0x1004ca65 /
//           0x1004cad3 / 0x1004cc06, and centre on the bar:
//           flds 0x88(esi) (bar width) * 0.5 (@0x1022f270) - textWidth/2.
//
// StatusWnd.uc drives CP/HP/MP through SetPoint (mode 0 -> "cur/max") and
// EXP through SetPointExp (mode 1 -> "nn.nn%"), which is why the exp gauge
// reads as a percentage and the other three as a pair.
const LABEL_COLOR = '#DCDCDC';

// StatusWnd.uc drives the EXP gauge with SetPointExp(curExp, level): the
// client receives ABSOLUTE exp and derives the fraction itself from the level
// thresholds. Same table, same arithmetic, exported from the server's own
// playerLevels.xml by tools/dat/export_playerlevels.py.
let _expTable = null;

export function loadExpTable() {
  if (_expTable) return Promise.resolve(_expTable);
  return fetch('/gamedata/playerlevels.json')
    .then(r => (r.ok ? r.json() : null))
    .then(d => (_expTable = (d && d.requiredExpToLevelUp) || {}))
    .catch(() => (_expTable = {}));
}

/** Fraction of the way from `level` to `level + 1`, or null if unknown.
 *  Exported because DetailStatusWnd needs the SAME arithmetic: its .uc feeds
 *  the exp gauge GetPlayerEXPRate() — the identical rate this computes — and
 *  prints it with a '%'. Two copies of a formula is how they drift apart. */
export function expFraction(exp, level) {
  if (!_expTable || exp == null || !level) return null;
  const cur = _expTable[String(level)];
  const next = _expTable[String(level + 1)];
  if (cur == null || next == null || next <= cur) return null;
  return Math.max(0, Math.min(1, (exp - cur) / (next - cur)));
}

function barTextures(ctrl) {
  const refs = Layout.tex(WND, ctrl).filter(r => Skin.sprite(r));
  const back = refs.find(r => /back/i.test(r)) || refs[0] || null;
  const fill = refs.find(r => r !== back && !/warn/i.test(r)) || back;
  return { fill, back, warn: refs.find(r => /warn/i.test(r)) || null };
}

export class StatusWnd {
  constructor(parent = document.body) {
    const def = Layout.window(WND);
    this.defaultW = def && def.width ? def.width : 176;
    this.h = def && def.height ? def.height : 84;

    this.lSize = Layout.size(WND, 'StatusWndLeftTex') || { w: 16, h: this.h };
    this.rSize = Layout.size(WND, 'StatusWndRightTex') || { w: 4, h: this.h };
    this.lTex = Layout.tex0(WND, 'StatusWndLeftTex');
    this.rTex = Layout.tex0(WND, 'StatusWndRightTex');
    // MINED (docs/ui-mined-values.md §3): StatusWndLeftTex at (12,0),
    // StatusWnd_LevelTextBox_back at (15,6). Fallbacks keep the previous
    // AUTHORED offsets if the lookup ever fails.
    this.leftX = Layout.pos(WND, 'StatusWndLeftTex')?.x ?? 0;
    this.lvlPos = Layout.pos(WND, 'StatusWnd_LevelTextBox_back')
      ?? { x: INSET, y: INSET };

    // width is user state; height never changes
    this.minW = this.lSize.w + this.rSize.w + 60;
    this.maxW = 640;
    this.w = this._loadWidth();

    const root = document.createElement('div');
    root.id = 'l2-statuswnd';
    root.style.position = 'fixed';
    root.style.display = 'none';
    root.style.height = `${Skin.px(this.h)}px`;
    root.style.zIndex = '12';
    // the grip needs the pointer; everything else stays click-through
    root.style.pointerEvents = 'none';
    this.root = root;

    // --- background bands ---
    // All three bands name their own art in the xdat; the middle one
    // (Smallwindow2_back2) only became visible once the texture harvest was
    // fixed (tools/ui/mine_texrefs.py) — before that the port stretched the
    // LEFT cap across the gap, which is why the strip read as flat.
    // The band WIDTH comes from the has0 auto-size block
    // (docs/xdat-tail-has0.md): width = parent.width + insetA (-32 -> 144).
    this.cTex = Layout.tex0(WND, 'StatusWndCenterTex');
    this.bandL = this._band(this.lTex);
    this.bandC = this._band(this.cTex || this.lTex);
    this.bandR = this._band(this.rTex);
    this.centerInset = (Layout.autosize(WND, 'StatusWndCenterTex')
      || { insets: [0, 0] }).insets[0];

    // --- level box ---
    const lvlSize = Layout.size(WND, 'StatusWnd_LevelTextBox_back') || { w: 22, h: 20 };
    this.lvlSize = lvlSize;
    const lvl = document.createElement('div');
    lvl.style.cssText = 'position:absolute;display:flex;align-items:center;'
      + 'justify-content:center;';
    lvl.style.left = `${Skin.px(this.lvlPos.x)}px`;
    lvl.style.top = `${Skin.px(this.lvlPos.y)}px`;
    lvl.style.width = `${Skin.px(lvlSize.w)}px`;
    lvl.style.height = `${Skin.px(lvlSize.h)}px`;
    const lvlBack = Layout.tex0(WND, 'StatusWnd_LevelTextBox_back');
    if (lvlBack) Skin.apply(lvl, lvlBack, { content: lvlSize });
    root.appendChild(lvl);
    this.levelEl = lvl;

    // --- character name ---
    const name = document.createElement('div');
    name.style.position = 'absolute';
    // MINED (has0 decode): UserName at (40, 9) — replaces the AUTHORED offset.
    const namePos = Layout.pos(WND, 'UserName') ?? { x: INSET + lvlSize.w + 4, y: 6 };
    name.style.left = `${Skin.px(namePos.x)}px`;
    name.style.top = `${Skin.px(namePos.y)}px`;
    root.appendChild(name);
    this.nameEl = name;

    // --- gauge rows (fixed height, width follows the window) ---
    // Row height is the bar art's MEASURED height, not a chosen number:
    // ps_hpbar_back is 8x12 of art inside an 8x16 padded export.
    const rowArt = Skin.content(ROW_REF);
    const ROW_H = rowArt ? rowArt.h : 12;

    // MINED (has0 decode, docs/xdat-tail-has0.md §2 check 1): the four
    // gauges stack at x=16, y=27/41/55/69 (constant 14px pitch). Width
    // follows the auto-size rule width = parent.width + insetA (-26).
    this.rows = {};
    this.set = {};
    this.labels = {};
    for (const { key, ctrl } of BARS) {
      const { fill, back, warn } = barTextures(ctrl);
      const pos = Layout.pos(WND, ctrl) ?? { x: INSET, y: 4 + lvlSize.h + 3 };
      const row = document.createElement('div');
      row.style.position = 'absolute';
      row.style.left = `${Skin.px(pos.x)}px`;
      row.style.top = `${Skin.px(pos.y)}px`;
      root.appendChild(row);
      this.set[key] = Skin.gauge(row, fill, back,
                                 { width: this._gaugeW(), height: ROW_H });
      this.rows[key] = { el: row, fill, back, warn, frac: 0, pos };

      // The gauge label is a SIBLING of the bar, not a child: Skin.gauge
      // clips `el.lastElementChild` as the fill, so anything appended into
      // the gauge would be mistaken for it.
      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;display:flex;pointer-events:none;'
        + 'align-items:center;justify-content:center;';
      label.style.left = `${Skin.px(pos.x)}px`;
      label.style.top = `${Skin.px(pos.y)}px`;
      label.style.height = `${Skin.px(ROW_H)}px`;
      root.appendChild(label);
      this.labels[key] = label;
    }

    // --- resize grip: the right cap IS the size control ---
    this._makeResizable();

    parent.appendChild(root);
    this.setWidth(this.w);
    this.place();
    this.clear();
  }

  /** One background band, stretched over the full window height.
   *
   *  MEASURED: all three band sprites carry 76 rows of art inside their
   *  128-tall padded export (verified per-row on the staged PNGs:
   *  Smallwindow2_back1/back2 and ps_sizecontrol1 are opaque on rows 0..75,
   *  empty from 76). The xdat declares the controls 84 tall — the window
   *  height in both Interface.xdat and WindowsInfo.ini [StatusWnd] — so the
   *  client scales the 76px band into its 84px rect. Passing the DECLARED
   *  84 as the sprite's content rect (the old code) told the skin the art
   *  was already 84 tall and drew it at native size, leaving the bottom 8px
   *  of the window unpainted and the EXP gauge hanging outside the frame.
   *  Letting Skin.apply use the sprite's own measured rect fixes it. */
  _band(tex) {
    const d = document.createElement('div');
    d.style.position = 'absolute';
    d.style.top = '0';
    d.style.height = `${Skin.px(this.h)}px`;
    if (tex) Skin.apply(d, tex);
    this.root.appendChild(d);
    return d;
  }

  // data rule (has0 autosize): gauge width = parent.width + insetA
  _gaugeW() { return this.w + ((Layout.autosize(WND, 'CPBar') || { insets: [-2 * INSET, 0] }).insets[0]); }

  _loadWidth() {
    try {
      const v = Number(localStorage.getItem(STORE));
      if (v >= this.minW && v <= this.maxW) return v;
    } catch { /* fresh */ }
    return this.defaultW;
  }

  /** Resize width only; height is fixed, as in retail. */
  setWidth(w) {
    this.w = Math.round(Math.max(this.minW, Math.min(this.maxW, w)));
    this.root.style.width = `${Skin.px(this.w)}px`;

    this.bandL.style.left = `${Skin.px(this.leftX)}px`;
    this.bandL.style.width = `${Skin.px(this.lSize.w)}px`;
    this.bandC.style.left = `${Skin.px(this.leftX + this.lSize.w)}px`;
    // data rule (has0 autosize): center band width = parent.width + insetA
    // (-32) — spans 28..(width-32), tiling exactly into the right cap
    this.bandC.style.width = `${Skin.px(this.w + this.centerInset)}px`;
    this.bandR.style.left = `${Skin.px(this.w - this.rSize.w)}px`;
    this.bandR.style.width = `${Skin.px(this.rSize.w)}px`;

    for (const key of Object.keys(this.rows)) {
      const r = this.rows[key];
      r.el.style.width = `${Skin.px(this._gaugeW())}px`;
      // the native centres its label on the bar (width * 0.5 - textW / 2),
      // so the label box tracks the gauge's width
      this.labels[key].style.width = `${Skin.px(this._gaugeW())}px`;
      const fill = r.el.lastElementChild;
      if (fill) fill.style.clipPath = `inset(0 ${(1 - r.frac) * 100}% 0 0)`;
    }
    return this;
  }

  _makeResizable() {
    const grip = this.bandR;
    grip.style.pointerEvents = 'auto';
    grip.style.cursor = 'ew-resize';
    grip.title = 'drag to resize';
    let from = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      from = { x: e.clientX, w: this.w };
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!from) return;
      this.setWidth(from.w + (e.clientX - from.x) / Skin.scale);
    });
    const end = () => {
      if (!from) return;
      from = null;
      try { localStorage.setItem(STORE, String(this.w)); } catch { /* ignore */ }
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /** Default dock: SOURCED — WindowsInfo.ini [StatusWnd] posX=444 posY=0
   *  (absolute retail px at 1024x768; Skin.px applies the uiScale — retail
   *  does not rescale UI with resolution, so no proportional rescale).
   *  DEVIATION: posX 444 -> 513. Both docks are individually sourced, but
   *  the sourced TargetStatusWnd dock (337 + width 176) ends exactly at
   *  513 — the sourced combination overlaps by 69px and is unreadable, so
   *  this window butts against the target frame instead. */
  place({ left = 513, top = 0 } = {}) {
    this.root.style.left = `${Skin.px(left)}px`;
    this.root.style.top = `${Skin.px(top)}px`;
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
    return this;
  }

  /**
   * The retail interface-reset callback (StatusWnd has no override of its
   * own, so this restores the parts that are user state here: the width).
   * See docs/ui-reverse-engineering.md §3.
   */
  onDefaultPosition() {
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
    this.setWidth(this.defaultW);
  }

  /**
   * Clicking the window targets yourself.
   *
   * SOURCED (tier 2, StatusWnd.uc OnLButtonDown): the client accepts the
   * click only between rect.nX + 13 and rect.nX + width - 10, leaving the
   * level box and the resize grip clickable for their own purposes. Those
   * two insets are the client's own numbers, in retail pixels.
   */
  onSelfTargetClick(fn) {
    this.root.style.pointerEvents = 'auto';
    let down = null;
    this.root.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    this.root.addEventListener('click', (e) => {
      // the window is also draggable; a click that ended a drag is not a
      // target request
      const moved = down
        ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
      down = null;
      if (moved > 4) return;
      const r = this.root.getBoundingClientRect();
      const x = e.clientX - r.left;
      // SOURCED (StatusWnd.uc): rect.nX + 13 .. rect.nX + width - 10
      if (x > Skin.px(13) && x < r.width - Skin.px(10)) fn();
    });
    return this;
  }

  show() { this.root.style.display = 'block'; return this; }
  hide() { this.root.style.display = 'none'; return this; }

  _setBar(key, frac) {
    const f = Math.max(0, Math.min(1, frac || 0));
    this.rows[key].frac = f;
    this.set[key](f);
  }

  /** Takes a `selfStatus` payload straight off the bridge. */
  update(s) {
    if (!s) return;
    this.show();
    const frac = (v, m) => (m ? v / m : 0);

    this._setBar('hp', frac(s.hp, s.maxHp));
    this._setBar('mp', frac(s.mp, s.maxMp));
    this._setBar('cp', frac(s.cp, s.maxCp));
    // aCis sends absolute exp (resolved against the level table); the mock
    // gateway sends a plain 0..1 fraction
    const e = s.exp;
    const expFrac = expFraction(e, s.level);
    this._setBar('exp', expFrac != null ? expFrac : (e > 0 && e < 1 ? e : 0));

    Font.set(this.levelEl, String(s.level ?? 1), { color: '#ffffff' });
    if (s.name) this.setName(s.name);

    // Gauge labels, exactly what NCStatusBarCtrl's render writes (see
    // LABEL_COLOR above): "cur/max" on the SetPoint bars, "nn.nn%" on the
    // SetPointExp bar. No separator spaces — the native draws "%d", "/",
    // "%d" back to back.
    this._label('cp', s.cp, s.maxCp);
    this._label('hp', s.hp, s.maxHp);
    this._label('mp', s.mp, s.maxMp);
    const ef = this.rows.exp.frac;
    Font.set(this.labels.exp, `${(ef * 100).toFixed(2)}%`, { color: LABEL_COLOR });

    // low HP: the client swaps the fill for its 'warn' texture
    const hp = this.rows.hp;
    if (hp.warn && s.maxHp) {
      const low = frac(s.hp, s.maxHp) < 0.3;
      if (low !== this._low) {
        this._low = low;
        const fill = hp.el.lastElementChild;
        if (fill) Skin.apply(fill, low ? hp.warn : hp.fill, { stretch: true });
      }
    }
  }

  /** "cur/max" on one gauge, or nothing when the payload omits the pair. */
  _label(key, cur, max) {
    if (max == null) return;
    Font.set(this.labels[key], `${cur ?? 0}/${max}`, { color: LABEL_COLOR });
  }

  setName(n) {
    if (n) Font.set(this.nameEl, n, { color: '#e8dcc0' });
  }

  clear() {
    for (const k of Object.keys(this.set)) this._setBar(k, 0);
    for (const k of Object.keys(this.labels)) this.labels[k].replaceChildren();
    this.hide();
  }
}
