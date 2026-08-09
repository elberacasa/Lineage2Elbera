// ElberaSkin runtime — ShortcutWnd, the retail shortcut bar.
//
// Behavioral spec: assets/uscript/Interface/ShortcutWnd.uc (read, not
// transcribed) — MAX_Page = 10 pages, MAX_ShortcutPerPage = 12 slots
// (constants at ShortcutWnd.uc:3-4, so both numbers are sourced).
// Layout spec: docs/ui-mined-values.md §3 (horizontal: 504x46 container,
// Shortcut1 36x36 at (32,5), F1Tex 16x16 at (32,4), PageNumTextBox 20x10 at
// (10,0), NextBtn/PrevBtn 14x14 at (13,1)/(13,31), Expand/Reduce (1,8),
// Joypad/Rotate/Lock 15x15 at left edge x=0-1; vertical: 46x504, slot at
// (5,32)). Option.ini defaults: horizontal, not expanded, not locked.
//
// Slot types: EShortCutItemType {NONE, ITEM, SKILL, ACTION, MACRO, RECIPE}.
// ITEM, SKILL and ACTION are wired (useItem/useSkill/action). MACRO/RECIPE
// are recognized but dropping them is rejected — AUTHORED: nothing in the
// web port produces those types yet, so the slots exist in the type model
// only.
//
// WHAT WAS WRONG (measured 2026-08-08, before/after shots in the report):
// the bar painted NO background in its default orientation, so the twelve
// mined slot origins sat on nothing and the port drew a CSS box per slot to
// compensate — the same "flat coloured stripe" failure the status gauges had.
// Two separate causes, both in what is painted, not where:
//
//   1. `ShortcutWndHorizontal`'s texture list opens with the intra-UI control
//      reference `ShortcutWnd.ShortcutWndVertical` (a real string in the
//      file, harvested correctly — it is simply not a texture), so `tex0`
//      handed Skin.apply a name that resolves to no sprite and Skin.apply
//      set `background: none`. Every other record in this window is clean,
//      which is why only the DEFAULT orientation was blank. Fixed by
//      filtering to refs that resolve, the same guard `_btn` and `fArts`
//      already used.
//   2. The art is 492x46 inside a 504x46 window and is NOT anchored at the
//      window origin. tools/ui/mine_shortcutslots.py measures the twelve
//      wells the art paints and solves for the placement that puts them
//      under the twelve xdat slot rects: +13 on the bar's long axis, 0 on
//      the short axis, identical in both orientations, all twelve agreeing.
//      Passing the DECLARED 504x46 as the sprite's content rect (what the
//      old code did) told the skin a 492px art was 504px wide and stretched
//      it, which moves every well off its slot.
//
// So the slots no longer draw a box: the retail plate already paints the
// well, exactly as InventoryWnd's cells stopped doing (see style.css).

import { Layout } from './layout.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { WndMgr } from './wndmgr.js';
import { skillMeta, skillInfo, itemMeta, itemInfo, actionMeta, actionInfo }
  from '../gamedata.js';
import { skillType } from './skillwnd.js';
import { activeInventory } from './inventorywnd.js';

/** An item shortcut stores the inventory OBJECT id, not the item id.
 *  InventoryWnd's drag payload and its right-click assign both send
 *  `{type:'item', id: it.objectId}` (inventorywnd.js), aCis stores the same
 *  thing (`character_shortcuts.id` is the objectId — ShortcutList.addShortcut
 *  looks it up with getItemByObjectId), and useItem is addressed by objectId
 *  too. Everything that needs the ITEM id — the icon, the name, the shot
 *  mark — has to go through the live inventory to get it. Returns null when
 *  the inventory has no such object (an item consumed to zero, or a bar
 *  restored before the first itemList lands). */
function itemIdOf(objectId) {
  const inv = activeInventory();
  const it = inv && inv.items && inv.items.get(objectId);
  return it ? it.itemId : null;
}

const MAX_PAGE = 10;          // ShortcutWnd.uc:3
const SLOTS_PER_PAGE = 12;    // ShortcutWnd.uc:4

// Slot positions: EXACT, from the xdat's nested slot records
// (docs/ui-mined-native.md §1c — all 12 slots are declared as variants
// inside Shortcut1's span; earlier notes said only Shortcut1 exists, which
// the deeper decode disproved):
//   slot  1   2   3   4  |  5    6    7    8  |  9    10   11   12
//   pos  32  69  106 143 | 185  222  259  296 | 338  375  412  449
// pitch 37 (36px slot + 1px) with a +5px separator after slots 4 and 8,
// grouping the bar 4|4|4. Vertical mirrors: (5,32) first slot.
//
// Those twelve numbers used to be duplicated into this file as SLOT_X /
// SLOT_Y / SLOT / SLOT_Y0 / SLOT_V_X0 "fallbacks". They are gone. The same
// twelve origins, the same 4|4|4 stepping and the 36px slot are re-derived
// from the background art by tools/ui/mine_shortcutslots.py, shipped in
// editor/world/ui/shortcutslots.json and READ through Layout.shortcutArt() —
// which is what proves the table: the art's own twelve wells reproduce the
// record decode independently, in both orientations. If that harvest is ever
// missing the bar draws no slots and says so, rather than laying them out
// from a copy nobody re-derived.

const ALLOWED_TYPES = new Set(['skill', 'item', 'action']);

// Page-number colour: the client's own, read off PageNumTextBox's record
// (all eight ShortcutWnd sub-windows store #DCDCDC — the same default grey
// NWindow.dll pushes for unclassified text, docs/ui-mined-native.md §2).
// This replaces an authored gold #c9a959. The constant is only the fallback
// for when the decode is unavailable.
const PAGE_COLOR_FALLBACK = '#DCDCDC';

// The bar may only hold castable skills — passives are rejected at every
// entry point (MagicSkillWnd.uc keeps them in a separate pane for exactly
// this reason; the old invented hotbar enforced the same rule). Actions
// carry no such restriction (ActionWnd.uc hands every cell to DoAction).
const acceptable = (s) => s && ALLOWED_TYPES.has(s.type)
  && !(s.type === 'skill' && skillType(s.id) === 'PASSIVE');

// WndMgr makes the WHOLE bar the drag handle; an unclaimed pointerdown on
// a slot/button would capture the pointer and retarget the click to the
// bar root, silently eating real-mouse clicks. Interactive children claim
// the press with stopPropagation (NOT preventDefault — the buttons' art
// swap listens to the compatibility mousedown, which preventDefault would
// suppress). Dragging the bar from empty frame space still works.
const claimPress = (e) => e.stopPropagation();

export class ShortcutWnd {
  constructor(parent = document.body, { onUseSkill, onUseItem, onUseAction, onNote } = {}) {
    this.onUseSkill = onUseSkill || (() => {});
    this.onUseItem = onUseItem || (() => {});
    this.onUseAction = onUseAction || (() => {});
    this.onNote = onNote || (() => {});
    this.page = 0;
    this.expanded = false;    // Option.ini default
    this.vertical = false;    // Option.ini default
    this.locked = false;      // Option.ini default (not locked)
    this.charName = 'default';
    this.data = {};           // page -> slotIndex -> {type, id}
    this._activeToggles = new Set();   // skill ids with a live toggle buff
    this._weaponGate = null;           // WeaponGate (js/weapongate.js)

    const H = 'ShortcutWnd';
    this.H = H;
    const def = Layout.sizeOf(H, 'ShortcutWndHorizontal');
    this.w = def.w; this.h = def.h;
    const vdef = Layout.sizeOf(H, 'ShortcutWndVertical');
    this.vw = vdef.w; this.vh = vdef.h;
    // Background placement per orientation, MEASURED from the art
    // (tools/ui/mine_shortcutslots.py — see the header). Null when the
    // harvest is missing: the bar then falls back to the constants above and
    // paints no plate rather than guessing where one would go.
    this.artH = Layout.shortcutArt('ShortcutWndHorizontal');
    this.artV = Layout.shortcutArt('ShortcutWndVertical');
    // F-key badge art enumerates f01..f12 (a control ref is interleaved —
    // filter to sprites that actually resolve)
    this.fArts = Layout.tex(H, 'F1Tex').filter(r => Skin.sprite(r));

    const root = document.createElement('div');
    root.id = 'l2-shortcutwnd';
    root.style.cssText = 'position:fixed;z-index:12;pointer-events:auto;';
    this.root = root;
    parent.appendChild(root);

    WndMgr.register('ShortcutWnd', this);
    this.render();
    this.onDefaultPosition();
  }

  // -- persistence ---------------------------------------------------------

  _key() { return `l2vzla.hotbar.${this.charName}`; }

  load(charName) {
    this.charName = charName || 'default';
    this.data = {};
    try {
      const raw = localStorage.getItem(this._key());
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        // migrate the invented 10-slot hotbar: entries become page 0
        parsed.forEach((s, i) => {
          if (s && ALLOWED_TYPES.has(s.type)) this.data[i] = s;
        });
      } else if (parsed && typeof parsed === 'object') {
        // MEASURED 2026-08-08 (before/after in verify_soulshot.js): this loop
        // used to read EVERY top-level key as a page, and save() writes page 0
        // FLAT — `{"0": {type:"item", id:...}}` is slot 0 of page 0, not page
        // 0. Parsed as a page, its "slots" are the entries of the slot object
        // ("type" -> "item", "id" -> 268530204), every one of which fails the
        // ALLOWED_TYPES test, so the whole of page 0 was dropped. Page 0 is
        // where assignFirstFree() puts everything, so in practice the ENTIRE
        // bar was wiped on the next load() — which runs at the end of the
        // enterWorld handler, i.e. on every relog. That is why a soulshot
        // dragged to the bar was simply gone after relogging.
        //
        // The two forms are told apart by the VALUE, not the key: a slot
        // carries a `type` STRING, a page is a map of slot index -> slot.
        for (const [key, val] of Object.entries(parsed)) {
          if (!val || typeof val !== 'object') continue;
          if (typeof val.type === 'string') {              // flat page-0 slot
            if (ALLOWED_TYPES.has(val.type) && +key >= 0 && +key < SLOTS_PER_PAGE) {
              if (!this.data[0]) this.data[0] = {};
              this.data[0][key] = val;
            }
            continue;
          }
          if ((+key >= 0) && +key < MAX_PAGE) {            // page -> slots
            if (!this.data[key]) this.data[key] = {};
            for (const [i, s] of Object.entries(val)) {
              if (s && ALLOWED_TYPES.has(s.type) && +i >= 0 && +i < SLOTS_PER_PAGE) {
                this.data[key][i] = s;
              }
            }
          }
        }
      }
    } catch { /* fresh bar */ }
    this.render();
  }

  save() {
    // Always the NESTED form, page -> {slot -> slot}. The old writer flattened
    // page 0 into the top level, which is not just unreadable by load() (see
    // there) but LOSSY on its own terms: page 1's entry and page 0's slot 1
    // both want the top-level key "1", and the later `out[page] = slots`
    // overwrote the flat slot. load() still accepts the flat form so a bar
    // saved by the old writer migrates instead of vanishing.
    const out = {};
    for (const [page, slots] of Object.entries(this.data)) {
      if (slots && Object.keys(slots).length) out[page] = slots;
    }
    try { localStorage.setItem(this._key(), JSON.stringify(out)); } catch {}
  }

  // -- slot model ------------------------------------------------------------

  assign(page, index, slot) {
    if (!this.data[page]) this.data[page] = {};
    if (slot) this.data[page][index] = slot;
    else delete this.data[page][index];
    this.save();
    this.render();
  }

  assignFirstFree(slot) {
    if (!acceptable(slot)) {
      // MACRO/RECIPE slots render but reject drops (see header note);
      // passives are not usable and never reach the bar
      this.onNote(`shortcut: ${slot.type} slots are not supported yet`);
      return -1;
    }
    for (let p = 0; p < MAX_PAGE; p++) {
      for (let i = 0; i < SLOTS_PER_PAGE; i++) {
        if (!(this.data[p] && this.data[p][i])) {
          this.assign(p, i, slot);
          return p * SLOTS_PER_PAGE + i;
        }
      }
    }
    return -1;
  }

  trigger(page, index) {
    const s = this.data[page] && this.data[page][index];
    if (!s) return;
    // weapon condition (aCis weaponsAllowed): a mismatching skill is inert —
    // the click is swallowed client-side, nothing is sent (retail behavior;
    // the server would reject it anyway)
    if (s.type === 'skill' && this._weaponGate && !this._weaponGate.allows(s.id)) {
      this.onNote('That skill cannot be used with the equipped weapon.');
      return;
    }
    if (s.type === 'skill') this.onUseSkill(s.id);
    else if (s.type === 'item') this.onUseItem(s.id);
    else if (s.type === 'action') this.onUseAction(s.id);
  }

  triggerF(i) {
    // F1..F12 trigger the CURRENT page's slots (retail behavior)
    if (i >= 0 && i < SLOTS_PER_PAGE) this.trigger(this.page, i);
  }

  flipPage(d) {
    this.page = Math.max(0, Math.min(MAX_PAGE - 1, this.page + d));
    this.render();
  }

  toggleExpand() { this.expanded = !this.expanded; this.render(); }
  toggleRotate() {
    this.vertical = !this.vertical;
    // re-dock to the orientation's SOURCED WindowsInfo.ini spot: keeping
    // the horizontal dock (347,722) parks the 504px-tall vertical bar
    // off the bottom of the screen
    this.onDefaultPosition();
    this.render();
  }
  toggleLock() { this.locked = !this.locked; this.render(); }

  // -- rendering ---------------------------------------------------------------

  // xdat name collisions: PrevBtn/NextBtn/LockBtn/JoypadBtn/ExpandButton
  // are declared PER sub-window (horizontal, vertical, joypad variants).
  // Layout's flat index is last-wins (the joypad record) — the slash-path
  // lookup (Layout.pos with 'Sub/Control') reaches the record inside OUR
  // orientation's sub-window instead.
  _ctrlPos(subName, ctrlName) {
    return Layout.pos(this.H, `${subName}/${ctrlName}`)
      || Layout.pos(this.H, ctrlName);   // flat last-wins as last resort
  }

  /** Same last-wins hazard as _ctrlPos, for the size and texture lookups:
   *  ExpandButton exists in BOTH orientations with DIFFERENT art
   *  (shortcut_expand vs shortcut_expandv), and the flat index returns
   *  whichever record the file happens to hold last. Resolve by path first. */
  _ctrl(subName, ctrlName, fn) {
    const hit = subName ? fn(this.H, `${subName}/${ctrlName}`) : null;
    // Layout.tex returns [] (truthy) for a miss, so emptiness is the test
    if (hit && !(Array.isArray(hit) && hit.length === 0)) return hit;
    return fn(this.H, ctrlName);
  }

  _btn(ctrlName, onClick, subName) {
    const size = this._ctrl(subName, ctrlName, Layout.size);
    const pos = subName ? this._ctrlPos(subName, ctrlName)
      : Layout.pos(this.H, ctrlName);
    const tex = this._ctrl(subName, ctrlName, Layout.tex)
      .filter(r => Skin.sprite(r));
    if (!size || !pos || !tex[0]) return null;
    const el = document.createElement('div');
    el.className = 'shortcut-btn';
    el.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
      + `top:${Skin.px(pos.y)}px;width:${Skin.px(size.w)}px;`
      + `height:${Skin.px(size.h)}px;cursor:pointer;`;
    Skin.apply(el, tex[0]);
    el.addEventListener('pointerdown', claimPress);
    if (tex[1]) {
      el.addEventListener('mousedown', () => Skin.apply(el, tex[1]));
      el.addEventListener('mouseup', () => Skin.apply(el, tex[0]));
    }
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return el;
  }

  async _slotContent(el, s) {
    if (s.type === 'action') {
      const am = await actionMeta();
      const info = actionInfo(am, s.id);
      el.title = info.name;
      // action icons were not mined (only action102.png exists) — label
      // first, icon layered on top only if the png resolves (same degrade
      // as ActionWnd's cells)
      const label = document.createElement('div');
      // AUTHORED size and colour: same case as ActionWnd's cells -- retail
      // drew the action ICON here and never any text, so nothing in the
      // client governs a label's font or colour.
      label.style.cssText = 'position:absolute;inset:0;font:8px sans-serif;'
        + 'color:#d8cba6;text-align:center;line-height:9px;overflow:hidden;'
        + 'display:flex;align-items:center;justify-content:center;'
        + 'text-shadow:0 1px 1px #000;pointer-events:none;';
      label.textContent = info.name;
      el.appendChild(label);
      if (info.icon) {
        const img = document.createElement('img');
        img.src = info.icon;
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;';
        img.addEventListener('load', () => {
          img.style.display = 'block';
          label.style.display = 'none';
        });
        img.addEventListener('error', () => img.remove());
        el.appendChild(img);
      }
      return;
    }
    const [sm, im] = await Promise.all([skillMeta(), itemMeta()]);
    // MEASURED 2026-08-08: this used to call itemInfo(im, s.id) with s.id =
    // the OBJECT id, so every item shortcut missed the item table outright and
    // drew the "?" fallback with the tooltip "Item #268530204". Resolve the
    // object id through the inventory first (itemIdOf); with no inventory yet
    // there is genuinely no answer, and the "?" fallback stands.
    const itemId = s.type === 'item' ? itemIdOf(s.id) : null;
    const info = s.type === 'skill' ? skillInfo(sm, s.id)
      : (itemId != null ? itemInfo(im, itemId) : { name: `Item #${s.id}`, icon: null });
    el.title = info.name;
    el.innerHTML = (info.icon ? `<img src="${info.icon}" alt="">`
      : '<div class="icon-fallback">?</div>') + el.innerHTML;
  }

  /** The mined art record for an orientation, or null. */
  _art(vertical) { return vertical ? this.artV : this.artH; }

  _renderRow(host, page, vertical, subName) {
    const slots = this.data[page] || {};
    const art = this._art(vertical);
    // No harvest -> no slots. Every number below (the 36px slot rect, the
    // 32px icon cell inside it, the 2px inset, the constant short-axis
    // origin and the twelve long-axis origins) is MEASURED off the
    // background art by tools/ui/mine_shortcutslots.py; none of them has an
    // honest substitute, so the row degrades to empty instead.
    if (!art) return;
    const inset = art.iconInset;
    const cell = art.iconCell;
    // Shortcut1's constant short-axis origin: y horizontal, x vertical. The
    // art gives the same number for both, which is why one field covers both.
    const short = art.slotShort;
    const table = art.slotOrigins;
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const el = document.createElement('div');
      el.className = 'shortcut-slot' + (slots[i] ? '' : ' empty');
      if (slots[i]) { el.dataset.stype = slots[i].type; el.dataset.sid = slots[i].id; }
      const x = vertical ? short : table[i];
      const y = vertical ? table[i] : short;
      el.style.cssText = `position:absolute;left:${Skin.px(x + inset)}px;`
        + `top:${Skin.px(y + inset)}px;`
        + `width:${Skin.px(cell)}px;height:${Skin.px(cell)}px;`;
      // F-key badge. Size AND placement are the xdat's, not chosen: F1Tex is
      // 16x16 at (32,4) horizontal against Shortcut1 (32,5), and (4,32)
      // vertical against (5,32) — i.e. the badge sits one pixel outside the
      // slot rect on the bar's SHORT axis and flush with it on the long one.
      // The badge is a child of the icon box, which is itself inset into the
      // slot rect, so the delta carries that inset back out.
      const fArt = this.fArts[i];
      const fSize = this._ctrl(subName, 'F1Tex', Layout.size);
      const fPos = this._ctrlPos(subName, 'F1Tex');
      const sPos = this._ctrlPos(subName, 'Shortcut1');
      if (fArt && fSize && fPos && sPos) {
        const f = document.createElement('div');
        f.style.cssText = 'position:absolute;pointer-events:none;z-index:1;'
          + `left:${Skin.px(fPos.x - sPos.x - inset)}px;`
          + `top:${Skin.px(fPos.y - sPos.y - inset)}px;`
          + `width:${Skin.px(fSize.w)}px;height:${Skin.px(fSize.h)}px;`;
        // Draw the badge 1:1, NOT scaled to the control rect.
        //
        // Skin.apply defaults to blowing a sprite's measured content up until
        // it fills the element, which is right when the xdat rect IS the art
        // (shortcut_nextv: rect 14x14, content 14x14) and wrong here: F1Tex's
        // rect is 16x16, exactly the PADDED export size, while the digits are
        // 6x10 (f01) through 15x10 (f10, f12). Scaling each into 16x16 makes
        // "1" and "12" the same width and 60% taller than authored — it
        // destroys the per-digit widths the art deliberately carries. Passing
        // the FILE size as the content rect gives backgroundSize 100%, i.e.
        // the export drawn at native size with its padding intact, which is
        // what a rect equal to the padded size asks for.
        const sp = Skin.sprite(fArt);
        Skin.apply(f, fArt, (sp && sp.w === fSize.w && sp.h === fSize.h)
          ? { content: { w: sp.w, h: sp.h } } : {});
        el.appendChild(f);
      }
      el.addEventListener('click', () => this.trigger(page, i));
      el.addEventListener('pointerdown', claimPress);
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.assign(page, i, null);   // right-click clears (retail)
      });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/x-l2vzla'));
          if (!acceptable(data)) {
            this.onNote(`shortcut: ${data.type} slots are not supported yet`);
            return;
          }
          this.assign(page, i, data);
        } catch { /* not ours */ }
      });
      if (slots[i]) this._slotContent(el, slots[i]);
      host.appendChild(el);
    }
  }

  /** Paint one bar's background plate.
   *
   *  `refs` is the sub-window record's whole texture list, NOT its first
   *  entry: ShortcutWndHorizontal's list opens with the intra-UI control
   *  reference `ShortcutWnd.ShortcutWndVertical`, which resolves to no
   *  sprite, and Skin.apply answers an unknown ref with `background: none`.
   *  That one line is why the default bar was blank. Filter to refs that
   *  actually resolve — the same guard _btn and fArts already apply.
   *
   *  The plate is then drawn at ITS OWN measured size, displaced by the
   *  mined art offset (MEASURED, mine_shortcutslots.py: +13 along the bar's
   *  long axis). Stretching it to the declared window size instead — which
   *  is what passing the 504x46 window rect as the sprite's content rect
   *  did — moves all twelve wells off the twelve mined slot rects. */
  _plate(refs, vertical) {
    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;pointer-events:none;';
    const ref = (refs || []).find(r => Skin.sprite(r));
    if (!ref) return back;          // no art: paint nothing, invent nothing
    const art = this._art(vertical);
    const c = Skin.content(ref);
    const ox = art ? art.artOffsetX : 0;
    const oy = art ? art.artOffsetY : 0;
    back.style.left = `${Skin.px(ox)}px`;
    back.style.top = `${Skin.px(oy)}px`;
    back.style.width = `${Skin.px(c ? c.w : 0)}px`;
    back.style.height = `${Skin.px(c ? c.h : 0)}px`;
    Skin.apply(back, ref);
    return back;
  }

  _renderBar({ vertical, page, x = 0, y = 0, backRefs, main }) {
    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;left:${Skin.px(x)}px;top:${Skin.px(y)}px;`
      + `width:${Skin.px(vertical ? this.vw : this.w)}px;`
      + `height:${Skin.px(vertical ? this.vh : this.h)}px;overflow:hidden;`;
    bar.appendChild(this._plate(backRefs, vertical));

    const subName = vertical ? 'ShortcutWndVertical' : 'ShortcutWndHorizontal';
    this._renderRow(bar, page, vertical, subName);

    if (main) {
      // page number on PageNumTextBox's own rect. The lookup MUST be by path:
      // five sub-windows declare a PageNumTextBox and the flat index is
      // last-wins (the joypad record, 10,0), which is not the vertical bar's
      // (0,16). Both rects are the xdat's; neither is padded by hand.
      const ppos = this._ctrlPos(subName, 'PageNumTextBox');
      const pSize = this._ctrl(subName, 'PageNumTextBox', Layout.size)
        || { w: 20, h: 10 };
      if (ppos) {
        const pnum = document.createElement('div');
        pnum.style.cssText = 'position:absolute;pointer-events:none;'
          + `left:${Skin.px(ppos.x)}px;top:${Skin.px(ppos.y)}px;`
          + `width:${Skin.px(pSize.w)}px;height:${Skin.px(pSize.h)}px;`;
        Font.set(pnum, `${this.page + 1}/${MAX_PAGE}`, {
          color: Layout.color(this.H, `${subName}/PageNumTextBox`)
            || PAGE_COLOR_FALLBACK,
        });
        bar.appendChild(pnum);
      }

      for (const [ctrl, fn] of [
        ['NextBtn', () => this.flipPage(1)],
        ['PrevBtn', () => this.flipPage(-1)],
        [this.expanded ? 'ReduceButton' : 'ExpandButton', () => this.toggleExpand()],
        ['RotateBtn', () => this.toggleRotate()],
        [this.locked ? 'UnlockBtn' : 'LockBtn', () => this.toggleLock()],
      ]) {
        const b = this._btn(ctrl, fn, subName);
        if (b) bar.appendChild(b);
      }
      // JoypadBtn exists in the layout but is disabled — AUTHORED: the
      // joypad bar modes are not wired (no joypad input in a browser).
      const j = this._btn('JoypadBtn', () => {}, subName);
      if (j) { j.classList.add('disabled'); j.title = 'Joypad mode: not supported'; bar.appendChild(j); }
    }
    return bar;
  }

  render() {
    this.root.innerHTML = '';
    const vertical = this.vertical;
    const sub = vertical ? 'ShortcutWndVertical' : 'ShortcutWndHorizontal';
    const bar = this._renderBar({
      vertical, page: this.page, backRefs: Layout.tex(this.H, sub), main: true,
    });
    this.root.appendChild(bar);

    // expanded: two more rows above, because ShortcutWndHorizontal_1 and _2
    // are the only expanded-row sub-windows Interface.xdat declares --
    // and WindowsInfo.ini agrees, carrying _1/_2 and nothing beyond.
    if (this.expanded && !vertical) {
      for (let r = 2; r >= 1; r--) {
        const row = this._renderBar({
          vertical: false, page: Math.min(MAX_PAGE - 1, this.page + r),
          y: -this.h * r,
          backRefs: Layout.tex(this.H, `ShortcutWndHorizontal_${r}`),
          main: false,
        });
        this.root.appendChild(row);
      }
    }

    const totalW = vertical ? this.vw : this.w;
    // 3 rows = the main bar plus the two the xdat declares (see render()).
    const totalH = vertical ? this.vh : this.h * (this.expanded ? 3 : 1);
    this.root.style.width = `${Skin.px(totalW)}px`;
    this.root.style.height = `${Skin.px(totalH)}px`;
    if (this.expanded && !vertical) {
      // keep the main row in place: shift the root up by the extra rows
      this.root.style.marginTop = `${Skin.px(-this.h * 2)}px`;
    } else {
      this.root.style.marginTop = '0';
    }
    this._applyToggleMarks();
  }

  /** Active-toggle marker — same sourced-signal / AUTHORED-visual split as
   *  SkillWnd.setActiveToggles (see there): a -1-duration buff marks the
   *  toggle active; neither ShortcutWnd.uc nor MagicSkillWnd.uc draws that
   *  state (both checked), so a border stands in. Clicking the slot again
   *  re-sends useSkill and aCis stops the effect (PlayerCast.doToggleCast). */
  setActiveToggles(ids) {
    this._activeToggles = ids || new Set();
    this._applyToggleMarks();
    return this;
  }

  _applyToggleMarks() {
    const ids = this._activeToggles || new Set();
    for (const el of this.root.querySelectorAll('.shortcut-slot[data-stype="skill"]')) {
      const id = +el.dataset.sid;
      el.classList.toggle('l2-toggle-active',
        ids.has(id) && skillType(id) === 'TOGGLE');
    }
    this._applyWeaponMarks();
    this._applyShotMarks();
  }

  /** Soulshot/spiritshot automatic use. Same standing-state problem as a
   *  toggle skill, but shots sit in ITEM slots, so the toggle query above
   *  never reaches them. Driven by ExAutoSoulShot, which the server sends
   *  only when the toggle actually took — never from the click.
   *
   *  aCis keys the state by ITEM id (Player._activeSoulShots is a Set<Integer>
   *  of item ids, and ExAutoSoulShot carries the item id), while main.js hands
   *  this method the OBJECT ids that currently carry those item ids. Both are
   *  kept: the object-id set is the literal argument, and the item-id set
   *  derived from it is what the marks actually match on, so a slot stays
   *  marked when a stack is consumed and re-created under a new object id —
   *  an InventoryUpdate that main.js does not re-derive the object ids for.
   *  With no inventory available (unit tests, pre-boot) the object-id set is
   *  the only comparison, exactly as before. */
  setActiveShots(ids) {
    this._activeShots = ids || new Set();
    this._activeShotItems = new Set();
    for (const oid of this._activeShots) {
      const itemId = itemIdOf(oid);
      if (itemId != null) this._activeShotItems.add(itemId);
    }
    this._applyShotMarks();
    return this;
  }

  _applyShotMarks() {
    const oids = this._activeShots || new Set();
    const itemIds = this._activeShotItems || new Set();
    for (const el of this.root.querySelectorAll('.shortcut-slot[data-stype="item"]')) {
      const oid = +el.dataset.sid;
      const itemId = itemIdOf(oid);
      el.classList.toggle('l2-toggle-active',
        oids.has(oid) || (itemId != null && itemIds.has(itemId)));
    }
  }

  /** Weapon-condition gray-out — the SIGNAL is sourced (aCis weaponsAllowed
   *  via the WeaponGate); the VISUAL mirrors the skill window's own inert
   *  treatment (opacity 0.4, the same as its Lock-flag cells). */
  setWeaponGate(gate) {
    this._weaponGate = gate || null;
    this._applyWeaponMarks();
    return this;
  }

  _applyWeaponMarks() {
    const gate = this._weaponGate;
    for (const el of this.root.querySelectorAll('.shortcut-slot[data-stype="skill"]')) {
      const blocked = !!(gate && !gate.allows(+el.dataset.sid));
      el.classList.toggle('l2-weapon-mismatch', blocked);
      el.style.opacity = blocked ? '0.4' : '';
    }
  }

  /** Cooldown sweep, driven from the main loop. TIMING is sourced
   *  (skillCoolTime reuse ms / the cast lock's hitTime via skillBar.reuse);
   *  the VISUAL is AUTHORED — the native sweep rendering isn't mineable,
   *  so a dark overlay drains top-to-bottom over the remaining fraction. */
  tickCooldowns(skillBar) {
    for (const el of this.root.querySelectorAll('.shortcut-slot[data-stype="skill"]')) {
      const left = skillBar.reuseLeft(+el.dataset.sid);
      let ov = el.querySelector('.l2-cool-overlay');
      if (!left) { if (ov) ov.remove(); continue; }
      if (!ov) {
        ov = document.createElement('div');
        ov.className = 'l2-cool-overlay';
        ov.style.cssText = 'position:absolute;left:0;top:0;width:100%;'
          + 'background:rgba(0,0,0,0.65);pointer-events:none;';
        el.appendChild(ov);
      }
      ov.style.height = `${(left.frac * 100).toFixed(1)}%`;
    }
  }

  /** WndMgr reset: the dock is READ from the client's own WindowsInfo.ini
   *  ([ShortcutWndHorizontal] / [ShortcutWndVertical]) through Layout.dock(),
   *  in absolute retail px at 1024x768 — Skin.px applies the uiScale, and
   *  retail does not scale its UI with resolution. If the harvest is missing
   *  the bar keeps its current spot rather than jumping to a typed one. */
  onDefaultPosition() {
    const el = this.root;
    const d = Layout.dock(this.vertical
      ? 'ShortcutWndVertical' : 'ShortcutWndHorizontal');
    if (!d) return;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `${Skin.px(d.x)}px`;
    el.style.top = `${Skin.px(d.y)}px`;
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${o.left}px`;
    if (o.top != null) el.style.top = `${o.top}px`;
    if (o.right != null) el.style.right = `${o.right}px`;
    if (o.bottom != null) el.style.bottom = `${o.bottom}px`;
    return this;
  }
}
