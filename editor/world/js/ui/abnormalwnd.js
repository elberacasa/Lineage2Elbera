// Phase C.10 — AbnormalStatusWnd, the retail buff strip.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   WindowsInfo.ini   [AbnormalStatusWnd] posX=348 posY=583 — the
//                     decrypted retail file: default dock (SOURCED).
//   Interface.xdat    AbnormalStatusWnd holds ONE StatusIcon [StatusIcon-
//                     Ctrl] 26x26 at (12,0) — the cell frame is 26x26; the
//                     native control replicates it per effect.
//   AbnormalStatusWnd.uc  the strip model: every icon draws on
//                     L2UI.EtcWndBack.AbnormalBack (uc:188, script-referenced
//                     — staged via build_uiskin IMPLICIT; measured 26x26 of
//                     art inside its 32x32 export), icon Size 24 (uc:187,
//                     so a 1px inset inside the 26px frame), max 12 icons
//                     per row (NSTATUSICON_MAXCOL, uc:4), window hidden
//                     with 0 rows (UpdateWindowSize, uc:387).
//
// What the evidence does NOT say, and is therefore NOT invented:
//   - no debuff tint/border: the .uc uses ONE BackTex for all three
//     categories, and the library's AbnormalFrame1/2/3 are window-frame
//     strips, not icon frames. Debuffs render like buffs here.
//   - no under-icon countdown text: the .uc carries RemainTime per item
//     but draws no timer — remaining time lives in the tooltip only.
//   - no Normal/Etc/Short category split: those categories are decided
//     natively from client-side skill data; the gateway op carries none.
//
// Wire (frozen ops; gateway landing in parallel): `buffs{effects:
// [{skillId,level,duration}]}` is a FULL snapshot (party-style replace);
// `buffUpdate{add:[...], remove:[skillId]}` is a packet-level delta. Both
// are handled. `duration` follows the aCis AbnormalStatusUpdate packet
// (SECONDS, -1 = toggle/infinite; a defensive ms heuristic guards the
// landing: anything over a day can't be seconds). Local expiry drops
// timed effects at 0 even if a remove never comes (mirrors retail's
// countdown); toggles never expire client-side.

import { Skin } from './skin.js';
import { Layout } from './layout.js';
import { skillMeta, skillInfo } from '../gamedata.js';

const BACK = 'L2UI.EtcWndBack.AbnormalBack';   // AbnormalStatusWnd.uc:188
const CELL = 26;    // xdat StatusIcon control 26x26 (measured art agrees)
const ICON = 24;    // uc:187 info.Size = 24
const MAX_COL = 12; // NSTATUSICON_MAXCOL, AbnormalStatusWnd.uc:4
// Dock READ from WindowsInfo.ini [AbnormalStatusWnd] (see Layout.dock);
// resolved lazily because Layout loads after this module is evaluated.
const dock = () => {
  const d = Layout.dock('AbnormalStatusWnd');
  return d ? { left: d.x, top: d.y } : null;
};

export class AbnormalWnd {
  constructor(parent = document.body) {
    this.effects = [];    // {skillId, level, durationSec, t0}
    this._lastTick = 0;

    // frameless strip (the xdat window carries no chrome textures) —
    // same family as ShortcutWnd/PartyWnd: bare root + WndMgr drag
    const root = document.createElement('div');
    root.id = 'l2-abnormalwnd';
    root.style.cssText = 'position:fixed;z-index:12;display:none;pointer-events:auto;';
    this.root = root;
    parent.appendChild(root);
    const d = dock();
    if (d) this.place(d);   // no harvest -> leave it where it is
  }

  _normalize(e) {
    // aCis AbnormalStatusUpdate duration is in SECONDS, -1 = toggle /
    // infinite (gateway M10); guard the landing against an ms variant —
    // no buff lasts a day
    let d = Number(e.duration) || 0;
    if (d > 86400) d = d / 1000;
    return { skillId: e.skillId | 0, level: e.level | 0, durationSec: d, t0: performance.now() };
  }

  /** FULL snapshot (frozen op `buffs`) — replace, never merge. */
  setEffects(effects) {
    this.effects = (effects || []).map(e => this._normalize(e));
    this._render();
    return this;
  }

  /** Packet-level delta (frozen op `buffUpdate{add, remove}`). */
  applyUpdate(add = [], remove = []) {
    const rm = new Set((remove || []).map(id => id | 0));
    if (rm.size) this.effects = this.effects.filter(e => !rm.has(e.skillId));
    for (const e of add || []) {
      const n = this._normalize(e);
      const i = this.effects.findIndex(x => x.skillId === n.skillId);
      if (i >= 0) this.effects[i] = n; else this.effects.push(n);
    }
    this._render();
  }

  remaining(e, now = performance.now()) {
    if (e.durationSec < 0) return Infinity;   // -1 = toggle/infinite (M10)
    return Math.max(0, e.durationSec - (now - e.t0) / 1000);
  }

  /** Skill ids with a live toggle effect (duration -1, gateway M10) — the
   *  active-toggle signal the MagicSkillWnd / ShortcutWnd markers use. */
  toggleIds() {
    return new Set(this.effects.filter(e => e.durationSec < 0)
      .map(e => e.skillId));
  }

  async _render() {
    const root = this.root;
    root.replaceChildren();
    if (!this.effects.length) { root.style.display = 'none'; return; }
    root.style.display = 'block';
    const meta = await skillMeta();

    this.effects.forEach((e, i) => {
      // new row every MAX_COL icons (uc:207-211)
      const cell = document.createElement('div');
      cell.className = 'l2-buff-cell';
      cell.dataset.skillId = e.skillId;
      cell.style.cssText = `position:absolute;width:${Skin.px(CELL)}px;`
        + `height:${Skin.px(CELL)}px;`
        + `left:${Skin.px((i % MAX_COL) * CELL)}px;`
        + `top:${Skin.px(Math.floor(i / MAX_COL) * CELL)}px;`;
      if (Skin.sprite(BACK)) {
        Skin.apply(cell, BACK, { content: { w: CELL, h: CELL }, stretch: true });
      }
      const info = skillInfo(meta, e.skillId);
      cell.dataset.name = info.name;
      if (info.icon) {
        const img = document.createElement('img');
        img.src = info.icon;
        // 24px icon inside the 26px frame (uc:187) — the 1px inset is the
        // frame edge, derived not chosen
        const inset = (CELL - ICON) / 2;
        img.style.cssText = `position:absolute;left:${Skin.px(inset)}px;`
          + `top:${Skin.px(inset)}px;width:${Skin.px(ICON)}px;`
          + `height:${Skin.px(ICON)}px;display:block;`;
        img.draggable = false;
        img.addEventListener('error', () => img.remove());
        cell.appendChild(img);
      }
      root.appendChild(cell);
    });
    this._renderTooltips();
  }

  _renderTooltips() {
    const cells = this.root.querySelectorAll('.l2-buff-cell');
    this.effects.forEach((e, i) => {
      const cell = cells[i];
      if (!cell) return;
      // tooltip-only countdown (see header — the .uc draws no timer);
      // toggles (duration -1) carry no timer at all, just the name
      if (e.durationSec < 0) {
        cell.title = cell.dataset.name || '';
        return;
      }
      const left = Math.ceil(this.remaining(e));
      const mm = Math.floor(left / 60), ss = left % 60;
      cell.title = `${cell.dataset.name || ''}${cell.dataset.name ? ' — ' : ''}`
        + `${mm}:${String(ss).padStart(2, '0')}`;
    });
  }

  /** Per-frame hook from the main loop; throttled to 4 Hz (AUTHORED —
   *  tooltips tick in whole seconds, anything faster is invisible). */
  tick() {
    if (!this.effects.length) return;
    const now = performance.now();
    // AUTHORED redraw throttle. AbnormalStatusWnd.uc drives the countdown
    // off the engine's own tick; nothing in the client states a period, so
    // this is ours: fast enough that a 1s remaining-time label never skips.
    if (now - this._lastTick < 250) return;
    this._lastTick = now;
    const alive = this.effects.filter(e => this.remaining(e, now) > 0);
    if (alive.length !== this.effects.length) {
      // local expiry — mirrors retail's countdown even if no remove comes
      this.effects = alive;
      this._render();
      return;
    }
    this._renderTooltips();
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${Skin.px(o.left)}px`;
    if (o.top != null) el.style.top = `${Skin.px(o.top)}px`;
    if (o.right != null) el.style.right = `${o.right}px`;
    if (o.bottom != null) el.style.bottom = `${o.bottom}px`;
    return this;
  }

  /** WndMgr reset: the WindowsInfo.ini dock. */
  onDefaultPosition() {
    const d = dock();
    if (d) this.place(d);   // no harvest -> leave it where it is
  }
}
