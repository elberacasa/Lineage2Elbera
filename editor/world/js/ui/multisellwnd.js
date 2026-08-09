// M15 — MultiSellWnd, the NPC multisell (item exchange) window.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   MultiSellWnd 512x401: ItemList 240x314 at (9,48) —
//                    the entry grid, 32px cells at the standard 37x35
//                    pitch (decoded grid params); ItemInfo 244x150 at
//                    (262,45) (products of the selected entry) and
//                    NeededItem 244x150 at (262,217) (its ingredients);
//                    Text1 (11,32) / Text2 (267,32) / Text3 (267,203) /
//                    Text4 (110,378) static labels; OKButton (307,372),
//                    CancelButton (387,372), ItemCountEdit (165,374).
//   MultiSellWnd.uc  the LEFT grid holds ONE icon per entry (the first
//                    product, uc:305-315 ShowItemList adds ItemInfoList[0]);
//                    clicking an entry fills ItemInfo (products) and
//                    NeededItem (ingredients) on the right (uc:86-142);
//                    the count edit is enabled only for stackable-type
//                    entries, fixed "1" otherwise (uc:120-129); OK asks a
//                    warning dialog then sends RequestMultiSellChoose
//                    (uc:317-350); Cancel just hides (uc:81-83). When the
//                    list arrives the INVENTORY window is hidden
//                    (uc:289-303, HandleItemListEnd).
//   aCis             the server sends the prepared list on the merchant
//                    bypass (inventoryOnly for Newbie_ lists — only entries
//                    whose ingredients you own show up); there is NO close
//                    packet, and the list may be re-sent after an exchange.
//
// Contract (frozen ops): multisellList{listId,items:[{entryId,products:
// [{itemId,count,enchant}],ingredients:[{itemId,count,enchant}]}]} opens /
// refills the window; listId is the Java String.hashCode of the XML name
// and entryId is 1-based into the server-side PREPARED list — both pass
// back verbatim in multisellChoose{listId,entryId,count}. Results arrive
// ONLY via invUpdate/itemList (server truth; failures are sysMsg lines in
// chat — the window never assumes success).
//
// Gaps marked AUTHORED/DEVIATION: pane labels/title ('Exchange', 'Select',
// 'You receive', 'Required', 'Amount:') are English — retail uses system
// strings, not extracted. The frozen op drops the packet's stackable flag
// (0xd0 C stackable, decoded but not bridged), so the amount prompt (our
// DIALOG_NumberPad stand-in, same as ShopWnd's) is offered when the
// AFFORDABLE maximum is > 1 — computed from the local inventory state,
// capped by the server's 1..9999; equipment entries (max 1) exchange
// directly, matching the .uc's disabled count edit. The xdat's inline
// ItemCountEdit is DEVIATED into that prompt (no dialog framework to
// mirror, and the task mandates reusing it). Entries whose ingredients
// are missing render grayed and unclickable — aCis pre-filters the
// prepared list, but the window renders defensively. The .uc's warning
// dialog before OK is skipped (no dialog framework).

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { itemMeta, itemInfo } from '../gamedata.js';

const WND = 'MultiSellWnd';
// Text colour is never typed here: it resolves through
// Layout.textColor(WND, <record>). MultiSellWnd declares four TextBox
// records, Text1..Text4, all #DCDCDC. The port used to paint them #b09b79 on
// the strength of QuestTreeWnd.uc:570, which governs a different control in
// a different window.
// AUTHORED: retail's MultiSellWnd does not tint the owned/required line at
// all -- it shows the ingredient counts plainly and refuses the trade
// server-side. The shortfall red and the sufficiency green are both port
// affordances, so no record and no NWindow constant governs either.
const SHORT_COLOR = '#c04040';    // AUTHORED (see above)
const ENOUGH_COLOR = '#9fb07a';   // AUTHORED (see above)

function displayName(info, enchant) {
  return (enchant ? `+${enchant} ` : '') + info.name;
}

export class MultiSellWnd {
  constructor(parent = document.body, { onChoose, getOwned } = {}) {
    this.onChoose = onChoose || (() => {});
    // owned count per itemId, from the local inventory state (server truth
    // mirrored client-side); equipped gear does not count toward exchange
    // ingredients (aCis inventoryOnly lists skip it)
    this.getOwned = getOwned || (() => 0);
    this.listId = 0;
    this.items = [];           // server entries (verbatim)
    this.selected = -1;        // index into this.items

    const def = Layout.windowSize(WND);
    this.w = def.w;
    this.h = def.h;

    const win = new L2Window({
      title: 'Exchange', width: this.w, height: this.h, closable: true,
      winName: WND,
    });
    win.root.id = 'l2-multisellwnd';
    win.onClose = () => this.hide();   // no close packet exists (aCis)
    this.win = win;
    this.root = win.root;

    // -- left: the entry grid (ItemList, one first-product icon per entry) --
    {
      const pos = Layout.posOf(WND, 'ItemList');
      const size = Layout.sizeOf(WND, 'ItemList');
      const grid = Layout.gridOf(WND, 'ItemList');
      const el = document.createElement('div');
      el.className = 'l2-multisell-list';
      el.style.cssText = 'position:absolute;overflow-y:auto;overflow-x:hidden;'
        + 'pointer-events:auto;'
        + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`
        + `width:${Skin.px(size.w)}px;height:${Skin.px(size.h)}px;`;
      win.body.appendChild(el);
      this.listPane = {
        el,
        icon: grid.cellX,   // 32px icon cell (xdat grid decode)
        pitch: { x: grid.cellX + grid.gapX, y: grid.cellY + grid.gapY },
      };
    }

    // -- right: product detail (ItemInfo) and ingredient detail (NeededItem) --
    for (const [key, ctrl] of [['products', 'ItemInfo'], ['needed', 'NeededItem']]) {
      const pos = Layout.posOf(WND, ctrl);
      const size = Layout.sizeOf(WND, ctrl);
      const el = document.createElement('div');
      el.className = `l2-multisell-${key}`;
      el.style.cssText = 'position:absolute;overflow-y:auto;overflow-x:hidden;'
        + 'pointer-events:auto;'
        + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`
        + `width:${Skin.px(size.w)}px;height:${Skin.px(size.h)}px;`;
      win.body.appendChild(el);
      this[key + 'El'] = el;
    }

    // pane labels at their mined rects — AUTHORED English (retail: system
    // strings on Text1..Text4, not extracted)
    this.labels = {};
    const labelText = { Text1: 'Select', Text2: 'You receive', Text3: 'Required', Text4: 'Amount:' };
    for (const ctrl of ['Text1', 'Text2', 'Text3', 'Text4']) {
      const pos = Layout.pos(WND, ctrl);
      if (!pos) continue;
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`;
      Font.set(el, labelText[ctrl], { color: Layout.textColor(WND, ctrl) });
      win.body.appendChild(el);
      this.labels[ctrl] = el;
    }

    this._ctrlBtn('OKButton', () => this._ok(), 'OK');
    this._ctrlBtn('CancelButton', () => this.hide(), 'Cancel');

    parent.appendChild(win.root);
    // Dock READ from WindowsInfo.ini [MultiSellWnd] via Layout.dock(). The
    // comment this replaced said "WindowsInfo.ini not mined for this window"
    // and typed {right:12, top:60}; the client's file has had a [MultiSellWnd]
    // section all along.
    const dock = Layout.dock('MultiSellWnd');
    this.defaultPlace = dock ? { left: dock.x, top: dock.y } : null;
    this._buildAmountPrompt(parent);
  }

  _ctrlBtn(ctrl, onClick, label = null) {
    const pos = Layout.pos(WND, ctrl);
    const size = Layout.sizeOf(WND, ctrl);
    if (!pos) return null;
    const b = document.createElement('div');
    b.className = 'l2-multisell-btn';
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

  // -- open / refresh -----------------------------------------------------------

  /** multisellList opens the window; a re-sent list replaces the content
   *  (aCis may re-send after an exchange — selection is kept by entryId
   *  when the entry survives the refresh). */
  openList(listId, items) {
    const prevEntryId = this.selected >= 0 && this.items[this.selected]
      ? this.items[this.selected].entryId : null;
    this.listId = listId;
    this.items = items || [];
    this.selected = prevEntryId != null
      ? this.items.findIndex(e => e.entryId === prevEntryId) : -1;
    if (this.selected < 0 && this.items.length === 1) this.selected = 0;
    this._render();
    this.show();
  }

  // -- affordability (defensive — aCis pre-filters the prepared list) -----------

  /** max exchanges the local inventory state supports (server validates
   *  again; 1..9999 per the packet). */
  _maxAmount(entry) {
    let max = 9999;
    for (const ing of entry.ingredients || []) {
      max = Math.min(max, Math.floor(this.getOwned(ing.itemId) / (ing.count || 1)));
    }
    return Math.max(0, max);
  }

  _affordable(entry) { return this._maxAmount(entry) > 0; }

  // -- choose --------------------------------------------------------------------

  _offerChoose(entry) {
    if (!this._affordable(entry)) return;   // grayed entries are dead ends
    const max = this._maxAmount(entry);
    if (max > 1) {
      // DEVIATION: the frozen op drops the packet's stackable flag, so the
      // prompt (NumberPad stand-in) is offered whenever more than one
      // exchange is affordable — equipment entries (max 1) skip it, like
      // the .uc's disabled count edit (uc:120-129)
      this._askAmount(max, (n) => this._choose(entry, n));
    } else {
      this._choose(entry, 1);
    }
  }

  _choose(entry, count) {
    // entryId/listId pass back VERBATIM (1-based into the prepared list;
    // listId is the XML-name hash — a mismatch nukes the list server-side)
    this.onChoose(this.listId, entry.entryId, count);
    // the result arrives via invUpdate + sysMsg (and possibly a refreshed
    // multisellList) — never assume success here
  }

  _ok() {
    const entry = this.items[this.selected];
    if (entry) this._offerChoose(entry);
  }

  // -- amount prompt (AUTHORED — stands in for DIALOG_NumberPad; same
  //    pattern as ShopWnd's) ------------------------------------------------------

  _buildAmountPrompt(parent) {
    const win = new L2Window({
      // AUTHORED prompt: the xdat declares no amount dialog for MultiSellWnd
      // (retail types the count into the window itself), so nothing sizes it.
      title: 'Amount', width: 180, height: 70, closable: false,
    });
    win.root.id = 'l2-multisell-amount';
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
    cancel.style.cssText = `position:absolute;left:${Skin.px(94)}px;`
      + `top:${Skin.px(38)}px;width:${Skin.px(76)}px;height:${Skin.px(23)}px;`
      + 'cursor:pointer;display:flex;align-items:center;justify-content:center;';
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
    this.amountInput.max = String(max);
    // AUTHORED centering (the prompt is the port's own, nothing to mine)
    this.amountWin.place({
      left: window.innerWidth / 2 - Skin.px(90), top: window.innerHeight / 2 - Skin.px(35),
    });
    this.amountWin.show();
    this.amountInput.focus();
    this.amountInput.select();
  }

  // -- rendering -------------------------------------------------------------------

  async _entryCell(entry, index) {
    const meta = await itemMeta();
    const prod = (entry.products || [])[0] || {};
    const info = itemInfo(meta, prod.itemId);
    const affordable = this._affordable(entry);
    const cell = document.createElement('div');
    cell.className = 'l2-multisell-cell';
    cell.dataset.entryId = String(entry.entryId);
    cell.style.cssText = 'position:relative;display:inline-block;overflow:hidden;'
      + `width:${Skin.px(this.listPane.pitch.x)}px;`
      + `height:${Skin.px(this.listPane.pitch.y)}px;`
      + `cursor:${affordable ? 'pointer' : 'default'};vertical-align:top;`
      + (affordable ? '' : 'opacity:0.35;')
      // AUTHORED selection outline. Nothing in the client decides this:
      // no ItemWindow record carries a colour, NCItemWnd's render holds
      // exactly ONE colour immediate (the stack-count badge -- asserted by
      // tools/ui/mine_native_colors.py section 2), and no xdat control names
      // a selection texture. `L2UI_CH3.iconselect1/2` DO exist in the
      // extracted texture library and are referenced by nothing we have
      // decoded; if someone ties them to item selection this outline should
      // be replaced by that art, not by another colour.
      + (index === this.selected ? 'outline:1px solid #c8a959;' : '');
    cell.title = displayName(info, prod.enchant)
      + ((entry.products || []).length > 1 ? ` (+${entry.products.length - 1} more)` : '')
      + (affordable ? '' : ' (missing ingredients)');
    // the icon cell is the xdat grid's cellX (32) — from the pane record
    const icon = document.createElement('div');
    icon.style.cssText = `width:${Skin.px(this.listPane.icon)}px;`
      + `height:${Skin.px(this.listPane.icon)}px;margin:0 auto;`;
    if (info.icon) {
      const img = document.createElement('img');
      img.src = info.icon;
      img.style.cssText = `width:${Skin.px(this.listPane.icon)}px;`
        + `height:${Skin.px(this.listPane.icon)}px;display:block;`;
      img.draggable = false;
      icon.appendChild(img);
    } else {
      // AUTHORED: retail draws nothing when an icon is missing -- NCItemWnd
      // paints the slot art and the icon texture, with no placeholder glyph.
      // This '?' is a port-only affordance, so no record can govern it.
      Font.set(icon, '?', { color: '#8a93a5' });
    }
    cell.appendChild(icon);
    cell.addEventListener('click', () => {
      if (!affordable) return;   // grayed entries are unclickable
      this.selected = index;
      this._renderSelection();
      this._renderDetail();
    });
    cell.addEventListener('dblclick', () => {
      if (!affordable) return;   // grayed entries are unclickable
      this.selected = index;
      this._offerChoose(entry);
    });
    return cell;
  }

  _renderSelection() {
    [...this.listPane.el.children].forEach((cell, i) => {
      // AUTHORED selection outline. Nothing in the client decides this:
      // no ItemWindow record carries a colour, NCItemWnd's render holds
      // exactly ONE colour immediate (the stack-count badge -- asserted by
      // tools/ui/mine_native_colors.py section 2), and no xdat control names
      // a selection texture. `L2UI_CH3.iconselect1/2` DO exist in the
      // extracted texture library and are referenced by nothing we have
      // decoded; if someone ties them to item selection this outline should
      // be replaced by that art, not by another colour.
      cell.style.outline = i === this.selected ? '1px solid #c8a959' : '';
    });
  }

  /** Detail row for the ItemInfo/NeededItem panes. AUTHORED row layout
   *  (those controls are native MultiSellItemInfo/MultiSellNeededItem —
   *  their inner rows are not in the xdat): a 32px icon (the ItemList
   *  grid's decoded cellX) + name + counts. */
  async _detailRow(parentEl, item, { owned = null } = {}) {
    const meta = await itemMeta();
    const info = itemInfo(meta, item.itemId);
    const cellIcon = this.listPane.icon;   // 32px, from the xdat grid
    const row = document.createElement('div');
    // AUTHORED row metrics (the native detail controls decode no grid)
    row.style.cssText = 'position:relative;display:flex;align-items:center;'
      + `min-height:${Skin.px(cellIcon + 2)}px;gap:${Skin.px(6)}px;`;
    const icon = document.createElement('div');
    icon.style.cssText = `flex:0 0 ${Skin.px(cellIcon)}px;height:${Skin.px(cellIcon)}px;`;
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
    row.appendChild(icon);
    const text = document.createElement('div');
    const name = document.createElement('div');
    // the row sits under the Text2/Text3 pane headings; MultiSellWnd has no
    // per-row record, so the item name takes the window's own text colour
    Font.set(name, displayName(info, item.enchant),
             { color: Layout.textColor(WND, 'Text2') });
    text.appendChild(name);
    const counts = document.createElement('div');
    if (owned != null) {
      // ingredient: owned/required — red when short
      const short = owned < item.count;
      Font.set(counts, `${owned}/${item.count}`,
               { color: short ? SHORT_COLOR : ENOUGH_COLOR });
    } else if (item.count > 1) {
      Font.set(counts, `x${item.count}`, { color: Layout.textColor(WND, 'Text3') });
    }
    text.appendChild(counts);
    row.appendChild(text);
    row.title = displayName(info, item.enchant);
    parentEl.appendChild(row);
  }

  async _renderDetail() {
    this.productsEl.replaceChildren();
    this.neededEl.replaceChildren();
    const entry = this.items[this.selected];
    if (!entry) return;
    for (const p of entry.products || []) {
      await this._detailRow(this.productsEl, p);
    }
    for (const ing of entry.ingredients || []) {
      await this._detailRow(this.neededEl, ing, { owned: this.getOwned(ing.itemId) });
    }
  }

  async _render() {
    this.listPane.el.replaceChildren();
    for (let i = 0; i < this.items.length; i++) {
      this.listPane.el.appendChild(await this._entryCell(this.items[i], i));
    }
    await this._renderDetail();
  }

  /** Owned counts follow the inventory (server truth via invUpdate /
   *  itemList): re-tint grayed entries and the ingredient rows. */
  onInvUpdate() {
    if (this.visible) this._render();
  }

  place(o = {}) { this.win.place(o); return this; }
  show() { this.win.show(); return this; }
  hide() { this.win.hide(); if (this.amountWin) this.amountWin.hide(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { this.win.toggle(force); return this; }

  onDefaultPosition() {
    if (this.defaultPlace) this.place(this.defaultPlace);
  }
}
