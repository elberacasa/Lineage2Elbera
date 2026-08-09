// Phase C.12 — TradeWnd, the retail player-to-player trade window.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   TradeWnd 256x471, THREE ItemWindows: InventoryList
//                    239x139 at (9,35) (your tradable inventory — what you
//                    add FROM), MyList 239x108 at (9,202) (your offer) and
//                    OtherList 239x108 at (9,329) (their offer), all 32px
//                    cells at the standard 37x35 pitch (decoded grid
//                    params). MoveButton 15x15 at (140,181), OK (51,442),
//                    Cancel (131,442), TradeNameTextConst (11,184),
//                    TargetName (11,313), InvenWeight (180,182 — SKIPPED:
//                    no weight data in the contract, same as ShopWnd).
//   TradeWnd.uc      double-click in InventoryList (uc:89) or the
//                    MoveButton (uc:146) adds to MyList; STACKABLES with
//                    ItemNum != 1 ask the amount with DIALOG_NumberPad
//                    (uc:91-97), everything else adds 1 (uc:99). There is
//                    NO remove-from-trade path anywhere in the .uc — the
//                    lists only grow until done/cancel. OK fades MyList
//                    and sends TradeDone(true) (uc:66-71), Cancel and
//                    closing the window send TradeDone(false) (uc:73-76,
//                    OnSendPacketWhenHiding uc:19-22). TradeStart HIDES
//                    the inventory/shop windows (uc:184-199, done in
//                    main.js) and names the partner in TargetName
//                    (uc:216/220). The incoming request is a DialogBox
//                    with Accept -> AnswerTradeRequest(true) (uc:322-354).
//   gateway/README   the port's contract (M12): tradeStart carries MY
//   M12              tradable-inventory snapshot (equipped / untradable /
//                    quest items already EXCLUDED server-side);
//                    tradeOwn/tradeOther are the ONLY pane truth — the
//                    window renders nothing the server did not send;
//                    tradeEnd{reason} closes (done/cancel). CONFIRM IS
//                    TWO-PHASE: the first tradeDone only marks that side
//                    (TradePressOwnOk/OtherOk are log-only, NOT contract
//                    ops), so the partner's confirm can never be shown —
//                    KNOWN LIMITATION: after OK we latch the OWN side
//                    (faded MyList, adds locked) and wait; the exchange
//                    completes when tradeEnd arrives. Refuse surfaces ONLY
//                    as sysMsg 119 in chat — nothing to render.
//
// Gaps marked AUTHORED: the amount prompt and the Accept/Refuse prompt
// stand in for DIALOG_NumberPad / DIALOG_Progress (the port has no dialog
// framework, same stand-ins as ShopWnd/PartyWnd); pane labels ('Trade',
// 'My offer') are English — retail uses system strings, not extracted.
// Stackability comes from the list count (itemmeta carries no flag):
// count != 1 prompts, count == 1 adds without one (shopwnd heuristic).

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { itemMeta, itemInfo } from '../gamedata.js';

const WND = 'TradeWnd';
// Text colour is never typed here: it resolves through
// Layout.textColor(WND, <record>). TradeWnd declares two TextBox records,
// TradeNameTextConst and TargetName, both #DCDCDC. The port used to paint
// them #b09b79 on the strength of QuestTreeWnd.uc:570, which governs a
// different control in a different window.

export class TradeWnd {
  constructor(parent = document.body, { onAdd, onDone, onCancel, onAnswer } = {}) {
    this.onAdd = onAdd || (() => {});
    this.onDone = onDone || (() => {});
    this.onCancel = onCancel || (() => {});
    this.onAnswer = onAnswer || (() => {});
    this.partner = null;         // partner name from tradeStart
    this.partnerId = null;
    this.tradable = [];          // tradeStart snapshot (server truth)
    this.ownOffer = [];          // tradeOwn entries ONLY (server truth)
    this.otherOffer = [];        // tradeOther entries ONLY (server truth)
    this.ownConfirmed = false;   // two-phase latch (M12)
    this.selected = null;        // index into this.tradable

    const def = Layout.windowSize(WND);
    this.w = def.w;
    this.h = def.h;

    const win = new L2Window({
      title: 'Trade', width: this.w, height: this.h, closable: true,
      winName: WND,
    });
    win.root.id = 'l2-tradewnd';
    // OnSendPacketWhenHiding (uc:19-22): closing the window IS a cancel
    win.onClose = () => this.onCancel();
    this.win = win;
    this.root = win.root;

    this.panes = {};
    for (const [key, ctrl] of [['inventory', 'InventoryList'],
                               ['my', 'MyList'],
                               ['other', 'OtherList']]) {
      const pos = Layout.posOf(WND, ctrl);
      const size = Layout.sizeOf(WND, ctrl);
      const grid = Layout.gridOf(WND, ctrl);
      const el = document.createElement('div');
      el.className = `l2-trade-${key}`;
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

    // 'My offer' label at the TradeNameTextConst rect (11,184) — the const
    // string itself is a retail system string, not extracted (AUTHORED text)
    const myLabelPos = Layout.pos(WND, 'TradeNameTextConst');
    if (myLabelPos) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(myLabelPos.x)}px;top:${Skin.px(myLabelPos.y)}px;`;
      // AUTHORED English (retail uses a system string); the COLOUR is the
      // TradeNameTextConst record's own
      Font.set(el, 'My offer',
               { color: Layout.textColor(WND, 'TradeNameTextConst') });
      win.body.appendChild(el);
    }

    // partner name at the TargetName rect (uc:216/220 — retail appends the
    // clan; the contract carries the name only)
    const tnPos = Layout.pos(WND, 'TargetName');
    const tnSize = Layout.sizeOf(WND, 'TargetName');
    this.targetNameEl = document.createElement('div');
    this.targetNameEl.style.cssText = 'position:absolute;pointer-events:none;'
      + `left:${Skin.px((tnPos || { x: 11 }).x)}px;`
      + `top:${Skin.px((tnPos || { y: 313 }).y)}px;`
      + `width:${Skin.px(tnSize.w)}px;`;
    win.body.appendChild(this.targetNameEl);

    // MoveButton: adds the selected inventory entry (uc:146-163)
    this._ctrlBtn('MoveButton', () => this._moveSelected());

    this.okBtn = this._ctrlBtn('OKButton', () => this._ok(), 'OK');
    this._ctrlBtn('CancelButton', () => this._cancel(), 'Cancel');

    parent.appendChild(win.root);
    // AUTHORED dock (WindowsInfo.ini not mined for this window); same
    // family spot as the other toggle windows.
    this.defaultPlace = { right: 12, top: 60 };
    this._buildAmountPrompt(parent);
    this._buildAsk(parent);
  }

  _ctrlBtn(ctrl, onClick, label = null) {
    const pos = Layout.pos(WND, ctrl);
    const size = Layout.sizeOf(WND, ctrl);
    if (!pos) return null;
    const b = document.createElement('div');
    b.className = 'l2-trade-btn';
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

  // -- trade lifecycle ---------------------------------------------------------

  /** tradeStart: open with MY tradable snapshot; panes start empty. */
  start(msg) {
    this.partner = msg.partner || null;
    this.partnerId = msg.partnerId ?? null;
    this.tradable = (msg.items || []).slice();
    this.ownOffer = [];
    this.otherOffer = [];
    this.ownConfirmed = false;
    this.selected = null;
    this.panes.my.el.style.opacity = '';
    if (this.okBtn) {
      this.okBtn.style.opacity = '';
      Font.set(this.okBtn, 'OK', { color: Layout.native('buttonLabel') });
    }
    Font.set(this.targetNameEl, this.partner || '',
             { color: Layout.textColor(WND, 'TargetName') });
    this._render();
    this.show();
  }

  /** tradeOwn / tradeOther: the ONLY pane truth (M12 — per-add lists,
   *  merged by objectId like HandleTradeAddItem, uc:251-266). */
  addOwn(items) { this._merge(this.ownOffer, items); if (this.visible) this._render(); }
  addOther(items) { this._merge(this.otherOffer, items); if (this.visible) this._render(); }

  _merge(list, items) {
    for (const it of items || []) {
      const have = list.find(e => e.objectId === it.objectId);
      if (have) have.count += it.count;   // uc:255-259 stackable merge
      else list.push({ ...it });
    }
  }

  /** tradeEnd{reason}: the exchange is over — close (uc:270-273). */
  end(reason) {
    this.endReason = reason;
    this.hide();
  }

  // -- adding to the offer -----------------------------------------------------

  /** dblclick / MoveButton entry: stackables ask the amount
   *  (DIALOG_NumberPad in the .uc — our prompt stands in), the rest add 1
   *  (uc:91-99). Nothing renders locally — the tradeOwn op is the truth. */
  _offerAdd(entry) {
    if (this.ownConfirmed) return;   // confirms lock the offer (M12)
    const stackable = entry.count !== 1;   // itemmeta carries no flag
    if (stackable) {
      this._askAmount(entry.count, (n) => this.onAdd(entry.objectId, n));
    } else {
      this.onAdd(entry.objectId, 1);
    }
  }

  _moveSelected() {
    if (this.selected == null) return;
    const entry = this.tradable[this.selected];
    if (entry) this._offerAdd(entry);
  }

  // -- OK / Cancel ---------------------------------------------------------------

  _ok() {
    if (this.ownConfirmed) return;
    this.ownConfirmed = true;
    // SetFaded(MyList) (uc:69): the own side latches; the partner's
    // confirm can NOT be shown (TradePressOtherOk is log-only, M12) —
    // 'Waiting' is the honest state (AUTHORED label)
    this.panes.my.el.style.opacity = '0.45';
    if (this.okBtn) {
      this.okBtn.style.opacity = '0.45';
      // AUTHORED English; the COLOUR is NCButton's disabled branch, which is
      // what retail paints once the button stops accepting clicks
      // (NWindow.dll 0x100035a8 with IsEnableWindow() false)
      Font.set(this.okBtn, 'Waiting',
               { color: Layout.native('buttonLabelDisabled') });
    }
    this.onDone();
  }

  _cancel() {
    // retail Cancel sends TradeDone(false) and waits for the server's
    // tradeEnd to hide (uc:73-76 vs HandleTradeDone uc:270-273)
    this.onCancel();
  }

  // -- amount prompt (AUTHORED — stands in for DIALOG_NumberPad) ---------------

  _buildAmountPrompt(parent) {
    const win = new L2Window({
      title: 'Amount', width: 180, height: 70, closable: false,
    });
    win.root.id = 'l2-trade-amount';
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

  // -- tradeAsk prompt (AUTHORED — stands in for DIALOG_Progress) ---------------

  _buildAsk(parent) {
    // AUTHORED prompt window: retail uses the DialogBox system dialog,
    // which the port does not have — a small L2Window stands in (220x80
    // and the 8px insets are ours, there is nothing to mine)
    const win = new L2Window({
      title: 'Trade', width: 220, height: 80, closable: false,
    });
    win.root.id = 'l2-tradeask';
    const text = document.createElement('div');
    text.style.cssText = `position:absolute;left:${Skin.px(8)}px;`
      + `top:${Skin.px(8)}px;right:${Skin.px(8)}px;`;   // AUTHORED (above)
    win.body.appendChild(text);
    const row = document.createElement('div');
    // AUTHORED insets (the _buildAsk comment above covers this whole block)
    row.style.cssText = `position:absolute;bottom:${Skin.px(8)}px;`
      + `left:${Skin.px(8)}px;display:flex;gap:8px;`;
    const btn = (label, cb) => {
      const b = document.createElement('div');
      // Size is the button art's own content rect, read from the sprite --
      // not a second copy of a measurement the art already carries.
      const art = Skin.content('L2UI_CH3.Button.SmallButton1');
      if (!art) return null;
      b.style.cssText = `width:${Skin.px(art.w)}px;height:${Skin.px(art.h)}px;`
        + 'display:flex;align-items:center;justify-content:center;cursor:pointer;';
      Skin.apply(b, 'L2UI_CH3.Button.SmallButton1', { stretch: true });
      Font.set(b, label, { color: Layout.native('buttonLabel') });
      b.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
      return b;
    };
    row.appendChild(btn('Accept', () => this._answer(1)));
    row.appendChild(btn('Refuse', () => this._answer(0)));
    win.body.appendChild(row);
    parent.appendChild(win.root);
    this.askWin = win;
    this.askText = text;
  }

  showAsk(from) {
    this.askFrom = from;
    // AUTHORED prompt text (retail: sysmsg-driven DialogBox content)
    // AUTHORED English; the COLOUR is DialogBox/DialogText's own record
    // (#DCDCDC), which is the control retail would put this prompt in
    Font.set(this.askText, `${from || '?'} wants to trade with you.`,
             { color: Layout.textColor('DialogBox', 'DialogText') });
    this.askWin.place({ left: window.innerWidth / 2 - 110, top: 200 });
    this.askWin.show();
  }

  _answer(accept) {
    this.askWin.hide();
    this.askFrom = null;
    this.onAnswer(accept);
  }

  // -- rendering ----------------------------------------------------------------

  async _cell(entry, pane, index) {
    const meta = await itemMeta();
    const info = itemInfo(meta, entry.itemId);
    const cell = document.createElement('div');
    cell.className = 'l2-trade-cell';
    cell.dataset.key = `o${entry.objectId}`;
    cell.style.cssText = 'position:relative;display:inline-block;overflow:hidden;'
      + `width:${Skin.px(this.panes[pane].pitch.x)}px;`
      + `height:${Skin.px(this.panes[pane].pitch.y)}px;`
      + (pane === 'inventory' ? 'cursor:pointer;' : '')
      + 'vertical-align:top;'
      + (pane === 'inventory' && this.selected === index
        // AUTHORED selection outline. Nothing in the client decides this:
        // no ItemWindow record carries a colour, NCItemWnd's render holds
        // exactly ONE colour immediate (the stack-count badge -- asserted by
        // tools/ui/mine_native_colors.py section 2), and no xdat control names
        // a selection texture. `L2UI_CH3.iconselect1/2` DO exist in the
        // extracted texture library and are referenced by nothing we have
        // decoded; if someone ties them to item selection this outline should
        // be replaced by that art, not by another colour.
        ? 'outline:1px solid #c8a959;' : '');
    cell.title = info.name + (entry.count > 1 ? ` ×${entry.count}` : '');
    const icon = document.createElement('div');
    // the icon cell is the xdat grid's cellX (32) — from the pane record
    const cellIcon = this.panes[pane].icon;
    icon.style.cssText = `width:${Skin.px(cellIcon)}px;height:${Skin.px(cellIcon)}px;`
      + 'margin:0 auto;';
    if (info.icon) {
      const img = document.createElement('img');
      img.src = info.icon;
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
    if (entry.count > 1) {
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
      Font.set(c, String(entry.count > 9999 ? '9999+' : entry.count),
               { color: Layout.native('itemSlotCount') });
      cell.appendChild(c);
    }
    if (pane === 'inventory') {
      cell.addEventListener('click', () => {
        this.selected = index;
        this._renderSelection();
      });
      cell.addEventListener('dblclick', () => this._offerAdd(entry));
    }
    return cell;
  }

  _renderSelection() {
    [...this.panes.inventory.el.children].forEach((cell, i) => {
      // AUTHORED selection outline. Nothing in the client decides this:
      // no ItemWindow record carries a colour, NCItemWnd's render holds
      // exactly ONE colour immediate (the stack-count badge -- asserted by
      // tools/ui/mine_native_colors.py section 2), and no xdat control names
      // a selection texture. `L2UI_CH3.iconselect1/2` DO exist in the
      // extracted texture library and are referenced by nothing we have
      // decoded; if someone ties them to item selection this outline should
      // be replaced by that art, not by another colour.
      cell.style.outline = this.selected === i ? '1px solid #c8a959' : '';
    });
  }

  async _render() {
    const lists = { inventory: this.tradable, my: this.ownOffer, other: this.otherOffer };
    for (const [pane, items] of Object.entries(lists)) {
      const el = this.panes[pane].el;
      el.replaceChildren();
      for (let i = 0; i < items.length; i++) {
        el.appendChild(await this._cell(items[i], pane, i));
      }
    }
  }

  place(o = {}) { this.win.place(o); return this; }
  show() { this.win.show(); return this; }
  hide() { this.win.hide(); if (this.amountWin) this.amountWin.hide(); return this; }
  get visible() { return this.win.visible; }

  onDefaultPosition() {
    this.place(this.defaultPlace);
  }
}
