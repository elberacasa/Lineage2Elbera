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
//
// WHAT CHANGED AND WHY (2026-08-09, second pass)
// ----------------------------------------------
// Two things this file used to author are now decoded, and one hypothesis it
// was carrying is now dead:
//
//   * THE TITLE. It said `title: 'Dialog'` with a comment reading "AUTHORED
//     default: what retail writes in the bar when a page carries no <title>
//     was not decoded". It is decoded. The console gives BOTH NPC viewers
//     `push 0x1bc` — SysString 444, "Chat" — through vtable slot 0x164,
//     NCWnd::SetWindowTitle(int) (NWindow.dll 0x1013fe65 / 0x1013ff43). The
//     title is an ID, not a string, and the id is a constant.
//
//     The other half is a NEGATIVE and it changes behaviour: there is no
//     slot-0x164 call site anywhere in the html viewer's own code, so a page's
//     `<title>` NEVER reaches the bar. This file used to put it there. It no
//     longer does — the bar is always SysString 444 — and the page's declared
//     title stays readable as `data-npc-title` for anything that needs to know
//     the page changed.
//
//   * THE 22-FRAME WIPE. `npc1_back_alpha01..22` was recorded as "a wipe whose
//     stepping code was not found", which left open that a flat-looking panel
//     was a missing animation. It is not: NCHtmlViewer's ctor loads frame 01
//     into this+0x250 and NOTHING in the image ever reads that field, and the
//     name occurs in no other client file. There is no wipe to reproduce.
//     Both facts are asserted by tools/ui/mine_npchtml.py --check.
//
//   * THE WRAPPED-LINE INDENT, which is the visible defect the owner reported.
//     See _pushSpace below.

import { L2Window } from './window.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { WndMgr } from './wndmgr.js';
import { Layout } from './layout.js';
import { NpcHtml } from './npchtml.js';
import { sysStringMeta, sysMsgMeta, renderSysMsg } from '../gamedata.js';

// Reached only if /gamedata/npchtml.json failed to load. Zero, not a
// plausible number: a window we could not measure has no honest size, and a
// zero-size window makes the gap visible instead of dressing it up as retail
// geometry (the discipline Layout._degrade sets).
const NO_SPEC = {
  width: 0, height: 0, titleBarHeight: 0, background: null,
  title: null, openAnim: null,
  frame: { x: 0, y: 0, width: 0, height: 0 },
  dock: { x: 0, yScale: 0, yOffset: 0 },
};

// The bar text, resolved once for every dialog in the page. The ID is the
// client's (npchtml.json window.title.sysStringId, NWindow.dll 0x1013fe65);
// the STRING is the client's too, out of sysstring-e.dat. Neither is typed
// here — a lookup that misses leaves the bar empty rather than inventing a
// word, which is the same discipline the geometry follows.
let _titlePromise = null;
function titleText(id) {
  if (id == null) return Promise.resolve('');
  if (!_titlePromise) _titlePromise = sysStringMeta().catch(() => null);
  return _titlePromise.then((doc) => {
    if (!doc) return '';
    // sysstring.json is a LIST of {id, string}; index it once.
    const rec = Array.isArray(doc)
      ? doc.find(e => e && e.id === id)
      : (doc[String(id)] || null);
    return (rec && rec.string) || '';
  });
}

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
      // Empty until the SysString resolves; see titleText above.
      title: '', width: spec.width, height: bodyH, closable: true,
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

    // The bar carries SysString 444 and nothing else, for every page.
    this.barTitleId = (spec.title && spec.title.sysStringId != null)
      ? spec.title.sysStringId : null;
    this.barTitle = '';
    titleText(this.barTitleId).then((text) => {
      this.barTitle = text;
      win.setTitle(text);
      // Glyph pixels have no textContent; mirror the bar for verification.
      this.root.dataset.npcBar = text;
      this.root.dataset.npcBarId = String(this.barTitleId);
    });

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
    // The flow runs at font-size 0 (style.css), so a space CHARACTER measures
    // nothing and this supplies its whole advance — the retail glyph sheet's
    // own space advance, the same number the old inline-block spacer used.
    // See _pushSpace for why the separator is a character and not a box.
    this.body.style.wordSpacing = `${Skin.px(NpcHtml.spaceWidth)}px`;
    // …and the same number reaches style.css's underline bridge.
    this.body.style.setProperty('--l2h-space',
      `${Skin.px(NpcHtml.spaceWidth)}px`);
    scroller.appendChild(this.body);

    this._buildScrollbar();

    // The confirmation table, kicked once. `<a msg=>` needs it synchronously
    // at click time; see _confirmMsg.
    this.sysMsg = null;
    sysMsgMeta().then((m) => { this.sysMsg = m; }).catch(() => {});

    view.addEventListener('click', (e) => {
      const link = e.target.closest('[data-bypass]');
      if (link && !link.hasAttribute('data-disabled')) {
        e.preventDefault();
        if (!this._confirmMsg(link.dataset.msg)) return;
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
    // Minimum thumb height: the two cap sprites' own MEASURED heights, so the
    // thumb never shrinks below the art it is made of. The 8 is reached only
    // when neither cap sprite loaded, i.e. the thumb has no art at all —
    // AUTHORED, and a tripwire rather than a design.
    const h = Math.max(Skin.px(this.thumbCaps || 8),
      track * (s.clientHeight / s.scrollHeight));
    const span = s.scrollHeight - s.clientHeight;
    const y = span > 0 ? (s.scrollTop / span) * (track - h) : 0;
    this.thumb.style.top = `${btn + y}px`;
    this.thumb.style.height = `${h}px`;
  }

  // -- rendering -------------------------------------------------------------

  /** One inter-word space, as REAL whitespace rather than as a box.
   *
   *  THE DEFECT THIS REPLACES, measured on the live client against the real
   *  page aCis sends for Gatekeeper Clarissa (30080): the space used to be its
   *  own `<span class="l2h-sp">` inline-BLOCK, and an inline-block is an
   *  atomic box, so it wraps like a word. When a line filled to within one
   *  space width the SPACE moved to the next line and that line opened with
   *  it. Two of the four text lines in the owner's screenshot are indented by
   *  exactly one space, and the headless capture reproduces both. The preview
   *  harness reproduces it too — but only when it is given that page; its own
   *  gatekeeper fixture (Roxxy, 30006) happens never to fill a line that
   *  closely, which is why the existing suite never saw it.
   *
   *  The fix is to stop simulating whitespace. The separator is a real space
   *  CHARACTER in a text node, and the browser's own inline layout then does
   *  what every text renderer does and what retail visibly does: it breaks at
   *  the space, hangs the trailing space past the end of the line so it never
   *  costs the last word its place, and drops it at the start of the next.
   *
   *  The WIDTH of that space is still the retail glyph sheet's own advance,
   *  not a font metric: the flow runs at `font-size: 0` (style.css), so a
   *  space character measures zero and `word-spacing` — set from
   *  NpcHtml.spaceWidth in _render — supplies the whole advance.
   *
   *  The run's underline is ONE draw for the whole anchor, spaces included
   *  (NWindow.dll 0x100856af pushes 1 where the plain-text branch at
   *  0x100856de pushes 0), so it must not break at every space. It does not:
   *  a link word that is followed by a space inside the same anchor is marked
   *  `data-sp`, and style.css paints the missing segment as a pseudo-element
   *  ABOVE the flow. Nothing about that segment participates in layout, so
   *  the underline is continuous and the space is still a space. Wrapping the
   *  character in a real element instead would either make it an atomic box
   *  again (the bug) or leave its border at the strut's baseline, which with
   *  `font-size: 0` sits six pixels above the glyph boxes — measured.
   *
   *  AUTHORED, unchanged from before and still not decoded: what the client
   *  does with a run of MORE than one space. Collapsing is the browser's rule,
   *  not a measured one, so the surplus is kept as an explicit box — which
   *  preserves the widths this port already rendered.
   */
  _pushSpace(parent, count, link) {
    const prev = parent.lastElementChild;
    if (link && prev && prev.classList.contains('l2h-w')
        && prev.classList.contains('npc-link')) {
      prev.dataset.sp = '';        // style.css bridges the underline over it
    }
    parent.appendChild(document.createTextNode(' '));
    if (count <= 1) return;
    const extra = document.createElement('span');
    extra.className = 'l2h-sp l2h-sp-extra';
    extra.style.width = `${Skin.px(NpcHtml.spaceWidth * (count - 1))}px`;
    // Same box height as a glyph canvas, so a link's underline is one
    // unbroken rule across the run instead of a dash at the line top.
    extra.style.height = `${Skin.px(NpcHtml.lineHeight)}px`;
    if (link) extra.classList.add('npc-link');
    parent.appendChild(extra);
  }

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
          this._pushSpace(top().el, part.length, link);
        } else {
          const w = NpcHtml.word(part, color);
          w.dataset.t = part;
          if (link) {
            w.classList.add('npc-link');
            if (owner && owner.link.bypass) w.dataset.bypass = owner.link.bypass;
            // MSG rides with the bypass: the client reads it on the same <a>
            // (NWindow.dll 0x1034e9a8) and it gates the command. See
            // _confirmMsg.
            if (owner && owner.link.msg) w.dataset.msg = owner.link.msg;
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
        link: name === 'A'
          ? { bypass: this._bypass(attrs), msg: attrs.MSG || null } : null,
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
    // A sanity ceiling on a server-supplied width/height, not a layout value:
    // AUTHORED, and it exists so a malformed page cannot ask for a
    // million-pixel box. Every dimension that reaches the DOM comes from the
    // page itself or from a measured sprite.
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
        // The label goes through the same decoder the flow text does: the
        // shipped data writes `value="&$140;"` (SysString 140, "OK") and
        // `value="&$141;"` ("Cancel") on the board's two buttons, so a button
        // label that skipped it read `&$140;`.
        const label = NpcHtml.entities(attrs.VALUE || '');
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
        // FIXWIDTH — the eighth name in TD's own attribute array (NWindow.dll
        // 0x1034e9a8's TD record; the wide string L"FIXWIDTH" lives at
        // 0x1024d044). MEASURED: the shipped datapack writes it on 202 cells
        // and this renderer read none of them, so every one of those cells was
        // laid out at whatever width its content happened to want.
        //
        // AUTHORED, and separated from the measurement above: what the client
        // DOES with it. The client reads both WIDTH and FIXWIDTH on the same
        // element, so they cannot mean the same thing, and the only difference
        // the names admit is that one is a request and the other is not. So
        // FIXWIDTH is pinned with min-width == max-width and border-box, while
        // WIDTH stays the ordinary suggestion `_boxAttrs` already sets. The
        // client's own sizing pass was not decoded; if it turns out FIXWIDTH is
        // something else, this is the line to delete.
        const fw = px(attrs.FIXWIDTH);
        if (fw != null) {
          const v = `${Skin.px(fw)}px`;
          el.style.boxSizing = 'border-box';
          el.style.width = v;
          el.style.minWidth = v;
          el.style.maxWidth = v;
        }
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

      // <edit> and <multiedit> are separate native classes and they do NOT
      // share their chrome. Both were decoded 2026-08-09 out of NWindow.dll,
      // by way of the image's own MSVC RTTI (see tools/ui/mine_htmlart.py):
      //
      //   NCHtmlEdit      ctor writes vtable 0x10251464 at 0x1009532c, then
      //                   pushes L"L2UI.EtcWnd.Edit_Back" at 0x10095346 into
      //                   SetTexture and stores the handle at this+0x350. ONE
      //                   texture, no slices — l2ui.utx `Edit_Back` is DXT3
      //                   32x32 with every texel at alpha 153, a flat plate.
      //   NCHtmlMultiEdit vtable 0x10251214 slot 0x98 -> 0x10095b50, a nine
      //                   iteration loop (count 9 at 0x10095b7b, index from 1
      //                   at 0x10095b70) over L"l2ui_ch3.multiedit.
      //                   M_inputbox0%d" — a 3x3 nine-slice of 4x4 tiles.
      //
      // What this REPLACES is a CSS box with an authored `1px solid #555`
      // border, sitting under a comment that named L2UI_CH3.Etc.inputbox1..3
      // as the missing art. Those six textures are real and they ARE installed
      // by a constructor — the one at 0x10095670, which also installs
      // L2UI_CH3.ListCtrl.TextSelect and is not either html control. The name
      // was decoded; the class it belonged to was assumed.
      case 'EDIT': case 'MULTIEDIT': {
        const multi = name === 'MULTIEDIT';
        const el = document.createElement(multi ? 'textarea' : 'input');
        el.className = 'npc-edit';
        if (!multi) {
          el.type = String(attrs.TYPE || '').toLowerCase() === 'password'
            ? 'password' : 'text';
          const len = px(attrs.LENGTH);
          if (len != null) el.maxLength = len;
        }
        const w = px(attrs.WIDTH), h = px(attrs.HEIGHT);
        if (w != null) el.style.width = `${Skin.px(w)}px`;
        if (h != null) el.style.height = `${Skin.px(h)}px`;
        // The glyphs cannot come off the retail sheet here — the field is
        // editable, so it needs a real text renderer and a real caret. Only
        // the COLOUR is the client's: npchtml.json colors.text, the same
        // 0xffdcdcdc the html flow draws with (NWindow.dll 0x100856fa).
        // AUTHORED and unavoidable: the typeface and its size.
        const tc = (NpcHtml.spec && NpcHtml.spec.colors
          && NpcHtml.spec.colors.text) || null;
        if (tc) el.style.color = tc;
        if (multi) {
          // Nine-slice: border-image lays a 3x3 grid out of one image, which
          // is what the client's loop does with nine separate 4x4 tiles. The
          // tiles are staged individually, so they are composited into one
          // 12x12 sheet at load and cached on the class.
          this._paintMultiEdit(el);
        } else if (!NpcHtml.paint(el, 'L2UI.EtcWnd.Edit_Back')) {
          console.warn('[NpcDialog] L2UI.EtcWnd.Edit_Back did not resolve');
        }
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

  /** The <multiedit> nine-slice, laid out as nine background layers.
   *
   *  WHICH TILE GOES WHERE IS MEASURED, not assumed. The client's loop
   *  (NWindow.dll 0x10095b50) only proves there are nine of them, numbered 1
   *  to 9; it does not say where each one sits. The TILE PIXELS do. Each is
   *  4x4, and the light edge colour 0x393839 marks the outside of the frame:
   *
   *    1 top row + left col     2 top row        3 top row + right col
   *    4 left col               5 uniform        6 right col
   *    7 left col + bottom row  8 bottom row     9 right col + bottom row
   *
   *  which is row-major, and tile 5 is a flat 0x202020 at alpha 238 — the
   *  interior. Any other assignment would put a light rule through the middle
   *  of the field, so this is falsifiable by looking at the picture.
   */
  _paintMultiEdit(el) {
    const T = ['01', '02', '03', '04', '05', '06', '07', '08', '09']
      .map(n => NpcHtml.artUrl(`l2ui_ch3.multiedit.M_inputbox${n}`));
    if (T.some(u => !u)) {
      console.warn('[NpcDialog] the multiedit nine-slice did not resolve');
      return;
    }
    const s = Skin.px(4);         // every tile is 4x4 in the client's package
    // Painted back to front: the centre first, then the four edges, then the
    // four corners on top — the order a nine-slice composites in.
    const layers = [
      [T[0], 'left top', 'no-repeat'],
      [T[2], 'right top', 'no-repeat'],
      [T[6], 'left bottom', 'no-repeat'],
      [T[8], 'right bottom', 'no-repeat'],
      [T[1], 'left top', 'repeat-x'],
      [T[7], 'left bottom', 'repeat-x'],
      [T[3], 'left top', 'repeat-y'],
      [T[5], 'right top', 'repeat-y'],
      [T[4], 'left top', 'repeat'],
    ];
    el.style.backgroundImage = layers.map(l => l[0]).join(', ');
    el.style.backgroundPosition = layers.map(l => l[1]).join(', ');
    el.style.backgroundRepeat = layers.map(l => l[2]).join(', ');
    el.style.backgroundSize = layers.map(() => `${s}px ${s}px`).join(', ');
    el.style.imageRendering = 'pixelated';
    el.style.padding = `${s}px`;
  }

  _boxAttrs(el, attrs) {
    // Same AUTHORED sanity ceiling as _element's `px`, for the same reason.
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
  /** `msg="811;Monster Arena"` -> ask before firing the bypass.
   *
   *  MEASURED: MSG is the fifth name in the client's own attribute array for
   *  <a> (NWindow.dll 0x1034e9a8 — ACTION, CMD, HREF, LINK, MSG), and the
   *  shipped datapack writes it on 112 anchors, every one of them in a page an
   *  NPC serves. This renderer read none of them, so a gatekeeper teleport
   *  link fired the moment it was clicked.
   *
   *  MEASURED, which table: the id is a SystemMessage, not a SysString. 811 in
   *  systemmsg-e.dat is "You will be moved to ($s1). Do you wish to continue?"
   *  and the attribute's own second field is the $s1 — `msg="811;Monster
   *  Arena"`. The other ids used are 1039, 1040, 1271, 1272, 1298 and 1484,
   *  and each is a yes/no question about exactly what its link does. Against
   *  sysstring-e.dat the same ids read as unrelated nouns, so the table is not
   *  ambiguous.
   *
   *  AUTHORED: the WINDOW. Retail draws this through the client's own modal;
   *  this port has no such window yet, and js/ui/inventorywnd.js already
   *  answers the same problem with `window.confirm` carrying the retail TEXT
   *  (see its _confirmText). This follows that precedent rather than inventing
   *  a second convention. DEVIATION, and it is a deviation in chrome only —
   *  the words, the id and the yes/no semantics are the client's.
   *
   *  A missing table or an unknown id must NOT silently swallow the click:
   *  returning true keeps the link working, which is what the pre-msg
   *  behaviour was.
   */
  _confirmMsg(raw) {
    if (!raw) return true;
    const semi = String(raw).indexOf(';');
    // SPEC: parseInt radix -- base 10, the notation the attribute is written in
    const id = parseInt(semi < 0 ? raw : raw.slice(0, semi), 10);
    if (!Number.isFinite(id)) return true;
    const args = semi < 0 ? [] : String(raw).slice(semi + 1).split(';')
      .filter(s => s !== '');
    if (!this.sysMsg) return true;
    const text = renderSysMsg(this.sysMsg, id, args);
    // renderSysMsg's own miss shape: it echoes "sysmsg <id>" when the entry is
    // absent. Asking the player to confirm that string would be worse than not
    // asking, so an unresolved id passes through.
    if (!text || /^sysmsg \d+/.test(text)) return true;
    this.lastConfirm = text;              // readable by verification
    return window.confirm(text);
  }

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
    // <title> is metadata and it is SILENT — its content does not reach the
    // flow. It does not reach the BAR either: the window is titled by the
    // console with SysString 444 and the html viewer owns no path to
    // NCWnd::SetWindowTitle (npchtml.json window.title.fromPageTitle = false,
    // NWindow.dll 0x10080000..0x1008b000 carries no slot-0x164 site). So the
    // page's own title is recorded and NOT displayed; `data-npc-bar` is what
    // the bar actually says.
    const t = /<title>([\s\S]*?)<\/title>/i.exec(String(html || ''));
    this.pageTitle = t ? NpcHtml.entities(t[1]).trim() : '';
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
