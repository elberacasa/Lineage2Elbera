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

import { Layout } from './layout.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { WndMgr } from './wndmgr.js';
import { skillMeta, skillInfo, itemMeta, itemInfo, actionMeta, actionInfo }
  from '../gamedata.js';
import { skillType } from './skillwnd.js';

const MAX_PAGE = 10;          // ShortcutWnd.uc:3
const SLOTS_PER_PAGE = 12;    // ShortcutWnd.uc:4

// Slot positions: EXACT, from the xdat's nested slot records
// (docs/ui-mined-native.md §1c — all 12 slots are declared as variants
// inside Shortcut1's span; earlier notes said only Shortcut1 exists, which
// the deeper decode disproved). SOURCED table:
//   slot  1   2   3   4  |  5    6    7    8  |  9    10   11   12
//   pos  32  69  106 143 | 185  222  259  296 | 338  375  412  449
// pitch 37 (36px slot + 1px) with a +5px separator after slots 4 and 8,
// grouping the bar 4|4|4. Vertical mirrors: (5,32) first slot.
const SLOT_X = [32, 69, 106, 143, 185, 222, 259, 296, 338, 375, 412, 449];
const SLOT_Y = [32, 69, 106, 143, 185, 222, 259, 296, 338, 375, 412, 449];
const SLOT = 36;
const SLOT_Y0 = 5, SLOT_V_X0 = 5;

const ALLOWED_TYPES = new Set(['skill', 'item', 'action']);

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
    const def = Layout.size(H, 'ShortcutWndHorizontal') || { w: 504, h: 46 };
    this.w = def.w; this.h = def.h;
    const vdef = Layout.size(H, 'ShortcutWndVertical') || { w: 46, h: 504 };
    this.vw = vdef.w; this.vh = vdef.h;
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
        for (const [page, slots] of Object.entries(parsed)) {
          if ((+page >= 0) && +page < MAX_PAGE) {
            this.data[page] = {};
            for (const [i, s] of Object.entries(slots)) {
              if (s && ALLOWED_TYPES.has(s.type) && +i >= 0 && +i < SLOTS_PER_PAGE) {
                this.data[page][i] = s;
              }
            }
          }
        }
      }
    } catch { /* fresh bar */ }
    this.render();
  }

  save() {
    const out = {};
    for (const [page, slots] of Object.entries(this.data)) {
      if (page === '0') Object.assign(out, slots);       // page 0 stays flat
      else out[page] = slots;
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
  toggleRotate() { this.vertical = !this.vertical; this.render(); }
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

  _btn(ctrlName, onClick, subName) {
    const size = Layout.size(this.H, ctrlName);
    const pos = subName ? this._ctrlPos(subName, ctrlName)
      : Layout.pos(this.H, ctrlName);
    const tex = Layout.tex(this.H, ctrlName).filter(r => Skin.sprite(r));
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
    const info = s.type === 'skill' ? skillInfo(sm, s.id) : itemInfo(im, s.id);
    el.title = info.name;
    el.innerHTML = (info.icon ? `<img src="${info.icon}" alt="">`
      : '<div class="icon-fallback">?</div>') + el.innerHTML;
  }

  _renderRow(host, page, x0, y0, vertical) {
    const slots = this.data[page] || {};
    for (let i = 0; i < SLOTS_PER_PAGE; i++) {
      const el = document.createElement('div');
      el.className = 'shortcut-slot' + (slots[i] ? '' : ' empty');
      if (slots[i]) { el.dataset.stype = slots[i].type; el.dataset.sid = slots[i].id; }
      const x = vertical ? x0 : SLOT_X[i];
      const y = vertical ? SLOT_Y[i] : y0;
      el.style.cssText = `position:absolute;left:${Skin.px(x)}px;`
        + `top:${Skin.px(y)}px;width:${Skin.px(SLOT)}px;height:${Skin.px(SLOT)}px;`;
      // F-key badge at the slot's top-left corner; its size is the xdat's
      // (F1Tex 16x16), not a chosen number
      const fArt = this.fArts[i];
      const fSize = Layout.size(this.H, 'F1Tex');
      if (fArt && fSize) {
        const f = document.createElement('div');
        f.style.cssText = 'position:absolute;left:0;top:0;width:'
          + `${Skin.px(fSize.w)}px;height:${Skin.px(fSize.h)}px;pointer-events:none;z-index:1;`;
        Skin.apply(f, fArt);
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

  _renderBar({ vertical, page, x = 0, y = 0, backRef, backSize, main }) {
    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;left:${Skin.px(x)}px;top:${Skin.px(y)}px;`
      + `width:${Skin.px(vertical ? this.vw : this.w)}px;`
      + `height:${Skin.px(vertical ? this.vh : this.h)}px;`;
    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    if (backRef) Skin.apply(back, backRef, { content: backSize, stretch: true });
    bar.appendChild(back);

    this._renderRow(bar, page,
      vertical ? SLOT_V_X0 : SLOT_X[0], vertical ? SLOT_Y[0] : SLOT_Y0, vertical);

    if (main) {
      // page number over PageNumTextBox's mined rect (10,0 / 0,16)
      const ppos = Layout.pos(this.H, 'PageNumTextBox');
      const pnum = document.createElement('div');
      const pSize = Layout.size(this.H, 'PageNumTextBox') || { w: 20, h: 10 };
      pnum.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(vertical ? 0 : ppos.x)}px;`
        + `top:${Skin.px(vertical ? pSize.h + 6 : ppos.y)}px;`
        + `width:${Skin.px(pSize.w + 8)}px;height:${Skin.px(pSize.h + 2)}px;`;
      Font.set(pnum, `${this.page + 1}/${MAX_PAGE}`, { color: '#c9a959' });
      bar.appendChild(pnum);

      const subName = vertical ? 'ShortcutWndVertical' : 'ShortcutWndHorizontal';
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
    const backRef = Layout.tex0(this.H, vertical ? 'ShortcutWndVertical' : 'ShortcutWndHorizontal');
    const backSize = Layout.size(this.H, vertical ? 'ShortcutWndVertical' : 'ShortcutWndHorizontal');
    const bar = this._renderBar({
      vertical, page: this.page, backRef, backSize, main: true,
    });
    this.root.appendChild(bar);

    // expanded: two more rows above (ShortcutWndHorizontal_1/_2 layouts)
    if (this.expanded && !vertical) {
      for (let r = 2; r >= 1; r--) {
        const row = this._renderBar({
          vertical: false, page: Math.min(MAX_PAGE - 1, this.page + r),
          y: -this.h * r,
          backRef: Layout.tex0(this.H, `ShortcutWndHorizontal_${r}`),
          backSize: Layout.size(this.H, `ShortcutWndHorizontal_${r}`),
          main: false,
        });
        this.root.appendChild(row);
      }
    }

    const totalW = vertical ? this.vw : this.w;
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

  /** WndMgr reset: SOURCED docks — WindowsInfo.ini [ShortcutWndHorizontal]
   *  posX=347 posY=722 / [ShortcutWndVertical] posX=805 posY=264, absolute
   *  retail px at 1024x768 (Skin.px applies the uiScale; no proportional
   *  rescale — retail doesn't scale UI with resolution). */
  onDefaultPosition() {
    const el = this.root;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    const d = this.vertical ? { left: 805, top: 264 } : { left: 347, top: 722 };
    el.style.left = `${Skin.px(d.left)}px`;
    el.style.top = `${Skin.px(d.top)}px`;
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
