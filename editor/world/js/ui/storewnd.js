// Phase C.13 — StoreWnd, the retail private-store window (PrivateShopWnd).
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   PrivateShopWnd 256x401, dual pane: TopList 239x139 at
//                    (9,48) and BottomList 239x104 at (9,215), 32px cells at
//                    the standard 37x35 pitch. Up/Down buttons (112,194)/
//                    (130,194), StopButton (10,372), MessageButton (87,372),
//                    OKButton (164,372), TopText (11,32), BottomText (11,198),
//                    PriceConstText/PriceText (100,332)/(158,332),
//                    AdenaConstText/AdenaText (100,351)/(158,351).
//                    CheckBulk (11,350) and InvenWeight (28,331) are SKIPPED
//                    (AUTHORED omissions: package-sale is out of scope and
//                    the contract carries no weight data, same as ShopWnd).
//   PrivateShopWnd.uc  FOUR modes: PT_SellList/PT_BuyList are MY manage
//                    views (top = what can be listed, bottom = my list with
//                    MY prices), PT_Buy/PT_Sell are the OBSERVER views of
//                    someone's store (top = their list, bottom = my cart).
//                    Manage add asks the PRICE first (DIALOG_ASK_PRICE,
//                    uc:203-225) then the amount for stackables; observer
//                    moves ask only the amount for stackables (uc:246-256).
//                    MessageButton opens a 29-char title edit dialog
//                    (uc:99-110). OK packs the bottom list and HIDES
//                    (uc:1163-1164); StopButton quits the store (uc:94-98).
//                    OnSendPacketWhenHiding (uc:38-41): closing the window
//                    in a MANAGE mode IS a store quit; observer closes send
//                    nothing. Opening hides the InventoryWnd (uc:870-873,
//                    done in main.js).
//   gateway/README   the port's contract (M13): storeMsgSell/storeMsgBuy
//   M13              open the manage views, playerStore opens the observer
//                    view, storeState tracks my open store. There is NO
//                    start packet — storeSetSell/storeSetBuy IS the start
//                    (storeStart is a documented no-op; never sent).
//
// DECISION (task brief): the ActionWnd 'Private Store - Sell/Buy' actions
// (actionname ids 10/28) do NOT ride action{actionId} -> RequestActionUse
// (the native aCis path) — main.js sends storeManageSell{}/storeManageBuy{}
// instead, the deterministic bridge ops; storeMsgSell/storeMsgBuy then open
// this window exactly like the native answer would.
//
// Gaps marked AUTHORED: the amount+price prompt extends the ShopWnd amount
// prompt with a price field (stands in for DIALOG_ASK_PRICE +
// DIALOG_NumberPad — the port has no dialog framework); the title prompt
// stands in for DIALOG_OKCancelInput (uc:101-109); pane labels/titles are
// English — retail uses system strings 1/137/139/142/143/498/1157/1434,
// not extracted. Stackability comes from the list count (itemmeta carries
// no flag): count != 1 prompts, count == 1 moves without one (shopwnd
// heuristic). BottomCountText '(n/max)' is skipped — the contract carries
// no max-count (EV_SetMaxCount has no bridge op).

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { itemMeta, itemInfo } from '../gamedata.js';

const WND = 'PrivateShopWnd';
// Text colour is never typed here: it resolves through
// Layout.textColor(WND, <record>). WND is PrivateShopWnd, whose seven
// TextBox records are TopText/BottomText/PriceConstText/AdenaConstText/
// PriceText/AdenaText (#DCDCDC) and BottomCountText (#B09B79). The port used
// to paint them all #b09b79 on the strength of QuestTreeWnd.uc:570, which
// governs a different control in a different window.

// MakeCostString (PrivateShopWnd.uc:1014) — thousand separators; the
// tooltip (ConvertNumToText) spells it out
function costString(n) {
  return Math.round(n).toLocaleString('en-US');
}

// mode -> [window title, top label, bottom label, ok label] — AUTHORED
// English (retail system strings, not extracted; uc:884-963)
const MODE_TEXT = {
  manageSell: ['Private Store (Sell)', 'Inventory', 'My Store', 'Start'],
  manageBuy: ['Private Store (Buy)', 'Inventory', 'Wanted', 'Start'],
  observeSell: ['Private Store', 'Store', 'Cart', 'Buy'],
  observeBuy: ['Private Store', 'Your Items', 'Cart', 'Sell'],
};

export class StoreWnd {
  constructor(parent = document.body,
              { onSetSell, onSetBuy, onStop, onBuy, onSell, getAdena } = {}) {
    this.onSetSell = onSetSell || (() => {});
    this.onSetBuy = onSetBuy || (() => {});
    this.onStop = onStop || (() => {});
    this.onBuy = onBuy || (() => {});
    this.onSell = onSell || (() => {});
    this.getAdena = getAdena || (() => 0);
    this.mode = null;          // see MODE_TEXT
    this.storeId = null;       // observer view: the merchant's objectId
    this.title = '';           // my store title (MessageButton dialog)
    this.topItems = [];        // sellables/buyables or the store's list
    this.cart = new Map();     // key -> {itemId, objectId, count, price, name, icon}
    this.selected = null;      // {pane, index}
    this.storeOpen = false;    // storeState latch (M13)

    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 256;
    this.h = def && def.height ? def.height : 401;

    const win = new L2Window({
      title: 'Private Store', width: this.w, height: this.h, closable: true,
      winName: WND,
    });
    win.root.id = 'l2-storewnd';
    // OnSendPacketWhenHiding (uc:38-41): closing a MANAGE view quits the
    // store (RequestQuitPrivateShop); observer closes send nothing
    win.onClose = () => {
      if (this.mode === 'manageSell' || this.mode === 'manageBuy') this.onStop();
      this.hide();
    };
    this.win = win;
    this.root = win.root;

    this.panes = {};
    for (const [key, ctrl] of [['top', 'TopList'], ['bottom', 'BottomList']]) {
      const pos = Layout.pos(WND, ctrl) ?? { x: 9, y: key === 'top' ? 48 : 215 };
      const size = Layout.size(WND, ctrl) || { w: 239, h: 104 };
      const grid = Layout.grid(WND, ctrl)
        || { cellX: 32, cellY: 32, gapX: 5, gapY: 3 };
      const el = document.createElement('div');
      el.className = `l2-store-${key}`;
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

    // footer: price + adena lines at their mined rects
    this.priceEl = this._footerText('PriceText', 'PriceConstText', 'Price:');
    this.adenaEl = this._footerText('AdenaText', 'AdenaConstText', 'Adena:');

    // manage-only buttons (uc:889-917 show them only for the *List modes);
    // MessageButton opens the title edit (DIALOG_OKCancelInput stand-in)
    this.stopBtn = this._ctrlBtn('StopButton', () => this._stop(), 'Stop');
    this.msgBtn = this._ctrlBtn('MessageButton', () => this._askTitle(), 'Title');
    this.okBtn = this._ctrlBtn('OKButton', () => this._ok(), 'OK');

    parent.appendChild(win.root);
    // AUTHORED dock (WindowsInfo.ini not mined for this window); same
    // family spot as the other toggle windows.
    this.defaultPlace = { right: 12, top: 60 };
    this._buildAmountPrompt(parent);
    this._buildPricePrompt(parent);
    this._buildTitlePrompt(parent);
  }

  _ctrlBtn(ctrl, onClick, label = null) {
    const pos = Layout.pos(WND, ctrl);
    const size = Layout.size(WND, ctrl) || { w: 76, h: 23 };
    if (!pos) return null;
    const b = document.createElement('div');
    b.className = 'l2-store-btn';
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
      // the label's own record governs its colour (PriceConstText /
      // AdenaConstText, both #DCDCDC in Interface.xdat)
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

  /** storeMsgSell: my sell-store manage view. items = current store
   *  contents (re-manage while open), sellables = what can be listed. */
  openManageSell(msg) {
    this.mode = 'manageSell';
    this.storeId = null;
    this.cart.clear();
    for (const it of msg.items || []) {
      // already-listed entries come back with their store price
      this.cart.set(this._key(it), {
        itemId: it.itemId, objectId: it.objectId,
        count: it.count, price: it.storePrice ?? it.price,
        name: it.name, icon: it.icon,
      });
    }
    this.topItems = (msg.sellables || [])
      .filter(it => !this.cart.has(this._key(it)))
      .map(it => ({ ...it }));
    this.selected = null;
    this._renderLabels();
    this._render();
    this.show();
  }

  /** storeMsgBuy: my buy-store manage view. buyables = owned reference
   *  items (keyed by itemId, uc FindItemWithClassID). */
  openManageBuy(msg) {
    this.mode = 'manageBuy';
    this.storeId = null;
    this.cart.clear();
    for (const it of msg.items || []) {
      this.cart.set(this._key(it), {
        itemId: it.itemId, objectId: null,
        count: it.count, price: it.storePrice ?? it.price,
        name: it.name, icon: it.icon,
      });
    }
    this.topItems = (msg.buyables || []).map(it => ({ ...it }));
    this.selected = null;
    this._renderLabels();
    this._render();
    this.show();
  }

  /** playerStore: what an observer sees clicking someone's store. type
   *  'sell' -> we BUY from it (PT_Buy); type 'buy' -> we SELL into it
   *  (PT_Sell; objectIds are the VIEWER's own matching items, M13). */
  openObserver(msg) {
    this.mode = msg.type === 'buy' ? 'observeBuy' : 'observeSell';
    this.storeId = msg.id;
    this.storeTitle = msg.title || '';
    this.cart.clear();
    this.topItems = (msg.items || []).map(it => ({ ...it }));
    this.selected = null;
    this._renderLabels();
    this._render();
    this.show();
  }

  /** storeState{open,type}: my own store's lifecycle (M13). While open the
   *  manage view latches: lists locked, Start disabled, Stop active. */
  setStoreState(msg) {
    this.storeOpen = !!msg.open;
    if (!this.visible) return;
    const locked = this.storeOpen;
    this.panes.top.el.style.opacity = locked ? '0.45' : '';
    this.panes.bottom.el.style.opacity = locked ? '0.45' : '';
    if (this.okBtn) this.okBtn.style.opacity = locked ? '0.45' : '';
  }

  _renderLabels() {
    const t = MODE_TEXT[this.mode] || MODE_TEXT.observeSell;
    if (this.labels.top) {
      Font.set(this.labels.top, t[1], { color: Layout.textColor(WND, 'TopText') });
    }
    if (this.labels.bottom) {
      Font.set(this.labels.bottom, t[2],
               { color: Layout.textColor(WND, 'BottomText') });
    }
    // AUTHORED button visibility per mode (uc:889-963): Stop/Title only in
    // the manage views; the observer store title rides the window title
    const manage = this.mode === 'manageSell' || this.mode === 'manageBuy';
    if (this.stopBtn) this.stopBtn.style.display = manage ? 'flex' : 'none';
    if (this.msgBtn) this.msgBtn.style.display = manage ? 'flex' : 'none';
    if (this.okBtn) Font.set(this.okBtn, t[3], { color: Layout.native('buttonLabel') });
    let title = t[0];
    if (!manage && this.storeTitle) title = this.storeTitle;   // their sign
    if (manage && this.title) title = `${t[0]} — ${this.title}`;
    this.win.setTitle(title);
  }

  // -- the list (bottom pane) -------------------------------------------------

  _key(t) { return this.mode === 'manageBuy' ? `i${t.itemId}` : `o${t.objectId}`; }

  _moveToCart(item, count, price) {
    const key = this._key(item);
    const existing = this.cart.get(key);
    const add = Math.min(count, this.mode === 'manageBuy' ? count : item.count);
    if (add <= 0) return;
    if (this.mode === 'manageBuy') {
      // uc:572 — the wanted count is SET, not accumulated; price overwritten
      if (existing) { existing.count = add; existing.price = price; }
      else {
        this.cart.set(key, {
          itemId: item.itemId, objectId: null,
          count: add, price, name: item.name, icon: item.icon,
        });
      }
    } else if (existing) {
      // uc:393-397 — re-listing overwrites the price and adds the count
      existing.count += add;
      if (price != null) existing.price = price;
    } else {
      this.cart.set(key, {
        itemId: item.itemId, objectId: item.objectId,
        count: add, price: price != null ? price : item.price,
        name: item.name, icon: item.icon,
      });
    }
    if (this.mode !== 'manageBuy') {
      // the top pane depletes (buyables are reference items, never consumed)
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
    if (this.mode !== 'manageBuy') {
      const back = this.topItems.find(t => this._key(t) === key);
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

  /** dblclick / button entry: MANAGE modes ask count+price (DIALOG_ASK_PRICE
   *  + DIALOG_NumberPad in the .uc — our combined prompt stands in,
   *  AUTHORED); observer moves ask only the amount for stackables
   *  (uc:246-256), the rest move 1. */
  _offerMove(entry, pane) {
    if (this.storeOpen && (this.mode === 'manageSell' || this.mode === 'manageBuy')) {
      return;   // the store is running — the list is locked (storeState)
    }
    const toCart = pane === 'top';
    const manage = this.mode === 'manageSell' || this.mode === 'manageBuy';
    const stackable = entry.count !== 1;   // itemmeta carries no flag
    if (toCart && manage) {
      this._askCountPrice(entry.count, entry.price, (n, price) => {
        this._moveToCart(entry, n, price);
      });
    } else if (stackable) {
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
    win.root.id = 'l2-store-amount';
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

  // -- count+price prompt (AUTHORED — extends the ShopWnd amount prompt with
  //    a price field; stands in for DIALOG_ASK_PRICE + DIALOG_NumberPad) -----

  _buildPricePrompt(parent) {
    // AUTHORED prompt layout (180x100 + the 8px rows are ours — the port
    // has no dialog framework to mirror, same stand-in as the amount prompt)
    const win = new L2Window({
      title: 'Count & Price', width: 180, height: 100, closable: false,
    });
    win.root.id = 'l2-store-price';
    const mkRow = (label, top) => {
      const l = document.createElement('div');
      l.style.cssText = `position:absolute;left:${Skin.px(10)}px;`
        + `top:${Skin.px(top + 3)}px;`;
      // our own count/price prompt (retail uses DIALOG_NumberPad); the row
      // labels take DialogBox/DialogText's colour, the record that governs
      // the text of the dialog retail would have opened
      Font.set(l, label, { color: Layout.textColor('DialogBox', 'DialogText') });
      win.body.appendChild(l);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.value = '1';
      // AUTHORED field split (label at 10, input 60..170 — the rows of our
      // own prompt; retail's DIALOG_ASK_PRICE geometry is not mined)
      input.style.cssText = `position:absolute;left:${Skin.px(60)}px;`
        + `top:${Skin.px(top)}px;width:${Skin.px(110)}px;`
        + 'background:#10131a;border:1px solid #5a5344;color:#e8e0d0;'
        + 'font:12px sans-serif;';
      win.body.appendChild(input);
      return input;
    };
    const countInput = mkRow('Count', 8);
    const priceInput = mkRow('Price', 34);
    const ok = document.createElement('div');
    // AUTHORED button row (OK at 10 / Cancel at 94, mirrors the amount
    // prompt's own layout — no retail dialog to mirror)
    ok.style.cssText = `position:absolute;left:${Skin.px(10)}px;`
      + `top:${Skin.px(64)}px;width:${Skin.px(76)}px;height:${Skin.px(23)}px;`
      + 'cursor:pointer;display:flex;align-items:center;justify-content:center;';
    Skin.apply(ok, 'L2UI_CH3.BUTTON.Btn1_normal', { stretch: true });
    Font.set(ok, 'OK', { color: Layout.native('buttonLabel') });
    win.body.appendChild(ok);
    const cancel = document.createElement('div');
    // AUTHORED (same prompt layout as above — the cancel mirrors OK)
    cancel.style.cssText = ok.style.cssText.replace(
      /left:\s*\d+(?:\.\d+)?px/, 'left:' + Skin.px(94) + 'px');
    Skin.apply(cancel, 'L2UI_CH3.BUTTON.Btn1_normal', { stretch: true });
    Font.set(cancel, 'Cancel', { color: Layout.native('buttonLabel') });
    win.body.appendChild(cancel);
    parent.appendChild(win.root);
    this.priceWin = win;
    this.priceCountInput = countInput;
    this.pricePriceInput = priceInput;
    const commit = () => {
      const max = this.priceMax;
      const n = Math.max(1, Math.min(max, parseInt(countInput.value, 10) || 1));
      // uc:497 — 2 billion cap (sysmsg 1369 in retail; clamped here)
      const p = Math.max(1, Math.min(1999999999, parseInt(priceInput.value, 10) || 1));
      win.hide();
      const cb = this.priceCb;
      this.priceCb = null;
      if (cb) cb(n, p);
    };
    ok.addEventListener('click', commit);
    cancel.addEventListener('click', () => {
      win.hide();
      this.priceCb = null;
    });
    for (const input of [countInput, priceInput]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ok.click();
        e.stopPropagation();
      });
    }
  }

  _askCountPrice(max, refPrice, cb) {
    this.priceMax = max;
    this.priceCb = cb;
    this.priceCountInput.value = '1';
    // the count row only makes sense for stackables (uc asks the amount
    // only when ItemNum != 1, uc:456) — fixed 1 otherwise
    this.priceCountInput.disabled = max === 1;
    // the reference price is the server's own (sellables/buyables carry it)
    this.pricePriceInput.value = String(refPrice || 1);
    // AUTHORED centering (the prompt is the port's own, nothing to mine)
    this.priceWin.place({
      left: window.innerWidth / 2 - Skin.px(90), top: window.innerHeight / 2 - Skin.px(50),
    });
    this.priceWin.show();
    this.pricePriceInput.focus();
    this.pricePriceInput.select();
  }

  // -- title prompt (AUTHORED — stands in for DIALOG_OKCancelInput, uc:99-110) --

  _buildTitlePrompt(parent) {
    // AUTHORED prompt window (220x80 + 8px insets are ours — the retail
    // dialog framework is not ported); the 29-char cap is uc:101
    const win = new L2Window({
      title: 'Store Title', width: 220, height: 80, closable: false,
    });
    win.root.id = 'l2-store-title';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 29;   // uc:101 DialogSetEditBoxMaxLength(29)
    // AUTHORED edit-box insets (8px sides, 10px top — the retail dialog
    // framework is not ported, nothing to mine for this box)
    input.style.cssText = `position:absolute;left:${Skin.px(8)}px;`
      + `top:${Skin.px(10)}px;width:${Skin.px(204)}px;`
      + 'background:#10131a;border:1px solid #5a5344;color:#e8e0d0;'
      + 'font:12px sans-serif;';
    win.body.appendChild(input);
    const btn = (label, left, cb) => {
      const b = document.createElement('div');
      // AUTHORED button row (44px below the edit box — our own prompt)
      b.style.cssText = `position:absolute;left:${Skin.px(left)}px;`
        + `top:${Skin.px(44)}px;width:${Skin.px(76)}px;height:${Skin.px(23)}px;`
        + 'cursor:pointer;display:flex;align-items:center;justify-content:center;';
      Skin.apply(b, 'L2UI_CH3.BUTTON.Btn1_normal', { stretch: true });
      Font.set(b, label, { color: Layout.native('buttonLabel') });
      b.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
      win.body.appendChild(b);
      return b;
    };
    const ok = btn('OK', 34, () => {
      this.title = input.value.trim();
      win.hide();
      this._renderLabels();
    });
    btn('Cancel', 120, () => win.hide());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
      e.stopPropagation();
    });
    parent.appendChild(win.root);
    this.titleWin = win;
    this.titleInput = input;
  }

  _askTitle() {
    this.titleInput.value = this.title || '';
    // AUTHORED centering (same as the other prompts)
    this.titleWin.place({
      left: window.innerWidth / 2 - Skin.px(110), top: window.innerHeight / 2 - Skin.px(40),
    });
    this.titleWin.show();
    this.titleInput.focus();
    this.titleInput.select();
  }

  // -- rendering ----------------------------------------------------------------

  async _cell(entry, pane, index) {
    const meta = await itemMeta();
    const info = itemInfo(meta, entry.itemId);
    const cell = document.createElement('div');
    cell.className = 'l2-store-cell';
    cell.dataset.key = this._key(entry);
    cell.style.cssText = 'position:relative;display:inline-block;overflow:hidden;'
      + `width:${Skin.px(this.panes[pane].pitch.x)}px;`
      + `height:${Skin.px(this.panes[pane].pitch.y)}px;`
      + 'cursor:pointer;vertical-align:top;'
      + (this.selected && this.selected.pane === pane && this.selected.index === index
        ? 'outline:1px solid #c8a959;' : '');
    cell.title = `${entry.name || info.name} — ${costString(entry.price)} a`;
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
      // AUTHORED: retail draws nothing when an icon is missing -- NCItemWnd
      // paints the slot art and the icon texture, with no placeholder glyph.
      // This '?' is a port-only affordance, so no record can govern it.
      Font.set(icon, '?', { color: '#8a93a5' });
    }
    cell.appendChild(icon);
    if (entry.count > 1) {
      const c = document.createElement('div');
      c.style.cssText = 'position:absolute;right:2px;bottom:0;pointer-events:none;'
        + 'text-shadow:0 1px 1px #000;';
      Font.set(c, String(entry.count > 9999 ? '9999+' : entry.count),
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
    // price total: accumulated price x count (AdjustPrice, uc:986-1017),
    // MakeCostString formatting
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

  // -- OK / Stop ---------------------------------------------------------------

  _ok() {
    const items = [...this.cart.values()];
    if (!items.length) return;
    if (this.mode === 'manageSell') {
      if (this.storeOpen) return;   // latched while the store runs
      // SetPrivateStoreListSell IS the store start (M13 — no storeStart op)
      this.onSetSell(
        items.map(e => ({ objectId: e.objectId, count: e.count, price: e.price })),
        this.title);
    } else if (this.mode === 'manageBuy') {
      if (this.storeOpen) return;
      this.onSetBuy(
        items.map(e => ({ itemId: e.itemId, count: e.count, price: e.price })),
        this.title);
    } else if (this.mode === 'observeSell') {
      // the bridge fills the price from its playerStore cache (M13: the
      // price MUST match the store's — never sent from here)
      this.onBuy(this.storeId, items.map(e => ({ objectId: e.objectId, count: e.count })));
    } else if (this.mode === 'observeBuy') {
      this.onSell(this.storeId,
        items.map(e => ({ objectId: e.objectId, count: e.count, price: e.price })));
    }
    // the .uc hides on OK (uc:1163); results arrive via invUpdate /
    // storeState — failure is a sysMsg in chat, never assumed success here
    this.hide();
  }

  _stop() {
    // StopButton (uc:94-98): RequestQuitPrivateShop + hide
    this.onStop();
    this.hide();
  }

  place(o = {}) { this.win.place(o); return this; }
  show() {
    this.win.show();
    this._renderAdena();
    this.setStoreState({ open: this.storeOpen });
    return this;
  }
  hide() {
    this.win.hide();
    if (this.amountWin) this.amountWin.hide();
    if (this.priceWin) this.priceWin.hide();
    if (this.titleWin) this.titleWin.hide();
    return this;
  }
  get visible() { return this.win.visible; }
  toggle(force) { this.win.toggle(force); return this; }

  onDefaultPosition() {
    this.place(this.defaultPlace);
  }
}
