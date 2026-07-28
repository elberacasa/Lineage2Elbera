// Phase C.14 — WarehouseWnd, the retail warehouse keeper window (M16).
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   WarehouseWnd 256x401 — the SAME chrome as ShopWnd:
//                    TopList 239x139 at (9,48) (the list you pick FROM) and
//                    BottomList 239x104 at (9,215) (the staging list), both
//                    32px cells at the standard 37x35 pitch (decoded grid
//                    params). Up/Down buttons (112,194)/(130,194), OK
//                    (51,372), Cancel (131,372), TopText (11,32), BottomText
//                    (11,198), PriceConstText/PriceText (100,332)/(158,332),
//                    AdenaConstText/AdenaText (100,351)/(158,351).
//                    TopCountText/BottomCountText decode with NO position —
//                    their placement here is AUTHORED (the xdat acceptance
//                    test rejected those coords; never guessed back).
//   WarehouseWnd.uc  ONE window, two modes (WT_Deposit/WT_Withdraw, uc:19-23).
//                    TopList is the source (deposit: own inventory, uc:360;
//                    withdraw: warehouse contents, uc:368), BottomList the
//                    staging list. Double-click (uc:111-122) or Up/Down
//                    (uc:87-99) move entries; STACKABLES with count > 1 ask
//                    the amount with DIALOG_NumberPad (uc:163-170/202-208),
//                    the rest move whole. Entries merge by class id in the
//                    receiving list (uc:176/213). FEE: KEEPING_PRICE = 30
//                    adena PER STAGED ENTRY (uc:3), deposit mode only,
//                    rendered in PriceText via MakeCostString (uc:386-397);
//                    withdraw leaves PriceText at "0" (uc:57 + AdjustPrice
//                    does nothing for WT_Withdraw). The entry count renders
//                    as "(num/max)" (uc:399-419): BottomCountText in deposit,
//                    TopCountText in withdraw. OK packs the bottom list and
//                    HIDES (uc:421-455); Cancel just hides (uc:104-108).
//                    Opening HIDES the inventory window (uc:351-354 — wired
//                    in main.js).
//   aCis             has no warehouse cancel packet (checked
//                    clientpackets/) — closing sends nothing.
//
// Contract (frozen ops, gateway README M16): whDeposit{whType, adena, items}
// opens deposit mode (own inventory, deposit-eligible), whWithdraw{whType,
// adena, items} opens withdraw mode (warehouse contents). whType: 1 private,
// 2 clan, 3 castle, 4 freight. OK sends whDepositItems / whWithdrawItems
// with {objectId, count} per staged entry. ADENA IS A NORMAL ENTRY (itemId
// 57) — staged and sent like any other stack. Results arrive ONLY via
// invUpdate (server truth; failures come back as sysMsg in chat — the
// window never assumes success). An EMPTY warehouse answers WithdrawP with
// sysMsg 282 only — no op, no window. Stackables get NEW objectIds across
// the transfer: objectIds are always taken from the list being answered,
// never remembered across ops.
//
// Gaps marked AUTHORED: the amount prompt stands in for DIALOG_NumberPad
// (the port has no dialog framework); pane labels/title ('Warehouse',
// 'Inventory', 'Fee:', 'Adena:') are English — retail uses system strings
// 131-138 and 1216-1218, not extracted. Stackability comes from the list
// count (itemmeta carries no flag): count > 1 prompts and merges by itemId,
// count == 1 moves whole keyed by objectId. The count cap is the .uc's
// DEFAULT_MAX_COUNT (200, uc:5) — the real per-warehouse max rides
// EV_SetMaxCount (uc:457-461), which the frozen contract does not carry.
// InvenWeight is skipped (no weight data in the contract).

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { itemMeta, itemInfo } from '../gamedata.js';

const WND = 'WarehouseWnd';
const SUB_COLOR = '#b09b79';   // the L2 secondary text tone (QuestTreeWnd.uc:570)

const KEEPING_PRICE = 30;      // SOURCED WarehouseWnd.uc:3
const DEFAULT_MAX_COUNT = 200; // SOURCED WarehouseWnd.uc:5 (see header)

// MakeCostString (WarehouseWnd.uc:347/393) — retail renders costs with
// thousand separators; the tooltip (ConvertNumToText) spells it out
function costString(n) {
  return Math.round(n).toLocaleString('en-US');
}

export class WarehouseWnd {
  constructor(parent = document.body, { onDeposit, onWithdraw, getAdena } = {}) {
    this.onDeposit = onDeposit || (() => {});
    this.onWithdraw = onWithdraw || (() => {});
    this.getAdena = getAdena || (() => 0);
    this.mode = null;          // 'deposit' | 'withdraw'
    this.whType = 1;           // 1 private, 2 clan, 3 castle, 4 freight (M16)
    this.topItems = [];        // source list (deposit: inventory; withdraw: wh)
    this.cart = new Map();     // key -> {objectId, itemId, count, enchant, name, icon}
    this.selected = null;      // {pane, index}

    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 256;
    this.h = def && def.height ? def.height : 401;

    const win = new L2Window({
      title: 'Warehouse', width: this.w, height: this.h, closable: true,
      winName: WND,
    });
    win.root.id = 'l2-warehousewnd';
    win.onClose = () => this.hide();   // no cancel packet exists (aCis)
    this.win = win;
    this.root = win.root;

    this.panes = {};
    for (const [key, ctrl] of [['top', 'TopList'], ['bottom', 'BottomList']]) {
      const pos = Layout.pos(WND, ctrl) ?? { x: 9, y: key === 'top' ? 48 : 215 };
      const size = Layout.size(WND, ctrl) || { w: 239, h: 104 };
      const grid = Layout.grid(WND, ctrl)
        || { cellX: 32, cellY: 32, gapX: 5, gapY: 3 };
      const el = document.createElement('div');
      el.className = `l2-wh-${key}`;
      el.style.cssText = 'position:absolute;overflow-y:auto;overflow-x:hidden;'
        + 'pointer-events:auto;'
        + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`
        + `width:${Skin.px(size.w)}px;height:${Skin.px(size.h)}px;`;
      win.body.appendChild(el);
      this.panes[key] = {
        el,
        icon: grid.cellX,   // 32px icon cell (xdat grid decode)
        pitch: { x: grid.cellX + grid.gapX, y: grid.cellY + grid.gapY },
      };
    }

    // pane labels at their mined rects (11,32) / (11,198); the entry count
    // sits on the same rows — the xdat carries NO position for the count
    // texts, so the right-edge alignment here is AUTHORED
    this.labels = {};
    this.counts = {};
    for (const [key, ctrl] of [['top', 'TopText'], ['bottom', 'BottomText']]) {
      const pos = Layout.pos(WND, ctrl);
      if (!pos) continue;
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`;
      win.body.appendChild(el);
      this.labels[key] = el;
      const c = document.createElement('div');
      // AUTHORED: the xdat carries NO position for the count texts — the
      // right-edge inset (aligned with the pane's 9px left edge) is ours
      c.style.cssText = 'position:absolute;pointer-events:none;text-align:right;'
        + `right:${Skin.px(9)}px;top:${Skin.px(pos.y)}px;`;
      win.body.appendChild(c);
      this.counts[key] = c;
    }

    // Up/Down buttons (move the selected entry between the lists)
    this._ctrlBtn('UpButton', () => this._moveSelected('bottom'));
    this._ctrlBtn('DownButton', () => this._moveSelected('top'));

    // footer: fee + adena lines at their mined rects, then OK/Cancel
    this.priceEl = this._footerText('PriceText', 'PriceConstText', 'Fee:');
    this.adenaEl = this._footerText('AdenaText', 'AdenaConstText', 'Adena:');
    this._ctrlBtn('OKButton', () => this._ok(), 'OK');
    this._ctrlBtn('CancelButton', () => this.hide(), 'Cancel');

    parent.appendChild(win.root);
    // AUTHORED dock (WindowsInfo.ini not mined for this window); same
    // family spot as the other trade windows.
    this.defaultPlace = { right: 12, top: 60 };
    this._buildAmountPrompt(parent);
  }

  _ctrlBtn(ctrl, onClick, label = null) {
    const pos = Layout.pos(WND, ctrl);
    const size = Layout.size(WND, ctrl) || { w: 76, h: 23 };
    if (!pos) return null;
    const b = document.createElement('div');
    b.className = 'l2-wh-btn';
    b.dataset.id = ctrl;
    b.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
      + `top:${Skin.px(pos.y)}px;width:${Skin.px(size.w)}px;`
      + `height:${Skin.px(size.h)}px;cursor:pointer;display:flex;`
      + 'align-items:center;justify-content:center;';
    const tex = Layout.tex(WND, ctrl).filter(r => Skin.sprite(r));
    if (tex[0]) Skin.apply(b, tex[0], { stretch: true });
    if (label) Font.set(b, label, { color: '#c9a959' });   // AUTHORED
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    this.win.body.appendChild(b);
    return b;
  }

  _footerText(valueCtrl, labelCtrl, label) {
    const lp = Layout.pos(WND, labelCtrl);
    if (lp) {
      const l = document.createElement('div');
      l.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(lp.x)}px;top:${Skin.px(lp.y)}px;`;
      Font.set(l, label, { color: SUB_COLOR });   // AUTHORED label text
      this.win.body.appendChild(l);
    }
    const vp = Layout.pos(WND, valueCtrl);
    const vSize = Layout.size(WND, valueCtrl) || { w: 89 };
    const v = document.createElement('div');
    v.style.cssText = 'position:absolute;pointer-events:none;text-align:right;'
      + `left:${Skin.px((vp || { x: 158 }).x)}px;top:${Skin.px((vp || { y: 332 }).y)}px;`
      + `width:${Skin.px(vSize.w)}px;`;
    this.win.body.appendChild(v);
    return v;
  }

  // -- open modes ------------------------------------------------------------

  openDeposit(msg) {
    this._open('deposit', msg);
  }

  openWithdraw(msg) {
    this._open('withdraw', msg);
  }

  _open(mode, msg) {
    this.mode = mode;
    this.whType = msg.whType || 1;
    this.adena = msg.adena || 0;
    // the op's list is the ONLY source of objectIds (M16: stackables get
    // new ones across the transfer) — copy it, never reuse an older one
    this.topItems = (msg.items || []).map(i => ({ ...i }));
    this.cart.clear();
    this.selected = null;
    this._renderLabels();
    this._render();
    this.show();
  }

  _renderLabels() {
    // AUTHORED English (retail: system strings 131-138 + titles 1216-1218,
    // not extracted). uc:358-373: deposit top = inventory, bottom =
    // warehouse; withdraw mirrors it.
    const top = this.mode === 'deposit' ? 'Inventory' : 'Warehouse';
    const bottom = this.mode === 'deposit' ? 'Warehouse' : 'Inventory';
    if (this.labels.top) Font.set(this.labels.top, top, { color: SUB_COLOR });
    if (this.labels.bottom) Font.set(this.labels.bottom, bottom, { color: SUB_COLOR });
    this.win.setTitle(this.whType === 2 ? 'Clan Warehouse'
      : this.whType === 3 ? 'Castle Warehouse' : 'Warehouse');
  }

  // -- the staging list ---------------------------------------------------------

  // count > 1 = stackable (itemmeta carries no flag): those merge by class
  // id in the receiving list (uc:176/213); singles keep their objectId.
  // The cart entry KEEPS the flag it was staged with — deriving it from the
  // live count would flip the key mid-stack as counts drain.
  _stackable(e) { return e.count > 1; }
  _cartKey(e) { return e.stack ? `i${e.itemId}` : `o${e.objectId}`; }

  _moveToCart(item, count) {
    const add = Math.min(count, item.count);
    if (add <= 0) return;
    const stack = this._stackable(item);
    const key = stack ? `i${item.itemId}` : `o${item.objectId}`;
    const existing = this.cart.get(key);
    if (existing) existing.count += add;
    else {
      this.cart.set(key, {
        objectId: item.objectId, itemId: item.itemId, stack,
        count: add, enchant: item.enchant, name: item.name, icon: item.icon,
      });
    }
    item.count -= add;
    if (item.count <= 0) this.topItems.splice(this.topItems.indexOf(item), 1);
    this.selected = null;
    this._render();
  }

  _moveBack(entry, count) {
    const add = Math.min(count, entry.count);
    if (add <= 0) return;
    entry.count -= add;
    if (entry.count <= 0) this.cart.delete(this._cartKey(entry));
    if (entry.stack) {
      // stackables merge back into the source list by class id (uc:288-298)
      const back = this.topItems.find(t => t.itemId === entry.itemId);
      if (back) {
        back.count += add;
        this.selected = null;
        this._render();
        return;
      }
    }
    this.topItems.push({
      objectId: entry.objectId, itemId: entry.itemId,
      count: add, enchant: entry.enchant, name: entry.name, icon: entry.icon,
    });
    this.selected = null;
    this._render();
  }

  _moveSelected(pane) {
    if (!this.selected || this.selected.pane !== pane) return;
    const pool = pane === 'top' ? this.topItems : [...this.cart.values()];
    const entry = pool[this.selected.index];
    if (entry) this._offerMove(entry, pane);
  }

  /** Double-click / button entry point: stackables ask the amount
   *  (DIALOG_NumberPad in the .uc — our prompt stands in), the rest move
   *  whole (uc:163-170/202-208). Adena (itemId 57) is a stack like any
   *  other — no special path (M16). */
  _offerMove(entry, pane) {
    const toCart = pane === 'top';
    if (this._stackable(entry)) {
      this._askAmount(entry.count,
        (n) => { toCart ? this._moveToCart(entry, n) : this._moveBack(entry, n); });
    } else {
      toCart ? this._moveToCart(entry, 1) : this._moveBack(entry, 1);
    }
  }

  // -- amount prompt (AUTHORED — stands in for DIALOG_NumberPad) ---------------

  _buildAmountPrompt(parent) {
    const win = new L2Window({
      title: 'Amount', width: 180, height: 70, closable: false,
    });
    win.root.id = 'l2-wh-amount';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.value = '1';
    // AUTHORED prompt layout (there is no dialog framework to mirror)
    input.style.cssText = `position:absolute;left:${Skin.px(10)}px;`
      + `top:${Skin.px(10)}px;width:${Skin.px(160)}px;`
      + 'background:#10131a;border:1px solid #5a5344;color:#e8e0d0;'
      + 'font:12px sans-serif;';
    win.body.appendChild(input);
    const ok = document.createElement('div');
    ok.style.cssText = `position:absolute;left:${Skin.px(10)}px;`
      + `top:${Skin.px(38)}px;width:${Skin.px(76)}px;height:${Skin.px(23)}px;`
      + 'cursor:pointer;display:flex;align-items:center;justify-content:center;';
    Skin.apply(ok, 'L2UI_CH3.BUTTON.Btn1_normal', { stretch: true });
    Font.set(ok, 'OK', { color: '#c9a959' });
    win.body.appendChild(ok);
    // AUTHORED (same prompt layout as above — the cancel mirrors OK)
    const cancel = document.createElement('div');
    cancel.style.cssText = ok.style.cssText.replace(
      /left:\s*\d+(?:\.\d+)?px/, 'left:' + Skin.px(94) + 'px');
    Skin.apply(cancel, 'L2UI_CH3.BUTTON.Btn1_normal', { stretch: true });
    Font.set(cancel, 'Cancel', { color: '#c9a959' });
    win.body.appendChild(cancel);
    parent.appendChild(win.root);
    this.amountWin = win;
    this.amountInput = input;
    ok.addEventListener('click', () => {
      const max = this.amountMax;
      const n = Math.max(1, Math.min(max, parseInt(input.value, 10) || 1));
      win.hide();
      const cb = this.amountCb;
      this.amountCb = null;
      if (cb) cb(n);
    });
    cancel.addEventListener('click', () => {
      win.hide();
      this.amountCb = null;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
      e.stopPropagation();
    });
  }

  _askAmount(max, cb) {
    this.amountMax = max;
    this.amountCb = cb;
    this.amountInput.value = '1';
    // AUTHORED centering (the prompt is the port's own, nothing to mine)
    this.amountWin.place({
      left: window.innerWidth / 2 - Skin.px(90), top: window.innerHeight / 2 - Skin.px(35),
    });
    this.amountWin.show();
    this.amountInput.focus();
    this.amountInput.select();
  }

  // -- rendering ----------------------------------------------------------------

  async _cell(entry, pane, index) {
    const meta = await itemMeta();
    const info = itemInfo(meta, entry.itemId);
    const cell = document.createElement('div');
    cell.className = 'l2-wh-cell';
    // top cells key by OBJECT id (the verify picks entries from the op's
    // list); cart cells by the merge key
    cell.dataset.key = pane === 'top' ? `o${entry.objectId}` : this._cartKey(entry);
    cell.style.cssText = 'position:relative;display:inline-block;overflow:hidden;'
      + `width:${Skin.px(this.panes[pane].pitch.x)}px;`
      + `height:${Skin.px(this.panes[pane].pitch.y)}px;`
      + 'cursor:pointer;vertical-align:top;'
      + (this.selected && this.selected.pane === pane && this.selected.index === index
        ? 'outline:1px solid #c8a959;' : '');
    cell.title = entry.name || info.name;
    const icon = document.createElement('div');
    // the icon cell is the xdat grid's cellX (32) — from the pane record
    const cellIcon = this.panes[pane].icon;
    icon.style.cssText = `width:${Skin.px(cellIcon)}px;height:${Skin.px(cellIcon)}px;`
      + 'margin:0 auto;';
    if (info.icon) {
      const img = document.createElement('img');
      img.src = entry.icon || info.icon;
      img.style.cssText = `width:${Skin.px(cellIcon)}px;height:${Skin.px(cellIcon)}px;display:block;`;
      img.draggable = false;
      icon.appendChild(img);
    } else {
      Font.set(icon, '?', { color: '#8a93a5' });
    }
    cell.appendChild(icon);
    if (entry.count > 1) {
      const c = document.createElement('div');
      c.style.cssText = 'position:absolute;right:2px;bottom:0;pointer-events:none;'
        + 'text-shadow:0 1px 1px #000;';
      Font.set(c, String(entry.count > 9999 ? '9999+' : entry.count), { color: '#e8e8e8' });
      cell.appendChild(c);
    }
    cell.addEventListener('click', () => {
      this.selected = { pane, index };
      this._renderSelection();
    });
    cell.addEventListener('dblclick', () => this._offerMove(entry, pane));
    return cell;
  }

  _renderSelection() {
    for (const [pane, { el }] of Object.entries(this.panes)) {
      [...el.children].forEach((cell, i) => {
        cell.style.outline = (this.selected
          && this.selected.pane === pane && this.selected.index === i)
          ? '1px solid #c8a959' : '';
      });
    }
  }

  async _render() {
    const top = this.panes.top.el;
    const bottom = this.panes.bottom.el;
    top.replaceChildren();
    bottom.replaceChildren();
    if (!this.topItems.length) {
      // empty state (an emptied source list, or a whWithdraw with no rows):
      // retail shows the bare grid — the placeholder line is AUTHORED
      const empty = document.createElement('div');
      empty.className = 'l2-wh-empty';
      Font.set(empty, '(empty)', { color: SUB_COLOR });
      top.appendChild(empty);
    }
    for (let i = 0; i < this.topItems.length; i++) {
      top.appendChild(await this._cell(this.topItems[i], 'top', i));
    }
    const cartItems = [...this.cart.values()];
    for (let i = 0; i < cartItems.length; i++) {
      bottom.appendChild(await this._cell(cartItems[i], 'bottom', i));
    }
    // fee: 30 adena PER STAGED ENTRY, deposit mode only (uc:386-397);
    // withdraw leaves PriceText at "0" (uc:57)
    const fee = this.mode === 'deposit' ? cartItems.length * KEEPING_PRICE : 0;
    Font.set(this.priceEl, costString(fee), { color: '#e8dcc0' });
    this.priceEl.title = String(fee);   // ConvertNumToText stand-in
    // entry count "(num/max)" (uc:399-419): staged entries in deposit,
    // source entries in withdraw
    const num = this.mode === 'deposit' ? cartItems.length : this.topItems.length;
    const countEl = this.mode === 'deposit' ? this.counts.bottom : this.counts.top;
    const otherEl = this.mode === 'deposit' ? this.counts.top : this.counts.bottom;
    if (countEl) Font.set(countEl, `(${num}/${DEFAULT_MAX_COUNT})`, { color: SUB_COLOR });
    if (otherEl) otherEl.textContent = '';
    this._renderAdena();
  }

  /** Adena line: the op's adena field at open, then the inventory (server
   *  truth via invUpdate). */
  _renderAdena() {
    const adena = this.getAdena() || this.adena || 0;
    Font.set(this.adenaEl, costString(adena), { color: '#e8dcc0' });
    this.adenaEl.title = String(adena);
  }

  onInvUpdate() {
    if (this.visible) this._renderAdena();
  }

  // -- OK / Cancel ---------------------------------------------------------------

  _ok() {
    const items = [...this.cart.values()]
      .map(e => ({ objectId: e.objectId, count: e.count }));
    if (!items.length) return;
    if (this.mode === 'deposit') this.onDeposit(items);
    else this.onWithdraw(items);
    // the .uc hides on OK (uc:454); the result arrives via invUpdate —
    // failure is a sysMsg in chat, never assumed success here
    this.hide();
  }

  place(o = {}) { this.win.place(o); return this; }
  show() { this.win.show(); this._renderAdena(); return this; }
  hide() { this.win.hide(); if (this.amountWin) this.amountWin.hide(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { this.win.toggle(force); return this; }

  onDefaultPosition() {
    this.place(this.defaultPlace);
  }
}
