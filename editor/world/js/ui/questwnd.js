// Phase C.8 — QuestTreeWnd (Alt+U), the retail quest journal.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   QuestTreeWnd 256x335 at (0,65), texture
//                    L2UI_CH3.QUESTWND.QuestWndBack; children: MainTree
//                    [TreeCtrl] 242x274 at (7,27), txtQuestNum 40x23 at
//                    (190,12), btnClose 77x23 at (91,306) (the quest-cancel
//                    button), chkNpcPosBox 80x12 at (10,310).
//   QuestTreeWnd.uc  the journal model: EV_QuestList fills a tree — one
//                    node per quest (name, from UIDATA_QUEST) with journal
//                    sub-nodes per cond (journal name, description, item
//                    list — ALL from questname-e.dat via UIDATA_QUEST).
//                    btnClose (HandleQuestCancel) aborts the SELECTED
//                    quest after a confirm dialog (sysmsg 182), and
//                    txtQuestNum shows (n/QUESTTREEWND_MAX_COUNT) with
//                    the max 25 (QuestTreeWnd.uc:3).
//   gateway/README   the port's contract is thinner: questList carries
//   M8               {id, name, progress} only — name from the aCis Java
//                    sources, progress the RAW QuestState flags dword.
//                    Journal names/descriptions/items (UIDATA_QUEST) are
//                    NOT in the contract, so the window shows name + the
//                    derived cond state and NOTHING else — no invented
//                    quest text.
//
// Cond math (aCis QuestState.calculateFlags, gateway/README M8): while
// started, flags = ((1 << cond) - 1) | 0x80000000 — bit31 = started,
// low bits = cond mask. cond = (highest set bit index in the low mask)
// + 1. Live evidence: accept -> 0x80000001 (cond 1), advance ->
// 0x80000003 (cond 2).
//
// DEVIATIONS (all backend-absent): no journal/description/item sub-nodes
// (no UIDATA_QUEST); no chkNpcPosBox (quest target locations come from
// UIDATA_QUEST.GetTargetLoc); the abort is IMMEDIATE — retail confirms
// with DIALOG_Warning (sysmsg 182) and the port has no dialog framework.
// QuestListWnd (600x326, lstQuest + btnLoc) is the GM/location window,
// not the Alt+U journal — not built.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';

const WND = 'QuestTreeWnd';
const MAX_QUESTS = 25;   // QUESTTREEWND_MAX_COUNT, QuestTreeWnd.uc:3

// Secondary text colour: SOURCED from QuestTreeWnd.uc:570-572 (the
// level/journal node items, R176 G155 B121).
const SUB_COLOR = '#b09b79';

/** aCis QuestState flags dword -> cond number (see header). */
export function questCond(progress) {
  const low = progress & 0x7fffffff;
  return low === 0 ? 0 : 32 - Math.clz32(low);
}

/** bit31 of the flags dword = started/active (calculateFlags). */
export function questStarted(progress) {
  return (progress & 0x80000000) !== 0;
}

export class QuestWnd {
  constructor(parent = document.body, { onAbort } = {}) {
    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 256;
    this.h = def && def.height ? def.height : 335;
    this.onAbort = onAbort || (() => {});
    this.quests = [];          // {id, name, progress}
    this.selected = null;      // quest id

    const win = new L2Window({
      title: 'Quest', width: this.w, height: this.h, closable: true,
      back: 'none',   // QuestWndBack painted via its MEASURED content rect
    });
    win.root.id = 'l2-questwnd';
    this.win = win;
    this.root = win.root;

    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    Skin.apply(back, 'L2UI_CH3.QUESTWND.QuestWndBack', { stretch: true });
    win.body.appendChild(back);

    // quest count over the mined txtQuestNum rect (190,12)
    const numPos = Layout.pos(WND, 'txtQuestNum') ?? { x: 190, y: 12 };
    this.numEl = document.createElement('div');
    this.numEl.style.cssText = 'position:absolute;pointer-events:none;'
      + `left:${Skin.px(numPos.x)}px;top:${Skin.px(numPos.y)}px;`;
    win.body.appendChild(this.numEl);

    // the journal list over the mined MainTree rect (7,27, 242x274)
    const listPos = Layout.pos(WND, 'MainTree') ?? { x: 7, y: 27 };
    const listSize = Layout.size(WND, 'MainTree') || { w: 242, h: 274 };
    this.listEl = document.createElement('div');
    this.listEl.className = 'l2-quest-list';
    this.listEl.style.cssText = 'position:absolute;overflow-y:auto;'
      + 'overflow-x:hidden;pointer-events:auto;'
      + `left:${Skin.px(listPos.x)}px;top:${Skin.px(listPos.y)}px;`
      + `width:${Skin.px(listSize.w)}px;height:${Skin.px(listSize.h)}px;`;
    win.body.appendChild(this.listEl);

    // abort button on the mined btnClose rect (91,306) — retail cancels
    // the SELECTED quest from here (QuestTreeWnd.uc HandleQuestCancel)
    const abPos = Layout.pos(WND, 'btnClose') ?? { x: 91, y: 306 };
    const abSize = Layout.size(WND, 'btnClose') || { w: 77, h: 23 };
    const ab = document.createElement('div');
    ab.className = 'l2-quest-abort';
    ab.style.cssText = `position:absolute;left:${Skin.px(abPos.x)}px;`
      + `top:${Skin.px(abPos.y)}px;width:${Skin.px(abSize.w)}px;`
      + `height:${Skin.px(abSize.h)}px;display:flex;align-items:center;`
      + 'justify-content:center;';
    const abTex = Layout.tex(WND, 'btnClose').filter(r => Skin.sprite(r));
    if (abTex[0]) Skin.apply(ab, abTex[0], { stretch: true });
    // AUTHORED label (retail's is a system string, not extracted)
    Font.set(ab, 'Abort', { color: '#c9a959' });
    ab.addEventListener('click', () => {
      if (this.selected != null) this.onAbort(this.selected);
    });
    this.abortEl = ab;
    win.body.appendChild(ab);

    parent.appendChild(win.root);
    // AUTHORED: WindowsInfo.ini has no [QuestTreeWnd] ([QuestListWnd] is
    // the separate 600x326 GM window). Bottom-left cell of the
    // toggle-window 2x2 tile (see skillwnd.js for the reasoning).
    this.defaultPlace = { right: 12, top: 424 };
    this._render();
  }

  /** Feed the bridge's questList payload straight in. */
  setQuests(quests) {
    this.quests = quests || [];
    if (this.selected != null
        && !this.quests.some(q => q.id === this.selected)) {
      this.selected = null;
    }
    this._render();
    return this;
  }

  _render() {
    Font.set(this.numEl, `(${this.quests.length}/${MAX_QUESTS})`,
             { color: SUB_COLOR });
    this.listEl.replaceChildren();

    for (const q of this.quests) {
      const row = document.createElement('div');
      row.className = 'l2-quest-row';
      row.dataset.questId = q.id;
      // AUTHORED row geometry/highlight: the xdat's TreeCtrl paints nodes
      // natively; a 15px row with a translucent selection tint stands in
      row.style.cssText = 'padding:1px 4px;cursor:pointer;min-height:15px;'
        + (this.selected === q.id ? 'background:rgba(200,170,90,0.25);' : '');
      row.addEventListener('click', () => {
        this.selected = this.selected === q.id ? null : q.id;
        this._render();
      });

      const name = document.createElement('div');
      Font.set(name, q.name || `Quest #${q.id}`, { color: '#e8e8e8' });
      name.style.pointerEvents = 'none';
      row.appendChild(name);

      if (questStarted(q.progress)) {
        const cond = document.createElement('div');
        // bare state text — the contract carries no journal names, so the
        // cond number is all that can honestly be shown (AUTHORED format)
        Font.set(cond, `cond ${questCond(q.progress)}`, { color: SUB_COLOR });
        cond.style.pointerEvents = 'none';
        row.appendChild(cond);
      }
      this.listEl.appendChild(row);
    }

    const armed = this.selected != null;
    this.abortEl.style.opacity = armed ? '1' : '0.45';
    this.abortEl.style.cursor = armed ? 'pointer' : 'default';
    this.abortEl.title = armed ? 'Abort the selected quest'
      : 'Select a quest first';
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
