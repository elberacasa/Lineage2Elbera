// ElberaSkin runtime — InventoryWnd, the retail inventory window.
//
// Layout (ALL tier 1, docs/ui-mined-values.md §3, via Layout.pos — no
// retyped numbers): window 256x401, BackTexture 256x381 at (0,20) — the
// y=20 offset is the titlebar, so controls sit at (x, y-20) in the
// L2Window body. InventoryTab 189x23 at (12,159), InventoryItem/QuestItem
// panes 236x139 at (9,188) (tab alternates sharing one rect),
// EquipItem_Underwear 34x34 at (137,36), HennaItem 26x84 at (223,39),
// CrystallizeButton (14,351), TrashButton (208,351), AdenaIcon 16x12 at
// (98,355), AdenaText at (110,356), InvenWeight 85x12 at (117,372).
//
// Behavior spec: InventoryWnd.uc (read, not transcribed) —
// drag semantics via DragSrcName: InventoryItem->reorder, EquipItem->unequip
// (its OnDropItem reorders CLIENT-SIDE with SwapItems and sends NO packet
// (uc:195-227), so our reorder is client-side too — that IS the retail
// behavior, not a missing op). Equip/unequip goes through the existing
// useItem op: aCis UseItem.java unequips when the item is equipped
// (line 128) and equips otherwise (line 141).

import { Layout } from './layout.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { L2Window } from './window.js';
import { WndMgr } from './wndmgr.js';
import { itemMeta, itemInfo } from '../gamedata.js';

const WND = 'InventoryWnd';
const TITLEBAR_H = 20;   // docs/ui-mined-values.md §3: BackTexture y=20 is the titlebar

// aCis slot bitmask (tier 4: server/aCis Item.java SLOT_* constants) ->
// paperdoll key. LR_* variants occupy both slots of the pair.
const SLOT_BITS = [
  ['hair', 0x040000], ['head', 0x0040], ['hair2', 0x080000],
  ['rear', 0x0002], ['neck', 0x0008], ['lear', 0x0004],
  ['rfinger', 0x0010], ['lfinger', 0x0020],
  ['rhand', 0x0080], ['lhand', 0x0100],
  ['gloves', 0x0200], ['chest', 0x0400], ['legs', 0x0800], ['feet', 0x1000],
  ['underwear', 0x0001],
];
const LR_PAIRS = { 0x0006: ['rear', 'lear'], 0x0030: ['rfinger', 'lfinger'], 0x4000: ['rhand'] };

// Paperdoll slot ORDER from InventoryWnd.uc:67-81 (the m_equipItem enum).
// POSITIONS: only EquipItem_Underwear (137,36) and HennaItem (223,39) are
// in the xdat — the rest are laid out by the native ItemWindow control
// (tier 5, not mined; execAddItem@UUIAPI_ITEMWINDOW would retire this).
// AUTHORED grid, anchored so Underwear lands on its xdat position; slot
// SIZE 34x34 comes from the xdat's EquipItem_Underwear (tier 1).
const DOLL_SLOTS = [
  ['hair', 21, 16], ['head', 59, 16], ['hair2', 98, 16], ['underwear', null, null],
  ['rear', 21, 54], ['neck', 59, 54], ['lear', 98, 54],
  ['rfinger', 21, 92], ['rhand', 59, 92], ['lhand', 98, 92], ['lfinger', 137, 92],
  ['gloves', 21, 130], ['chest', 59, 130], ['legs', 98, 130], ['feet', 137, 130],
];
const DOLL_CELL = 34;   // EquipItem_Underwear, xdat

// Inventory grid geometry: DATA-DRIVEN from the xdat grid block
// (docs/ui-mined-native.md §1b): InventoryItem carries cell 32x32 +
// gap (5,3) => pitch 37x35 (same as every standard grid). Slot art 34x34
// at (x-1, y-1), icon 32x32 (NCItemWnd hardcode, §1a). Replaces the
// earlier MEASURED-34 pitch.
const GRID_CELL = 32;

const ADENA_ID = 57;    // aCis PcInventory.ADENA_ID (tier 4)

export class InventoryWnd {
  constructor(parent = document.body, {
    onUse, onDestroy, onCrystallize, onAssign, getItems, getCharSheet,
  } = {}) {
    this.onUse = onUse || (() => {});
    this.onDestroy = onDestroy || (() => {});
    this.onCrystallize = onCrystallize || (() => {});
    this.onAssign = onAssign || (() => {});
    this.getItems = getItems || (() => []);
    this.getCharSheet = getCharSheet || (() => null);
    this.tab = 'inventory';
    this.order = [];           // client-side reorder state (objectIds)
    this.items = new Map();

    const def = Layout.window(WND);
    const backSize = Layout.size(WND, 'BackTexture');
    const w = backSize ? backSize.w : (def && def.width) || 256;
    const h = backSize ? backSize.h : ((def && def.height) || 401) - TITLEBAR_H;

    const win = new L2Window({
      title: 'Inventory', width: w, height: h, closable: true, winName: WND,
    });
    win.root.id = 'l2-inventorywnd';
    this.win = win;
    this.root = win.root;
    const body = win.body;
    body.style.overflow = 'hidden';

    const P = (ctrl) => {
      const p = Layout.pos(WND, ctrl);
      return p ? { x: p.x, y: p.y - TITLEBAR_H } : null;
    };

    // --- tab strip (inventory | quest), panes share the mined rect -------
    const tabPos = P('InventoryTab');
    const tabSize = Layout.size(WND, 'InventoryTab');
    this.tabs = document.createElement('div');
    this.tabs.style.cssText = 'position:absolute;display:flex;';
    if (tabPos) {
      this.tabs.style.left = `${Skin.px(tabPos.x)}px`;
      this.tabs.style.top = `${Skin.px(tabPos.y)}px`;
      this.tabs.style.width = `${Skin.px(tabSize.w)}px`;
      this.tabs.style.height = `${Skin.px(tabSize.h)}px`;
    }
    body.appendChild(this.tabs);
    for (const [key, label] of [['inventory', 'Inventory'], ['quest', 'Quest']]) {
      const t = document.createElement('div');
      t.style.cssText = 'flex:1;display:flex;align-items:center;'
        + 'justify-content:center;cursor:pointer;';
      t.addEventListener('click', () => { this.tab = key; this.render(); });
      this.tabs.appendChild(t);
      Font.set(t, label, { color: key === this.tab ? '#c9a959' : '#8a93a5' });
    }

    const panePos = P('InventoryItem');
    const paneSize = Layout.size(WND, 'InventoryItem');
    this.grid = document.createElement('div');
    const grid = Layout.grid(WND, 'InventoryItem');
    this.pitch = grid ? { x: grid.cellX + grid.gapX, y: grid.cellY + grid.gapY }
      : { x: 37, y: 35 };
    this.grid.style.cssText = 'position:absolute;display:flex;flex-wrap:wrap;'
      + 'align-content:flex-start;overflow-y:auto;pointer-events:auto;';
    if (panePos) {
      this.grid.style.left = `${Skin.px(panePos.x)}px`;
      this.grid.style.top = `${Skin.px(panePos.y)}px`;
      this.grid.style.width = `${Skin.px(paneSize.w)}px`;
      this.grid.style.height = `${Skin.px(paneSize.h)}px`;
    }
    body.appendChild(this.grid);
    this.grid.addEventListener('dragover', (e) => e.preventDefault());
    this.grid.addEventListener('drop', (e) => this._dropOnGrid(e));

    // --- paperdoll ---------------------------------------------------------
    this.doll = {};
    for (const [key, ax, ay] of DOLL_SLOTS) {
      const pos = key === 'underwear' ? P('EquipItem_Underwear') : null;
      const x = pos ? pos.x : ax, y = pos ? pos.y : ay;
      const el = this._dollSlot(key, x, y);
      body.appendChild(el);
      this.doll[key] = el;
    }
    // HennaItem: xdat control (223,39) 26x84 — our data model has no dyes;
    // renders as an empty framed column (AUTHORED: dye items not bridged).
    const hennaPos = P('HennaItem');
    const hennaSize = Layout.size(WND, 'HennaItem');
    if (hennaPos) {
      const el = document.createElement('div');
      el.className = 'doll-slot henna';
      el.title = 'Henna (not bridged)';
      el.style.cssText = `position:absolute;left:${Skin.px(hennaPos.x)}px;`
        + `top:${Skin.px(hennaPos.y)}px;width:${Skin.px(hennaSize.w)}px;`
        + `height:${Skin.px(hennaSize.h)}px;`;
      body.appendChild(el);
    }

    // --- bottom row: crystallize / trash / adena / weight ------------------
    this._bottomButton(body, 'CrystallizeButton', () => {
      const sel = this._selected();
      if (sel) this.onCrystallize(sel);
    }, 'Crystallize');
    this._bottomButton(body, 'TrashButton', () => {
      const sel = this._selected();
      if (sel) this.onDestroy(sel);
    }, 'Trash');

    const adenaIconPos = P('AdenaIcon');
    const adenaIconSize = Layout.size(WND, 'AdenaIcon');
    const adenaTex = Layout.tex0(WND, 'AdenaIcon');
    if (adenaIconPos && adenaTex) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${Skin.px(adenaIconPos.x)}px;`
        + `top:${Skin.px(adenaIconPos.y)}px;width:${Skin.px(adenaIconSize.w)}px;`
        + `height:${Skin.px(adenaIconSize.h)}px;pointer-events:none;`;
      Skin.apply(el, adenaTex);
      body.appendChild(el);
    }
    const adenaPos = P('AdenaText');
    this.adenaEl = document.createElement('div');
    this.adenaEl.style.cssText = 'position:absolute;pointer-events:none;';
    if (adenaPos) {
      this.adenaEl.style.left = `${Skin.px(adenaPos.x)}px`;
      this.adenaEl.style.top = `${Skin.px(adenaPos.y)}px`;
    }
    body.appendChild(this.adenaEl);

    const weightPos = P('InvenWeight');
    const weightSize = Layout.size(WND, 'InvenWeight');
    this.weightEl = document.createElement('div');
    this.weightEl.style.cssText = 'position:absolute;pointer-events:none;';
    if (weightPos) {
      this.weightEl.style.left = `${Skin.px(weightPos.x)}px`;
      this.weightEl.style.top = `${Skin.px(weightPos.y)}px`;
      this.weightEl.style.width = `${Skin.px(weightSize.w)}px`;
      this.weightEl.style.height = `${Skin.px(weightSize.h)}px`;
    }
    body.appendChild(this.weightEl);

    parent.appendChild(win.root);
    WndMgr.register('InventoryWnd', this, { handle: win.bar });
    this.place({ right: 12, top: 260 });
    this.defaultPlace = { right: 12, top: 260 };
  }

  // -- pieces ----------------------------------------------------------------

  _bottomButton(body, ctrl, onClick, label) {
    const pos = P2XY(ctrl);
    const size = Layout.size(WND, ctrl);
    const tex = Layout.tex(WND, ctrl).filter(r => Skin.sprite(r));
    if (!pos || !size) return;
    const el = document.createElement('div');
    el.className = 'inv-bottom-btn';
    el.title = label;
    el.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
      + `top:${Skin.px(pos.y)}px;width:${Skin.px(size.w)}px;`
      + `height:${Skin.px(size.h)}px;cursor:pointer;`;
    if (tex[0]) Skin.apply(el, tex[0]);
    el.addEventListener('click', onClick);
    body.appendChild(el);
  }

  _dollSlot(key, x, y) {
    const el = document.createElement('div');
    el.className = 'doll-slot';
    el.dataset.slot = key;
    el.title = key;
    el.style.cssText = `position:absolute;left:${Skin.px(x)}px;`
      + `top:${Skin.px(y)}px;width:${Skin.px(DOLL_CELL)}px;`
      + `height:${Skin.px(DOLL_CELL)}px;`;
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/x-l2vzla'));
        if (data.type === 'item') this.onUse(data.id);   // aCis UseItem equips
      } catch { /* not ours */ }
    });
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      const oid = el.dataset.oid;
      if (!oid) { e.preventDefault(); return; }
      // DragSrcName = EquipItem* (uc): dragging out of the doll UNEQUIPS —
      // aCis UseItem on an equipped item unequips (UseItem.java:128).
      e.dataTransfer.setData('application/x-l2vzla',
        JSON.stringify({ type: 'item', id: Number(oid), from: 'equip' }));
    });
    return el;
  }

  _dropOnGrid(e) {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('application/x-l2vzla')); }
    catch { return; }
    if (data.type !== 'item') return;
    if (data.from === 'equip') {
      this.onUse(data.id);   // unequip path (see _dollSlot note)
      return;
    }
    // reorder: client-side only, exactly like InventoryWnd.uc OnDropItem
    // (SwapItems, no packet)
    const to = e.target.closest('.inv-cell');
    if (to && to.dataset.oid && Number(to.dataset.oid) !== data.id) {
      const from = this.order.indexOf(data.id);
      const ti = this.order.indexOf(Number(to.dataset.oid));
      if (from >= 0 && ti >= 0) {
        this.order.splice(ti, 0, ...this.order.splice(from, 1));
        this.render();
      }
    }
  }

  _selected() { return null; }   // no selection model yet (buttons act on drag)

  // -- data ------------------------------------------------------------------

  async setItems(items) {
    if (!this.meta) this.meta = await itemMeta();
    this.items.clear();
    for (const it of items) {
      this.items.set(it.objectId, it);
      if (!this.order.includes(it.objectId)) this.order.push(it.objectId);
    }
    this.order = this.order.filter(oid => this.items.has(oid));
    this.render();
  }

  async applyUpdate(updated) {
    if (!this.meta) this.meta = await itemMeta();
    const CHANGE = { 1: 'add', 2: 'modify', 3: 'remove' };
    for (const u of updated) {
      const change = CHANGE[u.change] || u.change;
      if (change === 'remove') {
        this.items.delete(u.objectId);
        this.order = this.order.filter(oid => oid !== u.objectId);
      } else {
        this.items.set(u.objectId, { ...(this.items.get(u.objectId) || {}), ...u });
        if (!this.order.includes(u.objectId)) this.order.push(u.objectId);
      }
    }
    this.render();
  }

  toggle(force) {
    const show = force ?? this.win.root.style.display === 'none';
    if (show) { this.render(); this.win.show(); }
    else this.win.hide();
  }

  place(o) { this.win.place(o || this.defaultPlace); return this; }
  onDefaultPosition() { this.place(this.defaultPlace); }

  // -- render ------------------------------------------------------------------

  render() {
    if (!this.meta) return;
    // grid
    this.grid.innerHTML = '';
    const questTab = this.tab === 'quest';
    for (const oid of this.order) {
      const it = this.items.get(oid);
      if (!it) continue;
      // quest tab: the datapack has no quest flag in our item meta; show an
      // empty pane (AUTHORED: quest classification needs itemmeta 'quest')
      if (questTab) continue;
      const info = itemInfo(this.meta, it.itemId);
      const el = document.createElement('div');
      el.className = 'inv-cell';
      el.dataset.oid = it.objectId;
      const enchant = it.enchant ? ` +${it.enchant}` : '';
      el.title = `${info.name}${enchant}${it.equipped ? ' (equipped)' : ''}`;
      el.style.cssText = `width:${Skin.px(this.pitch.x)}px;height:${Skin.px(this.pitch.y)}px;`
        + 'display:flex;align-items:center;justify-content:center;';
      el.innerHTML = (info.icon
        ? `<img src="${info.icon}" alt="">`
        : '<div class="icon-fallback">?</div>')
        + (it.count > 1 ? `<span class="count">${it.count}</span>` : '');
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-l2vzla',
          JSON.stringify({ type: 'item', id: it.objectId }));
      });
      el.addEventListener('dblclick', () => this.onUse(it.objectId));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.onAssign({ type: 'item', id: it.objectId });
      });
      this.grid.appendChild(el);
    }

    // paperdoll: slot bitmask -> item (aCis SLOT_* tier 4)
    for (const el of Object.values(this.doll)) {
      delete el.dataset.oid;
      el.innerHTML = '';
      el.classList.remove('filled');
    }
    for (const it of this.items.values()) {
      if (!it.equipped) continue;
      const keys = [];
      for (const [key, bit] of SLOT_BITS) {
        if (it.slot & bit) keys.push(key);
      }
      for (const [bit, pair] of Object.entries(LR_PAIRS)) {
        if (it.slot & bit) keys.push(...pair);
      }
      const info = itemInfo(this.meta, it.itemId);
      for (const key of keys) {
        const el = this.doll[key];
        if (!el || el.dataset.oid) continue;
        el.dataset.oid = it.objectId;
        el.classList.add('filled');
        el.title = `${info.name}${it.enchant ? ' +' + it.enchant : ''} (equipped)`;
        el.innerHTML = info.icon ? `<img src="${info.icon}" alt="">`
          : '<div class="icon-fallback">?</div>';
      }
    }

    // adena + weight
    const adena = [...this.items.values()].find(it => it.itemId === ADENA_ID);
    Font.set(this.adenaEl, adena ? String(adena.count) : '0', { color: '#e8dcc0' });
    const cs = this.getCharSheet();
    // InvenWeight shows current/max load; our charSheet op has no weight
    // fields — left empty rather than invented (gateway would need to
    // forward maxLoad/curLoad from UserInfo).
    Font.set(this.weightEl, cs && cs.maxLoad != null ? `${cs.curLoad ?? '?'}/${cs.maxLoad}` : '', { color: '#8a93a5' });

    for (const [i, t] of [...this.tabs.children].entries()) {
      const key = i === 0 ? 'inventory' : 'quest';
      Font.set(t, i === 0 ? 'Inventory' : 'Quest',
        { color: key === this.tab ? '#c9a959' : '#8a93a5' });
    }
  }
}

// body-relative position helper for bottom-row controls
function P2XY(ctrl) {
  const p = Layout.pos(WND, ctrl);
  return p ? { x: p.x, y: p.y - TITLEBAR_H } : null;
}
