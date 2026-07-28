// Phase C.3 — MagicSkillWnd, the skill window.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat   MagicSkillWnd is 256x335 and holds exactly two panes,
//                    ASkill (239x280) and PSkill (239x280), plus a 189x23
//                    TabCtrl skinned with skill_tab1 / skill_tab2.
//   MagicSkillWnd.uc HandleSkillList() routes each skill by ESkillCategory:
//                    SKILL_Passive -> "PSkill.PItemWnd", everything else ->
//                    "ASkill.SkillItem". So retail splits PASSIVE from
//                    ACTIVE+TOGGLE -- there is no third pane.
//   SkillList (0x58) carries `passive` and `disabled` per skill. The gateway
//                    now forwards both (it used to drop them).
//   skilltypes.json  ACTIVE / TOGGLE / PASSIVE from aCis's own skill XML,
//                    which is the only place toggles are distinguishable --
//                    the packet's boolean cannot express them.
//
// Rules that follow, and that the old invented skill bar got wrong:
//   * passive skills are NOT castable and CANNOT go on the shortcut bar
//   * toggle skills are castable, and are marked as toggles
//   * disabled skills (the packet's Lock) are shown but not usable

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { skillMeta, skillInfo } from '../gamedata.js';

const WND = 'MagicSkillWnd';
// Icon cell geometry: DATA-DRIVEN from the xdat grid block
// (docs/ui-mined-native.md §1): SkillItem carries cell 32x32 + gap (5,3)
// => pitch 37x35. The slot ART is hardcoded in NCItemWnd at 34x34 drawn at
// (x-1, y-1) with the 32x32 icon at (x, y) — 1px inset (0x101827a3/c9 in
// the doc). This replaces the earlier MEASURED-34 assumption.
const CELL_REF = 'l2ui.nwindow.icon_back';

let _types = null;

export function loadSkillTypes() {
  if (_types) return Promise.resolve(_types);
  return fetch('/gamedata/skilltypes.json')
    .then(r => (r.ok ? r.json() : null))
    .then(d => (_types = (d && d.types) || {}))
    .catch(() => (_types = {}));
}

/** 'ACTIVE' | 'TOGGLE' | 'PASSIVE'. Falls back to the packet's passive flag. */
export function skillType(id, passiveFlag) {
  const t = _types && _types[String(id)];
  if (t) return t;
  return passiveFlag ? 'PASSIVE' : 'ACTIVE';
}

export class SkillWnd {
  constructor(parent = document.body, { onCast } = {}) {
    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 256;
    this.h = def && def.height ? def.height : 335;
    this.onCast = onCast || (() => {});
    this.skills = [];
    this.tab = 'active';
    this._activeToggles = new Set();   // skill ids with a live toggle buff

    const pane = Layout.size(WND, 'ASkill') || { w: 239, h: 280 };
    this.pane = pane;
    this.cellArt = Skin.content(CELL_REF);
    const cellArt = this.cellArt;
    const grid = Layout.grid(WND, 'SkillItem')
      || { cellX: 32, cellY: 32, gapX: 5, gapY: 3 };
    this.cellIcon = grid.cellX;                       // 32 icon
    this.pitch = { x: grid.cellX + grid.gapX, y: grid.cellY + grid.gapY };  // 37 x 35
    this.cell = cellArt ? cellArt.w : this.cellIcon + 2;   // 34 slot art

    const win = new L2Window({
      title: 'Skill', width: this.w, height: this.h, closable: true,
      winName: WND,
    });
    win.root.id = 'l2-skillwnd';
    this.win = win;
    this.root = win.root;

    // --- tab strip (Active | Passive), skinned from the xdat's TabCtrl ---
    const tabSize = Layout.size(WND, 'TabCtrl') || { w: 189, h: 23 };
    const tabs = document.createElement('div');
    tabs.style.cssText = 'position:absolute;display:flex;';
    // MINED (docs/ui-mined-values.md §3): TabCtrl at (12,8). Fallback keeps
    // the previous AUTHORED offset if the lookup ever fails.
    const tabPos = Layout.pos(WND, 'TabCtrl') ?? { x: 6, y: 4 };
    tabs.style.left = `${Skin.px(tabPos.x)}px`;
    tabs.style.top = `${Skin.px(tabPos.y)}px`;
    tabs.style.height = `${Skin.px(tabSize.h)}px`;
    win.body.appendChild(tabs);

    const tabRefs = Layout.tex(WND, 'TabCtrl').filter(r => Skin.sprite(r));
    const onTex = tabRefs[1] || tabRefs[0] || null;
    const offTex = tabRefs[0] || null;
    this.tabEls = {};
    for (const [key, label] of [['active', 'Active'], ['passive', 'Passive']]) {
      const t = document.createElement('div');
      t.style.cssText = 'cursor:pointer;display:flex;align-items:center;'
        + 'justify-content:center;pointer-events:auto;';
      t.style.width = `${Skin.px(tabSize.w / 2)}px`;
      t.style.height = `${Skin.px(tabSize.h)}px`;
      t.addEventListener('click', () => this.setTab(key));
      tabs.appendChild(t);
      this.tabEls[key] = { el: t, label, onTex, offTex };
    }

    // --- the two panes ---
    const panePos = Layout.pos(WND, 'ASkill') ?? { x: 6, y: tabPos.y + tabSize.h + 9 };
    this.panes = {};
    for (const key of ['active', 'passive']) {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;overflow-y:auto;overflow-x:hidden;'
        + 'display:none;align-content:flex-start;flex-wrap:wrap;pointer-events:auto;';
      // MINED (docs/ui-mined-values.md §3): both panes share (9,40) —
      // they are alternates. Fallback keeps the previous AUTHORED inset.
      p.style.left = `${Skin.px(panePos.x)}px`;
      p.style.top = `${Skin.px(panePos.y)}px`;
      p.style.width = `${Skin.px(pane.w)}px`;
      p.style.height = `${Skin.px(pane.h)}px`;
      p.style.display = 'none';
      win.body.appendChild(p);
      this.panes[key] = p;
    }

    // --- footer count ---
    const foot = document.createElement('div');
    foot.style.cssText = 'position:absolute;pointer-events:none;';
    // AUTHORED: footer is ours — retail has no skill-count line, and no
    // mined value exists for it; anchored under the mined pane rect.
    foot.style.left = `${Skin.px(8)}px`;
    foot.style.top = `${Skin.px(panePos.y + pane.h + 4)}px`;
    win.body.appendChild(foot);
    this.footEl = foot;

    parent.appendChild(win.root);
    this.defaultPlace = { right: 12, top: 60 };
    this.setTab('active');
    this._renderTabs();
  }

  _renderTabs() {
    for (const [key, t] of Object.entries(this.tabEls)) {
      const active = this.tab === key;
      const ref = active ? t.onTex : t.offTex;
      if (ref) Skin.apply(t.el, ref, { stretch: true });
      Font.set(t.el, t.label,
               { color: active ? '#f0e0b0' : '#9a9a8c' });
    }
  }

  setTab(key) {
    this.tab = key;
    for (const [k, p] of Object.entries(this.panes)) {
      p.style.display = k === key ? 'flex' : 'none';
    }
    this._renderTabs();
    this._renderFoot();
    return this;
  }

  _renderFoot() {
    const list = this.skills.filter(s => this._bucket(s) === this.tab);
    Font.set(this.footEl, `${list.length} skills`, { color: '#8a93a5' });
  }

  _bucket(s) {
    return skillType(s.id, s.passive) === 'PASSIVE' ? 'passive' : 'active';
  }

  /** Feed the bridge's skillList payload straight in. */
  async setSkills(skills) {
    this.skills = skills || [];
    const meta = await skillMeta();

    for (const key of ['active', 'passive']) this.panes[key].replaceChildren();

    for (const s of this.skills) {
      const type = skillType(s.id, s.passive);
      const bucket = type === 'PASSIVE' ? 'passive' : 'active';
      const info = skillInfo(meta, s.id);

      const cell = document.createElement('div');
      cell.className = 'l2-skill-cell';
      cell.dataset.skillId = s.id;
      // slot art (34) sits at (x-1, y-1) around the 32px icon; the pitch
      // advances by icon+gap (37x35) — emulate with a padded cell
      cell.style.cssText = 'position:relative;overflow:visible;'
        + `width:${Skin.px(this.pitch.x)}px;height:${Skin.px(this.pitch.y)}px;`
        + 'display:flex;align-items:center;justify-content:center;';
      const inner = document.createElement('div');
      inner.style.cssText = `position:relative;width:${Skin.px(this.cell)}px;`
        + `height:${Skin.px(this.cell)}px;overflow:hidden;`
        + 'display:flex;align-items:center;justify-content:center;';
      if (this.cellArt) Skin.apply(inner, CELL_REF, { content: { w: this.cell, h: this.cell } });
      cell.appendChild(inner);
      cell.title = `${info.name} (Lv ${s.level}) — ${type}`
        + (s.disabled ? ' — unavailable' : '');

      if (info.icon) {
        const img = document.createElement('img');
        img.src = info.icon;
        img.style.cssText = `width:${Skin.px(this.cellIcon)}px;`
          + `height:${Skin.px(this.cellIcon)}px;display:block;`;
        img.draggable = false;
        inner.appendChild(img);
      }

      // Passive skills are not usable and never reach the shortcut bar --
      // MagicSkillWnd.uc puts them in a separate pane precisely because they
      // are a different kind of thing.
      if (type === 'PASSIVE') {
        cell.style.cursor = 'default';
        cell.style.opacity = '0.85';
      } else if (s.disabled) {
        cell.style.cursor = 'not-allowed';
        cell.style.opacity = '0.4';
      } else {
        cell.style.cursor = 'pointer';
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-l2vzla',
            JSON.stringify({ type: 'skill', id: s.id }));
        });
        cell.addEventListener('click', () => this.onCast(s.id, type));
        if (this.onAssign) {
          cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.onAssign({ type: 'skill', id: s.id });
          });
        }
      }

      // toggles are active but behave differently; mark them
      if (type === 'TOGGLE') {
        const dot = document.createElement('div');
        dot.style.cssText = 'position:absolute;left:1px;top:1px;'
          + 'width:5px;height:5px;border-radius:50%;background:#7fd8e8;'
          + 'box-shadow:0 0 3px #000;';
        cell.appendChild(dot);
      }

      this.panes[bucket].appendChild(cell);
    }
    this._renderFoot();
    this._applyToggleMarks();
  }

  /** Active-toggle marker. The SIGNAL is sourced — a buff with duration -1
   *  IS the active toggle (gateway M10; AbnormalWnd.toggleIds). The VISUAL
   *  is AUTHORED: neither MagicSkillWnd.uc nor ShortcutWnd.uc draws an
   *  active-toggle state (both checked — silent), so a plain border stands
   *  in. Deactivate needs no special op: clicking an active toggle re-sends
   *  useSkill and aCis stops it (PlayerCast.doToggleCast — "if the toggle
   *  is already active, we don't need to do anything else besides
   *  stopping it"). */
  setActiveToggles(ids) {
    this._activeToggles = ids || new Set();
    this._applyToggleMarks();
    return this;
  }

  _applyToggleMarks() {
    const ids = this._activeToggles;
    for (const cell of this.root.querySelectorAll('.l2-skill-cell[data-skill-id]')) {
      const id = +cell.dataset.skillId;
      cell.classList.toggle('l2-toggle-active',
        ids.has(id) && skillType(id) === 'TOGGLE');
    }
  }

  /** Only the skills the shortcut bar may legally hold. */
  usableSkills() {
    return this.skills.filter(
      s => skillType(s.id, s.passive) !== 'PASSIVE' && !s.disabled);
  }

  /** Same cooldown sweep as the shortcut bar (see its tickCooldowns for
   *  the sourced-timing / AUTHORED-visual split). */
  tickCooldowns(skillBar) {
    for (const cell of this.root.querySelectorAll('.l2-skill-cell[data-skill-id]')) {
      const left = skillBar.reuseLeft(+cell.dataset.skillId);
      const inner = cell.firstElementChild;
      if (!inner) continue;
      let ov = inner.querySelector('.l2-cool-overlay');
      if (!left) { if (ov) ov.remove(); continue; }
      if (!ov) {
        ov = document.createElement('div');
        ov.className = 'l2-cool-overlay';
        ov.style.cssText = 'position:absolute;left:0;top:0;width:100%;'
          + 'background:rgba(0,0,0,0.65);pointer-events:none;';
        inner.appendChild(ov);
      }
      ov.style.height = `${(left.frac * 100).toFixed(1)}%`;
    }
  }

  isPassive(id) {
    const s = this.skills.find(x => x.id === id);
    return skillType(id, s && s.passive) === 'PASSIVE';
  }

  place(o = {}) { this.win.place(o); return this; }
  show() { this.win.show(); return this; }
  hide() { this.win.hide(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { this.win.toggle(force); return this; }

  onDefaultPosition() {
    this.setTab('active');
    this.place(this.defaultPlace);
  }

  clear() {
    this.skills = [];
    for (const key of ['active', 'passive']) this.panes[key].replaceChildren();
    this._renderFoot();
    this.hide();
  }
}
