// Phase C.11 — ShopWnd, the retail NPC shop window.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   ShopWnd 256x401, dual pane: TopList 239x139 at
//                    (9,48) (the list you pick FROM) and BottomList
//                    239x104 at (9,215) (the cart), both 32px cells at
//                    the standard 37x35 pitch (decoded grid params).
//                    Up/Down buttons (112,194)/(130,194), OK (51,372),
//                    Cancel (131,372), TopText (11,32), BottomText
//                    (11,198), PriceConstText/PriceText (100,332)/(158,332),
//                    AdenaConstText/AdenaText (100,351)/(158,351).
//   ShopWnd.uc       NOT tabs — two modes: ShopBuy (top = merchant's
//                    items, bottom = what you will buy) and ShopSell (top
//                    = your inventory, bottom = what you will sell).
//                    Double-click (uc:91) or the Up/Down buttons (uc:70)
//                    move items between the lists; STACKABLES ask the
//                    amount with DIALOG_NumberPad (uc:130-141), everything
//                    else moves 1 (buy mode always moves exactly 1,
//                    uc:164). The cart stacks by class id (uc:243-245).
//                    Price total accumulates price x count (uc:174/216)
//                    and renders via MakeCostString (uc:356/425 — the
//                    retail thousand-separator formatting; the tooltip
//                    spells the number out). OK packs the cart into
//                    RequestBuyItem/RequestSellItem and HIDES (uc:430-501);
//                    Cancel just hides (uc:86-87).
//   aCis             has NO buy-cancel packet (checked
//                    clientpackets/) — closing sends nothing.
//
// Contract (frozen ops): buyList{items:[{itemId,count,price}]} opens buy
// mode, sellList{items:[{objectId,itemId,count,price}]} opens sell mode
// (prices are server truth — never computed client-side). OK sends
// buy{items:[{itemId,count}]} / sell{items:[{objectId,count}]}. Results
// arrive ONLY via invUpdate (server truth; failures come back as sysMsg
// in chat — the window never assumes success).
//
// Gaps marked AUTHORED: the amount prompt stands in for DIALOG_NumberPad
// (the port has no dialog framework); pane labels/title ('Shop',
// 'Merchant'/'Inventory', 'Cart', 'Price:', 'Adena:') are English —
// retail uses system strings 136-143, not extracted. Stackability comes
// from the list count (itemmeta carries no flag): count != 1 prompts,
// count == 1 moves without one. InvenWeight is skipped (no weight data
// in the contract).

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { itemMeta, itemInfo } from '../gamedata.js';

const WND = 'ShopWnd';
// Text colour is never typed here. Every label and value resolves through
// Layout.textColor(WND, <record>), which reads the control's own
// Interface.xdat colour and falls back to NCTextBox's own default. ShopWnd's
// six TextBox records -- TopText, BottomText, PriceConstText, AdenaConstText,
// PriceText, AdenaText -- are all #DCDCDC; the port previously painted them
// #b09b79 on the strength of QuestTreeWnd.uc:570, which governs a different
// control in a different window.

// MakeCostString (ShopWnd.uc:356/425) — retail renders costs with
// thousand separators; the tooltip (ConvertNumToText) spells it out
function costString(n) {
  return Math.round(n).toLocaleString('en-US');
}

export class ShopWnd {
  constructor(parent = document.body, { onBuy, onSell, getAdena } = {}) {
    this.onBuy = onBuy || (() => {});
    this.onSell = onSell || (() => {});
    this.getAdena = getAdena || (() => 0);
    this.mode = null;          // 'buy' | 'sell'
    this.topItems = [];        // server list (buy list or sell list)
    this.cart = new Map();     // key -> {itemId, objectId, count, price, name, icon}
    this.selected = null;      // {pane, key}

    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 256;
    this.h = def && def.height ? def.height : 401;

    const win = new L2Window({
      title: 'Shop', width: this.w, height: this.h, closable: true,
      winName: WND,
    });
    win.root.id = 'l2-shopwnd';
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
      el.className = `l2-shop-${key}`;
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

    // pane labels at their mined rects (11,32) / (11,198)
    this.labels = {};
    for (const [key, ctrl] of [['top', 'TopText'], ['bottom', 'BottomText']]) {
      const pos = Layout.pos(WND, ctrl);
      if (!pos) continue;
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`;
      win.body.appendChild(el);
      this.labels[key] = el;
    }

    // Up/Down buttons (move the selected entry between the lists)
    this._ctrlBtn('UpButton', () => this._moveSelected('bottom'));
    this._ctrlBtn('DownButton', () => this._moveSelected('top'));

    // footer: price + adena lines at their mined rects, then OK/Cancel
    this.priceEl = this._footerText('PriceText', 'PriceConstText', 'Price:');
    this.adenaEl = this._footerText('AdenaText', 'AdenaConstText', 'Adena:');
    this._ctrlBtn('OKButton', () => this._ok(), 'OK');
    this._ctrlBtn('CancelButton', () => this.hide(), 'Cancel');

    parent.appendChild(win.root);
    // AUTHORED dock (WindowsInfo.ini not mined for this window); same
    // family spot as the other toggle windows.
    this.defaultPlace = { right: 12, top: 60 };
    this._buildAmountPrompt(parent);
  }

  _ctrlBtn(ctrl, onClick, label = null) {
    const pos = Layout.pos(WND, ctrl);
    const size = Layout.size(WND, ctrl) || { w: 76, h: 23 };
    if (!pos) return null;
    const b = document.createElement('div');
    b.className = 'l2-shop-btn';
    b.dataset.id = ctrl;
    b.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
      + `top:${Skin.px(pos.y)}px;width:${Skin.px(size.w)}px;`
      + `height:${Skin.px(size.h)}px;cursor:pointer;display:flex;`
      + 'align-items:center;justify-content:center;';
    const tex = Layout.tex(WND, ctrl).filter(r => Skin.sprite(r));
    if (tex[0]) Skin.apply(b, tex[0], { stretch: true });
    // Button labels carry no colour in the xdat (352 Button records, none
    // coloured); NCButton picks it per draw. SOURCED NWindow.dll 0x100035a8.
    if (label) Font.set(b, label, { color: Layout.native('buttonLabel') });
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
      // the label's own record governs its colour (ShopWnd/PriceConstText,
      // ShopWnd/AdenaConstText -- both #DCDCDC in Interface.xdat)
      Font.set(l, label, { color: Layout.textColor(WND, labelCtrl) });
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

  openBuy(items) {
    this.mode = 'buy';
    this.topItems = items || [];
    this.cart.clear();
    this.selected = null;
    this._renderLabels();
    this._render();
    this.show();
  }

  openSell(items) {
    this.mode = 'sell';
    this.topItems = items || [];
    this.cart.clear();
    this.selected = null;
    this._renderLabels();
    this._render();
    this.show();
  }

  _renderLabels() {
    // AUTHORED English (retail: system strings 136-143, not extracted)
    if (this.labels.top) {
      Font.set(this.labels.top, this.mode === 'buy' ? 'Merchant' : 'Inventory',
               { color: Layout.textColor(WND, 'TopText') });
    }
    if (this.labels.bottom) {
      Font.set(this.labels.bottom, 'Cart',
               { color: Layout.textColor(WND, 'BottomText') });
    }
    this.win.setTitle('Shop');
  }

  // -- the cart ---------------------------------------------------------------

  _key(t) { return this.mode === 'sell' ? `o${t.objectId}` : `i${t.itemId}`; }

  _moveToCart(item, count) {
    const key = this._key(item);
    const existing = this.cart.get(key);
    const add = Math.min(count, this.mode === 'sell' ? item.count : count);
    if (add <= 0) return;
    if (existing) existing.count += add;
    else {
      this.cart.set(key, {
        itemId: item.itemId, objectId: item.objectId,
        count: add, price: item.price, name: item.name, icon: item.icon,
      });
    }
    if (this.mode === 'sell') {
      item.count -= add;
      if (item.count <= 0) this.topItems.splice(this.topItems.indexOf(item), 1);
    }
    this.selected = null;
    this._render();
  }

  _moveBack(entry, count) {
    const key = this._key(entry);
    const add = Math.min(count, entry.count);
    if (add <= 0) return;
    entry.count -= add;
    if (entry.count <= 0) this.cart.delete(key);
    if (this.mode === 'sell') {
      const back = this.topItems.find(t => t.objectId === entry.objectId);
      if (back) back.count += add;
      else {
        this.topItems.push({
          objectId: entry.objectId, itemId: entry.itemId,
          count: add, price: entry.price, name: entry.name, icon: entry.icon,
        });
      }
    }
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
   *  (DIALOG_NumberPad in the .uc — our prompt stands in), the rest
   *  move 1 (buy mode moves exactly 1, uc:164). */
  _offerMove(entry, pane) {
    const toCart = pane === 'top';
    const stackable = entry.count !== 1;   // itemmeta carries no flag
    if (stackable) {
      this._askAmount(
        // buy from the merchant is unbounded by the list (count is stock,
        // uc:164 ignores it) — the adena line bounds it honestly
        toCart && this.mode === 'buy' ? Infinity : entry.count,
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
    win.root.id = 'l2-shop-amount';
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
    Font.set(ok, 'OK', { color: Layout.native('buttonLabel') });
    win.body.appendChild(ok);
    // AUTHORED (same prompt layout as above — the cancel mirrors OK)
    const cancel = document.createElement('div');
    cancel.style.cssText = ok.style.cssText.replace(
      /left:\s*\d+(?:\.\d+)?px/, 'left:' + Skin.px(94) + 'px');
    Skin.apply(cancel, 'L2UI_CH3.BUTTON.Btn1_normal', { stretch: true });
    Font.set(cancel, 'Cancel', { color: Layout.native('buttonLabel') });
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
    cell.className = 'l2-shop-cell';
    cell.dataset.key = this._key(entry);
    cell.style.cssText = 'position:relative;display:inline-block;overflow:hidden;'
      + `width:${Skin.px(this.panes[pane].pitch.x)}px;`
      + `height:${Skin.px(this.panes[pane].pitch.y)}px;`
      + 'cursor:pointer;vertical-align:top;'
      + (this.selected && this.selected.pane === pane && this.selected.index === index
        ? 'outline:1px solid #c8a959;' : '');
    cell.title = `${entry.name || info.name} — ${costString(entry.price)} a`
      + (this.mode === 'sell' && pane === 'top' ? ' (sell price)' : '');
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
      // AUTHORED: retail draws nothing when an icon is missing -- NCItemWnd
      // paints the slot art and the icon texture, with no placeholder glyph.
      // This '?' is a port-only affordance, so no record can govern it.
      Font.set(icon, '?', { color: '#8a93a5' });
    }
    cell.appendChild(icon);
    const shown = pane === 'top' ? entry.count : entry.count;
    if (shown > 1) {
      const c = document.createElement('div');
      c.style.cssText = 'position:absolute;right:2px;bottom:0;pointer-events:none;'
        + 'text-shadow:0 1px 1px #000;';
      Font.set(c, String(shown > 9999 ? '9999+' : shown),
               { color: Layout.native('itemSlotCount') });
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
    for (let i = 0; i < this.topItems.length; i++) {
      top.appendChild(await this._cell(this.topItems[i], 'top', i));
    }
    const cartItems = [...this.cart.values()];
    for (let i = 0; i < cartItems.length; i++) {
      bottom.appendChild(await this._cell(cartItems[i], 'bottom', i));
    }
    // price total: accumulated price x count (uc:174/216), MakeCostString
    const total = cartItems.reduce((s, e) => s + e.price * e.count, 0);
    Font.set(this.priceEl, costString(total),
             { color: Layout.textColor(WND, 'PriceText') });
    this.priceEl.title = String(total);   // ConvertNumToText stand-in
    this._renderAdena();
  }

  /** Adena line follows the inventory (server truth via invUpdate). */
  _renderAdena() {
    const adena = this.getAdena();
    Font.set(this.adenaEl, costString(adena),
             { color: Layout.textColor(WND, 'AdenaText') });
    this.adenaEl.title = String(adena);
  }

  onInvUpdate() {
    if (this.visible) this._renderAdena();
  }

  // -- OK / Cancel ---------------------------------------------------------------

  _ok() {
    const items = [...this.cart.values()];
    if (!items.length) return;
    if (this.mode === 'buy') {
      this.onBuy(items.map(e => ({ itemId: e.itemId, count: e.count })));
    } else {
      this.onSell(items.map(e => ({ objectId: e.objectId, count: e.count })));
    }
    // the .uc hides on OK (uc:501); the result arrives via invUpdate —
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
