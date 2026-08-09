// ElberaSkin runtime — the retail NPC dialog window (NpcHtmlMessage).
//
// WHAT CHANGED AND WHY (2026-08-09)
// ---------------------------------
// This file used to open with "The xdat has NO NpcHtmlWnd ... so the frame is
// L2Window chrome + the measured body panel. Width 360 is AUTHORED", and it
// styled the contents with a web font, a #c9a959 title and a #7fb3ff link.
//
// The measurement was right and the conclusion was wrong. Interface.xdat has
// no record because the window is a NATIVE class — `NCNPCHtmlViewer` — and its
// geometry is an inline immediate in NWindow.dll, at two call sites the
// console uses to build the two NPC pages retail can show at once:
//
//     310 x 401, title bar 20, html frame (7, 30) 296 x 364,
//     background L2UI_ch3.NpcWnd.Npc1_back (art 310x381 = 401 - the bar),
//     opening at x = 0, y = round(viewportHeight/2 - 252)
//
// All of it, plus the client's complete 51-name element table, its 67-name
// entity table and its three text colours, is decoded by
// tools/ui/mine_npchtml.py into assets/gamedata/npchtml.json, which
// `--check` re-reads out of the DLL. This file reads that file and types no
// geometry of its own. The parser and the glyph rendering live in
// js/ui/npchtml.js; this module is the window around them.
//
// The colours are the client's, not ours:
//   body text  #DCDCDC     NWindow.dll 0x100856fa / 0x10085873
//   link       #6699FF     NWindow.dll 0x100856a3, used when the anchor
//                          carries no colour of its own
//   LEVEL      #FFCC00     NWindow.dll 0x10082653, the only NAME the client's
//                          `<font color=>` parser knows
// #c9a959 — the gold this window used for its title — appears nowhere in the
// client and is gone.

import { L2Window } from './window.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { WndMgr } from './wndmgr.js';
import { Layout } from './layout.js';
import { NpcHtml } from './npchtml.js';

// Reached only if /gamedata/npchtml.json failed to load. Zero, not a
// plausible number: a window we could not measure has no honest size, and a
// zero-size window makes the gap visible instead of dressing it up as retail
// geometry (the discipline Layout._degrade sets).
const NO_SPEC = {
  width: 0, height: 0, titleBarHeight: 0, background: null,
  frame: { x: 0, y: 0, width: 0, height: 0 },
  dock: { x: 0, yScale: 0, yOffset: 0 },
};

export class NpcDialog {
  constructor(parent = document.body, { onBypass, onClose } = {}) {
    this.onBypass = onBypass || (() => {});
    this.onClose = onClose || (() => {});
    this.open = false;

    const spec = NpcHtml.window || NO_SPEC;
    if (!NpcHtml.window) {
      console.warn('[NpcDialog] no decoded record for the NPC html window —'
        + ' painting nothing (a typed size would be an invention)');
    }
    this.spec = spec;

    // The window is 401 tall INCLUDING its 20px title bar, and L2Window's
    // `height` is the body only — so the body is the mined height minus the
    // bar. Passing the full 401 is what made every other window in this port
    // 20px too tall for its art; here the art itself proves the split, since
    // Npc1_back's measured content rect is 310x381.
    const bodyH = Math.max(0, spec.height - spec.titleBarHeight);
    const win = new L2Window({
      title: 'Dialog', width: spec.width, height: bodyH, closable: true,
      winName: null,
      // 'none': L2Window's fallback would 9-slice Npc1_back with a 2px inset.
      // Slicing a WINDOW-SIZED art stretches its middle and shifts every
      // cutout — the same trap window.js already documents for the backs it
      // draws 1:1. We paint it 1:1 below instead.
      back: 'none',
    });
    win.root.id = 'l2-npcdialog';
    win.root.style.zIndex = '14';
    this.win = win;
    this.root = win.root;
    win.onClose = () => this.close();

    // -- the background: Npc1_back at its measured size, 1:1 ----------------
    this.backOk = spec.background
      ? NpcHtml.paint(win.backdrop, spec.background) : false;
    if (!this.backOk && spec.background) {
      // shortcutwnd.js's bug, guarded: an unresolved sprite silently leaves
      // the window with no art while every coordinate stays perfect.
      console.warn(`[NpcDialog] background ${spec.background} did not resolve`);
    }

    // -- the html frame, at the mined rect ---------------------------------
    const f = spec.frame;
    const view = document.createElement('div');
    view.className = 'npc-html-frame';
    view.style.cssText =
      `position:absolute;left:${Skin.px(f.x)}px;`
      // frame y is measured from the WINDOW's top; this element lives in the
      // body, which starts one title bar down.
      + `top:${Skin.px(f.y - spec.titleBarHeight)}px;`
      + `width:${Skin.px(f.width)}px;height:${Skin.px(f.height)}px;`
      + 'overflow:hidden;pointer-events:auto;';
    win.body.appendChild(view);
    this.view = view;

    const scroller = document.createElement('div');
    scroller.className = 'npc-html-scroll';
    scroller.style.cssText =
      'position:absolute;left:0;top:0;right:0;bottom:0;overflow-y:auto;'
      + 'overflow-x:hidden;';
    view.appendChild(scroller);
    this.scroller = scroller;

    this.body = document.createElement('div');
    this.body.className = 'npc-dialog-body';
    this.body.style.lineHeight = `${Skin.px(NpcHtml.lineHeight)}px`;
    scroller.appendChild(this.body);

    this._buildScrollbar();

    view.addEventListener('click', (e) => {
      const link = e.target.closest('[data-bypass]');
      if (link && !link.hasAttribute('data-disabled')) {
        e.preventDefault();
        this.onBypass(this._substituteVars(link.dataset.bypass));
      }
    });
    scroller.addEventListener('scroll', () => this._syncThumb());

    parent.appendChild(win.root);
    WndMgr.register('NpcHtmlWnd', this, { handle: win.bar });
    this.onDefaultPosition();
  }

  // -- the frame's scrollbar -------------------------------------------------
  //
  // Retail's html frame has one: NWindow.dll pushes SliderBarTop/Center/Bottom
  // and ScrollBarUp/DownBtn (0x10095d22..0x10095ec0) in the scroll control's
  // construction, and `<html noscrollbar>` exists as an attribute precisely
  // because the default is TO have one. Those five sprites are staged by
  // tools/ui/mine_htmlart.py from those addresses.
  //
  // AUTHORED: its WIDTH. No immediate names it, so the bar is drawn at its own
  // button art's measured width (16px) and the frame keeps its full mined
  // 296px of text — i.e. the bar overlays rather than insets. Retail may
  // instead reserve the column; that was not decoded.
  _buildScrollbar() {
    const up = NpcHtml.art('L2UI_CH3.ScrollBar.ScrollBarUpBtn');
    if (!up) { this.scrollbar = null; return; }
    const W = up.cw != null ? up.cw : up.w;
    const bar = document.createElement('div');
    bar.className = 'npc-html-sb';
    bar.style.cssText = `position:absolute;right:0;top:0;bottom:0;`
      + `width:${Skin.px(W)}px;display:none;pointer-events:auto;`;
    const mk = (cls, ref, css) => {
      const el = document.createElement('div');
      el.className = cls;
      el.style.cssText = css;
      NpcHtml.paint(el, ref);
      bar.appendChild(el);
      return el;
    };
    const btn = (ref, onRef, css, dir) => {
      const el = mk('npc-sb-btn', ref, css);
      el.addEventListener('mouseenter', () => NpcHtml.paint(el, onRef));
      el.addEventListener('mouseleave', () => NpcHtml.paint(el, ref));
      el.addEventListener('click', () => {
        this.scroller.scrollTop += dir * Skin.px(NpcHtml.lineHeight);
      });
      return el;
    };
    const sq = `width:${Skin.px(W)}px;height:${Skin.px(W)}px;cursor:pointer;`;
    btn('L2UI_CH3.ScrollBar.ScrollBarUpBtn', 'L2UI_CH3.ScrollBar.ScrollBarUpOnBtn',
      `position:absolute;left:0;top:0;${sq}`, -1);
    btn('L2UI_CH3.ScrollBar.ScrollBarDownBtn', 'L2UI_CH3.ScrollBar.ScrollBarDownOnBtn',
      `position:absolute;left:0;bottom:0;${sq}`, 1);

    const thumb = document.createElement('div');
    thumb.className = 'npc-sb-thumb';
    thumb.style.cssText = `position:absolute;left:0;width:${Skin.px(W)}px;`;
    const top = NpcHtml.art('L2UI_CH3.ScrollBar.SliderBarTop');
    const mid = NpcHtml.art('L2UI_CH3.ScrollBar.SliderBarCenter');
    const bot = NpcHtml.art('L2UI_CH3.ScrollBar.SliderBarBottom');
    if (top && mid && bot) {
      const th = top.ch != null ? top.ch : top.h;
      const bh = bot.ch != null ? bot.ch : bot.h;
      const t = document.createElement('div');
      t.style.cssText = `position:absolute;left:0;top:0;right:0;height:${Skin.px(th)}px;`;
      NpcHtml.paint(t, 'L2UI_CH3.ScrollBar.SliderBarTop');
      const c = document.createElement('div');
      c.style.cssText = `position:absolute;left:0;right:0;top:${Skin.px(th)}px;`
        + `bottom:${Skin.px(bh)}px;`;
      NpcHtml.paint(c, 'L2UI_CH3.ScrollBar.SliderBarCenter');
      c.style.backgroundSize = `${(mid.w / (mid.cw || mid.w)) * 100}% ${Skin.px(mid.ch || mid.h)}px`;
      c.style.backgroundRepeat = 'repeat-y';
      const b = document.createElement('div');
      b.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:${Skin.px(bh)}px;`;
      NpcHtml.paint(b, 'L2UI_CH3.ScrollBar.SliderBarBottom');
      thumb.append(t, c, b);
      this.thumbCaps = th + bh;
    } else {
      this.thumbCaps = 0;
    }
    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const start = e.clientY;
      const from = this.scroller.scrollTop;
      const track = this.scroller.clientHeight - Skin.px(W) * 2;
      const move = (ev) => {
        const span = this.scroller.scrollHeight - this.scroller.clientHeight;
        this.scroller.scrollTop = from + ((ev.clientY - start) / Math.max(1, track)) * span;
      };
      const upH = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', upH);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', upH);
    });
    bar.appendChild(thumb);
    this.view.appendChild(bar);
    this.scrollbar = bar;
    this.thumb = thumb;
    this.sbW = W;
  }

  _syncThumb() {
    if (!this.scrollbar) return;
    const s = this.scroller;
    const need = s.scrollHeight > s.clientHeight + 1;
    this.scrollbar.style.display = need ? 'block' : 'none';
    if (!need || !this.thumb) return;
    const btn = Skin.px(this.sbW);
    const track = s.clientHeight - btn * 2;
    const h = Math.max(Skin.px(this.thumbCaps || 8),
      track * (s.clientHeight / s.scrollHeight));
    const span = s.scrollHeight - s.clientHeight;
    const y = span > 0 ? (s.scrollTop / span) * (track - h) : 0;
    this.thumb.style.top = `${btn + y}px`;
    this.thumb.style.height = `${h}px`;
  }

  // -- rendering -------------------------------------------------------------

  /** Render one server page into `this.body`, the way NCHtmlFrame does. */
  _render(src) {
    const colors = (NpcHtml.spec && NpcHtml.spec.colors) || {};
    const out = document.createElement('div');
    out.className = 'npc-dialog-content';
    this.edits = new Map();          // VAR name -> control, for `$var` bypass
    this.title = null;

    const root = { el: out, name: 'BODY', colorSet: false, color: null, link: null, silent: 0 };
    const stack = [root];
    const top = () => stack[stack.length - 1];
    // The innermost <font color=> that is in scope, WITH the distinction the
    // client makes: an attribute that parses to a fully transparent word
    // (`color="white"` -> 0x000000FF, because wcstoul stops at 'w') is a
    // colour that was set and draws nothing. Falling back to the default in
    // that case would paint text retail leaves invisible.
    const flowColor = () => {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].colorSet) return { set: true, color: stack[i].color };
      }
      return { set: false, color: null };
    };
    const inLink = () => stack.some(s => s.link);
    const textColor = () => {
      // NWindow.dll NCHtmlTagInfo::Draw 0x10085837 picks the branch from the
      // run's link kind, and DrawTextCode (0x10085550) uses the tag's own
      // GetMatchedColor result when it is non-zero, else the branch default.
      const own = flowColor();
      if (own.set) return own.color;
      return (inLink() ? colors.link : colors.text) || null;
    };

    const append = (node) => { top().el.appendChild(node); };

    const pushText = (raw) => {
      if (top().silent) return;
      const text = NpcHtml.entities(NpcHtml.runWhitespace(raw));
      if (!text) return;
      const color = textColor();
      if (!color) return;              // alpha 0 -> the client draws nothing
      const link = inLink();
      const owner = link ? [...stack].reverse().find(s => s.link) : null;
      const parts = text.split(/( +)/);
      for (const part of parts) {
        if (!part) continue;
        if (part[0] === ' ') {
          const sp = document.createElement('span');
          sp.className = 'l2h-sp';
          sp.style.width = `${Skin.px(NpcHtml.spaceWidth * part.length)}px`;
          // Same box height as a glyph canvas, so a link's underline is one
          // unbroken rule across the run instead of a dash at the line top.
          sp.style.height = `${Skin.px(NpcHtml.lineHeight)}px`;
          // The underline runs under the WHOLE anchor, spaces included —
          // it is one draw argument for the run (NWindow.dll 0x100856af
          // pushes 1 where the plain-text branch pushes 0), not per word.
          if (link) sp.classList.add('npc-link');
          append(sp);
          append(document.createElement('wbr'));
        } else {
          const w = NpcHtml.word(part, color);
          w.dataset.t = part;
          if (link) {
            w.classList.add('npc-link');
            if (owner && owner.link.bypass) w.dataset.bypass = owner.link.bypass;
          }
          append(w);
        }
      }
    };

    for (const tok of NpcHtml.tokenize(src)) {
      if (tok.t === 'text') { pushText(tok.text); continue; }

      if (tok.t === 'close') {
        // Pop to the matching open. An unmatched close is ignored, which is
        // what a linear parser with a stack does.
        const at = [...stack].reverse().findIndex(s => s.name === tok.name);
        if (at >= 0 && stack.length > 1) {
          const idx = stack.length - 1 - at;
          if (idx > 0) stack.length = idx;
        }
        continue;
      }

      const { name, attrs } = tok;
      if (!NpcHtml.known(name)) continue;        // UNKNOWN: the client's no-op

      const made = this._element(name, attrs, { colors, top, append });
      if (made === undefined) continue;          // handled inline (BR, TITLE…)
      if (NpcHtml.isVoid(name)) { if (made) append(made); continue; }

      const frame = {
        el: made || top().el,
        name,
        colorSet: name === 'FONT' && attrs.COLOR != null,
        color: name === 'FONT' ? NpcHtml.cssColor(attrs.COLOR) : null,
        link: name === 'A' ? { bypass: this._bypass(attrs) } : null,
        silent: (top().silent || NpcHtml.isSilent(name)) ? 1 : 0,
      };
      if (made) append(made);
      stack.push(frame);
    }

    this.body.replaceChildren(out);
    this._syncThumb();
  }

  /** One element -> a DOM node, or null for the ones that only affect flow
   *  (FONT, A, BODY, HTML), or undefined when fully handled here. */
  _element(name, attrs, ctx) {
    const px = (v, d = null) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 && n < 10000 ? n : d;
    };
    switch (name) {
      case 'BR': case 'BR1':
        // AUTHORED: BR1 is drawn as a plain break. It is its own entry in the
        // client's tag table (so it is NOT a typo for BR), but what
        // distinguishes the two was not decoded.
        return document.createElement('br');

      // TITLE is in SILENT: the page's title belongs to the frame's own
      // title bar, not to the flow.

      case 'IMG': {
        const ref = attrs.SRC;
        const el = document.createElement('div');
        el.className = 'npc-html-img';
        const w = px(attrs.WIDTH), h = px(attrs.HEIGHT);
        const s = NpcHtml.art(ref);
        if (!s) return null;           // the client draws nothing either
        el.style.cssText = 'display:inline-block;vertical-align:top;'
          + `width:${Skin.px(w != null ? w : (s.cw || s.w))}px;`
          + `height:${Skin.px(h != null ? h : (s.ch || s.h))}px;`;
        NpcHtml.paint(el, ref);
        if (attrs.TOOLTIP) el.title = attrs.TOOLTIP;
        return el;
      }

      case 'BUTTON': {
        const el = document.createElement('div');
        el.className = 'npc-btn';
        const w = px(attrs.WIDTH), h = px(attrs.HEIGHT);
        const fore = attrs.FORE, back = attrs.BACK;
        el.style.cssText = 'display:inline-block;vertical-align:top;position:relative;'
          + (w != null ? `width:${Skin.px(w)}px;` : '')
          + (h != null ? `height:${Skin.px(h)}px;` : '')
          + 'cursor:pointer;';
        // MEASURED which of the pair rests: across the shipped datapack all
        // 894 buttons pair `fore` with the plain name and `back` with the
        // `_click` / `_over` / `On` variant, and the two arts differ in mean
        // luminance the way a normal/highlight pair does (sek.cbui92 77 vs
        // cbui94 108; DefaultButton 37 vs DefaultButton_click 100). INFERENCE
        // from that: `fore` is the resting texture. Which slot NCButton reads
        // at rest was not decoded.
        // NpcHtml.paint already scales the padded export so its MEASURED
        // content rect fills the element — which is what NCButton does with a
        // button whose width= differs from its texture. Forcing 100% 100%
        // here squeezed the whole 128x32 file into a 67x19 box and left every
        // button looking like an empty dark rectangle.
        const painted = NpcHtml.paint(el, fore) || NpcHtml.paint(el, back);
        if (painted && back && NpcHtml.art(back) && NpcHtml.art(fore)) {
          el.addEventListener('mouseenter', () => NpcHtml.paint(el, back));
          el.addEventListener('mouseleave', () => NpcHtml.paint(el, fore));
        }
        const cmd = this._bypass(attrs);
        if (cmd) el.dataset.bypass = cmd; else el.setAttribute('data-disabled', '');
        const label = attrs.VALUE || '';
        // The label is glyph pixels, so it has no textContent. Mirror it as a
        // data attribute: without it nothing outside this module can read what
        // the button says.
        if (label) el.dataset.label = label;
        if (label) {
          const t = document.createElement('span');
          t.className = 'npc-btn-label';
          // NWindow.dll NCButton::paint 0x100035a2/0x100035a8 — a button's
          // label colour is chosen per draw from its enabled state and is not
          // in any xdat record. Mined into native_colors.json.
          t.appendChild(Font.canvas(label, {
            font: 'small',
            color: Layout.native(cmd ? 'buttonLabel' : 'buttonLabelDisabled'),
          }));
          el.appendChild(t);
        }
        return el;
      }

      case 'TABLE': {
        const el = document.createElement('table');
        el.className = 'npc-table';
        this._boxAttrs(el, attrs);
        const cp = px(attrs.CELLPADDING), cs = px(attrs.CELLSPACING);
        if (cs != null) el.style.borderSpacing = `${Skin.px(cs)}px`;
        el.style.borderCollapse = cs != null && cs > 0 ? 'separate' : 'collapse';
        if (cp != null) el.dataset.cellpadding = String(cp);
        const bc = NpcHtml.cssColor(attrs.BORDERCOLOR);
        const b = px(attrs.BORDER);
        if (b) el.style.border = `${Skin.px(b)}px solid ${bc || 'transparent'}`;
        return el;
      }
      case 'TR': return document.createElement('tr');
      case 'TD': {
        const el = document.createElement('td');
        this._boxAttrs(el, attrs);
        const a = String(attrs.ALIGN || '').toUpperCase();
        const va = String(attrs.VALIGN || '').toUpperCase();
        const H = (NpcHtml.spec && NpcHtml.spec.align && NpcHtml.spec.align.h) || [];
        const V = (NpcHtml.spec && NpcHtml.spec.align && NpcHtml.spec.align.v) || [];
        if (H.includes(a)) el.style.textAlign = a.toLowerCase();
        if (V.includes(va)) el.style.verticalAlign = va.toLowerCase();
        const table = ctx.top().el.closest && ctx.top().el.closest('table');
        const pad = table && table.dataset.cellpadding;
        if (pad) el.style.padding = `${Skin.px(parseInt(pad, 10))}px`;
        return el;
      }

      case 'CENTER': {
        const el = document.createElement('div');
        el.style.textAlign = 'center';
        return el;
      }
      case 'LEFT': case 'RIGHT': {
        const el = document.createElement('div');
        el.style.textAlign = name.toLowerCase();
        return el;
      }
      case 'P': {
        const el = document.createElement('div');
        const a = String(attrs.ALIGN || '').toUpperCase();
        const H = (NpcHtml.spec && NpcHtml.spec.align && NpcHtml.spec.align.h) || [];
        if (H.includes(a)) el.style.textAlign = a.toLowerCase();
        return el;
      }

      case 'EDIT': case 'MULTIEDIT': {
        const el = document.createElement(name === 'EDIT' ? 'input' : 'textarea');
        el.className = 'npc-edit';
        if (name === 'EDIT') {
          el.type = String(attrs.TYPE || '').toLowerCase() === 'password'
            ? 'password' : 'text';
          const len = px(attrs.LENGTH);
          if (len != null) el.maxLength = len;
        }
        const w = px(attrs.WIDTH), h = px(attrs.HEIGHT);
        if (w != null) el.style.width = `${Skin.px(w)}px`;
        if (h != null) el.style.height = `${Skin.px(h)}px`;
        if (attrs.VAR) this.edits.set(attrs.VAR, el);
        return el;
      }
      case 'COMBOBOX': {
        const el = document.createElement('select');
        el.className = 'npc-edit';
        const w = px(attrs.WIDTH);
        if (w != null) el.style.width = `${Skin.px(w)}px`;
        for (const opt of String(attrs.LIST || '').split(';')) {
          if (!opt) continue;
          const o = document.createElement('option');
          o.textContent = opt;
          o.value = opt;
          el.appendChild(o);
        }
        if (attrs.SEL) el.value = attrs.SEL;
        if (attrs.VAR) this.edits.set(attrs.VAR, el);
        return el;
      }

      // Flow-only: they change colour or link state, they draw no box.
      case 'FONT': case 'A': case 'HTML': case 'BODY':
      case 'B': case 'I': case 'U': case 'TT': case 'PRE':
      case 'SUB': case 'SUP': case 'STRIKE': case 'ADDRESS':
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': case 'H7':
      case 'HEAD': case 'COMMENT': case 'UL': case 'OL': case 'LI':
      default:
        return null;
    }
  }

  _boxAttrs(el, attrs) {
    const n = (v) => {
      const x = parseInt(v, 10);
      return Number.isFinite(x) && x >= 0 && x < 10000 ? x : null;
    };
    const w = n(attrs.WIDTH), h = n(attrs.HEIGHT);
    if (/%$/.test(String(attrs.WIDTH || ''))) el.style.width = attrs.WIDTH;
    else if (w != null) el.style.width = `${Skin.px(w)}px`;
    if (h != null) el.style.height = `${Skin.px(h)}px`;
    const bg = NpcHtml.cssColor(attrs.BGCOLOR);
    if (bg) el.style.background = bg;
    if (attrs.BACKGROUND) NpcHtml.paint(el, attrs.BACKGROUND);
  }

  // action="bypass -h CMD" -> "CMD" (frozen contract: the raw string after
  // 'bypass -h '). Voice-command menus use action="bypass CMD" (no -h) — the
  // same raw string form aCis RequestBypassToServer takes. ACTION is one of
  // the five attributes the client reads on <a> (NWindow.dll 0x1034e9a8:
  // ACTION, CMD, HREF, LINK, MSG); an action that is not a bypass is dropped.
  _bypass(attrs) {
    const action = attrs && attrs.ACTION;
    if (!action) return null;
    let m = String(action).match(/^bypass\s+-h\s+(.+)$/);
    if (m) return m[1];
    m = String(action).match(/^bypass\s+(.+)$/);
    return m ? m[1] : null;
  }

  // AUTHORED: `$var` substitution. Retail sends the bypass with each edit's
  // value in place of its `$name` marker — that is how a page with an <edit
  // var="foo"> and `bypass -h ..._set $foo` can work at all — but the client
  // code that performs it was not located, so the exact marker syntax here is
  // ours. It is applied only to names an <edit>/<combobox> on THIS page
  // declared, so a command with no controls is passed through untouched.
  _substituteVars(cmd) {
    if (!this.edits || !this.edits.size) return cmd;
    let out = cmd;
    for (const [name, el] of this.edits) {
      out = out.split(`$${name}`).join(el.value == null ? '' : el.value);
    }
    return out;
  }

  // -- flow --------------------------------------------------------------------

  /** A fresh npcHtml replaces the current page (retail behavior). */
  showHtml(html) {
    this._render(html);
    // <title> is metadata: the client puts it in the frame, not in the flow.
    const t = /<title>([\s\S]*?)<\/title>/i.exec(String(html || ''));
    // AUTHORED default: what retail writes in the bar when a page carries no
    // <title> was not decoded. The bar itself is mined (20px, NWindow.dll
    // 0x1008a0d7); only the fallback word is ours.
    this.pageTitle = t ? NpcHtml.entities(t[1]).trim() : 'Dialog';
    this.win.setTitle(this.pageTitle);
    // Same reason as the button label: the bar draws glyph pixels, so the
    // title has no textContent for a suite or a screen reader to find.
    this.root.dataset.npcTitle = this.pageTitle;
    if (!this.open) {
      this.open = true;
      this.win.show();
    }
    this.scroller.scrollTop = 0;
    this._syncThumb();
  }

  close() {
    if (this.open) {
      this.open = false;
      this.win.hide();
      this.onClose();
    }
  }

  /** The client's own opening position: x = 0 and y = viewportHeight/2 - 252,
   *  from the two doubles at the construction site (NWindow.dll 0x1013fdf7).
   *  hMode 0 anchors it to the left edge; vMode 5 keeps its distance from the
   *  vertical centre when the viewport changes. */
  onDefaultPosition() {
    const el = this.root;
    const d = this.spec.dock || {};
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `${Skin.px(d.x || 0)}px`;
    const y = Math.round(window.innerHeight * (d.yScale || 0) - Skin.px(d.yOffset || 0));
    el.style.top = `${Math.max(0, y)}px`;
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${o.left}px`;
    if (o.top != null) el.style.top = `${o.top}px`;
    if (o.right != null) el.style.right = `${o.right}px`;
    if (o.bottom != null) el.style.bottom = `${o.bottom}px`;
    return this;
  }
}
