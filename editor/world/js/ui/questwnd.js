// Original QuestTreeWnd journal: Interface.u AddQuestInfo and native
// NWindow AddQuestID / UIDATA_QUEST. See docs/quest-data.md and the native
// evidence verifier. All journal prose and item requirements are decoded.
// Native TreeCtrl painting/word breaking still have presentation differences;
// target guidance is not implemented. Confirmation uses original DialogBox.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { sharedDialogBox } from './dialogbox.js';
import { questMeta, questStages } from '../questdata.js';
import { itemMeta, itemInfo, sysStringMeta, sysMsgMeta, renderSysMsg } from '../gamedata.js';

const WND = 'QuestTreeWnd';
const MAX_QUESTS = 25;   // QUESTTREEWND_MAX_COUNT, QuestTreeWnd.uc:3
// Original XMLButtonData label ID at Interface.xdat byte340308. The shared
// layout asset has not migrated yet; use the proven ID, never authored text.
// tools/ui/check_layout_native.py verifies this field and its native consumer.
const ABORT_LABEL_ID = 385;

// Secondary text colour: SOURCED from QuestTreeWnd.uc:570-572 (the
// level/journal node items, R176 G155 B121).

// Compatibility exports used by inspection tools; native stage decoding
// also handles non-bitmask counts and intentionally ignores reserved bit30.
export function questCond(progress) { return questStages(progress).at(-1)?.level || 0; }
export function questStarted(progress) { return questStages(progress).length > 0; }

// DOM text wrapping uses measured original glyphs. Native TreeCtrl's exact
// line-break algorithm is still unverified; do not claim pixel-identical flow.
function textBlock(text, color, width) {
  const box = document.createElement('div');
  box.setAttribute('aria-label', text);
  box.dataset.text = text;
  box.style.cssText = `max-width:${Skin.px(width)}px;line-height:0;`;
  for (const [i, line] of String(text).split(/\\n|\n/).entries()) {
    if (i) box.appendChild(document.createElement('br'));
    for (const part of line.split(/( +)/)) {
      if (!part) continue;
      if (/^ +$/.test(part)) {
        // Ordinary whitespace gives the browser a wrap opportunity; its
        // width is the original font's measured space advance.
        const space = document.createElement('span');
        space.textContent = ' ';
        space.style.cssText = `white-space:normal;font-size:0;word-spacing:${Skin.px(Font.measure(part) + 2)}px;`;
        box.appendChild(space);
      } else {
        const canvas = Font.canvas(part, { color });
        canvas.style.verticalAlign = 'top';
        box.appendChild(canvas);
      }
    }
  }
  return box;
}

function sprite(ref, width, height) {
  const el = document.createElement('span');
  el.style.cssText = `display:inline-block;flex-shrink:0;width:${Skin.px(width)}px;height:${Skin.px(height)}px;`;
  Skin.apply(el, ref, { stretch: true });
  return el;
}

export class QuestWnd {
  constructor(parent = document.body, { onAbort, getItems = () => [] } = {}) {
    const def = Layout.windowSize(WND);
    this.w = def.w;
    this.h = def.h;
    this.onAbort = onAbort || (() => {});
    this.quests = [];          // {id, name, progress}
    this.getItems = getItems;
    this.expandedStages = new Set();
    this.meta = null;
    this.strings = new Map();
    this.selected = null;      // quest id
    this.resetRevision = 0;
    this.dialog = sharedDialogBox(parent);

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
    const numPos = Layout.posOf(WND, 'txtQuestNum');
    this.numEl = document.createElement('div');
    this.numEl.style.cssText = 'position:absolute;pointer-events:none;'
      + `left:${Skin.px(numPos.x)}px;top:${Skin.px(numPos.y)}px;`;
    win.body.appendChild(this.numEl);

    // The original xdat declares this caption's system-string ID, position
    // and colour. It is independent from the journal's dynamic quest count.
    const captionPos = Layout.posOf(WND, 'txt324');
    this.captionEl = document.createElement('div');
    this.captionEl.style.cssText = 'position:absolute;pointer-events:none;'
      + `left:${Skin.px(captionPos.x)}px;top:${Skin.px(captionPos.y)}px;`;
    win.body.appendChild(this.captionEl);

    // the journal list over the mined MainTree rect (7,27, 242x274)
    const listPos = Layout.posOf(WND, 'MainTree');
    const listSize = Layout.sizeOf(WND, 'MainTree');
    this.listEl = document.createElement('div');
    this.listEl.className = 'l2-quest-list';
    this.listEl.style.cssText = 'position:absolute;overflow-y:auto;'
      + 'overflow-x:hidden;pointer-events:auto;'
      + `left:${Skin.px(listPos.x)}px;top:${Skin.px(listPos.y)}px;`
      + `width:${Skin.px(listSize.w)}px;height:${Skin.px(listSize.h)}px;`;
    win.body.appendChild(this.listEl);

    // abort button on the mined btnClose rect (91,306) — retail cancels
    // the SELECTED quest from here (QuestTreeWnd.uc HandleQuestCancel)
    const abPos = Layout.posOf(WND, 'btnClose');
    const abSize = Layout.sizeOf(WND, 'btnClose');
    const ab = document.createElement('div');
    ab.className = 'l2-quest-abort';
    ab.setAttribute('role', 'button');
    ab.setAttribute('aria-label', '');
    ab.style.cssText = `position:absolute;left:${Skin.px(abPos.x)}px;`
      + `top:${Skin.px(abPos.y)}px;width:${Skin.px(abSize.w)}px;`
      + `height:${Skin.px(abSize.h)}px;display:flex;align-items:center;`
      + 'justify-content:center;';
    const abTex = Layout.tex(WND, 'btnClose').filter(r => Skin.sprite(r));
    if (abTex[0]) Skin.apply(ab, abTex[0], { stretch: true });
    // Label is painted from the original system-string table in _render.
    ab.addEventListener('click', () => this.abortSelected());
    this.abortEl = ab;
    win.body.appendChild(ab);

    parent.appendChild(win.root);
    // Original xdat initial placement; QuestListWnd's saved position belongs
    // to a different window. Do not substitute an invented toggle-grid cell.
    const position = Layout.pos(WND);
    this.defaultPlace = { left: Skin.px(position.x), top: Skin.px(position.y) };
    this._render();
    this._loadData();
  }

  async abortSelected() {
    const selected = this.selected;
    const revision = this.resetRevision;
    await this._loadData();
    if (revision !== this.resetRevision || selected !== this.selected) return;
    if (selected != null && !this.quests.some(q => q.id === selected)) return;
    // Original HandleQuestCancel uses Notice1201 without an expanded quest,
    // otherwise Warning182. The captured selection/session is checked again
    // after the dialog, so reconnect cannot apply an old confirmation.
    const text = this.systemMessages && renderSysMsg(this.systemMessages, selected == null ? 1201 : 182, []);
    if (!text || /^sysmsg /.test(text)) return;
    const result = await this.dialog.request({ type: selected == null ? 'notice' : 'warning',
      message: text, context: { selected, revision }, owner: this });
    if (result.accepted && selected != null && revision === this.resetRevision
        && selected === this.selected && this.quests.some(q => q.id === selected)) this.onAbort(selected);
  }

  _loadData() {
    if (this.meta || this.ready) return this.ready;
    this.ready = Promise.all([questMeta(), itemMeta(), sysStringMeta(), sysMsgMeta()])
      .then(([meta, items, strings, messages]) => {
        this.meta = meta; this.itemMetadata = items; this.systemMessages = messages;
        this.strings = new Map((strings || []).map(row => [row.id, row.string]));
        this._render();
      }).catch(error => {
        this.ready = null;
        console.error('[QuestTreeWnd] original data unavailable:', error);
      });
    return this.ready;
  }

  /** The server snapshot includes completed quests with progress0. Original
   * NWindow AddQuestID emits journal events only for decoded stages, so such
   * rows do not create a QuestTreeWnd entry or consume its displayed count. */
  setQuests(quests) {
    this.quests = (quests || []).filter(q => questStages(q.progress).length > 0);
    const stages = new Set(this.quests.flatMap(q =>
      questStages(q.progress).map(stage => `${q.id}:${stage.level}`)));
    for (const key of this.expandedStages) {
      if (!stages.has(key)) this.expandedStages.delete(key);
    }
    if (this.selected != null
        && !this.quests.some(q => q.id === this.selected)) {
      this.selected = null;
      // Retire both visible confirmations and requests still awaiting source
      // metadata. A later reappearance of the same ID is a new selection.
      this.resetRevision++;
      this.dialog.reset(this);
    }
    this._render();
    return this;
  }

  _render() {
    const abortLabel = this.strings.get(ABORT_LABEL_ID) || '';
    Font.set(this.abortEl, abortLabel, { color: Layout.native('buttonLabel') });
    this.abortEl.setAttribute('aria-label', abortLabel);
    const caption = this.strings.get(Layout.textId(WND, 'txt324')) || '';
    Font.set(this.captionEl, caption, { color: Layout.textColor(WND, 'txt324') });
    // numEl sits at the txtQuestNum rect, so that record governs it
    // (#B09B79 in Interface.xdat)
    Font.set(this.numEl, `(${this.quests.length}/${MAX_QUESTS})`,
             { color: Layout.textColor(WND, 'txtQuestNum') });
    this.listEl.replaceChildren();

    // Original InitTree root offset(3,5).
    this.listEl.style.padding = `${Skin.px(5)}px ${Skin.px(3)}px`;
    this.listEl.style.boxSizing = 'border-box';
    for (const q of this.quests) {
      const row = document.createElement('section');
      row.className = 'l2-quest-row'; row.dataset.questId = q.id;
      const open = this.selected === q.id;
      const title = this.meta?.title(q.id);
      // Never replace missing original prose with an emulator-authored name.
      const button = this._nodeButton(title || `Quest #${q.id}`, open, false, () => {
        this.selected = open ? null : q.id;
        if (!open) {
          const current = questStages(q.progress).at(-1);
          if (current) this.expandedStages.add(`${q.id}:${current.level}`);
        }
        this._render();
      });
      row.appendChild(button);
      if (open) {
        const first = this.meta?.stage(q.id, 1);
        if (first) {
          const info = document.createElement('div');
          info.style.cssText = `margin-left:${Skin.px(22)}px;margin-bottom:${Skin.px(7)}px;`;
          const icons = [[4, 1], [4, 2], [3, 1], [3, 2]][first.questType] || [];
          for (const icon of icons) info.appendChild(sprite(`L2UI_CH3.QUESTWND.QuestWndInfoIcon_${icon}`, 11, 11));
          const level = this.strings.get(922), plus = this.strings.get(859), none = this.strings.get(866);
          if (level && plus && none) {
            const range = first.minLevel > 0
              ? first.maxLevel > 0 ? `${first.minLevel}~${first.maxLevel}` : `${first.minLevel} ${plus}` : none;
            info.appendChild(textBlock(`(${level}:${range})`, '#b09b79', 211));
          }
          row.appendChild(info);
        }
        for (const stage of questStages(q.progress)) {
          const data = this.meta?.stage(q.id, stage.level);
          if (!data) continue; // unresolved source stage is never fabricated
          const key = `${q.id}:${stage.level}`, expanded = this.expandedStages.has(key);
          const chapter = document.createElement('div');
          chapter.dataset.questStage = stage.level;
          chapter.dataset.completed = String(stage.completed);
          chapter.style.cssText = `margin-left:${Skin.px(7)}px;margin-bottom:${Skin.px(5)}px;`;
          const completion = stage.completed && data.unknown1 !== 0 ? this.strings.get(898) : '';
          const heading = this._nodeButton(data.journal, expanded, true, () => {
            if (expanded) this.expandedStages.delete(key); else this.expandedStages.add(key);
            this._render();
          });
          if (completion) {
            const badge = textBlock(completion, '#b09b79', 211);
            badge.style.marginLeft = `${Skin.px(5)}px`;
            heading.appendChild(badge);
          }
          chapter.appendChild(heading);
          if (expanded) {
            const body = document.createElement('div');
            body.className = 'l2-quest-description';
            body.style.cssText = `margin-left:${Skin.px(2)}px;width:${Skin.px(211)}px;`;
            const prose = textBlock(data.description, '#8c8c8c', 211 - 5);
            prose.style.marginLeft = `${Skin.px(5)}px`;
            body.appendChild(prose);
            this._renderItems(body, data, stage.completed);
            chapter.appendChild(body);
          }
          row.appendChild(chapter);
        }
      }
      this.listEl.appendChild(row);
    }

    // HandleQuestCancel has an explicit no-selection Notice path; the
    // original script never disables or fades this button when collapsed.
    this.abortEl.style.cursor = 'pointer';
  }

  _nodeButton(text, expanded, journal, onClick) {
    const button = document.createElement('button');
    button.type = 'button'; button.setAttribute('aria-label', text);
    button.setAttribute('aria-expanded', String(expanded));
    button.style.cssText = 'display:flex;align-items:flex-start;text-align:left;background:none;'
      + 'border:0;padding:0;cursor:pointer;color:inherit;font:inherit;';
    const name = journal ? (expanded ? 'Up' : 'Down') : (expanded ? 'Minus' : 'Plus');
    const ref = `L2UI_CH3.QUESTWND.QuestWnd${name}Btn`;
    const icon = sprite(ref, 14, 14); button.appendChild(icon);
    button.addEventListener('mouseenter', () => Skin.apply(icon, ref + '_over', { stretch: true }));
    button.addEventListener('mouseleave', () => Skin.apply(icon, ref, { stretch: true }));
    const label = textBlock(text, '#ffffff', 211);
    label.style.marginLeft = `${Skin.px(5)}px`;
    if (!journal) label.style.marginTop = `${Skin.px(2)}px`;
    button.appendChild(label); button.addEventListener('click', onClick);
    return button;
  }

  _renderItems(parent, data, completed) {
    const totals = new Map();
    for (const item of this.getItems()) totals.set(item.itemId, (totals.get(item.itemId) || 0) + item.count);
    data.itemIds.forEach((id, index) => {
      // Original AddQuestInfo skips an item whose source icon is unavailable.
      const item = this.itemMetadata?.[id];
      if (!item?.icon) return;
      const line = document.createElement('div');
      line.style.cssText = `display:flex;align-items:flex-start;margin-top:${Skin.px(4)}px;`;
      const image = sprite('L2UI_CH3.Etc.menu_outline', 34, 34);
      image.style.position = 'relative'; image.style.marginLeft = `${Skin.px(4)}px`;
      const img = document.createElement('img'); img.src = itemInfo(this.itemMetadata, id).icon;
      img.alt = item.name;
      img.style.cssText = `position:absolute;left:${Skin.px(1)}px;top:${Skin.px(1)}px;`
        + `width:${Skin.px(32)}px;height:${Skin.px(32)}px;`;
      image.appendChild(img); line.appendChild(image);
      const labels = document.createElement('div');
      labels.style.cssText = `margin-left:${Skin.px(5)}px;margin-top:${Skin.px(1)}px;`;
      labels.appendChild(textBlock(item.name, '#b09b79', 211 - 34 - 5 - 4));
      const required = data.itemCounts[index];
      const goal = required > 0 ? String(required)
        : required === 0 ? this.strings.get(858) : `${-required}${this.strings.get(859) || ''}`;
      const amount = completed && data.unknown2 !== 0 ? this.strings.get(898) : String(totals.get(id) || 0);
      if (goal != null && amount != null) labels.appendChild(textBlock(`(${amount}/${goal})`, '#b09b79', 211 - 34 - 5 - 4));
      line.appendChild(labels); parent.appendChild(line);
    });
  }

  onInvUpdate() { if (this.visible) this._render(); }

  // Original QuestTreeWnd.HandleQuestSetCurrentID: the effect button opens
  // the quest pane, then expands the requested quest and its last chapter.
  // Target guidance and the containing native MainWnd tab remain unported.
  focusQuest(id) {
    const quest = id > 0 && this.quests.find(q => q.id === id);
    if (quest) {
      this.selected = id;
      const current = questStages(quest.progress).at(-1);
      if (current) this.expandedStages.add(`${id}:${current.level}`);
    }
    this.show();
    return !!quest;
  }

  reset() {
    this.resetRevision++;
    this.dialog.reset(this);
    this.quests = [];
    this.selected = null;
    this.expandedStages.clear();
    this._render();
    this.hide();
  }

  place(o = {}) { this.win.place(o); return this; }
  show() { this._loadData(); this._render(); this.win.show(); return this; }
  hide() { this.win.hide(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { this._loadData(); this._render(); this.win.toggle(force); return this; }

  onDefaultPosition() {
    this.place(this.defaultPlace);
  }
}
