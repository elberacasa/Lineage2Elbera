// ElberaSkin runtime — InventoryWnd, the retail inventory window.
//
// GEOMETRY. Two sources, no typed numbers:
//   tier 1  Interface.xdat (docs/ui-mined-values.md §3, via Layout.*):
//           window 256x401, BackTexture 256x381 at (0,20) — the y=20 offset
//           is the titlebar, so controls sit at (x, y-20) in the L2Window
//           body. InventoryTab 189x23 at (12,159), InventoryItem/QuestItem
//           236x139 at (9,188) (tab alternates sharing one rect),
//           EquipItem_Underwear 34x34 at (137,36), HennaItem 26x84 at
//           (223,39), CrystallizeButton (14,351), TrashButton (208,351),
//           AdenaIcon 16x12 at (98,355), AdenaText 90 wide at (110,356),
//           InvenWeight 85x12 at (117,372).
//   tier 3  the window's own background art, measured by
//           tools/ui/mine_invslots.py and read through Layout.wells():
//           the 15 paperdoll wells and the 6x4 item-grid wells, because the
//           xdat decode recovers only ONE of the fifteen EquipItem_* records.
//           That harvest refuses to emit unless it reproduces every anchor
//           the xdat does give — the underwear slot, the grid origin, the
//           grid pitch, the grid extent and the weight gauge rect all land
//           on measured features. The previous AUTHORED paperdoll grid was
//           7px right of the wells the art paints; this is that fix.
//
// BEHAVIOUR. From InventoryWnd.uc (the client's own script, in
// assets/uscript/Interface):
//   * HandleAddItem (uc:745-753) routes each item to exactly ONE of three
//     places: equipped -> paperdoll, quest -> the QuestItem pane, else the
//     InventoryItem grid. Equipped items are therefore NOT listed in the
//     grid; the port used to show them in both.
//   * IsQuestItem (uc:390) is `ItemType == ITEM_QUESTITEM`, which on the
//     wire is ItemList's type2 field == 3 (aCis Item.TYPE2_QUEST).
//   * OnDropItem (uc:184-343): drag semantics. InventoryItem->InventoryItem
//     reorders CLIENT-SIDE with SwapItems and sends NO packet, so our
//     reorder is client-side too. EquipItem->InventoryItem unequips.
//     *->EquipItem equips. *->TrashButton destroys after a DIALOG_Warning,
//     *->CrystallizeButton crystallizes after one. The two bottom buttons
//     are DROP TARGETS, not click buttons — they used to be hidden here
//     because they were wired as clicks against a selection model that does
//     not exist.
//   Equip/unequip travels on the existing useItem op: aCis UseItem.java
//   unequips when the item is equipped (line 128) and equips otherwise
//   (line 141).

import { Layout } from './layout.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { L2Window } from './window.js';
import { WndMgr } from './wndmgr.js';
import { itemMeta, itemInfo, sysMsgMeta, renderSysMsg } from '../gamedata.js';

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
// Combined paperdoll masks aCis sends for the paired slots: the OR of the
// two single-slot bits declared immediately above (rear|lear, rfinger|lfinger)
// plus the two-hand marker. Every value here is a union of decoded bits, not
// a number of ours.
const LR_PAIRS = { 0x0006: ['rear', 'lear'], 0x0030: ['rfinger', 'lfinger'], 0x4000: ['rhand'] };

// Paperdoll slot names, in InventoryWnd.uc's EQUIPITEM_* order. Positions
// come from Layout.wells() (measured); this list only fixes which keys must
// exist, so a missing well shows as an absent slot rather than a guessed one.
const DOLL_KEYS = [
  'underwear', 'head', 'hair', 'hair2', 'neck', 'rhand', 'chest', 'lhand',
  'rear', 'lear', 'gloves', 'legs', 'feet', 'rfinger', 'lfinger',
];

const ADENA_ID = 57;      // aCis PcInventory.ADENA_ID (tier 4)
const TYPE2_QUEST = 3;    // aCis Item.TYPE2_QUEST — InventoryWnd.uc's ITEM_QUESTITEM

// The empty part of the weight gauge. MEASURED from Inventory_Back: the
// gauge well's unfilled interior is a flat rgb(10,10,10) (row y=364 of the
// texture), and the coloured bar is painted into the background beneath it,
// so "draining" the gauge means covering its right end with this colour.
const GAUGE_EMPTY = 'rgb(10,10,10)';

// The live InventoryWnd, registered at construction. Same escape hatch (and
// same reason) as skills.js `activeSkillFx()`: ShortcutWnd has to turn an
// item shortcut's objectId into an itemId to draw its icon and to mark it as
// a charged shot, and main.js — which owns every constructor wiring — is
// another worker's file. A module-level accessor keeps that dependency inside
// the two files this worker owns instead of adding a constructor option.
let _activeInventory = null;

/** The InventoryWnd main.js created, or null before boot / in unit tests. */
export function activeInventory() { return _activeInventory; }

export class InventoryWnd {
  constructor(parent = document.body, {
    onUse, onDestroy, onCrystallize, onAssign, getItems, getCharSheet,
  } = {}) {
    _activeInventory = this;
    this.onUse = onUse || (() => {});
    this.onDestroy = onDestroy || (() => {});
    this.onCrystallize = onCrystallize || (() => {});
    this.onAssign = onAssign || (() => {});
    this.getItems = getItems || (() => []);
    this.getCharSheet = getCharSheet || (() => null);
    this.tab = 'inventory';
    this.order = [];           // client-side reorder state (objectIds)
    this.items = new Map();
    this.wells = Layout.wells(WND);

    const def = Layout.window(WND);
    const backSize = Layout.size(WND, 'BackTexture');
    const wndSize = Layout.windowSize(WND);
    const w = backSize ? backSize.w : wndSize.w;
    const h = backSize ? backSize.h : wndSize.h - TITLEBAR_H;

    const win = new L2Window({
      title: 'Inventory', width: w, height: h, closable: true, winName: WND,
    });
    win.root.id = 'l2-inventorywnd';
    this.win = win;
    this.root = win.root;
    const body = win.body;
    body.style.overflow = 'hidden';

    // --- tab strip (inventory | quest), panes share the mined rect -------
    const tabPos = P(WND, 'InventoryTab');
    const tabSize = Layout.size(WND, 'InventoryTab');
    this.tabs = document.createElement('div');
    this.tabs.style.cssText = 'position:absolute;display:flex;';
    if (tabPos && tabSize) {
      place(this.tabs, tabPos.x, tabPos.y, tabSize.w, tabSize.h);
    }
    body.appendChild(this.tabs);
    for (const [key, label] of [['inventory', 'Inventory'], ['quest', 'Quest']]) {
      const t = document.createElement('div');
      t.dataset.tab = key;
      t.style.cssText = 'flex:1;display:flex;align-items:center;'
        + 'justify-content:center;cursor:pointer;';
      t.addEventListener('click', () => { this.tab = key; this.render(); });
      this.tabs.appendChild(t);
    }
    // the tab art the xdat names: [unselected, selected]
    this.tabTex = Layout.tex(WND, 'InventoryTab').filter(r => Skin.sprite(r));

    // --- item grid: cells at the measured wells ---------------------------
    const panePos = P(WND, 'InventoryItem');
    const paneSize = Layout.size(WND, 'InventoryItem');
    const g = Layout.grid(WND, 'InventoryItem');
    const gw = this.wells && this.wells.grid;
    // pitch and well size are the same number from two independent sources;
    // prefer the measured well (it carries the 34px frame the xdat's 32px
    // cell sits inside), fall back to the xdat's cell+gap.
    this.pitch = gw ? { x: gw.pitchX, y: gw.pitchY }
      : (g ? { x: g.cellX + g.gapX, y: g.cellY + g.gapY } : null);
    this.well = gw ? gw.well : (g ? g.cellX : null);
    this.icon = gw ? gw.icon : (g ? g.cellX : null);
    this.cols = gw ? gw.cols
      : (this.pitch && paneSize ? Math.floor(paneSize.w / this.pitch.x) : 0);

    this.grid = document.createElement('div');
    this.grid.style.cssText = 'position:absolute;overflow-y:auto;overflow-x:hidden;'
      + 'pointer-events:auto;';
    if (panePos && paneSize) place(this.grid, panePos.x, panePos.y, paneSize.w, paneSize.h);
    body.appendChild(this.grid);
    this.gridInner = document.createElement('div');
    this.gridInner.style.cssText = 'position:relative;width:100%;';
    this.grid.appendChild(this.gridInner);
    this.grid.addEventListener('dragover', (e) => e.preventDefault());
    this.grid.addEventListener('drop', (e) => this._dropOnGrid(e));

    // --- paperdoll: one cell per measured well ----------------------------
    this.doll = {};
    for (const key of DOLL_KEYS) {
      const r = this.wells && this.wells.doll[key];
      if (!r) continue;               // no measured well: draw nothing
      const el = this._dollSlot(key, r);
      body.appendChild(el);
      this.doll[key] = el;
    }
    // HennaItem: xdat control (223,39) 26x84 — our data model has no dyes;
    // the back art already draws its well, so nothing is painted over it.
    const hennaPos = P(WND, 'HennaItem');
    const hennaSize = Layout.size(WND, 'HennaItem');
    if (hennaPos && hennaSize) {
      const el = document.createElement('div');
      el.className = 'doll-slot henna';
      el.title = 'Henna (not bridged)';
      el.style.cssText = 'position:absolute;';
      place(el, hennaPos.x, hennaPos.y, hennaSize.w, hennaSize.h);
      body.appendChild(el);
    }

    // --- bottom row: crystallize / trash / adena / weight ------------------
    // Drop targets, per InventoryWnd.uc OnDropItem (uc:305 TrashButton,
    // uc:332 CrystallizeButton) — not click buttons.
    // The third argument is the confirmation systemmsg id the client shows
    // before the op: 336 "You are attempting to crystalize $s1..." and
    // 74 "Do you wish to destroy your $s1?" in systemmsg.json.
    this._dropButton(body, 'CrystallizeButton', 336, (oid) => this.onCrystallize(oid));
    this._dropButton(body, 'TrashButton', 74, (oid) => this.onDestroy(oid));

    const adenaIconPos = P(WND, 'AdenaIcon');
    const adenaIconSize = Layout.size(WND, 'AdenaIcon');
    const adenaTex = Layout.tex0(WND, 'AdenaIcon');
    if (adenaIconPos && adenaIconSize && adenaTex) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;';
      place(el, adenaIconPos.x, adenaIconPos.y, adenaIconSize.w, adenaIconSize.h);
      Skin.apply(el, adenaTex);
      body.appendChild(el);
    }
    // AdenaText is a TextBox 90 wide; the art's adena well ends one pixel
    // past its right edge, so the number is RIGHT-aligned in it. Left-aligned
    // it ran back over the coin icon.
    const adenaPos = P(WND, 'AdenaText');
    const adenaSize = Layout.size(WND, 'AdenaText');
    this.adenaEl = document.createElement('div');
    this.adenaEl.style.cssText = 'position:absolute;pointer-events:none;'
      + 'display:flex;justify-content:flex-end;';
    if (adenaPos && adenaSize) {
      place(this.adenaEl, adenaPos.x, adenaPos.y, adenaSize.w, null);
    }
    body.appendChild(this.adenaEl);

    // InvenWeight: the gauge's full-scale gradient is painted INTO
    // BackTexture at exactly this rect (mine_invslots.py proves the coloured
    // run equals the xdat control), so the control is an overlay that covers
    // the unfilled end rather than a sprite of its own.
    const weightPos = P(WND, 'InvenWeight');
    const weightSize = Layout.size(WND, 'InvenWeight');
    this.weightEl = document.createElement('div');
    this.weightEl.style.cssText = `position:absolute;pointer-events:none;`
      + `background:${GAUGE_EMPTY};display:none;`;
    if (weightPos && weightSize) {
      place(this.weightEl, weightPos.x, weightPos.y, weightSize.w, weightSize.h);
    }
    body.appendChild(this.weightEl);

    parent.appendChild(win.root);
    WndMgr.register('InventoryWnd', this, { handle: win.bar });
    // Dock READ from WindowsInfo.ini [InventoryWnd] via Layout.dock() — the
    // client's own file, mined by tools/ui/mine_windowsinfo.py. Absolute
    // retail px at 1024x768 (Skin.px applies the uiScale; no proportional
    // rescale). Null only if that harvest is missing, in which case the
    // window opens where WndMgr left it rather than at a typed spot.
    const dock = Layout.dock('InventoryWnd');
    this.defaultPlace = dock ? { left: dock.x, top: dock.y } : null;
    if (this.defaultPlace) this.place(this.defaultPlace);
  }

  // -- pieces ----------------------------------------------------------------

  /** A bottom-row control that accepts a dropped item, with the retail
   *  confirmation text (systemmsg-e.dat, the same id the .uc passes to
   *  DialogShow). */
  _dropButton(body, ctrl, sysMsgId, act) {
    const pos = P(WND, ctrl);
    const size = Layout.size(WND, ctrl);
    const tex = Layout.tex(WND, ctrl).filter(r => Skin.sprite(r));
    if (!pos || !size) return;
    const el = document.createElement('div');
    el.className = 'inv-bottom-btn';
    el.dataset.ctrl = ctrl;
    el.style.cssText = 'position:absolute;cursor:pointer;';
    place(el, pos.x, pos.y, size.w, size.h);
    if (tex[0]) Skin.apply(el, tex[0], { content: size });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('over');
      // the pressed/drag art the xdat names second
      if (tex[1]) Skin.apply(el, tex[0], { content: size });
      const data = readDrag(e);
      if (!data) return;
      const it = this.items.get(data.id);
      const name = it && this.meta ? itemInfo(this.meta, it.itemId).name : 'this item';
      if (window.confirm(this._confirmText(sysMsgId, name))) act(data.id);
    });
    body.appendChild(el);
    this[`${ctrl}El`] = el;
  }

  /** The retail confirmation line: the same systemmsg-e.dat id the .uc
   *  hands to DialogShow, with the item name substituted. */
  _confirmText(id, name) {
    return renderSysMsg(this.sysMsg, id, [name]);
  }

  _dollSlot(key, r) {
    const el = document.createElement('div');
    el.className = 'doll-slot';
    el.dataset.slot = key;
    el.title = key;
    el.style.cssText = 'position:absolute;';
    place(el, r.x, r.y, r.w, r.h);
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const data = readDrag(e);
      // uc:291-303 — *->EquipItem equips, EquipItem->EquipItem does nothing
      if (data && data.from !== 'equip') this.onUse(data.id);
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
    el.addEventListener('dblclick', () => {
      if (el.dataset.oid) this.onUse(Number(el.dataset.oid));
    });
    return el;
  }

  _dropOnGrid(e) {
    e.preventDefault();
    const data = readDrag(e);
    if (!data) return;
    if (data.from === 'equip') {
      this.onUse(data.id);   // unequip path (uc:227 RequestUnequipItem)
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

  // -- data ------------------------------------------------------------------

  /** Inventory object ids holding a given item type. Shortcut slots key on
   *  objectId, but the server talks about shots by itemId (ExAutoSoulShot,
   *  RequestAutoSoulShot both use getItemByItemId), so something has to
   *  bridge the two. Returns a list: a stack can legitimately be split. */
  objectIdsForItem(itemId) {
    const out = [];
    for (const [oid, it] of this.items) {
      if (it.itemId === itemId) out.push(oid);
    }
    return out;
  }

  async setItems(items) {
    if (!this.meta) this.meta = await itemMeta();
    if (!this.sysMsg) this.sysMsg = await sysMsgMeta();
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
    // InventoryUpdate's per-item change code, straight from the packet:
    // aCis writes 1=ADDED, 2=MODIFIED, 3=REMOVED (ItemInfo/InventoryUpdate).
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
  onDefaultPosition() { if (this.defaultPlace) this.place(this.defaultPlace); }

  // -- render ------------------------------------------------------------------

  /** InventoryWnd.uc HandleAddItem: equipped -> paperdoll, quest -> quest
   *  pane, everything else -> the grid. Each item lands in exactly one. */
  _paneOf(it) {
    if (it.equipped) return 'equip';
    // type2 is ItemList's item-type field; the gateway forwards it as
    // `type2` when present. Without it every item reads as non-quest, which
    // is why the quest tab is empty on a build whose bridge predates it.
    return it.type2 === TYPE2_QUEST ? 'quest' : 'inventory';
  }

  render() {
    if (!this.meta) return;
    this.gridInner.innerHTML = '';
    if (!this.pitch || !this.well) return;

    const listed = this.order
      .map(oid => this.items.get(oid))
      .filter(it => it && this._paneOf(it) === this.tab);

    for (const [i, it] of listed.entries()) {
      const col = i % this.cols, row = Math.floor(i / this.cols);
      const info = itemInfo(this.meta, it.itemId);
      const el = document.createElement('div');
      el.className = 'inv-cell';
      el.dataset.oid = it.objectId;
      const enchant = it.enchant ? ` +${it.enchant}` : '';
      el.title = `${info.name}${enchant}`;
      el.style.cssText = 'position:absolute;';
      place(el, col * this.pitch.x, row * this.pitch.y, this.well, this.well);
      // the icon is the xdat grid cell (32x32) centred in the 34x34 well
      const inset = Math.round((this.well - this.icon) / 2);
      el.innerHTML = (info.icon
        ? `<img src="${info.icon}" alt="" style="position:absolute;`
          + `left:${Skin.px(inset)}px;top:${Skin.px(inset)}px;`
          + `width:${Skin.px(this.icon)}px;height:${Skin.px(this.icon)}px">`
        : '<div class="icon-fallback">?</div>');
      if (it.count > 1) {
        const c = document.createElement('span');
        c.className = 'count';
        // the stack-count badge is drawn by NCItemWnd's own render, not by
        // any declared control: SOURCED NWindow.dll 0x1003118d
        Font.set(c, String(it.count), { color: Layout.native('itemSlotCount') });
        el.appendChild(c);
      }
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
      this.gridInner.appendChild(el);
    }
    // exact content height: (rows-1)*pitch + well, so the mined 4 rows fill
    // the mined 139px pane with no scrollbar and a 5th row starts one
    const rows = Math.max(1, Math.ceil(listed.length / this.cols));
    this.gridInner.style.height =
      `${Skin.px((rows - 1) * this.pitch.y + this.well)}px`;

    // paperdoll: slot bitmask -> item (aCis SLOT_* tier 4)
    for (const el of Object.values(this.doll)) {
      delete el.dataset.oid;
      el.innerHTML = '';
      el.classList.remove('filled');
      el.title = el.dataset.slot;
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
        const cell = this.wells.dollCell;
        const inset = Math.round((cell - (this.icon || cell)) / 2);
        el.innerHTML = info.icon
          ? `<img src="${info.icon}" alt="" style="position:absolute;`
            + `left:${Skin.px(inset)}px;top:${Skin.px(inset)}px;`
            + `width:${Skin.px(this.icon || cell)}px;`
            + `height:${Skin.px(this.icon || cell)}px">`
          : '<div class="icon-fallback">?</div>';
      }
    }

    // adena
    const adena = [...this.items.values()].find(it => it.itemId === ADENA_ID);
    // InventoryWnd/AdenaText is a TextBox and carries its own colour in
    // Interface.xdat; textColor() falls through to NCTextBox's own default
    // if it ever stops doing so.
    Font.set(this.adenaEl, adena ? String(adena.count) : '0',
      { color: Layout.textColor(WND, 'AdenaText') });

    // weight gauge — needs BOTH ends of the load, and now has both. UserInfo
    // carries getCurrentWeight() immediately before getWeightLimit()
    // (gameclient.js:1547-1548) and the bridge forwards the pair onto the
    // charSheet op as curLoad/maxLoad (bridge.js:794-795). The guard below
    // stays: if a payload ever arrives without them the gauge hides rather
    // than drawing an invented fill.
    const cs = this.getCharSheet();
    const hasLoad = cs && cs.maxLoad > 0 && cs.curLoad != null;
    this.weightEl.style.display = hasLoad ? '' : 'none';
    if (hasLoad) {
      const frac = Math.max(0, Math.min(1, cs.curLoad / cs.maxLoad));
      // cover the unfilled right end of the gradient baked into BackTexture
      this.weightEl.style.clipPath = `inset(0 0 0 ${frac * 100}%)`;
      this.weightEl.title = `${cs.curLoad} / ${cs.maxLoad}`;
    }

    // tab strip: the xdat names [unselected, selected] art for InventoryTab
    for (const t of this.tabs.children) {
      const on = t.dataset.tab === this.tab;
      const ref = this.tabTex[on ? 1 : 0] || this.tabTex[0];
      if (ref) Skin.apply(t, ref, { content: Skin.content(ref) });
      // The tab's LABEL colour does not encode selection in retail: the
      // InventoryTab record carries no colour, and NCTabButton shares
      // NCButton's slot-99 paint (asserted by tools/ui/mine_native_colors.py),
      // which picks the colour from enabled state alone. Both tabs are
      // enabled, so both take buttonLabel; selection is carried by the two
      // textures the record names, which the line above already swaps.
      Font.set(t, t.dataset.tab === 'quest' ? 'Quest' : 'Inventory',
        { color: Layout.native('buttonLabel') });
    }
  }
}

// -- helpers ----------------------------------------------------------------

/** Control position in BODY space: the xdat's y minus the titlebar. */
function P(win, ctrl) {
  const p = Layout.pos(win, ctrl);
  return p ? { x: p.x, y: p.y - TITLEBAR_H } : null;
}

/** Place an element at retail-pixel coordinates. */
function place(el, x, y, w, h) {
  el.style.left = `${Skin.px(x)}px`;
  el.style.top = `${Skin.px(y)}px`;
  if (w != null) el.style.width = `${Skin.px(w)}px`;
  if (h != null) el.style.height = `${Skin.px(h)}px`;
}

function readDrag(e) {
  try {
    const d = JSON.parse(e.dataTransfer.getData('application/x-l2vzla'));
    return d && d.type === 'item' ? d : null;
  } catch { return null; }
}
