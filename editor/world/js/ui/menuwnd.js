// ElberaSkin runtime — MenuWnd + SystemMenuWnd, decoded from the client.
//
// Behavioral source (recovered NCSoft source, assets/uscript/Interface/ —
// behavior mirrored, not transcribed):
//   MenuWnd.uc OnClickButton: BtnCharInfo -> ToggleOpenCharInfoWnd ("MainWnd"
//     = our CharSheet), BtnInventory -> ToggleOpenInventoryWnd (our
//     Inventory), BtnMap -> RequestOpenMinimap, BtnSystemMenu ->
//     ToggleOpenSystemMenuWnd.
//   SystemMenuWnd.uc OnClickButton: btnBBS/btnMacro/btnHelpHtml/btnPetition/
//     btnOption/btnRestart/btnQuit.
// MenuWnd.uc also plays InterfaceSound.charstat_open_01 etc. on toggles —
// we have NO audio assets extracted, so sound is skipped entirely here
// (source lines: MenuWnd.uc ToggleOpenCharInfoWnd / ToggleOpenInventoryWnd).
//
// Geometry source: assets/gamedata/interface.json (Interface.xdat decode):
//   MenuWnd 173x46, three background bands (16/129/16), four 34x34 buttons
//     in xdat child order (== MenuWnd.uc case order).
//   SystemMenuWnd 172x295, back texture, seven 36x36 icon buttons
//     (systemicon1..7 + _down) with 121x25 label rows -> icon+text rows.

import { Layout } from './layout.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { WndMgr } from './wndmgr.js';

// MenuWnd is FULLY decoded (docs/ui-mined-values.md §3): band and button
// positions come from Layout.pos — no authored layout remains here.
// Buttons still render as text labels: AUTHORED, the xdat carries NO
// textures for them (native assigns them at runtime).
const MENU_BUTTONS = [
  { id: 'BtnCharInfo', label: 'Stat' },
  { id: 'BtnInventory', label: 'Inv' },
  { id: 'BtnMap', label: 'Map' },
  { id: 'BtnSystemMenu', label: 'Menu' },
];

// SystemMenuWnd rows: xdat order (matches the .uc switch order).
// enabled=false rows are visible but disabled: AUTHORED product decision —
// BBS/Macro/HelpHtml/Petition have no backend in the web port.
// AUTHORED English labels (retail uses GetSystemString; no string table
// extracted for these).
const SYSMENU_ROWS = [
  { id: 'btnBBS', label: 'BBS (Alt+B)', enabled: false },
  { id: 'btnMacro', label: 'Macro (Alt+R)', enabled: false },
  { id: 'btnHelpHtml', label: 'Help', enabled: false },
  { id: 'btnPetition', label: 'Petition', enabled: false },
  { id: 'btnOption', label: 'Option', enabled: true },
  { id: 'btnRestart', label: 'Restart', enabled: true },
  { id: 'btnQuit', label: 'Quit', enabled: true },
];

export class MenuWnd {
  constructor(parent = document.body, { onAction } = {}) {
    this.onAction = onAction || (() => {});
    const WND = 'MenuWnd';
    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 173;
    this.h = def && def.height ? def.height : 46;

    const root = document.createElement('div');
    root.id = 'l2-menuwnd';
    root.style.cssText = `position:fixed;width:${Skin.px(this.w)}px;`
      + `height:${Skin.px(this.h)}px;z-index:12;pointer-events:auto;`;
    this.root = root;

    // background bands at their MINED positions (12,0) (28,0) (157,0) —
    // they tile to exactly 173 (the parse guard, docs/ui-mined-values.md §1)
    for (const band of ['MenuWndBackTexLeft', 'MenuWndBackTexMiddle', 'MenuWndBackTexRight']) {
      const size = Layout.size(WND, band);
      const tex = Layout.tex0(WND, band);
      if (!tex || !size) continue;
      const pos = Layout.pos(WND, band);
      if (!pos) continue;   // mined table is authoritative; skip, never guess
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
        + `top:${Skin.px(pos.y)}px;height:100%;width:${Skin.px(size.w)}px;`;
      Skin.apply(el, tex, { content: size, stretch: true });
      root.appendChild(el);
    }

    // buttons at their MINED positions (20,6) (57,6) (94,6) (131,6)
    const bwSize = Layout.size(WND, 'BtnCharInfo');
    if (!bwSize) return;    // no mined table, no buttons — never guess
    const bw = bwSize.w;
    this.buttons = {};
    MENU_BUTTONS.forEach((b) => {
      const pos = Layout.pos(WND, b.id);
      if (!pos) return;
      const el = document.createElement('div');
      el.className = 'menu-btn';
      el.dataset.id = b.id;
      el.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
        + `top:${Skin.px(pos.y)}px;width:${Skin.px(bw)}px;`
        + `height:${Skin.px(bw)}px;display:flex;align-items:center;`
        + 'justify-content:center;cursor:pointer;';
      Font.set(el, b.label, { color: '#c9a959' });
      // claim the press: WndMgr makes the whole bar draggable, and an
      // unclaimed pointerdown would capture the pointer and eat the click
      el.addEventListener('pointerdown', (e) => e.preventDefault());
      el.addEventListener('click', () => this.onAction(b.id));
      root.appendChild(el);
      this.buttons[b.id] = el;
    });

    // BtnMap: retail calls RequestOpenMinimap (MenuWnd.uc). DEVIATION: the
    // port's MinimapWnd is client-side (the imagery + georeference are
    // staged locally), so the button just toggles it — no round trip.
    if (this.buttons.BtnMap) this.buttons.BtnMap.title = 'Map (MinimapWnd)';

    parent.appendChild(root);
    WndMgr.register('MenuWnd', this);
    this.onDefaultPosition();
  }

  /** WndMgr reset: retail keeps the menu at the bottom-right corner
   *  (WindowsInfo.ini corroborates menu bottom-right at 1024x768). */
  onDefaultPosition() {
    const el = this.root;
    el.style.left = 'auto';
    el.style.top = 'auto';
    el.style.right = '8px';
    el.style.bottom = '8px';
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

export class SystemMenuWnd {
  constructor(parent = document.body, { onAction } = {}) {
    this.onAction = onAction || (() => {});
    const WND = 'SystemMenuWnd';
    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 172;
    this.h = def && def.height ? def.height : 295;

    const root = document.createElement('div');
    root.id = 'l2-systemmenuwnd';
    root.style.cssText = `position:fixed;width:${Skin.px(this.w)}px;`
      + `height:${Skin.px(this.h)}px;z-index:13;display:none;pointer-events:auto;`;
    this.root = root;

    const back = Layout.tex0(WND, WND);
    if (back) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:0;';
      Skin.apply(el, back, { content: { w: this.w, h: this.h }, stretch: true });
      root.appendChild(el);
    }

    // seven icon+label rows. AUTHORED: the xdat gives sizes (36x36 button,
    // 121x25 label) but no offsets (native layout); rows are stacked
    // centered, which the label width corroborates (36+121+margins ~= 172).
    // The 8px row margin is part of that AUTHORED layout.
    const rows = SYSMENU_ROWS;
    const rowH = 36, gap = Math.max(0, (this.h - rows.length * rowH) / (rows.length + 1));
    const rowX = 8;   // AUTHORED (part of the same un-offset layout)
    const labelW = (Layout.size(WND, 'txtBBS') || { w: 121 }).w;
    this.buttons = {};
    rows.forEach((r, i) => {
      const y = gap + i * (rowH + gap);
      const btn = document.createElement('div');
      btn.className = 'sysmenu-btn' + (r.enabled ? '' : ' disabled');
      btn.dataset.id = r.id;
      btn.style.cssText = `position:absolute;left:${Skin.px(rowX)}px;`
        + `top:${Skin.px(y)}px;width:${Skin.px(rowH)}px;height:${Skin.px(rowH)}px;`
        + 'cursor:pointer;';
      const tex = Layout.tex(WND, r.id);
      if (tex && tex[0]) Skin.apply(btn, tex[0], { content: { w: rowH, h: rowH }, stretch: true });
      // claim the press so the window drag (WndMgr) cannot eat the click
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('click', () => { if (r.enabled) this.onAction(r.id); });
      root.appendChild(btn);
      this.buttons[r.id] = btn;

      const label = document.createElement('div');
      label.style.cssText = `position:absolute;left:${Skin.px(rowX + rowH + 6)}px;`
        + `top:${Skin.px(y)}px;width:${Skin.px(labelW)}px;height:${Skin.px(rowH)}px;`
        + 'display:flex;align-items:center;';
      Font.set(label, r.label, { color: r.enabled ? '#cfd4de' : '#5a6274' });
      root.appendChild(label);
    });

    parent.appendChild(root);
    WndMgr.register('SystemMenuWnd', this);
    this.onDefaultPosition();
  }

  toggle(force) {
    const show = force ?? this.root.style.display === 'none';
    this.root.style.display = show ? 'block' : 'none';
  }

  /** WndMgr reset: the system menu opens centered (retail behavior). */
  onDefaultPosition() {
    const el = this.root;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `calc(50% - ${Skin.px(this.w) / 2}px)`;
    el.style.top = `calc(50% - ${Skin.px(this.h) / 2}px)`;
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${o.left}px`;
    if (o.top != null) el.style.top = `${o.top}px`;
    return this;
  }
}
