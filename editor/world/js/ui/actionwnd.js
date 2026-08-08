// Phase C.5 — ActionWnd, the retail actions window.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   ActionWnd is 256x335 with three labelled sections and
//                    three ItemWindows (assets/gamedata/interface.json):
//                      txtBasic headers at (22,11) / (22,141) / (22,235)
//                      ActionBasicItem  219x104 at (18,25)  {rows:3, cap:18}
//                      ActionPartyItem  219x69  at (18,155) {rows:2, cap:12}
//                      ActionSocialItem 219x69  at (18,250) {rows:3, cap:12}
//                    cells 32x32 + gap (5,3) => pitch 37x35, the same
//                    convention as SkillWnd's SkillItem grid.
//   ActionWnd.uc     three sections Basic/Party/Social; OnClickItem routes
//                    to DoAction(ClassID) — one click, one action id.
//   actionname.json  102 actions; category 1=basic (17), 2=party (7),
//                    3=social (12). Categories 0/4/5 (special/pet/servitor)
//                    belong to the pet UIs (PetActionWnd/SummonedActionWnd
//                    in the xdat), NOT to this window.
//
// Wire: bridge op 'action' (C->S action{actionId}); the gateway routes ids
// 2..13 to RequestSocialAction and everything else to RequestActionUse.
// Sit/stand and walk/run are server-side toggles — the client holds no
// toggle state, and neither do we.
//
// Icons: actionname's icon.actionNNN art ships in the same utx icon
// package as skills/items (tools/dat/build_meta.py copy_action_icons ->
// assets/gamedata/icons/; 102 refs -> 47 unique textures). Cells are
// text-labelled and the <img> replaces the label once the png loads.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { actionMeta } from '../gamedata.js';

const WND = 'ActionWnd';
// Slot art convention shared with SkillWnd: NCItemWnd hardcodes the 34x34
// back drawn at (x-1, y-1) around the 32x32 icon (see skillwnd.js header).
const CELL_REF = 'l2ui.nwindow.icon_back';

// category id -> [label, item-window child]. Section order is the xdat's
// child order (ActionWnd.uc: Basic, Party, Social). Labels are AUTHORED
// English — retail renders system strings that were not extracted.
const SECTIONS = [
  { cat: 1, label: 'Basic', item: 'ActionBasicItem' },
  { cat: 2, label: 'Party', item: 'ActionPartyItem' },
  { cat: 3, label: 'Social', item: 'ActionSocialItem' },
];

export class ActionWnd {
  constructor(parent = document.body, { onUse } = {}) {
    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 256;
    this.h = def && def.height ? def.height : 335;
    this.onUse = onUse || (() => {});
    this.sections = {};   // cat -> { grid: element, count: n }

    const win = new L2Window({
      title: 'Action', width: this.w, height: this.h, closable: true,
      winName: WND,
    });
    win.root.id = 'l2-actionwnd';
    this.win = win;
    this.root = win.root;

    this.cellArt = Skin.content(CELL_REF);

    // The three section headers share the xdat name txtBasic; their mined
    // positions come from the window's child list in declaration order.
    const winDef = Layout.window(WND);
    const headers = ((winDef && winDef.children) || [])
      .filter(c => c.name === 'txtBasic');

    for (let s = 0; s < SECTIONS.length; s++) {
      const sec = SECTIONS[s];
      const head = document.createElement('div');
      head.style.cssText = 'position:absolute;pointer-events:none;';
      // MINED: txtBasic positions (22,11)/(22,141)/(22,235). Fallback keeps
      // the section readable if the lookup ever fails.
      const hp = headers[s] && headers[s].x != null
        ? { x: headers[s].x, y: headers[s].y } : { x: 22, y: 11 + s * 120 };
      head.style.left = `${Skin.px(hp.x)}px`;
      head.style.top = `${Skin.px(hp.y)}px`;
      Font.set(head, sec.label, { color: '#c8b98a' });
      win.body.appendChild(head);

      const pos = Layout.pos(WND, sec.item) ?? { x: 18, y: 25 + s * 113 };
      const size = Layout.size(WND, sec.item) || { w: 219, h: 104 };
      const grid = document.createElement('div');
      grid.className = 'l2-action-grid';
      grid.style.cssText = 'position:absolute;display:flex;flex-wrap:wrap;'
        + 'align-content:flex-start;overflow:hidden;pointer-events:auto;';
      const g = Layout.grid(WND, sec.item)
        || { cellX: 32, cellY: 32, gapX: 5, gapY: 3 };
      const pitchX = g.cellX + g.gapX;                         // 37

      // Column count. A row holds n cells when n*cell + (n-1)*gap <= paneW,
      // i.e. n = floor((paneW + gap) / pitch) — the trailing gap after the
      // last cell is not inside the pane. The port was flowing cells into a
      // paneW-wide flex box, which is floor(paneW / pitch): 5 columns in
      // ActionWnd's 219px panes, where Action_Back is drawn with SIX cell
      // wells per row. floor((219+5)/37) = 6 matches the art; the same
      // formula leaves MagicSkillWnd (239) and InventoryWnd (236) at 6, so
      // it agrees everywhere the old rule was already right.
      const cols = Math.floor((size.w + g.gapX) / pitchX);

      grid.style.left = `${Skin.px(pos.x)}px`;
      grid.style.top = `${Skin.px(pos.y)}px`;
      grid.style.width = `${Skin.px(cols * pitchX)}px`;
      grid.style.height = `${Skin.px(size.h)}px`;
      win.body.appendChild(grid);

      this.sections[sec.cat] = {
        grid,
        cols,
        pitch: { x: pitchX, y: g.cellY + g.gapY },              // 37 x 35
        cellIcon: g.cellX,                                     // 32 icon
        count: 0,
      };
    }

    parent.appendChild(win.root);
    // AUTHORED: no [ActionWnd] in WindowsInfo.ini. Top-right cell of the
    // toggle-window 2x2 tile (see skillwnd.js for the reasoning): one
    // window width + an 8px gutter left of SkillWnd. Alt+Enter (WndMgr
    // reset) restores this spot.
    this.defaultPlace = { right: 276, top: 60 };
  }

  /** Fill the three sections from actionname.json (fetched once). */
  async setActions() {
    const meta = await actionMeta();
    for (const sec of SECTIONS) {
      const S = this.sections[sec.cat];
      S.grid.replaceChildren();
      S.count = 0;
      for (const a of meta.list) {
        if (a.category !== sec.cat) continue;
        S.grid.appendChild(this._cell(a, S));
        S.count++;
      }
    }
    return this;
  }

  _cell(a, S) {
    const cell = document.createElement('div');
    cell.className = 'l2-action-cell';
    cell.dataset.actionId = a.id;
    cell.style.cssText = 'position:relative;overflow:visible;cursor:pointer;'
      + `width:${Skin.px(S.pitch.x)}px;height:${Skin.px(S.pitch.y)}px;`
      + 'display:flex;align-items:center;justify-content:center;';

    const cell32 = this.cellArt ? this.cellArt.w : S.cellIcon + 2;  // 34 slot
    const inner = document.createElement('div');
    inner.style.cssText = `position:relative;width:${Skin.px(cell32)}px;`
      + `height:${Skin.px(cell32)}px;overflow:hidden;`
      + 'display:flex;align-items:center;justify-content:center;';
    if (this.cellArt) Skin.apply(inner, CELL_REF, { content: { w: cell32, h: cell32 } });
    cell.appendChild(inner);

    // text-underlay: the name is the cell content until the icon png
    // loads (and the fallback if it ever 404s); AUTHORED 8px (no retail
    // source — retail never drew text here, it had the icons). The label
    // spans WIDER than the 34px slot (centered on it, into the 5px grid
    // gap) and wraps only at word boundaries: inside the slot rect
    // 'Exchange' clipped to 'Exchang e' and 'Walk/Run' to 'Walk/Ru n'.
    const label = document.createElement('div');
    label.className = 'l2-action-label';
    label.style.cssText = 'position:absolute;left:50%;top:50%;'
      + 'transform:translate(-50%,-50%);width:46px;'
      + 'font:8px sans-serif;color:#d8cba6;text-align:center;'
      + 'line-height:9px;overflow:hidden;max-height:27px;'
      + 'overflow-wrap:break-word;'
      + 'text-shadow:0 1px 1px #000;pointer-events:none;';
    label.textContent = a.name;
    cell.appendChild(label);

    if (a.icon) {
      const img = document.createElement('img');
      img.src = `/gamedata/icons/${String(a.icon).replace(/^icon\./, '')}.png`;
      img.style.cssText = `position:absolute;left:${Skin.px(1)}px;`
        + `top:${Skin.px(1)}px;width:${Skin.px(S.cellIcon)}px;`
        + `height:${Skin.px(S.cellIcon)}px;display:none;`;
      img.draggable = false;
      img.addEventListener('load', () => {
        img.style.display = 'block';
        label.style.display = 'none';
      });
      img.addEventListener('error', () => img.remove());
      inner.appendChild(img);
    }

    cell.title = `${a.name} — ${String(a.desc || '').replace(/\\n/g, ' ')}`;
    cell.draggable = true;
    cell.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-l2vzla',
        JSON.stringify({ type: 'action', id: a.id }));
    });
    cell.addEventListener('click', () => this.onUse(a.id));
    if (this.onAssign) {
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.onAssign({ type: 'action', id: a.id });
      });
    }
    return cell;
  }

  /** {basic, party, social} live counts — what the window actually shows. */
  counts() {
    return {
      basic: this.sections[1] ? this.sections[1].count : 0,
      party: this.sections[2] ? this.sections[2].count : 0,
      social: this.sections[3] ? this.sections[3].count : 0,
    };
  }

  place(o = {}) { this.win.place(o); return this; }
  show() { this.win.show(); return this; }
  hide() { this.win.hide(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { this.win.toggle(force); return this; }

  onDefaultPosition() {
    this.place(this.defaultPlace);
  }
}
