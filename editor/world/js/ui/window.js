// ElberaSkin runtime — the retail window frame.
//
// Interlude windows are built from three fixed pieces (see Interface.xdat:
// every *Wnd carries a LeftTex / CenterTex / RightTex trio, and the shared
// chrome lives in L2UI_CH3 as FrameBackLeft / FrameBackMid / FrameBackRight
// with FrameCloseBtn on the right). This class reproduces that assembly:
// caps at their true pixel width, a middle that stretches, a close button
// that swaps to its "On" texture on hover, and drag-by-titlebar.
//
//   const w = new L2Window({ title: 'Inventory', width: 248, height: 300 });
//   document.body.appendChild(w.root);
//   w.body.appendChild(...);      // your content, positioned in retail px
//
// Sizes passed in are RETAIL pixels; the frame multiplies by Skin.scale.

import { Skin } from './skin.js';
import { Layout } from './layout.js';
import { Font } from './font.js';

const FRAME = {
  left: 'L2UI_CH3.FrameCtrl.FrameBackLeft',
  mid: 'L2UI_CH3.FrameCtrl.FrameBackMid',
  right: 'L2UI_CH3.FrameCtrl.FrameBackRight',
  close: 'L2UI_CH3.FrameCtrl.FrameCloseBtn',
  closeOn: 'L2UI_CH3.FrameCtrl.FrameCloseOnBtn',
};

// Fallback: the staged manifest keys by package + leaf, and different xdat
// groups collapse onto the same leaf. Try the plain leaf form too.
function ref(name) {
  const dotted = FRAME[name];
  if (Skin.sprite(dotted)) return dotted;
  const leaf = dotted.split('.').pop();
  const alt = `L2UI_CH3.${leaf}`;
  return Skin.sprite(alt) ? alt : dotted;
}

export class L2Window {
  /**
   * @param {object} o
   * @param {string} o.title      titlebar text (retail bitmap font)
   * @param {number} o.width      retail px
   * @param {number} o.height     retail px, body only (titlebar is extra)
   * @param {boolean} o.closable  show the close button
   * @param {boolean} o.draggable drag by the titlebar
   * @param {string}  o.back      body background override: a texture ref, or
   *                              'none' when the caller paints its own (e.g.
   *                              MinimapWnd's MapBack via its measured content
   *                              rect — nine-slicing the padded export would
   *                              distort the frame)
   */
  constructor({ title = '', width = 200, height = 120,
                closable = true, draggable = true, winName = null,
                back } = {}) {
    this.title = title;
    this.width = width;
    this.height = height;

    // Titlebar height is the cap art's MEASURED height (FrameBackLeft is
    // 16x20 of art inside a 16x32 export), not the padded file height.
    const cap = Skin.content(ref('left'));
    this.barH = cap ? cap.h : 20;

    const root = document.createElement('div');
    root.className = 'l2wnd';
    root.style.position = 'fixed';
    root.style.width = `${Skin.px(width)}px`;
    root.style.display = 'none';
    this.root = root;

    // --- titlebar (3-part strip) ---
    const bar = document.createElement('div');
    bar.className = 'l2wnd-bar';
    bar.style.position = 'relative';
    bar.style.height = `${Skin.px(this.barH)}px`;
    Skin.hstrip(bar, ref('left'), ref('mid'), ref('right'));
    root.appendChild(bar);
    this.bar = bar;

    // The left cap carries an ornament across its full 16px width, so the
    // title clears it rather than starting at the bar's edge. Both axes are
    // derived from the art, never eyeballed.
    const capW = cap ? cap.w : 16;
    const label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.left = `${Skin.px(capW + 3)}px`;
    label.style.top = `${Skin.px(Math.round((this.barH - 13) / 2))}px`;
    label.style.pointerEvents = 'none';
    bar.appendChild(label);
    this.label = label;

    if (closable) {
      const btn = document.createElement('div');
      const cs = Skin.content(ref('close'));
      btn.style.position = 'absolute';
      // AUTHORED: the close button's inset from the right edge. Its SIZE is
      // measured from the art; only this gap is ours.
      btn.style.right = `${Skin.px(4)}px`;
      btn.style.top = `${Skin.px(Math.round((this.barH - (cs ? cs.h : 16)) / 2))}px`;
      btn.style.width = `${Skin.px(cs ? cs.w : 15)}px`;
      btn.style.height = `${Skin.px(cs ? cs.h : 15)}px`;
      btn.style.cursor = 'pointer';
      Skin.apply(btn, ref('close'));
      btn.addEventListener('mouseenter', () => Skin.apply(btn, ref('closeOn')));
      btn.addEventListener('mouseleave', () => Skin.apply(btn, ref('close')));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
        if (this.onClose) this.onClose();
      });
      bar.appendChild(btn);
      this.closeBtn = btn;
    }

    // --- body ---
    const body = document.createElement('div');
    body.className = 'l2wnd-body';
    body.style.position = 'relative';
    // border-box: the 9-slice background below sets a 2px border, and with
    // the default content-box that border ADDS 4px to the window's height.
    // Every framed window was rendering 4px taller than the geometry it was
    // given (measured: InventoryWnd 405 against a mined 401).
    body.style.boxSizing = 'border-box';
    body.style.height = `${Skin.px(height)}px`;
    root.appendChild(body);
    this.body = body;

    // Body background (docs/ui-port-handoff.md §2.1), in the order the
    // client's own data offers it:
    //
    //  1. a BackTexture CHILD — InventoryWnd's Inventory_Back, 256x381 of
    //     art placed at y=20, i.e. the window minus its titlebar;
    //  2. the WINDOW RECORD's own texture — MagicSkillWnd/ActionWnd/
    //     ClanWnd/QuestTreeWnd each name a full-window interior
    //     (skill_back, Action_Back, bloodhood_back, QuestWndBack), all
    //     256x335 of art, exactly the declared window size. Accepted only
    //     when the sprite's MEASURED content rect equals that size, so a
    //     window whose record names an icon (InventoryWnd names
    //     MenuIcon.Menuicon2, 32x32) is never mistaken for a background.
    //     These arts were invisible to the port until the texture harvest
    //     was repaired (tools/ui/mine_texrefs.py).
    //  3. the staged flat panel — MEASURED from the skin manifest:
    //     L2UI_ch3.NpcWnd.Npc1_back, content 310x381 in a 512x512 export,
    //     2px border (dark outline x=0, highlight x=1), interior alpha ~221.
    const own = winName ? Layout.tex0(winName) : null;
    const ownArt = own ? Skin.content(own) : null;
    const win = winName ? Layout.window(winName) : null;
    const ownFits = !!(ownArt && win
      && ownArt.w === win.width && ownArt.h === win.height);
    const backRef = back !== undefined ? back
      : (winName && Layout.tex0(winName, 'BackTexture'))
        || (ownFits ? own : null)
        || 'L2UI_ch3.NpcWnd.Npc1_back';
    if (backRef === 'none') {
      /* caller paints its own */
    } else if (backRef === own && ownFits) {
      // a full-window interior: draw it 1:1, never 9-slice it (slicing a
      // window-sized art stretches its middle and shifts every cutout)
      body.style.height = `${Skin.px(win.height)}px`;
      Skin.apply(body, backRef);
      this.height = win.height;
    } else {
      Skin.nine(body, backRef, 2);
    }

    if (draggable) this._makeDraggable(bar);
    this.setTitle(title);
  }

  setTitle(text) {
    this.title = text;
    if (Font.ready) Font.set(this.label, text, { font: 'small', color: '#c8b98a' });
  }

  _makeDraggable(handle) {
    handle.style.cursor = 'move';
    let from = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = this.root.getBoundingClientRect();
      from = { x: e.clientX - r.left, y: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!from) return;
      this.root.style.left = `${e.clientX - from.x}px`;
      this.root.style.top = `${e.clientY - from.y}px`;
      this.root.style.right = 'auto';
      this.root.style.bottom = 'auto';
    });
    handle.addEventListener('pointerup', () => { from = null; });
  }

  /** Position in retail pixels from a viewport edge. */
  place({ left, top, right, bottom } = {}) {
    const s = (v) => `${Skin.px(v)}px`;
    if (left != null) this.root.style.left = s(left);
    if (top != null) this.root.style.top = s(top);
    if (right != null) this.root.style.right = s(right);
    if (bottom != null) this.root.style.bottom = s(bottom);
    return this;
  }

  show() { this.root.style.display = 'block'; return this; }
  hide() { this.root.style.display = 'none'; return this; }
  get visible() { return this.root.style.display !== 'none'; }
  toggle(force) {
    const v = force ?? !this.visible;
    return v ? this.show() : this.hide();
  }
}
