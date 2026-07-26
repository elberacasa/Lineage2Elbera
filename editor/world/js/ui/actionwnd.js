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
// Icons: actionname's icon.actionNNN art was never mined (only
// action102.png exists under assets/gamedata/icons/), so cells are
// text-labelled and an <img> is layered in only if the png resolves.

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
      grid.style.left = `${Skin.px(pos.x)}px`;
      grid.style.top = `${Skin.px(pos.y)}px`;
      grid.style.width = `${Skin.px(size.w)}px`;
      grid.style.height = `${Skin.px(size.h)}px`;
      win.body.appendChild(grid);

      const g = Layout.grid(WND, sec.item)
        || { cellX: 32, cellY: 32, gapX: 5, gapY: 3 };
      this.sections[sec.cat] = {
        grid,
        pitch: { x: g.cellX + g.gapX, y: g.cellY + g.gapY },   // 37 x 35
        cellIcon: g.cellX,                                     // 32 icon
        count: 0,
      };
    }

    parent.appendChild(win.root);
    // AUTHORED: same dock as SkillWnd ({right:12, top:60}) — windows toggle,
    // and Alt+Enter (WndMgr reset) restores this spot.
    this.defaultPlace = { right: 12, top: 60 };
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

    // text-first: the action icons were not mined, so the name IS the cell
    // content; AUTHORED 8px to fit the 32px icon rect (no retail source
    // exists — retail never drew text here, it had the icons)
    const label = document.createElement('div');
    label.className = 'l2-action-label';
    label.style.cssText = 'font:8px sans-serif;color:#d8cba6;text-align:center;'
      + 'line-height:9px;overflow:hidden;max-height:27px;word-break:break-word;'
      + 'text-shadow:0 1px 1px #000;pointer-events:none;';
    label.textContent = a.name;
    inner.appendChild(label);

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
