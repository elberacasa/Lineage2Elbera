// ElberaSkin runtime — TargetStatusWnd, the retail target frame.
//
// Layout: docs/ui-mined-values.md §3 (window 176x46) + the hasSize==0
// decode (docs/xdat-tail-has0.md) for everything inside it, ALL via
// Layout.pos / Layout.autosize:
//   BackTex/BackExpTex (12,0) autosize (1,1) insetA -12 -> width 164
//   UserName (12,9) insetA -33 -> width 143, name CENTERED (TA_Center,
//     TargetStatusWnd.uc:206/228/252/266/293)
//   barHP (16,26) / barMP (16,33) insetA -26 -> width 150 (7px pitch)
//   btnClose 15x15 — x/y among the 23 undecoded hasSize==0 records:
//     AUTHORED position (top-right corner).
//   Expand rows (txtPledge/texPledgeCrest/txtPledgeName y=43, alliance
//     y=59, NpcInfo tree 158x33 at (18,40)) sit OUTSIDE the base height —
//     the expand mode (uc SetExpandMode). NpcInfo tree is SKIPPED (no
//     data); pledge rows likewise (no clan data in the bridge contract).
//
// Behavior (TargetStatusWnd.uc, read not transcribed):
//   - name centered, colored by con-level (SetNameWithColor, uc:266)
//   - MP bar only for NON-attackable targets: `if (!(bNpc && !bPet &&
//     bCanBeAttacked)) bShowMPBar = true` (uc:275-277). Our bridge has no
//     bCanBeAttacked flag — rule applied: monsters (kind 'npc') show HP
//     only; players show HP+MP (noted in code).
//   - close button hides the frame; the server-side target stays
//
// Con-color (ui-port-handoff.md §4, sign settled by protocol: gateway's
// target_ok.color = viewerLevel - targetLevel, raw from aCis
// MyTargetSelected; verify-level proved 1-1=0). diff -> name color:
//   <=-9 #FF0000 | -8..-6 #FF9191 | -5..-3 #FAFE91 | -2..2 #DCDCDC
//   3..5 #A2FFAB | 6..8 #A2A8FC | >=9 #0000FF

import { Layout } from './layout.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { WndMgr } from './wndmgr.js';

const WND = 'TargetStatusWnd';

const CON_COLORS = [
  [Infinity, '#FF0000'],     // <= -9 (matched via first rule below)
];

export function conColor(diff) {
  if (diff == null) return '#DCDCDC';
  if (diff <= -9) return '#FF0000';
  if (diff <= -6) return '#FF9191';
  if (diff <= -3) return '#FAFE91';
  if (diff <= 2) return '#DCDCDC';
  if (diff <= 5) return '#A2FFAB';
  if (diff <= 8) return '#A2A8FC';
  return '#0000FF';
}

export class TargetStatusWnd {
  constructor(parent = document.body) {
    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 176;
    this.h = def && def.height ? def.height : 46;
    this.target = null;   // {id, name, kind, color, hp, maxHp, mp, maxMp}

    const root = document.createElement('div');
    root.id = 'l2-targetstatuswnd';
    root.style.cssText = `position:fixed;width:${Skin.px(this.w)}px;`
      + `height:${Skin.px(this.h)}px;z-index:12;display:none;`
      + 'pointer-events:none;';
    this.root = root;

    // --- BackTex: window body, autosize rule width = parent.width + A (-12)
    const backPos = Layout.pos(WND, 'BackTex');
    const backAuto = Layout.autosize(WND, 'BackTex');
    if (backPos) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${Skin.px(backPos.x)}px;`
        + `top:${Skin.px(backPos.y)}px;`
        + `width:${Skin.px(this.w + (backAuto ? backAuto.insets[0] : 0))}px;`
        + `height:${Skin.px(this.h)}px;`;
      // AUTHORED panel fill: BackTex carries no texture reference (the
      // record names no art); dark panel like the other retail windows.
      el.style.background = 'rgba(10,12,17,.72)';
      el.style.border = '1px solid #3a4254';
      el.style.borderRadius = '4px';
      root.appendChild(el);
      this.backEl = el;
    }

    // --- name, centered (TA_Center per the .uc) --------------------------
    const namePos = Layout.pos(WND, 'UserName');
    const nameAuto = Layout.autosize(WND, 'UserName');
    this.nameEl = document.createElement('div');
    this.nameEl.style.cssText = 'position:absolute;display:flex;'
      + 'align-items:center;justify-content:center;pointer-events:none;';
    if (namePos) {
      this.nameEl.style.left = `${Skin.px(namePos.x)}px`;
      this.nameEl.style.top = `${Skin.px(namePos.y)}px`;
      this.nameEl.style.width = `${Skin.px(this.w + (nameAuto ? nameAuto.insets[0] : 0) - namePos.x)}px`;
    }
    root.appendChild(this.nameEl);

    // --- HP / MP bars (has0: (16,26) / (16,33), insetA -26 -> width 150)
    this.bars = {};
    for (const key of ['HP', 'MP']) {
      const ctrl = 'bar' + key;
      const pos = Layout.pos(WND, ctrl);
      const auto = Layout.autosize(WND, ctrl);
      if (!pos) continue;
      const el = document.createElement('div');
      el.className = 'target-bar target-bar-' + key.toLowerCase();
      el.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
        + `top:${Skin.px(pos.y)}px;`
        + `width:${Skin.px(this.w + (auto ? auto.insets[0] : 0))}px;`
        + 'height:5px;border-radius:2px;overflow:hidden;'
        + 'background:rgba(10,12,17,.8);border:1px solid #222;';
      const fill = document.createElement('div');
      // AUTHORED bar art: BarCtrl renders natively (no texture reference in
      // the xdat); CSS gauge until NWindow.dll bar art is mined.
      fill.style.cssText = 'height:100%;width:100%;';
      el.appendChild(fill);
      root.appendChild(el);
      this.bars[key] = { el, fill };
    }

    // --- close button (AUTHORED position; record undecoded) ---------------
    const closeSize = Layout.size(WND, 'btnClose');
    const close = document.createElement('div');
    close.style.cssText = `position:absolute;right:${Skin.px(4)}px;`
      + `top:${Skin.px(4)}px;width:${Skin.px(closeSize ? closeSize.w : 15)}px;`
      + `height:${Skin.px(closeSize ? closeSize.h : 15)}px;`
      + 'cursor:pointer;pointer-events:auto;display:flex;'
      + 'align-items:center;justify-content:center;';
    Font.set(close, '×', { color: '#8a93a5' });
    close.addEventListener('click', () => this.hide());
    root.appendChild(close);

    parent.appendChild(root);
    WndMgr.register('TargetStatusWnd', this);
    this.onDefaultPosition();
  }

  // -- placement --------------------------------------------------------------

  /** WndMgr reset: retail docks the target frame at the top center.
   *  AUTHORED: the top gap (retail target frame hugs the top edge; the
   *  xdat carries no window position, positions are native). */
  onDefaultPosition() {
    const el = this.root;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `calc(50% - ${Skin.px(this.w) / 2}px)`;
    el.style.top = `${Skin.px(34)}px`;
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${o.left}px`;
    if (o.top != null) el.style.top = `${o.top}px`;
    if (o.right != null) el.style.right = `${o.right}px`;
    if (o.bottom != null) el.style.bottom = `${o.bottom}px`;
    return this;
  }

  // -- data -------------------------------------------------------------------

  // diff = viewerLevel - targetLevel (target_ok.color); null for players
  setTarget(id, name, { kind = 'npc', color = null, level = null } = {}) {
    this.target = { id, name, kind, color, level,
      hp: null, maxHp: null, mp: null, maxMp: null };
    Font.set(this.nameEl, name || `#${id}`,
      { color: conColor(color) });
    this._renderBars();
    this.root.style.display = 'block';
  }

  setColor(diff) {
    if (this.target) {
      this.target.color = diff;
      Font.set(this.nameEl, this.target.name, { color: conColor(diff) });
    }
  }

  updateStatus(hp, maxHp, mp, maxMp) {
    if (!this.target) return;
    Object.assign(this.target, { hp, maxHp, mp, maxMp });
    this._renderBars();
  }

  // uc: MP bar only for NON-attackable targets (players here; monsters are
  // the attackable case in the bridge data we have)
  _renderBars() {
    const t = this.target;
    if (!t) return;
    const hpFrac = t.maxHp ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 1;
    if (this.bars.HP) {
      this.bars.HP.el.style.display = 'block';
      this.bars.HP.fill.style.width = `${hpFrac * 100}%`;
    }
    const showMP = t.kind === 'player' && t.maxMp;
    if (this.bars.MP) {
      this.bars.MP.el.style.display = showMP ? 'block' : 'none';
      if (showMP) {
        const mpFrac = Math.max(0, Math.min(1, t.mp / t.maxMp));
        this.bars.MP.fill.style.width = `${mpFrac * 100}%`;
      }
    }
  }

  // click close: hide the DISPLAY only; the server-side target stays
  hide() {
    this.target = null;
    this.root.style.display = 'none';
  }
}
