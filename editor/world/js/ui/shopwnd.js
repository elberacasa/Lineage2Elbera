// Original Interlude ShopWnd: Interface.u ShopWnd.uc + Interface.xdat.
// Server lists open buy/sell mode, and their item prices/Adena are authoritative.
// Confirm packs every cart row; results arrive through ItemList/InventoryUpdate.
// No assumed success, no extra purchase confirmation, no local pricing.
// Source records/provenance and retained limits: docs/shop-playtest.md.
//
// Source transfer rules: ConsumeType1/2/3, NumberPad72, limited stock1338.
// The two original transfer paths differ: direct buy appends a row; quantity
// confirmation merges the first class match. Never infer this from stock.
// Remaining parity gaps: preview, native drag/AllItemCount, weight preview,
// original item tooltips, exact INT64 price/overflow semantics, badge painting,
// focus/key behavior and native button state art. See docs/shop-playtest.md.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { itemMeta, itemInfo, sysStringMeta, sysMsgMeta, renderSysMsg } from '../gamedata.js';
import { sharedDialogBox } from './dialogbox.js';
import { defaultWindowPosition, windowCornerInside } from './windowposition.js';

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
  constructor(parent = document.body, { onBuy, onSell, loadMetadata = () => Promise.all([itemMeta(), sysStringMeta(), sysMsgMeta()]) } = {}) {
    this.onBuy = onBuy || (() => {});
    this.onSell = onSell || (() => {});
    this.loadMetadata = loadMetadata;
    this.dialog = sharedDialogBox(parent);
    this.revision = 0;
    this.rowSerial = 0;
    this.pending = null;
    this.money = 0;
    this.currentPrice = 0;
    this.mode = null;          // 'buy' | 'sell'
    this.topItems = [];        // server list (buy list or sell list)
    this.cart = new Map();     // row identity; repeated nonstackable classes stay separate
    this.selected = null;      // {pane, key}

    const def = Layout.windowSize(WND);
    this.w = def.w;
    this.h = def.h;

    const win = new L2Window({
      title: '', width: this.w, height: this.h, closable: true,
      winName: WND, nativeBounds: true, back: 'none',
    });
    win.root.id = 'l2-shopwnd';
    win.onClose = () => this.hide();   // no cancel packet exists (aCis)
    this.win = win;
    this.root = win.root;
    this._paintBackdrop();

    this.panes = {};
    for (const [key, ctrl] of [['top', 'TopList'], ['bottom', 'BottomList']]) {
      const pos = Layout.posOf(WND, ctrl);
      const size = Layout.sizeOf(WND, ctrl);
      const grid = Layout.gridOf(WND, ctrl);
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
    this.okButton = this._ctrlBtn('OKButton', () => this._ok());
    this.cancelButton = this._ctrlBtn('CancelButton', () => this.hide());

    parent.appendChild(win.root);
    this.defaultPositionRule = Layout.windowDefault(WND);
    const p = Layout.window(WND)?.position;
    // This window's common source anchor references the parent, with matching
    // self/target anchors. Reuse the proven anchor arithmetic for that case.
    if (p && !p.target && p.selfAnchor === p.targetAnchor) {
      const creation = defaultWindowPosition({ anchor: p.selfAnchor, anchored: true,
        offsetX: p.offsetX, offsetY: p.offsetY }, { x: 0, y: 0, width: this.w, height: this.h }, this._parentRect());
      if (creation) this.place({ left: creation.x, top: creation.y });
    }

  }

  _paintBackdrop() {
    const record = Layout.find(WND, 'BackTexture');
    const size = record?.relativeSize, p = record?.position;
    if (!size || size.reference || !p || p.target || p.selfAnchor !== 1 || p.targetAnchor !== 1) return;
    // Original ShopWnd frame direction3 subtracts the20px title strip before
    // relative child height resolves. Texture type0 with zero source size
    // samples the control's own dimensions at1:1; it is not a nine-slice.
    // The title art and original native frame constant agree (source check).
    const w = this.w * size.widthRate + size.widthOffset;
    const h = (this.h - this.win.barH) * size.heightRate + size.heightOffset;
    if (![w, h, p.offsetX, p.offsetY].every(Number.isFinite) || w <= 0 || h <= 0) return;
    const texture = Layout.tex0(WND, 'BackTexture');
    if (!texture || !Skin.sprite(texture)) return;
    const el = this.win.backdrop;
    Skin.apply(el, texture, { content: { w, h } });
    Object.assign(el.style, { left: `${Skin.px(p.offsetX)}px`, top: `${Skin.px(p.offsetY)}px`,
      width: `${Skin.px(w)}px`, height: `${Skin.px(h)}px`, right: 'auto', bottom: 'auto' });
  }

  _ctrlBtn(ctrl, onClick, label = null) {
    const pos = Layout.pos(WND, ctrl);
    const size = Layout.sizeOf(WND, ctrl);
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
    if (label) {
      Font.set(b, label, { color: Layout.native('buttonLabel') });
      b.setAttribute('role', 'button'); b.setAttribute('aria-label', label);
    }
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    this.win.body.appendChild(b);
    return b;
  }

  _footerText(valueCtrl, labelCtrl, label) {
    const lp = Layout.pos(WND, labelCtrl);
    if (lp) {
      const l = document.createElement('div');
      const size = Layout.sizeOf(WND, labelCtrl);
      const align = Layout.find(WND, labelCtrl)?.align;
      l.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(lp.x)}px;top:${Skin.px(lp.y)}px;width:${Skin.px(size.w)}px;`
        + `text-align:${align || 'left'};`;
      // the label's own record governs its colour (ShopWnd/PriceConstText,
      // ShopWnd/AdenaConstText -- both #DCDCDC in Interface.xdat)
      Font.set(l, label, { color: Layout.textColor(WND, labelCtrl) });
      this.win.body.appendChild(l);
      this.labels[labelCtrl] = l;
    }
    const vp = Layout.pos(WND, valueCtrl);
    const vSize = Layout.sizeOf(WND, valueCtrl);
    const v = document.createElement('div');
    v.style.cssText = 'position:absolute;pointer-events:none;text-align:right;'
      + `left:${Skin.px((vp || { x: 158 }).x)}px;top:${Skin.px((vp || { y: 332 }).y)}px;`
      + `width:${Skin.px(vSize.w)}px;`;
    this.win.body.appendChild(v);
    return v;
  }

  // -- open modes ------------------------------------------------------------

  openBuy(items, money) { return this._open('buy', items, money); }
  openSell(items, money) { return this._open('sell', items, money); }

  async _open(mode, items, money) {
    this.resetSession();
    const revision = this.revision;
    // Clone packet rows: moving a sell item must not mutate a network snapshot.
    const rows = (items || []).map(item => ({ ...item }));
    try {
      const [meta, strings, messages] = await this.loadMetadata();
      if (revision !== this.revision) return;
      const labels = new Map((strings || []).map(row => [row.id, row.string]));
      if (!meta || !messages || [134, 136, 137, 138, 139, 140, 141, 142, 143].some(id => !labels.get(id))
          || !Number.isSafeInteger(money) || money < 0) {
        throw new Error('Original shop data or packet money unavailable');
      }
      this.meta = meta; this.strings = labels; this.messages = messages;
      this.mode = mode; this.money = money; this.topItems = rows;
      this._renderLabels(); this._render(); this.show();
    } catch (error) {
      if (revision === this.revision) console.warn('[ShopWnd]', error.message);
    }
  }

  _renderLabels() {
    const text = (element, id, control) => {
      if (element) Font.set(element, this.strings.get(id), { color: Layout.textColor(WND, control) });
    };
    text(this.labels.top, this.mode === 'buy' ? 137 : 138, 'TopText');
    text(this.labels.bottom, this.mode === 'buy' ? 139 : 137, 'BottomText');
    text(this.labels.PriceConstText, this.mode === 'buy' ? 142 : 143, 'PriceConstText');
    text(this.labels.AdenaConstText, 134, 'AdenaConstText');
    for (const [button, id] of [[this.okButton, 140], [this.cancelButton, 141]]) {
      if (!button) continue;
      const label = this.strings.get(id);
      Font.set(button, label, { color: Layout.native('buttonLabel') });
      button.setAttribute('role', 'button'); button.setAttribute('aria-label', label);
    }
    this.win.setTitle(this.strings.get(136));
  }

  // -- the cart ---------------------------------------------------------------

  _key(entry) { return entry.rowKey ?? (this.mode === 'sell' ? `o${entry.objectId}` : `i${entry.itemId}`); }
  _stackable(entry) { return [1, 2, 3].includes(this.meta?.[entry.itemId]?.consumeType); }
  _has(entry, pane) { return pane === 'top' ? this.topItems.includes(entry) : this.cart.get(entry.rowKey) === entry; }

  _moveToCart(item, count, fromDialog = false) {
    if (!this._has(item, 'top') || !Number.isSafeInteger(count) || count <= 0 || count > 0x7fffffff) return;
    const add = this.mode === 'sell' ? Math.min(count, item.count) : count;
    const merge = fromDialog || (this.mode === 'sell' && this._stackable(item));
    const existing = merge && [...this.cart.values()].find(row => row.itemId === item.itemId);
    // Native signed-overflow conversion is unresolved. Refuse that range;
    // never silently wrap a purchase count into a different quantity.
    if (add <= 0 || (existing && existing.count + add > 0x7fffffff)) return;
    if (existing) existing.count += add;
    else {
      const rowKey = ++this.rowSerial;
      this.cart.set(rowKey, { ...item, rowKey, count: add });
    }
    if (this.mode === 'sell') {
      item.count -= add;
      if (item.count <= 0) this.topItems.splice(this.topItems.indexOf(item), 1);
    }
    this._addPrice(add * (existing && fromDialog ? existing.price : item.price));
    this.selected = null; this._render();
  }

  _moveBack(entry, count, fromDialog = false) {
    if (!this._has(entry, 'bottom') || !Number.isSafeInteger(count) || count <= 0 || count > 0x7fffffff) return;
    const back = this.mode === 'sell' && this.topItems.find(row => fromDialog
      ? row.itemId === entry.itemId : row.objectId === entry.objectId);
    // ShopWnd.HandleDialogOK restores the requested sell quantity even for
    // overshoot. When it creates a top row, it also rewrites local ItemNum
    // before the price correction. Preserve this observable source asymmetry;
    // the server still validates actual ownership.
    const restore = fromDialog ? count : entry.count;
    if (back && back.count + restore > 0x7fffffff) return;
    const oldCount = entry.count;
    entry.count -= count;
    if (entry.count <= 0) this.cart.delete(entry.rowKey);
    if (this.mode === 'sell') {
      if (back) back.count += restore;
      else {
        const { rowKey, ...item } = entry;
        this.topItems.push({ ...item, count: restore });
      }
    }
    const removed = fromDialog && this.mode === 'sell' && !back ? count : Math.min(count, oldCount);
    this._addPrice(-removed * entry.price);
    this.selected = null; this._render();
  }

  _addPrice(delta) {
    // Small exact-number domain. Original INT64 high/low signed-word and
    // overflow behavior remains a separate native parity boundary.
    this.currentPrice = Math.max(0, this.currentPrice + delta);
  }

  _moveSelected(pane) {
    if (!this.selected || this.selected.pane !== pane) return;
    const pool = pane === 'top' ? this.topItems : [...this.cart.values()];
    const entry = pool[this.selected.index];
    if (entry) return this._offerMove(entry, pane);
  }

  async _offerMove(entry, pane) {
    if (!this.visible || this.pending || !this._has(entry, pane)) return;
    const meta = this.meta?.[entry.itemId];
    if (!Number.isInteger(meta?.consumeType) || !meta.name) return;
    const toCart = pane === 'top';
    if (this._stackable(entry) && (!toCart || entry.count !== 1)) {
      const token = { entry, pane, revision: this.revision };
      const message = renderSysMsg(this.messages, 72, [meta.name]);
      if (!message || /^sysmsg /.test(message)) return;
      this.pending = token;
      try {
        const result = await this.dialog.request({ type: 'number', message, context: token, owner: this,
          parameter: toCart && this.mode === 'buy' ? -1 : entry.count });
        if (!result.accepted || this.pending !== token || token.revision !== this.revision
            || !this._has(entry, pane) || typeof result.value !== 'string' || !/^\d*$/.test(result.value)) return;
        const count = Number(result.value);
        if (!Number.isSafeInteger(count) || count <= 0 || count > 0x7fffffff) return;
        // DialogSetReservedInt stores ClassID, so acceptance resolves the
        // first current class row, including duplicate direct-buy rows.
        const pool = toCart ? this.topItems : [...this.cart.values()];
        const selected = pool.find(row => row.itemId === entry.itemId);
        if (selected && toCart) this._moveToCart(selected, count, true);
        else if (selected) this._moveBack(selected, count, true);
      } finally { if (this.pending === token) this.pending = null; }
    } else if (toCart) this._moveToCart(entry, this.mode === 'sell' ? entry.count : 1);
    else this._moveBack(entry, entry.count);
  }

  // -- rendering ----------------------------------------------------------------

  _cell(entry, pane, index) {
    const info = itemInfo(this.meta, entry.itemId);
    const cell = document.createElement('div');
    cell.className = 'l2-shop-cell';
    cell.dataset.key = this._key(entry);
    cell.dataset.itemId = entry.itemId;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', `${info.name} (${entry.count})`);
    cell.style.cssText = 'position:relative;display:inline-block;overflow:hidden;'
      + `width:${Skin.px(this.panes[pane].pitch.x)}px;`
      + `height:${Skin.px(this.panes[pane].pitch.y)}px;`
      + 'cursor:pointer;vertical-align:top;'
      + (this.selected && this.selected.pane === pane && this.selected.index === index
        // AUTHORED selection outline. Nothing in the client decides this:
        // no ItemWindow record carries a colour, NCItemWnd's render holds
        // exactly ONE colour immediate (the stack-count badge -- asserted by
        // tools/ui/mine_native_colors.py section 2), and no xdat control names
        // a selection texture. `L2UI_CH3.iconselect1/2` DO exist in the
        // extracted texture library and are referenced by nothing we have
        // decoded; if someone ties them to item selection this outline should
        // be replaced by that art, not by another colour.
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
      // AUTHORED 2px right inset. NCItemWnd draws this badge itself and
      // its position is computed in native code we have not decoded --
      // only its COLOUR was recovered (see mine_native_colors.py §2).
      c.style.cssText = 'position:absolute;right:2px;bottom:0;pointer-events:none;'
        + 'text-shadow:0 1px 1px #000;';
      // AUTHORED overflow cap. The badge helper NCItemWnd calls
      // (NWindow.dll 0x10064790) switches on wcslen and has a branch
      // per digit count, so retail does clamp the label somewhere --
      // but which count it clamps AT is not decoded, and 9999+ is our
      // choice, not a reading.
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
          // AUTHORED selection outline. Nothing in the client decides this:
          // no ItemWindow record carries a colour, NCItemWnd's render holds
          // exactly ONE colour immediate (the stack-count badge -- asserted by
          // tools/ui/mine_native_colors.py section 2), and no xdat control names
          // a selection texture. `L2UI_CH3.iconselect1/2` DO exist in the
          // extracted texture library and are referenced by nothing we have
          // decoded; if someone ties them to item selection this outline should
          // be replaced by that art, not by another colour.
          ? '1px solid #c8a959' : '';
      });
    }
  }

  _render() {
    const top = this.panes.top.el;
    const bottom = this.panes.bottom.el;
    top.replaceChildren();
    bottom.replaceChildren();
    for (let i = 0; i < this.topItems.length; i++) {
      top.appendChild(this._cell(this.topItems[i], 'top', i));
    }
    const cartItems = [...this.cart.values()];
    for (let i = 0; i < cartItems.length; i++) {
      bottom.appendChild(this._cell(cartItems[i], 'bottom', i));
    }
    // price total: accumulated price x count (uc:174/216), MakeCostString
    const total = this.currentPrice;
    Font.set(this.priceEl, costString(total),
             { color: Layout.textColor(WND, 'PriceText') });
    this.priceEl.title = String(total);   // ConvertNumToText stand-in
    this._renderAdena();
  }

  /** ShopWnd.HandleOpenWindow uses the supplied list Adena snapshot. */
  _renderAdena() {
    const adena = this.money;
    Font.set(this.adenaEl, costString(adena),
             { color: Layout.textColor(WND, 'AdenaText') });
    this.adenaEl.title = String(adena);
  }

  onInvUpdate() {} // No such source ShopWnd event; list money is authoritative.

  // -- OK / Cancel ---------------------------------------------------------------

  async _ok() {
    if (!this.visible || this.pending || !['buy', 'sell'].includes(this.mode)) return;
    const items = [...this.cart.values()];
    if (this.mode === 'buy' && this.topItems.some(top => top.count > 0
        && items.filter(row => row.itemId === top.itemId).reduce((sum, row) => sum + row.count, 0) > top.count)) {
      const message = renderSysMsg(this.messages, 1338, []);
      if (!message || /^sysmsg /.test(message)) return;
      const token = { revision: this.revision };
      this.pending = token;
      try { await this.dialog.request({ type: 'warning', message, context: token, owner: this }); }
      finally { if (this.pending === token) this.pending = null; }
      return; // A warning acceptance never purchases the invalid cart.
    }
    if (this.mode === 'buy') {
      this.onBuy(items.map(e => ({ itemId: e.itemId, count: e.count })));
    } else {
      this.onSell(items.map(e => ({ objectId: e.objectId, count: e.count })));
    }
    // the .uc hides on OK (uc:501); the result arrives via invUpdate —
    // failure is a sysMsg in chat, never assumed success here
    this.hide();
  }

  _parentRect() {
    return { x: 0, y: 0, width: window.innerWidth / Skin.scale, height: window.innerHeight / Skin.scale };
  }
  _positionRect() {
    const r = this.root.getBoundingClientRect();
    const x = parseFloat(this.root.style.left), y = parseFloat(this.root.style.top);
    return { x: (Number.isFinite(x) ? x : r.left) / Skin.scale,
      y: (Number.isFinite(y) ? y : r.top) / Skin.scale, width: this.w, height: this.h };
  }
  place(o) {
    if (o) this.win.place(o);
    else {
      const reset = defaultWindowPosition(this.defaultPositionRule, this._positionRect(), this._parentRect());
      if (reset) this.win.place({ left: reset.x, top: reset.y });
    }
    return this;
  }
  repairPosition() {
    if (!windowCornerInside(this._positionRect(), this._parentRect())) this.place();
  }
  show() { this.win.show(); this._renderAdena(); return this; }
  resetSession() {
    ++this.revision;
    this.pending = null; this.dialog.reset(this);
    this.mode = null; this.money = 0; this.currentPrice = 0; this.topItems = []; this.cart.clear(); this.selected = null;
    this.win.hide();
    for (const pane of Object.values(this.panes)) pane.el.replaceChildren();
  }
  hide() { this.resetSession(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { if (force === false || this.visible) this.hide(); else if (this.mode) this.show(); return this; }

  onDefaultPosition() {
    this.place();
  }
}
