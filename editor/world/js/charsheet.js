// M5: character sheet window (C key). L2 stat layout: base stats left,
// combat stats right; level/exp from selfStatus, equipped gear from the
// inventory (itemmeta names). Refreshes live on new charSheet ops.

import { itemMeta, itemInfo } from './gamedata.js';

const BASE = ['str', 'dex', 'con', 'int', 'wit', 'men'];
const COMBAT = [
  ['pAtk', 'P. Atk'], ['pDef', 'P. Def'], ['mAtk', 'M. Atk'], ['mDef', 'M. Def'],
  ['accuracy', 'Accuracy'], ['evasion', 'Evasion'], ['critical', 'Critical'],
  ['runSpeed', 'Run Spd'], ['walkSpeed', 'Walk Spd'],
  ['pAtkSpd', 'Atk. Spd'], ['mAtkSpd', 'Cast. Spd'],
];

export class CharSheet {
  constructor(panelEl, { getSelf, getSheet, getEquipped } = {}) {
    this.panel = panelEl;
    this.getSelf = getSelf || (() => null);
    this.getSheet = getSheet || (() => null);
    this.getEquipped = getEquipped || (() => []);
    panelEl.querySelector('.inv-close').addEventListener('click', () => this.toggle(false));
  }

  toggle(force) {
    const show = force ?? !this.panel.classList.contains('visible');
    if (show) this.render();
    this.panel.classList.toggle('visible', show);
  }

  async render() {
    const s = this.getSheet() || {};
    const self = this.getSelf() || {};
    const meta = await itemMeta();
    const row = (k, v) => `<tr><td>${k}</td><td>${v ?? '—'}</td></tr>`;

    const base = BASE.map(k => row(k.toUpperCase(), s[k])).join('');
    const combat = COMBAT.map(([k, label]) => row(label, s[k])).join('');
    const gear = this.getEquipped().map(it => {
      const info = itemInfo(meta, it.itemId);
      return `<div class="gear-line">${info.name}${it.enchant ? ' +' + it.enchant : ''}</div>`;
    }).join('') || '<div class="gear-line">—</div>';

    this.panel.querySelector('.sheet-body').innerHTML = `
      <div class="sheet-cols">
        <table>${base}</table>
        <table>${combat}</table>
      </div>
      <div class="sheet-sub">Lv ${self.level ?? '—'} · exp ${self.exp ?? '—'} · SP ${self.sp ?? '—'}</div>
      <div class="sheet-gear">${gear}</div>`;
  }

  clear() { this.toggle(false); }
}
